import { BlokRef, isRef, createRef as createRefForInstance } from './ref-proxy'
import { Scope } from './scope'
import { createEffect, untracked } from './reactive'
import {
  ComponentInstance, resolveOnInstance, setOnInstance,
  createInstance, setupWatchers, RESERVED_CONTEXT_KEYS,
} from './component'
import { setRawHTML, sanitizeURL } from './sanitize'
import { validateTemplate } from './validate'

declare const __DEV__: boolean
const SUSPICIOUS_HTML = /<script[\s>]|on\w+\s*=/i

export interface RenderCtx {
  inst: ComponentInstance
  scope: Scope
  iterVars: Map<string, () => any>
}

const EVENT_NAMES: Record<string, 1> = {
  click: 1, dblclick: 1, mousedown: 1, mouseup: 1, mousemove: 1, mouseenter: 1, mouseleave: 1,
  keydown: 1, keyup: 1, keypress: 1, input: 1, change: 1, submit: 1, focus: 1, blur: 1,
  scroll: 1, resize: 1, touchstart: 1, touchend: 1, touchmove: 1,
  dragstart: 1, dragend: 1, dragover: 1, dragleave: 1, drop: 1,
}

// Resolve a ref (or static value) to its current value
export function resolve(val: any, ctx: RenderCtx): any {
  if (!isRef(val)) return val

  const ref = val as BlokRef
  const path = ref.path
  if (path.length === 0) return undefined

  // Check iteration scope
  if (ctx.iterVars.has(path[0])) {
    let v = ctx.iterVars.get(path[0])!()
    for (let i = 1; i < path.length; i++) {
      if (v == null) return ref.negate ? true : undefined
      v = v[path[i]]
    }
    return ref.negate ? !v : v
  }

  const v = resolveOnInstance(ctx.inst, path)
  return ref.negate ? !v : v
}

function resolveWrite(ref: BlokRef, ctx: RenderCtx, value: any): void {
  const path = ref.path
  if (path.length === 0) return

  // Iteration variable write
  if (ctx.iterVars.has(path[0])) {
    const root = ctx.iterVars.get(path[0])!()
    if (path.length === 1) return
    let target = root
    for (let i = 1; i < path.length - 1; i++) {
      if (target == null) return
      target = target[path[i]]
    }
    if (target != null) {
      target[path[path.length - 1]] = value
    }
    return
  }

  setOnInstance(ctx.inst, path, value)
}

// Classify a template node
const CONTROL: Record<string, 1> = { when: 1, each: 1, as: 1, key: 1, children: 1 }

function classify(tpl: any): { type: 'when' } | { type: 'each' } | { type: 'element'; tag: string; value: any } {
  if (tpl == null || typeof tpl !== 'object') return { type: 'element', tag: 'span', value: String(tpl ?? '') }

  for (const k of Object.keys(tpl)) {
    if (!(k in CONTROL)) return { type: 'element', tag: k, value: tpl[k] }
  }

  if ('each' in tpl) return { type: 'each' }
  if ('when' in tpl) return { type: 'when' }
  return { type: 'element', tag: 'div', value: null }
}

function isComponentTag(tag: string): boolean {
  return tag[0] === tag[0].toUpperCase() && tag[0] !== tag[0].toLowerCase()
}

// Main render entry
export function renderNodes(templates: any[], ctx: RenderCtx): Node[] {
  const result: Node[] = []
  for (const tpl of templates) result.push(...renderNode(tpl, ctx))
  return result
}

export function renderNode(tpl: any, ctx: RenderCtx): Node[] {
  if (tpl == null) return []
  if (typeof tpl === 'string') return [document.createTextNode(tpl)]

  const info = classify(tpl)
  if (info.type === 'when') return renderWhen(tpl, ctx)
  if (info.type === 'each') return renderEach(tpl, ctx)

  const { tag, value } = info as { tag: string; value: any }

  if (tag === 'template' && typeof value === 'object' && value?.slot) return []
  if (isComponentTag(tag)) return renderComponent(tag, value || {}, ctx)

  return renderElement(tag, value, ctx)
}

