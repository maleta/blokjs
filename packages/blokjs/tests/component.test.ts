import { describe, it, expect, vi } from 'vitest'
import {
  createApp,
  createInstance,
  evalComputed,
  resolveOnInstance,
  setOnInstance,
  setupWatchers,
  RESERVED_CONTEXT_KEYS,
} from '../src/component'
import type { App, ComponentDef, ComponentInstance } from '../src/component'
import { createRef } from '../src/ref-proxy'
import { createProxy } from '../src/reactive'

function flush(): Promise<void> {
  return new Promise((r) => queueMicrotask(r))
}

function makeApp(): App {
  return createApp()
}

function makeDef(overrides: Partial<ComponentDef> = {}): ComponentDef {
  return { view: () => ({ div: null }), ...overrides }
}

function makeInstance(
  defOverrides: Partial<ComponentDef> = {},
  app?: App,
  parent?: ComponentInstance | null,
  propBindings?: Record<string, any>,
): ComponentInstance {
  return createInstance(
    makeDef(defOverrides),
    app ?? makeApp(),
    parent ?? null,
    propBindings ?? {},
  )
}

// ---- createApp ----

describe('createApp', () => {
  it('returns app with empty initial state', () => {
    const app = createApp()
    expect(app.registry.size).toBe(0)
    expect(app.stores.size).toBe(0)
    expect(app.root).toBeNull()
    expect(app.router).toBeNull()
    expect(app.storeProxy).toBeNull()
  })

  it('routeProxy defaults to { path: "/", params: {}, query: {} }', () => {
    const app = createApp()
    expect(app.routeProxy.path).toBe('/')
    expect(app.routeProxy.params).toEqual({})
    expect(app.routeProxy.query).toEqual({})
  })
})

// ---- createInstance ----

describe('createInstance', () => {
  it('clones state so original def is not affected', () => {
    const originalState = { count: 0, items: [1, 2] }
    const def = makeDef({ state: originalState })
    const inst = createInstance(def, makeApp(), null, {})

    inst.stateProxy.count = 99
    inst.stateProxy.items.push(3)

    expect(originalState.count).toBe(0)
    expect(originalState.items).toEqual([1, 2])
  })

  it('ref prop bindings classified as sharedProps when parent exists', () => {
    const app = makeApp()
    const parent = makeInstance({}, app)
    const ref = createRef(['count'])

    const inst = createInstance(makeDef(), app, parent, { myProp: ref })

    expect(inst.sharedProps.has('myProp')).toBe(true)
    expect(inst.sharedProps.get('myProp')!.owner).toBe(parent)
    expect(inst.sharedProps.get('myProp')!.ref.path).toEqual(['count'])
    expect(inst.staticProps.has('myProp')).toBe(false)
  })

  it('static (non-ref) prop bindings classified as staticProps', () => {
    const app = makeApp()
    const parent = makeInstance({}, app)
    const inst = createInstance(makeDef(), app, parent, { label: 'hello', num: 42 })

    expect(inst.staticProps.get('label')).toBe('hello')
    expect(inst.staticProps.get('num')).toBe(42)
    expect(inst.sharedProps.size).toBe(0)
  })
})

// ---- Context proxy get ----

describe('context proxy - get', () => {
  it('reads state value via context', () => {
    const inst = makeInstance({ state: { count: 5 } })
    expect(inst.context.count).toBe(5)
  })

  it('returns computed value', () => {
    const inst = makeInstance({
      state: { count: 3 },
      computed: {
        doubled() { return this.count * 2 },
      },
    })
    expect(inst.context.doubled).toBe(6)
  })

  it('method this binding is the context (can read state via this)', () => {
    const inst = makeInstance({
      state: { name: 'briq' },
      methods: {
        greet() { return `hello ${this.name}` },
      },
    })
    expect(inst.context.greet()).toBe('hello briq')
  })

  it('context.store returns app.storeProxy', () => {
    const app = makeApp()
    const storeData = { counter: { val: 10 } }
    app.storeProxy = createProxy(storeData)

    const inst = makeInstance({}, app)
    expect(inst.context.store).toBe(app.storeProxy)
  })

  it('context.loading returns loadingProxy', () => {
    const inst = makeInstance()
    expect(inst.context.loading).toBe(inst.loadingProxy)
  })

  it('context.error returns errorProxy', () => {
    const inst = makeInstance()
    expect(inst.context.error).toBe(inst.errorProxy)
  })

  it('context.refs returns inst.refs', () => {
    const inst = makeInstance()
    const el = {} as HTMLElement
    inst.refs.myInput = el
    expect(inst.context.refs.myInput).toBe(el)
  })

  it('context.el returns inst.el', () => {
    const inst = makeInstance()
    expect(inst.context.el).toBeNull()
    const el = {} as HTMLElement
    inst.el = el
    expect(inst.context.el).toBe(el)
  })

  it('context.route returns app.routeProxy', () => {
    const app = makeApp()
    const inst = makeInstance({}, app)
    expect(inst.context.route).toBe(app.routeProxy)
    expect(inst.context.route.path).toBe('/')
  })

  it('context.emit fires event handler registered on instance', () => {
    const inst = makeInstance()
    const spy = vi.fn()
    inst.eventHandlers.set('update', spy)

    inst.context.emit('update', { value: 42 })
    expect(spy).toHaveBeenCalledWith({ value: 42 })
  })

  it('shared prop reads from owner instance state', () => {
    const app = makeApp()
    const parent = makeInstance({ state: { count: 10 } }, app)
    const ref = createRef(['count'])
    const child = createInstance(makeDef(), app, parent, { myCount: ref })

    expect(child.context.myCount).toBe(10)

    parent.stateProxy.count = 20
    expect(child.context.myCount).toBe(20)
  })

  it('static prop returns the stored value', () => {
    const app = makeApp()
    const inst = createInstance(makeDef(), app, null, { title: 'test' })
    expect(inst.context.title).toBe('test')
  })

  it('returns undefined for unknown key', () => {
    const inst = makeInstance()
    expect(inst.context.nonExistent).toBeUndefined()
  })

  it('returns undefined for symbol key', () => {
    const inst = makeInstance()
    expect(inst.context[Symbol('test')]).toBeUndefined()
  })
})

