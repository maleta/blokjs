import * as esbuild from 'esbuild'
import { shared } from './build-options'

async function build() {
  await esbuild.build({ ...shared, outfile: 'dist/blokjs.js' })
  await esbuild.build({ ...shared, define: { __DEV__: 'false' }, minify: true, outfile: 'dist/blokjs.min.js' })
  await esbuild.build({
    entryPoints: ['src/index.ts'],
    bundle: true,
    format: 'esm',
    target: 'es2020',
    define: { __DEV__: 'true' },
    outfile: 'dist/blokjs.esm.js',
  })
  await esbuild.build({
    entryPoints: ['src/index.ts'],
    bundle: true,
    format: 'esm',
    target: 'es2020',
    define: { __DEV__: 'false' },
    minify: true,
    outfile: 'dist/blokjs.esm.min.js',
  })
  await esbuild.build({
    entryPoints: ['src/server.ts'],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: 'es2020',
    define: { __DEV__: 'true' },
    outfile: 'dist/blokjs-server.mjs',
  })
  console.log('Build complete: dist/blokjs.js, dist/blokjs.min.js, dist/blokjs.esm.js, dist/blokjs.esm.min.js, dist/blokjs-server.mjs')
}

build()
