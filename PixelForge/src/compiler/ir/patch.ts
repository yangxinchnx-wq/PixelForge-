/**
 * PixelForge - RenderIRPatch 协议定义（freeze-1 收口版）
 *
 * 本文件定义 Patch 协议 —— 修改 Render IR 的唯一合法途径。
 * 与骨架文档 §4.2 完全对齐。
 *
 * Patch 四级分档（骨架 §4.2.1）：
 *   - value         dynamic          re-encode aux + upload
 *   - structural    structural-patch 局部 invalidate + 局部重编
 *   - topology      static           全局重编
 *   - metadata      metadata-only   仅更新内存
 *
 * 静态边界硬约束（§4.1.0）的运行时强制由本文件负责：
 *   - id 不可被 patch 修改
 *   - opcode / type 不可落入 structural / value
 *   - params 值必须是 JsonLiteral
 *   - 禁用字段（time / frame / ...）一律拒绝
 */

// ============================================================================
// Import —— freeze-1 收口：type 与 value 拆分
// ============================================================================

import type {
  JsonLiteral,
  Opcode,
  EffectType,
  SourceKind,
  ParamOwnership,
  BoundingBox,
  WorldMetadata,
} from '../../shared/types';

import { isJsonLiteral } from '../../shared/types';

import type {
  Layer,
  Region,
  Effect,
  Params,
} from './renderIR';

import { isParams } from './renderIR';

// ============================================================================
// 1. Patch tier / source
// ============================================================================

/**
 * Patch 四级分档（骨架 §4.2.1）。
 *
 * 对应 Render IR 字段切片与 cache 失效范围：
 *   - value         → 仅 dynamicKey 失效
 *   - structural    → structuralKey + dynamicKey 失效
 *   - topology      → staticKey + structuralKey + dynamicKey 全部失效
 *   - metadata      → 仅 metadataKey 失效（不影响渲染求值）
 */
export type PatchTier = 'value' | 'structural' | 'topology' | 'metadata';

/**
 * Patch 来源（骨架 §4.2.10）。
 *
 * Phase B-E 仅允许前三项（user_patch / system_internal / rule_parser）。
 * Phase F+ 才允许 l3_*。
 */
export type PatchSource =
  | 'user_patch'         // 用户参数修改（Phase B-E 主要来源）
  | 'system_internal'    // 系统内部触发
  | 'rule_parser'        // 规则 parser 输出触发（Phase B）
  | 'l3_timeline'        // Timeline 关键帧变化（Phase F+）
  | 'l3_director'        // AI Director 决策（Phase F+）
  | 'l3_revision';       // Revision Layer（Phase F+）

/**
 * 拓扑变更操作类型（骨架 §4.2.3 TopologyPatch）。
 */
export type TopologyOp =
  | 'add'        // 增加实体（layer / region / effect）
  | 'remove'     // 删除实体
  | 'replace'    // 整体替换（id 不变，其余字段全替换）
  | 'reorder';   // 重排序（仅 layerOrder / regionOrder / effectOrder）

/**
 * 拓扑变更目标实体类型。
 */
export type TopologyEntity = 'layer' | 'region' | 'effect';

/**
 * Patch 作用目标实体类型（value / structural patch 用）。
 */
export type PatchTargetEntity = 'layer' | 'region' | 'effect' | 'canvas';

// ============================================================================
// 2. PatchBase - 公共字段
// ============================================================================

/**
 * 所有 patch 共享的基础字段。
 *
 * source 在 payload 内（非外部上下文）——骨架 §4.2.10 收口项。
 * 应用 Patch 时会记录到 Revision History（Phase F+ 才有）。
 */
export interface PatchBase {
  /** Patch 唯一 ID（由调用方生成，便于 Revision History 追踪） */
  patchId: string;
  /** Patch tier */
  tier: PatchTier;
  /** Patch 来源 */
  source: PatchSource;
}

// ============================================================================
// 3. ValuePatch - 改 params 动态值（骨架 §4.2.3）
// ============================================================================

/**
 * ValuePatch：修改某个 layer / effect 的 params 内某个 key 的值。
 *
 * 约束：
 *   - 只能改 params 内的 key，不能改 opcode / type / visible / blendMode 等其他字段
 *   - value 必须是 JsonLiteral
 *   - 同一 frame 内可批量应用多个 ValuePatch
 *
 * paramKey 路径规则：
 *   - 允许指向 params 内的嵌套 JSON object 路径（如 'noise.scale'）
 *   - 但 freeze-1 不承诺完整的 path-based setter 实现（深层合并规则由 PatchEngine 在应用时定义）
 *   - 首段不能命中 FORBIDDEN_VALUEPATCH_KEYS（防止误改非 params 字段）
 */
