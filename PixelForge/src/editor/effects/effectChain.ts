/**
 * 视频效果链(Step 34)— 视频效果定义 + 效果链操作 + 参数验证纯函数。
 *
 * 职责:
 * - 定义视频效果类型(色彩校正/模糊/变换/风格化/合成)
 * - 定义效果链结构(顺序应用的效果节点列表)
 * - 提供效果链操作纯函数(添加/删除/移动/启用/禁用)
 * - 提供参数验证和默认值
 * - 不依赖 WebGPU/DOM(纯逻辑,便于测试)
 *
 * 与 Clip 的关系:
 * - Clip.effects 字段(Step 31.1)存储 Effect ID 数组
 * - 本模块定义 Effect 的完整结构(类型/参数/启用状态)
 * - 效果链 = 有序的 Effect 列表,按顺序应用到 Clip 的渲染输出
 *
 * 数据流:
 *   Clip.effects(Effect ID 数组)
 *     → EffectChainStore.getEffectChain(clipId)
 *     → Effect[](按 order 排序)
 *     → WebGPU Render Pass(逐个应用)
 *     → 最终画面
 *
 * 效果分类:
 * - COLOR:   色彩校正(亮度/对比度/饱和度/色温/色调)
 * - BLUR:    模糊(高斯/径向/运动)
 * - TRANSFORM: 变换(位置/缩放/旋转/锚点)
 * - STYLIZE: 风格化(锐化/噪点/ vignette/色彩偏移)
 * - COMPOSITE: 合成(混合模式/遮罩/键控)
 */

// ============================================================================
// 1. 类型定义
// ============================================================================

/** 视频效果大类 */
export type VideoEffectCategory =
  | 'color'
  | 'blur'
  | 'transform'
  | 'stylize'
  | 'composite'

/** 具体效果类型 */
export type VideoEffectType =
  // 色彩校正
  | 'brightness_contrast'
  | 'hue_saturation'
  | 'color_temperature'
  | 'levels'
  | 'curves'
  // 模糊
  | 'gaussian_blur'
  | 'radial_blur'
  | 'motion_blur'
  // 变换
  | 'transform'
  | 'crop'
  // 风格化
  | 'sharpen'
  | 'noise'
  | 'vignette'
  | 'chromatic_aberration'
  // 合成
  | 'blend_mode'
  | 'mask'
  | 'keyer'

/** 效果参数(联合类型,按 type 区分) */
export interface VideoEffectParams {
  /** 亮度对比度 */
  brightness_contrast?: {
    brightness: number  // [-100, 100],0 = 原始
    contrast: number    // [-100, 100],0 = 原始
  }
  /** 色相饱和度 */
  hue_saturation?: {
    hue: number         // [-180, 180] 度
    saturation: number  // [-100, 100],0 = 原始
    lightness: number   // [-100, 100],0 = 原始
  }
  /** 色温 */
  color_temperature?: {
    temperature: number // [-100, 100],负=冷色,正=暖色
    tint: number        // [-100, 100],负=绿,正=洋红
  }
  /** 色阶 */
  levels?: {
    inBlack: number     // [0, 255]
    inWhite: number     // [0, 255]
    gamma: number       // [0.1, 9.9]
    outBlack: number    // [0, 255]
    outWhite: number    // [0, 255]
  }
  /** 曲线(简化:RGB 主曲线 + 各通道) */
  curves?: {
    points: Array<{ x: number; y: number }>  // 主曲线控制点
  }
  /** 高斯模糊 */
  gaussian_blur?: {
    radius: number      // [0, 100] 像素
  }
  /** 径向模糊 */
  radial_blur?: {
    amount: number      // [0, 100]
    centerX: number     // [0, 1] 归一化
    centerY: number     // [0, 1] 归一化
  }
  /** 运动模糊 */
  motion_blur?: {
    angle: number       // [0, 360] 度
    distance: number    // [0, 100] 像素
  }
  /** 变换 */
  transform?: {
    x: number           // 像素偏移
    y: number
    scale: number       // [0.01, 100]
    rotation: number    // [-360, 360] 度
    anchorX: number     // 归一化 [0, 1]
    anchorY: number
  }
  /** 裁剪 */
  crop?: {
    left: number        // [0, 1] 归一化
    right: number
    top: number
    bottom: number
  }
  /** 锐化 */
  sharpen?: {
    amount: number      // [0, 100]
    radius: number      // [0, 10] 像素
  }
  /** 噪点 */
  noise?: {
    amount: number      // [0, 100]
    monochrome: boolean
  }
  /** 暗角 */
  vignette?: {
    amount: number      // [-100, 100],正=暗角,负=亮角
    size: number        // [0, 100]
    feather: number     // [0, 100]
  }
  /** 色差 */
  chromatic_aberration?: {
    amount: number      // [0, 100]
    radial: boolean     // true = 径向渐变
  }
  /** 混合模式 */
  blend_mode?: {
    mode: BlendMode
    opacity: number     // [0, 1]
  }
  /** 遮罩 */
  mask?: {
    type: MaskType
    invert: boolean
    feather: number     // [0, 100]
  }
  /** 键控(抠像) */
  keyer?: {
    keyColor: string    // hex 格式 "#RRGGBB"
    threshold: number   // [0, 100]
    smoothness: number  // [0, 100]
  }
}

