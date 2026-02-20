import { Scope } from './scope'

export const RAW = Symbol.for('blokjs-raw')

// --- Dependency tracking ---

interface Effect {
  run(): void
  deps: Set<Set<Effect>>
  active: boolean
}

let activeEffect: Effect | null = null
const effectStack: (Effect | null)[] = []
const targetMap = new WeakMap<object, Map<string | symbol, Set<Effect>>>()

function track(target: object, key: string | symbol): void {
  if (!activeEffect) return
  let depsMap = targetMap.get(target)
  if (!depsMap) targetMap.set(target, depsMap = new Map())
  let dep = depsMap.get(key)
  if (!dep) depsMap.set(key, dep = new Set())
  if (!dep.has(activeEffect)) {
    dep.add(activeEffect)
    activeEffect.deps.add(dep)
  }
}

function trigger(target: object, key: string | symbol): void {
  const depsMap = targetMap.get(target)
  if (!depsMap) return
  const dep = depsMap.get(key)
  if (dep) { for (const e of [...dep]) schedule(e) }
}

function triggerAll(target: object): void {
  const depsMap = targetMap.get(target)
  if (!depsMap) return
  for (const dep of depsMap.values()) {
    for (const e of [...dep]) schedule(e)
  }
}

function cleanupEffect(effect: Effect): void {
  for (const dep of effect.deps) dep.delete(effect)
  effect.deps.clear()
}

// --- Batching ---

const queue = new Set<Effect>()
let flushing = false

function schedule(effect: Effect): void {
  queue.add(effect)
  if (!flushing) {
    flushing = true
    queueMicrotask(() => {
      let iterations = 0
      while (queue.size > 0) {
        if (++iterations > 100) {
          console.warn('[blok] Possible infinite reactive loop detected')
          queue.clear()
          break
        }
        const batch = [...queue]
        queue.clear()
        for (const e of batch) {
          if (e.active) e.run()
        }
      }
      flushing = false
    })
  }
}

// --- Public: effects ---

export function createEffect(fn: () => void, scope: Scope): void {
  const effect: Effect = {
    run() {
      cleanupEffect(effect)
      effectStack.push(activeEffect)
      activeEffect = effect
      try { fn() } finally { activeEffect = effectStack.pop() ?? null }
    },
    deps: new Set(),
    active: true,
  }
  scope.track(() => { effect.active = false; cleanupEffect(effect); queue.delete(effect) })
  effect.run()
}

export function pauseTracking(): void {
  effectStack.push(activeEffect)
  activeEffect = null
}

export function resumeTracking(): void {
  activeEffect = effectStack.pop() ?? null
}

export function untracked<T>(fn: () => T): T {
  effectStack.push(activeEffect)
  activeEffect = null
  try { return fn() }
  finally { activeEffect = effectStack.pop() ?? null }
}

// --- Reactive proxy ---

const MUTATORS: Record<string, 1> = { push: 1, pop: 1, shift: 1, unshift: 1, splice: 1, sort: 1, reverse: 1 }

export function createProxy(data: Record<string, any>): any {
  const cache = new WeakMap<object, any>()

  function wrap(target: any): any {
    if (target == null || typeof target !== 'object') return target
    if (target[RAW] !== undefined) return target
    if (cache.has(target)) return cache.get(target)

    const p = new Proxy(target, {
      get(obj, key) {
        if (key === RAW) return obj
        if (Array.isArray(obj) && typeof key === 'string' && key in MUTATORS) {
          return (...args: any[]) => {
            const unwrappedArgs = args.map(a =>
              a != null && typeof a === 'object' && a[RAW] !== undefined ? a[RAW] : a
            )
            const r = (Array.prototype as any)[key].apply(obj, unwrappedArgs)
            triggerAll(obj)
            return r
          }
        }
        if (typeof key !== 'symbol') track(obj, key)
        const v = Reflect.get(obj, key)
        if (v != null && typeof v === 'object' && typeof key !== 'symbol') return wrap(v)
        return v
      },
      set(obj, key, val) {
        const unwrapped = val != null && typeof val === 'object' && val[RAW] !== undefined
          ? val[RAW] : val
        const old = Reflect.get(obj, key)
        Reflect.set(obj, key, unwrapped)
        if (old !== unwrapped && typeof key !== 'symbol') {
          trigger(obj, key)
          if (Array.isArray(obj) && /^\d+$/.test(key as string)) trigger(obj, 'length')
        }
        return true
      },
      deleteProperty(obj, key) {
        const had = Reflect.has(obj, key)
        Reflect.deleteProperty(obj, key)
        if (had && typeof key !== 'symbol') trigger(obj, key)
        return true
      },
    })

    cache.set(target, p)
    return p
  }

  return wrap(data)
}

// --- Utilities ---

export function setByPath(obj: any, path: string[], val: any): void {
  let c = obj
  for (let i = 0; i < path.length - 1; i++) {
    if (c == null) return
    c = c[path[i]]
  }
  if (c != null && path.length > 0) c[path[path.length - 1]] = val
}
