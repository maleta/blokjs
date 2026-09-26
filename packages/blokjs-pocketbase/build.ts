import * as esbuild from 'esbuild'

const shared: esbuild.BuildOptions = {
  entryPoints: ['src/index.ts'],
  bundle: true,
  target: 'es2020',
}

async function build() {
  await esbuild.build({
    ...shared,
    format: 'iife',
    globalName: 'blokPocketbase',
    footer: { js: 'if(typeof window!=="undefined")window.blokPocketbase=blokPocketbase;' },
    minify: true,
    outfile: 'dist/blokjs-pocketbase.min.js',
  })
  await esbuild.build({ ...shared, format: 'esm', outfile: 'dist/blokjs-pocketbase.esm.js' })
  console.log('Build complete: dist/blokjs-pocketbase.min.js, dist/blokjs-pocketbase.esm.js')
}

build()
