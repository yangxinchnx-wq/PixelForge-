/**
 * Material Asset ID 生成器 — 为每个材质资产生成全局唯一标识符。
 *
 * 设计原则:
 * - 使用 UUID v4 算法（RFC 4122）保证全局唯一性
 * - 追加时间戳前缀，便于排序和调试
 * - 带应用前缀 'pfmat_'，避免与其他系统 ID 冲突
 * - 支持 crypto.randomUUID（现代浏览器）和 fallback 手动实现
 *
 * 格式: pfmat_<base36_timestamp>_<uuid_v4>
 * 示例: pfmat_lz3k8n1p_550e8400-e29b-41d4-a716-446655440000
 */

// ============================================================================
// 1. UUID v4 生成
// ============================================================================

/**
 * 生成 UUID v4 字符串。
 *
 * 优先使用浏览器原生 crypto.randomUUID()，
 * 不可用时回退到基于 crypto.getRandomValues 的手动实现。
 *
 * @returns 形如 "550e8400-e29b-41d4-a716-446655440000" 的 UUID 字符串
 */
export function generateUUIDv4(): string {
  // 现代浏览器路径（安全且高效）
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  // Fallback: 使用 getRandomValues 手动构建 UUID v4
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)

    // 设置 version (4) 和 variant (10xx)
    bytes[6] = (bytes[6] & 0x0f) | 0x40 // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80 // variant 10xx

    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'))
    return `${hex[0]}${hex[1]}${hex[2]}${hex[3]}-${hex[4]}${hex[5]}-${hex[6]}${hex[7]}-${hex[8]}${hex[9]}-${hex[10]}${hex[11]}${hex[12]}${hex[13]}${hex[14]}${hex[15]}`
  }

  // 最后 fallback: Math.random（不推荐用于安全场景，但保证功能可用）
  return generateUUIDv4Fallback()
}

/**
 * Math.random fallback（仅在 crypto API 不可用时使用）。
 */
function generateUUIDv4Fallback(): string {
  const template = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'
  return template.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

// ============================================================================
// 2. 材质资产 ID 生成
// ============================================================================

/** 材质 ID 前缀 */
export const MATERIAL_ID_PREFIX = 'pfmat'

/**
 * 生成全局唯一的材质资产 ID。
 *
 * 格式: pfmat_<base36_timestamp>_<uuid_v4>
 *
 * - 前缀 'pfmat' 标识来源为 PixelForge 材质系统
 * - 时间戳（base36 编码）便于人眼排序和定位
 * - UUID v4 保证跨设备/跨时间的全局唯一性
 *
 * @returns 形如 "pfmat_lz3k8n1p_550e8400-e29b-41d4-a716-446655440000" 的 ID
 */
export function generateMaterialId(): string {
  const timestamp = Date.now().toString(36)
  const uuid = generateUUIDv4()
  return `${MATERIAL_ID_PREFIX}_${timestamp}_${uuid}`
}

/**
 * 验证一个字符串是否为合法的材质资产 ID。
 *
 * @param id 待验证的 ID
 * @returns 是否合法
 */
export function isValidMaterialId(id: string): boolean {
  if (!id || typeof id !== 'string') return false
  if (!id.startsWith(MATERIAL_ID_PREFIX + '_')) return false
  // pfmat_<timestamp>_<uuid>
  // 至少 3 段，用 _ 分割
  const parts = id.split('_')
  if (parts.length < 3) return false
  // 中间段是 base36 时间戳
  const timestampPart = parts[1]
  if (!/^[0-9a-z]+$/.test(timestampPart)) return false
  // 后面的部分拼起来应该是一个合法 UUID
  const uuidPart = parts.slice(2).join('_')
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  return uuidRegex.test(uuidPart)
}
