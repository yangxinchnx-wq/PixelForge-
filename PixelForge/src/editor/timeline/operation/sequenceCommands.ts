/**
 * Sequence Commands(Step 31.6)— Sequence 级可撤销操作。
 *
 * 与 commands.ts / trackCommands.ts / multiClipCommands.ts 区别:
 * - 那些命令操作单个活跃 Sequence(MutableSequenceState)
 * - 本模块命令操作整个 Project(MutableProjectState):
 *     AddSequence / RemoveSequence / DuplicateSequence
 *     RenameSequence / SwitchSequence / SetSequencePropertiesCommand
 *
 * 用法:
 *   const cmd = new AddSequenceCommand(state, newSeq)
 *   history.execute(cmd)
 */
import type { Sequence } from '../core/sequence'
import { createSequence } from '../core/sequence'
import type { MutableProjectState } from './command'
import { genCommandId } from './command'
import { cloneClip, genClipId } from '../core/clip'
import type { Track } from '../core/track'

// ============================================================================
// 1. ProjectCommand 基类
// ============================================================================

/**
 * ProjectCommand — 操作 Project 级状态的命令基类。
 *
 * 与 BaseCommand 区别:BaseCommand 操作 MutableSequenceState(单 Sequence),
 * ProjectCommand 操作 MutableProjectState(整个 Project,含多 Sequence)。
 */
export abstract class ProjectCommand {
  abstract readonly id: string
  abstract readonly label: string
  protected state: MutableProjectState
  private _executed = false

  constructor(state: MutableProjectState) {
    this.state = state
  }

  get executed(): boolean {
    return this._executed
  }

  execute(): void {
    if (this._executed) return
    this.doExecute()
    this._executed = true
    this.state.notify()
  }

  undo(): void {
    if (!this._executed) return
    this.doUndo()
    this._executed = false
    this.state.notify()
  }

  protected abstract doExecute(): void
  protected abstract doUndo(): void
}

// ============================================================================
// 2. AddSequenceCommand
// ============================================================================

/**
 * 添加 Sequence 到 Project。
 */
export class AddSequenceCommand extends ProjectCommand {
  readonly id = genCommandId('addSeq')
  readonly label = '添加序列'
  private newSequence: Sequence
  private wasAdded = false

  constructor(state: MutableProjectState, sequence?: Sequence) {
    super(state)
    this.newSequence = sequence ?? createSequence({ name: `序列 ${state.project.sequences.length + 1}` })
  }

  protected doExecute(): void {
    this.state.project = {
      ...this.state.project,
      sequences: [...this.state.project.sequences, this.newSequence],
      updatedAt: Date.now(),
    }
    this.wasAdded = true
  }

  protected doUndo(): void {
    if (!this.wasAdded) return
    this.state.project = {
      ...this.state.project,
      sequences: this.state.project.sequences.filter((s) => s.id !== this.newSequence.id),
      updatedAt: Date.now(),
    }
  }

  get sequenceId(): string {
    return this.newSequence.id
  }
}

// ============================================================================
// 3. RemoveSequenceCommand
// ============================================================================

/**
 * 删除 Sequence(不允许删除最后一个)。
 *
 * 若删除的是 activeSequence,自动切换到第一个剩余 Sequence。
 */
export class RemoveSequenceCommand extends ProjectCommand {
  readonly id = genCommandId('rmSeq')
  readonly label = '删除序列'
  private sequenceId: string
  private removedSequence: Sequence | null = null
  private removedIndex = -1
  private prevActiveId = ''
  private didRemove = false

  constructor(state: MutableProjectState, sequenceId: string) {
    super(state)
    this.sequenceId = sequenceId
  }

  protected doExecute(): void {
    const project = this.state.project
    if (project.sequences.length <= 1) return

    const idx = project.sequences.findIndex((s) => s.id === this.sequenceId)
    if (idx < 0) return

    this.removedSequence = project.sequences[idx]
    this.removedIndex = idx
    this.prevActiveId = project.activeSequenceId

    const newSequences = project.sequences.filter((s) => s.id !== this.sequenceId)
    const newActiveId = project.activeSequenceId === this.sequenceId
      ? newSequences[0].id
      : project.activeSequenceId

    this.state.project = {
      ...project,
      sequences: newSequences,
      activeSequenceId: newActiveId,
      updatedAt: Date.now(),
    }
    this.didRemove = true
  }

  protected doUndo(): void {
    if (!this.didRemove || !this.removedSequence) return
    const sequences = [...this.state.project.sequences]
    sequences.splice(this.removedIndex, 0, this.removedSequence)
    this.state.project = {
      ...this.state.project,
      sequences,
      activeSequenceId: this.prevActiveId,
      updatedAt: Date.now(),
    }
  }
}

// ============================================================================
// 4. DuplicateSequenceCommand
// ============================================================================

/**
 * 深拷贝 Sequence(新 ID + 新 Clip ID + " 副本" 后缀)。
 */
export class DuplicateSequenceCommand extends ProjectCommand {
  readonly id = genCommandId('dupSeq')
  readonly label = '复制序列'
  private sourceId: string
  private duplicated: Sequence | null = null

  constructor(state: MutableProjectState, sourceId: string) {
    super(state)
    this.sourceId = sourceId
  }

  protected doExecute(): void {
    const source = this.state.project.sequences.find((s) => s.id === this.sourceId)
    if (!source) return

    this.duplicated = deepCloneSequence(source)
    this.state.project = {
      ...this.state.project,
      sequences: [...this.state.project.sequences, this.duplicated],
      updatedAt: Date.now(),
    }
  }

