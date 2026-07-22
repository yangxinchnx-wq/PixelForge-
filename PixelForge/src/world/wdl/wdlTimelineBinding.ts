/**
 * PixelForge - WDL ↔ ProTimeline 绑定(Step 38.6)
 *
 * 职责:
 * - 绑定注册表:Clip 属性 ↔ WDL/RenderIR 参数的映射(不修改 Clip 接口和 WDL 语法)
 * - 绑定 CRUD:addBinding / removeBinding / getBindingsForClip / getBindingsForLayer
 * - 属性提取:从 Clip 提取可绑定的属性值(label/speed/volume/transform.x 等)
 * - 播放桥:watch activeClips → 查绑定 → applyValuePatch(ProTimeline 专用)
 *
 * 设计原则:
 * - 不修改 Clip 接口(避免破坏现有 2791 测试)
 * - 不修改 WDL 语法(WDL 仍是静态 DSL)
 * - 绑定关系存在独立 store(符合 RenderIR 静态边界约束)
 * - Clip 固定字段(label/speed/volume/transform.*)直接映射到 Layer.params 的 key
 */
import type { Clip } from '@/editor/timeline/core/clip'

// ============================================================================
// 1. 类型定义
// ============================================================================

/** 可绑定的 Clip 属性名 */
export type ClipBindableProperty =
  | 'speed'
  | 'volume'
  | 'transform.x'
  | 'transform.y'
  | 'transform.scale'
  | 'transform.rotation'
  | 'transform.opacity'

/** 绑定关系:Clip 属性 → Layer 参数 */
export interface ClipWdlBinding {
  /** 绑定唯一 ID */
  id: string
  /** Clip ID */
  clipId: string
  /** Clip 属性名 */
  clipProperty: ClipBindableProperty
  /** 目标 Layer ID(RenderIR.layers[*].id) */
  layerId: string
  /** 目标参数名(Layer.params 的 key) */
  paramKey: string
  /** 值缩放因子(可选,Clip 属性值 × scale → paramValue) */
  scale?: number
  /** 值偏移(可选,(clipValue × scale) + offset → paramValue) */
  offset?: number
}

/** 绑定注册表(纯数据结构,便于测试) */
export interface BindingRegistry {
  bindings: ClipWdlBinding[]
}

// ============================================================================
// 2. 绑定 CRUD(纯函数,便于测试)
// ============================================================================

/** 生成绑定 ID */
function makeBindingId(clipId: string, clipProperty: string): string {
  return `${clipId}.${clipProperty}`
}

/**
 * 创建绑定注册表。
 */
export function createBindingRegistry(): BindingRegistry {
  return { bindings: [] }
}

/**
 * 添加绑定(幂等:同 clipId + clipProperty 只保留一条,后添加的覆盖)。
 *
 * @param registry 注册表
 * @param binding 绑定(不含 id,自动生成)
 * @returns 生成的绑定 ID
 */
export function addBinding(
  registry: BindingRegistry,
  binding: Omit<ClipWdlBinding, 'id'>,
): string {
  const id = makeBindingId(binding.clipId, binding.clipProperty)
  // 移除同 clipId + clipProperty 的旧绑定
  registry.bindings = registry.bindings.filter(
    (b) => !(b.clipId === binding.clipId && b.clipProperty === binding.clipProperty),
  )
  registry.bindings.push({ ...binding, id })
  return id
}

/**
 * 移除绑定。
 *
 * @param registry 注册表
 * @param bindingId 绑定 ID
 */
export function removeBinding(registry: BindingRegistry, bindingId: string): void {
  registry.bindings = registry.bindings.filter((b) => b.id !== bindingId)
}

/**
 * 按 Clip ID 查询所有绑定。
 */
export function getBindingsForClip(
  registry: BindingRegistry,
  clipId: string,
): ClipWdlBinding[] {
  return registry.bindings.filter((b) => b.clipId === clipId)
}

/**
 * 按 Layer ID 查询所有绑定。
 */
