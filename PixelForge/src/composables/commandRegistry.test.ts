/**
 * Command Registry Tests(Step 40.2)
 *
 * 测试策略:
 * - eventToShortcut:修饰键组合 / 单键 / 忽略修饰键本身
 * - formatShortcut:mac/win 格式 / 特殊键映射
 * - isEditableTarget:input/textarea/select/contenteditable
 * - CommandRegistry:注册/注销/查询/执行/匹配/搜索/重绑定/批量
 * - registerDefaultCommands:7 个默认命令注册
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  CommandRegistry,
  commandRegistry,
  eventToShortcut,
  formatShortcut,
  isEditableTarget,
  registerDefaultCommands,
  type Command,
} from './commandRegistry'

// ============================================================================
// 辅助:创建 mock KeyboardEvent
// ============================================================================

function makeEvent(
  key: string,
  options: {
    ctrlKey?: boolean
    metaKey?: boolean
    shiftKey?: boolean
    altKey?: boolean
    code?: string
    target?: EventTarget | null
  } = {},
): KeyboardEvent {
  return {
    key,
    code: options.code ?? '',
    ctrlKey: options.ctrlKey ?? false,
    metaKey: options.metaKey ?? false,
    shiftKey: options.shiftKey ?? false,
    altKey: options.altKey ?? false,
    target: options.target ?? null,
    preventDefault: () => {},
  } as unknown as KeyboardEvent
}

// ============================================================================
// 1. eventToShortcut
// ============================================================================

describe('commandRegistry / eventToShortcut', () => {
  it('E01: mod+z → "mod+z"', () => {
    expect(eventToShortcut(makeEvent('z', { ctrlKey: true }))).toBe('mod+z')
    expect(eventToShortcut(makeEvent('z', { metaKey: true }))).toBe('mod+z')
  })

  it('E02: shift+mod+z → "shift+mod+z"', () => {
    expect(eventToShortcut(makeEvent('z', { ctrlKey: true, shiftKey: true }))).toBe('shift+mod+z')
    expect(eventToShortcut(makeEvent('Z', { metaKey: true, shiftKey: true }))).toBe('shift+mod+z')
  })

  it('E03: mod+y → "mod+y"', () => {
    expect(eventToShortcut(makeEvent('y', { ctrlKey: true }))).toBe('mod+y')
  })

  it('E04: space(无修饰键)→ "space"', () => {
    expect(eventToShortcut(makeEvent(' ', { code: 'Space' }))).toBe('space')
    expect(eventToShortcut(makeEvent('Space', { code: 'Space' }))).toBe('space')
  })

  it('E05: arrowleft → "arrowleft"', () => {
    expect(eventToShortcut(makeEvent('ArrowLeft'))).toBe('arrowleft')
  })

  it('E06: arrowright → "arrowright"', () => {
    expect(eventToShortcut(makeEvent('ArrowRight'))).toBe('arrowright')
  })

  it('E07: home / end → "home" / "end"', () => {
    expect(eventToShortcut(makeEvent('Home'))).toBe('home')
    expect(eventToShortcut(makeEvent('End'))).toBe('end')
  })

  it('E08: escape → "escape"', () => {
    expect(eventToShortcut(makeEvent('Escape'))).toBe('escape')
  })

  it('E09: F1-F12 → "f1"-"f12"', () => {
    expect(eventToShortcut(makeEvent('F1'))).toBe('f1')
    expect(eventToShortcut(makeEvent('F12'))).toBe('f12')
  })

  it('E10: 普通字母(无修饰键)→ null', () => {
    expect(eventToShortcut(makeEvent('a'))).toBeNull()
    expect(eventToShortcut(makeEvent('x'))).toBeNull()
  })

  it('E11: 修饰键本身(shift/ctrl/alt)→ null', () => {
    expect(eventToShortcut(makeEvent('Shift', { shiftKey: true }))).toBeNull()
    expect(eventToShortcut(makeEvent('Control', { ctrlKey: true }))).toBeNull()
    expect(eventToShortcut(makeEvent('Alt', { altKey: true }))).toBeNull()
  })

  it('E12: alt+mod+delete → "alt+mod+delete"', () => {
    expect(eventToShortcut(makeEvent('Delete', { ctrlKey: true, altKey: true }))).toBe('alt+mod+delete')
  })

  it('E13: pageup / pagedown', () => {
    expect(eventToShortcut(makeEvent('PageUp'))).toBe('pageup')
    expect(eventToShortcut(makeEvent('PageDown'))).toBe('pagedown')
  })
})

// ============================================================================
// 2. formatShortcut
// ============================================================================

describe('commandRegistry / formatShortcut', () => {
  it('F01: mac mod+z → "⌘Z"', () => {
    expect(formatShortcut('mod+z', 'mac')).toBe('⌘Z')
  })

  it('F02: win mod+z → "Ctrl+Z"', () => {
    expect(formatShortcut('mod+z', 'win')).toBe('Ctrl+Z')
  })

  it('F03: mac shift+mod+z → "⇧⌘Z"', () => {
    expect(formatShortcut('shift+mod+z', 'mac')).toBe('⇧⌘Z')
  })

  it('F04: win shift+mod+z → "Shift+Ctrl+Z"', () => {
    expect(formatShortcut('shift+mod+z', 'win')).toBe('Shift+Ctrl+Z')
  })

  it('F05: space → "Space"', () => {
    expect(formatShortcut('space', 'mac')).toBe('Space')
    expect(formatShortcut('space', 'win')).toBe('Space')
  })

  it('F06: arrowleft → "←"', () => {
    expect(formatShortcut('arrowleft', 'win')).toBe('←')
    expect(formatShortcut('arrowright', 'win')).toBe('→')
  })

  it('F07: home / end', () => {
    expect(formatShortcut('home', 'win')).toBe('Home')
    expect(formatShortcut('end', 'win')).toBe('End')
  })

  it('F08: escape → "Esc"', () => {
    expect(formatShortcut('escape', 'win')).toBe('Esc')
  })

  it('F09: mac alt+mod+a → "⌥⌘A"', () => {
    expect(formatShortcut('alt+mod+a', 'mac')).toBe('⌥⌘A')
  })
})

// ============================================================================
// 3. isEditableTarget
// ============================================================================

/**
 * Mock HTMLElement — 在 vitest 默认 Node 环境下替代真实 DOM。
 *
 * 设计要点:
 * - 实现 tagName / contentEditable / isContentEditable 三个属性,对齐真实 HTMLElement 接口
 * - contentEditable 设置为 'true' 时 isContentEditable getter 返回 true(对齐 DOM 语义)
 * - 通过 vi.stubGlobal 注入到全局,使 isEditableTarget 中的 `instanceof HTMLElement` 成立
 */
