/**
 * PixelForge - PatchEngine 最小骨架（freeze-1）
 *
 * 本文件实现 patch 的 immutable apply 引擎，与骨架 §4.2.5 / §4.2.6 对齐。
 *
 * 设计原则（用户拍板）：
 *   - 不实现 beginFrame/endFrame 状态机（Phase B 强制才做）
 *   - 支持 AtomicTopologyPatch 作为"单次原子 apply"（不是事务系统）
 *   - 单 patch 失败直接 throw PatchError
 *   - batch 任一失败立即停止并回滚，返回原 ir + errors
 *   - appliedCount 按"最终提交数"定义，回滚时为 0
 *   - immutable：返回新 ir，不修改输入
 *
 * 不在本文件范围内：
 *   - frame transaction（beginFrame/endFrame/rollback）
 *   - PatchEngineState 状态机
 *   - cache 实际失效/重编（仅返回 affectedScopes，由调用方决定如何 invalidate）
 */

// ============================================================================
// Import —— 类型与值拆分
// ============================================================================

import type {
  JsonLiteral,
  BoundingBox,
  BlendMode,
  SourceKind,
  ParamOwnership,
  WorldMetadata,
} from '../../shared/types';

import type {
  RenderIR,
  Layer,
  Region,
  Effect,
  Params,
} from './renderIR';

import type {
  RenderIRPatch,
  AnyPatch,
  ValuePatch,
  StructuralPatch,
  TopologyPatch,
  AtomicTopologyPatch,
  AtomicLayerTopologyPatch,
  AtomicEffectTopologyPatch,
  MetadataPatch,
  PatchBatch,
  PatchScope,
} from './patch';

import {
  assertPatchValid,
  getAffectedCacheScopes,
  isAtomicTopologyPatch,
  isPatchBatch,
  isValuePatch,
  isStructuralPatch,
  isMetadataPatch,
  isPlainTopologyPatch,
  PatchError,
} from './patch';

// ============================================================================
// 1. PatchApplyOutcome - 应用结果
// ============================================================================

/**
 * patch apply 的返回结构。
 *
 * - 单 patch 成功：appliedCount=1，errors 不存在
 * - 单 patch 失败：直接 throw PatchError，不返回该结构
 * - batch 全部成功：appliedCount=patches.length，errors 不存在
 * - batch 任一失败：appliedCount=0，errors 含至少一个 PatchError，ir 为原始输入
 *
 * errors[0].code 语义（调用方注意）：
 *   - errors[0] 是首个失败子 patch 抛出的 PatchError（fail fast，不收集所有错误）
 *   - 若失败发生在 apply 阶段（如 target not found）：code 准确（apply 只抛单 violation）
 *   - 若失败发生在 validator 阶段（如 patch 结构非法）：code 只反映该子 patch
 *     violations 数组的首个错误码，不一定是最严重的（见 PatchError 类注释）
 *   - 需要完整诊断信息时应检查 errors[0].violations 数组
 */
export interface PatchApplyOutcome {
  /** 应用后的新 ir（batch 失败时为原 ir） */
  ir: RenderIR;
  /** 影响的 cache scope 并集（batch 为所有子 patch 的并集） */
  affectedScopes: PatchScope[];
  /** 最终成功提交的 patch 数（batch 回滚时为 0） */
  appliedCount: number;
  /** 失败时的错误列表（batch 模式才有；单 patch 失败直接 throw） */
  errors?: PatchError[];
}

// ============================================================================
// 2. 入口：applyPatch - 单 patch（或 batch / atomic）
// ============================================================================

/**
 * 应用单个 patch（包括 batch 与 atomic）。
 *
 * 失败语义：
 *   - 非 batch：失败直接 throw PatchError
 *   - batch：失败返回含 errors 的 PatchApplyOutcome（不 throw）
 *
 * 调用方处理范式：
 *   - try/catch 处理单 patch 失败
 *   - outcome.errors 处理 batch 失败
 */
export function applyPatch(ir: RenderIR, patch: AnyPatch): PatchApplyOutcome {
  // 入口校验：结构合法性（不含 targetId 存在性，targetId 校验在 apply 内部做）
  assertPatchValid(patch);

  if (isPatchBatch(patch)) {
    return applyPatchBatchInternal(ir, patch);
  }

  // 单 patch：失败 throw PatchError
  const affectedScopes = getAffectedCacheScopes(patch);
  const newIr = applySinglePatchChecked(ir, patch);
  return {
    ir: newIr,
    affectedScopes,
    appliedCount: 1,
  };
}

