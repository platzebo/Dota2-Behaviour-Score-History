import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// GitHub Pages serves this repository under /Dota2-Behaviour-Score-History/.
export default defineConfig({
  base: '/Dota2-Behaviour-Score-History/',
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
  },
})
