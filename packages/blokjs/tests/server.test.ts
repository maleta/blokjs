// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderToString, component, store } from '../src/server'
import { createStringDocument, serializeChildren } from '../src/string-dom'

function flush(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0))
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('renderToString environment', () => {
  it('runs without window or document', () => {
    expect(typeof window).toBe('undefined')
    expect(typeof document).toBe('undefined')
    expect(renderToString({ view: () => ({ p: 'ok' }) })).toBe('<p>ok</p>')
  })
})

describe('renderToString output', () => {
  it('renders elements, static and bound text', () => {
    const html = renderToString({
      state: { name: 'Ana', n: 3 },
      view: ($) => ({ div: { children: [{ h1: $.name }, { span: { text: $.n } }, { p: 'static' }, 'loose'] } }),
    })
    expect(html).toBe('<div><h1>Ana</h1><span>3</span><p>static</p>loose</div>')
  })

  it('escapes text and attribute values', () => {
    const html = renderToString({
      state: { t: '<script>x</script> & "q"' },
      view: ($) => ({ div: { title: $.t, text: $.t } }),
    })
    expect(html).toBe('<div title="<script>x</script> &amp; &quot;q&quot;">&lt;script&gt;x&lt;/script&gt; &amp; "q"</div>')
  })

  it('sanitizes URLs like the client', () => {
    const html = renderToString({
      state: { bad: 'javascript:alert(1)', good: '/about' },
      view: ($) => ({ div: { children: [{ a: { href: $.bad, text: 'x' } }, { a: { href: $.good, text: 'y' } }] } }),
    })
    expect(html).toBe('<div><a href>x</a><a href="/about">y</a></div>')
  })

  it('skips event handlers', () => {
    const html = renderToString({
      methods: { go() {} },
      view: () => ({ button: { click: 'go', text: 'Go' } }),
    })
    expect(html).toBe('<button>Go</button>')
  })

  it('renders class and style forms', () => {
    const html = renderToString({
      state: { on: true, off: false, color: 'red', variant: 'primary' },
      view: ($) => ({ div: { children: [
        { i: { class: 'a b' } },
        { i: { class: { active: $.on, hidden: $.off } } },
        { i: { class: ['btn', $.variant] } },
        { i: { style: 'margin: 0' } },
        { i: { style: { color: $.color, fontSize: '12px' } } },
      ] } }),
    })
    expect(html).toBe(
      '<div><i class="a b"></i><i class="active"></i><i class="btn primary"></i>'
      + '<i style="margin: 0"></i><i style="color: red; font-size: 12px"></i></div>',
    )
  })

  it('renders boolean attributes and props', () => {
    const html = renderToString({
      state: { dis: true, hid: false },
      view: ($) => ({ div: { children: [
        { button: { disabled: $.dis, text: 'a' } },
        { p: { props: { hidden: true }, text: 'b' } },
        { p: { hidden: $.hid, text: 'c' } },
      ] } }),
    })
    expect(html).toBe('<div><button disabled>a</button><p hidden>b</p><p>c</p></div>')
  })

  it('renders model values for inputs, checkboxes, textareas and selects', () => {
    const html = renderToString({
      state: { name: 'Ana', agree: true, bio: 'hi\nthere', pick: 'b' },
      view: ($) => ({ form: { children: [
        { input: { type: 'text', model: $.name } },
        { input: { type: 'checkbox', model: $.agree } },
        { textarea: { model: $.bio } },
        { select: { children: [{ option: { value: 'a', text: 'A' } }, { option: { value: 'b', text: 'B' } }], model: $.pick } },
      ] } }),
    })
    expect(html).toBe(
      '<form><input type="text" value="Ana"><input type="checkbox" checked><textarea>hi\nthere</textarea>'
      + '<select><option value="a">A</option><option value="b" selected>B</option></select></form>',
    )
  })

  it('renders conditionals with markers', () => {
    const html = renderToString({
      state: { yes: true, no: false },
      view: ($) => ({ div: { children: [
        { when: $.yes, children: [{ b: 'shown' }] },
        { when: $.no, children: [{ b: 'hidden' }] },
        { p: { when: $.yes, text: 'el' } },
        { p: { when: $.no, text: 'gone' } },
      ] } }),
    })
    expect(html).toBe(
      '<div><!--when--><b>shown</b><!--/when--><!--when--><!--/when-->'
      + '<!--if:p--><p>el</p><!--/if:p--><!--if:p--><!--/if:p--></div>',
    )
  })

  it('renders keyed and non-keyed lists', () => {
    const html = renderToString({
      state: { items: [{ id: 1, t: 'a' }, { id: 2, t: 'b' }] },
      view: ($) => ({ div: { children: [
        { ul: { children: [{ each: $.items, as: 'it', key: 'id', children: [{ li: $.it.t }] }] } },
        { ol: { children: [{ each: $.items, children: [{ li: $.item.t }] }] } },
      ] } }),
    })
    const list = '<!--each--><!--ei--><li>a</li><!--/ei--><!--ei--><li>b</li><!--/ei--><!--/each-->'
    expect(html).toBe(`<div><ul>${list}</ul><ol>${list}</ol></div>`)
  })

  it('renders components with props and slots', () => {
    component('SrvCard', {
      props: ['title'],
      view: ($) => ({ section: { children: [{ h2: $.title }, { div: { children: { slot: true } } }] } }),
    })
    const html = renderToString({
      state: { heading: 'Hello' },
      view: ($) => ({ SrvCard: { title: $.heading, children: [{ p: 'inside' }] } }),
    })
    expect(html).toBe('<section><h2>Hello</h2><div><p>inside</p></div></section>')
  })

  it('keeps the case of svg tags and attributes', () => {
    const html = renderToString({
      view: () => ({ svg: { viewBox: '0 0 10 10', children: [
        { linearGradient: { gradientUnits: 'userSpaceOnUse' } },
        { foreignObject: { children: [{ div: 'x' }] } },
      ] } }),
    })
    expect(html).toBe('<svg viewBox="0 0 10 10"><linearGradient gradientUnits="userSpaceOnUse"></linearGradient><foreignObject><div>x</div></foreignObject></svg>')
  })

  it('emits raw html content, neutralizing script tags', () => {
    const html = renderToString({
      view: () => ({ div: { html: '<b>bold</b><script>alert(1)</script>' } }),
    })
    expect(html).toBe('<div><b>bold</b>&lt;script>alert(1)</script></div>')
  })

  it('renders the route for the given url', () => {
    component('SrvHome', { view: () => ({ h1: 'Home' }) })
    component('SrvUser', { view: ($) => ({ h1: { text: $.route.params.id } }) })
    const opts = {
      routes: [{ path: '/', component: 'SrvHome' }, { path: '/users/:id', component: 'SrvUser' }],
      view: () => ({ main: { route: true } }),
    }
    expect(renderToString(opts)).toBe('<main><h1>Home</h1></main>')
    expect(renderToString(opts, { url: '/users/42?tab=x' })).toBe('<main><h1>42</h1></main>')
  })

  it('warns about guarded routes and does not run the guard', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const guard = vi.fn(() => '/login')
    component('SrvAdmin', { view: () => ({ h1: 'Admin' }) })
    const html = renderToString({
      routes: [{ path: '/admin', component: 'SrvAdmin', guard: 'auth' }],
      guards: { auth: guard },
      view: () => ({ main: { route: true } }),
    }, { url: '/admin' })
    expect(html).toBe('<main><h1>Admin</h1></main>')
    expect(guard).not.toHaveBeenCalled()
    expect(warn.mock.calls[0][0]).toContain('guard "auth"')
  })

  it('uses fresh store state for every render', () => {
    store('srvCounter', { state: { n: 0 }, methods: { inc() { this.n++ } } })
    const opts = {
      computed: { label(this: any) { this.store.srvCounter.inc(); return String(this.store.srvCounter.n) } },
      view: ($: any) => ({ p: $.label }),
    }
    expect(renderToString(opts)).toBe('<p>1</p>')
    expect(renderToString(opts)).toBe('<p>1</p>')
  })

  it('never runs mount or unmount hooks', async () => {
    const mount = vi.fn()
    const unmount = vi.fn()
    component('SrvHooks', { mount, unmount, view: () => ({ span: 'x' }) })
    renderToString({ mount, unmount, view: () => ({ SrvHooks: {} }) })
    await flush()
    expect(mount).not.toHaveBeenCalled()
    expect(unmount).not.toHaveBeenCalled()
  })
})

