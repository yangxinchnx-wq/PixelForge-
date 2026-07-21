/**
 * Step 31.6 单元测试 — 多 Sequence 切换 + 嵌套 Sequence。
 *
 * 覆盖:
 * - CM:  Clip 模型扩展(sequenceId / isNestedSequenceClip / setClipSequenceId)
 * - PM:  Project 模型扩展(findSequence / renameSequence / removeSequence / setSequenceProperties)
 * - SC:  Sequence Commands(Add/Remove/Duplicate/Rename/Switch/SetProps + undo)
 * - NSR: NestedSequenceResolver(resolve / detectCycle / isNestedReferenceSafe)
 * - SI:  Store 集成(addSequence / switchSequence / resolveNestedClips)
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { createClip, isNestedSequenceClip, setClipSequenceId, cloneClip } from './core/clip'
import { createSequence } from './core/sequence'
import type { Sequence } from './core/sequence'
import { TrackType } from './core/track'
import {
  createProject,
  addSequence,
  findSequence,
  renameSequence,
  removeSequence,
  setSequenceProperties,
  setActiveSequence,
  getTotalClipCountInProject,
} from './core/project'
import type { Project } from './core/project'
import { seconds } from './core/time'
import type { MutableProjectState } from './operation/command'
import { CommandHistory } from './operation/history'
import {
  AddSequenceCommand,
  RemoveSequenceCommand,
  DuplicateSequenceCommand,
  RenameSequenceCommand,
  SwitchSequenceCommand,
  SetSequencePropertiesCommand,
  deepCloneSequence,
} from './operation/sequenceCommands'
import {
  NestedSequenceResolver,
  resolveActiveSequenceClips,
  MAX_NESTING_DEPTH,
} from './resolver/nestedSequenceResolver'
import { useProTimelineStore } from './store/timelineStore'

// ============================================================================
// 辅助:创建带 Clip 的 Sequence
// ============================================================================

function makeSequenceWithClips(name: string, clipStarts: number[]): Sequence {
  const seq = createSequence({ name })
  // 在第一个 VIDEO 轨道上添加 Clip
  const videoTrack = seq.tracks.find((t) => t.type === TrackType.VIDEO)!
  for (const start of clipStarts) {
    const clip = createClip({
      assetId: `asset_${name}_${start}`,
      kind: 'video',
      timelineStart: seconds(start),
      sourceStart: seconds(0),
      sourceEnd: seconds(5),
    })
    videoTrack.clips.push(clip)
  }
  return seq
}

function makeNestedClip(seqId: string, timelineStart: number): ReturnType<typeof createClip> {
  return createClip({
    assetId: `nested_${seqId}`,
    kind: 'video',
    timelineStart: seconds(timelineStart),
    sourceStart: seconds(0),
    sourceEnd: seconds(10),
    sequenceId: seqId,
  })
}

function makeMutableProjectState(project: Project): MutableProjectState {
  let current = project
  return {
    get project() { return current },
    set project(p: Project) { current = p },
    notify: () => { /* no-op for tests */ },
  }
}

// ============================================================================
// CM: Clip 模型扩展
// ============================================================================

