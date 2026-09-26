import { describe, it, expect } from 'vitest'
import type { RecordModel } from 'pocketbase'
import { pbCollection, type CollectionStore } from '../src'
import { fakePb, ResponseError } from './fake-pb'
import { tick, use, mountStore } from './helpers'

const rec = (id: string, fields: Record<string, unknown> = {}) => ({ id, collectionId: 'c1', collectionName: 'notes', ...fields }) as RecordModel
const titles = (s: CollectionStore) => s.items.map((r) => r.title)
const listView = ($: any, s: any) => ({
  ul: { children: [{ each: s.items, as: 'r', key: 'id', children: [{ li: { text: $.r.title } }] }] },
})

describe('pbCollection - load', () => {
  it('fills items with the query options and renders them', async () => {
    const fake = fakePb([rec('a', { title: 'A' }), rec('b', { title: 'B' })])
    const { s, el } = await use<CollectionStore>(pbCollection(fake.pb, 'notes', { sort: '-updated', expand: 'author' }), listView)

    await s.load()
    await tick()

    expect(titles(s)).toEqual(['A', 'B'])
    expect(el.textContent).toBe('AB')
    expect(fake.col.getFullList).toHaveBeenCalledWith({
      filter: undefined, sort: '-updated', expand: 'author', fields: undefined, requestKey: null,
    })
  })

  it('reports failures through loading and error', async () => {
    const fake = fakePb()
    fake.col.list.mockRejectedValueOnce(new ResponseError(403))
    const { s } = await use<CollectionStore & { loading: any; error: any }>(pbCollection(fake.pb, 'notes'))

    await expect(s.load()).rejects.toThrow('status 403')

    expect(s.loading.load).toBe(false)
    expect(s.error.load.status).toBe(403)
  })
})

describe('pbCollection - realtime', () => {
  it('applies create, update and delete events', async () => {
    const fake = fakePb([rec('a', { title: 'A' }), rec('b', { title: 'B' })])
    const { s, el } = await use<CollectionStore>(pbCollection(fake.pb, 'notes'), listView)
    await s.connect()

    fake.emit('create', rec('c', { title: 'C' }))
    fake.emit('update', rec('a', { title: 'A2' }))
    fake.emit('delete', rec('b'))
    await tick()

    expect(titles(s)).toEqual(['A2', 'C'])
    expect(el.textContent).toBe('A2C')
    expect(fake.col.getFullList).toHaveBeenCalledTimes(1)
  })

  it('ignores the echo of its own save', async () => {
    const fake = fakePb()
    const { s } = await use<CollectionStore>(pbCollection(fake.pb, 'notes'))
    await s.connect()

    const saved = await s.save({ title: 'N' })
    fake.emit('create', saved)
    await tick()

    expect(titles(s)).toEqual(['N'])
  })

  it('keeps a plain field sort when patching', async () => {
    const fake = fakePb([rec('b', { n: 3 }), rec('a', { n: 1 })])
    const { s } = await use<CollectionStore>(pbCollection(fake.pb, 'notes', { sort: '-n,title' }))
    await s.connect()

    fake.emit('create', rec('c', { n: 2 }))
    await tick()
    expect(s.items.map((r) => r.id)).toEqual(['b', 'c', 'a'])

    fake.emit('update', rec('a', { n: 5 }))
    await tick()
    expect(s.items.map((r) => r.id)).toEqual(['a', 'b', 'c'])
  })

  it('applies events that arrive during the initial load on top of it', async () => {
    const fake = fakePb()
    let release!: (rows: RecordModel[]) => void
    fake.col.list.mockImplementationOnce(() => new Promise((r) => (release = r)))
    const { s } = await use<CollectionStore>(pbCollection(fake.pb, 'notes'))

    const connecting = s.connect()
    while (!release) await tick()
    fake.emit('create', rec('c', { title: 'C' }))
    release([rec('a', { title: 'A' })])
    await connecting
    await tick()

    expect(titles(s)).toEqual(['A', 'C'])
  })

  it('reloads a filtered store instead of patching, but removes deletes locally', async () => {
    const fake = fakePb([rec('a', { title: 'A', done: false }), rec('b', { title: 'B', done: false })])
    fake.col.list.mockImplementation(async () => [...fake.db.values()].filter((r) => !r.done))
    const { s } = await use<CollectionStore>(pbCollection(fake.pb, 'notes', { filter: 'done = false' }))
    await s.connect()

    fake.db.set('a', rec('a', { title: 'A', done: true }))
    fake.emit('update', fake.db.get('a')!)
    await tick()
    expect(titles(s)).toEqual(['B'])
    expect(fake.col.getFullList).toHaveBeenCalledTimes(2)

    fake.emit('delete', rec('b'))
    await tick()
    expect(titles(s)).toEqual([])
    expect(fake.col.getFullList).toHaveBeenCalledTimes(2)
  })

  it('coalesces reloads for a burst of events', async () => {
    const fake = fakePb([rec('a')])
    const { s } = await use<CollectionStore>(pbCollection(fake.pb, 'notes', { filter: 'x = 1' }))
    await s.connect()

    fake.emit('update', rec('a'))
    fake.emit('update', rec('a'))
    fake.emit('create', rec('b'))
    await tick()

    expect(fake.col.getFullList).toHaveBeenCalledTimes(2)
  })

  it('reloads for a sort only the server can apply', async () => {
    const fake = fakePb()
    const { s } = await use<CollectionStore>(pbCollection(fake.pb, 'notes', { sort: '@random' }))
    await s.connect()

    fake.emit('create', rec('a'))
    await tick()

    expect(fake.col.getFullList).toHaveBeenCalledTimes(2)
  })

  it('reloads after the realtime connection reconnects', async () => {
    const fake = fakePb()
    const { s } = await use<CollectionStore>(pbCollection(fake.pb, 'notes'))
    await s.connect()

    fake.reconnect()
    await tick()

    expect(fake.col.getFullList).toHaveBeenCalledTimes(2)
  })

  it('reconnects when the signed-in user changes, not on a token refresh', async () => {
    const fake = fakePb()
    const { s } = await use<CollectionStore>(pbCollection(fake.pb, 'notes'))
    await s.connect()

    fake.authStore.save('t1', rec('u1'))
    await tick()
    expect(fake.pb.realtime.disconnect).toHaveBeenCalledTimes(1)
    expect(fake.col.subscribe).toHaveBeenCalledTimes(2)
    expect(fake.col.getFullList).toHaveBeenCalledTimes(2)
    expect(fake.subscribers).toBe(2)

    fake.authStore.save('t2', rec('u1'))
    await tick()
    expect(fake.col.subscribe).toHaveBeenCalledTimes(2)
  })

  it('stops applying events after disconnect()', async () => {
    const fake = fakePb()
    const { s } = await use<CollectionStore>(pbCollection(fake.pb, 'notes'))
    await s.connect()

    await s.disconnect()
    fake.emit('create', rec('a'))
    fake.authStore.save('t1', rec('u1'))
    await tick()

    expect(fake.subscribers).toBe(0)
    expect(s.items).toEqual([])
    expect(fake.col.subscribe).toHaveBeenCalledTimes(1)
  })

  it('keeps one subscription when connect() runs twice at once', async () => {
    const fake = fakePb()
    const { s } = await use<CollectionStore>(pbCollection(fake.pb, 'notes'))

    await Promise.all([s.connect(), s.connect()])

    expect(fake.subscribers).toBe(2)
  })

  it('keeps sync state per instance across isolated mounts', async () => {
    const fake = fakePb()
    const { name, s: first } = await use<CollectionStore>(pbCollection(fake.pb, 'notes'), () => ({ div: {} }), true)
    const { s: second } = await mountStore<CollectionStore>(name, () => ({ div: {} }), true)
    await first.connect()
    await second.connect()

    await first.disconnect()
    fake.emit('create', rec('a'))
    await tick()

    expect(first.items).toEqual([])
    expect(second.items.map((r) => r.id)).toEqual(['a'])
  })
})

