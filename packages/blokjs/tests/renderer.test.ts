import { describe, it, expect, afterEach, vi } from 'vitest'
import { mount, component } from '../src/index'

function flush(): Promise<void> {
  return new Promise((r) => queueMicrotask(r))
}

let cleanup: (() => void) | null = null

function mountApp(opts: Parameters<typeof mount>[1]): {
  el: HTMLElement
  app: ReturnType<typeof mount>
} {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const app = mount(el, opts)
  cleanup = () => {
    app.destroy()
    el.remove()
  }
  return { el, app }
}

afterEach(() => {
  cleanup?.()
  cleanup = null
})

// ---- Text binding ----

describe('text binding', () => {
  it('static text: { span: "hello" } renders span with "hello"', () => {
    const { el } = mountApp({
      view: () => ({ span: 'hello' }),
    })

    expect(el.querySelector('span')!.textContent).toBe('hello')
  })

  it('reactive ref text: { span: { text: $.message } } updates when state changes', async () => {
    const { el } = mountApp({
      state: { message: 'initial' },
      methods: {
        update() { this.message = 'updated' },
      },
      view: ($: any) => ({ span: { text: $.message, click: 'update' } }),
    })

    expect(el.querySelector('span')!.textContent).toBe('initial')

    el.querySelector('span')!.click()
    await flush()

    expect(el.querySelector('span')!.textContent).toBe('updated')
  })

  it('ref as element content: { p: $.count } renders count value and updates on change', async () => {
    const { el } = mountApp({
      state: { count: 42 },
      methods: {
        inc() { this.count++ },
      },
      view: ($: any) => ({
        div: {
          children: [
            { p: $.count },
            { button: { text: 'inc', click: 'inc' } },
          ],
        },
      }),
    })

    expect(el.querySelector('p')!.textContent).toBe('42')

    el.querySelector('button')!.click()
    await flush()

    expect(el.querySelector('p')!.textContent).toBe('43')
  })
})

// ---- Conditional rendering ----

describe('conditional rendering', () => {
  it('when block: shows/hides children based on condition', async () => {
    const { el } = mountApp({
      state: { visible: true },
      methods: {
        toggle() { this.visible = !this.visible },
      },
      view: ($: any) => ({
        div: {
          children: [
            { when: $.visible, children: [{ span: 'shown' }] },
            { button: { text: 'toggle', click: 'toggle' } },
          ],
        },
      }),
    })

    expect(el.querySelector('span')!.textContent).toBe('shown')

    el.querySelector('button')!.click()
    await flush()

    expect(el.querySelector('span')).toBeNull()
  })

  it('element-level when: { div: { when: $.editing, text: "edit" } }', async () => {
    const { el } = mountApp({
      state: { editing: false },
      methods: {
        startEdit() { this.editing = true },
      },
      view: ($: any) => ({
        div: {
          children: [
            { div: { when: $.editing, text: 'edit mode' } },
            { button: { text: 'edit', click: 'startEdit' } },
          ],
        },
      }),
    })

    // Initially hidden
    expect(el.textContent).not.toContain('edit mode')

    el.querySelector('button')!.click()
    await flush()

    expect(el.textContent).toContain('edit mode')
  })

  it('toggle on state change updates DOM both ways', async () => {
    const { el } = mountApp({
      state: { show: true },
      methods: {
        toggle() { this.show = !this.show },
      },
      view: ($: any) => ({
        div: {
          children: [
            { when: $.show, children: [{ span: 'content' }] },
            { button: { text: 'toggle', click: 'toggle' } },
          ],
        },
      }),
    })

    expect(el.querySelector('span')).not.toBeNull()

    el.querySelector('button')!.click()
    await flush()
    expect(el.querySelector('span')).toBeNull()

    el.querySelector('button')!.click()
    await flush()
    expect(el.querySelector('span')).not.toBeNull()
    expect(el.querySelector('span')!.textContent).toBe('content')
  })
})

