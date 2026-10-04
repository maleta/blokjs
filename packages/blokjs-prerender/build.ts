import * as esbuild from 'esbuild'

await esbuild.build({
  entryPoints: ['src/cli.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node18',
  external: ['@maleta/blokjs', 'esbuild'],
  banner: { js: '#!/usr/bin/env node' },
  outfile: 'dist/cli.js',
})
console.log('Build complete: dist/cli.js')
