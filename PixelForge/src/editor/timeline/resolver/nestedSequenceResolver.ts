/**
 * NestedSequenceResolver(Step 31.6)— 嵌套 Sequence 解析器。
 *
 * 职责:
 * - 把嵌套 Sequence Clip(含 sequenceId)递归展开为普通 Clip
 * - 检测循环引用(A 嵌套 B,B 嵌套 A → 报错)
 * - 深度限制(防止过深嵌套导致栈溢出)
 * - 时间偏移:子 Sequence 的 Clip 时间相对于父 Clip 的 timelineStart
 *
 * 解析规则:
 *   父 Clip(timelineStart=10s, sequenceId='seqB')
 *     → 展开 seqB 的所有 Clip,时间偏移 +10s
 *     → seqB 中的 Clip 若也有 sequenceId,继续递归
 *
 * 用法:
 *   const resolver = new NestedSequenceResolver(project)
 *   const flat = resolver.resolve(activeSequence)
 *   // flat.clips = 展开后的所有 Clip(不含嵌套引用)
 *
 *   // 或检测循环:
 *   const cycle = resolver.detectCycle(seqA.id)
 *   if (cycle) console.warn('循环引用:', cycle)
 */
import type { Project } from '../core/project'
import type { Sequence } from '../core/sequence'
import type { Clip } from '../core/clip'
import { isNestedSequenceClip } from '../core/clip'
import type { Time } from '../core/time'
import { ZERO, add } from '../core/time'

// ============================================================================
// 1. 常量
// ============================================================================

/** 最大嵌套深度(防止栈溢出) */
export const MAX_NESTING_DEPTH = 16

// ============================================================================
// 2. 类型
// ============================================================================

/**
 * 展开后的 Clip(携带来源信息,用于调试 / UI 高亮)。
 */
export interface ResolvedClip extends Clip {
  /** 来源 Sequence ID 链(从根到当前,如 ['seqA', 'seqB', 'seqC']) */
  sourceChain: string[]
  /** 在根 Sequence 中的实际起始时间(已应用所有偏移) */
  resolvedTimelineStart: Time
  /** 嵌套深度(0 = 根 Sequence 的 Clip) */
  depth: number
}

/**
 * 循环引用检测结果。
 */
export interface CycleDetectionResult {
  /** 是否存在循环 */
  hasCycle: boolean
  /** 循环路径(Sequence ID 链,如 ['seqA', 'seqB', 'seqA']) */
  cyclePath: string[]
}

// ============================================================================
// 3. NestedSequenceResolver 类
// ============================================================================

export class NestedSequenceResolver {
  private project: Project

  constructor(project: Project) {
    this.project = project
  }

  /** 更新 Project 引用(用于 Project 变更后复用 resolver) */
  setProject(project: Project): void {
    this.project = project
  }

  /**
   * 展开一个 Sequence 的所有 Clip(递归展开嵌套引用)。
   *
   * @param sequence 要展开的 Sequence(通常是 activeSequence)
   * @returns 展开后的 Clip 列表(按 timelineStart 排序)
   */
  resolve(sequence: Sequence): ResolvedClip[] {
    const result: ResolvedClip[] = []
    const visited = new Set<string>() // 当前展开路径(防循环)

    for (const track of sequence.tracks) {
      for (const clip of track.clips) {
        this.resolveClip(clip, ZERO, [sequence.id], 0, visited, result)
      }
    }

    // 按 timelineStart 排序
    result.sort((a, b) => {
      if (a.resolvedTimelineStart < b.resolvedTimelineStart) return -1
      if (a.resolvedTimelineStart > b.resolvedTimelineStart) return 1
      return 0
    })

    return result
  }

  /**
   * 递归展开单个 Clip。
   *
   * @param clip        要展开的 Clip
   * @param timeOffset  累计时间偏移(父 Clip 的 timelineStart)
   * @param chain       来源 Sequence ID 链
   * @param depth       当前深度
   * @param visited     当前路径已访问的 Sequence ID(防循环)
   * @param result      输出数组
   */
  private resolveClip(
    clip: Clip,
    timeOffset: Time,
    chain: string[],
    depth: number,
    visited: Set<string>,
    result: ResolvedClip[],
  ): void {
    // 深度限制
    if (depth > MAX_NESTING_DEPTH) {
      console.warn(`[NestedSequenceResolver] 超过最大嵌套深度 ${MAX_NESTING_DEPTH},跳过`)
      return
    }

    // 嵌套 Sequence Clip:递归展开
    if (isNestedSequenceClip(clip)) {
      const nestedSeqId = clip.sequenceId!

      // 循环检测
      if (visited.has(nestedSeqId)) {
        console.warn(`[NestedSequenceResolver] 检测到循环引用: ${nestedSeqId} 已在展开路径中`)
        return
      }

      const nestedSeq = this.project.sequences.find((s) => s.id === nestedSeqId)
      if (!nestedSeq) {
        console.warn(`[NestedSequenceResolver] 找不到嵌套 Sequence: ${nestedSeqId}`)
        return
      }

      // 递归展开子 Sequence 的 Clip
      const childVisited = new Set(visited)
      childVisited.add(nestedSeqId)
      const childOffset = add(timeOffset, clip.timelineStart)

      for (const track of nestedSeq.tracks) {
        for (const childClip of track.clips) {
          this.resolveClip(
            childClip,
            childOffset,
            [...chain, nestedSeqId],
            depth + 1,
            childVisited,
            result,
          )
        }
      }
      return
    }

    // 普通 Clip:直接加入结果(应用时间偏移)
    result.push({
      ...clip,
      sourceChain: [...chain],
      resolvedTimelineStart: add(timeOffset, clip.timelineStart),
      depth,
    })
  }