export interface ValuePatch extends PatchBase {
  tier: 'value';
  targetEntity: 'layer' | 'effect';
  targetId: string;
  /** params 内的字段路径，如 'color' / 'radius' / 'noise.scale'（点分嵌套） */
  paramKey: string;
  /** 新值，必须是 JsonLiteral */
  value: JsonLiteral;
}

// ============================================================================
// 4. StructuralPatch - 改局部结构（骨架 §4.2.3）
// ============================================================================

/**
 * StructuralPatch 字段枚举：明确列出可改的结构字段。
 *
 * 防止把 opcode / type / id 错误地塞进 StructuralPatch。
 */
export type StructuralField =
  | 'visible'         // layer.visible 切换
  | 'bounds'          // region.bounds 修改
  | 'targetLayer'     // effect.targetLayer 修改
  | 'targetRegion';   // effect.targetRegion 修改

/**
 * StructuralPatch：改局部结构字段，不增删实体、不改 opcode/type。
 *
 * 约束：
 *   - targetEntity + targetId + field 三元组唯一定位
 *   - field 只能取 StructuralField 列举值之一
 *   - value 类型依 field 而定（运行时由 checkStructuralValue 强制）
 */
export interface StructuralPatch extends PatchBase {
  tier: 'structural';
  targetEntity: 'layer' | 'region' | 'effect';
  targetId: string;
  /** 要修改的结构字段 */
  field: StructuralField;
  /** 新值（类型依 field 而定，由 validatePatch 强制） */
  value: boolean | BoundingBox | string | undefined;
}

// ============================================================================
// 5. TopologyPatch - 增删实体或重排序（骨架 §4.2.3）
// ============================================================================

/**
 * TopologyPatch：拓扑变更。
 *
 * 约束：
 *   - op='add'      → payload 必须含完整新实体定义；targetId 应为空
 *   - op='remove'   → targetId 必填；payload 必须为空
 *   - op='replace'  → payload 必须含完整新实体定义；payload.id 必须与 targetId 一致
 *   - op='reorder'  → payload 必须为 { newOrder: string[] }；targetId 应为空
 *
 * 非原子：单个 patch 即一个拓扑变更，多个可串行应用。
 * 原子多步变更见 AtomicTopologyPatch。
 */
export interface TopologyPatch extends PatchBase {
  tier: 'topology';
  /** 拓扑操作 */
  op: TopologyOp;
  /** 目标实体类型 */
  entity: TopologyEntity;
  /** op='remove' / 'replace' 时必填；op='add' / 'reorder' 时为空 */
  targetId?: string;
  /**
   * 拓扑变更 payload，依 op 而定：
   *   - op='add'      → 新实体完整定义（Layer / Region / Effect）
   *   - op='remove'   → undefined
   *   - op='replace'  → 新实体完整定义（id 必须与 targetId 一致）
   *   - op='reorder'  → { newOrder: string[] }
   */
  payload?: Layer | Region | Effect | { newOrder: string[] };
}

// ============================================================================
// 6. AtomicTopologyPatch - 原子多步拓扑变更（判别联合）
// ============================================================================

/**
 * AtomicLayerTopologyPatch：layer 的原子 opcode + params schema 迁移。
 *
 * 用途：替换 layer 的 opcode 同时迁移 params schema，要么全成要么全失败。
 */
export interface AtomicLayerTopologyPatch extends PatchBase {
  tier: 'topology';
  /** 标记为原子 patch */
  atomic: true;
  /** 被原子替换的实体类型 = layer */
  targetEntity: 'layer';
  targetId: string;
  /** 新 opcode（必填） */
  newOpcode: Opcode;
  /** 新 params（必填） */
  newParams: Params;
}

/**
 * AtomicEffectTopologyPatch：effect 的原子 type + params schema 迁移。
 *
 * 用途：替换 effect 的 type 同时迁移 params schema，要么全成要么全失败。
 */
export interface AtomicEffectTopologyPatch extends PatchBase {
  tier: 'topology';
  /** 标记为原子 patch */
  atomic: true;
  /** 被原子替换的实体类型 = effect */
  targetEntity: 'effect';
  targetId: string;
  /** 新 type（必填） */
  newType: EffectType;
  /** 新 params（必填） */
  newParams: Params;
}

/**
 * AtomicTopologyPatch 判别联合：
 *   - AtomicLayerTopologyPatch：layer 用 newOpcode
 *   - AtomicEffectTopologyPatch：effect 用 newType
 *
 * 不支持 region（region 无 opcode/type schema 迁移需求）。
 */
export type AtomicTopologyPatch =
  | AtomicLayerTopologyPatch
  | AtomicEffectTopologyPatch;

// ============================================================================
// 7. MetadataPatch - 改 metadata（骨架 §4.2.3）
// ============================================================================

