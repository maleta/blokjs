import { describe, it, expect } from 'vitest'
import { sanitizeURL } from '../src/sanitize'

describe('sanitizeURL', () => {
  it('allows https URLs', () => {
    expect(sanitizeURL('https://example.com')).toBe('https://example.com')
  })

  it('allows http URLs', () => {
    expect(sanitizeURL('http://example.com')).toBe('http://example.com')
  })

  it('allows mailto links', () => {
    expect(sanitizeURL('mailto:user@example.com')).toBe('mailto:user@example.com')
  })

  it('allows tel links', () => {
    expect(sanitizeURL('tel:+1234567890')).toBe('tel:+1234567890')
  })

  it('allows fragment-only URLs', () => {
    expect(sanitizeURL('#section')).toBe('#section')
  })

  it('allows relative paths starting with /', () => {
    expect(sanitizeURL('/about')).toBe('/about')
  })

  it('blocks javascript: protocol', () => {
    expect(sanitizeURL('javascript:alert(1)')).toBe('')
  })

  it('blocks data: protocol', () => {
    expect(sanitizeURL('data:text/html,<script>alert(1)</script>')).toBe('')
  })

  it('blocks protocol-relative URLs (//) ', () => {
    expect(sanitizeURL('//evil.com/payload')).toBe('')
  })

  it('trims whitespace and returns trimmed result', () => {
    expect(sanitizeURL('  https://example.com  ')).toBe('https://example.com')
  })

  it('returns empty string for empty input', () => {
    expect(sanitizeURL('')).toBe('')
    expect(sanitizeURL('   ')).toBe('')
  })

  it('allows bare paths without colon', () => {
    expect(sanitizeURL('about')).toBe('about')
    expect(sanitizeURL('./page')).toBe('./page')
  })
})
