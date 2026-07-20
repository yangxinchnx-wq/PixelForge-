/**
 * Inspector 属性面板的数据模型。
 *
 * 设计原则:
 * - PropertySchema 描述"如何渲染某个参数"(label / 控件类型 / 范围)
 * - InspectorGroup 把参数按语义分组(Transform / Appearance / Render / ...)
 * - schema 与 layer.params 解耦:layer.params 提供值,schema 提供编辑方式
 * - 不在 schema 里写值,值始终从 runtime.currentIr.layers[*].params 实时读取
 */

/** 控件类型(决定 PropertyControl 渲染哪种 input) */
export type PropertyType = 'slider' | 'number' | 'color' | 'select' | 'toggle'

/** 单个属性 schema */
export interface PropertySchema {
  /** 对应 layer.params 内的 key */
  key: string
  /** 中文显示名 */
  label: string
  /** 控件类型 */
  type: PropertyType
  /** slider / number 的范围 */
  min?: number
  max?: number
  step?: number
  /** select 的可选值列表 */
  options?: Array<{ label: string; value: string | number }>
  /** 是否为只读展示(不可编辑,如 opcode) */
  readonly?: boolean
}

/** 属性分组 */
export interface InspectorGroup {
  /** 组名(英文标题,如 "Transform") */
  name: string
  /** 中文副标题 */
  subtitle?: string
  /** 该组下的属性列表 */
  properties: PropertySchema[]
}
