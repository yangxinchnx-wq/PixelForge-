/**
 * TextureSplitPlanner — 纹理读写分离规划器。
 *
 * 纯函数实现。根据跨 shader/pass 的纹理访问信息，决定哪些纹理需要拆分：
 *   - 若该纹理存在 read_write 访问且格式不支持读写存储 → 需要拆分
 *   - 若该纹理在不同 shader 中分别被 read / write 引用且格式不支持 → 需要拆分
 *
 * 拆分方案约定：
 *   - 原始纹理改为只写（write）
 *   - 生成名为 `${original}_readOnly` 的只读副本
 *   - 读取操作重定向到只读副本
 */

import {
  analyzeShaders,
  type ShaderInput,
  isReadWriteStorageFormatSupported,
} from './textureAccessAnalyzer'
import type { TextureAccessInfo, TextureSplitPlan } from './types'

/**
 * 生成只读副本纹理名。
 */
export function readOnlyCopyName(original: string): string {
  return `${original}_readOnly`
}

/**
 * 规划单组访问信息（同一纹理名）。
 */
function planForTexture(textureName: string, accesses: TextureAccessInfo[]): TextureSplitPlan | null {
  if (accesses.length === 0) return null

  const hasReadWrite = accesses.some((a) => a.accessType === 'read_write')

  // 仅当存在 read_write 声明（同一 shader 内同时读写同一纹理）且格式不支持时
  // 才需要拆分。跨 shader 的「read + write」是合法的 producer/consumer 模式
  // （各自独立绑定，不涉及 read_write），无需拆分。
  if (!hasReadWrite) return null

  const format = accesses[0].format
  if (isReadWriteStorageFormatSupported(format)) {
    // 格式本身支持读写存储，无需拆分
    return null
  }

  // 收集需要重定向读取的 shader（read_write 声明所在 shader）
  const affectedShaders = accesses
    .filter((a) => a.accessType === 'read_write')
    .map((a) => ({
      shaderName: a.shaderName,
      passName: a.passName,
    }))

  return {
    originalTexture: textureName,
    readOnlyCopy: readOnlyCopyName(textureName),
    format,
    affectedShaders,
    copyTiming: 'before-pass',
  }
}

/**
 * 根据访问信息生成拆分方案列表。
 */
export function plan(accessInfos: TextureAccessInfo[]): TextureSplitPlan[] {
  const byTexture = new Map<string, TextureAccessInfo[]>()
  for (const info of accessInfos) {
    const list = byTexture.get(info.textureName) ?? []
    list.push(info)
    byTexture.set(info.textureName, list)
  }

  const plans: TextureSplitPlan[] = []
  for (const [textureName, accesses] of byTexture) {
    const planResult = planForTexture(textureName, accesses)
    if (planResult) plans.push(planResult)
  }

  return plans
}

/**
 * 便捷入口：直接传入多段 shader，先分析再规划。
 */
export function planFromShaders(shaders: ShaderInput[]): TextureSplitPlan[] {
  return plan(analyzeShaders(shaders))
}
