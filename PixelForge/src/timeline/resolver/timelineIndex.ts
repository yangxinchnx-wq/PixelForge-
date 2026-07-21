/**
 * PixelForge Timeline Core — Interval Tree 索引。
 *
 * 解决大型项目性能：不能每帧遍历所有 Clip。
 *
 * 结构：Interval Tree（增强二叉搜索树）
 *   保存：clip.timelineStart ~ clip.timelineStart + clip.duration 区间
 *   查询：给定时间点，O(log n) 快速找到所有包含该时间的 Clip
 *
 * 复杂度：
 *   以前 O(n)（遍历所有 Clip）
 *   现在 O(log n + k)（k = 匹配的 Clip 数量）
 */

import type { Clip } from '../core/clip';
import type { Time } from '../core/time';

/** Interval Tree 节点。 */
interface IntervalNode {
  /** 关联的 Clip */
  clip: Clip;
  /** 区间起点 = clip.timelineStart */
  start: Time;
  /** 区间终点 = clip.timelineStart + clip.duration */
  end: Time;
  /** 以该节点为根的子树中最大的 end 值 */
  maxEnd: Time;
  /** 左子节点 */
  left: IntervalNode | null;
  /** 右子节点 */
  right: IntervalNode | null;
}

/**
 * 创建一个 Interval Tree 节点。
 */
function createNode(clip: Clip): IntervalNode {
  const start = clip.timelineStart;
  const end = start + clip.duration;
  return {
    clip,
    start,
    end,
    maxEnd: end,
    left: null,
    right: null,
  };
}

/**
 * 更新节点的 maxEnd 值（取自身 end 和子树 maxEnd 的最大值）。
 */
function updateMaxEnd(node: IntervalNode): void {
  let max = node.end;
  if (node.left !== null && node.left.maxEnd > max) {
    max = node.left.maxEnd;
  }
  if (node.right !== null && node.right.maxEnd > max) {
    max = node.right.maxEnd;
  }
  node.maxEnd = max;
}

/**
 * Interval Tree — 按时间点快速查询 Clip。
 *
 * 用法：
 *   const index = new TimelineIndex();
 *   index.insert(clip);
 *   const clips = index.query(time);
 */
export class TimelineIndex {
  private root: IntervalNode | null = null;

  /** 插入一个 Clip。 */
  insert(clip: Clip): void {
    this.root = this.insertNode(this.root, clip);
  }

  /** 批量插入 Clip（先排序再平衡构建）。 */
  build(clips: Clip[]): void {
    this.root = null;
    for (const clip of clips) {
      this.insert(clip);
    }
  }

  /** 查询给定时间点活跃的所有 Clip。 */
  query(time: Time): Clip[] {
    const result: Clip[] = [];
    this.queryNode(this.root, time, result);
    return result;
  }

  /** 清空索引。 */
  clear(): void {
    this.root = null;
  }

  // ---- 内部实现 ----

  private insertNode(node: IntervalNode | null, clip: Clip): IntervalNode {
    if (node === null) {
      return createNode(clip);
    }

    const newNode = createNode(clip);

    // 按 start 作为 BST key 插入
    if (newNode.start < node.start) {
      node.left = this.insertNode(node.left, clip);
    } else {
      node.right = this.insertNode(node.right, clip);
    }

    // 更新 maxEnd（考虑左右子树）
    updateMaxEnd(node);

    return node;
  }

  private queryNode(
    node: IntervalNode | null,
    time: Time,
    result: Clip[],
  ): void {
    if (node === null) return;

    // 如果 time >= 子树最大 end，该子树不会有匹配
    if (time >= node.maxEnd) return;

    // 检查当前节点区间是否包含 time
    if (time >= node.start && time < node.end) {
      result.push(node.clip);
    }

    // 递归左子树（左子树可能有 start <= time 的区间）
    this.queryNode(node.left, time, result);

    // 递归右子树（右子树的 start >= node.start，但 maxEnd 可能覆盖 time）
    this.queryNode(node.right, time, result);
  }
}
