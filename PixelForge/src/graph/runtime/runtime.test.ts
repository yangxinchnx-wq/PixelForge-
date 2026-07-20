/**
 * Graph Runtime 单元测试(Step 26)。
 *
 * 覆盖:
 * - S:  scheduler(buildSchedule / buildParallelLevels / getNodeDepth)
 * - P:  executionPlan(buildExecutionPlan / summarizeExecutionPlan)
 * - C:  cache(NodeCache / createCacheKey / cacheKeyHash)
 * - TP: texturePool(TexturePool acquire / release / LRU / 统计)
 * - RM: resourceManager(acquireTexture / disposeNode / disposeAll)
 * - E:  evaluator(各 NodeEvaluator 实现 + EvaluatorRegistry + findUpstreamOutput)
 * - GR: graphRuntime(主入口,端到端执行 + 缓存复用 + 失效)
 */

import { describe, it, expect, beforeEach } from 'vitest'

import type { GraphEdge, GraphNode, RenderGraph } from '../types'
import {
  buildParallelLevels,
  buildSchedule,
  getNodeDepth,
} from './scheduler'
import {
  buildExecutionPlan,
  summarizeExecutionPlan,
  type ExecutionPlan,
} from './executionPlan'
import {
  NodeCache,
  cacheKeyHash,
  createCacheKey,
} from './cache'
import { TexturePool } from './texturePool'
import { ResourceManager } from './resourceManager'
import {
  CompositeEvaluator,
  EvaluatorRegistry,
  EffectEvaluator,
  InputEvaluator,
  OutputEvaluator,
  RegionEvaluator,
  getEvaluator,
  getEvaluatorByType,
  type RuntimeContext,
  type TextureHandle,
} from './evaluator'
import { GraphRuntime } from './graphRuntime'

// ============================================================================
// 辅助:构造测试用 Graph / 节点
// ============================================================================

function makeRegionNode(
  id: string,
  opcodeName: string,
  name: string = '测试节点',
  position = { x: 100, y: 100 },
): GraphNode {
  return {
    id,
    type: 'REGION',
    name,
    position,
    inputs: [{ id: 'input', name: 'background', type: 'texture' }],
    outputs: [{ id: 'output', name: 'texture', type: 'texture' }],
    params: { scale: 24 },
    opcodeName,
  }
}

function makeEffectNode(
  id: string,
  effectType: string,
  name: string = '效果节点',
  position = { x: 200, y: 100 },
): GraphNode {
  return {
    id,
    type: 'EFFECT',
    name,
    position,
    inputs: [{ id: 'input', name: 'source', type: 'texture' }],
    outputs: [{ id: 'output', name: 'texture', type: 'texture' }],
    params: { strength: 0.5 },
    opcodeName: effectType,
  }
}

function makeOutputNode(
  id: string = 'output_node',
  position = { x: 400, y: 100 },
): GraphNode {
  return {
    id,
    type: 'OUTPUT',
    name: '输出',
    position,
    inputs: [{ id: 'input', name: 'source', type: 'texture' }],
    outputs: [],
    params: {},
  }
}

function makeCompositeNode(
  id: string,
  position = { x: 300, y: 200 },
): GraphNode {
  return {
    id,
    type: 'COMPOSITE',
    name: '合成',
    position,
    inputs: [
      { id: 'input_0', name: 'source_0', type: 'texture' },
      { id: 'input_1', name: 'source_1', type: 'texture' },
    ],
    outputs: [{ id: 'output', name: 'texture', type: 'texture' }],
    params: {},
  }
}

function makeEdge(from: string, to: string, fromPort = 'output', toPort = 'input'): GraphEdge {
  return {
    id: `${from}:${fromPort}->${to}:${toPort}`,
    from,
    fromPort,
    to,
    toPort,
  }
}

/** Noise → Output(最小有效 Graph) */
function makeMinimalGraph(): RenderGraph {
  return {
    nodes: [makeRegionNode('noise1', 'NOISE', '噪声'), makeOutputNode('output1')],
    edges: [makeEdge('noise1', 'output1')],
  }
}

/**
 * 钻石形 Graph(用于测试并行层级):
 *   Noise → Galaxy ↘
 *                  Composite → Output
 *   Noise → Star   ↗
 *
 * 注意:同一个 Noise 节点的 output 端口可连接到多个目标(端口允许多对一,但端口对端口只能一对一)。
 * 这里用两个独立的 REGION 节点(galaxy / star)模拟分叉,共享同一个 noise 前驱。
 */
function makeDiamondGraph(): RenderGraph {
  return {
    nodes: [
      makeRegionNode('noise', 'NOISE', '噪声'),
      makeRegionNode('galaxy', 'CIRCLE_SHAPE', '银河'),
      makeRegionNode('star', 'CIRCLE_SHAPE', '星辰'),
      makeCompositeNode('composite'),
      makeOutputNode('output'),
    ],
    edges: [
      makeEdge('noise', 'galaxy'),
      makeEdge('noise', 'star'),
      makeEdge('galaxy', 'composite', 'output', 'input_0'),
      makeEdge('star', 'composite', 'output', 'input_1'),
      makeEdge('composite', 'output'),
    ],
  }
}

/** 完整链式:Noise → Blur → Output */
function makeChainGraph(): RenderGraph {
  return {
    nodes: [
      makeRegionNode('noise', 'NOISE', '噪声'),
      makeEffectNode('blur', 'blur', '模糊'),
      makeOutputNode('output'),
    ],
    edges: [makeEdge('noise', 'blur'), makeEdge('blur', 'output')],
  }
}

// ============================================================================
// S: scheduler
// ============================================================================

