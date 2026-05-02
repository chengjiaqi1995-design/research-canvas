import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const CLOUD_API_TARGET = 'https://research-canvas-api-jxycyus54a-as.a.run.app'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiTarget = env.VITE_API_TARGET || process.env.VITE_API_TARGET || CLOUD_API_TARGET
  const devPort = Number(env.VITE_DEV_PORT || process.env.VITE_DEV_PORT || 5174)

  return {
    plugins: [react(), tailwindcss()],
    define: {
      'import.meta.env.VITE_EFFECTIVE_API_TARGET': JSON.stringify(apiTarget),
    },
    server: {
      port: devPort,
      strictPort: true,
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
          secure: true,
        },
        '/ws': {
          target: apiTarget,
          changeOrigin: true,
          secure: true,
          ws: true,
        },
      },
    },
    css: {
      modules: {
        localsConvention: 'camelCase',
      },
    },
    build: {
      chunkSizeWarningLimit: 2500, // Suppress warnings for heavy chunks since they are now lazy-loaded
    },
  }
})
