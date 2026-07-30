import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * OpfsStore 测试
 *
 * 测试策略：
 * - jsdom 环境下 navigator.storage 不存在，OpfsStore 自动走 fallback 内存路径
 * - 验证 fallback 路径的读写、删除、列表、清空等操作
 * - 验证命名空间隔离
 */

// Mock worker 导入，避免 vitest 解析 ?worker 失败
vi.mock('./opfs.worker?worker', () => ({
  default: class MockWorker {
    onmessage: ((e: MessageEvent) => void) | null = null
    postMessage() {}
    terminate() {}
    addEventListener() {}
    removeEventListener() {}
  },
}))

import { OpfsStore, OPFS_NAMESPACES, isOpfsAvailable } from './opfsStore'

describe('isOpfsAvailable', () => {
  it('jsdom 环境返回 false', async () => {
    expect(await isOpfsAvailable()).toBe(false)
  })
})

describe('OpfsStore (fallback 内存模式)', () => {
  let store: OpfsStore

  beforeEach(async () => {
    store = new OpfsStore()
    await store.ready()
    // 每个测试前清空所有命名空间
    for (const ns of Object.values(OPFS_NAMESPACES)) {
      await store.clear(ns)
    }
  })

  it('writeText / readText 文本读写', async () => {
    await store.writeText(OPFS_NAMESPACES.SHADERS, 'shader_abc.wgsl', '@vertex fn main() {}')
    const text = await store.readText(OPFS_NAMESPACES.SHADERS, 'shader_abc.wgsl')
    expect(text).toBe('@vertex fn main() {}')
  })

  it('readText 不存在返回 null', async () => {
    const text = await store.readText(OPFS_NAMESPACES.SHADERS, 'nonexistent.wgsl')
    expect(text).toBeNull()
  })

  it('write / read 二进制读写', async () => {
    const data = new Uint8Array([1, 2, 3, 4, 5])
    await store.write(OPFS_NAMESPACES.FRAMES, 'frame_1.rgba', data)
    const read = await store.read(OPFS_NAMESPACES.FRAMES, 'frame_1.rgba')
    expect(read).not.toBeNull()
    expect(read!.length).toBe(5)
    expect(Array.from(read!)).toEqual([1, 2, 3, 4, 5])
  })

  it('read 不存在返回 null', async () => {
    const read = await store.read(OPFS_NAMESPACES.FRAMES, 'no_such_file.bin')
    expect(read).toBeNull()
  })

  it('delete 删除文件', async () => {
    await store.writeText(OPFS_NAMESPACES.PROMPTS, 'p1.txt', 'hello')
    await store.delete(OPFS_NAMESPACES.PROMPTS, 'p1.txt')
    const text = await store.readText(OPFS_NAMESPACES.PROMPTS, 'p1.txt')
    expect(text).toBeNull()
  })

  it('delete 不存在的文件不报错', async () => {
    await expect(store.delete(OPFS_NAMESPACES.PROMPTS, 'ghost.txt')).resolves.toBeUndefined()
  })

  it('exists 判断文件存在', async () => {
    await store.writeText(OPFS_NAMESPACES.IR, 'ir_1.json', '{}')
    expect(await store.exists(OPFS_NAMESPACES.IR, 'ir_1.json')).toBe(true)
    expect(await store.exists(OPFS_NAMESPACES.IR, 'ir_2.json')).toBe(false)
  })

  it('list 列出命名空间下所有文件', async () => {
    await store.writeText(OPFS_NAMESPACES.IR, 'ir_1.json', '{}')
    await store.writeText(OPFS_NAMESPACES.IR, 'ir_2.json', '{}')
    await store.writeText(OPFS_NAMESPACES.IR, 'meta_proj.txt', 'meta')
    const files = await store.list(OPFS_NAMESPACES.IR)
    expect(files.sort()).toEqual(['ir_1.json', 'ir_2.json', 'meta_proj.txt'])
  })

  it('list 支持前缀过滤', async () => {
    await store.writeText(OPFS_NAMESPACES.IR, 'ir_1.json', '{}')
    await store.writeText(OPFS_NAMESPACES.IR, 'ir_2.json', '{}')
    await store.writeText(OPFS_NAMESPACES.IR, 'meta_proj.txt', 'meta')
    const files = await store.list(OPFS_NAMESPACES.IR, 'ir_')
    expect(files.sort()).toEqual(['ir_1.json', 'ir_2.json'])
  })

  it('命名空间隔离', async () => {
    await store.writeText(OPFS_NAMESPACES.SHADERS, 'same_name.txt', 'from shaders')
    await store.writeText(OPFS_NAMESPACES.PROMPTS, 'same_name.txt', 'from prompts')
    expect(await store.readText(OPFS_NAMESPACES.SHADERS, 'same_name.txt')).toBe('from shaders')
    expect(await store.readText(OPFS_NAMESPACES.PROMPTS, 'same_name.txt')).toBe('from prompts')
  })

  it('clear 清空指定命名空间', async () => {
    await store.writeText(OPFS_NAMESPACES.SHADERS, 's1.wgsl', 'a')
    await store.writeText(OPFS_NAMESPACES.SHADERS, 's2.wgsl', 'b')
    await store.writeText(OPFS_NAMESPACES.PROMPTS, 'p1.txt', 'c')
    await store.clear(OPFS_NAMESPACES.SHADERS)
    expect(await store.list(OPFS_NAMESPACES.SHADERS)).toEqual([])
    // prompts 不受影响
    expect(await store.list(OPFS_NAMESPACES.PROMPTS)).toEqual(['p1.txt'])
  })

  it('writeText 后 overwrite 同名文件', async () => {
    await store.writeText(OPFS_NAMESPACES.SHADERS, 's.wgsl', 'old')
    await store.writeText(OPFS_NAMESPACES.SHADERS, 's.wgsl', 'new')
    expect(await store.readText(OPFS_NAMESPACES.SHADERS, 's.wgsl')).toBe('new')
  })

  it('ready 可被多次 await', async () => {
    await store.ready()
    await store.ready()
    expect(await store.readText(OPFS_NAMESPACES.IR, 'whatever.txt')).toBeNull()
  })

  it('destroy 终止后状态清理', async () => {
    await store.writeText(OPFS_NAMESPACES.IR, 'tmp.txt', 'x')
    store.destroy()
    // destroy 后 store 仍可使用（fallback 路径不依赖 worker）
    expect(await store.readText(OPFS_NAMESPACES.IR, 'tmp.txt')).toBe('x')
  })
})

describe('OPFS_NAMESPACES', () => {
  it('包含全部预期命名空间', () => {
    expect(OPFS_NAMESPACES.FRAMES).toBe('frames')
    expect(OPFS_NAMESPACES.SHADERS).toBe('shaders')
    expect(OPFS_NAMESPACES.PROMPTS).toBe('prompts')
    expect(OPFS_NAMESPACES.IR).toBe('ir')
    expect(OPFS_NAMESPACES.THUMBNAILS).toBe('thumbnails')
    expect(OPFS_NAMESPACES.VIDEOS).toBe('videos')
  })
})
