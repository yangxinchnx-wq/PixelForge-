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
      'animejs',
    ],
  },
  build: {
    // 启用 CSS 代码分割，按组件拆分样式
    cssCodeSplit: true,
    // chunk 大小警告阈值（KB）
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        assetFileNames: 'assets/[name].[ext]',
        // 手动代码分割：将 vendor 库拆分为独立 chunk，
        // 让浏览器并行加载并长期缓存
        // 注意：Vite 8 (Rolldown) 要求 manualChunks 为函数形式
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined;
          // Vue 核心框架（vue + vue-router + pinia）
          // 使用 /node_modules/ 前缀避免匹配 @phosphor-icons/vue
          if (
            id.includes('/node_modules/vue/') ||
            id.includes('/node_modules/vue-router/') ||
            id.includes('/node_modules/pinia/')
          ) {
            return 'vendor-vue';
          }
          // Phosphor 图标库
          if (id.includes('/node_modules/@phosphor-icons/')) {
            return 'vendor-icons';
          }
          // 动画引擎
          if (id.includes('/node_modules/animejs/')) {
            return 'vendor-anime';
          }
          // 视频编码器（mp4-muxer + webm-muxer，仅在导出时需要）
          if (id.includes('/node_modules/mp4-muxer/') || id.includes('/node_modules/webm-muxer/')) {
            return 'vendor-video';
          }
          // Tauri 桥接 API
          if (id.includes('/node_modules/@tauri-apps/')) {
            return 'vendor-tauri';
          }
          return undefined;
        },
      },
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
})