/**
 * MetadataPatch 字段枚举：明确列出可改的 metadata 字段。
 *
 * 与 renderIR.ts MetadataKeyInput 对齐：
 *   - source / sourceRef（layer + region）
 *   - paramOwnership（仅 layer）
 *   - worldMetadata（顶层）
 *
 * 注意：Effect 没有 metadata 字段定义（renderIR.ts 中 Effect 仅含
 * id/type/params/targetLayer/targetRegion，不含 source/sourceRef/paramOwnership）。
 * 因此 MetadataPatch.targetEntity 不允许 'effect'。
 */
export type MetadataField =
  | 'source'
  | 'sourceRef'
  | 'paramOwnership'
  | 'worldMetadata';

/**
 * MetadataPatch：修改 metadata 字段，不影响渲染求值。
 *
 * 约束：
 *   - targetEntity + targetId + field 三元组唯一定位
 *   - targetEntity='canvas' 时只能改 worldMetadata
 *   - targetEntity='region' 时不能改 paramOwnership（Region 无此字段）
 *   - targetEntity='effect' 不允许（Effect 无 metadata 字段）
 */
export interface MetadataPatch extends PatchBase {
  tier: 'metadata';
  /** 'canvas' 表示顶层 worldMetadata 修改；不允许 'effect' */
  targetEntity: 'layer' | 'region' | 'canvas';
  /** op='remove' 时 targetId 可省（顶层 worldMetadata）；否则必填 */
  targetId?: string;
  /** 要修改的 metadata 字段 */
  field: MetadataField;
  /** 新值（类型依 field 而定，由 validatePatch 强制） */
  value: SourceKind | string | undefined | ParamOwnership | WorldMetadata;
}

// ============================================================================
// 8. PatchBatch - 批量容器（骨架 §4.2.3）
// ============================================================================

/**
 * PatchBatch：批量 patch 容器。
 *
 * 约束：
 *   - patches 内只能含 ValuePatch / StructuralPatch / TopologyPatch / MetadataPatch
 *   - 禁止嵌套 PatchBatch（抛 IR_PATCH_BATCH_NESTED）
 *   - 禁止含 AtomicTopologyPatch（原子 patch 必须独立提交，见 §4.2.5）
 *   - 允许混 tier（实现简单，符合"一个 frame 内多个 patch 串行提交"语义）
 *
 * batch.tier 语义（freeze-1 冻结）：
 *   - batch.tier 是「容器声明 tier」，由调用方在构造 batch 时设置
 *   - freeze-1 要求其等于子 patch 的最高 tier，由 validatePatch() 强制校验
 *   - tier 优先级：topology > structural > value > metadata
 *     · 只要 batch 里有 topology，batch.tier 必须是 topology
 *     · 否则有 structural，batch.tier 必须是 structural
 *     · 否则有 value，batch.tier 必须是 value
 *     · 否则全 metadata，batch.tier 必须是 metadata
 *
 * 应用语义：按顺序串行应用，任一失败则整批回滚。
 */
export interface PatchBatch extends PatchBase {
  /** 批量标识，必须为 true */
  batch: true;
  /** 子 patch 列表（不能含 PatchBatch / AtomicTopologyPatch） */
  patches: RenderIRPatch[];
}

// ============================================================================
// 9. RenderIRPatch - 联合类型
// ============================================================================

/**
 * RenderIRPatch 联合：所有合法 patch 类型。
 *
 * 不含 PatchBatch 与 AtomicTopologyPatch —— 它们有独立的事务语义，
 * 需通过 PatchEngine.beginFrame / endFrame 提交。
 */
export type RenderIRPatch =
  | ValuePatch
  | StructuralPatch
  | TopologyPatch
  | MetadataPatch;

/**
 * 包含原子与批量的完整 patch 联合（PatchEngine 接口用）。
 */
export type AnyPatch =
  | RenderIRPatch
  | AtomicTopologyPatch
  | PatchBatch;

// ============================================================================
// 10. PatchErrorCode - 错误码（骨架 §4.2.9）
// ============================================================================

/**
 * Patch 错误码 type literal union。
 * 与骨架 §4.2.9 + 优先级文档 §4.4 同步。
 */
export type PatchErrorCode =
  | 'IR_PATCH_VIOLATION'                  // 通用 patch 违规
  | 'IR_STATIC_BOUNDARY_VIOLATION'        // 违反静态边界硬约束
  | 'IR_PATCH_TARGET_NOT_FOUND'           // targetId 不存在
  | 'IR_PATCH_DUPLICATE_ID'              // add 时 id 重复
  | 'IR_PATCH_DANGLING_REF'              // remove 时仍有引用 / setLayerRefs 引用不存在
  | 'IR_PATCH_SCHEMA_MISMATCH'            // params 不匹配 opcode schema
  | 'IR_PATCH_PATH_NOT_ALLOWED'           // value patch path 不在白名单 / 指向非 params
  | 'IR_PATCH_INVALID_VALUE'              // 数值越界（radius < 0 / 负尺寸 / NaN）
  | 'IR_PATCH_ATOMIC_INCOMPLETE'          // AtomicTopologyPatch 缺 newOpcode / newType 或 params
  | 'IR_PATCH_BATCH_NESTED'              // PatchBatch 嵌套 PatchBatch
  | 'IR_PATCH_TRANSACTION_CONFLICT';      // 同 frame 内 atomic patch 与普通 patch 冲突

