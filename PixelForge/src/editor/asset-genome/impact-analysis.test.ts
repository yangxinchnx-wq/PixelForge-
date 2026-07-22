/**
 * Impact Analysis Tests(Step 35.3)— 影响分析测试套件。
 */
import { describe, it, expect, beforeEach } from 'vitest'

import {
  getDownstreamImpact,
  getUpstreamDependencies,
  getDownstreamDepth,
  hasCycle,
  findCycles,
  topologicalSort,
  getDownstreamImpactDetails,
} from './impactAnalysis'
import {
  createReferenceGraph,
  createReference,
  addReference,
  type ReferenceGraph,
} from './referenceGraph'

describe('Impact Analysis (IA)', () => {
  let g: ReferenceGraph

  beforeEach(() => {
    // 构建测试图(DAG,无环):
    //   a → b → c
    //   a → d
    //   d → c
    //   e → d
    g = createReferenceGraph()
    g = addReference(g, createReference('a', 'b'))
    g = addReference(g, createReference('b', 'c'))
    g = addReference(g, createReference('a', 'd'))
    g = addReference(g, createReference('d', 'c'))
    g = addReference(g, createReference('e', 'd'))
  })

  // —— 下游影响 ——

  it('IA01: getDownstreamImpact 改 c 影响所有引用 c 的上游', () => {
    // c 被 b, d 引用; b 被 a 引用; d 被 a, e 引用
    // 改 c → 影响 b, d, a, e
    const impact = getDownstreamImpact(g, 'c')
    expect(impact.has('b')).toBe(true)
    expect(impact.has('d')).toBe(true)
    expect(impact.has('a')).toBe(true)
    expect(impact.has('e')).toBe(true)
    expect(impact.size).toBe(4)
    expect(impact.has('c')).toBe(false)
  })

  it('IA02: getDownstreamImpact 改 a 影响空集(a 没被引用)', () => {
    const impact = getDownstreamImpact(g, 'a')
    expect(impact.size).toBe(0)
  })

  it('IA03: getDownstreamImpact 改 d 影响 a, e', () => {
    const impact = getDownstreamImpact(g, 'd')
    expect(impact.has('a')).toBe(true)
    expect(impact.has('e')).toBe(true)
    expect(impact.size).toBe(2)
  })

  // —— 上游依赖 ——

  it('IA04: getUpstreamDependencies a 依赖 b, c, d', () => {
    const deps = getUpstreamDependencies(g, 'a')
    expect(deps.has('b')).toBe(true)
    expect(deps.has('c')).toBe(true)
    expect(deps.has('d')).toBe(true)
    expect(deps.size).toBe(3)
    expect(deps.has('a')).toBe(false)
  })

  it('IA05: getUpstreamDependencies c 依赖空集(c 不引用任何)', () => {
    const deps = getUpstreamDependencies(g, 'c')
    expect(deps.size).toBe(0)
  })

  it('IA06: getUpstreamDependencies e 依赖 d, c', () => {
    const deps = getUpstreamDependencies(g, 'e')
    expect(deps.has('d')).toBe(true)
    expect(deps.has('c')).toBe(true)
    expect(deps.size).toBe(2)
  })

  // —— 影响深度 ——

  it('IA07: getDownstreamDepth 改 c 的深度映射', () => {
    const depth = getDownstreamDepth(g, 'c')
    expect(depth.get('b')).toBe(1)
    expect(depth.get('d')).toBe(1)
    expect(depth.get('a')).toBe(2) // a → b → c 或 a → d → c,深度 2
    expect(depth.get('e')).toBe(2) // e → d → c
  })

  it('IA08: getDownstreamDepth 不含自身', () => {
    const depth = getDownstreamDepth(g, 'c')
    expect(depth.has('c')).toBe(false)
  })

  // —— 循环检测(无环) ——

  it('IA09: hasCycle 无环图返回 false', () => {
    expect(hasCycle(g)).toBe(false)
  })

  it('IA10: topologicalSort 无环图可排序', () => {
    const sorted = topologicalSort(g)
    expect(sorted).not.toBeNull()
    expect(sorted!.length).toBe(5)
    // a 必须在 b 之前(a → b)
    expect(sorted!.indexOf('a')).toBeLessThan(sorted!.indexOf('b'))
    expect(sorted!.indexOf('b')).toBeLessThan(sorted!.indexOf('c'))
    expect(sorted!.indexOf('a')).toBeLessThan(sorted!.indexOf('d'))
    expect(sorted!.indexOf('d')).toBeLessThan(sorted!.indexOf('c'))
    expect(sorted!.indexOf('e')).toBeLessThan(sorted!.indexOf('d'))
  })
})

