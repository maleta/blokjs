import { describe, it, expect, afterEach } from 'vitest'
import { mount } from '../src/index'

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

// Helper: count elements by tag inside a root
function count(root: Element, tag: string): number {
  return root.querySelectorAll(tag).length
}

function texts(root: Element, tag: string): string[] {
  return [...root.querySelectorAll(tag)].map((e) => e.textContent || '')
}

// =========================================================================
// when > when > when
// =========================================================================

describe('when > when > when', () => {
  function setup() {
    return mountApp({
      state: { a: true, b: true, c: true },
      methods: {
        toggleA() { this.a = !this.a },
        toggleB() { this.b = !this.b },
        toggleC() { this.c = !this.c },
      },
      view: ($: any) => ({
        div: {
          children: [
            {
              when: $.a,
              children: [
                { span: 'L1' },
                {
                  when: $.b,
                  children: [
                    { span: 'L2' },
                    {
                      when: $.c,
                      children: [{ span: 'L3' }],
                    },
                  ],
                },
              ],
            },
            { button: { id: 'a', click: 'toggleA' } },
            { button: { id: 'b', click: 'toggleB' } },
            { button: { id: 'c', click: 'toggleC' } },
          ],
        },
      }),
    })
  }

  it('initial render shows all three levels', () => {
    const { el } = setup()
    expect(texts(el, 'span')).toEqual(['L1', 'L2', 'L3'])
  })

  it('toggle innermost (c) off/on', async () => {
    const { el } = setup()
    el.querySelector<HTMLElement>('#c')!.click()
    await flush()
    expect(texts(el, 'span')).toEqual(['L1', 'L2'])

    el.querySelector<HTMLElement>('#c')!.click()
    await flush()
    expect(texts(el, 'span')).toEqual(['L1', 'L2', 'L3'])
  })

  it('toggle middle (b) off/on', async () => {
    const { el } = setup()
    el.querySelector<HTMLElement>('#b')!.click()
    await flush()
    expect(texts(el, 'span')).toEqual(['L1'])

    el.querySelector<HTMLElement>('#b')!.click()
    await flush()
    expect(texts(el, 'span')).toEqual(['L1', 'L2', 'L3'])
  })

  it('toggle outermost (a) off/on', async () => {
    const { el } = setup()
    el.querySelector<HTMLElement>('#a')!.click()
    await flush()
    expect(count(el, 'span')).toBe(0)

    el.querySelector<HTMLElement>('#a')!.click()
    await flush()
    expect(texts(el, 'span')).toEqual(['L1', 'L2', 'L3'])
  })

  it('toggle inner then outer does not leak nodes', async () => {
    const { el } = setup()
    // Toggle c off/on so inner when replaces its nodes
    el.querySelector<HTMLElement>('#c')!.click()
    await flush()
    el.querySelector<HTMLElement>('#c')!.click()
    await flush()
    expect(count(el, 'span')).toBe(3)

    // Now toggle a off - must clean up everything
    el.querySelector<HTMLElement>('#a')!.click()
    await flush()
    expect(count(el, 'span')).toBe(0)
  })

  it('toggle middle then outer does not leak nodes', async () => {
    const { el } = setup()
    el.querySelector<HTMLElement>('#b')!.click()
    await flush()
    el.querySelector<HTMLElement>('#b')!.click()
    await flush()

    el.querySelector<HTMLElement>('#a')!.click()
    await flush()
    expect(count(el, 'span')).toBe(0)
  })

  it('toggle inner, then middle, then outer - no leaks', async () => {
    const { el } = setup()
    el.querySelector<HTMLElement>('#c')!.click()
    await flush()
    el.querySelector<HTMLElement>('#c')!.click()
    await flush()

    el.querySelector<HTMLElement>('#b')!.click()
    await flush()
    el.querySelector<HTMLElement>('#b')!.click()
    await flush()

    el.querySelector<HTMLElement>('#a')!.click()
    await flush()
    expect(count(el, 'span')).toBe(0)

    el.querySelector<HTMLElement>('#a')!.click()
    await flush()
    expect(texts(el, 'span')).toEqual(['L1', 'L2', 'L3'])
  })
})

