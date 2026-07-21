/**
 * Step 31.8 单元测试 — 嵌套 Sequence 编辑 + 面包屑导航。
 *
 * 覆盖:
 * - BC:  SequenceBreadcrumb(initRoot / enter / exit / jumpTo / validate)
 * - BCP: buildBreadcrumbFromProject(从 Project 反推嵌套链)
 * - SI:  Store 集成(enterNestedSequence / exitNestedSequence / jumpToBreadcrumbLevel)
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { createClip, setClipSequenceId } from './core/clip'
import { createSequence } from './core/sequence'
import { TrackType } from './core/track'
import { createProject, addSequence, setActiveSequence } from './core/project'
import type { Project } from './core/project'
import { seconds } from './core/time'
import {
  SequenceBreadcrumb,
  buildBreadcrumbFromProject,
} from './resolver/sequenceBreadcrumb'
import { useProTimelineStore } from './store/timelineStore'

// ============================================================================
// 辅助
// ============================================================================

function makeClipWithSeq(seqId: string, id?: string) {
  const c = createClip({
    assetId: 'a',
    kind: 'video',
    timelineStart: seconds(0),
    sourceStart: seconds(0),
    sourceEnd: seconds(10),
    id,
  })
  return setClipSequenceId(c, seqId)
}

function makeProjectWithNested(): { project: Project; seqA: any; seqB: any; seqC: any } {
  const seqA = createSequence({ name: 'A' })
  const seqB = createSequence({ name: 'B' })
  const seqC = createSequence({ name: 'C' })

  // seqA 引用 seqB
  const clipA = makeClipWithSeq(seqB.id, 'clip_a')
  seqA.tracks.find((t) => t.type === TrackType.VIDEO)!.clips.push(clipA)
  // seqB 引用 seqC
  const clipB = makeClipWithSeq(seqC.id, 'clip_b')
  seqB.tracks.find((t) => t.type === TrackType.VIDEO)!.clips.push(clipB)

  let project = createProject('测试')
  project = { ...project, sequences: [seqA], activeSequenceId: seqA.id }
  project = addSequence(project, seqB)
  project = addSequence(project, seqC)

  return { project, seqA, seqB, seqC }
}

// ============================================================================
// BC: SequenceBreadcrumb
// ============================================================================

describe('BC: SequenceBreadcrumb', () => {
  it('BC1: initRoot 初始化根层', () => {
    const bc = new SequenceBreadcrumb()
    bc.initRoot('seq_a', '序列 A')
    expect(bc.depth).toBe(0)
    expect(bc.isNested).toBe(false)
    expect(bc.currentSequenceId).toBe('seq_a')
    expect(bc.entries.length).toBe(1)
    expect(bc.entries[0].label).toBe('序列 A')
    expect(bc.entries[0].parentSequenceId).toBeNull()
  })

  it('BC2: enter 进入子 Sequence', () => {
    const bc = new SequenceBreadcrumb()
    bc.initRoot('seq_a', 'A')
    bc.enter('seq_b', 'seq_a', 'clip_1', 'B')
    expect(bc.depth).toBe(1)
    expect(bc.isNested).toBe(true)
    expect(bc.currentSequenceId).toBe('seq_b')
    expect(bc.parentSequenceId).toBe('seq_a')
    expect(bc.entries.length).toBe(2)
  })

  it('BC3: enter 多层嵌套', () => {
    const bc = new SequenceBreadcrumb()
    bc.initRoot('seq_a', 'A')
    bc.enter('seq_b', 'seq_a', 'clip_1', 'B')
    bc.enter('seq_c', 'seq_b', 'clip_2', 'C')
    expect(bc.depth).toBe(2)
    expect(bc.currentSequenceId).toBe('seq_c')
    expect(bc.parentSequenceId).toBe('seq_b')
  })

  it('BC4: enter 自身抛错', () => {
    const bc = new SequenceBreadcrumb()
    bc.initRoot('seq_a', 'A')
    expect(() => bc.enter('seq_a', 'seq_a', 'clip', 'A')).toThrow()
  })

  it('BC5: enter 父 Sequence 不是栈顶抛错', () => {
    const bc = new SequenceBreadcrumb()
    bc.initRoot('seq_a', 'A')
    expect(() => bc.enter('seq_c', 'seq_b', 'clip', 'C')).toThrow()
  })

  it('BC6: exit 回到上层', () => {
    const bc = new SequenceBreadcrumb()
    bc.initRoot('seq_a', 'A')
    bc.enter('seq_b', 'seq_a', 'clip_1', 'B')
    const result = bc.exit()
    expect(result).toBe('seq_a')
    expect(bc.depth).toBe(0)
    expect(bc.currentSequenceId).toBe('seq_a')
  })

  it('BC7: exit 在根层返回 null', () => {
    const bc = new SequenceBreadcrumb()
    bc.initRoot('seq_a', 'A')
    const result = bc.exit()
    expect(result).toBeNull()
  })

  it('BC8: jumpTo 跳到指定层', () => {
    const bc = new SequenceBreadcrumb()
    bc.initRoot('seq_a', 'A')
    bc.enter('seq_b', 'seq_a', 'clip_1', 'B')
    bc.enter('seq_c', 'seq_b', 'clip_2', 'C')
    const result = bc.jumpTo(0)
    expect(result).toBe('seq_a')
    expect(bc.depth).toBe(0)
    expect(bc.entries.length).toBe(1)
  })

  it('BC9: jumpTo 越界返回 null', () => {
    const bc = new SequenceBreadcrumb()
    bc.initRoot('seq_a', 'A')
    expect(bc.jumpTo(5)).toBeNull()
    expect(bc.jumpTo(-1)).toBeNull()
  })

  it('BC10: findLevel 查找层级', () => {
    const bc = new SequenceBreadcrumb()
    bc.initRoot('seq_a', 'A')
    bc.enter('seq_b', 'seq_a', 'clip_1', 'B')
    bc.enter('seq_c', 'seq_b', 'clip_2', 'C')
    expect(bc.findLevel('seq_a')).toBe(0)
    expect(bc.findLevel('seq_b')).toBe(1)
    expect(bc.findLevel('seq_c')).toBe(2)
    expect(bc.findLevel('seq_x')).toBe(-1)
  })

  it('BC11: clear 清空栈', () => {
    const bc = new SequenceBreadcrumb()
    bc.initRoot('seq_a', 'A')
    bc.enter('seq_b', 'seq_a', 'clip_1', 'B')
    bc.clear()
    expect(bc.entries.length).toBe(0)
    expect(bc.currentSequenceId).toBeNull()
  })

  it('BC12: validate 正常栈', () => {
    const bc = new SequenceBreadcrumb()
    bc.initRoot('seq_a', 'A')
    bc.enter('seq_b', 'seq_a', 'clip_1', 'B')
    const result = bc.validate()
    expect(result.valid).toBe(true)
  })

  it('BC13: validate 检测重复(理论场景,正常 enter 不会出现)', () => {
    // 注:正常 enter 流程不会产生重复,这里直接操作内部 entries 模拟异常
    const bc = new SequenceBreadcrumb()
    bc.initRoot('seq_a', 'A')
    // 用 any 访问私有字段模拟异常栈
    ;(bc as any).stack.push({
      sequenceId: 'seq_a',
      parentSequenceId: 'seq_a',
      parentClipId: 'clip',
      label: 'A2',
    })
    const result = bc.validate()
    expect(result.valid).toBe(false)
  })

  it('BC14: syncFromProject 空栈时初始化根层', () => {
    const bc = new SequenceBreadcrumb()
    const { project } = makeProjectWithNested()
    bc.syncFromProject(project)
    expect(bc.currentSequenceId).toBe(project.activeSequenceId)
    expect(bc.depth).toBe(0)
  })

  it('BC15: syncFromProject 活跃 Sequence 在栈中 → jumpTo', () => {
    const bc = new SequenceBreadcrumb()
    const { project, seqA, seqB } = makeProjectWithNested()
    bc.initRoot(seqA.id, seqA.name)
    bc.enter(seqB.id, seqA.id, 'clip_a', seqB.name)
    // 现在 bc 在 seqB,project 活跃是 seqA → 应跳回 seqA
    bc.syncFromProject(project)
    expect(bc.currentSequenceId).toBe(seqA.id)
    expect(bc.depth).toBe(0)
  })

  it('BC16: syncFromProject 活跃 Sequence 不在栈中 → 重置根层', () => {
    const bc = new SequenceBreadcrumb()
    const { project, seqA, seqC } = makeProjectWithNested()
    bc.initRoot(seqA.id, seqA.name)
    // 把 project 切到 seqC(不在栈中)
    const newProject = setActiveSequence(project, seqC.id)
    bc.syncFromProject(newProject)
    expect(bc.currentSequenceId).toBe(seqC.id)
    expect(bc.depth).toBe(0)
  })
})

// ============================================================================
// BCP: buildBreadcrumbFromProject
// ============================================================================

describe('BCP: buildBreadcrumbFromProject', () => {
  it('BCP1: 无嵌套 → 单层', () => {
    const seq = createSequence({ name: 'A' })
    let project = createProject('test')
    project = { ...project, sequences: [seq], activeSequenceId: seq.id }
    const chain = buildBreadcrumbFromProject(project)
    expect(chain.length).toBe(1)
    expect(chain[0].sequenceId).toBe(seq.id)
    expect(chain[0].parentSequenceId).toBeNull()
  })

  it('BCP2: 一层嵌套(活跃是子 Sequence)→ 两层', () => {
    const { project, seqA } = makeProjectWithNested()
    // 活跃是 seqA,seqA 引用 seqB
    // buildBreadcrumbFromProject 从活跃反推,seqA 无父,返回单层
    const chain = buildBreadcrumbFromProject(project)
    expect(chain.length).toBe(1)
    expect(chain[0].sequenceId).toBe(seqA.id)
  })

  it('BCP3: 活跃是子 Sequence → 反推到根', () => {
    const { project, seqA, seqB } = makeProjectWithNested()
    // 切到 seqB(被 seqA 引用)
    const newProject = setActiveSequence(project, seqB.id)
    const chain = buildBreadcrumbFromProject(newProject)
    expect(chain.length).toBe(2)
    expect(chain[0].sequenceId).toBe(seqA.id)
    expect(chain[1].sequenceId).toBe(seqB.id)
    expect(chain[1].parentSequenceId).toBe(seqA.id)
  })

  it('BCP4: 深层嵌套(3 层)', () => {
    const { project, seqA, seqB, seqC } = makeProjectWithNested()
    // 切到 seqC(被 seqB 引用,seqB 被 seqA 引用)
    const newProject = setActiveSequence(project, seqC.id)
    const chain = buildBreadcrumbFromProject(newProject)
    expect(chain.length).toBe(3)
    expect(chain[0].sequenceId).toBe(seqA.id)
    expect(chain[1].sequenceId).toBe(seqB.id)
    expect(chain[2].sequenceId).toBe(seqC.id)
  })

  it('BCP5: 空 Project → 空链', () => {
    const emptyProject: Project = {
      id: 'p',
      name: 'empty',
      sequences: [],
      activeSequenceId: '',
      assets: [],
      createdAt: 0,
      updatedAt: 0,
    }
    const chain = buildBreadcrumbFromProject(emptyProject)
    expect(chain.length).toBe(0)
  })
})

// ============================================================================
// SI: Store 集成
// ============================================================================

describe('SI: Store 嵌套编辑集成', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('SI1: enterNestedSequence 进入子 Sequence', () => {
    const store = useProTimelineStore()
    const { project, seqB } = makeProjectWithNested()
    store.init(project)
    // 在 seqA 中有 clip_a 引用 seqB
    const result = store.enterNestedSequence('clip_a')
    expect(result).toBe(true)
    expect(store.activeSequenceId).toBe(seqB.id)
    expect(store.isNestedEditing).toBe(true)
    expect(store.nestedDepth).toBe(1)
  })

  it('SI2: enterNestedSequence 非 Clip 返回 false', () => {
    const store = useProTimelineStore()
    const { project } = makeProjectWithNested()
    store.init(project)
    const result = store.enterNestedSequence('nonexistent')
    expect(result).toBe(false)
  })

  it('SI3: enterNestedSequence 非 Clip 返回 false', () => {
    const store = useProTimelineStore()
    const { project } = makeProjectWithNested()
    store.init(project)
    // 添加一个普通 Clip(无 sequenceId)
    const trackId = store.tracks[0].id
    const normalClip = createClip({
      assetId: 'a', kind: 'video',
      timelineStart: seconds(0),
      sourceStart: seconds(0), sourceEnd: seconds(5),
      id: 'normal_clip',
    })
    store.addClip(trackId, normalClip)
    const result = store.enterNestedSequence('normal_clip')
    expect(result).toBe(false)
  })

  it('SI4: exitNestedSequence 退出回到父', () => {
    const store = useProTimelineStore()
    const { project, seqA } = makeProjectWithNested()
    store.init(project)
    store.enterNestedSequence('clip_a')
    const result = store.exitNestedSequence()
    expect(result).toBe(true)
    expect(store.activeSequenceId).toBe(seqA.id)
    expect(store.isNestedEditing).toBe(false)
  })

  it('SI5: exitNestedSequence 在根层返回 false', () => {
    const store = useProTimelineStore()
    const { project } = makeProjectWithNested()
    store.init(project)
    const result = store.exitNestedSequence()
    expect(result).toBe(false)
  })

  it('SI6: jumpToBreadcrumbLevel 跳到指定层', () => {
    const store = useProTimelineStore()
    const { project, seqA } = makeProjectWithNested()
    store.init(project)
    store.enterNestedSequence('clip_a') // A → B
    store.enterNestedSequence('clip_b') // B → C
    // 跳到根层 A
    const result = store.jumpToBreadcrumbLevel(0)
    expect(result).toBe(true)
    expect(store.activeSequenceId).toBe(seqA.id)
    expect(store.nestedDepth).toBe(0)
  })

  it('SI7: jumpToBreadcrumbLevel 越界返回 false', () => {
    const store = useProTimelineStore()
    const { project } = makeProjectWithNested()
    store.init(project)
    const result = store.jumpToBreadcrumbLevel(99)
    expect(result).toBe(false)
  })

  it('SI8: breadcrumbEntries 响应式更新', () => {
    const store = useProTimelineStore()
    const { project } = makeProjectWithNested()
    store.init(project)
    expect(store.breadcrumbEntries.length).toBe(1)
    store.enterNestedSequence('clip_a')
    expect(store.breadcrumbEntries.length).toBe(2)
    expect(store.breadcrumbEntries[1].label).toBe('B')
  })

  it('SI9: 多层嵌套完整流程', () => {
    const store = useProTimelineStore()
    const { project, seqA, seqB, seqC } = makeProjectWithNested()
    store.init(project)
    expect(store.activeSequenceId).toBe(seqA.id)

    store.enterNestedSequence('clip_a') // A → B
    expect(store.activeSequenceId).toBe(seqB.id)
    expect(store.nestedDepth).toBe(1)

    store.enterNestedSequence('clip_b') // B → C
    expect(store.activeSequenceId).toBe(seqC.id)
    expect(store.nestedDepth).toBe(2)

    store.exitNestedSequence() // C → B
    expect(store.activeSequenceId).toBe(seqB.id)
    expect(store.nestedDepth).toBe(1)

    store.exitNestedSequence() // B → A
    expect(store.activeSequenceId).toBe(seqA.id)
    expect(store.nestedDepth).toBe(0)
  })

  it('SI10: init 后面包屑重置', () => {
    const store = useProTimelineStore()
    const { project } = makeProjectWithNested()
    store.init(project)
    store.enterNestedSequence('clip_a')
    expect(store.isNestedEditing).toBe(true)

    // 重新 init
    store.init(project)
    expect(store.isNestedEditing).toBe(false)
    expect(store.breadcrumbEntries.length).toBe(1)
  })

  it('SI11: syncBreadcrumb 手动同步', () => {
    const store = useProTimelineStore()
    const { project } = makeProjectWithNested()
    store.init(project)
    store.syncBreadcrumb()
    expect(store.breadcrumbEntries.length).toBe(1)
  })

  it('SI12: enterNestedSequence 切换 Sequence 后 resolver 重建', () => {
    const store = useProTimelineStore()
    const { project } = makeProjectWithNested()
    store.init(project)
    // seqB 有 clip_b
    store.enterNestedSequence('clip_a')
    // 切换后应能解析 seqB 的 clips
    const clips = store.resolveActiveClips()
    expect(clips).toBeDefined()
    // seqB 中有 clip_b(嵌套引用 seqC)
    expect(clips?.allActiveClips.length).toBeGreaterThan(0)
  })

  it('SI13: jumpToBreadcrumbLevel 到中间层', () => {
    const store = useProTimelineStore()
    const { project, seqB } = makeProjectWithNested()
    store.init(project)
    store.enterNestedSequence('clip_a') // A → B
    store.enterNestedSequence('clip_b') // B → C
    // 跳到 B(中间层)
    store.jumpToBreadcrumbLevel(1)
    expect(store.activeSequenceId).toBe(seqB.id)
    expect(store.nestedDepth).toBe(1)
  })

  it('SI14: 面包屑条目包含 parentClipId', () => {
    const store = useProTimelineStore()
    const { project } = makeProjectWithNested()
    store.init(project)
    store.enterNestedSequence('clip_a')
    const entries = store.breadcrumbEntries
    expect(entries.length).toBe(2)
    expect(entries[0].parentClipId).toBeNull()
    expect(entries[1].parentClipId).toBe('clip_a')
  })
})
