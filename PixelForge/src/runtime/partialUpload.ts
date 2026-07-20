/**
 * PixelForge - Partial Upload（Phase C）
 *
 * 技术路线 §19.4 空间增量：只更新变化区域。
 *
 * 当 ValuePatch 修改单个图层参数时，不需要重新上传整个 descriptor/aux 缓冲区。
 * 只需上传该图层对应的数据范围。
 *
 * 工作原理：
 *   1. 跟踪上一帧的 artifact 和各图层的 buffer 偏移
 *   2. 当 ValuePatch 应用后，标记受影响图层的 buffer 范围为 dirty
 *   3. 渲染时只上传 dirty 范围，非 dirty 范围复用上一帧数据
 *   4. 结构性变化（增删图层/区域）时，标记 fullUploadRequired
 *
 * 前提条件：
 *   - GPU 缓冲区在帧间复用（不每帧创建/销毁）
 *   - evaluator 需要改为持久化缓冲区模式
 *
 * Buffer 布局（与 regionCompiler.ts 对齐）：
 *   - descriptorData: [layer0Desc, layer0Meta, layer1Desc, layer1Meta, ...]
 *     每个图层占 2 个 Uint32（8 字节）
 *   - auxData: 各图层 auxData 拼接，每个图层的偏移记录在 LayerCompileEntry.auxOffset
 *   - regionData: 每个 region 占 4 个 Float32（16 字节）
 */

import type { RegionCompileArtifact, LayerCompileEntry } from '@/compiler/region/regionCompiler'
import type { ValuePatch } from '@/compiler/ir/patch'
import type { RenderIR } from '@/compiler/ir/renderIR'

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 缓冲区中需要更新的范围（字节偏移和长度）。
 */
export interface BufferRange {
  /** 起始字节偏移 */
  offset: number
  /** 字节长度 */
  length: number
}

/**
 * 上传差异：描述哪些 buffer 范围需要更新。
 */
export interface UploadDiff {
  /** descriptor buffer 需要更新的范围列表 */
  descriptorRanges: BufferRange[]
  /** aux buffer 需要更新的范围列表 */
  auxRanges: BufferRange[]
  /** region buffer 需要更新的范围列表 */
  regionRanges: BufferRange[]
  /** effectDesc buffer 需要更新的范围列表 */
  effectDescRanges: BufferRange[]
  /** effectParam buffer 需要更新的范围列表 */
  effectParamRanges: BufferRange[]
  /** 是否需要全量上传（结构性变化时为 true） */
  fullUploadRequired: boolean
  /** 变化的图层 ID 列表（用于日志/调试） */
  changedLayerIds: string[]
}

// ============================================================================
// Partial Upload Tracker
// ============================================================================

/**
 * 空的 UploadDiff（无变化）。
 */
export function emptyUploadDiff(): UploadDiff {
  return {
    descriptorRanges: [],
    auxRanges: [],
    regionRanges: [],
    effectDescRanges: [],
    effectParamRanges: [],
    fullUploadRequired: false,
    changedLayerIds: [],
  }
}

/**
 * 全量上传的 UploadDiff。
 */
export function fullUploadDiff(changedLayerIds: string[] = []): UploadDiff {
  return {
    ...emptyUploadDiff(),
    fullUploadRequired: true,
    changedLayerIds,
  }
}

/**
 * 计算单个图层在 descriptor buffer 中的字节范围。
 *
 * descriptorData 布局：每个图层占 2 个 Uint32 = 8 字节
 * 图层 i 的范围：[i * 8, (i+1) * 8)
 */
function getLayerDescriptorRange(layerEntry: LayerCompileEntry): BufferRange {
  const layerIndex = layerEntry.order
  return {
    offset: layerIndex * 2 * 4, // 2 Uint32 × 4 bytes
    length: 2 * 4,
  }
}

/**
 * 计算单个图层在 aux buffer 中的字节范围。
 *
 * auxData 布局：各图层 auxData 拼接
 * 图层的起始偏移记录在 LayerCompileEntry.auxOffset（以 vec4f = 16 字节为单位）
 */
function getLayerAuxRange(layerEntry: LayerCompileEntry): BufferRange {
  const startBytes = layerEntry.auxOffset * 16 // auxOffset 以 vec4f(16B) 为单位
  const lengthBytes = layerEntry.auxData.byteLength
  return {
    offset: startBytes,
    length: lengthBytes,
  }
}

/**
 * 根据 ValuePatch 和当前 artifact，计算需要上传的 buffer 范围。
 *
 * @param patch 应用的 ValuePatch
 * @param ir 当前 RenderIR（patch 应用后的）
 * @param artifact 当前编译产物
 * @returns UploadDiff
 */
