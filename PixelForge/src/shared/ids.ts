/**
 * PixelForge - 稳定 ID 生成器（骨架 §6.2 接入点 1）
 *
 * 同一语义元素在多次编译中保持相同 ID。
 * 用于 Layer.id / Region.id / Effect.id / ColorBlockNode.id。
 *
 * 设计原则：
 *   - 输入相同 → 输出相同（确定性）
 *   - 输入微小变化 → 输出显著不同（雪崩效应）
 *   - 输出格式：可读前缀 + 短 hash（如 'layer_a3f2b1c0'）
 *   - 不依赖外部状态，纯函数
 */

// ============================================================================
// hash 函数 — FNV-1a 32-bit（快速、确定性、无需 crypto）
// ============================================================================

const FNV_OFFSET = 0x811c9dc5
const FNV_PRIME = 0x01000193

/**
 * FNV-1a 32-bit hash。
 * 返回无符号 32 位整数。
 */
function fnv1aHash(input: string): number {
  let hash = FNV_OFFSET
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, FNV_PRIME)
  }
  // 确保无符号
  return hash >>> 0
}

// ============================================================================
// 稳定 ID 生成
// ============================================================================

/**
 * 生成稳定 ID。
 *
 * @param source - 来源标识（如 'rule_parser' / 'user_prompt' / 'system_default'）
 * @param content - 内容描述（如 'solid_color_red' / 'gradient_blue_to_red'）
 * @param prefix - 可选前缀（如 'layer' / 'region' / 'effect'），默认无前缀
 * @returns 稳定 ID 字符串（如 'layer_a3f2b1c0'）
 *
 * @example
 * stableId('rule_parser', 'solid_color_red', 'layer') // 'layer_a3f2b1c0'
 * stableId('rule_parser', 'solid_color_red', 'layer') // 'layer_a3f2b1c0'（相同输入→相同输出）
 */
export function stableId(source: string, content: string, prefix?: string): string {
  const hash = fnv1aHash(`${source}::${content}`)
  const hex = hash.toString(16).padStart(8, '0')
  return prefix ? `${prefix}_${hex}` : hex
}

/**
 * 生成图层稳定 ID。
 */
export function stableLayerId(source: string, content: string): string {
  return stableId(source, content, 'layer')
}

/**
 * 生成区域稳定 ID。
 */
export function stableRegionId(source: string, content: string): string {
  return stableId(source, content, 'region')
}

/**
 * 生成效果稳定 ID。
 */
export function stableEffectId(source: string, content: string): string {
  return stableId(source, content, 'effect')
}

/**
 * 生成色块稳定 ID（骨架 §5.4 / §6.2 接入点 1）。
 * 用于 ColorBlockNode.id，基于来源 + 像素坐标 + 深度生成确定性 ID。
 */
export function stableColorBlockId(source: string, content: string): string {
  return stableId(source, content, 'cb')
}

/**
 * 生成全局唯一 ID（用于 patch id 等不需要稳定的场景）。
 * 使用时间戳 + 随机数，保证唯一性但不保证稳定性。
 */
export function uniqueId(prefix?: string): string {
  const ts = Date.now().toString(36)
  const rand = Math.random().toString(36).substring(2, 10)
  return prefix ? `${prefix}_${ts}${rand}` : `${ts}${rand}`
}
