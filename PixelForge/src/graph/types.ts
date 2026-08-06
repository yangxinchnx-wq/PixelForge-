/**
 * RenderIR Graph Editor 类型定义(Step 25)。
 *
 * 与 RenderIR 的关系:
 * - RenderIR 是「线性 Layer 数组」(骨架 §4.1.2),无法表达 Layer 间的数据流。
 * - RenderGraph 是「有向无环图 DAG」,可表达 Layer/Effect 间的输入输出关系。
 * - GraphCompiler 负责 Graph → RenderIR 的转换(拓扑排序 + 节点展开)。
 *
 * 节点类型(NodeType):
 *   - REGION:     对应 Layer(opcode 必须是 5 个受支持 opcode 之一)
 *   - EFFECT:     对应 Effect(type 必须是 5 个受支持 effect 之一)
 *   - COMPOSITE:  合并多个输入到单个 Region(不对应 IR 实体,编译时展开为 region.layerRefs)
 *   - OUTPUT:     画布输出节点(每个 Graph 只能有 1 个 OUTPUT 节点)
 *   - INPUT:      外部输入(预留:图像纹理输入,Phase B+ 启用)
 *
 * 端口(Port):
 *   - texture:  纹理数据流(Region/Effect 节点之间)
 *   - value:    数值参数(预留:关键帧驱动,Phase F+ 启用)
 *
 * 边(Edge)的语义:
 *   - fromPort → toPort 必须类型匹配(texture → texture, value → value)
 *   - EFFECT 节点的 input 接 REGION 节点的 output(targetLayer 由前驱推导)
 *   - COMPOSITE 节点可接多个输入(合并到同一 region)
 *   - OUTPUT 节点只能有 1 个输入(最终合成结果)
 */

import type { JsonLiteral } from '@/shared/types'

/**
 * 节点类型(决定节点在编译时的展开方式)。
 *
 * 新增 SUBGRAPH 类型(借鉴 Gigi SubGraphs.cpp):
 * - SUBGRAPH 节点引用一个 SubGraphDefinition
 * - 编译时递归内联为普通节点(inlineSubGraphs)
 * - 支持参数覆盖和实例化
 */
export type NodeType = 'INPUT' | 'REGION' | 'EFFECT' | 'COMPOSITE' | 'OUTPUT' | 'SUBGRAPH'

/**
 * 端口数据类型。
 * - 'texture': 纹理数据流(默认,所有 REGION/EFFECT 节点的输入输出)
 * - 'value':   数值参数(预留,关键帧驱动用)
 */
export type PortType = 'texture' | 'value'

/**
 * 节点端口(输入或输出)。
 *
 * - id:    端口 ID(在节点内唯一,如 'output' / 'input_0')
 * - name:  端口可读名(如 'texture' / 'source')
 * - type:  数据类型(texture / value)
 */
export interface Port {
  id: string
  name: string
  type: PortType
}

/**
 * 节点在画布上的位置(像素坐标,相对于画布原点)。
 */
export interface NodePosition {
  x: number
  y: number
}

/**
 * Graph 节点。
 *
 * - id:           节点稳定 ID(用于 edge 引用)
 * - type:         节点类型(REGION/EFFECT/COMPOSITE/OUTPUT/INPUT)
 * - name:         可读名(如 '星空噪声' / '银河旋转' / '电影调色')
 * - position:     画布坐标(用于 UI 渲染)
 * - inputs:       输入端口列表
 * - outputs:      输出端口列表
 * - params:       节点参数(对应 Layer.params / Effect.params)
 * - opcodeName:   REGION 节点的 opcode 名(如 'NOISE'),EFFECT 节点的 effect type(如 'blur')
 * - templateKey:  来源模板 key(可选,用于追溯 NodeRegistry)
 *
 * 注意:
 * - REGION 节点的 opcodeName 必须是 SUPPORTED_OPCODE_NAMES 之一
 * - EFFECT 节点的 opcodeName 必须是 SUPPORTED_EFFECT_TYPES 之一
 * - COMPOSITE / OUTPUT / INPUT 节点无 opcodeName
 */
export interface GraphNode {
  id: string
  type: NodeType
  name: string
  position: NodePosition
  inputs: Port[]
  outputs: Port[]
  params: Record<string, JsonLiteral>
  opcodeName?: string
  templateKey?: string
}

/**
 * Graph 边(节点间的连接)。
 *
 * - from:       源节点 ID
 * - fromPort:   源节点输出端口 ID
 * - to:         目标节点 ID
 * - toPort:     目标节点输入端口 ID
 *
 * 注意:id 由 `${from}:${fromPort}->${to}:${toPort}` 拼接,可省略显式 id 字段。
 */
export interface GraphEdge {
  id: string
  from: string
  fromPort: string
  to: string
  toPort: string
}

