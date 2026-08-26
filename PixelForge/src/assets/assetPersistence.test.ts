/**
 * Asset 持久化模块测试
 *
 * 验证 OPFS 二进制写入/读取、索引管理、完整恢复流程。
 * 使用 mock opfsStore 避免真实 OPFS 依赖。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Asset, AssetIndexEntry } from './types'
import {
  generateOpfsPath,
  persistAssetBinary,
  loadAssetBlobUrl,
  assetToIndexEntry,
  indexEntryToAsset,
  loadAssetIndex,
  saveAssetIndex,
  upsertAssetIndex,
  deleteAssetFile,
  removeAssetFromIndex,
  restoreAllAssets,
} from './assetPersistence'

// ============================================================================
// Mock opfsStore — 使用内存 Map 模拟 OPFS
// ============================================================================

const mockStorage = new Map<string, Uint8Array>()
const mockTextStorage = new Map<string, string>()

vi.mock('@/storage/opfsStore', () => ({
  opfsStore: {
    write: vi.fn(async (ns: string, fn: string, data: Uint8Array) => {
      mockStorage.set(`${ns}/${fn}`, new Uint8Array(data))
    }),
    read: vi.fn(async (ns: string, fn: string) => {
      const v = mockStorage.get(`${ns}/${fn}`)
      return v ? new Uint8Array(v) : null
    }),
    writeText: vi.fn(async (ns: string, fn: string, text: string) => {
      mockTextStorage.set(`${ns}/${fn}`, text)
    }),
    readText: vi.fn(async (ns: string, fn: string) => {
      return mockTextStorage.get(`${ns}/${fn}`) ?? null
    }),
    delete: vi.fn(async (ns: string, fn: string) => {
      mockStorage.delete(`${ns}/${fn}`)
      mockTextStorage.delete(`${ns}/${fn}`)
    }),
  },
  OPFS_NAMESPACES: {
    FRAMES: 'frames',
    SHADERS: 'shaders',
    PROMPTS: 'prompts',
    IR: 'ir',
    THUMBNAILS: 'thumbnails',
    VIDEOS: 'videos',
    ASSETS: 'assets',
  },
  isOpfsAvailable: vi.fn().mockResolvedValue(true),
}))

// ============================================================================
// Mock URL.createObjectURL / fetch / atob
// ============================================================================

vi.stubGlobal('URL', {
  ...URL,
  createObjectURL: vi.fn((blob: Blob) => `blob:mock-${blob.size}`),
  revokeObjectURL: vi.fn(),
})

vi.stubGlobal('fetch', vi.fn(async (url: string) => {
  // 模拟 blob URL → 返回固定 bytes
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]) // PNG header
  return {
    blob: async () => new Blob([bytes.buffer as ArrayBuffer], { type: 'image/png' }),
  }
}))

vi.stubGlobal('atob', (str: string) => {
  // 简单 base64 解码
  return Buffer.from(str, 'base64').toString('binary')
})

vi.stubGlobal('btoa', (str: string) => {
  return Buffer.from(str, 'binary').toString('base64')
})

// ============================================================================
// 测试数据
// ============================================================================

function createTestImageAsset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: 'test-001',
    name: 'test.png',
    type: 'image',
    url: 'data:image/png;base64,iVBORw0KGgo=',
    width: 100,
    height: 100,
    size: 1024,
    createdAt: Date.now(),
    mimeType: 'image/png',
    ...overrides,
  }
}

function createTestVideoAsset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: 'test-vid-001',
    name: 'test.mp4',
    type: 'video',
    url: 'blob:mock-video',
    width: 1920,
    height: 1080,
    size: 50000000,
    createdAt: Date.now(),
    mimeType: 'video/mp4',
    duration: 10,
    fps: 30,
    codec: 'avc1',
    frameCount: 300,
    ...overrides,
  }
}

// ============================================================================
// 测试
// ============================================================================

beforeEach(() => {
  mockStorage.clear()
  mockTextStorage.clear()
  vi.clearAllMocks()
})

describe('generateOpfsPath', () => {
  it('应为图片 MIME 生成正确扩展名', () => {
    expect(generateOpfsPath('id1', 'image/png')).toBe('asset_id1.png')
    expect(generateOpfsPath('id2', 'image/jpeg')).toBe('asset_id2.jpg')
    expect(generateOpfsPath('id3', 'image/webp')).toBe('asset_id3.webp')
  })

  it('应为视频 MIME 生成正确扩展名', () => {
    expect(generateOpfsPath('vid1', 'video/mp4')).toBe('asset_vid1.mp4')
    expect(generateOpfsPath('vid2', 'video/webm')).toBe('asset_vid2.webm')
  })

  it('应为未知 MIME 生成 .dat 扩展名', () => {
    expect(generateOpfsPath('id', 'application/octet-stream')).toBe('asset_id.dat')
  })
})

describe('persistAssetBinary', () => {
  it('应将 dataURL 资产写入 OPFS', async () => {
    const asset = createTestImageAsset()
    const opfsPath = await persistAssetBinary(asset)

    expect(opfsPath).toBe('asset_test-001.png')
    expect(mockStorage.get('assets/asset_test-001.png')).toBeDefined()
    expect(mockStorage.get('assets/asset_test-001.png')!.byteLength).toBeGreaterThan(0)
  })

  it('应将 blob URL 资产写入 OPFS', async () => {
    const asset = createTestVideoAsset({ url: 'blob:mock-video' })
    const opfsPath = await persistAssetBinary(asset)

    expect(opfsPath).toBe('asset_test-vid-001.mp4')
    expect(mockStorage.get('assets/asset_test-vid-001.mp4')).toBeDefined()
  })

  it('应返回 null 当 URL 格式无法识别', async () => {
    const asset = createTestImageAsset({ url: 'invalid://url' })
    const opfsPath = await persistAssetBinary(asset)
    expect(opfsPath).toBeNull()
  })
})

describe('loadAssetBlobUrl', () => {
  it('应从 OPFS 读取并生成 blob URL', async () => {
    const asset = createTestImageAsset()
    await persistAssetBinary(asset)

    const url = await loadAssetBlobUrl('asset_test-001.png', 'image/png')
    expect(url).toBeTruthy()
    expect(url).toContain('blob:')
  })

  it('应返回 null 当 OPFS 文件不存在', async () => {
    const url = await loadAssetBlobUrl('nonexistent.png', 'image/png')
    expect(url).toBeNull()
  })
})

describe('索引管理', () => {
  it('assetToIndexEntry 应正确转换', () => {
    const asset = createTestImageAsset({ opfsPath: 'asset_test.png' })
    const entry = assetToIndexEntry(asset)

    expect(entry.id).toBe(asset.id)
    expect(entry.name).toBe(asset.name)
    expect(entry.opfsPath).toBe('asset_test.png')
    expect(entry.type).toBe('image')
    // 不应包含 url
    expect((entry as Asset).url).toBeUndefined()
  })

  it('indexEntryToAsset 应正确转换', () => {
    const entry: AssetIndexEntry = {
      id: 'test-001',
      name: 'test.png',
      type: 'image',
      width: 100,
      height: 100,
      size: 1024,
      createdAt: 12345,
      mimeType: 'image/png',
      opfsPath: 'asset_test-001.png',
    }
    const asset = indexEntryToAsset(entry)

    expect(asset.id).toBe(entry.id)
    expect(asset.opfsPath).toBe(entry.opfsPath)
    expect(asset.url).toBe('') // 需要异步恢复
  })

  it('saveAssetIndex / loadAssetIndex 应正确读写', async () => {
    const entries: AssetIndexEntry[] = [
      assetToIndexEntry(createTestImageAsset()),
      assetToIndexEntry(createTestVideoAsset()),
    ]

    await saveAssetIndex(entries)
    const loaded = await loadAssetIndex()

    expect(loaded).toHaveLength(2)
    expect(loaded[0].id).toBe('test-001')
    expect(loaded[1].id).toBe('test-vid-001')
  })

  it('loadAssetIndex 空时应返回空数组', async () => {
    const loaded = await loadAssetIndex()
    expect(loaded).toEqual([])
  })

  it('upsertAssetIndex 应新增条目', async () => {
    const entry = assetToIndexEntry(createTestImageAsset())
    await upsertAssetIndex(entry)
    const loaded = await loadAssetIndex()
    expect(loaded).toHaveLength(1)
    expect(loaded[0].id).toBe(entry.id)
  })

  it('upsertAssetIndex 应更新已有条目', async () => {
    const entry = assetToIndexEntry(createTestImageAsset({ name: 'old.png' }))
    await upsertAssetIndex(entry)

    const updated = { ...entry, name: 'new.png' }
    await upsertAssetIndex(updated)

    const loaded = await loadAssetIndex()
    expect(loaded).toHaveLength(1)
    expect(loaded[0].name).toBe('new.png')
  })

  it('removeAssetFromIndex 应删除条目', async () => {
    const entry = assetToIndexEntry(createTestImageAsset())
    await upsertAssetIndex(entry)

    await removeAssetFromIndex(entry.id)

    const loaded = await loadAssetIndex()
    expect(loaded).toHaveLength(0)
  })
})

describe('deleteAssetFile', () => {
  it('应删除 OPFS 中的文件', async () => {
    const asset = createTestImageAsset()
    await persistAssetBinary(asset)

    await deleteAssetFile('asset_test-001.png')

    expect(mockStorage.get('assets/asset_test-001.png')).toBeUndefined()
  })
})

describe('restoreAllAssets', () => {
  it('应从 OPFS 恢复全部资产', async () => {
    // 先持久化两个资产
    const imageAsset = createTestImageAsset()
    const videoAsset = createTestVideoAsset()
    await persistAssetBinary(imageAsset)
    await persistAssetBinary(videoAsset)
    await upsertAssetIndex(assetToIndexEntry({ ...imageAsset, opfsPath: 'asset_test-001.png' }))
    await upsertAssetIndex(assetToIndexEntry({ ...videoAsset, opfsPath: 'asset_test-vid-001.mp4' }))

    // 恢复
    const restored = await restoreAllAssets()

    expect(restored).toHaveLength(2)
    // 每个恢复的资产应有 blob URL
    for (const a of restored) {
      expect(a.url).toContain('blob:')
      expect(a.opfsPath).toBeTruthy()
    }
  })

  it('无持久化数据时应返回空数组', async () => {
    const restored = await restoreAllAssets()
    expect(restored).toEqual([])
  })
})
