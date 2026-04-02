import { createApp, createInstance, type ComponentDef, type MountOptions, type App } from './component'
import { mountRoot } from './renderer'
import { createRouter } from './router'
import { createStoreInstance, createStoreProxy, type StoreDef, type StoreInstance } from './store'
import { untracked } from './reactive'
import { validateComponentDef, validateMountOptions, validateStoreDef, validate } from './validate'

export { validate }
export type { ComponentDef, MountOptions } from './component'
export type { StoreDef } from './store'

declare const __DEV__: boolean

const globalRegistry = new Map<string, ComponentDef>()
const globalStoreDefs = new Map<string, StoreDef>()
const globalStores = new Map<string, StoreInstance>()
let globalStoreProxy: any = null
let routerOwner: { destroy: () => void } | null = null

export function component(name: string, def: ComponentDef): void {
  if (__DEV__) validateComponentDef(name, def)
  globalRegistry.set(name, def)
}

export function store(name: string, def: StoreDef): void {
  if (__DEV__) validateStoreDef(name, def)
  if (globalStores.has(name)) {
    console.warn(`[blok] Store "${name}" already registered. Skipping.`)
    return
  }
  globalStoreDefs.set(name, def)
  globalStores.set(name, createStoreInstance(name, def))
  globalStoreProxy = createStoreProxy(globalStores)
}

export function mount(target: string | HTMLElement, opts: MountOptions): { destroy: () => void } {
  if (__DEV__) validateMountOptions(opts as Record<string, any>)

  const app = createApp()

  if (opts.isolated) {
    // Isolated: own component registry (copy), own store instances
    for (const [name, def] of globalRegistry) app.registry.set(name, def)
    for (const [name] of globalStores) {
      const storeDef = globalStoreDefs.get(name)
      if (storeDef) app.stores.set(name, createStoreInstance(name, storeDef))
    }
    app.storeProxy = createStoreProxy(app.stores)
  } else {
    // Shared: global registry and stores by reference
    app.registry = globalRegistry
    app.stores = globalStores
    app.storeProxy = globalStoreProxy ?? createStoreProxy(globalStores)
  }

  // Resolve target element
  const el = typeof target === 'string' ? document.querySelector(target) : target
  if (!el || !(el instanceof HTMLElement)) {
    throw new Error(`[blok] Target element not found: ${target}`)
  }

  // Setup router (singleton - only one mount can own it)
  if (opts.routes) {
    if (routerOwner) {
      throw new Error('[blok] Router already active. Only one mount can declare routes.')
    }
    app.router = createRouter(app, opts.routes, opts.guards || {}, opts.mode)
  }

  // Create root instance
  const rootDef: ComponentDef = {
    state: opts.state,
    computed: opts.computed,
    watch: opts.watch,
    methods: opts.methods,
    mount: opts.mount,
    unmount: opts.unmount,
    view: opts.view,
  }

  const inst = createInstance(rootDef, app, null, {})
  app.root = inst

  // Mount
  mountRoot(el, inst)

  const handle = {
    destroy() {
      inst.destroyed = true
      inst.scope.dispose()
      if (inst.def.unmount) {
        untracked(() => inst.def.unmount!.call(inst.context))
      }
      if (app.router) {
        app.router.destroy()
        if (routerOwner === handle) routerOwner = null
      }
      el.innerHTML = ''
    },
  }

  if (opts.routes) routerOwner = handle

  return handle
}
