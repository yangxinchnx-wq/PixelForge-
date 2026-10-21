/**
 * 音频效果链(Step 41.2)— 参数规范表 + 链操作纯函数。
 *
 * 职责:
 * - 汇总四种效果的默认参数与取值范围(UI 生成控件、校验、clamp 的唯一来源)
 * - 提供效果链的增/删/移动/启停/改参操作(全部不可变)
 * - 提供链级校验与序列化
 *
 * 设计上与 `src/editor/effects/effectChain.ts`(视频效果链)保持同一范式:
 * 纯函数 + 不可变更新 + 参数 clamp,便于单测与 undo/redo。
 *
 * 数据流:
 *   AudioEffectNode[]
 *     ↓ appendAudioEffect / moveAudioEffect / updateAudioEffectParams
 *   新的 AudioEffectNode[](不可变)
 *     ↓ runtime.audioGraph
 *   Web Audio 节点链
 */

import type { AudioEffectNode, AudioEffectType } from '../core/types'
import { clampCompressorParams } from './compressor'
import { clampEqParams } from './eq'
import { FADE_CURVE, clampGainParams, type GainParams } from './gain'
import { clampReverbParams } from './reverb'

// ============================================================================
// 1. 参数规范
// ============================================================================

/** 单个参数的元信息(UI 控件生成与校验的单一来源) */
export interface AudioParamSpec {
  key: string
  label: string
  min: number
  max: number
  default: number
  unit: string
}

/** 每种效果的参数规范表 */
export const AUDIO_EFFECT_PARAM_SPECS: Record<AudioEffectType, AudioParamSpec[]> = {
  eq: [
    { key: 'lowGainDb', label: '低频', min: -24, max: 24, default: 0, unit: 'dB' },
    { key: 'midGainDb', label: '中频', min: -24, max: 24, default: 0, unit: 'dB' },
    { key: 'highGainDb', label: '高频', min: -24, max: 24, default: 0, unit: 'dB' },
    { key: 'lowFreqHz', label: '低分频', min: 20, max: 20000, default: 250, unit: 'Hz' },
    { key: 'highFreqHz', label: '高分频', min: 20, max: 20000, default: 4000, unit: 'Hz' },
  ],
  compressor: [
    { key: 'thresholdDb', label: '阈值', min: -60, max: 0, default: -18, unit: 'dB' },
    { key: 'ratio', label: '压缩比', min: 1, max: 20, default: 4, unit: ':1' },
    { key: 'attackMs', label: '启动', min: 0.1, max: 200, default: 10, unit: 'ms' },
    { key: 'releaseMs', label: '释放', min: 10, max: 2000, default: 250, unit: 'ms' },
    { key: 'kneeDb', label: '拐点', min: 0, max: 24, default: 6, unit: 'dB' },
  ],
  reverb: [
    { key: 'decaySeconds', label: '混响时间', min: 0.1, max: 10, default: 2, unit: 's' },
    { key: 'preDelayMs', label: '预延迟', min: 0, max: 200, default: 20, unit: 'ms' },
    { key: 'damping', label: '阻尼', min: 0, max: 1, default: 0.5, unit: '' },
    { key: 'mix', label: '干湿比', min: 0, max: 1, default: 0.25, unit: '' },
    { key: 'roomSize', label: '房间', min: 0, max: 1, default: 0.5, unit: '' },
  ],
  gain: [
    { key: 'gainDb', label: '增益', min: -60, max: 12, default: 0, unit: 'dB' },
    { key: 'fadeInMs', label: '淡入', min: 0, max: 60000, default: 0, unit: 'ms' },
    { key: 'fadeOutMs', label: '淡出', min: 0, max: 60000, default: 0, unit: 'ms' },
    { key: 'fadeCurve', label: '曲线', min: 0, max: 2, default: FADE_CURVE.LINEAR, unit: '' },
  ],
}

/** 效果显示名 */
const EFFECT_LABELS: Record<AudioEffectType, string> = {
  eq: '均衡器',
  compressor: '压缩器',
  reverb: '混响',
  gain: '增益',
}

/**
 * 获取效果的显示名。
 */
export function getAudioEffectLabel(type: AudioEffectType): string {
  return EFFECT_LABELS[type] ?? type
}

/**
 * 获取效果的默认参数(按规范表生成)。
 */
export function getDefaultAudioEffectParams(type: AudioEffectType): Record<string, number> {
  const specs = AUDIO_EFFECT_PARAM_SPECS[type]
  if (!specs) return {}
  const params: Record<string, number> = {}
  for (const spec of specs) {
    params[spec.key] = spec.default
  }
  return params
}

// ============================================================================
// 2. 参数校验
// ============================================================================

/**
 * 按规范表 clamp 单个参数值。
 */
