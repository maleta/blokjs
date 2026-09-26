import { vi } from 'vitest'
import type PocketBase from 'pocketbase'
import type { RecordModel } from 'pocketbase'

type Event = { action: string; record: RecordModel }

export class ResponseError extends Error {
  constructor(public status: number, public response: Record<string, any> = {}) {
    super(`status ${status}`)
  }
}

// In-memory stand-in for the SDK surface the stores use. `list` decides what getFullList returns.
export function fakePb(rows: RecordModel[] = []) {
  const db = new Map(rows.map((r) => [r.id, r]))
  const listeners = new Set<(e: Event) => void>()
  const reconnects = new Set<() => void>()
  const authListeners: Array<(token: string, record: RecordModel | null) => void> = []
  let seq = 0

  const authStore = {
    token: '',
    record: null as RecordModel | null,
    get isValid() {
      return this.token !== ''
    },
    onChange(cb: (token: string, record: RecordModel | null) => void) {
      authListeners.push(cb)
      return () => {
        const i = authListeners.indexOf(cb)
        if (i !== -1) authListeners.splice(i, 1)
      }
    },
    save(token: string, record: RecordModel | null) {
      this.token = token
      this.record = record
      for (const cb of authListeners) cb(token, record)
    },
    clear() {
      this.save('', null)
    },
  }

  const col = {
    list: vi.fn(async (_opts?: Record<string, unknown>) => [...db.values()]),
    getFullList: vi.fn(async (opts?: Record<string, unknown>) => (await col.list(opts)).map((r) => ({ ...r }))),
    create: vi.fn(async (data: Record<string, any>, _opts?: unknown) => {
      if (data.slug !== undefined && [...db.values()].some((r) => r.slug === data.slug)) {
        throw new ResponseError(400, { data: { slug: { code: 'validation_not_unique' } } })
      }
      const record = { collectionId: 'c1', collectionName: 'notes', ...data, id: `r${++seq}` } as RecordModel
      db.set(record.id, record)
      return { ...record }
    }),
    update: vi.fn(async (id: string, data: Record<string, any>, _opts?: unknown) => {
      const record = { ...db.get(id)!, ...data, id } as RecordModel
      db.set(id, record)
      return { ...record }
    }),
    delete: vi.fn(async (id: string, _opts?: unknown) => {
      db.delete(id)
      return true
    }),
    getFirstListItem: vi.fn(async (filter: string, _opts?: unknown) => {
      const value = filter.split("'")[1]
      const found = [...db.values()].find((r) => r.slug === value)
      if (!found) throw new ResponseError(404)
      return { ...found }
    }),
    subscribe: vi.fn(async (_topic: string, cb: (e: Event) => void, _opts?: unknown) => {
      listeners.add(cb)
      return async () => {
        listeners.delete(cb)
      }
    }),
    authWithPassword: vi.fn(async (identity: string, password: string, _opts?: unknown) => {
      if (password !== 'secret') throw new ResponseError(400)
      const record = { id: 'u1', collectionId: 'u', collectionName: 'users', email: identity } as RecordModel
      authStore.save('token-u1', record)
      return { token: 'token-u1', record }
    }),
    authRefresh: vi.fn(async (_opts?: unknown) => {
      authStore.save(authStore.token, { ...authStore.record! })
      return { token: authStore.token, record: authStore.record }
    }),
  }

  const pb = {
    collection: vi.fn((_name: string) => col),
    filter: (expr: string, params: Record<string, unknown>) =>
      expr.replace(/\{:(\w+)\}/g, (_, k: string) => `'${String(params[k])}'`),
    realtime: {
      disconnect: vi.fn(),
      subscribe: vi.fn(async (_topic: string, cb: () => void) => {
        reconnects.add(cb)
        return async () => {
          reconnects.delete(cb)
        }
      }),
    },
    authStore,
  }

  return {
    pb: pb as unknown as PocketBase,
    col,
    authStore,
    db,
    emit(action: string, record: RecordModel) {
      for (const cb of listeners) cb({ action, record: { ...record } })
    },
    reconnect() {
      for (const cb of reconnects) cb()
    },
    get subscribers() {
      return listeners.size + reconnects.size
    },
  }
}
