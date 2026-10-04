# blokjs-prerender

Writes the rendered HTML of a [BlokJS](https://github.com/maleta/blokjs) page into the page itself, one file per route. Clients that do not run JavaScript (crawlers, link previews, payment provider site reviews, curl) then see the content, and `blok.mount()` adopts that HTML in the browser instead of rendering it again.

The page keeps working without this step. Prerendering only adds HTML.

## Usage

```sh
bunx blokjs-prerender index.html
bunx blokjs-prerender index.html --routes / /about /users/42 --out dist
bunx blokjs-prerender index.html --inline --out dist   # one self-contained file per route
```

| Option | Default | Description |
|---|---|---|
| `--routes <paths...>` | every route without `:param`, `*` or `guard`; `/` without a router | Routes to render |
| `--out <dir>` | directory of the page | Where the files go. Only HTML files are written; copy the site's other files yourself |
| `--inline` | off | Embed local scripts, local stylesheets and the blokjs runtime, minified. Needs `--out` |

`/` is written to the page's own file name, `/about` to `about.html` (static hosts such as GitHub Pages, Netlify, Cloudflare Pages and Vercel serve it at `/about`), `/docs/` to `docs/index.html`. Without `--out` the page is updated in place; running the CLI again replaces the earlier output.

## What it does

1. Collects the page's scripts in the order a browser runs them: inline scripts and local `src` files, then `defer`, `async` and module scripts. Module scripts are bundled with esbuild.
2. Runs them in a sandbox where `blok` comes from `@maleta/blokjs/server`. `blok.mount('#id', opts)` and `blok.mount(document.getElementById('id'), opts)` calls are recorded, also inside `DOMContentLoaded` listeners.
3. For each route, renders every recorded mount with `renderToString` and writes the HTML into the element with that id, adding the `data-blok-ssr` attribute. The rest of the file stays byte for byte.

## One file per page: `--inline`

- Inline scripts and local `src` scripts are minified and embedded. Deferred and module scripts move to the end of `<body>`, which is where they would run.
- The blokjs `<script>` tag is replaced by the runtime of the installed `@maleta/blokjs`, the version that rendered the HTML, so its hydration markers always match. Module scripts that import blokjs get it bundled when the page has no blokjs `<script>` tag.
- Local stylesheets become minified `<style>` elements; relative `url()` and `@import` paths are rewritten to resolve from the page.
- Remote scripts and stylesheets stay external. Images, fonts and other files are not copied.
- `--out` is required, so the source page keeps its own script and link tags.
- The markup itself is not minified: the prerendered part has no whitespace to remove, and its comments are hydration markers.

## Limits

- `mount()`/`unmount()` hooks, route guards and event handlers do not run. Data loaded in `mount()` is not in the HTML.
- Top-level code must not touch the DOM; move it into `mount()`. `localStorage` and `sessionStorage` return `null`, timers do nothing.
- Remote scripts other than blokjs, and module scripts that import remote URLs, are skipped with a warning.
- Hash-mode routers share one HTML file, so only `/` is rendered.
- Without `--inline`, pin the blokjs version in the CDN URL (`@maleta/blokjs@<version>/dist/blokjs.min.js`). A cached older runtime appends to the prerendered HTML instead of adopting it, which shows the content twice. The CLI warns about unpinned URLs.
- Keep HTML comments in the output: they mark `when` and `each` blocks. A minifier that strips them makes every page render fresh in the browser.
- `<title>` and meta tags are the same in every route file.

## License

MIT
