/**
 * Graph Animation(Step 27.14)— Graph 节点参数与 Timeline 联动骨架。
 *
 * 职责:
 * - 定义 GraphParameterTrack(节点参数轨道,绑定 nodeId + paramKey)
 * - 提供 evaluateGraphTracks(frame, fps):根据当前帧计算所有轨道的插值
 * - 输出 NodeParamPatch[] 由调用方(graphStore.updateNodeParams / runtime)应用
 *
 * 与 stores/timeline.ts 的关系:
 * - stores/timeline.ts 的 ParameterTrack 绑定 layerId(线性 RenderIR)
 * - 本模块的 GraphParameterTrack 绑定 nodeId(图 RenderGraph)
 * - 两者结构相似但目标不同,Step 27 先各自独立,Step 28 合并到统一 AnimationTrack
 *
 * 数据流(每帧):
 *   Timeline.seek(frame)
 *     ↓
 *   evaluateGraphTracks(tracks, frame, fps)
 *     ↓
 *   [{ nodeId, paramKey, value }, ...]
 *     ↓
 *   graphStore.updateNodeParams(nodeId, { [paramKey]: value })
 *     ↓
 *   GraphRuntime.execute() → GPU
 *
 * Step 27 仅实现骨架(类型 + evaluator),完整 UI(轨道编辑 / 关键帧拖动)留待 Step 28。
 */

import type { Easing, Keyframe } from '@/editor/timeline/types'
import type { JsonLiteral } from '@/shared/types'

/**
 * Graph 节点参数轨道。
 *
 * - id:         轨道唯一 id
 * - nodeId:     绑定的 GraphNode.id
 * - paramKey:   绑定的 node.params key(如 'density' / 'radius' / 'amount')
 * - label:      显示名(中文,用于 UI)
 * - keyframes:  关键帧列表(按 frame 升序)
 */
export interface GraphParameterTrack {
  id: string
  nodeId: string
  paramKey: string
  label: string
  keyframes: Keyframe[]
}

/**
 * 评估后的节点参数补丁(由调用方应用到 graphStore)。
 *
 * - nodeId:    目标节点 id
 * - paramKey:  目标参数 key
 * - value:     插值后的值(标量或数组,由 toGraphParamValue 转换)
 */
export interface NodeParamPatch {
  nodeId: string
  paramKey: string
  value: JsonLiteral
}

/**
 * 把 0-1 的 normalized value 转成实际参数值。
 *
 * 与 editor/timeline/types.ts 的 toPatchValue 对齐,但返回 JsonLiteral
 * (graphStore.updateNodeParams 接受 Record<string, JsonLiteral>)。
 *
 * - 标量参数(radius / amount / scale / density / intensity 等):直接 number
 * - 数组参数(color / colorA / colorB / fill / background):[v, v, v, 1]
 * - 二维参数(center / from / to):[v, v]
 *
 * @param paramKey 参数 key
 * @param value    0-1 的归一化值
 */
export function toGraphParamValue(paramKey: string, value: number): JsonLiteral {
  const arrayParamKeys = new Set(['color', 'colorA', 'colorB', 'fill', 'background'])
  if (arrayParamKeys.has(paramKey)) {
    return [value, value, value, 1] as JsonLiteral
  }
  if (paramKey === 'center' || paramKey === 'from' || paramKey === 'to') {
    return [value, value] as JsonLiteral
  }
  return value as JsonLiteral
}

/**
 * 在两个关键帧之间插值。
 *
 * - linear: 线性插值
 * - ease:   平滑插值(用 cubic-bezier 近似)
 * - hold:   保持前一个关键帧的值(阶梯函数)
 *
 * @param k1   前一个关键帧
 * @param k2   后一个关键帧
 * @param t    归一化时间 [0, 1](0=k1, 1=k2)
 */
function interpolate(k1: Keyframe, k2: Keyframe, t: number, easing: Easing): number {
  switch (easing) {
    case 'hold':
      return k1.value
    case 'ease': {
      // cubic-bezier(0.4, 0, 0.2, 1) 近似(与 CSS ease 一致)
      const eased = t < 0.5
        ? 4 * t * t * t
        : 1 - Math.pow(-2 * t + 2, 3) / 2
      return k1.value + (k2.value - k1.value) * eased
    }
    case 'linear':
    default:
      return k1.value + (k2.value - k1.value) * t
  }
}

/**
 * 评估单条轨道在指定帧的值。
 *
 * - frame 在两个关键帧之间:线性 / ease / hold 插值
 * - frame 在第一个关键帧之前:返回第一个关键帧的值
 * - frame 在最后一个关键帧之后:返回最后一个关键帧的值
 * - 轨道无关键帧:返回 null
 *
 * @param track 轨道
 * @param frame 当前帧
 * @returns 插值后的 0-1 归一化值,或 null(轨道为空)
 */
export function evaluateTrack(track: GraphParameterTrack, frame: number): number | null {
  const kfs = track.keyframes
  if (kfs.length === 0) return null

  // 边界:帧在第一个关键帧之前
  if (frame <= kfs[0].frame) return kfs[0].value
  // 边界:帧在最后一个关键帧之后
  if (frame >= kfs[kfs.length - 1].frame) return kfs[kfs.length - 1].value

  // 找到包含 frame 的关键帧区间
  for (let i = 0; i < kfs.length - 1; i++) {
    const k1 = kfs[i]
    const k2 = kfs[i + 1]
    if (frame >= k1.frame && frame <= k2.frame) {
      const span = k2.frame - k1.frame
      if (span <= 0) return k1.value
      const t = (frame - k1.frame) / span
      return interpolate(k1, k2, t, k1.easing)
    }
  }

  // 不应到达此处
  return kfs[kfs.length - 1].value
}

/**
 * 评估所有轨道在指定帧的值,输出 NodeParamPatch 列表。
 *
 * @param tracks  轨道列表
 * @param frame   当前帧
 * @returns NodeParamPatch[](空轨道会被跳过)
 */
export function evaluateGraphTracks(
  tracks: GraphParameterTrack[],
  frame: number,
): NodeParamPatch[] {
  const patches: NodeParamPatch[] = []
  for (const track of tracks) {
    const value = evaluateTrack(track, frame)
    if (value === null) continue
    patches.push({
      nodeId: track.nodeId,
      paramKey: track.paramKey,
      value: toGraphParamValue(track.paramKey, value),
    })
  }
  return patches
}

/**
 * 生成轨道唯一 id。
 */
export function genTrackId(prefix = 'gtrack'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * 创建空轨道(便于 UI 快速创建)。
 */
export function createEmptyTrack(
  nodeId: string,
  paramKey: string,
  label: string,
): GraphParameterTrack {
  return {
    id: genTrackId(),
    nodeId,
    paramKey,
    label,
    keyframes: [
      { id: genTrackId('kf'), frame: 0, value: 0.5, easing: 'linear' },
    ],
  }
}
