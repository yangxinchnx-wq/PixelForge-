/**
 * UAV Split（纹理读写分离）模块统一导出。
 *
 * 借鉴 Gigi 的 WebGPU UAV Split 思路，解决 WebGPU 仅允许
 * r32float/r32uint/r32sint 格式存储纹理 read_write 的限制：
 *   原始纹理 → 只写；只读副本 → 只读；读操作重定向到副本。
 *
 * 模块与具体 GPU 实现解耦，执行器通过 UavSplitBackend 注入能力，
 * 便于在单元测试中使用 mock backend 验证。
 */

export * from './types'
export {
  analyzeShaderCode,
  analyzeShaders,
  isReadWriteStorageFormatSupported,
  declarationNeedsSplit,
  normalizeFormat,
  type ShaderInput,
} from './textureAccessAnalyzer'
export {
  plan,
  planFromShaders,
  readOnlyCopyName,
} from './textureSplitPlanner'
export {
  modifyShaderForSplit,
  modifyShaderSet,
} from './shaderCodeModifier'
export {
  TextureSplitExecutor,
  applyUavSplit,
  type ExecuteSplitParams,
} from './textureSplitExecutor'
export { GpuUavSplitBackend, recordUavCopy } from './gpuBackend'
export {
  prepareEffectUavSplit,
  EFFECT_READ_ONLY_BINDING,
  type EffectUavSplitResult,
} from './integration'
