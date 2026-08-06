/**
 * PixelForge - RenderGraph 出口(Step 40.5)
 *
 * 借鉴 Orillusion RenderGraph 全套架构,适配 PixelForge 的 2D 视觉引擎抽象。
 * 提供:
 * - 通用 RenderGraph(任意 Pass + 拓扑排序 + dependsOn 边)
 * - 事务性 setup + 多轮重试(add() 顺序不约束资源依赖顺序)
 * - 瞬态资源子系统(生命周期分析 + lifetime-aware 别名池)
 * - GPU 注入式设计(不持有 device,createGpuTexture/createGpuBuffer 回调注入)
 */

// 错误体系
export {
  GraphCompileError,
  CyclicDependencyError,
  UnresolvedResourceError,
  MissingCreatorError,
  WrongResourceKindError,
  DuplicateCreatorError,
} from './graphErrors'

// 验证器 + 拓扑排序
export { GraphValidator, topoSort } from './graphValidator'

// Pass 抽象 + Builder + Context
export {
  type RenderGraphBuilder,
  type RenderGraphPassContext,
  RenderGraphPass,
} from './renderGraphPass'

// 资源池
export { RenderGraphResourcePool, type ResourceKind } from './resourcePool'

// 瞬态资源子系统
export {
  type SizeSpec,
  type AccessHint,
  type TextureDesc,
  type BufferDesc,
} from './transient/resourceDesc'
export { type TextureHandle, type BufferHandle } from './transient/resourceHandle'
export { type TransientResourceKind } from './transient/types'
export {
  TransientResourceRegistry,
  type TransientResourceDeclaration,
} from './transient/transientResourceRegistry'
export {
  LifetimeAnalyzer,
  resolveSizeSpec,
  type ResourceLifetime,
} from './transient/lifetimeAnalyzer'
export {
  TransientTexturePool,
  computeBucketKey,
  inPlaceResizable,
  estimateTextureBytes,
  type PooledTexture,
  type TransientTextureAssignment,
  type TransientTexturePoolOptions,
} from './transient/transientTexturePool'
export {
  TransientBufferPool,
  roundUpToPow2,
  type PooledBuffer,
  type TransientBufferAssignment,
  type TransientBufferPoolOptions,
} from './transient/transientBufferPool'

// 主类
export { RenderGraph, type RenderGraphOptions } from './renderGraph'

// 适配层(接入现有渲染链路)
export {
  SceneDispatchPass,
  PresentToCanvasPass,
  RenderGraphAdapter,
  type RenderGraphAdapterOptions,
} from './adapter'
