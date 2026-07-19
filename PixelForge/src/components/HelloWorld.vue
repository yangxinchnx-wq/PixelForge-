<script setup lang="ts">
import { useCounterStore } from '@/stores/counter'

defineProps<{
  msg: string
}>()

const counterStore = useCounterStore()
</script>

<template>
  <h1>{{ msg }}</h1>

  <div class="card">
    <p>
      这是一个 <strong>Tauri + Vue 3.5.4 + Pinia 4.0.2</strong> 应用
    </p>
    <button type="button" class="counter-btn" @click="counterStore.increment()">
      当前计数: {{ counterStore.count }}
    </button>
    <button type="button" class="reset-btn" @click="counterStore.reset()">
      重置
    </button>
  </div>
</template>

<style scoped>
.card {
  padding: 2rem;
}

button {
  margin-right: 1rem;
}

.counter-btn {
  display: inline-block;
  font-size: 1rem;
  font-weight: 600;
  padding: 0.75rem 1rem;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
  background: #34d399;
  color: #fff;
  border: none;
}

.counter-btn:hover {
  background: #10b981;
  transform: scale(1.05);
}

.reset-btn {
  background: #f87171;
  border: none;
  border-radius: 8px;
  padding: 0.75rem 1rem;
  font-size: 1rem;
  font-weight: 600;
  color: #fff;
  cursor: pointer;
  transition: all 0.2s;
}

.reset-btn:hover {
  background: #ef4444;
  transform: scale(1.05);
}
</style>