// ============================================================================
// 3. 单 patch 分发（已通过 assertPatchValid，但需检查 IR 上下文）
// ============================================================================

/**
 * 分发单 patch 到具体 apply 函数。
 * 在 apply 前做 IR 上下文校验（targetId 存在性、id 重复等）。
 *
 * 失败时 throw PatchError。
 *
 * 注：依赖 assertPatchValid() 已确保 patch 结构合法 + payload shape 与 entity 一致。
 *     本函数不重复做 shape 校验。
 */
function applySinglePatchChecked(
  ir: RenderIR,
  patch: RenderIRPatch | AtomicTopologyPatch,
): RenderIR {
  if (isValuePatch(patch)) {
    return applyValuePatch(ir, patch);
  }
  if (isStructuralPatch(patch)) {
    return applyStructuralPatch(ir, patch);
  }
  if (isMetadataPatch(patch)) {
    return applyMetadataPatch(ir, patch);
  }
  if (isAtomicTopologyPatch(patch)) {
    return applyAtomicTopologyPatch(ir, patch);
  }
  if (isPlainTopologyPatch(patch)) {
    return applyTopologyPatch(ir, patch);
  }
  throw new PatchError('IR_PATCH_VIOLATION', [
    `unknown patch type: ${(patch as { tier?: string }).tier}`,
  ]);
}

// ============================================================================
// 4. applyValuePatch
// ============================================================================

/**
 * 应用 ValuePatch：修改 layer/effect 的 params 内某个 key 的值。
 *
 * immutable：仅替换被修改的 layer/effect 对象，其余引用不变。
 *
 * IR 上下文校验：
 *   - targetId 不存在 → IR_PATCH_TARGET_NOT_FOUND
 *
 * 失败时 throw PatchError。
 */
function applyValuePatch(ir: RenderIR, patch: ValuePatch): RenderIR {
  if (patch.targetEntity === 'layer') {
    const idx = findLayerIndex(ir, patch.targetId);
    if (idx < 0) {
      throw new PatchError('IR_PATCH_TARGET_NOT_FOUND', [
        `layer '${patch.targetId}' not found`,
      ]);
    }
    const newLayer: Layer = {
      ...ir.layers[idx],
      params: setParamPath(ir.layers[idx].params, patch.paramKey, patch.value),
    };
    const newLayers = ir.layers.slice();
    newLayers[idx] = newLayer;
    return { ...ir, layers: newLayers };
  }

  // targetEntity === 'effect'
  const idx = findEffectIndex(ir, patch.targetId);
  if (idx < 0) {
    throw new PatchError('IR_PATCH_TARGET_NOT_FOUND', [
      `effect '${patch.targetId}' not found`,
    ]);
  }
  const newEffect: Effect = {
    ...ir.effects[idx],
    params: setParamPath(ir.effects[idx].params, patch.paramKey, patch.value),
  };
  const newEffects = ir.effects.slice();
  newEffects[idx] = newEffect;
  return { ...ir, effects: newEffects };
}

// ============================================================================
// 5. applyStructuralPatch
// ============================================================================

/**
 * 应用 StructuralPatch：改 visible / bounds / targetLayer / targetRegion。
 *
 * immutable：仅替换被修改的实体对象。
 *
 * IR 上下文校验：
 *   - targetId 不存在 → IR_PATCH_TARGET_NOT_FOUND
 *
 * 失败时 throw PatchError。
 */
