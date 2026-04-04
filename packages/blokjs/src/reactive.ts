import { Scope } from './scope'

export const RAW = Symbol.for('blokjs-raw')

// --- Dependency tracking ---

interface Effect {
  run(): void
  deps: Set<Set<Effect>>
  active: boolean
  scheduler?: () => void // if set, called synchronously instead of queue-based scheduling
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
  if (dep) { for (const e of dep) schedule(e) }
}

function triggerAll(target: object): void {
  const depsMap = targetMap.get(target)
  if (!depsMap) return
  for (const dep of depsMap.values()) {
    for (const e of dep) schedule(e)
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
  if (effect.scheduler) { effect.scheduler(); return }
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
  if (deferredDepth > 0) {
    // Deferred: set initial DOM values without tracking, queue real effect for later
    untracked(fn)
    deferredQueue.push({ fn, scope })
    return
  }

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

// --- Deferred effect mode ---
// When enabled, createEffect runs fn once untracked (for initial DOM values)
// and queues the real tracked effect for later. Used by `each` for large lists.

let deferredDepth = 0
const deferredQueue: Array<{ fn: () => void; scope: Scope }> = []

export function enterDeferredMode(): void { deferredDepth++ }
/** Returns true when the outermost deferred scope has exited (safe to flush). */
export function exitDeferredMode(): boolean {
  deferredDepth = Math.max(0, deferredDepth - 1)
  return deferredDepth === 0
}

export function flushDeferred(chunkSize = 50): void {
  if (deferredQueue.length === 0) return
  const pending = deferredQueue.splice(0)
  let index = 0

  function processChunk(): void {
    const end = Math.min(index + chunkSize, pending.length)
    for (; index < end; index++) {
      const { fn, scope } = pending[index]
      if (!scope.disposed) createEffect(fn, scope)
    }
    if (index < pending.length) {
      if (typeof requestAnimationFrame !== 'undefined') {
        requestAnimationFrame(processChunk)
      } else {
        queueMicrotask(processChunk)
      }
    }
  }

  if (typeof requestAnimationFrame !== 'undefined') {
    requestAnimationFrame(processChunk)
  } else {
    queueMicrotask(processChunk)
  }
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

// --- Computed (lazy, memoized) ---

export interface ComputedSignal<T = any> {
  readonly value: T
  dispose(): void
}

export function createComputed<T>(fn: () => T, scope: Scope): ComputedSignal<T> {
  let cachedValue: T | undefined
  let dirty = true
  let active = true

  // Subscriber set: effects (or other computeds) that depend on this computed's output
  const dep: Set<Effect> = new Set()

  // Internal effect: subscribes to fn's source dependencies.
  // When sources change, run() marks dirty and propagates to downstream subscribers.
  // It does NOT re-evaluate fn - that happens lazily on next .value read.
  // Uses a scheduler so dirty is marked synchronously (not deferred to microtask).
  const effect: Effect = {
    run() {
      if (!active || dirty) return
      dirty = true
      // Propagate invalidation to subscribers without re-evaluating
      for (const sub of dep) schedule(sub)
    },
    deps: new Set(),
    active: true,
    scheduler() { effect.run() },
  }

  // Initial evaluation: track source dependencies
  evaluate()

  scope.track(() => {
    active = false
    effect.active = false
    cleanupEffect(effect)
    queue.delete(effect)
    dep.clear()
  })

  function evaluate(): void {
    cleanupEffect(effect)
    effectStack.push(activeEffect)
    activeEffect = effect
    try {
      cachedValue = fn()
      dirty = false
    } finally {
      activeEffect = effectStack.pop() ?? null
    }
  }

  return {
    get value(): T {
      // Track: outer effect subscribes to this computed's output
      if (activeEffect && activeEffect !== effect) {
        dep.add(activeEffect)
        activeEffect.deps.add(dep)
      }
      if (dirty && active) evaluate()
      return cachedValue as T
    },
    dispose() {
      active = false
      effect.active = false
      cleanupEffect(effect)
      queue.delete(effect)
      dep.clear()
    },
  }
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
