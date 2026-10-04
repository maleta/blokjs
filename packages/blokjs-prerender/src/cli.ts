import { relative } from 'node:path'
import { prerender } from './prerender'

const USAGE = 'Usage: blokjs-prerender <page.html> [--routes / /about ...] [--out <dir>] [--inline]'

function parseArgs(argv: string[]): { file: string; routes?: string[]; out?: string; inline: boolean } {
  let file: string | undefined
  let routes: string[] | undefined
  let out: string | undefined
  let inline = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--routes') {
      routes = []
      while (argv[i + 1] && !argv[i + 1].startsWith('--')) routes.push(argv[++i])
    } else if (a === '--out') {
      out = argv[++i]
      if (!out) throw new Error('--out needs a directory')
    } else if (a === '--inline') {
      inline = true
    } else if (a.startsWith('--')) {
      throw new Error(`Unknown option ${a}`)
    } else if (!file) {
      file = a
    } else {
      throw new Error(`Unexpected argument ${a}`)
    }
  }
  if (!file) throw new Error('Missing page file')
  return { file, routes, out, inline }
}

let args: ReturnType<typeof parseArgs>
try {
  args = parseArgs(process.argv.slice(2))
} catch (e) {
  console.error(`${(e as Error).message}\n${USAGE}`)
  process.exit(2)
}

try {
  for (const r of await prerender(args.file, { routes: args.routes, out: args.out, inline: args.inline })) {
    console.log(`${r.route} -> ${relative(process.cwd(), r.file)}`)
  }
} catch (e) {
  console.error(`[blokjs-prerender] ${(e as Error).message}`)
  process.exit(1)
}
