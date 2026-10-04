import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { JSDOM, VirtualConsole } from 'jsdom'

export const DEV_RUNTIME = join(dirname(createRequire(import.meta.url).resolve('@maleta/blokjs/package.json')), 'dist/blokjs.js')

const SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi

export interface Hydrated {
  /** Every element under the mount nodes is the same object after mount() */
  adopted: boolean
  elements: number
  ssrAttrLeft: boolean
  warnings: string[]
  errors: string[]
  window: JSDOM['window']
}

/**
 * Load a prerendered page like a browser: parse the markup, run its scripts in order, fire DOMContentLoaded.
 * Remote and module scripts are skipped; a blokjs `src` script runs `runtime` when one is given.
 */
export function hydrate(html: string, url = 'http://localhost/', runtime?: string): Hydrated {
  const scripts = [...html.matchAll(SCRIPT)].map(m => ({ attrs: m[1], code: m[2] }))
  const warnings: string[] = []
  const vc = new VirtualConsole()
  vc.on('warn', (...a: unknown[]) => warnings.push(a.join(' ')))
  vc.on('error', (...a: unknown[]) => warnings.push(a.join(' ')))
  const { window } = new JSDOM(html.replace(SCRIPT, ''), { url, runScripts: 'outside-only', virtualConsole: vc })
  // Every supported browser has it; jsdom does not
  ;(window as unknown as { structuredClone: typeof structuredClone }).structuredClone = structuredClone

  const roots = Array.from(window.document.querySelectorAll('[data-blok-ssr]'))
  const before = roots.flatMap(r => Array.from(r.querySelectorAll('*')))
  const errors: string[] = []
  for (const s of scripts) {
    let code = s.code
    if (/type="module"/.test(s.attrs)) continue
    if (/\bsrc=/.test(s.attrs)) {
      if (!runtime || !/blokjs/.test(s.attrs)) continue
      code = readFileSync(runtime, 'utf-8')
    }
    try {
      window.eval(code)
    } catch (e) {
      errors.push((e as Error).message)
    }
  }
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'))

  const after = roots.flatMap(r => Array.from(r.querySelectorAll('*')))
  return {
    adopted: before.length > 0 && after.length === before.length && after.every((n, i) => n === before[i]),
    elements: before.length,
    ssrAttrLeft: roots.some(r => r.hasAttribute('data-blok-ssr')),
    warnings,
    errors,
    window,
  }
}
