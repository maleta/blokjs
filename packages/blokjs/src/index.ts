import { createInstance, type MountOptions } from './component'
import { mountRoot } from './renderer'
import { createRouter } from './router'
import { untracked } from './reactive'
import { validateMountOptions, validate } from './validate'
import { component, store, createMountApp, rootDef } from './app'

export { component, store, validate }
export type { ComponentDef, MountOptions } from './component'
export type { StoreDef } from './store'

const SSR_ATTR = 'data-blok-ssr'
let routerOwner: { destroy: () => void } | null = null

export function mount(target: string | HTMLElement, opts: MountOptions): { destroy: () => void } {
  validateMountOptions(opts as Record<string, any>)

  const app = createMountApp(!!opts.isolated)

  // Resolve target element
  const el = typeof target === 'string' ? document.querySelector(target) : target
  if (!el || !(el instanceof HTMLElement)) {
    throw new Error(`[blok] Target element not found: ${target}`)
  }

  // Router is a singleton - only one mount can own it
  if (opts.routes && routerOwner) {
    throw new Error('[blok] Router already active. Only one mount can declare routes.')
  }

  const def = rootDef(opts)
  const createRoot = () => {
    const inst = createInstance(def, app, null, {})
    app.root = inst
    return inst
  }

  // Guards run while the router resolves the initial route, so the root context must exist first
  let inst = createRoot()
  if (opts.routes) {
    app.router = createRouter(app, opts.routes, opts.guards || {}, opts.mode)
  }

  if (el.hasAttribute(SSR_ATTR)) {
    el.removeAttribute(SSR_ATTR)
    if (!mountRoot(el, inst, true)) {
      el.textContent = ''
      inst = createRoot()
      mountRoot(el, inst)
    }
  } else {
    mountRoot(el, inst)
  }

  const handle = {
    destroy() {
      inst.destroyed = true
      inst.scope.dispose()
      if (inst.mounted && inst.def.unmount) {
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