// ============================================================================
// 11. PatchError - 错误类（extends Error）
// ============================================================================

/**
 * PatchError：patch 校验失败时抛出的错误对象。
 *
 * 继承 Error 以保留 stack trace 与标准 catch 语义。
 *
 * code 与 violations 的语义关系（freeze-1 设计选择，非 bug）：
 *   - code 是从 violations[0] 提取的首个错误码（见 assertPatchValid → extractErrorCode）
 *   - 当存在多个不同错误码的 violations 时，code 只反映首个，不一定是最严重的
 *   - violations 保留完整违规列表，含所有错误码字符串
 *
 * 调用方使用建议：
 *   - 单 violation 场景（如 apply 阶段的 target not found）：code 可靠，可直接用于程序化分支
 *   - 多 violation 场景（如 validator 阶段的 patchId 空 + value 非 JsonLiteral）：
 *     应检查 violations 数组获取完整错误信息，不要仅依赖 code
 *   - batch 失败时 outcome.errors[0] 是首个失败子 patch 的 PatchError，
 *     其 code 的可靠性取决于该子 patch 的失败来源（validator vs apply）
 */
export class PatchError extends Error {
  code: PatchErrorCode;
  violations: string[];

  constructor(code: PatchErrorCode, violations: string[]) {
    super(`Patch validation failed: ${violations[0] ?? code}`);
    this.name = 'PatchError';
    this.code = code;
    this.violations = violations;
    // 维持 prototype chain（TS 编译到 ES5 时 instanceof 会失效的已知问题）
    Object.setPrototypeOf(this, PatchError.prototype);
  }
}

// ============================================================================
// 12. ReferenceIndex - 运行时引用索引（骨架 §4.2.7）
// ============================================================================

/**
 * ReferenceIndex：运行时内存索引，用于快速检测 dangling ref。
 *
 * 注意：
 *   - 仅存在于运行时内存（Map / Set 允许）
 *   - 不进入 IR payload（不可 serialize）
 *   - 每次 patch 应用后增量更新
 */
export interface ReferenceIndex {
  /** layerId → 引用它的 regionId 集合 */
  layerRefByRegion: Map<string, Set<string>>;
  /** effectId → 引用它的 targetLayerId / targetRegionId */
  effectTargets: Map<string, { layer?: string; region?: string }>;
}

// ============================================================================
// 13. PatchApplyResult - 应用结果（骨架 §4.2.6）
// ============================================================================

/**
 * PatchApplyResult：patch 应用结果。
 *
 * success=false 时 violations 非空，列出所有违规路径。
 */
export interface PatchApplyResult {
  success: boolean;
  /** 应用了多少个 patch（batch 时 >1） */
  appliedCount: number;
  /** 失败时的违规路径列表 */
  violations: string[];
  /** 失败时的错误码 */
  errorCode?: PatchErrorCode;
}

// ============================================================================
// 14. CacheScope - patch 影响 cache 范围（骨架 §4.6.5 PatchScope）
// ============================================================================

/**
 * PatchScope：patch 影响的 cache key 失效范围。
 *
 * 与骨架 §4.6.5 对齐：
 *   - 'dynamic'    → 仅 dynamicKey 失效
 *   - 'structural' → structuralKey + dynamicKey 失效
 *   - 'topology'   → staticKey + structuralKey + dynamicKey 失效
 *   - 'metadata'   → 仅 metadataKey 失效
 *   - 'none'       → 无 cache 影响（理论不出现，留作 fallback）
 */
export type PatchScope = 'dynamic' | 'structural' | 'topology' | 'metadata' | 'none';

// ============================================================================
// 15. Type guards - tier 判别（骨架 §4.2.8）
// ============================================================================

export function isValuePatch(p: AnyPatch): p is ValuePatch {
  return p.tier === 'value' && !('batch' in p) && !('atomic' in p);
}

export function isStructuralPatch(p: AnyPatch): p is StructuralPatch {
  return p.tier === 'structural' && !('batch' in p) && !('atomic' in p);
}

export function isMetadataPatch(p: AnyPatch): p is MetadataPatch {
  return p.tier === 'metadata' && !('batch' in p) && !('atomic' in p);
}

/**
 * isTopologyPatch：覆盖普通 TopologyPatch 与 AtomicTopologyPatch。
 * 用 isAtomicTopologyPatch 区分两种。
 */
