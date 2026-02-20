import type { App, Router, RouteConfig } from './component'

interface ParsedRoute {
  pattern: RegExp
  paramNames: string[]
  config: RouteConfig
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function parseRoutes(routes: RouteConfig[]): ParsedRoute[] {
  return routes.map(r => {
    const paramNames: string[] = []
    if (r.path === '*') return { pattern: /.*/, paramNames, config: r }

    // Split on :param segments, escape the static parts
    const parts = r.path.split(/:(\w+)/)
    let re = '^'
    for (let i = 0; i < parts.length; i++) {
      if (i % 2 === 0) {
        re += escapeRegex(parts[i])
      } else {
        paramNames.push(parts[i])
        re += '([^/]+)'
      }
    }
    re += '$'
    return { pattern: new RegExp(re), paramNames, config: r }
  })
}

function parseQuery(search: string): Record<string, string> {
  const q: Record<string, string> = {}
  const params = new URLSearchParams(search)
  params.forEach((v, k) => { q[k] = v })
  return q
}

function splitFullPath(fullPath: string): { path: string; search: string } {
  const idx = fullPath.indexOf('?')
  if (idx === -1) return { path: fullPath, search: '' }
  return { path: fullPath.slice(0, idx), search: fullPath.slice(idx + 1) }
}

export function matchRoute(
  parsed: ParsedRoute[],
  path: string,
): { config: RouteConfig; params: Record<string, string> } | null {
  for (const r of parsed) {
    const m = path.match(r.pattern)
    if (m) {
      const params: Record<string, string> = {}
      r.paramNames.forEach((name, i) => {
        try { params[name] = decodeURIComponent(m[i + 1]) }
        catch { params[name] = m[i + 1] }
      })
      return { config: r.config, params }
    }
  }
  return null
}

export function createRouter(
  app: App,
  routes: RouteConfig[],
  guards: Record<string, (to: any, from: any) => string | boolean>,
  mode: 'hash' | 'history' | 'auto' = 'auto',
): Router {
  const parsed = parseRoutes(routes)

  // auto: file:// → hash, otherwise history
  const useHash = mode === 'hash' || (mode === 'auto' && location.protocol === 'file:')

  // Flag to skip guard re-check in hashchange when triggered by programmatic navigate
  let skipNextHashChange = false
  const MAX_REDIRECTS = 10

  function currentFullPath(): string {
    const q = Object.keys(app.routeData.query).length > 0
      ? '?' + new URLSearchParams(app.routeData.query as Record<string, string>).toString()
      : ''
    return app.routeData.path + q
  }

  function updateCurrent(fullPath: string): void {
    const { path, search } = splitFullPath(fullPath)
    const match = matchRoute(parsed, path)

    app.routeProxy.path = path
    app.routeProxy.params = match?.params ?? {}
    app.routeProxy.query = parseQuery(search)
  }

  function runGuard(
    match: { config: RouteConfig; params: Record<string, string> },
    to: { path: string; params: Record<string, string>; query: Record<string, string> },
    from: { path: string; params: Record<string, string>; query: Record<string, string> },
  ): true | false | string {
    if (!match.config.guard || !guards[match.config.guard]) return true
    const result = guards[match.config.guard].call(app.root?.context, to, from)
    if (result === false) return false
    if (typeof result === 'string') return result
    return true
  }

  function checkGuardsAndUpdate(fullPath: string, depth = 0): void {
    const { path, search } = splitFullPath(fullPath)
    const query = parseQuery(search)
    const match = matchRoute(parsed, path)
    if (!match) {
      updateCurrent(fullPath)
      return
    }

    const from = { path: app.routeData.path, params: { ...app.routeData.params }, query: { ...app.routeData.query } }
    const guardResult = runGuard(match, { path, params: match.params, query }, from)

    if (guardResult === false) {
      const prev = currentFullPath()
      if (useHash) {
        history.replaceState(null, '', '#' + prev)
      } else {
        history.replaceState(null, '', prev)
      }
      return
    }
    if (typeof guardResult === 'string') {
      if (depth >= MAX_REDIRECTS) {
        console.warn('[blok] Too many guard redirects, aborting navigation')
        return
      }
      navigateInternal(guardResult, depth + 1)
      return
    }

    updateCurrent(fullPath)
  }

  function navigateInternal(to: string, depth = 0): void {
    const { path, search } = splitFullPath(to)
    const query = parseQuery(search)
    const from = { path: app.routeData.path, params: { ...app.routeData.params }, query: { ...app.routeData.query } }
    const match = matchRoute(parsed, path)
    if (!match) {
      console.warn('[blok] No route matched:', to)
      return
    }

    const guardResult = runGuard(match, { path, params: match.params, query }, from)
    if (guardResult === false) return
    if (typeof guardResult === 'string') {
      if (depth >= MAX_REDIRECTS) {
        console.warn('[blok] Too many guard redirects, aborting navigation')
        return
      }
      navigateInternal(guardResult, depth + 1)
      return
    }

    if (useHash) {
      skipNextHashChange = true
      location.hash = '#' + to
      updateCurrent(to)
    } else {
      history.pushState(null, '', to)
      updateCurrent(to)
    }
  }

  const onHashChange = () => {
    if (skipNextHashChange) {
      skipNextHashChange = false
      return
    }
    checkGuardsAndUpdate(location.hash.slice(1) || '/')
  }

  const onPopState = () => {
    checkGuardsAndUpdate(location.pathname + location.search)
  }

  const router: Router = {
    current: app.routeProxy,
    routes,
    guards,

    match(path: string) {
      return matchRoute(parsed, path)
    },

    navigate(to: string | number) {
      if (typeof to === 'number') {
        history.go(to)
        return
      }
      navigateInternal(to)
    },

    destroy() {
      if (useHash) {
        window.removeEventListener('hashchange', onHashChange)
      } else {
        window.removeEventListener('popstate', onPopState)
      }
    },
  }

  if (useHash) {
    window.addEventListener('hashchange', onHashChange)
  } else {
    window.addEventListener('popstate', onPopState)
  }

  // Initial load also runs guards
  function getInitialPath(): string {
    if (useHash) {
      return location.hash ? location.hash.slice(1) || '/' : '/'
    }
    return location.pathname + location.search
  }

  // Defer initial route check so app.root is set before guards run
  queueMicrotask(() => checkGuardsAndUpdate(getInitialPath()))

  return router
}
