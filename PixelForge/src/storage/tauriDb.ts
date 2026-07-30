/**
 * Tauri L3 持久化数据库前端桥接层
 *
 * 通过 invoke 调用 Rust 端 redb 命令。
 * 浏览器环境（非 Tauri）下自动降级为 OPFS 内存兜底。
 *
 * 注意：`@tauri-apps/api/core` 使用动态 import，浏览器环境完全不加载该包，
 * 避免 Vite 运行时重新预构建导致的 ERR_ABORTED 错误。
 */

import { opfsStore, OPFS_NAMESPACES } from './opfsStore'

/** Tauri invoke 函数类型（支持泛型返回值） */
type InvokeFn = <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>

/** 缓存的 invoke 函数（Tauri 环境下加载一次） */
let cachedInvoke: InvokeFn | null = null

/** 标记是否已确认非 Tauri 环境（避免重复检测） */
let confirmedNonTauri = false

/** 检测是否在 Tauri 环境 */
function isTauriEnv(): boolean {
  if (confirmedNonTauri) return false
  const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
  if (!isTauri) confirmedNonTauri = true
  return isTauri
}

/** 获取 invoke 函数，浏览器环境返回 null */
async function getInvoke(): Promise<InvokeFn | null> {
  if (!isTauriEnv()) return null
  if (cachedInvoke) return cachedInvoke
  // 动态导入：仅 Tauri 环境下加载 @tauri-apps/api
  const mod = await import('@tauri-apps/api/core')
  cachedInvoke = mod.invoke
  return cachedInvoke
}

// ===== 元数据 =====

export async function setMetadata(key: string, value: string): Promise<void> {
  const invoke = await getInvoke()
  if (invoke) {
    await invoke('db_set_metadata', { key, value })
  } else {
    await opfsStore.writeText(OPFS_NAMESPACES.IR, `meta_${key}.txt`, value)
  }
}

export async function getMetadata(key: string): Promise<string | null> {
  const invoke = await getInvoke()
  if (invoke) {
    const v = await invoke<string | null>('db_get_metadata', { key })
    return v ?? null
  } else {
    return await opfsStore.readText(OPFS_NAMESPACES.IR, `meta_${key}.txt`)
  }
}

export async function deleteMetadata(key: string): Promise<void> {
  const invoke = await getInvoke()
  if (invoke) {
    await invoke('db_delete_metadata', { key })
  } else {
    await opfsStore.delete(OPFS_NAMESPACES.IR, `meta_${key}.txt`)
  }
}

export async function listMetadata(): Promise<string[]> {
  const invoke = await getInvoke()
  if (invoke) {
    return await invoke<string[]>('db_list_metadata')
  } else {
    const files = await opfsStore.list(OPFS_NAMESPACES.IR, 'meta_')
    return files.map((f) => f.replace(/^meta_/, '').replace(/\.txt$/, ''))
  }
}

// ===== Prompt 历史 =====

export async function addPrompt(timestampMs: number, text: string): Promise<void> {
  const invoke = await getInvoke()
  if (invoke) {
    await invoke('db_add_prompt', { timestampMs, text })
  } else {
    await opfsStore.writeText(OPFS_NAMESPACES.PROMPTS, `${timestampMs}.txt`, text)
  }
}

export async function listPrompts(): Promise<Array<{ timestampMs: number; text: string }>> {
  const invoke = await getInvoke()
  if (invoke) {
    const arr = await invoke<Array<[number, string]>>('db_list_prompts')
    return arr.map(([timestampMs, text]) => ({ timestampMs, text }))
  } else {
    const files = await opfsStore.list(OPFS_NAMESPACES.PROMPTS)
    const result: Array<{ timestampMs: number; text: string }> = []
    for (const f of files) {
      const text = await opfsStore.readText(OPFS_NAMESPACES.PROMPTS, f)
      if (text !== null) {
        const timestampMs = parseInt(f.replace(/\.txt$/, ''), 10)
        result.push({ timestampMs, text })
      }
    }
    result.sort((a, b) => a.timestampMs - b.timestampMs)
    return result
  }
}

export async function queryPrompts(startMs: number, endMs: number): Promise<Array<{ timestampMs: number; text: string }>> {
  const invoke = await getInvoke()
  if (invoke) {
    const arr = await invoke<Array<[number, string]>>('db_query_prompts', { startMs, endMs })
    return arr.map(([timestampMs, text]) => ({ timestampMs, text }))
  } else {
    const all = await listPrompts()
    return all.filter((p) => p.timestampMs >= startMs && p.timestampMs <= endMs)
  }
}

