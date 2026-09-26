import { store, mount } from '@maleta/blokjs'

type View = ($: any, s: any) => object

let count = 0

export function tick(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0))
}

// Registers the definition as a real BlokJS store and returns its proxy plus the rendered element.
export async function use<T>(def: object, view: View = () => ({ div: {} }), isolated = false) {
  const name = `store${++count}`
  store(name, def as never)
  return { name, ...(await mountStore<T>(name, view, isolated)) }
}

export async function mountStore<T>(name: string, view: View, isolated = false) {
  let s!: T
  const el = document.createElement('div')
  document.body.append(el)
  mount(el, {
    isolated,
    mount(this: any) {
      s = this.store[name]
    },
    view: ($: any) => view($, $.store[name]),
  })
  await tick()
  return { s, el }
}