function applyStructuralPatch(ir: RenderIR, patch: StructuralPatch): RenderIR {
  if (patch.targetEntity === 'layer') {
    const idx = findLayerIndex(ir, patch.targetId);
    if (idx < 0) {
      throw new PatchError('IR_PATCH_TARGET_NOT_FOUND', [
        `layer '${patch.targetId}' not found`,
      ]);
    }
    const oldLayer = ir.layers[idx];
    const newLayer: Layer = applyStructuralField(oldLayer, patch.field, patch.value);
    const newLayers = ir.layers.slice();
    newLayers[idx] = newLayer;
    return { ...ir, layers: newLayers };
  }

  if (patch.targetEntity === 'region') {
    const idx = findRegionIndex(ir, patch.targetId);
    if (idx < 0) {
      throw new PatchError('IR_PATCH_TARGET_NOT_FOUND', [
        `region '${patch.targetId}' not found`,
      ]);
    }
    const oldRegion = ir.regions[idx];
    // region 仅支持 'bounds' 字段（其他 field 在 validatePatch 已拒绝，但这里防御性检查）
    if (patch.field !== 'bounds') {
      throw new PatchError('IR_PATCH_PATH_NOT_ALLOWED', [
        `region only allows 'bounds', got '${patch.field}'`,
      ]);
    }
    const newRegion: Region = {
      ...oldRegion,
      bounds: patch.value as BoundingBox,
    };
    const newRegions = ir.regions.slice();
    newRegions[idx] = newRegion;
    return { ...ir, regions: newRegions };
  }

  // targetEntity === 'effect'
  const idx = findEffectIndex(ir, patch.targetId);
  if (idx < 0) {
    throw new PatchError('IR_PATCH_TARGET_NOT_FOUND', [
      `effect '${patch.targetId}' not found`,
    ]);
  }
  const oldEffect = ir.effects[idx];
  const newEffect: Effect = applyEffectStructuralField(
    oldEffect,
    patch.field,
    patch.value,
  );
  const newEffects = ir.effects.slice();
  newEffects[idx] = newEffect;
  return { ...ir, effects: newEffects };
}

function applyStructuralField(
  layer: Layer,
  field: StructuralPatch['field'],
  value: StructuralPatch['value'],
): Layer {
  switch (field) {
    case 'visible':
      return { ...layer, visible: value as boolean };
    case 'blendMode':
      return { ...layer, blendMode: value as BlendMode };
    // bounds / targetLayer / targetRegion 不适用于 layer
    default:
      throw new PatchError('IR_PATCH_PATH_NOT_ALLOWED', [
        `layer structural field '${field}' not allowed`,
      ]);
  }
}

function applyEffectStructuralField(
  effect: Effect,
  field: StructuralPatch['field'],
  value: StructuralPatch['value'],
): Effect {
  switch (field) {
    case 'targetLayer':
      return { ...effect, targetLayer: value as string | undefined };
    case 'targetRegion':
      return { ...effect, targetRegion: value as string | undefined };
    default:
      throw new PatchError('IR_PATCH_PATH_NOT_ALLOWED', [
        `effect structural field '${field}' not allowed`,
      ]);
  }
}

// ============================================================================
// 6. applyMetadataPatch
// ============================================================================

/**
 * 应用 MetadataPatch：改 source / sourceRef / paramOwnership / worldMetadata。
 *
 * 不影响渲染求值（但本函数仍 immutable 返回新 ir，便于 cache 比对）。
 *
 * IR 上下文校验：
 *   - 非 canvas 时 targetId 不存在 → IR_PATCH_TARGET_NOT_FOUND
 *
 * 失败时 throw PatchError。
 */
function applyMetadataPatch(ir: RenderIR, patch: MetadataPatch): RenderIR {
  if (patch.targetEntity === 'canvas') {
    // canvas 只能改 worldMetadata（validatePatch 已强制）
    return { ...ir, worldMetadata: patch.value as WorldMetadata };
  }

  if (patch.targetEntity === 'layer') {
    const idx = findLayerIndex(ir, patch.targetId!);
    if (idx < 0) {
      throw new PatchError('IR_PATCH_TARGET_NOT_FOUND', [
        `layer '${patch.targetId}' not found`,
      ]);
    }
    const oldLayer = ir.layers[idx];
    const newLayer = applyLayerMetadataField(oldLayer, patch.field, patch.value);
    const newLayers = ir.layers.slice();
    newLayers[idx] = newLayer;
    return { ...ir, layers: newLayers };
  }

  // targetEntity === 'region'
  const idx = findRegionIndex(ir, patch.targetId!);
  if (idx < 0) {
    throw new PatchError('IR_PATCH_TARGET_NOT_FOUND', [
      `region '${patch.targetId}' not found`,
    ]);
  }
  const oldRegion = ir.regions[idx];
  const newRegion = applyRegionMetadataField(oldRegion, patch.field, patch.value);
  const newRegions = ir.regions.slice();
  newRegions[idx] = newRegion;
  return { ...ir, regions: newRegions };
}

