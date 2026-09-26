# @maleta/blokjs-pocketbase

[PocketBase](https://pocketbase.io) collections and auth as reactive [BlokJS](https://github.com/maleta/blokjs) stores. Records load into store state and stay in sync through PocketBase realtime. BlokJS async tracking provides `loading` and `error` for every call.

A full app without a custom backend: PocketBase for data, auth and realtime, and BlokJS for the UI, with no build step.

## Install

Script tags:

```html
<script src="https://cdn.jsdelivr.net/npm/@maleta/blokjs/dist/blokjs.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/pocketbase@0.28/dist/pocketbase.umd.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@maleta/blokjs-pocketbase/dist/blokjs-pocketbase.min.js"></script>
```

This exposes `blokPocketbase.pbCollection` and `blokPocketbase.pbAuth`.

npm:

```bash
npm install @maleta/blokjs @maleta/blokjs-pocketbase pocketbase
```

```js
import { store, mount } from '@maleta/blokjs'
import PocketBase from 'pocketbase'
import { pbCollection, pbAuth } from '@maleta/blokjs-pocketbase'
```

The app creates the [PocketBase JS SDK](https://github.com/pocketbase/js-sdk) client and passes it in. This package does not bundle the SDK.

## Usage

```js
const pb = new PocketBase('/')

blok.store('todos', blokPocketbase.pbCollection(pb, 'todos', { sort: '-created' }))

blok.mount('#app', {
  state: { title: '' },
  mount() {
    this.store.todos.connect()   // load, then follow realtime changes
  },
  methods: {
    async add() {
      await this.store.todos.save({ title: this.title })
      this.title = ''
    },
    toggle(todo) { this.store.todos.save({ id: todo.id, done: !todo.done }) },
    remove(todo) { this.store.todos.remove(todo.id) },
  },
  view: ($) => ({ div: { children: [
    { form: { submit: 'add', children: [
      { input: { type: 'text', model: $.title } },
      { button: { type: 'submit', text: 'Add' } },
    ] } },
    { when: $.store.todos.loading.connect, children: [{ p: 'Loading...' }] },
    { when: $.store.todos.error.connect, children: [{ p: { text: $.store.todos.error.connect } }] },
    { each: $.store.todos.items, as: 'todo', key: 'id', children: [
      { label: { children: [
        { input: { type: 'checkbox', props: { checked: $.todo.done }, change: 'toggle(todo)' } },
        { span: { text: $.todo.title } },
        { button: { click: 'remove(todo)', text: 'x' } },
      ] } },
    ] },
  ] } }),
})
```

A runnable version lives in [`examples/pocketbase`](https://github.com/maleta/blokjs/tree/main/examples/pocketbase):

```bash
pocketbase serve --migrationsDir=examples/pocketbase/pb_migrations --publicDir=examples/pocketbase/pb_public
# open http://127.0.0.1:8090 in two tabs
```

## `pbCollection(pb, name, options?)`

Returns a store definition for `blok.store()` that mirrors one collection.

| Option | Description |
|---|---|
| `filter` | PocketBase filter, e.g. `done = false` |
| `sort` | PocketBase sort, e.g. `-created,title` |
| `expand` | Relations to expand |
| `fields` | Fields to return |
| `key` | Field with a unique index. `save()` without an `id` then updates the record with the same key instead of failing |

| Member | Description |
|---|---|
| `items` | The records, in `sort` order |
| `load()` | Fetch all matching records into `items` |
| `connect()` | `load()`, then apply realtime creates, updates and deletes until `disconnect()` |
| `disconnect()` | Stop following realtime changes |
| `save(data)` | Update when `data.id` is set, otherwise create (or update by `key`). Returns the saved record |
| `remove(id)` | Delete the record |

Every method is async, so `$.store.todos.loading.save` and `$.store.todos.error.save` work in views.

How syncing behaves:

- Records `save()` and `remove()` return appear in `items` right away. The realtime echo of your own write changes nothing.
- A plain field sort (`-created`, `title,-n`) is kept locally as records change. A sort that only the server can apply (`@random`, relation fields) reloads the list on each change.
- A store with a `filter` reloads the list on each create or update. PocketBase sends no event when a record stops matching a filter, so patching locally would leave stale rows. Deletes are removed locally.
- After a realtime reconnect the store reloads, since events can be lost while offline.
- When the signed-in user changes, connected stores reconnect and reload. PocketBase keeps the first auth of an open realtime connection, so the stores open a new one.
- `load()` fetches every matching record, which suits collections up to a few thousand records.
- Call `connect()` once per store, for example in the root `mount()`. `disconnect()` stops syncing for every component that uses the store.

## `pbAuth(pb, options?)`

Returns a store definition that mirrors `pb.authStore`.

| Member | Description |
|---|---|
| `user` | The signed-in record, or `null`. A copy, so editing it never touches the SDK |
| `isLoggedIn` | `user !== null` |
| `connect()` | Validate a saved session with the server (a rejected one is cleared) and follow auth changes from anywhere, including other tabs |
| `login(identity, password)` | Password login against `options.collection` (default `users`) |
| `logout()` | Clear the session |

```js
blok.store('auth', blokPocketbase.pbAuth(pb))

// root mount(): this.store.auth.connect()
{ when: $.store.auth.isLoggedIn, children: [{ span: { text: $.store.auth.user.email } }] }
{ button: { click: 'logout', text: 'Log out' } }   // methods: { logout() { this.store.auth.logout() } }
```

For OAuth2 or OTP, call the SDK directly (`pb.collection('users').authWithOAuth2(...)`). A connected `pbAuth` store picks up the change.

## Schema and hosting

- Create collections with a [migration](https://pocketbase.io/docs/js-migrations/) or the admin UI. This package never needs superuser credentials.
- Serve the app from PocketBase's `pb_public` directory, so the page and the API share an origin. That avoids CORS, and avoids mixed-content blocking of `http://127.0.0.1:8090` from an `https://` page.

## Development

```bash
pnpm test                                   # unit tests
PB_BIN=/path/to/pocketbase pnpm test        # plus integration tests against a real PocketBase
pnpm run build
```

## License

MIT
