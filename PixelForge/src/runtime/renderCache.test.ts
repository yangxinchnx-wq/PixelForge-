/**
 * Render Cache Tests(Step 39.4)
 *
 * 测试策略:
 * - renderSignature:签名生成稳定性 / 不同输入不同签名 / hash 格式 / createSignatureFromKeys
 * - SignatureCache:查询/命中/LRU/统计/失效/清空/边界
 * - RenderCache:三级查询逻辑 / levelDistribution / overallHitRate / L2/L3 注入统计
 *
 * 设计:纯元数据测试(不依赖真实 GPU,不依赖 compileCache)
 */
import { describe, it, expect } from 'vitest'
import {
  computeRenderSignature,
  SignatureCache,
  createSignatureFromKeys,
  type RenderSignatureInput,
} from './renderSignature'
import { RenderCache } from './renderCache'

// ============================================================================
// 辅助
// ============================================================================

function makeInput(
  staticKey = 's_abc',
  structuralKey = 'st_def',
  dynamicKey = 'd_ghi',
  width = 1920,
  height = 1080,
): RenderSignatureInput {
  return { staticKey, structuralKey, dynamicKey, canvasSize: { width, height } }
}

// ============================================================================
// 1. 渲染签名生成
// ============================================================================

describe('renderSignature / computeRenderSignature', () => {
  it('S01: 相同输入产生相同签名', () => {
    const a = computeRenderSignature(makeInput())
    const b = computeRenderSignature(makeInput())
    expect(a.hash).toBe(b.hash)
    expect(a.fullKey).toBe(b.fullKey)
  })

  it('S02: hash 是 8 位 hex', () => {
    const sig = computeRenderSignature(makeInput())
    expect(sig.hash).toMatch(/^[0-9a-f]{8}$/)
  })

  it('S03: fullKey 包含三层 key + 画布尺寸', () => {
    const sig = computeRenderSignature(makeInput('s1', 'st2', 'd3', 800, 600))
    expect(sig.fullKey).toBe('s1|st2|d3|800x600')
  })

  it('S04: staticKey 不同 → 签名不同', () => {
    const a = computeRenderSignature(makeInput('s1'))
    const b = computeRenderSignature(makeInput('s2'))
    expect(a.hash).not.toBe(b.hash)
  })

  it('S05: structuralKey 不同 → 签名不同', () => {
    const a = computeRenderSignature(makeInput(undefined, 'st1'))
    const b = computeRenderSignature(makeInput(undefined, 'st2'))
    expect(a.hash).not.toBe(b.hash)
  })

  it('S06: dynamicKey 不同 → 签名不同', () => {
    const a = computeRenderSignature(makeInput(undefined, undefined, 'd1'))
    const b = computeRenderSignature(makeInput(undefined, undefined, 'd2'))
    expect(a.hash).not.toBe(b.hash)
  })

  it('S07: 画布尺寸不同 → 签名不同', () => {
    const a = computeRenderSignature(makeInput(undefined, undefined, undefined, 1920, 1080))
    const b = computeRenderSignature(makeInput(undefined, undefined, undefined, 1280, 720))
    expect(a.hash).not.toBe(b.hash)
  })

  it('S08: 画布宽高交换 → 签名不同', () => {
    const a = computeRenderSignature(makeInput(undefined, undefined, undefined, 1920, 1080))
    const b = computeRenderSignature(makeInput(undefined, undefined, undefined, 1080, 1920))
    expect(a.hash).not.toBe(b.hash)
  })

  it('S09: createSignatureFromKeys 等价于 computeRenderSignature', () => {
    const keys = { staticKey: 's1', structuralKey: 'st2', dynamicKey: 'd3' }
    const canvas = { width: 100, height: 100 }
    const a = createSignatureFromKeys(keys, canvas)
    const b = computeRenderSignature({ ...keys, canvasSize: canvas })
    expect(a.hash).toBe(b.hash)
  })
})

// ============================================================================
// 2. SignatureCache — 基本生命周期
// ============================================================================

