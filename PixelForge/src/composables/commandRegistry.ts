/**
 * Command Registry(Step 40.2)— 命令注册中心 + 快捷键匹配引擎。
 *
 * 职责:
 * - 注册命令(id + name + description + category + shortcut + execute)
 * - 快捷键匹配(KeyboardEvent → shortcut string → command)
 * - 命令执行(execute by id)
 * - 命令查询(list / get / search)
 *
 * 设计原则:
 * - 纯 TS 模块(不依赖 Vue / DOM 事件监听),便于测试
 * - 快捷键格式:"mod+z"(mod = ctrl|cmd 跨平台)、"shift+mod+z"、"space"、"arrowleft"
 * - 焦点守卫由调用方(useCommandShortcuts composable)处理,Registry 只做匹配
 * - 单例模式(全局唯一 Registry)
 *
 * 快捷键格式规范:
 * - 修饰键顺序:shift + alt + mod + key(如 "shift+alt+mod+z"),对齐 mac ⇧⌥⌘ 显示顺序
 * - mod = ctrl 或 cmd(跨平台,Mac 用 Cmd,Win/Linux 用 Ctrl)
 * - key 用小写(如 "z", "arrowleft", "space", "f1")
 * - 无修饰键时直接写 key(如 "space", "escape")
 */

// ============================================================================
// 类型定义
// ============================================================================

/** 命令分类 */
export type CommandCategory =
  | 'playback'   // 播放控制
  | 'history'    // 撤销/重做
  | 'project'    // 项目操作
  | 'editor'     // 编辑器操作
  | 'view'       // 视图操作
  | 'settings'   // 设置

/** 快捷键字符串(如 "mod+z", "shift+mod+z", "space") */
export type Shortcut = string

/** 命令定义 */
export interface Command {
  /** 唯一 ID(如 "playback.toggle", "history.undo") */
  id: string
  /** 显示名称(如 "播放/暂停") */
  name: string
  /** 描述(用于命令面板 + tooltip) */
  description?: string
  /** 分类(用于命令面板分组) */
  category: CommandCategory
  /** 快捷键(可选,如 "mod+z") */
  shortcut?: Shortcut
  /** 备用快捷键(如 redo 同时支持 "shift+mod+z" 和 "mod+y") */
  altShortcut?: Shortcut
  /** 执行函数 */
  execute: () => void | Promise<void>
  /** 是否在编辑控件聚焦时仍响应(默认 false,undo/redo 为 true) */
  activeWhenEditing?: boolean
  /** 是否启用(默认 true,false 时快捷键不响应 + 面板灰显) */
  enabled?: boolean
}

/** 命令查询结果(不含 execute 函数,用于 UI 展示) */
export interface CommandInfo {
  id: string
  name: string
  description?: string
  category: CommandCategory
  shortcut?: Shortcut
  altShortcut?: Shortcut
  activeWhenEditing: boolean
  enabled: boolean
}

// ============================================================================
// 快捷键解析
// ============================================================================

/**
 * 将 KeyboardEvent 转为快捷键字符串。
 *
 * @param event 键盘事件
 * @returns 快捷键字符串(如 "mod+z", "shift+mod+z", "space"),无匹配返回 null
 */
export function eventToShortcut(event: KeyboardEvent): Shortcut | null {
  const isMod = event.ctrlKey || event.metaKey
  if (!isMod && !event.shiftKey && !event.altKey) {
    // 无修饰键:仅响应特定 key(space / arrows / home / end / escape / f1-f12)
    const key = event.key.toLowerCase()
    const code = event.code
    // Space(key 可能是 " " 或 "Space")
    if (key === ' ' || code === 'Space') return 'space'
    // 方向键
    if (key === 'arrowleft' || key === 'arrowright' ||
        key === 'arrowup' || key === 'arrowdown') return key
    // Home / End / Escape / PageUp / PageDown
    if (['home', 'end', 'escape', 'pageup', 'pagedown'].includes(key)) return key
    // F1-F12
    if (/^f([1-9]|1[0-2])$/.test(key)) return key
    // 其他单字符键不注册为快捷键(避免误触)
    return null
  }

  // 有修饰键:组合键(顺序:shift + alt + mod + key,对齐 mac ⇧⌥⌘ 显示)
  const parts: string[] = []
  if (event.shiftKey) parts.push('shift')
  if (event.altKey) parts.push('alt')
  if (isMod) parts.push('mod')

  const key = event.key.toLowerCase()
  // 忽略修饰键本身的 keyup(如 Shift、Control、Alt、Meta)
  if (['shift', 'control', 'alt', 'meta'].includes(key)) return null

  parts.push(key)
  return parts.join('+')
}

/**
 * 格式化快捷键为人类可读字符串(用于 UI 展示)。
 *
 * @param shortcut 快捷键字符串
 * @param platform 平台('mac' | 'win',默认自动检测)
 * @returns 可读字符串(如 "⌘Z", "Ctrl+Shift+Z", "Space")
 */