  protected doUndo(): void {
    if (!this.duplicated) return
    this.state.project = {
      ...this.state.project,
      sequences: this.state.project.sequences.filter((s) => s.id !== this.duplicated!.id),
      updatedAt: Date.now(),
    }
  }

  get duplicatedId(): string | null {
    return this.duplicated?.id ?? null
  }
}

// ============================================================================
// 5. RenameSequenceCommand
// ============================================================================

/**
 * 重命名 Sequence。
 */
export class RenameSequenceCommand extends ProjectCommand {
  readonly id = genCommandId('renSeq')
  readonly label = '重命名序列'
  private sequenceId: string
  private newName: string
  private prevName = ''

  constructor(state: MutableProjectState, sequenceId: string, newName: string) {
    super(state)
    this.sequenceId = sequenceId
    this.newName = newName.trim()
  }

  protected doExecute(): void {
    const seq = this.state.project.sequences.find((s) => s.id === this.sequenceId)
    if (!seq || !this.newName) return
    this.prevName = seq.name
    this.state.project = {
      ...this.state.project,
      sequences: this.state.project.sequences.map((s) =>
        s.id === this.sequenceId ? { ...s, name: this.newName, updatedAt: Date.now() } : s,
      ),
      updatedAt: Date.now(),
    }
  }

  protected doUndo(): void {
    if (!this.prevName) return
    this.state.project = {
      ...this.state.project,
      sequences: this.state.project.sequences.map((s) =>
        s.id === this.sequenceId ? { ...s, name: this.prevName, updatedAt: Date.now() } : s,
      ),
      updatedAt: Date.now(),
    }
  }
}

// ============================================================================
// 6. SwitchSequenceCommand
// ============================================================================

/**
 * 切换活跃 Sequence(不删除任何 Sequence,只改 activeSequenceId)。
 */
export class SwitchSequenceCommand extends ProjectCommand {
  readonly id = genCommandId('swSeq')
  readonly label = '切换序列'
  private targetId: string
  private prevActiveId = ''

  constructor(state: MutableProjectState, targetId: string) {
    super(state)
    this.targetId = targetId
  }

  protected doExecute(): void {
    const exists = this.state.project.sequences.some((s) => s.id === this.targetId)
    if (!exists) return
    this.prevActiveId = this.state.project.activeSequenceId
    this.state.project = {
      ...this.state.project,
      activeSequenceId: this.targetId,
      updatedAt: Date.now(),
    }
  }

  protected doUndo(): void {
    if (!this.prevActiveId) return
    this.state.project = {
      ...this.state.project,
      activeSequenceId: this.prevActiveId,
      updatedAt: Date.now(),
    }
  }
}

// ============================================================================
// 7. SetSequencePropertiesCommand
// ============================================================================

/**
 * 修改 Sequence 属性(fps / width / height / duration)。
 */
export class SetSequencePropertiesCommand extends ProjectCommand {
  readonly id = genCommandId('setSeqProps')
  readonly label = '修改序列属性'
  private sequenceId: string
  private newProps: Partial<Pick<Sequence, 'fps' | 'width' | 'height' | 'duration'>>
  private prevProps: Partial<Pick<Sequence, 'fps' | 'width' | 'height' | 'duration'>> = {}

  constructor(
    state: MutableProjectState,
    sequenceId: string,
    props: Partial<Pick<Sequence, 'fps' | 'width' | 'height' | 'duration'>>,
  ) {
    super(state)
    this.sequenceId = sequenceId
    this.newProps = { ...props }
  }

  protected doExecute(): void {
    const seq = this.state.project.sequences.find((s) => s.id === this.sequenceId)
    if (!seq) return
    // 记录旧值(只记录要修改的字段)
    this.prevProps = {}
    if (this.newProps.fps !== undefined) this.prevProps.fps = seq.fps
    if (this.newProps.width !== undefined) this.prevProps.width = seq.width
    if (this.newProps.height !== undefined) this.prevProps.height = seq.height
    if (this.newProps.duration !== undefined) this.prevProps.duration = seq.duration

    this.state.project = {
      ...this.state.project,
      sequences: this.state.project.sequences.map((s) =>
        s.id === this.sequenceId ? { ...s, ...this.newProps, updatedAt: Date.now() } : s,
      ),
      updatedAt: Date.now(),
    }
  }

  protected doUndo(): void {
    if (Object.keys(this.prevProps).length === 0) return
    this.state.project = {
      ...this.state.project,
      sequences: this.state.project.sequences.map((s) =>
        s.id === this.sequenceId ? { ...s, ...this.prevProps, updatedAt: Date.now() } : s,
      ),
      updatedAt: Date.now(),
    }
  }
}

// ============================================================================
// 8. 辅助:深拷贝 Sequence
// ============================================================================

/**
 * 深拷贝 Sequence(新 Sequence ID + 新 Track ID + 新 Clip ID)。
 *
 * 用于 DuplicateSequenceCommand。
 * 拷贝后的 Sequence 名称加 " 副本" 后缀。
 *
 * 注意:嵌套引用(sequenceId)保持原值 — 指向被引用的源 Sequence,
 * 而非拷贝(否则会无限拷贝)。
 */
export function deepCloneSequence(source: Sequence): Sequence {
  const newTracks: Track[] = source.tracks.map((track) => {
    const newClips = track.clips.map((clip) => cloneClip(clip, genClipId()))
    return {
      ...track,
      id: `track_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      clips: newClips,
    }
  })

  return {
    ...source,
    id: `seq_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    name: `${source.name} 副本`,
    tracks: newTracks,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}
