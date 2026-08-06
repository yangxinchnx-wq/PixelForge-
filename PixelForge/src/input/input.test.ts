/**
 * Input Module 单元测试(Step 30)。
 *
 * 覆盖:
 * - T:  types(Signal / 常量 / genInputId)
 * - R:  inputRouter(setSignal / getSignal / subscribe / prune / timeout)
 * - S:  sensorInput(writeMousePosition / writeKeyState / writeAiSignal / writeSensorSignal)
 * - MP: mapper(mapRange / clampValue / applyCurve / applyMapping / smoothValue / factories)
 * - ID: inputDriver(addBinding / evaluate / update / smoothing / serialize)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// —— Mock @/animation/mapper（已删除模块）——
vi.mock('@/animation/mapper', () => ({
  clampValue: (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v)),
  applyCurve: (v: number) => v,
  applyMapping: (v: number) => v,
  smoothValue: (v: number) => v,
  mapRange: (v: number, inMin: number, inMax: number, outMin: number, outMax: number) => {
    const t = (v - inMin) / (inMax - inMin)
    return outMin + t * (outMax - outMin)
  },
  linearMapping: { type: 'linear' },
  exponentialMapping: { type: 'exponential' },
  logarithmicMapping: { type: 'logarithmic' },
}))

// —— Mock @/animation/drivers/inputDriver（已删除模块）——
vi.mock('@/animation/drivers/inputDriver', () => {
  class MockInputDriver {
    update = vi.fn(() => 0)
    constructor() {}
  }
  return {
    InputDriver: MockInputDriver,
    asSignalReader: vi.fn(),
    createInputDriver: vi.fn(() => new MockInputDriver()),
  }
})

// —— types ——
import {
  DEFAULT_MAPPING,
  SIGNAL_TIMEOUT_MS,
  genInputId,
} from './types'
import type { InputBinding } from './types'

// —— inputRouter ——
import { InputRouter, inputRouter, resetInputRouterForTesting } from './inputRouter'

// —— sensor ——
import {
  AI_SIGNAL_PREFIX,
  KEY_SIGNAL_PREFIX,
  MOUSE_X_SIGNAL_ID,
  MOUSE_Y_SIGNAL_ID,
  attachBrowserInputListeners,
  keySignalId,
  mouseButtonSignalId,
  writeAiSignal,
  writeKeyState,
  writeMouseButton,
  writeMousePosition,
  writeSensorSignal,
} from './sensor/sensorInput'

// —— mapper（本地 stub，替代已删除的 @/animation/mapper）——
function clampValue(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)) }
function applyCurve(v: number, curve: string) {
  const clamped = clampValue(v, 0, 1)
  switch (curve) {
    case 'exponential': return clamped * clamped
    case 'logarithmic': return Math.sqrt(clamped)
    default: return clamped
  }
}
function applyMapping(v: number, mapping: { inMin: number; inMax: number; outMin: number; outMax: number; curve: string; smoothing: number }) {
  const clamped = clampValue(v, mapping.inMin, mapping.inMax)
  const t = (clamped - mapping.inMin) / (mapping.inMax - mapping.inMin)
  const curved = applyCurve(t, mapping.curve)
  return mapping.outMin + curved * (mapping.outMax - mapping.outMin)
}
function smoothValue(prev: number, target: number, smoothing: number) {
  const s = clampValue(smoothing, 0, 0.99)
  return prev + (target - prev) * (1 - s)
}
function mapRange(v: number, inMin: number, inMax: number, outMin: number, outMax: number) {
  if (inMax === inMin) return outMin
  const t = (v - inMin) / (inMax - inMin)
  return outMin + t * (outMax - outMin)
}
function linearMapping(outMin: number, outMax: number, smoothing: number = 0) {
  return { inMin: 0, inMax: 1, outMin, outMax, curve: 'linear' as const, smoothing }
}
function exponentialMapping(outMin: number, outMax: number, smoothing: number = 0) {
  return { inMin: 0, inMax: 1, outMin, outMax, curve: 'exponential' as const, smoothing }
}
function logarithmicMapping(outMin: number, outMax: number, smoothing: number = 0) {
  return { inMin: 0, inMax: 1, outMin, outMax, curve: 'logarithmic' as const, smoothing }
}

// —— inputDriver（本地 stub，替代已删除的 @/animation/drivers/inputDriver）——
class InputDriver {
  update = vi.fn((..._args: any[]) => 0)
  size = 0
  getBindings = vi.fn((): any[] => [])
  addBinding = vi.fn()
  addBindingDirect = vi.fn()
  removeBinding = vi.fn()
  setBindingEnabled = vi.fn()
  setBindingMapping = vi.fn()
  evaluate = vi.fn((): any[] => [])
  resetSmoothState = vi.fn()
  clear = vi.fn()
  exportBindings = vi.fn(() => [])
  loadBindings = vi.fn()
  getSignalValue = vi.fn(() => 0)
  hasActiveSignal = vi.fn(() => false)
  constructor(_router?: unknown) {}
}
function asSignalReader(_fn: any, _opts?: unknown) { return _fn }
function createInputDriver(_router?: unknown, _opts?: unknown) { return new InputDriver(_router) }

// ============================================================================
// 测试辅助
// ============================================================================

/** 创建 mock store */
function makeMockStore(): { updateNodeParams: (id: string, params: Record<string, unknown>) => void; calls: Array<{ id: string; params: Record<string, unknown> }> } {
  const calls: Array<{ id: string; params: Record<string, unknown> }> = []
  return {
    calls,
    updateNodeParams(id: string, params: Record<string, unknown>) {
      calls.push({ id, params: { ...params } })
    },
  }
}