export function isTopologyPatch(p: AnyPatch): p is TopologyPatch | AtomicTopologyPatch {
  return p.tier === 'topology' && !('batch' in p);
}

/** 普通非原子 TopologyPatch */
export function isPlainTopologyPatch(p: AnyPatch): p is TopologyPatch {
  return p.tier === 'topology' && !('batch' in p) && !('atomic' in p);
}

/** 原子拓扑 patch（判别联合） */
export function isAtomicTopologyPatch(p: AnyPatch): p is AtomicTopologyPatch {
  return p.tier === 'topology' && !('batch' in p) && (p as { atomic?: boolean }).atomic === true;
}

/** 原子 patch（当前仅 AtomicTopologyPatch 一种） */
export function isAtomicPatch(p: AnyPatch): p is AtomicTopologyPatch {
  return isAtomicTopologyPatch(p);
}

/** 批量 patch */
export function isPatchBatch(p: AnyPatch): p is PatchBatch {
  return (p as { batch?: boolean }).batch === true;
}

// ============================================================================
// 16. getPatchTier - 取 tier
// ============================================================================

/**
 * 取 patch tier。
 * PatchBatch 的 tier 是批量容器自身的 tier（通常等于子 patch 的最高 tier）。
 */
export function getPatchTier(p: AnyPatch): PatchTier {
  return p.tier;
}

/**
 * tier 优先级数值（越大越高）。
 * 用于 getBatchTier 比较：topology > structural > value > metadata。
 */
const TIER_PRIORITY: Record<PatchTier, number> = {
  topology: 4,
  structural: 3,
  value: 2,
  metadata: 1,
};

/**
 * getBatchTier：计算 patch 列表的最高 tier。
 *
 * 规则（freeze-1 冻结）：
 *   - topology > structural > value > metadata
 *   - 空数组返回 'metadata'（最低 tier，作为安全默认值）
 *
 * 用途：
 *   - PatchBatch 构造时由调用方计算并设置 batch.tier
 *   - validatePatch() 校验 batch.tier === getBatchTier(patches)
 */
export function getBatchTier(patches: RenderIRPatch[]): PatchTier {
  if (patches.length === 0) return 'metadata';
  let best: PatchTier = 'metadata';
  let bestPri = TIER_PRIORITY[best];
  for (const p of patches) {
    const pri = TIER_PRIORITY[p.tier];
    if (pri > bestPri) {
      best = p.tier;
      bestPri = pri;
    }
  }
  return best;
}

// ============================================================================
// 17. getAffectedCacheScopes - patch 影响 cache 范围（骨架 §4.6.5）
// ============================================================================

/**
 * 计算 patch 影响的 cache 失效范围。
 *
 * 映射规则（骨架 §4.6.5）：
 *   ValuePatch         → ['dynamic']
 *   StructuralPatch    → ['structural', 'dynamic']
 *   TopologyPatch     → ['topology', 'structural', 'dynamic']
 *   AtomicTopologyPatch → 同 TopologyPatch（原子事务）
 *   MetadataPatch      → ['metadata']
 *   PatchBatch         → 取所有子 patch 的 scope 并集
 */
export function getAffectedCacheScopes(p: AnyPatch): PatchScope[] {
  if (isPatchBatch(p)) {
    const scopes = new Set<PatchScope>();
    for (const sub of p.patches) {
      for (const s of getAffectedCacheScopes(sub)) {
        scopes.add(s);
      }
    }
    return Array.from(scopes);
  }

  switch (p.tier) {
    case 'value':
      return ['dynamic'];
    case 'structural':
      return ['structural', 'dynamic'];
    case 'topology':
      return ['topology', 'structural', 'dynamic'];
    case 'metadata':
      return ['metadata'];
    default:
      return ['none'];
  }
}

// ============================================================================
// 18. validatePatch - patch 合法性校验（骨架 §4.2.9）
// ============================================================================

/**
 * 校验单个 patch 是否合法。
 *
 * 不检查 targetId 是否存在（需要 IR 上下文，由 PatchEngine 在 apply 时检查）。
 * 仅检查 patch 自身的结构合法性。
 *
 * @returns violations 违规路径列表，空数组表示通过。
 */
