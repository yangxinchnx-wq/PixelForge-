# PixelForge 实施优先级重排版

## 0. 文档定位

本文档不是路线文档的复述，而是：

- 把 Phase A-F 的边界、依赖、验收标准压到可执行粒度
- 把上一轮讨论中暴露的 6 个开放问题转化为决策矩阵
- 帮助决定是否把 Region-first 立为新核心方向

阅读顺序：先看 §1 总览 → 看 §3 决策矩阵 → 再看 §2 Phase 细节。

---

## 1. Phase 总览

| Phase | 目标 | 核心交付 | 阻塞依赖 | 是否触及核心方向 |
|---|---|---|---|---|
| A | GPU 最小渲染闭环 | WebGPU 初始化 + storage texture 直写 + 64-bit pipeline + 单帧静态渲染 | 无 | **是**：opcode 选择决定 region-first 还是 per-pixel |
| B | Pixel Compiler 闭环 | RequirementClarifier + Render IR + 64-bit encoder + region-first 编译 + 增量上传 | A 完成 | **是**：Render IR 设计决定与 WDL 的边界 |
| C | Worker + 渐进式预览 | tile-based worker + 多分辨率预览 + compile cache + partial upload | B 完成 | 否 |
| D | 图像理解 Phase 1 | resize/blur/integral + adaptive split + ColorBlockTree + toLLMView | B 完成 | 否 |
| E | LLM 接入 | callLLM + JSON schema + 失败回退 + prompt cache | D 完成（或与 D-2 并行） | 否 |
| F | Timeline / Revision | 进入可编辑视频语义层 | E 完成 | **是**：触发 WDL/Scene Graph/Director 是否启动 |

**关键节点**：
- Phase A 完成后，必须立即决策 Region-first 是否立为核心
- Phase B 完成后，必须明确 Render IR / WDL 边界
- Phase F 启动前，必须明确 L3 接入点

---

## 2. Phase 详细展开

### Phase A：GPU 最小渲染闭环

**目标**：证明 PixelForge 底层渲染模型成立。

**必做项**：
1. WebGPU device 初始化 + capability negotiation
2. storage texture 直写（compute shader → texture → render pass 采样显示）
3. 64-bit descriptor pipeline
4. 最小 opcode 集合（见决策矩阵 DM-3）
5. 单帧静态渲染
6. 性能面板（CPU/GPU 耗时分离可观测）

**验收标准**：
- 1080p 单帧稳定渲染
- profile / pipeline 可切换
- 单帧渲染耗时可测（dispatch time、texture write time、present time 分离）
- WebGPU 不可用时有明确降级路径

**阻塞依赖**：无。

**开放问题**：
- DM-1：是否采用 Region-first 作为主路径？
- DM-3：opcode 最小集选择？
- DM-5：输出策略——storage texture 优先，buffer 仅用于导出？

**完成后必须决策**：
- Region-first 是否立为核心方向（影响 Phase B 的 Render IR 设计）

---

### Phase B：Pixel Compiler 闭环

**目标**：从结构化参数到 descriptor / render plan。

**必做项**：
1. RequirementClarifier（含三种结果：auto-resolved / needs-confirmation / rejected）
2. 规则 parser（非 LLM 版本，先做 hard-coded 规则）
3. Render IR（见决策矩阵 DM-2）
4. 64-bit encoder
5. region-first 编译策略
6. 增量上传（修改单参数不重编全帧）

**验收标准**：
- 文本输入可生成画面（先支持简单 prompt：纯色背景、渐变、基础几何）
- 修改单参数可局部更新（不需要重新编译全帧）
- CPU/GPU 耗时分离可观测
- RequirementClarifier 能在尺寸与性能冲突时拒绝执行

**阻塞依赖**：Phase A 完成。

**开放问题**：
- DM-2：Render IR 与 WDL 的边界？
- DM-6：Phase B-E 期间编辑走参数 patch 还是 mini revision layer？

**完成后必须决策**：
- Render IR 的字段范围（决定 L3 能否干净挂接）

---

### Phase C：Worker + 渐进式预览

**目标**：让交互变快。

**必做项**：
1. tile-based worker 编译
2. 多分辨率预览（低分辨率先出，高分辨率后台细化）
3. compile cache（key 见 §4.3）
4. partial upload（仅上传变化的 tile）
5. 动态 worker pool（基于 navigator.hardwareConcurrency，不假设 24 线程）

