/**
 * WGSL Shader 语法验证测试
 *
 * 用项目自带的 wgslValidator 验证 region_eval.wgsl 的语法正确性。
 * 注意：wgslValidator 原设计面向 fragment shader（需要 return 语句），
 * region_eval.wgsl 是 compute shader（void 返回，不需要 return），
 * 所以 V8 规则（return 检查）是预期的 false positive，单独排除。
 */
import { describe, expect, it } from 'vitest'
import { validateWGSL } from '@/material/wgslValidator'
import regionShaderSource from './region_eval.wgsl?raw'

describe('region_eval.wgsl 语法验证', () => {
  const result = validateWGSL(regionShaderSource, 'main')

  it('V1: 括号匹配应通过', () => {
    const v1Errors = result.errors.filter((e) => e.rule === 'V1')
    expect(v1Errors).toEqual([])
  })

  it('V3: 入口函数 main 应存在', () => {
    const v3Errors = result.errors.filter((e) => e.rule === 'V3')
    expect(v3Errors).toEqual([])
  })

  it('V4: fn 声明语法应通过', () => {
    const v4Errors = result.errors.filter((e) => e.rule === 'V4')
    expect(v4Errors).toEqual([])
  })

  it('V9: @binding/@group 注解应通过', () => {
    const v9Errors = result.errors.filter((e) => e.rule === 'V9')
    expect(v9Errors).toEqual([])
  })

  it('V10: 无未关闭字符串', () => {
    const v10Errors = result.errors.filter((e) => e.rule === 'V10')
    expect(v10Errors).toEqual([])
  })

  // V8 是预期的 false positive：compute shader 的 main 函数不需要 return
  it('V8: compute shader 不需要 return（预期 false positive）', () => {
    const v8Errors = result.errors.filter((e) => e.rule === 'V8')
    // 这个错误是预期的 — compute shader main() 不需要 return 语句
    // 如果有 V8 错误，说明 validator 在工作，只是不适用于 compute shader
    if (v8Errors.length > 0) {
      console.log('V8 预期 false positive（compute shader 不需要 return）:', v8Errors)
    }
  })

  // 非 V8 的错误应为 0
  it('除 V8 外无其他错误', () => {
    const nonV8Errors = result.errors.filter((e) => e.rule !== 'V8')
    if (nonV8Errors.length > 0) {
      console.error('非 V8 的 WGSL 语法错误:', nonV8Errors)
    }
    expect(nonV8Errors).toEqual([])
  })

  it('应包含 OP_IMAGE_TEXTURE 常量定义', () => {
    expect(regionShaderSource).toContain('OP_IMAGE_TEXTURE')
  })

  it('应包含 4 个材质纹理 binding (binding 5-8)', () => {
    expect(regionShaderSource).toContain('@binding(5) var matTex0')
    expect(regionShaderSource).toContain('@binding(6) var matTex1')
    expect(regionShaderSource).toContain('@binding(7) var matTex2')
    expect(regionShaderSource).toContain('@binding(8) var matTex3')
  })

  it('应包含 sample_material_texture 函数', () => {
    expect(regionShaderSource).toContain('fn sample_material_texture')
  })

  it('应包含 textureLoad 调用', () => {
    expect(regionShaderSource).toContain('textureLoad(matTex0')
    expect(regionShaderSource).toContain('textureLoad(matTex1')
    expect(regionShaderSource).toContain('textureLoad(matTex2')
    expect(regionShaderSource).toContain('textureLoad(matTex3')
  })

  it('evaluate_opcode 应接受 texIndex 参数', () => {
    expect(regionShaderSource).toContain(
      'fn evaluate_opcode(opcode: u32, auxIndex: u32, coords: vec2f, texIndex: u32) -> vec4f',
    )
  })

  it('应包含 OP_IMAGE_TEXTURE case 分支', () => {
    expect(regionShaderSource).toContain('case OP_IMAGE_TEXTURE:')
  })

  it('main 函数应从 packedMeta 提取 texIndex', () => {
    expect(regionShaderSource).toContain('(packedMeta >> 16u) & 0xFFu')
  })
})