function applyLayerMetadataField(
  layer: Layer,
  field: MetadataPatch['field'],
  value: MetadataPatch['value'],
): Layer {
  switch (field) {
    case 'source':
      return { ...layer, source: value as SourceKind };
    case 'sourceRef':
      return { ...layer, sourceRef: value as string | undefined };
    case 'paramOwnership':
      return { ...layer, paramOwnership: value as ParamOwnership };
    default:
      throw new PatchError('IR_PATCH_PATH_NOT_ALLOWED', [
        `layer metadata field '${field}' not allowed`,
      ]);
  }
}

function applyRegionMetadataField(
  region: Region,
  field: MetadataPatch['field'],
  value: MetadataPatch['value'],
): Region {
  switch (field) {
    case 'source':
      return { ...region, source: value as SourceKind };
    case 'sourceRef':
      return { ...region, sourceRef: value as string | undefined };
    default:
      throw new PatchError('IR_PATCH_PATH_NOT_ALLOWED', [
        `region metadata field '${field}' not allowed`,
      ]);
  }
}

// ============================================================================
// 7. applyTopologyPatch - add / remove / replace / reorder
// ============================================================================

/**
 * 应用 TopologyPatch（非原子）。
 *
 * IR 上下文校验：
 *   - add: payload.id 已存在 → IR_PATCH_DUPLICATE_ID
 *   - remove: targetId 仍被引用 → IR_PATCH_DANGLING_REF
 *   - replace: targetId 不存在 → IR_PATCH_TARGET_NOT_FOUND
 *              payload.id !== targetId → IR_PATCH_VIOLATION
 *   - reorder: newOrder 与现有 id 集合不一致 → IR_PATCH_VIOLATION
 *
 * 失败时 throw PatchError。
 *
 * 注：依赖 assertPatchValid() 已确保 payload shape 与 patch.entity 一致
 *     （layer payload 含 opcode / region payload 含 layerRefs / effect payload 含 type）。
 *     本函数不重复做 shape 校验。
 */
function applyTopologyPatch(ir: RenderIR, patch: TopologyPatch): RenderIR {
  switch (patch.op) {
    case 'add':
      return applyTopologyAdd(ir, patch);
    case 'remove':
      return applyTopologyRemove(ir, patch);
    case 'replace':
      return applyTopologyReplace(ir, patch);
    case 'reorder':
      return applyTopologyReorder(ir, patch);
    default:
      throw new PatchError('IR_PATCH_VIOLATION', [
        `unknown topology op: ${patch.op}`,
      ]);
  }
}

function applyTopologyAdd(ir: RenderIR, patch: TopologyPatch): RenderIR {
  const entity = patch.payload as Layer | Region | Effect;
  const id = (entity as { id: string }).id;

  if (patch.entity === 'layer') {
    if (findLayerIndex(ir, id) >= 0) {
      throw new PatchError('IR_PATCH_DUPLICATE_ID', [
        `layer '${id}' already exists`,
      ]);
    }
    return { ...ir, layers: [...ir.layers, entity as Layer] };
  }
  if (patch.entity === 'region') {
    if (findRegionIndex(ir, id) >= 0) {
      throw new PatchError('IR_PATCH_DUPLICATE_ID', [
        `region '${id}' already exists`,
      ]);
    }
    return { ...ir, regions: [...ir.regions, entity as Region] };
  }
  // effect
  if (findEffectIndex(ir, id) >= 0) {
    throw new PatchError('IR_PATCH_DUPLICATE_ID', [
      `effect '${id}' already exists`,
    ]);
  }
  return { ...ir, effects: [...ir.effects, entity as Effect] };
}

