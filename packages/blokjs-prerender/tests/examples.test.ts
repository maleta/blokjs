import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { prerender, type PrerenderResult } from '../src/prerender'
import { hydrate, DEV_RUNTIME } from './dom'

const EXAMPLES = fileURLToPath(new URL('../../../examples/', import.meta.url))
// Generated with Math.random(), so the browser renders different data than the prerender
const RANDOM_DATA = 'perf-1k-items.html'
const pages = readdirSync(EXAMPLES).filter(f => f.endsWith('.html') && f !== RANDOM_DATA)

let out = ''

afterEach(() => {
  if (out) rmSync(out, { recursive: true, force: true })
  out = ''
})

function urlFor(r: PrerenderResult): string {
  return `http://localhost${r.route}`
}

describe.each(pages)('examples/%s', (page) => {
  it('is adopted by mount() after an --inline prerender', async () => {
    out = mkdtempSync(join(tmpdir(), 'blokjs-examples-'))
    const results = await prerender(join(EXAMPLES, page), { inline: true, out, warn: () => {} })
    for (const r of results) {
      const html = readFileSync(r.file, 'utf-8')
      expect(html, relative(out, r.file)).not.toMatch(/<script\b[^>]*\bsrc="(?!https?:)/)
      const hydrated = hydrate(html, urlFor(r))
      expect(hydrated.errors, r.route).toEqual([])
      expect(hydrated.adopted, r.route).toBe(true)
    }
  })

  it('is adopted by the development runtime without warnings', async () => {
    out = mkdtempSync(join(tmpdir(), 'blokjs-examples-'))
    const results = await prerender(join(EXAMPLES, page), { out, warn: () => {} })
    for (const r of results) {
      const hydrated = hydrate(readFileSync(r.file, 'utf-8'), urlFor(r), DEV_RUNTIME)
      expect(hydrated.errors, r.route).toEqual([])
      expect(hydrated.warnings.filter(w => w.includes('[blok]')), r.route).toEqual([])
      expect(hydrated.adopted, r.route).toBe(true)
    }
  })
})

it('examples/perf-1k-items.html falls back to a fresh render because its data is random', async () => {
  out = mkdtempSync(join(tmpdir(), 'blokjs-examples-'))
  const [r] = await prerender(join(EXAMPLES, RANDOM_DATA), { out, warn: () => {} })
  const hydrated = hydrate(readFileSync(r.file, 'utf-8'), urlFor(r), DEV_RUNTIME)
  expect(hydrated.warnings.join('\n')).toContain('Hydration mismatch')
  expect(hydrated.adopted).toBe(false)
  expect(hydrated.window.document.querySelectorAll('#app tbody tr').length).toBeGreaterThan(0)
}, 30000)
