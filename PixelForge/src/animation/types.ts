/**
 * Animation Types(Step 29.2)— 时间轴动画系统类型定义。
 *
 * 与 src/editor/timeline/types.ts 的区别:
 * - editor/timeline:  基于 frame(整数),绑定 RenderIR.layers,仅 linear/ease/hold
 * - animation(本模块): 基于 time(秒,浮点),绑定 GraphNode + MaterialNode,
 *                      支持 linear/bezier/step + expression(程序动画)
 *
 * 数据流(Step 29 完整):
 *   Timeline(time)
 *     ↓ evaluator.evaluateTrack
 *   参数值(number)
 *     ↓ binding.applyAnimations
 *   GraphNode.params / MaterialNode.params
 *     ↓ graphStore / materialGraphStore 更新
 *   RenderGraph / MaterialGraph
 *     ↓ compiler
 *   WGSL + Uniform Buffer
 *     ↓ GPU
 *   Canvas
 */

import type { JsonLiteral } from '@/shared/types'

// ============================================================================
// 1. AnimationMode - 动画模式
// ============================================================================

/**
 * 动画模式(与 spec §15 对齐)。
 *
 * - KEYFRAME:   关键帧动画(用户在时间轴上放置关键帧,插值生成)
 * - EXPRESSION: 表达式动画(用户输入 JS 表达式,如 "sin(time) * 0.5")
 * - PHYSICS:    物理动画(预留,Step 30+ 实现:弹簧 / 阻尼 / 碰撞)
 */
export type AnimationMode = 'KEYFRAME' | 'EXPRESSION' | 'PHYSICS'

// ============================================================================
// 2. Interpolation - 插值类型
// ============================================================================

/**
 * 关键帧之间的插值方式(与 spec §5 对齐)。
 *
 * - linear:  线性插值(直线)
 * - bezier:  三次贝塞尔曲线(电影动画常用,需控制点 cp1/cp2)
 * - step:    阶梯函数(保持前一个关键帧的值直到下一个)
 */
export type Interpolation = 'linear' | 'bezier' | 'step'

// ============================================================================
// 3. Keyframe - 关键帧(时间基于秒)
// ============================================================================

/**
 * 关键帧(时间轴上的一个点)。
 *
 * - id:            唯一 id
 * - time:          时间点(秒,>= 0,浮点)
 * - value:         参数值(任意 number,不限于 0-1)
 * - interpolation: 到下一个关键帧的插值方式
 * - cp1:           bezier 控制点 1(时间偏移,值偏移),相对当前关键帧
 * - cp2:           bezier 控制点 2(时间偏移,值偏移),相对下一个关键帧
 *
 * bezier 说明:
 *   三次贝塞尔需要 4 个点:P0(当前), P1(cp1), P2(cp2), P3(下一个)
 *   cp1/cp2 用归一化坐标 [0,1] x [0,1](相对当前区间)
 *   默认 cp1=(0.25, 0.1), cp2=(0.75, 0.9) 近似 CSS ease
 */
export interface Keyframe {
  id: string
  time: number
  value: number
  interpolation: Interpolation
  /** bezier 控制点 1(归一化 [0,1] x [0,1],相对当前区间) */
  cp1?: { x: number; y: number }
  /** bezier 控制点 2(归一化 [0,1] x [0,1],相对当前区间) */
  cp2?: { x: number; y: number }
}

/** bezier 默认控制点(近似 CSS ease) */
export const DEFAULT_BEZIER_CP1 = { x: 0.25, y: 0.1 }
export const DEFAULT_BEZIER_CP2 = { x: 0.75, y: 0.9 }

// ============================================================================
// 4. AnimationTrack - 动画轨道
// ============================================================================

/**
 * 目标类型(轨道绑定到哪种节点)。
 *
 * - graph:    RenderGraph 节点(graphStore.nodes)
 * - material: MaterialGraph 节点(materialGraphStore.nodes)
 * - runtime:  RenderIR 直接目标(runtimeStore.currentIr.layers/effects)
 *             用于实时输入(Timeline 动画优先用 graph/material,Input 系统也可用)
 */
export type TargetKind = 'graph' | 'material' | 'runtime'

