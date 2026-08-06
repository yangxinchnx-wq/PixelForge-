/**
 * UAV Split 与 PixelForge 真实渲染管线的接入层。
 *
 * 专门为效果后处理（effect_post）着色器服务：将其 read_write 存储纹理
 * （outputTex）拆分为「只写原纹理 + 只读副本」，并把着色器内的读操作
 * 重定向到只读副本。
 *
 * 设计要点：
 *  - 着色器改写（分析 → 规划 → 改写）在管线初始化时做一次；
 *  - 只读副本纹理也只创建一次；
 *  - 但输出纹理每个渲染帧都会被图层求值 pass 覆盖，因此只读副本的内容
 *    必须由调用方在每个渲染帧通过 recordUavCopy 从输出纹理刷新。
 *    为此本层仅为只读副本注入显式 @binding，便于调用方在效果绑定组中
 *    稳定地引用它。
 */

import type { RuntimeTextureBundle } from '../types'
import type { TextureSplitPlan, UavSplitBackend } from './types'
import type { ShaderInput } from './textureAccessAnalyzer'
import { applyUavSplit } from './textureSplitExecutor'

/** 效果后处理着色器中只读副本使用的绑定槽（原 shader 已占用 0-4） */
export const EFFECT_READ_ONLY_BINDING = 5

export interface EffectUavSplitResult {
  /** 改写后的 WGSL 源码（已为只读副本注入 @group/@binding） */
  effectShaderCode: string
  /** 创建的只读副本纹理（storage 用法，每个渲染帧刷新内容） */
  readOnlyCopy: GPUTexture
  /** 只读副本在效果绑定组中的绑定槽 */
  readOnlyBinding: number
  /** 采用的拆分方案（用于诊断） */
  plan: TextureSplitPlan
}

/**
 * 为效果后处理着色器准备 UAV Split。
 *
 * @returns 若着色器无需拆分（无非 r32 系列的 read_write 存储纹理）返回 null，
 *          调用方应回退到原始着色器源码；否则返回改写结果与只读副本纹理。
 *
 * 注意：本函数不会执行复制。复制由调用方在每个渲染帧通过 recordUavCopy
 * 将输出纹理内容复制到返回的 readOnlyCopy，再执行效果 pass。
 */
export function prepareEffectUavSplit(
  effectShaderSource: string,
  output: RuntimeTextureBundle,
  backend: UavSplitBackend,
): EffectUavSplitResult | null {
  const shaders: ShaderInput[] = [
    { name: 'effect_post', pass: 'effect', code: effectShaderSource },
  ]

  // 分析 → 规划 → 改写。传入空 sourceTextures，避免 executor 在预处理阶段
  // 做一次性复制（渲染管线需要逐帧刷新副本内容）。
  const { modifiedShaders, plans } = applyUavSplit(
    shaders,
    new Map<string, { handle: unknown; size: { width: number; height: number } }>(),
    backend,
  )
  if (plans.length === 0) return null

  const plan0 = plans[0]
  const baseCode = modifiedShaders.get('effect_post') ?? effectShaderSource

  // layout:'auto' 要求所有资源变量具备 @group/@binding，
  // 为只读副本声明注入显式绑定（原 shader 占用 0-4，副本用 5）。
  const effectShaderCode = withReadOnlyBinding(baseCode, plan0.readOnlyCopy, EFFECT_READ_ONLY_BINDING)

  // 创建只读副本纹理（storage 用法，逐帧从输出纹理复制内容填充）。
  const readOnlyCopy = backend.createReadOnlyTexture({
    width: output.size.width,
    height: output.size.height,
    format: plan0.format,
    label: plan0.readOnlyCopy,
  }) as GPUTexture

  return {
    effectShaderCode,
    readOnlyCopy,
    readOnlyBinding: EFFECT_READ_ONLY_BINDING,
    plan: plan0,
  }
}

/** 在只读副本声明前注入 `@group(0) @binding(<n>)`，使其满足 auto 布局要求。 */
function withReadOnlyBinding(code: string, copyName: string, binding: number): string {
  const re = new RegExp(`(var\\s+${escapeRe(copyName)}\\s*:\\s*texture_storage_2d)`)
  return code.replace(re, `@group(0) @binding(${binding}) $1`)
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