describe('CM: Clip sequenceId 扩展', () => {
  it('CM1: createClip 支持 sequenceId 参数', () => {
    const clip = createClip({
      assetId: 'a1',
      kind: 'video',
      timelineStart: seconds(0),
      sourceStart: seconds(0),
      sourceEnd: seconds(5),
      sequenceId: 'seq_abc',
    })
    expect(clip.sequenceId).toBe('seq_abc')
  })

  it('CM2: createClip 不传 sequenceId 时字段不存在', () => {
    const clip = createClip({
      assetId: 'a1',
      kind: 'video',
      timelineStart: seconds(0),
      sourceStart: seconds(0),
      sourceEnd: seconds(5),
    })
    expect(clip.sequenceId).toBeUndefined()
  })

  it('CM3: isNestedSequenceClip 正确判断', () => {
    const normal = createClip({
      assetId: 'a1', kind: 'video',
      timelineStart: seconds(0), sourceStart: seconds(0), sourceEnd: seconds(5),
    })
    const nested = createClip({
      assetId: 'a1', kind: 'video',
      timelineStart: seconds(0), sourceStart: seconds(0), sourceEnd: seconds(5),
      sequenceId: 'seq_x',
    })
    expect(isNestedSequenceClip(normal)).toBe(false)
    expect(isNestedSequenceClip(nested)).toBe(true)
  })

  it('CM4: setClipSequenceId 设置 sequenceId', () => {
    const clip = createClip({
      assetId: 'a1', kind: 'video',
      timelineStart: seconds(0), sourceStart: seconds(0), sourceEnd: seconds(5),
    })
    const updated = setClipSequenceId(clip, 'seq_y')
    expect(updated.sequenceId).toBe('seq_y')
    expect(clip.sequenceId).toBeUndefined() // 原始不变
  })

  it('CM5: setClipSequenceId 取消嵌套引用', () => {
    const clip = createClip({
      assetId: 'a1', kind: 'video',
      timelineStart: seconds(0), sourceStart: seconds(0), sourceEnd: seconds(5),
      sequenceId: 'seq_z',
    })
    const updated = setClipSequenceId(clip, undefined)
    expect(updated.sequenceId).toBeUndefined()
  })

  it('CM6: cloneClip 保留 sequenceId', () => {
    const clip = createClip({
      assetId: 'a1', kind: 'video',
      timelineStart: seconds(0), sourceStart: seconds(0), sourceEnd: seconds(5),
      sequenceId: 'seq_keep',
    })
    const cloned = cloneClip(clip)
    expect(cloned.sequenceId).toBe('seq_keep')
    expect(cloned.id).not.toBe(clip.id)
  })
})

// ============================================================================
// PM: Project 模型扩展
// ============================================================================

describe('PM: Project Sequence CRUD', () => {
  let project: Project

  beforeEach(() => {
    project = createProject('测试项目')
  })

  it('PM1: findSequence 找到 Sequence', () => {
    const seq = project.sequences[0]
    expect(findSequence(project, seq.id)).toBe(seq)
  })

  it('PM2: findSequence 找不到返回 null', () => {
    expect(findSequence(project, 'nonexistent')).toBeNull()
  })

  it('PM3: renameSequence 修改名称', () => {
    const seq = project.sequences[0]
    const updated = renameSequence(project, seq.id, '新名称')
    expect(findSequence(updated, seq.id)!.name).toBe('新名称')
  })

  it('PM4: renameSequence 空名称不修改', () => {
    const seq = project.sequences[0]
    const originalName = seq.name
    const updated = renameSequence(project, seq.id, '   ')
    expect(findSequence(updated, seq.id)!.name).toBe(originalName)
  })

  it('PM5: removeSequence 删除非活跃 Sequence', () => {
    // 先添加第二个 Sequence
    const seq2 = createSequence({ name: '序列2' })
    project = addSequence(project, seq2)
    expect(project.sequences.length).toBe(2)

    // 删除非活跃的 seq2
    const updated = removeSequence(project, seq2.id)
    expect(updated.sequences.length).toBe(1)
    expect(updated.activeSequenceId).toBe(project.activeSequenceId)
  })

  it('PM6: removeSequence 删除活跃 Sequence 时自动切换', () => {
    const seq2 = createSequence({ name: '序列2' })
    project = addSequence(project, seq2)
    const activeId = project.activeSequenceId

    // 删除活跃 Sequence
    const updated = removeSequence(project, activeId)
    expect(updated.sequences.length).toBe(1)
    expect(updated.activeSequenceId).toBe(seq2.id)
  })

  it('PM7: removeSequence 不允许删除最后一个', () => {
    const updated = removeSequence(project, project.sequences[0].id)
    expect(updated.sequences.length).toBe(1) // 不变
  })

  it('PM8: removeSequence 不存在的 ID 返回原 Project', () => {
    const updated = removeSequence(project, 'nonexistent')
    expect(updated).toBe(project)
  })

  it('PM9: setSequenceProperties 修改 fps', () => {
    const seq = project.sequences[0]
    const updated = setSequenceProperties(project, seq.id, { fps: 60 })
    expect(findSequence(updated, seq.id)!.fps).toBe(60)
  })

  it('PM10: setSequenceProperties 修改多个属性', () => {
    const seq = project.sequences[0]
    const updated = setSequenceProperties(project, seq.id, {
      fps: 24,
      width: 1280,
      height: 720,
    })
    const modified = findSequence(updated, seq.id)!
    expect(modified.fps).toBe(24)
    expect(modified.width).toBe(1280)
    expect(modified.height).toBe(720)
  })

  it('PM11: getTotalClipCountInProject 统计所有 Clip', () => {
    const seq2 = makeSequenceWithClips('序列2', [0, 5, 10])
    project = addSequence(project, seq2)
    // 默认序列有 0 个 Clip,seq2 有 3 个
    expect(getTotalClipCountInProject(project)).toBe(3)
  })
})