// =========================================================================
// when > when > each
// =========================================================================

describe('when > when > each', () => {
  function setup() {
    return mountApp({
      state: { a: true, b: true, items: [{ id: 1, t: 'X' }, { id: 2, t: 'Y' }] },
      methods: {
        toggleA() { this.a = !this.a },
        toggleB() { this.b = !this.b },
        addItem() { this.items.push({ id: 3, t: 'Z' }) },
        clearItems() { this.items = [] },
      },
      view: ($: any) => ({
        div: {
          children: [
            {
              when: $.a,
              children: [
                { span: 'L1' },
                {
                  when: $.b,
                  children: [
                    { each: $.items, as: 'it', key: 'id', children: [{ b: { text: $.it.t } }] },
                  ],
                },
              ],
            },
            { button: { id: 'a', click: 'toggleA' } },
            { button: { id: 'b', click: 'toggleB' } },
            { button: { id: 'add', click: 'addItem' } },
            { button: { id: 'clear', click: 'clearItems' } },
          ],
        },
      }),
    })
  }

  it('initial render', () => {
    const { el } = setup()
    expect(count(el, 'span')).toBe(1)
    expect(texts(el, 'b')).toEqual(['X', 'Y'])
  })

  it('mutate list then toggle outer off - no leaks', async () => {
    const { el } = setup()
    el.querySelector<HTMLElement>('#add')!.click()
    await flush()
    expect(texts(el, 'b')).toEqual(['X', 'Y', 'Z'])

    el.querySelector<HTMLElement>('#a')!.click()
    await flush()
    expect(count(el, 'b')).toBe(0)
    expect(count(el, 'span')).toBe(0)
  })

  it('toggle middle off/on then outer off - no leaks', async () => {
    const { el } = setup()
    el.querySelector<HTMLElement>('#b')!.click()
    await flush()
    el.querySelector<HTMLElement>('#b')!.click()
    await flush()

    el.querySelector<HTMLElement>('#a')!.click()
    await flush()
    expect(count(el, 'b')).toBe(0)
  })

  it('clear list then toggle outer off/on restores empty', async () => {
    const { el } = setup()
    el.querySelector<HTMLElement>('#clear')!.click()
    await flush()
    expect(count(el, 'b')).toBe(0)

    el.querySelector<HTMLElement>('#a')!.click()
    await flush()
    el.querySelector<HTMLElement>('#a')!.click()
    await flush()
    expect(count(el, 'b')).toBe(0)
    expect(count(el, 'span')).toBe(1)
  })
})

// =========================================================================
// when > each > when
// =========================================================================