// ---- List rendering ----

describe('list rendering', () => {
  it('renders items from array', () => {
    const { el } = mountApp({
      state: { items: ['a', 'b', 'c'] },
      view: ($: any) => ({
        ul: {
          children: [
            { each: $.items, as: 'item', children: [{ li: $.item }] },
          ],
        },
      }),
    })

    const lis = el.querySelectorAll('li')
    expect(lis.length).toBe(3)
    expect(lis[0].textContent).toBe('a')
    expect(lis[1].textContent).toBe('b')
    expect(lis[2].textContent).toBe('c')
  })

  it('add item updates DOM', async () => {
    const { el } = mountApp({
      state: { items: ['x'] },
      methods: {
        add() { this.items.push('y') },
      },
      view: ($: any) => ({
        div: {
          children: [
            { each: $.items, as: 'item', children: [{ span: $.item }] },
            { button: { text: 'add', click: 'add' } },
          ],
        },
      }),
    })

    expect(el.querySelectorAll('span').length).toBe(1)

    el.querySelector('button')!.click()
    await flush()

    const spans = el.querySelectorAll('span')
    expect(spans.length).toBe(2)
    expect(spans[1].textContent).toBe('y')
  })

  it('remove item updates DOM', async () => {
    const { el } = mountApp({
      state: { items: ['a', 'b', 'c'] },
      methods: {
        removeLast() { this.items.pop() },
      },
      view: ($: any) => ({
        div: {
          children: [
            { each: $.items, as: 'item', children: [{ span: $.item }] },
            { button: { text: 'remove', click: 'removeLast' } },
          ],
        },
      }),
    })

    expect(el.querySelectorAll('span').length).toBe(3)

    el.querySelector('button')!.click()
    await flush()

    expect(el.querySelectorAll('span').length).toBe(2)
  })

  it('empty array renders nothing', () => {
    const { el } = mountApp({
      state: { items: [] as string[] },
      view: ($: any) => ({
        ul: {
          children: [
            { each: $.items, as: 'item', children: [{ li: $.item }] },
          ],
        },
      }),
    })

    expect(el.querySelectorAll('li').length).toBe(0)
  })

  it('keyed reconciliation: reorder preserves DOM elements', async () => {
    const { el } = mountApp({
      state: {
        items: [
          { id: 1, name: 'alpha' },
          { id: 2, name: 'beta' },
          { id: 3, name: 'gamma' },
        ],
      },
      methods: {
        reverse() {
          this.items = [...this.items].reverse()
        },
      },
      view: ($: any) => ({
        div: {
          children: [
            { each: $.items, as: 'item', key: 'id', children: [{ li: $.item.name }] },
            { button: { text: 'reverse', click: 'reverse' } },
          ],
        },
      }),
    })

    const lisBefore = Array.from(el.querySelectorAll('li'))
    expect(lisBefore.length).toBe(3)

    // Grab references to DOM nodes keyed by their content
    const alphaNode = lisBefore[0]
    const gammaNode = lisBefore[2]

    el.querySelector('button')!.click()
    await flush()

    const lisAfter = Array.from(el.querySelectorAll('li'))
    expect(lisAfter.length).toBe(3)

    // After reverse, gamma should be first and alpha last - same DOM nodes reused
    expect(lisAfter[0]).toBe(gammaNode)
    expect(lisAfter[2]).toBe(alphaNode)
  })

  it('unkeyed: full rebuild on length change (DOM nodes recreated)', async () => {
    const { el } = mountApp({
      state: {
        items: ['alpha', 'beta'],
      },
      methods: {
        addAndReorder() {
          this.items = ['gamma', 'alpha', 'beta']
        },
      },
      view: ($: any) => ({
        div: {
          children: [
            { each: $.items, as: 'item', children: [{ li: $.item }] },
            { button: { text: 'change', click: 'addAndReorder' } },
          ],
        },
      }),
    })

    const lisBefore = Array.from(el.querySelectorAll('li'))
    expect(lisBefore.length).toBe(2)
    const firstNodeBefore = lisBefore[0]

    el.querySelector('button')!.click()
    await flush()

    const lisAfter = Array.from(el.querySelectorAll('li'))
    expect(lisAfter.length).toBe(3)
    // Without key, all DOM nodes are fully rebuilt when length changes
    expect(lisAfter[0]).not.toBe(firstNodeBefore)
    expect(lisAfter[0].textContent).toBe('gamma')
    expect(lisAfter[1].textContent).toBe('alpha')
    expect(lisAfter[2].textContent).toBe('beta')
  })
})

