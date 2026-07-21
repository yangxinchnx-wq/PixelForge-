/**
 * Sequence Breadcrumb(Step 31.8)— 嵌套 Sequence 编辑历史栈。
 *
 * 当用户双击嵌套 Sequence Clip 进入子 Sequence 编辑时,记录"进入历史"。
 * 用户可以通过面包屑导航回任意父级 Sequence。
 *
 * 设计:
 * - 栈结构:每层记录 (sequenceId, parentClipId, parentSequenceId)
 * - 进入:push 当前状态 + 切换 activeSequence
 * - 退出:pop + 切换回上一级
 * - 跳到任意层:截断栈到该层
 *
 * 注意:本模块只维护"导航历史",不修改 Project 数据。
 * 嵌套关系本身由 Clip.sequenceId 表达(Step 31.6)。
 */
import type { Project } from '../core/project'

// ============================================================================
// 1. 类型
// ============================================================================

/**
 * 面包屑栈的一层。
 *
 * @property sequenceId       当前层的 Sequence ID
 * @property parentSequenceId 上一层的 Sequence ID(根层为 null)
 * @property parentClipId     上一层中引用此 Sequence 的 Clip ID(根层为 null)
 * @property label            显示名称(从 Sequence.name 取)
 */
export interface BreadcrumbEntry {
  sequenceId: string
  parentSequenceId: string | null
  parentClipId: string | null
  label: string
}

// ============================================================================
// 2. SequenceBreadcrumb 类
// ============================================================================

/**
 * SequenceBreadcrumb — 嵌套 Sequence 编辑历史栈。
 *
 * 用法:
 *   const bc = new SequenceBreadcrumb()
 *   bc.enter('seqB', 'seqA', 'clip_1', '子序列')
 *   bc.enter('seqC', 'seqB', 'clip_2', '孙序列')
 *   bc.exit() // 回到 seqB
 *   bc.jumpTo(0) // 回到 seqA
 */
export class SequenceBreadcrumb {
  private stack: BreadcrumbEntry[] = []

  /** 当前栈深度(0 = 根) */
  get depth(): number {
    return this.stack.length - 1
  }

  /** 当前栈(只读副本) */
  get entries(): BreadcrumbEntry[] {
    return [...this.stack]
  }

  /** 当前所在 Sequence ID */
  get currentSequenceId(): string | null {
    return this.stack.length > 0 ? this.stack[this.stack.length - 1].sequenceId : null
  }

  /** 上一层(父)Sequence ID */
  get parentSequenceId(): string | null {
    return this.stack.length > 1
      ? this.stack[this.stack.length - 2].sequenceId
      : null
  }

  /** 是否在嵌套中(非根层) */
  get isNested(): boolean {
    return this.stack.length > 1
  }

  /**
   * 初始化根层(进入活跃 Sequence 时调用)。
   *
   * @param sequenceId 根 Sequence ID
   * @param label      显示名称
   */
  initRoot(sequenceId: string, label: string): void {
    this.stack = [{
      sequenceId,
      parentSequenceId: null,
      parentClipId: null,
      label,
    }]
  }

  /**
   * 进入子 Sequence(双击嵌套 Clip 时调用)。
   *
   * @param childSequenceId  子 Sequence ID
   * @param parentSequenceId 父 Sequence ID
   * @param parentClipId     父 Sequence 中引用子 Sequence 的 Clip ID
   * @param label            子 Sequence 显示名称
   */
  enter(
    childSequenceId: string,
    parentSequenceId: string,
    parentClipId: string,
    label: string,
  ): void {
    // 校验:不能进入自身
    if (childSequenceId === parentSequenceId) {
      throw new Error(`SequenceBreadcrumb.enter: 不能进入自身(${childSequenceId})`)
    }
    // 校验:必须从当前栈顶进入
    if (this.currentSequenceId !== parentSequenceId) {
      throw new Error(
        `SequenceBreadcrumb.enter: 父 Sequence ${parentSequenceId} 不是当前栈顶(${this.currentSequenceId})`,
      )
    }
    this.stack.push({
      sequenceId: childSequenceId,
      parentSequenceId,
      parentClipId,
      label,
    })
  }

  /**
   * 退出当前层,回到上一层。
   *
   * @returns 上一层的 Sequence ID,若已在根层返回 null
   */
  exit(): string | null {
    if (this.stack.length <= 1) return null
    this.stack.pop()
    return this.currentSequenceId
  }

