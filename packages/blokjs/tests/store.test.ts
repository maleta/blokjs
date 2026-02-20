import { describe, it, expect, vi } from 'vitest'
import { createStoreInstance, createStoreProxy, type StoreInstance } from '../src/store'

function flush(): Promise<void> {
  return new Promise((r) => queueMicrotask(r))
}

// ---- createStoreInstance: state read/write ----

describe('createStoreInstance - state', () => {
  it('reads state values through proxy', () => {
    const inst = createStoreInstance('test', {
      state: { count: 0, name: 'hello' },
    })
    expect(inst.proxy.count).toBe(0)
    expect(inst.proxy.name).toBe('hello')
  })

  it('writes state values through proxy', () => {
    const inst = createStoreInstance('test', {
      state: { count: 0 },
    })
    inst.proxy.count = 42
    expect(inst.proxy.count).toBe(42)
  })

  it('clones state so original def is not affected', () => {
    const original = { count: 0, nested: { value: 1 } }
    const inst = createStoreInstance('test', { state: original })
    inst.proxy.count = 99
    inst.proxy.nested.value = 99
    expect(original.count).toBe(0)
    expect(original.nested.value).toBe(1)
  })

  it('falls back to shallow copy for non-cloneable state', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fn = () => {}
    const inst = createStoreInstance('test', {
      state: { handler: fn, count: 1 },
    })
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('non-cloneable'),
    )
    // shallow copy means the function reference is shared
    expect(inst.proxy.handler).toBe(fn)
    expect(inst.proxy.count).toBe(1)
    warn.mockRestore()
  })
})

// ---- createStoreInstance: computed ----

describe('createStoreInstance - computed', () => {
  it('returns derived value from state', () => {
    const inst = createStoreInstance('test', {
      state: { count: 5 },
      computed: {
        doubled() {
          return this.count * 2
        },
      },
    })
    expect(inst.proxy.doubled).toBe(10)
  })

  it('reflects state changes', () => {
    const inst = createStoreInstance('test', {
      state: { count: 3 },
      computed: {
        doubled() {
          return this.count * 2
        },
      },
    })
    inst.proxy.count = 10
    expect(inst.proxy.doubled).toBe(20)
  })
})

// ---- createStoreInstance: methods ----

describe('createStoreInstance - methods', () => {
  it('calls method through proxy', () => {
    const inst = createStoreInstance('test', {
      state: { count: 0 },
      methods: {
        increment() {
          this.count++
        },
      },
    })
    inst.proxy.increment()
    expect(inst.proxy.count).toBe(1)
  })

  it('method this binding points to proxy so it can read state', () => {
    const inst = createStoreInstance('test', {
      state: { items: [1, 2, 3] },
      methods: {
        total() {
          return this.items.reduce((a: number, b: number) => a + b, 0)
        },
      },
    })
    expect(inst.proxy.total()).toBe(6)
  })
})

// ---- createStoreInstance: write guards ----

describe('createStoreInstance - write guards', () => {
  it('warns on write to computed property', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const inst = createStoreInstance('test', {
      state: { count: 0 },
      computed: {
        doubled() {
          return this.count * 2
        },
      },
    })
    inst.proxy.doubled = 999
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('computed'),
    )
    // value should not change
    expect(inst.proxy.doubled).toBe(0)
    warn.mockRestore()
  })

  it('warns on write to method property', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const inst = createStoreInstance('test', {
      state: { count: 0 },
      methods: {
        increment() {
          this.count++
        },
      },
    })
    inst.proxy.increment = 'nope'
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('method'),
    )
    // method should still work
    inst.proxy.increment()
    expect(inst.proxy.count).toBe(1)
    warn.mockRestore()
  })
})

// ---- createStoreInstance: symbol keys ----

describe('createStoreInstance - symbol keys', () => {
  it('get returns undefined for symbol key', () => {
    const inst = createStoreInstance('test', { state: { a: 1 } })
    expect(inst.proxy[Symbol('x')]).toBeUndefined()
  })

  it('set with symbol key is a no-op and does not throw', () => {
    const inst = createStoreInstance('test', { state: { a: 1 } })
    expect(() => {
      inst.proxy[Symbol('x')] = 'value'
    }).not.toThrow()
  })
})

// ---- createStoreInstance: loading and error proxies ----

describe('createStoreInstance - loading/error', () => {
  it('proxy.loading returns loading proxy, initially empty', () => {
    const inst = createStoreInstance('test', {
      state: { count: 0 },
      methods: { fetch() {} },
    })
    expect(inst.proxy.loading).toBe(inst.loadingProxy)
  })

  it('proxy.error returns error proxy, initially empty', () => {
    const inst = createStoreInstance('test', {
      state: { count: 0 },
      methods: { fetch() {} },
    })
    expect(inst.proxy.error).toBe(inst.errorProxy)
  })
})

// ---- createStoreInstance: async tracking ----

describe('createStoreInstance - async tracking', () => {
  it('sets loading=true then false on resolved promise', async () => {
    const inst = createStoreInstance('test', {
      state: {},
      methods: {
        fetchData() {
          return new Promise((resolve) => setTimeout(resolve, 0))
        },
      },
    })

    inst.proxy.fetchData()
    await flush()
    expect(inst.proxy.loading.fetchData).toBe(true)

    await new Promise((r) => setTimeout(r, 0))
    await flush()
    expect(inst.proxy.loading.fetchData).toBe(false)
    expect(inst.proxy.error.fetchData).toBeNull()
  })

  it('sets loading=false and error on rejected promise', async () => {
    let rejectFn: (e: string) => void
    const inst = createStoreInstance('test', {
      state: {},
      methods: {
        fetchData() {
          return new Promise((_, reject) => {
            rejectFn = reject
          })
        },
      },
    })

    inst.proxy.fetchData()
    await flush()
    expect(inst.proxy.loading.fetchData).toBe(true)

    rejectFn!('fail')
    await flush()
    await new Promise((r) => setTimeout(r, 0))
    await flush()
    expect(inst.proxy.loading.fetchData).toBe(false)
    expect(inst.proxy.error.fetchData).toBe('fail')
  })

  it('does not set loading for non-async method', () => {
    const inst = createStoreInstance('test', {
      state: { count: 0 },
      methods: {
        increment() {
          this.count++
          return this.count
        },
      },
    })

    inst.proxy.increment()
    expect(inst.loadingData.increment).toBeUndefined()
  })
})

// ---- createStoreProxy ----

describe('createStoreProxy', () => {
  it('returns store proxy by name', () => {
    const inst = createStoreInstance('counter', {
      state: { count: 0 },
    })
    const stores = new Map<string, StoreInstance>()
    stores.set('counter', inst)
    const sp = createStoreProxy(stores)
    expect(sp.counter).toBe(inst.proxy)
  })

  it('returns undefined for missing store name', () => {
    const stores = new Map<string, StoreInstance>()
    const sp = createStoreProxy(stores)
    expect(sp.nonexistent).toBeUndefined()
  })

  it('set is a no-op and does not throw', () => {
    const stores = new Map<string, StoreInstance>()
    const sp = createStoreProxy(stores)
    expect(() => {
      sp.anything = 'value'
    }).not.toThrow()
  })

  it('returns undefined for symbol key', () => {
    const stores = new Map<string, StoreInstance>()
    const sp = createStoreProxy(stores)
    expect(sp[Symbol('x')]).toBeUndefined()
  })
})