// ---- Context proxy set ----

describe('context proxy - set', () => {
  it('writing state through context', async () => {
    const inst = makeInstance({ state: { count: 0 } })
    inst.context.count = 42
    expect(inst.context.count).toBe(42)
    expect(inst.stateProxy.count).toBe(42)
  })

  it('reserved key warning (e.g. store)', () => {
    const inst = makeInstance()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    inst.context.store = 'bad'
    expect(warnSpy).toHaveBeenCalledWith('[blok] Cannot set reserved property "store"')

    warnSpy.mockRestore()
  })

  it('computed key warning', () => {
    const inst = makeInstance({
      state: { count: 1 },
      computed: { doubled() { return this.count * 2 } },
    })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    inst.context.doubled = 99
    expect(warnSpy).toHaveBeenCalledWith('[blok] Cannot set computed property "doubled"')

    warnSpy.mockRestore()
  })

  it('shared prop write-through to owner', () => {
    const app = makeApp()
    const parent = makeInstance({ state: { count: 0 } }, app)
    const ref = createRef(['count'])
    const child = createInstance(makeDef(), app, parent, { myCount: ref })

    child.context.myCount = 99
    expect(parent.stateProxy.count).toBe(99)
  })
})

// ---- resolveOnInstance ----

describe('resolveOnInstance', () => {
  it('state path ["count"] reads count from stateProxy', () => {
    const inst = makeInstance({ state: { count: 7 } })
    expect(resolveOnInstance(inst, ['count'])).toBe(7)
  })

  it('computed path ["doubled"] calls computed function', () => {
    const inst = makeInstance({
      state: { count: 4 },
      computed: { doubled() { return this.count * 2 } },
    })
    expect(resolveOnInstance(inst, ['doubled'])).toBe(8)
  })

  it('store path ["store", "myStore", "val"] reads through storeProxy', () => {
    const app = makeApp()
    app.storeProxy = createProxy({ myStore: { val: 55 } })
    const inst = makeInstance({}, app)

    expect(resolveOnInstance(inst, ['store', 'myStore', 'val'])).toBe(55)
  })

  it('route path ["route", "path"] reads through routeProxy', () => {
    const app = makeApp()
    const inst = makeInstance({}, app)

    expect(resolveOnInstance(inst, ['route', 'path'])).toBe('/')
  })

  it('loading path ["loading", "fetch"]', () => {
    const inst = makeInstance()
    inst.loadingProxy.fetch = true

    expect(resolveOnInstance(inst, ['loading', 'fetch'])).toBe(true)
  })

  it('error path ["error", "fetch"]', () => {
    const inst = makeInstance()
    inst.errorProxy.fetch = 'something went wrong'

    expect(resolveOnInstance(inst, ['error', 'fetch'])).toBe('something went wrong')
  })

  it('shared prop path delegates to owner', () => {
    const app = makeApp()
    const parent = makeInstance({ state: { items: [1, 2, 3] } }, app)
    const ref = createRef(['items'])
    const child = createInstance(makeDef(), app, parent, { list: ref })

    const result = resolveOnInstance(child, ['list'])
    expect(result).toEqual([1, 2, 3])
  })

  it('static prop path returns value', () => {
    const app = makeApp()
    const inst = createInstance(makeDef(), app, null, { label: 'hello' })

    expect(resolveOnInstance(inst, ['label'])).toBe('hello')
  })

  it('empty path returns undefined', () => {
    const inst = makeInstance()
    expect(resolveOnInstance(inst, [])).toBeUndefined()
  })

  it('null intermediate returns undefined', () => {
    const inst = makeInstance({ state: { obj: null } })
    expect(resolveOnInstance(inst, ['obj', 'nested', 'deep'])).toBeUndefined()
  })
})

