import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// El backend se sirve bajo el mismo origen en desarrollo mediante proxy, para que la
// cookie de refresh (path=/api/v1/auth) viaje sin CORS ni restricciones de SameSite.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // El kit declara react/react-dom como peers; dedupe garantiza una sola copia,
  // porque dos copias de React rompen los hooks.
  resolve: { dedupe: ['react', 'react-dom'] },
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
