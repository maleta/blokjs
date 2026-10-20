import { describe, it, expect } from 'vitest'
import * as esbuild from 'esbuild'
import * as api from '../src/index'
import { shared } from '../build-options'

async function globalKeys(minify: boolean): Promise<string[]> {
  const out = await esbuild.build({ ...shared, minify, define: { __DEV__: String(!minify) }, write: false, outfile: 'blokjs.js' })
  const win: { blok?: Record<string, unknown> } = {}
  new Function('window', out.outputFiles[0].text)(win)
  return Object.keys(win.blok!).sort()
}

describe('script-tag build', () => {
  it.each([false, true])('exposes every runtime export on window.blok (minify: %s)', async (minify) => {
    expect(await globalKeys(minify)).toEqual(Object.keys(api).sort())
  })
})
