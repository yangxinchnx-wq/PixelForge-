/**
 * Asset Registry Tests(Step 35.1)— 资产注册表测试套件。
 *
 * 覆盖:
 * - T (Types): 类型映射 / 常量完整性
 * - F (Factory): createAssetRecord 工厂
 * - R (Registry CRUD): 注册 / 注销 / 重命名 / 更新 / 标签 / 版本 / 清空
 * - Q (Query): byId / byKind / byCategory / byTag / bySource / search / group
 * - V (Validation): 资产记录验证 / 注册表验证
 * - L (Legacy): 旧 Asset 兼容转换
 * - S (Store): Pinia Store actions + computed
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

import {
  type AssetKind,
  type AssetCategory,
  type AssetSource,
  ALL_ASSET_KINDS,
  ALL_ASSET_CATEGORIES,
  CATEGORY_OF_KIND,
  KIND_DISPLAY_NAME,
  CATEGORY_DISPLAY_NAME,
  genAssetId,
  createAssetRecord,
  createRegistry,
  registerAsset,
  registerManyAssets,
  unregisterAsset,
  renameAsset,
  updateAssetMetadata,
  addTag,
  removeTag,
  bumpVersion,
  clearRegistry,
  getAssetById,
  getAllAssets,
  getAssetCount,
  getAssetsByKind,
  getAssetsByCategory,
  getAssetsByTag,
  getAssetsBySource,
  searchAssets,
  hasAsset,
  groupByCategory,
  groupByKind,
  validateAssetRecord,
  validateRegistry,
  assetFromLegacy,
} from './assetRegistry'
import { useAssetRegistryStore } from './assetRegistryStore'

// ============================================================================
// T — Types / 常量完整性
// ============================================================================

describe('Asset Registry — Types (T)', () => {
  it('T01: ALL_ASSET_KINDS 包含全部 14 种资产种类', () => {
    expect(ALL_ASSET_KINDS).toHaveLength(14)
    expect(ALL_ASSET_KINDS).toContain('image')
    expect(ALL_ASSET_KINDS).toContain('texture')
    expect(ALL_ASSET_KINDS).toContain('audio')
    expect(ALL_ASSET_KINDS).toContain('video')
    expect(ALL_ASSET_KINDS).toContain('material')
    expect(ALL_ASSET_KINDS).toContain('shader')
    expect(ALL_ASSET_KINDS).toContain('graph')
    expect(ALL_ASSET_KINDS).toContain('sequence')
    expect(ALL_ASSET_KINDS).toContain('template')
    expect(ALL_ASSET_KINDS).toContain('clip')
    expect(ALL_ASSET_KINDS).toContain('effectChain')
    expect(ALL_ASSET_KINDS).toContain('animation')
    expect(ALL_ASSET_KINDS).toContain('renderConfig')
    expect(ALL_ASSET_KINDS).toContain('preset')
  })

  it('T02: ALL_ASSET_CATEGORIES 包含 4 大类', () => {
    expect(ALL_ASSET_CATEGORIES).toHaveLength(4)
    expect(ALL_ASSET_CATEGORIES).toEqual(['media', 'shader', 'scene', 'config'])
  })

  it('T03: CATEGORY_OF_KIND 把每个 kind 都映射到正确大类', () => {
    expect(CATEGORY_OF_KIND.image).toBe('media')
    expect(CATEGORY_OF_KIND.texture).toBe('media')
    expect(CATEGORY_OF_KIND.audio).toBe('media')
    expect(CATEGORY_OF_KIND.video).toBe('media')
    expect(CATEGORY_OF_KIND.material).toBe('shader')
    expect(CATEGORY_OF_KIND.shader).toBe('shader')
    expect(CATEGORY_OF_KIND.graph).toBe('shader')
    expect(CATEGORY_OF_KIND.sequence).toBe('scene')
    expect(CATEGORY_OF_KIND.template).toBe('scene')
    expect(CATEGORY_OF_KIND.clip).toBe('scene')
    expect(CATEGORY_OF_KIND.effectChain).toBe('config')
    expect(CATEGORY_OF_KIND.animation).toBe('config')
    expect(CATEGORY_OF_KIND.renderConfig).toBe('config')
    expect(CATEGORY_OF_KIND.preset).toBe('config')
  })

  it('T04: CATEGORY_OF_KIND 覆盖全部 AssetKind', () => {
    for (const kind of ALL_ASSET_KINDS) {
      expect(CATEGORY_OF_KIND[kind]).toBeDefined()
    }
  })

  it('T05: KIND_DISPLAY_NAME 为每个 kind 提供中文显示名', () => {
    for (const kind of ALL_ASSET_KINDS) {
      const name = KIND_DISPLAY_NAME[kind]
      expect(name).toBeDefined()
      expect(name.length).toBeGreaterThan(0)
    }
  })

  it('T06: CATEGORY_DISPLAY_NAME 为每个 category 提供中文显示名', () => {
    for (const cat of ALL_ASSET_CATEGORIES) {
      expect(CATEGORY_DISPLAY_NAME[cat]).toBeDefined()
      expect(CATEGORY_DISPLAY_NAME[cat].length).toBeGreaterThan(0)
    }
  })

  it('T07: genAssetId 为不同 kind 生成不同前缀', () => {
    const imageId = genAssetId('image')
    const audioId = genAssetId('audio')
    const seqId = genAssetId('sequence')
    expect(imageId).toMatch(/^img_/)
    expect(audioId).toMatch(/^aud_/)
    expect(seqId).toMatch(/^seq_/)
  })

  it('T08: genAssetId 每次调用生成不同 ID', () => {
    const ids = new Set<string>()
    for (let i = 0; i < 100; i++) {
      ids.add(genAssetId('image'))
    }
    expect(ids.size).toBe(100)
  })
})

// ============================================================================
// F — Factory
// ============================================================================

describe('Asset Registry — Factory (F)', () => {
  it('F01: createAssetRecord 创建带默认值的记录', () => {
    const record = createAssetRecord({ kind: 'image', name: '测试图片' })
    expect(record.kind).toBe('image')
    expect(record.category).toBe('media')
    expect(record.name).toBe('测试图片')
    expect(record.source).toBe('user')
    expect(record.version).toBe(1)
    expect(record.tags).toEqual([])
    expect(record.id).toMatch(/^img_/)
    expect(record.createdAt).toBeGreaterThan(0)
    expect(record.updatedAt).toBe(record.createdAt)
  })

  it('F02: createAssetRecord 接受自定义参数', () => {
    const record = createAssetRecord({
      kind: 'material',
      name: '金属材质',
      source: 'builtin',
      tags: ['metal', 'shiny'],
      description: '金属反射材质',
      payloadRef: 'mat://metal',
      size: 1024,
      thumbnail: 'data:image/png;base64,...',
      contentHash: 'abc123',
    })
    expect(record.kind).toBe('material')
    expect(record.category).toBe('shader')
    expect(record.source).toBe('builtin')
    expect(record.tags).toEqual(['metal', 'shiny'])
    expect(record.description).toBe('金属反射材质')
    expect(record.payloadRef).toBe('mat://metal')
    expect(record.size).toBe(1024)
    expect(record.thumbnail).toBe('data:image/png;base64,...')
    expect(record.contentHash).toBe('abc123')
  })

  it('F03: createAssetRecord 标签数组是独立副本(不共享引用)', () => {
    const tags = ['a', 'b']
    const record = createAssetRecord({ kind: 'image', name: 'test', tags })
    tags.push('c')
    expect(record.tags).toEqual(['a', 'b'])
  })

  it('F04: createAssetRecord 接受自定义 id 和 createdAt(测试用)', () => {
    const record = createAssetRecord({
      kind: 'audio',
      name: 'test',
      id: 'aud_custom',
      createdAt: 1000,
    })
    expect(record.id).toBe('aud_custom')
    expect(record.createdAt).toBe(1000)
    expect(record.updatedAt).toBe(1000)
  })

  it('F05: createAssetRecord 自动推导 category', () => {
    const cases: Array<{ kind: AssetKind; category: AssetCategory }> = [
      { kind: 'image', category: 'media' },
      { kind: 'material', category: 'shader' },
      { kind: 'sequence', category: 'scene' },
      { kind: 'effectChain', category: 'config' },
    ]
    for (const { kind, category } of cases) {
      const record = createAssetRecord({ kind, name: 't' })
      expect(record.category).toBe(category)
    }
  })
})

// ============================================================================
// R — Registry CRUD
// ============================================================================

describe('Asset Registry — CRUD (R)', () => {
  let registry: ReturnType<typeof createRegistry>

  beforeEach(() => {
    registry = createRegistry()
  })

  it('R01: createRegistry 返回空 Map', () => {
    expect(registry.size).toBe(0)
  })

  it('R02: registerAsset 添加资产到注册表', () => {
    const record = createAssetRecord({ kind: 'image', name: 'img1' })
    registry = registerAsset(registry, record)
    expect(registry.size).toBe(1)
    expect(registry.get(record.id)).toBe(record)
  })

  it('R03: registerAsset 重复 ID 抛错', () => {
    const record = createAssetRecord({ kind: 'image', name: 'img1', id: 'img_dup' })
    registry = registerAsset(registry, record)
    expect(() => registerAsset(registry, record)).toThrow(/已存在/)
  })

  it('R04: registerAsset 返回新 Map(不可变)', () => {
    const record = createAssetRecord({ kind: 'image', name: 'img1' })
    const before = registry
    const after = registerAsset(registry, record)
    expect(before).not.toBe(after)
    expect(before.size).toBe(0)
    expect(after.size).toBe(1)
  })

  it('R05: registerManyAssets 批量注册,跳过已存在的', () => {
    const r1 = createAssetRecord({ kind: 'image', name: 'a', id: 'img_a' })
    const r2 = createAssetRecord({ kind: 'image', name: 'b', id: 'img_b' })
    registry = registerAsset(registry, r1)
    registry = registerManyAssets(registry, [r1, r2])
    expect(registry.size).toBe(2)
  })

  it('R06: unregisterAsset 移除资产', () => {
    const record = createAssetRecord({ kind: 'image', name: 'img1', id: 'img_rm' })
    registry = registerAsset(registry, record)
    registry = unregisterAsset(registry, 'img_rm')
    expect(registry.size).toBe(0)
    expect(registry.has('img_rm')).toBe(false)
  })

  it('R07: unregisterAsset 不存在的 ID 返回原注册表(不抛错)', () => {
    const before = registry
    const after = unregisterAsset(registry, 'nonexistent')
    expect(after).toBe(before)
  })

  it('R08: renameAsset 重命名资产', () => {
    const record = createAssetRecord({ kind: 'image', name: 'old', id: 'img_rn' })
    registry = registerAsset(registry, record)
    registry = renameAsset(registry, 'img_rn', 'new')
    const updated = registry.get('img_rn')!
    expect(updated.name).toBe('new')
    expect(updated.updatedAt).toBeGreaterThanOrEqual(record.createdAt)
  })

  it('R09: renameAsset 不存在的 ID 返回原注册表', () => {
    const before = registry
    const after = renameAsset(registry, 'no_id', 'x')
    expect(after).toBe(before)
  })

  it('R10: updateAssetMetadata patch 模式更新', () => {
    const record = createAssetRecord({
      kind: 'material',
      name: 'mat',
      id: 'mat_upd',
      description: 'old',
    })
    registry = registerAsset(registry, record)
    registry = updateAssetMetadata(registry, 'mat_upd', {
      name: 'new_mat',
      description: 'new desc',
      size: 2048,
    })
    const updated = registry.get('mat_upd')!
    expect(updated.name).toBe('new_mat')
    expect(updated.description).toBe('new desc')
    expect(updated.size).toBe(2048)
    // 未更新的字段保留
    expect(updated.kind).toBe('material')
    expect(updated.source).toBe('user')
  })

  it('R11: updateAssetMetadata 不修改 id / kind / category / createdAt', () => {
    const record = createAssetRecord({
      kind: 'image',
      name: 'x',
      id: 'img_lock',
    })
    registry = registerAsset(registry, record)
    // @ts-expect-error 测试 id 不可更新
    registry = updateAssetMetadata(registry, 'img_lock', { id: 'hacked' })
    // @ts-expect-error 测试 kind 不可更新
    registry = updateAssetMetadata(registry, 'img_lock', { kind: 'audio' })
    const updated = registry.get('img_lock')!
    expect(updated.id).toBe('img_lock')
    expect(updated.kind).toBe('image')
    expect(updated.category).toBe('media')
  })

  it('R12: addTag 添加标签', () => {
    const record = createAssetRecord({ kind: 'image', name: 'x', id: 'img_tag' })
    registry = registerAsset(registry, record)
    registry = addTag(registry, 'img_tag', 'favorite')
    expect(registry.get('img_tag')!.tags).toEqual(['favorite'])
  })

  it('R13: addTag 重复标签不添加', () => {
    const record = createAssetRecord({
      kind: 'image',
      name: 'x',
      id: 'img_tag2',
      tags: ['fav'],
    })
    registry = registerAsset(registry, record)
    registry = addTag(registry, 'img_tag2', 'fav')
    expect(registry.get('img_tag2')!.tags).toEqual(['fav'])
  })

  it('R14: removeTag 移除标签', () => {
    const record = createAssetRecord({
      kind: 'image',
      name: 'x',
      id: 'img_tag3',
      tags: ['a', 'b', 'c'],
    })
    registry = registerAsset(registry, record)
    registry = removeTag(registry, 'img_tag3', 'b')
    expect(registry.get('img_tag3')!.tags).toEqual(['a', 'c'])
  })

  it('R15: removeTag 不存在的标签返回原注册表', () => {
    const record = createAssetRecord({
      kind: 'image',
      name: 'x',
      id: 'img_tag4',
      tags: ['a'],
    })
    registry = registerAsset(registry, record)
    const before = registry
    registry = removeTag(registry, 'img_tag4', 'nonexistent')
    expect(registry).toBe(before)
  })

  it('R16: bumpVersion 版本号 +1', () => {
    const record = createAssetRecord({ kind: 'image', name: 'x', id: 'img_ver' })
    registry = registerAsset(registry, record)
    expect(registry.get('img_ver')!.version).toBe(1)
    registry = bumpVersion(registry, 'img_ver')
    expect(registry.get('img_ver')!.version).toBe(2)
    registry = bumpVersion(registry, 'img_ver')
    expect(registry.get('img_ver')!.version).toBe(3)
  })

  it('R17: clearRegistry 清空注册表', () => {
    registry = registerAsset(registry, createAssetRecord({ kind: 'image', name: 'a', id: 'i1' }))
    registry = registerAsset(registry, createAssetRecord({ kind: 'image', name: 'b', id: 'i2' }))
    expect(registry.size).toBe(2)
    registry = clearRegistry(registry)
    expect(registry.size).toBe(0)
  })

  it('R18: clearRegistry 空注册表返回原引用', () => {
    const before = registry
    const after = clearRegistry(registry)
    expect(after).toBe(before)
  })
})

// ============================================================================
// Q — Query
// ============================================================================

describe('Asset Registry — Query (Q)', () => {
  let registry: ReturnType<typeof createRegistry>

  beforeEach(() => {
    registry = createRegistry()
    // 添加多种资产用于查询测试
    registry = registerManyAssets(registry, [
      createAssetRecord({ kind: 'image', name: '风景图', id: 'img1', tags: ['nature', 'outdoor'] }),
      createAssetRecord({ kind: 'image', name: 'portrait', id: 'img2', tags: ['people'] }),
      createAssetRecord({ kind: 'audio', name: 'BGM', id: 'aud1', tags: ['music'] }),
      createAssetRecord({ kind: 'material', name: '金属', id: 'mat1', tags: ['shiny'] }),
      createAssetRecord({ kind: 'sequence', name: '主序列', id: 'seq1', description: '主场景序列' }),
      createAssetRecord({ kind: 'effectChain', name: '电影感', id: 'efx1', source: 'builtin' }),
    ])
  })

  it('Q01: getAssetById 按 ID 查找', () => {
    expect(getAssetById(registry, 'img1')?.name).toBe('风景图')
    expect(getAssetById(registry, 'nonexistent')).toBeUndefined()
  })

  it('Q02: getAllAssets 返回全部资产列表', () => {
    const all = getAllAssets(registry)
    expect(all).toHaveLength(6)
  })

  it('Q03: getAssetCount 返回资产数', () => {
    expect(getAssetCount(registry)).toBe(6)
  })

  it('Q04: getAssetsByKind 按种类筛选', () => {
    expect(getAssetsByKind(registry, 'image')).toHaveLength(2)
    expect(getAssetsByKind(registry, 'audio')).toHaveLength(1)
    expect(getAssetsByKind(registry, 'material')).toHaveLength(1)
    expect(getAssetsByKind(registry, 'video')).toHaveLength(0)
  })

  it('Q05: getAssetsByCategory 按大类筛选', () => {
    expect(getAssetsByCategory(registry, 'media')).toHaveLength(3) // 2 image + 1 audio
    expect(getAssetsByCategory(registry, 'shader')).toHaveLength(1) // 1 material
    expect(getAssetsByCategory(registry, 'scene')).toHaveLength(1) // 1 sequence
    expect(getAssetsByCategory(registry, 'config')).toHaveLength(1) // 1 effectChain
  })

  it('Q06: getAssetsByTag 按标签筛选(OR 语义)', () => {
    expect(getAssetsByTag(registry, ['nature'])).toHaveLength(1)
    expect(getAssetsByTag(registry, ['nature', 'people'])).toHaveLength(2)
    expect(getAssetsByTag(registry, ['nonexistent'])).toHaveLength(0)
    expect(getAssetsByTag(registry, [])).toHaveLength(0)
  })

  it('Q07: getAssetsBySource 按来源筛选', () => {
    expect(getAssetsBySource(registry, 'user')).toHaveLength(5)
    expect(getAssetsBySource(registry, 'builtin')).toHaveLength(1)
    expect(getAssetsBySource(registry, 'imported')).toHaveLength(0)
  })

  it('Q08: searchAssets 按名称搜索(大小写不敏感)', () => {
    const result = searchAssets(registry, 'portrait')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('img2')
  })

  it('Q09: searchAssets 按中文搜索', () => {
    const result = searchAssets(registry, '风景')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('img1')
  })

  it('Q10: searchAssets 按描述搜索', () => {
    const result = searchAssets(registry, '主场景')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('seq1')
  })

  it('Q11: searchAssets 按标签搜索', () => {
    const result = searchAssets(registry, 'music')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('aud1')
  })

  it('Q12: searchAssets 空查询返回空数组', () => {
    expect(searchAssets(registry, '')).toHaveLength(0)
    expect(searchAssets(registry, '   ')).toHaveLength(0)
  })

  it('Q13: hasAsset 检查存在性', () => {
    expect(hasAsset(registry, 'img1')).toBe(true)
    expect(hasAsset(registry, 'nope')).toBe(false)
  })

  it('Q14: groupByCategory 按大类分组', () => {
    const g = groupByCategory(registry)
    expect(g.media).toHaveLength(3)
    expect(g.shader).toHaveLength(1)
    expect(g.scene).toHaveLength(1)
    expect(g.config).toHaveLength(1)
  })

  it('Q15: groupByKind 按种类分组', () => {
    const g = groupByKind(registry)
    expect(g.image).toHaveLength(2)
    expect(g.audio).toHaveLength(1)
    expect(g.material).toHaveLength(1)
    expect(g.sequence).toHaveLength(1)
    expect(g.effectChain).toHaveLength(1)
    expect(g.video).toBeUndefined()
  })
})

// ============================================================================
// V — Validation
// ============================================================================

describe('Asset Registry — Validation (V)', () => {
  it('V01: validateAssetRecord 合法记录返回空错误列表', () => {
    const record = createAssetRecord({ kind: 'image', name: 'valid' })
    expect(validateAssetRecord(record)).toEqual([])
  })

  it('V02: validateAssetRecord 空 ID 报错', () => {
    const record = createAssetRecord({ kind: 'image', name: 'x', id: '' })
    const errors = validateAssetRecord(record)
    expect(errors.some((e) => e.code === 'EMPTY_ID')).toBe(true)
  })

  it('V03: validateAssetRecord 空名称报错', () => {
    const record = createAssetRecord({ kind: 'image', name: '', id: 'img_v3' })
    const errors = validateAssetRecord(record)
    expect(errors.some((e) => e.code === 'EMPTY_NAME')).toBe(true)
  })

  it('V04: validateAssetRecord 无效种类报错', () => {
    const record = {
      ...createAssetRecord({ kind: 'image', name: 'x', id: 'img_v4' }),
      kind: 'invalid_kind' as AssetKind,
    }
    const errors = validateAssetRecord(record)
    expect(errors.some((e) => e.code === 'INVALID_KIND')).toBe(true)
  })

  it('V05: validateAssetRecord kind-category 不一致报错', () => {
    const record = {
      ...createAssetRecord({ kind: 'image', name: 'x', id: 'img_v5' }),
      category: 'shader' as AssetCategory,
    }
    const errors = validateAssetRecord(record)
    expect(errors.some((e) => e.code === 'CATEGORY_MISMATCH')).toBe(true)
  })

  it('V06: validateAssetRecord 非正整数版本号报错', () => {
    const record = {
      ...createAssetRecord({ kind: 'image', name: 'x', id: 'img_v6' }),
      version: 0,
    }
    const errors = validateAssetRecord(record)
    expect(errors.some((e) => e.code === 'INVALID_VERSION')).toBe(true)
  })

  it('V07: validateAssetRecord 无效时间戳报错', () => {
    const record = {
      ...createAssetRecord({ kind: 'image', name: 'x', id: 'img_v7' }),
      createdAt: -1,
    }
    const errors = validateAssetRecord(record)
    expect(errors.some((e) => e.code === 'INVALID_TIMESTAMP')).toBe(true)
  })

  it('V08: validateAssetRecord 无效来源报错', () => {
    const record = {
      ...createAssetRecord({ kind: 'image', name: 'x', id: 'img_v8' }),
      source: 'invalid' as AssetSource,
    }
    const errors = validateAssetRecord(record)
    expect(errors.some((e) => e.code === 'INVALID_SOURCE')).toBe(true)
  })

  it('V09: validateRegistry 收集所有资产的错误', () => {
    const registry = createRegistry()
    const good = createAssetRecord({ kind: 'image', name: 'good', id: 'g1' })
    const bad = { ...createAssetRecord({ kind: 'image', name: '', id: 'b1' }) }
    const r2 = registerManyAssets(registry, [good, bad])
    const errors = validateRegistry(r2)
    expect(errors.some((e) => e.code === 'EMPTY_NAME')).toBe(true)
  })
})

// ============================================================================
// L — Legacy 兼容
// ============================================================================

describe('Asset Registry — Legacy (L)', () => {
  it('L01: assetFromLegacy 把旧 image Asset 转为 AssetRecord', () => {
    const legacy = {
      id: 'old-asset-1',
      name: 'old.png',
      type: 'image',
      url: 'blob:http://localhost/abc',
      size: 4096,
      createdAt: 1700000000000,
      thumbnail: 'data:image/jpeg;base64,...',
      mimeType: 'image/png',
    }
    const record = assetFromLegacy(legacy)
    expect(record.id).toBe('old-asset-1')
    expect(record.kind).toBe('image')
    expect(record.category).toBe('media')
    expect(record.name).toBe('old.png')
    expect(record.source).toBe('imported')
    expect(record.version).toBe(1)
    expect(record.tags).toEqual([])
    expect(record.size).toBe(4096)
    expect(record.thumbnail).toBe('data:image/jpeg;base64,...')
    expect(record.payloadRef).toBe('blob:http://localhost/abc')
    expect(record.createdAt).toBe(1700000000000)
  })

  it('L02: assetFromLegacy 把旧 texture Asset 转为 AssetRecord', () => {
    const legacy = {
      id: 'old-tex-1',
      name: 'tex.png',
      type: 'texture',
      url: 'blob:http://localhost/xyz',
      size: 8192,
      createdAt: 1700000000000,
      mimeType: 'image/png',
    }
    const record = assetFromLegacy(legacy)
    expect(record.kind).toBe('texture')
    expect(record.category).toBe('media')
  })
})

// ============================================================================
// S — Store
// ============================================================================

describe('Asset Registry — Store (S)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('S01: store 初始为空', () => {
    const store = useAssetRegistryStore()
    expect(store.count).toBe(0)
    expect(store.isEmpty).toBe(true)
    expect(store.all).toEqual([])
  })

  it('S02: create 创建并注册资产', () => {
    const store = useAssetRegistryStore()
    const record = store.create({ kind: 'image', name: 'test' })
    expect(store.count).toBe(1)
    expect(store.isEmpty).toBe(false)
    expect(store.getById(record.id)?.name).toBe('test')
  })

  it('S03: register 注册已有记录', () => {
    const store = useAssetRegistryStore()
    const record = createAssetRecord({ kind: 'audio', name: 'bgm', id: 'aud_s3' })
    store.register(record)
    expect(store.exists('aud_s3')).toBe(true)
  })

  it('S04: registerMany 批量注册', () => {
    const store = useAssetRegistryStore()
    const records = [
      createAssetRecord({ kind: 'image', name: 'a', id: 'i_s4' }),
      createAssetRecord({ kind: 'image', name: 'b', id: 'i_s4b' }),
    ]
    store.registerMany(records)
    expect(store.count).toBe(2)
  })

  it('S05: unregister 注销资产', () => {
    const store = useAssetRegistryStore()
    const record = store.create({ kind: 'image', name: 'x' })
    store.unregister(record.id)
    expect(store.count).toBe(0)
    expect(store.exists(record.id)).toBe(false)
  })

  it('S06: rename 重命名', () => {
    const store = useAssetRegistryStore()
    const record = store.create({ kind: 'image', name: 'old' })
    store.rename(record.id, 'new')
    expect(store.getById(record.id)?.name).toBe('new')
  })

  it('S07: update 元数据 patch', () => {
    const store = useAssetRegistryStore()
    const record = store.create({ kind: 'material', name: 'm', description: 'd1' })
    store.update(record.id, { name: 'm2', description: 'd2', size: 100 })
    const updated = store.getById(record.id)!
    expect(updated.name).toBe('m2')
    expect(updated.description).toBe('d2')
    expect(updated.size).toBe(100)
  })

  it('S08: addAssetTag / removeAssetTag 标签操作', () => {
    const store = useAssetRegistryStore()
    const record = store.create({ kind: 'image', name: 'x' })
    store.addAssetTag(record.id, 'fav')
    expect(store.getById(record.id)?.tags).toEqual(['fav'])
    store.removeAssetTag(record.id, 'fav')
    expect(store.getById(record.id)?.tags).toEqual([])
  })

  it('S09: bump 版本号 +1', () => {
    const store = useAssetRegistryStore()
    const record = store.create({ kind: 'image', name: 'x' })
    expect(store.getById(record.id)?.version).toBe(1)
    store.bump(record.id)
    expect(store.getById(record.id)?.version).toBe(2)
  })

  it('S10: clear 清空注册表', () => {
    const store = useAssetRegistryStore()
    store.create({ kind: 'image', name: 'a' })
    store.create({ kind: 'image', name: 'b' })
    expect(store.count).toBe(2)
    store.clear()
    expect(store.count).toBe(0)
  })

  it('S11: grouped computed 按大类分组', () => {
    const store = useAssetRegistryStore()
    store.create({ kind: 'image', name: 'a' })
    store.create({ kind: 'audio', name: 'b' })
    store.create({ kind: 'material', name: 'c' })
    store.create({ kind: 'sequence', name: 'd' })
    store.create({ kind: 'effectChain', name: 'e' })
    const g = store.grouped
    expect(g.media).toHaveLength(2)
    expect(g.shader).toHaveLength(1)
    expect(g.scene).toHaveLength(1)
    expect(g.config).toHaveLength(1)
  })

  it('S12: countByCategory 各大类资产数', () => {
    const store = useAssetRegistryStore()
    store.create({ kind: 'image', name: 'a' })
    store.create({ kind: 'audio', name: 'b' })
    store.create({ kind: 'material', name: 'c' })
    const c = store.countByCategory
    expect(c.media).toBe(2)
    expect(c.shader).toBe(1)
    expect(c.scene).toBe(0)
    expect(c.config).toBe(0)
  })

  it('S13: countByKind 各种类资产数', () => {
    const store = useAssetRegistryStore()
    store.create({ kind: 'image', name: 'a' })
    store.create({ kind: 'image', name: 'b' })
    store.create({ kind: 'audio', name: 'c' })
    const c = store.countByKind
    expect(c.image).toBe(2)
    expect(c.audio).toBe(1)
    expect(c.video).toBe(0)
  })

  it('S14: builtinCount / userCount / importedCount 来源统计', () => {
    const store = useAssetRegistryStore()
    store.create({ kind: 'image', name: 'a', source: 'user' })
    store.create({ kind: 'image', name: 'b', source: 'builtin' })
    store.create({ kind: 'image', name: 'c', source: 'imported' })
    store.create({ kind: 'image', name: 'd', source: 'user' })
    expect(store.userCount).toBe(2)
    expect(store.builtinCount).toBe(1)
    expect(store.importedCount).toBe(1)
  })

  it('S15: listByKind / listByCategory / listByTag 查询', () => {
    const store = useAssetRegistryStore()
    store.create({ kind: 'image', name: 'a', tags: ['fav'] })
    store.create({ kind: 'audio', name: 'b', tags: ['fav'] })
    store.create({ kind: 'material', name: 'c' })
    expect(store.listByKind('image')).toHaveLength(1)
    expect(store.listByCategory('media')).toHaveLength(2)
    expect(store.listByTag(['fav'])).toHaveLength(2)
  })

  it('S16: search 搜索', () => {
    const store = useAssetRegistryStore()
    store.create({ kind: 'image', name: '风景图' })
    store.create({ kind: 'image', name: 'portrait' })
    expect(store.search('风景')).toHaveLength(1)
    expect(store.search('portrait')).toHaveLength(1)
    expect(store.search('xyz')).toHaveLength(0)
  })

  it('S17: reset 等价于 clear', () => {
    const store = useAssetRegistryStore()
    store.create({ kind: 'image', name: 'a' })
    store.reset()
    expect(store.count).toBe(0)
    expect(store.isEmpty).toBe(true)
  })

  it('S18: store 响应式更新 — computed 跟随 state 变化', () => {
    const store = useAssetRegistryStore()
    expect(store.count).toBe(0)
    store.create({ kind: 'image', name: 'a' })
    expect(store.count).toBe(1)
    store.create({ kind: 'image', name: 'b' })
    expect(store.count).toBe(2)
    store.unregister(store.all[0].id)
    expect(store.count).toBe(1)
  })
})
