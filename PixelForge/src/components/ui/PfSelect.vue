<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';

interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
  /** 鼠标悬停时的提示文字 */
  tooltip?: string;
}

const props = withDefaults(defineProps<{
  modelValue: string;
  options: SelectOption[];
  size?: 'normal' | 'small';
  title?: string;
  block?: boolean;
  /** 下拉菜单宽度（px），不设置则跟随 select 宽度 */
  menuWidth?: number;
  /** 下拉菜单宽度匹配指定父元素的内容宽度（CSS 选择器，从 rootRef 向上查找） */
  menuMatchSelector?: string;
  /** 下拉菜单展开方向：'auto'（自动）| 'top'（始终向上）| 'bottom'（始终向下） */
  menuPlacement?: 'auto' | 'top' | 'bottom';
}>(), {
  size: 'normal',
  title: '',
  block: true,
  menuWidth: undefined,
  menuMatchSelector: undefined,
  menuPlacement: 'auto',
});

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();

const isOpen = ref(false);
const rootRef = ref<HTMLElement | null>(null);
const menuRef = ref<HTMLElement | null>(null);
const menuStyle = ref<Record<string, string>>({});

const selectedLabel = computed(() => {
  const opt = props.options.find((o) => o.value === props.modelValue);
  return opt?.label ?? props.modelValue;
});

function toggleOpen() {
  if (isOpen.value) {
    close();
  } else {
    open();
  }
}

function open() {
  isOpen.value = true;
  nextTick(positionMenu);
}

function close() {
  isOpen.value = false;
}

function selectOption(value: string) {
  emit('update:modelValue', value);
  close();
}

/** 计算下拉菜单位置（根据 menuPlacement 决定上方或下方） */
function positionMenu() {
  if (!rootRef.value) return;
  const rect = rootRef.value.getBoundingClientRect();
  const optionHeight = 36;
  const menuHeight = Math.min(props.options.length * optionHeight + 8, 300);
  const spaceBelow = window.innerHeight - rect.bottom;
  const placeAbove =
    props.menuPlacement === 'top'
      ? true
      : props.menuPlacement === 'bottom'
        ? false
        : spaceBelow < menuHeight && rect.top > menuHeight;

  // 计算下拉菜单宽度：优先 menuMatchSelector > menuWidth > select 自身宽度
  let menuWidthPx = rect.width;
  if (props.menuMatchSelector && rootRef.value) {
    const matchEl = rootRef.value.closest(props.menuMatchSelector);
    if (matchEl) {
      const matchRect = matchEl.getBoundingClientRect();
      const matchStyle = getComputedStyle(matchEl);
      const padX =
        parseFloat(matchStyle.paddingLeft || '0') +
        parseFloat(matchStyle.paddingRight || '0');
      menuWidthPx = matchRect.width - padX;
    }
  } else if (props.menuWidth != null) {
    menuWidthPx = props.menuWidth;
  }

  menuStyle.value = {
    position: 'fixed',
    left: `${rect.left}px`,
    width: `${menuWidthPx}px`,
    ...(placeAbove
      ? { bottom: `${window.innerHeight - rect.top + 4}px` }
      : { top: `${rect.bottom + 4}px` }),
    zIndex: '9999',
  };
}

/** 点击外部关闭 */
function onClickOutside(e: MouseEvent) {
  const target = e.target as Node;
  if (rootRef.value?.contains(target)) return;
  if (menuRef.value?.contains(target)) return;
  close();
}

/** 滚动 / 缩放时关闭 */
function onScrollOrResize() {
  if (isOpen.value) close();
}

onMounted(() => {
  document.addEventListener('mousedown', onClickOutside, true);
});

onUnmounted(() => {
  document.removeEventListener('mousedown', onClickOutside, true);
  // 确保清理可能残留的监听器
  document.removeEventListener('keydown', onKeydown);
  window.removeEventListener('scroll', onScrollOrResize, true);
  window.removeEventListener('resize', onScrollOrResize);
});

/** ESC 关闭 */
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && isOpen.value) {
    close();
  }
}

watch(isOpen, (open) => {
  if (open) {
    document.addEventListener('keydown', onKeydown);
    // 仅在打开时注册 scroll/resize 监听（避免多实例全局监听风暴）
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
  } else {
    document.removeEventListener('keydown', onKeydown);
    window.removeEventListener('scroll', onScrollOrResize, true);
    window.removeEventListener('resize', onScrollOrResize);
  }
});
</script>

