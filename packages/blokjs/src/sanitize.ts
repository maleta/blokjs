const SAFE_URL_RE = /^\s*(https?:|mailto:|tel:|#|\/(?!\/))/i

export function sanitizeURL(value: string): string {
  const trimmed = value.trim()
  if (trimmed === '' || SAFE_URL_RE.test(trimmed)) return trimmed
  // Block protocol-relative URLs
  if (trimmed.startsWith('//')) return ''
  // Bare paths like "about" or "./page" are safe (no protocol)
  if (!trimmed.includes(':')) return value
  return ''
}

export function setRawHTML(el: HTMLElement, html: string): void {
  el.innerHTML = html
}
