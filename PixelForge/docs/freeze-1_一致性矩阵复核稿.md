# freeze-1 一致性矩阵复核稿

> **复核范围**：`shared/types.ts` / `compiler/ir/renderIR.ts` / `compiler/ir/patch.ts` / `compiler/ir/patchEngine.ts` + 对应测试
> **复核方法**：逐行读取源码 + grep 错误码实际抛出位置，不依赖记忆
> **复核结论**：freeze-1 边界清楚、口径一致，但有 3 处与建议稿的命名差异需要订正（见 §4）

---

## 0. 复核依据（文件清单与行数）

| 文件 | 行数 | 职责边界 |
|---|---|---|
| `shared/types.ts` | 344 | 值层公约 + 基础领域类型（JsonLiteral / Opcode / SourceKind / ParameterOwner / CapabilityProfile / OutputStrategy 等） |
| `compiler/ir/renderIR.ts` | 563 | RenderIR 数据结构 + 静态边界守卫 + 4 个投影函数 |
| `compiler/ir/patch.ts` | 985 | Patch 协议类型 + 类型守卫 + `validatePatch` / `assertPatchValid` + `getAffectedCacheScopes` |
| `compiler/ir/patchEngine.ts` | 850 | `applyPatch` 不可变应用引擎 + IR 上下文校验 + batch 回滚 |
| `__tests__/patch.test.ts` | 112 cases | validator 层回归 |
| `__tests__/patchEngine.test.ts` | 8 cases | apply 层回归 |

---

## 1. 模块职责矩阵（基于实际导出核对）

| 模块 | 责任 | 不负责 |
|---|---|---|
| `shared/types.ts` | 基础领域类型定义（JsonLiteral / Opcode / SourceKind / ParameterOwner / ParamOwnership / BoundingBox / CompileHints / WorldMetadata / CapabilityProfile / OutputStrategy / TextureFormat / BlendMode / EffectType）；`isJsonLiteral` 运行时守卫 | RenderIR 结构定义；patch 类型；运行时校验；apply 行为；DOM/WebGPU 类型耦合（用 TextureFormat 协议字符串隔离） |
| `renderIR.ts` | RenderIR / Layer / Region / Effect 结构定义；`Params` 类型唯一定义；`isParams` 守卫；`validateStaticBoundary`（三重校验：禁用字段名 + params JsonLiteral + Effect.type 禁词）；`FORBIDDEN_IR_FIELD_NAMES` / `FORBIDDEN_EFFECT_TYPE_NAMES` 常量；`CacheKeySet` + 4 个 `KeyInput` 类型；4 个投影函数（`projectStaticKey` / `projectStructuralKey` / `projectDynamicKey` / `projectMetadataKey`）；`CompileContext`（无 time 字段） | patch 类型定义；patch 合法性校验；patch 应用；cache 实际读写 |
| `patch.ts` | Patch 协议全类型（`PatchTier` / `PatchSource` / `ValuePatch` / `StructuralPatch` / `TopologyPatch` / `AtomicTopologyPatch` / `MetadataPatch` / `PatchBatch` / `RenderIRPatch` / `AnyPatch`）；`PatchErrorCode` 枚举；`PatchError` 类；类型守卫（`isValuePatch` 等 8 个）；`getPatchTier` / `getBatchTier`；`getAffectedCacheScopes`；`validatePatch`（schema/静态合法性）；`assertPatchValid`（throw 版）；`parseParamPath`；`PatchEngine` 接口定义 + `PatchEngineState`（仅接口，不实现）；`ReferenceIndex` / `PatchApplyResult` / `PatchScope` 类型 | 真正修改 IR；targetId 存在性校验（需 IR 上下文）；duplicate id 校验；dangling ref 校验；cache 实际失效 |
| `patchEngine.ts` | `applyPatch` 入口；`PatchApplyOutcome` 类型；单 patch 分发（`applySinglePatchChecked`）；5 个 apply 函数（value/structural/metadata/topology/atomic）；`setParamPath` 严格模式路径写入；batch 顺序应用 + 失败回滚（`applyPatchBatchInternal`）；IR 上下文校验（targetId 存在 / duplicate id / dangling ref / reorder 集合一致性 / replace id 一致性） | 定义 patch 类型本身；定义 PatchErrorCode；cache 实际失效（仅返回 `affectedScopes`，由调用方决定如何 invalidate）；frame 事务状态机（Phase B 才实现） |

### 1.1 与建议稿的差异

