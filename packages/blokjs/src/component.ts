import { BlokRef, isRef } from './ref-proxy'
import { createProxy, setByPath, untracked, createEffect } from './reactive'
import { Scope } from './scope'
import { wrapAsync } from './async-tracking'
import type { StoreInstance } from './store'

export interface ComponentDef {
  props?: string[]
  state?: Record<string, any>
  computed?: Record<string, (this: any) => any>
  watch?: Record<string, (this: any, newVal: any, oldVal: any) => void>
  methods?: Record<string, (this: any, ...args: any[]) => any>
  mount?: (this: any) => void
  unmount?: (this: any) => void
  view: ($: any) => any
}

export interface MountOptions extends ComponentDef {
  routes?: RouteConfig[]
  guards?: Record<string, (this: any, to: any, from: any) => string | boolean>
  mode?: 'hash' | 'history' | 'auto'
}

export interface RouteConfig {
  path: string
  component: string
  guard?: string
}

export interface SharedProp {
  ref: BlokRef
  owner: ComponentInstance
}

export interface App {
  registry: Map<string, ComponentDef>
  stores: Map<string, StoreInstance>
  storeProxy: any
  routeData: Record<string, any>
  routeProxy: any
  root: ComponentInstance | null
  router: Router | null
}

export interface Router {
  current: any // reactive proxy to routeData
  routes: RouteConfig[]
  guards: Record<string, (to: any, from: any) => string | boolean>
  navigate(to: string | number): void
  match(path: string): { config: RouteConfig; params: Record<string, string> } | null
  destroy(): void
}

export interface ComponentInstance {
  def: ComponentDef
  app: App
  stateData: Record<string, any>
  stateProxy: any
  loadingData: Record<string, boolean>
  loadingProxy: any
  errorData: Record<string, any>
  errorProxy: any
  sharedProps: Map<string, SharedProp>
  staticProps: Map<string, any>
  computedDefs: Record<string, (this: any) => any>
  context: any
  el: HTMLElement | null
  refs: Record<string, HTMLElement>
  scope: Scope
  parent: ComponentInstance | null
  children: ComponentInstance[]
  eventHandlers: Map<string, (payload: any) => void>
  destroyed: boolean
  template: any
  _slotChildren?: any[]
}

export function createApp(): App {
  const routeData = { path: '/', params: {}, query: {} }
  return {
    registry: new Map(),
    stores: new Map(),
    storeProxy: null,
    routeData,
    routeProxy: createProxy(routeData),
    root: null,
    router: null,
  }
}

export function createInstance(
  def: ComponentDef,
  app: App,
  parent: ComponentInstance | null,
  propBindings: Record<string, any>,
): ComponentInstance {
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

  const inst: ComponentInstance = {
    def,
    app,
    stateData,
    stateProxy,
    loadingData,
    loadingProxy,
    errorData,
    errorProxy,
    sharedProps: new Map(),
    staticProps: new Map(),
    computedDefs: def.computed || {},
    context: null!,
    el: null,
    refs: {},
    scope: new Scope(),
    parent,
    children: [],
    eventHandlers: new Map(),
    destroyed: false,
    template: null,
  }

  // Process prop bindings
  for (const [key, val] of Object.entries(propBindings)) {
    if (isRef(val) && parent) {
      inst.sharedProps.set(key, { ref: val, owner: parent })
    } else {
      inst.staticProps.set(key, val)
    }
  }

  // Build context (the `this` for methods/lifecycle)
  inst.context = createContext(inst)

  return inst
}

export const RESERVED_CONTEXT_KEYS: Record<string, 1> = { store: 1, loading: 1, error: 1, refs: 1, el: 1, route: 1, emit: 1, navigate: 1 }

function createContext(inst: ComponentInstance): any {
  const asyncCounts = new Map<string, number>()

  return new Proxy({} as any, {
    get(_, key) {
      if (typeof key === 'symbol') return undefined
      const k = key as string

      // Special properties
      if (k === 'store') return inst.app.storeProxy
      if (k === 'loading') return inst.loadingProxy
      if (k === 'error') return inst.errorProxy
      if (k === 'refs') return inst.refs
      if (k === 'el') return inst.el
      if (k === 'route') return inst.app.routeProxy
      if (k === 'emit') return (event: string, payload?: any) => emitEvent(inst, event, payload)
      if (k === 'navigate') return (to: string | number) => inst.app.router?.navigate(to)

      // Methods - wrap for async loading/error tracking
      if (inst.def.methods && k in inst.def.methods) {
        const fn = inst.def.methods[k]
        return (...args: any[]) => {
          const result = fn.apply(inst.context, args)
          wrapAsync(inst, asyncCounts, k, result)
          return result
        }
      }

      // Computed
      if (k in inst.computedDefs) {
        return evalComputed(inst, k)
      }

      // Shared props
      if (inst.sharedProps.has(k)) {
        const sp = inst.sharedProps.get(k)!
        return resolveOnInstance(sp.owner, sp.ref.path)
      }

      // Static props
      if (inst.staticProps.has(k)) {
        return inst.staticProps.get(k)
      }

      // State (via proxy for reactivity)
      if (k in inst.stateData) {
        return inst.stateProxy[k]
      }

      return undefined
    },

    set(_, key, val) {
      if (typeof key === 'symbol') return true
      const k = key as string

      if (k in RESERVED_CONTEXT_KEYS) {
        console.warn(`[blok] Cannot set reserved property "${k}"`)
        return true
      }

      if (k in inst.computedDefs) {
        console.warn(`[blok] Cannot set computed property "${k}"`)
        return true
      }

      // Shared props: write to owner
      if (inst.sharedProps.has(k)) {
        const sp = inst.sharedProps.get(k)!
        setOnInstance(sp.owner, sp.ref.path, val)
        return true
      }

      // State
      inst.stateProxy[k] = val
      return true
    },
  })
}