function applyTopologyRemove(ir: RenderIR, patch: TopologyPatch): RenderIR {
  const targetId = patch.targetId!;

  // 检查 dangling ref
  if (patch.entity === 'layer') {
    if (findLayerIndex(ir, targetId) < 0) {
      throw new PatchError('IR_PATCH_TARGET_NOT_FOUND', [
        `layer '${targetId}' not found`,
      ]);
    }
    // 检查是否有 region 仍引用该 layer
    const refByRegions = ir.regions.filter((r) => r.layerRefs.includes(targetId));
    if (refByRegions.length > 0) {
      throw new PatchError('IR_PATCH_DANGLING_REF', [
        `layer '${targetId}' still referenced by regions: ${refByRegions.map((r) => r.id).join(', ')}`,
      ]);
    }
    // 检查是否有 effect.targetLayer 指向该 layer
    const refByEffects = ir.effects.filter((e) => e.targetLayer === targetId);
    if (refByEffects.length > 0) {
      throw new PatchError('IR_PATCH_DANGLING_REF', [
        `layer '${targetId}' still referenced by effects: ${refByEffects.map((e) => e.id).join(', ')}`,
      ]);
    }
    return { ...ir, layers: ir.layers.filter((l) => l.id !== targetId) };
  }

  if (patch.entity === 'region') {
    if (findRegionIndex(ir, targetId) < 0) {
      throw new PatchError('IR_PATCH_TARGET_NOT_FOUND', [
        `region '${targetId}' not found`,
      ]);
    }
    // 检查是否有 effect.targetRegion 指向该 region
    const refByEffects = ir.effects.filter((e) => e.targetRegion === targetId);
    if (refByEffects.length > 0) {
      throw new PatchError('IR_PATCH_DANGLING_REF', [
        `region '${targetId}' still referenced by effects: ${refByEffects.map((e) => e.id).join(', ')}`,
      ]);
    }
    return { ...ir, regions: ir.regions.filter((r) => r.id !== targetId) };
  }

  // effect
  if (findEffectIndex(ir, targetId) < 0) {
    throw new PatchError('IR_PATCH_TARGET_NOT_FOUND', [
      `effect '${targetId}' not found`,
    ]);
  }
  return { ...ir, effects: ir.effects.filter((e) => e.id !== targetId) };
}

function applyTopologyReplace(ir: RenderIR, patch: TopologyPatch): RenderIR {
  const entity = patch.payload as Layer | Region | Effect;
  const payloadId = (entity as { id: string }).id;
  const targetId = patch.targetId!;

  // freeze-1 严格约束：replace 必须保持同 id
  // （validatePatch 已检查 payload.id === targetId，此处防御性再次校验）
  if (payloadId !== targetId) {
    throw new PatchError('IR_PATCH_VIOLATION', [
      `replace payload.id '${payloadId}' must match targetId '${targetId}'`,
    ]);
  }

  if (patch.entity === 'layer') {
    const idx = findLayerIndex(ir, targetId);
    if (idx < 0) {
      throw new PatchError('IR_PATCH_TARGET_NOT_FOUND', [
        `layer '${targetId}' not found`,
      ]);
    }
    const newLayers = ir.layers.slice();
    newLayers[idx] = entity as Layer;
    return { ...ir, layers: newLayers };
  }
  if (patch.entity === 'region') {
    const idx = findRegionIndex(ir, targetId);
    if (idx < 0) {
      throw new PatchError('IR_PATCH_TARGET_NOT_FOUND', [
        `region '${targetId}' not found`,
      ]);
    }
    const newRegions = ir.regions.slice();
    newRegions[idx] = entity as Region;
    return { ...ir, regions: newRegions };
  }
  // effect
  const idx = findEffectIndex(ir, targetId);
  if (idx < 0) {
    throw new PatchError('IR_PATCH_TARGET_NOT_FOUND', [
      `effect '${targetId}' not found`,
    ]);
  }
  const newEffects = ir.effects.slice();
  newEffects[idx] = entity as Effect;
  return { ...ir, effects: newEffects };
}

function applyTopologyReorder(ir: RenderIR, patch: TopologyPatch): RenderIR {
  const newOrder = (patch.payload as { newOrder: string[] }).newOrder;

  if (patch.entity === 'layer') {
    // 校验 newOrder 与现有 id 集合一致（重复 id 会被 Set 去重，导致 size 不匹配）
    const existingIds = new Set(ir.layers.map((l) => l.id));
    const newOrderSet = new Set(newOrder);
    if (existingIds.size !== newOrderSet.size || !setEqual(existingIds, newOrderSet)) {
      throw new PatchError('IR_PATCH_VIOLATION', [
        `reorder newOrder does not match existing layer id set`,
      ]);
    }
    const idToLayer = new Map(ir.layers.map((l) => [l.id, l] as const));
    const newLayers = newOrder.map((id) => idToLayer.get(id)!);
    return { ...ir, layers: newLayers };
  }
  if (patch.entity === 'region') {
    const existingIds = new Set(ir.regions.map((r) => r.id));
    const newOrderSet = new Set(newOrder);
    if (existingIds.size !== newOrderSet.size || !setEqual(existingIds, newOrderSet)) {
      throw new PatchError('IR_PATCH_VIOLATION', [
        `reorder newOrder does not match existing region id set`,
      ]);
    }
    const idToRegion = new Map(ir.regions.map((r) => [r.id, r] as const));
    const newRegions = newOrder.map((id) => idToRegion.get(id)!);
    return { ...ir, regions: newRegions };
  }
  // effect
  const existingIds = new Set(ir.effects.map((e) => e.id));
  const newOrderSet = new Set(newOrder);
  if (existingIds.size !== newOrderSet.size || !setEqual(existingIds, newOrderSet)) {
    throw new PatchError('IR_PATCH_VIOLATION', [
      `reorder newOrder does not match existing effect id set`,
    ]);
  }
  const idToEffect = new Map(ir.effects.map((e) => [e.id, e] as const));
  const newEffects = newOrder.map((id) => idToEffect.get(id)!);
  return { ...ir, effects: newEffects };
}

