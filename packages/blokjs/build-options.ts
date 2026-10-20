import type * as esbuild from 'esbuild'

export const shared: esbuild.BuildOptions = {
  entryPoints: ['src/index.ts'],
  bundle: true,
  format: 'iife',
  globalName: '__blokExports',
  target: 'es2020',
  define: { __DEV__: 'true' },
  footer: {
    js: ';(function(){var e=__blokExports;if(typeof window!=="undefined"){window.blok={...e}}})()',
  },
}