describe('SignatureCache / lifecycle', () => {
  it('L01: 初始 size 为 0', () => {
    const cache = new SignatureCache()
    expect(cache.size).toBe(0)
  })

  it('L02: query 未命中返回 false 并插入', () => {
    const cache = new SignatureCache()
    const sig = computeRenderSignature(makeInput())
    const hit = cache.query(sig, 0)
    expect(hit).toBe(false)
    expect(cache.size).toBe(1)
  })

  it('L03: query 命中返回 true', () => {
    const cache = new SignatureCache()
    const sig = computeRenderSignature(makeInput())
    cache.query(sig, 0) // 插入
    const hit = cache.query(sig, 1) // 命中
    expect(hit).toBe(true)
    expect(cache.size).toBe(1) // 不增加
  })

  it('L04: 不同签名各自插入', () => {
    const cache = new SignatureCache()
    cache.query(computeRenderSignature(makeInput('s1')), 0)
    cache.query(computeRenderSignature(makeInput('s2')), 0)
    expect(cache.size).toBe(2)
  })

  it('L05: get 返回条目(不更新统计)', () => {
    const cache = new SignatureCache()
    const sig = computeRenderSignature(makeInput())
    cache.query(sig, 0)
    const entry = cache.get(sig)
    expect(entry).toBeDefined()
    expect(entry!.signature.hash).toBe(sig.hash)
    expect(entry!.frameIndex).toBe(0)
    expect(entry!.hitCount).toBe(0) // query 插入时 hitCount=0
  })

  it('L06: has 检查存在性(不更新统计)', () => {
    const cache = new SignatureCache()
    const sig = computeRenderSignature(makeInput())
    expect(cache.has(sig)).toBe(false)
    cache.query(sig, 0)
    expect(cache.has(sig)).toBe(true)
  })

  it('L07: invalidate 删除单条', () => {
    const cache = new SignatureCache()
    const sig = computeRenderSignature(makeInput())
    cache.query(sig, 0)
    expect(cache.invalidate(sig)).toBe(true)
    expect(cache.size).toBe(0)
    expect(cache.has(sig)).toBe(false)
  })

  it('L08: invalidate 不存在的签名返回 false', () => {
    const cache = new SignatureCache()
    const sig = computeRenderSignature(makeInput())
    expect(cache.invalidate(sig)).toBe(false)
  })

  it('L09: clear 清空所有条目', () => {
    const cache = new SignatureCache()
    cache.query(computeRenderSignature(makeInput('s1')), 0)
    cache.query(computeRenderSignature(makeInput('s2')), 0)
    cache.clear()
    expect(cache.size).toBe(0)
  })

  it('L10: insert 显式插入(不增加 misses)', () => {
    const cache = new SignatureCache()
    const sig = computeRenderSignature(makeInput())
    cache.insert(sig, 0)
    expect(cache.size).toBe(1)
    const stats = cache.getStats()
    expect(stats.misses).toBe(0) // insert 不计 miss
    expect(stats.hits).toBe(0)
  })

  it('L11: insert 已存在签名更新 hitCount', () => {
    const cache = new SignatureCache()
    const sig = computeRenderSignature(makeInput())
    cache.insert(sig, 0)
    cache.insert(sig, 1) // 重复插入
    expect(cache.size).toBe(1)
    const entry = cache.get(sig)!
    expect(entry.hitCount).toBe(1)
  })
})

// ============================================================================
// 3. SignatureCache — LRU 淘汰
// ============================================================================

