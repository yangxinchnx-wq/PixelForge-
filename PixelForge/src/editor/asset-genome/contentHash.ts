/**
 * Content Hash & Dedup(Step 35.4)— 内容哈希 + 去重 + 相似检测。
 *
 * 职责:
 * - 计算资产内容哈希(SHA-256 / FNV-1a 降级)
 * - 基于 contentHash 检测重复资产
 * - 基于元数据相似度进行相似检测(名称/标签/类型)
 * - 提供去重建议(保留哪个、合并哪个)
 *
 * 不职责:
 * - 不做像素级相似检测(过于复杂,需感知哈希 pHash,后续扩展)
 * - 不自动删除资产(只提供去重建议,由用户决定)
 */
// ============================================================================
// 1. 哈希计算
// ============================================================================

/**
 * 计算字符串的 FNV-1a 32-bit 哈希(纯函数,无外部依赖)。
 * 用于非加密场景的内容指纹(快速、确定性)。
 */
export function fnv1a32(input: string): string {
  const FNV_OFFSET = 0x811c9dc5
  const FNV_PRIME = 0x01000193
  let hash = FNV_OFFSET
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, FNV_PRIME)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/**
 * 计算资产内容哈希(基于元数据 + payloadRef)。
 *
 * 算法:
 * - 拼接关键字段(kind + name + size + payloadRef + tags 排序)
 * - 用 FNV-1a 计算指纹
 * - 返回 'fnv1a_' 前缀的 8 位十六进制字符串
 *
 * @param kind 资产种类
 * @param name 名称
 * @param size 大小(可选)
 * @param payloadRef payload 引用(可选)
 * @param tags 标签列表(排序后参与哈希)
 */
export function computeContentHash(params: {
  kind: string
  name: string
  size?: number
  payloadRef?: string
  tags?: string[]
}): string {
  const { kind, name, size, payloadRef, tags = [] } = params
  const sortedTags = [...tags].sort().join(',')
  const content = `${kind}|${name}|${size ?? 0}|${payloadRef ?? ''}|${sortedTags}`
  return `fnv1a_${fnv1a32(content)}`
}

/**
 * 异步计算二进制内容的 SHA-256 哈希(浏览器 SubtleCrypto)。
 * 若 SubtleCrypto 不可用,降级为 FNV-1a。
 *
 * @param data 二进制数据
 * @returns SHA-256 十六进制字符串(sha256_ 前缀)或 FNV-1a 降级
 */
export async function computeBinaryHash(data: ArrayBuffer | Uint8Array): Promise<string> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)

  if (typeof crypto !== 'undefined' && crypto.subtle) {
    try {
      const hashBuffer = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
      const hashArray = Array.from(new Uint8Array(hashBuffer))
      const hex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
      return `sha256_${hex}`
    } catch {
      // 降级
    }
  }

  // FNV-1a 降级
  let hash = 0x811c9dc5
  const FNV_PRIME = 0x01000193
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i]
    hash = Math.imul(hash, FNV_PRIME)
  }
  return `fnv1a_${(hash >>> 0).toString(16).padStart(8, '0')}`
}

// ============================================================================
// 2. 重复检测
// ============================================================================

/** 资产哈希索引(contentHash → assetId 列表) */
export type HashIndex = Map<string, string[]>

/** 重复组(contentHash 相同的资产集合) */
export interface DuplicateGroup {
  /** 共享的内容哈希 */
  contentHash: string
  /** 重复的资产 ID 列表 */
  assetIds: string[]
}

/**
 * 构建哈希索引。
 *
 * @param assets 资产列表(含 id + contentHash)
 * @returns 哈希索引
 */
export function buildHashIndex(
  assets: Array<{ id: string; contentHash?: string }>,
): HashIndex {
  const index: HashIndex = new Map()
  for (const asset of assets) {
    if (!asset.contentHash) continue
    const existing = index.get(asset.contentHash) ?? []
    existing.push(asset.id)
    index.set(asset.contentHash, existing)
  }
  return index
}

/**
 * 查找重复资产组(contentHash 相同,且至少 2 个)。
 *
 * @param assets 资产列表
 * @returns 重复组列表
 */
export function findDuplicates(
  assets: Array<{ id: string; contentHash?: string }>,
): DuplicateGroup[] {
  const index = buildHashIndex(assets)
  const result: DuplicateGroup[] = []
  for (const [contentHash, assetIds] of index) {
    if (assetIds.length >= 2) {
      result.push({ contentHash, assetIds })
    }
  }
  return result
}

/**
 * 检查资产是否有重复(同 contentHash 的其他资产)。
 *
 * @param assets 资产列表
 * @param assetId 待检查的资产 ID
 * @returns 重复的资产 ID 列表(不含自身,空数组表示无重复)
 */
export function findDuplicatesOf(
  assets: Array<{ id: string; contentHash?: string }>,
  assetId: string,
): string[] {
  const target = assets.find((a) => a.id === assetId)
  if (!target?.contentHash) return []
  return assets
    .filter((a) => a.id !== assetId && a.contentHash === target.contentHash)
    .map((a) => a.id)
}

// ============================================================================
// 3. 相似检测(基于元数据)
// ============================================================================

