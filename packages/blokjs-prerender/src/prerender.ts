import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname, basename, join, relative, sep } from 'node:path'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import * as esbuild from 'esbuild'
import { renderToString, component, store, validate, type MountOptions } from '@maleta/blokjs/server'
import { findElementById, scripts, tags } from './html'

export interface PrerenderOptions {
  /** Routes to render. Default: every route without params, wildcard or guard; `/` without a router. */
  routes?: string[]
  /** Output directory. Default: the directory of the input file. Required with `inline`. */
  out?: string
  /** Embed local scripts, local stylesheets and the blokjs runtime into each file, minified. */
  inline?: boolean
  warn?: (msg: string) => void
}

export interface PrerenderResult {
  route: string
  file: string
}

interface CapturedMount {
  id: string
  opts: MountOptions
}

interface Script {
  start: number
  end: number
  kind: 'blokjs' | 'code' | 'keep'
  deferred: boolean
  module: boolean
  name: string
  /** Code that runs during prerendering; module scripts are bundled against the sandbox `blok` */
  code: string
  /** Inline module source, bundled again for the browser */
  source?: string
  path?: string
}

const SSR_ATTR = 'data-blok-ssr'
const TARGET = Symbol('mount target')
const BLOKJS_SRC = /(^|\/)blokjs(\.esm)?(\.min)?\.js$/
const CDN_BLOKJS = /@maleta\/blokjs(@[^/]+)?\//
const BLOKJS_IMPORT = /^@maleta\/blokjs$|@maleta\/blokjs(@[^/]+)?\/dist\/blokjs/
const JS_TYPES = new Set(['', 'text/javascript', 'application/javascript', 'module'])
const REMOTE = /^(https?:)?\/\//i

/**
 * Render a BlokJS page to static HTML, one file per route.
 * Scripts of the page run in a sandbox where `blok` comes from `@maleta/blokjs/server`;
 * each `blok.mount('#id', opts)` call is rendered into the element with that id.
 * @param file - the page, e.g. `index.html`
 * @returns the files written, in route order
 * @throws when a script fails, nothing is mounted, a mount target is missing from the page,
 *   or `inline` would overwrite the source page
 */
export async function prerender(file: string, options: PrerenderOptions = {}): Promise<PrerenderResult[]> {
  const warn = options.warn ?? ((msg: string) => console.warn(`[blokjs-prerender] ${msg}`))
  const htmlPath = resolve(file)
  const baseDir = dirname(htmlPath)
  const html = readFileSync(htmlPath, 'utf-8')
  const outDir = resolve(options.out ?? baseDir)
  if (options.inline && outDir === baseDir) {
    throw new Error('--inline replaces script and stylesheet tags, so it needs an --out directory other than the page\'s own')
  }

  const pageScripts = await collectScripts(html, baseDir, !!options.inline, warn)
  const mounts = runScripts(pageScripts)
  if (mounts.length === 0) throw new Error(`No blok.mount() call found in ${file}`)

  const routedMounts = mounts.filter(m => m.opts.routes)
  if (routedMounts.length > 1) {
    warn(`Only one mount can declare routes; mounting #${routedMounts[1].id} throws in the browser.`)
  }
  const routed = routedMounts[0]?.opts
  let routes = options.routes ?? defaultRoutes(routed)
  if (routed?.mode === 'hash' && routes.some(r => r !== '/')) {
    warn('Hash routes share one HTML file, so only "/" is rendered.')
    routes = ['/']
  }

  const template = options.inline ? await inlineAssets(html, pageScripts, baseDir) : html

  const results: PrerenderResult[] = []
  for (const route of routes) {
    if (!route.startsWith('/') || route.includes('?') || route.includes('#')) {
      throw new Error(`Route must be a path starting with "/": ${route}`)
    }
    let page = template
    for (const m of mounts) page = inject(page, m.id, renderToString(m.opts, { url: route }))
    const out = join(outDir, routeFile(route, basename(htmlPath)))
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, page)
    results.push({ route, file: out })
  }
  return results
}

function defaultRoutes(opts: MountOptions | undefined): string[] {
  if (!opts?.routes) return ['/']
  const paths = opts.routes
    .filter(r => r.path !== '*' && !r.path.includes(':') && !r.guard)
    .map(r => r.path)
  return paths.length > 0 ? paths : ['/']
}

// `/about` becomes about.html, which static hosts serve at /about (about/index.html would be /about/)
function routeFile(route: string, indexName: string): string {
  if (route === '/') return indexName
  const path = route.slice(1)
  return path.endsWith('/') ? `${path}index.html` : `${path}.html`
}

function inject(page: string, id: string, content: string): string {
  const el = findElementById(page, id)
  if (!el) throw new Error(`Mount target #${id} not found in the page`)
  let open = page.slice(el.openStart, el.openEnd)
  if (!new RegExp(`\\s${SSR_ATTR}(?=[\\s=/>])`).test(open)) {
    open = open.replace(/\s*\/?>$/, ` ${SSR_ATTR}>`)
  }
  return page.slice(0, el.openStart) + open + content + page.slice(el.closeStart)
}

