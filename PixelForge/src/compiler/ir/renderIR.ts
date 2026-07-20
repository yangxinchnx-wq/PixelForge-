/**
 * PixelForge - Render IR 定义（freeze-1 收口版）
 *
 * 本文件定义 Render IR ——「某一时刻已完成求值的渲染输入快照」。
 * 与骨架文档 §4.1 / §4.6 / §4.7 完全对齐。
 *
 * 静态边界硬约束（§4.1.0，6 条不可破坏）：
 *   1. 所有 params 字段必须是 JsonLiteral
 *   2. Layer / Region / Effect 不出现 time / frame / phase / progress / animationPhase / animated
 *   3. WorldMetadata 仅允许标识 / 标签 / 引用三类字段
 *   4. CompileHints 不含时间窗口 / 帧号 / 预览时刻字段
 *   5. Render IR 不允许跨帧资源引用（无 usePreviousFrame / historyBuffer / prevFrame / nextFrame）
 *   6. Render IR 不允许携带可执行语义（无脚本 / DSL / 表达式 / lambda）
 *
 * 违反任一约束 = IR_STATIC_BOUNDARY_VIOLATION 编译错误。
 */

// ============================================================================
// Import —— freeze-1 收口：type 与 value 拆分
// ============================================================================

import type {
  Opcode,
  EffectType,
  SourceKind,
  ParamOwnership,
  BlendMode,
  BoundingBox,
  CompileHints,
  WorldMetadata,
  CapabilityProfile,
  JsonLiteral,
  OutputStrategy,
} from '../../shared/types';

import { isJsonLiteral } from '../../shared/types';

// ============================================================================
// 1. Params - 唯一落位（骨架 §4.1.6）
// ============================================================================

/**
 * Params 类型硬约束（骨架 §4.1.6）。
 *
 * JsonLiteral 是项目「值层公约」，唯一定义在 shared/types.ts。
 * 禁止使用 Record<string, unknown> 等宽松容器。
 * 禁止其他模块重复定义 Params。
 */
export type Params = Record<string, JsonLiteral>;

/**
 * Params 运行时守卫。
 * 依赖 isJsonLiteral 对每个 value 做递归校验。
 */
export function isParams(value: unknown): value is Params {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return false;
  return Object.values(value).every((v) => isJsonLiteral(v));
}

// ============================================================================
// 2. RenderIR 顶层（骨架 §4.1.1）
// ============================================================================

/**
 * Render IR 顶层结构。
 *
 * 核心定位（§4.1.0）：
 *   Render IR 是「某一时刻已完成求值的渲染输入快照」。
 *   - 不负责保存时间逻辑
 *   - 不负责表达动画意图
 *   - 不负责携带绑定关系
 *   - 只代表「此刻该怎么画」
 */
export interface RenderIR {
  canvas: { width: number; height: number };   // static：改尺寸触发 storage texture 重建
  layers: Layer[];                              // static：增删 = TopologyPatch
  regions: Region[];                            // static：增删 = TopologyPatch
  effects: Effect[];                            // static：增删 = TopologyPatch；Phase B 已实现（blur/bloom/vignette/color_shift/mask）
  compileHints: CompileHints;                   // static：编译策略
  worldMetadata?: WorldMetadata;                // metadata：仅追踪，不影响渲染求值
}

// ============================================================================
// 3. Layer（骨架 §4.1.2）
// ============================================================================

/**
 * Layer：单层渲染输入。
 *
 * 字段切分：
 *   - id              static             改 id = 新对象（禁止 patch）
 *   - opcode          static             改 opcode = AtomicTopologyPatch
 *   - params          dynamic            改值 = ValuePatch
 *   - source          metadata           仅追踪
 *   - sourceRef       metadata           仅追踪
 *   - paramOwnership  metadata           Record<string, ParameterOwner>
 *   - visible         structural-patch   切换 = StructuralPatch
 *   - blendMode       static             Phase A 不支持（抛 COMPILE_ERROR）
 */
export interface Layer {
  id: string;                       // L3 接入点 1：稳定 ID，禁止 patch 修改
  opcode: Opcode;                   // static：改 opcode = AtomicTopologyPatch
  params: Params;                   // dynamic：改值 = ValuePatch
  source: SourceKind;               // metadata：仅追踪（见 §4.1.4）
  sourceRef?: string;                // metadata：仅追踪
  paramOwnership: ParamOwnership;   // metadata：Record<string, ParameterOwner>
  visible: boolean;                  // structural-patch：切换 = StructuralPatch
  blendMode?: BlendMode;              // static：Phase B 已支持（normal/multiply/screen/overlay/add/subtract）
}

