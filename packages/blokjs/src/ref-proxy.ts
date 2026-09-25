export const REF = Symbol.for('blokjs-ref')

export interface RefInfo {
  readonly path: string[]
  readonly negate: boolean
}

/** View accessor. Metadata sits behind REF only, so every string key stays free for user data. */
export interface BlokRef {
  readonly [REF]: RefInfo
}

export function isRef(v: unknown): v is BlokRef {
  const info = v != null && typeof v === 'object' ? (v as any)[REF] : null
  return info != null && Array.isArray(info.path)
}

/** `$.save` is the accessor form of the handler string 'save'; other values pass through. */
export function handlerName(handler: unknown): unknown {
  return isRef(handler) ? handler[REF].path.join('.') : handler
}

export function createRef(path: string[] = [], negate = false): any {
  const info: RefInfo = { path, negate }
  return new Proxy(info as any, {
    get(_, p) {
      if (p === REF) return info
      if (typeof p === 'symbol') return undefined
      const key = String(p)
      if (key === 'not' && path.length === 0 && !negate) return createRef([], true)
      return createRef([...path, key], negate)
    },
  })
}
