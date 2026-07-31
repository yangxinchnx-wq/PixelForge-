import { createApp } from 'vue';
import { createPinia } from 'pinia';
import router from './router';
import App from './App.vue';
import PhosphorIcons from '@phosphor-icons/vue';
import './styles/index.css';
import { initStorage } from './storage';
import tooltipDirective from './directives/tooltip';

function bootstrap() {
  const app = createApp(App);
  app.use(createPinia());
  app.use(router);
  app.use(PhosphorIcons);
  app.directive('tooltip', tooltipDirective);

  // 先挂载应用，让 UI 立即渲染（使用 localStorage 同步加载的初始数据）
  app.mount('#app');

  // 异步初始化三层存储系统（L1 内存 LRU + L2 OPFS + L3 Redb）
  // 不阻塞启动：存储层内部会自动降级，loadFromUnifiedStore 会等待 ready
  initStorage().catch((e) => {
    console.warn('[Bootstrap] 存储系统初始化失败，使用降级模式', e);
  });
}

bootstrap();