/** 混合模式 */
export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color_dodge'
  | 'color_burn'
  | 'hard_light'
  | 'soft_light'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity'

/** 遮罩类型 */
export type MaskType = 'rectangle' | 'ellipse' | 'gradient'

/**
 * 视频效果节点 — 效果链的一个环节。
 */
export interface VideoEffect {
  /** 唯一 ID */
  id: string
  /** 效果类型 */
  type: VideoEffectType
  /** 效果大类(派生自 type,冗余存储便于 UI 分组) */
  category: VideoEffectCategory
  /** 是否启用 */
  enabled: boolean
  /** 效果名称(UI 显示,默认取类型显示名) */
  name: string
  /** 效果参数 */
  params: VideoEffectParams
  /** 是否折叠(UI 状态) */
  collapsed: boolean
}

/**
 * 效果链 — 作用于单个 Clip 的有序效果列表。
 */
export interface EffectChain {
  /** 关联的 Clip ID */
  clipId: string
  /** 效果列表(按应用顺序,从上到下) */
  effects: VideoEffect[]
}

// ============================================================================
// 2. 效果类型元数据
// ============================================================================

/** 类型 → 大类映射 */
const TYPE_CATEGORY: Record<VideoEffectType, VideoEffectCategory> = {
  brightness_contrast: 'color',
  hue_saturation: 'color',
  color_temperature: 'color',
  levels: 'color',
  curves: 'color',
  gaussian_blur: 'blur',
  radial_blur: 'blur',
  motion_blur: 'blur',
  transform: 'transform',
  crop: 'transform',
  sharpen: 'stylize',
  noise: 'stylize',
  vignette: 'stylize',
  chromatic_aberration: 'stylize',
  blend_mode: 'composite',
  mask: 'composite',
  keyer: 'composite',
}

/** 类型 → 中文显示名映射 */
const TYPE_DISPLAY_NAME: Record<VideoEffectType, string> = {
  brightness_contrast: '亮度对比度',
  hue_saturation: '色相饱和度',
  color_temperature: '色温',
  levels: '色阶',
  curves: '曲线',
  gaussian_blur: '高斯模糊',
  radial_blur: '径向模糊',
  motion_blur: '运动模糊',
  transform: '变换',
  crop: '裁剪',
  sharpen: '锐化',
  noise: '噪点',
  vignette: '暗角',
  chromatic_aberration: '色差',
  blend_mode: '混合模式',
  mask: '遮罩',
  keyer: '键控',
}

/** 大类 → 中文显示名 */
const CATEGORY_DISPLAY_NAME: Record<VideoEffectCategory, string> = {
  color: '色彩校正',
  blur: '模糊',
  transform: '变换',
  stylize: '风格化',
  composite: '合成',
}

/**
 * 获取效果类型的中文显示名。
 */
export function getEffectDisplayName(type: VideoEffectType): string {
  return TYPE_DISPLAY_NAME[type]
}