建议稿将 `renderIR.ts` 的职责描述为「RenderIR 守卫、投影/归一化相关类型约束」，实际代码还包含：
- `Params` 类型的**唯一定义**（`renderIR.ts` L49，不从 `shared/types.ts` 导入）
- `isParams` 守卫
- `validateStaticBoundary` 完整实现（不是类型约束，是运行时递归扫描）
- `CompileContext` 定义

建议稿将 `patch.ts` 的职责描述为「patch schema、类型守卫、validatePatch / validateBatch、错误聚合」，实际代码**没有独立的 `validateBatch` 函数**——batch 校验内联在 `validatePatch` 的 `isPatchBatch(p)` 分支里（L607-634）。

---

## 2. 校验分层矩阵（逐项验证 validator / engine 各自校验什么）

| 校验项 | `patch.ts`（validatePatch） | `patchEngine.ts`（apply 系列） | 备注 |
|---|---|---|---|
| patch 基本 shape（patchId 非空 / tier 合法 / 必填字段存在） | ✅ 主责 | 防御性兜底（L154 unknown type） | validator 做完整 shape 校验 |
| `tier` 字面量合法性 | ✅（通过类型守卫间接保证） | 防御性兜底 | TypeScript 编译期已保证，运行时 validator 再查 |
| `op` 字面量合法性（add/remove/replace/reorder） | ✅（`validateTopologyPatch` switch default 分支 L798） | 防御性兜底（L424 unknown op） | 两层都有 default 分支 |
| `entity` / `targetEntity` 字面量合法性 | ✅（MetadataPatch canvas/layer/region 分支 L701-711） | ✅（applyMetadataPatch 分发 L324-355） | |
| ValuePatch `paramKey` 非空 | ✅（L669） | — | |
| ValuePatch `paramKey` 首段不在 FORBIDDEN_VALUEPATCH_KEYS | ✅（L672-675） | — | 防止误改 id/opcode/visible 等非 params 字段 |
| ValuePatch `value` 是 JsonLiteral | ✅（L678-680，用 `isJsonLiteral`） | — | |
| StructuralPatch `field` 与 `value` 类型匹配 | ✅（`checkStructuralValue` L822-835） | — | |
| MetadataPatch `targetEntity='region'` 不能改 `paramOwnership` | ✅（L701-703） | — | |
| MetadataPatch `targetEntity='canvas'` 只能改 `worldMetadata` | ✅（L705-707） | — | |
| TopologyPatch `op='add'` payload 含完整实体 + id 非空 | ✅（L731-746） | — | validator 用 `isEntityObject` 做 shape 校验 |
| TopologyPatch `op='add'` 不应有 targetId | ✅（L738-740） | — | |
| TopologyPatch `op='remove'` 必有 targetId + 无 payload | ✅（L750-756） | — | |
| TopologyPatch `op='replace'` payload.id === targetId | ✅（L771-774） | ✅ 防御性再次校验（L518-522） | **两层都做**，engine 是防御性兜底 |
| TopologyPatch `op='reorder'` payload 含 `newOrder: string[]` | ✅（L779-783） | — | validator 只做 shape：每项是 string |
| TopologyPatch `op='reorder'` newOrder 每项非空 string | ✅（L786-789） | — | |
| AtomicTopologyPatch `newParams` 是 Params | ✅（L643-645） | — | |
| AtomicTopologyPatch `newOpcode`（layer）/ `newType`（effect）存在 | ✅（L647-657） | — | |
| PatchBatch `patches` 非空 | ✅（L608-611） | — | |
| PatchBatch `tier` === 子 patch 最高 tier | ✅（L613-618，用 `getBatchTier`） | — | |
| PatchBatch 不含嵌套 PatchBatch | ✅（L622-625 → `IR_PATCH_BATCH_NESTED`） | — | |
| PatchBatch 不含 AtomicTopologyPatch | ✅（L627-629 → `IR_PATCH_TRANSACTION_CONFLICT`） | — | |
| **target 是否存在** | ❌（需 IR 上下文） | ✅ 主责（所有 apply 函数开头） | 抛 `IR_PATCH_TARGET_NOT_FOUND` |
| **duplicate id**（add 时） | ❌（需 IR 上下文） | ✅ 主责（L436/444/452） | 抛 `IR_PATCH_DUPLICATE_ID` |
| **dangling ref**（remove 时） | ❌（需 IR 上下文） | ✅ 主责（L472/479/495） | 抛 `IR_PATCH_DANGLING_REF` |
| **reorder 集合一致性**（newOrder 与现有 id 集合一致） | ❌（只做 shape） | ✅ 主责（L565/577/589，用 `setEqual`） | 抛 `IR_PATCH_VIOLATION` |
| **reorder 重复 id** | ❌ | ✅（Set 去重后 size 比较捕获） | 归入集合一致性检查 |
| **strict param path**（中间对象不存在 / 非 object） | ❌（`parseParamPath` 只做语法解析） | ✅ 主责（`setParamPath` L758-804） | 抛 `IR_PATCH_PATH_NOT_ALLOWED` |
| **batch 回滚语义** | ❌ | ✅ 主责（`applyPatchBatchInternal` L671-706） | 失败返回原 ir + errors，不 throw |
| **region structural 只允许 bounds** | ✅（隐式：StructuralField 枚举 + checkStructuralValue） | ✅ 防御性（L244-248） | 两层都做 |
| **layer structural 只允许 visible** | — | ✅（`applyStructuralField` L285-288 default 抛错） | validator 通过 StructuralField 类型间接保证 |
| **effect structural 只允许 targetLayer/targetRegion** | — | ✅（`applyEffectStructuralField` L302-305 default 抛错） | 同上 |

