import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import './style.css'

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)

// —— 全局错误处理器(Step 40.4) ——
// 捕获所有未处理的 Vue 组件错误,推送到 errorStore 展示 toast。
// 注意:ErrorBoundary 已捕获的不会到达这里(返回 false 阻止冒泡)。
app.config.errorHandler = (err) => {
  // 延迟导入避免循环依赖
  void import('./stores/errorStore').then(({ useErrorStore }) => {
    const errorStore = useErrorStore()
    errorStore.push(err, '应用发生未捕获错误')
  })
  // console 兜底(便于调试)
  console.error('[App Error]', err)
}

app.mount('#app')
