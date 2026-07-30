<script setup lang="ts">
import type { DemoScenario } from '@/compiler/region/demoIR'

const props = defineProps<{
  scenarios: DemoScenario[]
  currentScenario: DemoScenario
  currentLayerId: string | null
  currentOpcode: string | null
}>()

const emit = defineEmits<{
  selectScenario: [scenario: DemoScenario]
}>()

const scenarioMeta: Record<DemoScenario, { title: string; description: string }> = {
  gradient: {
    title: '线性渐变',
    description: '观察颜色插值、参数替换与补丁注入结果。',
  },
  solid: {
    title: '纯色填充',
    description: '验证基础输出、颜色覆盖与画布呈现链路。',
  },
  noise: {
    title: '噪声纹理',
    description: '检查噪声参数扰动、编译输出与分布变化。',
  },
  circle: {
    title: '圆形图层',
    description: '验证几何图形参数、区域编译与边缘表现。',
  },
  multi_layer: {
    title: '多图层组合',
    description: '三层叠加：渐变背景 + 圆形 + 噪声，验证图层排序与混合。',
  },
  blend_demo: {
    title: '混合模式演示',
    description: '多个圆形图层使用 screen/add 混合模式叠加。',
  },
  effect_demo: {
    title: '效果系统演示',
    description: '渐变 + 圆形图层叠加暗角与泛光效果。',
  },
}
</script>

<template>
  <aside class="app-sidebar">
    <div class="sidebar-section brand-block compact-brand-block">
      <div class="brand-mark compact-brand-mark" />
      <div>
        <p class="section-kicker">链路验证</p>
        <h1 class="sidebar-title compact-sidebar-title">图形运行验证台</h1>
      </div>
    </div>

    <section class="sidebar-section compact-panel">
      <div class="section-head">
        <p class="section-kicker">当前状态</p>
      </div>

      <dl class="fact-list">
        <div class="fact-row">
          <dt>图层</dt>
          <dd>{{ props.currentLayerId ?? '无' }}</dd>
        </div>
        <div class="fact-row">
          <dt>指令</dt>
          <dd>{{ props.currentOpcode ?? '无' }}</dd>
        </div>
        <div class="fact-row">
          <dt>模式</dt>
          <dd>区域运行</dd>
        </div>
      </dl>
    </section>

    <section class="sidebar-section">
      <div class="section-head">
        <p class="section-kicker">场景切换</p>
        <span class="section-count">{{ scenarios.length }}</span>
      </div>

      <div class="scenario-list">
        <button
          v-for="scenario in props.scenarios"
          :key="scenario"
          type="button"
          class="scenario-card"
          :class="{ active: scenario === props.currentScenario }"
          @click="emit('selectScenario', scenario)"
        >
          <span class="scenario-name">{{ scenarioMeta[scenario].title }}</span>
          <span class="scenario-description">{{ scenarioMeta[scenario].description }}</span>
        </button>
      </div>
    </section>
  </aside>
</template>
