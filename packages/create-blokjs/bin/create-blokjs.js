#!/usr/bin/env node

import { cpSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectName = process.argv[2] || 'my-blokjs-app'
const targetDir = resolve(process.cwd(), projectName)
const templateDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'template')

cpSync(templateDir, targetDir, { recursive: true })

const pkgPath = resolve(targetDir, 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
pkg.name = basename(projectName)
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')

console.log(`\nCreated ${projectName}!\n`)
console.log('Next steps:')
console.log(`  cd ${projectName}`)
console.log('  npm install')
console.log('  npx vite')
console.log('')
