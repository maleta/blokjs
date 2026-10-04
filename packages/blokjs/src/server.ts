import { createInstance, type MountOptions } from './component'
import { component, store, createMountApp, rootDef } from './app'
import { mountRoot, setRenderDocument, type NodeFactory } from './renderer'
import { createServerRouter } from './router'
import { validateMountOptions, validate } from './validate'
import { createStringDocument, serializeChildren } from './string-dom'

export { component, store, validate }
export type { ComponentDef, MountOptions } from './component'
export type { StoreDef } from './store'

export interface RenderOptions {
  /** Path, with optional query, that the router renders. Default `/`. */
  url?: string
}

/**
 * Render mount options to HTML without a browser, using the same renderer as `mount()`.
 * Components and stores must be registered through this module's `component`/`store`.
 * Every call gets fresh store instances; `mount`/`unmount` hooks and route guards never run.
 * @param opts - the options that `mount()` receives in the browser
 * @returns inner HTML for the mount node. Give that node the `data-blok-ssr` attribute so
 *   `mount()` adopts the HTML instead of rendering it again.
 */
export function renderToString(opts: MountOptions, options: RenderOptions = {}): string {
  validateMountOptions(opts as Record<string, any>)

  const app = createMountApp(true)
  const inst = createInstance(rootDef(opts), app, null, {})
  app.root = inst

  if (opts.routes) {
    const url = options.url ?? '/'
    app.router = createServerRouter(app, opts.routes, opts.guards || {}, url)
    const guard = app.router.match(app.routeData.path)?.config.guard
    if (guard) console.warn(`[blok] Route "${url}" has guard "${guard}", which does not run during server rendering.`)
  }

  const doc = createStringDocument()
  const target = doc.createElement('div')
  setRenderDocument(doc as unknown as NodeFactory)
  try {
    mountRoot(target as unknown as HTMLElement, inst)
    return serializeChildren(target)
  } finally {
    setRenderDocument(null)
    inst.destroyed = true
    inst.scope.dispose()
  }
}
