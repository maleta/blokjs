import { describe, it, expect, vi } from 'vitest'
import { Scope } from '../src/scope'

describe('Scope', () => {
  it('creates a child scope with parent reference', () => {
    const parent = new Scope()
    const child = parent.child()
    expect(child).toBeInstanceOf(Scope)
    // child is tracked - disposing parent should dispose child
    const fn = vi.fn()
    child.track(fn)
    parent.dispose()
    expect(fn).toHaveBeenCalledOnce()
  })

  it('tracks cleanup functions', () => {
    const scope = new Scope()
    const fn1 = vi.fn()
    const fn2 = vi.fn()
    scope.track(fn1)
    scope.track(fn2)
    scope.dispose()
    expect(fn1).toHaveBeenCalledOnce()
    expect(fn2).toHaveBeenCalledOnce()
  })

  it('runs cleanup functions in reverse order', () => {
    const scope = new Scope()
    const order: number[] = []
    scope.track(() => order.push(1))
    scope.track(() => order.push(2))
    scope.track(() => order.push(3))
    scope.dispose()
    expect(order).toEqual([3, 2, 1])
  })

  it('disposes children recursively', () => {
    const root = new Scope()
    const child = root.child()
    const grandchild = child.child()
    const fn = vi.fn()
    grandchild.track(fn)
    root.dispose()
    expect(fn).toHaveBeenCalledOnce()
  })

  it('removes itself from parent on dispose', () => {
    const parent = new Scope()
    const child = parent.child()
    child.dispose()
    // After child disposes, disposing parent should not error
    // and child cleanup should not run again
    const fn = vi.fn()
    child.track(fn)
    parent.dispose()
    // fn was added after child disposed, parent no longer tracks child
    expect(fn).not.toHaveBeenCalled()
  })

  it('does not throw when cleanup function throws', () => {
    const scope = new Scope()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const goodFn = vi.fn()
    scope.track(goodFn)
    scope.track(() => { throw new Error('fail') })
    expect(() => scope.dispose()).not.toThrow()
    expect(goodFn).toHaveBeenCalledOnce()
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })
})
