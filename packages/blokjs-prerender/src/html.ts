export interface Tag {
  name: string
  closing: boolean
  attrs: Record<string, string>
  start: number
  end: number
}

const TOKEN = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*\/?>/g
const ATTR = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title'])
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'])

function parseAttrs(src: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  for (const m of src.matchAll(ATTR)) {
    attrs[m[1].toLowerCase()] = decode(m[2] ?? m[3] ?? m[4] ?? '')
  }
  return attrs
}

function decode(s: string): string {
  return s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
}

/**
 * Start and end tags of an HTML document in order. Comments are skipped, and the content
 * of script, style, textarea and title is passed over, so markup inside strings is never matched.
 */
export function* tags(html: string, from = 0): Generator<Tag> {
  const token = new RegExp(TOKEN.source, 'g')
  token.lastIndex = from
  let m: RegExpExecArray | null
  while ((m = token.exec(html))) {
    if (!m[2]) continue
    const tag: Tag = {
      name: m[2].toLowerCase(),
      closing: m[1] === '/',
      attrs: parseAttrs(m[3]),
      start: m.index,
      end: m.index + m[0].length,
    }
    yield tag
    if (!tag.closing && RAW_TEXT.has(tag.name)) {
      const close = new RegExp(`</${tag.name}\\s*>`, 'ig')
      close.lastIndex = tag.end
      const c = close.exec(html)
      token.lastIndex = c ? c.index : html.length
    }
  }
}

export interface ElementRange {
  name: string
  openStart: number
  openEnd: number
  closeStart: number
}

/** Locate the element with the given id: its start tag and the start of its matching end tag. */
export function findElementById(html: string, id: string): ElementRange | null {
  for (const open of tags(html)) {
    if (open.closing || open.attrs.id !== id) continue
    if (VOID.has(open.name)) return null
    let depth = 1
    for (const t of tags(html, open.end)) {
      if (t.name !== open.name) continue
      depth += t.closing ? -1 : 1
      if (depth === 0) return { name: open.name, openStart: open.start, openEnd: open.end, closeStart: t.start }
    }
    return null
  }
  return null
}

export interface ScriptTag {
  attrs: Record<string, string>
  code: string
  /** Range of the whole element, end tag included */
  start: number
  end: number
}

/** All script elements in document order, with their inline code. */
export function scripts(html: string): ScriptTag[] {
  const out: ScriptTag[] = []
  for (const t of tags(html)) {
    if (t.closing || t.name !== 'script') continue
    const close = /<\/script\s*>/ig
    close.lastIndex = t.end
    const c = close.exec(html)
    out.push({
      attrs: t.attrs,
      code: html.slice(t.end, c ? c.index : html.length),
      start: t.start,
      end: c ? c.index + c[0].length : html.length,
    })
  }
  return out
}
