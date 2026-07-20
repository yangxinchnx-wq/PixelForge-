/**
 * Type Checker(Step 28.8)— Material Graph 端口类型兼容检查。
 *
 * 职责:
 * - 判断两个端口是否可以连接(类型兼容性)
 * - 提供详细错误信息(用户在 UI 看到 "Invalid Connection: ...")
 * - 与 graphStore.connect 协作:连接前先检查
 *
 * 兼容规则(spec §8):
 *   float    ← float
 *   vec2     ← vec2, float(广播)
 *   vec3     ← vec3, vec4(截断 .rgb), float(广播)
 *   vec4     ← vec4, vec3(扩展 alpha=1), vec2(扩展 z=0,w=1), float(广播)
 *   texture  ← texture(严格相同)
 *
 * 不兼容:
 *   texture  ← float/vec*(禁止)
 *   float    ← texture(禁止)
 *   vec2     ← vec3, vec4(下转需要显式截断,禁止隐式)
 *
 * 注:vec2 ← vec3/vec4 的截断(.xy)在 castPortType 中支持,
 *     但 typeChecker 默认拒绝,避免用户混淆。
 *     若用户明确需要,可通过 UI 显式添加 "Swizzle" 节点。
 */

import type { MaterialPort, PortType } from './types'

/**
 * 类型兼容矩阵。
 * compatible[toType] = Set<fromType>
 */
const COMPATIBLE: Record<PortType, Set<PortType>> = {
  float: new Set<PortType>(['float']),
  vec2: new Set<PortType>(['vec2', 'float']),
  vec3: new Set<PortType>(['vec3', 'vec4', 'float']),
  vec4: new Set<PortType>(['vec4', 'vec3', 'vec2', 'float']),
  texture: new Set<PortType>(['texture']),
}

/**
 * 检查两个端口是否可以连接。
 *
 * @param fromPort 上游输出端口
 * @param toPort   下游输入端口
 * @returns { ok: true } 或 { ok: false, reason: string }
 */
export function canConnectPorts(
  fromPort: MaterialPort,
  toPort: MaterialPort,
): { ok: boolean; reason?: string } {
  // 方向检查
  if (fromPort.direction !== 'output') {
    return { ok: false, reason: `源端口 ${fromPort.name} 不是输出端口` }
  }
  if (toPort.direction !== 'input') {
    return { ok: false, reason: `目标端口 ${toPort.name} 不是输入端口` }
  }

  // 类型兼容检查
  const allowed = COMPATIBLE[toPort.type]
  if (!allowed.has(fromPort.type)) {
    return {
      ok: false,
      reason: `类型不兼容: ${fromPort.type} → ${toPort.type}(允许: ${Array.from(allowed).join(', ')})`,
    }
  }

  return { ok: true }
}

/**
 * 检查两个端口是否严格同类型(用于自动 cast 判断)。
 */
export function isStrictMatch(from: PortType, to: PortType): boolean {
  return from === to
}

/**
 * 判断是否需要类型转换(用于 compiler 在变量引用处插入 cast 表达式)。
 */
export function needsCast(from: PortType, to: PortType): boolean {
  return from !== to
}

/**
 * 获取所有兼容的源类型(用于 UI 高亮可连接端口)。
 */
export function getCompatibleFromTypes(toType: PortType): PortType[] {
  return Array.from(COMPATIBLE[toType])
}

/**
 * 获取所有兼容的目标类型(用于 UI 高亮可连接端口)。
 */
export function getCompatibleToTypes(fromType: PortType): PortType[] {
  const result: PortType[] = []
  for (const [toType, fromSet] of Object.entries(COMPATIBLE)) {
    if (fromSet.has(fromType)) {
      result.push(toType as PortType)
    }
  }
  return result
}