/**
 * 完整的 Render Graph。
 *
 * - nodes:  节点列表(顺序无意义,编译时按拓扑序处理)
 * - edges:  边列表
 * - canvas: 画布尺寸(可选,用于编译时生成 RenderIR.canvas)
 *
 * 不变量(由 validator 强制):
 * - 必须有且仅有 1 个 OUTPUT 节点
 * - 不能有环(DFS 检测)
 * - 所有 edge 的 from/to 必须指向存在的节点
 * - edge 的端口类型必须匹配
 */
export interface RenderGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
  canvas?: { width: number; height: number }
  /** 子图定义库（编译时由 inlineSubGraphs 消费，内联后清空） */
  subgraphLibrary?: SubGraphDefinition[]
}

/**
 * Graph 校验结果。
 *
 * - valid:      是否通过校验
 * - errors:     阻塞性错误(必须修复才能编译)
 * - warnings:   非阻塞性警告(如悬空节点)
 */
export interface ValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

// ============================================================================
// 子图(SubGraph)类型定义(借鉴 Gigi SubGraphs.cpp)
// ============================================================================

/**
 * 子图端口定义。
 *
 * 描述子图的输入/输出接口，绑定到内部节点的某个端口。
 * 编译时，外部连接到子图端口的边会被重定向到绑定的内部节点端口。
 *
 * - id:       端口 ID（在子图内唯一，如 'input' / 'output'）
 * - name:     端口可读名（如 '背景' / '效果'）
 * - type:     数据类型（texture / value）
 * - boundTo:  绑定到内部节点的端口（nodeId + portId）
 */
export interface SubGraphPort {
  id: string
  name: string
  type: PortType
  boundTo: { nodeId: string; portId: string }
}

/**
 * 子图参数定义。
 *
 * 子图可暴露参数供外部配置，参数在内部节点中通过 ${paramKey} 引用。
 * 实例化时可通过 paramOverrides 覆盖默认值。
 *
 * - key:          参数 key（在子图内唯一）
 * - name:         参数可读名
 * - type:         参数类型
 * - defaultValue: 默认值
 * - description:  参数描述（可选）
 */
export interface SubGraphParam {
  key: string
  name: string
  type: 'number' | 'string' | 'boolean' | 'color'
  defaultValue: JsonLiteral
  description?: string
}

/**
 * 子图定义（可复用的节点组合模块）。
 *
 * 借鉴 Gigi 的 .gg 文件设计：
 * - 子图是独立的节点+边集合
 * - 通过 inputPorts / outputPorts 暴露接口
 * - 通过 params 暴露可配置参数
 * - 编译时递归内联（inlineSubGraphs）
 *
 * - id:           子图唯一 ID
 * - name:         子图名称
 * - description:  子图描述
 * - version:      子图版本
 * - inputPorts:   输入端口定义
 * - outputPorts:  输出端口定义
 * - nodes:        内部节点
 * - edges:        内部边
 * - params:       可配置参数
 * - createdAt:    创建时间
 * - updatedAt:    更新时间
 */
export interface SubGraphDefinition {
  id: string
  name: string
  description: string
  version: string
  inputPorts: SubGraphPort[]
  outputPorts: SubGraphPort[]
  nodes: GraphNode[]
  edges: GraphEdge[]
  params: SubGraphParam[]
  createdAt: number
  updatedAt: number
}

/**
 * 子图节点（引用 SubGraphDefinition 的实例）。
 *
 * - type:          固定为 'SUBGRAPH'
 * - subgraphId:    引用的子图定义 ID
 * - paramOverrides: 参数覆盖（覆盖子图定义的默认值）
 * - instanceId:    实例 ID（区分同一子图的不同实例，用于内联时 ID 前缀）
 */
export interface SubGraphNode extends Omit<GraphNode, 'type'> {
  type: 'SUBGRAPH'
  subgraphId: string
  paramOverrides: Record<string, JsonLiteral>
  instanceId: string
}

/**
 * 受支持的 EFFECT type 字符串(与 regionCompiler.ts 的 EFFECT_TYPE_IDS 对齐)。
 */
export const SUPPORTED_EFFECT_TYPES = [
  'blur',
  'bloom',
  'color_shift',
  'vignette',
  'mask',
] as const

export type SupportedEffectType = (typeof SUPPORTED_EFFECT_TYPES)[number]

/**
 * 受支持的 REGION opcode 名(与 generator/types.ts 的 SUPPORTED_OPCODE_NAMES 对齐)。
 */
export const SUPPORTED_GRAPH_OPCODE_NAMES = [
  'SOLID_COLOR',
  'LINEAR_GRADIENT',
  'NOISE',
  'CIRCLE_SHAPE',
  'IMAGE_TEXTURE',
] as const

export type SupportedGraphOpcodeName = (typeof SUPPORTED_GRAPH_OPCODE_NAMES)[number]

/**
 * 默认画布尺寸(与 generator/renderIRGenerator.ts 对齐)。
 */
export const DEFAULT_GRAPH_CANVAS = {
  width: 1920,
  height: 1080,
} as const

/**
 * 默认节点尺寸(用于 UI 布局计算与连接线锚点)。
 */
export const NODE_SIZE = {
  width: 180,
  headerHeight: 32,
  portHeight: 22,
  padding: 10,
} as const
