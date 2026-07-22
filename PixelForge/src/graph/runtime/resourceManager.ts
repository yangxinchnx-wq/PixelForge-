/**
 * Resource Manager(Step 26.8 + 39.2)— GPU 资源管理器。
 *
 * 职责:
 * - 封装 TexturePool + BufferPool,提供更高层级的资源管理接口
 * - 跟踪每个节点的资源占用(nodeId → PooledTexture[] / PooledBuffer[])
 * - 提供 dispose(nodeId) 释放单个节点持有的纹理和 buffer
 * - 提供 disposeAll() 释放所有资源
 * - 统计资源使用情况(供 profiler / UI 显示)
 *
 * 设计原则:
 * - 不直接创建 GPU 资源(委托给 TexturePool / BufferPool)
 * - 跟踪 nodeId → texture/buffer 引用(便于按节点失效,直接持有 Pooled 引用)
 * - 单例模式(由 GraphRuntime 持有,生命周期与 Runtime 一致)
 *
 * Step 39.2 升级:
 * - 新增 BufferPool 集成(acquireBuffer / releaseBuffer / disposeNode 同时释放 buffer)
 * - getStats 合并 texture + buffer 两套统计
 *
 * 与 runtime/types.ts 的 RuntimeDeviceHandle 的关系:
 * - RuntimeDeviceHandle: 底层 GPU device 接口(createTexture / createBuffer / ...)
 * - ResourceManager:     高层资源管理(acquireTexture / acquireBuffer / disposeNode)
 * ResourceManager 内部的池可注入创建函数,
 * 该函数在真实运行时由 RuntimeDeviceHandle.createTexture/createBuffer 实现。
 */

import type { PooledTexture, TextureDescriptor, TexturePoolOptions } from './texturePool'
import { TexturePool } from './texturePool'
import type { PooledBuffer, BufferDescriptor, BufferPoolOptions } from './bufferPool'
import { BufferPool } from './bufferPool'

/**
 * ResourceManager 选项。
 */
export interface ResourceManagerOptions extends TexturePoolOptions, BufferPoolOptions {
  /** 已有的 TexturePool(可选,不传则内部新建) */
  texturePool?: TexturePool
  /** 已有的 BufferPool(可选,不传则内部新建) */
  bufferPool?: BufferPool
}

/**
 * 资源管理统计信息(合并 texture + buffer)。
 */
export interface ResourceStats {
  // —— Texture 池统计 ——
  texturePoolSize: number
  textureInUse: number
  textureAvailable: number
  textureTotalAcquired: number
  textureTotalHits: number
  textureTotalMisses: number
  textureHitRate: number
  // —— Buffer 池统计 ——
  bufferPoolSize: number
  bufferInUse: number
  bufferAvailable: number
  bufferTotalAcquired: number
  bufferTotalHits: number
  bufferTotalMisses: number
  bufferHitRate: number
  bufferTotalRejected: number
  bufferTotalBytes: number
  // —— 节点统计 ——
  /** 持有资源的节点数量(纹理或 buffer) */
  nodeCount: number
}

/**
 * GPU 资源管理器。
 *
 * @example
 * const rm = new ResourceManager()
 * const tex = rm.acquireTexture('noise_01', { width: 1920, height: 1080 })
 * const buf = rm.acquireBuffer('noise_01', { size: 16, usage: 0x40 | 0x08 })
 * // ... 使用 tex / buf ...
 * rm.disposeNode('noise_01')  // 释放 noise_01 持有的所有纹理和 buffer
 */
export class ResourceManager {
  private readonly texturePool: TexturePool
  private readonly bufferPool: BufferPool
  /** nodeId → 该节点持有的纹理引用列表(直接持有 PooledTexture,便于 release) */
  private readonly nodeTextures = new Map<string, Set<PooledTexture>>()
  /** nodeId → 该节点持有的 buffer 引用列表(Step 39.2 新增) */
  private readonly nodeBuffers = new Map<string, Set<PooledBuffer>>()

  constructor(options: ResourceManagerOptions = {}) {
    this.texturePool = options.texturePool ?? new TexturePool(options)
    this.bufferPool = options.bufferPool ?? new BufferPool(options)
  }

