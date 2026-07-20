/**
 * 时间轴关键帧类型定义。
 *
 * Keyframe 表示某个参数在指定帧上的取值 + 缓动方式。
 * ParameterTrack 把关键帧绑定到具体 layer 的具体参数上,
 * 拖动播放头时由 evaluator 计算插值,再由 player 生成 ValuePatch。
 */

export type Easing = 'linear' | 'ease' | 'hold'

export interface Keyframe {
  id: string
  /** 帧号(整数,>=0) */
  frame: number
  /** 参数值(0-1,由 player 按 paramKey 语义换算成实际 patch value) */
  value: number
  easing: Easing
}

export interface ParameterTrack {
  id: string
  /** 显示名(中文) */
  label: string
  /** 对应 RenderIR.layers[*].id */
  layerId: string
  /** 对应 layer.params 内的 key */
  parameter: string
  keyframes: Keyframe[]
}

/**
 * 把 slider 的 0-1 value 转成 ValuePatch.value。
 * - 标量 paramKey(radius / amount / scale 等):直接传 number
 * - 数组 paramKey(color / colorA / center 等):包装成 [v, v, v, 1] / [v, v]
 *
 * 与 App.vue 内的同名函数保持一致(为便于 player 独立调用,这里复制一份)。
 */
export function toPatchValue(paramKey: string, value: number): number | number[] {
  const arrayParamKeys = new Set(['color', 'colorA', 'colorB', 'fill', 'background'])
  if (arrayParamKeys.has(paramKey)) {
    return [value, value, value, 1]
  }
  if (paramKey === 'center' || paramKey === 'from' || paramKey === 'to') {
    return [value, value]
  }
  return value
}