describe('graph/runtime/scheduler', () => {
  it('S1: buildSchedule 对最小图返回 [noise, output]', () => {
    const order = buildSchedule(makeMinimalGraph())
    expect(order).toEqual(['noise1', 'output1'])
  })

  it('S2: buildSchedule 对链式图返回拓扑序', () => {
    const order = buildSchedule(makeChainGraph())
    expect(order).toEqual(['noise', 'blur', 'output'])
  })

  it('S3: buildSchedule 对钻石图返回拓扑序(依赖在前)', () => {
    const order = buildSchedule(makeDiamondGraph())
    // noise 必须在最前,output 在最后
    expect(order[0]).toBe('noise')
    expect(order[order.length - 1]).toBe('output')
    // galaxy / star 必须在 noise 之后,composite 之前
    const noiseIdx = order.indexOf('noise')
    const galaxyIdx = order.indexOf('galaxy')
    const starIdx = order.indexOf('star')
    const compositeIdx = order.indexOf('composite')
    const outputIdx = order.indexOf('output')
    expect(galaxyIdx).toBeGreaterThan(noiseIdx)
    expect(starIdx).toBeGreaterThan(noiseIdx)
    expect(compositeIdx).toBeGreaterThan(galaxyIdx)
    expect(compositeIdx).toBeGreaterThan(starIdx)
    expect(outputIdx).toBeGreaterThan(compositeIdx)
  })

  it('S4: buildSchedule 包含所有节点', () => {
    const graph = makeDiamondGraph()
    const order = buildSchedule(graph)
    expect(order).toHaveLength(graph.nodes.length)
    for (const node of graph.nodes) {
      expect(order).toContain(node.id)
    }
  })

  it('S5: buildParallelLevels 对最小图返回 2 层', () => {
    const levels = buildParallelLevels(makeMinimalGraph())
    expect(levels).toEqual([['noise1'], ['output1']])
  })

  it('S6: buildParallelLevels 对钻石图返回 4 层,且 galaxy/star 同层', () => {
    const levels = buildParallelLevels(makeDiamondGraph())
    expect(levels).toHaveLength(4)
    expect(levels[0]).toEqual(['noise'])
    // 第二层应包含 galaxy + star(顺序无要求)
    expect(levels[1]).toContain('galaxy')
    expect(levels[1]).toContain('star')
    expect(levels[1]).toHaveLength(2)
    expect(levels[2]).toEqual(['composite'])
    expect(levels[3]).toEqual(['output'])
  })

  it('S7: getNodeDepth 返回正确深度', () => {
    const graph = makeDiamondGraph()
    expect(getNodeDepth(graph, 'noise')).toBe(0)
    expect(getNodeDepth(graph, 'galaxy')).toBe(1)
    expect(getNodeDepth(graph, 'star')).toBe(1)
    expect(getNodeDepth(graph, 'composite')).toBe(2)
    expect(getNodeDepth(graph, 'output')).toBe(3)
  })

  it('S8: getNodeDepth 不存在的节点返回 -1', () => {
    expect(getNodeDepth(makeMinimalGraph(), 'not_exist')).toBe(-1)
  })

  it('S9: buildSchedule 对孤立节点也包含', () => {
    const graph: RenderGraph = {
      nodes: [
        makeRegionNode('orphan', 'NOISE', '孤立'),
        makeOutputNode('output'),
        makeRegionNode('noise', 'NOISE', '噪声'),
      ],
      edges: [makeEdge('noise', 'output')],
    }
    const order = buildSchedule(graph)
    expect(order).toContain('orphan')
    expect(order).toContain('noise')
    expect(order).toContain('output')
  })
})

// ============================================================================
// P: executionPlan
// ============================================================================

describe('graph/runtime/executionPlan', () => {
  it('P1: buildExecutionPlan 返回 steps + levels', () => {
    const plan = buildExecutionPlan(makeMinimalGraph())
    expect(plan.steps).toHaveLength(2)
    expect(plan.levels).toHaveLength(2)
    expect(plan.steps[0].id).toBe('noise1')
    expect(plan.steps[0].node.id).toBe('noise1')
    expect(plan.steps[0].dependencies).toEqual([])
    expect(plan.steps[1].id).toBe('output1')
    expect(plan.steps[1].dependencies).toEqual(['noise1'])
  })

  it('P2: buildExecutionPlan 钻石图 dependencies 正确', () => {
    const plan = buildExecutionPlan(makeDiamondGraph())
    const composite = plan.steps.find((s) => s.id === 'composite')!
    expect(composite.dependencies).toContain('galaxy')
    expect(composite.dependencies).toContain('star')
    expect(composite.dependencies).toHaveLength(2)

    const output = plan.steps.find((s) => s.id === 'output')!
    expect(output.dependencies).toEqual(['composite'])
  })

  it('P3: buildExecutionPlan step.node 引用原始节点对象', () => {
    const graph = makeMinimalGraph()
    const plan = buildExecutionPlan(graph)
    // 引用应相等(避免复制)
    expect(plan.steps[0].node).toBe(graph.nodes[0])
    expect(plan.steps[1].node).toBe(graph.nodes[1])
  })

  it('P4: summarizeExecutionPlan 返回可读摘要', () => {
    const plan = buildExecutionPlan(makeDiamondGraph())
    const summary = summarizeExecutionPlan(plan)
    expect(summary).toContain('5 步')
    expect(summary).toContain('4 层')
    expect(summary).toContain('并行度 2')
  })

  it('P5: ExecutionPlan 类型字段完整', () => {
    const plan: ExecutionPlan = buildExecutionPlan(makeMinimalGraph())
    expect(Array.isArray(plan.steps)).toBe(true)
    expect(Array.isArray(plan.levels)).toBe(true)
    expect(plan.steps[0]).toHaveProperty('id')
    expect(plan.steps[0]).toHaveProperty('node')
    expect(plan.steps[0]).toHaveProperty('dependencies')
  })
})

