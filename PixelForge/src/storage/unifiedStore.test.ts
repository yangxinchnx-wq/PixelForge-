import { describe, it, expect, beforeEach, vi } from 'vitest'
import { UnifiedStore } from './unifiedStore'

// Mock Tauri 环境：不在 Tauri 时走 OPFS fallback
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockRejectedValue(new Error('not tauri')),
}))

// Mock OPFS：使用内存兜底
vi.mock('./opfsStore', () => {
  const store = new Map<string, string>()
  return {
    opfsStore: {
      ready: vi.fn().mockResolvedValue(undefined),
      write: vi.fn(async (ns: string, fn: string, data: ArrayBuffer) => {
        store.set(`${ns}/${fn}`, new TextDecoder().decode(data))
      }),
      writeText: vi.fn(async (ns: string, fn: string, text: string) => {
        store.set(`${ns}/${fn}`, text)
      }),
      read: vi.fn(async (ns: string, fn: string) => {
        const v = store.get(`${ns}/${fn}`)
        return v ? new TextEncoder().encode(v) : null
      }),
      readText: vi.fn(async (ns: string, fn: string) => {
        return store.get(`${ns}/${fn}`) ?? null
      }),
      delete: vi.fn(async (ns: string, fn: string) => {
        store.delete(`${ns}/${fn}`)
      }),
      exists: vi.fn(async (ns: string, fn: string) => store.has(`${ns}/${fn}`)),
      list: vi.fn(async (ns: string, prefix?: string) => {
        const p = prefix ?? ''
        const result: string[] = []
        for (const k of store.keys()) {
          if (k.startsWith(`${ns}/`)) {
            const fn = k.slice(ns.length + 1)
            if (p === '' || fn.startsWith(p)) result.push(fn)
          }
        }
        return result
      }),
      clear: vi.fn(async (ns: string) => {
        for (const k of Array.from(store.keys())) {
          if (k.startsWith(`${ns}/`)) store.delete(k)
        }
      }),
    },
    OPFS_NAMESPACES: {
      FRAMES: 'frames',
      SHADERS: 'shaders',
      PROMPTS: 'prompts',
      IR: 'ir',
      THUMBNAILS: 'thumbnails',
      VIDEOS: 'videos',
    },
    isOpfsAvailable: vi.fn().mockResolvedValue(false),
  }
})

describe('UnifiedStore', () => {
  let store: UnifiedStore

  beforeEach(() => {
    store = new UnifiedStore()
  })

  it('writeFrame / readFrame 二进制读写', async () => {
    const pixels = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255])
    await store.writeFrame(1, pixels)
    const read = await store.readFrame(1)
    expect(read).not.toBeNull()
    expect(read!.length).toBe(8)
    expect(read![0]).toBe(255)
  })

  it('readFrame 不存在返回 null', async () => {
    const read = await store.readFrame(9999)
    expect(read).toBeNull()
  })

  it('writeShader / readShader 文本读写', async () => {
    const code = '@vertex fn vs() -> @builtin(position) vec4f { return vec4f(0,0,0,1); }'
    await store.writeShader('hash123', code)
    const read = await store.readShader('hash123')
    expect(read).toBe(code)
  })

  it('writeMetadata / readMetadata 元数据读写', async () => {
    const json = JSON.stringify({ name: 'test', version: 1 })
    await store.writeMetadata('project1', json)
    const read = await store.readMetadata('project1')
    expect(read).toBe(json)
  })

  it('deleteMetadata 删除元数据', async () => {
    await store.writeMetadata('temp', 'value')
    await store.deleteMetadata('temp')
    const read = await store.readMetadata('temp')
    // L1 已删除，L2/L3 fallback 也会删除
    // readText 会回源 L2，但 L2 也已删除
    expect(read).toBeNull()
  })

  it('writeIR / readIR 快照读写', async () => {
    const ir = JSON.stringify({ layers: [], regions: [] })
    await store.writeIR(42, ir)
    const read = await store.readIR(42)
    expect(read).toBe(ir)
  })

  it('stats 返回统计', async () => {
    const stats = await store.stats()
    expect(stats).toHaveProperty('frameMemory')
    expect(stats).toHaveProperty('textMemory')
    expect(stats.frameMemory.entries).toBeGreaterThanOrEqual(0)
  })

  it('clearAll 清空所有层', async () => {
    await store.writeShader('h1', 'code1')
    await store.writeMetadata('k1', 'v1')
    await store.clearAll()
    const stats = await store.stats()
    expect(stats.frameMemory.entries).toBe(0)
    expect(stats.textMemory.entries).toBe(0)
  })

  // ===== 删除操作 =====

  it('deleteFrame 删除帧数据', async () => {
    const pixels = new Uint8Array([1, 2, 3])
    await store.writeFrame(5, pixels)
    expect(await store.readFrame(5)).not.toBeNull()
    await store.deleteFrame(5)
    expect(await store.readFrame(5)).toBeNull()
  })

  it('deleteFrame 不存在的帧不报错', async () => {
    await expect(store.deleteFrame(9999)).resolves.toBeUndefined()
  })

  it('deleteShader 删除着色器', async () => {
    await store.writeShader('hash_x', 'code')
    expect(await store.readShader('hash_x')).toBe('code')
    await store.deleteShader('hash_x')
    expect(await store.readShader('hash_x')).toBeNull()
  })

  it('deleteIR 删除 IR 快照', async () => {
    await store.writeIR(7, '{"v":1}')
    expect(await store.readIR(7)).toBe('{"v":1}')
    await store.deleteIR(7)
    expect(await store.readIR(7)).toBeNull()
  })

  it('deleteAsset 删除资产', async () => {
    await store.writeAsset('test1', '{"name":"tex"}')
    expect(await store.readAsset('test1')).toBe('{"name":"tex"}')
    await store.deleteAsset('test1')
    expect(await store.readAsset('test1')).toBeNull()
  })

  it('clearCategory 清空指定类别', async () => {
    await store.writeFrame(1, new Uint8Array([1]))
    await store.writeFrame(2, new Uint8Array([2]))
    await store.writeShader('h', 'code')
    await store.clearCategory('frame')
    // frame 类别应被清空
    expect(await store.readFrame(1)).toBeNull()
    expect(await store.readFrame(2)).toBeNull()
    // shader 类别不受影响
    expect(await store.readShader('h')).toBe('code')
  })
})
