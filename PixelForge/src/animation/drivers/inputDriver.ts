/**
 * Input Driver(Step 30.11-12)— 输入驱动动画。
 *
 * 职责:
 * - 管理 InputBinding[](Signal → Node 参数 的绑定列表)
 * - 每帧 update():从 InputRouter 读取信号 → applyMapping → 生成 ParamPatch[]
 * - 应用 ParamPatch 到 graphStore / materialStore
 *
 * 与 animation/binding.ts 的区别:
 * - binding.ts:   处理 Timeline 动画的 ParamPatch(基于关键帧求值)
 * - inputDriver(本模块): 处理实时输入的 ParamPatch(基于 Signal 当前值)
 *
 * 数据流(Step 30 完整):
 *   Input Source(audio / midi / camera / sensor)
 *     ↓ InputRouter.setSignal
 *   Signal(实时值)
 *     ↓ inputDriver.update()
 *   applyMapping(signal, binding.mapping) → 输出值
 *     ↓ ParamPatch
 *   applyAnimations(patches, graphStore, materialStore)
 *     ↓ store.updateNodeParams
 *   GraphNode / MaterialNode
 *     ↓ compiler / runtime
 *   GPU
 */

import type { InputBinding, InputTargetKind } from '@/input/types'
import { genInputId } from '@/input/types'
import type { inputRouter } from '@/input/inputRouter'
import { applyMapping, smoothValue } from '../mapper'
import { applyAnimations, type ParamUpdatableStore, type RuntimePatchableStore } from '../binding'
import type { ParamPatch } from '../types'

// ============================================================================
// 1. 类型
// ============================================================================

/**
 * InputRouter 最小接口(避免循环依赖)。
 *
 * 与 inputRouter.ts 的 InputRouter 类兼容(结构化类型)。
 */
export interface SignalReader {
  getSignalValue: (id: string, fallback?: number) => number
  hasActiveSignal: (id: string) => boolean
}

/**
 * 创建绑定时的输入参数。
 */
export interface CreateBindingOptions {
  signalId: string
  targetKind: InputTargetKind
  nodeId: string
  property: string
  mapping?: Partial<import('@/input/types').ControlMapping>
  enabled?: boolean
}

// ============================================================================
// 2. InputDriver 类
// ============================================================================

/**
 * 输入驱动器。
 *
 * 用法:
 *   const driver = new InputDriver(inputRouter)
 *   driver.addBinding({
 *     signalId: 'audio.bass',
 *     targetKind: 'graph',
 *     nodeId: 'galaxy01',
 *     property: 'scale',
 *     mapping: { outMin: 0.5, outMax: 3.0, smoothing: 0.3 }
 *   })
 *   // 每帧:
 *   driver.update(graphStore, materialStore)
 */
export class InputDriver {
  private router: SignalReader
  private bindings: InputBinding[] = []
  /** 平滑状态(每个绑定的上一次输出值) */
  private smoothState: Map<string, number> = new Map()

  constructor(router: SignalReader) {
    this.router = router
  }

  // —— 绑定管理 ——

  /**
   * 添加绑定。
   *
   * @returns 绑定 id
   */
  addBinding(options: CreateBindingOptions): string {
    const id = genInputId('binding')
    const binding: InputBinding = {
      id,
      signalId: options.signalId,
      targetKind: options.targetKind,
      nodeId: options.nodeId,
      property: options.property,
      mapping: {
        inMin: 0,
        inMax: 1,
        outMin: 0,
        outMax: 1,
        curve: 'linear',
        smoothing: 0,
        ...options.mapping,
      },
      enabled: options.enabled ?? true,
    }
    this.bindings.push(binding)
    return id
  }

  /**
   * 直接添加完整绑定(用于序列化加载)。
   */
  addBindingDirect(binding: InputBinding): string {
    this.bindings.push({ ...binding })
    return binding.id
  }

  /** 删除绑定 */
  removeBinding(id: string): boolean {
    const idx = this.bindings.findIndex((b) => b.id === id)
    if (idx < 0) return false
    this.bindings.splice(idx, 1)
    this.smoothState.delete(id)
    return true
  }

  /** 启用/禁用绑定 */
  setBindingEnabled(id: string, enabled: boolean): boolean {
    const b = this.bindings.find((b) => b.id === id)
    if (!b) return false
    b.enabled = enabled
    return true
  }