export function validatePatch(p: AnyPatch): string[] {
  const violations: string[] = [];

  // 公共：patchId 必填非空
  if (!isNonEmptyString(p.patchId)) {
    violations.push('IR_PATCH_VIOLATION: patchId must be non-empty string');
  }

  // PatchBatch 校验
  if (isPatchBatch(p)) {
    if (!p.patches || p.patches.length === 0) {
      violations.push('IR_PATCH_VIOLATION: batch.patches must be non-empty');
      return violations;
    }
    // freeze-1 冻结：batch.tier 必须等于子 patch 最高 tier
    const expectedTier = getBatchTier(p.patches);
    if (p.tier !== expectedTier) {
      violations.push(
        `IR_PATCH_VIOLATION: batch.tier must equal highest child tier '${expectedTier}' (got '${p.tier}')`
      );
    }
    for (let i = 0; i < p.patches.length; i++) {
      const sub = p.patches[i];
      // 禁止嵌套 PatchBatch
      if (isPatchBatch(sub)) {
        violations.push(`patches[${i}]: IR_PATCH_BATCH_NESTED`);
        continue;
      }
      // 禁止含 AtomicTopologyPatch（原子 patch 必须独立提交）
      if (isAtomicTopologyPatch(sub)) {
        violations.push(`patches[${i}]: IR_PATCH_TRANSACTION_CONFLICT (atomic in batch)`);
        continue;
      }
      violations.push(...validatePatch(sub).map((v) => `patches[${i}]: ${v}`));
    }
    return violations;
  }

  // AtomicTopologyPatch 校验（判别联合）
  if (isAtomicTopologyPatch(p)) {
    // targetId 必填
    if (!isNonEmptyString(p.targetId)) {
      violations.push('IR_PATCH_VIOLATION: atomic targetId must be non-empty');
    }
    // newParams 必须满足 isParams
    if (p.newParams === undefined || !isParams(p.newParams)) {
      violations.push('IR_PATCH_ATOMIC_INCOMPLETE: newParams required and must be Params');
    }
    // 判别字段校验
    if (p.targetEntity === 'layer') {
      if (p.newOpcode === undefined) {
        violations.push('IR_PATCH_ATOMIC_INCOMPLETE: newOpcode required for layer atomic');
      }
    } else if (p.targetEntity === 'effect') {
      if (p.newType === undefined) {
        violations.push('IR_PATCH_ATOMIC_INCOMPLETE: newType required for effect atomic');
      }
    } else {
      violations.push(`IR_PATCH_VIOLATION: atomic targetEntity must be 'layer' or 'effect'`);
    }
    return violations;
  }

  // ValuePatch 校验
  if (isValuePatch(p)) {
    // targetId 必填
    if (!isNonEmptyString(p.targetId)) {
      violations.push('IR_PATCH_VIOLATION: targetId must be non-empty');
    }
    // paramKey 必填非空
    if (!isNonEmptyString(p.paramKey)) {
      violations.push('IR_PATCH_PATH_NOT_ALLOWED: paramKey must be non-empty');
    } else {
      // 首段不能命中 forbidden 列表
      const firstSegment = p.paramKey.split('.')[0]?.toLowerCase();
      if (firstSegment && FORBIDDEN_VALUEPATCH_KEYS.has(firstSegment)) {
        violations.push(`IR_PATCH_PATH_NOT_ALLOWED: paramKey '${p.paramKey}' not in params whitelist`);
      }
    }
    // value 必须是 JsonLiteral
    if (!isJsonLiteral(p.value)) {
      violations.push('IR_STATIC_BOUNDARY_VIOLATION: value must be JsonLiteral');
    }
    return violations;
  }

  // StructuralPatch 校验
  if (isStructuralPatch(p)) {
    // targetId 必填
    if (!isNonEmptyString(p.targetId)) {
      violations.push('IR_PATCH_VIOLATION: targetId must be non-empty');
    }
    // value 类型依 field 而定
    const ok = checkStructuralValue(p.field, p.value);
    if (!ok) {
      violations.push(`IR_PATCH_INVALID_VALUE: structural field '${p.field}' value type mismatch`);
    }
    return violations;
  }

  // MetadataPatch 校验
  if (isMetadataPatch(p)) {
    // targetEntity='region' 不能改 paramOwnership
    if (p.targetEntity === 'region' && p.field === 'paramOwnership') {
      violations.push('IR_PATCH_PATH_NOT_ALLOWED: region has no paramOwnership');
    }
    // targetEntity='canvas' 只能改 worldMetadata
    if (p.targetEntity === 'canvas' && p.field !== 'worldMetadata') {
      violations.push('IR_PATCH_PATH_NOT_ALLOWED: canvas only allows worldMetadata');
    }
    // 非 canvas 时 targetId 必填
    if (p.targetEntity !== 'canvas' && !isNonEmptyString(p.targetId)) {
      violations.push('IR_PATCH_VIOLATION: targetId must be non-empty for non-canvas metadata patch');
    }
    return violations;
  }

  // TopologyPatch 校验
  if (isPlainTopologyPatch(p)) {
    validateTopologyPatch(p, violations);
    return violations;
  }

  // 未识别类型
  violations.push('IR_PATCH_VIOLATION: unknown patch type');
  return violations;
}

/**
 * TopologyPatch 详细校验：add / remove / replace / reorder 各自的约束。
 */
