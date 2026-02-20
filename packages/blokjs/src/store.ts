import { createProxy } from './reactive'
import { wrapAsync } from './async-tracking'

export interface StoreDef {
  state?: Record<string, any>
  computed?: Record<string, (this: any) => any>
  methods?: Record<string, (this: any, ...args: any[]) => any>
}

export interface StoreInstance {
  name: string
  stateData: Record<string, any>
  stateProxy: any
  loadingData: Record<string, boolean>
  loadingProxy: any
  errorData: Record<string, any>
  errorProxy: any
  proxy: any
}

export function createStoreInstance(name: string, def: StoreDef): StoreInstance {
  let stateData: Record<string, any>
  try {
    stateData = structuredClone(def.state || {})
  } catch {
    console.warn('[blok] State contains non-cloneable values, falling back to shallow copy')
    stateData = { ...(def.state || {}) }
  }
  const stateProxy = createProxy(stateData)

  const loadingData: Record<string, boolean> = {}
  const errorData: Record<string, any> = {}
  const loadingProxy = createProxy(loadingData)
  const errorProxy = createProxy(errorData)

  const asyncCounts = new Map<string, number>()

  const proxy: any = new Proxy({} as any, {
    get(_, key) {
      if (typeof key === 'symbol') return undefined
      const k = key as string

      if (k === 'loading') return loadingProxy
      if (k === 'error') return errorProxy

      if (def.methods && k in def.methods) {
        const fn = def.methods[k]
        return (...args: any[]) => {
          const result = fn.apply(proxy, args)
          wrapAsync({ loadingData, loadingProxy, errorData, errorProxy }, asyncCounts, k, result)
          return result
        }
      }

      if (def.computed && k in def.computed) {
        return def.computed[k].call(proxy)
      }

      return stateProxy[k]
    },
    set(_, key, val) {
      if (typeof key === 'symbol') return true
      const k = key as string
      if ((def.methods && k in def.methods) || (def.computed && k in def.computed)) {
        console.warn(`[blok] Cannot write to ${def.computed && k in def.computed ? 'computed' : 'method'} "${k}" on store`)
        return true
      }
      stateProxy[k] = val
      return true
    },
  })

  return { name, stateData, stateProxy, loadingData, loadingProxy, errorData, errorProxy, proxy }
}

export function createStoreProxy(stores: Map<string, StoreInstance>): any {
  return new Proxy({} as any, {
    get(_, key) {
      if (typeof key === 'symbol') return undefined
      return stores.get(key as string)?.proxy
    },
    set() {
      return true
    },
  })
}
