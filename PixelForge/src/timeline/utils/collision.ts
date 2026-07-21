/**
 * PixelForge Timeline — Clip 碰撞检测工具。
 *
 * 提供两种检测：
 * 1. hitTestClip：鼠标点击检测（像素坐标 → Clip）
 * 2. checkCollision：Clip 时间区间重叠检测
 */

import type { Time } from '../core/time';

/** Clip 在画布上的矩形区域。 */
export interface ClipRect {
  /** 关联的 Clip ID */
  clipId: string;
  /** 矩形左上角 X（像素） */
  x: number;
  /** 矩形左上角 Y（像素） */
  y: number;
  /** 矩形宽度（像素） */
  width: number;
  /** 矩形高度（像素） */
  height: number;
  /** 所在轨道索引 */
  track: number;
}

/**
 * 点击检测：判断鼠标坐标是否在 Clip 矩形内。
 *
 * @param px   鼠标 X 坐标
 * @param py   鼠标 Y 坐标
 * @param rect Clip 矩形区域
 * @returns 是否命中
 */
export function hitTestClip(px: number, py: number, rect: ClipRect): boolean {
  return (
    px >= rect.x &&
    px <= rect.x + rect.width &&
    py >= rect.y &&
    py <= rect.y + rect.height
  );
}

/** 时间区间。 */
export interface TimeInterval {
  start: Time;
  end: Time;
}

/**
 * 检测两个时间区间是否重叠。
 *
 * @param a 区间 A
 * @param b 区间 B
 * @returns true 表示重叠（非法），false 表示不重叠
 */
export function checkCollision(a: TimeInterval, b: TimeInterval): boolean {
  return !(a.end <= b.start || a.start >= b.end);
}
