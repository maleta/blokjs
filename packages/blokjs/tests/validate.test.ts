import { describe, it, expect, vi, beforeEach } from 'vitest'
import { validate, validateComponentDef, validateMountOptions, validateStoreDef, validateTemplate } from '../src/validate'

// --- Public API (validate.*) returns arrays ---

describe('validate.component', () => {
  it('returns empty array for valid definition', () => {
    const w = validate.component('Test', {
      props: ['a'],
      state: { count: 0 },
      computed: { double() { return this.count * 2 } },
      watch: { count() {} },
      methods: { inc() { this.count++ } },
      mount() {},
      unmount() {},
      view: ($: any) => ({ div: { text: $.count } }),
    })
    expect(w).toEqual([])
  })

  it('returns warning for unknown property', () => {
    const w = validate.component('Bad', { veiw: () => ({}), view: () => ({}) } as any)
    expect(w).toHaveLength(1)
    expect(w[0]).toContain('Unknown property "veiw"')
  })

  it('returns warning when view is missing', () => {
    const w = validate.component('NoView', {} as any)
    expect(w).toHaveLength(1)
    expect(w[0]).toContain('missing the required "view"')
  })

  it('returns warning when view is not a function', () => {
    const w = validate.component('BadView', { view: 'not a function' } as any)
    expect(w).toHaveLength(1)
    expect(w[0]).toContain('"view" must be a function')
  })

  it('returns warnings for reserved state keys', () => {
    const w = validate.component('Reserved', {
      state: { store: null, loading: false },
      view: () => ({}),
    } as any)
    expect(w).toHaveLength(2)
    expect(w[0]).toContain('"store" in state')
    expect(w[1]).toContain('"loading" in state')
  })

  it('returns warning for state/computed collision', () => {
    const w = validate.component('Collision', {
      state: { count: 0 },
      computed: { count() { return 1 } },
      view: () => ({}),
    } as any)
    expect(w).toHaveLength(1)
    expect(w[0]).toContain('both state and computed')
  })

  it('returns warning for state/method collision', () => {
    const w = validate.component('Collision', {
      state: { save: '' },
      methods: { save() {} },
      view: () => ({}),
    } as any)
    expect(w).toHaveLength(1)
    expect(w[0]).toContain('both state and methods')
  })

  it('returns warning for non-function method', () => {
    const w = validate.component('BadMethod', {
      methods: { broken: 'not a fn' as any },
      view: () => ({}),
    })
    expect(w).toHaveLength(1)
    expect(w[0]).toContain('method "broken" is not a function')
  })

  it('returns warning for non-function computed', () => {
    const w = validate.component('BadComputed', {
      computed: { val: 42 as any },
      view: () => ({}),
    })
    expect(w).toHaveLength(1)
    expect(w[0]).toContain('computed "val" is not a function')
  })

  it('returns warning for non-function watcher', () => {
    const w = validate.component('BadWatch', {
      watch: { count: true as any },
      view: () => ({}),
    })
    expect(w).toHaveLength(1)
    expect(w[0]).toContain('watcher "count" is not a function')
  })

  it('returns warning for non-function mount hook', () => {
    const w = validate.component('BadHook', {
      mount: 'oops' as any,
      view: () => ({}),
    })
    expect(w).toHaveLength(1)
    expect(w[0]).toContain('"mount" must be a function')
  })

  it('returns warning for non-function unmount hook', () => {
    const w = validate.component('BadHook', {
      unmount: 123 as any,
      view: () => ({}),
    })
    expect(w).toHaveLength(1)
    expect(w[0]).toContain('"unmount" must be a function')
  })
})

describe('validate.mount', () => {
  it('returns empty array for valid options', () => {
    const w = validate.mount({
      state: { count: 0 },
      routes: [{ path: '/', component: 'Home' }],
      guards: { auth() { return true } },
      mode: 'hash',
      view: () => ({}),
    })
    expect(w).toEqual([])
  })

  it('returns warning for unknown option', () => {
    const w = validate.mount({ view: () => ({}), plugin: true })
    expect(w).toHaveLength(1)
    expect(w[0]).toContain('Unknown mount option "plugin"')
  })

  it('returns warning when view is missing', () => {
    const w = validate.mount({ state: { x: 1 } })
    expect(w).toHaveLength(1)
    expect(w[0]).toContain('missing the required "view"')
  })

  it('returns warning for invalid router mode', () => {
    const w = validate.mount({ view: () => ({}), mode: 'pushState' })
    expect(w).toHaveLength(1)
    expect(w[0]).toContain('Invalid router mode "pushState"')
  })

  it('validates state keys', () => {
    const w = validate.mount({ view: () => ({}), state: { emit: 'bad' } })
    expect(w).toHaveLength(1)
    expect(w[0]).toContain('"emit" in state')
  })
})

