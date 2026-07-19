/**
 * PixelForge - 跨层共享类型（freeze-1 收口版）
 *
 * 本文件是项目「值层公约」与「基础类型层」的唯一来源。
 * 禁止其他模块重复定义下列任何类型。
 *
 * 与骨架文档对齐范围：
 *   - §4.1.0 静态边界硬约束（params 必须为 JsonLiteral，无 time/frame/...）
 *   - §4.1.4 SourceKind 枚举（7 个值）
 *   - §4.1.5 ParameterOwner 枚举（6 个值）
 *   - §4.1.6 Params = Record<string, JsonLiteral>
 *   - §4.6.2 / §4.6.3 CacheKeySet + KeyInput 类型
 *   - §4.7 CompileContext（无 time 字段）
 *
 * freeze-1 保守原则：
 *   - 文档未正式收口的字段集合不硬枚举（EffectType 用 string）
 *   - 共享层不直接暴露浏览器 DOM/WebGPU 类型（用 TextureFormat 协议字符串）
 *   - 不与 CompileContext 字段重叠（previewLevel 仅在 CompileContext，不在 CompileHints）
 *   - Opcode 用数值 enum，对齐骨架 §4.3 与 shader 解包逻辑
 */

// ============================================================================
// 1. JsonLiteral - 项目「值层公约」
// ============================================================================

/**
 * JSON 字面量类型。
 * 用于 Render IR 的 params 字段、cache key 输入、跨 worker 传输等所有值层场景。
 *
 * 硬约束（骨架 §4.1.0 第 1 条）：
 *   - 禁止 undefined / Function / Map / Set / Date / class instance
 *   - 仅允许 null / boolean / number / string / 数组 / 普通 object
 */
export type JsonLiteral =
  | null
  | boolean
  | number
  | string
  | JsonLiteral[]
  | { [key: string]: JsonLiteral };

/**
 * JsonLiteral 运行时守卫。
 *
 * 递归判断 value 是否符合 JsonLiteral 约束：
 *   - 原始类型（null/boolean/number/string）直接通过
 *   - 数组逐项校验
 *   - 普通对象逐字段校验（拒绝 Map/Set/Date/RegExp 等）
 *   - 含深度保护（MAX_JSON_LITERAL_DEPTH = 16）与环路保护（WeakSet）
 *
 * 该函数是 freeze-1 中唯一允许作为「值」导入的工具函数：
 *   import { isJsonLiteral } from '../../shared/types';
 *   // 不能 import type { isJsonLiteral } — isJsonLiteral 是函数，不是类型
 */
const MAX_JSON_LITERAL_DEPTH = 16;

export function isJsonLiteral(
  value: unknown,
  seen: WeakSet<object> = new WeakSet(),
  depth: number = 0
): value is JsonLiteral {
  // 深度保护
  if (depth > MAX_JSON_LITERAL_DEPTH) return false;

  // 原始类型
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return true;
  }

  // 非对象类型直接拒绝（含 undefined / function / symbol / bigint）
  if (typeof value !== 'object') return false;

  // 环路保护
  if (seen.has(value as object)) return false;
  seen.add(value as object);

  // 数组：逐项校验
  if (Array.isArray(value)) {
    for (const item of value) {
      if (!isJsonLiteral(item, seen, depth + 1)) return false;
    }
    return true;
  }

  // 拒绝 Map / Set / Date / RegExp / ArrayBuffer / Promise / class instance
  // 仅允许 plain object
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return false;

  // 普通对象：逐字段校验
  for (const key in value) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    const v = (value as Record<string, unknown>)[key];
    if (!isJsonLiteral(v, seen, depth + 1)) return false;
  }
  return true;
}

// ============================================================================
// 2. Opcode - 数值 enum（对齐骨架 §4.3 与 shader 解包逻辑）
// ============================================================================

/**
 * Opcode 数值 enum。
 *
 * 与骨架 §4.3 OpcodeSpec 对齐，与 region_eval.wgsl 的 descriptor 解包逻辑一致：
 *   descriptor[0] = opcode(8) | flags(8) | auxIndex(16)
 *
 * DM-3 收口（Phase A）：
 *   - SOLID_COLOR / LINEAR_GRADIENT / NOISE / CIRCLE_SHAPE：Phase A 实现
 *   - BLEND：Phase B 转为 blendMode 机制（不再作为图层 opcode）
 *
 * Phase B 限制：
 *   - RegionCompiler 遇到 BLEND 作为图层 opcode 仍抛 COMPILE_ERROR
 *   - 混合通过 Layer.blendMode 字段实现，在着色器内完成
 */