// ============================================================================
// 8. applyAtomicTopologyPatch
// ============================================================================

/**
 * 应用 AtomicTopologyPatch：原子替换 layer.opcode + params 或 effect.type + params。
 *
 * 语义：要么全成（newOpcode + newParams 同时应用），要么全失败（不部分修改）。
 *
 * 实现策略：先做 IR 上下文校验，校验通过后再 immutable 替换。
 * 校验失败时 throw PatchError，原 ir 保持不变（因为还没开始修改）。
 *
 * IR 上下文校验：
 *   - targetId 不存在 → IR_PATCH_TARGET_NOT_FOUND
 *
 * 注：AtomicTopologyPatch 不支持 region（骨架 §4.2.3）。
 */
function applyAtomicTopologyPatch(
  ir: RenderIR,
  patch: AtomicTopologyPatch,
): RenderIR {
  if (patch.targetEntity === 'layer') {
    const p = patch as AtomicLayerTopologyPatch;
    const idx = findLayerIndex(ir, p.targetId);
    if (idx < 0) {
      throw new PatchError('IR_PATCH_TARGET_NOT_FOUND', [
        `layer '${p.targetId}' not found`,
      ]);
    }
    const newLayer: Layer = {
      ...ir.layers[idx],
      opcode: p.newOpcode,
      params: p.newParams,
    };
    const newLayers = ir.layers.slice();
    newLayers[idx] = newLayer;
    return { ...ir, layers: newLayers };
  }

  // targetEntity === 'effect'
  const p = patch as AtomicEffectTopologyPatch;
  const idx = findEffectIndex(ir, p.targetId);
  if (idx < 0) {
    throw new PatchError('IR_PATCH_TARGET_NOT_FOUND', [
      `effect '${p.targetId}' not found`,
    ]);
  }
  const newEffect: Effect = {
    ...ir.effects[idx],
    type: p.newType,
    params: p.newParams,
  };
  const newEffects = ir.effects.slice();
  newEffects[idx] = newEffect;
  return { ...ir, effects: newEffects };
}

// ============================================================================
// 9. applyPatchBatchInternal - batch 顺序应用 + 失败回滚
// ============================================================================

/**
 * 内部：应用 PatchBatch。
 *
 * 策略（用户拍板）：
 *   - 顺序应用每个子 patch
 *   - 任一失败立即停止
 *   - 返回原 ir + errors + appliedCount=0（整批回滚）
 *   - 不 throw，由调用方通过 outcome.errors 判断是否成功
 *
 * 注意：PatchBatch 内禁止含 AtomicTopologyPatch（validatePatch 已强制）。
 */
function applyPatchBatchInternal(
  ir: RenderIR,
  batch: PatchBatch,
): PatchApplyOutcome {
  const allScopes = new Set<PatchScope>();
  let currentIr = ir;

  for (let i = 0; i < batch.patches.length; i++) {
    const subPatch = batch.patches[i];
    try {
      // 单 patch 应用（失败会 throw）
      currentIr = applySinglePatchChecked(currentIr, subPatch);
      // 收集 cache scope
      for (const s of getAffectedCacheScopes(subPatch)) {
        allScopes.add(s);
      }
    } catch (err) {
      // 整批回滚：返回原 ir
      const error = err instanceof PatchError
        ? err
        : new PatchError('IR_PATCH_VIOLATION', [String(err)]);
      return {
        ir, // 原始输入 ir
        affectedScopes: Array.from(allScopes), // 已成功部分仍报告 scope（信息性）
        appliedCount: 0, // 整批回滚，最终提交 0
        errors: [error],
      };
    }
  }

  return {
    ir: currentIr,
    affectedScopes: Array.from(allScopes),
    appliedCount: batch.patches.length,
  };
}

