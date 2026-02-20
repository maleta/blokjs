import type { ComponentDef } from './component'
import { RESERVED_CONTEXT_KEYS } from './component'
import type { StoreDef } from './store'

const VALID_DEF_KEYS: Record<string, 1> = {
  props: 1, state: 1, computed: 1, watch: 1, methods: 1,
  mount: 1, unmount: 1, view: 1,
}

const VALID_MOUNT_KEYS: Record<string, 1> = {
  ...VALID_DEF_KEYS,
  routes: 1, guards: 1, mode: 1,
}

const VALID_STORE_KEYS: Record<string, 1> = {
  state: 1, computed: 1, methods: 1,
}

const TEMPLATE_KEYS: Record<string, 1> = {
  text: 1, bind: 1, html: 1, children: 1, class: 1, style: 1, model: 1,
  ref: 1, route: 1, link: 1, on: 1, when: 1, each: 1, as: 1, key: 1, slot: 1,
}

const EVENT_NAMES: Record<string, 1> = {
  click: 1, dblclick: 1, mousedown: 1, mouseup: 1, mousemove: 1, mouseenter: 1, mouseleave: 1,
  keydown: 1, keyup: 1, keypress: 1, input: 1, change: 1, submit: 1, focus: 1, blur: 1,
  scroll: 1, resize: 1, touchstart: 1, touchend: 1, touchmove: 1,
  dragstart: 1, dragend: 1, dragover: 1, dragleave: 1, drop: 1,
}

// --- Collectors (return warnings as array) ---

function collectComponentDef(name: string, def: ComponentDef): string[] {
  const w: string[] = []

  for (const key of Object.keys(def)) {
    if (!(key in VALID_DEF_KEYS)) {
      w.push(`Unknown property "${key}" in component "${name}". Valid: ${Object.keys(VALID_DEF_KEYS).join(', ')}`)
    }
  }

  if (!def.view) {
    w.push(`Component "${name}" is missing the required "view" function.`)
  } else if (typeof def.view !== 'function') {
    w.push(`Component "${name}": "view" must be a function.`)
  }

  w.push(...collectStateKeys(name, def))
  w.push(...collectMethodTypes(name, def))
  return w
}

function collectMountOptions(opts: Record<string, any>): string[] {
  const w: string[] = []

  for (const key of Object.keys(opts)) {
    if (!(key in VALID_MOUNT_KEYS)) {
      w.push(`Unknown mount option "${key}". Valid: ${Object.keys(VALID_MOUNT_KEYS).join(', ')}`)
    }
  }

  if (!opts.view) {
    w.push('Mount options missing the required "view" function.')
  }

  if (opts.mode && !['hash', 'history', 'auto'].includes(opts.mode)) {
    w.push(`Invalid router mode "${opts.mode}". Valid: hash, history, auto`)
  }

  w.push(...collectStateKeys('root', opts as ComponentDef))
  w.push(...collectMethodTypes('root', opts as ComponentDef))
  return w
}

function collectStoreDef(name: string, def: StoreDef): string[] {
  const w: string[] = []
  for (const key of Object.keys(def)) {
    if (!(key in VALID_STORE_KEYS)) {
      w.push(`Unknown property "${key}" in store "${name}". Valid: ${Object.keys(VALID_STORE_KEYS).join(', ')}`)
    }
  }
  return w
}

