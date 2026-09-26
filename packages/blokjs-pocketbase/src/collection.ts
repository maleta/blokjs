import type PocketBase from 'pocketbase'
import type { RecordModel } from 'pocketbase'

export interface CollectionOptions {
  /** PocketBase filter expression. A filtered store reloads from the server on every change. */
  filter?: string
  /** PocketBase sort expression, e.g. `-updated,title`. */
  sort?: string
  expand?: string
  fields?: string
  /** Field with a unique index. `save()` without an `id` then updates the record with the same value instead of failing. */
  key?: string
}

/** The store as seen through `this.store.<name>` in BlokJS. */
export interface CollectionStore {
  items: RecordModel[]
  load(): Promise<void>
  connect(): Promise<void>
  disconnect(): Promise<void>
  save(data: Record<string, unknown>): Promise<RecordModel>
  remove(id: string): Promise<void>
}

type Compare = (a: RecordModel, b: RecordModel) => number

interface Chain {
  tail: Promise<unknown>
}

interface Sync {
  data: Chain
  life: Chain
  reloadQueued: boolean
  stops: Array<() => unknown>
}

const SORT_FIELD = /^([+-]?)(\w+)$/

function noop(): void {}

function enqueue<T>(chain: Chain, task: () => T | Promise<T>): Promise<T> {
  const run = chain.tail.then(task)
  chain.tail = run.then(noop, noop)
  return run
}

/** Local equivalent of a sort made only of plain fields; null when only the server can sort. */
function comparator(sort: string): Compare | null {
  const keys: Array<[string, number]> = []
  for (const part of sort.split(',')) {
    const m = SORT_FIELD.exec(part.trim())
    if (!m) return null
    keys.push([m[2], m[1] === '-' ? -1 : 1])
  }
  return (a, b) => {
    for (const [field, dir] of keys) {
      if (a[field] < b[field]) return -dir
      if (a[field] > b[field]) return dir
    }
    return 0
  }
}

function isNotUnique(err: unknown, field: string): boolean {
  const data = (err as { response?: { data?: Record<string, { code?: string }> } } | null)?.response?.data
  return data?.[field]?.code === 'validation_not_unique'
}

/**
 * Store definition for `blok.store()` that mirrors a PocketBase collection into `items`.
 *
 * Methods: `load()` fetches all matching records, `connect()` loads and then applies
 * realtime changes until `disconnect()`, `save(data)` creates or updates, `remove(id)` deletes.
 * All of them are async, so BlokJS tracks `loading.<method>` and `error.<method>`.
 *
 * @param pb - PocketBase SDK client owned by the app
 * @param name - collection name or id
 */
export function pbCollection(pb: PocketBase, name: string, options: CollectionOptions = {}) {
  const { filter, sort, expand, fields, key } = options
  const order = sort ? comparator(sort) : undefined
  // Realtime events carry no "left the filter" signal, and a non-field sort cannot be replayed locally.
  const patchable = !filter && order !== null
  const syncs = new WeakMap<object, Sync>()

  // Keyed by store proxy: isolated mounts create separate instances from one definition.
  function sync(store: CollectionStore): Sync {
    let s = syncs.get(store)
    if (!s) {
      s = { data: { tail: Promise.resolve() }, life: { tail: Promise.resolve() }, reloadQueued: false, stops: [] }
      syncs.set(store, s)
    }
    return s
  }

  function scheduleLoad(store: CollectionStore): void {
    const s = sync(store)
    if (s.reloadQueued) return
    s.reloadQueued = true
    void enqueue(s.data, () => {
      s.reloadQueued = false
      return store.load()
    })
  }

  function put(store: CollectionStore, record: RecordModel): void {
    if (!patchable) return scheduleLoad(store)
    const i = store.items.findIndex((r) => r.id === record.id)
    if (i === -1) store.items.push(record)
    else store.items.splice(i, 1, record)
    if (order) store.items.sort(order)
  }

  function drop(store: CollectionStore, id: string): void {
    const i = store.items.findIndex((r) => r.id === id)
    if (i !== -1) store.items.splice(i, 1)
  }

  async function stop(s: Sync): Promise<void> {
    for (const fn of s.stops.splice(0)) await fn()
  }

  async function start(store: CollectionStore, s: Sync): Promise<void> {
    await stop(s)
    s.stops.push(
      await pb.collection(name).subscribe(
        '*',
        (e) => void enqueue(s.data, () => (e.action === 'delete' ? drop(store, e.record.id) : put(store, e.record))),
        { expand, fields },
      ),
    )
    // Fires only on reconnects here; events sent while the connection was down are lost.
    s.stops.push(await pb.realtime.subscribe('PB_CONNECT', () => scheduleLoad(store)))
    let userId = pb.authStore.record?.id
    s.stops.push(
      pb.authStore.onChange((_, record) => {
        if (record?.id === userId) return
        userId = record?.id
        // The server allows only guest-to-user upgrades on an open realtime connection, and the SDK
        // has no public reset. Other stores on this client reconnect from their own listeners.
        ;(pb.realtime as unknown as { disconnect(): void }).disconnect()
        void store.connect()
      }),
    )
    // Queued so realtime patches that arrive during the load apply on top of it.
    await enqueue(s.data, () => store.load())
  }

  async function saveByKey(field: string, data: Record<string, unknown>): Promise<RecordModel> {
    const col = pb.collection(name)
    try {
      return await col.create(data, { expand, fields, requestKey: null })
    } catch (err) {
      if (!isNotUnique(err, field)) throw err
    }
    const existing = await col.getFirstListItem(pb.filter(`${field} = {:value}`, { value: data[field] }), {
      fields: 'id',
      requestKey: null,
    })
    return col.update(existing.id, data, { expand, fields, requestKey: null })
  }

  return {
    state: { items: [] as RecordModel[] },
    methods: {
      async load(this: CollectionStore): Promise<void> {
        this.items = await pb.collection(name).getFullList({ filter, sort, expand, fields, requestKey: null })
      },

      async connect(this: CollectionStore): Promise<void> {
        const s = sync(this)
        await enqueue(s.life, () => start(this, s))
      },

      async disconnect(this: CollectionStore): Promise<void> {
        const s = sync(this)
        await enqueue(s.life, () => stop(s))
      },

      async save(this: CollectionStore, data: Record<string, unknown>): Promise<RecordModel> {
        const col = pb.collection(name)
        const id = typeof data.id === 'string' ? data.id : ''
        let record: RecordModel
        if (id) record = await col.update(id, data, { expand, fields, requestKey: null })
        else if (key && data[key] != null) record = await saveByKey(key, data)
        else record = await col.create(data, { expand, fields, requestKey: null })
        put(this, record)
        return record
      },

      async remove(this: CollectionStore, id: string): Promise<void> {
        await pb.collection(name).delete(id, { requestKey: null })
        drop(this, id)
      },
    },
  }
}
