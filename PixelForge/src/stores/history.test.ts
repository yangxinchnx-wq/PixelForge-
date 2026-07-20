import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ValuePatch, StructuralPatch } from '@/compiler/ir/patch'
import type { RuntimeLike } from '@/stores/history'

import { useHistoryStore } from './history'

// —— 模拟 runtime(实现 RuntimeLike 最小接口) ——
function createMockRuntime(shouldSucceed = true): RuntimeLike & {
  applied: Array<{ targetId: string; paramKey: string; value: ValuePatch['value'] }>
  structuralApplied: Array<{ targetId: string; field: StructuralPatch['field']; value: StructuralPatch['value'] }>
} {
  const applied: Array<{ targetId: string; paramKey: string; value: ValuePatch['value'] }> = []
  const structuralApplied: Array<{ targetId: string; field: StructuralPatch['field']; value: StructuralPatch['value'] }> = []
  return {
    applied,
    structuralApplied,
    applyValuePatch(targetId, paramKey, value) {
      applied.push({ targetId, paramKey, value })
      return shouldSucceed
    },
    applyStructuralPatch(targetId, field, value) {
      structuralApplied.push({ targetId, field, value })
      return shouldSucceed
    },
  }
}

describe('history store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('初始状态:空栈,不能 undo/redo', () => {
    const history = useHistoryStore()
    expect(history.canUndo).toBe(false)
    expect(history.canRedo).toBe(false)
    expect(history.undoCount).toBe(0)
    expect(history.redoCount).toBe(0)
    expect(history.lastEntry).toBeNull()
    expect(history.nextRedoEntry).toBeNull()
  })

  it('pushEntry 推入新条目,清空 redo 栈', () => {
    const history = useHistoryStore()
    // 先制造一个 redo 状态
    history.pushEntry({
      id: 'p1',
      description: 'a.x -> 1',
      targetId: 'a',
      paramKey: 'x',
      oldValue: 0,
      newValue: 1,
    })
    const mock = createMockRuntime()
    history.undo(mock)
    expect(history.redoCount).toBe(1)

    // 推入新条目,redo 应被清空
    history.pushEntry({
      id: 'p2',
      description: 'a.x -> 2',
      targetId: 'a',
      paramKey: 'x',
      oldValue: 1,
      newValue: 2,
    })
    expect(history.undoCount).toBe(1)
    expect(history.redoCount).toBe(0)
  })

  it('合并窗口:同 targetId.paramKey 500ms 内合并', () => {
    const history = useHistoryStore()
    history.setMergeWindow(500)

    history.pushEntry({
      id: 'p1',
      description: 'a.x -> 1',
      targetId: 'a',
      paramKey: 'x',
      oldValue: 0,
      newValue: 1,
    })
    expect(history.undoCount).toBe(1)
    expect(history.lastEntry?.newValue).toBe(1)
    expect(history.lastEntry?.oldValue).toBe(0)

    // 立刻再推一条同 target.param
    history.pushEntry({
      id: 'p2',
      description: 'a.x -> 2',
      targetId: 'a',
      paramKey: 'x',
      oldValue: 1, // 调用方读取的 oldValue(此时已经是 1)
      newValue: 2,
    })
    expect(history.undoCount).toBe(1) // 合并,不新增
    expect(history.lastEntry?.newValue).toBe(2) // newValue 更新
    expect(history.lastEntry?.oldValue).toBe(0) // oldValue 保留首次
    expect(history.lastEntry?.id).toBe('p1') // id 保留首次
  })

  it('合并窗口:不同 paramKey 不合并', () => {
    const history = useHistoryStore()
    history.setMergeWindow(500)

    history.pushEntry({
      id: 'p1',
      description: 'a.x -> 1',
      targetId: 'a',
      paramKey: 'x',
      oldValue: 0,
      newValue: 1,
    })
    history.pushEntry({
      id: 'p2',
      description: 'a.y -> 1',
      targetId: 'a',
      paramKey: 'y',
      oldValue: 0,
      newValue: 1,
    })
    expect(history.undoCount).toBe(2)
  })

  it('合并窗口:超时后不合并', () => {
    const history = useHistoryStore()
    history.setMergeWindow(100)

    history.pushEntry({
      id: 'p1',
      description: 'a.x -> 1',
      targetId: 'a',
      paramKey: 'x',
      oldValue: 0,
      newValue: 1,
    })

    // 用 fake timers 推进时间
    vi.useFakeTimers()
    vi.advanceTimersByTime(200) // 超过 100ms 合并窗口

    history.pushEntry({
      id: 'p2',
      description: 'a.x -> 2',
      targetId: 'a',
      paramKey: 'x',
      oldValue: 1,
      newValue: 2,
    })
    expect(history.undoCount).toBe(2)
  })

  it('undo:用 oldValue 反向应用,移到 redo 栈', () => {
    const history = useHistoryStore()
    const mock = createMockRuntime()

    history.pushEntry({
      id: 'p1',
      description: 'a.x -> 1',
      targetId: 'a',
      paramKey: 'x',
      oldValue: 0,
      newValue: 1,
    })

    const ok = history.undo(mock)
    expect(ok).toBe(true)
    expect(mock.applied).toHaveLength(1)
    expect(mock.applied[0]).toEqual({
      targetId: 'a',
      paramKey: 'x',
      value: 0, // 用 oldValue 反向应用
    })
    expect(history.undoCount).toBe(0)
    expect(history.redoCount).toBe(1)
    expect(history.canUndo).toBe(false)
    expect(history.canRedo).toBe(true)
  })

  it('redo:用 newValue 正向应用,移回 undo 栈', () => {
    const history = useHistoryStore()
    const mock = createMockRuntime()

    history.pushEntry({
      id: 'p1',
      description: 'a.x -> 1',
      targetId: 'a',
      paramKey: 'x',
      oldValue: 0,
      newValue: 1,
    })
    history.undo(mock)

    const ok = history.redo(mock)
    expect(ok).toBe(true)
    expect(mock.applied).toHaveLength(2)
    expect(mock.applied[1]).toEqual({
      targetId: 'a',
      paramKey: 'x',
      value: 1, // 用 newValue 正向应用
    })
    expect(history.undoCount).toBe(1)
    expect(history.redoCount).toBe(0)
  })

  it('undo 失败时回滚栈(applyValuePatch 返回 false)', () => {
    const history = useHistoryStore()
    const mock = createMockRuntime(false)

    history.pushEntry({
      id: 'p1',
      description: 'a.x -> 1',
      targetId: 'a',
      paramKey: 'x',
      oldValue: 0,
      newValue: 1,
    })

    const ok = history.undo(mock)
    expect(ok).toBe(false)
    expect(history.undoCount).toBe(1) // 没移除
    expect(history.redoCount).toBe(0) // 没移到 redo
  })

  it('空栈 undo / redo 返回 false', () => {
    const history = useHistoryStore()
    const mock = createMockRuntime()
    expect(history.undo(mock)).toBe(false)
    expect(history.redo(mock)).toBe(false)
  })

  it('clear 清空两个栈', () => {
    const history = useHistoryStore()
    history.pushEntry({
      id: 'p1',
      description: 'a.x -> 1',
      targetId: 'a',
      paramKey: 'x',
      oldValue: 0,
      newValue: 1,
    })
    history.pushEntry({
      id: 'p2',
      description: 'a.y -> 1',
      targetId: 'a',
      paramKey: 'y',
      oldValue: 0,
      newValue: 1,
    })
    expect(history.undoCount).toBe(2)

    history.clear()
    expect(history.undoCount).toBe(0)
    expect(history.redoCount).toBe(0)
  })

  it('maxSize 限制:超出时丢弃最老条目', () => {
    const history = useHistoryStore()
    history.setMaxSize(3)

    for (let i = 0; i < 5; i++) {
      history.pushEntry({
        id: `p${i}`,
        description: `a.x -> ${i}`,
        targetId: 'a',
        paramKey: `x${i}`, // 不同 paramKey 避免合并
        oldValue: i - 1,
        newValue: i,
      })
    }
    expect(history.undoCount).toBe(3) // 限制为 3
    expect(history.undoStack[0].id).toBe('p2') // 最老的 p0/p1 被丢弃
    expect(history.undoStack[2].id).toBe('p4')
  })
})
