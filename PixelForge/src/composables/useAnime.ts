/**
 * Anime.js v4 动画工具
 *
 * 项目约束:
 *   - 所有 UI 交互必须使用 cubic-bezier(0.22, 1, 0.36, 1) easing
 *   - 持续时间 180ms
 *   - iOS 风格平滑过渡,消除突兀切换
 *
 * Anime.js v4 API:
 *   - 具名导入: animate, createTimeline, stagger, utils, cubicBezier
 *   - 自定义缓动: cubicBezier(x1, y1, x2, y2) 返回缓动函数
 */
import { animate, utils, cubicBezier } from 'animejs';

// 项目统一缓动曲线 cubic-bezier(0.22, 1, 0.36, 1)
export const PF_EASE = cubicBezier(0.22, 1, 0.36, 1);

// 项目统一时长
export const PF_DURATION = 180;

// 缓动别名(便于阅读)
export const PF_EASE_OUT = PF_EASE;

/**
 * 模态弹窗进入动画:
 *   - 背景遮罩淡入
 *   - 弹窗主体 scale(0.95→1) + translateY(8px→0) + opacity(0→1)
 */
export function modalEnter(overlayEl: HTMLElement, modalEl: HTMLElement): void {
  // 背景遮罩
  animate(overlayEl, {
    opacity: [0, 1],
    duration: PF_DURATION,
    ease: PF_EASE,
  });
  // 弹窗主体
  animate(modalEl, {
    opacity: [0, 1],
    scale: [0.95, 1],
    translateY: [8, 0],
    duration: PF_DURATION,
    ease: PF_EASE,
  });
}

/**
 * 模态弹窗离开动画:
 *   - 背景遮罩淡出
 *   - 弹窗主体 scale(1→0.95) + translateY(0→8) + opacity(1→0)
 *   注意: 需在动画结束后才能真正移除 DOM,返回 Promise 以便调用方处理
 */
export function modalLeave(overlayEl: HTMLElement, modalEl: HTMLElement): Promise<void> {
  return new Promise((resolve) => {
    animate(overlayEl, {
      opacity: [1, 0],
      duration: PF_DURATION,
      ease: PF_EASE,
    });
    animate(modalEl, {
      opacity: [1, 0],
      scale: [1, 0.95],
      translateY: [0, 8],
      duration: PF_DURATION,
      ease: PF_EASE,
      onComplete: () => resolve(),
    });
  });
}

/**
 * 页面/面板切换淡入动画:
 *   - opacity(0→1) + translateY(6px→0)
 *   - 用于左侧栏 Tab 切换时内容区过渡
 */
export function pageEnter(el: HTMLElement): void {
  animate(el, {
    opacity: [0, 1],
    translateY: [6, 0],
    duration: PF_DURATION,
    ease: PF_EASE,
  });
}

/**
 * 元素进入:轻微上浮 + 淡入
 */
export function fadeUp(el: HTMLElement): void {
  animate(el, {
    opacity: [0, 1],
    translateY: [6, 0],
    duration: PF_DURATION,
    ease: PF_EASE,
  });
}

/**
 * 列表项依次进入(stagger)
 *   - 用于 chips / 树节点等列表的依次淡入
 */
export function staggerEnter(items: HTMLElement[]): void {
  if (items.length === 0) return;
  animate(items, {
    opacity: [0, 1],
    translateY: [4, 0],
    duration: PF_DURATION,
    delay: utils.stagger(20, { start: 0 }),
    ease: PF_EASE,
  });
}
