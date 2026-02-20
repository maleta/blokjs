import { describe, it, expect } from 'vitest'
import { REF, createRef, isRef } from '../src/ref-proxy'

describe('createRef', () => {
  it('returns an object with REF symbol set to true', () => {
    const ref = createRef()
    expect(ref[REF]).toBe(true)
  })

  it('starts with empty path', () => {
    const ref = createRef()
    expect(ref.path).toEqual([])
  })

  it('builds path via property access', () => {
    const ref = createRef()
    const nested = ref.user.name
    expect(nested.path).toEqual(['user', 'name'])
  })

  it('preserves REF marker on nested access', () => {
    const ref = createRef()
    expect(ref.foo.bar[REF]).toBe(true)
  })

  it('starts with negate false', () => {
    const ref = createRef()
    expect(ref.negate).toBe(false)
  })

  it('supports .not for negation', () => {
    const ref = createRef()
    const negated = ref.not
    expect(negated.negate).toBe(true)
    expect(negated.path).toEqual([])
  })

  it('builds path after .not', () => {
    const ref = createRef()
    const neg = ref.not.visible
    expect(neg.negate).toBe(true)
    expect(neg.path).toEqual(['visible'])
  })

  it('.not only works at root level with no path', () => {
    const ref = createRef()
    // Accessing .not on a ref that already has a path treats "not" as a path segment
    const deep = ref.foo.not
    expect(deep.path).toEqual(['foo', 'not'])
    expect(deep.negate).toBe(false)
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
  })

  it('returns false for primitives', () => {
    expect(isRef(42)).toBe(false)
    expect(isRef('str')).toBe(false)
  })
})