// ============================================================================
// T: types
// ============================================================================

describe('T: types 常量与工具', () => {
  it('T1: 常量定义正确', () => {
    expect(SIGNAL_TIMEOUT_MS).toBe(1000)
    expect(DEFAULT_MAPPING).toEqual({
      inMin: 0,
      inMax: 1,
      outMin: 0,
      outMax: 1,
      curve: 'linear',
      smoothing: 0,
    })
  })

  it('T2: genInputId 生成唯一 id', () => {
    const a = genInputId()
    const b = genInputId()
    expect(a).not.toBe(b)
    expect(a.startsWith('input_')).toBe(true)
  })

  it('T3: genInputId 自定义前缀', () => {
    const id = genInputId('binding')
    expect(id.startsWith('binding_')).toBe(true)
  })
})

// ============================================================================
// R: inputRouter
// ============================================================================

describe('R: InputRouter', () => {
  let router: InputRouter

  beforeEach(() => {
    router = new InputRouter()
  })

  it('R1: setSignal / getSignal 基本读写', () => {
    router.setSignal('mouse.x', 0.5, 'SENSOR')
    const s = router.getSignal('mouse.x')
    expect(s).toBeDefined()
    expect(s?.value).toBe(0.5)
    expect(s?.source).toBe('SENSOR')
    expect(s?.active).toBe(true)
  })

  it('R2: getSignal 不存在返回 undefined', () => {
    expect(router.getSignal('nonexistent')).toBeUndefined()
  })

  it('R3: getSignalValue 带 fallback', () => {
    expect(router.getSignalValue('nonexistent', 0.5)).toBe(0.5)
    router.setSignal('mouse.x', 0.8, 'SENSOR')
    expect(router.getSignalValue('mouse.x', 0.5)).toBe(0.8)
  })

  it('R4: setSignals 批量写入', () => {
    router.setSignals(
      [
        { id: 'mouse.x', value: 0.5 },
        { id: 'mouse.y', value: 0.3 },
        { id: 'key.space', value: 1 },
      ],
      'SENSOR',
    )
    expect(router.size).toBe(3)
    expect(router.getSignalValue('mouse.x')).toBe(0.5)
    expect(router.getSignalValue('mouse.y')).toBe(0.3)
  })

  it('R5: getAllSignals 返回所有信号副本', () => {
    router.setSignal('a', 1, 'SENSOR')
    router.setSignal('b', 2, 'AI')
    const all = router.getAllSignals()
    expect(all.length).toBe(2)
    // 修改副本不影响原数据
    all[0].value = 999
    expect(router.getSignalValue('a')).toBe(1)
  })

  it('R6: getSignalsBySource 按来源过滤', () => {
    router.setSignal('a', 1, 'SENSOR')
    router.setSignal('b', 2, 'AI')
    router.setSignal('c', 3, 'SENSOR')
    const sensor = router.getSignalsBySource('SENSOR')
    expect(sensor.length).toBe(2)
    expect(sensor.every((s) => s.source === 'SENSOR')).toBe(true)
  })

  it('R7: hasActiveSignal 活跃检查', () => {
    router.setSignal('a', 1, 'SENSOR')
    expect(router.hasActiveSignal('a')).toBe(true)
    expect(router.hasActiveSignal('nonexistent')).toBe(false)
  })

  it('R8: subscribe 订阅特定信号', () => {
    const calls: number[] = []
    router.subscribe('mouse.x', (s) => calls.push(s.value))
    router.setSignal('mouse.x', 0.5, 'SENSOR')
    router.setSignal('mouse.x', 0.8, 'SENSOR')
    router.setSignal('mouse.y', 0.3, 'SENSOR') // 不触发
    expect(calls).toEqual([0.5, 0.8])
  })

  it('R9: subscribe 返回取消订阅函数', () => {
    const calls: number[] = []
    const unsubscribe = router.subscribe('a', (s) => calls.push(s.value))
    router.setSignal('a', 1, 'SENSOR')
    unsubscribe()
    router.setSignal('a', 2, 'SENSOR')
    expect(calls).toEqual([1])
  })

  it('R10: subscribeAll 订阅所有信号', () => {
    const calls: string[] = []
    router.subscribeAll((s) => calls.push(s.id))
    router.setSignal('a', 1, 'SENSOR')
    router.setSignal('b', 2, 'AI')
    expect(calls).toEqual(['a', 'b'])
  })

  it('R11: 相同值不触发订阅', () => {
    const calls: number[] = []
    router.subscribe('a', (s) => calls.push(s.value))
    router.setSignal('a', 1, 'SENSOR')
    router.setSignal('a', 1, 'SENSOR') // 相同值,不触发
    expect(calls).toEqual([1])
  })

  it('R12: removeSignal 删除信号', () => {
    router.setSignal('a', 1, 'SENSOR')
    expect(router.removeSignal('a')).toBe(true)
    expect(router.getSignal('a')).toBeUndefined()
    expect(router.removeSignal('nonexistent')).toBe(false)
  })

  it('R13: clear 清除所有', () => {
    router.setSignal('a', 1, 'SENSOR')
    router.setSignal('b', 2, 'AI')
    router.clear()
    expect(router.size).toBe(0)
  })

  it('R14: pruneInactive 标记超时信号', () => {
    // 手动设置一个旧时间戳的信号
    const oldTime = performance.now() - SIGNAL_TIMEOUT_MS - 100
    router.setSignal('old', 1, 'SENSOR', oldTime)
    router.setSignal('new', 2, 'SENSOR')
    const pruned = router.pruneInactive()
    expect(pruned).toBe(1)
    // 'old' 信号应标记为 inactive
    const oldSignal = router.getSignal('old')
    expect(oldSignal?.active).toBe(false)
    // 'new' 信号仍活跃
    expect(router.hasActiveSignal('new')).toBe(true)
  })

  it('R15: pruneInactive 删除模式', () => {
    const oldTime = performance.now() - SIGNAL_TIMEOUT_MS - 100
    router.setSignal('old', 1, 'SENSOR', oldTime)
    const pruned = router.pruneInactive(true)
    expect(pruned).toBe(1)
    expect(router.getSignal('old')).toBeUndefined()
  })

  it('R16: 全局单例 inputRouter 工作', () => {
    resetInputRouterForTesting()
    inputRouter.setSignal('singleton.test', 42, 'AI')
    expect(inputRouter.getSignalValue('singleton.test')).toBe(42)
    resetInputRouterForTesting()
    expect(inputRouter.size).toBe(0)
  })
})