describe('when > each > when', () => {
  function setup() {
    return mountApp({
      state: {
        show: true,
        items: [{ id: 1, t: 'A' }, { id: 2, t: 'B' }],
        detail: true,
      },
      methods: {
        toggleShow() { this.show = !this.show },
        toggleDetail() { this.detail = !this.detail },
        addItem() { this.items.push({ id: 3, t: 'C' }) },
      },
      view: ($: any) => ({
        div: {
          children: [
            {
              when: $.show,
              children: [
                {
                  each: $.items, as: 'it', key: 'id',
                  children: [
                    { span: { text: $.it.t } },
                    { when: $.detail, children: [{ em: { text: $.it.t } }] },
                  ],
                },
              ],
            },
            { button: { id: 'show', click: 'toggleShow' } },
            { button: { id: 'detail', click: 'toggleDetail' } },
            { button: { id: 'add', click: 'addItem' } },
          ],
        },
      }),
    })
  }

  it('initial render: each item has span + em', () => {
    const { el } = setup()
    expect(texts(el, 'span')).toEqual(['A', 'B'])
    expect(texts(el, 'em')).toEqual(['A', 'B'])
  })

  it('toggle inner when (detail) off/on', async () => {
    const { el } = setup()
    el.querySelector<HTMLElement>('#detail')!.click()
    await flush()
    expect(texts(el, 'span')).toEqual(['A', 'B'])
    expect(count(el, 'em')).toBe(0)

    el.querySelector<HTMLElement>('#detail')!.click()
    await flush()
    expect(texts(el, 'em')).toEqual(['A', 'B'])
  })

  it('toggle detail then outer off - no leaked em tags', async () => {
    const { el } = setup()
    el.querySelector<HTMLElement>('#detail')!.click()
    await flush()
    el.querySelector<HTMLElement>('#detail')!.click()
    await flush()

    el.querySelector<HTMLElement>('#show')!.click()
    await flush()
    expect(count(el, 'span')).toBe(0)
    expect(count(el, 'em')).toBe(0)
  })

  it('add item while detail on, then toggle outer off/on', async () => {
    const { el } = setup()
    el.querySelector<HTMLElement>('#add')!.click()
    await flush()
    expect(texts(el, 'em')).toEqual(['A', 'B', 'C'])

    el.querySelector<HTMLElement>('#show')!.click()
    await flush()
    expect(count(el, 'em')).toBe(0)

    el.querySelector<HTMLElement>('#show')!.click()
    await flush()
    expect(texts(el, 'em')).toEqual(['A', 'B', 'C'])
  })
})

// =========================================================================
// when > each > each
// =========================================================================

describe('when > each > each', () => {
  function setup() {
    return mountApp({
      state: {
        show: true,
        groups: [
          { id: 1, name: 'G1', tags: ['x', 'y'] },
          { id: 2, name: 'G2', tags: ['z'] },
        ],
      },
      methods: {
        toggleShow() { this.show = !this.show },
      },
      view: ($: any) => ({
        div: {
          children: [
            {
              when: $.show,
              children: [
                {
                  each: $.groups, as: 'g', key: 'id',
                  children: [
                    { b: { text: $.g.name } },
                    {
                      each: $.g.tags, as: 'tag',
                      children: [{ em: { text: $.tag } }],
                    },
                  ],
                },
              ],
            },
            { button: { id: 'toggle', click: 'toggleShow' } },
          ],
        },
      }),
    })
  }

  it('initial render shows nested lists', () => {
    const { el } = setup()
    expect(texts(el, 'b')).toEqual(['G1', 'G2'])
    expect(texts(el, 'em')).toEqual(['x', 'y', 'z'])
  })

  it('toggle outer off/on preserves structure', async () => {
    const { el } = setup()
    el.querySelector<HTMLElement>('#toggle')!.click()
    await flush()
    expect(count(el, 'b')).toBe(0)
    expect(count(el, 'em')).toBe(0)

    el.querySelector<HTMLElement>('#toggle')!.click()
    await flush()
    expect(texts(el, 'b')).toEqual(['G1', 'G2'])
    expect(texts(el, 'em')).toEqual(['x', 'y', 'z'])
  })
})

// =========================================================================
// each > when > when
// =========================================================================

