# PixelForge 首期工程骨架设计说明

## 0. 文档定位

### 0.1 输入约束（已确认，不再讨论）

```text
DM-1  核心能力不改，首期默认路径 = Region-first + GPU eval
      per-pixel descriptor 保留为特殊路径（手工冻结、复杂 mask、中间缓存）
DM-2  Render IR 与 WDL 严格分层
      Timeline/Revision 以外部 patch 作用于 Render IR，不嵌入
DM-3  Phase A opcode 最小集固定为 4 个（BLEND 推迟到 Phase B）：
      SOLID_COLOR / LINEAR_GRADIENT / NOISE / CIRCLE_SHAPE
      BLEND 推迟到 Phase B（需独立 blend pass shader）
DM-4  LLM 时机：Phase D-1（结构）→ D-2（基础 LLM）→ E（完整 LLM）
DM-5  输出策略：storage texture 优先，buffer 仅用于导出
DM-6  Phase B-E 编辑统一走 parameter patch + cache invalidation
      Phase F 才引入完整 Revision Layer
```

### 0.2 本文档覆盖的审查点

```text
1. 四层目录与模块边界
2. 核心类型与接口
3. 数据流
4. patch 协议（已在 §4.2 收口为 RenderIRPatch 最小协议）
5. profile / opcode 扩展位
6. L3 的 5 个接入点逐项落位
7. capability negotiation
8. 性能指标采集点
9. schema 定义位置
10. 与当前 my-app/ 脚手架的兼容接入方式
11. 收口项：SourceKind 枚举（§4.1.4）
12. 收口项：ParameterOwner 枚举（§4.1.5）
13. 收口项：RenderIRPatch 字段定死（§4.2.1）
```

---

## 1. 与 my-app 脚手架的兼容接入

### 1.1 现有脚手架（不改动）

```text
my-app/
├── src/
│   ├── components/HelloWorld.vue     保留（Phase A 改为调试面板）
│   ├── stores/counter.ts             保留（Phase A 替换为 GPU store）
│   ├── App.vue                       保留（Phase A 改为渲染画布）
│   ├── env.d.ts                      追加 *.wgsl 模块声明
│   ├── main.ts                       追加 WebGPU 初始化
│   └── style.css                     保留
├── src-tauri/                        保留（首期不依赖 Rust 侧业务）
└── package.json                      追加 @webgpu/types
```

### 1.2 新增业务目录

```text
my-app/src/
├── runtime/          L0 Render Runtime
├── compiler/         L1 Pixel Compiler
├── authoring/        L2 Semantic Authoring
├── world/            L3 World Authoring（Phase F+ 预留，首期空）
├── shared/           跨层共享类型、schema、常量
├── shaders/          *.wgsl 着色器源
└── workers/          Web Worker 脚本
```

### 1.3 兼容策略

- 现有 Tauri + Vue + Pinia 不替换
- `App.vue` 在 Phase A 改为渲染画布 + 调试面板
- `stores/counter.ts` 替换为 `stores/runtime.ts`（GPU 状态）
- Rust 侧首期不引入业务逻辑（仅保留 Tauri 外壳）

---

## 2. 四层目录与模块边界

### 2.1 总体目录

```text
src/
├── runtime/                   L0 Render Runtime
│   ├── device.ts              WebGPU device 初始化
│   ├── capability.ts          capability negotiation
│   ├── pipeline.ts            pipeline 管理（64-bit / 128-bit / region-only）
│   ├── encoder.ts             GPU encoder / pass
│   ├── output.ts              storage texture 输出
│   ├── profiler.ts            GPU 性能采集
│   └── types.ts               L0 内部类型
│
├── compiler/                  L1 Pixel Compiler
│   ├── ir/
│   │   ├── renderIR.ts        Render IR 定义
│   │   ├── region.ts          Region 定义
│   │   ├── layer.ts           Layer 定义
│   │   └── patch.ts           Patch 协议定义
│   ├── parser/
│   │   ├── ruleParser.ts      规则 parser（Phase B）
│   │   └── llmParser.ts       LLM parser（Phase E）
│   ├── encoder/
│   │   ├── descriptor.ts      64/128-bit descriptor 编码
│   │   ├── opcode.ts          opcode 注册与扩展
│   │   └── profile.ts         profile 切换
│   ├── region/
│   │   ├── regionCompiler.ts  region-first 编译
│   │   └── evaluator.ts       GPU eval 路径
│   ├── cache/
│   │   └── compileCache.ts     compile cache
│   ├── patch/
│   │   └── patchEngine.ts     patch 应用 + cache invalidation
│   └── context.ts             CompileContext 定义
│
├── authoring/                 L2 Semantic Authoring
│   ├── clarify/
│   │   └── requirementClarifier.ts   RequirementClarifier
│   ├── prompt/
│   │   └── promptProcessor.ts         prompt 处理
│   ├── llm/
│   │   └── callLLM.ts                 LLM 接入（Phase D-2+）
│   ├── image/
│   │   ├── resize.ts                  图像缩放（Phase D-1）
│   │   ├── integralImage.ts           积分图（Phase D-1）
│   │   ├── adaptiveSplit.ts           自适应细分（Phase D-1）
│   │   └── colorBlockTree.ts          ColorBlockTree（Phase D-1）
│   └── schema/
│       └── schemas.ts                 所有 JSON schema 定义
│
├── world/                     L3 World Authoring（Phase F+）
│   ├── wdl/                   首期空目录，预留
│   ├── sceneGraph/            预留
│   ├── genome/                预留
│   ├── timeline/              预留
│   ├── revision/              预留
│   └── director/              预留
│
├── shared/
│   ├── types.ts               跨层共享类型
│   ├── ids.ts                 稳定 ID 生成
│   ├── seed.ts                deterministic seed
│   ├── errors.ts              error taxonomy
│   └── constants.ts           全局常量
│
├── shaders/
│   ├── region_eval.wgsl       region-only 求值 shader（Phase A 主 shader）
│   ├── present.wgsl           全屏采样显示 shader
│   └── compute_64.wgsl       64-bit per-pixel descriptor shader（Phase B+，Phase A 不创建）
│
└── workers/
    └── tileWorker.ts          tile-based 编译 worker
```

### 2.2 层间依赖规则（硬约束）

```text
L0 runtime       ← 只依赖 shared/、shaders/
L1 compiler      ← 依赖 L0 + shared/
L2 authoring     ← 依赖 L1 + shared/
L3 world          ← 依赖 L2 + L1 + shared/（首期不实现）

禁止：
  L0 ← L1 / L2 / L3   (下层不可依赖上层)
  L1 ← L2 / L3         (编译器不可依赖语义层)
  跨层直接引用内部实现（必须通过对外接口）
```

---

## 3. L0 Render Runtime 模块

### 3.1 device.ts

职责：WebGPU device 初始化。

接口：

```text
initGPU(): Promise<{ device, adapter, format }>
```

- 启动时调用一次
- 失败时返回明确错误（gpu_capability error）
- 不做降级（降级由 capability.ts 决策）

### 3.2 capability.ts

职责：capability negotiation。

启动时探测清单：

```text
- WebGPU 可用性
- storage texture 支持格式
- max buffer size
- max workgroup size
- max storage bindings
- 浏览器特性差异
```

决策表：

```text
storage texture 可用 → DM-5 选 storage texture 优先
storage texture 不可用 → 抛 gpu_capability_error（方案 A，DM-5 收口；不维护 buffer fallback）
max workgroup < 64   → 降级 tile size
max buffer < 阈值    → 限制最大分辨率
```

输出：`CapabilityProfile` 对象，供 L1/L2 决策 tile size / preview strategy / output strategy。

### 3.3 pipeline.ts

职责：pipeline 管理（参考 Chapter 13 Descriptor Profile）。

支持 pipeline：

```text
- region-only pipeline      DM-1 默认路径（Phase A 主 shader，对应 region_eval.wgsl）
- 64-bit pipeline           per-pixel descriptor 特殊路径（Phase B+）
- 128-bit pipeline          per-pixel descriptor 扩展路径（Phase B+）
- present pipeline          显示（对应 present.wgsl，render pipeline）
```

#### 强类型接口拆分

按返回类型拆分 compute / render，避免联合类型断言：

```typescript
type ComputeProfile = 'region' | '64' | '128';
type RenderProfile = 'present';

class PipelineManager {
  private computePipelines: Map<ComputeProfile, GPUComputePipeline>;
  private renderPipelines: Map<RenderProfile, GPURenderPipeline>;

  // Phase A 启动时预编译所有 pipeline（零运行时编译成本）
  public async initAllPipelines(
    device: GPUDevice,
    computeShaderSource: string,    // region_eval.wgsl
    presentShaderSource: string,     // present.wgsl
    storageFormat: GPUTextureFormat // 'rgba8unorm'
  ): Promise<void>;

  // Compute pipeline：region-only / 64-bit / 128-bit
  public getComputePipeline(profile: ComputeProfile): GPUComputePipeline;

  // Render pipeline：present 专用通道
  public getRenderPipeline(profile: RenderProfile = 'present'): GPURenderPipeline;
}
```

#### Phase A 实现范围

| Pipeline | Phase A 是否实现 | 备注 |
|---|---|---|
| `'region'` compute | ✅ 实现 | 主 shader，对应 `region_eval.wgsl` |
| `'64'` compute | ❌ 不实现 | 仅声明类型，Phase B+ 才创建 pipeline |
| `'128'` compute | ❌ 不实现 | 仅声明类型，Phase B+ 才创建 pipeline |
| `'present'` render | ✅ 实现 | 对应 `present.wgsl` |