// ============================================================================
// C: cache
// ============================================================================

describe('graph/runtime/cache', () => {
  it('C1: NodeCache 基本 set / get / has', () => {
    const cache = new NodeCache<string>()
    cache.set('key1', 'value1', 'nodeA')
    expect(cache.has('key1')).toBe(true)
    expect(cache.get('key1')).toBe('value1')
  })

  it('C2: NodeCache get 未命中返回 undefined', () => {
    const cache = new NodeCache<string>()
    expect(cache.get('not_exist')).toBeUndefined()
    expect(cache.has('not_exist')).toBe(false)
  })

  it('C3: NodeCache delete 删除单项', () => {
    const cache = new NodeCache<string>()
    cache.set('key1', 'value1', 'nodeA')
    expect(cache.delete('key1')).toBe(true)
    expect(cache.has('key1')).toBe(false)
  })

  it('C4: NodeCache invalidateNode 按 nodeId 失效', () => {
    const cache = new NodeCache<string>()
    cache.set('key1', 'v1', 'nodeA')
    cache.set('key2', 'v2', 'nodeA')
    cache.set('key3', 'v3', 'nodeB')
    const removed = cache.invalidateNode('nodeA')
    expect(removed).toBe(2)
    expect(cache.has('key1')).toBe(false)
    expect(cache.has('key2')).toBe(false)
    expect(cache.has('key3')).toBe(true)
  })

  it('C5: NodeCache clear 清空全部', () => {
    const cache = new NodeCache<string>()
    cache.set('k1', 'v1', 'n1')
    cache.set('k2', 'v2', 'n2')
    cache.clear()
    expect(cache.size).toBe(0)
  })

  it('C6: NodeCache size 返回当前条数', () => {
    const cache = new NodeCache<string>()
    expect(cache.size).toBe(0)
    cache.set('k1', 'v1', 'n1')
    expect(cache.size).toBe(1)
    cache.set('k2', 'v2', 'n2')
    expect(cache.size).toBe(2)
  })

  it('C7: NodeCache debugEntries 返回元信息', () => {
    const cache = new NodeCache<string>()
    cache.set('k1', 'v1', 'n1')
    const entries = cache.debugEntries()
    expect(entries).toHaveLength(1)
    expect(entries[0].key).toBe('k1')
    expect(entries[0].nodeId).toBe('n1')
    expect(entries[0].timestamp).toBeGreaterThan(0)
  })

  it('C8: createCacheKey 包含 type / opcodeName / canvas', () => {
    const node = makeRegionNode('n1', 'NOISE')
    const key = createCacheKey(node, [], { width: 1920, height: 1080 })
    expect(key).toContain('REGION')
    expect(key).toContain('NOISE')
    expect(key).toContain('1920x1080')
  })

  it('C9: createCacheKey 相同输入产生相同 key', () => {
    const node1 = makeRegionNode('n1', 'NOISE')
    const node2 = makeRegionNode('n2', 'NOISE')  // 不同 id 但其他相同
    const canvas = { width: 1920, height: 1080 }
    const key1 = createCacheKey(node1, [], canvas)
    const key2 = createCacheKey(node2, [], canvas)
    // key 不依赖 id,只依赖 type + opcodeName + params + inputs + canvas
    expect(key1).toBe(key2)
  })

  it('C10: createCacheKey 不同 params 产生不同 key', () => {
    const node1 = makeRegionNode('n1', 'NOISE')
    const node2 = { ...node1, params: { scale: 48 } }
    const canvas = { width: 1920, height: 1080 }
    const key1 = createCacheKey(node1, [], canvas)
    const key2 = createCacheKey(node2, [], canvas)
    expect(key1).not.toBe(key2)
  })

  it('C11: createCacheKey 不同 canvas 产生不同 key', () => {
    const node = makeRegionNode('n1', 'NOISE')
    const key1 = createCacheKey(node, [], { width: 1920, height: 1080 })
    const key2 = createCacheKey(node, [], { width: 1280, height: 720 })
    expect(key1).not.toBe(key2)
  })

  it('C12: createCacheKey 不同 inputCacheKeys 产生不同 key', () => {
    const node = makeEffectNode('e1', 'blur')
    const canvas = { width: 1920, height: 1080 }
    const key1 = createCacheKey(node, ['upstream_a'], canvas)
    const key2 = createCacheKey(node, ['upstream_b'], canvas)
    expect(key1).not.toBe(key2)
  })

  it('C13: createCacheKey params 键顺序不影响 key(stableStringify)', () => {
    const canvas = { width: 1920, height: 1080 }
    const node1: GraphNode = {
      ...makeRegionNode('n1', 'NOISE'),
      params: { a: 1, b: 2 },
    }
    const node2: GraphNode = {
      ...makeRegionNode('n1', 'NOISE'),
      params: { b: 2, a: 1 },
    }
    expect(createCacheKey(node1, [], canvas)).toBe(createCacheKey(node2, [], canvas))
  })

  it('C14: cacheKeyHash 返回 8 位 hex', () => {
    const hash = cacheKeyHash('REGION|NOISE|...|1920x1080')
    expect(hash).toMatch(/^[0-9a-f]{8}$/)
  })

  it('C15: cacheKeyHash 相同输入相同输出', () => {
    const key = 'REGION|NOISE|...|1920x1080'
    expect(cacheKeyHash(key)).toBe(cacheKeyHash(key))
  })
})

// ============================================================================
// TP: texturePool
// ============================================================================