export function clampParamValue(type: AudioEffectType, key: string, value: number): number {
  const spec = AUDIO_EFFECT_PARAM_SPECS[type]?.find((s) => s.key === key)
  if (!spec) return Number.isNaN(value) ? 0 : value
  if (Number.isNaN(value)) return spec.default
  return Math.min(spec.max, Math.max(spec.min, value))
}

/**
 * 校验并修正效果节点的参数。
 *
 * 先按规范表逐项 clamp,再交给各效果自身的 clamp 处理跨参数约束
 * (例如 EQ 的两个分频点必须有序)。返回新对象,不修改入参。
 */
export function validateAudioEffectParams(effect: AudioEffectNode): AudioEffectNode {
  const specs = AUDIO_EFFECT_PARAM_SPECS[effect.type] ?? []

  // 1) 补齐缺失项并 clamp 已有项
  const params: Record<string, number> = {}
  for (const spec of specs) {
    const raw = effect.params?.[spec.key]
    params[spec.key] = clampParamValue(effect.type, spec.key, raw)
  }

  // 2) 丢弃规范表之外的键,避免脏数据随工程持久化
  const validated = { ...effect, params }

  // 3) 应用跨参数约束
  return applyCrossParamConstraints(validated)
}

function applyCrossParamConstraints(effect: AudioEffectNode): AudioEffectNode {
  switch (effect.type) {
    case 'eq': {
      const eq = clampEqParams({
        lowGainDb: effect.params.lowGainDb,
        midGainDb: effect.params.midGainDb,
        highGainDb: effect.params.highGainDb,
        lowFreqHz: effect.params.lowFreqHz,
        highFreqHz: effect.params.highFreqHz,
      })
      return { ...effect, params: { ...eq } }
    }
    case 'compressor': {
      const comp = clampCompressorParams({
        thresholdDb: effect.params.thresholdDb,
        ratio: effect.params.ratio,
        attackMs: effect.params.attackMs,
        releaseMs: effect.params.releaseMs,
        kneeDb: effect.params.kneeDb,
      })
      return { ...effect, params: { ...comp } }
    }
    case 'reverb': {
      const rev = clampReverbParams({
        decaySeconds: effect.params.decaySeconds,
        preDelayMs: effect.params.preDelayMs,
        damping: effect.params.damping,
        mix: effect.params.mix,
        roomSize: effect.params.roomSize,
      })
      return { ...effect, params: { ...rev } }
    }
    case 'gain': {
      const gain = clampGainParams({
        gainDb: effect.params.gainDb,
        fadeInMs: effect.params.fadeInMs,
        fadeOutMs: effect.params.fadeOutMs,
        fadeCurve: effect.params.fadeCurve as GainParams['fadeCurve'],
      })
      return { ...effect, params: { ...gain } }
    }
    default:
      return { ...effect }
  }
}

// ============================================================================
// 3. 构造
// ============================================================================

/** 效果 id 计数器(保证同一会话内不重复) */
let _effectIdCounter = 0

/**
 * 生成效果 id。
 */
export function genAudioEffectId(): string {
  _effectIdCounter++
  return `afx-${Date.now().toString(36)}-${_effectIdCounter.toString(36)}`
}

/**
 * 创建一个效果节点。
 *
 * @param type 效果类型
 * @param params 初始参数(缺省项用默认值补齐)
 */
export function createAudioEffect(
  type: AudioEffectType,
  params?: Partial<Record<string, number>>,
): AudioEffectNode {
  // 先铺默认值,再逐项覆盖(只接受数值,避免 undefined 混入参数表)
  const merged: Record<string, number> = { ...getDefaultAudioEffectParams(type) }
  for (const [key, value] of Object.entries(params ?? {})) {
    if (typeof value === 'number') merged[key] = value
  }

  return validateAudioEffectParams({
    id: genAudioEffectId(),
    type,
    enabled: true,
    params: merged,
  })
}

/**
 * 创建空效果链。
 */
export function createAudioEffectChain(): AudioEffectNode[] {
  return []
}

// ============================================================================
// 4. 链操作(全部不可变)
// ============================================================================

/** 追加效果到链尾 */
export function appendAudioEffect(
  chain: AudioEffectNode[],
  effect: AudioEffectNode,
): AudioEffectNode[] {
  return [...chain, effect]
}

/** 在指定位置插入效果(越界时钳制到两端) */
export function insertAudioEffect(
  chain: AudioEffectNode[],
  effect: AudioEffectNode,
  index: number,
): AudioEffectNode[] {
  const next = [...chain]
  const at = Math.min(next.length, Math.max(0, Math.floor(index)))
  next.splice(at, 0, effect)
  return next
}

/** 按 id 移除效果 */
export function removeAudioEffect(chain: AudioEffectNode[], id: string): AudioEffectNode[] {
  return chain.filter((e) => e.id !== id)
}

