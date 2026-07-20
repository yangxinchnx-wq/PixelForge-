/**
 * Node Cache(Step 26.10)— 节点求值缓存。
 *
 * 核心思想:如果节点的参数和输入未变,直接复用上次的求值结果。
 *
 * Cache Key 设计(三层):
 *   1. 节点本身:type + opcodeName + params 哈希
 *   2. 输入依赖:前驱节点的 cache key(传递性,确保上游变化时下游失效)
 *   3. 画布尺寸:canvas 改变时所有节点失效
 *
 * 失效策略:
 *   - 自动失效:cache key 变化 → 自然 miss(无需显式删除)
 *   - 手动失效:invalidate(nodeId) 删除单个节点缓存
 *   - 全量失效:clear() 清空所有缓存
 *
 * 注意:cache 只存 TextureHandle(元数据),不持有 GPU 资源。
 *       GPU 资源由 TexturePool / ResourceManager 管理。
 */

import type { GraphNode } from '../types'

/**
 * 稳定 JSON 序列化(键排序,避免对象键顺序影响 hash)。
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`
  }
  const keys = Object.keys(value as Record<string, unknown>).sort()
  const pairs = keys.map((k) => {
    const v = (value as Record<string, unknown>)[k]
    return `${JSON.stringify(k)}:${stableStringify(v)}`
  })
  return `{${pairs.join(',')}}`
}

/**
 * 节点缓存(泛型 T 通常为 TextureHandle)。
 *
 * 与 compileCache.ts 的区别:
 * - compileCache: 缓存 RegionCompileArtifact(Graph → RenderIR → RegionCompiler 的产物)
 * - NodeCache:    缓存单个节点的求值结果(GraphRuntime 中每个节点的 TextureHandle)
 * 两者粒度不同,NodeCache 更细,支持单节点级别的缓存命中。
 */
export class NodeCache<T = unknown> {
  private map = new Map<string, { value: T; timestamp: number; nodeId: string }>()

  /**
   * 查询缓存。
   * @returns 命中返回值,未命中返回 undefined
   */
  get(key: string): T | undefined {
    const entry = this.map.get(key)
    return entry?.value
  }

  /**
   * 写入缓存。
   */
  set(key: string, value: T, nodeId: string): void {
    this.map.set(key, { value, timestamp: Date.now(), nodeId })
  }

  /**
   * 是否命中。
   */
  has(key: string): boolean {
    return this.map.has(key)
  }

  /**
   * 删除单个缓存项(按 key)。
   */
  delete(key: string): boolean {
    return this.map.delete(key)
  }

  /**
   * 按 nodeId 失效:删除所有由该节点产生的缓存项。
   */
  invalidateNode(nodeId: string): number {
    let count = 0
    for (const [key, entry] of this.map) {
      if (entry.nodeId === nodeId) {
        this.map.delete(key)
        count++
      }
    }
    return count
  }

  /**
   * 清空所有缓存。
   */
  clear(): void {
    this.map.clear()
  }

  /**
   * 当前缓存项数量。
   */
  get size(): number {
    return this.map.size
  }

  /**
   * 列出所有缓存项的元信息(调试用)。
   */
  debugEntries(): Array<{ key: string; nodeId: string; timestamp: number }> {
    return Array.from(this.map.entries()).map(([key, entry]) => ({
      key,
      nodeId: entry.nodeId,
      timestamp: entry.timestamp,
    }))
  }
}

/**
 * 创建节点 cache key。
 *
 * Key 结构:
 *   `${node.type}|${opcodeName}|${hash(params)}|${inputCacheKeys.join(',')}|${canvas}`
 *
 * 设计原则:
 * - 节点 type + opcodeName 决定求值逻辑(不同 type / opcode 必然不同结果)
 * - params 决定输入参数(参数变 → key 变 → cache miss)
 * - inputCacheKeys 决定上游输入(上游任何变化 → 传递性失效)
 * - canvas 决定输出尺寸(画布变 → 所有节点失效)
 *
 * @param node            待求值的节点
 * @param inputCacheKeys  前驱节点的 cache key 列表(按依赖顺序)
 * @param canvas          画布尺寸(参与 key,确保画布变化时全量失效)
 * @returns 稳定的 cache key 字符串
 */
export function createCacheKey(
  node: GraphNode,
  inputCacheKeys: string[],
  canvas: { width: number; height: number },
): string {
  const parts = [
    node.type,
    node.opcodeName ?? '',
    stableStringify(node.params),
    inputCacheKeys.join(','),
    `${canvas.width}x${canvas.height}`,
  ]
  return parts.join('|')
}

/**
 * 计算 cache key 的短 hash(用于日志 / 调试显示)。
 */
export function cacheKeyHash(key: string): string {
  // FNV-1a 32-bit(与 shared/ids.ts 一致,但本模块内联避免循环依赖)
  let hash = 0x811c9dc5
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
