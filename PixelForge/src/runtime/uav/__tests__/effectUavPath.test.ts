/**
 * UAV Split 接入真实渲染管线的「通路」测试。
 *
 * 目标：验证 Gigi 风格的纹理读写分离已被真正接入 PixelForge 的效果后处理
 * 渲染路径，且逐帧可用。覆盖三条关键链路：
 *   1. applyUavSplit 对真实 effect_post.wgsl 的端到端改写 + 执行
 *   2. prepareEffectUavSplit（evaluator 实际调用的接入层）产出带显式 @binding
 *      的改写着色器，并创建只读副本纹理
 *   3. recordUavCopy 将「输出纹理 → 只读副本」的复制录制进效果 command encoder
 *   4. 端到端：createRegionEvaluator(...).render(含效果工件) 实际编译拆分后的
 *      着色器、在效果绑定组中引用只读副本(binding 5)、并在效果 encoder 录制复制
 *
 * 全程不依赖真实 GPU（headless），通过 mock backend + fake device 验证行为契约。
 */

import { describe, it, expect, beforeAll, vi } from 'vitest'
import effectShaderSource from '@/shaders/effect_post.wgsl?raw'
import { applyUavSplit } from '../textureSplitExecutor'
import { prepareEffectUavSplit, EFFECT_READ_ONLY_BINDING } from '../integration'
import { recordUavCopy } from '../gpuBackend'
import { createRegionEvaluator } from '@/compiler/region/evaluator'
import type { RuntimeDeviceHandle, RuntimeTextureBundle } from '@/runtime/types'
import type { CompileContext } from '@/compiler/context'
import type { RegionCompileArtifact } from '@/compiler/region/regionCompiler'

// WebGPU 全局在 node 测试环境未定义，GpuUavSplitBackend.createReadOnlyTexture 会
// 用到 GPUTextureUsage，这里在测试运行前补齐最小常量集合。
beforeAll(() => {
  ;(globalThis as unknown as { GPUTextureUsage: Record<string, number> }).GPUTextureUsage = {
    COPY_SRC: 0x01,
    COPY_DST: 0x02,
    TEXTURE_BINDING: 0x04,
    STORAGE_BINDING: 0x08,
    RENDER_ATTACHMENT: 0x10,
  }
})

// ─── Mock GPU Backend（复用 UAV 模块测试中的形态）───

class MockUavBackend {
  created: Array<{ label: string; format: string; width: number; height: number }> = []
  copies: Array<{ from: unknown; to: unknown }> = []
  destroyed: unknown[] = []
  private nextId = 0

  createReadOnlyTexture(desc: { width: number; height: number; format: string; label: string }): unknown {
    const handle = `tex_${this.nextId++}`
    this.created.push({ label: desc.label, format: desc.format, width: desc.width, height: desc.height })
    return handle
  }
  copyTextureToTexture(source: unknown, destination: unknown): void {
    this.copies.push({ from: source, to: destination })
  }
  destroyTexture(handle: unknown): void {
    this.destroyed.push(handle)
  }
}

// ─── 1. applyUavSplit 对真实 effect_post.wgsl 的端到端改写 ───

describe('UAV 接入效果后处理：applyUavSplit 真实着色器', () => {
  it('UAV-EP01: 改写真实 effect_post.wgsl（read_write→write+只读副本+读重定向）', () => {
    const shaders = [{ name: 'effect_post', pass: 'effect', code: effectShaderSource }]
    const sourceTextures = new Map<string, { handle: unknown; size: { width: number; height: number } }>([
      ['outputTex', { handle: 'output_gpu', size: { width: 1920, height: 1080 } }],
    ])
    const backend = new MockUavBackend()

    const { modifiedShaders, plans, results } = applyUavSplit(shaders, sourceTextures, backend as never)

    // 1 个拆分方案（rgba8unorm 不支持 read_write 存储）
    expect(plans).toHaveLength(1)
    expect(plans[0].originalTexture).toBe('outputTex')
    expect(plans[0].readOnlyCopy).toBe('outputTex_readOnly')

    const out = modifiedShaders.get('effect_post')!
    expect(out).toBeDefined()
    // 不再有 read_write 存储纹理声明（注释中的文字除外）
    expect(out).not.toContain('texture_storage_2d<rgba8unorm, read_write>')
    // 原纹理变只写
    expect(out).toContain('var outputTex : texture_storage_2d<rgba8unorm, write>')
    // 插入只读副本声明
    expect(out).toContain('var outputTex_readOnly : texture_storage_2d<rgba8unorm, read>;')
    // 读取重定向到只读副本（原 shader 的两处 textureLoad）
    expect(out).toContain('textureLoad(outputTex_readOnly, pixelCoord)')
    expect(out).toContain('textureLoad(outputTex_readOnly, sampleCoord)')
    // 写入保持原纹理
    expect(out).toContain('textureStore(outputTex, pixelCoord, color)')

    // 执行：创建只读副本 + 记录一次复制
    expect(results).toHaveLength(1)
    expect(backend.created).toHaveLength(1)
    expect(backend.created[0].label).toBe('outputTex_readOnly')
    expect(backend.copies).toHaveLength(1)
    expect(backend.copies[0]).toEqual({ from: 'output_gpu', to: results[0].readOnlyTexture })
  })
})

