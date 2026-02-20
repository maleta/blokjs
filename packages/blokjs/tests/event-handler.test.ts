import { describe, it, expect, afterEach } from 'vitest'
import { component, mount, store } from '../src/index'

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

describe('event handler - object syntax', () => {
  it('calls method with object handler', () => {
    let called = false
    const { el } = mountApp({
      methods: {
        doIt() { called = true },
      },
      view: () => ({
        button: { click: { handler: 'doIt' }, text: 'go' },
      }),
    })
    el.querySelector('button')!.click()
    expect(called).toBe(true)
  })

  it('calls preventDefault with prevent: true', () => {
    let defaultPrevented = false
    const { el } = mountApp({
      methods: {
        go() {},
      },
      view: () => ({
        a: { href: '#', click: { handler: 'go', prevent: true }, text: 'link' },
      }),
    })
    const link = el.querySelector('a')!
    link.addEventListener('click', (e) => {
      defaultPrevented = e.defaultPrevented
    })
    link.click()
    expect(defaultPrevented).toBe(true)
  })

  it('calls stopPropagation with stop: true', () => {
    let parentClicked = false
    const { el } = mountApp({
      methods: {
        parentClick() { parentClicked = true },
      },
      view: () => ({
        div: {
          click: 'parentClick',
          children: [
            { button: { click: { stop: true }, text: 'inner' } },
          ],
        },
      }),
    })
    el.querySelector('button')!.click()
    expect(parentClicked).toBe(false)
  })

  it('supports both prevent and stop together', () => {
    let defaultPrevented = false
    let parentClicked = false
    const { el } = mountApp({
      methods: {
        parentClick() { parentClicked = true },
        child() {},
      },
      view: () => ({
        div: {
          click: 'parentClick',
          children: [
            { a: { href: '#', click: { handler: 'child', prevent: true, stop: true }, text: 'link' } },
          ],
        },
      }),
    })
    const link = el.querySelector('a')!
    link.addEventListener('click', (e) => {
      defaultPrevented = e.defaultPrevented
    })
    link.click()
    expect(defaultPrevented).toBe(true)
    expect(parentClicked).toBe(false)
  })

  it('still supports old string syntax with dot modifiers', () => {
    let called = false
    let defaultPrevented = false
    const { el } = mountApp({
      methods: {
        go() { called = true },
      },
      view: () => ({
        a: { href: '#', 'click.prevent': 'go', text: 'link' },
      }),
    })
    const link = el.querySelector('a')!
    link.addEventListener('click', (e) => {
      defaultPrevented = e.defaultPrevented
    })
    link.click()
    expect(called).toBe(true)
    expect(defaultPrevented).toBe(true)
  })

  it('handles object handler with no handler string (modifier-only)', () => {
    let parentClicked = false
    const { el } = mountApp({
      methods: {
        parentClick() { parentClicked = true },
      },
      view: () => ({
        div: {
          click: 'parentClick',
          children: [
            { button: { click: { stop: true }, text: 'stop' } },
          ],
        },
      }),
    })
    el.querySelector('button')!.click()
    expect(parentClicked).toBe(false)
  })

  it('rejects non-string non-object handlers', () => {
    let clicked = false
    const { el } = mountApp({
      view: () => ({
        button: { click: 42 as any, text: 'bad' },
      }),
    })
    // Should not throw, just silently ignore
    el.querySelector('button')!.click()
    expect(clicked).toBe(false)
  })
})

describe('event handler - argument passing', () => {
  it('passes iteration variable as argument', () => {
    let received: any = null
    const { el } = mountApp({
      state: { items: [{ id: 1, name: 'a' }, { id: 2, name: 'b' }] },
      methods: {
        handler(val: any) { received = val },
      },
      view: ($: any) => ({
        div: { children: [
          { each: $.items, as: 'item', key: 'id', children: [
            { button: { click: 'handler(item)', text: 'click' } },
          ] },
        ] },
      }),
    })
    const buttons = el.querySelectorAll('button')
    buttons[1].click()
    expect(received).toEqual({ id: 2, name: 'b' })
  })

  it('passes nested path from iteration variable', () => {
    let received: any = null
    const { el } = mountApp({
      state: { items: [{ id: 1, name: 'first' }, { id: 2, name: 'second' }] },
      methods: {
        handler(val: any) { received = val },
      },
      view: ($: any) => ({
        div: { children: [
          { each: $.items, as: 'item', key: 'id', children: [
            { button: { click: 'handler(item.name)', text: 'click' } },
          ] },
        ] },
      }),
    })
    const buttons = el.querySelectorAll('button')
    buttons[0].click()
    expect(received).toBe('first')
  })

  it('passes number literal as argument', () => {
    let received: any = null
    const { el } = mountApp({
      methods: {
        handler(val: any) { received = val },
      },
      view: () => ({
        button: { click: 'handler(42)', text: 'click' },
      }),
    })
    el.querySelector('button')!.click()
    expect(received).toBe(42)
  })

  it('passes boolean literal as argument', () => {
    let received: any = null
    const { el } = mountApp({
      methods: {
        handler(val: any) { received = val },
      },
      view: () => ({
        button: { click: 'handler(true)', text: 'click' },
      }),
    })
    el.querySelector('button')!.click()
    expect(received).toBe(true)
  })

  it('passes string literal as argument', () => {
    let received: any = null
    const { el } = mountApp({
      methods: {
        handler(val: any) { received = val },
      },
      view: () => ({
        button: { click: "handler('hello')", text: 'click' },
      }),
    })
    el.querySelector('button')!.click()
    expect(received).toBe('hello')
  })

  it('passes mixed arguments', () => {
    let received: any[] = []
    const { el } = mountApp({
      state: { items: [{ id: 1, name: 'x' }] },
      methods: {
        handler(...args: any[]) { received = args },
      },
      view: ($: any) => ({
        div: { children: [
          { each: $.items, as: 'item', key: 'id', children: [
            { button: { click: 'handler(item, true, 42)', text: 'click' } },
          ] },
        ] },
      }),
    })
    el.querySelector('button')!.click()
    expect(received).toEqual([{ id: 1, name: 'x' }, true, 42])
  })

  it('passes event when no args specified (backward compat)', () => {
    let receivedEvent = false
    const { el } = mountApp({
      methods: {
        handler(e: any) { receivedEvent = e instanceof Event },
      },
      view: () => ({
        button: { click: 'handler', text: 'click' },
      }),
    })
    el.querySelector('button')!.click()
    expect(receivedEvent).toBe(true)
  })

  it('resolves state path as argument', () => {
    let received: any = null
    const { el } = mountApp({
      state: { count: 99 },
      methods: {
        handler(val: any) { received = val },
      },
      view: () => ({
        button: { click: 'handler(count)', text: 'click' },
      }),
    })
    el.querySelector('button')!.click()
    expect(received).toBe(99)
  })

  it('passes null literal as argument', () => {
    let received: any = 'not-null'
    const { el } = mountApp({
      methods: {
        handler(val: any) { received = val },
      },
      view: () => ({
        button: { click: 'handler(null)', text: 'click' },
      }),
    })
    el.querySelector('button')!.click()
    expect(received).toBe(null)
  })
})
