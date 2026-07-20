/**
 * MIDI Input(Step 30.14)— Web MIDI API 接入。
 *
 * 职责:
 * - init():          申请 MIDI 访问权限
 * - 监听 MIDI 消息:  noteon / noteoff / cc / pitchbend
 * - 把消息解析后写入 InputRouter(如 'midi.cc1' / 'midi.noteon' / ...)
 *
 * 与 spec §14 对齐:
 *   navigator.requestMIDIAccess()
 *     ↓
 *   midiAccess.inputs.forEach(input => input.onmidimessage = ...)
 *     ↓
 *   parseMidiMessage(event.data)
 *     ↓
 *   inputRouter.setSignal('midi.knob1', value, 'MIDI')
 *
 * 设计:
 * - 浏览器 API 依赖延迟到运行时(测试环境无 navigator.requestMIDIAccess)
 * - 支持多个设备同时监听
 * - CC 信号 id 约定:'midi.cc{ccNumber}'(如 'midi.cc1' / 'midi.cc74')
 */

import type { MidiMessage, MidiMessageType } from '../types'

// ============================================================================
// 1. 结构化类型(避免直接依赖 DOM 类型,便于测试)
// ============================================================================

/**
 * MIDIAccess 最小接口(结构化类型)。
 */
export interface MidiAccessLike {
  inputs: Map<string, MidiInputLike>
  outputs: Map<string, MidiOutputLike>
  onstatechange: ((event: unknown) => void) | null
}

export interface MidiInputLike {
  id: string
  name: string
  manufacturer: string
  onmidimessage: ((event: MidiMessageEventLike) => void) | null
}

export interface MidiOutputLike {
  id: string
  name: string
}

export interface MidiMessageEventLike {
  data: Uint8Array
  timeStamp: number
}

// ============================================================================
// 2. MIDI 消息解析
// ============================================================================

/**
 * 解析原始 MIDI 消息字节。
 *
 * MIDI 消息格式:
 *   [status, data1, data2]
 *   status = (command << 4) | channel
 *
 * 命令:
 *   0x8 = noteoff
 *   0x9 = noteon(velocity=0 时也表示 noteoff)
 *   0xB = cc(control change)
 *   0xE = pitchbend
 *
 * @param data       原始字节
 * @param timeStamp  时间戳(毫秒)
 * @returns 解析后的 MidiMessage,或 null(无法解析)
 */
export function parseMidiMessage(data: Uint8Array, timeStamp: number): MidiMessage | null {
  if (data.length < 2) return null

  const status = data[0]
  const command = status >> 4 // 高 4 位
  const channel = status & 0x0f // 低 4 位
  const value1 = data[1]
  const value2 = data.length >= 3 ? data[2] : 0

  let type: MidiMessageType | null = null
  switch (command) {
    case 0x8:
      type = 'noteoff'
      break
    case 0x9:
      // velocity=0 也表示 noteoff
      type = value2 === 0 ? 'noteoff' : 'noteon'
      break
    case 0xb:
      type = 'cc'
      break
    case 0xe:
      type = 'pitchbend'
      break
    default:
      // 其他命令(如 program change / system message)暂不支持
      return null
  }

  return { type, channel, value1, value2, timestamp: timeStamp }
}

// ============================================================================
// 3. 信号 id 生成
// ============================================================================

/** CC 信号 id:'midi.cc{number}' */
export function ccSignalId(ccNumber: number): string {
  return `midi.cc${ccNumber}`
}

/** Note 信号 id:'midi.note{pitch}' */
export function noteSignalId(pitch: number): string {
  return `midi.note${pitch}`
}

/** Pitchbend 信号 id */
export const PITCHBEND_SIGNAL_ID = 'midi.pitchbend'

/** Modulation wheel(标准 CC 1) */
export const MODWHEEL_SIGNAL_ID = ccSignalId(1)

/** Expression pedal(标准 CC 11) */
export const EXPRESSION_SIGNAL_ID = ccSignalId(11)

/** Sustain pedal(标准 CC 64) */
export const SUSTAIN_SIGNAL_ID = ccSignalId(64)