  /** 更新绑定的 mapping */
  setBindingMapping(
    id: string,
    mapping: Partial<import('@/input/types').ControlMapping>,
  ): boolean {
    const b = this.bindings.find((b) => b.id === id)
    if (!b) return false
    b.mapping = { ...b.mapping, ...mapping }
    return true
  }

  /** 获取所有绑定 */
  getBindings(): InputBinding[] {
    return this.bindings.map((b) => ({ ...b }))
  }

  /** 获取绑定数量 */
  get size(): number {
    return this.bindings.length
  }

  /** 清空所有绑定 */
  clear(): void {
    this.bindings = []
    this.smoothState.clear()
  }

  // —— 每帧更新 ——

  /**
   * 每帧更新:读取所有信号 → 应用 mapping → 生成 ParamPatch[]。
   *
   * @returns ParamPatch[](可由 applyAnimations 应用到 stores)
   */
  evaluate(): ParamPatch[] {
    const patches: ParamPatch[] = []
    for (const binding of this.bindings) {
      if (!binding.enabled) continue

      // 信号不存在或未活跃时,跳过(不输出 0,避免覆盖其他动画源)
      if (!this.router.hasActiveSignal(binding.signalId)) continue

      const signalValue = this.router.getSignalValue(binding.signalId, 0)

      // 应用 mapping(曲线 + 范围)
      let output = applyMapping(signalValue, binding.mapping)

      // 应用平滑
      // 初始状态用 0(让绑定启用时从 0 平滑过渡到目标值,避免跳变)
      if (binding.mapping.smoothing > 0) {
        const prev = this.smoothState.get(binding.id) ?? 0
        output = smoothValue(prev, output, binding.mapping.smoothing)
        this.smoothState.set(binding.id, output)
      } else {
        this.smoothState.set(binding.id, output)
      }

      patches.push({
        targetKind: binding.targetKind,
        nodeId: binding.nodeId,
        property: binding.property,
        value: output,
      })
    }
    return patches
  }

  /**
   * 每帧更新:evaluate + applyAnimations(便捷方法)。
   *
   * @param graphStore    RenderGraph store(用于 'graph' 目标)
   * @param materialStore MaterialGraph store(用于 'material' 目标)
   * @param runtimeStore  可选 Runtime store(用于 'runtime' 目标,直接驱动 RenderIR 触发渲染)
   * @returns 应用了多少个 patch
   */
  update(
    graphStore: ParamUpdatableStore | null,
    materialStore: ParamUpdatableStore | null,
    runtimeStore: RuntimePatchableStore | null = null,
  ): number {
    const patches = this.evaluate()
    return applyAnimations(patches, graphStore, materialStore, runtimeStore)
  }

  /**
   * 重置平滑状态(切换场景时调用)。
   */
  resetSmoothState(): void {
    this.smoothState.clear()
  }

  // —— 序列化 ——

  /**
   * 导出所有绑定(用于持久化)。
   */
  exportBindings(): InputBinding[] {
    return this.bindings.map((b) => ({
      ...b,
      mapping: { ...b.mapping },
    }))
  }

  /**
   * 导入绑定(替换现有)。
   */
  loadBindings(bindings: InputBinding[]): void {
    this.bindings = bindings.map((b) => ({ ...b, mapping: { ...b.mapping } }))
    this.smoothState.clear()
  }
}

// ============================================================================
// 3. 全局单例(与 inputRouter 配合)
// ============================================================================

/**
 * 创建一个绑定到全局 inputRouter 的 InputDriver 单例。
 *
 * 用法:
 *   import { createInputDriver } from '@/animation/drivers/inputDriver'
 *   const driver = createInputDriver()
 *   driver.addBinding({ ... })
 *
 * 注意:返回的是新实例(不是全局单例),由调用方决定生命周期。
 * 通常在应用初始化时创建一个,组件销毁时 dispose。
 */
export function createInputDriver(routerInstance: SignalReader): InputDriver {
  return new InputDriver(routerInstance)
}

/**
 * 类型断言:InputRouter 实例兼容 SignalReader。
 *
 * 用于确保 inputRouter 单例可以直接传给 InputDriver。
 */
export function asSignalReader(router: typeof inputRouter): SignalReader {
  return {
    getSignalValue: (id, fallback) => router.getSignalValue(id, fallback),
    hasActiveSignal: (id) => router.hasActiveSignal(id),
  }
}