export function formatShortcut(
  shortcut: Shortcut,
  platform?: 'mac' | 'win',
): string {
  const isMac = platform === 'mac' ||
    (!platform && typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform))
  const modLabel = isMac ? '⌘' : 'Ctrl'
  const shiftLabel = isMac ? '⇧' : 'Shift'
  const altLabel = isMac ? '⌥' : 'Alt'

  const parts = shortcut.split('+')
  const result: string[] = []

  for (const part of parts) {
    switch (part) {
      case 'mod': result.push(modLabel); break
      case 'shift': result.push(shiftLabel); break
      case 'alt': result.push(altLabel); break
      case 'space': result.push('Space'); break
      case 'arrowleft': result.push('←'); break
      case 'arrowright': result.push('→'); break
      case 'arrowup': result.push('↑'); break
      case 'arrowdown': result.push('↓'); break
      case 'home': result.push('Home'); break
      case 'end': result.push('End'); break
      case 'escape': result.push('Esc'); break
      case 'pageup': result.push('PageUp'); break
      case 'pagedown': result.push('PageDown'); break
      default:
        // 单字母大写,其他保持
        result.push(part.length === 1 ? part.toUpperCase() : part)
    }
  }

  return isMac ? result.join('') : result.join('+')
}

// ============================================================================
// 焦点守卫
// ============================================================================

/**
 * 检查事件目标是否为可编辑控件(input/textarea/select/contenteditable)。
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName.toLowerCase()
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true
  if (target.isContentEditable) return true
  return false
}

// ============================================================================
// CommandRegistry 类
// ============================================================================

/**
 * 命令注册中心(单例)。
 *
 * @example
 * import { commandRegistry } from '@/composables/commandRegistry'
 *
 * // 注册命令
 * commandRegistry.register({
 *   id: 'playback.toggle',
 *   name: '播放/暂停',
 *   category: 'playback',
 *   shortcut: 'space',
 *   execute: () => timelineStore.togglePlay(),
 * })
 *
 * // 匹配快捷键
 * const cmd = commandRegistry.matchShortcut(event)
 * if (cmd && (!isEditableTarget(event.target) || cmd.activeWhenEditing)) {
 *   event.preventDefault()
 *   cmd.execute()
 * }
 *
 * // 执行命令
 * commandRegistry.execute('playback.toggle')
 *
 * // 查询命令(用于 CommandPalette)
 * const commands = commandRegistry.list()
 */
export class CommandRegistry {
  private readonly commands = new Map<string, Command>()
  /** shortcut → commandId 映射(快捷键索引) */
  private readonly shortcutIndex = new Map<Shortcut, string>()

  /**
   * 注册命令。若 id 已存在则覆盖。
   */
  register(command: Command): void {
    // 移除旧命令的快捷键索引(若覆盖注册)
    const existing = this.commands.get(command.id)
    if (existing) {
      if (existing.shortcut) this.shortcutIndex.delete(existing.shortcut)
      if (existing.altShortcut) this.shortcutIndex.delete(existing.altShortcut)
    }
    this.commands.set(command.id, { ...command, enabled: command.enabled ?? true, activeWhenEditing: command.activeWhenEditing ?? false })
    // 建立快捷键索引
    if (command.shortcut) this.shortcutIndex.set(command.shortcut, command.id)
    if (command.altShortcut) this.shortcutIndex.set(command.altShortcut, command.id)
  }

  /**
   * 批量注册命令。
   */
  registerAll(commands: Command[]): void {
    for (const cmd of commands) this.register(cmd)
  }

  /**
   * 注销命令。
   */
  unregister(id: string): boolean {
    const cmd = this.commands.get(id)
    if (!cmd) return false
    if (cmd.shortcut) this.shortcutIndex.delete(cmd.shortcut)
    if (cmd.altShortcut) this.shortcutIndex.delete(cmd.altShortcut)
    return this.commands.delete(id)
  }

  /**
   * 获取命令(含 execute 函数)。
   */
  get(id: string): Command | undefined {
    return this.commands.get(id)
  }

  /**
   * 列出所有命令信息(不含 execute,用于 UI)。
   */
  list(): CommandInfo[] {
    return Array.from(this.commands.values()).map((cmd) => ({
      id: cmd.id,
      name: cmd.name,
      description: cmd.description,
      category: cmd.category,
      shortcut: cmd.shortcut,
      altShortcut: cmd.altShortcut,
      activeWhenEditing: cmd.activeWhenEditing ?? false,
      enabled: cmd.enabled ?? true,
    }))
  }

  /**
   * 按分类列出命令。
   */
  listByCategory(category: CommandCategory): CommandInfo[] {
    return this.list().filter((c) => c.category === category)
  }

