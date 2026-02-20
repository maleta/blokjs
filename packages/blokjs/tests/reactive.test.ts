import { describe, it, expect, vi } from 'vitest'
import {
  createProxy,
  createEffect,
  untracked,
  setByPath,
  pauseTracking,
  resumeTracking,
  RAW,
} from '../src/reactive'
import { Scope } from '../src/scope'

// Helper: flush microtask queue so batched effects run
function flush(): Promise<void> {
  return new Promise((r) => queueMicrotask(r))
}

// Fresh scope per test
function scope(): Scope {
  return new Scope()
}

// ---- createProxy: basic get/set ----

describe('createProxy', () => {
  it('reads and writes primitive properties', () => {
    const p = createProxy({ a: 1, b: 'hello' })
    expect(p.a).toBe(1)
    expect(p.b).toBe('hello')
    p.a = 42
    expect(p.a).toBe(42)
  })

  it('exposes raw target via RAW symbol', () => {
    const raw = { x: 1 }
    const p = createProxy(raw)
    expect(p[RAW]).toBe(raw)
  })

  it('returns same proxy for same nested object (cache)', () => {
    const inner = { v: 1 }
    const p = createProxy({ a: inner, b: inner })
    expect(p.a).toBe(p.b)
  })

  it('already-proxied object returns itself', () => {
    const p = createProxy({ x: 1 })
    // Accessing RAW is defined - wrapping again should short-circuit
    const p2 = createProxy(p)
    expect(p2).toBe(p)
  })

  it('handles nested objects reactively', () => {
    const p = createProxy({ nested: { count: 0 } })
    p.nested.count = 5
    expect(p.nested.count).toBe(5)
  })

  it('handles deleteProperty', async () => {
    const p = createProxy({ a: 1, b: 2 })
    const s = scope()
    const spy = vi.fn()
    createEffect(() => { spy(p.a) }, s)
    spy.mockClear()

    delete p.a
    await flush()
    expect(spy).toHaveBeenCalledTimes(1)
    expect(p.a).toBeUndefined()
    s.dispose()
  })
})

// ---- createProxy: arrays ----

describe('createProxy - arrays', () => {
  it('reads array elements and length', () => {
    const p = createProxy({ items: [1, 2, 3] })
    expect(p.items[0]).toBe(1)
    expect(p.items.length).toBe(3)
  })

  it('setting an index triggers length effect', async () => {
    const p = createProxy({ items: [1, 2] })
    const s = scope()
    const spy = vi.fn()
    createEffect(() => { spy(p.items.length) }, s)
    spy.mockClear()

    p.items[5] = 99
    await flush()
    expect(spy).toHaveBeenCalled()
    s.dispose()
  })
})

// ---- createEffect: dependency tracking ----

describe('createEffect', () => {
  it('runs immediately on creation', () => {
    const p = createProxy({ x: 0 })
    const s = scope()
    const spy = vi.fn()
    createEffect(() => spy(p.x), s)
    expect(spy).toHaveBeenCalledWith(0)
    s.dispose()
  })

  it('re-runs when tracked dependency changes', async () => {
    const p = createProxy({ count: 0 })
    const s = scope()
    const spy = vi.fn()
    createEffect(() => spy(p.count), s)
    spy.mockClear()

    p.count = 1
    await flush()
    expect(spy).toHaveBeenCalledWith(1)
    s.dispose()
  })

  it('does not re-run when set to same value', async () => {
    const p = createProxy({ v: 10 })
    const s = scope()
    const spy = vi.fn()
    createEffect(() => spy(p.v), s)
    spy.mockClear()

    p.v = 10
    await flush()
    expect(spy).not.toHaveBeenCalled()
    s.dispose()
  })

  it('tracks multiple dependencies', async () => {
    const p = createProxy({ a: 1, b: 2 })
    const s = scope()
    const spy = vi.fn()
    createEffect(() => spy(p.a + p.b), s)
    spy.mockClear()

    p.a = 10
    await flush()
    expect(spy).toHaveBeenCalledWith(12)

    spy.mockClear()
    p.b = 20
    await flush()
    expect(spy).toHaveBeenCalledWith(30)
    s.dispose()
  })

  it('stops running after scope dispose', async () => {
    const p = createProxy({ v: 0 })
    const s = scope()
    const spy = vi.fn()
    createEffect(() => spy(p.v), s)
    spy.mockClear()

    s.dispose()
    p.v = 99
    await flush()
    expect(spy).not.toHaveBeenCalled()
  })

  it('handles dynamic dependency switching', async () => {
    const p = createProxy({ flag: true, a: 1, b: 2 })
    const s = scope()
    const spy = vi.fn()
    createEffect(() => {
      spy(p.flag ? p.a : p.b)
    }, s)
    spy.mockClear()

    // b is not tracked when flag is true
    p.b = 99
    await flush()
    expect(spy).not.toHaveBeenCalled()

    // switch branch - now b is tracked, a is not
    p.flag = false
    await flush()
    expect(spy).toHaveBeenCalledWith(99)

    spy.mockClear()
    p.a = 50
    await flush()
    expect(spy).not.toHaveBeenCalled()

    p.b = 200
    await flush()
    expect(spy).toHaveBeenCalledWith(200)
    s.dispose()
  })
})

// ---- Array mutators triggering effects ----

