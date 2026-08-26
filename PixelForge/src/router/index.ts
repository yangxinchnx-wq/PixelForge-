import { createRouter, createMemoryHistory } from 'vue-router';
import App from '../App.vue';

const router = createRouter({
  history: createMemoryHistory(),
  routes: [
    {
      path: '/',
      name: 'home',
      component: App,
    },
  ],
});

export default router;