// ============================================================================
// 4. Region（骨架 §4.1.3）
// ============================================================================

/**
 * Region：渲染区域。
 *
 * 字段切分：
 *   - id          static           稳定 ID
 *   - bounds      structural-patch 改值 = StructuralPatch（影响 dispatch + tile 失效）
 *   - layerRefs   static           改引用 = TopologyPatch（顺序敏感）
 *   - source      metadata         仅追踪
 *   - sourceRef   metadata         仅追踪
 */
export interface Region {
  id: string;                    // 稳定 ID
  bounds: BoundingBox;           // structural-patch：影响 dispatch + tile 失效
  layerRefs: string[];           // static：改引用 = TopologyPatch（顺序敏感）
  source: SourceKind;
  sourceRef?: string;
}

// ============================================================================
// 5. Effect（骨架 §4.1.3）
// ============================================================================

/**
 * Effect：静态渲染修饰符。
 *
 * 职责硬约束（§4.1.3）：Effect 是静态渲染修饰符，不是时序控制器。
 * 禁止 ANIMATE / ANIMATION / TRANSITION / MOTION / FADE / PULSE / FLICKER 等 type。
 * 该禁令由 FORBIDDEN_EFFECT_TYPE_NAMES + validateStaticBoundary() 强制。
 *
 * 字段切分：
 *   - id             static           稳定 ID
 *   - type           static           改 type = AtomicTopologyPatch
 *   - params         dynamic          改值 = ValuePatch
 *   - targetLayer    structural-patch 改作用对象
 *   - targetRegion   structural-patch 改作用区域
 */
export interface Effect {
  id: string;                    // 稳定 ID
  type: EffectType;              // static：改 type = AtomicTopologyPatch
  params: Params;                // dynamic：改值 = ValuePatch
  targetLayer?: string;           // structural-patch：改作用对象
  targetRegion?: string;          // structural-patch：改作用区域
}

/**
 * 禁止的 Effect.type 字段名（动画类）。
 * 匹配规则：大小写不敏感 + 前后 trim。
 * 由 validateStaticBoundary() 在 effects 遍历时强制校验。
 */
export const FORBIDDEN_EFFECT_TYPE_NAMES = [
  'animate', 'animation', 'transition', 'motion',
  'fade', 'pulse', 'flicker', 'anim', 'animstate',
] as const;

// ============================================================================
// 6. CompileContext（骨架 §4.7，freeze-1 删 time）
// ============================================================================

/**
 * CompileContext：编译期稳定上下文。
 *
 * freeze-1 修订：删除 time 字段，对齐 §4.1.0 静态边界硬约束。
 * 时间语义完全由 ValuePatch 在主线程推动，编译期不含任何时间量。
 */
export interface CompileContext {
  capability: CapabilityProfile;
  // L3 接入点 3：可注入上层语义元数据
  worldMetadata?: WorldMetadata;
  seed: number;                     // deterministic seed
  previewLevel: 0 | 1 | 2 | 3;
}

// ============================================================================
// 7. FORBIDDEN_IR_FIELD_NAMES（骨架 §4.1.7）
// ============================================================================

/**
 * Render IR 静态边界禁用字段名（骨架 §4.1.7）。
 *
 * validateStaticBoundary() 在递归扫描时匹配这些字段名，
 * 出现任一即视为违反静态边界硬约束（§4.1.0 第 2 / 5 条）。
 *
 * 命中即追加到 violations 列表，由调用方决定是否抛
 * IR_STATIC_BOUNDARY_VIOLATION。
 */
export const FORBIDDEN_IR_FIELD_NAMES = [
  // 时间语义（违反第 2 条）
  'time', 'frame', 'phase', 'progress',
  'animationPhase', 'animated', 'animState',
  'tick', 'clock',
  // 跨帧资源引用（违反第 5 条）
  'prevFrame', 'nextFrame', 'historyBuffer',
  // 时间窗口（违反第 4 条 CompileHints 限制的连带检查）
  'timeWindow',
  // 可执行语义（违反第 6 条）
  'script', 'expression', 'lambda', 'eval',
] as const;