// ---- Class binding ----

describe('class binding', () => {
  it('static string class', () => {
    const { el } = mountApp({
      view: () => ({ div: { class: 'container' } }),
    })

    expect(el.querySelector('div')!.className).toBe('container')
  })

  it('reactive ref class', async () => {
    const { el } = mountApp({
      state: { cls: 'primary' },
      methods: {
        change() { this.cls = 'secondary' },
      },
      view: ($: any) => ({
        div: {
          children: [
            { span: { class: $.cls, text: 'styled' } },
            { button: { text: 'change', click: 'change' } },
          ],
        },
      }),
    })

    expect(el.querySelector('span')!.className).toBe('primary')

    el.querySelector('button')!.click()
    await flush()

    expect(el.querySelector('span')!.className).toBe('secondary')
  })

  it('array of strings', () => {
    const { el } = mountApp({
      view: () => ({ div: { class: ['base', 'extra'] } }),
    })

    const div = el.querySelector('div')!
    expect(div.classList.contains('base')).toBe(true)
    expect(div.classList.contains('extra')).toBe(true)
  })

  it('object with boolean conditions (static true/false)', () => {
    const { el } = mountApp({
      view: () => ({ div: { class: { bold: true, hidden: false } } }),
    })

    const div = el.querySelector('div')!
    expect(div.classList.contains('bold')).toBe(true)
    expect(div.classList.contains('hidden')).toBe(false)
  })

  it('reactive object condition (ref in object value)', async () => {
    const { el } = mountApp({
      state: { isActive: false },
      methods: {
        activate() { this.isActive = true },
      },
      view: ($: any) => ({
        div: {
          children: [
            { span: { class: { active: $.isActive }, text: 'item' } },
            { button: { text: 'activate', click: 'activate' } },
          ],
        },
      }),
    })

    expect(el.querySelector('span')!.classList.contains('active')).toBe(false)

    el.querySelector('button')!.click()
    await flush()

    expect(el.querySelector('span')!.classList.contains('active')).toBe(true)
  })
})

// ---- Style binding ----

describe('style binding', () => {
  it('static string style', () => {
    const { el } = mountApp({
      view: () => ({ div: { style: 'color: red' } }),
    })

    expect(el.querySelector('div')!.getAttribute('style')).toBe('color: red')
  })

  it('object with camelCase to kebab conversion', () => {
    const { el } = mountApp({
      view: () => ({ div: { style: { fontSize: '14px', backgroundColor: 'blue' } } }),
    })

    const div = el.querySelector('div')!
    expect(div.style.fontSize).toBe('14px')
    expect(div.style.backgroundColor).toBe('blue')
  })

  it('CSS custom properties (--my-var)', () => {
    const { el } = mountApp({
      view: () => ({ div: { style: { '--my-var': '10px' } } }),
    })

    const div = el.querySelector('div')!
    expect(div.style.getPropertyValue('--my-var')).toBe('10px')
  })

  it('reactive individual prop via ref', async () => {
    const { el } = mountApp({
      state: { textColor: 'red' },
      methods: {
        changeColor() { this.textColor = 'blue' },
      },
      view: ($: any) => ({
        div: {
          children: [
            { span: { style: { color: $.textColor }, text: 'colored' } },
            { button: { text: 'change', click: 'changeColor' } },
          ],
        },
      }),
    })

    expect(el.querySelector('span')!.style.color).toBe('red')

    el.querySelector('button')!.click()
    await flush()

    expect(el.querySelector('span')!.style.color).toBe('blue')
  })
})