### 2.1 核心结论

**为什么 validator 通过，不代表 apply 一定成功：**

`validatePatch` 只做「patch 自身的结构合法性」校验（shape / schema / 字面量 / payload shape），**完全不接触 IR 上下文**。以下 5 类校验必须依赖当前 IR 状态，只能在 `patchEngine.ts` 的 apply 阶段完成：

1. targetId 是否存在
2. add 时 id 是否重复
3. remove 时是否产生 dangling ref
4. reorder 时 newOrder 是否与现有 id 集合一致
5. strict param path 中间对象是否存在

这意味着：**`assertPatchValid(patch)` 通过 ≠ `applyPatch(ir, patch)` 一定成功**。调用方必须同时处理 validator 抛出的 `PatchError` 和 engine 抛出的 `PatchError`。

---

## 3. 错误码归属矩阵（grep 实际抛出位置）

> **重要实现细节**：`patch.ts` 的错误抛出方式不是直接 `throw new PatchError(code, ...)`，而是 `violations.push('CODE: message')` 字符串嵌入错误码，再由 `assertPatchValid`（L866-874）通过 `extractErrorCode` 从首个 violation 字符串中提取错误码并 throw。这意味着 `patch.ts` 里同一批 violations 可能含多个错误码，但 `PatchError.code` 只取第一个。

| 错误码 | 主要抛出层 | 实际位置 | 说明 |
|---|---|---|---|
| `IR_PATCH_VIOLATION` | `patch.ts` + `patchEngine.ts` | patch.ts: L603/609/616/640/656/665/688/710/722/734/739/744/751/755/762/767/773/781/793/798（shape 校验）；patchEngine.ts: L154/424/519/566/578/590（防御性兜底 + replace id 不一致 + reorder 集合不一致） | 通用违规。**建议稿的 `IR_PATCH_INVALID` 在实际代码中不存在**，全部归入 `IR_PATCH_VIOLATION` |
| `IR_STATIC_BOUNDARY_VIOLATION` | `patch.ts` | L679（ValuePatch value 非 JsonLiteral） | 仅此一处。静态边界硬约束的运行时强制 |
| `IR_PATCH_TARGET_NOT_FOUND` | `patchEngine.ts` | L177/193/224/238/261/332/346/465/488/504/527/538/549/624/642 | 所有 apply 函数开头的 targetId 存在性检查 |
| `IR_PATCH_DUPLICATE_ID` | `patchEngine.ts` | L436/444/452 | topology add 时 id 已存在 |
| `IR_PATCH_DANGLING_REF` | `patchEngine.ts` | L472/479/495 | topology remove 时仍有引用（layer 被 region/effect 引用，region 被 effect 引用） |
| `IR_PATCH_SCHEMA_MISMATCH` | **已定义未实现** | 仅在 L369 枚举定义 + L889 `extractErrorCode` 候选列表 | Phase A 无 OpcodeRegistry，无法校验 params 是否匹配 opcode schema。**预留错误码，当前无任何代码抛出** |
| `IR_PATCH_PATH_NOT_ALLOWED` | `patch.ts` + `patchEngine.ts` | patch.ts: L669/674/702/706（paramKey 非空 / 首段禁用 / region 无 paramOwnership / canvas 只允许 worldMetadata）；patchEngine.ts: L245/286/303/370/387/765/788/795（structural field 不允许 / metadata field 不允许 / strict path 中间对象不存在或非 object） | 两层都抛。validator 做 schema 级路径校验，engine 做运行时路径校验 |
| `IR_PATCH_INVALID_VALUE` | `patch.ts` | L693（structural field value 类型不匹配）/ L788（reorder newOrder 项非 string） | **建议稿矩阵 3 未列出此错误码**，实际存在 |
| `IR_PATCH_ATOMIC_INCOMPLETE` | `patch.ts` | L644/649/653 | AtomicTopologyPatch 缺 newParams / newOpcode / newType |
| `IR_PATCH_BATCH_NESTED` | `patch.ts` | L623 | PatchBatch 嵌套 PatchBatch |
| `IR_PATCH_TRANSACTION_CONFLICT` | `patch.ts` | L628 | PatchBatch 含 AtomicTopologyPatch（原子 patch 必须独立提交） |