export function computeUploadDiffForValuePatch(
  patch: ValuePatch,
  ir: RenderIR,
  artifact: RegionCompileArtifact,
): UploadDiff {
  // ir 当前未使用(预留:未来用于按 ir.layers 数量精确分片上传)
  void ir

  // Effect 参数变化：保守全量上传 effect buffer
  if (patch.targetEntity === 'effect') {
    return {
      ...emptyUploadDiff(),
      effectDescRanges: [{ offset: 0, length: artifact.effectDescData.byteLength }],
      effectParamRanges: [{ offset: 0, length: artifact.effectParamData.byteLength }],
      changedLayerIds: [patch.targetId],
    }
  }

  // Layer 参数变化：只更新该图层的 descriptor 和 aux 范围
  const layerEntry = artifact.layers.find((l) => l.layerId === patch.targetId)
  if (!layerEntry) {
    // 图层不存在，需要全量上传
    return fullUploadDiff([patch.targetId])
  }

  const descRange = getLayerDescriptorRange(layerEntry)
  const auxRange = getLayerAuxRange(layerEntry)

  return {
    descriptorRanges: [descRange],
    auxRanges: [auxRange],
    regionRanges: [],
    effectDescRanges: [],
    effectParamRanges: [],
    fullUploadRequired: false,
    changedLayerIds: [patch.targetId],
  }
}

/**
 * 比较两个 artifact，计算上传差异。
 *
 * 用于没有 patch 信息时的 fallback 比较（如场景切换后首次渲染）。
 *
 * @param prev 上一帧 artifact（null 表示首次渲染）
 * @param current 当前帧 artifact
 * @returns UploadDiff
 */
export function computeUploadDiffByComparison(
  prev: RegionCompileArtifact | null,
  current: RegionCompileArtifact,
): UploadDiff {
  // 首次渲染或结构变化 → 全量上传
  if (!prev) {
    return fullUploadDiff()
  }

  // 层数变化 → 全量上传
  if (prev.layers.length !== current.layers.length) {
    return fullUploadDiff()
  }

  // 区域数变化 → 全量上传
  if (prev.regions.length !== current.regions.length) {
    return fullUploadDiff()
  }

  // 效果数变化 → 全量上传
  if (prev.effects.length !== current.effects.length) {
    return fullUploadDiff()
  }

  // 逐图层比较，找出变化的图层
  const changedLayerIds: string[] = []
  const descRanges: BufferRange[] = []
  const auxRanges: BufferRange[] = []

  for (let i = 0; i < current.layers.length; i++) {
    const prevLayer = prev.layers[i]
    const currLayer = current.layers[i]

    // 图层 ID 变化 → 全量上传
    if (prevLayer.layerId !== currLayer.layerId) {
      return fullUploadDiff()
    }

    // 比较 auxData 内容
    let auxChanged = false
    if (prevLayer.auxData.length !== currLayer.auxData.length) {
      auxChanged = true
    } else {
      for (let j = 0; j < currLayer.auxData.length; j++) {
        if (prevLayer.auxData[j] !== currLayer.auxData[j]) {
          auxChanged = true
          break
        }
      }
    }

    // 比较 descriptorEntry
    const descChanged =
      prevLayer.descriptorEntry[0] !== currLayer.descriptorEntry[0] ||
      prevLayer.descriptorEntry[1] !== currLayer.descriptorEntry[1]

    if (auxChanged || descChanged) {
      changedLayerIds.push(currLayer.layerId)
      if (descChanged) {
        descRanges.push(getLayerDescriptorRange(currLayer))
      }
      if (auxChanged) {
        auxRanges.push(getLayerAuxRange(currLayer))
      }
    }
  }

  // 没有变化
  if (changedLayerIds.length === 0) {
    return emptyUploadDiff()
  }

  return {
    descriptorRanges: descRanges,
    auxRanges: auxRanges,
    regionRanges: [],
    effectDescRanges: [],
    effectParamRanges: [],
    fullUploadRequired: false,
    changedLayerIds,
  }
}

/**
 * 判断 UploadDiff 是否需要任何上传。
 */
export function hasAnyUpload(diff: UploadDiff): boolean {
  return (
    diff.fullUploadRequired ||
    diff.descriptorRanges.length > 0 ||
    diff.auxRanges.length > 0 ||
    diff.regionRanges.length > 0 ||
    diff.effectDescRanges.length > 0 ||
    diff.effectParamRanges.length > 0
  )
}

/**
 * 获取 UploadDiff 的摘要字符串（用于日志/调试）。
 */
export function summarizeUploadDiff(diff: UploadDiff): string {
  if (diff.fullUploadRequired) {
    return `full upload (changed: ${diff.changedLayerIds.join(', ') || 'structural'})`
  }
  const parts: string[] = []
  if (diff.descriptorRanges.length > 0) parts.push(`desc:${diff.descriptorRanges.length}`)
  if (diff.auxRanges.length > 0) parts.push(`aux:${diff.auxRanges.length}`)
  if (diff.regionRanges.length > 0) parts.push(`region:${diff.regionRanges.length}`)
  if (diff.effectDescRanges.length > 0) parts.push(`effectDesc:${diff.effectDescRanges.length}`)
  if (diff.effectParamRanges.length > 0) parts.push(`effectParam:${diff.effectParamRanges.length}`)
  if (parts.length === 0) return 'no changes'
  return `partial: ${parts.join(', ')} (changed: ${diff.changedLayerIds.join(', ')})`
}