/**
 * 获取效果大类的中文显示名。
 */
export function getCategoryDisplayName(category: VideoEffectCategory): string {
  return CATEGORY_DISPLAY_NAME[category]
}

/**
 * 获取效果类型所属大类。
 */
export function getEffectCategory(type: VideoEffectType): VideoEffectCategory {
  return TYPE_CATEGORY[type]
}

// ============================================================================
// 3. 默认参数
// ============================================================================

/** 各效果类型的默认参数 */
const DEFAULT_PARAMS: Record<VideoEffectType, VideoEffectParams> = {
  brightness_contrast: {
    brightness_contrast: { brightness: 0, contrast: 0 },
  },
  hue_saturation: {
    hue_saturation: { hue: 0, saturation: 0, lightness: 0 },
  },
  color_temperature: {
    color_temperature: { temperature: 0, tint: 0 },
  },
  levels: {
    levels: { inBlack: 0, inWhite: 255, gamma: 1.0, outBlack: 0, outWhite: 255 },
  },
  curves: {
    curves: { points: [{ x: 0, y: 0 }, { x: 255, y: 255 }] },
  },
  gaussian_blur: {
    gaussian_blur: { radius: 5 },
  },
  radial_blur: {
    radial_blur: { amount: 20, centerX: 0.5, centerY: 0.5 },
  },
  motion_blur: {
    motion_blur: { angle: 0, distance: 10 },
  },
  transform: {
    transform: { x: 0, y: 0, scale: 1, rotation: 0, anchorX: 0.5, anchorY: 0.5 },
  },
  crop: {
    crop: { left: 0, right: 0, top: 0, bottom: 0 },
  },
  sharpen: {
    sharpen: { amount: 50, radius: 1 },
  },
  noise: {
    noise: { amount: 10, monochrome: false },
  },
  vignette: {
    vignette: { amount: 30, size: 50, feather: 50 },
  },
  chromatic_aberration: {
    chromatic_aberration: { amount: 5, radial: true },
  },
  blend_mode: {
    blend_mode: { mode: 'normal', opacity: 1 },
  },
  mask: {
    mask: { type: 'rectangle', invert: false, feather: 0 },
  },
  keyer: {
    keyer: { keyColor: '#00ff00', threshold: 30, smoothness: 50 },
  },
}

/**
 * 获取效果类型的默认参数(深拷贝)。
 */
export function getDefaultParams(type: VideoEffectType): VideoEffectParams {
  const src = DEFAULT_PARAMS[type]
  return JSON.parse(JSON.stringify(src))
}

// ============================================================================
// 4. Effect / EffectChain 工厂函数
// ============================================================================

let effectIdCounter = 0

/** 生成唯一 Effect ID */
export function genEffectId(): string {
  effectIdCounter++
  return `vfx_${Date.now().toString(36)}_${effectIdCounter}`
}

/**
 * 创建视频效果节点。
 *
 * @param type    效果类型
 * @param enabled 是否启用(默认 true)
 * @returns 新的效果节点
 */
export function createEffect(
  type: VideoEffectType,
  enabled = true,
): VideoEffect {
  return {
    id: genEffectId(),
    type,
    category: TYPE_CATEGORY[type],
    enabled,
    name: TYPE_DISPLAY_NAME[type],
    params: getDefaultParams(type),
    collapsed: false,
  }
}

/**
 * 创建空的效果链。
 *
 * @param clipId 关联的 Clip ID
 */
export function createEffectChain(clipId: string): EffectChain {
  return { clipId, effects: [] }
}

// ============================================================================
// 5. 效果链操作纯函数(不可变)
// ============================================================================

/**
 * 添加效果到链尾。
 */
export function appendEffect(
  chain: EffectChain,
  effect: VideoEffect,
): EffectChain {
  return {
    ...chain,
    effects: [...chain.effects, effect],
  }
}

/**
 * 在指定索引处插入效果。
 */
export function insertEffect(
  chain: EffectChain,
  index: number,
  effect: VideoEffect,
): EffectChain {
  const effects = [...chain.effects]
  const clampedIndex = Math.max(0, Math.min(index, effects.length))
  effects.splice(clampedIndex, 0, effect)
  return { ...chain, effects }
}

