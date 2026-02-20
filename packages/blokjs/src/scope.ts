export class Scope {
  private unsubs: (() => void)[] = []
  private children: Scope[] = []
  private parent: Scope | null = null

  track(unsub: () => void): void {
    this.unsubs.push(unsub)
  }

  child(): Scope {
    const s = new Scope()
    s.parent = this
    this.children.push(s)
    return s
  }

  dispose(): void {
    const children = [...this.children]
    for (const c of children) {
      c.parent = null
      c.dispose()
    }
    for (let i = this.unsubs.length - 1; i >= 0; i--) {
      try { this.unsubs[i]() } catch (e) { console.warn('[blok] Error during scope cleanup:', e) }
    }
    this.children = []
    this.unsubs = []
    if (this.parent) {
      const idx = this.parent.children.indexOf(this)
      if (idx !== -1) this.parent.children.splice(idx, 1)
      this.parent = null
    }
  }
}
