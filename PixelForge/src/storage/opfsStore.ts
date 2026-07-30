/**
 * L2 OPFS 存储前端访问层
 *
 * 通过 Worker 桥接 OPFS，主线程只发消息不阻塞。
 * 提供异步 API：write/read/delete/list/clear。
 *
 * 回退策略：浏览器不支持 OPFS 时降级为内存存储并打印警告。
 */

import OPFSWorker from './opfs.worker?worker'

type OpfsOp = 'write' | 'read' | 'delete' | 'exists' | 'list' | 'clear'

interface OpfsRequest {
  id: number
  op: OpfsOp
  namespace: string
  filename: string
  data?: ArrayBuffer
  prefix?: string
}

interface OpfsResponse {
  id: number
  ok: boolean
  data?: ArrayBuffer
  files?: string[]
  error?: string
  ready?: boolean
}

/** OPFS 是否可用（懒检测） */
let opfsAvailable: boolean | null = null

export async function isOpfsAvailable(): Promise<boolean> {
  if (opfsAvailable !== null) return opfsAvailable
  opfsAvailable =
    typeof navigator !== 'undefined' &&
    'storage' in navigator &&
    typeof navigator.storage.getDirectory === 'function'
  return opfsAvailable
}

/**
 * OPFS 仓储客户端
 * 单例：一个 Worker 实例处理所有 IO
 */
export class OpfsStore {
  private worker: Worker | null = null
  private pending = new Map<number, { resolve: (v: OpfsResponse) => void; reject: (e: Error) => void }>()
  private nextId = 1
  private readyPromise: Promise<void>
  private readyResolve!: () => void
  private fallbackCache = new Map<string, ArrayBuffer>()

  constructor() {
    this.readyPromise = new Promise((resolve) => {
      this.readyResolve = resolve
    })
    void this.init()
  }

  private async init(): Promise<void> {
    if (!(await isOpfsAvailable())) {
      console.warn('[OPFS] 浏览器不支持 OPFS，降级为内存存储（页面刷新后数据丢失）')
      this.readyResolve()
      return
    }
    try {
      this.worker = new OPFSWorker()
      this.worker.onmessage = (e: MessageEvent<OpfsResponse>) => {
        if (e.data.ready) {
          this.readyResolve()
          return
        }
        const handler = this.pending.get(e.data.id)
        if (handler) {
          this.pending.delete(e.data.id)
          if (e.data.ok) handler.resolve(e.data)
          else handler.reject(new Error(e.data.error ?? 'OPFS 操作失败'))
        }
      }
      this.worker.onerror = (e) => {
        console.error('[OPFS] Worker 错误', e)
        // 让所有等待中的请求失败
        for (const [, handler] of this.pending) {
          handler.reject(new Error('OPFS Worker 崩溃'))
        }
        this.pending.clear()
      }
      // 等待 ready 消息
      await this.readyPromise
    } catch (e) {
      console.warn('[OPFS] Worker 初始化失败，降级为内存存储', e)
      this.worker = null
      this.readyResolve()
    }
  }

  /** 等待 Worker 就绪 */
  async ready(): Promise<void> {
    await this.readyPromise
  }

  private fallbackKey(namespace: string, filename: string): string {
    return `${namespace}/${filename}`
  }

