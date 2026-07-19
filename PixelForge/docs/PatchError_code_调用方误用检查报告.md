# PatchError.code 调用方误用检查报告

> **检查范围**：`2号想法/my-app/src/` 全目录
> **检查方法**：grep 所有 `PatchError` / `.code` / `.violations` / `outcome.errors` 使用点 + 逐个分析
> **检查结论**：当前项目无真正的业务调用方（Phase A 未启动），无误用 bug。但发现 2 处文档缺口 + 2 处测试覆盖缺口，已全部修复。测试过程中额外发现 1 处格式不一致（freeze-1 原有设计，非本次修改造成）。

---

## 1. 使用点清单

grep `PatchError` 在 `src/` 下只命中 4 个文件：

| 文件 | 角色 | 使用方式 |
|---|---|---|
| `compiler/ir/patch.ts` | 定义层 | 定义 `PatchError` 类 + `assertPatchValid` 构造并 throw |
| `compiler/ir/patchEngine.ts` | 实现层 | batch 失败时 catch 并透传 `PatchError` 到 `outcome.errors` |
| `compiler/ir/__tests__/patch.test.ts` | validator 测试 | G13 组测试 `PatchError.code` / `.violations` 行为 |
| `compiler/ir/__tests__/patchEngine.test.ts` | engine 测试 | C2 测试 batch 失败时 `outcome.errors[0].code` |

**关键发现**：项目里目前**没有真正的业务调用方**。Phase A 尚未启动，`applyPatch` 只被测试调用。因此不存在"误用 bug"。

---

## 2. 逐个使用点分析

### 2.1 patch.ts（定义层）

`PatchError` 类（L386-398）：
```typescript
export class PatchError extends Error {
  code: PatchErrorCode;
  violations: string[];
  constructor(code: PatchErrorCode, violations: string[]) {
    super(`Patch validation failed: ${violations[0] ?? code}`);
    this.code = code;
    this.violations = violations;
    Object.setPrototypeOf(this, PatchError.prototype);
  }
}
```

**问题**：原注释说"code 用于程序化分支处理"，暗示 code 足够用于程序化分支。但在多 violation 场景下 code 只反映首个，不一定是最严重的。

`assertPatchValid`（L866-874）：
```typescript
export function assertPatchValid(p: AnyPatch): void {
  const violations = validatePatch(p);
  if (violations.length === 0) return;
  const firstCode = extractErrorCode(violations[0]) ?? 'IR_PATCH_VIOLATION';
  throw new PatchError(firstCode, violations);
}
```

**分析**：`code` 来自 `extractErrorCode(violations[0])`，即从首个 violation 字符串中提取错误码。这是 freeze-1 的设计选择，注释已说明"首个 errorCode"。**不是 bug**，但原 `PatchError` 类注释没说清楚这个语义局限。

### 2.2 patchEngine.ts（实现层）

batch 失败处理（L678-698）：
```typescript
try {
  currentIr = applySinglePatchChecked(currentIr, subPatch);
  ...
} catch (err) {
  const error = err instanceof PatchError
    ? err
    : new PatchError('IR_PATCH_VIOLATION', [String(err)]);
  return { ir, affectedScopes: ..., appliedCount: 0, errors: [error] };
}
```

**分析**：直接透传 catch 到的 `PatchError`，保留原始 violations。**正确**，没有重新构造导致信息丢失。

`PatchApplyOutcome` 注释（L70-77）：
```typescript
/**
 * - batch 任一失败：appliedCount=0，errors 含至少一个 PatchError，ir 为原始输入
 */
```

**问题**：没说明 `errors[0].code` 的语义——它可能是 validator 失败（code 只反映首个 violation）或 apply 失败（code 准确）。

### 2.3 patch.test.ts（validator 测试）

G13-4（L728-737）：
```typescript
it('G13-4 PatchError.code === 第一个 errorCode', () => {
  // validValuePatch({ patchId: '' }) 只产生 1 个 violation
  expect(err.code).toBe('IR_PATCH_VIOLATION')
})
```

**问题**：只测单 violation 场景，没覆盖多 violation。无法验证"code 只反映首个"的设计契约。

G13-5（L739-747）：
```typescript
it('G13-5 PatchError.violations 非空', () => {
  expect(err.violations.length).toBeGreaterThan(0)
})
```

**问题**：只检查非空，不检查内容。

### 2.4 patchEngine.test.ts（engine 测试）

C2（L296-303）：
```typescript
expect(outcome.errors![0].code).toBe('IR_PATCH_TARGET_NOT_FOUND')
```

**问题**：只检查 `.code`，不检查 `.violations`。虽然当前 case 里 code 是可靠的（apply 阶段单 violation），但给未来调用方传达了"只看 code 就够"的坏榜样。

---

## 3. 修复清单

### 修复 1：patch.ts PatchError 类注释