function renderElement(tag: string, value: any, ctx: RenderCtx): Node[] {
  if (typeof value === 'string') {
    const el = document.createElement(tag)
    el.textContent = value
    return [el]
  }
  if (isRef(value)) {
    const el = document.createElement(tag)
    setupTextBinding(el, value, ctx)
    return [el]
  }
  if (value == null || typeof value === 'boolean') {
    return [document.createElement(tag)]
  }
  if (typeof value !== 'object') {
    const el = document.createElement(tag)
    el.textContent = String(value)
    return [el]
  }

  const opts = value as Record<string, any>

  // Conditional element: { div: { when: $.editing, ... } }
  if ('when' in opts) return renderConditionalElement(tag, opts, ctx)

  const el = document.createElement(tag)
  applyOptions(el, tag, opts, ctx)
  return [el]
}

function renderConditionalElement(tag: string, opts: Record<string, any>, ctx: RenderCtx): Node[] {
  const startMarker = document.createComment(`if:${tag}`)
  const endMarker = document.createComment(`/if:${tag}`)
  const condRef = opts.when
  const restOpts = { ...opts }
  delete restOpts.when

  let currentEl: HTMLElement | null = null
  let childScope: Scope | null = null

  createEffect(() => {
    const show = !!resolve(condRef, ctx)

    if (childScope) { childScope.dispose(); childScope = null }
    if (currentEl) { currentEl.remove(); currentEl = null }

    if (show) {
      childScope = ctx.scope.child()
      const childCtx: RenderCtx = { ...ctx, scope: childScope }
      currentEl = document.createElement(tag)
      applyOptions(currentEl, tag, restOpts, childCtx)
      if (endMarker.parentNode) {
        endMarker.parentNode.insertBefore(currentEl, endMarker)
      }
    }
  }, ctx.scope)

  const result: Node[] = [startMarker]
  if (currentEl) result.push(currentEl)
  result.push(endMarker)
  return result
}

function renderWhen(tpl: any, ctx: RenderCtx): Node[] {
  const startMarker = document.createComment('when')
  const endMarker = document.createComment('/when')
  const condRef = tpl.when
  const childTemplates: any[] = tpl.children || []

  let currentNodes: Node[] = []
  let childScope: Scope | null = null

  createEffect(() => {
    const show = !!resolve(condRef, ctx)

    if (childScope) { childScope.dispose(); childScope = null }
    for (const n of currentNodes) (n as any).parentNode?.removeChild(n)
    currentNodes = []

    if (show) {
      childScope = ctx.scope.child()
      const childCtx: RenderCtx = { ...ctx, scope: childScope }
      const nodes = renderNodes(childTemplates, childCtx)
      currentNodes = nodes
      if (endMarker.parentNode) {
        for (const n of nodes) endMarker.parentNode.insertBefore(n, endMarker)
      }
    }
  }, ctx.scope)

  return [startMarker, ...currentNodes, endMarker]
}

interface EachEntry { key: any; nodes: Node[]; scope: Scope; setIndex: (i: number) => void }