describe('string DOM serializer', () => {
  it('writes void elements without closing tags', () => {
    const doc = createStringDocument()
    const root = doc.createElement('div')
    root.append(doc.createElement('br'), doc.createElement('img'))
    expect(serializeChildren(root)).toBe('<br><img>')
  })

  it('keeps script and style text raw but closes no element early', () => {
    const doc = createStringDocument()
    const root = doc.createElement('div')
    const style = doc.createElement('style')
    style.textContent = 'a > b { color: red } </style><script>'
    root.appendChild(style)
    expect(serializeChildren(root)).toBe('<style>a > b { color: red } <\\/style><script></style>')
  })

  it('neutralizes comment terminators', () => {
    const doc = createStringDocument()
    const root = doc.createElement('div')
    root.appendChild(doc.createComment('a-->b'))
    expect(serializeChildren(root)).toBe('<!--a--&gt;b-->')
  })

  it('adds the newline the parser drops after <pre>', () => {
    const doc = createStringDocument()
    const root = doc.createElement('div')
    const pre = doc.createElement('pre')
    pre.textContent = '\nline'
    root.appendChild(pre)
    expect(serializeChildren(root)).toBe('<pre>\n\nline</pre>')
  })

  it('rejects attribute names a browser rejects', () => {
    const el = createStringDocument().createElement('div')
    expect(() => el.setAttribute('a"b', 'x')).toThrow()
  })

  it('warns about markup the parser restructures', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    renderToString({ view: () => ({ table: { children: [{ tr: { children: [{ td: 'x' }] } }] } }) })
    renderToString({ view: () => ({ p: { children: [{ span: { children: [{ div: 'x' }] } }] } }) })
    expect(warn.mock.calls.map(c => c[0]).join('\n')).toMatch(/<tr> directly inside <table>[\s\S]*<div> inside <p>/)
  })
})