// ===== WGSL 着色器代码 =====

export async function saveShader(hash: string, code: string): Promise<void> {
  const invoke = await getInvoke()
  if (invoke) {
    await invoke('db_save_shader', { hash, code })
  } else {
    await opfsStore.writeText(OPFS_NAMESPACES.SHADERS, `${hash}.wgsl`, code)
  }
}

export async function getShader(hash: string): Promise<string | null> {
  const invoke = await getInvoke()
  if (invoke) {
    return await invoke<string | null>('db_get_shader', { hash })
  } else {
    return await opfsStore.readText(OPFS_NAMESPACES.SHADERS, `${hash}.wgsl`)
  }
}

export async function listShaders(): Promise<string[]> {
  const invoke = await getInvoke()
  if (invoke) {
    return await invoke<string[]>('db_list_shaders')
  } else {
    const files = await opfsStore.list(OPFS_NAMESPACES.SHADERS)
    return files.map((f) => f.replace(/\.wgsl$/, ''))
  }
}

export async function deleteShader(hash: string): Promise<void> {
  const invoke = await getInvoke()
  if (invoke) {
    // redb 无独立删除命令，通过写入空字符串标记删除
    await invoke('db_save_shader', { hash, code: '' })
  } else {
    await opfsStore.delete(OPFS_NAMESPACES.SHADERS, `${hash}.wgsl`)
  }
}

// ===== RenderIR 索引 =====

export async function saveIR(frameId: number, irJson: string): Promise<void> {
  const invoke = await getInvoke()
  if (invoke) {
    await invoke('db_save_ir', { frameId, irJson })
  } else {
    await opfsStore.writeText(OPFS_NAMESPACES.IR, `${frameId}.json`, irJson)
  }
}

export async function getIR(frameId: number): Promise<string | null> {
  const invoke = await getInvoke()
  if (invoke) {
    return await invoke<string | null>('db_get_ir', { frameId })
  } else {
    return await opfsStore.readText(OPFS_NAMESPACES.IR, `${frameId}.json`)
  }
}

export async function deleteIR(frameId: number): Promise<void> {
  const invoke = await getInvoke()
  if (invoke) {
    // redb 无独立删除命令，通过写入空字符串标记删除
    await invoke('db_save_ir', { frameId, irJson: '' })
  } else {
    await opfsStore.delete(OPFS_NAMESPACES.IR, `${frameId}.json`)
  }
}

// ===== 资产元数据 =====

export async function saveAsset(assetId: string, metaJson: string): Promise<void> {
  const invoke = await getInvoke()
  if (invoke) {
    await invoke('db_save_asset', { assetId, metaJson })
  } else {
    await opfsStore.writeText(OPFS_NAMESPACES.IR, `asset_${assetId}.json`, metaJson)
  }
}

export async function listAssets(): Promise<Array<{ assetId: string; meta: unknown }>> {
  const invoke = await getInvoke()
  if (invoke) {
    const arr = await invoke<Array<[string, string]>>('db_list_assets')
    return arr.map(([assetId, meta]) => ({ assetId, meta: JSON.parse(meta) }))
  } else {
    const files = await opfsStore.list(OPFS_NAMESPACES.IR, 'asset_')
    const result: Array<{ assetId: string; meta: unknown }> = []
    for (const f of files) {
      const text = await opfsStore.readText(OPFS_NAMESPACES.IR, f)
      if (text) {
        const assetId = f.replace(/^asset_/, '').replace(/\.json$/, '')
        try {
          result.push({ assetId, meta: JSON.parse(text) })
        } catch {
          // 跳过损坏记录
        }
      }
    }
    return result
  }
}

export async function deleteAsset(assetId: string): Promise<void> {
  const invoke = await getInvoke()
  if (invoke) {
    await invoke('db_delete_asset', { assetId })
  } else {
    await opfsStore.delete(OPFS_NAMESPACES.IR, `asset_${assetId}.json`)
  }
}

// ===== 维护 =====

export async function clearAll(): Promise<void> {
  const invoke = await getInvoke()
  if (invoke) {
    await invoke('db_clear_all')
  }
  // 同时清 OPFS
  for (const ns of Object.values(OPFS_NAMESPACES)) {
    await opfsStore.clear(ns)
  }
}

export async function getDbPath(): Promise<string | null> {
  const invoke = await getInvoke()
  if (invoke) {
    return await invoke<string>('db_get_path')
  }
  return null
}
