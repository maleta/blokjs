import { createApp, type App, type ComponentDef, type MountOptions } from './component'
import { createStoreInstance, createStoreProxy, type Store, type StoreDef, type StoreInstance } from './store'
import { createWatcher, type WatchOptions } from './reactive'
import { Scope } from './scope'
import { validateComponentDef, validateStoreDef } from './validate'

const globalRegistry = new Map<string, ComponentDef>()
const globalStoreDefs = new Map<string, StoreDef>()
const globalStores = new Map<string, StoreInstance>()
let globalStoreProxy: any = null

export function component(name: string, def: ComponentDef): void {
  validateComponentDef(name, def)
  globalRegistry.set(name, def)
}

/**
 * Register a global store, or look one up when called with a name only.
 * @returns the store that shared mounts see as `this.store[name]`. A duplicate registration
 *   warns and returns the existing store; a lookup of an unknown name returns `undefined`.
 */
export function store(name: string): Store | undefined
export function store(name: string, def: StoreDef): Store
export function store(name: string, def?: StoreDef): Store | undefined {
  if (!def) return globalStores.get(name)?.proxy
  validateStoreDef(name, def)
  const existing = globalStores.get(name)
  if (existing) {
    console.warn(`[blok] Store "${name}" already registered. Skipping.`)
    return existing.proxy
  }
  const inst = createStoreInstance(name, def)
  globalStoreDefs.set(name, def)
  globalStores.set(name, inst)
  globalStoreProxy = createStoreProxy(globalStores)
  return inst.proxy
}

/**
 * Call `callback(newValue, oldValue)` whenever the value returned by `getter` changes.
 * The getter is tracked like a computed; callbacks run in the same microtask batch as other effects.
 * Isolated mounts have their own store copies, which a watch on `blok.store(name)` does not see.
 * @returns `stop()`, which ends the watch
 */
export function watch<T>(
  getter: () => T,
  callback: (newValue: T, oldValue: T | undefined) => void,
  options: WatchOptions = {},
): () => void {
  const scope = new Scope()
  createWatcher(getter, callback, options, scope)
  return () => scope.dispose()
}

/** App for one mount: shares the global registry and stores, or copies them when `isolated`. */
export function createMountApp(isolated: boolean): App {
  const app = createApp()

  if (isolated) {
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

  return app
}

/** Root component definition taken from mount options. */
export function rootDef(opts: MountOptions): ComponentDef {
  return {
    state: opts.state,
    computed: opts.computed,
    watch: opts.watch,
    methods: opts.methods,
    mount: opts.mount,
    unmount: opts.unmount,
    view: opts.view,
  }
}