describe('each > when > when', () => {
  function setup() {
    return mountApp({
      state: {
        items: [{ id: 1, t: 'A' }, { id: 2, t: 'B' }],
        mid: true,
        inner: true,
      },
      methods: {
        toggleMid() { this.mid = !this.mid },
        toggleInner() { this.inner = !this.inner },
        removeFirst() { this.items.shift() },
        addItem() { this.items.push({ id: 3, t: 'C' }) },
      },
      view: ($: any) => ({
        div: {
          children: [
            {
              each: $.items, as: 'it', key: 'id',
              children: [
                { span: { text: $.it.t } },
                {
                  when: $.mid,
                  children: [
                    { b: { text: $.it.t } },
                    {
                      when: $.inner,
                      children: [{ em: { text: $.it.t } }],
                    },
                  ],
                },
              ],
            },
            { button: { id: 'mid', click: 'toggleMid' } },
            { button: { id: 'inner', click: 'toggleInner' } },
            { button: { id: 'rm', click: 'removeFirst' } },
            { button: { id: 'add', click: 'addItem' } },
          ],
        },
      }),
    })
  }

  it('initial render: each item has span + b + em', () => {
    const { el } = setup()
    expect(texts(el, 'span')).toEqual(['A', 'B'])
    expect(texts(el, 'b')).toEqual(['A', 'B'])
    expect(texts(el, 'em')).toEqual(['A', 'B'])
  })

  it('toggle inner when off/on inside each', async () => {
    const { el } = setup()
    el.querySelector<HTMLElement>('#inner')!.click()
    await flush()
    expect(count(el, 'em')).toBe(0)
    expect(texts(el, 'b')).toEqual(['A', 'B'])

    el.querySelector<HTMLElement>('#inner')!.click()
    await flush()
    expect(texts(el, 'em')).toEqual(['A', 'B'])
  })

  it('toggle inner, then remove item - no leaked nodes', async () => {
    const { el } = setup()
    el.querySelector<HTMLElement>('#inner')!.click()
    await flush()
    el.querySelector<HTMLElement>('#inner')!.click()
    await flush()

    el.querySelector<HTMLElement>('#rm')!.click()
    await flush()
    expect(texts(el, 'span')).toEqual(['B'])
    expect(texts(el, 'b')).toEqual(['B'])
    expect(texts(el, 'em')).toEqual(['B'])
  })

  it('toggle mid off cleans up inner when nodes too', async () => {
    const { el } = setup()
    el.querySelector<HTMLElement>('#inner')!.click()
    await flush()
    el.querySelector<HTMLElement>('#inner')!.click()
    await flush()

    el.querySelector<HTMLElement>('#mid')!.click()
    await flush()
    expect(count(el, 'b')).toBe(0)
    expect(count(el, 'em')).toBe(0)
    expect(texts(el, 'span')).toEqual(['A', 'B'])
  })
})

// =========================================================================
// each > when > each
// =========================================================================

describe('each > when > each', () => {
  function setup() {
    return mountApp({
      state: {
        rows: [
          { id: 1, label: 'R1', tags: ['a', 'b'] },
          { id: 2, label: 'R2', tags: ['c'] },
        ],
        expanded: true,
      },
      methods: {
        toggleExpanded() { this.expanded = !this.expanded },
        removeFirst() { this.rows.shift() },
      },
      view: ($: any) => ({
        div: {
          children: [
            {
              each: $.rows, as: 'row', key: 'id',
              children: [
                { span: { text: $.row.label } },
                {
                  when: $.expanded,
                  children: [
                    {
                      each: $.row.tags, as: 'tag',
                      children: [{ em: { text: $.tag } }],
                    },
                  ],
                },
              ],
            },
            { button: { id: 'expand', click: 'toggleExpanded' } },
            { button: { id: 'rm', click: 'removeFirst' } },
          ],
        },
      }),
    })
  }

  it('initial render', () => {
    const { el } = setup()
    expect(texts(el, 'span')).toEqual(['R1', 'R2'])
    expect(texts(el, 'em')).toEqual(['a', 'b', 'c'])
  })

  it('toggle expanded off/on', async () => {
    const { el } = setup()
    el.querySelector<HTMLElement>('#expand')!.click()
    await flush()
    expect(count(el, 'em')).toBe(0)

    el.querySelector<HTMLElement>('#expand')!.click()
    await flush()
    expect(texts(el, 'em')).toEqual(['a', 'b', 'c'])
  })

  it('toggle expanded then remove row - no leaked tags', async () => {
    const { el } = setup()
    el.querySelector<HTMLElement>('#expand')!.click()
    await flush()
    el.querySelector<HTMLElement>('#expand')!.click()
    await flush()

    el.querySelector<HTMLElement>('#rm')!.click()
    await flush()
    expect(texts(el, 'span')).toEqual(['R2'])
    expect(texts(el, 'em')).toEqual(['c'])
  })
})

