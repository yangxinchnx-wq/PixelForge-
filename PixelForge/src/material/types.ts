/**
 * Material Types(Step 28.2)— Material Graph 节点类型定义。
 *
 * 与 src/graph/types.ts 的关系:
 * - graph/types.ts:  RenderGraph(场景结构:Region / Effect / Composite / Output)
 * - material/types.ts: MaterialGraph(像素计算:Texture / UV / Math / Color / Filter / Output)
 *
 * 区别:
 *   RenderGraph  → "我要什么效果"(高层语义,调用固定 shader)
 *   MaterialGraph → "每个像素怎么算"(底层计算,自动生成 WGSL)
 *
 * 数据流(Step 28 完整):
 *   RenderGraph(高层)
 *     ↓ (Step 28+ 通过 MaterialBinding 关联)
 *   MaterialGraph(底层)
 *     ↓ compiler.compileMaterialGraph
 *   WGSL Source
 *     ↓ runtime.compilePipeline
 *   GPUShaderModule + RenderPipeline
 *     ↓ GPU
 *   Canvas
 */

import type { JsonLiteral } from '@/shared/types'
import type { WGSLBuilder } from './wgslBuilder'

// ============================================================================
// 1. MaterialNodeType - 节点类型枚举
// ============================================================================

/**
 * Material 节点类型(6 种,与 spec §2 对齐)。
 *
 * - TEXTURE:  纹理采样节点(从 binding 读 texture + sampler,输出 vec4 color)
 * - UV:       UV 坐标生成节点(从 frag coord 计算 uv,输出 vec2)
 * - MATH:     数学运算节点(add / multiply / sin / cos / pow 等,输出标量或向量)
 * - COLOR:    颜色常量节点(输出 vec4)
 * - FILTER:   滤镜节点(noise / blur / sharpen / distort 等,输入 vec4 输出 vec4)
 * - OUTPUT:   最终输出节点(全图唯一,接收 vec4 写入 location(0))
 */
export type MaterialNodeType =
  | 'TEXTURE'
  | 'UV'
  | 'MATH'
  | 'COLOR'
  | 'FILTER'
  | 'OUTPUT'

// ============================================================================
// 2. PortType - 端口数据类型
// ============================================================================

/**
 * Material 端口数据类型(与 spec §2 对齐)。
 *
 * - float:    标量(如 scale / intensity / time)
 * - vec2:     二维向量(如 uv / offset)
 * - vec3:     三维向量(如 rgb)
 * - vec4:     四维向量(如 rgba)
 * - texture:  纹理引用(仅 TEXTURE 节点输出)
 *
 * 类型系统(见 typeChecker.ts):
 *   float  ← float
 *   vec2   ← vec2
 *   vec3   ← vec3, vec4(截断 .rgb)
 *   vec4   ← vec4, vec3(扩展 alpha=1)
 *   texture ← texture
 */
export type PortType = 'float' | 'vec2' | 'vec3' | 'vec4' | 'texture'

// ============================================================================
// 3. MaterialPort - 端口定义
// ============================================================================

/**
 * Material 端口。
 *
 * - id:        端口唯一 id(节点内唯一)
 * - name:      显示名(如 "uv" / "color" / "scale")
 * - type:      数据类型(见 PortType)
 * - direction: 'input' | 'output'
 */
export interface MaterialPort {
  id: string
  name: string
  type: PortType
  direction: 'input' | 'output'
}

// ============================================================================
// 4. MaterialNode - 节点定义
// ============================================================================

/**
 * Material 节点实例(用户在编辑器中创建)。
 *
 * - id:         节点唯一 id
 * - type:       节点类型(决定调用哪个 ShaderNodeDefinition)
 * - subtype:    子类型(如 MATH 节点的 'add' / 'multiply' / 'sin';FILTER 的 'noise' / 'blur')
 * - name:       显示名(如 "Noise" / "Color #1")
 * - position:   画布坐标(由 UI 管理)
 * - inputs:     输入端口列表
 * - outputs:    输出端口列表
 * - params:     静态参数(如 scale=4.0,color=[1,0,0,1]),JsonLiteral 兼容
 * - templateKey: 在 ShaderNodeRegistry 中的 key(如 'noise' / 'uv' / 'output')
 */
export interface MaterialNode {
  id: string
  type: MaterialNodeType
  subtype?: string
  name: string
  position: { x: number; y: number }
  inputs: MaterialPort[]
  outputs: MaterialPort[]
  params: Record<string, JsonLiteral>
  templateKey: string
}

// ============================================================================
// 5. MaterialEdge - 连接边
// ============================================================================

