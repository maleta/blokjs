// The subset of the DOM the renderer uses, serializable to HTML without a browser

const VOID: Record<string, 1> = {
  area: 1, base: 1, br: 1, col: 1, embed: 1, hr: 1, img: 1, input: 1,
  link: 1, meta: 1, source: 1, track: 1, wbr: 1,
}
const RAW_TEXT: Record<string, 1> = { script: 1, style: 1 }
// Start tags that make the HTML parser close an open <p>
const CLOSES_P: Record<string, 1> = {
  address: 1, article: 1, aside: 1, blockquote: 1, details: 1, dialog: 1, div: 1, dl: 1, dd: 1, dt: 1,
  fieldset: 1, figcaption: 1, figure: 1, footer: 1, form: 1, h1: 1, h2: 1, h3: 1, h4: 1, h5: 1, h6: 1,
  header: 1, hgroup: 1, hr: 1, li: 1, main: 1, menu: 1, nav: 1, ol: 1, p: 1, pre: 1, section: 1,
  summary: 1, table: 1, ul: 1,
}
// Elements that end the parser's search for an open <p>
const P_SCOPE: Record<string, 1> = { button: 1, table: 1, td: 1, th: 1, caption: 1, template: 1, object: 1 }
const ATTR_NAME = /^[^\s"'<>/=\0]+$/

abstract class StringNode {
  abstract readonly nodeType: number
  parentNode: StringElement | null = null

  get nextSibling(): StringNode | null {
    const p = this.parentNode
    if (!p) return null
    return p.childNodes[p.childNodes.indexOf(this) + 1] ?? null
  }

  remove(): void {
    this.parentNode?.removeChild(this)
  }
}

export class StringText extends StringNode {
  readonly nodeType = 3
  constructor(public data: string) { super() }
  get textContent(): string { return this.data }
  set textContent(v: string) { this.data = v }
}

export class StringComment extends StringNode {
  readonly nodeType = 8
  constructor(public data: string) { super() }
}

// innerHTML content, emitted as-is
class StringRaw extends StringNode {
  readonly nodeType = 0
  constructor(public html: string) { super() }
}

class ClassList {
  constructor(private el: StringElement) {}

  private tokens(): string[] {
    return (this.el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)
  }

  add(...names: string[]): void {
    const t = this.tokens()
    for (const n of names) if (!t.includes(n)) t.push(n)
    this.el.setAttribute('class', t.join(' '))
  }

  remove(...names: string[]): void {
    this.el.setAttribute('class', this.tokens().filter(t => !names.includes(t)).join(' '))
  }

  toggle(name: string, force?: boolean): boolean {
    const on = force ?? !this.tokens().includes(name)
    if (on) this.add(name)
    else this.remove(name)
    return on
  }

  contains(name: string): boolean {
    return this.tokens().includes(name)
  }
}

class Style {
  raw = ''
  readonly props = new Map<string, string>()

  setProperty(name: string, value: string): void {
    if (value === '') this.props.delete(name)
    else this.props.set(name, value)
  }

  removeProperty(name: string): void {
    this.props.delete(name)
  }

  toString(): string {
    const parts = this.raw.trim() ? [this.raw.trim().replace(/;$/, '')] : []
    for (const [k, v] of this.props) parts.push(`${k}: ${v}`)
    return parts.join('; ')
  }
}

export class StringElement extends StringNode {
  readonly nodeType = 1
  readonly childNodes: StringNode[] = []
  readonly classList = new ClassList(this)
  readonly style = new Style()
  private attrs = new Map<string, string>()
  // Values written through properties, kept apart from attributes like in a browser; null until written
  liveValue: string | null = null
  liveChecked: boolean | null = null
  liveSelected: boolean | null = null

  constructor(readonly localName: string) { super() }

  get tagName(): string { return this.localName.toUpperCase() }
  get firstChild(): StringNode | null { return this.childNodes[0] ?? null }

  getAttribute(name: string): string | null {
    const n = name.toLowerCase()
    if (n === 'style') {
      const s = this.style.toString()
      return s === '' && !this.attrs.has('style') ? null : s
    }
    return this.attrs.get(n) ?? null
  }

  hasAttribute(name: string): boolean {
    return this.getAttribute(name) !== null
  }

  setAttribute(name: string, value: string): void {
    if (!ATTR_NAME.test(name)) throw new Error(`[blok] Invalid attribute name: ${name}`)
    const n = name.toLowerCase()
    if (n === 'style') {
      this.style.raw = String(value)
      this.style.props.clear()
    }
    this.attrs.set(n, String(value))
  }

  attributeNames(): string[] {
    const names = [...this.attrs.keys()]
    if (!this.attrs.has('style') && this.style.toString() !== '') names.push('style')
    return names
  }

  removeAttribute(name: string): void {
    const n = name.toLowerCase()
    if (n === 'style') {
      this.style.raw = ''
      this.style.props.clear()
    }
    this.attrs.delete(n)
  }

  get className(): string { return this.getAttribute('class') ?? '' }
  set className(v: string) { this.setAttribute('class', v) }

  get type(): string { return (this.getAttribute('type') ?? '').toLowerCase() }

  get value(): string {
    if (this.liveValue !== null) return this.liveValue
    if (this.localName === 'textarea') return this.textContent
    if (this.localName === 'option') return this.getAttribute('value') ?? this.textContent
    return this.getAttribute('value') ?? ''
  }
  set value(v: string) { this.liveValue = String(v) }

  get checked(): boolean { return this.liveChecked ?? this.hasAttribute('checked') }
  set checked(v: boolean) { this.liveChecked = !!v }

  get selected(): boolean { return this.liveSelected ?? this.hasAttribute('selected') }
  set selected(v: boolean) { this.liveSelected = !!v }

  get disabled(): boolean { return this.hasAttribute('disabled') }
  set disabled(v: boolean) { if (v) this.setAttribute('disabled', ''); else this.removeAttribute('disabled') }

  get hidden(): boolean { return this.hasAttribute('hidden') }
  set hidden(v: boolean) { if (v) this.setAttribute('hidden', ''); else this.removeAttribute('hidden') }

  get textContent(): string {
    let s = ''
    for (const c of this.childNodes) {
      if (c instanceof StringText) s += c.data
      else if (c instanceof StringElement) s += c.textContent
    }
    return s
  }
  set textContent(v: string) {
    this.clear()
    if (v !== '') this.appendChild(new StringText(v))
  }

  get innerHTML(): string { return serializeChildren(this) }
  set innerHTML(html: string) {
    this.clear()
    if (html !== '') this.appendChild(new StringRaw(html))
  }

  insertBefore<T extends StringNode>(node: T, ref: StringNode | null): T {
    node.parentNode?.removeChild(node)
    const idx = ref ? this.childNodes.indexOf(ref) : this.childNodes.length
    if (idx === -1) throw new Error('[blok] insertBefore: reference node is not a child')
    this.childNodes.splice(idx, 0, node)
    node.parentNode = this
    return node
  }

  appendChild<T extends StringNode>(node: T): T {
    return this.insertBefore(node, null)
  }

  append(...nodes: (StringNode | string)[]): void {
    for (const n of nodes) this.appendChild(typeof n === 'string' ? new StringText(n) : n)
  }

  removeChild<T extends StringNode>(node: T): T {
    const idx = this.childNodes.indexOf(node)
    if (idx === -1) throw new Error('[blok] removeChild: node is not a child')
    this.childNodes.splice(idx, 1)
    node.parentNode = null
    return node
  }

  addEventListener(): void {}
  removeEventListener(): void {}

  private clear(): void {
    for (const c of this.childNodes) c.parentNode = null
    this.childNodes.length = 0
  }
}

export interface StringDocument {
  createElement(tag: string): StringElement
  createTextNode(data: string): StringText
  createComment(data: string): StringComment
}

export function createStringDocument(): StringDocument {
  return {
    createElement: tag => new StringElement(tag.toLowerCase()),
    createTextNode: data => new StringText(String(data)),
    createComment: data => new StringComment(String(data)),
  }
}

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/ /g, '&nbsp;')
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/ /g, '&nbsp;')
}

