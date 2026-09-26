import { describe, it, expect } from 'vitest'
import type { RecordModel } from 'pocketbase'
import { pbAuth, type AuthStore } from '../src'
import { fakePb, ResponseError } from './fake-pb'
import { tick, use } from './helpers'

type Tracked = AuthStore & { loading: any; error: any }

const user = { id: 'u1', collectionId: 'u', collectionName: 'users', email: 'a@b.c' } as RecordModel

describe('pbAuth', () => {
  it('starts from a valid saved session, as a copy', async () => {
    const fake = fakePb()
    fake.authStore.save('t', user)
    const { s } = await use<Tracked>(pbAuth(fake.pb))

    expect(s.user?.email).toBe('a@b.c')
    expect(s.isLoggedIn).toBe(true)
    s.user!.email = 'changed'
    expect(fake.authStore.record?.email).toBe('a@b.c')
  })

  it('treats a stored record without a valid token as logged out', async () => {
    const fake = fakePb()
    fake.authStore.record = user
    const { s } = await use<Tracked>(pbAuth(fake.pb))

    expect(s.user).toBeNull()
    expect(s.isLoggedIn).toBe(false)
  })

  it('login() and logout() update user and the view', async () => {
    const fake = fakePb()
    const { s, el } = await use<Tracked>(pbAuth(fake.pb), (_$, st) => ({ div: { children: [
      { when: st.isLoggedIn, children: [{ span: { text: st.user.email } }] },
    ] } }))

    await s.login('x@y.z', 'secret')
    await tick()
    expect(s.user?.email).toBe('x@y.z')
    expect(el.textContent).toBe('x@y.z')
    expect(fake.col.authWithPassword).toHaveBeenCalledWith('x@y.z', 'secret', { requestKey: null })

    s.logout()
    await tick()
    expect(s.isLoggedIn).toBe(false)
    expect(el.textContent).toBe('')
  })

  it('login() failure lands in error.login', async () => {
    const fake = fakePb()
    const { s } = await use<Tracked>(pbAuth(fake.pb, { collection: 'members' }))

    await expect(s.login('x@y.z', 'wrong')).rejects.toThrow()

    expect(fake.pb.collection).toHaveBeenCalledWith('members')
    expect(s.error.login.status).toBe(400)
    expect(s.user).toBeNull()
  })

  it('connect() refreshes a session the server accepts', async () => {
    const fake = fakePb()
    fake.authStore.save('t', user)
    const { s } = await use<Tracked>(pbAuth(fake.pb))

    await s.connect()

    expect(fake.col.authRefresh).toHaveBeenCalledWith({ requestKey: null })
    expect(s.user?.id).toBe('u1')
  })

  it('connect() clears a session the server rejects', async () => {
    const fake = fakePb()
    fake.authStore.save('t', user)
    fake.col.authRefresh.mockRejectedValueOnce(new ResponseError(401))
    const { s } = await use<Tracked>(pbAuth(fake.pb))

    await s.connect()

    expect(s.user).toBeNull()
    expect(s.error.connect).toBeNull()
  })

  it('connect() keeps the session when the server is unreachable', async () => {
    const fake = fakePb()
    fake.authStore.save('t', user)
    fake.col.authRefresh.mockRejectedValueOnce(new ResponseError(0))
    const { s } = await use<Tracked>(pbAuth(fake.pb))

    await expect(s.connect()).rejects.toThrow()

    expect(s.user?.id).toBe('u1')
    expect(s.error.connect.status).toBe(0)
  })

  it('connect() follows changes made directly through the SDK', async () => {
    const fake = fakePb()
    const { s } = await use<Tracked>(pbAuth(fake.pb))
    await s.connect()

    fake.authStore.save('t', user)
    expect(s.user?.email).toBe('a@b.c')

    fake.authStore.clear()
    expect(s.user).toBeNull()
    expect(fake.col.authRefresh).not.toHaveBeenCalled()
  })
})
