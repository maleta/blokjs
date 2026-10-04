import * as esbuild from 'esbuild'

const shared: esbuild.BuildOptions = {
  entryPoints: ['src/index.ts'],
  bundle: true,
  format: 'iife',
  globalName: '__blokExports',
  target: 'es2020',
  define: { __DEV__: 'true' },
  footer: {
    js: ';(function(){var e=__blokExports;if(typeof window!=="undefined"){window.blok={component:e.component,mount:e.mount,store:e.store,validate:e.validate}}})()',
  },
}

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