interface SerializeState {
  warned: Set<string>
  inP: boolean
  select: StringElement | null
}

function warnOnce(state: SerializeState, msg: string): void {
  if (state.warned.has(msg)) return
  state.warned.add(msg)
  console.warn(`[blok] ${msg} The browser parser restructures this markup, so hydration falls back to a fresh render.`)
}

/** Serialize the children of `el` to HTML. */
export function serializeChildren(el: StringElement): string {
  return serializeKids(el, { warned: new Set(), inP: false, select: null })
}

function serializeKids(el: StringElement, state: SerializeState): string {
  let out = ''
  for (const c of el.childNodes) out += serializeNode(c, el, state)
  return out
}

function serializeNode(n: StringNode, parent: StringElement, state: SerializeState): string {
  if (n instanceof StringText) {
    return parent.localName in RAW_TEXT ? n.data.replace(/<\//g, '<\\/') : escapeText(n.data)
  }
  if (n instanceof StringComment) return `<!--${n.data.replace(/--!?>/g, '--&gt;')}-->`
  if (n instanceof StringRaw) return n.html.replace(/<script/gi, '&lt;script')
  if (!(n instanceof StringElement)) return ''

  const tag = n.localName
  if (tag === 'tr' && parent.localName === 'table') warnOnce(state, '<tr> directly inside <table>: wrap rows in <tbody>.')
  if (tag in CLOSES_P && state.inP) warnOnce(state, `<${tag}> inside <p>.`)
  if (tag === 'a' && hasAncestor(parent, 'a')) warnOnce(state, '<a> inside <a>.')

  // A select's value decides which option is selected
  const selectValue = tag === 'option' ? state.select?.liveValue ?? null : null
  const liveSelected = selectValue !== null ? n.value === selectValue : n.liveSelected
  const liveInputValue = tag === 'input' ? n.liveValue : null

  let attrs = ''
  for (const name of n.attributeNames()) {
    if (name === 'value' && liveInputValue !== null) continue
    if (name === 'checked' && n.liveChecked !== null) continue
    if (name === 'selected' && liveSelected !== null) continue
    const v = n.getAttribute(name)
    if (v !== null) attrs += v === '' ? ` ${name}` : ` ${name}="${escapeAttr(v)}"`
  }
  if (liveInputValue !== null) attrs += ` value="${escapeAttr(liveInputValue)}"`
  if (n.liveChecked) attrs += ' checked'
  if (liveSelected) attrs += ' selected'

  const open = `<${tag}${attrs}>`
  if (tag in VOID) return open

  let inner: string
  if (tag === 'textarea') {
    inner = escapeText(n.value)
  } else {
    inner = serializeKids(n, {
      warned: state.warned,
      inP: tag === 'p' || (state.inP && !(tag in P_SCOPE)),
      select: tag === 'select' ? n : state.select,
    })
  }
  // The parser drops one newline right after these start tags
  if ((tag === 'pre' || tag === 'textarea' || tag === 'listing') && inner.startsWith('\n')) inner = '\n' + inner
  return `${open}${inner}</${tag}>`
}

function hasAncestor(el: StringElement | null, tag: string): boolean {
  for (let e = el; e; e = e.parentNode) {
    if (e.localName === tag) return true
  }
  return false
}