**验收标准**：
- 预览首屏低延迟（具体数字待真实环境测量，不预设目标）
- 高分辨率后台细化不阻塞 UI
- 大图不会卡死主线程
- worker 数量根据硬件动态裁剪

**阻塞依赖**：Phase B 完成。

**开放问题**：无关键开放问题。

---

### Phase D：图像理解 Phase 1

**目标**：把参考图转为结构树。

**必做项**：
1. resize / blur / integral images
2. adaptive split（基于自适应阈值，不用固定 VARIANCE_THRESHOLD）
3. color block tree
4. toLLMView 序列化（树形文本输出）
5. 复杂度预算控制（见 §4.6）

**验收标准**：
- 典型风格化图可生成稳定树结构
- LLM 能读懂 toLLMView 输出
- 对超出预算的图能自动降级（降分辨率 / 提阈值 / 合并微块）
- 能力边界明确：风格化图、构图清晰插画、大块区域主导场景

**阻塞依赖**：Phase B 完成。

**开放问题**：
- DM-4：LLM 是否提前到 Phase D-2 并行？

---

### Phase E：LLM 接入

**目标**：把规则 parser 升级为语义 parser。

**必做项**：
1. callLLM()（封装 OpenAI/Claude，支持流式、重试、temperature）
2. JSON schema 校验（LLM 输出必须通过 schema 才能进入编译层）
3. 失败回退到规则 parser
4. prompt cache

**验收标准**：
- LLM 解析稳定（schema 校验通过率 > 阈值，待真实测试）
- 出错可回退到规则 parser，不破坏编译链
- LLM 输出永远不直接进入渲染层（必须经过 Render IR）

**阻塞依赖**：Phase D 完成（或与 D-2 并行）。

---

### Phase F：Timeline / Revision

**目标**：进入可编辑视频语义层。

**必做项**：
1. Timeline（参考 Chapter 26 §4 的 9 条 Track）
2. Revision Layer（参考 Chapter 25 §4 的 5 层堆栈）
3. 关键帧系统（参考 Chapter 26 §29 统一 Keyframe 结构）
4. 修改走 §30 Revision Compiler 流程

**验收标准**：
- 可生成 5-30s 的简单视频
- 修改单帧不重渲全片
- Revision Layer 可回退

**阻塞依赖**：Phase E 完成。

**完成后必须决策**：
- 是否启动 WDL / Scene Graph / Asset Genome / AI Director 的大规模工程化
- L2 为 L3 预留的接入点是否足够（见 DM-6）

---

## 3. 决策矩阵

### DM-1：Region-first 是否立为核心方向

| 选项 | 含义 | 影响范围 | 风险 |
|---|---|---|---|
| A. 立为核心 | 修订 Chapter 12/13/19/20/21 中 per-pixel 主路径论述 | 5 章重写；descriptor profile 重新定义；opcode 设计偏向 region 程序 | 文档原文核心论述被推翻，需要重新建立项目身份 |
| B. 保留原文 | Region-first 仅作为首期实施策略 | 文档不动；补充说明与原文并存；实施者按场景选择 | 矛盾长期存在；新人读文档会困惑；测试用例难以统一 |
| C. 折中 | 把 per-pixel 重新定义为"特定场景的优化路径"，Region-first 立为主路径 | 修订 Chapter 12/13 表述但不推翻核心；保留 per-pixel 作为高级特性 | 工作量中等；不彻底；可能两边都不满意 |

**我的倾向**：选项 C。理由：
- 选项 A 工作量过大，且原文 per-pixel 思路在局部场景（手工冻结、复杂 mask）确实有用
- 选项 B 矛盾无法解决
- 选项 C 把两者定位为"主路径 vs 特殊场景"，符合补充说明 §3 的实际需求

**建议决策时机**：Phase A 完成后立即决策。

---

### DM-2：Render IR 与 WDL 的边界

| 选项 | Render IR 范围 | WDL 范围 | 影响 |
|---|---|---|---|
| A. Render IR 严格限定为 L1 输入 | canvas + layers + regions + effects + compileHints | 描述世界（Entity/Relation/Time） | 职责清晰；Timeline/Revision 通过修改 Render IR 起作用，不嵌入 |
| B. Render IR 含 Timeline 字段 | + animation/TimelineIR | 同上 | 补充说明 §7 的写法；但 L3 字段侵入 L1，职责越界 |
| C. 合并 Render IR 与 WDL | 不存在 Render IR，全部由 WDL 表达 | 含 2D 渲染语义 | 文档减少一层；但 WDL 必须同时描述世界和 2D 渲染，过载 |