describe('graph/runtime/texturePool', () => {
  it('TP1: acquire 首次创建新纹理(miss)', () => {
    const pool = new TexturePool()
    const tex = pool.acquire({ width: 1920, height: 1080 })
    expect(tex.id).toMatch(/^tex_/)
    expect(tex.inUse).toBe(true)
    expect(tex.descriptor.width).toBe(1920)
    expect(tex.descriptor.height).toBe(1080)
    expect(tex.descriptor.format).toBe('rgba8unorm')
    expect(tex.gpuTexture).toBeUndefined()  // 未注入 createGpuTexture
    expect(pool.size).toBe(1)
    expect(pool.inUseCount).toBe(1)
  })

  it('TP2: acquire 同尺寸但池中无可用(inUse)时新建', () => {
    const pool = new TexturePool()
    const t1 = pool.acquire({ width: 1920, height: 1080 })
    const t2 = pool.acquire({ width: 1920, height: 1080 })
    expect(t1.id).not.toBe(t2.id)
    expect(pool.size).toBe(2)
  })

  it('TP3: acquire 同尺寸 + release 后可复用(hit)', () => {
    const pool = new TexturePool()
    const t1 = pool.acquire({ width: 1920, height: 1080 })
    pool.release(t1)
    const t2 = pool.acquire({ width: 1920, height: 1080 })
    expect(t2.id).toBe(t1.id)  // 复用
    expect(pool.size).toBe(1)
  })

  it('TP4: acquire 不同尺寸不复用', () => {
    const pool = new TexturePool()
    const t1 = pool.acquire({ width: 1920, height: 1080 })
    pool.release(t1)
    const t2 = pool.acquire({ width: 1280, height: 720 })
    expect(t2.id).not.toBe(t1.id)
    expect(pool.size).toBe(2)
  })

  it('TP5: acquire 不同 format 不复用', () => {
    const pool = new TexturePool()
    const t1 = pool.acquire({ width: 1920, height: 1080, format: 'rgba8unorm' })
    pool.release(t1)
    const t2 = pool.acquire({ width: 1920, height: 1080, format: 'rg16float' })
    expect(t2.id).not.toBe(t1.id)
  })

  it('TP6: release 后 inUse=false, availableCount +1', () => {
    const pool = new TexturePool()
    const t = pool.acquire({ width: 100, height: 100 })
    expect(pool.availableCount).toBe(0)
    pool.release(t)
    expect(t.inUse).toBe(false)
    expect(pool.availableCount).toBe(1)
    expect(pool.inUseCount).toBe(0)
  })

  it('TP7: LRU 淘汰 - 池满时释放最久未使用', () => {
    const pool = new TexturePool({ maxPoolSize: 2 })
    const t1 = pool.acquire({ width: 100, height: 100 })
    pool.acquire({ width: 200, height: 200 })
    pool.release(t1)  // t1.lastUsedAt 早于 t2
    // 池已满,新建一个不同尺寸的 → 应淘汰 t1(LRU)
    pool.acquire({ width: 300, height: 300 })
    expect(pool.size).toBeLessThanOrEqual(2)
  })

  it('TP8: destroyTexture 从池中移除', () => {
    const pool = new TexturePool()
    const t = pool.acquire({ width: 100, height: 100 })
    expect(pool.size).toBe(1)
    pool.destroyTexture(t)
    expect(pool.size).toBe(0)
  })

  it('TP9: clear 清空池', () => {
    const pool = new TexturePool()
    pool.acquire({ width: 100, height: 100 })
    pool.acquire({ width: 200, height: 200 })
    expect(pool.size).toBe(2)
    pool.clear()
    expect(pool.size).toBe(0)
  })

  it('TP10: getStats 返回正确统计', () => {
    const pool = new TexturePool()
    const t1 = pool.acquire({ width: 100, height: 100 })
    pool.acquire({ width: 200, height: 200 })
    pool.release(t1)
    const stats = pool.getStats()
    expect(stats.poolSize).toBe(2)
    expect(stats.inUse).toBe(1)
    expect(stats.available).toBe(1)
    expect(stats.totalAcquired).toBe(2)
    expect(stats.totalHits).toBe(0)
    expect(stats.totalMisses).toBe(2)
  })

  it('TP11: 注入 createGpuTexture 时 acquire 调用', () => {
    let called = 0
    const fakeGpuTexture = { destroy: () => {} } as unknown as GPUTexture
    const pool = new TexturePool({
      createGpuTexture: () => {
        called++
        return fakeGpuTexture
      },
    })
    const t = pool.acquire({ width: 100, height: 100 })
    expect(called).toBe(1)
    expect(t.gpuTexture).toBe(fakeGpuTexture)
  })

  it('TP12: 注入 destroyGpuTexture 时 clear 调用', () => {
    let destroyed = 0
    const fakeGpuTexture = { destroy: () => {} } as unknown as GPUTexture
    const pool = new TexturePool({
      createGpuTexture: () => fakeGpuTexture,
      destroyGpuTexture: () => {
        destroyed++
      },
    })
    pool.acquire({ width: 100, height: 100 })
    pool.acquire({ width: 200, height: 200 })
    pool.clear()
    expect(destroyed).toBe(2)
  })

  it('TP13: release 不存在的纹理不报错(已被 LRU 淘汰)', () => {
    const pool = new TexturePool({ maxPoolSize: 1 })
    const t1 = pool.acquire({ width: 100, height: 100 })
    // 新建不同尺寸 → t1 应被 LRU 淘汰
    pool.acquire({ width: 200, height: 200 })
    // 此时 t1 已不在池中,release 不应报错
    expect(() => pool.release(t1)).not.toThrow()
  })
})

// ============================================================================
// RM: resourceManager
// ============================================================================

