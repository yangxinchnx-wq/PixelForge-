/**
 * colorBlockTree.ts 单元测试
 *
 * 测试覆盖：
 *   C1  buildColorBlockTree 从 RawBlockNode 构建 ColorBlockTree
 *   C2  ColorBlockNode 坐标归一化正确
 *   C3  ColorBlockNode.id 稳定（相同输入 → 相同 ID）
 *   C4  ColorBlockNode.source = 'image_analysis'
 *   C5  toLLMView 输出非空树形文本
 *   C6  toLLMView maxDepth 限制生效
 *   C7  toUserView 提取指定深度色块
 *   C8  checkBudget 未超预算
 *   C9  checkBudget 超预算检测
 *   C10 pruneTree 限制深度
 *   C11 mergeLowSignificance 合并低方差叶子
 *   C12 keepTopSignificant 保留高方差叶子
 *   C13 countColorBlockNodes / maxColorBlockDepth / collectLeafNodes
 *   C14 describeBlockTree 树形文本格式
 */

import { describe, expect, it } from 'vitest'
import {
  buildColorBlockTree,
  ColorBlockTree,
  countColorBlockNodes,
  maxColorBlockDepth,
  collectLeafNodes,
  pruneTree,
  mergeLowSignificance,
  keepTopSignificant,
  describeBlockTree,
  extractBlocksAtDepth,
} from './colorBlockTree'
import type { RawBlockNode } from './adaptiveSplit'

// ============================================================================
// 辅助函数
// ============================================================================

/** 创建简单的 RawBlockNode 树（根 + 4 子节点） */
function createSimpleRawTree(): RawBlockNode {
  return {
    rect: { x: 0, y: 0, width: 64, height: 64 },
    avgColor: [128, 128, 128],
    dominantColor: [128, 128, 128],
    variance: 500,
    pixelCount: 4096,
    depth: 0,
    path: 'root',
    children: [
      {
        rect: { x: 0, y: 0, width: 32, height: 32 },
        avgColor: [255, 0, 0],
        dominantColor: [255, 0, 0],
        variance: 50,
        pixelCount: 1024,
        depth: 1,
        path: 'root/0',
        children: [],
      },
      {
        rect: { x: 32, y: 0, width: 32, height: 32 },
        avgColor: [0, 255, 0],
        dominantColor: [0, 255, 0],
        variance: 80,
        pixelCount: 1024,
        depth: 1,
        path: 'root/1',
        children: [
          {
            rect: { x: 32, y: 0, width: 16, height: 16 },
            avgColor: [0, 200, 0],
            dominantColor: [0, 200, 0],
            variance: 20,
            pixelCount: 256,
            depth: 2,
            path: 'root/1/0',
            children: [],
          },
          {
            rect: { x: 48, y: 0, width: 16, height: 16 },
            avgColor: [0, 150, 0],
            dominantColor: [0, 150, 0],
            variance: 15,
            pixelCount: 256,
            depth: 2,
            path: 'root/1/1',
            children: [],
          },
        ],
      },
      {
        rect: { x: 0, y: 32, width: 32, height: 32 },
        avgColor: [0, 0, 255],
        dominantColor: [0, 0, 255],
        variance: 30,
        pixelCount: 1024,
        depth: 1,
        path: 'root/2',
        children: [],
      },
      {
        rect: { x: 32, y: 32, width: 32, height: 32 },
        avgColor: [255, 255, 0],
        dominantColor: [255, 255, 0],
        variance: 200,
        pixelCount: 1024,
        depth: 1,
        path: 'root/3',
        children: [],
      },
    ],
  }
}