function validateTopologyPatch(p: TopologyPatch, violations: string[]): void {
  switch (p.op) {
    case 'add': {
      // payload 必须含完整实体
      if (!p.payload || !isEntityObject(p.payload)) {
        violations.push("IR_PATCH_VIOLATION: op='add' requires payload with complete entity");
        return;
      }
      // targetId 应为空（add 不需要 targetId）
      if (p.targetId !== undefined && p.targetId !== '') {
        violations.push("IR_PATCH_VIOLATION: op='add' should not have targetId");
      }
      // payload 必须含 id 且非空
      const payloadId = (p.payload as { id?: unknown }).id;
      if (!isNonEmptyString(payloadId)) {
        violations.push("IR_PATCH_VIOLATION: op='add' payload.id must be non-empty");
      }
      break;
    }
    case 'remove': {
      // targetId 必填
      if (!isNonEmptyString(p.targetId)) {
        violations.push("IR_PATCH_VIOLATION: op='remove' requires targetId");
      }
      // payload 应为空
      if (p.payload !== undefined) {
        violations.push("IR_PATCH_VIOLATION: op='remove' should not have payload");
      }
      break;
    }
    case 'replace': {
      // targetId 必填
      if (!isNonEmptyString(p.targetId)) {
        violations.push("IR_PATCH_VIOLATION: op='replace' requires targetId");
        return;
      }
      // payload 必须含完整实体
      if (!p.payload || !isEntityObject(p.payload)) {
        violations.push("IR_PATCH_VIOLATION: op='replace' requires payload with complete entity");
        return;
      }
      // payload.id 必须与 targetId 一致
      const payloadId = (p.payload as { id?: unknown }).id;
      if (payloadId !== p.targetId) {
        violations.push("IR_PATCH_VIOLATION: op='replace' payload.id must match targetId");
      }
      break;
    }
    case 'reorder': {
      // payload 必须为 { newOrder: string[] }
      const payload = p.payload as { newOrder?: unknown } | undefined;
      if (!payload || !Array.isArray(payload.newOrder)) {
        violations.push("IR_PATCH_VIOLATION: op='reorder' requires payload { newOrder: string[] }");
        return;
      }
      // newOrder 每项必须是 string 且非空
      const newOrder = payload.newOrder as unknown[];
      for (let i = 0; i < newOrder.length; i++) {
        if (!isNonEmptyString(newOrder[i])) {
          violations.push(`IR_PATCH_INVALID_VALUE: reorder newOrder[${i}] must be non-empty string`);
        }
      }
      // targetId 应为空
      if (p.targetId !== undefined && p.targetId !== '') {
        violations.push("IR_PATCH_VIOLATION: op='reorder' should not have targetId");
      }
      break;
    }
    default: {
      violations.push(`IR_PATCH_VIOLATION: unknown topology op '${p.op}'`);
    }
  }
}

/**
 * ValuePatch 禁止的 paramKey 首段（防止误改非 params 字段）。
 */
const FORBIDDEN_VALUEPATCH_KEYS = new Set<string>([
  'id', 'opcode', 'type', 'visible', 'blendmode',
  'source', 'sourceref', 'paramownership',
  'bounds', 'layerrefs', 'targetlayer', 'targetregion',
  // 静态边界硬约束禁用字段
  'time', 'frame', 'phase', 'progress',
  'animationphase', 'animated', 'animstate',
  'tick', 'clock',
  'prevframe', 'nextframe', 'historybuffer',
  'timewindow',
  'script', 'expression', 'lambda', 'eval',
]);

/**
 * StructuralPatch 字段值类型校验。
 */
function checkStructuralValue(field: StructuralField, value: unknown): boolean {
  switch (field) {
    case 'visible':
      return typeof value === 'boolean';
    case 'bounds':
      return isValidBoundingBox(value);
    case 'targetLayer':
    case 'targetRegion':
      // 允许 string 或 undefined（清除引用）
      return value === undefined || typeof value === 'string';
    default:
      return false;
  }
}

