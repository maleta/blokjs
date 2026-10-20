import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount, store, watch, validate } from '../src/index'
import { watch as serverWatch, store as serverStore } from '../src/server'

function flush(): Promise<void> {
  return new Promise((r) => queueMicrotask(r))
}

let uid = 0
function name(): string {
  return `outside${++uid}`
}

const handles: { destroy: () => void }[] = []
afterEach(() => {
  while (handles.length) handles.pop()!.destroy()
})

function mountApp(opts: any): HTMLElement {
  const el = document.createElement('div')
  document.body.appendChild(el)
  handles.push(mount(el, opts))
  return el
}

describe('store() return value', () => {
  it('returns the proxy that shared mounts see as this.store[name]', async () => {
    const n = name()
    const s = store(n, { state: { count: 1 } })
    let seen: any
    mountApp({ mount() { seen = this.store[n] }, view: () => ({ div: '' }) })
    await flush()
    expect(seen).toBe(s)
    expect(s.count).toBe(1)
  })

  it('looks up a registered store by name', () => {
    const n = name()
    const s = store(n, { state: {} })
    expect(store(n)).toBe(s)
    expect(store('outside-missing')).toBeUndefined()
  })

  it('returns the existing store on duplicate registration', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const n = name()
    const s = store(n, { state: { a: 1 } })
    expect(store(n, { state: { a: 2 } })).toBe(s)
    expect(s.a).toBe(1)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('already registered'))
    warn.mockRestore()
  })
})

describe('store.$state', () => {
  it('serializes the state keys only', () => {
    const s = store(name(), {
      state: { items: [1, 2], title: 't' },
      computed: { size() { return this.items.length } },
      methods: { add() {} },
    })
    expect(JSON.stringify(s.$state)).toBe('{"items":[1,2],"title":"t"}')
    expect(Object.keys(s.$state)).toEqual(['items', 'title'])
  })

  it('assigning updates the view and computed values, keeping missing keys', async () => {
    const n = name()
    const s = store(n, {
      state: { items: ['a'], title: 'x' },
      computed: { size() { return this.items.length } },
    })
    const el = mountApp({
      computed: { label() { return `${this.store[n].title}:${this.store[n].size}` } },
      view: ($: any) => ({ p: { text: $.label } }),
    })
    expect(el.textContent).toBe('x:1')
    s.$state = { items: ['a', 'b', 'c'] }
    await flush()
    expect(el.textContent).toBe('x:3')
    expect(s.title).toBe('x')
  })

  it('warns on a state key named $state', () => {
    expect(validate.store('s', { state: { $state: 1 } })).toEqual(['"$state" in state of store "s" is a reserved name.'])
  })
})

