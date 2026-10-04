import { describe, it, expect, afterEach, vi } from 'vitest'
import { mount, component } from '../src/index'
import { renderToString } from '../src/server'

function flush(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0))
}

let cleanup: (() => void) | null = null

afterEach(() => {
  cleanup?.()
  cleanup = null
  history.replaceState(null, '', '/')
  vi.restoreAllMocks()
})

// Mount node holding server-rendered HTML, as the prerender CLI writes it
function prerendered(html: string): HTMLElement {
  const el = document.createElement('div')
  el.innerHTML = html
  el.setAttribute('data-blok-ssr', '')
  document.body.appendChild(el)
  return el
}

function hydrate(opts: Parameters<typeof mount>[1], serverOpts = opts, url?: string) {
  const el = prerendered(renderToString(serverOpts, { url }))
  const html = el.innerHTML
  const nodes = Array.from(el.querySelectorAll('*'))
  const app = mount(el, opts)
  cleanup = () => { app.destroy(); el.remove() }
  const adopted = () => {
    const now = Array.from(el.querySelectorAll('*'))
    return now.length === nodes.length && now.every((n, i) => n === nodes[i])
  }
  return { el, app, html, adopted }
}

describe('hydration', () => {
  it('adopts the prerendered nodes without duplicating them', () => {
    const { el, html, adopted } = hydrate({
      state: { name: 'Ana', items: [{ id: 1, t: 'a' }, { id: 2, t: 'b' }], show: true },
      view: ($) => ({ main: { class: 'page', children: [
        { h1: $.name },
        { p: { text: 'static' } },
        { when: $.show, children: [{ b: 'shown' }] },
        { span: { when: $.show, text: 'cond' } },
        { ul: { children: [{ each: $.items, as: 'it', key: 'id', children: [{ li: $.it.t }] }] } },
      ] } }),
    })
    expect(adopted()).toBe(true)
    expect(el.innerHTML).toBe(html)
    expect(el.hasAttribute('data-blok-ssr')).toBe(false)
  })

  it('binds state and events to the adopted nodes', async () => {
    const { el, adopted } = hydrate({
      state: { count: 0 },
      methods: { inc() { this.count++ } },
      view: ($) => ({ div: { children: [{ span: $.count }, { button: { click: 'inc', text: '+' } }] } }),
    })
    const span = el.querySelector('span')!
    el.querySelector('button')!.click()
    await flush()
    expect(span.textContent).toBe('1')
    expect(adopted()).toBe(true)
  })

  it('keeps when, conditional elements and lists reactive', async () => {
    const { el, app } = hydrate({
      state: { show: true, items: [{ id: 1, t: 'a' }, { id: 2, t: 'b' }], plain: ['x', 'y'] },
      methods: {
        toggle() { this.show = !this.show },
        reorder() { this.items = [this.items[1], this.items[0], { id: 3, t: 'c' }] },
        drop() { this.plain = ['y'] },
      },
      view: ($) => ({ div: { children: [
        { button: { id: 't', click: 'toggle' } },
        { button: { id: 'r', click: 'reorder' } },
        { button: { id: 'd', click: 'drop' } },
        { when: $.show, children: [{ b: 'w' }] },
        { i: { when: $.show, text: 'c' } },
        { ul: { children: [{ each: $.items, as: 'it', key: 'id', children: [{ li: $.it.t }] }] } },
        { ol: { children: [{ each: $.plain, children: [{ li: $.item }] }] } },
      ] } }),
    })
    void app
    const liA = el.querySelector('ul li')!
    const click = (id: string) => (el.querySelector(`#${id}`) as HTMLElement).click()

    click('t')
    await flush()
    expect(el.querySelector('b')).toBeNull()
    expect(el.querySelector('i')).toBeNull()
    click('t')
    await flush()
    expect(el.querySelector('b')!.textContent).toBe('w')
    expect(el.querySelector('i')!.textContent).toBe('c')

    click('r')
    await flush()
    const lis = Array.from(el.querySelectorAll('ul li'))
    expect(lis.map(l => l.textContent)).toEqual(['b', 'a', 'c'])
    expect(lis[1]).toBe(liA)

    click('d')
    await flush()
    expect(Array.from(el.querySelectorAll('ol li')).map(l => l.textContent)).toEqual(['y'])
  })

  it('hydrates components with props, slots and events', async () => {
    component('HydCard', {
      props: ['title'],
      methods: { pick() { this.emit('picked', this.title) } },
      view: ($) => ({ section: { children: [
        { h2: $.title },
        { div: { children: { slot: true } } },
        { button: { click: 'pick', text: 'pick' } },
      ] } }),
    })
    const { el, adopted } = hydrate({
      state: { title: 'T', picked: '' },
      methods: { onPick(v: string) { this.picked = v } },
      view: ($) => ({ div: { children: [
        { HydCard: { title: $.title, on_picked: 'onPick', children: [{ p: 'slot' }] } },
        { output: $.picked },
      ] } }),
    })
    expect(adopted()).toBe(true)
    el.querySelector('button')!.click()
    await flush()
    expect(el.querySelector('output')!.textContent).toBe('T')
  })

  it('heals text nodes the HTML parser merged', async () => {
    const { el } = hydrate({
      state: { name: 'Ana' },
      methods: { rename() { this.name = 'Bo' } },
      view: ($) => ({ p: { children: ['Hello ', { span: { text: '!' } }, 'a', 'b', { button: { click: 'rename' } }] } }),
    })
    expect(el.querySelector('p')!.textContent).toBe('Hello !ab')
    const { el: el2 } = (() => {
      cleanup?.()
      return hydrate({
        state: { name: 'Ana' },
        methods: { rename() { this.name = 'Bo' } },
        view: ($) => ({ p: { text: $.name, children: [' and ', { button: { click: 'rename' } }] } }),
      })
    })()
    expect(el2.querySelector('p')!.textContent).toBe('Ana and ')
    el2.querySelector('button')!.click()
    await flush()
    expect(el2.querySelector('p')!.textContent).toBe('Bo and ')
    void el
  })

  it('keeps input the user typed before the script ran', async () => {
    const opts = {
      state: { q: 'server', agree: false },
      view: ($: any) => ({ div: { children: [
        { input: { type: 'text', model: $.q } },
        { input: { type: 'checkbox', model: $.agree } },
        { output: $.q },
      ] } }),
    }
    const el = prerendered(renderToString(opts))
    const [text, box] = Array.from(el.querySelectorAll('input'))
    text.value = 'typed'
    box.checked = true
    const app = mount(el, opts)
    cleanup = () => { app.destroy(); el.remove() }
    await flush()
    expect(el.querySelector('output')!.textContent).toBe('typed')
    expect(box.checked).toBe(true)
  })

  it('lets client state win over untouched prerendered input', () => {
    const view = ($: any) => ({ input: { type: 'text', model: $.q } })
    const { el } = hydrate({ state: { q: 'client' }, view }, { state: { q: 'server' }, view })
    expect(el.querySelector('input')!.value).toBe('client')
  })

  it('does not re-set unchanged attributes', async () => {
    const records: MutationRecord[] = []
    const opts = { state: { src: '/clip.mp4' }, view: ($: any) => ({ video: { src: $.src, title: 'clip' } }) }
    const el = prerendered(renderToString(opts))
    const observer = new MutationObserver(r => records.push(...r))
    observer.observe(el, { attributes: true, subtree: true, childList: true })
    const app = mount(el, opts)
    cleanup = () => { app.destroy(); el.remove() }
    await flush()
    observer.disconnect()
    expect(records.filter(r => r.target !== el)).toEqual([])
  })

  it('preserves focus', () => {
    const opts = { state: { q: '' }, view: ($: any) => ({ form: { children: [{ input: { model: $.q } }] } }) }
    const el = prerendered(renderToString(opts))
    const input = el.querySelector('input')!
    input.focus()
    const app = mount(el, opts)
    cleanup = () => { app.destroy(); el.remove() }
    expect(document.activeElement).toBe(input)
  })

  it('tolerates whitespace between prerendered nodes', () => {
    const opts = { view: () => ({ ul: { children: [{ li: 'a' }, { li: 'b' }] } }) }
    const el = prerendered('\n  <ul>\n    <li>a</li>\n    <li>b</li>\n  </ul>\n')
    const lis = Array.from(el.querySelectorAll('li'))
    const app = mount(el, opts)
    cleanup = () => { app.destroy(); el.remove() }
    expect(Array.from(el.querySelectorAll('li'))).toEqual(lis)
    expect(el.innerHTML).toBe('<ul><li>a</li><li>b</li></ul>')
  })

  it('removes classes the server rendered for a different state', () => {
    const view = ($: any) => ({ button: { class: ['btn', $.variant, { on: $.on }] } })
    const { el } = hydrate({ state: { variant: 'secondary', on: false }, view }, { state: { variant: 'primary', on: true }, view })
    expect(el.querySelector('button')!.className).toBe('btn secondary')
  })

  it('keeps raw html nodes when the content matches', () => {
    const { adopted } = hydrate({ view: () => ({ div: { html: '<b>bold</b><br/><i>x</i>' } }) })
    expect(adopted()).toBe(true)
  })

  it('falls back to a fresh render when the structure differs', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const mountHook = vi.fn()
    const unmountHook = vi.fn()
    component('HydChild', { mount: mountHook, unmount: unmountHook, view: () => ({ em: 'child' }) })
    const opts = {
      state: { n: 1 },
      methods: { inc() { this.n++ } },
      view: ($: any) => ({ div: { children: [{ HydChild: {} }, { span: $.n }, { button: { click: 'inc' } }] } }),
    }
    const el = prerendered('<div><em>child</em><p>stale</p></div>')
    const app = mount(el, opts)
    cleanup = () => { app.destroy(); el.remove() }
    await flush()
    expect(warn.mock.calls[0][0]).toContain('Hydration mismatch: expected <span>, found <p>')
    expect(el.innerHTML).toBe('<div><em>child</em><span>1</span><button></button></div>')
    expect(mountHook).toHaveBeenCalledTimes(1)
    expect(unmountHook).not.toHaveBeenCalled()
    el.querySelector('button')!.click()
    await flush()
    expect(el.querySelector('span')!.textContent).toBe('2')
  })

  it('hydrates the current route and keeps navigating', async () => {
    component('HydHome', { view: () => ({ h1: 'Home' }) })
    component('HydAbout', { view: () => ({ h1: 'About' }) })
    history.pushState(null, '', '/about')
    const { el, adopted } = hydrate({
      routes: [{ path: '/', component: 'HydHome' }, { path: '/about', component: 'HydAbout' }],
      view: () => ({ div: { children: [{ a: { href: '/', link: true, text: 'home' } }, { main: { route: true } }] } }),
    }, undefined, '/about')
    expect(adopted()).toBe(true)
    expect(el.querySelector('h1')!.textContent).toBe('About')
    el.querySelector('a')!.click()
    await flush()
    expect(el.querySelector('h1')!.textContent).toBe('Home')
  })
})
