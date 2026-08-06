/**
 * L2 OPFS Worker
 *
 * 在 Web Worker 中通过 createSyncAccessHandle 同步读写 OPFS 文件。
 * 同步 API 性能接近内存（~10μs），且不阻塞主线程。
 *
 * 浏览器支持：Chrome 111+ / Edge 111+ / Safari 17+
 * Tauri WebView2 (Chromium) 原生支持。
 *
 * 消息协议：
 * - 主线程 → Worker：request {id, op, payload}
 * - Worker → 主线程：response {id, ok, data?/error?}
 */

/// <reference lib="webworker" />

type OpfsOp = 'write' | 'read' | 'delete' | 'exists' | 'list' | 'clear'

interface OpfsRequest {
  id: number
  op: OpfsOp
  /** 命名空间（子目录），如 'frames' / 'shaders' / 'prompts' */
  namespace: string
  /** 文件名（不含路径分隔符） */
  filename: string
  /** 写入数据（仅 write） */
  data?: ArrayBuffer
  /** list 时的前缀过滤 */
  prefix?: string
}

interface OpfsResponse {
  id: number
  ok: boolean
  data?: ArrayBuffer
  files?: string[]
  error?: string
}

const ctx = self as unknown as DedicatedWorkerGlobalScope

/** 子目录句柄缓存，避免每次都遍历根目录 */
const dirHandleCache = new Map<string, FileSystemDirectoryHandle>()

/** Per-file 互斥锁：同一文件同一时间只允许一个 access handle */
const fileLocks = new Map<string, Promise<void>>()

/**
 * 对同一个文件（namespace/filename）的操作串行化。
 * 解决 OPFS 规范限制：同一文件不能同时有多个 open access handle。
 */
function withFileLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = fileLocks.get(key) ?? Promise.resolve()
  const next = prev.then(() => fn(), () => fn())
  // 保持链不断，即使中间步骤失败后续请求也能继续
  const chained = next.then(() => undefined, () => undefined)
  fileLocks.set(key, chained)
  return next
}

async function getNamespaceDir(
  root: FileSystemDirectoryHandle,
  namespace: string
): Promise<FileSystemDirectoryHandle> {
  let dir = dirHandleCache.get(namespace)
  if (dir) return dir
  dir = await root.getDirectoryHandle(namespace, { create: true })
  dirHandleCache.set(namespace, dir)
  return dir
}

async function handleRequest(req: OpfsRequest): Promise<OpfsResponse> {
  const { id, op, namespace, filename } = req

  // list 和 clear 是目录级操作，不需要 per-file 锁
  if (op === 'list' || op === 'clear') {
    return handleDirOp(req)
  }

  // read / write / delete / exists 需要 per-file 锁
  const fileKey = `${namespace}/${filename}`
  return withFileLock(fileKey, () => handleFileOp(req))
}

async function handleFileOp(req: OpfsRequest): Promise<OpfsResponse> {
  const { id, op, namespace, filename } = req
  try {
    const root = await navigator.storage.getDirectory()
    const dir = await getNamespaceDir(root, namespace)

    switch (op) {
      case 'write': {
        if (!req.data) throw new Error('write 缺少 data')
        const fileHandle = await dir.getFileHandle(filename, { create: true })
        const access = await fileHandle.createSyncAccessHandle()
        try {
          access.truncate(0)
          access.write(new Uint8Array(req.data))
          access.flush()
        } finally {
          access.close()
        }
        return { id, ok: true }
      }

      case 'read': {
        try {
          const fileHandle = await dir.getFileHandle(filename)
          const access = await fileHandle.createSyncAccessHandle()
          try {
            const size = access.getSize()
            const buf = new Uint8Array(size)
            access.read(buf, { at: 0 })
            // 拷贝到独立 ArrayBuffer 避免句柄关闭后引用失效
            const copied = buf.buffer.slice(0, size)
            return { id, ok: true, data: copied }
          } finally {
            access.close()
          }
        } catch (e) {
          if (
            e instanceof DOMException &&
            (e.name === 'NotFoundError' || e.name === 'TypeMismatchError')
          ) {
            return { id, ok: true, data: undefined }
          }
          throw e
        }
      }

      case 'delete': {
        try {
          await dir.removeEntry(filename)
        } catch (e) {
          if (e instanceof DOMException && e.name === 'NotFoundError') {
            // 忽略删除不存在文件
          } else {
            throw e
          }
        }
        return { id, ok: true }
      }

      case 'exists': {
        try {
          await dir.getFileHandle(filename)
          return { id, ok: true, data: new ArrayBuffer(1) }
        } catch {
          return { id, ok: true, data: undefined }
        }
      }

      default:
        return { id, ok: false, error: `未知 op: ${op}` }
    }
  } catch (e) {
    return { id, ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

async function handleDirOp(req: OpfsRequest): Promise<OpfsResponse> {
  const { id, op, namespace } = req
  try {
    const root = await navigator.storage.getDirectory()
    const dir = await getNamespaceDir(root, namespace)

    switch (op) {
      case 'list': {
        const files: string[] = []
        const prefix = req.prefix ?? ''
        for await (const [name, entry] of dir.entries()) {
          if (entry.kind === 'file' && (prefix === '' || name.startsWith(prefix))) {
            files.push(name)
          }
        }
        return { id, ok: true, files }
      }

      case 'clear': {
        for await (const [name, entry] of dir.entries()) {
          if (entry.kind === 'file') {
            try {
              await dir.removeEntry(name)
            } catch {
              // 忽略
            }
          }
        }
        return { id, ok: true }
      }

      default:
        return { id, ok: false, error: `未知 op: ${op}` }
    }
  } catch (e) {
    return { id, ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

ctx.onmessage = (e: MessageEvent<OpfsRequest>) => {
  void handleRequest(e.data).then((resp) => {
    const transfer: ArrayBuffer[] = []
    if (resp.data) transfer.push(resp.data)
    ctx.postMessage(resp, transfer)
  })
}

// 标记 worker 就绪
ctx.postMessage({ id: 0, ok: true, ready: true } as OpfsResponse & { ready: boolean })
