import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// Vite 配置：兼容 Node.js 18，端口固定 5173 便于联调
export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    open: false
  },
  build: {
    target: 'es2018',
    outDir: 'dist',
    sourcemap: false
  }
})