### 3.1 与建议稿的差异（3 处订正）

| 建议稿错误码 | 实际代码错误码 | 说明 |
|---|---|---|
| `IR_PATCH_INVALID` | `IR_PATCH_VIOLATION` | 实际代码无 `IR_PATCH_INVALID`，所有通用违规统一用 `IR_PATCH_VIOLATION` |
| `IR_PATCH_BATCH_INVALID` | `IR_PATCH_VIOLATION` | batch 自身结构不合法（patches 为空 / tier 不匹配）也归入 `IR_PATCH_VIOLATION`，无独立错误码 |
| （未列出）`IR_PATCH_INVALID_VALUE` | `IR_PATCH_INVALID_VALUE` | 建议稿遗漏，实际用于 structural field value 类型不匹配 + reorder newOrder 项非 string |
| （未列出）`IR_PATCH_SCHEMA_MISMATCH` | `IR_PATCH_SCHEMA_MISMATCH` | 建议稿遗漏，已定义但 Phase A 未实现（无 OpcodeRegistry） |

### 3.2 错误码未交叉混用确认

逐项核对后确认：**每个错误码的语义边界清晰，无交叉混用**。

- `IR_PATCH_TARGET_NOT_FOUND` 仅用于「targetId 在当前 IR 中不存在」，不在 validator 层使用
- `IR_PATCH_DUPLICATE_ID` 仅用于「add 时 id 已存在」，不在 validator 层使用
- `IR_PATCH_DANGLING_REF` 仅用于「remove 时破坏引用完整性」，不在 validator 层使用
- `IR_PATCH_PATH_NOT_ALLOWED` 在两层都有使用，但语义一致：validator 做 schema 级路径校验（paramKey 首段禁用 / region 无 paramOwnership），engine 做运行时路径校验（strict path 中间对象不存在）。**不算交叉混用**，是同一错误码在两个抽象层级的合理复用
- `IR_PATCH_VIOLATION` 是兜底错误码，用于所有无法归入具体类别的违规

---

## 4. 5 个重点确认问题

### Q1：`patch.ts` 是否只做"schema/静态合法性"，不掺入 IR 上下文语义？

**✅ 是。**

证据：
- `validatePatch` 函数签名 `(p: AnyPatch): string[]`，**不接受 IR 参数**
- 所有校验逻辑只访问 patch 自身字段（patchId / tier / targetId / paramKey / value / payload / field / op / entity）
- `FORBIDDEN_VALUEPATCH_KEYS` 是静态常量，不依赖 IR
- `checkStructuralValue` 只校验 value 类型与 field 是否匹配，不查 IR
- `isEntityObject` 只校验 payload 是 plain object，不查 IR 中是否已存在该 id

**唯一需要注意的点**：`validatePatch` 对 TopologyPatch `op='replace'` 做了 `payload.id === targetId` 校验（L771-774）。这看似是"上下文语义"，但实际上这只是 patch 自身的内部一致性约束（replace 语义要求 payload.id 与 targetId 一致），不需要 IR 上下文。**不算掺入 IR 语义**。

### Q2：`patchEngine.ts` 是否承担所有依赖当前 IR 状态的约束？

**✅ 是。**

以下 5 类校验全部在 `patchEngine.ts` 完成，且都依赖当前 IR：

