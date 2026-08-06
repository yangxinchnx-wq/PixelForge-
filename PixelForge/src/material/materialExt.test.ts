/**
 * Material Module 扩展测试 — 新增功能的单元测试。
 *
 * 覆盖:
 * - WV: wgslValidator(语法预校验)
 * - CF: compiler fusion(融合链编译)
 * - RT: runtime(GPU 设备丢失 / 校验集成)
 * - MV: materialValidator(像素分析 / 问题检测)
 */

import { describe, it, expect } from 'vitest'
import type { MaterialGraph } from './types'
import { DEFAULT_MATERIAL_CANVAS } from './types'
import { createNodeFromTemplate } from './shaderRegistry'
import { compileMaterialGraph } from './compiler'
import { validateWGSL } from './wgslValidator'
import { analyzePixels, detectIssues } from './materialValidator'
import type { PixelStats } from './materialValidator'

// ============================================================================
// 辅助
// ============================================================================

function makeNode(id: string, templateKey: string) {
  return createNodeFromTemplate(templateKey, id, { x: 0, y: 0 })
}

// ============================================================================
// WV: WGSL Validator
// ============================================================================

describe('WV: WGSL Validator', () => {
  it('WV1: 合法 WGSL 通过校验', () => {
    const wgsl = `
struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

@fragment fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    let color: vec4<f32> = vec4<f32>(1.0, 0.0, 0.0, 1.0);
    return color;
}
`
    const result = validateWGSL(wgsl, 'fs_main')
    expect(result.valid).toBe(true)
    expect(result.errors.length).toBe(0)
  })

  it('WV2: 括号不匹配被检测', () => {
    const wgsl = `
@fragment fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    let color: vec4<f32> = vec4<f32>(1.0, 0.0, 0.0, 1.0;
    return color;
}
`
    const result = validateWGSL(wgsl, 'fs_main')
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.rule === 'V1')).toBe(true)
  })

  it('WV3: 缺少入口函数被检测', () => {
    const wgsl = `
@fragment fn wrong_name(input: VertexOutput) -> @location(0) vec4<f32> {
    return vec4<f32>(1.0);
}
`
    const result = validateWGSL(wgsl, 'fs_main')
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.rule === 'V3')).toBe(true)
  })

  it('WV4: return 缺少分号被检测', () => {
    const wgsl = `
@fragment fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    let color: vec4<f32> = vec4<f32>(1.0, 0.0, 0.0, 1.0);
    return color
}
`
    const result = validateWGSL(wgsl, 'fs_main')
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.rule === 'V2')).toBe(true)
  })

  it('WV5: 缺少 return 语句被检测', () => {
    const wgsl = `
@fragment fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    let color: vec4<f32> = vec4<f32>(1.0, 0.0, 0.0, 1.0);
}
`
    const result = validateWGSL(wgsl, 'fs_main')
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.rule === 'V8')).toBe(true)
  })

  it('WV6: @binding 缺少数字被检测', () => {
    const wgsl = `
@group(0) @binding var tex: texture_2d<f32>;

@fragment fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    return vec4<f32>(1.0);
}
`
    const result = validateWGSL(wgsl, 'fs_main')
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.rule === 'V9')).toBe(true)
  })

  it('WV7: 编译器生成的 WGSL 通过校验(简单图)', () => {
    const graph: MaterialGraph = {
      nodes: [makeNode('c1', 'color')!, makeNode('out1', 'output')!],
      edges: [{ id: 'e1', from: 'c1', fromPort: 'color', to: 'out1', toPort: 'color' }],
      canvas: { ...DEFAULT_MATERIAL_CANVAS },
    }
    const result = compileMaterialGraph(graph)
    const validation = validateWGSL(result.wgsl, result.entryPoint)
    expect(validation.valid).toBe(true)
    expect(validation.errors.length).toBe(0)
  })

  it('WV8: 编译器生成的 WGSL 通过校验(含纹理)', () => {
    const graph: MaterialGraph = {
      nodes: [
        makeNode('uv1', 'uv')!,
        makeNode('tex1', 'texture')!,
        makeNode('out1', 'output')!,
      ],
      edges: [
        { id: 'e1', from: 'uv1', fromPort: 'uv', to: 'tex1', toPort: 'uv' },
        { id: 'e2', from: 'tex1', fromPort: 'color', to: 'out1', toPort: 'color' },
      ],
      canvas: { ...DEFAULT_MATERIAL_CANVAS },
    }
    const result = compileMaterialGraph(graph)
    const validation = validateWGSL(result.wgsl, result.entryPoint)
    expect(validation.valid).toBe(true)
  })

  it('WV9: 编译器生成的 WGSL 通过校验(含 helper function)', () => {
    const graph: MaterialGraph = {
      nodes: [
        makeNode('uv1', 'uv')!,
        makeNode('fbm1', 'fbm')!,
        makeNode('out1', 'output')!,
      ],
      edges: [{ id: 'e1', from: 'uv1', fromPort: 'uv', to: 'fbm1', toPort: 'uv' }],
      canvas: { ...DEFAULT_MATERIAL_CANVAS },
    }
    const result = compileMaterialGraph(graph)
    const validation = validateWGSL(result.wgsl, result.entryPoint)
    expect(validation.valid).toBe(true)
  })

  it('WV10: 空字符串校验失败', () => {
    const result = validateWGSL('', 'fs_main')
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.rule === 'V3')).toBe(true)
  })

  it('WV11: 注释行不干扰校验', () => {
    const wgsl = `
// This is a comment
// Another comment

@fragment fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    // inline comment
    let color: vec4<f32> = vec4<f32>(1.0, 0.0, 0.0, 1.0);
    return color;
}
`
    const result = validateWGSL(wgsl, 'fs_main')
    expect(result.valid).toBe(true)
  })
})