async function collectScripts(html: string, baseDir: string, inline: boolean, warn: (msg: string) => void): Promise<Script[]> {
  const out: Script[] = []
  for (const s of scripts(html)) {
    const type = (s.attrs.type ?? '').trim().toLowerCase()
    const src = s.attrs.src
    const module = type === 'module'
    const base = { start: s.start, end: s.end, module, name: src ?? 'inline script' }
    const keep = { ...base, kind: 'keep' as const, deferred: false, code: '' }
    if (!JS_TYPES.has(type)) {
      out.push(keep)
      continue
    }

    if (src !== undefined && (BLOKJS_SRC.test(src.split(/[?#]/)[0]) || CDN_BLOKJS.test(src))) {
      const version = src.match(CDN_BLOKJS)?.[1]
      if (!inline && REMOTE.test(src) && (!version || version === '@latest')) {
        warn(`Pin the blokjs version in ${src}: a cached older runtime appends to prerendered HTML instead of hydrating it, showing the content twice.`)
      }
      out.push({ ...keep, kind: 'blokjs' })
      continue
    }
    if (src !== undefined && REMOTE.test(src)) {
      warn(`Skipped remote script ${src}: it is not evaluated during prerendering${inline ? ' and stays an external file' : ''}.`)
      out.push(keep)
      continue
    }

    const path = src === undefined ? undefined : resolve(baseDir, src.split(/[?#]/)[0].replace(/^\//, ''))
    const deferred = module || (src !== undefined && ('defer' in s.attrs || 'async' in s.attrs))
    if (!module) {
      out.push({ ...base, kind: 'code', deferred, code: path ? readFileSync(path, 'utf-8') : s.code, path })
      continue
    }
    try {
      const code = await bundleModule(path ? { path } : { code: s.code }, baseDir, 'global', false)
      out.push({ ...base, kind: 'code', deferred, code, source: s.code, path })
    } catch (e) {
      warn(`Skipped module script (${base.name}): ${firstLine(e)}`)
      out.push(keep)
    }
  }
  return out
}

function firstLine(e: unknown): string {
  const err = e as { errors?: { text: string }[]; message?: string }
  return err.errors?.[0]?.text ?? String(err.message).split('\n')[0]
}

// One classic script per module script; blokjs imports resolve to the global `blok` or to a bundled ESM build
async function bundleModule(entry: { path?: string; code?: string }, baseDir: string, runtime: string, minify: boolean): Promise<string> {
  const result = await esbuild.build({
    ...(entry.path
      ? { entryPoints: [entry.path] }
      : { stdin: { contents: entry.code!, resolveDir: baseDir, sourcefile: 'inline module', loader: 'js' as const } }),
    bundle: true,
    format: 'iife',
    target: 'es2020',
    write: false,
    minify,
    logLevel: 'silent',
    plugins: [{
      name: 'blokjs',
      setup(build) {
        build.onResolve({ filter: BLOKJS_IMPORT }, () =>
          runtime === 'global' ? { path: 'blok', namespace: 'blok-global' } : { path: runtime })
        build.onResolve({ filter: REMOTE }, (args) => ({ errors: [{ text: `remote import ${args.path} cannot be bundled` }] }))
        build.onLoad({ filter: /.*/, namespace: 'blok-global' }, () => ({
          contents: 'const b = globalThis.blok\nexport const mount = b.mount, component = b.component, store = b.store, validate = b.validate',
          loader: 'js',
        }))
      },
    }],
  })
  return result.outputFiles[0].text
}

function runScripts(pageScripts: Script[]): CapturedMount[] {
  const mounts: CapturedMount[] = []
  const ready: (() => void)[] = []
  const context = vm.createContext(sandbox(mounts, ready))
  const code = pageScripts.filter(s => s.kind === 'code')
  for (const s of [...code.filter(s => !s.deferred), ...code.filter(s => s.deferred)]) {
    try {
      vm.runInContext(s.code, context, { filename: s.name })
    } catch (e) {
      throw new Error(`${s.name}: ${(e as Error).message}`)
    }
  }
  for (const fn of ready) {
    try {
      fn()
    } catch (e) {
      throw new Error(`DOMContentLoaded listener: ${(e as Error).message}`)
    }
  }
  return mounts
}

// Globals for page scripts: enough for registering components and calling mount, not a DOM
function sandbox(mounts: CapturedMount[], ready: (() => void)[]): Record<string, unknown> {
  const target = (id: string) => ({ id, [TARGET]: true })
  const onEvent = (type: string, fn: () => void) => {
    if (type === 'DOMContentLoaded' || type === 'load') ready.push(fn)
  }
  const storage = { getItem: () => null, setItem() {}, removeItem() {}, clear() {}, key: () => null, length: 0 }
  const noop = () => 0

  const blok = {
    component,
    store,
    validate,
    mount(t: unknown, opts: MountOptions) {
      mounts.push({ id: targetId(t), opts })
      return { destroy() {} }
    },
  }

  const g: Record<string, unknown> = {
    blok,
    console,
    document: {
      readyState: 'loading',
      addEventListener: onEvent,
      getElementById: (id: string) => target(id),
      querySelector: (sel: string) => (/^#[\w-]+$/.test(sel) ? target(sel.slice(1)) : null),
    },
    addEventListener: onEvent,
    localStorage: storage,
    sessionStorage: storage,
    setTimeout: noop,
    clearTimeout: noop,
    setInterval: noop,
    clearInterval: noop,
    queueMicrotask,
    performance,
    URL,
    URLSearchParams,
    structuredClone,
  }
  g.window = g
  g.self = g
  return g
}

function targetId(t: unknown): string {
  if (typeof t === 'string' && /^#[\w-]+$/.test(t)) return t.slice(1)
  if (t && typeof t === 'object' && TARGET in t && 'id' in t) return String(t.id)
  throw new Error(`Mount target must be "#id" or document.getElementById("id"), got ${String(t)}`)
}

function blokjsFile(name: string): string {
  const pkg = createRequire(import.meta.url).resolve('@maleta/blokjs/package.json')
  return join(dirname(pkg), 'dist', name)
}

interface Replacement {
  start: number
  end: number
  text: string
}

// The embedded runtime is the version this CLI renders with, so its hydration markers always match
async function inlineAssets(html: string, pageScripts: Script[], baseDir: string): Promise<string> {
  const reps: Replacement[] = []
  const atBodyEnd: string[] = []
  const hasGlobalRuntime = pageScripts.some(s => s.kind === 'blokjs' && !s.module)
  const moduleRuntime = hasGlobalRuntime ? 'global' : blokjsFile('blokjs.esm.min.js')

  for (const s of pageScripts) {
    if (s.kind === 'keep') continue
    let code: string
    if (s.kind === 'blokjs') {
      code = readFileSync(blokjsFile('blokjs.min.js'), 'utf-8').trim()
    } else if (s.module) {
      code = (await bundleModule(s.path ? { path: s.path } : { code: s.source }, baseDir, moduleRuntime, true)).trim()
    } else {
      code = (await esbuild.transform(s.code, { loader: 'js', minify: true, target: 'es2020' })).code.trim()
    }
    const tag = `<script>${code}</script>`
    // A deferred script runs once parsing is done, which is where an inline script at the end of <body> runs
    if (s.deferred) {
      reps.push({ start: s.start, end: s.end, text: '' })
      atBodyEnd.push(tag)
    } else {
      reps.push({ start: s.start, end: s.end, text: tag })
    }
  }

  for (const t of tags(html)) {
    if (t.closing || t.name !== 'link') continue
    const rel = (t.attrs.rel ?? '').toLowerCase().split(/\s+/)
    const href = t.attrs.href
    if (!rel.includes('stylesheet') || !href || REMOTE.test(href) || href.startsWith('data:')) continue
    const cssPath = resolve(baseDir, href.split(/[?#]/)[0].replace(/^\//, ''))
    const css = rebaseUrls(readFileSync(cssPath, 'utf-8'), dirname(cssPath), baseDir)
    const min = (await esbuild.transform(css, { loader: 'css', minify: true })).code.trim()
    const media = t.attrs.media ? ` media="${t.attrs.media.replace(/"/g, '&quot;')}"` : ''
    reps.push({ start: t.start, end: t.end, text: `<style${media}>${min.replace(/<\/style/gi, '<\\/style')}</style>` })
  }

  if (atBodyEnd.length > 0) {
    let bodyEnd = html.length
    for (const t of tags(html)) if (t.closing && t.name === 'body') bodyEnd = t.start
    reps.push({ start: bodyEnd, end: bodyEnd, text: atBodyEnd.join('\n') })
  }

  reps.sort((a, b) => a.start - b.start)
  let out = ''
  let pos = 0
  for (const r of reps) {
    out += html.slice(pos, r.start) + r.text
    pos = r.end
  }
  return out + html.slice(pos)
}

// url() and @import paths in a stylesheet are relative to the stylesheet; inlined, they resolve against the page
function rebaseUrls(css: string, cssDir: string, pageDir: string): string {
  const rebase = (p: string) => {
    if (/^([a-z][\w+.-]*:|\/|#)/i.test(p)) return p
    return relative(pageDir, resolve(cssDir, p)).split(sep).join('/')
  }
  return css
    .replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (_, q, p) => `url(${q}${rebase(p)}${q})`)
    .replace(/@import\s+(['"])([^'"]+)\1/g, (_, q, p) => `@import ${q}${rebase(p)}${q}`)
}
