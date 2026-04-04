# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Function-form `when` directive - accepts `($) => expr` for reactive expressions with operators (`!`, `&&`, `||`, `>`, ternary, etc.) without needing a computed property

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