// ─── 2. prepareEffectUavSplit（evaluator 接入层）───

describe('UAV 接入效果后处理：prepareEffectUavSplit 接入层', () => {
  it('UAV-EP02: 产出带显式 @binding 的改写着色器并创建只读副本', () => {
    const output: RuntimeTextureBundle = {
      texture: {} as GPUTexture,
      view: {} as GPUTextureView,
      size: { width: 640, height: 360 },
      format: 'rgba8unorm',
    }
    const backend = new MockUavBackend()

    const result = prepareEffectUavSplit(effectShaderSource, output, backend as never)

    expect(result).not.toBeNull()
    const code = result!.effectShaderCode
    // 为只读副本注入了显式绑定（layout:'auto' 必须），绑定槽为约定值 5
    expect(result!.readOnlyBinding).toBe(EFFECT_READ_ONLY_BINDING)
    expect(code).toContain(`@group(0) @binding(${EFFECT_READ_ONLY_BINDING}) var outputTex_readOnly : texture_storage_2d<rgba8unorm, read>;`)
    // 原着色器无 read_write 存储纹理声明，读取重定向到副本
    expect(code).not.toContain('texture_storage_2d<rgba8unorm, read_write>')
    expect(code).toContain('textureLoad(outputTex_readOnly, pixelCoord)')
    expect(code).toContain('textureStore(outputTex, pixelCoord, color)')
    // 只读副本纹理已创建
    expect(backend.created).toHaveLength(1)
    expect(backend.created[0]).toMatchObject({ label: 'outputTex_readOnly', format: 'rgba8unorm', width: 640, height: 360 })
  })

  it('UAV-EP03: 无 read_write 的着色器返回 null（不拆分）', () => {
    const plain = `@group(0) @binding(1) var outTex : texture_storage_2d<r32float, read_write>;`
    const output: RuntimeTextureBundle = {
      texture: {} as GPUTexture,
      view: {} as GPUTextureView,
      size: { width: 4, height: 4 },
      format: 'r32float',
    }
    const backend = new MockUavBackend()
    expect(prepareEffectUavSplit(plain, output, backend as never)).toBeNull()
  })
})

// ─── 3. recordUavCopy 录制进 effect encoder ───

describe('UAV 接入效果后处理：recordUavCopy 逐帧复制', () => {
  it('UAV-EP04: 将复制命令录制进给定 command encoder', () => {
    const copyCalls: Array<unknown> = []
    const fakeEncoder = {
      copyTextureToTexture: vi.fn((src: unknown, dst: unknown) => copyCalls.push([src, dst])),
    } as unknown as GPUCommandEncoder

    const src = { width: 8, height: 8, depthOrArrayLayers: 1 } as GPUTexture
    const dst = { width: 8, height: 8, depthOrArrayLayers: 1 } as GPUTexture

    recordUavCopy(fakeEncoder, src, dst)

    expect(copyCalls).toHaveLength(1)
    const [recordedSrc, recordedDst] = copyCalls[0] as Array<{ texture: GPUTexture }>
    expect(recordedSrc.texture).toBe(src)
    expect(recordedDst.texture).toBe(dst)
  })
})

// ─── 4. 端到端：通过真实 evaluator + 含效果工件 渲染 ───