describe('Impact Analysis — Cycles (IAC)', () => {
  it('IAC01: hasCycle 有环图返回 true', () => {
    let g = createReferenceGraph()
    // a → b → c → a(环)
    g = addReference(g, createReference('a', 'b'))
    g = addReference(g, createReference('b', 'c'))
    g = addReference(g, createReference('c', 'a'))
    expect(hasCycle(g)).toBe(true)
  })

  it('IAC02: hasCycle 自环(虽 createReference 禁止,但构造测试图)', () => {
    const g = createReferenceGraph()
    // 单独构造一个简单 2 节点环
    let g2 = addReference(g, createReference('x', 'y'))
    g2 = addReference(g2, createReference('y', 'x'))
    expect(hasCycle(g2)).toBe(true)
  })

  it('IAC03: findCycles 返回环路路径', () => {
    let g = createReferenceGraph()
    g = addReference(g, createReference('a', 'b'))
    g = addReference(g, createReference('b', 'c'))
    g = addReference(g, createReference('c', 'a'))
    const cycles = findCycles(g)
    expect(cycles.length).toBeGreaterThan(0)
    // 每条环路至少 3 个节点 + 回到起点
    for (const cycle of cycles) {
      expect(cycle.length).toBeGreaterThanOrEqual(4) // 3 节点 + 回到起点
      expect(cycle[0]).toBe(cycle[cycle.length - 1])
    }
  })

  it('IAC04: findCycles 无环图返回空数组', () => {
    let g = createReferenceGraph()
    g = addReference(g, createReference('a', 'b'))
    g = addReference(g, createReference('b', 'c'))
    expect(findCycles(g)).toEqual([])
  })

  it('IAC05: topologicalSort 有环图返回 null', () => {
    let g = createReferenceGraph()
    g = addReference(g, createReference('a', 'b'))
    g = addReference(g, createReference('b', 'a'))
    expect(topologicalSort(g)).toBeNull()
  })
})

describe('Impact Analysis — Details (IAD)', () => {
  it('IAD01: getDownstreamImpactDetails 返回路径 + 深度', () => {
    let g = createReferenceGraph()
    g = addReference(g, createReference('a', 'b'))
    g = addReference(g, createReference('b', 'c'))
    const details = getDownstreamImpactDetails(g, 'c')
    // 改 c → 影响 b(深度1) → 影响 a(深度2)
    const bItem = details.find((d) => d.assetId === 'b')
    const aItem = details.find((d) => d.assetId === 'a')
    expect(bItem).toBeDefined()
    expect(bItem!.depth).toBe(1)
    expect(bItem!.path).toContain('c')
    expect(bItem!.path).toContain('b')
    expect(aItem).toBeDefined()
    expect(aItem!.depth).toBe(2)
  })

  it('IAD02: getDownstreamImpactDetails 按深度排序', () => {
    let g = createReferenceGraph()
    g = addReference(g, createReference('a', 'b'))
    g = addReference(g, createReference('b', 'c'))
    const details = getDownstreamImpactDetails(g, 'c')
    for (let i = 1; i < details.length; i++) {
      expect(details[i].depth).toBeGreaterThanOrEqual(details[i - 1].depth)
    }
  })

  it('IAD03: getDownstreamImpactDetails 无影响返回空数组', () => {
    let g = createReferenceGraph()
    g = addReference(g, createReference('a', 'b'))
    const details = getDownstreamImpactDetails(g, 'a')
    expect(details).toEqual([])
  })
})