class MockHTMLElement {
  tagName: string
  private _contentEditable = 'false'
  constructor(tag: string) {
    this.tagName = tag.toUpperCase()
  }
  get isContentEditable(): boolean {
    return this._contentEditable === 'true'
  }
  get contentEditable(): string {
    return this._contentEditable
  }
  set contentEditable(v: string) {
    this._contentEditable = v
  }
}

function makeElement(tag: string, contentEditable = false): HTMLElement {
  const el = new MockHTMLElement(tag) as unknown as HTMLElement
  if (contentEditable) el.contentEditable = 'true'
  return el
}

describe('commandRegistry / isEditableTarget', () => {
  beforeEach(() => {
    vi.stubGlobal('HTMLElement', MockHTMLElement)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('ET01: input 是可编辑', () => {
    expect(isEditableTarget(makeElement('input'))).toBe(true)
  })

  it('ET02: textarea 是可编辑', () => {
    expect(isEditableTarget(makeElement('textarea'))).toBe(true)
  })

  it('ET03: select 是可编辑', () => {
    expect(isEditableTarget(makeElement('select'))).toBe(true)
  })

  it('ET04: contenteditable div 是可编辑', () => {
    expect(isEditableTarget(makeElement('div', true))).toBe(true)
  })

  it('ET05: 普通 div 不是可编辑', () => {
    expect(isEditableTarget(makeElement('div'))).toBe(false)
  })

  it('ET06: null 不是可编辑', () => {
    expect(isEditableTarget(null)).toBe(false)
  })

  it('ET07: 非 HTMLElement 不是可编辑', () => {
    expect(isEditableTarget({} as EventTarget)).toBe(false)
  })
})

// ============================================================================
// 4. CommandRegistry — 注册 / 注销 / 查询
// ============================================================================

describe('CommandRegistry / register & unregister', () => {
  let registry: CommandRegistry

  beforeEach(() => {
    registry = new CommandRegistry()
  })

  it('R01: register 后 size 增加', () => {
    expect(registry.size).toBe(0)
    registry.register({
      id: 'test',
      name: '测试',
      category: 'playback',
      execute: () => {},
    })
    expect(registry.size).toBe(1)
  })

  it('R02: register 相同 id 覆盖', () => {
    registry.register({ id: 'test', name: '测试1', category: 'playback', execute: () => {} })
    registry.register({ id: 'test', name: '测试2', category: 'history', execute: () => {} })
    expect(registry.size).toBe(1)
    expect(registry.get('test')!.name).toBe('测试2')
    expect(registry.get('test')!.category).toBe('history')
  })

  it('R03: unregister 删除命令', () => {
    registry.register({ id: 'test', name: '测试', category: 'playback', execute: () => {} })
    expect(registry.unregister('test')).toBe(true)
    expect(registry.size).toBe(0)
  })

  it('R04: unregister 不存在的 id 返回 false', () => {
    expect(registry.unregister('not_exist')).toBe(false)
  })

  it('R05: registerAll 批量注册', () => {
    registry.registerAll([
      { id: 'a', name: 'A', category: 'playback', execute: () => {} },
      { id: 'b', name: 'B', category: 'history', execute: () => {} },
      { id: 'c', name: 'C', category: 'editor', execute: () => {} },
    ])
    expect(registry.size).toBe(3)
  })

  it('R06: get 返回命令', () => {
    registry.register({ id: 'test', name: '测试', category: 'playback', execute: () => {}, description: 'desc' })
    const cmd = registry.get('test')
    expect(cmd).toBeDefined()
    expect(cmd!.name).toBe('测试')
    expect(cmd!.description).toBe('desc')
  })

  it('R07: get 不存在返回 undefined', () => {
    expect(registry.get('not_exist')).toBeUndefined()
  })

  it('R08: clear 清空所有', () => {
    registry.registerAll([
      { id: 'a', name: 'A', category: 'playback', execute: () => {} },
      { id: 'b', name: 'B', category: 'history', execute: () => {} },
    ])
    registry.clear()
    expect(registry.size).toBe(0)
    expect(registry.shortcutCount).toBe(0)
  })
})

// ============================================================================
// 5. CommandRegistry — 快捷键绑定 / 匹配
// ============================================================================

describe('CommandRegistry / shortcut binding', () => {
  let registry: CommandRegistry

  beforeEach(() => {
    registry = new CommandRegistry()
  })

  it('SB01: 注册带 shortcut 的命令', () => {
    registry.register({
      id: 'undo',
      name: '撤销',
      category: 'history',
      shortcut: 'mod+z',
      execute: () => {},
    })
    expect(registry.shortcutCount).toBe(1)
    expect(registry.isShortcutBound('mod+z')).toBe(true)
  })

  it('SB02: altShortcut 也建立索引', () => {
    registry.register({
      id: 'redo',
      name: '重做',
      category: 'history',
      shortcut: 'shift+mod+z',
      altShortcut: 'mod+y',
      execute: () => {},
    })
    expect(registry.shortcutCount).toBe(2)
    expect(registry.isShortcutBound('shift+mod+z')).toBe(true)
    expect(registry.isShortcutBound('mod+y')).toBe(true)
  })

  it('SB03: 覆盖注册时旧快捷键索引移除', () => {
    registry.register({ id: 'test', name: 'T', category: 'playback', shortcut: 'mod+a', execute: () => {} })
    expect(registry.isShortcutBound('mod+a')).toBe(true)
    // 覆盖注册,更换快捷键
    registry.register({ id: 'test', name: 'T', category: 'playback', shortcut: 'mod+b', execute: () => {} })
    expect(registry.isShortcutBound('mod+a')).toBe(false)
    expect(registry.isShortcutBound('mod+b')).toBe(true)
  })

  it('SB04: unregister 时快捷键索引移除', () => {
    registry.register({ id: 'test', name: 'T', category: 'playback', shortcut: 'mod+a', execute: () => {} })
    registry.unregister('test')
    expect(registry.isShortcutBound('mod+a')).toBe(false)
  })

  it('SB05: matchShortcut 匹配成功', () => {
    registry.register({ id: 'undo', name: '撤销', category: 'history', shortcut: 'mod+z', execute: () => {} })
    const cmd = registry.matchShortcut(makeEvent('z', { ctrlKey: true }))
    expect(cmd).toBeDefined()
    expect(cmd!.id).toBe('undo')
  })

  it('SB06: matchShortcut 无匹配返回 undefined', () => {
    registry.register({ id: 'undo', name: '撤销', category: 'history', shortcut: 'mod+z', execute: () => {} })
    const cmd = registry.matchShortcut(makeEvent('x', { ctrlKey: true }))
    expect(cmd).toBeUndefined()
  })

  it('SB07: matchShortcut 禁用命令返回 undefined', () => {
    registry.register({ id: 'undo', name: '撤销', category: 'history', shortcut: 'mod+z', execute: () => {}, enabled: false })
    const cmd = registry.matchShortcut(makeEvent('z', { ctrlKey: true }))
    expect(cmd).toBeUndefined()
  })

  it('SB08: matchShortcut altShortcut 匹配', () => {
    registry.register({
      id: 'redo', name: '重做', category: 'history',
      shortcut: 'shift+mod+z', altShortcut: 'mod+y',
      execute: () => {},
    })
    const cmd = registry.matchShortcut(makeEvent('y', { ctrlKey: true }))
    expect(cmd).toBeDefined()
    expect(cmd!.id).toBe('redo')
  })

  it('SB09: getCommandByShortcut 返回命令 id', () => {
    registry.register({ id: 'undo', name: '撤销', category: 'history', shortcut: 'mod+z', execute: () => {} })
    expect(registry.getCommandByShortcut('mod+z')).toBe('undo')
  })

  it('SB10: rebindShortcut 重新绑定', () => {
    registry.register({ id: 'test', name: 'T', category: 'playback', shortcut: 'mod+a', execute: () => {} })
    registry.rebindShortcut('test', 'mod+b')
    expect(registry.isShortcutBound('mod+a')).toBe(false)
    expect(registry.isShortcutBound('mod+b')).toBe(true)
    expect(registry.get('test')!.shortcut).toBe('mod+b')
  })

  it('SB11: rebindShortcut 解除绑定(undefined)', () => {
    registry.register({ id: 'test', name: 'T', category: 'playback', shortcut: 'mod+a', execute: () => {} })
    registry.rebindShortcut('test', undefined)
    expect(registry.isShortcutBound('mod+a')).toBe(false)
    expect(registry.get('test')!.shortcut).toBeUndefined()
  })
})

// ============================================================================
// 6. CommandRegistry — 执行
// ============================================================================

describe('CommandRegistry / execute', () => {
  let registry: CommandRegistry

  beforeEach(() => {
    registry = new CommandRegistry()
  })

  it('EX01: execute 调用命令的 execute 函数', () => {
    let called = false
    registry.register({ id: 'test', name: 'T', category: 'playback', execute: () => { called = true } })
    expect(registry.execute('test')).toBe(true)
    expect(called).toBe(true)
  })

  it('EX02: execute 不存在的 id 返回 false', () => {
    expect(registry.execute('not_exist')).toBe(false)
  })

  it('EX03: execute 禁用命令返回 false', () => {
    let called = false
    registry.register({ id: 'test', name: 'T', category: 'playback', execute: () => { called = true }, enabled: false })
    expect(registry.execute('test')).toBe(false)
    expect(called).toBe(false)
  })

  it('EX04: setEnabled 动态启用/禁用', () => {
    let called = 0
    registry.register({ id: 'test', name: 'T', category: 'playback', execute: () => { called++ } })
    registry.setEnabled('test', false)
    expect(registry.execute('test')).toBe(false)
    registry.setEnabled('test', true)
    expect(registry.execute('test')).toBe(true)
    expect(called).toBe(1)
  })
})

// ============================================================================
// 7. CommandRegistry — 查询 / 搜索
// ============================================================================

describe('CommandRegistry / query & search', () => {
  let registry: CommandRegistry

  beforeEach(() => {
    registry = new CommandRegistry()
    registry.registerAll([
      { id: 'playback.toggle', name: '播放/暂停', description: '切换播放', category: 'playback', shortcut: 'space', execute: () => {} },
      { id: 'playback.stepForward', name: '下一帧', category: 'playback', shortcut: 'arrowright', execute: () => {} },
      { id: 'history.undo', name: '撤销', description: 'undo', category: 'history', shortcut: 'mod+z', execute: () => {} },
      { id: 'history.redo', name: '重做', description: 'redo', category: 'history', shortcut: 'shift+mod+z', execute: () => {} },
    ])
  })

  it('Q01: list 返回所有命令信息', () => {
    const list = registry.list()
    expect(list).toHaveLength(4)
    expect(list[0].id).toBe('playback.toggle')
    expect(list[0].name).toBe('播放/暂停')
    expect(list[0].shortcut).toBe('space')
    // 不含 execute 函数
    expect((list[0] as unknown as Command).execute).toBeUndefined()
  })

  it('Q02: listByCategory 按分类过滤', () => {
    const playback = registry.listByCategory('playback')
    expect(playback).toHaveLength(2)
    expect(playback.every((c) => c.category === 'playback')).toBe(true)

    const history = registry.listByCategory('history')
    expect(history).toHaveLength(2)
  })

  it('Q03: search 按 name 匹配', () => {
    const results = registry.search('播放')
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('playback.toggle')
  })

  it('Q04: search 按 id 匹配', () => {
    const results = registry.search('undo')
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('history.undo')
  })

  it('Q05: search 按 description 匹配', () => {
    const results = registry.search('redo')
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('history.redo')
  })

  it('Q06: search 空字符串返回全部', () => {
    expect(registry.search('')).toHaveLength(4)
  })

  it('Q07: search 无匹配返回空数组', () => {
    expect(registry.search('不存在')).toHaveLength(0)
  })

  it('Q08: list 中 activeWhenEditing 默认 false', () => {
    const list = registry.list()
    expect(list.find((c) => c.id === 'playback.toggle')!.activeWhenEditing).toBe(false)
  })

  it('Q09: list 中 enabled 默认 true', () => {
    const list = registry.list()
    expect(list.every((c) => c.enabled === true)).toBe(true)
  })
})

// ============================================================================
// 8. registerDefaultCommands
// ============================================================================

describe('commandRegistry / registerDefaultCommands', () => {
  beforeEach(() => {
    commandRegistry.clear()
  })
  afterEach(() => {
    commandRegistry.clear()
  })

  it('DF01: 注册 7 个默认命令', () => {
    registerDefaultCommands({
      togglePlay: () => {},
      stepForward: () => {},
      stepBackward: () => {},
      jumpStart: () => {},
      jumpEnd: () => {},
      undo: () => {},
      redo: () => {},
    })
    expect(commandRegistry.size).toBe(7)
    expect(commandRegistry.shortcutCount).toBe(8) // 7 个 shortcut + redo 的 altShortcut
  })

  it('DF02: 包含所有预期命令 id', () => {
    registerDefaultCommands({
      togglePlay: () => {},
      stepForward: () => {},
      stepBackward: () => {},
      jumpStart: () => {},
      jumpEnd: () => {},
      undo: () => {},
      redo: () => {},
    })
    const ids = commandRegistry.list().map((c) => c.id)
    expect(ids).toContain('playback.toggle')
    expect(ids).toContain('playback.stepForward')
    expect(ids).toContain('playback.stepBackward')
    expect(ids).toContain('playback.jumpStart')
    expect(ids).toContain('playback.jumpEnd')
    expect(ids).toContain('history.undo')
    expect(ids).toContain('history.redo')
  })

  it('DF03: undo/redo activeWhenEditing = true', () => {
    registerDefaultCommands({
      togglePlay: () => {},
      stepForward: () => {},
      stepBackward: () => {},
      jumpStart: () => {},
      jumpEnd: () => {},
      undo: () => {},
      redo: () => {},
    })
    const undo = commandRegistry.get('history.undo')
    const redo = commandRegistry.get('history.redo')
    expect(undo!.activeWhenEditing).toBe(true)
    expect(redo!.activeWhenEditing).toBe(true)
  })

  it('DF04: execute 调用注入的 action', () => {
    let playToggled = false
    registerDefaultCommands({
      togglePlay: () => { playToggled = true },
      stepForward: () => {},
      stepBackward: () => {},
      jumpStart: () => {},
      jumpEnd: () => {},
      undo: () => {},
      redo: () => {},
    })
    commandRegistry.execute('playback.toggle')
    expect(playToggled).toBe(true)
  })

  it('DF05: redo 同时绑定 shift+mod+z 和 mod+y', () => {
    registerDefaultCommands({
      togglePlay: () => {},
      stepForward: () => {},
      stepBackward: () => {},
      jumpStart: () => {},
      jumpEnd: () => {},
      undo: () => {},
      redo: () => {},
    })
    expect(commandRegistry.isShortcutBound('shift+mod+z')).toBe(true)
    expect(commandRegistry.isShortcutBound('mod+y')).toBe(true)
  })
})