/**
 * Material 连接边(有向:from 输出端口 → to 输入端口)。
 *
 * - id:        边唯一 id
 * - from:      源节点 id
 * - fromPort:  源节点输出端口 id
 * - to:        目标节点 id
 * - toPort:    目标节点输入端口 id
 */
export interface MaterialEdge {
  id: string
  from: string
  fromPort: string
  to: string
  toPort: string
}

// ============================================================================
// 6. MaterialGraph - 完整图
// ============================================================================

/**
 * Material Graph(节点 + 边 + 画布元数据)。
 *
 * 不变量(由 validator 保证):
 * - 有且仅有一个 OUTPUT 节点
 * - 无环(DAG)
 * - 每个输入端口最多被一条边连接
 * - 边的端口类型兼容(由 typeChecker 检查)
 */
export interface MaterialGraph {
  nodes: MaterialNode[]
  edges: MaterialEdge[]
  canvas: { width: number; height: number }
}

// ============================================================================
// 7. MaterialValidation - 校验结果
// ============================================================================

export interface MaterialValidationError {
  nodeId?: string
  edgeId?: string
  message: string
  severity: 'error' | 'warning'
}

export interface MaterialValidationResult {
  valid: boolean
  errors: MaterialValidationError[]
  warnings: MaterialValidationError[]
}

// ============================================================================
// 8. CompileContext - WGSL 生成上下文
// ============================================================================

/**
 * WGSL 生成上下文(传给 ShaderNodeDefinition.generateWGSL)。
 *
 * 包含节点执行所需的所有信息:
 * - nodeId:           当前节点 id
 * - node:             当前节点实例
 * - inputVarNames:    输入端口 → WGSL 变量名映射(上游节点输出的变量名)
 * - outputVarNames:   输出端口 → WGSL 变量名映射(本节点需要赋值的变量名)
 * - resolution:       画布分辨率(用于 UV 计算)
 * - bindings:         binding 声明(TEXTURE 节点的纹理 / 采样器)
 * - builder:          WGSLBuilder 实例(用于添加代码行)
 * - varCounter:       变量计数器(用于生成唯一变量名)
 */
export interface CompileContext {
  nodeId: string
  node: MaterialNode
  /** 输入端口 id → 上游 WGSL 变量名(已由 compiler 解析) */
  inputVarNames: Map<string, string>
  /** 输出端口 id → 本节点赋值的变量名(已由 compiler 分配) */
  outputVarNames: Map<string, string>
  resolution: { width: number; height: number }
  /** 累积的 binding 声明(由 TEXTURE 节点追加) */
  bindings: string[]
  /** 累积的工具函数声明(如 noise() 函数) */
  helperFunctions: Set<string>
  /** WGSLBuilder 实例(节点通过它写入代码行) */
  builder: WGSLBuilder
}

// ============================================================================
// 9. CompileResult - 编译结果
// ============================================================================

/**
 * Material Graph 编译为 WGSL 的结果。
 *
 * - wgsl:             生成的 WGSL 源码(完整 fragment shader)
 * - bindings:         需要的 binding 声明列表(供 runtime 创建 bind group)
 * - entryPoint:       入口函数名(默认 'fs_main')
 * - nodeVarMap:       有输出端口的节点 id → 输出变量名映射(调试用,不含 OUTPUT)
 * - compiledNodeCount: 实际编译的节点总数(含 OUTPUT,用于摘要统计)
 * - hash:             源码 hash(供 shaderCache 使用)
 */
export interface CompileResult {
  wgsl: string
  bindings: MaterialBinding[]
  entryPoint: string
  nodeVarMap: Map<string, string>
  compiledNodeCount: number
  hash: string
}

/**
 * Material Binding(运行时 bind group 需要的资源声明)。
 *
 * - kind:     'texture' | 'sampler' | 'uniform'
 * - group:    bind group index(默认 0)
 * - binding:  binding index(在 group 内)
 * - name:     WGSL 中的变量名(如 'myTexture' / 'mySampler')
 * - source:   资源来源(节点 id,用于 runtime 关联用户上传的纹理)
 */
export interface MaterialBinding {
  kind: 'texture' | 'sampler' | 'uniform'
  group: number
  binding: number
  name: string
  sourceNodeId: string
}

// ============================================================================
// 10. 默认值
// ============================================================================

export const DEFAULT_MATERIAL_CANVAS = { width: 1920, height: 1080 }

/** Material 节点尺寸(用于 Minimap / 布局) */
export const MATERIAL_NODE_SIZE = {
  width: 200,
  headerHeight: 32,
}
