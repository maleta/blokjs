import { defineConfig } from 'vite'
import { blokjs } from 'vite-plugin-blokjs'

export default defineConfig({
  plugins: [blokjs()],
})
