/**
 * Resource Manager(Step 26.8)— GPU 资源管理器。
 *
 * 职责:
 * - 封装 TexturePool,提供更高层级的资源管理接口
 * - 跟踪每个节点的资源占用(nodeId → PooledTexture[])
 * - 提供 dispose(nodeId) 释放单个节点持有的资源
 * - 提供 disposeAll() 释放所有资源
 * - 统计资源使用情况(供 profiler / UI 显示)
 *
 * 设计原则:
 * - 不直接创建 GPU 资源(委托给 TexturePool)
 * - 跟踪 nodeId → texture 引用(便于按节点失效,直接持有 PooledTexture 引用)
 * - 单例模式(由 GraphRuntime 持有,生命周期与 Runtime 一致)
 *
 * 与 runtime/types.ts 的 RuntimeDeviceHandle 的关系:
 * - RuntimeDeviceHandle: 底层 GPU device 接口(createTexture / createBuffer / ...)
 * - ResourceManager:     高层资源管理(acquireTexture / releaseTexture / disposeNode)
 * ResourceManager 内部的 TexturePool 可注入 createGpuTexture 函数,
 * 该函数在真实运行时由 RuntimeDeviceHandle.createTexture 实现。
 */

import type { PooledTexture, TextureDescriptor, TexturePoolOptions } from './texturePool'
import { TexturePool } from './texturePool'

/**
 * ResourceManager 选项。
 */
export interface ResourceManagerOptions extends TexturePoolOptions {
  /** 已有的 TexturePool(可选,不传则内部新建) */
  texturePool?: TexturePool
}

/**
 * 资源管理统计信息。
 */
export interface ResourceStats {
  poolSize: number
  inUse: number
  available: number
  totalAcquired: number
  totalHits: number
  totalMisses: number
  hitRate: number
  /** 持有资源的节点数量 */
  nodeCount: number
}

/**
 * GPU 资源管理器。
 *
 * @example
 * const rm = new ResourceManager()
 * const tex = rm.acquireTexture('noise_01', { width: 1920, height: 1080 })
 * // ... 使用 tex ...
 * rm.disposeNode('noise_01')  // 释放 noise_01 持有的所有纹理
 */
export class ResourceManager {
  private readonly pool: TexturePool
  /** nodeId → 该节点持有的纹理引用列表(直接持有 PooledTexture,便于 release) */
  private readonly nodeTextures = new Map<string, Set<PooledTexture>>()

  constructor(options: ResourceManagerOptions = {}) {
    this.pool = options.texturePool ?? new TexturePool(options)
  }

  /**
   * 为指定节点申请一个纹理。
   *
   * @param nodeId 持有该纹理的节点 ID(用于 disposeNode 时批量释放)
   * @param desc   纹理描述符
   * @returns PooledTexture(已在池中标记为 inUse)
   */
  acquireTexture(nodeId: string, desc: TextureDescriptor): PooledTexture {
    const tex = this.pool.acquire(desc)
    if (!this.nodeTextures.has(nodeId)) {
      this.nodeTextures.set(nodeId, new Set())
    }
    this.nodeTextures.get(nodeId)!.add(tex)
    return tex
  }

  /**
   * 释放单个纹理(标记为可复用)。
   *
   * 注意:纹理仍归节点所有,只是标记为可被其他 acquire 复用。
   * 要彻底释放节点资源,使用 disposeNode。
   */
  releaseTexture(texture: PooledTexture): void {
    this.pool.release(texture)
  }

  /**
   * 释放某个节点持有的所有纹理(从池中标记为可复用)。
   *
   * @returns 释放的纹理数量
   */
  disposeNode(nodeId: string): number {
    const textures = this.nodeTextures.get(nodeId)
    if (!textures || textures.size === 0) return 0

    let count = 0
    for (const tex of textures) {
      this.pool.release(tex)
      count++
    }
    this.nodeTextures.delete(nodeId)
    return count
  }

  /**
   * 释放所有资源(清空池 + 节点映射)。
   */
  disposeAll(): void {
    this.pool.clear()
    this.nodeTextures.clear()
  }

  /**
   * 获取统计信息。
   */
  getStats(): ResourceStats {
    const poolStats = this.pool.getStats()
    return {
      ...poolStats,
      nodeCount: this.nodeTextures.size,
    }
  }

  /**
   * 获取节点的纹理占用情况(返回纹理 ID 列表,调试用)。
   */
  getNodeTextures(nodeId: string): string[] {
    const textures = this.nodeTextures.get(nodeId)
    return textures ? Array.from(textures).map((t) => t.id) : []
  }

  /**
   * 暴露内部的 TexturePool(供 GraphRuntime 直接操作)。
   */
  getTexturePool(): TexturePool {
    return this.pool
  }
}
