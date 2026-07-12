import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // Set BASE_PATH (e.g. "/my-repo/") when deploying under a sub-path such as
  // GitHub Pages project sites. Vite rewrites absolute URLs in index.html.
  base: process.env.BASE_PATH ?? '/',
  plugins: [react()],
  server: {
    host: true
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500
  }
})