  private async request(op: OpfsOp, namespace: string, filename: string, data?: ArrayBuffer, prefix?: string): Promise<OpfsResponse> {
    await this.ready()
    // 降级路径
    if (!this.worker) {
      return this.fallbackRequest(op, namespace, filename, data, prefix)
    }
    const id = this.nextId++
    const req: OpfsRequest = { id, op, namespace, filename, data, prefix }
    return new Promise<OpfsResponse>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      const transfer: ArrayBuffer[] = []
      if (data) transfer.push(data)
      this.worker!.postMessage(req, transfer)
    })
  }

  private async fallbackRequest(op: OpfsOp, namespace: string, filename: string, data?: ArrayBuffer, prefix?: string): Promise<OpfsResponse> {
    const key = this.fallbackKey(namespace, filename)
    switch (op) {
      case 'write':
        if (!data) throw new Error('write 缺少 data')
        this.fallbackCache.set(key, data)
        return { id: 0, ok: true }
      case 'read': {
        const buf = this.fallbackCache.get(key)
        return { id: 0, ok: true, data: buf }
      }
      case 'delete':
        this.fallbackCache.delete(key)
        return { id: 0, ok: true }
      case 'exists':
        return { id: 0, ok: true, data: this.fallbackCache.has(key) ? new ArrayBuffer(1) : undefined }
      case 'list': {
        const p = prefix ?? ''
        const prefix2 = `${namespace}/${p}`
        const files: string[] = []
        for (const k of this.fallbackCache.keys()) {
          if (k.startsWith(prefix2)) files.push(k.slice(namespace.length + 1))
        }
        return { id: 0, ok: true, files }
      }
      case 'clear': {
        for (const k of Array.from(this.fallbackCache.keys())) {
          if (k.startsWith(`${namespace}/`)) this.fallbackCache.delete(k)
        }
        return { id: 0, ok: true }
      }
      default:
        return { id: 0, ok: false, error: `未知 op: ${op}` }
    }
  }

  // ===== 公开 API =====

  /** 写入二进制数据 */
  async write(namespace: string, filename: string, data: ArrayBuffer | Uint8Array): Promise<void> {
    const buf: ArrayBuffer = data instanceof Uint8Array
      ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
      : data
    const r = await this.request('write', namespace, filename, buf)
    if (!r.ok) throw new Error(r.error)
  }

  /** 读取二进制数据 */
  async read(namespace: string, filename: string): Promise<Uint8Array | null> {
    const r = await this.request('read', namespace, filename)
    if (!r.ok) throw new Error(r.error)
    if (!r.data) return null
    return new Uint8Array(r.data)
  }

  /** 读取为文本 */
  async readText(namespace: string, filename: string): Promise<string | null> {
    const bytes = await this.read(namespace, filename)
    if (!bytes) return null
    return new TextDecoder().decode(bytes)
  }

  /** 写入文本 */
  async writeText(namespace: string, filename: string, text: string): Promise<void> {
    const buf = new TextEncoder().encode(text).buffer
    await this.write(namespace, filename, buf)
  }

  /** 删除文件 */
  async delete(namespace: string, filename: string): Promise<void> {
    await this.request('delete', namespace, filename)
  }

  /** 文件是否存在 */
  async exists(namespace: string, filename: string): Promise<boolean> {
    const r = await this.request('exists', namespace, filename)
    return r.ok && r.data !== undefined
  }

  /** 列出命名空间下所有文件（可加前缀过滤） */
  async list(namespace: string, prefix?: string): Promise<string[]> {
    const r = await this.request('list', namespace, '', undefined, prefix)
    return r.files ?? []
  }

  /** 清空命名空间 */
  async clear(namespace: string): Promise<void> {
    await this.request('clear', namespace, '')
  }

  /** 销毁 Worker（应用退出时调用） */
  destroy(): void {
    this.worker?.terminate()
    this.worker = null
    this.pending.clear()
  }
}

/** 全局单例 */
export const opfsStore = new OpfsStore()

/**
 * 命名空间约定：
 * - frames   : 渲染帧的 RGBA 像素数据（frame_000001.rgba）
 * - shaders  : AI 生成的 WGSL 源码（shader_<hash>.wgsl）
 * - prompts  : 自然语言 prompt 历史（prompt_<timestamp>.txt）
 * - ir       : RenderIR 快照（ir_<frame>.json）
 * - thumbnails : 缩略图（thumb_<assetId>.png）
 * - videos   : 编码后的视频文件（export_<timestamp>.mp4）
 */
export const OPFS_NAMESPACES = {
  FRAMES: 'frames',
  SHADERS: 'shaders',
  PROMPTS: 'prompts',
  IR: 'ir',
  THUMBNAILS: 'thumbnails',
  VIDEOS: 'videos',
} as const
