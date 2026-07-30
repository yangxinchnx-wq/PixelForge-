/**
 * v-tooltip — 全局 Tooltip 指令
 *
 * 用法:
 *   v-tooltip="'说明文字'"           // 简单字符串
 *   v-tooltip="{ text: '说明', position: 'top' }"  // 带位置
 *
 * 位置可选: 'top' | 'bottom' | 'left' | 'right' (默认 'bottom')
 *
 * 设计:
 * - 使用项目 Apple Liquid Glass 设计系统的 CSS 变量
 * - 300ms 延迟显示，避免频繁闪烁
 * - 智能定位：如果空间不足自动翻转方向
 * - 单例：同一时间只显示一个 tooltip
 */

import type { Directive, DirectiveBinding } from 'vue';

type TooltipPosition = 'top' | 'bottom' | 'left' | 'right';

interface TooltipOptions {
  text: string;
  position?: TooltipPosition;
}

interface TooltipState {
  el: HTMLElement;
  tooltipEl: HTMLElement | null;
  showTimer: ReturnType<typeof setTimeout> | null;
  hideTimer: ReturnType<typeof setTimeout> | null;
  options: TooltipOptions;
}

// 单例：当前显示中的 tooltip
let activeTooltip: HTMLElement | null = null;

function parseBinding(value: string | TooltipOptions): TooltipOptions {
  if (typeof value === 'string') {
    return { text: value, position: 'bottom' };
  }
  return {
    text: value.text ?? '',
    position: value.position ?? 'bottom',
  };
}

function createTooltipElement(text: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'pf-tooltip';
  el.textContent = text;
  el.setAttribute('role', 'tooltip');
  return el;
}

function positionTooltip(
  tooltip: HTMLElement,
  target: HTMLElement,
  position: TooltipPosition,
): void {
  const targetRect = target.getBoundingClientRect();
  const tooltipRect = tooltip.getBoundingClientRect();
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;

  let actualPosition = position;

  // 智能翻转：检查空间是否足够
  const margin = 8;
  if (position === 'top' && targetRect.top < tooltipRect.height + margin) {
    actualPosition = 'bottom';
  } else if (position === 'bottom' && window.innerHeight - targetRect.bottom < tooltipRect.height + margin) {
    actualPosition = 'top';
  } else if (position === 'left' && targetRect.left < tooltipRect.width + margin) {
    actualPosition = 'right';
  } else if (position === 'right' && window.innerWidth - targetRect.right < tooltipRect.width + margin) {
    actualPosition = 'left';
  }

  tooltip.setAttribute('data-position', actualPosition);

  let top: number;
  let left: number;

  switch (actualPosition) {
    case 'top':
      top = targetRect.top + scrollY - tooltipRect.height - 6;
      left = targetRect.left + scrollX + targetRect.width / 2 - tooltipRect.width / 2;
      break;
    case 'left':
      top = targetRect.top + scrollY + targetRect.height / 2 - tooltipRect.height / 2;
      left = targetRect.left + scrollX - tooltipRect.width - 6;
      break;
    case 'right':
      top = targetRect.top + scrollY + targetRect.height / 2 - tooltipRect.height / 2;
      left = targetRect.right + scrollX + 6;
      break;
    case 'bottom':
    default:
      top = targetRect.bottom + scrollY + 6;
      left = targetRect.left + scrollX + targetRect.width / 2 - tooltipRect.width / 2;
      break;
  }

  // 钳制到视口内
  const maxLeft = window.innerWidth + scrollX - tooltipRect.width - 4;
  const minLeft = scrollX + 4;
  left = Math.max(minLeft, Math.min(left, maxLeft));

  tooltip.style.top = `${top}px`;
  tooltip.style.left = `${left}px`;
}

function showTooltip(state: TooltipState): void {
  if (!state.options.text) return;

  // 隐藏之前的 tooltip
  if (activeTooltip && activeTooltip !== state.tooltipEl) {
    hideTooltipEl(activeTooltip);
  }

  if (state.showTimer) clearTimeout(state.showTimer);
  if (state.hideTimer) {
    clearTimeout(state.hideTimer);
    state.hideTimer = null;
  }

  state.showTimer = setTimeout(() => {
    // 如果已有 tooltip 元素先移除
    if (state.tooltipEl) {
      state.tooltipEl.remove();
    }

    state.tooltipEl = createTooltipElement(state.options.text);
    document.body.appendChild(state.tooltipEl);
    activeTooltip = state.tooltipEl;

    // 等下一帧让浏览器测量尺寸
    requestAnimationFrame(() => {
      if (state.tooltipEl) {
        positionTooltip(state.tooltipEl, state.el, state.options.position ?? 'bottom');
        state.tooltipEl.classList.add('pf-tooltip-visible');
      }
    });
  }, 300);
}

function hideTooltipEl(el: HTMLElement): void {
  el.classList.remove('pf-tooltip-visible');
  el.classList.add('pf-tooltip-hiding');
  setTimeout(() => {
    el.remove();
  }, 150);
}

function hideTooltip(state: TooltipState): void {
  if (state.showTimer) {
    clearTimeout(state.showTimer);
    state.showTimer = null;
  }

  if (state.hideTimer) {
    clearTimeout(state.hideTimer);
  }

  state.hideTimer = setTimeout(() => {
    if (state.tooltipEl) {
      hideTooltipEl(state.tooltipEl);
      if (activeTooltip === state.tooltipEl) {
        activeTooltip = null;
      }
      state.tooltipEl = null;
    }
  }, 100);
}

const states = new WeakMap<HTMLElement, TooltipState>();

const tooltipDirective: Directive = {
  mounted(el: HTMLElement, binding: DirectiveBinding) {
    const options = parseBinding(binding.value);
    const state: TooltipState = {
      el,
      tooltipEl: null,
      showTimer: null,
      hideTimer: null,
      options,
    };
    states.set(el, state);

    el.addEventListener('mouseenter', () => showTooltip(state));
    el.addEventListener('mouseleave', () => hideTooltip(state));
    el.addEventListener('mousedown', () => hideTooltip(state));
    // 滚动时隐藏
    el.addEventListener('wheel', () => hideTooltip(state), { passive: true });
  },

  updated(el: HTMLElement, binding: DirectiveBinding) {
    const state = states.get(el);
    if (state) {
      state.options = parseBinding(binding.value);
    }
  },

  unmounted(el: HTMLElement) {
    const state = states.get(el);
    if (state) {
      if (state.showTimer) clearTimeout(state.showTimer);
      if (state.hideTimer) clearTimeout(state.hideTimer);
      if (state.tooltipEl) {
        state.tooltipEl.remove();
        if (activeTooltip === state.tooltipEl) {
          activeTooltip = null;
        }
      }
      states.delete(el);
    }
  },
};

export default tooltipDirective;
