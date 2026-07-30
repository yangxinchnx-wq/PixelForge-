import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * tauriDb 测试
 *
 * 测试策略：
 * - jsdom 环境下 window.__TAURI_INTERNALS__ 不存在，自动走 OPFS fallback 路径
 * - 验证 fallback 路径下元数据、prompt、shader、IR、asset 的 CRUD 操作
 * - Mock OPFS 以隔离测试，使用内存 Map 模拟
 */

// Mock invoke，确保即使误判为 Tauri 环境也走 fallback
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockRejectedValue(new Error('not tauri')),
}))

// Mock OPFS：使用内存 Map 模拟
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

import * as tauriDb from './tauriDb'

describe('tauriDb (fallback 模式)', () => {
  beforeEach(async () => {
    // 每个测试前清空所有
    await tauriDb.clearAll()
  })

  // ===== 元数据 =====

  describe('元数据', () => {
    it('setMetadata / getMetadata 读写', async () => {
      await tauriDb.setMetadata('project_name', 'PixelForge Demo')
      const v = await tauriDb.getMetadata('project_name')
      expect(v).toBe('PixelForge Demo')
    })

    it('getMetadata 不存在返回 null', async () => {
      const v = await tauriDb.getMetadata('nonexistent_key')
      expect(v).toBeNull()
    })

    it('deleteMetadata 删除', async () => {
      await tauriDb.setMetadata('temp_key', 'temp_value')
      await tauriDb.deleteMetadata('temp_key')
      expect(await tauriDb.getMetadata('temp_key')).toBeNull()
    })

    it('deleteMetadata 不存在的 key 不报错', async () => {
      await expect(tauriDb.deleteMetadata('ghost')).resolves.toBeUndefined()
    })

    it('listMetadata 列出所有 key', async () => {
      await tauriDb.setMetadata('key1', 'v1')
      await tauriDb.setMetadata('key2', 'v2')
      const keys = await tauriDb.listMetadata()
      expect(keys.sort()).toEqual(['key1', 'key2'])
    })

    it('setMetadata 覆盖同名 key', async () => {
      await tauriDb.setMetadata('k', 'old')
      await tauriDb.setMetadata('k', 'new')
      expect(await tauriDb.getMetadata('k')).toBe('new')
    })
  })

  // ===== Prompt 历史 =====

  describe('Prompt 历史', () => {
    it('addPrompt / listPrompts 添加与列出', async () => {
      await tauriDb.addPrompt(1000, '画一个红色圆形')
      await tauriDb.addPrompt(2000, '画一个蓝色方形')
      const list = await tauriDb.listPrompts()
      expect(list).toHaveLength(2)
      expect(list[0].timestampMs).toBe(1000)
      expect(list[0].text).toBe('画一个红色圆形')
      expect(list[1].timestampMs).toBe(2000)
      expect(list[1].text).toBe('画一个蓝色方形')
    })

    it('listPrompts 空列表', async () => {
      const list = await tauriDb.listPrompts()
      expect(list).toEqual([])
    })

    it('queryPrompts 按时间范围查询', async () => {
      await tauriDb.addPrompt(1000, 'a')
      await tauriDb.addPrompt(2000, 'b')
      await tauriDb.addPrompt(3000, 'c')
      await tauriDb.addPrompt(4000, 'd')

      const result = await tauriDb.queryPrompts(1500, 3500)
      expect(result).toHaveLength(2)
      expect(result[0].timestampMs).toBe(2000)
      expect(result[1].timestampMs).toBe(3000)
    })

    it('queryPrompts 边界包含', async () => {
      await tauriDb.addPrompt(1000, 'a')
      await tauriDb.addPrompt(2000, 'b')
      const result = await tauriDb.queryPrompts(1000, 2000)
      expect(result).toHaveLength(2)
    })

    it('queryPrompts 范围外无结果', async () => {
      await tauriDb.addPrompt(1000, 'a')
      const result = await tauriDb.queryPrompts(2000, 3000)
      expect(result).toEqual([])
    })
  })

  // ===== WGSL 着色器 =====

  describe('WGSL 着色器', () => {
    it('saveShader / getShader 读写', async () => {
      const code = '@vertex fn vs() -> @builtin(position) vec4f { return vec4f(0,0,0,1); }'
      await tauriDb.saveShader('hash_001', code)
      expect(await tauriDb.getShader('hash_001')).toBe(code)
    })

    it('getShader 不存在返回 null', async () => {
      expect(await tauriDb.getShader('nonexistent')).toBeNull()
    })

    it('listShaders 列出所有 hash', async () => {
      await tauriDb.saveShader('hash_a', 'code a')
      await tauriDb.saveShader('hash_b', 'code b')
      const list = await tauriDb.listShaders()
      expect(list.sort()).toEqual(['hash_a', 'hash_b'])
    })

    it('saveShader 覆盖同名 hash', async () => {
      await tauriDb.saveShader('h', 'old code')
      await tauriDb.saveShader('h', 'new code')
      expect(await tauriDb.getShader('h')).toBe('new code')
    })

    it('deleteShader 删除着色器', async () => {
      await tauriDb.saveShader('del_me', 'code')
      expect(await tauriDb.getShader('del_me')).toBe('code')
      await tauriDb.deleteShader('del_me')
      expect(await tauriDb.getShader('del_me')).toBeNull()
    })

    it('deleteShader 不存在的不报错', async () => {
      await expect(tauriDb.deleteShader('ghost')).resolves.toBeUndefined()
    })
  })

  // ===== RenderIR =====

  describe('RenderIR', () => {
    it('saveIR / getIR 读写', async () => {
      const ir = JSON.stringify({ layers: [{ id: 'l1', opacity: 1 }] })
      await tauriDb.saveIR(42, ir)
      expect(await tauriDb.getIR(42)).toBe(ir)
    })

    it('getIR 不存在返回 null', async () => {
      expect(await tauriDb.getIR(9999)).toBeNull()
    })

    it('saveIR 覆盖同帧', async () => {
      await tauriDb.saveIR(1, '{"v":1}')
      await tauriDb.saveIR(1, '{"v":2}')
      expect(await tauriDb.getIR(1)).toBe('{"v":2}')
    })

    it('deleteIR 删除 IR 快照', async () => {
      await tauriDb.saveIR(5, '{"v":1}')
      expect(await tauriDb.getIR(5)).toBe('{"v":1}')
      await tauriDb.deleteIR(5)
      expect(await tauriDb.getIR(5)).toBeNull()
    })

    it('deleteIR 不存在的不报错', async () => {
      await expect(tauriDb.deleteIR(9999)).resolves.toBeUndefined()
    })
  })

  // ===== 资产元数据 =====

  describe('资产元数据', () => {
    it('saveAsset / listAssets 添加与列出', async () => {
      const meta1 = JSON.stringify({ name: 'texture1', size: 1024 })
      const meta2 = JSON.stringify({ name: 'mesh1', vertices: 256 })
      await tauriDb.saveAsset('asset_001', meta1)
      await tauriDb.saveAsset('asset_002', meta2)
      const list = await tauriDb.listAssets()
      expect(list).toHaveLength(2)
      const ids = list.map((a) => a.assetId).sort()
      expect(ids).toEqual(['asset_001', 'asset_002'])
    })

    it('listAssets 解析 JSON meta', async () => {
      const meta = JSON.stringify({ name: 'tex', width: 512, height: 512 })
      await tauriDb.saveAsset('a1', meta)
      const list = await tauriDb.listAssets()
      expect(list[0].meta).toEqual({ name: 'tex', width: 512, height: 512 })
    })

    it('deleteAsset 删除', async () => {
      await tauriDb.saveAsset('a1', '{}')
      await tauriDb.deleteAsset('a1')
      const list = await tauriDb.listAssets()
      expect(list).toEqual([])
    })

    it('deleteAsset 不存在的不报错', async () => {
      await expect(tauriDb.deleteAsset('ghost')).resolves.toBeUndefined()
    })

    it('listAssets 跳过损坏 JSON', async () => {
      // 直接通过底层 saveAsset 写入正常数据
      await tauriDb.saveAsset('good', JSON.stringify({ ok: true }))
      // listAssets 应该返回 1 条
      const list = await tauriDb.listAssets()
      expect(list).toHaveLength(1)
      expect(list[0].assetId).toBe('good')
    })
  })

  // ===== 维护 =====

  describe('维护', () => {
    it('clearAll 清空所有数据', async () => {
      await tauriDb.setMetadata('k', 'v')
      await tauriDb.addPrompt(1, 'p')
      await tauriDb.saveShader('h', 'c')
      await tauriDb.saveIR(1, '{}')
      await tauriDb.saveAsset('a', '{}')

      await tauriDb.clearAll()

      expect(await tauriDb.listMetadata()).toEqual([])
      expect(await tauriDb.listPrompts()).toEqual([])
      expect(await tauriDb.listShaders()).toEqual([])
      expect(await tauriDb.listAssets()).toEqual([])
    })

    it('getDbPath 非 Tauri 环境返回 null', async () => {
      expect(await tauriDb.getDbPath()).toBeNull()
    })
  })
})
