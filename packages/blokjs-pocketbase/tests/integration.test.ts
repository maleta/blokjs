// Runs against a real PocketBase binary: PB_BIN=/path/to/pocketbase pnpm test
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventSource } from 'eventsource'
import PocketBase, { BaseAuthStore } from 'pocketbase'
import { pbCollection, pbAuth, type CollectionStore, type AuthStore } from '../src'
import { use } from './helpers'

const bin = process.env.PB_BIN
const port = 18000 + Math.floor(Math.random() * 1000)
const url = `http://127.0.0.1:${port}`

const migration = `
migrate((app) => {
  const open = { listRule: '', viewRule: '', createRule: '', updateRule: '', deleteRule: '' }
  const fields = [
    { name: 'title', type: 'text' },
    { name: 'slug', type: 'text' },
    { name: 'done', type: 'bool' },
    { name: 'n', type: 'number' },
  ]
  app.save(new Collection({ type: 'base', name: 'notes', ...open, fields,
    indexes: ["CREATE UNIQUE INDEX idx_notes_slug ON notes (slug) WHERE slug != ''"] }))
  const signedIn = '@request.auth.id != ""'
  app.save(new Collection({ type: 'base', name: 'secrets', fields,
    listRule: signedIn, viewRule: signedIn, createRule: signedIn, updateRule: signedIn, deleteRule: signedIn }))
})
`

async function until(check: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms
  while (!check()) {
    if (Date.now() > end) throw new Error('condition not met in time')
    await new Promise((r) => setTimeout(r, 20))
  }
}

// In-memory auth per client: the default store shares one localStorage slot between clients.
function client(): PocketBase {
  return new PocketBase(url, new BaseAuthStore())
}

describe.skipIf(!bin)('integration with a real PocketBase', () => {
  let dir: string
  let server: ChildProcess
  let other: PocketBase

  beforeAll(async () => {
    ;(globalThis as { EventSource?: unknown }).EventSource = EventSource
    // happy-dom strips Authorization from cross-origin requests; browsers send it.
    ;(window as unknown as { happyDOM: { setURL(u: string): void } }).happyDOM.setURL(url)
    dir = mkdtempSync(join(tmpdir(), 'blokjs-pb-'))
    mkdirSync(join(dir, 'pb_migrations'))
    writeFileSync(join(dir, 'pb_migrations', '1_init.js'), migration)
    server = spawn(bin!, ['serve', `--http=127.0.0.1:${port}`, `--dir=${join(dir, 'pb_data')}`, `--migrationsDir=${join(dir, 'pb_migrations')}`])
    other = client()
    const health = async () => (await fetch(`${url}/api/health`).then((r) => r.ok, () => false))
    const end = Date.now() + 10000
    while (!(await health())) {
      if (Date.now() > end) throw new Error('PocketBase did not start')
      await new Promise((r) => setTimeout(r, 100))
    }
    await other.collection('users').create({ email: 'u@test.dev', password: 'secret123', passwordConfirm: 'secret123' })
  }, 20000)

  afterAll(() => {
    server?.kill()
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  it('loads, saves by key, and removes', async () => {
    await other.collection('notes').create({ title: 'seed', slug: 'seed' })
    const pb = client()
    const { s } = await use<CollectionStore>(pbCollection(pb, 'notes', { key: 'slug', sort: 'title' }))

    await s.load()
    expect(s.items.map((r) => r.title)).toEqual(['seed'])

    const created = await s.save({ slug: 'k1', title: 'first' })
    const again = await s.save({ slug: 'k1', title: 'first, edited' })
    expect(again.id).toBe(created.id)
    expect(s.items.map((r) => r.title)).toEqual(['first, edited', 'seed'])

    await s.remove(created.id)
    expect(s.items.map((r) => r.title)).toEqual(['seed'])
    expect(await other.collection('notes').getFullList({ filter: 'slug = "k1"' })).toEqual([])
  })

  it('follows changes made by another client, in sort order', async () => {
    const pb = client()
    const { s } = await use<CollectionStore>(pbCollection(pb, 'notes', { sort: '-n' }))
    await s.connect()
    const base = s.items.length

    const a = await other.collection('notes').create({ title: 'a', n: 1 })
    const b = await other.collection('notes').create({ title: 'b', n: 5 })
    await until(() => s.items.length === base + 2)
    expect(s.items.slice(0, 2).map((r) => r.title)).toEqual(['b', 'a'])

    await other.collection('notes').update(a.id, { n: 9 })
    await until(() => s.items[0].title === 'a')
    await other.collection('notes').delete(b.id)
    await until(() => !s.items.some((r) => r.id === b.id))

    await s.disconnect()
  })

  it('drops a record from a filtered store when it stops matching', async () => {
    const pb = client()
    const { s } = await use<CollectionStore>(pbCollection(pb, 'notes', { filter: 'done = false && title ~ "task"' }))
    await s.connect()

    const t = await other.collection('notes').create({ title: 'task 1' })
    await until(() => s.items.some((r) => r.id === t.id))
    await other.collection('notes').update(t.id, { done: true })
    await until(() => !s.items.some((r) => r.id === t.id))

    await s.disconnect()
  })

  it('reloads and resubscribes when a user signs in and out', async () => {
    await other.collection('users').authWithPassword('u@test.dev', 'secret123')
    await other.collection('secrets').create({ title: 'hidden' })
    const pb = client()
    const { s: auth } = await use<AuthStore>(pbAuth(pb))
    const { s } = await use<CollectionStore>(pbCollection(pb, 'secrets'))
    await s.connect()
    expect(s.items).toEqual([])

    await auth.login('u@test.dev', 'secret123')
    expect(auth.isLoggedIn).toBe(true)
    await until(() => s.items.length === 1)

    await other.collection('secrets').create({ title: 'live' })
    await until(() => s.items.length === 2)

    auth.logout()
    await until(() => s.items.length === 0)
    await other.collection('secrets').create({ title: 'after logout' })
    await new Promise((r) => setTimeout(r, 300))
    expect(s.items).toEqual([])
    await s.disconnect()
    other.authStore.clear()
  })

  it('pbAuth connect() keeps a valid session and clears a revoked one', async () => {
    const pb = client()
    await pb.collection('users').authWithPassword('u@test.dev', 'secret123')
    const { s } = await use<AuthStore>(pbAuth(pb))
    await s.connect()
    expect(s.user?.email).toBe('u@test.dev')

    const stale = client()
    stale.authStore.save(pb.authStore.token.slice(0, -4) + 'xxxx', pb.authStore.record)
    const { s: staleAuth } = await use<AuthStore>(pbAuth(stale))
    expect(staleAuth.isLoggedIn).toBe(true)
    await staleAuth.connect()
    expect(staleAuth.isLoggedIn).toBe(false)
  })
})