function renderEach(tpl: any, ctx: RenderCtx): Node[] {
  const startMarker = document.createComment('each')
  const endMarker = document.createComment('/each')
  const arrayRef = tpl.each
  const itemName: string = tpl.as || 'item'
  const keyProp: string | undefined = tpl.key
  const childTemplates: any[] = tpl.children || []

  let currentEntries: EachEntry[] = []

  function renderItem(item: any, index: number): EachEntry {
    const itemScope = ctx.scope.child()
    const itemCtx: RenderCtx = {
      inst: ctx.inst,
      scope: itemScope,
      iterVars: new Map(ctx.iterVars),
    }
    let currentIndex = index
    itemCtx.iterVars.set(itemName, () => {
      const arr = resolve(arrayRef, ctx)
      if (!Array.isArray(arr)) return item
      return currentIndex < arr.length ? arr[currentIndex] : item
    })

    const nodes = renderNodes(childTemplates, itemCtx)
    const key = keyProp && item != null ? item[keyProp] : index
    return { key, nodes, scope: itemScope, setIndex(i: number) { currentIndex = i } }
  }

  createEffect(() => {
    const arr = resolve(arrayRef, ctx)
    const items: any[] = Array.isArray(arr) ? arr : []

    // Build new keys
    const newKeys = items.map((item, i) => keyProp && item != null ? item[keyProp] : i)

    // Quick same-check
    if (newKeys.length === currentEntries.length) {
      let same = true
      for (let i = 0; i < newKeys.length; i++) {
        if (currentEntries[i].key !== newKeys[i]) { same = false; break }
      }
      if (same) return
    }

    // No key prop: full teardown + rebuild (original behavior)
    if (!keyProp) {
      for (const entry of currentEntries) {
        entry.scope.dispose()
        for (const n of entry.nodes) (n as any).parentNode?.removeChild(n)
      }
      currentEntries = []
      for (let i = 0; i < items.length; i++) {
        const entry = renderItem(items[i], i)
        if (endMarker.parentNode) {
          for (const n of entry.nodes) endMarker.parentNode!.insertBefore(n, endMarker)
        }
        currentEntries.push(entry)
      }
      return
    }

    // Keyed reconciliation
    const oldByKey = new Map<any, EachEntry>()
    for (const entry of currentEntries) {
      if (oldByKey.has(entry.key)) {
        console.warn(`[blok] Duplicate key "${String(entry.key)}" in each loop. Keys must be unique.`)
      }
      oldByKey.set(entry.key, entry)
    }

    const newEntries: EachEntry[] = []
    const reused = new Set<any>()

    for (let i = 0; i < items.length; i++) {
      const k = newKeys[i]
      const old = oldByKey.get(k)
      if (old) {
        old.setIndex(i)
        old.key = k
        newEntries.push(old)
        reused.add(k)
      } else {
        newEntries.push(renderItem(items[i], i))
      }
    }

    // Dispose + remove old entries not reused
    for (const entry of currentEntries) {
      if (!reused.has(entry.key)) {
        entry.scope.dispose()
        for (const n of entry.nodes) (n as any).parentNode?.removeChild(n)
      }
    }

    // Insert all entries' nodes in order before endMarker (moves existing nodes)
    if (endMarker.parentNode) {
      for (const entry of newEntries) {
        for (const n of entry.nodes) endMarker.parentNode!.insertBefore(n, endMarker)
      }
    }

    currentEntries = newEntries
  }, ctx.scope)

  const result: Node[] = [startMarker]
  for (const entry of currentEntries) result.push(...entry.nodes)
  result.push(endMarker)
  return result
}

