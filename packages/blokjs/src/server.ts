import { createInstance, type MountOptions } from './component'
import { component, store, createMountApp, rootDef } from './app'
import { mountRoot, setRenderDocument, type NodeFactory } from './renderer'
import { createServerRouter } from './router'
import { validateMountOptions, validate } from './validate'
import { createStringDocument, serializeChildren } from './string-dom'
import type { WatchOptions } from './reactive'

export { component, store, validate }
export type { ComponentDef, MountOptions, WatchEntry } from './component'
export type { Store, StoreDef } from './store'
export type { WatchOptions } from './reactive'

/** Server rendering never reacts to changes: the watch is not set up and `stop()` does nothing. */
export function watch<T>(
  _getter: () => T,
  _callback: (newValue: T, oldValue: T | undefined) => void,
  _options: WatchOptions = {},
): () => void {
  return () => {}
}

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