// ============================================================================
// SC: Sequence Commands
// ============================================================================

describe('SC: Sequence Commands', () => {
  let project: Project
  let state: MutableProjectState
  let history: CommandHistory

  beforeEach(() => {
    project = createProject('命令测试')
    state = makeMutableProjectState(project)
    history = new CommandHistory()
  })

  it('SC1: AddSequenceCommand 添加序列', () => {
    const cmd = new AddSequenceCommand(state)
    history.execute(cmd)
    expect(state.project.sequences.length).toBe(2)
    expect(cmd.sequenceId).toBeDefined()
  })

  it('SC2: AddSequenceCommand undo 移除序列', () => {
    const cmd = new AddSequenceCommand(state)
    history.execute(cmd)
    history.undo()
    expect(state.project.sequences.length).toBe(1)
  })

  it('SC3: AddSequenceCommand redo 重新添加', () => {
    const cmd = new AddSequenceCommand(state)
    history.execute(cmd)
    history.undo()
    history.redo()
    expect(state.project.sequences.length).toBe(2)
  })

  it('SC4: AddSequenceCommand 接受自定义 Sequence', () => {
    const custom = createSequence({ name: '自定义' })
    const cmd = new AddSequenceCommand(state, custom)
    history.execute(cmd)
    expect(state.project.sequences.length).toBe(2)
    expect(state.project.sequences[1].name).toBe('自定义')
  })

  it('SC5: RemoveSequenceCommand 删除序列', () => {
    const seq2 = createSequence({ name: '序列2' })
    state.project = addSequence(state.project, seq2)
    const cmd = new RemoveSequenceCommand(state, seq2.id)
    history.execute(cmd)
    expect(state.project.sequences.length).toBe(1)
  })

  it('SC6: RemoveSequenceCommand undo 恢复序列', () => {
    const seq2 = createSequence({ name: '序列2' })
    state.project = addSequence(state.project, seq2)
    const cmd = new RemoveSequenceCommand(state, seq2.id)
    history.execute(cmd)
    history.undo()
    expect(state.project.sequences.length).toBe(2)
    expect(state.project.sequences.find((s) => s.id === seq2.id)).toBeDefined()
  })

  it('SC7: RemoveSequenceCommand 不删除最后一个', () => {
    const onlySeq = state.project.sequences[0]
    const cmd = new RemoveSequenceCommand(state, onlySeq.id)
    history.execute(cmd)
    expect(state.project.sequences.length).toBe(1)
  })

  it('SC8: RemoveSequenceCommand 删除活跃序列时切换', () => {
    const seq2 = createSequence({ name: '序列2' })
    state.project = addSequence(state.project, seq2)
    const activeId = state.project.activeSequenceId
    const cmd = new RemoveSequenceCommand(state, activeId)
    history.execute(cmd)
    expect(state.project.activeSequenceId).toBe(seq2.id)
  })

  it('SC9: DuplicateSequenceCommand 深拷贝序列', () => {
    const source = makeSequenceWithClips('源序列', [0, 5, 10])
    state.project = addSequence(state.project, source)
    const cmd = new DuplicateSequenceCommand(state, source.id)
    history.execute(cmd)
    expect(state.project.sequences.length).toBe(3) // 默认1 + 源 + 副本
    const dup = state.project.sequences.find((s) => s.id === cmd.duplicatedId)
    expect(dup).toBeDefined()
    expect(dup!.name).toContain('副本')
    expect(dup!.id).not.toBe(source.id)
    // Clip 数量相同但 ID 不同
    const dupClipCount = dup!.tracks.reduce((n, t) => n + t.clips.length, 0)
    expect(dupClipCount).toBe(3)
  })

  it('SC10: DuplicateSequenceCommand undo 移除副本', () => {
    const source = makeSequenceWithClips('源序列', [0, 5])
    state.project = addSequence(state.project, source)
    const cmd = new DuplicateSequenceCommand(state, source.id)
    history.execute(cmd)
    history.undo()
    expect(state.project.sequences.length).toBe(2) // 默认1 + 源
  })

  it('SC11: RenameSequenceCommand 重命名', () => {
    const seq = state.project.sequences[0]
    const cmd = new RenameSequenceCommand(state, seq.id, '新名称')
    history.execute(cmd)
    expect(state.project.sequences[0].name).toBe('新名称')
  })

  it('SC12: RenameSequenceCommand undo 恢复名称', () => {
    const seq = state.project.sequences[0]
    const original = seq.name
    const cmd = new RenameSequenceCommand(state, seq.id, '新名称')
    history.execute(cmd)
    history.undo()
    expect(state.project.sequences[0].name).toBe(original)
  })

  it('SC13: SwitchSequenceCommand 切换活跃序列', () => {
    const seq2 = createSequence({ name: '序列2' })
    state.project = addSequence(state.project, seq2)
    const originalActive = state.project.activeSequenceId
    const cmd = new SwitchSequenceCommand(state, seq2.id)
    history.execute(cmd)
    expect(state.project.activeSequenceId).toBe(seq2.id)
    expect(state.project.activeSequenceId).not.toBe(originalActive)
  })

  it('SC14: SwitchSequenceCommand undo 切回', () => {
    const seq2 = createSequence({ name: '序列2' })
    state.project = addSequence(state.project, seq2)
    const originalActive = state.project.activeSequenceId
    const cmd = new SwitchSequenceCommand(state, seq2.id)
    history.execute(cmd)
    history.undo()
    expect(state.project.activeSequenceId).toBe(originalActive)
  })

  it('SC15: SetSequencePropertiesCommand 修改属性', () => {
    const seq = state.project.sequences[0]
    const cmd = new SetSequencePropertiesCommand(state, seq.id, { fps: 60 })
    history.execute(cmd)
    expect(state.project.sequences[0].fps).toBe(60)
  })

  it('SC16: SetSequencePropertiesCommand undo 恢复属性', () => {
    const seq = state.project.sequences[0]
    const originalFps = seq.fps
    const cmd = new SetSequencePropertiesCommand(state, seq.id, { fps: 60 })
    history.execute(cmd)
    history.undo()
    expect(state.project.sequences[0].fps).toBe(originalFps)
  })

  it('SC17: deepCloneSequence 生成新 ID', () => {
    const source = makeSequenceWithClips('源', [0, 5])
    const cloned = deepCloneSequence(source)
    expect(cloned.id).not.toBe(source.id)
    expect(cloned.name).toContain('副本')
    expect(cloned.tracks.length).toBe(source.tracks.length)
    // Clip ID 不同
    const srcClipIds = source.tracks.flatMap((t) => t.clips.map((c) => c.id))
    const dupClipIds = cloned.tracks.flatMap((t) => t.clips.map((c) => c.id))
    for (const id of srcClipIds) {
      expect(dupClipIds).not.toContain(id)
    }
  })
})