describe('SignatureCache / LRU', () => {
  it('LRU01: 池满时淘汰最久未使用', () => {
    const cache = new SignatureCache({ maxSize: 3 })
    cache.query(computeRenderSignature(makeInput('s1')), 0)
    cache.query(computeRenderSignature(makeInput('s2')), 0)
    cache.query(computeRenderSignature(makeInput('s3')), 0)
    expect(cache.size).toBe(3)

    // 插入第 4 个,触发 LRU 淘汰 s1(最久未访问)
    cache.query(computeRenderSignature(makeInput('s4')), 0)
    expect(cache.size).toBe(3)
    expect(cache.has(computeRenderSignature(makeInput('s1')))).toBe(false)
    expect(cache.has(computeRenderSignature(makeInput('s4')))).toBe(true)
  })

  it('LRU02: 命中更新 lastUsedAt(不被淘汰)', () => {
    const cache = new SignatureCache({ maxSize: 3 })
    cache.query(computeRenderSignature(makeInput('s1')), 0)
    cache.query(computeRenderSignature(makeInput('s2')), 0)
    cache.query(computeRenderSignature(makeInput('s3')), 0)

    // 访问 s1,使其 lastUsedAt 更新
    cache.query(computeRenderSignature(makeInput('s1')), 1)

    // 插入第 4 个,应淘汰 s2(现在最久未访问)
    cache.query(computeRenderSignature(makeInput('s4')), 0)
    expect(cache.has(computeRenderSignature(makeInput('s1')))).toBe(true) // s1 保留
    expect(cache.has(computeRenderSignature(makeInput('s2')))).toBe(false) // s2 淘汰
  })

  it('LRU03: 默认 maxSize = 64', () => {
    const cache = new SignatureCache()
    for (let i = 0; i < 64; i++) {
      cache.query(computeRenderSignature(makeInput(`s${i}`)), 0)
    }
    expect(cache.size).toBe(64)

    // 第 65 个触发 LRU
    cache.query(computeRenderSignature(makeInput('s64')), 0)
    expect(cache.size).toBe(64)
  })

  it('LRU04: evictions 统计累加', () => {
    const cache = new SignatureCache({ maxSize: 2 })
    cache.query(computeRenderSignature(makeInput('s1')), 0)
    cache.query(computeRenderSignature(makeInput('s2')), 0)
    cache.query(computeRenderSignature(makeInput('s3')), 0) // 淘汰 s1
    cache.query(computeRenderSignature(makeInput('s4')), 0) // 淘汰 s2
    expect(cache.getStats().evictions).toBe(2)
  })
})

// ============================================================================
// 4. SignatureCache — 统计
// ============================================================================

describe('SignatureCache / stats', () => {
  it('ST01: 初始统计全为 0', () => {
    const cache = new SignatureCache()
    const stats = cache.getStats()
    expect(stats.size).toBe(0)
    expect(stats.maxSize).toBe(64)
    expect(stats.hits).toBe(0)
    expect(stats.misses).toBe(0)
    expect(stats.hitRate).toBe(0)
    expect(stats.evictions).toBe(0)
  })

  it('ST02: 未命中计入 misses', () => {
    const cache = new SignatureCache()
    cache.query(computeRenderSignature(makeInput()), 0)
    const stats = cache.getStats()
    expect(stats.misses).toBe(1)
    expect(stats.hits).toBe(0)
    expect(stats.hitRate).toBe(0)
  })

  it('ST03: 命中计入 hits', () => {
    const cache = new SignatureCache()
    const sig = computeRenderSignature(makeInput())
    cache.query(sig, 0) // miss
    cache.query(sig, 1) // hit
    const stats = cache.getStats()
    expect(stats.hits).toBe(1)
    expect(stats.misses).toBe(1)
    expect(stats.hitRate).toBe(0.5)
  })

  it('ST04: 100% 命中率', () => {
    const cache = new SignatureCache()
    const sig = computeRenderSignature(makeInput())
    cache.query(sig, 0) // miss(插入)
    // 后续 9 次全部命中
    for (let i = 1; i < 10; i++) {
      cache.query(sig, i)
    }
    const stats = cache.getStats()
    expect(stats.hits).toBe(9)
    expect(stats.misses).toBe(1)
    expect(stats.hitRate).toBeCloseTo(0.9)
  })

  it('ST05: resetStats 清零统计但保留条目', () => {
    const cache = new SignatureCache()
    const sig = computeRenderSignature(makeInput())
    cache.query(sig, 0)
    cache.query(sig, 1)
    expect(cache.size).toBe(1)

    cache.resetStats()
    const stats = cache.getStats()
    expect(stats.hits).toBe(0)
    expect(stats.misses).toBe(0)
    expect(cache.size).toBe(1) // 条目保留
  })

  it('ST06: maxSize 自定义', () => {
    const cache = new SignatureCache({ maxSize: 16 })
    expect(cache.getStats().maxSize).toBe(16)
  })
})