Phase A 调用方仅使用 `getComputePipeline('region')` 和 `getRenderPipeline('present')`，其他 profile 在 `initAllPipelines` 时跳过预编译。

#### bind group layout 约定

所有 compute pipeline 共享同一 bind group layout（参考 [region_eval.wgsl](file:///c:/Users/yangx/Desktop/2号想法/my-app/src/shaders/region_eval.wgsl)）：

Phase A（4 个 binding）：

```text
group(0):
  binding(0): uniform     Uniforms
  binding(1): storage     outputTex (rgba8unorm, write-only)
  binding(2): storage     auxBuffer (read-only)
  binding(3): storage     descriptorBuffer (read-only)
```

Phase B 扩展（5 个 binding，新增 regionBuffer）：

```text
group(0):
  binding(0): uniform     Uniforms（含 layerCount，不再含 time）
  binding(1): storage     outputTex (rgba8unorm, write-only)
  binding(2): storage     auxBuffer (read-only)
  binding(3): storage     descriptorBuffer (read-only，长度 = 2 * layerCount)
  binding(4): storage     regionBuffer (read-only，区域边界 vec4f 数组)
```

效果后处理管线（effect_post.wgsl）使用独立 bind group layout（4 个 binding）：

```text
group(0):
  binding(0): uniform     Uniforms（与主管线共享）
  binding(1): storage     outputTex (rgba8unorm, read_write)
  binding(2): storage     effectBuffer (read-only，效果参数)
  binding(3): storage     effectDescBuffer (read-only，效果描述符)
```

present pipeline 的 bind group layout 单独定义（参考 [present.wgsl](file:///c:/Users/yangx/Desktop/2号想法/my-app/src/shaders/present.wgsl) 的 3 个 binding）。

### 3.4 encoder.ts / output.ts

职责：GPU encoder / pass 执行 + storage texture 输出。

输出策略（DM-5 已收口为方案 A，不支持就抛错）：

```text
实时预览：compute → storage texture (rgba8unorm) → present pass 采样显示
导出场景：compute → buffer → CPU 回读（Phase A 不实现，仅设计预留）
```

#### 接口签名

```typescript
// encoder.ts
import type { RenderPlan } from '../compiler/ir/renderIR';
import type { GPUContext } from './device';

/**
 * 执行 RenderPlan：上传 descriptor/aux buffer，dispatch compute pass 写入 storage texture
 * Phase A 单 layer 模式：descriptorBuffer 长度 = 2，auxBuffer 长度 ≤ 8 (2 个 vec4f)
 */
export function executeRenderPlan(
  gpu: GPUContext,
  pipeline: GPUComputePipeline,
  bindGroupLayout: GPUBindGroupLayout,
  plan: RenderPlan,
  storageTexture: GPUTexture,
  uniforms: { resolution: [number, number]; seed: number; time: number }
): void;

// output.ts
/**
 * 全屏三角形采样 storage texture 显示到 canvas
 * Canvas 格式由 navigator.gpu.getPreferredCanvasFormat() 决定，与 storage texture 格式分离
 */
export function presentToCanvas(
  gpu: GPUContext,
  presentPipeline: GPURenderPipeline,
  bindGroupLayout: GPUBindGroupLayout,
  storageTexture: GPUTexture,
  sampler: GPUSampler
): void;

/**
 * 创建共享 storage texture（compute 写 + present 读）
 * usage 必须包含 STORAGE_BINDING | TEXTURE_BINDING | COPY_SRC
 */
export function createStorageTexture(
  device: GPUDevice,
  width: number,
  height: number
): GPUTexture;
```

#### 数据流

```text
1. RegionCompiler.compile(ir, ctx) → RenderPlan
2. encoder.executeRenderPlan(gpu, pipeline, layout, plan, storageTex, uniforms)
   ├─ 创建 descriptorBuffer GPUBuffer（usage: STORAGE | COPY_DST）
   ├─ 创建 auxBuffer GPUBuffer（usage: STORAGE | COPY_DST）
   ├─ 创建 uniformBuffer GPUBuffer（usage: UNIFORM | COPY_DST）
   ├─ queue.writeBuffer 写入三个 buffer
   ├─ createBindGroup 绑定 4 个 binding
   ├─ beginComputePass + setPipeline + setBindGroup + dispatchWorkgroups
   └─ end + submit
3. output.presentToCanvas(gpu, presentPipeline, layout, storageTex, sampler)
   ├─ createBindGroup 绑定 3 个 binding（uniform + texture + sampler）
   ├─ getCurrentTexture().createView() 作为 colorAttachments
   └─ beginRenderPass + setPipeline + setBindGroup + draw(3) + end + submit
```

#### Workgroup dispatch 计算

```text
workgroupsX = ceil(width / 16)
workgroupsY = ceil(height / 16)
```

`region_eval.wgsl` 内含越界保护（`if (gid.x >= texSize.x ...) return`），无需精确对齐。

### 3.5 profiler.ts

职责：GPU 性能采集。

采集点：

```text
- pipeline switch cost
- compute dispatch time
- texture write time
- present time
```

输出：`GPUFrameMetrics` 对象，供调试面板显示。

---

## 4. L1 Pixel Compiler 模块

### 4.1 Render IR（ir/renderIR.ts）

> **本节为 freeze-1 收口版**，与 `src/shared/types.ts` + `src/compiler/ir/renderIR.ts` 类型定义完全对齐。
> 任何字段变更必须同步修改源文件并重新审阅静态边界。

#### 4.1.0 静态边界硬约束（不可破坏）

Render IR 的核心定位：

> **Render IR 是「某一时刻已完成求值的渲染输入快照」。**
> - 不负责保存时间逻辑
> - 不负责表达动画意图
> - 不负责携带绑定关系
> - 只代表「此刻该怎么画」

由此推出 6 条不可破坏的硬约束：

```text
1. 所有 params 字段必须是 JsonLiteral（禁止 undefined / Function / Map / Set / Date / class instance）
2. Layer / Region / Effect 不出现 time / frame / phase / progress / animationPhase / animated
3. WorldMetadata 仅允许标识 / 标签 / 引用三类字段（禁止 timeline / animatedBindings / animCurve / motion）
4. CompileHints 不含时间窗口 / 帧号 / 预览时刻字段
5. Render IR 不允许跨帧资源引用（无 usePreviousFrame / historyBuffer / prevFrame / nextFrame）
6. Render IR 不允许携带可执行语义（无脚本 / DSL / 表达式 / lambda）
```

违反任一约束 = `IR_STATIC_BOUNDARY_VIOLATION` 编译错误。

#### 4.1.1 顶层 RenderIR

```typescript
interface RenderIR {
  canvas: { width: number; height: number }   // static：改尺寸触发 storage texture 重建
  layers: Layer[]                              // static：增删 = TopologyPatch
  regions: Region[]                            // static：增删 = TopologyPatch
  effects: Effect[]                            // static：增删 = TopologyPatch；Phase A 不实现
  compileHints: CompileHints                    // static：编译策略
  worldMetadata?: WorldMetadata                // metadata：仅追踪，不影响渲染求值
}
```

`CompileHints` / `WorldMetadata` / `BoundingBox` / `CapabilityProfile` / `OutputStrategy` 等基础类型定义在 [shared/types.ts](file:///c:/Users/yangx/Desktop/2号想法/my-app/src/shared/types.ts)。

#### 4.1.2 Layer

```typescript
interface Layer {
  id: string                    // L3 接入点 1：稳定 ID，禁止 patch 修改
  opcode: Opcode                // static：改 opcode = AtomicTopologyPatch
  params: Params                // dynamic：改值 = ValuePatch
  source: SourceKind            // metadata：仅追踪（见 §4.1.4）
  sourceRef?: string            // metadata：仅追踪
  paramOwnership: ParamOwnership   // metadata：Record<string, ParameterOwner>（见 §4.1.5）
  visible: boolean              // structural-patch：切换 = StructuralPatch
  blendMode?: BlendMode         // static：Phase A 不支持（抛 COMPILE_ERROR）
}
```

字段切分表：

| 字段 | 切片 | 说明 |
|---|---|---|
| `id` | static | 改 id = 新对象（禁止 patch） |
| `opcode` | static | 改 opcode = AtomicTopologyPatch |
| `params` | dynamic | 改值 = ValuePatch |
| `source` | metadata | 仅追踪 |
| `sourceRef` | metadata | 仅追踪 |
| `paramOwnership` | metadata | `Record<string, ParameterOwner>` |
| `visible` | structural-patch | 切换 = StructuralPatch |
| `blendMode` | static | Phase A 不支持 |

#### 4.1.3 Region / Effect

```typescript
interface Region {
  id: string                    // 稳定 ID
  bounds: BoundingBox           // structural-patch：影响 dispatch + tile 失效
  layerRefs: string[]           // static：改引用 = TopologyPatch（顺序敏感）
  source: SourceKind
  sourceRef?: string
}

interface Effect {
  id: string                    // 稳定 ID
  type: EffectType              // static：改 type = AtomicTopologyPatch
  params: Params               // dynamic：改值 = ValuePatch
  targetLayer?: string         // structural-patch：改作用对象
  targetRegion?: string         // structural-patch：改作用区域
}
```

Effect 职责硬约束：**Effect 是静态渲染修饰符，不是时序控制器**。
禁止 `ANIMATE / ANIMATION / TRANSITION / MOTION / FADE / PULSE / FLICKER` 等 type。

#### 4.1.4 SourceKind 枚举（收口项 2）

```typescript
type SourceKind =
  | 'user_prompt'
  | 'rule_parser'
  | 'llm_parser'
  | 'image_analysis'
  | 'user_patch'
  | 'l3_world_ref'
  | 'system_default'    // Phase A 唯一允许值
```

**禁止使用开放字符串**。所有 source 字段必须取上述 7 个值之一。

各值含义：

| SourceKind | 含义 | 启用 Phase |
|---|---|---|
| `system_default` | 系统默认值 | Phase A |
| `user_prompt` | 来自用户原始 prompt | Phase B |
| `rule_parser` | 来自规则 parser 输出 | Phase B |
| `user_patch` | 来自用户参数 patch（Phase B-E 编辑） | Phase B |
| `image_analysis` | 来自图像理解 ColorBlockTree | Phase D-1 |
| `llm_parser` | 来自 LLM parser 输出 | Phase E |
| `l3_world_ref` | 来自 L3 世界系统引用 | Phase F+ |

#### 4.1.5 ParameterOwner 枚举（收口项 3）

```typescript
type ParameterOwner =
  | 'l2_user'
  | 'l2_parser'
  | 'system_default'
  | 'l3_timeline'
  | 'l3_director'
  | 'l3_revision'
```

**禁止使用自由标记**。所有 `paramOwnership` 值必须取上述 6 个之一。

```typescript
type ParamOwnership = Record<string, ParameterOwner>
```

**修正说明**：原 `Map<string, ParameterOwner>` 已废弃，改为 `Record<string, ParameterOwner>`。
原因：Map 不可稳定 serialize，不利于 hash / schema 校验 / 跨 worker 传输 / 调试输出。

各值含义与启用时机：

| ParameterOwner | 含义 | 启用 Phase | 冲突处理优先级 |
|---|---|---|---|
| `l2_user` | 用户手动设置的参数 | Phase B | 最高 |
| `l2_parser` | L2 parser 推断的参数 | Phase B | 中 |
| `system_default` | 系统默认值 | Phase A | 最低 |
| `l3_timeline` | Timeline 关键帧驱动的参数 | Phase F | 高 |
| `l3_director` | AI Director 决策的参数 | Phase F+ | 高 |
| `l3_revision` | Revision Layer 覆盖的参数 | Phase F | 最高（但可被 l2_user 否决） |

**冲突处理原则**：
- 同一参数存在多个 owner 时，按上表优先级取胜者
- `l2_user` 永远可否决其他 owner（用户始终是最终决策者）
- `l3_revision` 覆盖其他 L3 owner，但可被 `l2_user` 否决
- 冲突时触发 `needs_confirmation`（参考 §5.1）

**Phase B-E 期间所有参数 owner 仅允许为前三项**（`l2_user` / `l2_parser` / `system_default`）。
Phase F 启用时才允许出现后三项。

#### 4.1.6 Params 类型硬约束

```typescript
type Params = Record<string, JsonLiteral>
```

- `JsonLiteral` 是项目「值层公约」，唯一定义在 [shared/types.ts](file:///c:/Users/yangx/Desktop/2号想法/my-app/src/shared/types.ts)，禁止其他模块重复定义
- 具体 opcode 的 params schema 由 OpcodeRegistry 提供
- 运行时通过 `isParams(value)` 守卫做防御校验
- 禁止使用 `Record<string, unknown>` 等宽松容器

#### 4.1.7 静态边界运行时校验

```typescript
const FORBIDDEN_IR_FIELD_NAMES = [
  'time', 'frame', 'phase', 'progress',
  'animationPhase', 'animated', 'animState',
  'tick', 'clock',
  'prevFrame', 'nextFrame', 'historyBuffer',
  'timeWindow'
] as const;

function validateStaticBoundary(ir: RenderIR): string[]
```

`validateStaticBoundary()` 采用**递归扫描**：
- 扫描所有 plain object / array
- 含嵌套 `params.xxx.animated` 这种深层字段
- 防护深度 = 16
- 防循环引用（WeakSet）

调用时机：
- LLM parser 输出后
- rule parser 输出后
- 反序列化 IR 时
- schema validator 后置防御

### 4.2 Patch 协议（ir/patch.ts）

> **本节为 freeze-1 收口版**，与 `src/compiler/ir/patch.ts` 类型定义完全对齐。
> 原 §4.2.1 的扁平 `RenderIRPatch` 定义已整体废弃，由本节的 tier 分档 schema 替换。

#### 4.2.1 Patch 四级分档

Patch 按 tier 分四档，对应 Render IR 字段的四种切片：

| Tier | 影响切片 | 处理路径 | 典型场景 |
|---|---|---|---|
| `value` | dynamic | re-encode aux + upload | 改 color / radius / params 数值 |
| `structural` | structural-patch | 局部 invalidate + 局部重编 | 改 visible / bounds / target |
| `topology` | static | 全局重编 | 增删 layer/region/effect、改 opcode/type |
| `metadata` | metadata-only | 仅更新内存 | 改 source / paramOwnership / worldMetadata |

另加 `batch` 容器 tier 与 `AtomicTopologyPatch` 原子事务子型。

#### 4.2.2 PatchBase（所有 patch 共有）

```typescript
type PatchSource =
  | 'user_patch'
  | 'l3_timeline'
  | 'l3_director'
  | 'l3_revision'
  | 'system_internal';

interface PatchBase {
  id: string;                    // 全局唯一 patch id（建议 uuid v4）
  source: PatchSource;          // patch 来源，正式保留在 payload 内（非外部上下文）
  issuedAt: number;             // 时间戳（仅日志/排序用，不参与 cache key）
  transactionId?: string;       // 可选事务标签：同 transactionId 视为同一原子组
}
```

来源开放策略：
- Phase B-E：仅允许 `'user_patch'` | `'system_internal'`
- Phase F+：才允许 `'l3_timeline'` | `'l3_director'` | `'l3_revision'`

#### 4.2.3 六种 Patch 类型

```typescript
// 1. ValuePatch：tier = 'value'
interface ValuePatch extends PatchBase {
  tier: 'value';
  targetType: 'layer' | 'effect';    // region 不持 params
  targetId: string;
  path: string;                       // 点分路径：'color' / 'center.x' / 'color.0'
  operation: 'set';                   // value patch 固定 set，禁止 merge/remove
  value: JsonLiteral;
}

// 2. StructuralPatch：tier = 'structural'
type StructuralChange =
  | { field: 'visible';      targetType: 'layer';  targetId: string; value: boolean }
  | { field: 'bounds';       targetType: 'region'; targetId: string; value: BoundingBox }
  | { field: 'targetLayer';  targetType: 'effect'; targetId: string; value: string | null }
  | { field: 'targetRegion'; targetType: 'effect'; targetId: string; value: string | null };

interface StructuralPatch extends PatchBase {
  tier: 'structural';
  change: StructuralChange;          // 单次只改一个字段，多改走 PatchBatch
}

// 3. TopologyPatch：tier = 'topology'
type TopologyChange =
  | { kind: 'addLayer'; layer: Layer }
  | { kind: 'removeLayer'; layerId: string }
  | { kind: 'addRegion'; region: Region }
  | { kind: 'removeRegion'; regionId: string }
  | { kind: 'addEffect'; effect: Effect }
  | { kind: 'removeEffect'; effectId: string }
  | { kind: 'setCanvas'; width: number; height: number }
  | { kind: 'setCompileHints'; hints: CompileHints }
  | { kind: 'setLayerRefs'; regionId: string; layerRefs: string[] }
  | { kind: 'addLayerRefs'; regionId: string; layerIds: string[] }
  | { kind: 'removeLayerRefs'; regionId: string; layerIds: string[] }
  | { kind: 'setEffectType'; effectId: string; effectType: EffectType };

interface TopologyPatch extends PatchBase {
  tier: 'topology';
  change: TopologyChange;
}

// 4. AtomicTopologyPatch：tier = 'topology'（原子事务）
//    用于「改 opcode 必须同步改 params」场景
type AtomicTopologyPatch =
  | (PatchBase & {
      tier: 'topology';
      atomicOp: 'replaceLayerProgram';
      targetType: 'layer';
      targetId: string;
      newOpcode: Opcode;
      params: Params;                // 必须通过 OpcodeRegistry.get(newOpcode).paramSchema 校验
    })
  | (PatchBase & {
      tier: 'topology';
      atomicOp: 'replaceEffectProgram';
      targetType: 'effect';
      targetId: string;
      newEffectType: EffectType;
      params: Params;
    });

// 5. MetadataPatch：tier = 'metadata'
type MetadataChange =
  | { kind: 'setSource'; targetType: 'layer' | 'region'; targetId: string; source: SourceKind; sourceRef?: string }
  | { kind: 'setParamOwnership'; targetType: 'layer'; targetId: string; paramName: string; owner: ParameterOwner }
  | { kind: 'replaceParamOwnership'; targetType: 'layer'; targetId: string; ownership: Record<string, ParameterOwner> }
  | { kind: 'setWorldMetadata'; metadata: WorldMetadata | null };

interface MetadataPatch extends PatchBase {
  tier: 'metadata';
  change: MetadataChange;
}

// 6. PatchBatch：批处理容器
interface PatchBatch extends PatchBase {
  tier: 'batch';
  patches: RenderIRPatchOp[];   // 类型层禁止嵌套 PatchBatch
  mode: 'atomic' | 'best_effort';
  merge?: Partial<PatchBatchMergePolicy>;
}
```

顶层联合：

```typescript
type RenderIRPatchOp =
  | ValuePatch | StructuralPatch | TopologyPatch
  | AtomicTopologyPatch | MetadataPatch;

type RenderIRPatch = RenderIRPatchOp | PatchBatch;
```

#### 4.2.4 Patch 冲突处理与原子事务规则

同一参数被多个 Patch 修改时：

```text
1. 时间最新的 Patch 获胜
2. 但若旧 Patch 的 owner = 'l2_user' 而新 Patch 的 owner 属于 L3：
   → 触发 needs_confirmation
   → 不允许直接覆盖
```

这与 §4.1.5 的 ParameterOwner 冲突处理原则一致。

**原子事务硬规则**（AtomicTopologyPatch）：
- `replaceLayerProgram` 必须同时包含 `newOpcode + params`，不允许只传 opcode 不传 params
- `replaceEffectProgram` 同理
- params 必须通过对应 schema 校验，否则抛 `IR_PATCH_SCHEMA_MISMATCH`
- frame 内允许出现，但必须作为**独占原子段**提交：
  - 前置普通段先 commit
  - atomic 段单独 analysis / compile / commit
  - 后续 patch 进入新普通段
  - 不参与普通 value patch 合并

#### 4.2.5 PatchEngine 接口（Phase B 强制）

```typescript
interface PatchEngine {
  apply(patch: RenderIRPatch): PatchApplyResult;
  beginFrame(frameId: number): void;     // Phase B 强制：frame-scoped batching
  endFrame(frameId: number): PatchApplyResult;
  rollback(frameId: number): void;
  isInFrame(): boolean;
  pendingCount(): number;
}
```

**`apply()` 语义**：
- frame 外调用：立即执行，返回 `'committed'` 或 `'rejected'`
- frame 内调用：仅入队，返回 `'queued'`，真正结果由 `endFrame()` 返回

**`beginFrame()` 规则**：
- 允许会触发 storage texture rebuild 的 patch 入队
- 但不得在 frame 中途直接 commit rebuild
- endFrame 时若同 frame 同时存在 setCanvas 与不可并行的 atomic topology，抛 `IR_PATCH_TRANSACTION_CONFLICT`

**`endFrame()` 行为**：
- 合并同对象 value patch（`mergeValuePatches` 默认 true）
- 合并连续 upload（`mergeUploads` 默认 true）
- topology 分析可下沉 worker
- commit 始终在主线程完成
- 聚合结果：`effectiveTier = max(所有子 patch tier)`

#### 4.2.6 PatchApplyResult 与 PatchActions

```typescript
interface PatchApplyResult {
  accepted: boolean;
  commitState: 'queued' | 'committed' | 'rejected';
  violations?: PatchViolation[];

  effectiveTier: 'metadata' | 'value' | 'structural' | 'topology';
  // 单 patch：= patch.tier
  // batch：= max(子 patch tier)，优先级 metadata < value < structural < topology

  changedKeys: {
    staticKeyChanged: boolean;
    structuralKeyChanged: boolean;
    dynamicKeyChanged: boolean;
    metadataKeyChanged: boolean;
  };

  affectedRegionIds: string[];       // 闭包影响集
  affectedLayerIds: string[];
  affectedEffectIds: string[];

  actions: PatchActions;
  execution: { analysisMode: 'sync' | 'worker'; commitMode: 'main-thread' };

  appliedPatchIds: string[];         // 批处理追踪
  rejectedPatchIds?: string[];
  timings?: { analysis: number; recompile?: number; reencode?: number; upload?: number };
}

interface PatchActions {
  recompile: 'none' | 'region-local' | 'full';
  reencode: Array<'aux' | 'uniform' | 'descriptor' | 'dispatch'>;
  upload: Array<'aux-slot' | 'aux-full' | 'uniform' | 'descriptor' | 'dispatch'>;
  rebuildStorageTexture: boolean;
  rebuildPipeline: boolean;
  invalidateReferenceIndex: boolean;
}
```

#### 4.2.7 ReferenceIndex（运行时内存索引）

```typescript
interface ReferenceIndex {
  layerToRegions: Map<string, Set<string>>;   // layerId -> 引用该 layer 的 regionId 集合
  layerToEffects: Map<string, Set<string>>;   // layerId -> 作用于该 layer 的 effectId 集合
  regionToEffects: Map<string, Set<string>>; // regionId -> 作用于该 region 的 effectId 集合
}
```

**重要**：ReferenceIndex 是 PatchEngine 运行时内存索引，不是 JSON payload：
- 允许使用 `Map` / `Set`
- 不参与 cache key
- 不参与 patch payload 序列化
- 不要求 worker 直接传输该结构
- 每次 Render IR 结构变化时重建

用于 structural patch 的闭包影响集计算（如 `visible` 变化要联动 `layerToRegions + layerToEffects`）。

#### 4.2.8 Path 解析规范

```typescript
function parsePath(path: string): string[]
```

合法形式：
- `'color'` → `['color']`
- `'center.x'` → `['center', 'x']`
- `'color.0'` → `['color', '0']`（数组索引按字符串解析）

禁止形式（抛 `IR_PATCH_PATH_NOT_ALLOWED`）：
- `'color[0]'` bracket 写法
- `'*.color'` / `'color.*'` 通配符
- `'..color'` 相对路径
- `''` 空路径

path 必须通过对应 opcode 的 paramSchema 白名单校验。

#### 4.2.9 错误码表

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

#### 4.2.10 Patch 来源

`source` 字段正式保留在 patch payload 内（非外部上下文）。

```text
Phase B-E：
  - 'user_patch'（来自用户参数修改）
  - 'system_internal'（系统内部触发）
  - 不允许 L3 来源

Phase F+：
  - 'user_patch'（保持）
  - 'system_internal'（保持）
  - 'l3_timeline'（Timeline 关键帧变化产生的 patch）
  - 'l3_director'（AI Director 决策产生的 patch）
  - 'l3_revision'（Revision Layer 产生的 patch）
```

应用 Patch 时会记录到 Revision History（Phase F+ 才有）。

#### 4.2.11 PatchEngine 执行矩阵（速查表）

详见 [PatchEngine 执行矩阵](file:///c:/Users/yangx/Desktop/2号想法/PixelForge_首期工程骨架设计说明.md) 的设计讨论纪要。
速查规则：

| Patch 路径 | Tier | Recompile | Upload |
|---|---|---|---|
| `layers[i].params.*` | value | none | aux-slot |
| `layers[i].visible` | structural | region-local | aux + descriptor |
| `layers[i].opcode`（需原子 + params） | topology | full | aux-full + descriptor |
| `layers[i].blendMode` | topology | full（Phase B+） | — |
| `layers.push/splice` | topology | full | aux-full + descriptor |
| `layers[i].id` | 禁止 | — | — |
| `regions[i].bounds` | structural | region-local | aux + dispatch |
| `regions[i].layerRefs` | topology | region-local | aux + descriptor |
| `effects[i].params.*` | value | none | aux-slot |
| `effects[i].targetLayer/Region` | structural | region-local | aux + descriptor |
| `effects[i].type` | topology | region-local 或 full | — |
| `effects.push/splice` | topology | region-local 或 full | — |
| `canvas.width/height` | topology | full | 全部 + storage texture 重建 |
| `compileHints.*` | topology | full | 视 preferredProfile |
| `worldMetadata` | metadata | none | none |

### 4.3 opcode 注册与扩展（encoder/opcode.ts）

#### 首期 opcode 枚举（DM-3 修订：4 个 opcode）

Phase A 仅实现 4 个 opcode，BLEND 推迟到 Phase B（需独立 blend pass shader）。

```typescript
enum Opcode {
  SOLID_COLOR = 0,
  LINEAR_GRADIENT = 1,
  NOISE = 2,
  BLEND = 3,              // Phase B 启用（独立 blend pass，不进 region_eval）
  CIRCLE_SHAPE = 4,
  // 扩展位（不实现）
  // RECT_SHAPE = 5,
  // RADIAL_GRADIENT = 6,
  // SWIRL = 7,  // 不在首期
}
```

Phase A 限制：
- `RegionCompiler` 遇到 BLEND 必须抛错（`COMPILE_ERROR`），不做静默跳过
- `region_eval.wgsl` 不实现 BLEND 分支

#### opcode 注册机制

```typescript
interface OpcodeSpec {
  opcode: Opcode
  name: string
  paramSchema: JSONSchema       // 参数 schema
  shaderBranch: string          // shader 分支标识
  profileSupport: Profile[]     // 支持哪些 profile
}

class OpcodeRegistry {
  register(spec: OpcodeSpec): void
  get(opcode: Opcode): OpcodeSpec
  list(): OpcodeSpec[]
}
```

#### 扩展第 6 个 opcode 的步骤

```text
1. 在 Opcode 枚举追加新值
2. 编写 OpcodeSpec，定义 paramSchema / shaderBranch / profileSupport
3. 在 region_eval.wgsl 追加对应分支（若是 BLEND 类则进 blend.wgsl）
4. 在 encoder/encoder.ts 追加编码逻辑
5. 单元测试
```

### 4.4 descriptor 编码（encoder/descriptor.ts）

#### 主存储（参考补充说明 §4.4）

```text
统一使用 Uint32Array
  64-bit descriptor = 2 × u32
  128-bit descriptor = 4 × u32
禁止 BigInt64Array 作为跨层表示
```

#### Descriptor 字段拆分（修订版：对齐 §4.5 与 shader 实现）

**Phase A 64-bit 物理布局**（与 [region_eval.wgsl](file:///c:/Users/yangx/Desktop/2号想法/my-app/src/shaders/region_eval.wgsl) 解包逻辑一致）：

```text
descriptor[0] (u32):
  - opcode (8 bit)     bit 31-24
  - flags (8 bit)      bit 23-16
  - auxIndex (16 bit)  bit 15-0      // auxBuffer 偏移索引

descriptor[1] (u32):
  - reserved (32 bit)  全 0          // Phase A 未使用，保留扩展位
```

**字段说明**：
- `opcode`：算子类型，取值见 §4.3（Phase A 仅 4 个有效值）
- `flags`：Phase A 全 0，Phase B+ 用于 visible / blendMode 等标志位
- `auxIndex`：auxBuffer 的 vec4f 槽偏移（每个 slot = 16 字节）
- `reserved`：Phase A 强制为 0，不承载任何参数

**重要变更说明**：
- 早期版本含 `param0 / param1` 共 32 bit，**已废弃**
- Phase A 实际所有参数通过 auxBuffer 传递（参考 §4.4.2 aux buffer 布局）
- 删除 param0/param1 后，descriptor 仍占 64 bit（2 个 u32），保持物理对齐不变
- 与 [§4.5 RenderPlan](file:///c:/Users/yangx/Desktop/2号想法/PixelForge_首期工程骨架设计说明.md) 注释、[region_eval.wgsl L95-99](file:///c:/Users/yangx/Desktop/2号想法/my-app/src/shaders/region_eval.wgsl#L95-L99) 解包逻辑**三方一致**

**Phase B+ 128-bit 扩展布局**（仅设计预留，Phase A 不实现）：

```text
descriptor[0] (u32): opcode(8) | flags(8) | auxIndex(16)
descriptor[1] (u32): reserved(32)               // 继续保留
descriptor[2] (u32): extendedParam0(16) | extendedParam1(16)   // Phase B+ 启用
descriptor[3] (u32): materialOrRegionRef(32)    // Phase B+ 启用
```

**过渡原则**：
- Phase A → Phase B 升级时，descriptor[0] 和 descriptor[1] 的位布局不变
- 仅新增 descriptor[2] / descriptor[3]，向后兼容
- profile '64' 的 shader 仍可正常解析前 2 个 u32

#### aux buffer 数据布局（vec4f 槽）

每个 opcode 在 auxBuffer 中的 slot 占用：

| Opcode | Slot 数 | Slot 内布局 |
|---|---|---|
| SOLID_COLOR | 1 | `vec4f(r, g, b, a)` |
| LINEAR_GRADIENT | 2 | slot 0: 起点色 `vec4f(r1,g1,b1,a1)` / slot 1: 终点色 `vec4f(r2,g2,b2,a2)` |
| NOISE | 1 | `vec4f(scale, 0, 0, 0)`（seed 走 uniforms） |
| CIRCLE_SHAPE | 1 | `vec4f(centerX, centerY, radius, 0)` |
| BLEND | - | Phase A 不支持（参考 §4.3） |

每个 slot = 4 个 f32 = 16 字节，与 WGSL `vec4f` 对齐。

#### 编码接口

```text
encode64(layer: Layer, currentAuxOffset: number): EncodedResult
```

返回值 `EncodedResult`：

```typescript
interface EncodedResult {
  descriptor: Uint32Array;   // 长度固定 2（64-bit = 2 × u32）
  auxSlots: Float32Array[];  // 每元素长度固定 4（对齐 vec4f）
}
```

`encodeRegion(region, layers)` 接口在 Phase A 不实现（单 layer 模式，由 RegionCompiler 直接循环调用 `encode64`）。

#### 4.4.2 aux buffer 上传协议

`RegionCompiler.compile` 负责将所有 layer 的 `auxSlots` 顺序拼接为扁平 `Float32Array`：

```text
collectedAuxSlots = [layer0.slot0, layer0.slot1, layer1.slot0, ...]
                  = [Float32Array(4), Float32Array(4), ...]

flatAuxBuffer = new Float32Array(collectedAuxSlots.length * 4)
                // 顺序 set 每个槽
```

`currentAuxOffset` 累加规则：
- 每个 layer 编码后，`currentAuxOffset += auxSlots.length`
- 下一个 layer 的 `auxIndex` 即为新的 `currentAuxOffset`

### 4.5 region-first 编译（region/regionCompiler.ts）

#### 编译策略（DM-1 默认路径）

```text
1. 解析 RenderIR.regions
2. 对每个 region：
   - 判断是否需要 per-pixel descriptor
   - 默认走 GPU eval（参数 + shader 内求值）
   - 仅以下场景才生成 per-pixel descriptor：
     a. 手工冻结的局部编辑
     b. 复杂逐像素 mask
     c. 已计算好的中间缓存
3. 输出 RenderPlan（含 region program + 可选 descriptor buffer）
```

#### RenderPlan 结构

Phase A 最小子集（单 layer 模式）：

```typescript
interface RenderPlan {
  /**
   * 全局二进制指令流（每 layer 2 个 u32 = 64-bit）。
   * Phase A 固定长度为 2（单 layer）。
   * descriptor[0] = opcode(8) | flags(8) | auxIndex(16)
   * descriptor[1] = reserved(32)
   */
  descriptorBuffer: Uint32Array;

  /**
   * 全局 aux 显存（vec4f 数组扁平化，16 字节对齐）。
   * Phase A 单 layer 最多 2 个 vec4f（LINEAR_GRADIENT）。
   */
  auxBuffer: Float32Array;

  /**
   * 输出策略。
   * Phase A 强制为 'storage_texture'（DM-5 + 方案 A：不支持就抛 gpu_capability_error）。
   */
  outputStrategy: 'storage_texture';
}
```

Phase B+ 扩展字段（Phase A 不实现，仅预留设计）：

```typescript
interface RenderPlanPhaseBPlus {
  regions: RegionProgram[]                    // 多 region 编译产物
  pixelDescriptors?: PixelDescriptorBuffer[]  // 特殊路径（per-pixel descriptor）
  outputStrategy: 'storage_texture' | 'buffer'
}

interface RegionProgram {
  regionId: string
  shader: string                 // shader 标识
  params: Uint32Array            // 参数表
  textureRefs?: TextureRef[]
}

interface PixelDescriptorBuffer {
  regionId: string
  buffer: Uint32Array
  profile: '64' | '128'
}
```

Phase A → Phase B 迁移路径（已实现）：
- `descriptorBuffer` 长度从 2 扩展到 `2 * layerCount`（无 layerCount 前缀，layerCount 通过 Uniforms 传入）
- `auxBuffer` 长度相应增长（所有图层参数顺序拼接）
- 新增 `regionData`（Float32Array）支持区域边界
- 新增 `effectDescData` + `effectParamData` 支持效果后处理
- `outputStrategy` 保持 `'storage_texture'`
- Uniforms 结构从 `resolution/seed/time` 改为 `resolution/seed/layerCount`（对齐 §4.7 删除 time）
- bind group 从 4 个 binding 扩展到 5 个（新增 regionBuffer）

### 4.6 compile cache（cache/compileCache.ts）

> **本节为 freeze-1 收口版**，与 `src/compiler/ir/renderIR.ts` 中 `CacheKeySet` + 4 个投影函数类型定义完全对齐。
> 三层 key 设计对应 §4.1 字段切片（static / dynamic / structural-patch / metadata）与 §4.2 patch tier。

#### 4.6.1 设计动机：从单一 key 到三层 key

旧版（已废弃）使用单一 `key = hash(semanticHash, resolution, profile, seed, previewLevel, affectedRegionHash)`。

问题：
- 改一个 layer 的 params 值 → 整个 IR hash 变 → 全量重编
- 改 layer.visible → 与改 params 走同一条失效路径 → 无法区分"结构变化"与"数值变化"
- metadata（source / paramOwnership）变化也会命中失效，但 metadata 不影响渲染求值

freeze-1 把 key 拆为 4 层，对应 4 类字段切片，使 patch tier 精确命中失效范围：

```text
ValuePatch         → 仅 dynamicKey 失效
StructuralPatch    → structuralKey + dynamicKey 失效
TopologyPatch      → staticKey + structuralKey + dynamicKey 全部失效
AtomicTopologyPatch→ 同 TopologyPatch（原子事务，全失效或全不失效）
MetadataPatch      → 仅 metadataKey 失效（不影响渲染求值）
```

#### 4.6.2 CacheKeySet

```typescript
interface CacheKeySet {
  staticKey: string;        // 编译形态：canvas / opcodes / effectTypes / outputStrategy / profile
                            // → 决定 pipeline 选择与 descriptor buffer 形态
  structuralKey: string;   // 局部结构：visible / layerOrder / regionBounds / regionOrder / layerRefs
                            // → 决定 tile 划分与 dispatch 范围
  dynamicKey: string;       // 求值参数：params 值 / seed / compileHints
                            // → 决定 aux buffer 与 uniform 内容
  metadataKey?: string;     // 追踪用：source / sourceRef / paramOwnership / worldMetadata
                            // → 不影响渲染求值，仅用于 Revision History 与 L3 追踪
}
```

`metadataKey` 为可选：若 IR 不携带 metadata 字段则省略，cache 命中时跳过 metadata 比较。

#### 4.6.3 4 个 KeyInput 类型（投影函数输入）

每个 KeyInput 是对应 key 的"未 hash 原料"，由 RenderIR 投影得到，再经 `hashKeyInput()` 转成 string。

```typescript
interface StaticKeyInput {
  canvas: { width: number; height: number };
  opcodes: Opcode[];                  // 有序：layers.map(l => l.opcode)
  blendModes: (BlendMode | undefined)[]; // 有序：layers.map(l => l.blendMode) Phase B 新增
  effectTypes: EffectType[];           // 有序：effects.map(e => e.type)
  outputStrategy: OutputStrategy;
  profileId: string;                   // CapabilityProfile 标识（见 §3.2）
}

interface StructuralKeyInput {
  visibleFlags: boolean[];             // 有序：layers.map(l => l.visible)
  layerOrder: string[];                // 有序：layers.map(l => l.id)
  regionBounds: BoundingBox[];          // 有序：regions.map(r => r.bounds)
  regionOrder: string[];                // 有序：regions.map(r => r.id)
  layerRefs: string[][];                // 有序：regions.map(r => r.layerRefs)
}

interface DynamicKeyInput {
  paramValues: JsonLiteral[];          // 按 (layerId, paramKey) 字典序排列
  seed: number;
  compileHints: CompileHints;
}

interface MetadataKeyInput {
  sources: SourceKind[];                // 有序：layers.map(l => l.source)
  sourceRefs: (string | undefined)[];   // 有序：layers.map(l => l.sourceRef)
  paramOwnership: ParamOwnership[];     // 有序：layers.map(l => l.paramOwnership)
  worldMetadata?: WorldMetadata;
}
```

#### 4.6.4 投影函数签名

4 个投影函数定义在 `src/compiler/ir/renderIR.ts`（与 `CacheKeySet` 同文件，确保类型一致性）：

```typescript
export function projectStaticKey(
  ir: RenderIR,
  ctx: CompileContext
): StaticKeyInput;

export function projectStructuralKey(
  ir: RenderIR
): StructuralKeyInput;

export function projectDynamicKey(
  ir: RenderIR,
  ctx: CompileContext
): DynamicKeyInput;

export function projectMetadataKey(
  ir: RenderIR
): MetadataKeyInput;
```

`hashKeyInput()` 由 `cache/compileCache.ts` 内部实现，对 KeyInput 做规范化序列化后 hash：
- 数组按定义时的顺序参与 hash（投影函数已保证顺序确定）
- `undefined` 字段统一映射为固定 marker（避免与 `'undefined'` 字符串冲突）
- `JsonLiteral` 递归规范化（对象 key 按字典序排列，避免顺序差异造成 hash 不一致）

#### 4.6.5 接口

```text
get(keys: CacheKeySet): Promise<CompileResult | null>
set(keys: CacheKeySet, result: CompileResult): Promise<void>
invalidate(scope: PatchScope): void
```

`PatchScope` 由 patch tier 决定（见 §4.2 执行矩阵）：
- `'dynamic'` — 仅 dynamicKey 失效
- `'structural'` — structuralKey + dynamicKey 失效
- `'topology'` — staticKey + structuralKey + dynamicKey 失效
- `'metadata'` — 仅 metadataKey 失效

#### 4.6.6 与 DM 跨 Phase 硬约束 §4.3 的关系

优先级文档 §4.3 列出的 key 要素全部落到三层 key 中：

| 优先级文档 §4.3 要素 | 落位 |
|---|---|
| prompt hash / semantic hash | 拆解后由 `staticKey` + `structuralKey` + `dynamicKey` 共同表达 |
| resolution | `staticKey.canvas` |
| profile id | `staticKey.profileId` |
| seed | `dynamicKey.seed` |
| time segment | **不入 cache key**（time 不入 IR，见 §4.1.0 / §4.7） |
| region hash | `structuralKey.regionBounds` + `layerRefs` |

`time segment` 在 freeze-1 中被移出 cache key，对齐 §4.1.0 静态边界硬约束。

### 4.7 CompileContext（context.ts）

> **本节为 freeze-1 收口版**，与 `src/compiler/ir/renderIR.ts` 中 `CompileContext` 类型定义完全对齐。
> `time` 字段已删除，对齐 §4.1.0 静态边界硬约束（Render IR 不携带时间语义）。

```typescript
interface CompileContext {
  capability: CapabilityProfile
  // L3 接入点 3：可注入上层语义元数据
  worldMetadata?: WorldMetadata
  seed: number                     // deterministic seed
  previewLevel: 0 | 1 | 2 | 3
}
```

#### 4.7.1 为什么删除 `time`

旧版（已废弃）：

```typescript
interface CompileContext {
  capability: CapabilityProfile
  time?: number                    // 时间参数（动画用）  ← 已删除
  worldMetadata?: WorldMetadata
  seed: number
  previewLevel: 0 | 1 | 2 | 3
}
```

删除理由：
- `time` 字段会被误解为"编译结果依赖时间"，违背 §4.1.0 第 2 条硬约束（Layer/Region/Effect 不出现 time / frame / phase / progress / animationPhase / animated）
- 动画在 freeze-1 中通过高频 ValuePatch 在主线程推动，不进入 IR / CompileContext
- 与 §4.6.6 cache key 设计同步：`time segment` 不入 cache key
- 与 [region_eval.wgsl](file:///c:/Users/yangx/Desktop/2号想法/my-app/src/shaders/region_eval.wgsl) 中 `Uniforms.time` 字段的差异说明：WGSL uniform 中的 `time` 是 GPU 求值期注入，与 IR / CompileContext 解耦——前者是"渲染时刻的瞬时量"，后者是"编译期的稳定上下文"。Phase A 暂时把 seed 通过 uniform 传入，time uniform 保留但主线程不主动写入（避免引入隐式时间依赖）。

#### 4.7.2 字段说明

| 字段 | 类别 | 说明 |
|---|---|---|
| `capability` | static context | 启动时探测一次，整个会话不变（见 §3.2） |
| `worldMetadata` | metadata | L3 接入点 3，Phase B-E 留空，Phase F+ 由 Timeline / Director 注入 |
| `seed` | dynamic context | deterministic seed（DM 跨 Phase 硬约束 §4.2），所有 procedural effect 必须使用此 seed |
| `previewLevel` | dynamic context | 预览级别：0=full / 1=half / 2=quarter / 3=eighth |

---

## 5. L2 Semantic Authoring 模块

### 5.1 RequirementClarifier（clarify/requirementClarifier.ts）

#### 三种结果（参考补充说明 §8）

```typescript
type ClarifyResult =
  | { status: 'auto_resolved'; intent: ParsedIntent; warnings?: string[] }
  | { status: 'needs_confirmation'; intent: ParsedIntent; questions: string[] }
  | { status: 'rejected'; reason: string }
```

#### 必须拒绝执行的场景

```text
- 输出尺寸与性能预算冲突
- 风格与参考图冲突
- 描述存在互斥语义
- 编辑目标不唯一
- 用户请求会触发高代价全局重编译
```

#### 接口

```text
clarify(prompt: string, context?: ClarifyContext): Promise<ClarifyResult>
```

### 5.2 规则 parser（parser/ruleParser.ts）

职责：Phase B 的 hard-coded parser，不依赖 LLM。

输入：ParsedIntent（来自 RequirementClarifier）

输出：RenderIR

```text
parse(intent: ParsedIntent): RenderIR
```

#### Phase B 支持的 prompt 形式

```text
- "纯色背景：红色"
- "渐变：从红到蓝，垂直方向"
- "圆形：中心(0.5,0.5)，半径 0.3，红色"
- "叠加：layer1 + layer2"
```

### 5.3 LLM 接入（llm/callLLM.ts，Phase D-2+）

#### 接口

```text
callLLM(prompt: string, schema: JSONSchema): Promise<LLMResponse>
```

#### 行为

```text
1. 调用 LLM API（OpenAI/Claude）
2. 校验响应 schema
3. 失败时返回 llm_contract error
4. 不做自动重试（由调用方决定）
```

### 5.4 图像理解（image/，Phase D-1）

#### ColorBlockTree

```typescript
interface ColorBlockNode {
  id: string                    // 稳定 ID
  bounds: BoundingBox
  color: Color
  variance: number
  children: ColorBlockNode[]
  // L3 接入点 4：来源追踪
  source: 'image_analysis'
  sourceRef: string             // 原图 hash
}
```

#### toLLMView

```text
toLLMView(tree: ColorBlockTree): string
```

输出树形文本，供 LLM 解释（参考 Chapter 22 §22.4 [L1841](file:///c:/Users/yangx/Desktop/2号想法/PixelForge_技术实现路线.md#L1841)）。

#### 复杂度预算（跨 Phase 硬约束 §4.6）

```text
maxNodeCount: 5000
maxDepth: 7
maxLLMContextChars: 8000
maxTinyObjectNodes: 200
maxAnalysisTimeMs: 5000
```

超预算降级顺序：

```text
降分辨率 → 提阈值 → 限制深度 → 合并低显著度微块 → 仅保留关注区域
```

### 5.5 Schema 定义（schema/schemas.ts）

所有跨层输出的 JSON schema 集中定义：

```text
- parsedIntentSchema
- renderIRSchema
- colorBlockTreeSchema
- llmOutputSchema
- patchSchema
- compileResultSchema
```

校验机制：

```text
- LLM 输出必须通过 schema 才能进入编译层
- 所有跨层数据传递必须通过 schema 校验
- 失败时抛出 validation error
```

---

## 6. L3 World Authoring 模块（Phase F+ 预留）

### 6.1 首期状态

```text
src/world/
├── wdl/           （空）
├── sceneGraph/    （空）
├── genome/        （空）
├── timeline/      （空）
├── revision/      （空）
└── director/      （空）
```

### 6.2 L3 的 5 个接入点逐项落位

#### 接入点 1：语义元素 ID 稳定机制

位置：`src/shared/ids.ts`

```typescript
// 稳定 ID 生成器
// 同一语义元素在多次编译中保持相同 ID
function stableId(source: string, content: string): string {
  return hash(source + content)  // 基于来源 + 内容
}
```

使用位置：
- `Layer.id`
- `Region.id`
- `ColorBlockNode.id`

#### 接入点 2：Render IR 的外部 patch 接口

位置：`src/compiler/ir/patch.ts`

已在 §4.2 定义。Phase F 启动时，L3 Timeline/Revision 通过此接口产生 Patch 作用于 Render IR。

#### 接入点 3：compile context 中可注入上层语义元数据

位置：`src/compiler/context.ts`

已在 §4.7 定义。`CompileContext.worldMetadata` 字段可选，首期为空，Phase F+ 由 L3 注入。

```typescript
interface WorldMetadata {
  sceneGraphId?: string
  timelineId?: string
  directorIntentId?: string
}
```

#### 接入点 4：region/layer 的来源追踪字段

位置：`src/compiler/ir/renderIR.ts`

已在 §4.1 定义。`Layer.source` 和 `Region.source` 字段记录来源。
枚举值已在 §4.1.4 收口为 `SourceKind`（6 个固定值，禁止开放字符串）。

#### 接入点 5：parameter ownership 边界

位置：`src/compiler/ir/renderIR.ts`

已在 §4.1 定义。`Layer.paramOwnership` 标注每个参数的 owner。
枚举值已在 §4.1.5 收口为 `ParameterOwner`（6 个固定值，禁止自由标记）。

Phase B-E 期间所有参数 owner 仅允许为前三项（`l2_user` / `l2_parser` / `system_default`）。

Phase F 启动时迁移：

```text
Phase F 启动时：
  - Timeline 关键帧驱动的参数 owner 改为 'l3_timeline'
  - AI Director 决策的参数 owner 改为 'l3_director'
  - Revision Layer 覆盖的参数 owner 改为 'l3_revision'
  - 与 'l2_user' owner 冲突时 → 触发 needs_confirmation（参考 §4.1.5 冲突处理原则）
```

---

## 7. 数据流

### 7.1 完整数据流（Phase F 完成后）

```text
User Prompt
     ↓
[L2] RequirementClarifier
     ↓  ParsedIntent
[L2] ruleParser / llmParser
     ↓  RenderIR
[L1] regionCompiler
     ↓  RenderPlan
[L0] encoder + compute shader
     ↓  storage texture
[L0] present pipeline
     ↓
   画面
```

### 7.2 各 Phase 的数据流边界

#### Phase A（GPU 闭环）

```text
hard-coded RenderIR → L1 regionCompiler → L0 → 画面
```

无 L2，RenderIR 手动构造。

#### Phase B（Pixel Compiler 闭环）

```text
text prompt → L2 ruleParser → RenderIR → L1 → L0 → 画面
```

无 LLM，ruleParser 是 hard-coded。

#### Phase C（Worker + 预览）

```text
同 Phase B，但 L1 走 worker pool，输出多分辨率预览
```

#### Phase D-1（图像理解结构）

```text
image → L2 image analysis → ColorBlockTree → toLLMView（输出但不接入）
```

不进入主数据流。

#### Phase D-2（基础 LLM）

```text
image → L2 image analysis → ColorBlockTree → toLLMView
                                                   ↓
                                              L2 callLLM
                                                   ↓
                                              语义解释（输出但不接入）
```

仍不进入主编译流。

#### Phase E（完整 LLM）

```text
text prompt → L2 RequirementClarifier → L2 llmParser → RenderIR → L1 → L0 → 画面
```

LLM 替代 ruleParser。

#### Phase F（Timeline/Revision）

```text
[L3 Timeline / Director]
     ↓  Patch
[L1] patchEngine
     ↓  修改 RenderIR
[L1] regionCompiler（partial recompile）
     ↓
[L0] partial upload
     ↓
   画面
```

---

## 8. 跨 Phase 硬约束的落位

### 8.1 Schema First（§4.1）

位置：`src/authoring/schema/schemas.ts`

所有 schema 集中定义，所有跨层传递必须校验。

### 8.2 Deterministic Seed（§4.2）

位置：`src/shared/seed.ts`

```typescript
function createSeed(source: string): number {
  return hash(source)  // 32-bit 整数
}
```

所有 procedural path（NOISE、未来 SWIRL 等）必须接受 seed 参数。

### 8.3 Cache Key 可追踪（§4.3）

位置：`src/compiler/cache/compileCache.ts`

已在 §4.6 定义。

### 8.4 Capability Negotiation（§4.4）

位置：`src/runtime/capability.ts`

已在 §3.2 定义。

### 8.5 Error Taxonomy（§4.5）

位置：`src/shared/errors.ts`

```typescript
enum ErrorCode {
  PARSE_ERROR = 'parse_error'
  VALIDATION_ERROR = 'validation_error'
  COMPILE_ERROR = 'compile_error'
  GPU_CAPABILITY_ERROR = 'gpu_capability_error'
  RUNTIME_SHADER_ERROR = 'runtime_shader_error'
  LLM_CONTRACT_ERROR = 'llm_contract_error'
}

class PixelForgeError extends Error {
  code: ErrorCode
  details?: any
}
```

### 8.6 性能指标制度化（§4.7）

位置：`src/runtime/profiler.ts`（GPU）+ `src/compiler/profiler.ts`（CPU）

```typescript
interface FrameMetrics {
  // CPU
  clarifyTime: number
  parseTime: number
  irBuildTime: number
  encodeTime: number
  workerMergeTime: number

  // GPU
  pipelineSwitchCost: number
  dispatchTime: number
  textureWriteTime: number
  presentTime: number

  // 内存
  descriptorBufferBytes: number
  auxBufferBytes: number
  textureMemoryBytes: number
  workerTempBytes: number

  // 交互
  promptToPreviewLatency: number
  paramChangeToUpdateLatency: number
  fullCompileTime: number
}
```

采集点：

```text
- L2 RequirementClarifier 入口/出口
- L2 parser 入口/出口
- L1 regionCompiler 入口/出口
- L1 encoder 入口/出口
- L0 compute pass 入口/出口
- L0 present 入口/出口
```

---

## 9. Phase A 必做最小集

### 9.1 文件清单

```text
src/runtime/device.ts
src/runtime/capability.ts
src/runtime/pipeline.ts
src/runtime/encoder.ts
src/runtime/output.ts
src/runtime/profiler.ts
src/runtime/types.ts

src/compiler/ir/renderIR.ts        （最小定义）
src/compiler/ir/layer.ts
src/compiler/ir/region.ts
src/compiler/encoder/opcode.ts     （4 个 opcode，BLEND 推迟 Phase B）
src/compiler/encoder/descriptor.ts  （64-bit）
src/compiler/encoder/profile.ts
src/compiler/region/regionCompiler.ts
src/compiler/context.ts

src/shared/types.ts
src/shared/ids.ts
src/shared/seed.ts
src/shared/errors.ts
src/shared/constants.ts

src/shaders/region_eval.wgsl       （Phase A 主 shader，已创建）
src/shaders/present.wgsl           （已创建）
（src/shaders/compute_64.wgsl       Phase B+ 才创建，per-pixel descriptor 特殊路径）

src/stores/runtime.ts              （替换 counter.ts）
src/App.vue                         （改为画布 + 调试面板）
src/main.ts                         （追加 initGPU）
src/env.d.ts                        （追加 *.wgsl?raw 声明）

package.json                        （追加 @webgpu/types）
```

### 9.2 Phase A 验收清单

```text
[ ] WebGPU device 初始化成功，失败有明确错误
[ ] capability negotiation 探测清单全部完成
[ ] capability 不支持 rgba8unorm storage texture 时抛 gpu_capability_error（方案 A）
[ ] region-only pipeline 编译成功（region_eval.wgsl）
[ ] present pipeline 编译成功（present.wgsl）
[ ] 4 个 opcode 各能正确渲染（SOLID_COLOR / LINEAR_GRADIENT / NOISE / CIRCLE_SHAPE）
[ ] BLEND opcode 在 RegionCompiler 中触发 COMPILE_ERROR（Phase A 不支持）
[ ] storage texture 直写路径可用
[ ] descriptorBuffer 和 auxBuffer 正确上传并解包
[ ] Canvas 格式与 storage texture 格式分离（canvas 用 getPreferredCanvasFormat）
[ ] present.wgsl 正确采样 storage texture 并显示
[ ] 性能面板显示 CPU 耗时（GPU timestamp 推迟 Phase B）
[ ] 1080p 单帧稳定渲染
[ ] 单帧渲染后不进行 rAF 循环（渲染一次就挂起）
```

### 9.3 Phase A 不做的事

```text
- 不接 LLM
- 不做图像理解
- 不做 WDL
- 不做 Timeline / Revision
- 不做完整 ruleParser（仅 hard-coded RenderIR）
- 不做 worker pool
- 不做 compile cache
- 不做 patch engine（Phase B 才做）
```

---

## 10. opcode 扩展机制

### 10.1 注册位置

`src/compiler/encoder/opcode.ts`

### 10.2 扩展步骤（以追加 RECT_SHAPE 为例）

```text
1. opcode.ts 追加 RECT_SHAPE = 5
2. 编写 OpcodeSpec:
   {
     opcode: RECT_SHAPE,
     name: 'rect_shape',
     paramSchema: { x, y, w, h, color },
     shaderBranch: 'rect_shape',
     profileSupport: ['64', '128']
   }
3. 注册到 OpcodeRegistry
4. compute_64.wgsl 追加 'rect_shape' 分支
5. encoder.ts 追加编码逻辑
6. 测试：单独渲染一个矩形
```

### 10.3 shader 分支策略

首期不追求"函数指针表替代 switch"。

策略：

```text
- 高频 opcode（SOLID_COLOR / LINEAR_GRADIENT）：紧凑分支（Phase A）
- BLEND 在 Phase B 才启用，走独立 blend pass，不进 region_eval
- 低频 opcode：普通分支
- 不同 render plan 用不同 pipeline（参考补充说明 §5）
```

---

## 11. profile 切换机制

### 11.1 支持的 profile

```text
- '64'             64-bit descriptor pipeline
- '128'            128-bit descriptor pipeline（特殊路径）
- 'region'         region-only pipeline（DM-1 默认路径）
- 'present'        显示 pipeline（无 profile 切换）
```

### 11.2 切换决策

```text
默认：'region'（DM-1）
升级到 '64'：当 region 出现 per-pixel 需求（手工冻结、复杂 mask）
升级到 '128'：当 64-bit 不够表达（多参数特效）
```

### 11.3 切换成本

零编译成本（已预编译，参考 Chapter 22 §22.5 [L1862](file:///c:/Users/yangx/Desktop/2号想法/PixelForge_技术实现路线.md#L1862)）。

但运行时有 pipeline switch cost，由 profiler.ts 采集。

---

## 12. 与现有文档的对齐

### 12.1 直接对齐的章节

| 骨架模块 | 对应文档章节 |
|---|---|
| L0 Render Runtime | Chapter 13 Descriptor Profile、Chapter 14 Tauri+Vue 架构 |
| L1 Pixel Compiler | Chapter 18.4 IEncoder/IRenderer/IShaderManager 接口 |
| L2 RequirementClarifier | Chapter 22 §22.4 ambiguities 概念 |
| L2 ruleParser | Chapter 22 §22.2 encodeFromSemantic |
| L2 callLLM | Chapter 22 §22.2 [L1820](file:///c:/Users/yangx/Desktop/2号想法/PixelForge_技术实现路线.md#L1820) |
| L2 ColorBlockTree | Chapter 21、Chapter 22 §22.4 [L1841](file:///c:/Users/yangx/Desktop/2号想法/PixelForge_技术实现路线.md#L1841) |
| L1 descriptor 编码 | Chapter 12.x、Chapter 13 |
| L0 pipeline | Chapter 13 |
| L3 所有模块 | Chapter 23-27（Phase F+ 启动） |

### 12.2 不直接对齐的部分

| 骨架模块 | 与文档差异 | 原因 |
|---|---|---|
| Render IR | 文档无此概念 | 补充说明 §7 新增 |
| Patch 协议 | 文档无此概念 | DM-6 新增 |
| CompileContext.worldMetadata | 文档无 | L3 接入点 3 新增 |
| Layer.paramOwnership | 文档无 | L3 接入点 5 新增 |
| Layer.source / Region.source | 文档无 | L3 接入点 4 新增 |
| OpcodeRegistry | 文档无扩展机制 | DM-3 扩展需要 |

### 12.3 应同步追加到 Chapter 22 的 TODO

参考 Chapter 22 §22.5 接口契约表格格式，新增：

| 名称 | 位置 | 说明 | 契约 |
|---|---|---|---|
| `IAIDirector.create()` | 27.5 | 生成模式入口 | 输入 User Prompt + Persona，输出 TimelineContent |
| `IAIDirector.revise()` | 27.6 | 修改模式入口 | 输入 RevisionIntent，输出 Revision Request |
| `IRegionCompiler.compile()` | 骨架 §4.5 | region 编译 | 输入 RenderIR + CompileContext，输出 RenderPlan |
| `IPatchEngine.apply()` | 骨架 §4.2 | patch 应用 | 输入 Patch + RenderIR，输出修改后 RenderIR + 失效范围 |
| `ICapabilityNegotiator.detect()` | 骨架 §3.2 | capability 探测 | 启动时调用，输出 CapabilityProfile |
| `ICompileCache.get/set()` | 骨架 §4.6 | cache 读写 | 输入 cache key，输出 CompileResult |
| `IRequirementClarifier.clarify()` | 骨架 §5.1 | 需求澄清 | 输入 prompt，输出三态结果 |

---

## 13. 实施声明（建议加入路线文档顶部）

```text
实施声明：

1. 首期以 Pixel Compiler + WebGPU Render Runtime 为主线闭环。
2. PixelForge 的核心能力是将结构化语义编译为 GPU 可执行描述；
   首期默认执行路径采用 Region-first + GPU eval，
   per-pixel descriptor 保留为高精度、局部冻结、局部编辑和特殊效果路径。
3. WDL / Scene Graph / Asset Genome / Timeline / AI Director 在首期不作为启动依赖，
   但 L2/L1 必须为其预留干净接入点（见骨架设计 §6.2）。
4. Render IR 与 WDL 严格分层：
   WDL 描述世界，Render IR 描述 2D 渲染输入。
   Timeline / Revision 以外部 patch 作用于 Render IR，不嵌入。
5. Timeline / Revision 在 Phase F 之前不进入底层渲染协议；
   Phase B-E 期间的编辑统一走 parameter patch + cache invalidation。
6. 所有 LLM 输出必须经过 schema 校验，不允许直接进入渲染层。
7. 所有程序化生成必须支持 deterministic seed。
8. 所有性能结论必须基于指标验证，不以主观判断替代。
9. 如果出现架构边界冲突、协议职责不清或核心方向不确定，必须暂停并先确认。
```

---

## 14. 审查清单对照

按你提出的审查点逐项对照：

| 审查点 | 对应章节 | 状态 |
|---|---|---|
| 是否对齐 L0/L1/L2/L3 四层 | §2 | ✅ |
| 是否覆盖 4 个 opcode 的实现位置 | §4.3、§9.1、§10 | ✅（BLEND 推迟 Phase B） |
| 是否为 L3 预留了 5 个接入点 | §6.2 | ✅（逐项落位） |
| 是否定义了 Render IR patch 协议 | §4.2 | ✅（§4.2.1 收口为 RenderIRPatch） |
| 是否含 capability negotiation | §3.2、§8.4 | ✅ |
| 是否含性能指标采集点 | §3.5、§8.6 | ✅ |
| 是否含 schema 定义位置 | §5.5、§8.1 | ✅ |
| 是否与现有 my-app/ 脚手架兼容 | §1 | ✅ |
| 是否定义 SourceKind 枚举 | §4.1.4 | ✅（6 个固定值，禁止开放字符串） |
| 是否定义 ParameterOwner 枚举 | §4.1.5 | ✅（6 个固定值，含冲突处理原则） |
| 是否定义 RenderIRPatch 最小协议 | §4.2.1 | ✅（含 path/scope/冲突处理） |
| 是否对齐 64-bit descriptor 字段布局 | §4.4 | ✅（三方一致：§4.4 + §4.5 + region_eval.wgsl） |
| 是否定义 aux buffer 数据布局 | §4.4 | ✅（vec4f 槽对齐，含 5 个 opcode slot 表） |
| 是否定义 EncodedResult 编码接口 | §4.4 | ✅（descriptor: Uint32Array(2) + auxSlots: Float32Array[]） |
| 是否拆分 PipelineManager 强类型接口 | §3.3 | ✅（getComputePipeline / getRenderPipeline 分离） |
| 是否补全 L0 encoder/output 接口签名 | §3.4 | ✅（executeRenderPlan / presentToCanvas / createStorageTexture） |
| 是否定义 bind group layout 约定 | §3.3 | ✅（compute 4 个 binding + present 3 个 binding） |
| 是否定义 L0 数据流 | §3.4 | ✅（compile → execute → present 三步流程） |

---

## 15. 下一步

骨架已固化。建议下一步：

1. 在路线文档顶部追加 §13 实施声明
2. 同步追加 Chapter 22 §22.5 的 TODO 行（见 §12.3）
3. 启动 Phase A 实施（按 §9 文件清单）
4. Phase A 完成后回到 DM-1 决策：是否将 Region-first 正式立为核心方向（建议仍选 C）