// ============================================================================
// NSR: NestedSequenceResolver
// ============================================================================

describe('NSR: NestedSequenceResolver', () => {
  let project: Project

  beforeEach(() => {
    project = createProject('嵌套测试')
  })

  it('NSR1: resolve 普通 Sequence 返回所有 Clip', () => {
    const seq = makeSequenceWithClips('主序列', [0, 5, 10])
    project = addSequence(project, seq)
    project = setActiveSequence(project, seq.id)
    const resolver = new NestedSequenceResolver(project)
    const result = resolver.resolve(seq)
    expect(result.length).toBe(3)
  })

  it('NSR2: resolve 嵌套 Clip 展开子 Sequence', () => {
    // 子序列有 2 个 Clip(在 0s 和 3s)
    const childSeq = makeSequenceWithClips('子序列', [0, 3])
    project = addSequence(project, childSeq)

    // 主序列有 1 个普通 Clip + 1 个嵌套 Clip(引用 childSeq,在 5s)
    const mainSeq = createSequence({ name: '主序列' })
    const videoTrack = mainSeq.tracks.find((t) => t.type === TrackType.VIDEO)!
    videoTrack.clips.push(createClip({
      assetId: 'a1', kind: 'video',
      timelineStart: seconds(0), sourceStart: seconds(0), sourceEnd: seconds(5),
    }))
    videoTrack.clips.push(makeNestedClip(childSeq.id, 5))
    project = addSequence(project, mainSeq)
    project = setActiveSequence(project, mainSeq.id)

    const resolver = new NestedSequenceResolver(project)
    const result = resolver.resolve(mainSeq)
    // 1 普通 + 2 嵌套展开 = 3
    expect(result.length).toBe(3)
  })

  it('NSR3: resolve 嵌套 Clip 时间偏移正确', () => {
    const childSeq = makeSequenceWithClips('子序列', [0, 3])
    project = addSequence(project, childSeq)

    const mainSeq = createSequence({ name: '主序列' })
    const videoTrack = mainSeq.tracks.find((t) => t.type === TrackType.VIDEO)!
    // 嵌套 Clip 在 10s
    videoTrack.clips.push(makeNestedClip(childSeq.id, 10))
    project = addSequence(project, mainSeq)
    project = setActiveSequence(project, mainSeq.id)

    const resolver = new NestedSequenceResolver(project)
    const result = resolver.resolve(mainSeq)
    // 子序列 Clip 在 0s 和 3s,偏移 +10s → 10s 和 13s
    expect(result.length).toBe(2)
    const starts = result.map((c) => Number(c.resolvedTimelineStart / 1_000_000n)).sort((a, b) => a - b)
    expect(starts).toEqual([10, 13])
  })

  it('NSR4: resolve 深度嵌套(3 层)', () => {
    // 最内层序列有 1 个 Clip
    const innerSeq = makeSequenceWithClips('内层', [0])
    project = addSequence(project, innerSeq)

    // 中间层引用内层
    const midSeq = createSequence({ name: '中层' })
    midSeq.tracks.find((t) => t.type === TrackType.VIDEO)!.clips.push(makeNestedClip(innerSeq.id, 0))
    project = addSequence(project, midSeq)

    // 外层引用中间层
    const outerSeq = createSequence({ name: '外层' })
    outerSeq.tracks.find((t) => t.type === TrackType.VIDEO)!.clips.push(makeNestedClip(midSeq.id, 0))
    project = addSequence(project, outerSeq)
    project = setActiveSequence(project, outerSeq.id)

    const resolver = new NestedSequenceResolver(project)
    const result = resolver.resolve(outerSeq)
    expect(result.length).toBe(1)
    expect(result[0].depth).toBe(2) // 外层 → 中层 → 内层
    expect(result[0].sourceChain.length).toBe(3) // [outer, mid, inner]
  })

  it('NSR5: resolve 循环引用不崩溃', () => {
    const seqA = createSequence({ name: 'A' })
    const seqB = createSequence({ name: 'B' })
    seqA.tracks.find((t) => t.type === TrackType.VIDEO)!.clips.push(makeNestedClip(seqB.id, 0))
    seqB.tracks.find((t) => t.type === TrackType.VIDEO)!.clips.push(makeNestedClip(seqA.id, 0))
    project = addSequence(project, seqA)
    project = addSequence(project, seqB)
    project = setActiveSequence(project, seqA.id)

    const resolver = new NestedSequenceResolver(project)
    // 不应崩溃,也不应无限循环
    expect(() => resolver.resolve(seqA)).not.toThrow()
  })

  it('NSR6: resolve 结果按时间排序', () => {
    const seq = makeSequenceWithClips('序列', [10, 0, 5])
    project = addSequence(project, seq)
    project = setActiveSequence(project, seq.id)
    const resolver = new NestedSequenceResolver(project)
    const result = resolver.resolve(seq)
    const starts = result.map((c) => Number(c.resolvedTimelineStart / 1_000_000n))
    expect(starts).toEqual([0, 5, 10])
  })

  it('NSR7: resolve 找不到子 Sequence 时跳过', () => {
    const mainSeq = createSequence({ name: '主' })
    mainSeq.tracks.find((t) => t.type === TrackType.VIDEO)!.clips.push(
      makeNestedClip('nonexistent_seq', 0),
    )
    project = addSequence(project, mainSeq)
    project = setActiveSequence(project, mainSeq.id)
    const resolver = new NestedSequenceResolver(project)
    const result = resolver.resolve(mainSeq)
    // 嵌套 Clip 引用不存在的 Sequence → 跳过,结果为空
    expect(result.length).toBe(0)
  })

  it('NSR8: detectCycle 检测无循环', () => {
    const seqA = createSequence({ name: 'A' })
    const seqB = createSequence({ name: 'B' })
    seqA.tracks.find((t) => t.type === TrackType.VIDEO)!.clips.push(makeNestedClip(seqB.id, 0))
    project = addSequence(project, seqA)
    project = addSequence(project, seqB)
    const resolver = new NestedSequenceResolver(project)
    const result = resolver.detectCycle(seqA.id)
    expect(result.hasCycle).toBe(false)
  })

  it('NSR9: detectCycle 检测直接循环(A→A)', () => {
    const seqA = createSequence({ name: 'A' })
    seqA.tracks.find((t) => t.type === TrackType.VIDEO)!.clips.push(makeNestedClip(seqA.id, 0))
    project = addSequence(project, seqA)
    const resolver = new NestedSequenceResolver(project)
    const result = resolver.detectCycle(seqA.id)
    expect(result.hasCycle).toBe(true)
    expect(result.cyclePath).toContain(seqA.id)
  })

  it('NSR10: detectCycle 检测间接循环(A→B→A)', () => {
    const seqA = createSequence({ name: 'A' })
    const seqB = createSequence({ name: 'B' })
    seqA.tracks.find((t) => t.type === TrackType.VIDEO)!.clips.push(makeNestedClip(seqB.id, 0))
    seqB.tracks.find((t) => t.type === TrackType.VIDEO)!.clips.push(makeNestedClip(seqA.id, 0))
    project = addSequence(project, seqA)
    project = addSequence(project, seqB)
    const resolver = new NestedSequenceResolver(project)
    const result = resolver.detectCycle(seqA.id)
    expect(result.hasCycle).toBe(true)
  })

  it('NSR11: isNestedReferenceSafe 自引用不安全', () => {
    const seqA = createSequence({ name: 'A' })
    project = addSequence(project, seqA)
    const resolver = new NestedSequenceResolver(project)
    expect(resolver.isNestedReferenceSafe(seqA.id, seqA.id)).toBe(false)
  })

  it('NSR12: isNestedReferenceSafe 安全的嵌套', () => {
    const seqA = createSequence({ name: 'A' })
    const seqB = createSequence({ name: 'B' })
    project = addSequence(project, seqA)
    project = addSequence(project, seqB)
    const resolver = new NestedSequenceResolver(project)
    expect(resolver.isNestedReferenceSafe(seqA.id, seqB.id)).toBe(true)
  })

  it('NSR13: isNestedReferenceSafe 会形成循环的不安全', () => {
    const seqA = createSequence({ name: 'A' })
    const seqB = createSequence({ name: 'B' })
    // B 已引用 A
    seqB.tracks.find((t) => t.type === TrackType.VIDEO)!.clips.push(makeNestedClip(seqA.id, 0))
    project = addSequence(project, seqA)
    project = addSequence(project, seqB)
    const resolver = new NestedSequenceResolver(project)
    // A 想引用 B → 会形成 A→B→A 循环
    expect(resolver.isNestedReferenceSafe(seqA.id, seqB.id)).toBe(false)
  })

  it('NSR14: findReferencingSequences 找到引用者', () => {
    const seqA = createSequence({ name: 'A' })
    const seqB = createSequence({ name: 'B' })
    seqB.tracks.find((t) => t.type === TrackType.VIDEO)!.clips.push(makeNestedClip(seqA.id, 0))
    project = addSequence(project, seqA)
    project = addSequence(project, seqB)
    const resolver = new NestedSequenceResolver(project)
    const refs = resolver.findReferencingSequences(seqA.id)
    expect(refs).toContain(seqB.id)
    expect(refs.length).toBe(1)
  })

  it('NSR15: MAX_NESTING_DEPTH 为合理值', () => {
    expect(MAX_NESTING_DEPTH).toBeGreaterThan(4)
    expect(MAX_NESTING_DEPTH).toBeLessThan(50)
  })

  it('NSR16: resolveActiveSequenceClips 便捷函数', () => {
    const seq = makeSequenceWithClips('主', [0, 5])
    project = addSequence(project, seq)
    project = setActiveSequence(project, seq.id)
    const result = resolveActiveSequenceClips(project)
    expect(result.length).toBe(2)
  })

  it('NSR17: ResolvedClip 携带 sourceChain 和 depth', () => {
    const seq = makeSequenceWithClips('主', [0])
    project = addSequence(project, seq)
    project = setActiveSequence(project, seq.id)
    const resolver = new NestedSequenceResolver(project)
    const result = resolver.resolve(seq)
    expect(result[0].sourceChain).toEqual([seq.id])
    expect(result[0].depth).toBe(0)
  })
})