// ============================================================================
// 5. RenderCache — 三级查询
// ============================================================================

describe('RenderCache / query', () => {
  it('Q01: L1+L2 未命中 → level=miss', () => {
    const cache = new RenderCache()
    const result = cache.query(makeInput(), 0, false)
    expect(result.level).toBe('miss')
    expect(result.l1Hit).toBe(false)
    expect(result.l2Hit).toBe(false)
    expect(result.l3Hit).toBe(false)
  })

  it('Q02: L1 未命中 + L2 命中 → level=L2', () => {
    const cache = new RenderCache()
    // 第一次:L1 miss + L2 hit(假设 L2 已有)
    const result = cache.query(makeInput(), 0, true)
    expect(result.level).toBe('L2')
    expect(result.l1Hit).toBe(false)
    expect(result.l2Hit).toBe(true)
  })

  it('Q03: L1 命中(第二次相同输入) → level=L1', () => {
    const cache = new RenderCache()
    const input = makeInput()
    cache.query(input, 0, false) // 第一次插入 L1
    const result = cache.query(input, 1, true) // 第二次 L1 命中(L2 也命中,因为签名相同)
    expect(result.level).toBe('L1')
    expect(result.l1Hit).toBe(true)
    expect(result.l2Hit).toBe(true)
  })

  it('Q04: L1 命中优先于 L2', () => {
    const cache = new RenderCache()
    const input = makeInput()
    cache.query(input, 0, true) // L1 miss + L2 hit → 插入 L1
    // 第二次:L1 命中,即使 L2 也命中,level=L1
    const result = cache.query(input, 1, true)
    expect(result.level).toBe('L1')
  })

  it('Q05: 返回签名信息', () => {
    const cache = new RenderCache()
    const result = cache.query(makeInput('s1', 'st2', 'd3'), 0, false)
    expect(result.signature.hash).toMatch(/^[0-9a-f]{8}$/)
    expect(result.signature.fullKey).toContain('s1')
    expect(result.frameIndex).toBe(0)
  })

  it('Q06: 不同输入产生不同签名', () => {
    const cache = new RenderCache()
    const r1 = cache.query(makeInput('s1'), 0, false)
    const r2 = cache.query(makeInput('s2'), 0, false)
    expect(r1.signature.hash).not.toBe(r2.signature.hash)
  })
})

// ============================================================================
// 6. RenderCache — 层级分布
// ============================================================================

describe('RenderCache / levelDistribution', () => {
  it('D01: 各层级计数正确', () => {
    const cache = new RenderCache()
    const input1 = makeInput('s1')
    const input2 = makeInput('s2')

    // 帧1:L1 miss + L2 miss → miss
    cache.query(input1, 0, false)
    // 帧2:L1 miss + L2 hit → L2
    cache.query(input2, 0, true)
    // 帧3:L1 hit(第二次 input1) → L1
    cache.query(input1, 1, true)
    // 帧4:L1 hit(第二次 input2) → L1
    cache.query(input2, 1, true)

    const stats = cache.getStats()
    expect(stats.levelDistribution.L1).toBe(2)
    expect(stats.levelDistribution.L2).toBe(1)
    expect(stats.levelDistribution.miss).toBe(1)
    expect(stats.levelDistribution.L3).toBe(0) // L3 不在 query 中统计
  })

  it('D02: totalQueries 累加', () => {
    const cache = new RenderCache()
    cache.query(makeInput(), 0, false)
    cache.query(makeInput(), 1, true)
    cache.query(makeInput('s2'), 0, false)
    expect(cache.getStats().totalQueries).toBe(3)
  })

  it('D03: totalHits = L1 + L2', () => {
    const cache = new RenderCache()
    const input = makeInput()
    cache.query(input, 0, false) // miss
    cache.query(input, 1, true) // L1 hit
    cache.query(makeInput('s2'), 0, true) // L2 hit
    const stats = cache.getStats()
    expect(stats.totalHits).toBe(2) // L1(1) + L2(1)
  })
})

// ============================================================================
// 7. RenderCache — 命中率
// ============================================================================