/**
 * 按 ID 删除效果。
 */
export function removeEffect(
  chain: EffectChain,
  effectId: string,
): EffectChain {
  return {
    ...chain,
    effects: chain.effects.filter((e) => e.id !== effectId),
  }
}

/**
 * 移动效果位置。
 *
 * @param chain    效果链
 * @param effectId 要移动的效果 ID
 * @param direction 'up' = 上移(更早应用),'down' = 下移(更晚应用)
 */
export function moveEffect(
  chain: EffectChain,
  effectId: string,
  direction: 'up' | 'down',
): EffectChain {
  const idx = chain.effects.findIndex((e) => e.id === effectId)
  if (idx === -1) return chain

  const newIdx = direction === 'up' ? idx - 1 : idx + 1
  if (newIdx < 0 || newIdx >= chain.effects.length) return chain

  const effects = [...chain.effects]
  ;[effects[idx], effects[newIdx]] = [effects[newIdx], effects[idx]]
  return { ...chain, effects }
}

/**
 * 启用/禁用效果。
 */
export function setEffectEnabled(
  chain: EffectChain,
  effectId: string,
  enabled: boolean,
): EffectChain {
  return {
    ...chain,
    effects: chain.effects.map((e) =>
      e.id === effectId ? { ...e, enabled } : e,
    ),
  }
}

/**
 * 更新效果参数(浅合并)。
 */
export function updateEffectParams(
  chain: EffectChain,
  effectId: string,
  params: Partial<VideoEffectParams>,
): EffectChain {
  return {
    ...chain,
    effects: chain.effects.map((e) =>
      e.id === effectId
        ? { ...e, params: { ...e.params, ...params } }
        : e,
    ),
  }
}

/**
 * 重命名效果。
 */
export function renameEffect(
  chain: EffectChain,
  effectId: string,
  name: string,
): EffectChain {
  return {
    ...chain,
    effects: chain.effects.map((e) =>
      e.id === effectId ? { ...e, name } : e,
    ),
  }
}

/**
 * 设置效果折叠状态(UI)。
 */
export function setEffectCollapsed(
  chain: EffectChain,
  effectId: string,
  collapsed: boolean,
): EffectChain {
  return {
    ...chain,
    effects: chain.effects.map((e) =>
      e.id === effectId ? { ...e, collapsed } : e,
    ),
  }
}

// ============================================================================
// 6. 查询函数
// ============================================================================

/**
 * 按 ID 查找效果。
 */
export function findEffect(
  chain: EffectChain,
  effectId: string,
): VideoEffect | undefined {
  return chain.effects.find((e) => e.id === effectId)
}

/**
 * 获取启用的效果列表(按应用顺序)。
 */
export function getEnabledEffects(chain: EffectChain): VideoEffect[] {
  return chain.effects.filter((e) => e.enabled)
}

/**
 * 获取效果数量。
 */
export function getEffectCount(chain: EffectChain): number {
  return chain.effects.length
}

/**
 * 获取启用的效果数量。
 */
export function getEnabledCount(chain: EffectChain): number {
  return chain.effects.filter((e) => e.enabled).length
}

/**
 * 按大类分组效果。
 */
export function groupByCategory(
  chain: EffectChain,
): Record<VideoEffectCategory, VideoEffect[]> {
  const groups: Record<VideoEffectCategory, VideoEffect[]> = {
    color: [],
    blur: [],
    transform: [],
    stylize: [],
    composite: [],
  }
  for (const e of chain.effects) {
    groups[e.category].push(e)
  }
  return groups
}

// ============================================================================
// 7. 参数验证
// ============================================================================

/** 验证结果 */
export interface ValidationResult {
  valid: boolean
  reason?: string
}

/** clamp 工具 */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/**
 * 验证并修正效果参数(clamp 到合法范围)。
 *
 * @param effect 待验证效果
 * @returns 修正后的效果(如果参数越界则 clamp)
 */