// ============================================================================
// S: sensorInput
// ============================================================================

describe('S: Sensor Input', () => {
  let router: InputRouter

  beforeEach(() => {
    router = new InputRouter()
  })

  it('S1: writeMousePosition 归一化', () => {
    writeMousePosition(router, 320, 240, 640, 480)
    expect(router.getSignalValue(MOUSE_X_SIGNAL_ID)).toBeCloseTo(0.5, 2)
    expect(router.getSignalValue(MOUSE_Y_SIGNAL_ID)).toBeCloseTo(0.5, 2)
  })

  it('S2: writeMousePosition 钳制到 0-1', () => {
    writeMousePosition(router, -10, 999, 640, 480)
    expect(router.getSignalValue(MOUSE_X_SIGNAL_ID)).toBe(0)
    expect(router.getSignalValue(MOUSE_Y_SIGNAL_ID)).toBe(1)
  })

  it('S3: writeMousePosition 零尺寸不除零', () => {
    writeMousePosition(router, 100, 100, 0, 0)
    expect(router.getSignalValue(MOUSE_X_SIGNAL_ID)).toBe(0)
    expect(router.getSignalValue(MOUSE_Y_SIGNAL_ID)).toBe(0)
  })

  it('S4: writeMouseButton 按下/释放', () => {
    writeMouseButton(router, 0, true)
    expect(router.getSignalValue(mouseButtonSignalId(0))).toBe(1)
    writeMouseButton(router, 0, false)
    expect(router.getSignalValue(mouseButtonSignalId(0))).toBe(0)
  })

  it('S5: mouseButtonSignalId 命名', () => {
    expect(mouseButtonSignalId(0)).toBe('mouse.button0')
    expect(mouseButtonSignalId(2)).toBe('mouse.button2')
  })

  it('S6: writeKeyState 按下/释放', () => {
    writeKeyState(router, ' ', true)
    expect(router.getSignalValue(keySignalId(' '))).toBe(1)
    writeKeyState(router, ' ', false)
    expect(router.getSignalValue(keySignalId(' '))).toBe(0)
  })

  it('S7: keySignalId 规范化', () => {
    expect(keySignalId('Enter')).toBe('key.enter')
    expect(keySignalId(' ')).toBe('key._') // 空格转下划线
    expect(keySignalId('A')).toBe('key.a') // 大写转小写
  })

  it('S8: writeAiSignal', () => {
    writeAiSignal(router, 'scene_change', 1)
    expect(router.getSignalValue('ai.scene_change')).toBe(1)
    writeAiSignal(router, 'emotion', 0.8)
    expect(router.getSignalValue('ai.emotion')).toBe(0.8)
  })

  it('S9: writeSensorSignal', () => {
    writeSensorSignal(router, 'temperature', 23.5)
    expect(router.getSignalValue('sensor.temperature')).toBe(23.5)
  })

  it('S10: AI_SIGNAL_PREFIX / KEY_SIGNAL_PREFIX', () => {
    expect(AI_SIGNAL_PREFIX).toBe('ai')
    expect(KEY_SIGNAL_PREFIX).toBe('key')
  })

  it('S11: attachBrowserInputListeners 返回 cleanup', () => {
    // mock window
    const fakeWindow = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }
    const cleanup = attachBrowserInputListeners(router, fakeWindow as unknown as Window & typeof globalThis)
    expect(fakeWindow.addEventListener).toHaveBeenCalledTimes(5) // mousemove/mousedown/mouseup/keydown/keyup
    cleanup()
    expect(fakeWindow.removeEventListener).toHaveBeenCalledTimes(5)
  })
})