// ============================================================================
// CF: Compiler Fusion
// ============================================================================

describe('CF: Compiler Fusion', () => {
  it('CF1: 两个连续 color_correct 被融合', () => {
    const graph: MaterialGraph = {
      nodes: [
        makeNode('c1', 'color')!,
        makeNode('cc1', 'color_correct')!,
        makeNode('cc2', 'color_correct')!,
        makeNode('out1', 'output')!,
      ],
      edges: [
        { id: 'e1', from: 'c1', fromPort: 'color', to: 'cc1', toPort: 'color' },
        { id: 'e2', from: 'cc1', fromPort: 'result', to: 'cc2', toPort: 'color' },
        { id: 'e3', from: 'cc2', fromPort: 'result', to: 'out1', toPort: 'color' },
      ],
      canvas: { ...DEFAULT_MATERIAL_CANVAS },
    }
    const result = compileMaterialGraph(graph)
    // 应包含 Fused chain 标记
    expect(result.wgsl).toContain('Fused chain')
    // 应只生成一个 let 语句（而非两个独立的）
    // 统计 pf_color_correct 调用次数（排除函数定义 fn pf_color_correct）
    const allMatches = result.wgsl.match(/pf_color_correct\(/g) || []
    const defMatches = result.wgsl.match(/fn pf_color_correct\(/g) || []
    const ccCalls = allMatches.length - defMatches.length
    expect(ccCalls).toBe(2) // 两个嵌套调用
    // 应包含嵌套调用（一个 let 里有两个 pf_color_correct）
    expect(result.wgsl).toContain('pf_color_correct(pf_color_correct(')
  })

  it('CF2: 三个连续 color_correct 被融合为三层嵌套', () => {
    const graph: MaterialGraph = {
      nodes: [
        makeNode('c1', 'color')!,
        makeNode('cc1', 'color_correct')!,
        makeNode('cc2', 'color_correct')!,
        makeNode('cc3', 'color_correct')!,
        makeNode('out1', 'output')!,
      ],
      edges: [
        { id: 'e1', from: 'c1', fromPort: 'color', to: 'cc1', toPort: 'color' },
        { id: 'e2', from: 'cc1', fromPort: 'result', to: 'cc2', toPort: 'color' },
        { id: 'e3', from: 'cc2', fromPort: 'result', to: 'cc3', toPort: 'color' },
        { id: 'e4', from: 'cc3', fromPort: 'result', to: 'out1', toPort: 'color' },
      ],
      canvas: { ...DEFAULT_MATERIAL_CANVAS },
    }
    const result = compileMaterialGraph(graph)
    expect(result.wgsl).toContain('Fused chain')
    const allMatches = result.wgsl.match(/pf_color_correct\(/g) || []
    const defMatches = result.wgsl.match(/fn pf_color_correct\(/g) || []
    const ccCalls = allMatches.length - defMatches.length
    expect(ccCalls).toBe(3)
    // 应有三层嵌套
    expect(result.wgsl).toContain('pf_color_correct(pf_color_correct(pf_color_correct(')
  })

  it('CF3: 融合后的 WGSL 通过语法校验', () => {
    const graph: MaterialGraph = {
      nodes: [
        makeNode('c1', 'color')!,
        makeNode('cc1', 'color_correct')!,
        makeNode('cc2', 'color_correct')!,
        makeNode('out1', 'output')!,
      ],
      edges: [
        { id: 'e1', from: 'c1', fromPort: 'color', to: 'cc1', toPort: 'color' },
        { id: 'e2', from: 'cc1', fromPort: 'result', to: 'cc2', toPort: 'color' },
        { id: 'e3', from: 'cc2', fromPort: 'result', to: 'out1', toPort: 'color' },
      ],
      canvas: { ...DEFAULT_MATERIAL_CANVAS },
    }
    const result = compileMaterialGraph(graph)
    const validation = validateWGSL(result.wgsl, result.entryPoint)
    expect(validation.valid).toBe(true)
  })

  it('CF4: 无融合链时正常编译（回退路径）', () => {
    const graph: MaterialGraph = {
      nodes: [
        makeNode('c1', 'color')!,
        makeNode('cc1', 'color_correct')!,  // 单个，不形成链
        makeNode('out1', 'output')!,
      ],
      edges: [
        { id: 'e1', from: 'c1', fromPort: 'color', to: 'cc1', toPort: 'color' },
        { id: 'e2', from: 'cc1', fromPort: 'result', to: 'out1', toPort: 'color' },
      ],
      canvas: { ...DEFAULT_MATERIAL_CANVAS },
    }
    const result = compileMaterialGraph(graph)
    expect(result.wgsl).not.toContain('Fused chain')
    expect(result.wgsl).toContain('pf_color_correct(')
    const allMatches = result.wgsl.match(/pf_color_correct\(/g) || []
    const defMatches = result.wgsl.match(/fn pf_color_correct\(/g) || []
    const ccCalls = allMatches.length - defMatches.length
    expect(ccCalls).toBe(1)
  })

  it('CF5: 融合后的变量名正确（下游引用链尾变量）', () => {
    const graph: MaterialGraph = {
      nodes: [
        makeNode('c1', 'color')!,
        makeNode('cc1', 'color_correct')!,
        makeNode('cc2', 'color_correct')!,
        makeNode('out1', 'output')!,
      ],
      edges: [
        { id: 'e1', from: 'c1', fromPort: 'color', to: 'cc1', toPort: 'color' },
        { id: 'e2', from: 'cc1', fromPort: 'result', to: 'cc2', toPort: 'color' },
        { id: 'e3', from: 'cc2', fromPort: 'result', to: 'out1', toPort: 'color' },
      ],
      canvas: { ...DEFAULT_MATERIAL_CANVAS },
    }
    const result = compileMaterialGraph(graph)
    // OUTPUT 节点应该引用 cc2（链尾）的输出变量
    // cc2 的输出端口是 'result'，变量名应是 'result_N'
    // OUTPUT 的 return 语句中应包含 result_N（不是 cc1 的）
    expect(result.wgsl).toContain('return')
    // 确保不是返回未定义变量
    expect(result.wgsl).not.toContain('return result_0;') // cc1 的变量名不应出现在 return 中
  })

  it('CF6: compiledNodeCount 包含所有节点（含被内联的）', () => {
    const graph: MaterialGraph = {
      nodes: [
        makeNode('c1', 'color')!,
        makeNode('cc1', 'color_correct')!,
        makeNode('cc2', 'color_correct')!,
        makeNode('cc3', 'color_correct')!,
        makeNode('out1', 'output')!,
      ],
      edges: [
        { id: 'e1', from: 'c1', fromPort: 'color', to: 'cc1', toPort: 'color' },
        { id: 'e2', from: 'cc1', fromPort: 'result', to: 'cc2', toPort: 'color' },
        { id: 'e3', from: 'cc2', fromPort: 'result', to: 'cc3', toPort: 'color' },
        { id: 'e4', from: 'cc3', fromPort: 'result', to: 'out1', toPort: 'color' },
      ],
      canvas: { ...DEFAULT_MATERIAL_CANVAS },
    }
    const result = compileMaterialGraph(graph)
    expect(result.compiledNodeCount).toBe(5) // color + 3x cc + output
  })
})

// ============================================================================
// RT: Runtime (GPU 设备丢失检测)
// ============================================================================

describe('RT: MaterialRuntime Device Lost', () => {
  it('RT1: isDeviceLost 初始为 false', async () => {
    const { MaterialRuntime } = await import('./runtime')
    // 创建 mock device
    const mockDevice = {
      lost: new Promise(() => {}), // 永不 resolve
      createShaderModule: () => ({}),
      createRenderPipeline: () => ({}),
      createCommandEncoder: () => ({}),
      createBindGroup: () => ({}),
      queue: { submit: () => {} },
    } as unknown as GPUDevice

    const runtime = new MaterialRuntime({ device: mockDevice, format: 'bgra8unorm', enableCache: false, enableValidation: false })
    expect(runtime.isDeviceLost).toBe(false)
    runtime.dispose()
  })

  it('RT2: 设备丢失后 isDeviceLost 变为 true', async () => {
    const { MaterialRuntime } = await import('./runtime')
    const { shaderCache } = await import('./shaderCache')

    let lostResolve: (info: GPUDeviceLostInfo) => void
    const lostPromise = new Promise<GPUDeviceLostInfo>((resolve) => {
      lostResolve = resolve
    })

    const mockDevice = {
      lost: lostPromise,
      createShaderModule: () => ({}),
      createRenderPipeline: () => ({}),
      createCommandEncoder: () => ({}),
      createBindGroup: () => ({}),
      queue: { submit: () => {} },
    } as unknown as GPUDevice

    const runtime = new MaterialRuntime({ device: mockDevice, format: 'bgra8unorm', enableCache: false, enableValidation: false })
    expect(runtime.isDeviceLost).toBe(false)

    // 触发设备丢失
    lostResolve!({ reason: 'destroyed', message: 'test' } as GPUDeviceLostInfo)
    await new Promise((r) => setTimeout(r, 10)) // 等待 Promise 微任务

    expect(runtime.isDeviceLost).toBe(true)
    runtime.dispose()
  })

  it('RT3: 设备丢失后 compilePipeline 抛错', async () => {
    const { MaterialRuntime } = await import('./runtime')

    let lostResolve: (info: GPUDeviceLostInfo) => void
    const lostPromise = new Promise<GPUDeviceLostInfo>((resolve) => {
      lostResolve = resolve
    })

    const mockDevice = {
      lost: lostPromise,
      createShaderModule: () => ({}),
      createRenderPipeline: () => ({}),
      createCommandEncoder: () => ({}),
      createBindGroup: () => ({}),
      queue: { submit: () => {} },
    } as unknown as GPUDevice

    const runtime = new MaterialRuntime({ device: mockDevice, format: 'bgra8unorm', enableCache: false, enableValidation: false })

    // 触发设备丢失
    lostResolve!({ reason: 'destroyed', message: 'test' } as GPUDeviceLostInfo)
    await new Promise((r) => setTimeout(r, 10))

    const graph: MaterialGraph = {
      nodes: [makeNode('c1', 'color')!, makeNode('out1', 'output')!],
      edges: [{ id: 'e1', from: 'c1', fromPort: 'color', to: 'out1', toPort: 'color' }],
      canvas: { ...DEFAULT_MATERIAL_CANVAS },
    }
    const compileResult = compileMaterialGraph(graph)

    await expect(runtime.compilePipeline(compileResult)).rejects.toThrow(/设备已丢失/)
    runtime.dispose()
  })

  it('RT4: WGSL 校验失败时 compilePipeline 抛错', async () => {
    const { MaterialRuntime } = await import('./runtime')

    const mockDevice = {
      lost: new Promise(() => {}),
      createShaderModule: () => ({}),
      createRenderPipeline: () => ({}),
      createCommandEncoder: () => ({}),
      createBindGroup: () => ({}),
      queue: { submit: () => {} },
    } as unknown as GPUDevice

    const runtime = new MaterialRuntime({ device: mockDevice, format: 'bgra8unorm', enableCache: false, enableValidation: true })

    // 手动构造一个有语法错误的 CompileResult
    const badResult = {
      wgsl: 'invalid wgsl {{{',
      bindings: [],
      entryPoint: 'fs_main',
      nodeVarMap: new Map(),
      compiledNodeCount: 0,
      hash: 'bad00000',
    }

    await expect(runtime.compilePipeline(badResult)).rejects.toThrow(/WGSL 语法校验失败/)
    runtime.dispose()
  })
})

// ============================================================================
// MV: Material Validator (像素分析)
// ============================================================================

describe('MV: Material Validator (Pixel Analysis)', () => {
  it('MV1: analyzePixels 全黑像素', () => {
    const width = 4
    const height = 4
    const bytesPerRow = width * 4 // 16 bytes, already 256-aligned
    const data = new Uint8Array(bytesPerRow * height) // all zeros

    const stats = analyzePixels(data, width, height, bytesPerRow)
    expect(stats.avgR).toBe(0)
    expect(stats.avgG).toBe(0)
    expect(stats.avgB).toBe(0)
    expect(stats.avgA).toBe(0)
    expect(stats.avgLuminance).toBe(0)
    expect(stats.variance).toBe(0)
    expect(stats.nonZeroRatio).toBe(0)
    expect(stats.transparentRatio).toBe(1) // alpha < 128
  })

  it('MV2: analyzePixels 全白像素', () => {
    const width = 2
    const height = 2
    const bytesPerRow = width * 4
    const data = new Uint8Array(bytesPerRow * height)
    data.fill(255)

    const stats = analyzePixels(data, width, height, bytesPerRow)
    expect(stats.avgR).toBe(255)
    expect(stats.avgG).toBe(255)
    expect(stats.avgB).toBe(255)
    expect(stats.avgA).toBe(255)
    expect(stats.avgLuminance).toBe(255)
    expect(stats.variance).toBe(0)
    expect(stats.nonZeroRatio).toBe(1)
    expect(stats.transparentRatio).toBe(0)
  })

  it('MV3: analyzePixels 混合像素', () => {
    const width = 2
    const height = 1
    const bytesPerRow = width * 4
    const data = new Uint8Array(bytesPerRow * height)
    // 像素 0: 红色 (255, 0, 0, 255)
    data[0] = 255; data[1] = 0; data[2] = 0; data[3] = 255
    // 像素 1: 绿色 (0, 255, 0, 255)
    data[4] = 0; data[5] = 255; data[6] = 0; data[7] = 255

    const stats = analyzePixels(data, width, height, bytesPerRow)
    expect(stats.avgR).toBe(128) // (255 + 0) / 2 = 127.5 → round to 128
    expect(stats.avgG).toBe(128)
    expect(stats.avgB).toBe(0)
    expect(stats.avgA).toBe(255)
    expect(stats.nonZeroRatio).toBe(1)
    expect(stats.transparentRatio).toBe(0)
    expect(stats.variance).toBeGreaterThan(0) // 有变化
  })

  it('MV4: detectIssues 全黑检测为 error', () => {
    const stats: PixelStats = {
      avgR: 0, avgG: 0, avgB: 0, avgA: 0,
      avgLuminance: 0, variance: 0,
      nonZeroRatio: 0, transparentRatio: 1,
    }
    const issues = detectIssues(stats)
    expect(issues.some((i) => i.category === 'all_black' && i.severity === 'error')).toBe(true)
  })

  it('MV5: detectIssues 全透明检测为 error', () => {
    const stats: PixelStats = {
      avgR: 255, avgG: 0, avgB: 0, avgA: 0,
      avgLuminance: 76, variance: 0,
      nonZeroRatio: 1, transparentRatio: 1,
    }
    const issues = detectIssues(stats)
    expect(issues.some((i) => i.category === 'all_transparent' && i.severity === 'error')).toBe(true)
  })

  it('MV6: detectIssues 纯色检测为 warning', () => {
    const stats: PixelStats = {
      avgR: 128, avgG: 128, avgB: 128, avgA: 255,
      avgLuminance: 128, variance: 0,
      nonZeroRatio: 1, transparentRatio: 0,
    }
    const issues = detectIssues(stats)
    expect(issues.some((i) => i.category === 'no_variation' && i.severity === 'warning')).toBe(true)
  })

  it('MV7: detectIssues 正常画面无 issues', () => {
    const stats: PixelStats = {
      avgR: 128, avgG: 100, avgB: 80, avgA: 255,
      avgLuminance: 105, variance: 500,
      nonZeroRatio: 0.95, transparentRatio: 0,
    }
    const issues = detectIssues(stats)
    expect(issues.length).toBe(0)
  })

  it('MV8: detectIssues 极暗检测为 warning', () => {
    const stats: PixelStats = {
      avgR: 2, avgG: 1, avgB: 1, avgA: 255,
      avgLuminance: 2, variance: 10,
      nonZeroRatio: 0.5, transparentRatio: 0,
    }
    const issues = detectIssues(stats)
    expect(issues.some((i) => i.category === 'too_dark')).toBe(true)
  })

  it('MV9: detectIssues 极亮检测为 warning', () => {
    const stats: PixelStats = {
      avgR: 253, avgG: 254, avgB: 255, avgA: 255,
      avgLuminance: 254, variance: 10,
      nonZeroRatio: 1, transparentRatio: 0,
    }
    const issues = detectIssues(stats)
    expect(issues.some((i) => i.category === 'too_bright')).toBe(true)
  })

  it('MV10: analyzePixels 处理 bytesPerRow 填充', () => {
    // width=3, 每行 12 bytes, 需要填充到 256 字节对齐
    const width = 3
    const height = 2
    const bytesPerRow = 256 // 填充到 256
    const data = new Uint8Array(bytesPerRow * height)
    // 第一行像素
    data[0] = 255; data[1] = 0; data[2] = 0; data[3] = 255 // 红
    data[4] = 0; data[5] = 255; data[6] = 0; data[7] = 255 // 绿
    data[8] = 0; data[9] = 0; data[10] = 255; data[11] = 255 // 蓝
    // 第二行像素（在 offset 256）
    data[256] = 255; data[257] = 255; data[258] = 0; data[259] = 255 // 黄
    data[260] = 0; data[261] = 255; data[262] = 255; data[263] = 255 // 青
    data[264] = 255; data[265] = 0; data[266] = 255; data[267] = 255 // 紫

    const stats = analyzePixels(data, width, height, bytesPerRow)
    expect(stats.nonZeroRatio).toBe(1)
    expect(stats.transparentRatio).toBe(0)
    // 平均 R = (255+0+0+255+0+255) / 6 = 127.5 → 128
    expect(stats.avgR).toBe(128)
  })
})
