import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { prerender } from '../src/prerender'
import { hydrate } from './dom'

let dir = ''

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = ''
})

function site(files: Record<string, string>): string {
  dir = mkdtempSync(join(tmpdir(), 'blokjs-inline-'))
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true })
    writeFileSync(join(dir, name), content)
  }
  return join(dir, 'index.html')
}

const CLASSIC = {
  'index.html': `<!DOCTYPE html>
<html>
<head>
  <link rel="stylesheet" href="css/site.css">
  <link rel="stylesheet" href="css/print.css" media="print">
  <link rel="stylesheet" href="https://fonts.example.com/font.css">
  <script src="https://cdn.jsdelivr.net/npm/@maleta/blokjs/dist/blokjs.min.js"></script>
  <script src="lib/components.js" defer></script>
</head>
<body>
  <div id="app"></div>
  <script src="https://cdn.example.com/analytics.js"></script>
  <script>
    // removed by the minifier
    const greeting = 'Hello from the inline script'
    document.addEventListener('DOMContentLoaded', () => {
      blok.mount('#app', {
        state: { greeting, n: 0 },
        methods: { inc() { this.n++ } },
        view: ($) => ({ main: { children: [
          { h1: $.greeting },
          { Card: { title: 'card' } },
          { button: { click: 'inc', text: $.n } },
        ] } }),
      })
    })
  </script>
</body>
</html>`,
  'css/site.css': 'body { background: url(../img/bg.png) }  /* note */ .card > h2 { margin: 0px }',
  'css/print.css': 'nav { display: none }',
  'lib/components.js': `blok.component('Card', { props: ['title'], view: ($) => ({ section: { class: 'card', children: [{ h2: $.title }] } }) })`,
}

describe('--inline with classic scripts', () => {
  it('needs an output directory other than the page directory', async () => {
    const file = site(CLASSIC)
    await expect(prerender(file, { inline: true })).rejects.toThrow('--out')
    await expect(prerender(file, { inline: true, out: dir })).rejects.toThrow('--out')
  })

  it('embeds local scripts, local styles and the runtime, and keeps remote files', async () => {
    const file = site(CLASSIC)
    const [{ file: outFile }] = await prerender(file, { inline: true, out: join(dir, 'dist'), warn: () => {} })
    const out = readFileSync(outFile, 'utf-8')

    expect(out).not.toMatch(/src="lib\/components\.js"|href="css\//)
    expect(out).not.toContain('cdn.jsdelivr.net/npm/@maleta/blokjs')
    expect(out).toContain('window.blok={component:')
    expect(out).toContain('<style>body{background:url(img/bg.png)}.card>h2{margin:0}</style>')
    expect(out).toContain('<style media="print">nav{display:none}</style>')
    expect(out).toContain('<link rel="stylesheet" href="https://fonts.example.com/font.css">')
    expect(out).toContain('<script src="https://cdn.example.com/analytics.js"></script>')
    expect(out).not.toContain('removed by the minifier')
    expect(out).toContain('const greeting="Hello from the inline script"')
    expect(out).toContain('<div id="app" data-blok-ssr><main><h1>Hello from the inline script</h1><section class="card"><h2>card</h2></section><button>0</button></main></div>')
    expect(readFileSync(file, 'utf-8')).toBe(CLASSIC['index.html'])
  })

  it('moves deferred scripts to the end of body, where they would run', async () => {
    const file = site(CLASSIC)
    const [{ file: outFile }] = await prerender(file, { inline: true, out: join(dir, 'dist'), warn: () => {} })
    const out = readFileSync(outFile, 'utf-8')
    const inlineAt = out.indexOf('const greeting=')
    const componentsAt = out.indexOf('blok.component("Card"')
    expect(inlineAt).toBeGreaterThan(-1)
    expect(componentsAt).toBeGreaterThan(inlineAt)
    expect(componentsAt).toBeLessThan(out.indexOf('</body>'))
  })

  it('produces a page that mount() adopts and keeps interactive', async () => {
    const file = site(CLASSIC)
    const [{ file: outFile }] = await prerender(file, { inline: true, out: join(dir, 'dist'), warn: () => {} })
    const page = hydrate(readFileSync(outFile, 'utf-8'))
    expect(page.errors).toEqual([])
    expect(page.adopted).toBe(true)
    expect(page.ssrAttrLeft).toBe(false)
    const button = page.window.document.querySelector('button')!
    button.click()
    await new Promise(r => setTimeout(r, 0))
    expect(button.textContent).toBe('1')
  })
})

const MODULES = {
  'index.html': `<!DOCTYPE html>
<html><body>
<div id="app"></div>
<script type="module">
  import { mount, component } from 'https://cdn.jsdelivr.net/npm/@maleta/blokjs@0.4.0/dist/blokjs.esm.min.js'
  import { Badge } from './badge.js'
  component('Badge', Badge)
  mount('#app', { view: () => ({ p: { children: [{ Badge: { label: 'from a module' } }] } }) })
</script>
<script type="module">import confetti from 'https://esm.sh/canvas-confetti'</script>
</body></html>`,
  'badge.js': `export const Badge = { props: ['label'], view: ($) => ({ b: $.label }) }`,
}

describe('module scripts', () => {
  it('are bundled and prerendered; remote imports are skipped with a warning', async () => {
    const file = site(MODULES)
    const warnings: string[] = []
    await prerender(file, { out: join(dir, 'dist'), warn: (m) => warnings.push(m) })
    const out = readFileSync(join(dir, 'dist/index.html'), 'utf-8')
    expect(out).toContain('<div id="app" data-blok-ssr><p><b>from a module</b></p></div>')
    expect(out).toContain(`import { Badge } from './badge.js'`)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('Skipped module script')
  })

  it('are embedded with the bundled runtime by --inline and adopted by mount()', async () => {
    const file = site(MODULES)
    const [{ file: outFile }] = await prerender(file, { inline: true, out: join(dir, 'dist'), warn: () => {} })
    const out = readFileSync(outFile, 'utf-8')
    expect(out).not.toContain(`from './badge.js'`)
    expect(out).toContain('<script type="module">import confetti')
    const page = hydrate(out)
    expect(page.errors).toEqual([])
    expect(page.adopted).toBe(true)
    expect(page.ssrAttrLeft).toBe(false)
  })
})