describe('graph/runtime/resourceManager', () => {
  it('RM1: acquireTexture 返回 PooledTexture 并跟踪 nodeId', () => {
    const rm = new ResourceManager()
    const tex = rm.acquireTexture('nodeA', { width: 1920, height: 1080 })
    expect(tex.id).toMatch(/^tex_/)
    expect(rm.getNodeTextures('nodeA')).toContain(tex.id)
  })

  it('RM2: acquireTexture 多次调用累积到同一 nodeId', () => {
    const rm = new ResourceManager()
    rm.acquireTexture('nodeA', { width: 100, height: 100 })
    rm.acquireTexture('nodeA', { width: 200, height: 200 })
    expect(rm.getNodeTextures('nodeA')).toHaveLength(2)
  })

  it('RM3: disposeNode 释放该节点所有纹理', () => {
    const rm = new ResourceManager()
    rm.acquireTexture('nodeA', { width: 100, height: 100 })
    rm.acquireTexture('nodeA', { width: 200, height: 200 })
    rm.acquireTexture('nodeB', { width: 300, height: 300 })
    const released = rm.disposeNode('nodeA')
    expect(released).toBe(2)
    expect(rm.getNodeTextures('nodeA')).toHaveLength(0)
    expect(rm.getNodeTextures('nodeB')).toHaveLength(1)
  })

  it('RM4: disposeNode 不存在的节点返回 0', () => {
    const rm = new ResourceManager()
    expect(rm.disposeNode('not_exist')).toBe(0)
  })

  it('RM5: disposeAll 清空所有资源', () => {
    const rm = new ResourceManager()
    rm.acquireTexture('nodeA', { width: 100, height: 100 })
    rm.acquireTexture('nodeB', { width: 200, height: 200 })
    rm.disposeAll()
    expect(rm.getNodeTextures('nodeA')).toHaveLength(0)
    expect(rm.getNodeTextures('nodeB')).toHaveLength(0)
  })

  it('RM6: releaseTexture 标记单纹理为可复用', () => {
    const rm = new ResourceManager()
    const tex = rm.acquireTexture('nodeA', { width: 100, height: 100 })
    rm.releaseTexture(tex)
    // 节点仍持有引用(只是池中标记为 available)
    expect(rm.getNodeTextures('nodeA')).toContain(tex.id)
  })

  it('RM7: getStats 包含 nodeCount', () => {
    const rm = new ResourceManager()
    rm.acquireTexture('nodeA', { width: 100, height: 100 })
    rm.acquireTexture('nodeB', { width: 200, height: 200 })
    const stats = rm.getStats()
    expect(stats.nodeCount).toBe(2)
    expect(stats.poolSize).toBe(2)
  })

  it('RM8: getTexturePool 暴露内部池', () => {
    const rm = new ResourceManager()
    const pool = rm.getTexturePool()
    expect(pool).toBeInstanceOf(TexturePool)
  })

  it('RM9: 复用外部 TexturePool', () => {
    const externalPool = new TexturePool()
    const rm = new ResourceManager({ texturePool: externalPool })
    expect(rm.getTexturePool()).toBe(externalPool)
  })
})

// ============================================================================
// E: evaluator
// ============================================================================

