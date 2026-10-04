import { describe, it, expect, afterEach, vi } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { prerender } from '../src/prerender'

let dir = ''

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = ''
  vi.restoreAllMocks()
})

function site(files: Record<string, string>): string {
  dir = mkdtempSync(join(tmpdir(), 'blokjs-prerender-'))
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true })
    writeFileSync(join(dir, name), content)
  }
  return join(dir, 'index.html')
}

const PAGE = `<!DOCTYPE html>
<html>
<head>
  <title>t</title>
  <script src="https://cdn.jsdelivr.net/npm/@maleta/blokjs@0.5.0/dist/blokjs.min.js"></script>
  <script src="/components.js" defer></script>
</head>
<body>
  <div id="app"></div>
  <script>
    const helper = (t) => ({ p: t })
    document.addEventListener('DOMContentLoaded', () => {
      blok.mount('#app', {
        state: { theme: localStorage.getItem('theme') || 'light' },
        routes: [
          { path: '/', component: 'Home' },
          { path: '/about', component: 'About' },
          { path: '/users/:id', component: 'About' },
          { path: '/admin', component: 'About', guard: 'auth' },
        ],
        guards: { auth: () => false },
        view: ($) => ({ div: { class: $.theme, children: [helper('Header & nav'), { main: { route: true } }] } }),
      })
    })
  </script>
  <footer><div id="other">keep</div></footer>
</body>
</html>`

const COMPONENTS = `
blok.component('Home', { view: () => ({ h1: 'Welcome home' }) })
blok.component('About', { view: () => ({ h1: 'About us' }) })
`

describe('prerender', () => {
  it('writes one file per static route with the rendered content', async () => {
    const file = site({ 'index.html': PAGE, 'components.js': COMPONENTS })
    const results = await prerender(file, { warn: () => {} })
    expect(results.map(r => r.route)).toEqual(['/', '/about'])

    const home = readFileSync(file, 'utf-8')
    expect(home).toContain('<div id="app" data-blok-ssr><div class="light"><p>Header &amp; nav</p><main><h1>Welcome home</h1></main></div></div>')
    const about = readFileSync(join(dir, 'about.html'), 'utf-8')
    expect(about).toContain('<main><h1>About us</h1></main>')
    expect(existsSync(join(dir, 'admin.html'))).toBe(false)
  })

  it('leaves the rest of the page unchanged and is idempotent', async () => {
    const file = site({ 'index.html': PAGE, 'components.js': COMPONENTS })
    await prerender(file, { warn: () => {} })
    const first = readFileSync(file, 'utf-8')
    const [before, after] = PAGE.split('<div id="app"></div>')
    expect(first.startsWith(before)).toBe(true)
    expect(first.endsWith(after)).toBe(true)
    await prerender(file, { warn: () => {} })
    expect(readFileSync(file, 'utf-8')).toBe(first)
  })

  it('renders explicit routes into an output directory', async () => {
    const file = site({ 'index.html': PAGE, 'components.js': COMPONENTS })
    const out = join(dir, 'dist')
    await prerender(file, { routes: ['/users/7', '/docs/'], out, warn: () => {} })
    expect(readFileSync(join(out, 'users/7.html'), 'utf-8')).toContain('About us')
    expect(existsSync(join(out, 'docs/index.html'))).toBe(true)
    expect(readFileSync(file, 'utf-8')).toBe(PAGE)
  })

  it('warns about unpinned blokjs, remote and module scripts', async () => {
    const page = `<div id="app"></div>
<script src="https://cdn.jsdelivr.net/npm/@maleta/blokjs/dist/blokjs.min.js"></script>
<script src="https://cdn.example.com/lib.js"></script>
<script type="module">import x from './x.js'</script>
<script type="application/ld+json">{"a":1}</script>
<script>blok.mount(document.getElementById('app'), { view: () => ({ p: 'hi' }) })</script>`
    const file = site({ 'index.html': page })
    const warnings: string[] = []
    await prerender(file, { warn: (m) => warnings.push(m) })
    expect(warnings).toHaveLength(3)
    expect(warnings[0]).toContain('Pin the blokjs version')
    expect(warnings[1]).toContain('Skipped remote script')
    expect(warnings[2]).toContain('Skipped module script')
    expect(readFileSync(file, 'utf-8')).toContain('<div id="app" data-blok-ssr><p>hi</p></div>')
  })

  it('ignores markup inside scripts when finding the mount node', async () => {
    const page = `<script>const s = '<div id="app"></div>'</script>
<div id="app"><div>old</div></div>
<script>blok.mount('#app', { view: () => ({ p: 'new' }) })</script>`
    const file = site({ 'index.html': page })
    await prerender(file, { warn: () => {} })
    const out = readFileSync(file, 'utf-8')
    expect(out).toContain(`const s = '<div id="app"></div>'`)
    expect(out).toContain('<div id="app" data-blok-ssr><p>new</p></div>')
  })

  it('names the failing script', async () => {
    const file = site({ 'index.html': '<div id="app"></div><script src="app.js"></script>', 'app.js': 'document.body.appendChild(1)' })
    await expect(prerender(file, { warn: () => {} })).rejects.toThrow(/app\.js: .*appendChild|app\.js: .*body/)
  })

  it('fails when nothing is mounted or the target is missing', async () => {
    const none = site({ 'index.html': '<div id="app"></div><script>1</script>' })
    await expect(prerender(none)).rejects.toThrow('No blok.mount() call')
    rmSync(dir, { recursive: true, force: true })
    const missing = site({ 'index.html': `<div id="x"></div><script>blok.mount('#app', { view: () => ({ p: 1 }) })</script>` })
    await expect(prerender(missing)).rejects.toThrow('#app not found')
  })
})
