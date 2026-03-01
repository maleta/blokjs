# BlokJS - LLM Reference

> This document is designed for LLM consumption. Include it in your context when asking an LLM to write BlokJS code.

BlokJS is a zero-build reactive UI framework. Include via `<script>` tag, use via `blok.component()`, `blok.store()`, and `blok.mount()`. No JSX, no build step. Views are defined as plain JS objects.

---

## Setup

```html
<script src="https://cdn.jsdelivr.net/npm/@maleta/blokjs/dist/blokjs.min.js"></script>
<div id="app"></div>
<script>
  blok.mount('#app', {
    state: { count: 0 },
    methods: { inc() { this.count++ } },
    view: ($) => ({
      div: { children: [
        { h1: { text: $.count } },
        { button: { click: 'inc', text: '+1' } }
      ]}
    })
  })
</script>
```

---

## API

### `blok.mount(target, options)` - Mount root app

`target`: CSS selector string or HTMLElement.

Options:
- `state` - reactive state object
- `computed` - derived values: `{ fullName() { return this.first + ' ' + this.last } }`
- `watch` - react to changes: `{ search(newVal, oldVal) { this.filter() } }`
- `methods` - functions callable from view and other methods
- `mount()` - lifecycle hook, called after DOM mount (via microtask)
- `unmount()` - lifecycle hook, called on destroy
- `view($)` - returns view object (required)
- `routes` - array of route definitions (enables router)
- `guards` - route guard functions
- `mode` - router mode: `'hash'` | `'history'` | `'auto'` (default: `'auto'`)

Returns `{ destroy() }`.

### `blok.component(name, definition)` - Register component

Same options as mount (minus `routes`, `guards`, `mode`), plus:
- `props` - array of prop names: `props: ['user', 'color']`

### `blok.store(name, definition)` - Register global store

Options: `state`, `computed`, `methods`. Accessed in components via `this.store.name`.

---

## View DSL

The `view` function receives `$` (a reactive reference builder) and returns a plain object describing the DOM.

### Elements and text

```js
{ div: { text: 'Hello' } }         // <div>Hello</div>
{ div: 'Hello' }                   // shorthand
{ div: { text: $.count } }         // reactive text
{ div: { html: '<b>Bold</b>' } }   // raw HTML (not sanitized - see warning)
{ div: { children: [ ... ] } }     // children array
```

### Conditionals (when)

```js
{ when: $.isVisible, children: [
  { p: 'Shown when truthy' }
]}

{ when: $.not.isVisible, children: [
  { p: 'Shown when falsy' }
]}
```

### Loops (each)

```js
{ each: $.items, as: 'item', key: 'id', children: [
  { div: { text: $.item.name } }
]}
```

`key` is optional but recommended for efficient DOM reconciliation.

### Two-way binding (model)

```js
{ input: { type: 'text', model: $.search } }
{ input: { type: 'checkbox', model: $.agree } }
{ select: { model: $.chosen, children: [
  { option: { value: 'a', text: 'A' } },
  { option: { value: 'b', text: 'B' } }
]}}
{ textarea: { model: $.description } }
```

### Dynamic attributes (bind)

```js
{ img: { bind: { src: $.imageUrl, alt: $.title } } }
{ a: { bind: { href: $.link }, link: true, text: 'Go' } }
```

### Class binding

```js
{ div: { class: 'static-class' } }
{ div: { class: $.dynamicClass } }
{ div: { class: { active: $.isActive, disabled: $.isOff } } }
{ div: { class: ['base', { highlight: $.isHighlighted }] } }
```

### Style binding

```js
{ div: { style: 'color: red' } }
{ div: { style: { color: 'red', fontSize: '16px' } } }
{ div: { style: { backgroundColor: $.bgColor } } }
```

### Events

```js
{ button: { click: 'methodName' } }                   // methodName(event)
{ button: { click: 'remove(item)' } }                 // remove(itemValue)
{ button: { click: 'select(item.id)' } }              // select(resolved value)
{ button: { click: 'update(item, true, 42)' } }       // multiple args
{ button: { click: "handler('hello')" } }             // string literal arg
{ form: { submit: 'handleSubmit' } }                   // preventDefault auto-applied
{ div: { click: { handler: 'onClick', stop: true } } }
{ div: { click: { handler: 'onClick', prevent: true } } }
{ button: { click: 'showModal = true' } }              // inline assignment
```

Argument types: path references (`item`, `item.name`, `count`), string literals (`'hello'`), numbers (`42`), booleans (`true`/`false`), `null`. When args are specified, only those are passed. Without args, the Event object is passed.

Supported: click, dblclick, submit, input, change, focus, blur, keydown, keyup, keypress, mousedown, mouseup, mousemove, mouseenter, mouseleave, scroll, resize, dragstart, dragend, dragover, dragleave, drop, touchstart, touchend, touchmove.

### Element refs

```js
{ input: { ref: 'nameInput' } }
// In mount/methods: this.refs.nameInput.focus()
```

### Components

```js
{ MyComponent: { propA: $.value, propB: 'static' } }
```

### Component events (child to parent)

Child emits:
```js
methods: { remove() { this.emit('remove', this.item) } }
```

Parent listens:
```js
{ TodoItem: { todo: $.todo, on_remove: 'handleRemove' } }
```

### Slots