function collectTemplate(tag: string, opts: Record<string, any>, methods: Record<string, any> | undefined): string[] {
  const w: string[] = []

  for (const key of Object.keys(opts)) {
    if (key in TEMPLATE_KEYS) continue

    const base = key.split('.')[0]
    if (base in EVENT_NAMES) continue
    if (key.startsWith('on_')) continue

    const typoTarget = findTypo(key, TEMPLATE_KEYS)
    if (typoTarget) {
      w.push(`<${tag}> has "${key}" - did you mean "${typoTarget}"?`)
    }
  }

  if (methods) {
    for (const key of Object.keys(opts)) {
      const base = key.split('.')[0]
      if (!(base in EVENT_NAMES)) continue

      const handler = opts[key]
      if (typeof handler !== 'string') continue
      if (handler.includes('=')) continue
      if (!handler) continue

      const callMatch = handler.match(/^(\w+)\(.+\)$/)
      const methodName = callMatch ? callMatch[1] : handler

      if (!(methodName in methods)) {
        w.push(`<${tag}> event "${key}" references method "${methodName}" which is not defined.`)
      }
    }
  }

  return w
}

function collectStateKeys(name: string, def: ComponentDef): string[] {
  const w: string[] = []
  if (!def.state) return w
  for (const key of Object.keys(def.state)) {
    if (key in RESERVED_CONTEXT_KEYS) {
      w.push(`"${key}" in state of "${name}" conflicts with a reserved name. Reserved: ${Object.keys(RESERVED_CONTEXT_KEYS).join(', ')}`)
    }
    if (def.computed && key in def.computed) {
      w.push(`"${key}" is defined in both state and computed of "${name}".`)
    }
    if (def.methods && key in def.methods) {
      w.push(`"${key}" is defined in both state and methods of "${name}".`)
    }
  }
  return w
}

function collectMethodTypes(name: string, def: ComponentDef): string[] {
  const w: string[] = []
  if (def.mount && typeof def.mount !== 'function') {
    w.push(`"${name}": "mount" must be a function.`)
  }
  if (def.unmount && typeof def.unmount !== 'function') {
    w.push(`"${name}": "unmount" must be a function.`)
  }
  if (def.methods) {
    for (const [key, fn] of Object.entries(def.methods)) {
      if (typeof fn !== 'function') w.push(`"${name}": method "${key}" is not a function.`)
    }
  }
  if (def.computed) {
    for (const [key, fn] of Object.entries(def.computed)) {
      if (typeof fn !== 'function') w.push(`"${name}": computed "${key}" is not a function.`)
    }
  }
  if (def.watch) {
    for (const [key, fn] of Object.entries(def.watch)) {
      if (typeof fn !== 'function') w.push(`"${name}": watcher "${key}" is not a function.`)
    }
  }
  return w
}

// --- Runtime hooks (console.warn, used by index.ts / renderer.ts) ---

function emitWarnings(warnings: string[]): void {
  for (const msg of warnings) console.warn(`[blok warn] ${msg}`)
}

export function validateComponentDef(name: string, def: ComponentDef): void {
  emitWarnings(collectComponentDef(name, def))
}

export function validateMountOptions(opts: Record<string, any>): void {
  emitWarnings(collectMountOptions(opts))
}

export function validateStoreDef(name: string, def: StoreDef): void {
  emitWarnings(collectStoreDef(name, def))
}

export function validateTemplate(tag: string, opts: Record<string, any>, methods: Record<string, any> | undefined): void {
  emitWarnings(collectTemplate(tag, opts, methods))
}

// --- Public API (pure functions, return warnings) ---

export const validate = {
  component: collectComponentDef,
  mount: collectMountOptions,
  store: collectStoreDef,
  template: collectTemplate,
}

// --- Utilities ---

function findTypo(input: string, dict: Record<string, 1>): string | null {
  const lower = input.toLowerCase()
  for (const key of Object.keys(dict)) {
    if (key === input) continue
    if (key.toLowerCase() === lower) return key
    const maxDist = key.length >= 6 ? 2 : 1
    if (key.length > 3 && Math.abs(key.length - input.length) <= 1 && levenshtein(key, input) <= maxDist) return key
  }
  return null
}

function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  const dp: number[] = Array.from({ length: n + 1 }, (_, i) => i)
  for (let i = 1; i <= m; i++) {
    let prev = dp[0]
    dp[0] = i
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j]
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1])
      prev = tmp
    }
  }
  return dp[n]
}
