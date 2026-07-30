import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  clearScreen: false,
  // 显式预构建所有依赖，避免运行时发现新依赖触发重新预构建（导致 ERR_ABORTED）
  optimizeDeps: {
    include: [
      'vue',
      'vue-router',
      'pinia',
      '@tauri-apps/api/core',
      '@guolao/vue-monaco-editor',
      'animejs',
    ],
  },
  build: {
    rollupOptions: {
      output: {
        assetFileNames: 'assets/[name].[ext]',
      },
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
})