describe('validate.store', () => {
  it('returns empty array for valid store', () => {
    const w = validate.store('auth', {
      state: { user: null },
      computed: { isLoggedIn() { return this.user !== null } },
      methods: { logout() { this.user = null } },
    })
    expect(w).toEqual([])
  })

  it('returns warning for unknown property', () => {
    const w = validate.store('bad', { state: {}, view: () => ({}) } as any)
    expect(w).toHaveLength(1)
    expect(w[0]).toContain('Unknown property "view" in store "bad"')
  })
})

describe('validate.template', () => {
  it('returns empty array for valid template keys', () => {
    const w = validate.template('div', {
      text: 'hello', class: 'box', style: { color: 'red' },
      children: [], when: true, ref: 'myRef',
    }, {})
    expect(w).toEqual([])
  })

  it('accepts event names', () => {
    const w = validate.template('button', { click: 'handle', submit: 'save' }, { handle() {}, save() {} })
    expect(w).toEqual([])
  })

  it('accepts event with modifiers', () => {
    const w = validate.template('a', { 'click.prevent': 'navigate' }, { navigate() {} })
    expect(w).toEqual([])
  })

  it('accepts on_ prefixed component events', () => {
    const w = validate.template('MyComp', { on_remove: 'handleRemove' }, { handleRemove() {} })
    expect(w).toEqual([])
  })

  it('accepts HTML attributes', () => {
    const w = validate.template('input', { type: 'text', placeholder: 'Name', disabled: true }, {})
    expect(w).toEqual([])
  })

  it('detects case-mismatch typo', () => {
    const w = validate.template('div', { Children: [] }, {})
    expect(w).toHaveLength(1)
    expect(w[0]).toContain('did you mean "children"')
  })

  it('detects 1-char-off typo', () => {
    const w = validate.template('div', { childrn: [] }, {})
    expect(w).toHaveLength(1)
    expect(w[0]).toContain('did you mean "children"')
  })

  it('detects transposition typo', () => {
    const w = validate.template('div', { chlidren: [] }, {})
    expect(w).toHaveLength(1)
    expect(w[0]).toContain('did you mean "children"')
  })

  it('does not flag legitimate short attributes', () => {
    const w = validate.template('input', { id: 'foo', src: 'bar' }, {})
    expect(w).toEqual([])
  })

  it('returns warning for undefined method in event handler', () => {
    const w = validate.template('button', { click: 'nonExistent' }, { save() {} })
    expect(w).toHaveLength(1)
    expect(w[0]).toContain('references method "nonExistent" which is not defined')
  })

  it('ignores assignment expressions', () => {
    const w = validate.template('button', { click: 'count = 0' }, {})
    expect(w).toEqual([])
  })

  it('ignores object handlers', () => {
    const w = validate.template('a', { click: { handler: 'nav', prevent: true } }, { nav() {} })
    expect(w).toEqual([])
  })

  it('ignores events when methods is undefined', () => {
    const w = validate.template('button', { click: 'save' }, undefined)
    expect(w).toEqual([])
  })
})

// --- Runtime hooks (console.warn wrappers) ---

describe('runtime validators (console.warn)', () => {
  let warnings: string[]

  beforeEach(() => {
    warnings = []
    vi.spyOn(console, 'warn').mockImplementation((msg: string) => {
      warnings.push(msg)
    })
  })

  it('validateComponentDef emits console.warn with prefix', () => {
    validateComponentDef('X', {} as any)
    expect(warnings.length).toBeGreaterThan(0)
    expect(warnings[0]).toMatch(/^\[blok warn\]/)
  })

  it('validateMountOptions emits console.warn with prefix', () => {
    validateMountOptions({ state: { x: 1 } })
    expect(warnings.length).toBeGreaterThan(0)
    expect(warnings[0]).toMatch(/^\[blok warn\]/)
  })

  it('validateStoreDef emits console.warn with prefix', () => {
    validateStoreDef('x', { view: true } as any)
    expect(warnings.length).toBeGreaterThan(0)
    expect(warnings[0]).toMatch(/^\[blok warn\]/)
  })

  it('validateTemplate emits console.warn with prefix', () => {
    validateTemplate('button', { click: 'missing' }, { other() {} })
    expect(warnings.length).toBeGreaterThan(0)
    expect(warnings[0]).toMatch(/^\[blok warn\]/)
  })
})
