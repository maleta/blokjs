# BlokJS

Zero-build, zero-dependency, standalone, reactive, lightweight UI framework. ~30KB minified (~10KB gzipped).

[Documentation](https://maleta.github.io/blokjs/docs/) - [Examples](https://github.com/maleta/blokjs/tree/main/examples) - [LLM Reference](packages/blokjs/llm-reference.md) (~3,500 tokens) - [npm](https://www.npmjs.com/package/@maleta/blokjs)

## Quick start

```html
<script src="https://cdn.jsdelivr.net/npm/@maleta/blokjs/dist/blokjs.min.js"></script>
<div id="app"></div>
<script>
  blok.mount('#app', {
    state: { count: 0 },
    methods: {
      inc() { this.count++ },
      dec() { this.count-- },
    },
    view: ($) => ({
      div: { children: [
        { h1: { text: $.count } },
        { button: { click: 'dec', text: '-' } },
        { button: { click: 'inc', text: '+' } },
      ] }
    })
  })
</script>
```

No virtual DOM. Views are plain JavaScript objects. State is reactive - when `count` changes, the bound `h1` updates automatically.

## Features

- **Reactive state** - fine-grained dependency tracking via ES Proxy
- **Components** - props, events, slots, lifecycle hooks
- **Routing** - client-side router with params, guards, and history/hash modes
- **Stores** - global state with computed properties and async tracking
- **Async tracking** - automatic `loading` and `error` state for async methods
- **Web components** - custom events via `on`, JS properties via `props`, `model` on value-based elements
- **URL sanitization** - `javascript:` and dangerous URIs blocked on href/src attributes
- **Multi-mount** - multiple independent app instances, optional full isolation
- **Zero dependencies** - single script tag, no build step needed

## Components

```js
blok.component('TodoItem', {
  props: ['todo'],

  methods: {
    remove() { this.emit('remove', this.todo) }
  },

  view: ($) => ({
    li: { children: [
      { input: { type: 'checkbox', model: $.todo.done } },
      { span: { text: $.todo.text } },
      { button: { click: 'remove', text: 'x' } },
    ] }
  })
})
```

Use components by name in templates. Pass props, listen to events with `on_` prefix:

```js
{ each: $.todos, as: 'todo', key: 'id', children: [
  { TodoItem: { todo: $.todo, on_remove: 'handleRemove' } }
] }
```

## Stores

Global state shared across components. Async methods get automatic loading/error tracking:

```js
blok.store('auth', {
  state: { user: null },

  computed: {
    isLoggedIn() { return this.user !== null }
  },

  methods: {
    async login(email, password) {
      const res = await fetch('/api/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      })
      this.user = await res.json()
    },
    logout() { this.user = null }
  }
})
```

```js
// In templates
{ when: $.store.auth.loading.login, children: [
  { p: 'Signing in...' }
] }
{ when: $.store.auth.error.login, children: [
  { p: { class: 'error', text: $.store.auth.error.login } }
] }

// In methods
this.store.auth.login(email, pw)
this.store.auth.isLoggedIn
```

## Routing

```js
blok.mount('#app', {
  routes: [
    { path: '/', component: 'Home' },
    { path: '/product/:id', component: 'ProductDetail' },
    { path: '/admin', component: 'Admin', guard: 'requireAuth' },
    { path: '*', component: 'NotFound' },
  ],

  guards: {
    requireAuth(to, from) {
      if (!this.store.auth.isLoggedIn) return '/login'
      return true
    }
  },

  view: ($) => ({
    div: { children: [
      { a: { href: '/', link: true, text: 'Home' } },
      { a: { href: '/admin', link: true, text: 'Admin' } },
      { div: { route: true } },
    ] }
  })
})
```

Access route data in components via `this.route.params`, `this.route.query`, and navigate programmatically with `this.navigate('/path')`.

## View DSL

Views are plain objects. The `$` proxy creates reactive references resolved at render time. A ref is a path, not a value, so JS operators (`!`, `? :`, `>`) do not see its value: use `$.not`, the function form, or a computed.

```js
// Conditionals
{ when: $.isLoggedIn, children: [{ p: 'Welcome!' }] }
{ when: $.not.isLoggedIn, children: [{ p: 'Please log in' }] }

// Function form - for expressions with operators
{ when: ($) => !$.isLoggedIn, children: [{ p: 'Please log in' }] }
{ when: ($) => $.count > 0 && $.isReady, children: [{ p: 'Go!' }] }

// Loops
{ each: $.items, as: 'item', key: 'id', children: [
  { li: { text: $.item.name } }
] }

// Two-way binding
{ input: { type: 'text', model: $.search } }
{ select: { model: $.category, children: [...] } }

// JS properties (arrays/objects for web components)
{ 'data-grid': { props: { rows: $.rows } } }

// Classes (string, object, or array)
{ div: { class: { active: $.isActive, disabled: $.isOff } } }
{ li: { class: { active: ($) => $.item.id === $.selectedId } } }

// Events
{ button: { click: 'save', text: 'Save' } }
{ button: { click: $.save, text: 'Save' } }   // method ref
{ 'wa-dialog': { on: { 'wa-after-hide': 'onClose' } } }
{ button: { click: 'remove(item)', text: 'x' } }
{ form: { submit: 'handleSubmit', children: [...] } }

// Slots
{ Card: { title: 'Hello', children: [
  { p: 'This goes into the slot' }
] } }
```

## Using with Vite

While BlokJS works without a build step, the Vite plugin adds automatic component and store registration from file directories, bundling into optimized output, and hot module replacement during development.

Scaffold a new project:

```bash
npm create blokjs my-app
cd my-app
npm install
npx vite
```

Or add to an existing Vite project:

```bash
npm install blokjs vite-plugin-blokjs
```

```js
// vite.config.js
import { defineConfig } from 'vite'
import { blokjs } from 'vite-plugin-blokjs'

export default defineConfig({
  plugins: [blokjs()],
})
```

```js
// main.js
import { mount } from '@maleta/blokjs'
import 'virtual:blokjs'

mount('#app', {
  view: ($) => ({ counter: {} }),
})
```

The plugin auto-discovers files in `components/` and `stores/` directories, registering each by filename. Files prefixed with `_` are ignored.

```
components/counter.js   -> component('counter', ...)
stores/app.js           -> store('app', ...)
components/_helper.js   -> ignored
```

## Using with PocketBase

[`@maleta/blokjs-pocketbase`](https://www.npmjs.com/package/@maleta/blokjs-pocketbase) turns a [PocketBase](https://pocketbase.io) collection into a BlokJS store: records load into `items`, follow realtime changes, and get `loading`/`error` tracking like any async store method. `pbAuth` does the same for the signed-in user.

```html
<script src="https://cdn.jsdelivr.net/npm/@maleta/blokjs/dist/blokjs.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/pocketbase@0.28/dist/pocketbase.umd.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@maleta/blokjs-pocketbase/dist/blokjs-pocketbase.min.js"></script>
```

```js
const pb = new PocketBase('/')
blok.store('todos', blokPocketbase.pbCollection(pb, 'todos', { sort: '-created' }))

blok.mount('#app', {
  mount() { this.store.todos.connect() },
  methods: {
    add() { this.store.todos.save({ title: 'New todo' }) },
  },
  view: ($) => ({ div: { children: [
    { button: { click: 'add', text: 'Add' } },
    { each: $.store.todos.items, as: 'todo', key: 'id', children: [
      { p: { text: $.todo.title } },
    ] },
  ] } }),
})
```

See the [package README](https://github.com/maleta/blokjs/tree/main/packages/blokjs-pocketbase#readme) for the full API and [`examples/pocketbase`](https://github.com/maleta/blokjs/tree/main/examples/pocketbase) for a runnable app.

## Browser Compatibility

BlokJS supports all [ES2020-compliant](https://caniuse.com/?search=es2020) browsers ([96%+ global coverage](https://caniuse.com/proxy)). IE is not supported.

## Development

```bash
pnpm install
pnpm build       # build all packages
pnpm test        # run tests
```

## License

MIT