// ============================================================================
// 4. SignalWriter 接口(与 featureExtractor 一致)
// ============================================================================

interface SignalWriter {
  setSignal: (id: string, value: number, source: 'MIDI') => void
}

// ============================================================================
// 5. MidiInput 类
// ============================================================================

/**
 * MIDI 输入管理器。
 *
 * 用法:
 *   const midi = new MidiInput(inputRouter)
 *   await midi.init()
 *   // 自动监听所有设备,把消息写入 inputRouter
 */
export class MidiInput {
  private router: SignalWriter
  private access: MidiAccessLike | null = null
  private activeInputs: MidiInputLike[] = []

  constructor(router: SignalWriter) {
    this.router = router
  }

  /**
   * 初始化:申请 MIDI 访问权限,监听所有输入设备。
   *
   * @throws 若浏览器不支持 Web MIDI API
   */
  async init(): Promise<void> {
    if (this.access) return // 已初始化

    const requestMidi = this.getRequestMidiAccess()
    if (!requestMidi) {
      throw new Error('浏览器不支持 Web MIDI API')
    }

    this.access = await requestMidi()
    this.attachToInputs()

    // 监听设备热插拔
    this.access.onstatechange = () => {
      this.attachToInputs()
    }
  }

  /**
   * 附加到所有输入设备(监听 onmidimessage)。
   */
  private attachToInputs(): void {
    if (!this.access) return
    // 先清理旧的
    for (const input of this.activeInputs) {
      input.onmidimessage = null
    }
    this.activeInputs = []

    // 附加到所有当前设备
    this.access.inputs.forEach((input) => {
      input.onmidimessage = (event: MidiMessageEventLike) => {
        this.onMessage(event)
      }
      this.activeInputs.push(input)
    })
  }

  /**
   * 处理 MIDI 消息。
   */
  private onMessage(event: MidiMessageEventLike): void {
    const msg = parseMidiMessage(event.data, event.timeStamp)
    if (!msg) return

    switch (msg.type) {
      case 'noteon': {
        // noteon: 写入 'midi.note{pitch}' = velocity / 127
        const id = noteSignalId(msg.value1)
        this.router.setSignal(id, msg.value2 / 127, 'MIDI')
        break
      }
      case 'noteoff': {
        // noteoff: 写入 'midi.note{pitch}' = 0
        const id = noteSignalId(msg.value1)
        this.router.setSignal(id, 0, 'MIDI')
        break
      }
      case 'cc': {
        // cc: 写入 'midi.cc{ccNumber}' = value / 127
        const id = ccSignalId(msg.value1)
        this.router.setSignal(id, msg.value2 / 127, 'MIDI')
        break
      }
      case 'pitchbend': {
        // pitchbend: 14 位值,中心 8192
        const raw = (msg.value2 << 7) | msg.value1
        const normalized = (raw - 8192) / 8192 // -1 到 1
        this.router.setSignal(PITCHBEND_SIGNAL_ID, normalized, 'MIDI')
        break
      }
    }
  }

  /**
   * 销毁:清理所有监听器。
   */
  dispose(): void {
    for (const input of this.activeInputs) {
      input.onmidimessage = null
    }
    this.activeInputs = []
    if (this.access) {
      this.access.onstatechange = null
      this.access = null
    }
  }

  /** 获取已连接的输入设备列表 */
  getActiveInputs(): Array<{ id: string; name: string; manufacturer: string }> {
    return this.activeInputs.map((i) => ({
      id: i.id,
      name: i.name,
      manufacturer: i.manufacturer,
    }))
  }

  /** 是否已初始化 */
  get isInitialized(): boolean {
    return this.access !== null
  }

  // —— 浏览器 API 注入点 ——

  /**
   * 获取 requestMIDIAccess 函数(可被子类 / 测试覆盖)。
   */
  protected getRequestMidiAccess(): (() => Promise<MidiAccessLike>) | null {
    if (typeof navigator === 'undefined') return null
    const n = navigator as Navigator & { requestMIDIAccess?: () => Promise<MidiAccessLike> }
    if (typeof n.requestMIDIAccess !== 'function') return null
    return n.requestMIDIAccess.bind(n)
  }
}