function isValidBoundingBox(v: unknown): boolean {
  if (typeof v !== 'object' || v === null) return false;
  const b = v as Record<string, unknown>;
  return (
    typeof b.x === 'number' && typeof b.y === 'number' &&
    typeof b.width === 'number' && typeof b.height === 'number'
  );
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function isEntityObject(v: unknown): v is { id: string } {
  if (typeof v !== 'object' || v === null) return false;
  // 拒绝数组与 Map/Set 等
  if (Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

// ============================================================================
// 19. assertPatchValid - 断言版（throw on invalid）
// ============================================================================

/**
 * 断言 patch 合法，违规则抛 PatchError。
 * 错误对象含 violations 与首个 errorCode。
 */
export function assertPatchValid(p: AnyPatch): void {
  const violations = validatePatch(p);
  if (violations.length === 0) return;

  // 从 violation 字符串中提取首个 errorCode
  const firstCode = extractErrorCode(violations[0]) ?? 'IR_PATCH_VIOLATION';

  throw new PatchError(firstCode, violations);
}

function extractErrorCode(violation: string): PatchErrorCode | null {
  for (const code of PATCH_ERROR_CODES) {
    if (violation.includes(code)) return code;
  }
  return null;
}

const PATCH_ERROR_CODES: PatchErrorCode[] = [
  'IR_PATCH_VIOLATION',
  'IR_STATIC_BOUNDARY_VIOLATION',
  'IR_PATCH_TARGET_NOT_FOUND',
  'IR_PATCH_DUPLICATE_ID',
  'IR_PATCH_DANGLING_REF',
  'IR_PATCH_SCHEMA_MISMATCH',
  'IR_PATCH_PATH_NOT_ALLOWED',
  'IR_PATCH_INVALID_VALUE',
  'IR_PATCH_ATOMIC_INCOMPLETE',
  'IR_PATCH_BATCH_NESTED',
  'IR_PATCH_TRANSACTION_CONFLICT',
];

// ============================================================================
// 20. Path parsing - value patch 路径解析（骨架 §4.2.8）
// ============================================================================

/**
 * ValuePatch paramKey 路径解析：'a.b.c' → ['a', 'b', 'c']
 *
 * 路径规则：
 *   - 点分嵌套
 *   - 仅支持 string key
 *   - 不支持数组下标（params 内不应有数组顶层 key 访问）
 *   - 空字符串视为无效路径
 *
 * 注意：parseParamPath 只做语法解析，不保证路径在 params 内存在。
 * 深层合并语义由 PatchEngine 在应用时定义（freeze-1 不承诺完整 path-based setter）。
 */
export function parseParamPath(path: string): string[] | null {
  if (typeof path !== 'string' || path.length === 0) return null;
  const segments = path.split('.');
  if (segments.some((s) => s.length === 0)) return null;
  return segments;
}

// ============================================================================
// 21. PatchEngine 接口（骨架 §4.2.5，Phase B 强制）
// ============================================================================

/**
 * PatchEngine：frame-scoped patch 事务引擎。
 *
 * Phase B 强制使用 beginFrame / endFrame：
 *   - beginFrame: 开启新 frame，进入 queued 状态
 *   - apply: 入队 patch（atomic patch 作为独占段，普通 patch 串行入队）
 *   - endFrame: 提交所有 patch，要么全成功要么全回滚
 *   - rollback: 主动回滚当前 frame
 *
 * Phase A 不使用 PatchEngine（无 patch 编辑）。
 */
export interface PatchEngine {
  /** 开启新 frame */
  beginFrame(): void;
  /** 入队 patch（不立即应用） */
  apply(patch: AnyPatch): void;
  /** 提交当前 frame 的所有 patch，返回应用结果 */
  endFrame(): PatchApplyResult;
  /** 回滚当前 frame（丢弃所有 queued patch） */
  rollback(): void;
  /** 当前 frame 状态 */
  getState(): PatchEngineState;
  /** 当前 frame 的 queued patch 列表（只读） */
  getQueuedPatches(): readonly AnyPatch[];
}

/**
 * PatchEngine 状态机（骨架 §4.2.5）。
 */
export type PatchEngineState = 'idle' | 'queued' | 'committed' | 'rejected';

// ============================================================================
// 导出汇总
// ============================================================================

/**
 * 本文件导出清单：
 *
 * 类型（type-only）：
 *   - PatchTier / PatchSource / TopologyOp / TopologyEntity / PatchTargetEntity
 *   - StructuralField / MetadataField
 *   - PatchBase
 *   - ValuePatch / StructuralPatch / TopologyPatch
 *   - AtomicLayerTopologyPatch / AtomicEffectTopologyPatch / AtomicTopologyPatch
 *   - MetadataPatch / PatchBatch
 *   - RenderIRPatch / AnyPatch
 *   - PatchErrorCode
 *   - ReferenceIndex / PatchApplyResult / PatchScope
 *   - PatchEngine / PatchEngineState
 *
 * 值（value import）：
 *   - PatchError（class extends Error）
 *   - isValuePatch / isStructuralPatch / isTopologyPatch / isPlainTopologyPatch
 *   - isAtomicTopologyPatch / isAtomicPatch / isMetadataPatch / isPatchBatch
 *   - getPatchTier / getAffectedCacheScopes
 *   - validatePatch / assertPatchValid
 *   - parseParamPath
 *
 * 其他模块的导入范式（freeze-1 收口）：
 *   import type { RenderIRPatch, ValuePatch, AtomicTopologyPatch, ... } from './patch';
 *   import { validatePatch, PatchError, ... } from './patch';
 */