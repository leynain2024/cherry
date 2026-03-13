import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { ensureLocalHttpsCertificate } from './server/https-cert.js'

const httpsOptions = ensureLocalHttpsCertificate(process.cwd())

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    https: httpsOptions,
    port: 3133,
    proxy: {
      '/api': {
        target: 'https://127.0.0.1:3135',
        changeOrigin: true,
        secure: false,
      },
      '/uploads': {
        target: 'https://127.0.0.1:3135',
        changeOrigin: true,
        secure: false,
      },
      '/audio-assets': {
        target: 'https://127.0.0.1:3135',
        changeOrigin: true,
        secure: false,
      },
    },
  },
  preview: {
    host: '0.0.0.0',
    https: httpsOptions,
    port: 3133,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/setupTests.ts',
  },
})
