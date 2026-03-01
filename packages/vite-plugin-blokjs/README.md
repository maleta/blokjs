# vite-plugin-blokjs

Vite plugin for BlokJS - auto-discovers components and stores by filename convention.

## Install

```bash
npm i -D vite-plugin-blokjs
```

## Usage

```js
// vite.config.js
import { defineConfig } from 'vite'
import { blokjs } from 'vite-plugin-blokjs'

export default defineConfig({
  plugins: [blokjs()]
})
```

Then import the virtual module in your app:

```js
import 'virtual:blokjs'
```

The plugin scans your project for `components/*.js` and `stores/*.js` files and auto-registers them with BlokJS. No manual imports needed.

## Options

| Option | Default | Description |
|--------|---------|-------------|
| `componentsDir` | `'components'` | Directory to scan for component files |
| `storesDir` | `'stores'` | Directory to scan for store files |

```js
blokjs({
  componentsDir: 'src/components',
  storesDir: 'src/stores'
})
```

## Links

- [BlokJS](https://github.com/maleta/blokjs)
- [Issues](https://github.com/maleta/blokjs/issues)