describe('RenderCache / hitRate', () => {
  it('HR01: 初始 overallHitRate 为 0', () => {
    const cache = new RenderCache()
    expect(cache.getStats().overallHitRate).toBe(0)
  })

  it('HR02: 全部 miss → overallHitRate=0', () => {
    const cache = new RenderCache()
    cache.query(makeInput('s1'), 0, false)
    cache.query(makeInput('s2'), 0, false)
    cache.query(makeInput('s3'), 0, false)
    expect(cache.getStats().overallHitRate).toBe(0)
  })

  it('HR03: 全部 L1 命中 → overallHitRate=1', () => {
    const cache = new RenderCache()
    const input = makeInput()
    cache.query(input, 0, false) // miss(插入)
    cache.query(input, 1, true) // L1 hit
    cache.query(input, 2, true) // L1 hit
    // overallHitRate = 2 hits / 3 queries
    expect(cache.getStats().overallHitRate).toBeCloseTo(2 / 3)
  })

  it('HR04: L2 命中也计入 overallHitRate', () => {
    const cache = new RenderCache()
    cache.query(makeInput('s1'), 0, true) // L2 hit
    cache.query(makeInput('s2'), 0, true) // L2 hit
    cache.query(makeInput('s3'), 0, false) // miss
    // overallHitRate = 2 / 3
    expect(cache.getStats().overallHitRate).toBeCloseTo(2 / 3)
  })

  it('HR05: L1 hitRate 独立计算', () => {
    const cache = new RenderCache()
    const input = makeInput()
    cache.query(input, 0, false) // L1 miss
    cache.query(input, 1, true) // L1 hit
    cache.query(input, 2, true) // L1 hit
    const stats = cache.getStats()
    // L1: 2 hits / 3 total(1 miss + 2 hits)
    expect(stats.l1.hitRate).toBeCloseTo(2 / 3)
  })

  it('HR06: L2 hitRate 独立计算', () => {
    const cache = new RenderCache()
    cache.query(makeInput('s1'), 0, true) // L2 hit
    cache.query(makeInput('s2'), 0, false) // L2 miss
    cache.query(makeInput('s3'), 0, true) // L2 hit
    const stats = cache.getStats()
    // L2: 2 hits / 3 total
    expect(stats.l2.hitRate).toBeCloseTo(2 / 3)
    expect(stats.l2.hits).toBe(2)
    expect(stats.l2.misses).toBe(1)
  })
})

// ============================================================================
// 8. RenderCache — L2 显式记录
// ============================================================================

describe('RenderCache / L2 explicit recording', () => {
  it('L2R01: recordL2Hit 累加', () => {
    const cache = new RenderCache()
    cache.recordL2Hit()
    cache.recordL2Hit()
    expect(cache.getStats().l2.hits).toBe(2)
  })

  it('L2R02: recordL2Miss 累加', () => {
    const cache = new RenderCache()
    cache.recordL2Miss()
    expect(cache.getStats().l2.misses).toBe(1)
  })

  it('L2R03: recordL2Hit/Miss 影响 hitRate', () => {
    const cache = new RenderCache()
    cache.recordL2Hit()
    cache.recordL2Hit()
    cache.recordL2Miss()
    expect(cache.getStats().l2.hitRate).toBeCloseTo(2 / 3)
  })

  it('L2R04: l2.maxSize 默认 32', () => {
    const cache = new RenderCache()
    expect(cache.getStats().l2.maxSize).toBe(32)
  })

  it('L2R05: l2.maxSize 自定义', () => {
    const cache = new RenderCache({ l2MaxSize: 64 })
    expect(cache.getStats().l2.maxSize).toBe(64)
  })
})

// ============================================================================
// 9. RenderCache — L3 注入
// ============================================================================

