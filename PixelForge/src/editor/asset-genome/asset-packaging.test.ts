/**
 * Asset Packaging Tests(Step 35.7)— 打包导出 + 导入测试套件。
 */
import { describe, it, expect } from 'vitest'

import {
  createPackage,
  serializePackage,
  deserializePackage,
  validatePackage,
  mergePackage,
  createPackageWithIds,
} from './assetPackaging'
import type { AssetRecord } from './assetRegistry'
import { createAssetRecord } from './assetRegistry'
import type { Reference } from './referenceGraph'
import { createReference } from './referenceGraph'

describe('Asset Packaging (AP)', () => {
  // —— 导出 —— 

  it('AP01: createPackage 创建资产包', () => {
    const assets: AssetRecord[] = [
      createAssetRecord({ kind: 'image', name: 'a', id: 'img_1' }),
    ]
    const refs: Reference[] = [createReference('img_1', 'img_2')]
    const pkg = createPackage('测试包', assets, refs)
    expect(pkg.formatVersion).toBe(1)
    expect(pkg.name).toBe('测试包')
    expect(pkg.assets).toHaveLength(1)
    expect(pkg.references).toHaveLength(1)
    expect(pkg.createdAt).toBeGreaterThan(0)
  })

  it('AP02: createPackage 深拷贝资产和引用(不共享引用)', () => {
    const assets: AssetRecord[] = [createAssetRecord({ kind: 'image', name: 'a', id: 'img_1' })]
    const refs: Reference[] = [createReference('img_1', 'img_2')]
    const pkg = createPackage('test', assets, refs)
    pkg.assets[0].name = 'modified'
    expect(assets[0].name).toBe('a') // 原资产未被修改
  })

  it('AP03: serializePackage 返回 JSON 字符串', () => {
    const assets = [createAssetRecord({ kind: 'image', name: 'a', id: 'img_1' })]
    const pkg = createPackage('test', assets, [])
    const json = serializePackage(pkg)
    expect(typeof json).toBe('string')
    expect(json).toContain('formatVersion')
    expect(json).toContain('img_1')
  })

  // —— 导入 —— 

  it('AP04: deserializePackage 反序列化 JSON', () => {
    const assets = [createAssetRecord({ kind: 'image', name: 'a', id: 'img_1' })]
    const refs = [createReference('img_1', 'img_2')]
    const pkg = createPackage('test', assets, refs)
    const json = serializePackage(pkg)
    const restored = deserializePackage(json)
    expect(restored.formatVersion).toBe(1)
    expect(restored.name).toBe('test')
    expect(restored.assets).toHaveLength(1)
    expect(restored.references).toHaveLength(1)
  })

  it('AP05: deserializePackage 无效 JSON 抛错', () => {
    expect(() => deserializePackage('not json')).toThrow(/JSON 解析失败/)
  })

  it('AP06: deserializePackage 非 object 抛错', () => {
    expect(() => deserializePackage('"string"')).toThrow(/无效的资产包格式/)
  })

  it('AP07: deserializePackage 不支持的格式版本抛错', () => {
    const json = JSON.stringify({ formatVersion: 99, name: 'x', assets: [], references: [] })
    expect(() => deserializePackage(json)).toThrow(/不支持的包格式版本/)
  })

  it('AP08: deserializePackage assets 非数组抛错', () => {
    const json = JSON.stringify({ formatVersion: 1, name: 'x', assets: 'not array', references: [] })
    expect(() => deserializePackage(json)).toThrow(/资产列表必须是数组/)
  })

  // —— 校验 —— 

  it('AP09: validatePackage 合法包返回空错误', () => {
    const assets = [
      createAssetRecord({ kind: 'image', name: 'a', id: 'img_1' }),
      createAssetRecord({ kind: 'image', name: 'b', id: 'img_2' }),
    ]
    const refs = [createReference('img_1', 'img_2')]
    const pkg = createPackage('test', assets, refs)
    expect(validatePackage(pkg)).toEqual([])
  })

  it('AP10: validatePackage 空包名报错', () => {
    const pkg = createPackage('', [], [])
    const errors = validatePackage(pkg)
    expect(errors.some((e) => e.includes('包名不能为空'))).toBe(true)
  })

  it('AP11: validatePackage 引用资产不存在报错', () => {
    const assets = [createAssetRecord({ kind: 'image', name: 'a', id: 'img_1' })]
    const refs = [createReference('img_1', 'img_nonexistent')]
    const pkg = createPackage('test', assets, refs)
    const errors = validatePackage(pkg)
    expect(errors.some((e) => e.includes('img_nonexistent'))).toBe(true)
  })

  it('AP12: validatePackage 资产 ID 重复报错', () => {
    const a1 = createAssetRecord({ kind: 'image', name: 'a', id: 'img_dup' })
    const a2 = createAssetRecord({ kind: 'image', name: 'b', id: 'img_dup' })
    const pkg = createPackage('test', [a1, a2], [])
    const errors = validatePackage(pkg)
    expect(errors.some((e) => e.includes('img_dup'))).toBe(true)
  })

  // —— 合并 —— 

  it('AP13: mergePackage 导入新资产', () => {
    const existing = [createAssetRecord({ kind: 'image', name: 'old', id: 'img_old' })]
    const pkgAssets = [createAssetRecord({ kind: 'image', name: 'new', id: 'img_new' })]
    const pkg = createPackage('test', pkgAssets, [])
    const { result, assets } = mergePackage(existing, [], pkg)
    expect(result.importedAssetCount).toBe(1)
    expect(result.skippedAssetCount).toBe(0)
    expect(assets).toHaveLength(2)
  })

  it('AP14: mergePackage 已存在的 ID 跳过', () => {
    const existing = [createAssetRecord({ kind: 'image', name: 'old', id: 'img_dup' })]
    const pkgAssets = [createAssetRecord({ kind: 'image', name: 'new', id: 'img_dup' })]
    const pkg = createPackage('test', pkgAssets, [])
    const { result, assets } = mergePackage(existing, [], pkg)
    expect(result.importedAssetCount).toBe(0)
    expect(result.skippedAssetCount).toBe(1)
    expect(assets).toHaveLength(1)
  })

  it('AP15: mergePackage 导入引用', () => {
    const pkgAssets = [
      createAssetRecord({ kind: 'image', name: 'a', id: 'img_a' }),
      createAssetRecord({ kind: 'image', name: 'b', id: 'img_b' }),
    ]
    const pkgRefs = [createReference('img_a', 'img_b')]
    const pkg = createPackage('test', pkgAssets, pkgRefs)
    const { result, references } = mergePackage([], [], pkg)
    expect(result.importedReferenceCount).toBe(1)
    expect(references).toHaveLength(1)
  })

  // —— 过滤导出 —— 

  it('AP16: createPackageWithIds 只导出指定资产', () => {
    const assets = [
      createAssetRecord({ kind: 'image', name: 'a', id: 'img_a' }),
      createAssetRecord({ kind: 'image', name: 'b', id: 'img_b' }),
      createAssetRecord({ kind: 'image', name: 'c', id: 'img_c' }),
    ]
    const refs = [
      createReference('img_a', 'img_b'),
      createReference('img_b', 'img_c'), // c 不在导出列表,这条引用应被过滤
    ]
    const pkg = createPackageWithIds('subset', assets, refs, ['img_a', 'img_b'])
    expect(pkg.assets).toHaveLength(2)
    expect(pkg.assets.map((a) => a.id)).toContain('img_a')
    expect(pkg.assets.map((a) => a.id)).toContain('img_b')
    // 只有 img_a → img_b 保留(img_b → img_c 的 target 不在列表)
    expect(pkg.references).toHaveLength(1)
    expect(pkg.references[0].sourceId).toBe('img_a')
    expect(pkg.references[0].targetId).toBe('img_b')
  })

  it('AP17: createPackageWithIds 空列表返回空包', () => {
    const assets = [createAssetRecord({ kind: 'image', name: 'a', id: 'img_a' })]
    const pkg = createPackageWithIds('empty', assets, [], [])
    expect(pkg.assets).toHaveLength(0)
    expect(pkg.references).toHaveLength(0)
  })

  // —— 往返测试 —— 

  it('AP18: 序列化→反序列化往返保持数据一致', () => {
    const assets = [
      createAssetRecord({ kind: 'image', name: 'a', id: 'img_a', tags: ['t1', 't2'] }),
      createAssetRecord({ kind: 'audio', name: 'b', id: 'aud_b', source: 'builtin' }),
    ]
    const refs = [
      createReference('img_a', 'aud_b', 'uses', 'note'),
    ]
    const original = createPackage('roundtrip', assets, refs)
    const json = serializePackage(original)
    const restored = deserializePackage(json)
    expect(restored.assets).toHaveLength(2)
    expect(restored.assets[0].tags).toEqual(['t1', 't2'])
    expect(restored.assets[1].source).toBe('builtin')
    expect(restored.references).toHaveLength(1)
    expect(restored.references[0].note).toBe('note')
  })
})