<template>
  <div
    ref="rootRef"
    class="pf-custom-select"
    :class="{
      'pf-custom-select-sm': size === 'small',
      'pf-custom-select-block': block,
      open: isOpen,
    }"
    :title="title"
    @click="toggleOpen"
  >
    <span class="pf-custom-select-label">{{ selectedLabel }}</span>
    <svg class="pf-custom-select-arrow" :class="{ flipped: isOpen }" viewBox="0 0 10 6" width="10" height="6">
      <path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" d="M1 1l4 4 4-4" />
    </svg>

    <!-- 下拉菜单 (teleport 到 body 避免被父容器裁剪) -->
    <Teleport to="body">
      <div
        v-if="isOpen"
        ref="menuRef"
        class="pf-custom-select-menu"
        :style="menuStyle"
      >
        <div
          v-for="opt in options"
          :key="opt.value"
          class="pf-custom-select-option"
          :class="{ active: opt.value === modelValue, disabled: opt.disabled }"
          :title="opt.tooltip"
          @click.stop="!opt.disabled && selectOption(opt.value)"
        >
          <span class="pf-custom-select-option-label">{{ opt.label }}</span>
          <svg
            class="pf-custom-select-option-check"
            :class="{ visible: opt.value === modelValue }"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            width="14"
            height="14"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.pf-custom-select {
  height: 30px;
  padding: 0 28px 0 10px;
  background-color: var(--track-bg);
  border: 1px solid var(--separator);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
  outline: none;
  appearance: none;
  -webkit-appearance: none;
  display: inline-flex;
  align-items: center;
  position: relative;
  transition: border-color 200ms var(--ease-out), box-shadow 200ms var(--ease-out);
  user-select: none;
  flex-shrink: 0;
}

.pf-custom-select-block {
  display: flex;
  flex: 1;
  min-width: 0;
}

.pf-custom-select:hover {
  border-color: var(--separator-strong);
}

.pf-custom-select.open {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(10, 132, 255, 0.12);
}

.pf-custom-select-sm {
  height: 28px;
  padding: 0 24px 0 8px;
  font-size: 11px;
}

.pf-custom-select-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pf-custom-select-arrow {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-tertiary);
  transition: transform 200ms var(--ease-out), color 200ms ease;
  flex-shrink: 0;
}

.pf-custom-select-sm .pf-custom-select-arrow {
  right: 8px;
}

.pf-custom-select.open .pf-custom-select-arrow {
  transform: translateY(-50%) rotate(180deg);
  color: var(--accent);
}

/* ── 下拉菜单 — 使用不透明背景,避免穿透 ── */
.pf-custom-select-menu {
  background: var(--base-bg);
  border: 1px solid var(--separator-strong);
  border-radius: var(--radius-sm);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2), 0 8px 32px rgba(0, 0, 0, 0.15);
  padding: 4px;
  max-height: 300px;
  overflow-y: auto;
  animation: pfSelectMenuEnter 160ms var(--ease-out);
}

@keyframes pfSelectMenuEnter {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.pf-custom-select-menu::-webkit-scrollbar {
  width: 5px;
}
.pf-custom-select-menu::-webkit-scrollbar-thumb {
  background: var(--text-quaternary);
  border-radius: 999px;
}

.pf-custom-select-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  height: 36px;
  padding: 0 12px;
  border-radius: var(--radius-xs);
  font-size: 12px;
  color: var(--text-primary);
  cursor: pointer;
  transition: background 120ms ease;
  white-space: nowrap;
}

.pf-custom-select-option-label {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
}

/* 勾选图标始终占位，仅对选中项显示 */
.pf-custom-select-option-check {
  flex-shrink: 0;
  visibility: hidden;
}

.pf-custom-select-option-check.visible {
  visibility: visible;
}

.pf-custom-select-option:hover {
  background: var(--track-bg-hover);
}

.pf-custom-select-option.active {
  background: var(--accent);
  color: var(--accent-text);
  font-weight: 500;
}

.pf-custom-select-option.active .pf-custom-select-option-check {
  color: var(--accent-text);
}

.pf-custom-select-option.disabled {
  opacity: 0.4;
  cursor: not-allowed;
  pointer-events: none;
}
</style>
