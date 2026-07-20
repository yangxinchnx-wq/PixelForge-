import type { CapabilityProfile, RuntimeCanvasSize } from '@/runtime/types'

/**
 * 编译期稳定上下文。
 *
 * freeze-1 修订（对齐 §4.1.0 静态边界硬约束）：
 *   - 删除 time 字段（time 是 GPU 求值期注入，不属于编译期稳定上下文）
 *   - 动画通过高频 ValuePatch 在主线程推动
 *   - WGSL uniform 中的 time（如果有）是渲染时刻的瞬时量，与此处解耦
 */
export interface CompileContext {
  capability: CapabilityProfile
  canvasSize: RuntimeCanvasSize
  seed: number
}

export function createCompileContext(
  capability: CapabilityProfile,
  canvasSize: RuntimeCanvasSize,
): CompileContext {
  return {
    capability,
    canvasSize,
    seed: 1337,
  }
}
