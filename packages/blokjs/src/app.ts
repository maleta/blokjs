import { createApp, type App, type ComponentDef, type MountOptions } from './component'
import { createStoreInstance, createStoreProxy, type StoreDef, type StoreInstance } from './store'
import { validateComponentDef, validateStoreDef } from './validate'

const globalRegistry = new Map<string, ComponentDef>()
const globalStoreDefs = new Map<string, StoreDef>()
const globalStores = new Map<string, StoreInstance>()
let globalStoreProxy: any = null

export function component(name: string, def: ComponentDef): void {
  validateComponentDef(name, def)
  globalRegistry.set(name, def)
}

export function store(name: string, def: StoreDef): void {
  validateStoreDef(name, def)
  if (globalStores.has(name)) {
    console.warn(`[blok] Store "${name}" already registered. Skipping.`)
    return
  }
  globalStoreDefs.set(name, def)
  globalStores.set(name, createStoreInstance(name, def))
  globalStoreProxy = createStoreProxy(globalStores)
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