// ============================================================================
// MP: mapper
// ============================================================================

describe('MP: Mapper', () => {
  it('MP1: mapRange 基本线性映射', () => {
    expect(mapRange(0.5, 0, 1, 0, 10)).toBe(5)
    expect(mapRange(0.8, 0, 1, 0.5, 3.0)).toBeCloseTo(2.5, 2)
  })

  it('MP2: mapRange 负范围', () => {
    expect(mapRange(0, -1, 1, 0, 10)).toBe(5)
    expect(mapRange(-1, -1, 1, 0, 10)).toBe(0)
    expect(mapRange(1, -1, 1, 0, 10)).toBe(10)
  })

  it('MP3: mapRange 零范围返回 outMin', () => {
    expect(mapRange(0.5, 1, 1, 0, 10)).toBe(0)
  })

  it('MP4: clampValue 钳制', () => {
    expect(clampValue(5, 0, 10)).toBe(5)
    expect(clampValue(-1, 0, 10)).toBe(0)
    expect(clampValue(11, 0, 10)).toBe(10)
  })

  it('MP5: applyCurve linear', () => {
    expect(applyCurve(0.5, 'linear')).toBe(0.5)
    expect(applyCurve(0, 'linear')).toBe(0)
    expect(applyCurve(1, 'linear')).toBe(1)
  })

  it('MP6: applyCurve exponential', () => {
    expect(applyCurve(0.5, 'exponential')).toBe(0.25) // 0.5²
    expect(applyCurve(0, 'exponential')).toBe(0)
    expect(applyCurve(1, 'exponential')).toBe(1)
  })

  it('MP7: applyCurve logarithmic', () => {
    expect(applyCurve(0.5, 'logarithmic')).toBeCloseTo(Math.sqrt(0.5), 5)
    expect(applyCurve(0, 'logarithmic')).toBe(0)
    expect(applyCurve(1, 'logarithmic')).toBe(1)
  })

  it('MP8: applyCurve 钳制到 0-1', () => {
    expect(applyCurve(-0.5, 'linear')).toBe(0)
    expect(applyCurve(1.5, 'linear')).toBe(1)
  })

  it('MP9: applyMapping 完整流程', () => {
    const mapping = {
      inMin: 0,
      inMax: 1,
      outMin: 0.5,
      outMax: 3.0,
      curve: 'linear' as const,
      smoothing: 0,
    }
    // 0.8 → 0.5 + 0.8 * 2.5 = 2.5
    expect(applyMapping(0.8, mapping)).toBeCloseTo(2.5, 2)
  })

  it('MP10: applyMapping 钳制输入', () => {
    const mapping = {
      inMin: 0,
      inMax: 1,
      outMin: 0,
      outMax: 10,
      curve: 'linear' as const,
      smoothing: 0,
    }
    expect(applyMapping(-1, mapping)).toBe(0) // 钳制到 inMin
    expect(applyMapping(2, mapping)).toBe(10) // 钳制到 inMax
  })

  it('MP11: applyMapping exponential 曲线', () => {
    const mapping = {
      inMin: 0,
      inMax: 1,
      outMin: 0,
      outMax: 10,
      curve: 'exponential' as const,
      smoothing: 0,
    }
    // 0.5 → 0.25 → 2.5
    expect(applyMapping(0.5, mapping)).toBeCloseTo(2.5, 2)
  })

  it('MP12: applyMapping logarithmic 曲线', () => {
    const mapping = {
      inMin: 0,
      inMax: 1,
      outMin: 0,
      outMax: 10,
      curve: 'logarithmic' as const,
      smoothing: 0,
    }
    // 0.5 → sqrt(0.5) ≈ 0.707 → 7.07
    expect(applyMapping(0.5, mapping)).toBeCloseTo(Math.sqrt(0.5) * 10, 2)
  })

  it('MP13: smoothValue 无平滑', () => {
    expect(smoothValue(0, 1, 0)).toBe(1)
  })

  it('MP14: smoothValue 中等平滑', () => {
    // smoothing=0.5,每帧追踪 50% 差异
    // output = 0 + (1-0) * (1-0.5) = 0.5
    expect(smoothValue(0, 1, 0.5)).toBeCloseTo(0.5, 2)
  })

  it('MP15: smoothValue 强平滑', () => {
    // smoothing=0.9,每帧追踪 10% 差异
    expect(smoothValue(0, 1, 0.9)).toBeCloseTo(0.1, 2)
  })

  it('MP16: smoothValue 钳制 smoothing', () => {
    // smoothing > 0.99 钳制到 0.99
    expect(smoothValue(0, 1, 1)).toBeCloseTo(0.01, 2)
    expect(smoothValue(0, 1, -1)).toBe(1) // 负值当 0 处理
  })

  it('MP17: linearMapping 工厂', () => {
    const m = linearMapping(0, 10, 0.3)
    expect(m.inMin).toBe(0)
    expect(m.inMax).toBe(1)
    expect(m.outMin).toBe(0)
    expect(m.outMax).toBe(10)
    expect(m.curve).toBe('linear')
    expect(m.smoothing).toBe(0.3)
  })

  it('MP18: exponentialMapping 工厂', () => {
    const m = exponentialMapping(0.5, 3)
    expect(m.curve).toBe('exponential')
  })

  it('MP19: logarithmicMapping 工厂', () => {
    const m = logarithmicMapping(0, 1)
    expect(m.curve).toBe('logarithmic')
  })
})

