import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const CLOUD_API_TARGET = 'https://research-canvas-api-iwuz3k44oa-as.a.run.app'

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
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined;
            if (id.includes('@univerjs') || id.includes('hyperformula') || id.includes('@zwight') || id.includes('xlsx')) {
              return 'spreadsheet-vendor';
            }
            if (id.includes('pdfjs-dist') || id.includes('@react-pdf-viewer')) {
              return 'pdf-vendor';
            }
            if (id.includes('mermaid') || id.includes('cytoscape')) {
              return 'diagram-vendor';
            }
            if (id.includes('echarts') || id.includes('recharts')) {
              return 'charts-vendor';
            }
            if (id.includes('@tiptap') || id.includes('@blocknote')) {
              return 'editor-vendor';
            }
            if (id.includes('antd') || id.includes('@ant-design')) {
              return 'antd-vendor';
            }
            return undefined;
          },
        },
      },
    },
  }
})