export function validateEffectParams(effect: VideoEffect): VideoEffect {
  const p = effect.params
  const corrected = { ...p }

  if (p.brightness_contrast) {
    corrected.brightness_contrast = {
      brightness: clamp(p.brightness_contrast.brightness, -100, 100),
      contrast: clamp(p.brightness_contrast.contrast, -100, 100),
    }
  }
  if (p.hue_saturation) {
    corrected.hue_saturation = {
      hue: clamp(p.hue_saturation.hue, -180, 180),
      saturation: clamp(p.hue_saturation.saturation, -100, 100),
      lightness: clamp(p.hue_saturation.lightness, -100, 100),
    }
  }
  if (p.color_temperature) {
    corrected.color_temperature = {
      temperature: clamp(p.color_temperature.temperature, -100, 100),
      tint: clamp(p.color_temperature.tint, -100, 100),
    }
  }
  if (p.levels) {
    corrected.levels = {
      inBlack: clamp(p.levels.inBlack, 0, 255),
      inWhite: clamp(p.levels.inWhite, 0, 255),
      gamma: clamp(p.levels.gamma, 0.1, 9.9),
      outBlack: clamp(p.levels.outBlack, 0, 255),
      outWhite: clamp(p.levels.outWhite, 0, 255),
    }
  }
  if (p.gaussian_blur) {
    corrected.gaussian_blur = {
      radius: clamp(p.gaussian_blur.radius, 0, 100),
    }
  }
  if (p.radial_blur) {
    corrected.radial_blur = {
      amount: clamp(p.radial_blur.amount, 0, 100),
      centerX: clamp(p.radial_blur.centerX, 0, 1),
      centerY: clamp(p.radial_blur.centerY, 0, 1),
    }
  }
  if (p.motion_blur) {
    corrected.motion_blur = {
      angle: clamp(p.motion_blur.angle, 0, 360),
      distance: clamp(p.motion_blur.distance, 0, 100),
    }
  }
  if (p.transform) {
    corrected.transform = {
      x: p.transform.x,
      y: p.transform.y,
      scale: clamp(p.transform.scale, 0.01, 100),
      rotation: clamp(p.transform.rotation, -360, 360),
      anchorX: clamp(p.transform.anchorX, 0, 1),
      anchorY: clamp(p.transform.anchorY, 0, 1),
    }
  }
  if (p.crop) {
    corrected.crop = {
      left: clamp(p.crop.left, 0, 1),
      right: clamp(p.crop.right, 0, 1),
      top: clamp(p.crop.top, 0, 1),
      bottom: clamp(p.crop.bottom, 0, 1),
    }
  }
  if (p.sharpen) {
    corrected.sharpen = {
      amount: clamp(p.sharpen.amount, 0, 100),
      radius: clamp(p.sharpen.radius, 0, 10),
    }
  }
  if (p.noise) {
    corrected.noise = {
      amount: clamp(p.noise.amount, 0, 100),
      monochrome: p.noise.monochrome,
    }
  }
  if (p.vignette) {
    corrected.vignette = {
      amount: clamp(p.vignette.amount, -100, 100),
      size: clamp(p.vignette.size, 0, 100),
      feather: clamp(p.vignette.feather, 0, 100),
    }
  }
  if (p.chromatic_aberration) {
    corrected.chromatic_aberration = {
      amount: clamp(p.chromatic_aberration.amount, 0, 100),
      radial: p.chromatic_aberration.radial,
    }
  }
  if (p.blend_mode) {
    corrected.blend_mode = {
      mode: p.blend_mode.mode,
      opacity: clamp(p.blend_mode.opacity, 0, 1),
    }
  }
  if (p.mask) {
    corrected.mask = {
      type: p.mask.type,
      invert: p.mask.invert,
      feather: clamp(p.mask.feather, 0, 100),
    }
  }
  if (p.keyer) {
    corrected.keyer = {
      keyColor: p.keyer.keyColor,
      threshold: clamp(p.keyer.threshold, 0, 100),
      smoothness: clamp(p.keyer.smoothness, 0, 100),
    }
  }

  return { ...effect, params: corrected }
}

/**
 * 验证效果链结构完整性。
 */
