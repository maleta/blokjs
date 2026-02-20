export const REF = Symbol.for('blokjs-ref')

export interface BlokRef {
  readonly [REF]: true
  readonly path: string[]
  readonly negate: boolean
}

export function isRef(v: unknown): v is BlokRef {
  return v != null && typeof v === 'object' && (v as any)[REF] === true
}

export function createRef(path: string[] = [], negate = false): any {
  return new Proxy({ [REF]: true, path, negate } as any, {
    get(t, p) {
      if (p === REF) return true
      if (p === 'path') return t.path
      if (p === 'negate') return t.negate
      if (typeof p === 'symbol') return undefined
      const key = String(p)
      if (key === 'not' && path.length === 0 && !negate) return createRef([], true)
      return createRef([...path, key], negate)
    },
  })
}
