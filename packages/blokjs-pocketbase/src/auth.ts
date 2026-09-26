import type PocketBase from 'pocketbase'
import type { RecordModel } from 'pocketbase'

export interface AuthOptions {
  /** Auth collection that `login()` authenticates against. Defaults to `users`. */
  collection?: string
}

/** The store as seen through `this.store.<name>` in BlokJS. */
export interface AuthStore {
  user: RecordModel | null
  readonly isLoggedIn: boolean
  connect(): Promise<void>
  login(identity: string, password: string): Promise<RecordModel>
  logout(): void
}

function statusOf(err: unknown): number | undefined {
  return (err as { status?: number } | null)?.status
}

/**
 * Store definition for `blok.store()` that mirrors `pb.authStore` into reactive `user` and `isLoggedIn`.
 *
 * `connect()` validates a saved session with the server (clearing it when rejected) and follows
 * every later auth change, including ones made directly through the SDK or in another tab.
 * `login()` and `logout()` also start following changes, so `connect()` is optional for them.
 *
 * @param pb - PocketBase SDK client owned by the app
 */
export function pbAuth(pb: PocketBase, options: AuthOptions = {}) {
  const collection = options.collection ?? 'users'
  const followed = new WeakSet<object>()

  // A copy, so edits to `user` in the app never reach the SDK's record.
  function current(): RecordModel | null {
    const record = pb.authStore.isValid ? pb.authStore.record : null
    return record && structuredClone(record)
  }

  function follow(store: AuthStore): void {
    if (followed.has(store)) return
    followed.add(store)
    store.user = current()
    pb.authStore.onChange(() => {
      store.user = current()
    })
  }

  return {
    state: { user: current() },
    computed: {
      isLoggedIn(this: AuthStore): boolean {
        return this.user !== null
      },
    },
    methods: {
      async connect(this: AuthStore): Promise<void> {
        follow(this)
        const record = pb.authStore.record
        if (!pb.authStore.isValid || !record) return
        try {
          await pb.collection(record.collectionName ?? collection).authRefresh({ requestKey: null })
        } catch (err) {
          const status = statusOf(err)
          if (status !== 401 && status !== 404) throw err
          pb.authStore.clear()
        }
      },

      async login(this: AuthStore, identity: string, password: string): Promise<RecordModel> {
        follow(this)
        const { record } = await pb.collection(collection).authWithPassword(identity, password, { requestKey: null })
        return record
      },

      logout(this: AuthStore): void {
        follow(this)
        pb.authStore.clear()
      },
    },
  }
}