describe('array mutators', () => {
  it('push triggers effect', async () => {
    const p = createProxy({ list: [1] })
    const s = scope()
    const spy = vi.fn()
    createEffect(() => spy([...p.list]), s)
    spy.mockClear()

    p.list.push(2)
    await flush()
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith([1, 2])
    s.dispose()
  })

  it('pop triggers effect', async () => {
    const p = createProxy({ list: [1, 2, 3] })
    const s = scope()
    const spy = vi.fn()
    createEffect(() => spy([...p.list]), s)
    spy.mockClear()

    p.list.pop()
    await flush()
    expect(spy).toHaveBeenCalledWith([1, 2])
    s.dispose()
  })

  it('splice triggers effect', async () => {
    const p = createProxy({ list: [1, 2, 3, 4] })
    const s = scope()
    const spy = vi.fn()
    createEffect(() => spy([...p.list]), s)
    spy.mockClear()

    p.list.splice(1, 2)
    await flush()
    expect(spy).toHaveBeenCalledWith([1, 4])
    s.dispose()
  })

  it('shift and unshift trigger effects', async () => {
    const p = createProxy({ list: [1, 2] })
    const s = scope()
    const spy = vi.fn()
    createEffect(() => spy([...p.list]), s)
    spy.mockClear()

    p.list.shift()
    await flush()
    expect(spy).toHaveBeenCalledWith([2])

    spy.mockClear()
    p.list.unshift(0)
    await flush()
    expect(spy).toHaveBeenCalledWith([0, 2])
    s.dispose()
  })

  it('sort and reverse trigger effects', async () => {
    const p = createProxy({ list: [3, 1, 2] })
    const s = scope()
    const spy = vi.fn()
    createEffect(() => spy([...p.list]), s)
    spy.mockClear()

    p.list.sort()
    await flush()
    expect(spy).toHaveBeenCalledWith([1, 2, 3])

    spy.mockClear()
    p.list.reverse()
    await flush()
    expect(spy).toHaveBeenCalledWith([3, 2, 1])
    s.dispose()
  })

  it('unwraps proxied args passed to mutators', async () => {
    const rawInner = { val: 42 }
    const inner = createProxy(rawInner)
    const p = createProxy({ list: [] as any[] })
    const s = scope()
    const spy = vi.fn()
    createEffect(() => spy(p.list.length), s)
    spy.mockClear()

    p.list.push(inner)
    await flush()
    expect(spy).toHaveBeenCalled()
    // The underlying raw array should store the raw object, not the proxy
    const rawList: any[] = (p as any)[RAW].list
    expect(rawList[0]).toBe(rawInner)
    s.dispose()
  })
})

// ---- Batching ----

describe('batching', () => {
  it('multiple synchronous changes cause a single effect run', async () => {
    const p = createProxy({ a: 0, b: 0 })
    const s = scope()
    const spy = vi.fn()
    createEffect(() => spy(p.a + p.b), s)
    spy.mockClear()

    p.a = 1
    p.b = 2
    p.a = 3
    await flush()
    // Only one batched run
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith(5)
    s.dispose()
  })

  it('effects scheduled after flush run in next batch', async () => {
    const p = createProxy({ v: 0 })
    const s = scope()
    const spy = vi.fn()
    createEffect(() => spy(p.v), s)
    spy.mockClear()

    p.v = 1
    await flush()
    expect(spy).toHaveBeenCalledTimes(1)

    spy.mockClear()
    p.v = 2
    await flush()
    expect(spy).toHaveBeenCalledTimes(1)
    s.dispose()
  })
})

// ---- untracked ----

describe('untracked', () => {
  it('reads inside untracked do not create dependencies', async () => {
    const p = createProxy({ a: 1, b: 2 })
    const s = scope()
    const spy = vi.fn()
    createEffect(() => {
      const bVal = untracked(() => p.b)
      spy(p.a + bVal)
    }, s)
    spy.mockClear()

    // Changing b should NOT trigger effect
    p.b = 99
    await flush()
    expect(spy).not.toHaveBeenCalled()

    // Changing a should trigger effect
    p.a = 10
    await flush()
    expect(spy).toHaveBeenCalledWith(109)
    s.dispose()
  })

  it('returns the value from the callback', () => {
    const result = untracked(() => 42)
    expect(result).toBe(42)
  })
})

// ---- setByPath ----

describe('setByPath', () => {
  it('sets a top-level property', () => {
    const p = createProxy({ name: 'old' })
    setByPath(p, ['name'], 'new')
    expect(p.name).toBe('new')
  })

  it('sets a nested property', () => {
    const p = createProxy({ a: { b: { c: 0 } } })
    setByPath(p, ['a', 'b', 'c'], 99)
    expect(p.a.b.c).toBe(99)
  })

  it('triggers effects when used on proxy', async () => {
    const p = createProxy({ x: { y: 1 } })
    const s = scope()
    const spy = vi.fn()
    createEffect(() => spy(p.x.y), s)
    spy.mockClear()

    setByPath(p, ['x', 'y'], 42)
    await flush()
    expect(spy).toHaveBeenCalledWith(42)
    s.dispose()
  })

  it('no-ops on empty path', () => {
    const p = createProxy({ a: 1 })
    setByPath(p, [], 99)
    expect(p.a).toBe(1)
  })

  it('no-ops when intermediate is null', () => {
    const p = createProxy({ a: null as any })
    // Should not throw
    setByPath(p, ['a', 'b', 'c'], 1)
  })
})

// ---- pauseTracking / resumeTracking ----

describe('pauseTracking / resumeTracking', () => {
  it('pauses and resumes dependency tracking', async () => {
    const p = createProxy({ a: 1, b: 2 })
    const s = scope()
    const spy = vi.fn()
    createEffect(() => {
      const aVal = p.a
      pauseTracking()
      const bVal = p.b
      resumeTracking()
      spy(aVal + bVal)
    }, s)
    spy.mockClear()

    // b read was untracked
    p.b = 99
    await flush()
    expect(spy).not.toHaveBeenCalled()

    // a is tracked
    p.a = 10
    await flush()
    expect(spy).toHaveBeenCalledWith(109)
    s.dispose()
  })
})