/** 把指定效果移动到新位置 */
export function moveAudioEffect(
  chain: AudioEffectNode[],
  id: string,
  newIndex: number,
): AudioEffectNode[] {
  const from = chain.findIndex((e) => e.id === id)
  if (from < 0) return chain

  const next = [...chain]
  const [effect] = next.splice(from, 1)
  const to = Math.min(next.length, Math.max(0, Math.floor(newIndex)))
  next.splice(to, 0, effect)
  return next
}

/** 启停指定效果 */
export function setAudioEffectEnabled(
  chain: AudioEffectNode[],
  id: string,
  enabled: boolean,
): AudioEffectNode[] {
  return chain.map((e) => (e.id === id ? { ...e, enabled } : e))
}

/**
 * 更新指定效果的部分参数。
 *
 * 值会被 clamp;不存在的键会被忽略。
 */
export function updateAudioEffectParams(
  chain: AudioEffectNode[],
  id: string,
  patch: Record<string, number>,
): AudioEffectNode[] {
  return chain.map((e) => {
    if (e.id !== id) return e
    const merged: Record<string, number> = { ...e.params }
    for (const key of Object.keys(patch)) {
      // 只接受规范表内已声明的键
      if (!(key in merged)) continue
      merged[key] = clampParamValue(e.type, key, patch[key])
    }
    return applyCrossParamConstraints({ ...e, params: merged })
  })
}

// ============================================================================
// 5. 查询
// ============================================================================

/** 按 id 查找效果 */
export function findAudioEffect(
  chain: AudioEffectNode[],
  id: string,
): AudioEffectNode | undefined {
  return chain.find((e) => e.id === id)
}

/** 取出所有启用的效果(保持顺序) */
export function getEnabledAudioEffects(chain: AudioEffectNode[]): AudioEffectNode[] {
  return chain.filter((e) => e.enabled)
}

/** 链长度 */
export function getAudioEffectCount(chain: AudioEffectNode[]): number {
  return chain.length
}

/** 启用中的效果数量 */
export function getEnabledAudioEffectCount(chain: AudioEffectNode[]): number {
  return getEnabledAudioEffects(chain).length
}

// ============================================================================
// 6. 链级校验与序列化
// ============================================================================

/** 校验结果 */
export interface AudioChainValidationResult {
  valid: boolean
  issues: string[]
  /** 校验并修正后的链 */
  chain: AudioEffectNode[]
}

/**
 * 校验整条链:修正非法参数、检测重复 id。
 */
export function validateAudioEffectChain(
  chain: AudioEffectNode[],
): AudioChainValidationResult {
  const issues: string[] = []
  const seen = new Set<string>()

  const fixed = chain.map((effect) => {
    if (!effect.id) {
      issues.push('存在缺少 id 的效果节点')
    }
    if (seen.has(effect.id)) {
      issues.push(`效果 id 重复: ${effect.id}`)
    }
    seen.add(effect.id)

    if (!AUDIO_EFFECT_PARAM_SPECS[effect.type]) {
      issues.push(`未知效果类型: ${effect.type}`)
      return { ...effect }
    }

    const before = effect.params ?? {}
    const after = validateAudioEffectParams(effect).params
    for (const key of Object.keys(after)) {
      if (before[key] !== undefined && before[key] !== after[key]) {
        issues.push(`参数越界已修正: ${effect.id}.${key}`)
      }
    }

    return validateAudioEffectParams(effect)
  })

  return {
    valid: issues.length === 0,
    issues,
    chain: fixed,
  }
}

/**
 * 序列化效果链为 JSON 字符串。
 */
export function serializeAudioEffectChain(chain: AudioEffectNode[]): string {
  return JSON.stringify(chain)
}

/**
 * 从 JSON 字符串还原效果链。
 *
 * 非法输入返回空链,不抛异常——工程文件可能来自外部,加载失败应当降级而不是崩溃。
 */
export function deserializeAudioEffectChain(json: string): AudioEffectNode[] {
  if (typeof json !== 'string' || json.length === 0) return []

  try {
    const parsed = JSON.parse(json)
    if (!Array.isArray(parsed)) return []

    const nodes: AudioEffectNode[] = []
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue
      if (typeof item.id !== 'string' || typeof item.type !== 'string') continue
      if (!AUDIO_EFFECT_PARAM_SPECS[item.type as AudioEffectType]) continue

      nodes.push(
        validateAudioEffectParams({
          id: item.id,
          type: item.type as AudioEffectType,
          enabled: item.enabled !== false,
          params: typeof item.params === 'object' && item.params !== null ? item.params : {},
        }),
      )
    }
    return nodes
  } catch {
    return []
  }
}