  /**
   * 为指定节点申请一个纹理。
   *
   * @param nodeId 持有该纹理的节点 ID(用于 disposeNode 时批量释放)
   * @param desc   纹理描述符
   * @returns PooledTexture(已在池中标记为 inUse)
   */
  acquireTexture(nodeId: string, desc: TextureDescriptor): PooledTexture {
    const tex = this.texturePool.acquire(desc)
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
    this.texturePool.release(texture)
  }

  /**
   * 为指定节点申请一个 buffer(Step 39.2 新增)。
   *
   * @param nodeId 持有该 buffer 的节点 ID(用于 disposeNode 时批量释放)
   * @param desc   buffer 描述符
   * @returns PooledBuffer(已在池中标记为 inUse);若 usage 不可池化返回 undefined
   */
  acquireBuffer(nodeId: string, desc: BufferDescriptor): PooledBuffer | undefined {
    const buf = this.bufferPool.acquire(desc)
    if (buf === undefined) return undefined
    if (!this.nodeBuffers.has(nodeId)) {
      this.nodeBuffers.set(nodeId, new Set())
    }
    this.nodeBuffers.get(nodeId)!.add(buf)
    return buf
  }

  /**
   * 释放单个 buffer(标记为可复用)。
   */
  releaseBuffer(buffer: PooledBuffer): void {
    this.bufferPool.release(buffer)
  }

  /**
   * 释放某个节点持有的所有纹理和 buffer(从池中标记为可复用)。
   *
   * @returns 释放的资源总数(纹理 + buffer)
   */
  disposeNode(nodeId: string): number {
    let count = 0

    const textures = this.nodeTextures.get(nodeId)
    if (textures && textures.size > 0) {
      for (const tex of textures) {
        this.texturePool.release(tex)
        count++
      }
      this.nodeTextures.delete(nodeId)
    }

    const buffers = this.nodeBuffers.get(nodeId)
    if (buffers && buffers.size > 0) {
      for (const buf of buffers) {
        this.bufferPool.release(buf)
        count++
      }
      this.nodeBuffers.delete(nodeId)
    }

    return count
  }

  /**
   * 释放所有资源(清空纹理池 + buffer 池 + 节点映射)。
   */
  disposeAll(): void {
    this.texturePool.clear()
    this.bufferPool.clear()
    this.nodeTextures.clear()
    this.nodeBuffers.clear()
  }

  /**
   * 获取统计信息(合并 texture + buffer)。
   */
  getStats(): ResourceStats {
    const t = this.texturePool.getStats()
    const b = this.bufferPool.getStats()
    return {
      texturePoolSize: t.poolSize,
      textureInUse: t.inUse,
      textureAvailable: t.available,
      textureTotalAcquired: t.totalAcquired,
      textureTotalHits: t.totalHits,
      textureTotalMisses: t.totalMisses,
      textureHitRate: t.hitRate,
      bufferPoolSize: b.poolSize,
      bufferInUse: b.inUse,
      bufferAvailable: b.available,
      bufferTotalAcquired: b.totalAcquired,
      bufferTotalHits: b.totalHits,
      bufferTotalMisses: b.totalMisses,
      bufferHitRate: b.hitRate,
      bufferTotalRejected: b.totalRejected,
      bufferTotalBytes: b.totalBytes,
      nodeCount: new Set([...this.nodeTextures.keys(), ...this.nodeBuffers.keys()]).size,
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
   * 获取节点的 buffer 占用情况(返回 buffer ID 列表,调试用)。
   */
  getNodeBuffers(nodeId: string): string[] {
    const buffers = this.nodeBuffers.get(nodeId)
    return buffers ? Array.from(buffers).map((b) => b.id) : []
  }

  /**
   * 暴露内部的 TexturePool(供 GraphRuntime 直接操作)。
   */
  getTexturePool(): TexturePool {
    return this.texturePool
  }

  /**
   * 暴露内部的 BufferPool(Step 39.2 新增,供 GraphRuntime 直接操作)。
   */
  getBufferPool(): BufferPool {
    return this.bufferPool
  }
}