**我的倾向**：选项 A。Render IR 严格不含 Timeline/Revision 字段。

**建议决策时机**：Phase B 启动时。

---

### DM-3：opcode 最小集（Phase A）—— 已收口

**修订状态**：原推荐集 1（5 个 opcode 含 BLEND）已废弃。BLEND 需独立 blend pass shader，Phase A 单 pass 闭环不适合实现，BLEND 推迟到 Phase B。

**最终收口结论**（与 [骨架说明 §0.1/§4.3/§9.1](file:///c:/Users/yangx/Desktop/2号想法/PixelForge_首期工程骨架设计说明.md) 同步）：

| Phase A 4 个 opcode | 用途 |
|---|---|
| `SOLID_COLOR` (0) | 纯色背景 / 遮罩 / 兜底 |
| `LINEAR_GRADIENT` (1) | 天空 / 柔光过渡 |
| `NOISE` (2) | 程序化纹理最小证明 |
| `CIRCLE_SHAPE` (4) | 基础几何区域与 mask |
| `BLEND` (3) | **Phase B 启用**（独立 blend pass，不进 region_eval） |

**理由**：
- BLEND 需要多 pass + intermediate texture，破坏 Phase A 单 pass 闭环目标
- 4 个 opcode 已能覆盖 Phase A 验收场景（纯色、渐变、噪声、几何）
- BLEND 移到 Phase B 后，骨架的 `region_eval.wgsl` 设计更干净（不掺合多 pass 逻辑）
- opcode=3 保留为 BLEND 占位号，Phase A 在 RegionCompiler 中遇到直接抛 `COMPILE_ERROR`

**建议决策时机**：Phase A 启动前。**已定**。

---

### DM-4：LLM 接入时机

| 选项 | 顺序 | 影响 |
|---|---|---|
| A. 按补充说明 | Phase D（图像理解） → Phase E（LLM） | 图像理解的 toLLMView 输出无法立即验证（需要 LLM 才能验证语义可读性） |
| B. LLM 提前到 D-2 | Phase D-1（图像结构）→ Phase D-2（基础 LLM）→ Phase E（完整 LLM） | toLLMView 输出可立即被 LLM 验证；但 LLM 接入分两次做 |
| C. LLM 提前到 B 末 | Phase B 末尾接入基础 callLLM，规则 parser 一开始就有 LLM 兜底 | 风险高；Phase B 应该是确定性的规则链路，不应早接入 LLM 不确定性 |

**我的倾向**：选项 B。理由：
- 选项 A 在 Phase D 完成时无法验证 toLLMView 的实际可用性
- 选项 C 把 LLM 不确定性过早引入 Phase B，破坏编译闭环的可测性
- 选项 B 让 LLM 接入分两步，Phase D-2 仅做"基础语义解析"，Phase E 做完整 schema + 回退 + cache

**建议决策时机**：Phase D 启动前。

---

### DM-5：输出策略 —— 已收口

**修订状态**：原"我的倾向"推荐 fallback 到 B 的方案已废弃。Phase A 不做 fallback，不支持就熔断退出。

**最终收口结论**（与 [骨架说明 §4.5/§9.2](file:///c:/Users/yangx/Desktop/2号想法/PixelForge_首期工程骨架设计说明.md) 同步，方案 A）：

| 决策项 | 结论 |
|---|---|
| 实时预览输出路径 | compute shader → storage texture（rgba8unorm 直写）→ present pass 采样显示 |
| Canvas 格式 | `navigator.gpu.getPreferredCanvasFormat()`（与 storage texture 格式分离） |
| Storage texture 格式 | 强制 `rgba8unorm` |
| 不支持时的处理 | **直接抛 `gpu_capability_error`，不 fallback 到 buffer 路径** |
| 导出场景 | compute → buffer → CPU 回读（Phase A 不实现，仅设计预留） |

**修订理由**：
- 原 fallback 方案导致 Phase A 需要维护两套 shader（storage texture 版 + buffer 版），违背"最小闭环"目标
- 现代浏览器（Chrome/Edge 113+）均支持 `rgba8unorm` storage texture，不支持比例极低
- 不支持就报错让用户换浏览器，比维护 fallback 路径更符合工程现实
- 与骨架 §9.2 验收清单"capability 不支持 rgba8unorm storage texture 时抛 gpu_capability_error（方案 A）"完全对齐

**建议决策时机**：Phase A 启动前。**已定**。

---

### DM-6：L2 为 L3 预留接入点 + Phase B-E 编辑模型

**子问题 1：L3 接入点**

| 选项 | 含义 | 风险 |
|---|---|---|
| A. L2 显式预留 hook | Render IR 含可选 world_ref 字段；SemanticElement 含可选 entity_id | Phase B-E 工程量略增；L3 接入干净 |
| B. L2 不预留 | L3 启动时再考虑接入 | Phase B-E 工程量最小；L3 接入时可能需要重写 L2 |

**我的倾向**：选项 A。Render IR 含 `world_ref?: { scene_graph_id, entity_id }` 可选字段，L2 不依赖但 L3 可挂接。

**子问题 2：Phase B-E 编辑模型**

| 选项 | Phase B-E 编辑方式 | 影响 |
|---|---|---|
| A. 仅参数 patch + cache invalidation | 改参数 → 重编受影响 tile → 上传 | 简单；无历史；不可回退 |
| B. mini revision layer（仅保存参数 diff） | 改参数 → 进入 mini revision layer → 触发重编 | 可回退一步；但与 Phase F 的完整 Revision Layer 不兼容 |
| C. 直接引入完整 Revision Layer | Phase B 即接入 Chapter 25 §4 的 5 层堆栈 | 过度设计；Phase B 复杂度爆炸 |

**我的倾向**：选项 A。Phase B-E 走"参数 patch + cache invalidation"，Phase F 才引入完整 Revision Layer。两套编辑模型不并存，Phase F 启动时把 mini 历史丢弃（接受不向后兼容）。

**建议决策时机**：Phase B 启动前。

---

## 4. 跨 Phase 硬约束

### 4.1 Schema first

LLM 输出、Render IR、Descriptor Profile、Timeline Content 都必须有 JSON schema。
不接受"看起来像 JSON"。

### 4.2 Deterministic seed

所有 procedural effect 必须支持 seed 固定复现。
否则 revision、timeline、缓存、局部重渲染都会失效。

### 4.3 Compile cache key

缓存键至少包含：
- prompt hash / semantic hash
- resolution
- profile id
- seed
- region hash

> **freeze-1 修订**：原 `time segment` 已移出 cache key，对齐骨架 §4.1.0 静态边界硬约束（Render IR 不携带时间语义）与骨架 §4.6.6 三层 CacheKeySet 设计。时间相关动画通过高频 ValuePatch 在主线程推动，不进入编译期 cache key。

### 4.4 Error taxonomy

统一错误类型（顶层分类）：

- parse error
- validation error
- compile error
- gpu capability error
- runtime shader error
- llm contract error
- **patch transaction error**（freeze-1 新增）

#### Patch 错误码（与骨架 §4.2.9 同步）

patch transaction error 下的具体错误码（type literal union，详见 [骨架 §4.2.9](file:///c:/Users/yangx/Desktop/2号想法/PixelForge_首期工程骨架设计说明.md)）：

```typescript
type PatchErrorCode =
  | 'IR_PATCH_VIOLATION'                  // 通用 patch 违规
  | 'IR_STATIC_BOUNDARY_VIOLATION'        // 违反静态边界硬约束
  | 'IR_PATCH_TARGET_NOT_FOUND'           // targetId 不存在
  | 'IR_PATCH_DUPLICATE_ID'              // add 时 id 重复
  | 'IR_PATCH_DANGLING_REF'              // remove 时仍有引用 / setLayerRefs 引用不存在
  | 'IR_PATCH_SCHEMA_MISMATCH'            // params 不匹配 opcode schema
  | 'IR_PATCH_PATH_NOT_ALLOWED'           // value patch path 不在白名单 / 指向非 params
  | 'IR_PATCH_INVALID_VALUE'              // 数值越界（radius < 0 / 负尺寸 / NaN）
  | 'IR_PATCH_ATOMIC_INCOMPLETE'          // AtomicTopologyPatch 缺 newOpcode 或 params
  | 'IR_PATCH_BATCH_NESTED'              // PatchBatch 嵌套 PatchBatch
  | 'IR_PATCH_TRANSACTION_CONFLICT';      // 同 frame 内 atomic patch 与普通 patch 冲突
```

`IR_PATCH_TRANSACTION_CONFLICT` 为 freeze-1 新增错误码：当 PatchEngine 在 `endFrame` 时检测到同一 frame 内既存在 `setCanvas` / AtomicTopologyPatch 与普通 patch 共存，或同一事务内的 patch 互相冲突时抛出。Phase B 强制 `beginFrame` / `endFrame` 时启用此检查（见骨架 §4.2.5 PatchEngine 接口）。

### 4.5 Capability negotiation

启动时必须检测：
- WebGPU 可用性
- storage texture 支持
- 最大 buffer size
- workgroup 限制
- 浏览器特性差异

并据此决定 profile、tile size、preview strategy、output strategy。

### 4.6 复杂度预算（图像理解）

| 指标 | 默认上限 |
|---|---|
| maxNodeCount | 5000（待真实测试调整） |
| maxDepth | 7 |
| maxLLMContextChars | 8000 |
| maxTinyObjectNodes | 200 |
| maxAnalysisTimeMs | 5000 |

超预算时按顺序降级：降分辨率 → 提阈值 → 限制深度 → 合并低显著度微块 → 仅保留关注区域。

### 4.7 性能指标制度化

#### CPU 指标
- requirement clarify time
- parser time
- render IR build time
- descriptor encode time
- worker merge time

#### GPU 指标
- pipeline switch cost
- compute dispatch time
- texture write time
- present time

#### 内存指标
- descriptor buffer bytes
- auxiliary buffer bytes
- texture memory bytes
- worker temporary memory bytes

#### 交互指标
- prompt → preview latency
- parameter change → visible update latency
- full compile time
- export throughput

没有这些指标，"性能优先"停留在口号。

---

## 5. 推荐执行路径

```text
Phase A（GPU 最小闭环）
  ├─ 决策 DM-3（opcode 最小集）
  ├─ 决策 DM-5（输出策略）
  └─ 完成
       ↓
决策 DM-1（Region-first 是否立为核心）  ← 关键节点
       ↓
Phase B（Pixel Compiler 闭环）
  ├─ 决策 DM-2（Render IR / WDL 边界）
  ├─ 决策 DM-6（L3 接入点 + 编辑模型）
  └─ 完成
       ↓
Phase C（Worker + 渐进式预览）
       ↓
Phase D-1（图像理解结构）
       ↓
决策 DM-4（LLM 时机）
       ↓
Phase D-2（基础 LLM）→ Phase E（完整 LLM）
       ↓
Phase F（Timeline / Revision）
       ↓
决策：是否启动 L3（WDL/Scene Graph/Genome/Director）大规模工程化
```

---

## 6. 实施声明（建议加入路线文档顶部）

```text
实施声明：

1. 首期以 Pixel Compiler + WebGPU Render Runtime 为主线闭环。
2. WDL / Scene Graph / Asset Genome / Timeline / AI Director 属于上层语义系统，
   在底层 descriptor/profile/render pipeline 稳定前，不作为强依赖；
   但 L2 Semantic Authoring 必须为 L3 World Authoring 预留接入点。
3. 默认采用 Region-first + GPU-eval 的混合编译策略，
   逐像素 descriptor 仅用于必要场景（手工冻结、复杂 mask、中间缓存）。
4. 所有 LLM 输出必须经过 schema 校验，不允许直接进入渲染层。
5. 所有程序化生成必须可复现（seed 固定）。
6. 所有优化必须以可测指标为准，不以主观体感替代性能判断。
7. 性能目标（如 4K 20-40ms、24 线程并行）仅在真实环境验证后才作为设计假设。
8. 如遇架构边界不清、协议不稳定、语义与渲染职责冲突，必须暂停实现并先确认。
```

---

## 7. 待你决策的清单

按优先级排序：

1. **DM-1**：Region-first 是否立为核心方向（Phase A 完成后必决）
2. **DM-3**：Phase A opcode 最小集（Phase A 启动前必决）
3. **DM-5**：输出策略（Phase A 启动前必决）
4. **DM-2**：Render IR / WDL 边界（Phase B 启动前必决）
5. **DM-6**：L3 接入点 + Phase B-E 编辑模型（Phase B 启动前必决）
6. **DM-4**：LLM 接入时机（Phase D 启动前必决）

DM-1 是后续所有决策的前提。如果 DM-1 选 C（折中方案），DM-2/DM-3/DM-5 都可以基本按"我的倾向"推进。如果 DM-1 选 A（彻底重写），需要先回头修订路线文档再继续。

---

## 8. 与原路线文档的关系

本文档不是路线文档的替代，是**实施层的优先级重排**。

- 路线文档（PixelForge_技术实现路线.md）：描述"系统是什么"
- 本文档：描述"按什么顺序做、什么时候决策什么"

两者冲突时：
- 实施顺序以本文档为准
- 技术规范以路线文档为准
- 但若 DM-1 决策为 A 或 C，路线文档需要相应修订
