/**
 * PixelForge - Deterministic Seed（骨架 §8.2 跨 Phase 硬约束）
 *
 * 所有程序化生成（NOISE、未来 SWIRL 等）必须使用此 seed。
 *
 * 设计原则：
 *   - 输入相同 → 输出相同（确定性）
 *   - 输出为 32-bit 无符号整数
 *   - 不依赖外部状态，纯函数
 *   - 与 ids.ts 共享 hash 算法但独立导出
 */

// ============================================================================
// hash 函数 — 与 ids.ts 共享 FNV-1a 算法
// ============================================================================

const FNV_OFFSET = 0x811c9dc5
const FNV_PRIME = 0x01000193

function fnv1aHash(input: string): number {
  let hash = FNV_OFFSET
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, FNV_PRIME)
  }
  return hash >>> 0
}

// ============================================================================

/**
 * 根据 source 字符串生成确定性 32-bit seed。
 *
 * @param source - 任意字符串（如 prompt 内容、场景名称等）
 * @returns 无符号 32-bit 整数 seed
 *
 * @example
 * createSeed('星空背景')  // 3827156492
 * createSeed('星空背景')  // 3827156492（相同输入→相同输出）
 */
export function createSeed(source: string): number {
  return fnv1aHash(source)
}

/**
 * 默认 seed（当没有明确来源时使用）。
 */
export const DEFAULT_SEED = 42