describe('watch()', () => {
  it('without deep fires on reassignment, not on push', async () => {
    const s = store(name(), { state: { items: [1] } })
    const cb = vi.fn()
    const stop = watch(() => s.items, cb)
    s.items.push(2)
    await flush()
    expect(cb).not.toHaveBeenCalled()
    const prev = s.items
    s.items = [3]
    await flush()
    expect(cb).toHaveBeenCalledTimes(1)
    expect(cb.mock.calls[0][0]).toEqual([3])
    expect(cb.mock.calls[0][1]).toBe(prev)
    stop()
  })

  it('with deep fires on push, splice, nested set, add and delete', async () => {
    const s = store(name(), { state: { items: [{ done: false }], meta: {} as Record<string, number> } })
    const cb = vi.fn()
    const stop = watch(() => s.$state, cb, { deep: true })

    s.items.push({ done: false })
    await flush()
    expect(cb).toHaveBeenCalledTimes(1)

    s.items.splice(0, 1)
    await flush()
    expect(cb).toHaveBeenCalledTimes(2)

    s.items[0].done = true
    await flush()
    expect(cb).toHaveBeenCalledTimes(3)

    s.meta.added = 1
    await flush()
    expect(cb).toHaveBeenCalledTimes(4)

    delete s.meta.added
    await flush()
    expect(cb).toHaveBeenCalledTimes(5)
    stop()
  })

  it('with deep fires once per batch', async () => {
    const s = store(name(), { state: { items: [] as number[], n: 0 } })
    const cb = vi.fn()
    const stop = watch(() => s.$state, cb, { deep: true })
    s.items.push(1)
    s.items.push(2)
    s.n = 5
    await flush()
    expect(cb).toHaveBeenCalledTimes(1)
    stop()
  })

  it('with deep tolerates cycles', async () => {
    const s = store(name(), { state: { node: {} as any } })
    s.node.self = s.node
    const cb = vi.fn()
    const stop = watch(() => s.$state, cb, { deep: true })
    s.node.x = 1
    await flush()
    expect(cb).toHaveBeenCalledTimes(1)
    stop()
  })

  it('immediate calls back right away', () => {
    const s = store(name(), { state: { n: 4 } })
    const cb = vi.fn()
    const stop = watch(() => s.n, cb, { immediate: true })
    expect(cb).toHaveBeenCalledWith(4, undefined)
    stop()
  })

  it('stop() ends the watch', async () => {
    const s = store(name(), { state: { n: 0 } })
    const cb = vi.fn()
    const stop = watch(() => s.n, cb)
    stop()
    s.n = 1
    await flush()
    expect(cb).not.toHaveBeenCalled()
  })

  it('does not track reads inside the callback', async () => {
    const s = store(name(), { state: { a: 0, b: 0 } })
    const cb = vi.fn(() => s.b)
    const stop = watch(() => s.a, cb)
    s.a = 1
    await flush()
    s.b = 1
    await flush()
    expect(cb).toHaveBeenCalledTimes(1)
    stop()
  })

  it('does not see an isolated mount writing its own store copy', async () => {
    const n = name()
    const s = store(n, { state: { n: 0 }, methods: { inc() { this.n++ } } })
    const cb = vi.fn()
    const stop = watch(() => s.n, cb)
    let isolatedStore: any
    const el = mountApp({
      isolated: true,
      mount() { isolatedStore = this.store[n] },
      view: ($: any) => ({ p: { text: $.store[n].n } }),
    })
    await flush()
    isolatedStore.inc()
    s.n = 10
    await flush()
    expect(el.textContent).toBe('1')
    expect(cb).toHaveBeenCalledTimes(1)
    expect(s.n).toBe(10)
    stop()
  })
})

describe('component watch object form', () => {
  it('deep handler fires on push into a store array', async () => {
    const n = name()
    const s = store(n, { state: { items: [] as number[] } })
    const handler = vi.fn()
    mountApp({
      watch: { [`store.${n}.items`]: { handler, deep: true } },
      view: () => ({ div: '' }),
    })
    s.items.push(1)
    await flush()
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('immediate handler runs with the component context', () => {
    let ctx: any
    const handler = vi.fn(function (this: any) { ctx = this })
    mountApp({
      state: { n: 2 },
      watch: { n: { handler, immediate: true } },
      view: () => ({ div: '' }),
    })
    expect(handler).toHaveBeenCalledWith(2, undefined)
    expect(ctx.n).toBe(2)
  })

  it('validate accepts the object form and warns on a missing handler', () => {
    expect(validate.component('C', { watch: { n: { handler() {}, deep: true } }, view: () => ({}) })).toEqual([])
    expect(validate.component('C', { watch: { n: { deep: true } as any }, view: () => ({}) }))
      .toEqual(['"C": watcher "n" has no handler function.'])
  })
})

describe('reactive key set', () => {
  it('re-renders a view that lists keys when a key is added or deleted', async () => {
    let ctx: any
    const el = mountApp({
      state: { map: { a: 1 } as Record<string, number> },
      computed: { keys() { return Object.keys(this.map).join(',') } },
      mount() { ctx = this },
      view: ($: any) => ({ p: { text: $.keys } }),
    })
    await flush()
    expect(el.textContent).toBe('a')
    ctx.map.b = 2
    await flush()
    expect(el.textContent).toBe('a,b')
    delete ctx.map.a
    await flush()
    expect(el.textContent).toBe('b')
  })
})

describe('server build', () => {
  it('watch returns a no-op stop and store returns the store', () => {
    const stop = serverWatch(() => 1, () => {})
    expect(typeof stop).toBe('function')
    stop()
    const s = serverStore(name(), { state: { n: 1 } })
    expect(s.n).toBe(1)
  })
})