describe('UAV 接入效果后处理：evaluator 渲染通路', () => {
  it('UAV-EP05: render(含效果) 编译拆分着色器、绑定只读副本、录制复制', () => {
    const shaderModules: string[] = []
    const bindGroups: GPUBindGroupEntry[][] = []
    const encoders: Array<{ copyTextureToTexture: ReturnType<typeof vi.fn> }> = []
    const createdTextures: unknown[] = []

    const makeFakeTexture = (w: number, h: number): GPUTexture => {
      const t = { width: w, height: h, depthOrArrayLayers: 1, createView: () => ({}), destroy: vi.fn() }
      createdTextures.push(t)
      return t as unknown as GPUTexture
    }

    const fakeDevice = {
      queue: {
        submit: vi.fn(),
        writeBuffer: vi.fn(),
        writeTexture: vi.fn(),
        onSubmittedWorkDone: vi.fn(),
      },
      createTexture: vi.fn((desc: { size: number[] | { width: number; height: number; depthOrArrayLayers?: number } }) => {
        const size = Array.isArray(desc.size)
          ? { width: desc.size[0], height: desc.size[1], depthOrArrayLayers: desc.size[2] ?? 1 }
          : { width: desc.size.width, height: desc.size.height, depthOrArrayLayers: desc.size.depthOrArrayLayers ?? 1 }
        return makeFakeTexture(size.width, size.height)
      }),
      createBuffer: vi.fn(() => ({ destroy: vi.fn() })),
      createShaderModule: vi.fn((desc: { code: string }) => {
        shaderModules.push(desc.code)
        return { getBindGroupLayout: () => ({}) }
      }),
      createComputePipeline: vi.fn(() => ({ getBindGroupLayout: () => ({}) })),
      createBindGroup: vi.fn((desc: { entries: GPUBindGroupEntry[] }) => {
        bindGroups.push(desc.entries)
        return {}
      }),
      createCommandEncoder: vi.fn(() => {
        const enc = {
          beginComputePass: vi.fn(() => ({ setPipeline: vi.fn(), setBindGroup: vi.fn(), dispatchWorkgroups: vi.fn(), end: vi.fn() })),
          copyTextureToTexture: vi.fn(),
          finish: vi.fn(() => ({})),
        }
        encoders.push(enc)
        return enc
      }),
    } as unknown as RuntimeDeviceHandle

    const output: RuntimeTextureBundle = {
      texture: makeFakeTexture(8, 8),
      view: {} as GPUTextureView,
      size: { width: 8, height: 8 },
      format: 'rgba8unorm',
    }

    const context = {
      canvasSize: { width: 8, height: 8 },
      seed: 1,
      capability: {},
    } as unknown as CompileContext

    const artifact = {
      schemaVersion: 'region-artifact-v2',
      descriptorData: new Uint32Array([0, 0]),
      auxData: new Float32Array([0, 0, 0, 0]),
      regionData: new Float32Array([0, 0, 0, 0]),
      effectDescData: new Uint32Array([1, 0, 0xffff]),
      effectParamData: new Float32Array([0.5, 0, 0, 0]),
      layerId: 'l0',
      opcode: 'SOLID_COLOR',
      layers: [],
      regions: [],
      effects: [
        {
          effectId: 'e0',
          type: 'blur',
          typeId: 0,
          targetLayer: null,
          targetRegion: null,
          paramData: new Float32Array([0.5, 0, 0, 0]),
          paramIndex: 0,
          descriptorEntry: [0, 0xffff] as [number, number],
        },
      ],
      visibleLayerCount: 1,
      hasEffects: true,
    } as unknown as RegionCompileArtifact

    const evaluator = createRegionEvaluator(fakeDevice, context, output)
    evaluator.render(artifact)

    // (a) 编译出的效果着色器包含只读副本、且不再包含 read_write
    const effectModule = shaderModules.find((c) => c.includes('@group(0) @binding(5) var outputTex_readOnly'))
    expect(effectModule).toBeDefined()
    expect(effectModule).not.toContain('texture_storage_2d<rgba8unorm, read_write>')
    expect(effectModule).toContain('textureLoad(outputTex_readOnly, pixelCoord)')
    expect(effectModule).toContain('textureStore(outputTex, pixelCoord, color)')

    // (b) 效果绑定组引用只读副本（binding 5），且不含材质槽 binding 6（区别于图层绑定组）
    const effectBindGroup = bindGroups.find(
      (entries) => entries.some((e) => e.binding === 5) && !entries.some((e) => e.binding === 6),
    )
    expect(effectBindGroup).toBeDefined()
    expect(effectBindGroup!.find((e) => e.binding === 5)).toBeDefined()

    // (c) 至少一个 encoder 录制了「输出纹理 → 只读副本」的复制（逐帧刷新）
    const copyEncoder = encoders.find((e) => e.copyTextureToTexture.mock.calls.length > 0)
    expect(copyEncoder).toBeDefined()
    const copyCall = copyEncoder!.copyTextureToTexture.mock.calls[0] as Array<{ texture: GPUTexture }>
    expect(copyCall[0].texture).toBe(output.texture)
  })
})
