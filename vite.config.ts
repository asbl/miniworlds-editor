import { defineConfig } from 'vitest/config'
import preact from '@preact/preset-vite'
import { pwaPlugin } from './scripts/pwaPlugin'

export default defineConfig({
  // relative URLs: the build works from any folder of a web server (and inside an iframe of another site)
  base: './',
  plugins: [preact(), pwaPlugin()],
  build: { target: 'es2022' },
  test: { environment: 'node' },
})