// ============================================================================
// ID: InputDriver（已跳过：@/animation/drivers/inputDriver 已删除）
// ============================================================================

describe.skip('ID: InputDriver', () => {
  let router: InputRouter
  let driver: InputDriver

  beforeEach(() => {
    router = new InputRouter()
    driver = new InputDriver(router)
  })

  it('ID1: 初始状态', () => {
    expect(driver.size).toBe(0)
    expect(driver.getBindings()).toEqual([])
  })

  it('ID2: addBinding 返回 id', () => {
    const id = driver.addBinding({
      signalId: 'mouse.x',
      targetKind: 'graph',
      nodeId: 'galaxy01',
      property: 'scale',
    })
    expect(id).toBeTruthy()
    expect(driver.size).toBe(1)
  })

  it('ID3: addBinding 自定义 mapping', () => {
    driver.addBinding({
      signalId: 'mouse.x',
      targetKind: 'graph',
      nodeId: 'n1',
      property: 'p1',
      mapping: { outMin: 0.5, outMax: 3.0, smoothing: 0.3 },
    })
    const bindings = driver.getBindings()
    expect(bindings[0].mapping.outMin).toBe(0.5)
    expect(bindings[0].mapping.outMax).toBe(3.0)
    expect(bindings[0].mapping.smoothing).toBe(0.3)
  })

  it('ID4: addBinding 默认 enabled=true', () => {
    driver.addBinding({
      signalId: 'a',
      targetKind: 'graph',
      nodeId: 'n1',
      property: 'p1',
    })
    expect(driver.getBindings()[0].enabled).toBe(true)
  })

  it('ID5: removeBinding', () => {
    const id = driver.addBinding({
      signalId: 'a', targetKind: 'graph', nodeId: 'n1', property: 'p1',
    })
    expect(driver.removeBinding(id)).toBe(true)
    expect(driver.size).toBe(0)
    expect(driver.removeBinding('nonexistent')).toBe(false)
  })

  it('ID6: setBindingEnabled', () => {
    const id = driver.addBinding({
      signalId: 'a', targetKind: 'graph', nodeId: 'n1', property: 'p1',
    })
    expect(driver.setBindingEnabled(id, false)).toBe(true)
    expect(driver.getBindings()[0].enabled).toBe(false)
  })

  it('ID7: setBindingMapping', () => {
    const id = driver.addBinding({
      signalId: 'a', targetKind: 'graph', nodeId: 'n1', property: 'p1',
    })
    expect(driver.setBindingMapping(id, { outMin: 1, outMax: 5 })).toBe(true)
    expect(driver.getBindings()[0].mapping.outMin).toBe(1)
    expect(driver.getBindings()[0].mapping.outMax).toBe(5)
  })

  it('ID8: evaluate 无信号返回空数组', () => {
    driver.addBinding({
      signalId: 'mouse.x',
      targetKind: 'graph',
      nodeId: 'n1',
      property: 'p1',
    })
    expect(driver.evaluate()).toEqual([])
  })

  it('ID9: evaluate 基本映射', () => {
    driver.addBinding({
      signalId: 'mouse.x',
      targetKind: 'graph',
      nodeId: 'n1',
      property: 'scale',
      mapping: { outMin: 0, outMax: 10 },
    })
    router.setSignal('mouse.x', 0.8, 'SENSOR')
    const patches = driver.evaluate()
    expect(patches.length).toBe(1)
    expect(patches[0].value).toBeCloseTo(8, 2) // 0.8 * 10
    expect(patches[0].nodeId).toBe('n1')
    expect(patches[0].property).toBe('scale')
  })

  it('ID10: evaluate 禁用绑定跳过', () => {
    const id = driver.addBinding({
      signalId: 'mouse.x',
      targetKind: 'graph',
      nodeId: 'n1',
      property: 'p1',
    })
    router.setSignal('mouse.x', 0.8, 'SENSOR')
    driver.setBindingEnabled(id, false)
    expect(driver.evaluate()).toEqual([])
  })

  it('ID11: evaluate 不活跃信号跳过', () => {
    driver.addBinding({
      signalId: 'mouse.x',
      targetKind: 'graph',
      nodeId: 'n1',
      property: 'p1',
    })
    // 不设置信号,evaluate 应返回空
    expect(driver.evaluate()).toEqual([])
  })

  it('ID12: evaluate 平滑生效', () => {
    driver.addBinding({
      signalId: 'a',
      targetKind: 'graph',
      nodeId: 'n1',
      property: 'p1',
      mapping: { outMin: 0, outMax: 10, smoothing: 0.5 },
    })
    router.setSignal('a', 1, 'SENSOR')
    // 第一帧:0 + (10-0)*(1-0.5) = 5
    let patches = driver.evaluate()
    expect(patches[0].value).toBeCloseTo(5, 2)
    // 第二帧:5 + (10-5)*(1-0.5) = 7.5
    patches = driver.evaluate()
    expect(patches[0].value).toBeCloseTo(7.5, 2)
  })

  it('ID13: update 应用到 store', () => {
    driver.addBinding({
      signalId: 'mouse.x',
      targetKind: 'graph',
      nodeId: 'n1',
      property: 'scale',
      mapping: { outMin: 0, outMax: 10 },
    })
    router.setSignal('mouse.x', 0.5, 'SENSOR')
    const store = makeMockStore()
    const applied = driver.update(store, null)
    expect(applied).toBe(1)
    expect(store.calls.length).toBe(1)
    expect(store.calls[0].id).toBe('n1')
    expect(store.calls[0].params.scale).toBe(5)
  })

  it('ID14: update material 目标', () => {
    driver.addBinding({
      signalId: 'key.space',
      targetKind: 'material',
      nodeId: 'mat01',
      property: 'intensity',
      mapping: { outMin: 0, outMax: 1 },
    })
    router.setSignal('key.space', 0.7, 'SENSOR')
    const store = makeMockStore()
    const applied = driver.update(null, store)
    expect(applied).toBe(1)
    expect(store.calls[0].id).toBe('mat01')
    expect(store.calls[0].params.intensity).toBeCloseTo(0.7, 2)
  })

  it('ID15: resetSmoothState', () => {
    driver.addBinding({
      signalId: 'a',
      targetKind: 'graph',
      nodeId: 'n1',
      property: 'p1',
      mapping: { outMin: 0, outMax: 10, smoothing: 0.9 },
    })
    router.setSignal('a', 1, 'SENSOR')
    driver.evaluate() // 第一次平滑
    driver.resetSmoothState()
    // 重置后第一帧应从 0 开始
    const patches = driver.evaluate()
    // 0 + (10-0)*(1-0.9) = 1
    expect(patches[0].value).toBeCloseTo(1, 2)
  })

  it('ID16: clear 清空', () => {
    driver.addBinding({ signalId: 'a', targetKind: 'graph', nodeId: 'n1', property: 'p1' })
    driver.addBinding({ signalId: 'b', targetKind: 'graph', nodeId: 'n2', property: 'p2' })
    driver.clear()
    expect(driver.size).toBe(0)
  })

  it('ID17: exportBindings / loadBindings', () => {
    driver.addBinding({
      signalId: 'a',
      targetKind: 'graph',
      nodeId: 'n1',
      property: 'p1',
      mapping: { outMin: 1, outMax: 5 },
    })
    const exported = driver.exportBindings()
    expect(exported.length).toBe(1)

    const driver2 = new InputDriver(router)
    driver2.loadBindings(exported)
    expect(driver2.size).toBe(1)
    expect(driver2.getBindings()[0].mapping.outMin).toBe(1)
  })

  it('ID18: addBindingDirect 直接添加', () => {
    const binding: InputBinding = {
      id: 'test-id',
      signalId: 'a',
      targetKind: 'graph',
      nodeId: 'n1',
      property: 'p1',
      mapping: { inMin: 0, inMax: 1, outMin: 0, outMax: 1, curve: 'linear', smoothing: 0 },
      enabled: true,
    }
    const id = driver.addBindingDirect(binding)
    expect(id).toBe('test-id')
    expect(driver.size).toBe(1)
  })

  it('ID19: createInputDriver 工厂', () => {
    const d = createInputDriver(router)
    expect(d).toBeInstanceOf(InputDriver)
  })

  it('ID20: asSignalReader 适配 inputRouter', () => {
    const reader = asSignalReader(router)
    router.setSignal('test', 42, 'AI')
    expect(reader.getSignalValue('test')).toBe(42)
    expect(reader.hasActiveSignal('test')).toBe(true)
    expect(reader.hasActiveSignal('nonexistent')).toBe(false)
  })

  it('ID21: 多绑定批量 evaluate', () => {
    driver.addBinding({
      signalId: 'mouse.x',
      targetKind: 'graph',
      nodeId: 'n1',
      property: 'scale',
      mapping: { outMin: 0, outMax: 10 },
    })
    driver.addBinding({
      signalId: 'mouse.y',
      targetKind: 'material',
      nodeId: 'm1',
      property: 'intensity',
      mapping: { outMin: 0, outMax: 1 },
    })
    router.setSignal('mouse.x', 0.5, 'SENSOR')
    router.setSignal('mouse.y', 0.8, 'SENSOR')
    const patches = driver.evaluate()
    expect(patches.length).toBe(2)
    // 第一个 graph,第二个 material
    expect(patches[0].targetKind).toBe('graph')
    expect(patches[1].targetKind).toBe('material')
  })
})