| 校验 | 位置 | 依赖的 IR 状态 |
|---|---|---|
| targetId 存在 | 所有 apply 函数开头 | `ir.layers` / `ir.regions` / `ir.effects` |
| duplicate id | `applyTopologyAdd` L435/443/451 | `ir.layers` / `ir.regions` / `ir.effects` |
| dangling ref | `applyTopologyRemove` L470/477/493 | `ir.regions.layerRefs` / `ir.effects.targetLayer` / `ir.effects.targetRegion` |
| reorder 集合一致性 | `applyTopologyReorder` L563/575/587 | `ir.layers.map(l=>l.id)` / `ir.regions.map(r=>r.id)` / `ir.effects.map(e=>e.id)` |
| strict param path 中间对象 | `setParamPath` L787/794 | `layer.params` / `effect.params` 的实际内容 |

### Q3：错误码是否没有交叉混用？

**✅ 无交叉混用。**

详见 §3.2。唯一在两层都出现的错误码是 `IR_PATCH_PATH_NOT_ALLOWED` 和 `IR_PATCH_VIOLATION`，但语义一致，是同一错误码在不同抽象层级的合理复用，非交叉混用。

### Q4：batch 语义是否统一为：成功全提交，失败零提交？

**✅ 是。**

证据（`applyPatchBatchInternal` L671-706）：
- 顺序应用每个子 patch（L678-686）
- 任一失败立即 catch（L687）
- 失败时返回**原始 ir**（L693，`ir` 而非 `currentIr`）+ `appliedCount: 0`（L695）+ `errors: [error]`（L696）
- 成功时返回 `currentIr`（L702）+ `appliedCount: batch.patches.length`（L704）+ 无 errors

测试 C2（patchEngine.test.ts L281-308）明确验证：
- `outcome.ir === baseIR`（**同一引用**，不是深拷贝）
- `outcome.appliedCount === 0`
- `baseIR.layers[0].params` 未被第 1 个 patch 修改（`{ color: [1, 0, 0, 1] }`）

**注意**：batch 失败时 `affectedScopes` 仍报告已成功部分的 scope（L694 注释"信息性"），但 `appliedCount=0`。这是设计选择——scope 是诊断信息，appliedCount 是事实。两者不矛盾。

### Q5：`affectedScopes` 是否在 validator / engine / 测试里口径一致？

**✅ 口径一致。**

| 层 | `affectedScopes` 行为 | 位置 |
|---|---|---|
| validator（`patch.ts`） | **不涉及**。`validatePatch` 返回 `string[]`（violations），不返回 scope | — |
| 计算函数（`patch.ts`） | `getAffectedCacheScopes(p): PatchScope[]`，按 tier 映射：value→`['dynamic']`，structural→`['structural','dynamic']`，topology→`['topology','structural','dynamic']`，metadata→`['metadata']`；batch 取子 patch 并集 | L561-584 |
| engine（`patchEngine.ts`） | 单 patch：调用 `getAffectedCacheScopes(patch)`（L113）；batch：在 `applyPatchBatchInternal` 内累加并集（L684-686） | L113 / L675-686 |
| 测试 A1 | `expect(outcome.affectedScopes).toEqual(['dynamic'])` | patchEngine.test.ts L145 |
| 测试 A3 | `expect(outcome.affectedScopes).toEqual(['metadata'])` | L165 |
| 测试 A5 | `expect(outcome.affectedScopes).toEqual(['topology','structural','dynamic'])` | L182-186 |
| 测试 C1（batch） | `expect(outcome.affectedScopes).toEqual(['dynamic'])`（两个 value patch 并集仍为 `['dynamic']`） | L271 |

**口径完全一致**：engine 用的就是 `patch.ts` 的 `getAffectedCacheScopes`，测试断言的期望值与该函数的映射规则完全对应。

---

## 5. 复核结论

### 5.1 freeze-1 边界清楚性评估

| 维度 | 评估 | 依据 |
|---|---|---|
| 模块职责分层 | ✅ 清楚 | §1：4 个模块职责无重叠，依赖方向单向（shared ← renderIR ← patch ← patchEngine） |
| 校验分层 | ✅ 清楚 | §2：validator 只做 schema/静态，engine 承担所有 IR 上下文校验 |
| 错误码归属 | ✅ 清楚（有 3 处命名订正） | §3：无交叉混用；建议稿的 `IR_PATCH_INVALID` / `IR_PATCH_BATCH_INVALID` 在实际代码中统一为 `IR_PATCH_VIOLATION`；`IR_PATCH_INVALID_VALUE` 建议稿遗漏；`IR_PATCH_SCHEMA_MISMATCH` 已定义未实现 |
| batch 语义 | ✅ 清楚 | §4 Q4：成功全提交，失败零提交（同一引用回滚） |
| affectedScopes 口径 | ✅ 一致 | §4 Q5：validator 不涉及，engine 用 patch.ts 的函数，测试断言与映射规则对应 |

