#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import { Window } from 'happy-dom'

const file = process.argv[2]
if (!file) {
  console.error('Usage: blokjs-check <file.html>')
  process.exit(2)
}

const htmlPath = resolve(file)
const htmlDir = dirname(htmlPath)
const html = readFileSync(htmlPath, 'utf-8')

// Setup happy-dom
const window = new Window({ url: 'http://localhost' })
const document = window.document

// Parse body content into the DOM
const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)
const bodyHtml = bodyMatch ? bodyMatch[1] : html

// Extract scripts before setting innerHTML (we run them manually via vm)
const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi
const scripts = []
let match
while ((match = scriptRegex.exec(bodyHtml)) !== null) {
  const tag = match[0]
  const srcMatch = tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i)
  if (srcMatch) {
    const src = srcMatch[1]
    // Skip remote/CDN scripts
    if (/^https?:\/\//i.test(src)) continue
    const scriptPath = resolve(htmlDir, src.replace(/^\//, ''))
    try {
      scripts.push({ code: readFileSync(scriptPath, 'utf-8'), src: scriptPath })
    } catch (e) {
      console.error(`Could not read script: ${scriptPath}`)
      process.exit(2)
    }
  } else {
    scripts.push({ code: match[1], src: htmlPath })
  }
}

// Set body without scripts
document.body.innerHTML = bodyHtml.replace(scriptRegex, '')

// Capture [blok warn] messages
const warnings = []
const originalWarn = console.warn
window.console.warn = (...args) => {
  const msg = args.join(' ')
  if (msg.includes('[blok warn]')) {
    warnings.push(msg)
  }
}

// Resolve blokjs dev build (IIFE with __DEV__: true)
const require = createRequire(import.meta.url)
const blokjsPath = require.resolve('@maleta/blokjs')
const blokjsCode = readFileSync(blokjsPath, 'utf-8')

// Create vm context with happy-dom globals
const context = vm.createContext(window, { name: 'blokjs-check' })

// Run blokjs in context
try {
  vm.runInContext(blokjsCode, context, { filename: blokjsPath })
} catch (e) {
  console.error('Failed to load blokjs:', e.message)
  process.exit(2)
}

// Run user scripts
for (const script of scripts) {
  try {
    vm.runInContext(script.code, context, { filename: script.src })
  } catch (e) {
    console.error(`Script error in ${script.src}:`, e.message)
  }
}

// Dispatch DOMContentLoaded for scripts that listen for it
try {
  const event = new window.Event('DOMContentLoaded')
  window.document.dispatchEvent(event)
} catch {
  // ignore if dispatch fails
}

// Output results
if (warnings.length === 0) {
  console.log('No warnings found.')
  process.exit(0)
} else {
  console.log(`Found ${warnings.length} warning(s):\n`)
  for (const w of warnings) {
    console.log(w)
  }
  process.exit(1)
}