describe('RenderCache / L3 injection', () => {
  it('L301: 初始 L3 统计全为 0', () => {
    const cache = new RenderCache()
    const stats = cache.getStats().l3
    expect(stats.textureHits).toBe(0)
    expect(stats.textureMisses).toBe(0)
    expect(stats.textureHitRate).toBe(0)
    expect(stats.bufferHits).toBe(0)
    expect(stats.bufferMisses).toBe(0)
    expect(stats.bufferHitRate).toBe(0)
    expect(stats.texturePoolSize).toBe(0)
    expect(stats.bufferPoolSize).toBe(0)
  })

  it('L302: setL3Stats 注入纹理统计', () => {
    const cache = new RenderCache()
    cache.setL3Stats({
      textureHits: 8,
      textureMisses: 2,
      texturePoolSize: 10,
    })
    const stats = cache.getStats().l3
    expect(stats.textureHits).toBe(8)
    expect(stats.textureMisses).toBe(2)
    expect(stats.textureHitRate).toBeCloseTo(0.8)
    expect(stats.texturePoolSize).toBe(10)
  })

  it('L303: setL3Stats 注入 buffer 统计', () => {
    const cache = new RenderCache()
    cache.setL3Stats({
      bufferHits: 6,
      bufferMisses: 4,
      bufferPoolSize: 20,
    })
    const stats = cache.getStats().l3
    expect(stats.bufferHits).toBe(6)
    expect(stats.bufferMisses).toBe(4)
    expect(stats.bufferHitRate).toBeCloseTo(0.6)
    expect(stats.bufferPoolSize).toBe(20)
  })

  it('L304: setL3Stats 部分更新(不覆盖未传字段)', () => {
    const cache = new RenderCache()
    cache.setL3Stats({ textureHits: 10, textureMisses: 0 })
    cache.setL3Stats({ bufferHits: 5, bufferMisses: 5 })
    const stats = cache.getStats().l3
    expect(stats.textureHits).toBe(10) // 保留
    expect(stats.bufferHits).toBe(5) // 新增
  })

  it('L305: setL3Stats 自动计算 hitRate', () => {
    const cache = new RenderCache()
    cache.setL3Stats({ textureHits: 3, textureMisses: 1 })
    expect(cache.getStats().l3.textureHitRate).toBe(0.75)

    cache.setL3Stats({ textureMisses: 3 }) // 更新 misses
    expect(cache.getStats().l3.textureMisses).toBe(3)
    expect(cache.getStats().l3.textureHitRate).toBeCloseTo(0.5) // 3 / (3+3)
  })

  it('L306: setL3Stats 零查询时 hitRate=0', () => {
    const cache = new RenderCache()
    cache.setL3Stats({ textureHits: 0, textureMisses: 0 })
    expect(cache.getStats().l3.textureHitRate).toBe(0)
  })
})

// ============================================================================
// 10. RenderCache — 统计重置 / 销毁
// ============================================================================

describe('RenderCache / reset & dispose', () => {
  it('RS01: resetStats 清零所有统计', () => {
    const cache = new RenderCache()
    const input = makeInput()
    cache.query(input, 0, false)
    cache.query(input, 1, true)
    cache.recordL2Hit()
    cache.setL3Stats({ textureHits: 5, textureMisses: 5 })

    cache.resetStats()
    const stats = cache.getStats()
    expect(stats.l1.hits).toBe(0)
    expect(stats.l1.misses).toBe(0)
    expect(stats.l2.hits).toBe(0)
    expect(stats.l2.misses).toBe(0)
    expect(stats.totalQueries).toBe(0)
    expect(stats.levelDistribution.L1).toBe(0)
    // L3 注入值不被 resetStats 清零(由外部 ResourceManager 管理)
    expect(stats.l3.textureHits).toBe(5)
  })

  it('RS02: resetStats 不清空 L1 缓存条目', () => {
    const cache = new RenderCache()
    const input = makeInput()
    cache.query(input, 0, false)
    cache.resetStats()
    // 再次查询相同输入应 L1 命中
    const result = cache.query(input, 0, true)
    expect(result.l1Hit).toBe(true)
  })

  it('RS03: clearL1 清空 L1 条目', () => {
    const cache = new RenderCache()
    const input = makeInput()
    cache.query(input, 0, false)
    expect(cache.getL1Cache().size).toBe(1)
    cache.clearL1()
    expect(cache.getL1Cache().size).toBe(0)
  })

  it('RS04: dispose 清空一切', () => {
    const cache = new RenderCache()
    const input = makeInput()
    cache.query(input, 0, false)
    cache.recordL2Hit()
    cache.setL3Stats({ textureHits: 5, textureMisses: 5 })

    cache.dispose()
    const stats = cache.getStats()
    expect(stats.l1.size).toBe(0)
    expect(stats.l1.hits).toBe(0)
    expect(stats.l2.hits).toBe(0)
    expect(stats.l3.textureHits).toBe(0) // dispose 清零 L3
    expect(stats.totalQueries).toBe(0)
  })
})