**文件**：`compiler/ir/patch.ts` L380-385
**修改**：补充 code 与 violations 的语义关系说明，明确 code 只反映首个 violation 的设计选择，给出调用方使用建议（单 violation 可靠 vs 多 violation 检查 violations 数组）。

### 修复 2：patchEngine.ts PatchApplyOutcome 注释

**文件**：`compiler/ir/patchEngine.ts` L70-77
**修改**：补充 `errors[0].code` 语义说明：validator 失败时 code 只反映首个 violation，apply 失败时 code 准确，需要完整诊断信息时应检查 `errors[0].violations`。

### 修复 3：patch.test.ts 新增 G13-6 测试

**文件**：`compiler/ir/__tests__/patch.test.ts` G13 组
**新增测试**：`G13-6 多 violation 时 code 只反映首个（设计契约固化）`
- 构造 `validValuePatch({ patchId: '', value: new Date() })`，同时触发 `IR_PATCH_VIOLATION`（patchId 空）+ `IR_STATIC_BOUNDARY_VIOLATION`（value 非 JsonLiteral）
- 断言 violations 含至少 2 条 + 含两个不同错误码
- 断言 `code === violations[0]` 中提取的错误码（证明 code 来自首个 violation）
- **价值**：固化"code 只反映首个 violation"的设计契约，若未来改为"取最严重错误码"等策略，此测试会失败，提醒团队审视

### 修复 4：patchEngine.test.ts C2 补充 violations 检查

**文件**：`compiler/ir/__tests__/patchEngine.test.ts` C2 测试
**修改**：补充 `errors[0].violations` 非空检查 + 包含诊断信息检查，传达"batch 失败时既要看 code 也要看 violations"的好榜样。

---

## 4. 测试结果

```text
Test Files  2 passed (2)
Tests  121 passed (121)
Duration  470ms
```

- 原 120 个测试全部通过（无回归）
- 新增 G13-6 测试通过
- C2 补充断言通过

---

## 5. 蝴蝶效应分析

| 修改文件 | 修改类型 | 影响范围 | 蝴蝶效应 |
|---|---|---|---|
| `patch.ts` PatchError 类注释 | 纯注释 | 不影响构造函数逻辑、code/violations 赋值、任何导出 | ✅ 无 |
| `patchEngine.ts` PatchApplyOutcome 注释 | 纯注释 | 不影响接口定义、applyPatch 逻辑 | ✅ 无 |
| `patch.test.ts` 新增 G13-6 | 新增测试 | 不影响现有测试 | ✅ 无（121/121 通过） |
| `patchEngine.test.ts` C2 补充断言 | 增加断言 | 不修改现有断言 | ✅ 无（121/121 通过） |

**结论**：4 处修改均为注释或测试，不影响运行时行为。121/121 全通过确认无蝴蝶效应。

---

## 6. 额外发现：violations 格式不一致（freeze-1 原有设计）

在编写 C2 补充断言时，首次断言 `violations.some(v => v.includes('IR_PATCH_TARGET_NOT_FOUND'))` 失败，揭示了以下格式不一致：

| 阶段 | violations 格式 | 示例 |
|---|---|---|
| validator（`patch.ts` validatePatch） | `'ERROR_CODE: message'` | `'IR_PATCH_VIOLATION: patchId must be non-empty string'` |
| apply（`patchEngine.ts` throw） | `'message'`（无错误码前缀） | `"layer 'layer_nonexistent' not found"` |

**影响**：
- 调用方若尝试从 violations 字符串中解析错误码，在 apply 阶段会失败
- 但 `PatchError.code` 字段已携带错误码，所以不影响程序化分支处理
- 仅影响"从 violations 文本中提取错误码"的诊断逻辑

**处理方式**：**不修改**。这是 freeze-1 已收口的设计，修改它会破坏现有 120 个测试中的多个断言。记录此处供 Phase B 统一时参考。

---

## 7. 最终结论

| 检查项 | 结论 |
|---|---|
| 是否有调用方误用 `PatchError.code` | ❌ 无（项目无业务调用方） |
| 是否有调用方忽略 `PatchError.violations` | ⚠️ 测试 C2 原本只看 code，已补充 violations 检查 |
| 文档是否说清 code 语义局限 | ✅ 已修复（patch.ts + patchEngine.ts 注释补充） |
| 测试是否覆盖多 violation 场景 | ✅ 已修复（G13-6 新增） |
| 修复是否引入蝴蝶效应 | ✅ 无（121/121 全通过） |
| 是否发现其他问题 | ⚠️ violations 格式不一致（freeze-1 原有，不修改） |

**freeze-1 的 PatchError 设计是合理的**，`code` + `violations` 的双字段设计在单 violation 场景下足够可靠，在多 violation 场景下通过 violations 数组补充诊断。本次修复将这个设计契约从"隐式"提升为"显式"——通过注释说明 + 测试固化，让未来调用方和 Phase B 实现者不会踩坑。
