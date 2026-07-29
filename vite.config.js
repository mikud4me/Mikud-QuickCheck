import path from 'path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  logLevel: 'error', // Suppress warnings, only show errors
  plugins: [
    react(),
  ],
  // The "@/*" -> "src/*" alias used throughout this app was previously
  // supplied silently by @base44/vite-plugin; now that it's removed, Vite
  // needs its own native alias config (jsconfig.json's "paths" entry is
  // IDE-only, it was never what made the build itself resolve "@/").
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{js,jsx}', 'shared/**/*.test.{js,jsx}'],
  },
});