/**
 * 动画轨道(一个参数的动画序列)。
 *
 * - id:          轨道唯一 id
 * - label:       显示名(中文,如 "噪声密度" / "银河旋转")
 * - targetKind:  目标类型(graph / material)
 * - nodeId:      绑定的节点 id
 * - property:    绑定的节点参数 key(如 'density' / 'rotation' / 'scale')
 * - mode:        动画模式(KEYFRAME / EXPRESSION / PHYSICS)
 * - keyframes:   关键帧列表(仅 KEYFRAME 模式,按 time 升序)
 * - expression:  表达式代码(仅 EXPRESSION 模式,如 "sin(time) * 0.5")
 * - enabled:     是否启用(false 时跳过求值)
 * - color:       UI 显示颜色(轨道左侧标签颜色)
 */
export interface AnimationTrack {
  id: string
  label: string
  targetKind: TargetKind
  nodeId: string
  property: string
  mode: AnimationMode
  keyframes: Keyframe[]
  expression: string
  enabled: boolean
  color: string
}

// ============================================================================
// 5. AnimationBinding - 动画绑定(简化版,用于批量应用)
// ============================================================================

/**
 * 动画绑定(连接 Track → Node 参数)。
 *
 * 与 AnimationTrack 的关系:
 * - AnimationTrack 包含完整轨道数据(keyframes / expression)
 * - AnimationBinding 是轻量引用(trackId → nodeId + property)
 * - 用于批量应用动画时快速查找
 *
 * 注:AnimationTrack 本身已包含 nodeId + property,
 *     AnimationBinding 主要用于解耦 track 与 target 的场景(如 Motion Graph)。
 */
export interface AnimationBinding {
  trackId: string
  targetKind: TargetKind
  nodeId: string
  property: string
}

// ============================================================================
// 6. Timeline - 时间轴
// ============================================================================

/**
 * 时间轴(动画系统的顶层容器)。
 *
 * - duration:  总时长(秒,默认 10)
 * - fps:       帧率(默认 60,用于 frame ↔ time 换算)
 * - currentTime: 当前播放时间(秒,浮点)
 * - isPlaying: 是否正在播放
 * - loop:      是否循环播放
 * - tracks:    轨道列表
 */
export interface Timeline {
  duration: number
  fps: number
  currentTime: number
  isPlaying: boolean
  loop: boolean
  tracks: AnimationTrack[]
}

// ============================================================================
// 7. ParamPatch - 参数补丁(应用动画结果)
// ============================================================================

/**
 * 参数补丁(由 evaluator 生成,由 binding 应用到 store)。
 *
 * - targetKind: 目标类型(graph / material)
 * - nodeId:     目标节点 id
 * - property:   参数 key
 * - value:      插值后的值(number,由调用方按 property 语义转换)
 */
export interface ParamPatch {
  targetKind: TargetKind
  nodeId: string
  property: string
  value: number
}

// ============================================================================
// 8. UniformUpdate - GPU Uniform 更新指令
// ============================================================================

/**
 * GPU Uniform 更新指令(由 uniformUpdater 消费)。
 *
 * - buffer:     目标 GPUBuffer
 * - offset:     写入偏移(字节)
 * - data:       Float32Array 数据
 * - sourceTrack: 来源轨道 id(调试用)
 */
export interface UniformUpdate {
  buffer: GPUBuffer
  offset: number
  data: Float32Array
  sourceTrackId: string
}

// ============================================================================
// 9. 默认值
// ============================================================================

export const DEFAULT_TIMELINE_DURATION = 10  // 秒
export const DEFAULT_TIMELINE_FPS = 60
export const DEFAULT_TRACK_COLOR = '#4a9eff'

/**
 * 把 number value 按 property 语义转成 JsonLiteral(供 store.updateNodeParams 使用)。
 *
 * - 标量参数(density / rotation / scale / radius / amount 等):直接 number
 * - 数组参数(color / colorA / colorB / fill / background):[v, v, v, 1]
 * - 二维参数(center / from / to / offset):[v, v]
 */
export function toParamValue(property: string, value: number): JsonLiteral {
  const arrayProps = new Set(['color', 'colorA', 'colorB', 'fill', 'background'])
  if (arrayProps.has(property)) {
    return [value, value, value, 1] as JsonLiteral
  }
  const vec2Props = new Set(['center', 'from', 'to', 'offset', 'position'])
  if (vec2Props.has(property)) {
    return [value, value] as JsonLiteral
  }
  return value as JsonLiteral
}

/**
 * 生成简单唯一 id(不依赖 crypto,便于测试)。
 */
let idCounter = 0
export function genAnimId(prefix: string = 'anim'): string {
  idCounter++
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}`
}