// ============================================================================
// 11. RenderCache — 自定义 L1
// ============================================================================

describe('RenderCache / custom L1', () => {
  it('C01: 注入外部 SignatureCache', () => {
    const l1 = new SignatureCache({ maxSize: 16 })
    const cache = new RenderCache({ l1Cache: l1 })
    expect(cache.getL1Cache()).toBe(l1)
    expect(cache.getStats().l1.maxSize).toBe(16)
  })

  it('C02: l1MaxSize 仅在内部新建时生效', () => {
    const cache = new RenderCache({ l1MaxSize: 32 })
    expect(cache.getStats().l1.maxSize).toBe(32)
  })

  it('C03: 外部 L1 操作影响 RenderCache 统计', () => {
    const l1 = new SignatureCache({ maxSize: 16 })
    const cache = new RenderCache({ l1Cache: l1 })

    // 通过外部 L1 插入
    const sig = computeRenderSignature(makeInput())
    l1.query(sig, 0)

    // 通过 RenderCache 查询应命中
    const result = cache.query(makeInput(), 1, true)
    expect(result.l1Hit).toBe(true)
  })
})

// ============================================================================
// 12. 边界 / 集成
// ============================================================================

describe('RenderCache / edge cases', () => {
  it('E01: 空画布尺寸(0x0)也能生成签名', () => {
    const cache = new RenderCache()
    const result = cache.query(makeInput(undefined, undefined, undefined, 0, 0), 0, false)
    expect(result.signature.hash).toMatch(/^[0-9a-f]{8}$/)
  })

  it('E02: 大画布尺寸(8K)', () => {
    const cache = new RenderCache()
    const result = cache.query(makeInput(undefined, undefined, undefined, 7680, 4320), 0, false)
    expect(result.signature.fullKey).toContain('7680x4320')
  })

  it('E03: 连续 100 帧模拟(混合 L1/L2/miss)', () => {
    const cache = new RenderCache()
    const inputs = [
      makeInput('scene_a'),
      makeInput('scene_b'),
      makeInput('scene_c'),
    ]

    // 模拟 100 帧,交替使用 3 个场景
    for (let i = 0; i < 100; i++) {
      const input = inputs[i % 3]
      const l2Hit = i > 0 // 第一帧后 L2 都命中(模拟)
      cache.query(input, i, l2Hit)
    }

    const stats = cache.getStats()
    expect(stats.totalQueries).toBe(100)
    // 前 3 帧 L1 miss(插入),后续 97 次 L1 hit
    expect(stats.l1.misses).toBe(3)
    expect(stats.l1.hits).toBe(97)
    expect(stats.l1.hitRate).toBeCloseTo(0.97)
    // overallHitRate = (L1 hits + L2-only hits) / total = (97 + 2) / 100
    // (i=1,2 时 L1 miss 但 L2 hit → level=L2;i=3..99 L1 hit → level=L1)
    expect(stats.overallHitRate).toBeCloseTo(0.99)
    expect(stats.levelDistribution.L1).toBe(97)
    expect(stats.levelDistribution.L2).toBe(2)
    expect(stats.levelDistribution.miss).toBe(1)
  })

  it('E04: levelDistribution 总和 = totalQueries', () => {
    const cache = new RenderCache()
    const input = makeInput()
    cache.query(input, 0, false) // miss
    cache.query(input, 1, true) // L1
    cache.query(makeInput('s2'), 0, true) // L2
    cache.query(makeInput('s3'), 0, false) // miss

    const stats = cache.getStats()
    const sum = stats.levelDistribution.L1 + stats.levelDistribution.L2 +
      stats.levelDistribution.L3 + stats.levelDistribution.miss
    expect(sum).toBe(stats.totalQueries)
  })
})