// ============================================================================
// 8. validateStaticBoundary（骨架 §4.1.7，递归扫描 + 三重校验）
// ============================================================================

const MAX_SCAN_DEPTH = 16;

/**
 * 递归扫描 RenderIR，返回所有违反静态边界的字段路径列表。
 *
 * 三重校验：
 *   1. 禁用字段名匹配（FORBIDDEN_IR_FIELD_NAMES，大小写不敏感）
 *   2. params 字段必须满足 isParams（JsonLiteral 约束，骨架 §4.1.0 第 1 条）
 *   3. Effect.type 禁止动画类名字（FORBIDDEN_EFFECT_TYPE_NAMES，大小写不敏感 + trim）
 *
 * 扫描策略：
 *   - 递归扫描所有 plain object / array
 *   - 含嵌套 params.xxx.animated 这种深层字段
 *   - 防护深度 = MAX_SCAN_DEPTH (16)
 *   - 防循环引用（WeakSet）
 *   - 命中后继续扫描（不提前 return），保证能抓到所有违规
 *
 * @returns violations 字段路径列表
 *          （如 ['layers[0].params.animated', 'effects[1].type', 'layers[2].params']）
 *          空数组表示通过。
 */
export function validateStaticBoundary(ir: RenderIR): string[] {
  const violations: string[] = [];
  const seen = new WeakSet<object>();

  const forbiddenFieldSet = new Set<string>(
    FORBIDDEN_IR_FIELD_NAMES.map((n) => n.toLowerCase())
  );
  const forbiddenEffectTypeSet = new Set<string>(
    FORBIDDEN_EFFECT_TYPE_NAMES.map((n) => n.toLowerCase())
  );

  // -------- 校验 3：Effect.type 禁词 --------
  // 单独一轮，因为 type 是值而非字段名，无法在字段名扫描中捕获
  for (let i = 0; i < ir.effects.length; i++) {
    const t = ir.effects[i].type;
    if (typeof t === 'string') {
      const normalized = t.trim().toLowerCase();
      if (forbiddenEffectTypeSet.has(normalized)) {
        violations.push(`ir.effects[${i}].type`);
      }
    }
  }

  // -------- 校验 1 + 2：递归扫描字段名 + params 守卫 --------
  function scan(value: unknown, path: string, depth: number): void {
    // 深度保护
    if (depth > MAX_SCAN_DEPTH) return;

    // 原始类型：无可扫描字段
    if (value === null || typeof value !== 'object') return;

    // 环路保护
    if (seen.has(value as object)) return;
    seen.add(value as object);

    // 数组：逐项递归
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        scan(value[i], `${path}[${i}]`, depth + 1);
      }
      return;
    }

    // 仅扫描 plain object（拒绝 Map/Set/Date/RegExp/class instance）
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return;

    // 普通对象：逐字段检查
    for (const key in value) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) continue;

      // 校验 1：匹配禁用字段名（大小写不敏感）
      if (forbiddenFieldSet.has(key.toLowerCase())) {
        violations.push(`${path}.${key}`);
      }

      const v = (value as Record<string, unknown>)[key];

      // 校验 2：params 字段必须满足 isParams（§4.1.0 第 1 条）
      // 命中后仍继续 scan，以便抓到 params 内嵌套的 forbidden names（如 params.animated）
      if (key === 'params' && !isParams(v)) {
        violations.push(`${path}.${key}`);
      }

      // 继续递归（含命中违规的字段也继续扫描）
      scan(v, `${path}.${key}`, depth + 1);
    }
  }

  // 顶层扫描 RenderIR
  scan(ir, 'ir', 0);

  return violations;
}

// ============================================================================
// 9. CacheKeySet（骨架 §4.6.2）
// ============================================================================

/**
 * 三层 cache key 集合 + 可选 metadataKey。
 *
 * 对应字段切片（§4.1）与 patch tier（§4.2）：
 *   ValuePatch         → 仅 dynamicKey 失效
 *   StructuralPatch    → structuralKey + dynamicKey 失效
 *   TopologyPatch      → staticKey + structuralKey + dynamicKey 全部失效
 *   AtomicTopologyPatch→ 同 TopologyPatch（原子事务）
 *   MetadataPatch      → 仅 metadataKey 失效（不影响渲染求值）
 */