  /**
   * 检测从指定 Sequence 出发是否存在循环引用。
   *
   * @param startSeqId 起始 Sequence ID
   * @returns 检测结果
   */
  detectCycle(startSeqId: string): CycleDetectionResult {
    const visited = new Set<string>()
    const path: string[] = []

    const result = this.detectCycleDFS(startSeqId, visited, path)
    return result
  }

  private detectCycleDFS(
    seqId: string,
    visited: Set<string>,
    path: string[],
  ): CycleDetectionResult {
    // 在当前路径中找到自己 → 循环
    if (path.includes(seqId)) {
      const cycleStart = path.indexOf(seqId)
      return {
        hasCycle: true,
        cyclePath: [...path.slice(cycleStart), seqId],
      }
    }

    // 已检测过且无循环
    if (visited.has(seqId)) {
      return { hasCycle: false, cyclePath: [] }
    }

    visited.add(seqId)
    path.push(seqId)

    const seq = this.project.sequences.find((s) => s.id === seqId)
    if (!seq) {
      path.pop()
      return { hasCycle: false, cyclePath: [] }
    }

    // 遍历所有嵌套引用
    for (const track of seq.tracks) {
      for (const clip of track.clips) {
        if (isNestedSequenceClip(clip)) {
          const childResult = this.detectCycleDFS(clip.sequenceId!, visited, path)
          if (childResult.hasCycle) {
            return childResult
          }
        }
      }
    }

    path.pop()
    return { hasCycle: false, cyclePath: [] }
  }

  /**
   * 校验添加嵌套引用是否安全(不会形成循环)。
   *
   * @param parentSeqId  父 Sequence ID(要添加 Clip 的 Sequence)
   * @param nestedSeqId  要嵌套引用的 Sequence ID
   * @returns true=安全,false=会形成循环
   */
  isNestedReferenceSafe(parentSeqId: string, nestedSeqId: string): boolean {
    // 自引用不安全
    if (parentSeqId === nestedSeqId) return false
    // 检测从 nestedSeq 出发是否会回到 parentSeq
    const cycle = this.detectCycle(nestedSeqId)
    if (cycle.hasCycle) return false
    // 检测 nestedSeq 是否已引用 parentSeq
    const nestedSeq = this.project.sequences.find((s) => s.id === nestedSeqId)
    if (!nestedSeq) return false
    return !this.sequenceReferencesTarget(nestedSeq, parentSeqId, new Set())
  }

  /**
   * 检测 Sequence 是否(直接或间接)引用了目标 Sequence。
   */
  private sequenceReferencesTarget(
    seq: Sequence,
    targetId: string,
    visited: Set<string>,
  ): boolean {
    if (visited.has(seq.id)) return false
    visited.add(seq.id)

    for (const track of seq.tracks) {
      for (const clip of track.clips) {
        if (isNestedSequenceClip(clip)) {
          if (clip.sequenceId === targetId) return true
          const childSeq = this.project.sequences.find((s) => s.id === clip.sequenceId)
          if (childSeq && this.sequenceReferencesTarget(childSeq, targetId, visited)) {
            return true
          }
        }
      }
    }
    return false
  }

  /**
   * 统计一个 Sequence 被多少其他 Sequence 嵌套引用。
   *
   * @param targetSeqId 目标 Sequence ID
   * @returns 引用该 Sequence 的 Sequence ID 列表
   */
  findReferencingSequences(targetSeqId: string): string[] {
    const result: string[] = []
    for (const seq of this.project.sequences) {
      if (seq.id === targetSeqId) continue
      if (this.sequenceReferencesTarget(seq, targetSeqId, new Set())) {
        result.push(seq.id)
      }
    }
    return result
  }
}

// ============================================================================
// 4. 便捷函数
// ============================================================================

/**
 * 展开活跃 Sequence 的所有 Clip(含嵌套引用)。
 *
 * @param project Project
 * @returns 展开后的 Clip 列表
 */
export function resolveActiveSequenceClips(project: Project): ResolvedClip[] {
  const activeSeq = project.sequences.find((s) => s.id === project.activeSequenceId)
  if (!activeSeq) return []
  const resolver = new NestedSequenceResolver(project)
  return resolver.resolve(activeSeq)
}