// ---- Model binding ----

describe('model binding', () => {
  it('text input: state -> DOM (initial value), DOM -> state (input event)', async () => {
    const { el } = mountApp({
      state: { name: 'initial' },
      view: ($: any) => ({
        div: {
          children: [
            { input: { model: $.name } },
            { span: { text: $.name } },
          ],
        },
      }),
    })

    const input = el.querySelector('input')!
    expect(input.value).toBe('initial')

    // Simulate user typing
    input.value = 'changed'
    input.dispatchEvent(new Event('input'))
    await flush()

    expect(el.querySelector('span')!.textContent).toBe('changed')
  })

  it('checkbox: checked binding via change event', async () => {
    const { el } = mountApp({
      state: { checked: false },
      view: ($: any) => ({
        div: {
          children: [
            { input: { type: 'checkbox', model: $.checked } },
            { span: { text: $.checked } },
          ],
        },
      }),
    })

    const input = el.querySelector('input')! as HTMLInputElement
    expect(input.checked).toBe(false)

    input.checked = true
    input.dispatchEvent(new Event('change'))
    await flush()

    expect(el.querySelector('span')!.textContent).toBe('true')
  })

  it('select: value binding via change event', async () => {
    const { el } = mountApp({
      state: { selected: 'a' },
      view: ($: any) => ({
        div: {
          children: [
            {
              select: {
                model: $.selected,
                children: [
                  { option: { value: 'a', text: 'A' } },
                  { option: { value: 'b', text: 'B' } },
                  { option: { value: 'c', text: 'C' } },
                ],
              },
            },
            { span: { text: $.selected } },
          ],
        },
      }),
    })

    const select = el.querySelector('select')! as HTMLSelectElement
    expect(select.value).toBe('a')
    expect(el.querySelector('span')!.textContent).toBe('a')

    select.value = 'c'
    select.dispatchEvent(new Event('change'))
    await flush()

    expect(el.querySelector('span')!.textContent).toBe('c')
  })
})

// ---- Attribute binding ----

describe('attribute binding', () => {
  it('static attributes on element', () => {
    const { el } = mountApp({
      view: () => ({ a: { href: '/about', text: 'About' } }),
    })

    const a = el.querySelector('a')!
    expect(a.getAttribute('href')).toBe('/about')
    expect(a.textContent).toBe('About')
  })

  it('boolean true sets empty attribute, false removes it', () => {
    const { el } = mountApp({
      view: () => ({
        div: {
          children: [
            { button: { disabled: true, text: 'disabled' } },
            { button: { disabled: false, text: 'enabled' } },
          ],
        },
      }),
    })

    const buttons = el.querySelectorAll('button')
    expect(buttons[0].hasAttribute('disabled')).toBe(true)
    expect(buttons[0].getAttribute('disabled')).toBe('')
    expect(buttons[1].hasAttribute('disabled')).toBe(false)
  })

  it('URL sanitization: javascript: URL on href is sanitized to empty', () => {
    const { el } = mountApp({
      view: () => ({ a: { href: 'javascript:alert(1)', text: 'xss' } }),
    })

    const a = el.querySelector('a')!
    expect(a.getAttribute('href')).toBe('')
  })
})

// ---- Component rendering ----