function renderComponent(tag: string, propsObj: Record<string, any>, ctx: RenderCtx): Node[] {
  const app = ctx.inst.app
  const def = app.registry.get(tag)
  if (!def) {
    console.warn(`[blok] Unknown component: ${tag}`)
    return [document.createComment(`unknown:${tag}`)]
  }

  const propBindings: Record<string, any> = {}
  const eventMap: Record<string, string> = {}
  const slotChildren: any[] = []

  for (const [key, val] of Object.entries(propsObj)) {
    if (key === 'children') {
      if (Array.isArray(val)) slotChildren.push(...val)
      continue
    }
    if (key.startsWith('on_')) {
      eventMap[key.slice(3)] = val
      continue
    }
    propBindings[key] = val
  }

  const inst = createInstance(def, app, ctx.inst, propBindings)
  ctx.inst.children.push(inst)

  // For iteration-scoped props, set up live getters
  for (const [key, val] of Object.entries(propBindings)) {
    if (isRef(val) && val.path.length > 0 && ctx.iterVars.has(val.path[0])) {
      inst.sharedProps.delete(key)
      const ref = val as BlokRef
      Object.defineProperty(inst.stateData, key, {
        get: () => resolve(ref, ctx),
        set: (v: any) => resolveWrite(ref, ctx, v),
        enumerable: true,
        configurable: true,
      })
    }
  }

  // Wire event handlers
  for (const [event, methodName] of Object.entries(eventMap)) {
    inst.eventHandlers.set(event, (payload: any) => {
      if (typeof methodName === 'string' && ctx.inst.def.methods?.[methodName]) {
        ctx.inst.context[methodName](payload)
      }
    })
  }

  inst._slotChildren = slotChildren

  // Build template and render
  inst.template = def.view(createRefForInstance())

  const childScope = ctx.scope.child()
  const childCtx: RenderCtx = { inst, scope: childScope, iterVars: new Map() }
  const nodes = renderNode(inst.template, childCtx)

  for (const n of nodes) {
    if (n instanceof HTMLElement) { inst.el = n; break }
  }

  // Setup watchers
  setupWatchers(inst)

  // Lifecycle: mount (deferred)
  queueMicrotask(() => {
    if (!inst.destroyed && inst.def.mount) {
      inst.def.mount.call(inst.context)
    }
  })

  // Cleanup on scope dispose
  childScope.track(() => {
    inst.destroyed = true
    inst.scope.dispose()
    if (inst.def.unmount) {
      untracked(() => inst.def.unmount!.call(inst.context))
    }
    const idx = ctx.inst.children.indexOf(inst)
    if (idx !== -1) ctx.inst.children.splice(idx, 1)
  })

  return nodes
}

const SPECIAL: Record<string, 1> = {
  text: 1, bind: 1, html: 1, children: 1, class: 1, style: 1, model: 1,
  ref: 1, route: 1, link: 1, on: 1, when: 1, each: 1, as: 1, key: 1, slot: 1,
}

function applyOptions(el: HTMLElement, tag: string, opts: Record<string, any>, ctx: RenderCtx): void {
  if (__DEV__) validateTemplate(tag, opts, ctx.inst.def.methods)
  // Pass 1: HTML attributes first (so `type` is set before `model`)
  for (const [key, val] of Object.entries(opts)) {
    if (key === 'bind' && typeof val === 'object' && val != null) {
      for (const [attr, attrVal] of Object.entries(val)) {
        applyAttribute(el, attr, attrVal, ctx)
      }
    } else if (!(key in SPECIAL) && !(key.split('.')[0] in EVENT_NAMES)) {
      applyAttribute(el, key, val, ctx)
    }
  }

  // Pass 2: everything else
  for (const [key, val] of Object.entries(opts)) {
    if (key === 'text') {
      if (isRef(val)) {
        setupTextBinding(el, val, ctx)
      } else if (val != null) {
        el.append(document.createTextNode(String(val)))
      }
      continue
    }
    if (key === 'bind') continue
    if (key === 'html') {
      if (typeof val === 'string') {
        if (__DEV__ && SUSPICIOUS_HTML.test(val)) {
          console.warn('[blok] html contains potentially unsafe content (scripts or inline handlers). Consider sanitizing before use.')
        }
        setRawHTML(el, val)
      } else if (isRef(val)) {
        createEffect(() => {
          const raw = String(resolve(val, ctx) ?? '')
          if (__DEV__ && SUSPICIOUS_HTML.test(raw)) {
            console.warn('[blok] html contains potentially unsafe content (scripts or inline handlers). Consider sanitizing before use.')
          }
          setRawHTML(el, raw)
        }, ctx.scope)
      }
      continue
    }
    if (key === 'children') {
      if (val && typeof val === 'object' && (val as any).slot === true) {
        const slotChildren: any[] = ctx.inst._slotChildren || []
        if (slotChildren.length > 0) {
          const nodes = renderNodes(slotChildren, ctx)
          for (const n of nodes) el.appendChild(n)
        }
      } else if (Array.isArray(val)) {
        const nodes = renderNodes(val, ctx)
        for (const n of nodes) el.appendChild(n)
      }
      continue
    }
    if (key === 'class') { applyClass(el, val, ctx); continue }
    if (key === 'style') { applyStyle(el, val, ctx); continue }
    if (key === 'model') { setupModel(el, tag, val, ctx); continue }
    if (key === 'ref') { if (typeof val === 'string') ctx.inst.refs[val] = el; continue }
    if (key === 'route' && val === true) { setupRouteOutlet(el, ctx); continue }
    if (key === 'link' && val === true && tag === 'a') {
      el.addEventListener('click', (e) => {
        e.preventDefault()
        let href = el.getAttribute('href')
        if (href?.startsWith('#')) href = href.slice(1)
        if (href) ctx.inst.app.router?.navigate(href)
      })
      continue
    }
    if (key === 'on' && typeof val === 'object') {
      for (const [event, handler] of Object.entries(val)) {
        attachEvent(el, event, handler as string, ctx)
      }
      continue
    }
    const baseEvent = key.split('.')[0]
    if (baseEvent in EVENT_NAMES) { attachEvent(el, key, val, ctx); continue }
  }
}

