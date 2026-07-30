import { createApp } from 'vue';
import { createPinia } from 'pinia';
import router from './router';
import App from './App.vue';
import PhosphorIcons from '@phosphor-icons/vue';
import './styles/index.css';
import { initStorage } from './storage';

async function bootstrap() {
  // 初始化三层存储系统（L1 内存 LRU + L2 OPFS + L3 Redb）
  // 失败不阻塞启动，存储层内部会自动降级
  try {
    await initStorage();
  } catch (e) {
    console.warn('[Bootstrap] 存储系统初始化失败，使用降级模式', e);
  }

  const app = createApp(App);
  app.use(createPinia());
  app.use(router);
  app.use(PhosphorIcons);
  app.mount('#app');
}

void bootstrap();
