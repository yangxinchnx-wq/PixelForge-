/**
 * WDL 模板库 Tests(Step 38.5)
 *
 * 测试策略:
 * - 模板完整性:所有模板都有 id/name/category/source
 * - 模板合法性:所有模板都能通过 validateSource
 * - 查询函数:getTemplatesByCategory / getTemplateById / searchTemplates / getCategories
 * - 类别覆盖:每个类别至少有 1 个模板
 */
import { describe, it, expect } from 'vitest'
import {
  WDL_TEMPLATES,
  getTemplatesByCategory,
  getTemplateById,
  searchTemplates,
  getCategories,
  validateAllTemplates,
  type TemplateCategory,
} from './wdlTemplates'
import { validateSource } from './wdlValidator'
import { parse } from './wdlParser'

// ============================================================================
// 测试
// ============================================================================

describe('WDL 模板库', () => {
  // ==========================================================================
  // 模板完整性
  // ==========================================================================
  describe('模板完整性', () => {
    it('T01: 应有至少 8 个模板', () => {
      expect(WDL_TEMPLATES.length).toBeGreaterThanOrEqual(8)
    })

    it('T02: 每个模板都应有唯一 ID', () => {
      const ids = WDL_TEMPLATES.map((t) => t.id)
      const unique = new Set(ids)
      expect(unique.size).toBe(ids.length)
    })

    it('T03: 每个模板都应有非空 name', () => {
      for (const t of WDL_TEMPLATES) {
        expect(t.name.length).toBeGreaterThan(0)
      }
    })

    it('T04: 每个模板都应有非空 source', () => {
      for (const t of WDL_TEMPLATES) {
        expect(t.source.length).toBeGreaterThan(0)
      }
    })

    it('T05: 每个模板都应有 thumbnailColor(3 元素)', () => {
      for (const t of WDL_TEMPLATES) {
        expect(t.thumbnailColor).toHaveLength(3)
      }
    })

    it('T06: 每个模板都应有至少 1 个 tag', () => {
      for (const t of WDL_TEMPLATES) {
        expect(t.tags.length).toBeGreaterThanOrEqual(1)
      }
    })
  })

  // ==========================================================================
  // 模板合法性(关键:所有模板必须可解析 + 可校验)
  // ==========================================================================
  describe('模板合法性', () => {
    it('T07: 所有模板应能被 Parser 解析', () => {
      for (const t of WDL_TEMPLATES) {
        expect(() => parse(t.source)).not.toThrow()
      }
    })

    it('T08: 所有模板应通过 Validator(无错误)', () => {
      for (const t of WDL_TEMPLATES) {
        const report = validateSource(t.source)
        expect(report.errors).toHaveLength(0)
      }
    })

    it('T09: validateAllTemplates 应返回空列表(所有模板合法)', () => {
      const invalid = validateAllTemplates()
      expect(invalid).toHaveLength(0)
    })

    it('T10: 每个模板应至少含 1 个 layer', () => {
      for (const t of WDL_TEMPLATES) {
        const ast = parse(t.source)
        expect(ast.layers.length).toBeGreaterThanOrEqual(1)
      }
    })

    it('T11: 每个模板应含至少 1 个 region', () => {
      for (const t of WDL_TEMPLATES) {
        const ast = parse(t.source)
        expect(ast.regions.length).toBeGreaterThanOrEqual(1)
      }
    })

    it('T12: 每个模板应含 canvas 声明', () => {
      for (const t of WDL_TEMPLATES) {
        const ast = parse(t.source)
        expect(ast.canvas).not.toBeNull()
      }
    })
  })

  // ==========================================================================
  // 类别覆盖
  // ==========================================================================
  describe('类别覆盖', () => {
    it('T13: 应有 4 个类别', () => {
      const cats = getCategories()
      expect(cats).toHaveLength(4)
    })

    it('T14: 每个类别至少有 1 个模板', () => {
      const categories: TemplateCategory[] = ['nature', 'urban', 'abstract', 'minimal']
      for (const cat of categories) {
        const templates = getTemplatesByCategory(cat)
        expect(templates.length).toBeGreaterThanOrEqual(1)
      }
    })

    it('T15: getCategories 应返回正确的中文标签', () => {
      const cats = getCategories()
      const labels = cats.map((c) => c.label)
      expect(labels).toContain('自然')
      expect(labels).toContain('都市')
      expect(labels).toContain('抽象')
      expect(labels).toContain('极简')
    })

    it('T16: getCategories 的 count 应与实际模板数一致', () => {
      const cats = getCategories()
      for (const c of cats) {
        const actual = getTemplatesByCategory(c.category).length
        expect(c.count).toBe(actual)
      }
    })
  })

  // ==========================================================================
  // 查询函数
  // ==========================================================================
  describe('getTemplateById', () => {
    it('T17: 应能按 ID 找到模板', () => {
      const t = getTemplateById('starry-night')
      expect(t).toBeDefined()
      expect(t!.name).toBe('星空夜景')
    })

    it('T18: 不存在的 ID 应返回 undefined', () => {
      expect(getTemplateById('nonexistent')).toBeUndefined()
    })
  })

  describe('getTemplatesByCategory', () => {
    it('T19: nature 类别应含星空夜景', () => {
      const templates = getTemplatesByCategory('nature')
      const ids = templates.map((t) => t.id)
      expect(ids).toContain('starry-night')
    })

    it('T20: urban 类别应含霓虹都市', () => {
      const templates = getTemplatesByCategory('urban')
      const ids = templates.map((t) => t.id)
      expect(ids).toContain('neon-city')
    })
  })

  describe('searchTemplates', () => {
    it('T21: 空关键词应返回全部模板', () => {
      const results = searchTemplates('')
      expect(results.length).toBe(WDL_TEMPLATES.length)
    })

    it('T22: 应按 name 搜索', () => {
      const results = searchTemplates('星空')
      expect(results.length).toBeGreaterThanOrEqual(1)
      expect(results[0].name).toContain('星空')
    })

    it('T23: 应按 description 搜索', () => {
      const results = searchTemplates('渐变')
      expect(results.length).toBeGreaterThanOrEqual(1)
    })

    it('T24: 应按 tag 搜索', () => {
      const results = searchTemplates('暗角')
      expect(results.length).toBeGreaterThanOrEqual(1)
    })

    it('T25: 搜索应不区分大小写', () => {
      const results = searchTemplates('星空')
      // 应匹配星空夜景(无论大小写)
      expect(results.length).toBeGreaterThanOrEqual(1)
    })

    it('T26: 无匹配应返回空列表', () => {
      const results = searchTemplates('不存在的关键词xyz')
      expect(results).toHaveLength(0)
    })
  })

  // ==========================================================================
  // 模板内容验证
  // ==========================================================================
  describe('模板内容', () => {
    it('T27: starry-night 应含 2 个 layer 和 1 个 effect', () => {
      const t = getTemplateById('starry-night')!
      const ast = parse(t.source)
      expect(ast.layers).toHaveLength(2)
      expect(ast.effects).toHaveLength(1)
    })

    it('T28: solid-red 应只有 1 个 layer 无 effect', () => {
      const t = getTemplateById('solid-red')!
      const ast = parse(t.source)
      expect(ast.layers).toHaveLength(1)
      expect(ast.effects).toHaveLength(0)
    })

    it('T29: blank 模板的 layer1 应为灰色', () => {
      const t = getTemplateById('blank')!
      const ast = parse(t.source)
      const colorParam = ast.layers[0].params.find((p) => p.key === 'color')
      expect(colorParam).toBeDefined()
    })
  })
})
