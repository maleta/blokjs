# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- `@maleta/blokjs-pocketbase` package: `pbCollection()` returns a store definition that loads a PocketBase collection into `items` and applies realtime changes. `pbAuth()` returns one that mirrors the signed-in user. See `packages/blokjs-pocketbase/README.md`
- Server rendering: `renderToString(opts, { url })` from `@maleta/blokjs/server` renders mount options to HTML with the same renderer as the browser, without a DOM or dependencies
- Hydration: `blok.mount()` adopts the HTML inside a target that has the `data-blok-ssr` attribute instead of rendering it again, keeping focus, scroll position, iframes and text typed before the script loaded. When the HTML does not match the view it renders fresh, with a warning in development builds
- `blokjs-prerender` package: CLI that writes the rendered HTML of each route into the page, so clients that do not run JavaScript (crawlers, link previews, site reviews) see the content. `--inline` embeds local scripts, stylesheets and the blokjs runtime, minified, into one self-contained file per route. See `packages/blokjs-prerender/README.md`

### Changed

- The router resolves the initial route inside `mount()`, before the first render. The first render shows the matched route, and on a deep link the `/` component no longer mounts and unmounts first. Guards for the initial route now run before anything renders (`this.el` and `this.refs` are not set yet), and a `route.path` watcher no longer fires for the initial route: load that data in `mount()`
- `unmount()` runs only for components whose `mount()` ran. A component destroyed in the same tick it was created gets neither

### Fixed

- A bound attribute or text whose value did not change is no longer written again; rewriting an unchanged `src` reloaded iframes and restarted media

## [0.4.0] - 2026-09-25

### Added

- Function form in class object values: `class: { active: ($) => $.grp.name === $.activeGroup }`
- `props` template key assigns JS properties instead of attributes - arrays and objects for web components, or properties with no attribute such as `indeterminate`
- Method refs as event handlers: `click: $.save`, `on: { 'wa-change': $.onChange }`, `on_remove: $.handleRemove` - equivalent to the handler string `'save'`, previously they threw at mount
- "Did you mean" suggestions for definition keys from other frameworks: `init`, `mounted`, `created`, `setup` suggest `mount`; `destroyed`, `beforeUnmount` suggest `unmount`; `data` suggests `state`; `render`, `template` suggest `view`

### Changed

- Unknown keys in component, mount and store definitions now warn in minified builds too - a misnamed hook such as `init()` was silently dead code in production. Other validation stays dev-only

### Fixed

- Function-form `when` inside `each` can read loop variables (`$.item`) - it threw a TypeError that aborted the whole mount
- View refs no longer intercept data properties named `path` or `negate` - `$.item.path` rendered the loop variable name instead of the value, and `$.path` rendered an empty string

## [0.3.1] - 2026-04-04

### Added

- Function-form `when` directive - accepts `($) => expr` for reactive expressions with operators (`!`, `&&`, `||`, `>`, ternary, etc.) without needing a computed property

### Removed

- Automatic deferred effects for lists >32 items - single consistent code path for all list sizes

## [0.2.0] - 2026-04-02

### Added

- Multiple `blok.mount()` calls - each creates an independent app instance
- `isolated: true` mount option for fully sandboxed instances (own store state, copied component registry)
- Router singleton guard - throws if two mounts both declare routes
- Duplicate `blok.store()` registration warns and skips (all builds)

### Changed

- Component registry and store state are shared across mounts by default
- Store duplicate warning runs in all builds

### Performance

- Keyed `each` loops no longer re-run all per-row effects on array reorder/filter - per-row signal + cached item reference isolates row effects from the parent array (up to 700x faster on 1000-row sort/shuffle/toggle)
- Keyed `each` reconciliation skips DOM moves entirely when key order is unchanged (e.g. bulk data updates)
- Non-keyed `each` loops use untracked array reads to prevent wasteful effect re-runs before teardown
- Reactive trigger no longer copies dependency Sets into temporary arrays before iterating - eliminates allocation on every state change
- Component and store method wrappers are cached per instance instead of re-created on every proxy access
- CSS `camelCase` to `kebab-case` conversion is cached at module level, avoiding repeated regex execution on style updates
- Event handler strings (assignments, method calls with args) are parsed once at bind time instead of on every event fire

### Fixed

- Nested `when:` blocks inside `when:` or `each:` no longer leak DOM nodes when inner conditions toggle before an outer teardown - switched from reference-based cleanup to marker-based cleanup in both `renderWhen` and `renderEach`
- Watch dot-notation paths (e.g. `'route.path'`, `'store.nav.currentPath'`) now resolve correctly

## [0.1.1] - 2026-03-01

### Fixed

- Updated links and package name to `@maleta/blokjs`

## [0.1.0] - 2026-02-20

- Initial release
