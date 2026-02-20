import { readdirSync } from 'node:fs'
import { resolve, basename, extname } from 'node:path'
import type { Plugin } from 'vite'

const VIRTUAL_ID = 'virtual:blokjs'
const RESOLVED_ID = '\0' + VIRTUAL_ID

interface BlokPluginOptions {
  componentsDir?: string
  storesDir?: string
}

export function blokjs(options: BlokPluginOptions = {}): Plugin {
  const componentsDir = options.componentsDir ?? 'components'
  const storesDir = options.storesDir ?? 'stores'

  return {
    name: 'vite-plugin-blokjs',

    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID
    },

    load(id) {
      if (id !== RESOLVED_ID) return

      const root = process.cwd()
      const lines: string[] = [
        "import { component, store } from '@maleta/blokjs'",
        '',
      ]

      let idx = 0

      const compDir = resolve(root, componentsDir)
      for (const file of safeReaddir(compDir)) {
        const name = basename(file, extname(file))
        if (name.startsWith('_')) continue
        const varName = `_c${idx++}`
        lines.push(`import ${varName} from '/${componentsDir}/${file}'`)
        lines.push(`component('${name}', ${varName})`)
      }

      const strDir = resolve(root, storesDir)
      for (const file of safeReaddir(strDir)) {
        const name = basename(file, extname(file))
        if (name.startsWith('_')) continue
        const varName = `_s${idx++}`
        lines.push(`import ${varName} from '/${storesDir}/${file}'`)
        lines.push(`store('${name}', ${varName})`)
      }

      return lines.join('\n')
    },
  }
}

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir).filter((f: string) => /\.(js|ts|mjs)$/.test(f))
  } catch {
    return []
  }
}