export function validateEffectChain(chain: EffectChain): ValidationResult {
  if (!chain.clipId || chain.clipId.length === 0) {
    return { valid: false, reason: 'Clip ID 不能为空' }
  }
  if (!Array.isArray(chain.effects)) {
    return { valid: false, reason: 'effects 必须是数组' }
  }

  const ids = new Set<string>()
  for (const e of chain.effects) {
    if (!e.id || e.id.length === 0) {
      return { valid: false, reason: '效果 ID 不能为空' }
    }
    if (ids.has(e.id)) {
      return { valid: false, reason: `效果 ID 重复: ${e.id}` }
    }
    ids.add(e.id)
  }

  return { valid: true }
}

// ============================================================================
// 8. 预设
// ============================================================================

/**
 * 效果预设 — 预定义的效果组合。
 */
export interface EffectPreset {
  /** 预设 ID */
  id: string
  /** 预设名称 */
  name: string
  /** 预设描述 */
  description: string
  /** 预设包含的效果列表(已配置好参数) */
  effects: VideoEffect[]
}

/**
 * 内置效果预设。
 */
export const BUILTIN_PRESETS: EffectPreset[] = [
  {
    id: 'preset-cinematic',
    name: '电影感',
    description: '色彩校正 + 暗角,营造电影质感',
    effects: [
      {
        ...createEffect('color_temperature'),
        params: { color_temperature: { temperature: 15, tint: -5 } },
      },
      {
        ...createEffect('vignette'),
        params: { vignette: { amount: 40, size: 60, feather: 70 } },
      },
    ],
  },
  {
    id: 'preset-vintage',
    name: '复古',
    description: '降饱和 + 暖色调 + 噪点',
    effects: [
      {
        ...createEffect('hue_saturation'),
        params: { hue_saturation: { hue: -5, saturation: -30, lightness: 0 } },
      },
      {
        ...createEffect('color_temperature'),
        params: { color_temperature: { temperature: 25, tint: 5 } },
      },
      {
        ...createEffect('noise'),
        params: { noise: { amount: 15, monochrome: true } },
      },
    ],
  },
  {
    id: 'preset-dream',
    name: '梦幻',
    description: '高斯模糊 + 提亮 + 低对比度',
    effects: [
      {
        ...createEffect('gaussian_blur'),
        params: { gaussian_blur: { radius: 3 } },
      },
      {
        ...createEffect('brightness_contrast'),
        params: { brightness_contrast: { brightness: 15, contrast: -20 } },
      },
    ],
  },
  {
    id: 'preset-glitch',
    name: '故障',
    description: '色差 + 噪点 + 高对比度',
    effects: [
      {
        ...createEffect('chromatic_aberration'),
        params: { chromatic_aberration: { amount: 30, radial: false } },
      },
      {
        ...createEffect('noise'),
        params: { noise: { amount: 25, monochrome: false } },
      },
      {
        ...createEffect('brightness_contrast'),
        params: { brightness_contrast: { brightness: 0, contrast: 30 } },
      },
    ],
  },
  {
    id: 'preset-sharp-hd',
    name: '锐利高清',
    description: '锐化 + 色阶调整',
    effects: [
      {
        ...createEffect('sharpen'),
        params: { sharpen: { amount: 70, radius: 1.5 } },
      },
      {
        ...createEffect('levels'),
        params: { levels: { inBlack: 10, inWhite: 245, gamma: 1.0, outBlack: 0, outWhite: 255 } },
      },
    ],
  },
]

/**
 * 按 ID 查找内置预设。
 */
export function findPresetById(presetId: string): EffectPreset | undefined {
  return BUILTIN_PRESETS.find((p) => p.id === presetId)
}

/**
 * 应用预设到效果链(追加预设中的效果,生成新 ID)。
 */
export function applyPreset(
  chain: EffectChain,
  preset: EffectPreset,
): EffectChain {
  const newEffects = preset.effects.map((e) => ({
    ...e,
    id: genEffectId(), // 生成新 ID,避免冲突
    params: JSON.parse(JSON.stringify(e.params)), // 深拷贝参数
  }))
  return {
    ...chain,
    effects: [...chain.effects, ...newEffects],
  }
}