/** 创建深层 RawBlockNode 树（用于测试 pruneTree） */
function createDeepRawTree(maxDepth: number, currentDepth: number = 0): RawBlockNode {
  const size = 64 >> currentDepth
  if (currentDepth >= maxDepth || size < 8) {
    return {
      rect: { x: 0, y: 0, width: size, height: size },
      avgColor: [100, 100, 100],
      dominantColor: [100, 100, 100],
      variance: 100,
      pixelCount: size * size,
      depth: currentDepth,
      path: `root${'/0'.repeat(currentDepth)}`,
      children: [],
    }
  }
  return {
    rect: { x: 0, y: 0, width: size, height: size },
    avgColor: [100, 100, 100],
    dominantColor: [100, 100, 100],
    variance: 100,
    pixelCount: size * size,
    depth: currentDepth,
    path: `root${'/0'.repeat(currentDepth)}`,
    children: [
      createDeepRawTree(maxDepth, currentDepth + 1),
    ],
  }
}

// ============================================================================
// 测试
// ============================================================================

describe('colorBlockTree.ts — 颜色块树', () => {
  describe('buildColorBlockTree', () => {
    it('C1 从 RawBlockNode 构建 ColorBlockTree', () => {
      const rawRoot = createSimpleRawTree()
      const tree = buildColorBlockTree(rawRoot, 64, 64, 'test-hash')

      expect(tree).toBeInstanceOf(ColorBlockTree)
      expect(tree.sourceWidth).toBe(64)
      expect(tree.sourceHeight).toBe(64)
    })

    it('C2 坐标归一化正确（根节点 bounds = 0,0,1,1）', () => {
      const rawRoot = createSimpleRawTree()
      const tree = buildColorBlockTree(rawRoot, 64, 64, 'test-hash')

      expect(tree.root.bounds.x).toBe(0)
      expect(tree.root.bounds.y).toBe(0)
      expect(tree.root.bounds.width).toBe(1)
      expect(tree.root.bounds.height).toBe(1)
    })

    it('C2b 子节点坐标归一化正确', () => {
      const rawRoot = createSimpleRawTree()
      const tree = buildColorBlockTree(rawRoot, 64, 64, 'test-hash')

      // 第一个子节点 rect=(0,0,32,32) → bounds=(0,0,0.5,0.5)
      const child0 = tree.root.children[0]
      expect(child0.bounds.x).toBe(0)
      expect(child0.bounds.y).toBe(0)
      expect(child0.bounds.width).toBeCloseTo(0.5, 5)
      expect(child0.bounds.height).toBeCloseTo(0.5, 5)
    })

    it('C3 ID 稳定（相同输入 → 相同 ID）', () => {
      const rawRoot1 = createSimpleRawTree()
      const rawRoot2 = createSimpleRawTree()
      const tree1 = buildColorBlockTree(rawRoot1, 64, 64, 'test-hash')
      const tree2 = buildColorBlockTree(rawRoot2, 64, 64, 'test-hash')

      expect(tree1.root.id).toBe(tree2.root.id)
      expect(tree1.root.children[0].id).toBe(tree2.root.children[0].id)
    })

    it('C4 source = "image_analysis"', () => {
      const rawRoot = createSimpleRawTree()
      const tree = buildColorBlockTree(rawRoot, 64, 64, 'test-hash')

      expect(tree.root.source).toBe('image_analysis')
      expect(tree.root.children[0].source).toBe('image_analysis')
    })

    it('C4b sourceRef 正确传递', () => {
      const rawRoot = createSimpleRawTree()
      const tree = buildColorBlockTree(rawRoot, 64, 64, 'my-hash-123')

      expect(tree.root.sourceRef).toBe('my-hash-123')
      expect(tree.root.children[0].sourceRef).toBe('my-hash-123')
    })
  })

  describe('toLLMView', () => {
    it('C5 输出非空树形文本', () => {
      const rawRoot = createSimpleRawTree()
      const tree = buildColorBlockTree(rawRoot, 64, 64, 'test-hash')

      const text = tree.toLLMView()
      expect(text).toBeTruthy()
      expect(text.length).toBeGreaterThan(0)
      // 应包含 root
      expect(text).toContain('root')
    })

    it('C6 maxDepth 限制生效', () => {
      const rawRoot = createSimpleRawTree()
      const tree = buildColorBlockTree(rawRoot, 64, 64, 'test-hash')

      const text0 = tree.toLLMView(0)
      const text2 = tree.toLLMView(2)

      // maxDepth=0 只输出根节点行
      const lines0 = text0.split('\n')
      expect(lines0.length).toBe(1)

      // maxDepth=2 输出更多行
      const lines2 = text2.split('\n')
      expect(lines2.length).toBeGreaterThan(lines0.length)
    })

    it('C14 树形文本包含颜色信息', () => {
      const rawRoot = createSimpleRawTree()
      const tree = buildColorBlockTree(rawRoot, 64, 64, 'test-hash')

      const text = tree.toLLMView()
      // 应包含 hex 颜色（# 开头）
      expect(text).toMatch(/#[0-9a-f]{6}/i)
    })

    it('C14b 树形文本包含路径信息', () => {
      const rawRoot = createSimpleRawTree()
      const tree = buildColorBlockTree(rawRoot, 64, 64, 'test-hash')

      const text = tree.toLLMView()
      expect(text).toContain('root/0')
      expect(text).toContain('root/1')
    })
  })

  describe('toUserView', () => {
    it('C7 提取指定深度色块（depth=1）', () => {
      const rawRoot = createSimpleRawTree()
      const tree = buildColorBlockTree(rawRoot, 64, 64, 'test-hash')

      const blocks = tree.toUserView(1)
      // depth=1 有 4 个节点（root/0, root/1, root/2, root/3）
      expect(blocks.length).toBe(4)
    })

    it('C7b 提取 depth=0 只有根节点', () => {
      const rawRoot = createSimpleRawTree()
      const tree = buildColorBlockTree(rawRoot, 64, 64, 'test-hash')

      const blocks = tree.toUserView(0)
      expect(blocks.length).toBe(1)
    })

    it('C7c 叶子提前结束的分支也被收集', () => {
      const rawRoot = createSimpleRawTree()
      const tree = buildColorBlockTree(rawRoot, 64, 64, 'test-hash')

      // depth=2：root/0 是叶子（提前收集），root/1 的子节点在 depth=2，root/2 和 root/3 是叶子
      const blocks = tree.toUserView(2)
      // root/0（叶子）, root/1/0, root/1/1, root/2（叶子）, root/3（叶子） = 5
      expect(blocks.length).toBe(5)
    })
  })

  describe('checkBudget', () => {
    it('C8 未超预算（小树）', () => {
      const rawRoot = createSimpleRawTree()
      const tree = buildColorBlockTree(rawRoot, 64, 64, 'test-hash')

      const result = tree.checkBudget()
      expect(result.isOverBudget).toBe(false)
      expect(result.nodeCount).toBe(7) // 1 root + 4 children + 2 grandchildren
    })

    it('C9 超预算检测（设置极小预算）', () => {
      const rawRoot = createSimpleRawTree()
      const tree = buildColorBlockTree(rawRoot, 64, 64, 'test-hash')

      const tinyBudget = {
        maxNodeCount: 3,
        maxDepth: 7,
        maxLLMContextChars: 8000,
        maxTinyObjectNodes: 200,
        maxAnalysisTimeMs: 5000,
      }
      const result = tree.checkBudget(tinyBudget)
      expect(result.isOverBudget).toBe(true)
      expect(result.violations.length).toBeGreaterThan(0)
    })
  })

  describe('pruneTree', () => {
    it('C10 限制深度（maxDepth=1 截断 depth≥1 的子树）', () => {
      const rawRoot = createSimpleRawTree()
      const tree = buildColorBlockTree(rawRoot, 64, 64, 'test-hash')

      const pruned = pruneTree(tree.root, 1)
      // depth=1 的节点仍保留，但它们的子节点被截断
      expect(pruned.children.length).toBe(4)
      // root/1 原有 2 个子节点，截断后应为 0
      expect(pruned.children[1].children.length).toBe(0)
    })

    it('C10b pruneTree 不修改原树', () => {
      const rawRoot = createSimpleRawTree()
      const tree = buildColorBlockTree(rawRoot, 64, 64, 'test-hash')

      const originalChildCount = tree.root.children[1].children.length
      pruneTree(tree.root, 1)
      expect(tree.root.children[1].children.length).toBe(originalChildCount)
    })
  })

  describe('mergeLowSignificance', () => {
    it('C11 合并低方差叶子', () => {
      const rawRoot = createSimpleRawTree()
      const tree = buildColorBlockTree(rawRoot, 64, 64, 'test-hash')

      // root/1 的两个子节点方差分别为 20 和 15
      // 设置阈值为 100，这两个子节点都低于 100，应该被合并
      const merged = mergeLowSignificance(tree.root, 100)

      // root/1 的子节点应被合并为叶子
      const child1 = merged.children[1]
      expect(child1.children.length).toBe(0)
    })

    it('C11b 高方差不合并', () => {
      const rawRoot = createSimpleRawTree()
      const tree = buildColorBlockTree(rawRoot, 64, 64, 'test-hash')

      // 阈值为 10，方差 20 和 15 都 > 10，不合并
      const merged = mergeLowSignificance(tree.root, 10)
      expect(merged.children[1].children.length).toBe(2)
    })
  })

  describe('keepTopSignificant', () => {
    it('C12 保留高方差叶子', () => {
      const rawRoot = createSimpleRawTree()
      const tree = buildColorBlockTree(rawRoot, 64, 64, 'test-hash')

      // 保留前 3 个叶子（方差最高的）
      const result = keepTopSignificant(tree.root, 3)
      const leaves = collectLeafNodes(result)
      expect(leaves.length).toBeLessThanOrEqual(3)
    })

    it('C12b topN ≥ 叶子数时不变', () => {
      const rawRoot = createSimpleRawTree()
      const tree = buildColorBlockTree(rawRoot, 64, 64, 'test-hash')

      const originalLeaves = collectLeafNodes(tree.root)
      const result = keepTopSignificant(tree.root, 100)
      const newLeaves = collectLeafNodes(result)
      expect(newLeaves.length).toBe(originalLeaves.length)
    })
  })

  describe('树统计函数', () => {
    it('C13a countColorBlockNodes', () => {
      const rawRoot = createSimpleRawTree()
      const tree = buildColorBlockTree(rawRoot, 64, 64, 'test-hash')

      expect(countColorBlockNodes(tree.root)).toBe(7)
    })

    it('C13b maxColorBlockDepth', () => {
      const rawRoot = createSimpleRawTree()
      const tree = buildColorBlockTree(rawRoot, 64, 64, 'test-hash')

      expect(maxColorBlockDepth(tree.root)).toBe(2)
    })

    it('C13c collectLeafNodes', () => {
      const rawRoot = createSimpleRawTree()
      const tree = buildColorBlockTree(rawRoot, 64, 64, 'test-hash')

      const leaves = collectLeafNodes(tree.root)
      // root/0, root/1/0, root/1/1, root/2, root/3 = 5 叶子
      expect(leaves.length).toBe(5)
    })
  })

  describe('extractBlocksAtDepth', () => {
    it('C7d extractBlocksAtDepth 独立函数', () => {
      const rawRoot = createSimpleRawTree()
      const tree = buildColorBlockTree(rawRoot, 64, 64, 'test-hash')

      const blocks = extractBlocksAtDepth(tree.root, 1)
      expect(blocks.length).toBe(4)
    })
  })

  describe('describeBlockTree', () => {
    it('C14c describeBlockTree 独立函数', () => {
      const rawRoot = createSimpleRawTree()
      const tree = buildColorBlockTree(rawRoot, 64, 64, 'test-hash')

      const text = describeBlockTree(tree.root, 4)
      expect(text).toContain('root')
      expect(text).toContain('#') // 颜色 hex
    })

    it('C14d 超过 maxDepth 显示省略提示', () => {
      const rawRoot = createDeepRawTree(5)
      const tree = buildColorBlockTree(rawRoot, 64, 64, 'test-hash')

      const text = describeBlockTree(tree.root, 2)
      expect(text).toContain('omitted')
    })
  })
})
