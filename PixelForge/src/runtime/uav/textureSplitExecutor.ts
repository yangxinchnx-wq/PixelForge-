/**
 * TextureSplitExecutor — 纹理读写分离执行器。
 *
 * 通过注入的 UavSplitBackend 创建只读副本纹理、记录复制命令并销毁资源。
 * 不直接依赖浏览器 GPU 类型，因此可在单元测试中用 mock backend 验证。
 *
 * 真实环境的使用方会传入一个基于 GPUDevice 的 backend：
 *   - createReadOnlyTexture → device.createTexture(...)
 *   - copyTextureToTexture → encoder.copyTextureToTexture(src, dst, size)
 *   - destroyTexture → texture.destroy()
 */

import type { TextureSplitPlan, TextureSplitResult, UavSplitBackend } from './types'
import { analyzeShaders, type ShaderInput } from './textureAccessAnalyzer'
import { plan } from './textureSplitPlanner'
import { modifyShaderSet } from './shaderCodeModifier'

/** 执行单条拆分方案的参数 */
export interface ExecuteSplitParams {
  /** 拆分方案 */
  plan: TextureSplitPlan
  /** 原纹理的抽象句柄（真实环境是 GPUTexture，测试环境是 string id） */
  sourceTexture: unknown
  /** 原纹理尺寸 */
  size: { width: number; height: number }
  /** GPU 后端 */
  backend: UavSplitBackend
}

export class TextureSplitExecutor {
  /**
   * 执行单条拆分方案：
   *   1. 用 backend 创建只读副本纹理
   *   2. 用 backend 记录「原纹理 → 只读副本」的复制命令
   * @returns 拆分执行结果
   */
  execute(params: ExecuteSplitParams): TextureSplitResult {
    const { plan: p, sourceTexture, size, backend } = params

    const readOnlyTexture = backend.createReadOnlyTexture({
      width: size.width,
      height: size.height,
      format: p.format,
      label: p.readOnlyCopy,
    })

    backend.copyTextureToTexture(sourceTexture, readOnlyTexture)

    return {
      plan: p,
      readOnlyTexture,
      copyCommandRecorded: true,
    }
  }

  /**
   * 销毁一条拆分产生的只读副本纹理。
   */
  dispose(result: TextureSplitResult, backend: UavSplitBackend): void {
    backend.destroyTexture(result.readOnlyTexture)
  }
}

/**
 * 一次性完成「分析 → 规划 → 改写 → 执行」的便捷入口。
 *
 * 适用于后处理材质编译或单 shader 的读写分离预处理。
 *
 * @param shaders 待分析的 shader 集合
 * @param sourceTextures 纹理名 → { handle, size } 映射（参与复制的原纹理）
 * @param backend GPU 后端
 * @returns 改写后的 shader 代码 Map 与所有拆分执行结果
 */
export function applyUavSplit(
  shaders: ShaderInput[],
  sourceTextures: Map<string, { handle: unknown; size: { width: number; height: number } }>,
  backend: UavSplitBackend,
): {
  modifiedShaders: Map<string, string>
  plans: TextureSplitPlan[]
  results: TextureSplitResult[]
} {
  const accessInfos = analyzeShaders(shaders)
  const plans = plan(accessInfos)

  const modifiedShaders = modifyShaderSet(shaders, plans)

  const executor = new TextureSplitExecutor()
  const results: TextureSplitResult[] = []

  for (const p of plans) {
    const src = sourceTextures.get(p.originalTexture)
    if (!src) {
      // 没有可用的原纹理句柄，跳过执行（仅记录改写）
      continue
    }
    results.push(
      executor.execute({
        plan: p,
        sourceTexture: src.handle,
        size: src.size,
        backend,
      }),
    )
  }

  return { modifiedShaders, plans, results }
}
