import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': {
        target: 'https://research-canvas-api-jxycyus54a-as.a.run.app',
        changeOrigin: true,
        secure: true,
      },
    },
  },

})
