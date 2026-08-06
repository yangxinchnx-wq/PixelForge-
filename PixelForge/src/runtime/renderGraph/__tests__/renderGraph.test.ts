/**
 * RenderGraph 核心算法单测(Step 40.5)
 *
 * 覆盖:
 * - GraphValidator(单创建者 / 资源解析)
 * - topoSort(拓扑排序 + 多写入者链 + 显式依赖 + 环检测)
 * - LifetimeAnalyzer(生命周期区间 + SizeSpec 解析)
 * - TransientResourceRegistry(声明 / hint / 单创建者)
 * - TransientTexturePool / TransientBufferPool(别名 / 专用槽 / 统计)
 */

import { describe, it, expect, vi } from 'vitest'

// ============================================================================
// WebGPU 全局 stub(测试环境无 WebGPU,需手动注入 GPUTextureUsage / GPUBufferUsage)
// ============================================================================

// GPUTextureUsage 位掩码值(对齐 WebGPU 规范)
const GPU_TEXTURE_USAGE = {
  COPY_SRC: 4,
  COPY_DST: 8,
  TEXTURE_BINDING: 16,
  STORAGE_BINDING: 128,
  RENDER_ATTACHMENT: 32,
}
const GPU_BUFFER_USAGE = {
  COPY_SRC: 4,
  COPY_DST: 8,
  STORAGE: 128,
  UNIFORM: 64,
  VERTEX: 32,
  INDEX: 16,
}

;(globalThis as unknown as { GPUTextureUsage: typeof GPU_TEXTURE_USAGE }).GPUTextureUsage = GPU_TEXTURE_USAGE
;(globalThis as unknown as { GPUBufferUsage: typeof GPU_BUFFER_USAGE }).GPUBufferUsage = GPU_BUFFER_USAGE

import { GraphValidator, topoSort } from '../graphValidator'
import {
  GraphCompileError,
  CyclicDependencyError,
  UnresolvedResourceError,
  MissingCreatorError,
  DuplicateCreatorError,
} from '../graphErrors'
import { RenderGraphPass, type RenderGraphBuilder } from '../renderGraphPass'
import { TransientResourceRegistry, hintToUsageBit } from '../transient/transientResourceRegistry'
import { LifetimeAnalyzer, resolveSizeSpec } from '../transient/lifetimeAnalyzer'
import { TransientTexturePool, computeBucketKey, estimateTextureBytes } from '../transient/transientTexturePool'
import { TransientBufferPool, roundUpToPow2 } from '../transient/transientBufferPool'
import type { TextureDesc, BufferDesc } from '../transient/resourceDesc'

// ============================================================================
// 辅助:构造测试 Pass
// ============================================================================

class TestPass extends RenderGraphPass {
  constructor(
    public readonly name: string,
    private setupFn: (b: RenderGraphBuilder) => void = () => {},
  ) {
    super()
  }
  public setup(b: RenderGraphBuilder): void {
    this.setupFn(b)
  }
  public execute(): void {
    // no-op
  }
}

function makePass(name: string, reads: string[] = [], writes: string[] = [], creates: string[] = []): RenderGraphPass {
  const p = new TestPass(name)
  Object.defineProperty(p, 'reads', { value: Object.freeze([...reads]), writable: false, configurable: true })
  Object.defineProperty(p, 'writes', { value: Object.freeze([...writes]), writable: false, configurable: true })
  Object.defineProperty(p, 'creates', { value: Object.freeze([...creates]), writable: false, configurable: true })
  return p
}

// ============================================================================
// 1. GraphValidator
// ============================================================================

describe('GraphValidator', () => {
  it('V01: 单创建者通过', () => {
    const a = makePass('A', [], ['res'], ['res'])
    const b = makePass('B', ['res'], [], [])
    const v = new GraphValidator([a, b])
    expect(() => v.validateSingleCreator()).not.toThrow()
  })

  it('V02: 重复创建者抛 DuplicateCreatorError', () => {
    const a = makePass('A', [], ['res'], ['res'])
    const b = makePass('B', [], ['res'], ['res'])
    const v = new GraphValidator([a, b])
    expect(() => v.validateSingleCreator()).toThrow(DuplicateCreatorError)
  })

  it('V03: 未解析资源抛 UnresolvedResourceError', () => {
    const a = makePass('A', ['nonexistent'], [], [])
    const v = new GraphValidator([a])
    expect(() => v.validateResolvable()).toThrow(UnresolvedResourceError)
  })

  it('V04: mutator 无创建者抛 MissingCreatorError', () => {
    const a = makePass('A', [], ['res'], []) // mutator,无 creates
    const v = new GraphValidator([a])
    expect(() => v.validateResolvable()).toThrow(MissingCreatorError)
  })

  it('V05: 重复 Pass 名抛 GraphCompileError', () => {
    const a = makePass('A', [], [], [])
    const b = makePass('A', [], [], [])
    expect(() => new GraphValidator([a, b])).toThrow(GraphCompileError)
  })
})