export interface CacheKeySet {
  staticKey: string;        // 编译形态：canvas / opcodes / effectTypes / outputStrategy / profile
  structuralKey: string;    // 局部结构：visible / layerOrder / regionBounds / regionOrder / layerRefs
  dynamicKey: string;      // 求值参数：params 值 / seed / compileHints
  metadataKey?: string;     // 追踪用：source / sourceRef / paramOwnership / worldMetadata
}

// ============================================================================
// 10. KeyInput 类型（骨架 §4.6.3，4 个投影函数的输入）
// ============================================================================

/**
 * StaticKeyInput：编译形态。
 * → 决定 pipeline 选择与 descriptor buffer 形态。
 */
export interface StaticKeyInput {
  canvas: { width: number; height: number };
  opcodes: Opcode[];                  // 有序：layers.map(l => l.opcode)
  blendModes: (BlendMode | undefined)[];  // 有序：layers.map(l => l.blendMode) Phase B 新增
  effectTypes: EffectType[];          // 有序：effects.map(e => e.type)
  outputStrategy: OutputStrategy;
  profileId: string;                  // CapabilityProfile 标识（见 §3.2）
}

/**
 * StructuralKeyInput：局部结构。
 * → 决定 tile 划分与 dispatch 范围。
 */
export interface StructuralKeyInput {
  visibleFlags: boolean[];            // 有序：layers.map(l => l.visible)
  layerOrder: string[];               // 有序：layers.map(l => l.id)
  regionBounds: BoundingBox[];       // 有序：regions.map(r => r.bounds)
  regionOrder: string[];              // 有序：regions.map(r => r.id)
  layerRefs: string[][];              // 有序：regions.map(r => r.layerRefs)
}

/**
 * DynamicParamEntry：单个参数项（ownerId + paramKey + value 三元组）。
 * 必须保留 ownerId 与 paramKey，否则不同 key 排序后会产生 hash 碰撞。
 */
export interface DynamicParamEntry {
  ownerId: string;       // layer.id 或 effect.id
  paramKey: string;      // params 字段名
  value: JsonLiteral;     // 参数值
}

/**
 * DynamicKeyInput：求值参数。
 * → 决定 aux buffer 与 uniform 内容。
 *
 * paramEntries 按 (ownerId, paramKey) 字典序排列，保证 hash 输入稳定。
 */
export interface DynamicKeyInput {
  paramEntries: DynamicParamEntry[];
  seed: number;
  compileHints: CompileHints;
}

/**
 * MetadataKeyInput：追踪用元数据。
 * 不影响渲染求值，仅用于 Revision History 与 L3 追踪。
 *
 * 同时收集 layer 与 region 的 metadata，避免 Region.source 变化不反映到 metadataKey。
 */
export interface MetadataKeyInput {
  // Layer 元数据（按 layers 顺序）
  layerSources: SourceKind[];
  layerSourceRefs: (string | undefined)[];
  paramOwnership: ParamOwnership[];    // 仅 Layer 有此字段
  // Region 元数据（按 regions 顺序）
  regionSources: SourceKind[];
  regionSourceRefs: (string | undefined)[];
  // 顶层元数据
  worldMetadata?: WorldMetadata;        // 严格只取 ir.worldMetadata，不做 ctx fallback
}

// ============================================================================
// 11. 4 个 projection functions（骨架 §4.6.4）
// ============================================================================

/**
 * projectStaticKey：投影出静态编译形态。
 *
 * 包含字段：
 *   - canvas（来自 ir.canvas）
 *   - opcodes（来自 ir.layers，按顺序）
 *   - effectTypes（来自 ir.effects，按顺序）
 *   - outputStrategy（当前编译输出策略；Phase A 固定 'storage_texture'）
 *   - profileId（来自 ctx.capability.profileId）
 *
 * 注意：projectStaticKey 需要 ctx 是因为它依赖 CapabilityProfile.profileId。
 */
export function projectStaticKey(
  ir: RenderIR,
  ctx: CompileContext
): StaticKeyInput {
  return {
    canvas: { width: ir.canvas.width, height: ir.canvas.height },
    opcodes: ir.layers.map((l) => l.opcode),
    blendModes: ir.layers.map((l) => l.blendMode),
    effectTypes: ir.effects.map((e) => e.type),
    outputStrategy: 'storage_texture',
    profileId: ctx.capability.profileId,
  };
}

