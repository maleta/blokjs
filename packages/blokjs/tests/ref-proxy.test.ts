import { describe, it, expect } from 'vitest'
import { REF, createRef, isRef } from '../src/ref-proxy'

describe('createRef', () => {
  it('exposes path and negate behind the REF symbol', () => {
    const ref = createRef()
    expect(ref[REF]).toEqual({ path: [], negate: false })
  })

  it('starts with empty path', () => {
    const ref = createRef()
    expect(ref[REF].path).toEqual([])
  })

  it('builds path via property access', () => {
    const ref = createRef()
    const nested = ref.user.name
    expect(nested[REF].path).toEqual(['user', 'name'])
  })

  it('preserves REF marker on nested access', () => {
    const ref = createRef()
    expect(isRef(ref.foo.bar)).toBe(true)
  })

  it('treats path and negate as ordinary path segments', () => {
    const ref = createRef()
    expect(ref.path[REF].path).toEqual(['path'])
    expect(ref.item.path[REF].path).toEqual(['item', 'path'])
    expect(ref.item.negate[REF].path).toEqual(['item', 'negate'])
  })

  it('starts with negate false', () => {
    const ref = createRef()
    expect(ref[REF].negate).toBe(false)
  })

  it('supports .not for negation', () => {
    const ref = createRef()
    const negated = ref.not
    expect(negated[REF].negate).toBe(true)
    expect(negated[REF].path).toEqual([])
  })

  it('builds path after .not', () => {
    const ref = createRef()
    const neg = ref.not.visible
    expect(neg[REF].negate).toBe(true)
    expect(neg[REF].path).toEqual(['visible'])
  })

  it('.not only works at root level with no path', () => {
    const ref = createRef()
    // Accessing .not on a ref that already has a path treats "not" as a path segment
    const deep = ref.foo.not
    expect(deep[REF].path).toEqual(['foo', 'not'])
    expect(deep[REF].negate).toBe(false)
  })
})

describe('isRef', () => {
  it('returns true for refs', () => {
    expect(isRef(createRef())).toBe(true)
  })

  it('returns false for null', () => {
    expect(isRef(null)).toBe(false)
  })

  it('returns false for plain objects', () => {
    expect(isRef({ path: [] })).toBe(false)
    expect(isRef({ [REF]: true })).toBe(false)
  })

  it('returns false for primitives', () => {
    expect(isRef(42)).toBe(false)
    expect(isRef('str')).toBe(false)
  })
})