  /**
   * 跳转到栈中指定层(0 = 根)。
   *
   * @param level 目标层(0-based)
   * @returns 目标层的 Sequence ID,若 level 越界返回 null
   */
  jumpTo(level: number): string | null {
    if (level < 0 || level >= this.stack.length) return null
    // 截断栈到 level+1 层
    this.stack = this.stack.slice(0, level + 1)
    return this.currentSequenceId
  }

  /**
   * 查找指定 Sequence ID 在栈中的层(0-based)。
   *
   * @returns 层级,未找到返回 -1
   */
  findLevel(sequenceId: string): number {
    return this.stack.findIndex((e) => e.sequenceId === sequenceId)
  }

  /** 清空栈 */
  clear(): void {
    this.stack = []
  }

  /**
   * 从 Project 同步根层(若栈为空或根层不匹配)。
   *
   * @param project 当前 Project
   */
  syncFromProject(project: Project): void {
    const activeId = project.activeSequenceId
    const activeSeq = project.sequences.find((s) => s.id === activeId)
    if (!activeSeq) {
      this.clear()
      return
    }
    // 若栈为空,或当前栈顶不是活跃 Sequence 且栈中没有该 Sequence,初始化根层
    if (this.stack.length === 0) {
      this.initRoot(activeId, activeSeq.name)
      return
    }
    // 若活跃 Sequence 在栈中,跳到那一层
    const level = this.findLevel(activeId)
    if (level >= 0) {
      this.jumpTo(level)
      return
    }
    // 否则重置根层为活跃 Sequence
    this.initRoot(activeId, activeSeq.name)
  }

  /**
   * 验证栈的一致性(用于调试)。
   *
   * - 每层的 parentSequenceId 应等于上一层 sequenceId(除根层)
   * - 栈中不应有重复 sequenceId(避免循环)
   */
  validate(): { valid: boolean; reason?: string } {
    const seen = new Set<string>()
    for (let i = 0; i < this.stack.length; i++) {
      const entry = this.stack[i]
      if (seen.has(entry.sequenceId)) {
        return { valid: false, reason: `栈中存在重复 sequenceId: ${entry.sequenceId}` }
      }
      seen.add(entry.sequenceId)
      if (i > 0 && entry.parentSequenceId !== this.stack[i - 1].sequenceId) {
        return {
          valid: false,
          reason: `第 ${i} 层的 parentSequenceId(${entry.parentSequenceId}) 与上一层 sequenceId(${this.stack[i - 1].sequenceId}) 不匹配`,
        }
      }
    }
    return { valid: true }
  }
}

// ============================================================================
// 3. 辅助函数
// ============================================================================

/**
 * 根据 Project 和当前活跃 Sequence 构建面包屑栈(一次性,无状态)。
 *
 * 与 SequenceBreadcrumb 类区别:
 * - 类:维护导航历史,支持 enter/exit
 * - 函数:根据 Project 反推"嵌套链"(从根到当前)
 *
 * 用于初始化或调试时检查当前嵌套位置。
 *
 * @returns 面包屑栈(从根到当前),若活跃 Sequence 不在任何嵌套中,返回单层
 */
export function buildBreadcrumbFromProject(project: Project): BreadcrumbEntry[] {
  const activeId = project.activeSequenceId
  const activeSeq = project.sequences.find((s) => s.id === activeId)
  if (!activeSeq) return []

  // 反向查找:从活跃 Sequence 向上找谁引用了它
  const chain: BreadcrumbEntry[] = []
  let currentId: string | null = activeId
  const visited = new Set<string>()

  while (currentId) {
    if (visited.has(currentId)) break // 防循环
    visited.add(currentId)

    const seq = project.sequences.find((s) => s.id === currentId)
    if (!seq) break

    // 查找谁引用了 currentId
    let parent: { parentSeqId: string; parentClipId: string } | null = null
    for (const pSeq of project.sequences) {
      for (const track of pSeq.tracks) {
        for (const clip of track.clips) {
          if (clip.sequenceId === currentId) {
            parent = { parentSeqId: pSeq.id, parentClipId: clip.id }
            break
          }
        }
        if (parent) break
      }
      if (parent) break
    }

    chain.unshift({
      sequenceId: currentId,
      parentSequenceId: parent?.parentSeqId ?? null,
      parentClipId: parent?.parentClipId ?? null,
      label: seq.name,
    })

    currentId = parent?.parentSeqId ?? null
  }

  return chain
}