// =========================================================================
// each > each > when
// =========================================================================

describe('each > each > when', () => {
  function setup() {
    return mountApp({
      state: {
        groups: [
          { id: 1, items: [{ id: 10, t: 'A' }, { id: 11, t: 'B' }] },
          { id: 2, items: [{ id: 20, t: 'C' }] },
        ],
        detail: true,
      },
      methods: {
        toggleDetail() { this.detail = !this.detail },
        removeGroup() { this.groups.shift() },
      },
      view: ($: any) => ({
        div: {
          children: [
            {
              each: $.groups, as: 'g', key: 'id',
              children: [
                {
                  each: $.g.items, as: 'it', key: 'id',
                  children: [
                    { span: { text: $.it.t } },
                    { when: $.detail, children: [{ em: { text: $.it.t } }] },
                  ],
                },
              ],
            },
            { button: { id: 'detail', click: 'toggleDetail' } },
            { button: { id: 'rm', click: 'removeGroup' } },
          ],
        },
      }),
    })
  }

  it('initial render', () => {
    const { el } = setup()
    expect(texts(el, 'span')).toEqual(['A', 'B', 'C'])
    expect(texts(el, 'em')).toEqual(['A', 'B', 'C'])
  })

  it('toggle detail off/on', async () => {
    const { el } = setup()
    el.querySelector<HTMLElement>('#detail')!.click()
    await flush()
    expect(count(el, 'em')).toBe(0)

    el.querySelector<HTMLElement>('#detail')!.click()
    await flush()
    expect(texts(el, 'em')).toEqual(['A', 'B', 'C'])
  })

  it('toggle detail then remove group - no leaks', async () => {
    const { el } = setup()
    el.querySelector<HTMLElement>('#detail')!.click()
    await flush()
    el.querySelector<HTMLElement>('#detail')!.click()
    await flush()

    el.querySelector<HTMLElement>('#rm')!.click()
    await flush()
    expect(texts(el, 'span')).toEqual(['C'])
    expect(texts(el, 'em')).toEqual(['C'])
  })
})

// =========================================================================
// each > each > each
// =========================================================================

describe('each > each > each', () => {
  function setup() {
    return mountApp({
      state: {
        tables: [
          {
            id: 1,
            rows: [
              { id: 10, cells: ['a', 'b'] },
              { id: 11, cells: ['c'] },
            ],
          },
        ],
      },
      methods: {
        addCell() { this.tables[0].rows[0].cells.push('d') },
        removeTable() { this.tables = [] },
      },
      view: ($: any) => ({
        div: {
          children: [
            {
              each: $.tables, as: 'table', key: 'id',
              children: [
                {
                  each: $.table.rows, as: 'row', key: 'id',
                  children: [
                    {
                      each: $.row.cells, as: 'cell',
                      children: [{ em: { text: $.cell } }],
                    },
                  ],
                },
              ],
            },
            { button: { id: 'add', click: 'addCell' } },
            { button: { id: 'rm', click: 'removeTable' } },
          ],
        },
      }),
    })
  }

  it('initial render', () => {
    const { el } = setup()
    expect(texts(el, 'em')).toEqual(['a', 'b', 'c'])
  })

  it('mutate inner list then remove outer - no leaks', async () => {
    const { el } = setup()
    el.querySelector<HTMLElement>('#add')!.click()
    await flush()
    expect(texts(el, 'em')).toEqual(['a', 'b', 'd', 'c'])

    el.querySelector<HTMLElement>('#rm')!.click()
    await flush()
    expect(count(el, 'em')).toBe(0)
  })
})

