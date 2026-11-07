import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// El backend se sirve bajo el mismo origen en desarrollo mediante proxy.
// Así la cookie de refresh (path=/api/v1/auth) viaja sin CORS ni SameSite.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET ?? 'http://localhost:8000',
        changeOrigin: false,
      },
    },
  },
})
