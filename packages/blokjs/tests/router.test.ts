import { describe, it, expect, vi, afterEach } from 'vitest'
import { matchRoute } from '../src/router'
import { mount, component } from '../src/index'

// matchRoute expects ParsedRoute[] which is not exported,
// so we construct the objects manually matching its shape.
function makeParsed(routes: { path: string; paramNames?: string[] }[]) {
  return routes.map(r => {
    const paramNames = r.paramNames ?? []
    if (r.path === '*') {
      return { pattern: /.*/, paramNames, config: { path: r.path, component: 'C' } }
    }
    const parts = r.path.split(/:(\w+)/)
    let re = '^'
    const names: string[] = []
    for (let i = 0; i < parts.length; i++) {
      if (i % 2 === 0) {
        re += parts[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      } else {
        names.push(parts[i])
        re += '([^/]+)'
      }
    }
    re += '$'
    return { pattern: new RegExp(re), paramNames: names, config: { path: r.path, component: 'C' } }
  })
}

describe('matchRoute', () => {
  it('matches exact paths', () => {
    const parsed = makeParsed([{ path: '/about' }, { path: '/home' }])
    const result = matchRoute(parsed, '/about')
    expect(result).not.toBeNull()
    expect(result!.config.path).toBe('/about')
    expect(result!.params).toEqual({})
  })

  it('extracts parameters from :param segments', () => {
    const parsed = makeParsed([{ path: '/users/:id' }])
    const result = matchRoute(parsed, '/users/42')
    expect(result).not.toBeNull()
    expect(result!.params).toEqual({ id: '42' })
  })

  it('extracts multiple parameters', () => {
    const parsed = makeParsed([{ path: '/users/:userId/posts/:postId' }])
    const result = matchRoute(parsed, '/users/5/posts/99')
    expect(result).not.toBeNull()
    expect(result!.params).toEqual({ userId: '5', postId: '99' })
  })

  it('decodes URI-encoded parameters', () => {
    const parsed = makeParsed([{ path: '/search/:query' }])
    const result = matchRoute(parsed, '/search/hello%20world')
    expect(result!.params).toEqual({ query: 'hello world' })
  })

  it('matches wildcard routes', () => {
    const parsed = makeParsed([{ path: '/home' }, { path: '*' }])
    const result = matchRoute(parsed, '/anything/here')
    expect(result).not.toBeNull()
    expect(result!.config.path).toBe('*')
  })

  it('returns null when no route matches', () => {
    const parsed = makeParsed([{ path: '/home' }, { path: '/about' }])
    const result = matchRoute(parsed, '/contact')
    expect(result).toBeNull()
  })

  it('returns first match when multiple routes could match', () => {
    const parsed = makeParsed([{ path: '/users/:id' }, { path: '*' }])
    const result = matchRoute(parsed, '/users/1')
    expect(result!.config.path).toBe('/users/:id')
  })
})

describe('initial route', () => {
  let destroy: (() => void) | null = null

  afterEach(() => {
    destroy?.()
    destroy = null
    history.replaceState(null, '', '/')
  })

  function start(opts: Parameters<typeof mount>[1]) {
    const el = document.createElement('div')
    document.body.appendChild(el)
    const app = mount(el, opts)
    destroy = () => { app.destroy(); el.remove() }
    return el
  }

  it('renders a deep link in the first synchronous render', async () => {
    const homeMount = vi.fn()
    component('InitHome', { mount: homeMount, view: () => ({ h1: 'Home' }) })
    component('InitAbout', { view: () => ({ h1: 'About' }) })
    history.pushState(null, '', '/about')
    const el = start({
      routes: [{ path: '/', component: 'InitHome' }, { path: '/about', component: 'InitAbout' }],
      view: () => ({ main: { route: true } }),
    })
    expect(el.textContent).toBe('About')
    await new Promise(r => setTimeout(r, 0))
    expect(homeMount).not.toHaveBeenCalled()
  })

  it('runs guards before the first render', () => {
    component('InitLogin', { view: () => ({ h1: 'Login' }) })
    component('InitAdmin', { view: () => ({ h1: 'Admin' }) })
    history.pushState(null, '', '/admin')
    const el = start({
      state: { user: null },
      routes: [
        { path: '/login', component: 'InitLogin' },
        { path: '/admin', component: 'InitAdmin', guard: 'auth' },
      ],
      guards: { auth(this: any) { return this.user ? true : '/login' } },
      view: () => ({ main: { route: true } }),
    })
    expect(el.textContent).toBe('Login')
    expect(location.pathname).toBe('/login')
  })
})