/**
 * projectStructuralKey：投影出局部结构。
 *
 * 包含字段：
 *   - visibleFlags（来自 ir.layers，按顺序）
 *   - layerOrder（来自 ir.layers.id，按顺序）
 *   - regionBounds（来自 ir.regions.bounds，按顺序）
 *   - regionOrder（来自 ir.regions.id，按顺序）
 *   - layerRefs（来自 ir.regions.layerRefs，按顺序）
 *
 * 不需要 ctx：结构信息全部来自 ir。
 */
export function projectStructuralKey(
  ir: RenderIR
): StructuralKeyInput {
  return {
    visibleFlags: ir.layers.map((l) => l.visible),
    layerOrder: ir.layers.map((l) => l.id),
    regionBounds: ir.regions.map((r) => r.bounds),
    regionOrder: ir.regions.map((r) => r.id),
    layerRefs: ir.regions.map((r) => r.layerRefs),
  };
}

/**
 * projectDynamicKey：投影出求值参数。
 *
 * paramEntries 排序规则：
 *   1. 先按 ownerId 字典序
 *   2. 同一 ownerId 内按 paramKey 字典序
 *   排序保证 hash 输入稳定，避免不同 key 产生 hash 碰撞。
 *
 * 需要 ctx：seed 不在 ir 里，在 ctx 里。
 */
export function projectDynamicKey(
  ir: RenderIR,
  ctx: CompileContext
): DynamicKeyInput {
  const entries: DynamicParamEntry[] = [];

  for (const layer of ir.layers) {
    for (const key of Object.keys(layer.params)) {
      entries.push({
        ownerId: layer.id,
        paramKey: key,
        value: layer.params[key],
      });
    }
  }
  for (const effect of ir.effects) {
    for (const key of Object.keys(effect.params)) {
      entries.push({
        ownerId: effect.id,
        paramKey: key,
        value: effect.params[key],
      });
    }
  }

  // 按 (ownerId, paramKey) 字典序排列
  entries.sort((a, b) => {
    if (a.ownerId !== b.ownerId) return a.ownerId < b.ownerId ? -1 : 1;
    return a.paramKey < b.paramKey ? -1 : 1;
  });

  return {
    paramEntries: entries,
    seed: ctx.seed,
    compileHints: ir.compileHints,
  };
}

/**
 * projectMetadataKey：投影出元数据。
 *
 * 包含字段：
 *   - layerSources / layerSourceRefs（来自 ir.layers）
 *   - paramOwnership（来自 ir.layers）
 *   - regionSources / regionSourceRefs（来自 ir.regions）
 *   - worldMetadata（严格只取 ir.worldMetadata）
 *
 * 不需要 ctx：metadata 全部来自 ir。
 * worldMetadata 不做 ctx fallback，避免双源歧义。
 */
export function projectMetadataKey(
  ir: RenderIR
): MetadataKeyInput {
  return {
    layerSources: ir.layers.map((l) => l.source),
    layerSourceRefs: ir.layers.map((l) => l.sourceRef),
    paramOwnership: ir.layers.map((l) => l.paramOwnership),
    regionSources: ir.regions.map((r) => r.source),
    regionSourceRefs: ir.regions.map((r) => r.sourceRef),
    worldMetadata: ir.worldMetadata,
  };
}

// ============================================================================
// 导出汇总
// ============================================================================

/**
 * 本文件导出清单：
 *
 * 类型（type-only）：
 *   - Params
 *   - RenderIR / Layer / Region / Effect
 *   - CompileContext
 *   - CacheKeySet
 *   - StaticKeyInput / StructuralKeyInput / DynamicKeyInput / MetadataKeyInput
 *   - DynamicParamEntry
 *
 * 值（value import）：
 *   - FORBIDDEN_IR_FIELD_NAMES
 *   - FORBIDDEN_EFFECT_TYPE_NAMES
 *   - isParams
 *   - validateStaticBoundary
 *   - projectStaticKey / projectStructuralKey / projectDynamicKey / projectMetadataKey
 *
 * 其他模块的导入范式（freeze-1 收口）：
 *   import type { RenderIR, Layer, ... } from './renderIR';
 *   import { validateStaticBoundary, projectStaticKey, ... } from './renderIR';
 *
 * 注意：ParamOwnership 不在本文件定义，从 shared/types.ts 引入；
 *       patch.ts 若需要 ParamOwnership，直接从 shared/types.ts 引入。
 */