// ---- setOnInstance ----

describe('setOnInstance', () => {
  it('top-level state ["count"] writes to stateProxy', () => {
    const inst = makeInstance({ state: { count: 0 } })
    setOnInstance(inst, ['count'], 42)
    expect(inst.stateProxy.count).toBe(42)
  })

  it('nested state ["nested", "val"] uses setByPath', () => {
    const inst = makeInstance({ state: { nested: { val: 0 } } })
    setOnInstance(inst, ['nested', 'val'], 99)
    expect(inst.stateProxy.nested.val).toBe(99)
  })

  it('store path delegates to storeProxy', () => {
    const app = makeApp()
    app.storeProxy = createProxy({ counter: { val: 0 } })
    const inst = makeInstance({}, app)

    setOnInstance(inst, ['store', 'counter', 'val'], 100)
    expect(app.storeProxy.counter.val).toBe(100)
  })

  it('shared prop path delegates to owner', () => {
    const app = makeApp()
    const parent = makeInstance({ state: { count: 0 } }, app)
    const ref = createRef(['count'])
    const child = createInstance(makeDef(), app, parent, { myCount: ref })

    setOnInstance(child, ['myCount'], 77)
    expect(parent.stateProxy.count).toBe(77)
  })

  it('empty path is no-op', () => {
    const inst = makeInstance({ state: { count: 5 } })
    setOnInstance(inst, [], 999)
    expect(inst.stateProxy.count).toBe(5)
  })

  it('computed sub-path write resolves computed then writes to sub-path on returned object', () => {
    const data = { nested: { x: 1 } }
    const inst = makeInstance({
      computed: {
        obj() { return data },
      },
    })

    setOnInstance(inst, ['obj', 'nested', 'x'], 42)
    expect(data.nested.x).toBe(42)
  })
})

// ---- setupWatchers ----

describe('setupWatchers', () => {
  it('fires callback on state change with (newVal, oldVal)', async () => {
    const spy = vi.fn()
    const inst = makeInstance({
      state: { count: 0 },
      watch: {
        count(newVal, oldVal) { spy(newVal, oldVal) },
      },
    })

    setupWatchers(inst)
    inst.stateProxy.count = 5
    await flush()

    expect(spy).toHaveBeenCalledWith(5, 0)
  })

  it('skips when value is unchanged', async () => {
    const spy = vi.fn()
    const inst = makeInstance({
      state: { count: 10 },
      watch: {
        count(newVal, oldVal) { spy(newVal, oldVal) },
      },
    })

    setupWatchers(inst)
    await flush()

    spy.mockClear()
    inst.stateProxy.count = 10
    await flush()

    expect(spy).not.toHaveBeenCalled()
  })

  it('multiple watchers on different keys', async () => {
    const spyA = vi.fn()
    const spyB = vi.fn()
    const inst = makeInstance({
      state: { a: 1, b: 2 },
      watch: {
        a(newVal, oldVal) { spyA(newVal, oldVal) },
        b(newVal, oldVal) { spyB(newVal, oldVal) },
      },
    })

    setupWatchers(inst)
    inst.stateProxy.a = 10
    inst.stateProxy.b = 20
    await flush()

    expect(spyA).toHaveBeenCalledWith(10, 1)
    expect(spyB).toHaveBeenCalledWith(20, 2)
  })

  it('correct this context in watcher callback', async () => {
    let capturedThis: any = null
    const inst = makeInstance({
      state: { count: 0 },
      watch: {
        count() { capturedThis = this },
      },
    })

    setupWatchers(inst)
    inst.stateProxy.count = 1
    await flush()

    expect(capturedThis).toBe(inst.context)
  })

  it('oldVal tracking across multiple changes', async () => {
    const calls: Array<[number, number]> = []
    const inst = makeInstance({
      state: { count: 0 },
      watch: {
        count(newVal: number, oldVal: number) { calls.push([newVal, oldVal]) },
      },
    })

    setupWatchers(inst)

    inst.stateProxy.count = 1
    await flush()

    inst.stateProxy.count = 5
    await flush()

    inst.stateProxy.count = 100
    await flush()

    expect(calls).toEqual([
      [1, 0],
      [5, 1],
      [100, 5],
    ])
  })
})
