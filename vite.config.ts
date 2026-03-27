import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET || 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
  css: {
    modules: {
      localsConvention: 'camelCase',
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-antd': ['antd', '@ant-design/icons'],
          'vendor-echarts': ['echarts', 'echarts-for-react'],
          'vendor-tiptap': [
            '@tiptap/react',
            '@tiptap/starter-kit',
            '@tiptap/extension-highlight',
            '@tiptap/extension-image',
            '@tiptap/extension-link',
            '@tiptap/extension-placeholder',
            '@tiptap/extension-table',
            '@tiptap/extension-table-cell',
            '@tiptap/extension-table-header',
            '@tiptap/extension-table-row',
          ],
          'vendor-blocknote': [
            '@blocknote/core',
            '@blocknote/react',
            '@blocknote/mantine',
          ],
          'vendor-univer': [
            '@univerjs/presets',
            '@univerjs/preset-sheets-core',
          ],
          'vendor-pdf': [
            'pdfjs-dist',
            '@react-pdf-viewer/core',
            '@react-pdf-viewer/default-layout',
          ],
          'vendor-copilotkit': [
            '@copilotkit/react-core',
            '@copilotkit/react-ui',
          ],
          'vendor-xyflow': ['@xyflow/react'],
          'vendor-markdown': ['react-markdown', 'remark-gfm', 'marked'],
        },
      },
    },
  },
})