function setupTextBinding(el: HTMLElement, ref: any, ctx: RenderCtx): void {
  const textNode = document.createTextNode('')
  el.appendChild(textNode)
  createEffect(() => {
    textNode.textContent = String(resolve(ref, ctx) ?? '')
  }, ctx.scope)
}

function applyClass(el: HTMLElement, val: any, ctx: RenderCtx): void {
  if (typeof val === 'string') {
    el.className = val
    return
  }
  if (isRef(val)) {
    createEffect(() => { el.className = String(resolve(val, ctx) ?? '') }, ctx.scope)
    return
  }
  if (Array.isArray(val)) {
    for (const item of val) applyClassItem(el, item, ctx)
    return
  }
  if (typeof val === 'object' && val != null) {
    applyClassObject(el, val, ctx)
  }
}

function applyClassItem(el: HTMLElement, val: any, ctx: RenderCtx): void {
  if (typeof val === 'string') {
    for (const cls of val.split(/\s+/)) {
      if (cls) el.classList.add(cls)
    }
    return
  }
  if (isRef(val)) {
    let prev: string[] = []
    createEffect(() => {
      for (const cls of prev) el.classList.remove(cls)
      const v = String(resolve(val, ctx) ?? '')
      prev = v.split(/\s+/).filter(Boolean)
      for (const cls of prev) el.classList.add(cls)
    }, ctx.scope)
    return
  }
  if (typeof val === 'object' && val != null) {
    applyClassObject(el, val, ctx)
  }
}

function applyClassObject(el: HTMLElement, val: Record<string, any>, ctx: RenderCtx): void {
  for (const [cls, cond] of Object.entries(val)) {
    if (isRef(cond)) {
      createEffect(() => { el.classList.toggle(cls, !!resolve(cond, ctx)) }, ctx.scope)
    } else {
      if (cond) el.classList.add(cls)
    }
  }
}

function applyStyle(el: HTMLElement, val: any, ctx: RenderCtx): void {
  if (typeof val === 'string') {
    el.setAttribute('style', val)
    return
  }
  if (isRef(val)) {
    createEffect(() => {
      const resolved = resolve(val, ctx)
      el.removeAttribute('style')
      if (typeof resolved === 'string') { el.setAttribute('style', resolved) }
      else if (typeof resolved === 'object' && resolved != null) {
        for (const [prop, v] of Object.entries(resolved)) {
          el.style.setProperty(prop.startsWith('--') ? prop : prop.replace(/[A-Z]/g, m => '-' + m.toLowerCase()), String(v ?? ''))
        }
      }
    }, ctx.scope)
    return
  }
  if (typeof val === 'object' && val != null) {
    for (const [prop, v] of Object.entries(val)) {
      const cssProp = prop.startsWith('--') ? prop : prop.replace(/[A-Z]/g, m => '-' + m.toLowerCase())
      if (isRef(v)) {
        createEffect(() => {
          el.style.setProperty(cssProp, String(resolve(v, ctx) ?? ''))
        }, ctx.scope)
      } else {
        el.style.setProperty(cssProp, String(v ?? ''))
      }
    }
  }
}