describe('graph/runtime/evaluator', () => {
  function makeContext(
    overrides: Partial<RuntimeContext> = {},
  ): RuntimeContext {
    return {
      resources: new ResourceManager(),
      canvas: { width: 1920, height: 1080 },
      outputs: new Map<string, TextureHandle>(),
      currentNodeId: 'test_node',
      predecessors: [],
      ...overrides,
    }
  }

  it('E1: EvaluatorRegistry 包含 5 种 NodeType', () => {
    expect(EvaluatorRegistry.INPUT).toBeInstanceOf(InputEvaluator)
    expect(EvaluatorRegistry.REGION).toBeInstanceOf(RegionEvaluator)
    expect(EvaluatorRegistry.EFFECT).toBeInstanceOf(EffectEvaluator)
    expect(EvaluatorRegistry.COMPOSITE).toBeInstanceOf(CompositeEvaluator)
    expect(EvaluatorRegistry.OUTPUT).toBeInstanceOf(OutputEvaluator)
  })

  it('E2: getEvaluatorByType 返回正确 evaluator', () => {
    expect(getEvaluatorByType('REGION')).toBe(EvaluatorRegistry.REGION)
    expect(getEvaluatorByType('EFFECT')).toBe(EvaluatorRegistry.EFFECT)
    expect(getEvaluatorByType('OUTPUT')).toBe(EvaluatorRegistry.OUTPUT)
    expect(getEvaluatorByType('COMPOSITE')).toBe(EvaluatorRegistry.COMPOSITE)
    expect(getEvaluatorByType('INPUT')).toBe(EvaluatorRegistry.INPUT)
  })

  it('E3: getEvaluatorByType 未知 type 抛错', () => {
    // 类型系统会拦截,但运行时仍要防御
    expect(() => getEvaluatorByType('UNKNOWN' as never)).toThrow(/未知节点类型/)
  })

  it('E4: getEvaluator(node) 按 node.type 分发', () => {
    const regionNode = makeRegionNode('r1', 'NOISE')
    const effectNode = makeEffectNode('e1', 'blur')
    const outputNode = makeOutputNode('o1')
    expect(getEvaluator(regionNode)).toBe(EvaluatorRegistry.REGION)
    expect(getEvaluator(effectNode)).toBe(EvaluatorRegistry.EFFECT)
    expect(getEvaluator(outputNode)).toBe(EvaluatorRegistry.OUTPUT)
  })

  it('E5: RegionEvaluator.execute 返回 fresh TextureHandle', async () => {
    const evaluator = new RegionEvaluator()
    const node = makeRegionNode('r1', 'NOISE')
    const ctx = makeContext({ currentNodeId: 'r1' })
    const handle = await evaluator.execute(node, ctx)
    expect(handle.source).toBe('fresh')
    expect(handle.nodeType).toBe('REGION')
    expect(handle.opcodeName).toBe('NOISE')
    expect(handle.width).toBe(1920)
    expect(handle.height).toBe(1080)
    expect(handle.paramsHash).toMatch(/^[0-9a-f]{8}$/)
    expect(handle.gpuTexture).toBeUndefined()  // 测试环境无 GPU
  })

  it('E6: EffectEvaluator 无上游时返回 fresh(空纹理)', async () => {
    const evaluator = new EffectEvaluator()
    const node = makeEffectNode('e1', 'blur')
    const ctx = makeContext({ currentNodeId: 'e1', predecessors: [] })
    const handle = await evaluator.execute(node, ctx)
    expect(handle.source).toBe('fresh')
    expect(handle.nodeType).toBe('EFFECT')
  })

  it('E7: EffectEvaluator 有上游时返回 fresh(尺寸跟随上游)', async () => {
    const evaluator = new EffectEvaluator()
    const node = makeEffectNode('e1', 'blur')
    const upstream: TextureHandle = {
      id: 'upstream_tex',
      width: 1280,
      height: 720,
      source: 'fresh',
      nodeType: 'REGION',
      paramsHash: 'deadbeef',
    }
    const ctx = makeContext({
      currentNodeId: 'e1',
      predecessors: ['r1'],
      outputs: new Map([['r1', upstream]]),
    })
    const handle = await evaluator.execute(node, ctx)
    expect(handle.source).toBe('fresh')
    expect(handle.width).toBe(1280)  // 跟随上游
    expect(handle.height).toBe(720)
  })

  it('E8: OutputEvaluator 透传上游(passthrough)', async () => {
    const evaluator = new OutputEvaluator()
    const node = makeOutputNode('o1')
    const upstream: TextureHandle = {
      id: 'upstream_tex',
      width: 1920,
      height: 1080,
      source: 'fresh',
      nodeType: 'REGION',
      paramsHash: 'abcd1234',
    }
    const ctx = makeContext({
      currentNodeId: 'o1',
      predecessors: ['r1'],
      outputs: new Map([['r1', upstream]]),
    })
    const handle = await evaluator.execute(node, ctx)
    expect(handle.source).toBe('passthrough')
    expect(handle.nodeType).toBe('OUTPUT')
    expect(handle.id).toBe('upstream_tex')  // 透传上游 id
    expect(handle.width).toBe(1920)
  })

  it('E9: OutputEvaluator 无上游时返回 fresh(空纹理)', async () => {
    const evaluator = new OutputEvaluator()
    const node = makeOutputNode('o1')
    const ctx = makeContext({ currentNodeId: 'o1', predecessors: [] })
    const handle = await evaluator.execute(node, ctx)
    expect(handle.source).toBe('fresh')
  })

  it('E10: CompositeEvaluator.execute 返回画布尺寸 TextureHandle', async () => {
    const evaluator = new CompositeEvaluator()
    const node = makeCompositeNode('c1')
    const ctx = makeContext({ currentNodeId: 'c1' })
    const handle = await evaluator.execute(node, ctx)
    expect(handle.source).toBe('fresh')
    expect(handle.nodeType).toBe('COMPOSITE')
    expect(handle.width).toBe(1920)
    expect(handle.height).toBe(1080)
  })

  it('E11: InputEvaluator.execute 返回 fresh TextureHandle', async () => {
    const evaluator = new InputEvaluator()
    const node: GraphNode = {
      id: 'i1',
      type: 'INPUT',
      name: '输入',
      position: { x: 0, y: 0 },
      inputs: [],
      outputs: [{ id: 'output', name: 'texture', type: 'texture' }],
      params: {},
    }
    const ctx = makeContext({ currentNodeId: 'i1' })
    const handle = await evaluator.execute(node, ctx)
    expect(handle.source).toBe('fresh')
    expect(handle.nodeType).toBe('INPUT')
  })

  it('E12: findUpstreamOutput 使用 predecessors 而非遍历全部 outputs', async () => {
    // 场景:OUTPUT 节点有 1 个直接前驱(region1),
    // 但 ctx.outputs 中还有间接祖先(noise1)。
    // 旧实现会返回 noise1(错误),新实现应返回 region1(直接前驱)。
    const evaluator = new OutputEvaluator()
    const node = makeOutputNode('output1')

    const noiseHandle: TextureHandle = {
      id: 'noise_tex',
      width: 1920,
      height: 1080,
      source: 'fresh',
      nodeType: 'REGION',
      opcodeName: 'NOISE',
      paramsHash: 'noise_hash',
    }
    const regionHandle: TextureHandle = {
      id: 'region_tex',
      width: 1920,
      height: 1080,
      source: 'fresh',
      nodeType: 'REGION',
      opcodeName: 'CIRCLE_SHAPE',
      paramsHash: 'region_hash',
    }

    const ctx = makeContext({
      currentNodeId: 'output1',
      predecessors: ['region1'],  // 只有 region1 是直接前驱
      outputs: new Map([
        ['noise1', noiseHandle],    // 间接祖先(不在 predecessors 中)
        ['region1', regionHandle],  // 直接前驱
      ]),
    })

    const handle = await evaluator.execute(node, ctx)
    // 应透传 region1 的纹理,而非 noise1
    expect(handle.id).toBe('region_tex')
  })

  it('E13: 不同 params 产生不同 paramsHash', async () => {
    const evaluator = new RegionEvaluator()
    const node1 = makeRegionNode('r1', 'NOISE')
    const node2 = { ...node1, params: { scale: 48 } }
    const ctx = makeContext({ currentNodeId: 'r1' })
    const h1 = await evaluator.execute(node1, ctx)
    const h2 = await evaluator.execute(node2, ctx)
    expect(h1.paramsHash).not.toBe(h2.paramsHash)
  })

  it('E14: 同 params 产生相同 paramsHash', async () => {
    const evaluator = new RegionEvaluator()
    const node1 = makeRegionNode('r1', 'NOISE')
    const node2 = makeRegionNode('r2', 'NOISE')  // 不同 id,相同 params
    const ctx1 = makeContext({ currentNodeId: 'r1' })
    const ctx2 = makeContext({ currentNodeId: 'r2' })
    const h1 = await evaluator.execute(node1, ctx1)
    const h2 = await evaluator.execute(node2, ctx2)
    expect(h1.paramsHash).toBe(h2.paramsHash)
  })
})