/** 相似度结果 */
export interface SimilarityResult {
  /** 资产 A ID */
  assetAId: string
  /** 资产 B ID */
  assetBId: string
  /** 相似度分数 [0, 1] */
  score: number
  /** 相似原因 */
  reasons: string[]
}

/**
 * 计算两个资产的相似度(基于名称/标签/种类)。
 *
 * 算法:
 * - 名称相似度:Jaccard 字符集交集(0-1)
 * - 标签相似度:Jaccard 标签集交集(0-1)
 * - 种类相似度:同 kind=1,同 category=0.5,否则 0
 * - 综合分:0.4*name + 0.4*tags + 0.2*kind
 *
 * @param a 资产 A
 * @param b 资产 B
 * @returns 相似度结果
 */
export function computeSimilarity(
  a: { id: string; name: string; kind: string; category: string; tags: string[] },
  b: { id: string; name: string; kind: string; category: string; tags: string[] },
): SimilarityResult {
  const reasons: string[] = []

  // 名称相似度(Jaccard 字符集)
  const nameA = new Set(a.name.toLowerCase().split(''))
  const nameB = new Set(b.name.toLowerCase().split(''))
  const nameIntersect = new Set([...nameA].filter((x) => nameB.has(x)))
  const nameUnion = new Set([...nameA, ...nameB])
  const nameScore = nameUnion.size === 0 ? 0 : nameIntersect.size / nameUnion.size
  if (nameScore > 0.5) reasons.push('名称相似')

  // 标签相似度(Jaccard)
  const tagA = new Set(a.tags)
  const tagB = new Set(b.tags)
  const tagIntersect = new Set([...tagA].filter((x) => tagB.has(x)))
  const tagUnion = new Set([...tagA, ...tagB])
  const tagScore = tagUnion.size === 0 ? 0 : tagIntersect.size / tagUnion.size
  if (tagScore > 0.5) reasons.push('标签重叠')

  // 种类相似度
  let kindScore = 0
  if (a.kind === b.kind) {
    kindScore = 1
    reasons.push('同种类')
  } else if (a.category === b.category) {
    kindScore = 0.5
    reasons.push('同大类')
  }

  const score = 0.4 * nameScore + 0.4 * tagScore + 0.2 * kindScore

  return {
    assetAId: a.id,
    assetBId: b.id,
    score: Math.round(score * 100) / 100,
    reasons,
  }
}

/**
 * 查找所有相似资产对(相似度 >= threshold)。
 *
 * @param assets 资产列表
 * @param threshold 阈值(默认 0.6)
 * @returns 相似对列表
 */
export function findSimilarPairs(
  assets: Array<{ id: string; name: string; kind: string; category: string; tags: string[] }>,
  threshold = 0.6,
): SimilarityResult[] {
  const result: SimilarityResult[] = []
  for (let i = 0; i < assets.length; i++) {
    for (let j = i + 1; j < assets.length; j++) {
      const sim = computeSimilarity(assets[i], assets[j])
      if (sim.score >= threshold) result.push(sim)
    }
  }
  return result.sort((a, b) => b.score - a.score)
}

/**
 * 查找与指定资产相似的所有其他资产。
 *
 * @param assets 资产列表
 * @param assetId 目标资产 ID
 * @param threshold 阈值(默认 0.6)
 */
export function findSimilarTo(
  assets: Array<{ id: string; name: string; kind: string; category: string; tags: string[] }>,
  assetId: string,
  threshold = 0.6,
): SimilarityResult[] {
  const target = assets.find((a) => a.id === assetId)
  if (!target) return []
  const result: SimilarityResult[] = []
  for (const asset of assets) {
    if (asset.id === assetId) continue
    const sim = computeSimilarity(target, asset)
    if (sim.score >= threshold) result.push(sim)
  }
  return result.sort((a, b) => b.score - a.score)
}

// ============================================================================
// 4. 去重建议
// ============================================================================

/** 去重建议 */
export interface DedupSuggestion {
  /** 保留的资产 ID */
  keepId: string
  /** 可移除的资产 ID 列表 */
  removeIds: string[]
  /** 共享的内容哈希 */
  contentHash: string
  /** 建议原因 */
  reason: string
}

/**
 * 生成去重建议:对于每组重复,保留最新创建的(createdAt 最大)。
 *
 * @param assets 资产列表(含 id + contentHash + createdAt)
 * @returns 去重建议列表
 */
export function generateDedupSuggestions(
  assets: Array<{ id: string; contentHash?: string; createdAt: number }>,
): DedupSuggestion[] {
  const dupGroups = findDuplicates(assets)
  const suggestions: DedupSuggestion[] = []

  for (const group of dupGroups) {
    const groupAssets = assets.filter((a) => group.assetIds.includes(a.id))
    if (groupAssets.length < 2) continue

    // 保留 createdAt 最大的(最新创建的)
    const sorted = [...groupAssets].sort((a, b) => b.createdAt - a.createdAt)
    const keep = sorted[0]
    const remove = sorted.slice(1)

    suggestions.push({
      keepId: keep.id,
      removeIds: remove.map((a) => a.id),
      contentHash: group.contentHash,
      reason: `保留最新创建的资产(${keep.id}),可移除 ${remove.length} 个重复项`,
    })
  }

  return suggestions
}