// ============================================================================
// SI: Store 集成
// ============================================================================

describe('SI: Store Sequence 集成', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('SI1: store 初始有 1 个 Sequence', () => {
    const store = useProTimelineStore()
    if (!store.activeSequence) store.reset()
    expect(store.sequenceCount).toBe(1)
  })

  it('SI2: addSequence 增加序列数', () => {
    const store = useProTimelineStore()
    if (!store.activeSequence) store.reset()
    const id = store.addSequence()
    expect(store.sequenceCount).toBe(2)
    expect(store.findSequenceById(id)).toBeDefined()
  })

  it('SI3: switchSequence 切换活跃序列', () => {
    const store = useProTimelineStore()
    if (!store.activeSequence) store.reset()
    const originalId = store.activeSequenceId
    const newId = store.addSequence()
    store.switchSequence(newId)
    expect(store.activeSequenceId).toBe(newId)
    expect(store.activeSequenceId).not.toBe(originalId)
  })

  it('SI4: removeSequence 减少序列数', () => {
    const store = useProTimelineStore()
    if (!store.activeSequence) store.reset()
    const newId = store.addSequence()
    expect(store.sequenceCount).toBe(2)
    store.removeSequence(newId)
    expect(store.sequenceCount).toBe(1)
  })

  it('SI5: removeSequence 不删除最后一个', () => {
    const store = useProTimelineStore()
    if (!store.activeSequence) store.reset()
    store.removeSequence(store.activeSequenceId)
    expect(store.sequenceCount).toBe(1)
  })

  it('SI6: renameSequence 修改名称', () => {
    const store = useProTimelineStore()
    if (!store.activeSequence) store.reset()
    const id = store.activeSequenceId
    store.renameSequence(id, '新名称')
    expect(store.findSequenceById(id)!.name).toBe('新名称')
  })

  it('SI7: duplicateSequence 复制序列', () => {
    const store = useProTimelineStore()
    if (!store.activeSequence) store.reset()
    const sourceId = store.activeSequenceId
    const dupId = store.duplicateSequence(sourceId)
    expect(dupId).not.toBeNull()
    expect(store.sequenceCount).toBe(2)
    expect(store.findSequenceById(dupId!)!.name).toContain('副本')
  })

  it('SI8: setSequenceProperties 修改 fps', () => {
    const store = useProTimelineStore()
    if (!store.activeSequence) store.reset()
    const id = store.activeSequenceId
    store.setSequenceProperties(id, { fps: 60 })
    expect(store.findSequenceById(id)!.fps).toBe(60)
  })

  it('SI9: undo 撤销 addSequence', () => {
    const store = useProTimelineStore()
    if (!store.activeSequence) store.reset()
    store.addSequence()
    expect(store.sequenceCount).toBe(2)
    store.undo()
    expect(store.sequenceCount).toBe(1)
  })

  it('SI10: undo 撤销 switchSequence', () => {
    const store = useProTimelineStore()
    if (!store.activeSequence) store.reset()
    const originalId = store.activeSequenceId
    const newId = store.addSequence()
    store.switchSequence(newId)
    expect(store.activeSequenceId).toBe(newId)
    store.undo() // 撤销 switch → 回到 switch 前状态(originalId)
    expect(store.activeSequenceId).toBe(originalId)
    // 注意:addSequence 不自动切换 activeId,所以 switch 前 activeId 仍是 originalId
    // undo switch 后应回到 originalId
  })

  it('SI11: findSequenceById 查找', () => {
    const store = useProTimelineStore()
    if (!store.activeSequence) store.reset()
    const id = store.activeSequenceId
    expect(store.findSequenceById(id)).toBeDefined()
    expect(store.findSequenceById('nonexistent')).toBeNull()
  })

  it('SI12: isNestedReferenceSafe 自引用不安全', () => {
    const store = useProTimelineStore()
    if (!store.activeSequence) store.reset()
    const id = store.activeSequenceId
    expect(store.isNestedReferenceSafe(id, id)).toBe(false)
  })

  it('SI13: resolveNestedClips 返回展开后的 Clip', () => {
    const store = useProTimelineStore()
    if (!store.activeSequence) store.reset()
    const result = store.resolveNestedClips()
    // 默认空序列,无 Clip
    expect(result).toEqual([])
  })

  it('SI14: findReferencingSequences 空结果', () => {
    const store = useProTimelineStore()
    if (!store.activeSequence) store.reset()
    const refs = store.findReferencingSequences(store.activeSequenceId)
    expect(refs).toEqual([])
  })

  it('SI15: sequences getter 返回列表', () => {
    const store = useProTimelineStore()
    if (!store.activeSequence) store.reset()
    expect(store.sequences.length).toBe(1)
    store.addSequence()
    expect(store.sequences.length).toBe(2)
  })

  it('SI16: activeSequenceId getter', () => {
    const store = useProTimelineStore()
    if (!store.activeSequence) store.reset()
    const id = store.activeSequenceId
    expect(id).toBeDefined()
    expect(typeof id).toBe('string')
  })
})
