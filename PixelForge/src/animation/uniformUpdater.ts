/**
 * Uniform Updater(Step 29.11)— GPU Uniform Buffer 更新器。
 *
 * 职责:
 * - UniformBufferRegistry: 管理 nodeId → GPUBuffer 映射
 * - registerUniformBuffer: 注册节点的 uniform buffer
 * - unregisterUniformBuffer: 注销节点的 uniform buffer
 * - collectUniformUpdates: 把 ParamPatch[] 转成 UniformUpdate[]
 * - flushUniformUpdates: 批量写入 GPUBuffer(device.queue.writeBuffer)
 *
 * 数据流(每帧):
 *   evaluator.evaluateAllTracks(tracks, time)
 *     ↓ ParamPatch[]
 *   uniformUpdater.collectUniformUpdates(patches, registry)
 *     ↓ UniformUpdate[]
 *   uniformUpdater.flushUniformUpdates(updates, device)
 *     ↓ device.queue.writeBuffer(...)
 *   GPU Shader 读取最新 uniform 值
 */

import type { ParamPatch, UniformUpdate } from './types'

// ============================================================================
// 1. Uniform Buffer 注册表
// ============================================================================

/**
 * Uniform Buffer 注册表条目。
 *
 * - buffer:   GPUBuffer(由调用方创建)
 * - offset:   参数在 buffer 中的偏移(字节)
 * - size:     参数占用字节数(float=4, vec2=8, vec3=12, vec4=16)
 */
export interface UniformBufferEntry {
  buffer: GPUBuffer
  offset: number
  size: number
}

/**
 * Uniform Buffer 注册表。
 *
 * Key: `${nodeId}:${property}`
 * Value: UniformBufferEntry
 *
 * 设计:
 * - 一个节点可能有多个 uniform 参数,每个参数有独立 offset
 * - 或者一个节点共用一个 uniform buffer,多个参数在不同 offset
 * - 注册时由调用方指定 offset / size
 */
export class UniformBufferRegistry {
  private entries = new Map<string, UniformBufferEntry>()

  /**
   * 注册 uniform buffer。
   *
   * @param nodeId   节点 id
   * @param property 参数 key
   * @param buffer   GPUBuffer
   * @param offset   参数在 buffer 中的偏移(字节,默认 0)
   * @param size     参数字节数(默认 4 = float)
   */
  register(
    nodeId: string,
    property: string,
    buffer: GPUBuffer,
    offset: number = 0,
    size: number = 4,
  ): void {
    this.entries.set(`${nodeId}:${property}`, { buffer, offset, size })
  }

  /** 注销节点的所有 uniform 参数 */
  unregisterNode(nodeId: string): number {
    let removed = 0
    for (const key of this.entries.keys()) {
      if (key.startsWith(`${nodeId}:`)) {
        this.entries.delete(key)
        removed++
      }
    }
    return removed
  }

  /** 注销单个参数 */
  unregister(nodeId: string, property: string): boolean {
    return this.entries.delete(`${nodeId}:${property}`)
  }

  /** 查找 */
  get(nodeId: string, property: string): UniformBufferEntry | undefined {
    return this.entries.get(`${nodeId}:${property}`)
  }

  /** 清空 */
  clear(): void {
    this.entries.clear()
  }

  /** 当前条目数 */
  get size(): number {
    return this.entries.size
  }

  /** 所有 key(调试用) */
  keys(): IterableIterator<string> {
    return this.entries.keys()
  }
}

// ============================================================================
// 2. 收集 Uniform 更新
// ============================================================================

/**
 * 把 ParamPatch[] 转成 UniformUpdate[](仅包含已注册的参数)。
 *
 * 未注册的 patch 会被跳过(返回空)。
 *
 * @param patches   ParamPatch[](由 evaluator 生成)
 * @param registry  Uniform Buffer 注册表
 * @returns UniformUpdate[](每个含 buffer / offset / data / sourceTrackId)
 */
export function collectUniformUpdates(
  patches: ParamPatch[],
  registry: UniformBufferRegistry,
): UniformUpdate[] {
  const updates: UniformUpdate[] = []
  for (const patch of patches) {
    const entry = registry.get(patch.nodeId, patch.property)
    if (!entry) continue

    // 把 number 转成 Float32Array
    // 注:vec2/vec3/vec4 参数需要调用方在 register 时指定更大的 size,
    //     并在 toFloat32Array 中扩展。这里简化:只处理标量。
    const data = new Float32Array([patch.value])
    updates.push({
      buffer: entry.buffer,
      offset: entry.offset,
      data,
      sourceTrackId: `${patch.nodeId}:${patch.property}`,
    })
  }
  return updates
}

// ============================================================================
// 3. 批量写入 GPU
// ============================================================================

/**
 * GPU 设备接口(最小化,只要求 queue.writeBuffer)。
 *
 * 用结构化类型避免直接 import runtime/device.ts(循环依赖)。
 *
 * 注:data 类型用 Float32Array(而非 BufferSource),因为本模块只生成 Float32Array。
 *     这样避免 TS 5.7+ 的 ArrayBufferLike vs ArrayBuffer 泛型问题。
 */
export interface WritableGpuDevice {
  queue: {
    writeBuffer: (
      buffer: GPUBuffer,
      offset: number,
      data: Float32Array,
    ) => void
  }
}

/**
 * 批量写入 GPUBuffer(每帧调用)。
 *
 * - 对每个 update 调用 device.queue.writeBuffer
 * - 返回写入次数
 *
 * @param updates UniformUpdate[](由 collectUniformUpdates 生成)
 * @param device  GPU 设备
 */
export function flushUniformUpdates(
  updates: UniformUpdate[],
  device: WritableGpuDevice,
): number {
  for (const update of updates) {
    device.queue.writeBuffer(update.buffer, update.offset, update.data)
  }
  return updates.length
}

// ============================================================================
// 4. 便捷:合并收集 + 写入
// ============================================================================

/**
 * 一步完成:收集更新 + 写入 GPU。
 *
 * @param patches   ParamPatch[]
 * @param registry  Uniform Buffer 注册表
 * @param device    GPU 设备
 * @returns 写入次数
 */
export function applyUniformUpdates(
  patches: ParamPatch[],
  registry: UniformBufferRegistry,
  device: WritableGpuDevice,
): number {
  const updates = collectUniformUpdates(patches, registry)
  return flushUniformUpdates(updates, device)
}

// ============================================================================
// 5. 全局注册表单例
// ============================================================================

/**
 * 全局 Uniform Buffer 注册表单例。
 *
 * 设计:
 * - 单例避免每个组件创建独立 registry
 * - 切换场景时由 App.vue 调用 clear()
 */
export const uniformRegistry = new UniformBufferRegistry()
