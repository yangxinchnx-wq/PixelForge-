/**
 * UAV Split 模块单元测试。
 *
 * 覆盖：
 * - TextureAccessAnalyzer：WGSL 存储纹理声明解析、格式支持判定
 * - TextureSplitPlanner：拆分方案生成（read_write 不支持格式 → 拆分）
 * - ShaderCodeModifier：read_write → write + 只读副本 + 读重定向
 * - TextureSplitExecutor / applyUavSplit：通过 mock backend 验证执行流程
 */

import { describe, it, expect } from 'vitest'
import {
  analyzeShaderCode,
  analyzeShaders,
  isReadWriteStorageFormatSupported,
  declarationNeedsSplit,
} from '../textureAccessAnalyzer'
import {
  plan,
  planFromShaders,
  readOnlyCopyName,
} from '../textureSplitPlanner'
import { modifyShaderForSplit, modifyShaderSet } from '../shaderCodeModifier'
import {
  TextureSplitExecutor,
  applyUavSplit,
  type ExecuteSplitParams,
} from '../textureSplitExecutor'
import type { TextureSplitPlan, UavSplitBackend } from '../types'

// ─── Mock GPU Backend ───

class MockUavBackend implements UavSplitBackend {
  /** 已创建的纹理句柄列表 */
  created: Array<{ label: string; format: string; width: number; height: number }> = []
  /** 已记录的复制操作 */
  copies: Array<{ from: unknown; to: unknown }> = []
  /** 已销毁的句柄 */
  destroyed: unknown[] = []
  /** 自增 id 计数器 */
  private nextId = 0