export function getBindingsForLayer(
  registry: BindingRegistry,
  layerId: string,
): ClipWdlBinding[] {
  return registry.bindings.filter((b) => b.layerId === layerId)
}

/**
 * 获取所有绑定。
 */
export function getAllBindings(registry: BindingRegistry): ClipWdlBinding[] {
  return [...registry.bindings]
}

/**
 * 清空注册表。
 */
export function clearBindings(registry: BindingRegistry): void {
  registry.bindings = []
}

// ============================================================================
// 3. 属性提取(从 Clip 提取可绑定属性的值)
// ============================================================================

/**
 * 从 Clip 提取指定属性的值。
 *
 * @param clip Clip 对象
 * @param property 属性名
 * @returns 属性值(number),若属性不存在返回 null
 */
export function getClipPropertyValue(
  clip: Clip,
  property: ClipBindableProperty,
): number | null {
  switch (property) {
    case 'speed': return clip.speed
    case 'volume': return clip.volume
    case 'transform.x': return clip.transform.x
    case 'transform.y': return clip.transform.y
    case 'transform.scale': return clip.transform.scale
    case 'transform.rotation': return clip.transform.rotation
    case 'transform.opacity': return clip.transform.opacity
    default: return null
  }
}

/**
 * 计算绑定后的参数值(应用 scale 和 offset)。
 *
 * @param clipValue Clip 属性原始值
 * @param binding 绑定(含 scale/offset)
 * @returns 转换后的参数值
 */
export function computeParamValue(
  clipValue: number,
  binding: ClipWdlBinding,
): number {
  const scaled = clipValue * (binding.scale ?? 1)
  return scaled + (binding.offset ?? 0)
}

/**
 * 从一组活跃 Clip + 绑定注册表,计算所有需要 apply 的参数补丁。
 *
 * @param clips 当前活跃的 Clip 列表
 * @param registry 绑定注册表
 * @returns 参数补丁列表 [{layerId, paramKey, value}]
 */
export function computePatches(
  clips: Clip[],
  registry: BindingRegistry,
): { layerId: string; paramKey: string; value: number }[] {
  const patches: { layerId: string; paramKey: string; value: number }[] = []
  const clipIdSet = new Set(clips.map((c) => c.id))

  for (const binding of registry.bindings) {
    if (!clipIdSet.has(binding.clipId)) continue
    const clip = clips.find((c) => c.id === binding.clipId)
    if (!clip) continue

    const clipValue = getClipPropertyValue(clip, binding.clipProperty)
    if (clipValue === null) continue

    patches.push({
      layerId: binding.layerId,
      paramKey: binding.paramKey,
      value: computeParamValue(clipValue, binding),
    })
  }

  return patches
}

// ============================================================================
// 4. 可绑定属性元数据(用于 UI 展示)
// ============================================================================

/** 可绑定属性的元数据 */
export interface PropertyMetadata {
  property: ClipBindableProperty
  label: string
  group: string
  min: number
  max: number
  defaultValue: number
}

/** 所有可绑定属性的元数据 */
export const BINDABLE_PROPERTIES: PropertyMetadata[] = [
  { property: 'speed', label: '速度', group: '基础', min: 0.1, max: 10, defaultValue: 1 },
  { property: 'volume', label: '音量', group: '基础', min: 0, max: 1, defaultValue: 1 },
  { property: 'transform.x', label: 'X 位置', group: '变换', min: -1920, max: 1920, defaultValue: 0 },
  { property: 'transform.y', label: 'Y 位置', group: '变换', min: -1080, max: 1080, defaultValue: 0 },
  { property: 'transform.scale', label: '缩放', group: '变换', min: 0, max: 10, defaultValue: 1 },
  { property: 'transform.rotation', label: '旋转', group: '变换', min: 0, max: 360, defaultValue: 0 },
  { property: 'transform.opacity', label: '不透明度', group: '变换', min: 0, max: 1, defaultValue: 1 },
]

/**
 * 获取属性元数据。
 */
export function getPropertyMetadata(property: ClipBindableProperty): PropertyMetadata | undefined {
  return BINDABLE_PROPERTIES.find((p) => p.property === property)
}