describe('component rendering', () => {
  it('child component renders its view', () => {
    component('MyChild', {
      view: () => ({ span: 'child content' }),
    })

    const { el } = mountApp({
      view: () => ({
        div: {
          children: [{ MyChild: {} }],
        },
      }),
    })

    expect(el.querySelector('span')!.textContent).toBe('child content')
  })

  it('static props passed to child', () => {
    component('Greeting', {
      props: ['name'],
      view: ($: any) => ({ span: { text: $.name } }),
    })

    const { el } = mountApp({
      view: () => ({
        div: {
          children: [{ Greeting: { name: 'world' } }],
        },
      }),
    })

    expect(el.querySelector('span')!.textContent).toBe('world')
  })

  it('reactive shared props (parent state change updates child)', async () => {
    component('Display', {
      props: ['value'],
      view: ($: any) => ({ span: { text: $.value } }),
    })

    const { el } = mountApp({
      state: { count: 0 },
      methods: {
        inc() { this.count++ },
      },
      view: ($: any) => ({
        div: {
          children: [
            { Display: { value: $.count } },
            { button: { text: 'inc', click: 'inc' } },
          ],
        },
      }),
    })

    expect(el.querySelector('span')!.textContent).toBe('0')

    el.querySelector('button')!.click()
    await flush()

    expect(el.querySelector('span')!.textContent).toBe('1')
  })

  it('emit events from child to parent', async () => {
    component('ChildBtn', {
      methods: {
        doEmit() { this.emit('clicked', 'payload') },
      },
      view: ($: any) => ({ button: { text: 'child btn', click: 'doEmit' } }),
    })

    const { el } = mountApp({
      state: { received: '' },
      methods: {
        handleClicked(payload: string) { this.received = payload },
      },
      view: ($: any) => ({
        div: {
          children: [
            { ChildBtn: { on_clicked: 'handleClicked' } },
            { span: { text: $.received } },
          ],
        },
      }),
    })

    expect(el.querySelector('span')!.textContent).toBe('')

    el.querySelector('button')!.click()
    await flush()

    expect(el.querySelector('span')!.textContent).toBe('payload')
  })

  it('mount/unmount lifecycle callbacks fire', async () => {
    const mountSpy = vi.fn()
    const unmountSpy = vi.fn()

    component('Lifecycle', {
      mount: mountSpy,
      unmount: unmountSpy,
      view: () => ({ span: 'lifecycle' }),
    })

    const { el, app } = mountApp({
      view: () => ({
        div: {
          children: [{ Lifecycle: {} }],
        },
      }),
    })

    // mount is deferred via queueMicrotask
    await flush()
    expect(mountSpy).toHaveBeenCalledTimes(1)
    expect(unmountSpy).not.toHaveBeenCalled()

    app.destroy()
    cleanup = null // already destroyed
    el.remove()

    expect(unmountSpy).toHaveBeenCalledTimes(1)
  })
})

// ---- HTML binding ----

describe('html binding', () => {
  it('renders raw HTML without sanitization', () => {
    const { el } = mountApp({
      view: () => ({
        div: { html: '<b>bold</b><i>italic</i><iframe src="https://example.com"></iframe>' },
      }),
    })

    const div = el.querySelector('div')!
    expect(div.querySelector('b')!.textContent).toBe('bold')
    expect(div.querySelector('i')!.textContent).toBe('italic')
    expect(div.querySelector('iframe')).not.toBeNull()
  })

  it('reactive html updates on state change', async () => {
    const { el } = mountApp({
      state: { content: '<b>initial</b>' },
      methods: {
        update() { this.content = '<em>updated</em>' },
      },
      view: ($: any) => ({
        div: {
          children: [
            { div: { html: $.content } },
            { button: { text: 'update', click: 'update' } },
          ],
        },
      }),
    })

    const htmlDiv = el.querySelector('div > div')!
    expect(htmlDiv.querySelector('b')!.textContent).toBe('initial')

    el.querySelector('button')!.click()
    await flush()

    expect(htmlDiv.querySelector('em')!.textContent).toBe('updated')
    expect(htmlDiv.querySelector('b')).toBeNull()
  })
})