// =========================================================================
// Mixed: element-level when inside when inside each
// =========================================================================

describe('each > when > element-level when', () => {
  function setup() {
    return mountApp({
      state: {
        items: [{ id: 1, t: 'A' }, { id: 2, t: 'B' }],
        show: true,
        highlight: true,
      },
      methods: {
        toggleShow() { this.show = !this.show },
        toggleHighlight() { this.highlight = !this.highlight },
        removeFirst() { this.items.shift() },
      },
      view: ($: any) => ({
        div: {
          children: [
            {
              each: $.items, as: 'it', key: 'id',
              children: [
                { span: { text: $.it.t } },
                {
                  when: $.show,
                  children: [
                    { div: { when: $.highlight, text: $.it.t, class: 'hl' } },
                  ],
                },
              ],
            },
            { button: { id: 'show', click: 'toggleShow' } },
            { button: { id: 'hl', click: 'toggleHighlight' } },
            { button: { id: 'rm', click: 'removeFirst' } },
          ],
        },
      }),
    })
  }

  it('initial render', () => {
    const { el } = setup()
    expect(count(el, '.hl')).toBe(2)
  })

  it('toggle highlight off/on inside when inside each', async () => {
    const { el } = setup()
    el.querySelector<HTMLElement>('#hl')!.click()
    await flush()
    expect(count(el, '.hl')).toBe(0)

    el.querySelector<HTMLElement>('#hl')!.click()
    await flush()
    expect(count(el, '.hl')).toBe(2)
  })

  it('toggle all layers then remove item - no leaks', async () => {
    const { el } = setup()
    el.querySelector<HTMLElement>('#hl')!.click()
    await flush()
    el.querySelector<HTMLElement>('#hl')!.click()
    await flush()
    el.querySelector<HTMLElement>('#show')!.click()
    await flush()
    el.querySelector<HTMLElement>('#show')!.click()
    await flush()

    el.querySelector<HTMLElement>('#rm')!.click()
    await flush()
    expect(count(el, 'span')).toBe(1)
    expect(count(el, '.hl')).toBe(1)
  })
})

// =========================================================================
// Stress: rapid toggling at all levels
// =========================================================================

describe('stress: rapid multi-level toggling', () => {
  it('rapid inner/outer toggling produces correct final state', async () => {
    const { el } = mountApp({
      state: { a: true, b: true, c: true },
      methods: {
        toggleA() { this.a = !this.a },
        toggleB() { this.b = !this.b },
        toggleC() { this.c = !this.c },
      },
      view: ($: any) => ({
        div: {
          children: [
            {
              when: $.a,
              children: [
                {
                  when: $.b,
                  children: [
                    { when: $.c, children: [{ span: 'deep' }] },
                  ],
                },
              ],
            },
            { button: { id: 'a', click: 'toggleA' } },
            { button: { id: 'b', click: 'toggleB' } },
            { button: { id: 'c', click: 'toggleC' } },
          ],
        },
      }),
    })

    // Rapid toggles without awaiting between some
    el.querySelector<HTMLElement>('#c')!.click()
    el.querySelector<HTMLElement>('#c')!.click()
    el.querySelector<HTMLElement>('#b')!.click()
    await flush()
    expect(count(el, 'span')).toBe(0) // b is false

    el.querySelector<HTMLElement>('#b')!.click()
    await flush()
    expect(count(el, 'span')).toBe(1) // all true again

    el.querySelector<HTMLElement>('#a')!.click()
    el.querySelector<HTMLElement>('#c')!.click()
    await flush()
    expect(count(el, 'span')).toBe(0) // a is false

    el.querySelector<HTMLElement>('#a')!.click()
    await flush()
    // a true, b true, c false
    expect(count(el, 'span')).toBe(0)

    el.querySelector<HTMLElement>('#c')!.click()
    await flush()
    expect(count(el, 'span')).toBe(1)
  })
})