// ============================================================================
// 2. topoSort
// ============================================================================

describe('topoSort', () => {
  it('T01: 简单线性顺序 A → B → C', () => {
    const a = makePass('A', [], ['res1'], ['res1'])
    const b = makePass('B', ['res1'], ['res2'], ['res2'])
    const c = makePass('C', ['res2'], [], [])
    const byName = new Map([['A', a], ['B', b], ['C', c]])
    const insertedOrder = (p: RenderGraphPass) => [a, b, c].indexOf(p)
    const result = topoSort([a, b, c], byName, insertedOrder)
    expect(result).toEqual(['A', 'B', 'C'])
  })

  it('T02: 无依赖 Pass 按插入顺序', () => {
    const a = makePass('A', [], [], [])
    const b = makePass('B', [], [], [])
    const c = makePass('C', [], [], [])
    const byName = new Map([['A', a], ['B', b], ['C', c]])
    const insertedOrder = (p: RenderGraphPass) => [a, b, c].indexOf(p)
    const result = topoSort([a, b, c], byName, insertedOrder)
    expect(result).toEqual(['A', 'B', 'C'])
  })

  it('T03: 多写入者按插入顺序链接', () => {
    const a = makePass('A', [], ['res'], ['res'])
    const b = makePass('B', [], ['res'], []) // mutator
    const c = makePass('C', [], ['res'], []) // mutator
    const byName = new Map([['A', a], ['B', b], ['C', c]])
    const insertedOrder = (p: RenderGraphPass) => [a, b, c].indexOf(p)
    const result = topoSort([a, b, c], byName, insertedOrder)
    expect(result).toEqual(['A', 'B', 'C'])
  })

  it('T04: 环检测抛 CyclicDependencyError', () => {
    // A 读 res1 写 res2;B 读 res2 写 res1 —— 形成 A ↔ B 环
    const a = makePass('A', ['res1'], ['res2'], ['res2'])
    const b = makePass('B', ['res2'], ['res1'], ['res1'])
    const byName = new Map([['A', a], ['B', b]])
    const insertedOrder = (p: RenderGraphPass) => [a, b].indexOf(p)
    expect(() => topoSort([a, b], byName, insertedOrder)).toThrow(CyclicDependencyError)
  })

  it('T05: 显式 dependsOn 位移 Pass 到 dep 之后', () => {
    const a = makePass('A', [], [], [])
    const b = makePass('B', [], [], [])
    const c = makePass('C', [], [], [])
    c.dependencies = new Set(['A'])
    const byName = new Map([['A', a], ['B', b], ['C', c]])
    const insertedOrder = (p: RenderGraphPass) => [a, b, c].indexOf(p)
    const result = topoSort([a, b, c], byName, insertedOrder)
    // C 依赖 A,有效顺序位移到 A 之后,排在 B 之前
    expect(result).toEqual(['A', 'C', 'B'])
  })
})

// ============================================================================
// 3. LifetimeAnalyzer + resolveSizeSpec
// ============================================================================