  /**
   * 搜索命令(模糊匹配 name + id + description)。
   */
  search(query: string): CommandInfo[] {
    const q = query.toLowerCase().trim()
    if (!q) return this.list()
    return this.list().filter((c) => {
      return c.name.toLowerCase().includes(q) ||
             c.id.toLowerCase().includes(q) ||
             (c.description?.toLowerCase().includes(q) ?? false)
    })
  }

  /**
   * 执行命令。
   * @returns true=执行成功,false=命令不存在或禁用
   */
  execute(id: string): boolean {
    const cmd = this.commands.get(id)
    if (!cmd || cmd.enabled === false) return false
    void cmd.execute()
    return true
  }

  /**
   * 匹配快捷键(从 KeyboardEvent)。
   * @returns 匹配的命令(含 execute),无匹配返回 undefined
   */
  matchShortcut(event: KeyboardEvent): Command | undefined {
    const shortcut = eventToShortcut(event)
    if (!shortcut) return undefined
    const cmdId = this.shortcutIndex.get(shortcut)
    if (!cmdId) return undefined
    const cmd = this.commands.get(cmdId)
    if (!cmd || cmd.enabled === false) return undefined
    return cmd
  }

  /**
   * 检查快捷键是否已被绑定。
   */
  isShortcutBound(shortcut: Shortcut): boolean {
    return this.shortcutIndex.has(shortcut)
  }

  /**
   * 获取快捷键绑定的命令 ID。
   */
  getCommandByShortcut(shortcut: Shortcut): string | undefined {
    return this.shortcutIndex.get(shortcut)
  }

  /**
   * 更新命令的 enabled 状态。
   */
  setEnabled(id: string, enabled: boolean): void {
    const cmd = this.commands.get(id)
    if (cmd) cmd.enabled = enabled
  }

  /**
   * 重新绑定快捷键(运行时自定义快捷键用)。
   */
  rebindShortcut(id: string, newShortcut?: Shortcut): void {
    const cmd = this.commands.get(id)
    if (!cmd) return
    // 移除旧索引
    if (cmd.shortcut) this.shortcutIndex.delete(cmd.shortcut)
    // 设置新快捷键
    cmd.shortcut = newShortcut
    if (newShortcut) this.shortcutIndex.set(newShortcut, id)
  }

  /**
   * 清空所有命令。
   */
  clear(): void {
    this.commands.clear()
    this.shortcutIndex.clear()
  }

  /**
   * 获取命令总数。
   */
  get size(): number {
    return this.commands.size
  }

  /**
   * 获取已绑定快捷键的数量。
   */
  get shortcutCount(): number {
    return this.shortcutIndex.size
  }
}

// ============================================================================
// 单例
// ============================================================================

/** 全局命令注册中心单例 */
export const commandRegistry = new CommandRegistry()

// ============================================================================
// 默认命令注册(对齐 useKeyboardShortcuts.ts 现有绑定)
// ============================================================================

/**
 * 注册默认快捷键命令(延迟注册,由 App.vue 在 setup 中调用)。
 *
 * 注意:execute 函数需要访问 store,由调用方注入。
 *
 * @param actions 命令执行函数映射
 */
export interface DefaultCommandActions {
  togglePlay: () => void
  stepForward: () => void
  stepBackward: () => void
  jumpStart: () => void
  jumpEnd: () => void
  undo: () => void
  redo: () => void
}

/**
 * 注册默认命令(播放控制 + 撤销/重做)。
 */
export function registerDefaultCommands(actions: DefaultCommandActions): void {
  commandRegistry.registerAll([
    {
      id: 'playback.toggle',
      name: '播放 / 暂停',
      description: '切换时间轴播放状态',
      category: 'playback',
      shortcut: 'space',
      execute: actions.togglePlay,
    },
    {
      id: 'playback.stepForward',
      name: '下一帧',
      description: '时间轴前进一帧',
      category: 'playback',
      shortcut: 'arrowright',
      execute: actions.stepForward,
    },
    {
      id: 'playback.stepBackward',
      name: '上一帧',
      description: '时间轴后退一帧',
      category: 'playback',
      shortcut: 'arrowleft',
      execute: actions.stepBackward,
    },
    {
      id: 'playback.jumpStart',
      name: '跳到开头',
      description: '时间轴跳到第一帧',
      category: 'playback',
      shortcut: 'home',
      execute: actions.jumpStart,
    },
    {
      id: 'playback.jumpEnd',
      name: '跳到结尾',
      description: '时间轴跳到最后一帧',
      category: 'playback',
      shortcut: 'end',
      execute: actions.jumpEnd,
    },
    {
      id: 'history.undo',
      name: '撤销',
      description: '撤销上一步操作',
      category: 'history',
      shortcut: 'mod+z',
      activeWhenEditing: true,
      execute: actions.undo,
    },
    {
      id: 'history.redo',
      name: '重做',
      description: '重做已撤销的操作',
      category: 'history',
      shortcut: 'shift+mod+z',
      altShortcut: 'mod+y',
      activeWhenEditing: true,
      execute: actions.redo,
    },
  ])
}
