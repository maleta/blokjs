import { createApp, createInstance, type ComponentDef, type MountOptions, type App } from './component'
import { mountRoot } from './renderer'
import { createRouter } from './router'
import { createStoreInstance, createStoreProxy, type StoreDef } from './store'
import { untracked } from './reactive'
import { validateComponentDef, validateMountOptions, validateStoreDef, validate } from './validate'

export { validate }
export type { ComponentDef, MountOptions } from './component'
export type { StoreDef } from './store'

declare const __DEV__: boolean

let currentApp: App | null = null

function ensureApp(): App {
  if (!currentApp) currentApp = createApp()
  return currentApp
}

export function component(name: string, def: ComponentDef): void {
  if (__DEV__) validateComponentDef(name, def)
  const app = ensureApp()
  app.registry.set(name, def)
}

export function store(name: string, def: StoreDef): void {
  if (__DEV__) validateStoreDef(name, def)
  const app = ensureApp()
  app.stores.set(name, createStoreInstance(name, def))
}

export function mount(target: string | HTMLElement, opts: MountOptions): { destroy: () => void } {
  if (__DEV__) validateMountOptions(opts as Record<string, any>)
  if (currentApp?.root) {
    throw new Error('[blok] Already mounted. Call destroy() before mounting again.')
  }
  const app = ensureApp()

  // Resolve target element
  const el = typeof target === 'string' ? document.querySelector(target) : target
  if (!el || !(el instanceof HTMLElement)) {
    throw new Error(`[blok] Target element not found: ${target}`)
  }

  // Setup store
  app.storeProxy = createStoreProxy(app.stores)

  // Setup router
  if (opts.routes) {
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

  return {
    destroy() {
      inst.destroyed = true
      inst.scope.dispose()
      if (inst.def.unmount) {
        untracked(() => inst.def.unmount!.call(inst.context))
      }
      app.router?.destroy()
      el.innerHTML = ''
      currentApp = null
    },
  }
}
