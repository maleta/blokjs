import { describe, it, expect, vi } from 'vitest'
import { wrapAsync, type AsyncTrackingTarget } from '../src/async-tracking'

function makeTarget(): AsyncTrackingTarget {
  return {
    loadingData: {},
    loadingProxy: {},
    errorData: {},
    errorProxy: {},
  }
}

describe('wrapAsync', () => {
  it('is a no-op for non-promise results', () => {
    const target = makeTarget()
    const counts = new Map<string, number>()
    wrapAsync(target, counts, 'fetch', 42)
    expect(target.loadingProxy.fetch).toBeUndefined()
    expect(counts.size).toBe(0)
  })

  it('is a no-op for null/undefined results', () => {
    const target = makeTarget()
    const counts = new Map<string, number>()
    wrapAsync(target, counts, 'fetch', null)
    wrapAsync(target, counts, 'fetch', undefined)
    expect(counts.size).toBe(0)
  })

  it('sets loading to true when a promise starts', () => {
    const target = makeTarget()
    const counts = new Map<string, number>()
    const promise = new Promise(() => {}) // never resolves
    wrapAsync(target, counts, 'load', promise)
    expect(target.loadingProxy.load).toBe(true)
    expect(target.errorProxy.load).toBeNull()
  })

  it('sets loading to false when promise resolves', async () => {
    const target = makeTarget()
    const counts = new Map<string, number>()
    const promise = Promise.resolve('ok')
    wrapAsync(target, counts, 'load', promise)
    await promise
    // Let microtask run
    await new Promise(r => setTimeout(r, 0))
    expect(target.loadingProxy.load).toBe(false)
  })

  it('sets error when promise rejects', async () => {
    const target = makeTarget()
    const counts = new Map<string, number>()
    const err = new Error('fail')
    const promise = Promise.reject(err)
    wrapAsync(target, counts, 'load', promise)
    await promise.catch(() => {})
    await new Promise(r => setTimeout(r, 0))
    expect(target.loadingProxy.load).toBe(false)
    expect(target.errorProxy.load).toBe(err)
  })

  it('handles concurrent calls with count-based tracking', async () => {
    const target = makeTarget()
    const counts = new Map<string, number>()

    let resolve1!: () => void
    let resolve2!: () => void
    const p1 = new Promise<void>(r => { resolve1 = r })
    const p2 = new Promise<void>(r => { resolve2 = r })

    wrapAsync(target, counts, 'load', p1)
    wrapAsync(target, counts, 'load', p2)

    expect(counts.get('load')).toBe(2)
    expect(target.loadingProxy.load).toBe(true)

    // Resolve first - should still be loading (count=1)
    resolve1()
    await p1
    await new Promise(r => setTimeout(r, 0))
    expect(target.loadingProxy.load).toBe(true)

    // Resolve second - now loading should be false (count=0)
    resolve2()
    await p2
    await new Promise(r => setTimeout(r, 0))
    expect(target.loadingProxy.load).toBe(false)
  })
})