// ============================================================================
// GR: graphRuntime
// ============================================================================

describe('graph/runtime/graphRuntime', () => {
  beforeEach(() => {
    // 每个测试用例独立的 runtime,不共享缓存
  })

  it('GR1: 最小图能执行并返回 OUTPUT 的 TextureHandle', async () => {
    const runtime = new GraphRuntime(makeMinimalGraph())
    const result = await runtime.execute()
    expect(result.output).toBeDefined()
    expect(result.output.nodeType).toBe('OUTPUT')
    expect(result.output.source).toBe('passthrough')  // OUTPUT 透传上游
    expect(result.output.width).toBe(1920)
    expect(result.output.height).toBe(1080)
  })

  it('GR2: 链式图 Noise → Blur → Output 正确执行', async () => {
    const runtime = new GraphRuntime(makeChainGraph())
    const result = await runtime.execute()
    expect(result.output).toBeDefined()
    expect(result.outputs.size).toBe(3)
    expect(result.steps).toHaveLength(3)
    // 拓扑序:noise → blur → output
    expect(result.steps[0].nodeId).toBe('noise')
    expect(result.steps[1].nodeId).toBe('blur')
    expect(result.steps[2].nodeId).toBe('output')
  })

  it('GR3: 钻石图正确执行(测试并行层级 + COMPOSITE)', async () => {
    const runtime = new GraphRuntime(makeDiamondGraph())
    const result = await runtime.execute()
    expect(result.output).toBeDefined()
    expect(result.outputs.size).toBe(5)  // noise + galaxy + star + composite + output
    expect(result.steps).toHaveLength(5)
    // planSummary 应包含 4 层 + 并行度 2
    expect(result.planSummary).toContain('4 层')
    expect(result.planSummary).toContain('并行度 2')
  })

  it('GR4: 首次执行全部 cache miss', async () => {
    const runtime = new GraphRuntime(makeMinimalGraph())
    const result = await runtime.execute()
    expect(result.cacheHits).toBe(0)
    expect(result.cacheMisses).toBe(2)  // noise + output
    expect(result.steps.every((s) => !s.cacheHit)).toBe(true)
  })

  it('GR5: 复用 cache 时第二次全部 hit', async () => {
    const rm = new ResourceManager()
    const cache = new NodeCache<TextureHandle>()
    const graph = makeMinimalGraph()

    const runtime1 = new GraphRuntime(graph, { resourceManager: rm, cache })
    const r1 = await runtime1.execute()
    expect(r1.cacheHits).toBe(0)
    expect(r1.cacheMisses).toBe(2)

    const runtime2 = new GraphRuntime(graph, { resourceManager: rm, cache })
    const r2 = await runtime2.execute()
    expect(r2.cacheHits).toBe(2)
    expect(r2.cacheMisses).toBe(0)
    expect(r2.steps.every((s) => s.cacheHit)).toBe(true)
  })

  it('GR6: disableCache 时全部 miss', async () => {
    const runtime = new GraphRuntime(makeMinimalGraph(), { disableCache: true })
    const r1 = await runtime.execute()
    const r2 = await runtime.execute()
    expect(r1.cacheHits).toBe(0)
    expect(r1.cacheMisses).toBe(2)
    expect(r2.cacheHits).toBe(0)
    expect(r2.cacheMisses).toBe(2)
  })

  it('GR7: 参数变化时下游 cache miss(传递性失效)', async () => {
    const rm = new ResourceManager()
    const cache = new NodeCache<TextureHandle>()

    // 第一次:Noise → Output
    const graph1 = makeMinimalGraph()
    const runtime1 = new GraphRuntime(graph1, { resourceManager: rm, cache })
    await runtime1.execute()
    expect(cache.size).toBe(2)

    // 第二次:修改 Noise 的 params(应导致 Noise + Output 都 miss)
    const graph2: RenderGraph = {
      nodes: [
        { ...makeRegionNode('noise1', 'NOISE'), params: { scale: 100 } },
        makeOutputNode('output1'),
      ],
      edges: [makeEdge('noise1', 'output1')],
    }
    const runtime2 = new GraphRuntime(graph2, { resourceManager: rm, cache })
    const r2 = await runtime2.execute()
    // noise 因 params 变化 → cache miss
    // output 因 noise 的 cacheKey 变化(inputCacheKeys)→ cache miss
    expect(r2.cacheHits).toBe(0)
    expect(r2.cacheMisses).toBe(2)
  })

  it('GR8: 画布尺寸变化时全部 miss', async () => {
    const rm = new ResourceManager()
    const cache = new NodeCache<TextureHandle>()
    const graph = makeMinimalGraph()

    const runtime1 = new GraphRuntime(graph, {
      resourceManager: rm,
      cache,
      canvasWidth: 1920,
      canvasHeight: 1080,
    })
    await runtime1.execute()

    const runtime2 = new GraphRuntime(graph, {
      resourceManager: rm,
      cache,
      canvasWidth: 1280,
      canvasHeight: 720,
    })
    const r2 = await runtime2.execute()
    expect(r2.cacheHits).toBe(0)
    expect(r2.cacheMisses).toBe(2)
  })

  it('GR9: 校验失败的 Graph 抛错', async () => {
    const badGraph: RenderGraph = {
      nodes: [makeRegionNode('n1', 'NOISE')],  // 缺 OUTPUT 节点
      edges: [],
    }
    const runtime = new GraphRuntime(badGraph)
    await expect(runtime.execute()).rejects.toThrow(/Graph 校验失败/)
  })

  it('GR10: getExecutionPlan 返回 ExecutionPlan(不执行)', () => {
    const runtime = new GraphRuntime(makeDiamondGraph())
    const plan = runtime.getExecutionPlan()
    expect(plan.steps).toHaveLength(5)
    expect(plan.levels).toHaveLength(4)
  })

  it('GR11: getResources 返回 ResourceManager', () => {
    const rm = new ResourceManager()
    const runtime = new GraphRuntime(makeMinimalGraph(), { resourceManager: rm })
    expect(runtime.getResources()).toBe(rm)
  })

  it('GR12: getCache 返回 NodeCache', () => {
    const cache = new NodeCache<TextureHandle>()
    const runtime = new GraphRuntime(makeMinimalGraph(), { cache })
    expect(runtime.getCache()).toBe(cache)
  })

  it('GR13: invalidateNode 失效单个节点缓存', async () => {
    const cache = new NodeCache<TextureHandle>()
    const graph = makeMinimalGraph()
    const runtime = new GraphRuntime(graph, { cache })
    await runtime.execute()
    expect(cache.size).toBe(2)

    const removed = runtime.invalidateNode('noise1')
    expect(removed).toBe(1)
    expect(cache.size).toBe(1)
  })

  it('GR14: clearCache 清空全部缓存', async () => {
    const cache = new NodeCache<TextureHandle>()
    const graph = makeMinimalGraph()
    const runtime = new GraphRuntime(graph, { cache })
    await runtime.execute()
    expect(cache.size).toBe(2)
    runtime.clearCache()
    expect(cache.size).toBe(0)
  })

  it('GR15: dispose 释放 GPU 资源 + 清空 cache', async () => {
    const cache = new NodeCache<TextureHandle>()
    const rm = new ResourceManager()
    const graph = makeMinimalGraph()
    const runtime = new GraphRuntime(graph, { cache, resourceManager: rm })
    await runtime.execute()
    expect(cache.size).toBe(2)
    expect(rm.getStats().poolSize).toBeGreaterThan(0)

    runtime.dispose()
    expect(cache.size).toBe(0)
    expect(rm.getStats().poolSize).toBe(0)
  })

  it('GR16: steps 字段包含完整信息(nodeId / nodeType / cacheHit / handle / durationMs)', async () => {
    const runtime = new GraphRuntime(makeChainGraph())
    const result = await runtime.execute()
    for (const step of result.steps) {
      expect(step.nodeId).toBeTruthy()
      expect(['REGION', 'EFFECT', 'OUTPUT']).toContain(step.nodeType)
      expect(typeof step.cacheHit).toBe('boolean')
      expect(step.handle).toBeDefined()
      expect(step.durationMs).toBeGreaterThanOrEqual(0)
    }
  })

  it('GR17: totalDurationMs 为正数', async () => {
    const runtime = new GraphRuntime(makeMinimalGraph())
    const result = await runtime.execute()
    expect(result.totalDurationMs).toBeGreaterThanOrEqual(0)
  })

  it('GR18: 默认 canvas 从 graph.canvas 取', async () => {
    const graph: RenderGraph = {
      nodes: [makeRegionNode('n1', 'NOISE'), makeOutputNode('o1')],
      edges: [makeEdge('n1', 'o1')],
      canvas: { width: 640, height: 480 },
    }
    const runtime = new GraphRuntime(graph)
    const result = await runtime.execute()
    expect(result.output.width).toBe(640)
    expect(result.output.height).toBe(480)
  })

  it('GR19: options.canvasWidth/Height 覆盖 graph.canvas', async () => {
    const graph: RenderGraph = {
      nodes: [makeRegionNode('n1', 'NOISE'), makeOutputNode('o1')],
      edges: [makeEdge('n1', 'o1')],
      canvas: { width: 640, height: 480 },
    }
    const runtime = new GraphRuntime(graph, {
      canvasWidth: 1280,
      canvasHeight: 720,
    })
    const result = await runtime.execute()
    expect(result.output.width).toBe(1280)
    expect(result.output.height).toBe(720)
  })

  it('GR20: 端到端 - 钻石图第二次执行全部 hit(内容相同节点共享 cache)', async () => {
    const rm = new ResourceManager()
    const cache = new NodeCache<TextureHandle>()
    const graph = makeDiamondGraph()

    const runtime1 = new GraphRuntime(graph, { resourceManager: rm, cache })
    const r1 = await runtime1.execute()
    // 钻石图:noise + galaxy + star + composite + output = 5 节点
    // 但 galaxy 和 star 内容完全相同(同 type + opcodeName + params + 同上游),
    // createCacheKey 不含 node.id(内容寻址),所以 star 会命中 galaxy 的 cache。
    // 首次执行:4 miss(noise / galaxy / composite / output)+ 1 hit(star 复用 galaxy)
    expect(r1.cacheMisses).toBe(4)
    expect(r1.cacheHits).toBe(1)

    const runtime2 = new GraphRuntime(graph, { resourceManager: rm, cache })
    const r2 = await runtime2.execute()
    expect(r2.cacheHits).toBe(5)
    expect(r2.cacheMisses).toBe(0)
  })
})