// ============================================================================
// 10. Helper: 索引查找
// ============================================================================

function findLayerIndex(ir: RenderIR, id: string): number {
  for (let i = 0; i < ir.layers.length; i++) {
    if (ir.layers[i].id === id) return i;
  }
  return -1;
}

function findRegionIndex(ir: RenderIR, id: string): number {
  for (let i = 0; i < ir.regions.length; i++) {
    if (ir.regions[i].id === id) return i;
  }
  return -1;
}

function findEffectIndex(ir: RenderIR, id: string): number {
  for (let i = 0; i < ir.effects.length; i++) {
    if (ir.effects[i].id === id) return i;
  }
  return -1;
}

// ============================================================================
// 11. Helper: setParamPath - 严格模式（不自动创建中间对象）
// ============================================================================

/**
 * JsonObject 类型别名：明确表达"当前节点一定是 plain object"。
 */
type JsonObject = Record<string, JsonLiteral>;

/**
 * 修改 params 的指定路径值（点分嵌套路径）。
 *
 * 严格模式（freeze-1 收口）：
 *   - 单段路径：直接 set
 *   - 多段路径：
 *     - 中间对象不存在 → IR_PATCH_PATH_NOT_ALLOWED（不自动创建）
 *     - 中间值不是 object → IR_PATCH_PATH_NOT_ALLOWED
 *
 * immutable：仅替换路径上的对象，其余引用不变。
 *
 * 例如：
 *   setParamPath({a:{b:1}}, 'a.b', 2) → {a:{b:2}}
 *   setParamPath({a:1}, 'a.b', 2)     → IR_PATCH_PATH_NOT_ALLOWED（'a' 不是 object）
 *   setParamPath({}, 'a.b', 2)        → IR_PATCH_PATH_NOT_ALLOWED（'a' 不存在，不自动创建）
 */
function setParamPath(
  params: Params,
  path: string,
  value: JsonLiteral,
): Params {
  const segments = path.split('.');
  if (segments.length === 0) {
    throw new PatchError('IR_PATCH_PATH_NOT_ALLOWED', [
      `empty paramKey path`,
    ]);
  }
  const result: JsonObject = { ...params };
  setNestedValue(result, segments, value);
  return result;
}

function setNestedValue(
  obj: JsonObject,
  segments: string[],
  value: JsonLiteral,
): void {
  if (segments.length === 1) {
    obj[segments[0]] = value;
    return;
  }
  const [head, ...rest] = segments;
  const existing = obj[head];

  // 严格模式：中间对象不存在 → 拒绝（不自动创建）
  if (existing === undefined || existing === null) {
    throw new PatchError('IR_PATCH_PATH_NOT_ALLOWED', [
      `path '${head}' does not exist, strict mode does not auto-create`,
    ]);
  }

  // 严格模式：中间值不是 plain object → 拒绝
  if (typeof existing !== 'object' || Array.isArray(existing)) {
    throw new PatchError('IR_PATCH_PATH_NOT_ALLOWED', [
      `path '${head}' is not an object, cannot descend`,
    ]);
  }

  // immutable：拷贝中间对象
  const newObj: JsonObject = { ...(existing as JsonObject) };
  obj[head] = newObj;
  setNestedValue(newObj, rest, value);
}

// ============================================================================
// 12. Helper: setEqual
// ============================================================================

function setEqual<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) {
    if (!b.has(v)) return false;
  }
  return true;
}

// ============================================================================
// 导出汇总
// ============================================================================

/**
 * 本文件导出清单：
 *
 * 类型（type-only）：
 *   - PatchApplyOutcome
 *
 * 值（value import）：
 *   - applyPatch
 *
 * 使用示例：
 *
 *   单 patch（失败 throw）：
 *     try {
 *       const outcome = applyPatch(ir, valuePatch);
 *       // outcome.ir 是新 ir
 *     } catch (e) {
 *       if (e instanceof PatchError) { ... }
 *     }
 *
 *   batch（失败返回原 ir + errors，不 throw）：
 *     const outcome = applyPatch(ir, batch);
 *     if (outcome.errors) {
 *       // batch 失败，outcome.ir 是原始 ir
 *     } else {
 *       // batch 全部成功
 *       const newIr = outcome.ir;
 *     }
 */