describe('LifetimeAnalyzer', () => {
  it('L01: resolveSizeSpec 数值原样过', () => {
    expect(resolveSizeSpec(100, 1920)).toBe(100)
    expect(resolveSizeSpec(1, 1920)).toBe(1)
  })

  it('L02: resolveSizeSpec screen token 解析', () => {
    expect(resolveSizeSpec('screen', 1920)).toBe(1920)
    expect(resolveSizeSpec('screen/2', 1920)).toBe(960)
    expect(resolveSizeSpec('screen/4', 1920)).toBe(480)
    expect(resolveSizeSpec('screen/8', 1920)).toBe(240)
  })

  it('L03: resolveSizeSpec 未知 token 抛错', () => {
    expect(() => resolveSizeSpec('unknown' as never, 1920)).toThrow()
  })

  it('L04: analyze 计算生命周期区间', () => {
    const registry = new TransientResourceRegistry()
    const desc: TextureDesc = { format: 'rgba8unorm', width: 100, height: 100 }
    registry.declareTexture('res1', desc, 'PassA')
    registry.recordAccessHint('res1', 'texture', 'sample', 'read')

    const passA = makePass('PassA', [], ['res1'], ['res1'])
    const passB = makePass('PassB', ['res1'], [], [])
    const passC = makePass('PassC', [], [], [])
    const order = ['PassA', 'PassB', 'PassC']
    const byName = new Map([['PassA', passA], ['PassB', passB], ['PassC', passC]])

    const lifetimes = LifetimeAnalyzer.analyze(order, byName, registry, [1920, 1080])
    expect(lifetimes).toHaveLength(1)
    expect(lifetimes[0].name).toBe('res1')
    expect(lifetimes[0].firstUseIdx).toBe(0) // PassA
    expect(lifetimes[0].lastUseIdx).toBe(1) // PassB
    expect(lifetimes[0].resolvedWidth).toBe(100)
    expect(lifetimes[0].resolvedHeight).toBe(100)
  })

  it('L05: analyze 孤儿声明警告且跳过', () => {
    const registry = new TransientResourceRegistry()
    const desc: TextureDesc = { format: 'rgba8unorm', width: 100, height: 100 }
    registry.declareTexture('orphan', desc, 'PassA')

    const passA = makePass('PassA', [], [], [])
    const order = ['PassA']
    const byName = new Map([['PassA', passA]])

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const lifetimes = LifetimeAnalyzer.analyze(order, byName, registry, [1920, 1080])
    expect(lifetimes).toHaveLength(0)
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})

// ============================================================================
// 4. TransientResourceRegistry
// ============================================================================

describe('TransientResourceRegistry', () => {
  it('R01: declareTexture 注册成功', () => {
    const reg = new TransientResourceRegistry()
    const desc: TextureDesc = { format: 'rgba8unorm', width: 100, height: 100 }
    reg.declareTexture('res', desc, 'PassA')
    expect(reg.has('res')).toBe(true)
    expect(reg.get('res')?.kind).toBe('texture')
    expect(reg.get('res')?.persistent).toBe(false)
  })

  it('R02: declareBuffer 注册成功', () => {
    const reg = new TransientResourceRegistry()
    const desc: BufferDesc = { size: 1024, usage: GPUBufferUsage.STORAGE }
    reg.declareBuffer('res', desc, 'PassA')
    expect(reg.has('res')).toBe(true)
    expect(reg.get('res')?.kind).toBe('buffer')
  })

  it('R03: 重复声明抛错', () => {
    const reg = new TransientResourceRegistry()
    const desc: TextureDesc = { format: 'rgba8unorm', width: 100, height: 100 }
    reg.declareTexture('res', desc, 'PassA')
    expect(() => reg.declareTexture('res', desc, 'PassB')).toThrow()
  })

  it('R04: recordAccessHint 合并 usage bit', () => {
    const reg = new TransientResourceRegistry()
    const desc: TextureDesc = { format: 'rgba8unorm', width: 100, height: 100, usage: 'auto' }
    reg.declareTexture('res', desc, 'PassA')
    reg.recordAccessHint('res', 'texture', 'sample', 'read')
    reg.recordAccessHint('res', 'texture', 'storage', 'write')
    const usage = reg.hintUsageOf('res')
    // sample → TEXTURE_BINDING, storage → STORAGE_BINDING, 两者都加 COPY_SRC | COPY_DST
    expect(usage & GPUTextureUsage.TEXTURE_BINDING).toBeTruthy()
    expect(usage & GPUTextureUsage.STORAGE_BINDING).toBeTruthy()
    expect(usage & GPUTextureUsage.COPY_SRC).toBeTruthy()
    expect(usage & GPUTextureUsage.COPY_DST).toBeTruthy()
  })

  it('R05: hintToUsageBit texture 各 hint 正确', () => {
    expect(hintToUsageBit('texture', 'sample', 'read') & GPUTextureUsage.TEXTURE_BINDING).toBeTruthy()
    expect(hintToUsageBit('texture', 'storage', 'write') & GPUTextureUsage.STORAGE_BINDING).toBeTruthy()
    expect(hintToUsageBit('texture', 'attachment', 'write') & GPUTextureUsage.RENDER_ATTACHMENT).toBeTruthy()
  })

  it('R06: unregister 清除声明', () => {
    const reg = new TransientResourceRegistry()
    const desc: TextureDesc = { format: 'rgba8unorm', width: 100, height: 100 }
    reg.declareTexture('res', desc, 'PassA')
    reg.unregister('res')
    expect(reg.has('res')).toBe(false)
  })
})

// ============================================================================
// 5. TransientTexturePool
// ============================================================================

describe('TransientTexturePool', () => {
  // mock GPUTexture
  function mockTexture(label?: string): GPUTexture {
    return {
      label: label ?? 'mock',
      createView: () => ({}) as GPUTextureView,
      destroy: () => {},
    } as unknown as GPUTexture
  }

  it('P01: computeBucketKey 包含 format / size / sample / layer / mip / usage', () => {
    const desc: TextureDesc = { format: 'rgba8unorm', width: 100, height: 100 }
    const key = computeBucketKey(desc, 100, 100, 0)
    expect(key).toContain('rgba8unorm')
    expect(key).toContain('100x100')
    expect(key).toContain('s0')
    expect(key).toContain('l1')
    expect(key).toContain('m1')
    expect(key).toContain('u0')
  })

  it('P02: estimateTextureBytes rgba8unorm 100x100 = 40000', () => {
    const desc: TextureDesc = { format: 'rgba8unorm', width: 100, height: 100 }
    expect(estimateTextureBytes(desc, 100, 100)).toBe(40000)
  })

  it('P03: assign 分配新槽位(无复用)', () => {
    const created: GPUTexture[] = []
    const pool = new TransientTexturePool({
      createGpuTexture: () => {
        const t = mockTexture('new')
        created.push(t)
        return t
      },
    })
    const lifetimes = [
      {
        name: 'res1',
        kind: 'texture' as const,
        desc: { format: 'rgba8unorm', width: 100, height: 100 } as TextureDesc,
        firstUseIdx: 0,
        lastUseIdx: 1,
        resolvedUsage: GPUTextureUsage.TEXTURE_BINDING,
        resolvedWidth: 100,
        resolvedHeight: 100,
        persistent: false,
      },
    ]
    const { bindings, debug } = pool.assign(lifetimes)
    expect(bindings.size).toBe(1)
    expect(bindings.has('res1')).toBe(true)
    expect(debug.get('res1')?.aliased).toBe(false)
    expect(debug.get('res1')?.dedicated).toBe(false)
    expect(created).toHaveLength(1)
  })

  it('P04: assign 别名复用 disjoint 生命周期', () => {
    let createCount = 0
    const pool = new TransientTexturePool({
      createGpuTexture: () => {
        createCount++
        return mockTexture('new')
      },
    })
    // res1 用 [0,1],res2 用 [2,3] —— disjoint,同 bucket,应别名复用
    const desc = { format: 'rgba8unorm', width: 100, height: 100 } as TextureDesc
    const lifetimes = [
      {
        name: 'res1',
        kind: 'texture' as const,
        desc,
        firstUseIdx: 0,
        lastUseIdx: 1,
        resolvedUsage: GPUTextureUsage.TEXTURE_BINDING,
        resolvedWidth: 100,
        resolvedHeight: 100,
        persistent: false,
      },
      {
        name: 'res2',
        kind: 'texture' as const,
        desc,
        firstUseIdx: 2,
        lastUseIdx: 3,
        resolvedUsage: GPUTextureUsage.TEXTURE_BINDING,
        resolvedWidth: 100,
        resolvedHeight: 100,
        persistent: false,
      },
    ]
    const { bindings, debug } = pool.assign(lifetimes)
    expect(bindings.size).toBe(2)
    expect(createCount).toBe(1) // 只分配一次,res2 别名复用 res1 的槽位
    expect(debug.get('res2')?.aliased).toBe(true)
  })

  it('P05: aliasable: false 走专用槽', () => {
    const pool = new TransientTexturePool({
      createGpuTexture: () => mockTexture('dedicated'),
    })
    const desc = {
      format: 'rgba8unorm',
      width: 100,
      height: 100,
      aliasable: false,
    } as TextureDesc
    const lifetimes = [
      {
        name: 'dedicated',
        kind: 'texture' as const,
        desc,
        firstUseIdx: 0,
        lastUseIdx: 1,
        resolvedUsage: GPUTextureUsage.TEXTURE_BINDING,
        resolvedWidth: 100,
        resolvedHeight: 100,
        persistent: false,
      },
    ]
    const { debug } = pool.assign(lifetimes)
    expect(debug.get('dedicated')?.dedicated).toBe(true)
  })

  it('P06: dispose 清空所有槽位', () => {
    const pool = new TransientTexturePool({
      createGpuTexture: () => mockTexture(),
    })
    const desc = { format: 'rgba8unorm', width: 100, height: 100 } as TextureDesc
    pool.assign([
      {
        name: 'res1',
        kind: 'texture',
        desc,
        firstUseIdx: 0,
        lastUseIdx: 0,
        resolvedUsage: GPUTextureUsage.TEXTURE_BINDING,
        resolvedWidth: 100,
        resolvedHeight: 100,
        persistent: false,
      },
    ])
    expect(pool.stats().slotCount).toBe(1)
    pool.dispose()
    expect(pool.stats().slotCount).toBe(0)
    expect(pool.stats().currentBytes).toBe(0)
  })
})

// ============================================================================
// 6. TransientBufferPool
// ============================================================================

describe('TransientBufferPool', () => {
  function mockBuffer(label?: string): GPUBuffer {
    return {
      label: label ?? 'mock',
      size: 1024,
      usage: GPUBufferUsage.STORAGE,
      destroy: () => {},
    } as unknown as GPUBuffer
  }

  it('B01: roundUpToPow2 向上取整', () => {
    expect(roundUpToPow2(1)).toBe(1)
    expect(roundUpToPow2(2)).toBe(2)
    expect(roundUpToPow2(3)).toBe(4)
    expect(roundUpToPow2(100)).toBe(128)
    expect(roundUpToPow2(1024)).toBe(1024)
  })

  it('B02: assign 分配新 buffer 槽位', () => {
    let createCount = 0
    const pool = new TransientBufferPool({
      createGpuBuffer: () => {
        createCount++
        return mockBuffer()
      },
    })
    const desc = { size: 1024, usage: GPUBufferUsage.STORAGE }
    const lifetimes = [
      {
        name: 'buf1',
        kind: 'buffer' as const,
        desc,
        firstUseIdx: 0,
        lastUseIdx: 0,
        resolvedUsage: GPUBufferUsage.STORAGE,
        resolvedSize: 1024,
        persistent: false,
      },
    ]
    const { bindings } = pool.assign(lifetimes)
    expect(bindings.size).toBe(1)
    expect(createCount).toBe(1)
  })

  it('B03: assign 别名复用 disjoint buffer 生命周期', () => {
    let createCount = 0
    const pool = new TransientBufferPool({
      createGpuBuffer: () => {
        createCount++
        return mockBuffer()
      },
    })
    const desc = { size: 1024, usage: GPUBufferUsage.STORAGE }
    const lifetimes = [
      {
        name: 'buf1',
        kind: 'buffer' as const,
        desc,
        firstUseIdx: 0,
        lastUseIdx: 1,
        resolvedUsage: GPUBufferUsage.STORAGE,
        resolvedSize: 1024,
        persistent: false,
      },
      {
        name: 'buf2',
        kind: 'buffer' as const,
        desc,
        firstUseIdx: 2,
        lastUseIdx: 3,
        resolvedUsage: GPUBufferUsage.STORAGE,
        resolvedSize: 1024,
        persistent: false,
      },
    ]
    const { bindings, debug } = pool.assign(lifetimes)
    expect(bindings.size).toBe(2)
    expect(createCount).toBe(1)
    expect(debug.get('buf2')?.aliased).toBe(true)
  })
})

// ============================================================================
// 7. RenderGraph 主类(集成测试)
// ============================================================================

describe('RenderGraph 集成', () => {
  // 注:RenderGraph 主类测试需要 GPU 注入,这里仅做编译流程验证(无 GPU 调用)
  it('G01: 可构造', async () => {
    const { RenderGraph } = await import('../renderGraph')
    const graph = new RenderGraph({ canvasWidth: 1920, canvasHeight: 1080 })
    expect(graph.canvasWidth).toBe(1920)
    expect(graph.canvasHeight).toBe(1080)
    graph.destroy()
  })

  it('G02: setCanvasSize 标记 dirty', async () => {
    const { RenderGraph } = await import('../renderGraph')
    const graph = new RenderGraph({ canvasWidth: 1920, canvasHeight: 1080 })
    graph.setCanvasSize(1280, 720)
    expect(graph.canvasWidth).toBe(1280)
    expect(graph.canvasHeight).toBe(720)
    graph.destroy()
  })
})