  createReadOnlyTexture(desc: {
    width: number
    height: number
    format: string
    label: string
  }): unknown {
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

// ─── Analyzer 测试 ───

describe('TextureAccessAnalyzer', () => {
  it('UAV-A01: 解析 2d 存储纹理声明（read/write/read_write）', () => {
    const code = `
      var inTex  : texture_storage_2d<rgba8unorm, read>;
      var outTex : texture_storage_2d<rgba8unorm, write>;
      var accTex : texture_storage_2d<rgba16float, read_write>;
    `
    const decls = analyzeShaderCode(code)
    expect(decls).toHaveLength(3)
    expect(decls[0]).toMatchObject({ textureName: 'inTex', format: 'rgba8unorm', access: 'read' })
    expect(decls[1]).toMatchObject({ textureName: 'outTex', format: 'rgba8unorm', access: 'write' })
    expect(decls[2]).toMatchObject({ textureName: 'accTex', format: 'rgba16float', access: 'read_write' })
  })

  it('UAV-A02: 解析 2d_array / 3d 维度', () => {
    const code = `
      var a : texture_storage_2d_array<r32float, write>;
      var b : texture_storage_3d<r32uint, read_write>;
    `
    const decls = analyzeShaderCode(code)
    expect(decls).toHaveLength(2)
    expect(decls[0].textureName).toBe('a')
    expect(decls[1].textureName).toBe('b')
  })

  it('UAV-A03: 忽略普通纹理（非存储）', () => {
    const code = `
      var t : texture_2d<f32>;
      var s : sampler;
      @group(0) @binding(0) var<uniform> u : Uniforms;
    `
    expect(analyzeShaderCode(code)).toHaveLength(0)
  })

  it('UAV-A04: 格式大小写与空白归一化', () => {
    const code = `var x : texture_storage_2d<  RGBA8Unorm , read_write>;`
    const decls = analyzeShaderCode(code)
    expect(decls).toHaveLength(1)
    expect(decls[0].format).toBe('rgba8unorm')
  })

  it('UAV-A05: isReadWriteStorageFormatSupported 仅 r32 系列为真', () => {
    expect(isReadWriteStorageFormatSupported('r32float')).toBe(true)
    expect(isReadWriteStorageFormatSupported('r32uint')).toBe(true)
    expect(isReadWriteStorageFormatSupported('r32sint')).toBe(true)
    expect(isReadWriteStorageFormatSupported('rgba8unorm')).toBe(false)
    expect(isReadWriteStorageFormatSupported('rgba16float')).toBe(false)
    expect(isReadWriteStorageFormatSupported('RGBA8UNORM')).toBe(false)
  })

  it('UAV-A06: declarationNeedsSplit 仅 read_write + 不支持格式为真', () => {
    expect(
      declarationNeedsSplit({ textureName: 'x', formatToken: 'rgba8unorm', format: 'rgba8unorm', access: 'read_write', location: 0, length: 1 }),
    ).toBe(true)
    expect(
      declarationNeedsSplit({ textureName: 'x', formatToken: 'r32float', format: 'r32float', access: 'read_write', location: 0, length: 1 }),
    ).toBe(false)
    expect(
      declarationNeedsSplit({ textureName: 'x', formatToken: 'rgba8unorm', format: 'rgba8unorm', access: 'read', location: 0, length: 1 }),
    ).toBe(false)
  })

  it('UAV-A07: analyzeShaders 跨 shader/pass 汇总', () => {
    const shaders = [
      { name: 'post', pass: 'bloom', code: 'var acc : texture_storage_2d<rgba8unorm, read_write>;' },
      { name: 'comp', pass: 'composite', code: 'var mask : texture_storage_2d<r32float, write>;' },
    ]
    const infos = analyzeShaders(shaders)
    expect(infos).toHaveLength(2)
    expect(infos[0]).toMatchObject({ textureName: 'acc', accessType: 'read_write', shaderName: 'post', passName: 'bloom' })
    expect(infos[1]).toMatchObject({ textureName: 'mask', accessType: 'write', shaderName: 'comp' })
  })
})

// ─── Planner 测试 ───

describe('TextureSplitPlanner', () => {
  it('UAV-P01: read_write + 不支持格式 → 生成拆分方案', () => {
    const plans = plan([
      { textureName: 'scene', accessType: 'read_write', shaderName: 'post', passName: 'bloom', format: 'rgba8unorm' },
    ])
    expect(plans).toHaveLength(1)
    expect(plans[0].originalTexture).toBe('scene')
    expect(plans[0].readOnlyCopy).toBe('scene_readOnly')
    expect(plans[0].affectedShaders).toEqual([{ shaderName: 'post', passName: 'bloom' }])
    expect(plans[0].copyTiming).toBe('before-pass')
  })

  it('UAV-P02: read_write + 支持的 r32 格式 → 不拆分', () => {
    const plans = plan([
      { textureName: 'acc', accessType: 'read_write', shaderName: 'post', passName: 'bloom', format: 'r32float' },
    ])
    expect(plans).toHaveLength(0)
  })

  it('UAV-P03: 跨 shader 的 read + write（producer/consumer）不拆分', () => {
    const plans = plan([
      { textureName: 'a', accessType: 'read', shaderName: 's1', passName: 'p', format: 'rgba8unorm' },
      { textureName: 'a', accessType: 'write', shaderName: 's2', passName: 'p', format: 'rgba8unorm' },
    ])
    // 各自独立绑定，不涉及 read_write，无需拆分
    expect(plans).toHaveLength(0)
  })

  it('UAV-P04: 多纹理分别判定', () => {
    const plans = plan([
      { textureName: 't1', accessType: 'read_write', shaderName: 's', passName: 'p', format: 'rgba8unorm' },
      { textureName: 't2', accessType: 'read_write', shaderName: 's', passName: 'p', format: 'r32float' },
      { textureName: 't3', accessType: 'write', shaderName: 's', passName: 'p', format: 'rgba16float' },
    ])
    expect(plans.map((p) => p.originalTexture)).toEqual(['t1'])
  })

  it('UAV-P05: readOnlyCopyName 命名约定', () => {
    expect(readOnlyCopyName('foo')).toBe('foo_readOnly')
  })

  it('UAV-P06: planFromShaders 端到端', () => {
    const plans = planFromShaders([
      { name: 'fx', pass: 'bloom', code: 'var buf : texture_storage_2d<rgba8unorm, read_write>;' },
    ])
    expect(plans).toHaveLength(1)
    expect(plans[0].originalTexture).toBe('buf')
  })
})

// ─── ShaderCodeModifier 测试 ───

describe('ShaderCodeModifier', () => {
  it('UAV-M01: read_write → write + 插入只读副本声明', () => {
    const code = `@group(0) @binding(0) var buf : texture_storage_2d<rgba8unorm, read_write>;`
    const plan: TextureSplitPlan = {
      originalTexture: 'buf',
      readOnlyCopy: 'buf_readOnly',
      format: 'rgba8unorm',
      affectedShaders: [{ shaderName: 'fx', passName: 'bloom' }],
      copyTiming: 'before-pass',
    }
    const out = modifyShaderForSplit(code, plan)
    expect(out).toContain('texture_storage_2d<rgba8unorm, write>')
    expect(out).toContain('var buf_readOnly : texture_storage_2d<rgba8unorm, read>;')
    expect(out).not.toContain('read_write')
  })

  it('UAV-M02: textureLoad 重定向到只读副本', () => {
    const code = `
      var buf : texture_storage_2d<rgba8unorm, read_write>;
      fn main() {
        let v = textureLoad(buf, vec2<i32>(0, 0));
        textureStore(buf, vec2<i32>(0, 0), vec4<f32>(1.0));
      }
    `
    const plan: TextureSplitPlan = {
      originalTexture: 'buf',
      readOnlyCopy: 'buf_readOnly',
      format: 'rgba8unorm',
      affectedShaders: [{ shaderName: 'fx', passName: 'bloom' }],
      copyTiming: 'before-pass',
    }
    const out = modifyShaderForSplit(code, plan)
    expect(out).toContain('textureLoad(buf_readOnly, vec2<i32>(0, 0))')
    expect(out).toContain('textureStore(buf, vec2<i32>(0, 0), vec4<f32>(1.0))')
  })

  it('UAV-M03: 不误伤同名前缀的其它纹理', () => {
    const code = `
      var buff : texture_storage_2d<rgba8unorm, read_write>;
      var buffer2 : texture_storage_2d<rgba8unorm, read>;
      fn main() {
        let v = textureLoad(buff, vec2<i32>(0, 0));
        let w = textureLoad(buffer2, vec2<i32>(1, 1));
      }
    `
    const plan: TextureSplitPlan = {
      originalTexture: 'buff',
      readOnlyCopy: 'buff_readOnly',
      format: 'rgba8unorm',
      affectedShaders: [{ shaderName: 'fx', passName: 'bloom' }],
      copyTiming: 'before-pass',
    }
    const out = modifyShaderForSplit(code, plan)
    expect(out).toContain('textureLoad(buff_readOnly, vec2<i32>(0, 0))')
    // buffer2 不应被改写
    expect(out).toContain('textureLoad(buffer2, vec2<i32>(1, 1))')
  })

  it('UAV-M04: 无 read_write 声明的 shader 不改写', () => {
    const code = `var buf : texture_storage_2d<rgba8unorm, read>;`
    const plan: TextureSplitPlan = {
      originalTexture: 'buf',
      readOnlyCopy: 'buf_readOnly',
      format: 'rgba8unorm',
      affectedShaders: [{ shaderName: 'fx', passName: 'bloom' }],
      copyTiming: 'before-pass',
    }
    expect(modifyShaderForSplit(code, plan)).toBe(code)
  })

  it('UAV-M05: modifyShaderSet 仅返回改写的 shader', () => {
    const shaders = [
      { name: 'fx', pass: 'bloom', code: 'var buf : texture_storage_2d<rgba8unorm, read_write>;' },
      { name: 'other', pass: 'p', code: 'var x : texture_storage_2d<r32float, write>;' },
    ]
    const plans = planFromShaders(shaders)
    const modified = modifyShaderSet(shaders, plans)
    expect(modified.size).toBe(1)
    expect(modified.has('fx')).toBe(true)
  })
})

// ─── Executor 测试 ───

describe('TextureSplitExecutor', () => {
  it('UAV-E01: 创建只读副本并记录复制命令', () => {
    const backend = new MockUavBackend()
    const executor = new TextureSplitExecutor()
    const plan: TextureSplitPlan = {
      originalTexture: 'buf',
      readOnlyCopy: 'buf_readOnly',
      format: 'rgba8unorm',
      affectedShaders: [{ shaderName: 'fx', passName: 'bloom' }],
      copyTiming: 'before-pass',
    }
    const params: ExecuteSplitParams = {
      plan,
      sourceTexture: 'src_handle',
      size: { width: 1920, height: 1080 },
      backend,
    }
    const result = executor.execute(params)

    expect(backend.created).toHaveLength(1)
    expect(backend.created[0]).toMatchObject({ label: 'buf_readOnly', format: 'rgba8unorm', width: 1920, height: 1080 })
    expect(backend.copies).toHaveLength(1)
    expect(backend.copies[0]).toEqual({ from: 'src_handle', to: result.readOnlyTexture })
    expect(result.copyCommandRecorded).toBe(true)
    expect(result.readOnlyTexture).toBeDefined()
  })

  it('UAV-E02: dispose 通过 backend 销毁只读副本', () => {
    const backend = new MockUavBackend()
    const executor = new TextureSplitExecutor()
    const plan: TextureSplitPlan = {
      originalTexture: 'buf',
      readOnlyCopy: 'buf_readOnly',
      format: 'rgba8unorm',
      affectedShaders: [{ shaderName: 'fx', passName: 'bloom' }],
      copyTiming: 'before-pass',
    }
    const result = executor.execute({
      plan,
      sourceTexture: 'h',
      size: { width: 4, height: 4 },
      backend,
    })
    executor.dispose(result, backend)
    expect(backend.destroyed).toContain(result.readOnlyTexture)
  })
})

// ─── applyUavSplit 端到端 ───

describe('applyUavSplit', () => {
  it('UAV-X01: 完整链路 分析→规划→改写→执行', () => {
    const shaders = [
      {
        name: 'bloom',
        pass: 'bloom',
        code: `
          var accum : texture_storage_2d<rgba16float, read_write>;
          fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
            let v = textureLoad(accum, vec2<i32>(gid.xy));
            textureStore(accum, vec2<i32>(gid.xy), v * 0.5);
          }
        `,
      },
    ]
    const sourceTextures = new Map([
      ['accum', { handle: 'accum_gpu', size: { width: 1280, height: 720 } }],
    ])
    const backend = new MockUavBackend()

    const { modifiedShaders, plans, results } = applyUavSplit(shaders, sourceTextures, backend)

    // 1 个拆分方案
    expect(plans).toHaveLength(1)
    expect(plans[0].originalTexture).toBe('accum')

    // shader 被改写：read_write 消失，出现只读副本，读取重定向
    const out = modifiedShaders.get('bloom')!
    expect(out).toBeDefined()
    expect(out).not.toContain('read_write')
    expect(out).toContain('var accum_readOnly : texture_storage_2d<rgba16float, read>;')
    expect(out).toContain('textureLoad(accum_readOnly, vec2<i32>(gid.xy))')
    expect(out).toContain('textureStore(accum, vec2<i32>(gid.xy), v * 0.5)')

    // 执行：创建副本 + 记录复制
    expect(results).toHaveLength(1)
    expect(backend.created[0].label).toBe('accum_readOnly')
    expect(backend.copies[0]).toEqual({ from: 'accum_gpu', to: results[0].readOnlyTexture })
  })

  it('UAV-X02: 支持的 r32 格式不触发拆分', () => {
    const shaders = [
      { name: 'fx', pass: 'p', code: 'var c : texture_storage_2d<r32float, read_write>;' },
    ]
    const backend = new MockUavBackend()
    const { plans, results, modifiedShaders } = applyUavSplit(
      shaders,
      new Map([['c', { handle: 'h', size: { width: 1, height: 1 } }]]),
      backend,
    )
    expect(plans).toHaveLength(0)
    expect(results).toHaveLength(0)
    expect(modifiedShaders.size).toBe(0)
    expect(backend.created).toHaveLength(0)
  })

  it('UAV-X03: 缺少原纹理句柄时跳过执行但仍记录改写', () => {
    const shaders = [
      { name: 'fx', pass: 'p', code: 'var buf : texture_storage_2d<rgba8unorm, read_write>;' },
    ]
    const backend = new MockUavBackend()
    const { plans, results, modifiedShaders } = applyUavSplit(shaders, new Map(), backend)
    expect(plans).toHaveLength(1)
    expect(results).toHaveLength(0) // 无句柄 → 不执行
    expect(modifiedShaders.size).toBe(1) // 但改写仍发生
  })
})