export function evalComputed(inst: ComponentInstance, key: string): any {
  const fn = inst.computedDefs[key]
  if (!fn) return undefined
  return fn.call(inst.context)
}

function emitEvent(inst: ComponentInstance, event: string, payload: any): void {
  const handler = inst.eventHandlers.get(event)
  if (handler) handler(payload)
}

/** Resolve a value by walking the instance's state/props/computed/store chain */
export function resolveOnInstance(inst: ComponentInstance, path: string[]): any {
  if (path.length === 0) return undefined
  const root = path[0]
  let val: any

  // Store — read through proxy for dep tracking
  if (root === 'store' && inst.app.storeProxy) {
    val = inst.app.storeProxy
    for (let i = 1; i < path.length; i++) {
      if (val == null) return undefined
      val = val[path[i]]
    }
    return val
  }

  // Route — read through proxy for dep tracking
  if (root === 'route' && inst.app.routeProxy) {
    val = inst.app.routeProxy
    for (let i = 1; i < path.length; i++) {
      if (val == null) return undefined
      val = val[path[i]]
    }
    return val
  }

  // Loading / Error
  if (root === 'loading') {
    val = inst.loadingProxy
    for (let i = 1; i < path.length; i++) {
      if (val == null) return undefined
      val = val[path[i]]
    }
    return val
  }
  if (root === 'error') {
    val = inst.errorProxy
    for (let i = 1; i < path.length; i++) {
      if (val == null) return undefined
      val = val[path[i]]
    }
    return val
  }

  // Computed
  if (root in inst.computedDefs) {
    val = evalComputed(inst, root)
    for (let i = 1; i < path.length; i++) {
      if (val == null) return undefined
      val = val[path[i]]
    }
    return val
  }

  // Shared props
  if (inst.sharedProps.has(root)) {
    const sp = inst.sharedProps.get(root)!
    val = resolveOnInstance(sp.owner, sp.ref.path)
    for (let i = 1; i < path.length; i++) {
      if (val == null) return undefined
      val = val[path[i]]
    }
    return val
  }

  // Static props
  if (inst.staticProps.has(root)) {
    val = inst.staticProps.get(root)
    for (let i = 1; i < path.length; i++) {
      if (val == null) return undefined
      val = val[path[i]]
    }
    return val
  }

  // State — use proxy for dep tracking
  val = inst.stateProxy
  for (const k of path) {
    if (val == null) return undefined
    val = val[k]
  }
  return val
}

export function setOnInstance(inst: ComponentInstance, path: string[], value: any): void {
  if (path.length === 0) return
  const root = path[0]

  // Store
  if (root === 'store' && inst.app.storeProxy) {
    setByPath(inst.app.storeProxy, path.slice(1), value)
    return
  }

  // Shared props: delegate to owner
  if (inst.sharedProps.has(root)) {
    const sp = inst.sharedProps.get(root)!
    if (path.length === 1) {
      setOnInstance(sp.owner, sp.ref.path, value)
    } else {
      const fullPath = [...sp.ref.path, ...path.slice(1)]
      setOnInstance(sp.owner, fullPath, value)
    }
    return
  }

  // Computed: resolve the computed, then write to sub-path on the returned object
  if (root in inst.computedDefs && path.length > 1) {
    const obj = evalComputed(inst, root)
    if (obj != null && typeof obj === 'object') {
      let target = obj
      for (let i = 1; i < path.length - 1; i++) {
        if (target == null) return
        target = target[path[i]]
      }
      if (target != null) {
        target[path[path.length - 1]] = value
      }
    }
    return
  }

  // State
  if (path.length === 1) {
    inst.stateProxy[root] = value
  } else {
    setByPath(inst.stateProxy, path, value)
  }
}

export function setupWatchers(inst: ComponentInstance): void {
  if (!inst.def.watch) return
  for (const [key, fn] of Object.entries(inst.def.watch)) {
    let oldVal = untracked(() => resolveOnInstance(inst, [key]))

    createEffect(() => {
      const newVal = resolveOnInstance(inst, [key])
      if (newVal !== oldVal) {
        const prev = oldVal
        oldVal = newVal
        fn.call(inst.context, newVal, prev)
      }
    }, inst.scope)
  }
}