Parent passes children:
```js
{ Card: { children: [
  { h1: 'Title' },
  { p: 'Content' }
]}}
```

Child renders slot:
```js
view: ($) => ({
  div: { class: 'card', children: { slot: true } }
})
```

### Draggable

```js
{ div: { draggable: 'true', dragstart: 'onDragStart', dragend: 'onDragEnd' } }
```

Event object is passed as first argument to handler methods.

---

## Store

```js
blok.store('auth', {
  state: { user: null },
  computed: {
    isLoggedIn() { return this.user !== null }
  },
  methods: {
    async login(name) {
      await fetch('/api/login', { method: 'POST', body: JSON.stringify({ name }) })
      this.user = { name }
    },
    logout() { this.user = null }
  }
})
```

Access in components:
```js
// In view
{ p: { text: $.store.auth.user.name } }
{ when: $.store.auth.isLoggedIn, children: [ ... ] }

// In methods/computed
this.store.auth.login('Alice')
this.store.auth.user.name
```

---

## Async tracking

Async methods (returning promises) are automatically tracked.

```js
methods: {
  async loadData() {
    const res = await fetch('/api/data')
    this.data = await res.json()
  }
}
```

In view:
```js
{ when: $.loading.loadData, children: [{ p: 'Loading...' }] }
{ when: $.error.loadData, children: [{ p: { text: $.error.loadData } }] }
```

Works for both component methods and store methods:
```js
{ when: $.store.api.loading.fetch, children: [ ... ] }
{ when: $.store.api.error.fetch, children: [ ... ] }
```

---

## Router

```js
blok.mount('#app', {
  routes: [
    { path: '/', component: 'Home' },
    { path: '/product/:id', component: 'ProductDetail' },
    { path: '/admin', component: 'Admin', guard: 'requireAuth' },
    { path: '*', component: 'NotFound' }
  ],

  guards: {
    requireAuth(to, from) {
      if (!this.store.auth.isLoggedIn) return '/login'
      return true
    }
  },

  view: ($) => ({
    div: { children: [
      { nav: { children: [
        { a: { href: '/', link: true, text: 'Home' } },
        { a: { href: '/admin', link: true, text: 'Admin' } }
      ]}},
      { div: { route: true } }   // route outlet
    ]}
  })
})
```

In components:
```js
this.route.path          // '/product/42'
this.route.params        // { id: '42' }
this.route.query         // { sort: 'price' }
this.navigate('/path')   // programmatic navigation
this.navigate(-1)        // history back
```

Guards return: `true` (allow), `false` (block), or `'/redirect-path'`.

---

## Context (`this`) in methods, computed, watch, mount, unmount

- `this.<stateKey>` - read/write state
- `this.<computedKey>` - read computed (read-only)
- `this.<propName>` - read prop (read-only)
- `this.store.<name>` - access store state/computed/methods
- `this.route` - `{ path, params, query }`
- `this.refs.<name>` - DOM element references
- `this.el` - component root element
- `this.loading.<method>` - boolean, true while async method runs
- `this.error.<method>` - error object or null
- `this.emit(event, payload)` - emit event to parent
- `this.navigate(path | number)` - router navigation

---

## Patterns

### Negation in view refs

```js
$.not.isVisible            // negates boolean ref
$.not.store.auth.isLoggedIn
$.not.hasResults
```

### Array mutations are reactive

```js
this.items.push(item)      // reactive
this.items.splice(0, 1)    // reactive
this.items = [...filtered] // reactive (reassignment)
```

### Computed filters

```js
computed: {
  filtered() {
    return this.items.filter(i => i.name.toLowerCase().includes(this.search.toLowerCase()))
  }
}
```

---

## Validation (Debug API)

The `blok.validate` object exposes pure functions that return `string[]` of warnings. Use these to check definitions before registering them.

```js
// Validate a component definition
const warnings = blok.validate.component('todo-item', {
  props: ['label'],
  // missing view - will produce a warning
})
// ['Component "todo-item" is missing the required "view" function.']

// Validate mount options
blok.validate.mount({ state: { count: 0 } })
// ['Mount options missing the required "view" function.']

// Validate a store definition
blok.validate.store('auth', { state: { user: null }, foo: 1 })
// ['Unknown property "foo" in store "auth". Valid: state, computed, methods']

// Validate a template node
blok.validate.template('button', { click: 'save', clss: 'btn' }, { save() {} })
// ['<button> has "clss" - did you mean "class"?']
```

### What gets caught

- Missing or non-function `view`
- Unknown definition keys (typos like `methds` instead of `methods`)
- State keys conflicting with reserved names (`store`, `route`, `refs`, `el`, etc.)
- Duplicate keys across state/computed/methods
- Non-function mount/unmount/methods/computed/watch entries
- Event handlers referencing undefined methods
- Template key typos (Levenshtein-based suggestions)
- Invalid router mode

### LLM debug workflow

```js
// 1. Validate before registering
const w = blok.validate.component('my-comp', def)
if (w.length) {
  console.log('Issues:', w)
  // fix and retry
}

// 2. Register once clean
blok.component('my-comp', def)
```

Note: validation runs automatically in dev builds (`blokjs.js`, `blokjs.esm.js`) via `console.warn`. The `blok.validate.*` functions let you capture warnings programmatically without console interception. Minified builds (`blokjs.min.js`, `blokjs.esm.min.js`) strip all validation.
