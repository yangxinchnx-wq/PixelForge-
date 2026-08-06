/**
 * ShaderCodeModifier — WGSL 源码读写分离改写器。
 *
 * 纯字符串变换，不依赖 GPU。对一个声明了 read_write 存储纹理的 shader：
 *   1. 将原声明 `texture_storage_2d<F, read_write>` 改为 `... <F, write>`
 *   2. 紧接着插入只读副本声明 `var <copy> : texture_storage_2d<F, read>;`
 *   3. 将 shader 内对原纹理的读操作 `textureLoad(<orig>, ...)` 改写为
 *      `textureLoad(<copy>, ...)`；写操作 `textureStore(<orig>, ...)` 保持不变。
 *
 * 对应 Gigi Backend_WebGPU.cpp 的 PostLoad_WebGPU：
 * 原纹理变只写、副本变只读，读取重定向到副本。
 */

import type { TextureSplitPlan } from './types'
import type { ShaderInput } from './textureAccessAnalyzer'
import { readOnlyCopyName } from './textureSplitPlanner'

/** 转义正则特殊字符 */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 改写单个 shader 源码以应用一条拆分方案。
 *
 * 前提：该 shader 中存在 `var <originalTexture> : texture_storage_*<fmt, read_write>`。
 * 若不存在 read_write 声明（例如跨 shader 的 read 端），则返回原样（无修改）。
 *
 * @returns 改写后的 WGSL 源码
 */
export function modifyShaderForSplit(code: string, plan: TextureSplitPlan): string {
  const orig = plan.originalTexture
  const copy = plan.readOnlyCopy

  // 1. 定位原 read_write 声明并改写为 write
  const declRe = new RegExp(
    `var\\s+${escapeRegex(orig)}\\s*:\\s*texture_storage_(?:2d|2d_array|3d)\\s*<\\s*([A-Za-z0-9_]+)\\s*,\\s*read_write\\s*>`,
    'g',
  )

  let modified = code
  let declMatch: RegExpExecArray | null = declRe.exec(code)
  if (!declMatch) {
    // 该 shader 中没有 read_write 声明，无需改写（跨 shader 读端由绑定重映射处理）
    return code
  }

  const formatToken = declMatch[1]
  const declStart = declMatch.index
  const declEnd = declMatch.index + declMatch[0].length

  // 重建为 write-only 声明
  const writeDecl = `var ${orig} : texture_storage_2d<${formatToken}, write>`

  // 2. 插入只读副本声明（紧跟原声明之后）
  const readDecl = `var ${copy} : texture_storage_2d<${formatToken}, read>;`

  modified =
    code.slice(0, declStart) +
    writeDecl +
    '\n' +
    readDecl +
    code.slice(declEnd)

  // 3. 将读操作 textureLoad(<orig>, ...) 改写为 textureLoad(<copy>, ...)
  //    注意：只改 textureLoad（读），不改 textureStore（写），且需词边界避免误伤
  //    例如 textureLoad(otherTex 不应被 orig='tex' 误匹配）。
  const loadRe = new RegExp(`textureLoad\\(\\s*${escapeRegex(orig)}\\b`, 'g')
  modified = modified.replace(loadRe, `textureLoad(${copy}`)

  return modified
}

/**
 * 对一组 shader 批量应用拆分方案。
 *
 * @returns Map<shaderName, modifiedCode>，仅包含实际发生改写的 shader。
 */
export function modifyShaderSet(
  shaders: ShaderInput[],
  plans: TextureSplitPlan[],
): Map<string, string> {
  const result = new Map<string, string>()

  // 建立 shader 名 → shader
  const byName = new Map(shaders.map((s) => [s.name, s]))

  for (const plan of plans) {
    for (const affected of plan.affectedShaders) {
      const shader = byName.get(affected.shaderName)
      if (!shader) continue
      const modified = modifyShaderForSplit(shader.code, plan)
      if (modified !== shader.code) {
        result.set(affected.shaderName, modified)
      }
    }
  }

  return result
}

/** 重新导出，方便调用方统一从本模块拿到副本命名约定 */
export { readOnlyCopyName }