export enum Opcode {
  SOLID_COLOR = 0,
  LINEAR_GRADIENT = 1,
  NOISE = 2,
  BLEND = 3,              // Phase B 启用（独立 blend pass，不进 region_eval）
  CIRCLE_SHAPE = 4,
}

// ============================================================================
// 3. EffectType - 暂不硬枚举（freeze-1 保守）
// ============================================================================

/**
 * EffectType 暂用 string，不硬枚举具体值。
 *
 * 原因：骨架 §4.1.3 只收口了「Effect 是静态修饰符，禁止动画类 type」，
 * 但未正式收口 EffectType 枚举全集。若现在硬写 BLUR/BLOOM/COLOR_SHIFT/MASK，
 * 后续发现还要 VIGNETTE/LEVELS/CURVES/THRESHOLD 等就得改共享层基线。
 *
 * 运行时通过 renderIR.ts 中的守卫函数拒绝动画类名字（
 * 禁止 ANIMATE / ANIMATION / TRANSITION / MOTION / FADE / PULSE / FLICKER 等）。
 *
 * 后续若正式收口枚举全集，再改回字符串字面量联合。
 */
export type EffectType = string;

// ============================================================================
// 4. BlendMode - 混合模式（Phase A 不支持，仅定义类型）
// ============================================================================

/**
 * BlendMode 字符串字面量联合。
 * Phase B 已支持所有 6 种混合模式，在着色器内完成。
 */
export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'add'
  | 'subtract';

// ============================================================================
// 5. BoundingBox - 区域边界
// ============================================================================

/**
 * 区域边界（归一化坐标 [0, 1]）。
 * 用于 Region.bounds，structural-patch 字段（改值 = StructuralPatch）。
 */
export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ============================================================================
// 6. TextureFormat - 共享层纹理格式协议字符串（不暴露 GPUTextureFormat）
// ============================================================================

/**
 * 纹理格式协议字符串。
 *
 * freeze-1 设计原则：shared 层不直接依赖浏览器 DOM/WebGPU 类型，
 * 用字符串表达协议值，避免跨 worker / schema / 非 GPU 环境下类型耦合。
 *
 * runtime/capability.ts 负责在运行时把 TextureFormat 转换为 GPUTextureFormat。
 *
 * 常见值：
 *   - 'rgba8unorm'   DM-5 强制格式（不支持直接抛 gpu_capability_error）
 *   - 'bgra8unorm'   navigator.gpu.getPreferredCanvasFormat() 常见返回值
 *   - 'rgba16float'  HDR 预留
 */
export type TextureFormat = string;

// ============================================================================
// 7. SourceKind - 来源追踪（骨架 §4.1.4 收口）
// ============================================================================

/**
 * SourceKind 枚举（骨架 §4.1.4）。
 * 禁止开放字符串，所有 source 字段必须取以下 7 个值之一。
 *
 * Phase A 仅允许 'system_default'。
 */
export type SourceKind =
  | 'user_prompt'
  | 'rule_parser'
  | 'llm_parser'
  | 'image_analysis'
  | 'user_patch'
  | 'l3_world_ref'
  | 'system_default';

// ============================================================================
// 8. ParameterOwner / ParamOwnership - 参数归属（骨架 §4.1.5 收口）
// ============================================================================

/**
 * ParameterOwner 枚举（骨架 §4.1.5）。
 * 禁止自由标记，所有 paramOwnership 值必须取以下 6 个之一。
 *
 * Phase B-E 仅允许前三项（l2_user / l2_parser / system_default）。
 * Phase F 启用时才允许后三项。
 */
export type ParameterOwner =
  | 'l2_user'
  | 'l2_parser'
  | 'system_default'
  | 'l3_timeline'
  | 'l3_director'
  | 'l3_revision';

/**
 * ParamOwnership = Record<string, ParameterOwner>（freeze-1 修正）。
 *
 * 原 Map<string, ParameterOwner> 已废弃，原因：
 *   - Map 不可稳定 serialize，不利于 hash / schema 校验 / 跨 worker 传输
 *   - Record 是 JSON-friendly 的，可直接进入 JsonLiteral 容器
 */
