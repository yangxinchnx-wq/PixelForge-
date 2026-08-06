/**
 * Input Types(Step 30.1)— 实时输入系统类型定义。
 *
 * 数据流:
 *   Input Source(sensor / ai)
 *     ↓ InputRouter.setSignal
 *   Signal(实时值)
 *     ↓ inputDriver.evaluate
 *   ControlMapping(映射后的参数值)
 *     ↓ binding.applyInputBindings
 *   GraphNode / MaterialNode
 *     ↓ compiler
 *   WGSL + Uniform Buffer
 *     ↓ GPU
 *   Canvas
 */

// ============================================================================
// 1. Signal - 实时信号
// ============================================================================

/**
 * 输入源类型。
 *
 * - SENSOR: 通用传感器(鼠标 / 键盘 / 自定义)
 * - AI:     AI 事件(由 LLM 触发的瞬时信号)
 */
export type InputSourceKind = 'SENSOR' | 'AI'

/**
 * 实时信号(由 InputRouter 管理)。
 *
 * - id:        信号唯一 id(如 'mouse.x' / 'ai.scene_change')
 * - value:     当前值(归一化到 0-1,或原始值)
 * - timestamp: 最后更新时间(performance.now(),毫秒)
 * - source:    来源类型
 * - active:    是否活跃(超时未更新则置 false)
 */
export interface Signal {
  id: string
  value: number
  timestamp: number
  source: InputSourceKind
  active: boolean
}

// ============================================================================
// 2. InputBinding - 输入绑定
// ============================================================================

/**
 * 目标类型(与 animation/types.ts 的 TargetKind 一致,避免循环依赖)。
 *
 * - graph:    RenderGraph 节点(更新 graphStore.nodes,不直接触发渲染)
 * - material: MaterialGraph 节点(更新 materialGraphStore.nodes,不直接触发渲染)
 * - runtime:  RenderIR 直接目标(调用 runtimeStore.applyValuePatch,立即触发 GPU 重渲染)
 */
export type InputTargetKind = 'graph' | 'material' | 'runtime'

/**
 * 输入绑定(连接 Signal → Node 参数)。
 *
 * - id:          绑定唯一 id
 * - signalId:    源信号 id(如 'mouse.x')
 * - targetKind:  目标类型(graph / material / runtime)
 * - nodeId:      目标节点 id
 * - property:    目标参数 key(如 'scale' / 'intensity')
 * - mapping:     值映射(输入 0-1 → 输出 outMin-outMax)
 * - enabled:     是否启用
 */
export interface InputBinding {
  id: string
  signalId: string
  targetKind: InputTargetKind
  nodeId: string
  property: string
  mapping: ControlMapping
  enabled: boolean
}

// ============================================================================
// 3. ControlMapping - 值映射
// ============================================================================

/**
 * 值映射(把输入信号 0-1 映射到目标参数范围)。
 *
 * - inMin/inMax:     输入范围(通常 0-1,但可裁剪如 0.2-0.8)
 * - outMin/outMax:   输出范围(如 scale 的 0.5-3.0)
 * - curve:           映射曲线(linear / exponential / logarithmic)
 * - smoothing:       平滑系数(0=无平滑, 1=完全平滑,默认 0.3)
 */
export interface ControlMapping {
  inMin: number
  inMax: number
  outMin: number
  outMax: number
  curve: MappingCurve
  smoothing: number
}

/** 映射曲线类型 */
export type MappingCurve = 'linear' | 'exponential' | 'logarithmic'

/** 默认映射(0-1 → 0-1,线性,无平滑) */
export const DEFAULT_MAPPING: ControlMapping = {
  inMin: 0,
  inMax: 1,
  outMin: 0,
  outMax: 1,
  curve: 'linear',
  smoothing: 0,
}

// ============================================================================
// 4. 默认值 / 工具
// ============================================================================

/** 信号超时时间(毫秒,超过则标记为 inactive) */
export const SIGNAL_TIMEOUT_MS = 1000

/** 生成简单唯一 id */
let inputIdCounter = 0
export function genInputId(prefix: string = 'input'): string {
  inputIdCounter++
  return `${prefix}_${Date.now().toString(36)}_${inputIdCounter.toString(36)}`
}