### 5.2 需要订正的 3 处命名差异

1. **`IR_PATCH_INVALID` → `IR_PATCH_VIOLATION`**：实际代码无 `IR_PATCH_INVALID`，所有通用违规统一用 `IR_PATCH_VIOLATION`
2. **`IR_PATCH_BATCH_INVALID` → `IR_PATCH_VIOLATION`**：batch 结构不合法也归入 `IR_PATCH_VIOLATION`，无独立错误码
3. **补充 `IR_PATCH_INVALID_VALUE`**：用于 structural field value 类型不匹配 + reorder newOrder 项非 string

### 5.3 需要标注的 1 处预留错误码

- **`IR_PATCH_SCHEMA_MISMATCH`**：已在 `PatchErrorCode` 枚举中定义，但 Phase A 无 OpcodeRegistry，**当前无任何代码抛出**。Phase B 实现 OpcodeRegistry 后才会启用。

### 5.4 一个值得关注的实现细节

`patch.ts` 的 `assertPatchValid` 从 `violations[0]` 字符串中提取错误码（`extractErrorCode`，L876-881）。这意味着：
- 如果一批 violations 含多个不同错误码，`PatchError.code` 只反映第一个
- `PatchError.violations` 保留完整列表（含所有错误码字符串）
- 调用方若需要精确判断错误类型，应检查 `violations` 数组而非仅 `code`

这是 freeze-1 的设计选择，**不是 bug**，但需要在文档中明确，避免调用方误以为 `code` 能完全反映所有违规。

---

## 6. freeze-1 规范沉淀（可落盘）

基于本次复核，freeze-1 的规范可沉淀为以下 3 条硬约束：

```text
1. validatePatch(ir-free)：validatePatch 不接受 IR 参数，只做 patch 自身结构合法性校验。
   以下 5 类校验必须依赖 IR 上下文，由 applyPatch 承担：
   - targetId 存在性
   - add 时 duplicate id
   - remove 时 dangling ref
   - reorder 集合一致性
   - strict param path 中间对象存在性

2. batch 原子性：PatchBatch 顺序应用，任一失败立即停止并返回原始 ir（同一引用）+ appliedCount=0。
   不部分提交。affectedScopes 仍报告已成功部分（诊断信息），与 appliedCount=0 不矛盾。

3. 错误码层级：
   - validator 层（patch.ts）：IR_PATCH_VIOLATION / IR_STATIC_BOUNDARY_VIOLATION /
     IR_PATCH_PATH_NOT_ALLOWED / IR_PATCH_INVALID_VALUE / IR_PATCH_ATOMIC_INCOMPLETE /
     IR_PATCH_BATCH_NESTED / IR_PATCH_TRANSACTION_CONFLICT
   - engine 层（patchEngine.ts）：IR_PATCH_TARGET_NOT_FOUND / IR_PATCH_DUPLICATE_ID /
     IR_PATCH_DANGLING_REF / IR_PATCH_VIOLATION / IR_PATCH_PATH_NOT_ALLOWED
   - 预留未实现：IR_PATCH_SCHEMA_MISMATCH（Phase B OpcodeRegistry 启用后）
   - IR_PATCH_PATH_NOT_ALLOWED 在两层都出现，语义一致，是合理复用非交叉混用。
```

---

## 7. 下一步建议

freeze-1 一致性矩阵复核完成，边界已清楚。建议下一步：

1. **将本复核稿的 §5.2 订正同步到建议稿**（`IR_PATCH_INVALID` / `IR_PATCH_BATCH_INVALID` → `IR_PATCH_VIOLATION`，补充 `IR_PATCH_INVALID_VALUE`）
2. **在 `patch.ts` 的 `PatchErrorCode` 注释中标注 `IR_PATCH_SCHEMA_MISMATCH` 为"Phase B 预留"**（当前注释只说"params 不匹配 opcode schema"，未标注未实现状态）
3. **启动 Phase A 实施**（按骨架 §9 文件清单）——freeze-1 的类型层 / validator 层 / apply 层 / 测试层已完整闭环，可以放心进入 Phase A