export type ParamOwnership = Record<string, ParameterOwner>;

// ============================================================================
// 9. CompileHints - 编译策略提示（最小化，不与 CompileContext 重叠）
// ============================================================================

/**
 * 编译策略提示。
 *
 * 硬约束（骨架 §4.1.0 第 4 条）：不含时间窗口 / 帧号 / 预览时刻字段。
 *
 * freeze-1 最小化原则：
 *   - previewLevel 已在 CompileContext 中，不在此重复
 *   - allowTileSplit / maxTextureSize 等工程字段未在骨架正式收口，不补
 *   - 仅保留 preferredProfile（编译策略选择），与 CompileContext.capability（硬件能力描述）解耦
 */
export interface CompileHints {
  preferredProfile?: 'region' | '64' | '128';
}

// ============================================================================
// 10. WorldMetadata - L3 接入点 3 元数据（骨架 §4.7 / §6 接入点 3）
// ============================================================================

/**
 * L3 接入点 3：可注入上层语义元数据。
 *
 * 硬约束（骨架 §4.1.0 第 3 条）：
 *   - 仅允许标识 / 标签 / 引用三类字段
 *   - 禁止 timeline / animatedBindings / animCurve / motion 等时间语义字段
 *
 * Phase B-E 留空，Phase F+ 由 Timeline / Director / Revision 注入。
 */
export interface WorldMetadata {
  sceneGraphId?: string;
  timelineId?: string;
  directorIntentId?: string;
}

// ============================================================================
// 11. CapabilityProfile - 启动时探测的硬件能力（骨架 §3.2）
// ============================================================================

/**
 * CapabilityProfile：启动时探测一次，整个会话不变。
 * 由 capability.ts 输出，供 L1/L2 决策 tile size / preview strategy / output strategy。
 *
 * DM-5 收口：不支持 storage texture 直接抛 gpu_capability_error，不维护 buffer fallback。
 *
 * freeze-1 修订：用 TextureFormat 协议字符串代替 GPUTextureFormat，
 *                保持 shared 层零 DOM/WebGPU 类型耦合。
 *                runtime/capability.ts 在运行时做转换。
 */
export interface CapabilityProfile {
  supportsStorageTexture: boolean;             // rgba8unorm storage texture 支持
  storageTextureFormat: TextureFormat | null;   // 'rgba8unorm' 或 null
  preferredCanvasFormat: TextureFormat;         // 对应 navigator.gpu.getPreferredCanvasFormat()
  maxBufferSize: number;                         // 最大 buffer size（字节）
  maxStorageBufferBindingSize: number;
  maxWorkgroupSize: [number, number, number];     // [x, y, z]
  maxWorkgroupsPerDimension: number;
  maxBindGroups: number;
  // profileId 用于 §4.6.2 StaticKeyInput.profileId
  profileId: string;
}

// ============================================================================
// 12. OutputStrategy - 输出策略（DM-5 收口）
// ============================================================================

/**
 * 输出策略类型。
 *
 * DM-5 收口结论：Phase A 仅支持 'storage_texture'，不支持直接抛 gpu_capability_error。
 * 'buffer' 路径仅用于导出场景（Phase A 不实现，仅设计预留）。
 *
 * 作为独立 type（不内联到 RenderPlan）便于未来扩展（如 'render_target_direct'）。
 */
export type OutputStrategy = 'storage_texture';

// ============================================================================
// 导出汇总
// ============================================================================

/**
 * 本文件导出清单：
 *
 * 类型（type-only）：
 *   - JsonLiteral
 *   - EffectType / BlendMode
 *   - TextureFormat
 *   - BoundingBox
 *   - SourceKind / ParameterOwner / ParamOwnership
 *   - CompileHints / WorldMetadata / CapabilityProfile / OutputStrategy
 *
 * 值（value import）：
 *   - Opcode（enum 对象，含数值成员）
 *   - isJsonLiteral（运行时守卫）
 *
 * 其他模块的导入范式（freeze-1 收口）：
 *   import type { JsonLiteral, SourceKind, ParameterOwner, ... } from '../../shared/types';
 *   import { Opcode, isJsonLiteral } from '../../shared/types';
 *
 * 提醒：Opcode 若仅用于类型标注，仍优先 import type；
 *       只有运行时需要取 Opcode.SOLID_COLOR 等值时才做 value import。
 */