describe('pbCollection - save and remove', () => {
  it('creates without an id and updates with one', async () => {
    const fake = fakePb()
    const { s } = await use<CollectionStore>(pbCollection(fake.pb, 'notes', { expand: 'author' }))

    const created = await s.save({ title: 'X' })
    await s.save({ id: created.id, title: 'Y' })

    expect(fake.col.create).toHaveBeenCalledWith({ title: 'X' }, { expand: 'author', fields: undefined, requestKey: null })
    expect(fake.col.update).toHaveBeenCalledWith(created.id, { id: created.id, title: 'Y' }, { expand: 'author', fields: undefined, requestKey: null })
    expect(titles(s)).toEqual(['Y'])
  })

  it('updates the record with the same key on a unique conflict', async () => {
    const fake = fakePb([rec('a', { slug: 'one', title: 'A' })])
    const { s } = await use<CollectionStore>(pbCollection(fake.pb, 'notes', { key: 'slug' }))
    await s.load()

    const saved = await s.save({ slug: 'one', title: 'A2' })

    expect(saved.id).toBe('a')
    expect(fake.col.getFirstListItem).toHaveBeenCalledWith("slug = 'one'", { fields: 'id', requestKey: null })
    expect(titles(s)).toEqual(['A2'])
    expect(fake.db.size).toBe(1)
  })

  it('creates a new record for a new key', async () => {
    const fake = fakePb([rec('a', { slug: 'one' })])
    const { s } = await use<CollectionStore>(pbCollection(fake.pb, 'notes', { key: 'slug' }))
    await s.load()

    await s.save({ slug: 'two' })

    expect(fake.col.getFirstListItem).not.toHaveBeenCalled()
    expect(s.items.map((r) => r.slug)).toEqual(['one', 'two'])
  })

  it('rethrows errors other than a key conflict', async () => {
    const fake = fakePb()
    fake.col.create.mockRejectedValueOnce(new ResponseError(400, { data: { title: { code: 'validation_required' } } }))
    const { s } = await use<CollectionStore & { error: any }>(pbCollection(fake.pb, 'notes', { key: 'slug' }))

    await expect(s.save({ slug: 'one' })).rejects.toThrow('status 400')

    expect(s.error.save.status).toBe(400)
    expect(fake.col.update).not.toHaveBeenCalled()
  })

  it('remove() deletes the record and drops it from items', async () => {
    const fake = fakePb([rec('a'), rec('b')])
    const { s } = await use<CollectionStore>(pbCollection(fake.pb, 'notes'))
    await s.load()

    await s.remove('a')

    expect(fake.col.delete).toHaveBeenCalledWith('a', { requestKey: null })
    expect(s.items.map((r) => r.id)).toEqual(['b'])
  })
})