function setupModel(el: HTMLElement, tag: string, ref: any, ctx: RenderCtx): void {
  if (!isRef(ref)) return

  const isCheckbox = tag === 'input' && (el as HTMLInputElement).type === 'checkbox'

  if (isCheckbox) {
    createEffect(() => {
      (el as HTMLInputElement).checked = !!resolve(ref, ctx)
    }, ctx.scope)
    el.addEventListener('change', () => {
      resolveWrite(ref, ctx, (el as HTMLInputElement).checked)
    })
  } else {
    createEffect(() => {
      const v = resolve(ref, ctx)
      if ((el as HTMLInputElement).value !== String(v ?? '')) {
        (el as HTMLInputElement).value = String(v ?? '')
      }
    }, ctx.scope)
    const eventType = tag === 'select' ? 'change' : 'input'
    el.addEventListener(eventType, () => {
      resolveWrite(ref, ctx, (el as HTMLInputElement).value)
    })
  }
}

function attachEvent(el: HTMLElement, rawEvent: string, handler: any, ctx: RenderCtx): void {
  let handlerStr: string
  let prevent: boolean
  let stop: boolean

  if (typeof handler === 'string') {
    const parts = rawEvent.split('.')
    prevent = parts.includes('prevent')
    stop = parts.includes('stop')
    handlerStr = handler
  } else if (typeof handler === 'object' && handler != null) {
    handlerStr = handler.handler || ''
    prevent = !!handler.prevent
    stop = !!handler.stop
  } else {
    return
  }

  const eventName = rawEvent.split('.')[0]

  el.addEventListener(eventName, (e) => {
    if (prevent || eventName === 'submit') e.preventDefault()
    if (stop) e.stopPropagation()
    if (!handlerStr) return

    const assignMatch = handlerStr.match(/^(\w+)\s*=\s*(.+)$/)
    if (assignMatch) {
      const key = assignMatch[1]
      const rawVal = assignMatch[2].trim()
      let parsed: any
      if (rawVal === 'true') parsed = true
      else if (rawVal === 'false') parsed = false
      else if (rawVal === 'null') parsed = null
      else if (rawVal === "''" || rawVal === '""' || rawVal === '') parsed = ''
      else if (!isNaN(Number(rawVal))) parsed = Number(rawVal)
      else parsed = rawVal.replace(/^['"]|['"]$/g, '')

      if (key in RESERVED_CONTEXT_KEYS) return
      if (ctx.inst.def.methods?.[key] || key in ctx.inst.computedDefs) {
        console.warn(`[blok] Cannot assign to ${key in ctx.inst.computedDefs ? 'computed' : 'method'} "${key}" via event handler`)
        return
      }
      setOnInstance(ctx.inst, [key], parsed)
      return
    }

    const callMatch = handlerStr.match(/^(\w+)\((.+)\)$/)
    if (callMatch) {
      const methodName = callMatch[1]
      if (ctx.inst.def.methods?.[methodName]) {
        const args = parseArgs(callMatch[2]).map(a => resolveArg(a, ctx))
        ctx.inst.context[methodName](...args)
      }
      return
    }

    if (ctx.inst.def.methods?.[handlerStr]) {
      ctx.inst.context[handlerStr](e)
    }
  })
}

function parseArgs(raw: string): string[] {
  const args: string[] = []
  let current = ''
  let inQuote: string | null = null

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    if (inQuote) {
      current += ch
      if (ch === inQuote) inQuote = null
    } else if (ch === "'" || ch === '"') {
      inQuote = ch
      current += ch
    } else if (ch === ',') {
      args.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  if (current.trim()) args.push(current.trim())
  return args
}

function resolveArg(arg: string, ctx: RenderCtx): any {
  if ((arg.startsWith("'") && arg.endsWith("'")) || (arg.startsWith('"') && arg.endsWith('"'))) {
    return arg.slice(1, -1)
  }
  if (arg === 'true') return true
  if (arg === 'false') return false
  if (arg === 'null') return null
  if (!isNaN(Number(arg)) && arg !== '') return Number(arg)

  // Dot-path: check iterVars first, then instance
  const parts = arg.split('.')
  if (ctx.iterVars.has(parts[0])) {
    let v = ctx.iterVars.get(parts[0])!()
    for (let i = 1; i < parts.length; i++) {
      if (v == null) return undefined
      v = v[parts[i]]
    }
    return v
  }
  return resolveOnInstance(ctx.inst, parts)
}

const URL_ATTR_SET: Record<string, 1> = { href: 1, src: 1, action: 1, formaction: 1 }

function applyAttribute(el: HTMLElement, key: string, val: any, ctx: RenderCtx): void {
  const isURLAttr = key in URL_ATTR_SET
  if (isRef(val)) {
    createEffect(() => {
      const v = resolve(val, ctx)
      if (v === false || v == null) el.removeAttribute(key)
      else if (v === true) el.setAttribute(key, '')
      else el.setAttribute(key, isURLAttr ? sanitizeURL(String(v)) : String(v))
    }, ctx.scope)
  } else if (typeof val === 'boolean') {
    if (val) el.setAttribute(key, '')
    else el.removeAttribute(key)
  } else if (val != null) {
    const str = String(val)
    el.setAttribute(key, isURLAttr ? sanitizeURL(str) : str)
  }
}

function setupRouteOutlet(el: HTMLElement, ctx: RenderCtx): void {
  const router = ctx.inst.app.router
  if (!router) return

  let currentScope: Scope | null = null
  let currentNodes: Node[] = []
  let currentComponent: string | null = null

  createEffect(() => {
    const path = router.current.path // tracked via routeProxy

    const matched = router.match(path)
    if (!matched) {
      if (currentScope) {
        currentScope.dispose()
        for (const n of currentNodes) n.parentNode?.removeChild(n)
        currentNodes = []
        currentComponent = null
      }
      return
    }

    const componentName = matched.config.component
    if (componentName === currentComponent && currentNodes.length > 0) return
    currentComponent = componentName

    const def = ctx.inst.app.registry.get(componentName)
    if (!def) return

    // Clear old
    if (currentScope) {
      currentScope.dispose()
      for (const n of currentNodes) n.parentNode?.removeChild(n)
      currentNodes = []
    }

    // Render new
    currentScope = ctx.scope.child()
    const childInst = createInstance(def, ctx.inst.app, ctx.inst, {})
    ctx.inst.children.push(childInst)
    childInst.template = def.view(createRefForInstance())

    const childCtx: RenderCtx = { inst: childInst, scope: currentScope, iterVars: new Map() }
    const nodes = renderNode(childInst.template, childCtx)
    currentNodes = nodes
    for (const n of nodes) el.appendChild(n)

    for (const n of nodes) {
      if (n instanceof HTMLElement) { childInst.el = n; break }
    }

    setupWatchers(childInst)

    queueMicrotask(() => {
      if (!childInst.destroyed && childInst.def.mount) {
        childInst.def.mount.call(childInst.context)
      }
    })

    currentScope.track(() => {
      childInst.destroyed = true
      childInst.scope.dispose()
      if (childInst.def.unmount) {
        untracked(() => childInst.def.unmount!.call(childInst.context))
      }
      const idx = ctx.inst.children.indexOf(childInst)
      if (idx !== -1) ctx.inst.children.splice(idx, 1)
    })
  }, ctx.scope)
}

// Mount the root component into a target element
export function mountRoot(target: HTMLElement, inst: ComponentInstance): void {
  inst.template = inst.def.view(createRefForInstance())
  const ctx: RenderCtx = { inst, scope: inst.scope, iterVars: new Map() }
  const nodes = renderNode(inst.template, ctx)

  for (const n of nodes) target.appendChild(n)
  for (const n of nodes) {
    if (n instanceof HTMLElement) { inst.el = n; break }
  }

  setupWatchers(inst)

  queueMicrotask(() => {
    if (!inst.destroyed && inst.def.mount) {
      inst.def.mount.call(inst.context)
    }
  })
}
