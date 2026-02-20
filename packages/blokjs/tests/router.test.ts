import { describe, it, expect } from 'vitest'
import { matchRoute } from '../src/router'

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
