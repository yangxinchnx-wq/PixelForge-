import type { BlendMode } from '@/shared/types'

import type { InspectorGroup } from './inspectorTypes'

/**
 * 按 opcode 派发的属性 schema 映射。
 *
 * 每个 opcode 对应一组 InspectorGroup[],描述该类型 layer 在 Inspector 里如何展示。
 * Render 组(包含 opcode / blendMode / visible)是通用的,所有 layer 都有。
 *
 * 字段切分参考 renderIR.ts:
 *   - id / opcode        → 只读,展示在 Render 组
 *   - visible            → structural patch,toggle 控件
 *   - blendMode          → static,select 控件(Phase B 已支持)
 *   - params.*           → dynamic,value patch,按 opcode 派发不同 schema
 */

const BLEND_MODE_OPTIONS: Array<{ label: string; value: BlendMode }> = [
  { label: 'normal',   value: 'normal' },
  { label: 'multiply', value: 'multiply' },
  { label: 'screen',   value: 'screen' },
  { label: 'overlay',  value: 'overlay' },
  { label: 'add',      value: 'add' },
  { label: 'subtract', value: 'subtract' },
]

/** Render 组:通用,所有 layer 都展示(opcode / blendMode / visible) */
const renderGroup: InspectorGroup = {
  name: 'Render',
  subtitle: '渲染属性',
  properties: [
    {
      key: '__opcode__',
      label: 'opcode',
      type: 'select',
      readonly: true,
      options: [
        { label: 'SOLID_COLOR',     value: 'SOLID_COLOR' },
        { label: 'LINEAR_GRADIENT', value: 'LINEAR_GRADIENT' },
        { label: 'NOISE',           value: 'NOISE' },
        { label: 'CIRCLE_SHAPE',    value: 'CIRCLE_SHAPE' },
      ],
    },
    { key: '__blendMode__', label: 'blendMode', type: 'select', options: BLEND_MODE_OPTIONS },
    { key: '__visible__',   label: 'visible',   type: 'toggle' },
  ],
}

/** SOLID_COLOR 的 params schema */
const solidColorGroups: InspectorGroup[] = [
  {
    name: 'Color',
    subtitle: '颜色',
    properties: [
      { key: 'color', label: '填充色', type: 'color' },
    ],
  },
  renderGroup,
]

/** LINEAR_GRADIENT 的 params schema */
const linearGradientGroups: InspectorGroup[] = [
  {
    name: 'Gradient',
    subtitle: '渐变',
    properties: [
      { key: 'from',   label: '起点',   type: 'color' },
      { key: 'to',     label: '终点',   type: 'color' },
      { key: 'colorA', label: '颜色 A', type: 'color' },
      { key: 'colorB', label: '颜色 B', type: 'color' },
    ],
  },
  renderGroup,
]

/** NOISE 的 params schema */
const noiseGroups: InspectorGroup[] = [
  {
    name: 'Noise',
    subtitle: '噪声',
    properties: [
      { key: 'scale',  label: '缩放',   type: 'number', min: 1, max: 256, step: 1 },
      { key: 'amount', label: '强度',   type: 'slider', min: 0, max: 1, step: 0.01 },
      { key: 'colorA', label: '颜色 A', type: 'color' },
      { key: 'colorB', label: '颜色 B', type: 'color' },
    ],
  },
  renderGroup,
]

/** CIRCLE_SHAPE 的 params schema */
const circleShapeGroups: InspectorGroup[] = [
  {
    name: 'Circle',
    subtitle: '圆形',
    properties: [
      { key: 'center',     label: '圆心',   type: 'color' },
      { key: 'radius',     label: '半径',   type: 'slider', min: 0, max: 1, step: 0.01 },
      { key: 'fill',       label: '填充色', type: 'color' },
      { key: 'background', label: '背景色', type: 'color' },
    ],
  },
  renderGroup,
]

/** 未知 opcode 的兜底 schema:不分组,只展示 Render 组 */
const fallbackGroups: InspectorGroup[] = [renderGroup]

/** opcode 字符串 → schema 映射 */
const opcodeSchemaMap: Record<string, InspectorGroup[]> = {
  SOLID_COLOR: solidColorGroups,
  LINEAR_GRADIENT: linearGradientGroups,
  NOISE: noiseGroups,
  CIRCLE_SHAPE: circleShapeGroups,
}

/**
 * 按 opcode 取该 layer 的属性分组 schema。
 *
 * @param opcode layer.opcode 字符串(如 'LINEAR_GRADIENT')
 * @returns InspectorGroup[](始终包含 Render 组)
 */
export function getGroupsForOpcode(opcode: string): InspectorGroup[] {
  return opcodeSchemaMap[opcode] ?? fallbackGroups
}

/** 获取所有 blend mode 选项(供 PropertyControl 的 select 渲染) */
export function getBlendModeOptions() {
  return BLEND_MODE_OPTIONS
}
