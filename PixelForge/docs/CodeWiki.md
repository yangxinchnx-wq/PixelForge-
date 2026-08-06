# PixelForge Code Wiki

> 版本基线：阶段六（Step 25–40.4 已完成）
> 文档目的：系统化梳理项目整体架构、模块职责、关键类与函数、依赖关系及运行方式，作为开发者快速上手与协作维护的权威参考。

---

## 目录

1. [项目概述](#1-项目概述)
2. [技术栈与运行环境](#2-技术栈与运行环境)
3. [项目目录结构](#3-项目目录结构)
4. [整体架构与分层](#4-整体架构与分层)
5. [核心数据流与渲染管线](#5-核心数据流与渲染管线)
6. [模块详解](#6-模块详解)
   - 6.1 [shared（共享基线层）](#61-shared共享基线层)
   - 6.2 [compiler（编译层）](#62-compiler编译层)
   - 6.3 [runtime（WebGPU 运行时）](#63-runtimewebgpu-运行时)
   - 6.4 [graph（可视化编程图引擎）](#64-graph可视化编程图引擎)
   - 6.5 [material（材质/Shader 系统）](#65-material材质shader-系统)
   - 6.6 [render/compositor（多轨合成器）](#66-rendercompositor多轨合成器)
   - 6.7 [shaders（WGSL 着色器集）](#67-shaderswgsl-着色器集)
   - 6.8 [authoring（创作管线）](#68-authoring创作管线)
   - 6.9 [world（L3 动态世界层）](#69-worldl3-动态世界层)
   - 6.10 [editor（编辑器子系统）](#610-editor编辑器子系统)
   - 6.11 [storage（三层存储）](#611-storage三层存储)
   - 6.12 [services/frame（帧服务）](#612-servicesframe帧服务)
   - 6.13 [assets / media / input（资源、媒体、输入）](#613-assets--media--input资源媒体输入)
   - 6.14 [project（项目管理）](#614-project项目管理)
   - 6.15 [utils / workers（工具与 Worker 池）](#615-utils--workers工具与-worker-池)
   - 6.16 [前端 UI 层（components / stores / composables）](#616-前端-ui-层components--stores--composables)
   - 6.17 [src-tauri（Tauri 桌面壳）](#617-src-tauritauri-桌面壳)
7. [依赖关系总览](#7-依赖关系总览)
8. [项目运行方式](#8-项目运行方式)
9. [测试与 CI](#9-测试与-ci)
10. [附录：错误码与所有权优先级](#10-附录错误码与所有权优先级)

---

## 1. 项目概述

PixelForge 是一个基于 **Vue 3 + TypeScript + Vite + Tauri + WebGPU** 的可视化编程视觉引擎。项目从早期的"AI 生成器"逐步演进为涵盖"可视化编程 + 实时动画 + GPU 计算 + 专业时间轴 + 渲染导出 + 音频混音 + 视频效果链 + Asset Genome + AI Director 对话式创作 + WDL 声明式渲染 DSL"的完整视觉引擎。

核心能力包括：

- 文本 Prompt → RenderIR → GPU 渲染的端到端管线
- 基于 RenderGraph 的可视化节点编辑
- WDL（World Description Language）声明式渲染 DSL（含 Monaco 编辑器集成）
- AI Director 多轮对话式创作（create / modify / animate / analyze 四模式）
- 三层存储（L1 内存 LRU / L2 OPFS / L3 Rust Redb）
- WebGPU 多 Pass 渲染管线 + 三层缓存签名
- 专业时间轴 Pro Timeline（Project / Sequence / Track / Clip）
- 视频解码（WebCodecs）+ 编码（mp4/webm）+ 效果链
- Tauri 跨平台桌面应用（Windows / macOS / Linux）

---

## 2. 技术栈与运行环境

### 2.1 前端

| 类别 | 技术 | 版本 |
|------|------|------|
| 框架 | Vue 3 | 3.5.39 |
| 状态管理 | Pinia | 4.0.2 |
| 路由 | vue-router | 4.6.4 |
| 构建工具 | Vite | 8.1.4 |
| 类型 | TypeScript | 6.0.3 / vue-tsc 3.3.7 |
| 代码编辑器 | Monaco Editor | 0.56.0 |
| Monaco Vue 适配 | @guolao/vue-monaco-editor | 1.6.0 |
| 动画 | anime.js | 4.5.0 |
| 图标 | @phosphor-icons/vue | 2.2.1 |
| 视频封装 | mp4-muxer / webm-muxer | 5.2.2 / 5.1.4 |
| 测试 | Vitest | 3.2.4 |
| IndexedDB Mock | fake-indexeddb | 6.2.5 |
| WebGPU 类型 | @webgpu/types | 0.1.71 |

### 2.2 桌面壳

| 类别 | 技术 | 版本 |
|------|------|------|
| 应用框架 | Tauri | 2.5 |
| Tauri CLI | @tauri-apps/cli | 2.11.4 |
| Tauri API | @tauri-apps/api | 2.11.1 |
| 嵌入式 KV | redb (Rust) | 2.x |
| Rust edition | - | 2021 |

### 2.3 浏览器能力依赖

- **WebGPU**：核心渲染能力（计算着色器 + 存储缓冲区 + 存储纹理）
- **OPFS**（Origin Private File System）：L2 二进制存储
- **WebCodecs**：视频硬件编解码
- **Web Audio API**：音频混音
- **Web MIDI API**：MIDI 输入
- **MediaDevices**：摄像头输入

---

## 3. 项目目录结构

```
PixelForge/                                  # 仓库根
├── .github/workflows/ci.yml                # CI 配置
├── PixelForge/                              # 应用主目录
│   ├── src/                                 # TypeScript 源码
│   │   ├── main.ts                          # 应用入口
│   │   ├── App.vue                          # 根组件
│   │   ├── data.ts / data/presetData.ts     # 预设数据
│   │   ├── env.d.ts / vite-env.d.ts         # 环境类型
│   │   │
│   │   ├── shared/                          # 共享基线层（常量/类型/ID/错误/seed）
│   │   ├── compiler/                        # 编译层（RenderIR / Patch / Region Compiler）
│   │   ├── runtime/                         # WebGPU 运行时
│   │   ├── graph/                           # 可视化编程图引擎
│   │   ├── material/                        # 材质/Shader 系统
│   │   ├── render/compositor/               # 多轨合成器
│   │   ├── shaders/                         # WGSL 着色器
│   │   ├── authoring/                       # 创作管线（Prompt → IR）
│   │   ├── world/                           # L3 动态世界层（WDL/Director/Orchestrator/Timeline）
│   │   ├── editor/                          # 编辑器子系统（Asset Genome/Audio/Effects/Render/Inspector）
│   │   ├── storage/                         # 三层存储
│   │   ├── services/frame/                  # 帧服务
│   │   ├── assets/                          # 资源加载与缓存
│   │   ├── media/                           # 视频解码/编码/缩略图
│   │   ├── input/                           # 输入系统（Audio/Camera/MIDI/Sensor）
│   │   ├── project/                         # 项目管理与序列化
│   │   ├── utils/                           # 通用工具
│   │   ├── workers/                         # Web Worker 池（L1 编译）
│   │   ├── components/                      # Vue 组件
│   │   │   ├── editor/                      # 编辑器组件（graph/inspector/...）
│   │   │   ├── ui/                          # 基础 UI 组件
│   │   │   └── *.vue                        # 顶层功能面板
│   │   ├── composables/                     # 组合式函数
│   │   ├── directives/                      # 自定义指令（tooltip）
│   │   ├── stores/                          # Pinia stores
│   │   ├── router/                          # 路由
│   │   ├── styles/index.css                 # 全局样式（Apple Liquid Glass 设计系统）
│   │   └── types.ts                         # 全局类型
│   │
│   ├── src-tauri/                           # Rust 后端
│   │   ├── src/{db.rs, lib.rs, main.rs}     # Tauri 入口 + Redb 数据库
│   │   ├── Cargo.toml                       # Rust 依赖
│   │   ├── tauri.conf.json                  # Tauri 配置
│   │   ├── capabilities/default.json        # 权限声明
│   │   └── build.rs
│   │
│   ├── docs/                                # 项目文档
│   ├── public/                              # 静态资源
│   ├── dist/                                # 构建产物
│   ├── package.json
│   ├── Cargo.toml                           # Rust workspace 根
│   └── README.md
└── .gitignore
```

---

## 4. 整体架构与分层

PixelForge 采用严格的分层架构，每层只向下依赖，禁止反向引用。

### 4.1 分层视图

```
┌──────────────────────────────────────────────────────────────┐
│  UI 层 (components/*.vue + composables + directives)         │
│  ─ 用户交互、可视化编辑、面板展示                              │
└────────────────────────┬─────────────────────────────────────┘
                         │
┌────────────────────────▼─────────────────────────────────────┐
│  状态层 (stores: app / runtime / runtime-inspector /         │
│          history / errorStore + editor 子系统 stores)         │
└────────────────────────┬─────────────────────────────────────┘
                         │
┌────────────────────────▼─────────────────────────────────────┐
│  World L3 动态层 (world/)                                    │
│  ─ Director / Orchestrator / Timeline / Revision /           │
│    SceneGraph / WDL Document                                 │
│  ─ 三个子系统通过 PatchEngineLike 接口作用于 L1 patchEngine    │
└────────────────────────┬─────────────────────────────────────┘
                         │ ValuePatch / StructuralPatch /
                         │ TopologyPatch / MetadataPatch
┌────────────────────────▼─────────────────────────────────────┐
│  Compiler 层 (compiler/)                                     │
│  ─ RenderIR 中间表示 + Patch 协议 + patchEngine 事务状态机    │
│  ─ regionCompiler：RenderIR → RegionCompileArtifact           │
│  ─ compileCache：三层 cache key（static/structural/dynamic）  │
│  ─ ruleParser / previewPyramid                                │
└────────────────────────┬─────────────────────────────────────┘
                         │ RegionCompileArtifact
┌────────────────────────▼─────────────────────────────────────┐
│  Runtime + Graph + Material 层                               │
│  ─ runtime: WebGPU device/engine/scheduler/多 Pass 管线       │
│  ─ graph: RenderGraph → RenderIR + GraphRuntime GPU 求值      │
│  ─ material: MaterialGraph → WGSL + ShaderCache              │
└────────────────────────┬─────────────────────────────────────┘
                         │ GPU dispatch (WGSL)
┌────────────────────────▼─────────────────────────────────────┐
│  Render Compositor + Shaders 层                              │
│  ─ compositor: 多轨 Layer 合成（mask/blend/transform）       │
│  ─ shaders: 6 个 WGSL（region_eval/effect_post/present/...） │
└────────────────────────┬─────────────────────────────────────┘
                         │
┌────────────────────────▼─────────────────────────────────────┐
│  Storage 三层 (memoryCache / opfsStore / tauriDb)            │
│  ─ unifiedStore 统一编排，自动降级                            │
└──────────────────────────────────────────────────────────────┘
```

### 4.2 关键架构约束

1. **L0/L1/L2/L3 四层划分**：
   - **L0**：画面（partial upload 上传到 canvas）
   - **L1**：`patchEngine` + `regionCompiler`（修改与编译 RenderIR）
   - **L2**：RenderIR 静态层 + `l2_user` 参数（用户编辑基线）
   - **L3**：Timeline / Revision / Director 三个动态子系统

2. **参数所有权优先级**（`OWNER_PRIORITY`）：

   | Owner | 优先级 | 含义 |
   |-------|--------|------|
   | `l3_revision` | 100 | Revision Layer 覆盖（可被 l2_user 否决） |
   | `l2_user` | 90 | 用户直接编辑 |
   | `l3_timeline` | 70 | 关键帧动画驱动 |
   | `l3_director` | 70 | AI Director 决策 |
   | `l2_parser` | 50 | WDL/Rule Parser 初始解析 |
   | `system_default` | 10 | 系统默认值 |

3. **静态边界硬约束**（RenderIR 6 条不可破坏约束）：
   - params 字段必须是 `JsonLiteral`
   - Layer/Region/Effect 不出现 `time/frame/phase` 等时间字段
   - `WorldMetadata` 仅允许标识/标签/引用三类字段
   - `CompileHints` 不含时间窗口/帧号
   - 不允许跨帧资源引用
   - 不允许携带可执行语义

4. **纯函数 + immutable 设计**：domain 层（assetRegistry / referenceGraph / timelineManager / revisionLayer / audioMix / effectChain / renderConfig）均为纯函数 + immutable Map，Store 层包装为响应式。

---

## 5. 核心数据流与渲染管线

### 5.1 端到端渲染管线

```
用户输入 (text prompt)
   │
   ├─► [作者层] promptParser → intentAnalyzer → clarifier(可选追问)
   │      → generator(planner + renderIRGenerator) → RenderIR
   │
   ├─► [WDL 路径] wdlLexer → wdlParser → wdlValidator
   │      → wdlCompiler → RenderIR  (与上面任选其一)
   │
   ├─► [AI Director] directorConversation → converse()
   │      → DirectorPatch[] → toValuePatches() → patchEngine
   │
   ├─► [可视化图] GraphEditor → graphCompiler.compileGraph(graph)
   │      → RenderIR
   │
   ▼
RenderIR (L2 静态层)
   │
   ├─► applyPatch()  (ValuePatch / StructuralPatch / TopologyPatch / MetadataPatch)
   │      来自 L3 Timeline/Revision/Director 或 L2 用户编辑
   │
   ▼
patchEngine.endFrame() → 新的 immutable RenderIR
   │
   ├─► compileCache.computeCacheKeys() → 命中缓存跳过编译
   │
   ├─► workerPool.compile(ir) → RegionCompileArtifact
   │      (Worker 内调用 regionCompiler.compileRenderIRToRegionArtifact)
   │
   ▼
RegionCompileArtifact (descriptorData / auxData / regionData / effectDescData)
   │
   ├─► runtime engine GPU dispatch
   │      ├─ region_eval.wgsl   (多图层区域求值 + 混合)
   │      ├─ graph_node_eval.wgsl (单节点独立求值)
   │      ├─ graph_composite.wgsl (节点合成)
   │      ├─ graph_effect.wgsl / effect_post.wgsl (效果后处理)
   │      └─ present.wgsl        (呈现到 canvas)
   │
   ▼
画面 (canvas)
```

### 5.2 L3 编排流（Orchestrator）

`createL3Orchestrator(engine, config)` 创建编排器，内部封装三个子模块：

- **TimelinePlayer**（连续）：外部 rAF/scheduler 调用 `tick(deltaTime)` 驱动
- **RevisionApplier**（离散）：UI 调用 `applyRevision(layer, force?)`
- **DirectorApplier**（离散）：UI 调用 `applyDirectorFromPrompt(prompt, options?)`

执行优先级：Director → Revision → Timeline（不在同一帧混用避免 patch 冲突）。

所有 patch 通过 `PatchEngineLike` 接口提交：
```
engine.beginFrame() → engine.apply(patch) → engine.endFrame()
失败 → engine.rollback()
```

### 5.3 双图架构

```
RenderGraph (高层语义图，描述"要什么")
   │  graphCompiler.compileGraph()
   ▼
RenderIR (高层 IR)
   │  regionCompiler
   ▼
RegionCompileArtifact → GPU dispatch

MaterialGraph (底层像素计算图，描述"每个像素怎么算")
   │  material/compiler.compileMaterialGraph()
   ▼
WGSL Source
   │  material/runtime.compilePipeline()
   ▼
GPUShaderModule + GPURenderPipeline → GPU render pass
```

---

## 6. 模块详解

### 6.1 shared（共享基线层）

**路径**：`src/shared/`

**职责**：项目「值层公约」与「基础类型层」的唯一来源；全局常量、错误分类、稳定 ID、确定性 seed。禁止其他模块重复定义。

#### 关键文件与导出

##### `types.ts`（值层公约核心）

```typescript
// JsonLiteral：递归联合类型，禁止 undefined/Function/Map/Set/Date/class 实例
export type JsonLiteral = string | number | boolean | null | JsonLiteral[] | { [k: string]: JsonLiteral }

// Opcode 枚举
export enum Opcode {
  SOLID_COLOR = 0, LINEAR_GRADIENT = 1, NOISE = 2,
  CIRCLE_SHAPE = 3, IMAGE_TEXTURE = 4, /* ... */
}

export type BlendMode = 'normal' | 'multiply' | 'screen' | 'overlay' | 'add' | 'darken' | 'lighten'
export type SourceKind = 'generator' | 'image' | 'video' | 'text' | 'shader' | 'graph' | 'asset'
export type ParameterOwner = 'system_default' | 'l2_parser' | 'l2_user' | 'l3_timeline' | 'l3_director' | 'l3_revision'
export type ParamOwnership = Record<string, ParameterOwner>

export interface BoundingBox { x: number; y: number; width: number; height: number }
export interface CompileHints { /* ... */ }
export interface WorldMetadata { /* 标识/标签/引用 */ }
export interface CapabilityProfile { /* GPU 能力描述 */ }

// 运行时守卫
export function isJsonLiteral(value: unknown, seen?: WeakSet<object>, depth?: number): boolean
```

##### `constants.ts`
- 画布：`DEFAULT_CANVAS_WIDTH=1024`、`DEFAULT_CANVAS_HEIGHT=768`
- 上限：`MAX_LAYERS=64`、`MAX_REGIONS=16`、`MAX_EFFECTS=16`、`WORKGROUP_SIZE=16`
- 颜色/混合/方向关键词映射（中英文）

##### `ids.ts`
```typescript
export function stableId(source: string, content: string, prefix?: string): string  // FNV-1a 32-bit hash
export function stableLayerId(source, content): string  // prefix 'layer_'
export function stableRegionId / stableEffectId / stableColorBlockId
export function uniqueId(prefix?: string): string  // 时间戳+随机数（非稳定）
```

##### `seed.ts`
```typescript
export function createSeed(source: string): number  // FNV-1a 确定性 32-bit seed
export const DEFAULT_SEED = 42
```

##### `errors.ts`
```typescript
export type RuntimeErrorCode = 16 种错误码联合  // shader/pipeline/buffer/texture/dispatch/...
export type ReplayErrorCode = 4 种错误码联合
export function createRuntimeError(code, message): RuntimeErrorInfo  // 自动填充 severity/source/recoverable/timestamp
export function classifyError(caughtError, defaultSource?): RuntimeErrorInfo
export function getErrorCodeLabel(code): string
export function getSeverityLabel(severity): string
```

**依赖**：仅 `errors.ts` 依赖 `@/runtime/types`，其余零外部依赖。

---

### 6.2 compiler（编译层）

**路径**：`src/compiler/`

**职责**：定义 RenderIR 中间表示、Patch 协议、patchEngine 事务状态机、regionCompiler、compileCache、previewPyramid、ruleParser。

#### 6.2.1 `ir/renderIR.ts`（RenderIR 中间表示）

```typescript
export interface RenderIR {
  canvas: { width: number; height: number }
  layers: Layer[]
  regions: Region[]
  effects: Effect[]
  compileHints: CompileHints
  worldMetadata?: WorldMetadata
}

export interface Layer {
  id: string
  opcode: Opcode
  params: Params  // 必须是 JsonLiteral
  source: SourceKind
  sourceRef?: string
  paramOwnership: ParamOwnership
  visible: boolean
  blendMode?: BlendMode
}

// 字段切片策略（决定 patch tier）：
// static：id / opcode / type          → TopologyPatch
// dynamic：params                     → ValuePatch
// structural-patch：visible / bounds  → StructuralPatch
// metadata：source / sourceRef / paramOwnership → MetadataPatch

export function isParams(value: unknown): value is Params
export function validateStaticBoundary(ir: RenderIR): string[]  // 递归扫描违规字段
export function projectStaticKey(ir, ctx): StaticKeyInput
export function projectStructuralKey(ir): StructuralKeyInput
export function projectDynamicKey(ir, ctx): DynamicKeyInput
export function projectMetadataKey(ir): MetadataKeyInput
```

`FORBIDDEN_IR_FIELD_NAMES`：禁止字段列表（time/frame/phase/progress/animated/prevFrame/script/lambda 等）。
`FORBIDDEN_EFFECT_TYPE_NAMES`：禁止 Effect 类型（animate/animation/transition/motion/fade/pulse/flicker）。

#### 6.2.2 `ir/patch.ts`（Patch 协议）

四级 Patch 分档：

| Tier | 作用 | Cache 失效范围 |
|------|------|---------------|
| `value` | 改 params 动态值 | 仅 dynamicKey |
| `structural` | 改 visible/bounds/targetLayer | structuralKey + dynamicKey |
| `topology` | 增删实体/重排序 | 全部失效 |
| `metadata` | 改 source/worldMetadata | 仅 metadataKey |

```typescript
export type RenderIRPatch = ValuePatch | StructuralPatch | TopologyPatch | MetadataPatch
export type AnyPatch = RenderIRPatch | AtomicTopologyPatch | PatchBatch

export interface ValuePatch extends PatchBase {
  tier: 'value'
  targetEntity: 'layer' | 'effect'
  targetId: string
  paramKey: string
  value: JsonLiteral
}

export interface TopologyPatch extends PatchBase {
  tier: 'topology'
  op: TopologyOp  // 'add' | 'remove' | 'replace' | 'reorder'
  entity: TopologyEntity
  targetId?: string
  payload?: Layer | Region | Effect | { newOrder: string[] }
}

export function validatePatch(p: AnyPatch): string[]
export function assertPatchValid(p: AnyPatch): void  // throw PatchError
export function getAffectedCacheScopes(p: AnyPatch): PatchScope[]
export function getBatchTier(patches: RenderIRPatch[]): PatchTier
export function parseParamPath(path: string): string[] | null
```

错误码 `PatchErrorCode` 含 11 种错误（IR_PATCH_VIOLATION / IR_STATIC_BOUNDARY_VIOLATION / IR_PATCH_TARGET_NOT_FOUND / IR_PATCH_DUPLICATE_ID / IR_PATCH_DANGLING_REF / IR_PATCH_BATCH_NESTED 等）。

#### 6.2.3 `ir/patchEngine.ts`（无状态 Patch 应用引擎）

```typescript
export function applyPatch(ir: RenderIR, patch: AnyPatch): PatchApplyOutcome
// 返回 { ir, affectedScopes, appliedCount, errors? }
```

设计原则：
- **immutable**：返回新 ir，不修改输入
- 单 patch 失败 throw `PatchError`
- batch 任一失败立即停止并回滚，返回原 ir + errors + appliedCount=0
- AtomicTopologyPatch 作为单次原子 apply

内部 apply 函数：`applyValuePatch` / `applyStructuralPatch` / `applyMetadataPatch` / `applyTopologyPatch` / `applyAtomicTopologyPatch`。

#### 6.2.4 `ir/frameEngine.ts`（Frame 事务状态机）

```typescript
export function createPatchEngine(initialIr: RenderIR): PatchEngine & { getIR(): RenderIR }
```

状态机：`idle → queued → committed/rejected → idle`

- `beginFrame()`：开启新 frame，进入 queued
- `apply(patch)`：入队 patch（atomic 必须独占，禁止嵌套 PatchBatch）
- `endFrame()`：构造 PatchBatch 提交，全成功或全回滚
- `rollback()`：丢弃 queued patch

#### 6.2.5 `region/regionCompiler.ts`（RenderIR → GPU Artifact）

```typescript
export interface RegionCompileArtifact {
  schemaVersion: string  // 'region-artifact-v2'
  descriptorData: Uint32Array    // 图层描述符（2 * layerCount）
  auxData: Float32Array          // 图层参数拼接
  regionData: Float32Array       // 区域边界 (x,y,w,h) * regionCount
  effectDescData: Uint32Array    // 效果描述符
  effectParamData: Float32Array  // 效果参数拼接
  layers: LayerCompileEntry[]
  regions: RegionCompileEntry[]
  effects: EffectCompileEntry[]
}

export function compileRenderIRToRegionArtifact(ir: RenderIR): RegionCompileArtifact
```

描述符打包格式：
- `descriptorBuffer[2*i]` = `opcode(8) | blendMode(8) | auxIndex(16)`
- `descriptorBuffer[2*i+1]` = `regionIndex(16) | reserved(16)`（0xFFFF = 无区域限制）

支持 Opcode：SOLID_COLOR / LINEAR_GRADIENT / NOISE / CIRCLE_SHAPE / IMAGE_TEXTURE
支持 Effect：blur / bloom / color_shift / vignette / mask

#### 6.2.6 `cache/compileCache.ts`（三层 cache key 系统）

```typescript
export function computeCacheKeys(ir: RenderIR, ctx: CompileContext): CacheKeySet
export function getCachedArtifact(ir, ctx): RegionCompileArtifact | undefined
export function setCachedArtifact(ir, ctx, artifact): void
export function invalidateByScopes(scopes: PatchScope[]): number
export function invalidateByLayerId(layerId: string): number
```

三层 key：
- `staticKey`：canvas + opcodes + blendModes + effectTypes + outputStrategy + profileId
- `structuralKey`：visibleFlags + layerOrder + regionBounds + regionOrder + layerRefs
- `dynamicKey`：paramEntries（字典序）+ seed + compileHints

LRU 淘汰：最大 32 条 artifact 缓存。

#### 6.2.7 其他文件

- `parser/ruleParser.ts`：硬编码 parser，`parse(intent: ParsedIntent): RenderIR`，被 authoring 调用
- `preview/previewPyramid.ts`：多分辨率预览金字塔（Level 0 1/8 → Level 3 1/1），用户看到画面时间从 ~500ms 降到 ~50ms
- `tile/tileGrid.ts`：瓦片网格
- `region/demoIR.ts`：演示用 IR
- `region/evaluator.ts`：CPU 端 Region 求值（测试/降级用）
- `context.ts`：`CompileContext { capability, canvasSize, seed }`，默认 seed 1337

---

### 6.3 runtime（WebGPU 运行时）

**路径**：`src/runtime/`

**职责**：WebGPU device 生命周期、渲染引擎、帧调度、多 Pass 管线、GPU 资源管理、渲染缓存、Profiler。

#### 关键文件

- `device.ts`：WebGPU device/context 初始化、能力检测
- `capability.ts`：能力检测与 CapabilityProfile 生成
- `engine.ts`：主渲染引擎 `createEngine(deps: EngineDeps): PixelForgeEngine`
- `engineScheduled.ts`：调度版引擎
- `frameScheduler.ts`：帧调度器
- `pipeline.ts` / `multiPassPipeline.ts`：渲染管线（单 Pass / 多 Pass）
- `gpuResourceManager.ts`：GPU 资源管理
- `renderCache.ts` / `renderSignature.ts`：渲染缓存与签名
- `renderProfiler.ts` / `profiler.ts`：性能 Profiler
- `pixelSignature.ts`：像素级签名（用于回放一致性校验）
- `renderTarget.ts`：渲染目标管理
- `postProcessChain.ts`：后处理链
- `partialUpload.ts`：部分上传优化（仅上传变化区域）
- `output.ts`：输出处理
- `encoder.ts`：GPU CommandEncoder 封装
- `types.ts`：运行时类型

**集成点**：`App.vue` 通过 `runtimeStore` 启停引擎；`material/runtime.ts` 与 `render/compositor` 依赖 device。

---

### 6.4 graph（可视化编程图引擎）

**路径**：`src/graph/`

**职责**：RenderGraph 数据模型、编译为 RenderIR、运行时 GPU 求值、执行计划、GPU 资源池化、调度器。

#### 关键文件

- `graphCompiler.ts`：`compileGraph(graph: RenderGraph, options?): CompileResult`，流程：validateGraph → topologicalSort → generateIR
- `validator.ts`：`validateGraph(graph): ValidationResult`、`detectCycle(graph): string[] | null`、`canAddEdge(graph, edge): { ok, reason? }`，校验 OUTPUT 唯一性 / ID 唯一性 / Edge 引用完整性 / 端口类型 / DAG 无环 / 悬空节点警告
- `graphGenerator.ts`：图生成器
- `graphHistory.ts`：图编辑历史（命令模式 AddNode/RemoveNode/MoveNode/Connect/Disconnect/AutoLayout）
- `graphStore.ts`：Pinia store（nodes / edges / validation）
- `graphAnimation.ts`：图动画
- `layout.ts`：自动布局算法（`autoLayout`、`computeNodeBounds`、`NODE_SIZE`）
- `nodeRegistry.ts`：节点定义注册表（`getNodeDefinition`、`listNodeKeysByCategory`、`NodeRegistry`）
- `uiStore.ts`：UI 状态 store（zoom / offset / selection / connecting / menu）
- `types.ts`：`RenderGraph`、`GraphNode`、`GraphEdge`、`Port`、`PortType` 等
- `runtime/` 子目录：
  - `graphRuntime.ts`：图运行时
  - `evaluator.ts`：节点求值
  - `executionPlan.ts`：执行计划
  - `gpuDispatch.ts`：GPU dispatch
  - `scheduler.ts`：调度器
  - `bufferPool.ts` / `texturePool.ts`：GPU 资源池化
  - `cache.ts`：运行时缓存
  - `resourceManager.ts`：资源管理

---

### 6.5 material（材质/Shader 系统）

**路径**：`src/material/`

**职责**：MaterialGraph → WGSL 自动生成 + 类型检查 + 优化 + Shader 缓存 + WebGPU Pipeline 创建。

#### 关键文件

- `types.ts`：`MaterialNodeType`（TEXTURE/UV/MATH/COLOR/FILTER/OUTPUT）、`PortType`（float/vec2/vec3/vec4/texture）、`MaterialGraph`、`MaterialNode`、`MaterialEdge`、`MaterialPort`、`CompileContext`、`CompileResult`、`MaterialBinding`
- `compiler.ts`：`compileMaterialGraph(graph): CompileResult`，流程：拓扑排序 → 变量分配 → 节点 generateWGSL → 类型 cast → 组装完整 shader；输出 `{ wgsl, bindings, entryPoint: 'fs_main', nodeVarMap, hash }`
- `materialGraph.ts`：Pinia store `useMaterialGraphStore`，Actions：addNode / removeNode / connect / disconnect / compile / loadGraph / exportGraph
- `runtime.ts`：`MaterialRuntime` 类，`compilePipeline(result)`、`createBindGroup(pipeline, bindings, resources)`、`render(pipeline, outputView, bindGroup?)`
- `shaderCache.ts`：`ShaderCache` 类 + 单例 `shaderCache`，按 WGSL hash 缓存 GPUShaderModule/Pipeline，LRU 淘汰（默认 32 条），使用单调递增计数器替代 Date.now() 避免毫秒精度 LRU 误判
- `shaderRegistry.ts`：Shader 注册表
- `typeChecker.ts`：端口类型检查
- `wgslBuilder.ts`：WGSL 代码生成器
- `optimizer.ts`：Shader 优化器
- `compiler.ts` 内的 `topologicalSort(graph)`：与 graph/validator.ts 独立实现（避免循环依赖）

---

### 6.6 render/compositor（多轨合成器）

**路径**：`src/render/compositor/`

**职责**：多轨 GPU 合成器，从底向上绘制 Layer，支持 mask / blend / transform。

#### 关键文件

- `compositor.ts`：`Compositor` 类，`render(layers: RenderLayer[], outputTexture: GPUTexture)`，流程：创建 CommandEncoder → beginRenderPass → 遍历可见 Layer → drawLayer → submit
- `layer.ts`：`RenderLayer`、`RenderLayerType`（'video' | 'image' | 'text' | 'adjustment'）；Clip 是编辑概念，Layer 是渲染概念，Adjustment Layer 影响下面所有视频
- `blend.ts`：`BlendMode` enum + `BLEND_MODE_IDS` 映射；混合公式：Multiply `A*B` / Screen `1-(1-A)*(1-B)` / Overlay `mix(2*A*B, 1-2*(1-A)*(1-B), step(0.5,A))` / Add `min(A+B,1)`
- `mask.ts`：`Mask = CircleMask | RectangleMask | PathMask`
- `transform.ts`：`RenderTransform { position, scale, rotation }` + `createTransformMatrix(transform): number[]`，组合顺序：缩放 → 旋转 → 平移，输出 3×3 行优先矩阵
- `passes/compositePass.ts`：`CompositePass` 类，创建合成 RenderPipeline（Alpha 混合）
- `passes/blendPass.ts`：`BlendPass` 类，管理 GPU 混合状态 + WGSL `blend_colors` 函数
- `passes/maskPass.ts`：`MaskPass.getMaskCondition(mask): string`，生成 WGSL discard 条件代码片段（通过修改 UV 实现遮罩，而非修改 Texture）
- `shader/blend.wgsl` / `shader/composite.wgsl`：WGSL 着色器

---

### 6.7 shaders（WGSL 着色器集）

**路径**：`src/shaders/`

| 文件 | 用途 | Workgroup | 绑定 |
|------|------|-----------|------|
| `region_eval.wgsl` | 多图层区域求值核心，遍历所有图层混合 | `(16,16)` | uniform + outputTex + auxBuffer + descriptorBuffer + regionBuffer |
| `graph_node_eval.wgsl` | 单 REGION 节点独立求值（无图层循环） | `(16,16)` | uniform + outputTex + auxBuffer |
| `graph_composite.wgsl` | 多上游纹理合成（最多 2 输入） | - | uniform + inputTex0/1 + outputTex |
| `graph_effect.wgsl` | 单效果后处理（独立 dispatch） | - | uniform + inputTex + outputTex + paramBuffer |
| `effect_post.wgsl` | 效果后处理（read_write 就地修改） | - | outputTex + effectBuffer + effectDescBuffer + regionBuffer |
| `present.wgsl` | 呈现到 canvas（UV 翻转） | - | uniform + srcTex + nearestSampler |

**region_eval.wgsl 描述符布局**（V2）：
```
descriptorBuffer[2*i]     = opcode(8) | blendMode(8) | auxIndex(16)
descriptorBuffer[2*i + 1] = regionIndex(16) | reserved(16)
```

**effect_post.wgsl 描述符布局**：
```
effectDescBuffer[0] = effectCount
effectDescBuffer[1 + 2*i] = effectType(8) | reserved(8) | paramIndex(16)
effectDescBuffer[2 + 2*i] = targetRegionIndex(16) | reserved(16)
```

支持效果：BLUR / BLOOM / COLOR_SHIFT / VIGNETTE / MASK

---

### 6.8 authoring（创作管线）

**路径**：`src/authoring/`

**职责**：把自然语言 Prompt 转换为可渲染的 RenderIR。覆盖 Prompt 解析、意图分析、缺失字段澄清、图像分析、LLM 调用、RenderIR 生成全链路。

#### 子模块

##### `clarifier/`（需求澄清）
- `clarifier.ts`：澄清核心，检测意图与缺失字段，生成追问问题
- `intentAnalyzer.ts`：意图识别
- `missingDetector.ts`：缺失字段检测
- `questionGenerator.ts`：追问问题生成
- `types.ts`：`ClarifyQuestion`、`CreativeRequirement`

##### `clarify/requirementClarifier.ts`
旧版需求澄清器（兼容保留）。

##### `generator/`（RenderIR 生成）
- `planner.ts`：生成计划器
- `renderIRGenerator.ts`：RenderIR 生成器
- `layerTemplates.ts`：图层模板
- `parameterMapper.ts`：参数映射器
- `types.ts`：生成器类型

##### `image/`（图像理解）
- `adaptiveSplit.ts`：自适应分割
- `colorBlockTree.ts`：色块树
- `integralImage.ts`：积分图加速区域查询
- `analyzer.ts`：图像分析器
- `resize.ts`：图像缩放

##### `llm/`（LLM 集成）
- `callLLM.ts`：LLM 调用封装
- `llmParser.ts`：LLM 输出解析
- `modelDiscovery.ts`：模型发现（从 API 拉取）
- `modelRegistry.ts`：静态模型注册表
- `promptCache.ts`：Prompt 缓存
- `types.ts`：`LLMProviderConfig`、`ModelMetadata` 等

##### `prompt/`（Prompt 解析）
- `promptParser.ts`：Prompt 解析器
- `ruleParser.ts`：规则解析器
- `schema.ts`：JSON Schema
- `llmParser.ts`：LLM 输出解析
- `types.ts`：`ParsedIntent` 等

##### `schema/schemas.ts`
JSON Schema 定义，含 `validateLLMOutput` 用于校验 LLM 返回的 JSON。

#### 数据流

```
Prompt → promptParser → intentAnalyzer
  → clarifier (缺失字段时追问)
  → generator (planner + renderIRGenerator + parameterMapper + layerTemplates)
  → RenderIR
```

**依赖**：`compiler/ir/renderIR`、`shared/types`、`shared/ids`。

---

### 6.9 world（L3 动态世界层）

**路径**：`src/world/`

**职责**：L3 动态层，包含 WDL DSL、AI Director、Orchestrator、Timeline、Revision、SceneGraph、WDL Document。

#### 6.9.1 `wdl/`（WDL 声明式渲染 DSL）

**编译流水线**：
```
源码 → Lexer.tokenize() → Token[]
     → Parser.parse() → SceneNode (AST)
     → Validator.validate() → ValidationReport
     → compile(ast) → RenderIR
```

##### 关键文件

- `wdlLexer.ts`：`Lexer` 类 + `tokenize(source)`，`TokenType`（KEYWORD/IDENT/STRING/NUMBER/LBRACE/...），支持注释/字符串转义/负数/科学计数法/尺寸字面量
- `wdlParser.ts`：递归下降 `Parser` 类 + `parse(source)`，`SceneNode` AST（含 layers/effects/regions）
- `wdlCompiler.ts`：`compile(ast): RenderIR` + `compileSource(source): RenderIR`，opcode 名→enum、blendMode→类型、bounds→BoundingBox
- `wdlValidator.ts`：`validate(ast): ValidationReport`（收集所有错误不抛异常），校验 ID 唯一性 / effect.target 引用 / region.layers 引用 / 必填参数 / 类型 / canvas 尺寸
- `wdlMonarch.ts`：Monaco Monarch 词法定义（视图层高亮，与域 Lexer 独立）
- `wdlCompletion.ts`：Monaco 智能补全，`analyzeCompletionContext` + `generateCompletions` + `registerWDLCompletion`，7 类补全（块关键字/参数/opcode/blendMode/布尔/图层 ID 引用/参数名）
- `wdlGraphSync.ts`：WDL ↔ RenderGraph 双向同步，`wdlToGraph(ast)` / `graphToWdl(graph)`
- `wdlTimelineBinding.ts`：WDL ↔ ProTimeline 绑定，`ClipWdlBinding` / `BindingRegistry` / `computePatches(clips, registry)`
- `wdlDocument.ts`：WDL 文档（L3 只读元数据容器），`createWDLDocument` / `serializeWDL` / `deserializeWDL`
- `wdlRegister.ts`：`registerWDLLanguage(monaco)` 幂等注册（语言 ID + Monarch + 配置 + 主题 + 补全）
- `wdlLanguageConfig.ts`：括号匹配/自动闭合/注释切换/缩进规则
- `wdlTheme.ts`：`pixelforge-dark` 暗色主题
- `wdlTemplates.ts`：9 个内置模板（4 类：nature/urban/abstract/minimal），`validateAllTemplates()`

#### 6.9.2 `director/`（AI Director）

**数据流**：
```
User Prompt → parseIntent() → DirectorIntent
            → decide() → DirectorDecision
            → toValuePatches() → ValuePatch[] (source='l3_director')
            → patchEngine
```

##### 关键文件

- `director.ts`：基础骨架
  - `parseIntent(prompt): DirectorIntent`（本地意图分类，不调 LLM）
  - `decide(intent, options?): Promise<DirectorDecision>`（调 LLM，失败返回空决策）
  - `toValuePatches(patches, intentId): ValuePatch[]`
  - `DIRECTOR_SYSTEM_PROMPT`：要求 LLM 输出严格 JSON

- `directorContext.ts`：上下文引擎
  - `buildDirectorContext(ir, timeline?): DirectorContext`
  - `buildCreateModeContext` / `buildModifyModeContext`：序列化 RenderIR 为 LLM 上下文

- `directorEnhanced.ts`：增强版（双模式 + 上下文感知）
  - `DirectorMode = 'create' | 'modify' | 'animate' | 'analyze'`
  - `parseEnhancedIntent(prompt, ir?): EnhancedIntent`：检测模式/关键词/引用图层（支持中文数字解析）
  - `decideWithContext(intent, ir?, timeline?, options?): Promise<DirectorDecision>`

- `directorConversation.ts`：多轮对话 + Timeline 生成
  - `createConversation` / `addUserMessage` / `addDirectorMessage` / `clearConversation`
  - `serializeConversation(session): string`
  - `buildConversationSystemPrompt(session, mode, ir, timeline?): string`
  - `converse(session, prompt, ir?, timeline?, options?): Promise<ConversationSession>`
  - Timeline 生成：`extractAnimationParams(output, ir)` / `createTrackFromAnimation` / `createTimelineFromAnimations` / `generateTimelineFromLLM`

#### 6.9.3 `orchestrator/`（L3 主编排器）

##### `types.ts`
```typescript
export interface PatchEngineLike {
  beginFrame(): void
  apply(patch: AnyPatch): void
  endFrame(): PatchApplyResult
  rollback(): void
  getState(): unknown
  getQueuedPatches(): AnyPatch[]
  getIR(): RenderIR
}
export interface TickResult { currentTime; hasPatches; appliedCount; success; error?; skippedTracks? }
export interface ConflictResolution { needsConfirmation; conflicts; confirm? }
export interface RevisionApplyResult { success; appliedCount; needsConfirmation; conflicts; error? }
export interface DirectorApplyResult { success; appliedCount; reasoning; error? }
export interface L3Config { timelineSpeed; timelineLoop; directorAutoApply }
```

##### `l3Orchestrator.ts`
```typescript
export interface L3Orchestrator {
  loadTimeline / unloadTimeline / playTimeline / pauseTimeline / stopTimeline / seekTimeline / isTimelinePlaying / getCurrentTime
  checkRevisionConflicts(layer): ConflictResolution
  applyRevision(layer, force?): RevisionApplyResult
  applyDirectorFromPrompt(prompt, options?): Promise<DirectorApplyResult>
  applyDirectorFromIntent(intent, options?): Promise<DirectorApplyResult>
  tick(deltaTime): TickResult  // 只驱动 Timeline
  getTimelinePlayer / getRevisionApplier / getDirectorApplier
}
export function createL3Orchestrator(engine: PatchEngineLike, config?): L3Orchestrator
```

##### `directorApplier.ts` / `revisionApplier.ts` / `timelinePlayer.ts`
分别封装 Director / Revision / Timeline 三个子系统的应用逻辑。

#### 6.9.4 `timeline/`（时间轴）

- `timelineManager.ts`：immutable CRUD
  - `createKeyframe(time, value, interpolation?, bezierControl?)`
  - `createTrack(name, targetEntity, targetId, paramKey)`
  - `createTimeline(duration?, fps?, loop?)`
  - `addTrack` / `removeTrack` / `updateTrack` / `addKeyframe` / `removeKeyframe` / `updateKeyframe`
  - `getTimelineDuration` / `normalizeTimeline`

- `evaluator.ts`：
  - `interpolateKeyframes(t, k1, k2)`：linear / bezier（三次贝塞尔 Y 分量）/ step / hold
  - `evaluateTrack(track, time)`：二分查找关键帧区间
  - `evaluateTimeline(timeline, time): TimelineEvaluationResult`：为每条启用轨道生成 ValuePatch（source='l3_timeline'）

#### 6.9.5 `revision/`（Revision Layer）

最高优先级覆盖层（l3_revision），冲突处理：与 l2_user 冲突触发 needs_confirmation。

```typescript
export function createRevisionLayer(): RevisionLayer
export function createEntry(targetEntity, targetId, paramKey, value, reason): RevisionEntry
export function addEntry / removeEntry / updateEntry  // immutable，每次 version+1
export function toValuePatches(layer): ValuePatch[]  // source='l3_revision'
export function detectConflicts(layer, ownershipMap): ConflictResult
export function applyOwnership(layer, ownershipMap): Map<string, ParamOwnership>
```

#### 6.9.6 `sceneGraph/`（场景图）

L3 层世界描述，不直接进入渲染层，通过 Director 转换为 ValuePatch 作用于 RenderIR。

```typescript
export function createSceneGraph(): SceneGraph
export function createNode(name, type, parentId?, properties?): SceneGraphNode
export function createTransform(x?, y?, rotation?, scaleX?, scaleY?): SceneTransform
export function addNode / removeNode / updateNode / updateTransform  // immutable
export function getNode / getChildren / getParent / collectDescendants / getPath / getRoot / getNodeCount
```

#### 6.9.7 `world/types.ts`（L3 共享类型）

```typescript
// 关键类型
TimelineKeyframe / TimelineTrack / TimelineContent
RevisionEntry / RevisionLayer
DirectorIntent / DirectorDecision / DirectorPatch
SceneGraphNode / SceneTransform / SceneGraph
WDLDocument / WDLScene
TimelineEvaluationResult

// 关键常量与函数
export const OWNER_PRIORITY: Record<string, number>
export function compareOwnerPriority(a, b): number
```

---

### 6.10 editor（编辑器子系统）

**路径**：`src/editor/`

**职责**：编辑器独立子系统，包含 Asset Genome / Audio / Effects / Render / Inspector。

#### 6.10.1 `asset-genome/`（Asset Genome）

全项目资产管理系统，覆盖 14 种资产类型（image/texture/audio/video/material/shader/graph/sequence/template/clip/effectChain/animation/renderConfig/preset）。

##### `assetRegistry.ts`（注册表核心）
```typescript
export type AssetKind = 14 种资产类型联合
export type AssetCategory = 'media' | 'shader' | 'scene' | 'config'
export type AssetSource = 'builtin' | 'user' | 'imported'
export interface AssetMetadata { id; kind; category; name; source; version; tags; description?; createdAt; updatedAt; contentHash?; size?; thumbnail? }
export interface AssetRecord extends AssetMetadata { payloadRef? }
export type AssetRegistry = Map<string, AssetRecord>

// CRUD（immutable）
export function createRegistry / registerAsset / registerManyAssets / unregisterAsset / renameAsset / updateAssetMetadata / addTag / removeTag / bumpVersion / clearRegistry
// 查询
export function getAssetById / getAllAssets / getAssetCount / getAssetsByKind / getAssetsByCategory / getAssetsByTag / getAssetsBySource / searchAssets / hasAsset / groupByCategory / groupByKind
// 验证
export type AssetValidationError = 8 种错误码联合
export function validateAssetRecord(record): AssetValidationError[]
export function validateRegistry(registry): AssetValidationError[]
// 兼容性
export function assetFromLegacy(legacy): AssetRecord
```

##### `referenceGraph.ts`（引用图 DAG）
```typescript
export type ReferenceType = 'uses' | 'extends' | 'embeds'
export interface Reference { id; sourceId; targetId; type; createdAt; note? }
export interface ReferenceGraph { adjacency: Map<sourceId, Set<Reference>>; reverseIndex: Map<targetId, Set<Reference>> }

export function createReferenceGraph(): ReferenceGraph
export function createReference(sourceId, targetId, type?, note?): Reference  // 自引用抛错
export function addReference / removeReference / removeAllReferencesForAsset / clearReferenceGraph
export function getReferences (出边) / getReferencers (入边) / hasReference / getReferenceById / getAllReferences / getReferenceCount / getReferencesByType / getOutDegree / getInDegree / isAssetInGraph
```

##### `referenceGraphStore.ts`：Pinia store `useReferenceGraphStore`

##### `impactAnalysis.ts`（影响分析 + 循环检测）
```typescript
export function getDownstreamImpact(graph, assetId): Set<string>      // BFS 沿入边传播
export function getUpstreamDependencies(graph, assetId): Set<string>  // BFS 沿出边传播
export function getDownstreamDepth(graph, assetId): Map<string, number>
export function hasCycle(graph): boolean          // DFS 三色标记法
export function findCycles(graph): string[][]     // 所有环路
export function topologicalSort(graph): string[] | null  // Kahn 算法
export function getDownstreamImpactDetails(graph, assetId): ImpactItem[]
```

##### `contentHash.ts`（内容哈希 + 去重 + 相似检测）
```typescript
export function fnv1a32(input: string): string              // 32-bit FNV-1a
export function computeContentHash(params): string          // 'fnv1a_' 前缀
export async function computeBinaryHash(data): Promise<string>  // SHA-256 或 FNV-1a 降级
export function buildHashIndex / findDuplicates / findDuplicatesOf
export function computeSimilarity(a, b): SimilarityResult   // 0.4*name(Jaccard) + 0.4*tags(Jaccard) + 0.2*kind
export function findSimilarPairs / findSimilarTo
export function generateDedupSuggestions(assets): DedupSuggestion[]  // 保留最新创建的
```

##### `lazyLoader.ts`（增量加载 + 索引）
```typescript
export type LoadState = 'unloaded' | 'loading' | 'loaded' | 'error'
export interface AssetLoadStatus { assetId; state; startedAt?; completedAt?; error?; priority }
export interface AssetIndex { nameIndex; kindIndex; categoryIndex; tagIndex }  // 多维倒排索引
export interface LazyLoader { statusTable; loader }
export function createLazyLoader(loader): LazyLoader
export function requestLoad(lazyLoader, assetId, priority?): LazyLoader
export async function executeLoad(lazyLoader, assetId): Promise<LazyLoader>
export async function executeBatchLoads(lazyLoader, maxConcurrent?): Promise<LazyLoader>  // 顺序执行避免状态合并冲突
```

##### `assetPackaging.ts`（打包导出 + 导入）
```typescript
export interface AssetPackage { formatVersion: 1; name; createdAt; assets; references }
export interface ImportResult { importedAssetCount; importedReferenceCount; skippedAssetCount; errors }
export function createPackage / serializePackage / deserializePackage / validatePackage
export function mergePackage(existingAssets, existingReferences, pkg): { result; assets; references }  // 已存在 ID 跳过
export function createPackageWithIds(name, assets, references, assetIds): AssetPackage
```

#### 6.10.2 `audio/`（音频混音器）

- `audioMix.ts`：纯函数（不依赖 Web Audio API）
  - 类型：`PanValue`（[-1,1]）、`VolumeValue`、`AudioEffectType`（eq/compressor/reverb/gain）、`TrackMixConfig`、`MasterMixConfig`、`MixConfig`
  - 创建：`createTrackMixConfig` / `createDefaultMixConfig` / `createEqEffect` / `createCompressorEffect` / `createReverbEffect` / `createGainEffect`
  - 计算：`dbToLinear` / `linearToDb` / `panToGains`（等功率声像）/ `computeTrackGain` / `computeTrackChannelGain` / `estimateOutputLevel`
  - 操作：`addEffect` / `removeEffect` / `replaceEffect` / `toggleEffect` / `moveEffect` / `setTrackPan` / `setTrackSolo` / `setMasterVolume` / `setMasterPan` / `setMasterLimiter`
  - 验证：`validateMixConfig`

- `audioMixerStore.ts`：Pinia store `useAudioMixerStore`，AudioContext 延迟创建（浏览器策略要求用户交互），AnalyserNode fftSize=256 用于电平表

#### 6.10.3 `effects/`（视频效果链）

- `effectChain.ts`：17 种视频效果（5 大类：color/blur/transform/stylize/composite）
  - 类型：`VideoEffectType`（brightness_contrast / hue_saturation / color_temperature / levels / curves / gaussian_blur / radial_blur / motion_blur / transform / crop / sharpen / noise / vignette / chromatic_aberration / blend_mode / mask / keyer）
  - 16 种 `BlendMode`、`MaskType`（rectangle/ellipse/gradient）
  - 创建：`createEffect(type, enabled?)` / `createEffectChain(clipId)`
  - 操作：`appendEffect` / `insertEffect` / `removeEffect` / `moveEffect` / `setEffectEnabled` / `updateEffectParams` / `renameEffect` / `setEffectCollapsed`
  - 查询：`findEffect` / `getEnabledEffects` / `getEffectCount` / `getEnabledCount` / `groupByCategory`
  - 验证：`validateEffectParams`（clamp 到合法范围）/ `validateEffectChain`
  - 预设：5 个内置（电影感/复古/梦幻/故障/锐利高清），`applyPreset`

- `effectChainStore.ts`：Pinia store `useEffectChainStore`，每次修改后 `chains.value = new Map(chains.value)` 触发响应式

#### 6.10.4 `render/`（渲染导出）

- `renderConfig.ts`：
  - 类型：`RenderFormat`（png-sequence/webm/mp4）、`RenderQuality`（draft/standard/high）、`RenderStatus`、`RenderConfig`、`RenderJob`、`RenderPreset`
  - 6 个预设：1080p PNG / 1080p WebM / 4K PNG / 竖屏 WebM / 草稿预览 / 透明背景 PNG
  - `createRenderConfigFromSequence` / `createRenderConfigFromPreset` / `validateRenderConfig` / `computeTotalFrames` / `frameIndexToTime` / `generateFrameTimes`

- `renderPipeline.ts`：`RenderPipeline` 类
  - 状态流转：`idle → rendering → completed` / `rendering → paused → rendering` / `rendering → cancelled` / `rendering → failed`
  - `start()` / `pause()` / `resume()` / `cancel()`
  - 通过 `FrameRenderer` 回调实现实际渲染，`FrameExporter` 处理文件写入（与实际渲染解耦）
  - 暂停通过 Promise resolver 实现

- `renderStore.ts`：Pinia store `useRenderStore`
- `timelineTypes.ts`：本地类型存根，`Time = bigint`（微秒精度），`Sequence { id; name; width; height; fps; duration: Time }`

#### 6.10.5 `inspector/`（属性面板数据模型）

- `inspectorTypes.ts`：`PropertyType`（slider/number/color/select/toggle）、`PropertySchema`、`InspectorGroup`
- `propertySchemas.ts`：`getGroupsForOpcode(opcode): InspectorGroup[]`，4 个 opcode schema（SOLID_COLOR/LINEAR_GRADIENT/NOISE/CIRCLE_SHAPE），未知 opcode 兜底只展示 Render 组

---

### 6.11 storage（三层存储）

**路径**：`src/storage/`

**职责**：L1 内存 LRU + L2 OPFS + L3 Rust Redb，自动降级。

#### 关键文件

##### `memoryCache.ts`（L1 内存缓存）
```typescript
export class MemoryCache {
  get<T = unknown>(key: string): T | undefined
  set<T = unknown>(key: string, data: T): void
  setMany<T = unknown>(entries: Array<{ key: string; data: T }>): void
}
```
LRU 淘汰策略，含 `lastUsed` 时间戳。

##### `opfsStore.ts`（L2 OPFS 层）
通过 `opfs.worker.ts` 在 Worker 中操作 OPFS（Origin Private File System），存储大块二进制（图片/视频帧）。

##### `opfs.worker.ts`
OPFS Worker 入口，处理二进制读写消息。

##### `tauriDb.ts`（L3 Tauri/Rust Redb 层）
TS 侧适配层，通过 `@tauri-apps/api` 的 `invoke('db_xxx', ...)` 调用 Rust 命令。浏览器环境（无 Tauri）时 L3 不可用，自动降级到 OPFS。

##### `unifiedStore.ts`（三层编排器）
```typescript
export class UnifiedStore {
  async readBinary(category: 'frame', id: string): Promise<Uint8Array | null>
  async writeBinary(category: 'frame', id: string, data: Uint8Array): Promise<void>
  async readText(category: Exclude<StorageCategory, 'frame'>, id: string): Promise<string | null>
  async writeText(category: Exclude<StorageCategory, 'frame'>, id: string, text: string): Promise<void>
}
```

**读写流程**：
- 写：L1 写入 → L2 异步写入 → L3 异步写入（不可用降级）
- 读：L1 命中直接返回 → L2 命中回填 L1 → L3 命中回填 L1+L2 → 全未命中返回 null

##### `index.ts`
导出 `initStorage()` 初始化函数。

**集成点**：`main.ts` (initStorage)、`stores/app.ts` (项目保存/恢复)、`runtime.ts` (UnifiedFrameRepository)。

---

### 6.12 services/frame（帧服务）

**路径**：`src/services/frame/`

**职责**：帧存储/检索服务，使用 unifiedStore 作为后端。

#### 关键文件

- `repository.ts`：帧存储库接口
- `unifiedFrameRepository.ts`：基于 unifiedStore 的统一实现
- `indexedDbRepository.ts`：旧版 IndexedDB 实现（被 unifiedStore 替代，兼容保留）
- `adapter.ts`：适配器模式
- `playback.ts`：播放控制
- `timelineViewport.ts`：时间轴视口计算
- `types.ts`：帧服务类型

**集成点**：`runtime.ts` 中 `UnifiedFrameRepository` 替代了原 IndexedDB 直接访问。

---

### 6.13 assets / media / input（资源、媒体、输入）

#### 6.13.1 `assets/`（资产管理）
- `assetLoader.ts`：加载图片/视频为 `Asset` 对象，生成 blob URL 与缩略图
- `assetStore.ts`：Pinia store `useAssetStore`
- `assetToLayer.ts`：Asset → Layer 转换（接入 RenderIR）
- `textureCache.ts`：GPU 纹理缓存
- `types.ts`：`Asset`、`AssetType`、`AssetMeta`

#### 6.13.2 `media/`（媒体处理）

视频解码/编码全链路：

```
文件 → demuxer(mp4Demuxer/webmDemuxer) → DemuxedChunk
     → Worker 内 PixelVideoDecoder (WebCodecs) → VideoFrame
     → FrameCache → FrameUploader → GPUTexture → WebGPU 渲染
```

##### 关键文件
- `video/decoder/videoDecoder.ts`：`PixelVideoDecoder`，封装 WebCodecs `VideoDecoder`，硬件加速解码
- `video/decoder/decoderWorker.ts`：Worker 入口 `createDecoderWorker()`，消息协议 `configure/decode/seek/destroy`，帧通过 `postMessage` + Transferable 传输
- `video/decoder/frameScheduler.ts`：帧调度
- `video/demux/mp4Demuxer.ts` / `webmDemuxer.ts`：MP4/WebM 解封装
- `video/encoder/videoEncoder.ts` / `videoEncoderTypes.ts`：WebCodecs 视频编码（mp4-muxer / webm-muxer）
- `video/cache/frameCache.ts`：解码帧缓存
- `video/texture/frameUploader.ts`：`FrameUploader` 类，`createTexture(device,w,h)`、`upload(options)`、`update(device,texture,frame)`，通过 `copyExternalImageToTexture` 上传
- `video/metadata/videoMetadata.ts`：视频元数据提取
- `thumbnail/thumbnailCache.ts`：`LRUCache<K,V>`（limit=120）+ `ThumbnailCache`（按 assetId 分组管理 ImageBitmap）

#### 6.13.3 `input/`（输入系统）

统一输入路由分发，采集音频、摄像头、MIDI、传感器驱动渲染/时间轴。

##### 关键文件
- `inputRouter.ts`：统一输入路由分发
- `audio/audioAnalyzer.ts`：Web Audio API 麦克风采集 + FFT/时域分析
- `audio/beatDetector.ts` / `featureExtractor.ts` / `fft.ts`：节拍检测、特征提取、FFT 实现
- `camera/cameraInput.ts` / `motionDetector.ts`：摄像头输入与运动检测
- `midi/midiInput.ts`：Web MIDI API 输入
- `sensor/sensorInput.ts`：传感器输入
- `types.ts`：输入事件类型（使用 `AudioContextLike`、`MidiAccessLike` 等结构化类型解耦浏览器 API）

**集成点**：`inputRouter` 把事件分发给 `world/timeline` 与 `graph/runtime` 驱动动画。

---

### 6.14 project（项目管理）

**路径**：`src/project/`

#### 关键文件

- `serializer.ts`：
  - `createProjectSnapshot(name, runtime, timeline, history?, baseOn?): PixelForgeProject`
  - `serializeProject(project): string`（JSON 2 空格缩进）
  - `deserializeProject(json): PixelForgeProject`（含 `assertProjectShape` 结构校验）

- `autosave.ts`：`createAutosaver(saveCallback, options?): Autosaver`，支持 `start/stop/pause/resume/flush/isRunning/isPaused`

- `fileSystem.ts`：文件读写（下载/加载 `.pixelforge`）
- `projectExport.ts`：导出（视频/PNG 等）
- `projectStore.ts`：项目状态 Pinia store
- `projectValidator.ts`：项目校验
- `recentProjects.ts`：最近项目追踪
- `types.ts`：`PixelForgeProject`、`ProjectMetadata`、`TimelineSnapshot`、`HistoryEntrySnapshot`、`PROJECT_FILE_VERSION`、`DEFAULT_AUTOSAVE_INTERVAL_MS`

**集成点**：`stores/app.ts` 调用 `projectStore` 做保存/重置；`App.vue` 做项目恢复。

---

### 6.15 utils / workers（工具与 Worker 池）

#### 6.15.1 `utils/`（通用工具）

| 文件 | 关键导出 |
|------|---------|
| `clipUtils.ts` | `getClipEnd` / `isClipActiveAt` / `mapToSource` / `trimClipLeft` / `trimClipRight` / `moveClip` / `setClipSpeed` / `cloneClip` / `compareClipByStart` / `clipsForTrack` / `isSpliced` / `getSplicedGroup` / `getGroupRange` |
| `collision.ts` | `clipRange` / `checkCollision` / `findOverlapsAt` / `hitTestClip` / `findClipsInRange` / `collectGaps` / `resolveCollision`（基于间隙策略保证永不重叠）/ `hasResizeOverlap` / `clampResizeLeft` / `clampResizeRight` |
| `commandHistory.ts` | `Command` 接口（`{ label; execute(); undo() }`）、`CommandHistory` 类（`execute/undo/redo/canUndo/canRedo/clear/on`）、内置命令 `MoveClipCommand` / `TrimClipCommand` / `DeleteClipCommand` / `SplitClipCommand` |
| `frameLoop.ts` | `FrameLoopControl`、`startFrameLoop(callback, options?)`（60FPS rAF，dt 钳制 [0,100]ms）、`startFixedTimestepLoop(callback, fixedDt?, maxSteps?)` |
| `keyframe.ts` | `evaluateTrack(track, time)`（4 种插值 linear/ease(smoothstep)/hold/step/bezier，贝塞尔牛顿迭代 8 次）、`evaluateAllTracks`、`createKeyframe`、`insertKeyframe` / `removeKeyframe` / `updateKeyframe` |
| `snapEngine.ts` | `collectSnapTargets`（原点/Clip 边缘/播放头/标记点）、`snap` / `snapOrDefault`（`DEFAULT_SNAP_THRESHOLD=0.1` 秒 ≈3 帧 @30fps） |
| `timeRange.ts` | `TimeRange`（半开区间 [start, end)）、`fromStartDuration` / `fromStartEnd` / `duration` / `isEmpty` / `contains` / `containsInclusive` / `overlaps` / `intersection` / `union` / `shift` / `clampRange` |
| `timeUtils.ts` | `formatTime(seconds)` (HH:MM:SS.mmm)、`formatTimecode(seconds, fps)` (HH:MM:SS:FF)、`secondsToFrame` / `frameToSeconds` / `clamp` / `lerp` / `toPercent` |

#### 6.15.2 `workers/`（Web Worker 池）

把 L1 编译（RenderIR → RegionCompileArtifact）分发到后台线程。

- `tileWorker.ts`：Worker 入口，接收 compile 请求，调用 `compileRenderIRToRegionArtifact(ir)`，artifact 中 5 个 TypedArray 通过 Transferable 零拷贝传回主线程
- `workerPool.ts`：
  ```typescript
  export function getWorkerPool(): WorkerPool  // 单例
  export function destroyWorkerPool()
  export class WorkerPool {
    async compile(ir: RenderIR): Promise<RegionCompileArtifact>  // 不可用时降级主线程同步
    get isAvailable / workerCount / pendingCount
    destroy()
  }
  ```
  - `computeWorkerCount()`：`navigator.hardwareConcurrency / 2`，裁剪到 [1, 8]；不可用时默认 2
  - 惰性初始化，`busy: boolean[]` 跟踪 Worker 忙闲，`queue: PendingTask[]` 排队等待
  - Worker 创建失败（CSP/测试环境）自动降级

**注意**：`workers/` 与 `media/video/decoder/decoderWorker.ts` 是两套独立的 Worker，前者做 L1 编译，后者做视频解码。

---

### 6.16 前端 UI 层（components / stores / composables）

#### 6.16.1 应用入口 `main.ts`

```typescript
function bootstrap() {
  const app = createApp(App);
  app.use(createPinia());
  app.use(router);
  app.use(PhosphorIcons);
  app.directive('tooltip', tooltipDirective);
  app.mount('#app');  // 先挂载，UI 立即渲染
  initStorage().catch(...);  // 异步初始化三层存储，不阻塞启动
}
```

#### 6.16.2 根组件 `App.vue`

- 组合 TopHeader / LeftRail / ControlPanel / CanvasViewport / IRPreviewPanel / TimelinePanel / PerformancePanel / StatusBar / AIChatPanel / ResourceManagerPanel / WorkflowPanel / AmbientFluidCanvas
- 异步加载重型组件：GraphEditor / AssetGenomePanel / ExportModal / SettingsModal
- 监听 theme 应用到 `document.documentElement.dataset.theme`
- 监听 isPlaying 启停播放
- 全局快捷键：Ctrl/Cmd+Z 撤销、Ctrl/Cmd+Shift+Z / Ctrl+Y 重做（焦点守卫：编辑控件聚焦时跳过）
- 自动保存：浅层 watch + modelConfigs 深度 watch 分离，避免 deep watch 性能开销
- `onMounted` 调用 `store.loadFromUnifiedStore()` 异步覆盖 localStorage 同步加载结果
- 通过 `pageEnter` (anime.js) 实现左侧 Tab 切换页面进入动画

#### 6.16.3 Pinia Stores（`src/stores/`）

##### `app.ts`（主 store）
- 状态：`history` / `currentIndex` / `activeSnapshot`（computed）/ `livePromptText` / `resolution` / `frameRate` / `treeData` / `currentTime` / `isPlaying` / `isExportOpen` / `isSettingsOpen` / `theme` / `isGenerating` / `showTimeline` / `autoSaveEnabled` / `autoSaveInterval` / `saveStatus` / `lastSavedTime` / `modelConfigs` / `selectedModelId` / `accentColors` / `clips` / `tracks`
- Actions：`startPlayback` / `stopPlayback` / `undo` / `redo` / `triggerAutosave` / `loadFromUnifiedStore` / `setTuningParams` / `updateModelConfig` / ...
- 类型：`AppStateSnapshot`、`HistoryRecord`、`ModelConfig`、`ModelMetadata`、`AccentColors`
- 持久化：`AUTOSAVE_KEY = 'pixelforge_autosave_v2'`，`MAX_HISTORY_LENGTH = 50`

##### `runtime.ts`（运行时 store）
状态 / getters / actions，集成 WebGPU engine。

##### `runtime-inspector.ts`、`history.ts`、`errorStore.ts`、`counter.ts`
辅助 stores。

##### Editor 子系统 stores
`useReferenceGraphStore`、`useAudioMixerStore`、`useEffectChainStore`、`useRenderStore`、`useMaterialGraphStore`、`useGraphStore`、`useGraphUIStore`、`useGraphHistoryStore`、`useAssetStore`、`useProjectStore`。

#### 6.16.4 顶层组件（`src/components/`）

| 组件 | 职责 |
|------|------|
| `TopHeader.vue` | 顶部工具栏：品牌标志、主题切换、窗口控制（最小化/最大化/关闭），`data-tauri-drag-region` 无边框窗口拖拽 |
| `LeftRail.vue` | 左侧导航栏：视频/图片/元素/历史/渲染 + 性能 + 设置，文字标签 + 图标 |
| `CanvasViewport.vue` | 主画布视口 |
| `ControlPanel.vue` | 控制面板 |
| `IRPreviewPanel.vue` | IR 预览面板 |
| `TimelinePanel.vue` | 时间轴面板 |
| `PerformancePanel.vue` | 性能监控面板 |
| `StatusBar.vue` | 底部状态栏 |
| `AIChatPanel.vue` | AI 对话面板 |
| `AssetGenomePanel.vue` | Asset Genome 面板（异步加载） |
| `AudioMixerPanel.vue` | 音频混音器面板 |
| `WorkflowPanel.vue` | 工作流面板 |
| `ResourceManagerPanel.vue` | 资源管理面板 |
| `AmbientFluidCanvas.vue` | 环境流体背景（3 个 blob，filter blur 80px，ambient-drift 20s 动画） |
| `ExportModal.vue` | 导出弹窗（异步加载，anime.js 进出动画） |
| `SettingsModal.vue` | 设置弹窗（异步加载，anime.js 进出动画） |
| `HelloWorld.vue` | 示例组件 |

#### 6.16.5 编辑器子组件（`src/components/editor/`）

##### `graph/`（节点图编辑器）
- `GraphCanvas.vue`：无限画布容器，world↔screen 变换，背景点阵网格（随 zoom 自适应密度），SVG 连接线层 + 节点层
- `GraphEditor.vue`：图编辑器主面板，组合所有子组件，处理 pan/zoom/drag/connect 和快捷键，编译 Graph → emit applyIR
- `GraphNode.vue`：节点卡片，头部 + 输入/输出端口 + 参数摘要，类型边框色
- `GraphPort.vue`：端口组件，mousedown 触发连线，data-port-* 支持 hit-test
- `ConnectionLine.vue`：SVG 贝塞尔曲线连接线（S 形，offset = max(40, dx*0.4)）
- `GraphToolbar.vue`：工具栏（添加节点/自动布局/适应视图/Undo/Redo/编译/清空）
- `Minimap.vue`：右下角缩略图（180×120），显示节点位置和当前视口矩形
- `NodeMenu.vue`：节点搜索菜单浮层（右键/Tab 触发），按 category 分组
- `NodeToolbar.vue`：旧版节点添加工具栏（兼容保留）
- `useGraphInteraction.ts`：交互 Hook，鼠标/滚轮事件 → store 状态变更
- `useGraphShortcuts.ts`：GraphEditor 专用快捷键（Delete/F/Esc/Ctrl+D/Ctrl+Z/Y），capture phase + stopImmediatePropagation

##### `inspector/`
- `InspectorPanel.vue`：属性面板，组合 LayerTree + PropertyGroup，按 opcode 派发 schema
- `LayerTree.vue`：图层树列表，选中/可见性切换
- `PropertyControl.vue`：单属性控件（slider/number/color/select/toggle，iOS 风格 toggle）
- `PropertyGroup.vue`：属性分组容器

##### 顶层
- `CanvasView.vue`：画布预览容器，初始化/渲染/批量生成按钮 + HUD（fps/frame/gpuMs/memMb）
- `ClarifierDialog.vue`：需求澄清对话框，问题选项 chip 单选
- `CommandPalette.vue`：Ctrl+K 命令面板，搜索 + 分组 + 键盘导航
- `ErrorBoundary.vue`：Vue 组件级错误边界，onErrorCaptured 捕获 + 重试
- `ErrorToast.vue`：全局错误通知 Toast（error 需手动关闭，warning/info 5s 自动消失）
- `PromptPanel.vue`：语义创作面板，prompt 文本框 + 确认/快速生成/澄清/节点图按钮
- `RenderIRTree.vue`：Render IR 树形展示
- `TopBar.vue`：旧版顶部工具栏（兼容保留）
- `AssetPanel.vue`：资源面板，拖拽导入图片，添加到 Layer / 删除

#### 6.16.6 UI 子组件（`src/components/ui/`）

- `PfSelect.vue`：自定义下拉选择器，Teleport 到 body，自动方向，菜单宽度匹配父元素，ESC/点击外部/滚动关闭
- `AppSidebar.vue`：应用侧边栏（验证台场景）
- `CanvasWorkspace.vue`：主工作区面板
- `FrameDataConsole.vue`：帧数据控制台，4 种导出（快照/调试/CSV/完整）
- `InspectorPanel.vue`：轻量检查面板
- `TimelinePanel.vue`：逐帧编辑时间轴（播放控制 + 缩放 + 标尺拖拽 + 3 轨道 + 播放头）
- `types.ts`：共享类型（`FrameSnapshot`、`PlaybackState` 等）

#### 6.16.7 组合式函数（`src/composables/`）

- `useAnime.ts`：anime.js v4 动画工具
  - `PF_EASE`（cubic-bezier(0.22,1,0.36,1)）、`PF_DURATION`（180ms）
  - `modalEnter` / `modalLeave`（弹窗进出，leave 返回 Promise）
  - `pageEnter` / `fadeUp`（页面/元素淡入上浮）
  - `staggerEnter`（列表项依次进入，delay 20ms stagger）

- `useCommandShortcuts.ts`：基于 CommandRegistry 的全局快捷键 composable，焦点守卫

- `commandRegistry.ts`：命令注册中心 + 快捷键匹配引擎（单例）
  - `CommandCategory`：playback / history / project / editor / view / settings
  - 快捷键字符串解析（"mod+z" 跨平台）、格式化（Mac ⌘Z / Win Ctrl+Z）
  - `registerDefaultCommands` 注册 7 个默认命令
  - 支持 `rebindShortcut` 自定义

#### 6.16.8 指令（`src/directives/`）

- `tooltip.ts`：全局 `v-tooltip` 指令
  - 支持字符串或 `{ text, position }` 对象
  - 位置 top/bottom/left/right，智能翻转
  - 单例（同一时间只显示一个）
  - 300ms 延迟显示避免频繁闪烁
  - `pf-tooltip-visible` 类 opacity 0→1 + scale(0.92→1)，150ms var(--ease-out)
  - 滚动/按下时隐藏

#### 6.16.9 样式系统（`src/styles/index.css`）

**设计系统**：Apple Liquid Glass Design System（基于 Apple HIG + Emil Kowalski），两层架构：固态内容基底层 + 半透明玻璃控制层浮动其上。

##### 主题 Token（light/dark 双主题）
- 基础色：`--base-bg`（light #e8e8ed / dark #1c1c1e）
- 玻璃层：`--glass-bg` / `--glass-bg-hover` / `--glass-bg-pressed` / `--glass-border` / `--glass-edge` / `--glass-shadow`
- 强调色：`--accent` #0a84ff（双主题一致）
- 文本层级：4 级透明度（92% / 60% / 38% / 15%）
- 片段类型色：video=蓝 / audio=绿 / text=紫
- 环境色：`--ambient-1/2/3`（蓝/紫/绿，背景流体 blob）

##### 共享属性
- 缓动：`--ease-out` cubic-bezier(0.23,1,0.32,1)、`--ease-in-out` cubic-bezier(0.77,0,0.175,1)
- 圆角：`--radius-lg` 16px / `--radius-md` 12px / `--radius-sm` 8px / `--radius-xs` 6px / `--radius-pill` 999px
- 布局：`--rail-width` 56px / `--panel-left-width` 300px / `--panel-right-width` 240px / `--timeline-height` 260px / `--toolbar-height` 52px / `--statusbar-height` 28px
- 字体：-apple-system, BlinkMacSystemFont, "SF Pro Text/Display"；JetBrains Mono 用于代码/数值

##### 可访问性
- backdrop-filter 不支持时降级为 92%/95% 不透明背景
- `prefers-reduced-transparency` 媒体查询关闭毛玻璃
- `@media (hover: hover) and (pointer: fine)` 精确设备 hover 支持

---

### 6.17 src-tauri（Tauri 桌面壳）

**路径**：`PixelForge/src-tauri/`

**职责**：Rust 后端，提供 redb 嵌入式 KV 数据库（L3 持久化层）、窗口管理、Tauri 命令注册。

#### 6.17.1 `src/db.rs`（Redb 数据库）

数据库：redb（纯 Rust，mmap 内存级读）。文件路径 `app_data_dir/pixelforge.redb`。

**5 张表**：
- `metadata`（key → JSON string）
- `prompts`（timestamp_ms → text）
- `shaders`（hash → WGSL 源码）
- `ir`（frame_id → RenderIR JSON）
- `assets`（asset_id → JSON）

**关键导出**：
```rust
pub struct DbState(pub Mutex<Database>);
pub fn init_db(app: &AppHandle) -> Result<Database, String>
pub fn register(app) -> Result<AppHandle, String>
```

**17 个 `#[tauri::command]`**：
- 元数据：`db_set_metadata` / `db_get_metadata` / `db_delete_metadata` / `db_list_metadata`
- Prompt：`db_add_prompt` / `db_list_prompts` / `db_query_prompts(start_ms, end_ms)`（range 查询）
- Shader：`db_save_shader` / `db_get_shader` / `db_list_shaders`
- IR：`db_save_ir` / `db_get_ir`
- Asset：`db_save_asset` / `db_list_assets` / `db_delete_asset`
- 维护：`db_clear_all` / `db_get_path`

#### 6.17.2 `src/lib.rs`
```rust
pub fn run() {
  // Tauri Builder：注册 tauri_plugin_shell
  // setup 中同步 init_db 并 app.manage(DbState)
  // invoke_handler 注册全部 17 命令
  // DevTools 需 F12 手动打开
}
```

#### 6.17.3 `src/main.rs`
```rust
fn main() { pixelforge_lib::run(); }
```

#### 6.17.4 `Cargo.toml`
- `pixelforge` v0.1.0，edition 2021，crate-type `["staticlib","cdylib","rlib"]`
- 依赖：tauri 2.5、tauri-plugin-shell 2、serde 1.0、serde_json 1.0、redb 2、directories 5
- build-dep：tauri-build 2.5

#### 6.17.5 `tauri.conf.json`
- productName: PixelForge，identifier: `com.pixelforge.app`
- 构建钩子：`beforeDevCommand: npm run dev`，`frontendDist: ../dist`，`devUrl: http://localhost:5173`
- 窗口：1390×850（minWidth/minHeight 同），`decorations: false`（无边框），`maximizable: false`，`resizable: true`
- bundle: category GraphicsAndDesign

#### 6.17.6 `capabilities/default.json`
- identifier: default，windows: `["main"]`
- 权限：`shell:allow-open`、`core:window:allow-minimize`、`allow-toggle-maximize`、`allow-close`、`allow-start-dragging`

**集成点**：前端通过 `@tauri-apps/api` 的 `invoke('db_xxx', ...)` 调用命令；`storage/tauriDb.ts` 是 TS 侧适配层。

---

## 7. 依赖关系总览

### 7.1 模块依赖矩阵

| 消费方 | 被依赖模块 | 用途 |
|--------|-----------|------|
| 几乎所有模块 | `shared/` | 类型定义、常量、ID、seed、错误分类 |
| `authoring/`、`editor/`、`world/` | `compiler/` | RenderIR 与编译产物 |
| `runtime/` | `compiler/`、`workers/`、`render/compositor`、`material/` | 渲染管线消费编译 artifact |
| `world/` | `authoring/llm/`、`compiler/ir/patch` | LLM 调用、Patch 提交 |
| `graph/` | `compiler/ir/renderIR`、`shaders/` | 图编译、GPU dispatch |
| `material/` | `runtime/device`、`shaders/` | WebGPU Pipeline 创建 |
| `media/` | `workers/`（独立） | 视频解码 Worker |
| `project/` | `stores/`、`compiler/ir` | 序列化需要 runtime/timeline/history |
| `components/` | `utils/`、`stores/`、`composables/` | 时间轴 UI、状态、动画 |
| `stores/` | `storage/`、`project/`、`authoring/llm/` | 持久化、序列化、LLM |
| `src-tauri` | 前端 `storage/tauriDb.ts` | L3 持久化通过 Tauri command 桥接 |
| `.github/workflows` | 全项目 | CI 质量门禁 |

### 7.2 三层存储依赖

- **L1** `storage/memoryCache.ts` — 内存级
- **L2** `storage/opfsStore.ts` — OPFS（浏览器大块二进制：图片/视频帧）
- **L3** `src-tauri/db.rs` — redb（小文本/JSON：元数据/prompt/shader/IR 索引）
- **统一编排** `storage/unifiedStore.ts`，浏览器环境 L3 不可用时自动降级 L2

### 7.3 双 Worker 体系

- `workers/`：L1 编译（RenderIR → RegionCompileArtifact），主线程降级可用
- `media/video/decoder/decoderWorker.ts`：视频解码（WebCodecs），与编译池独立

---

## 8. 项目运行方式

### 8.1 环境要求

- **Node.js**：22.x（CI 使用 node 22）
- **Rust**：stable（Tauri 2.5 要求，edition 2021）
- **浏览器**：支持 WebGPU 的现代浏览器（Chrome 113+ / Edge 113+，开发环境）
- **操作系统**：Windows / macOS / Linux（Tauri 跨平台）

### 8.2 安装依赖

```bash
# 进入应用目录
cd PixelForge

# 前端依赖
npm install

# Rust 依赖（首次构建 Tauri 时自动拉取）
# 确保 ~/.cargo/bin 在 PATH 中
```

### 8.3 开发模式

#### 浏览器开发（纯前端，无 Tauri 后端，L3 自动降级 OPFS）

```bash
cd PixelForge
npm run dev
# 访问 http://localhost:5173/
```

#### Tauri 桌面开发（完整三层存储）

```bash
cd PixelForge
npm run tauri dev
# Tauri 自动执行 npm run dev 并启动桌面窗口
```

### 8.4 构建生产版本

```bash
cd PixelForge

# 类型检查 + 前端构建
npm run build
# 产物：PixelForge/dist/

# Tauri 桌面应用打包
npm run tauri build
# 产物：src-tauri/target/release/bundle/
```

### 8.5 运行测试

```bash
cd PixelForge

# 运行全部测试（Vitest，run 模式，不 watch）
npm test

# 类型检查
npx vue-tsc --noEmit
```

### 8.6 预览构建产物

```bash
cd PixelForge
npm run preview
```

### 8.7 关键 npm scripts

| 命令 | 作用 |
|------|------|
| `npm run dev` | Vite 开发服务器（端口 5173） |
| `npm run build` | `vue-tsc --noEmit && vite build` |
| `npm run preview` | 预览构建产物 |
| `npm test` | `vitest run` |
| `npm run tauri` | Tauri CLI 入口（`tauri dev` / `tauri build`） |

### 8.8 开发者工具

- Tauri 桌面模式：按 **F12** 打开 DevTools
- 浏览器模式：使用浏览器原生 DevTools
- 控制台 warning `L3 Redb 不可用，降级 OPFS` 在浏览器开发环境是**正常预期**，不影响数据持久化

---

## 9. 测试与 CI

### 9.1 测试基线

- **2859 项**自动化测试（89 个测试文件）：2838 通过 + 21 跳过，0 失败
- **vue-tsc 零错误**
- 注：存储架构提交删除旧 timeline/animation 模块后，测试总数由 3338 调整为 2859

### 9.2 CI 配置（`.github/workflows/ci.yml`）

- **触发**：push / PR 到 `master` 或 `main` 分支
- **运行环境**：`ubuntu-latest`
- **步骤**：
  1. `actions/checkout@v4`
  2. `actions/setup-node@v4`（node 22，npm 缓存，`cache-dependency-path: PixelForge/package-lock.json`）
  3. `npm ci`（working-directory: PixelForge）
  4. `npx vue-tsc --noEmit`（TypeScript 类型检查）
  5. `npx vitest run`（单元测试）

任何破坏类型检查或测试的提交会在 PR 阶段被拦截。

### 9.3 测试组织约定

- domain 层（纯函数）测试与源文件同目录，命名 `*.test.ts`
- 测试使用 `fake-indexeddb` mock IndexedDB 环境
- Worker 测试降级为主线程同步执行

---

## 10. 附录：错误码与所有权优先级

### 10.1 RuntimeErrorCode（16 项）

shader / pipeline / buffer / texture / dispatch / device_lost / webgpu / adapter / context / persistence / export / ... （详见 `shared/errors.ts`）

### 10.2 ReplayErrorCode（4 项）

帧回放一致性相关错误码。

### 10.3 PatchErrorCode（11 项）

- `IR_PATCH_VIOLATION`
- `IR_STATIC_BOUNDARY_VIOLATION`
- `IR_PATCH_TARGET_NOT_FOUND`
- `IR_PATCH_DUPLICATE_ID`
- `IR_PATCH_DANGLING_REF`
- `IR_PATCH_BATCH_NESTED`
- ... （详见 `compiler/ir/patch.ts`）

### 10.4 AssetValidationError（8 项）

Asset Genome 资产校验错误码（详见 `editor/asset-genome/assetRegistry.ts`）。

### 10.5 参数所有权优先级（OWNER_PRIORITY）

| Owner | 优先级 | 含义 |
|-------|--------|------|
| `l3_revision` | 100 | Revision Layer 覆盖（可被 l2_user 否决） |
| `l2_user` | 90 | 用户直接编辑 |
| `l3_timeline` | 70 | 关键帧动画驱动 |
| `l3_director` | 70 | AI Director 决策 |
| `l2_parser` | 50 | WDL/Rule Parser 初始解析 |
| `system_default` | 10 | 系统默认值 |

冲突解决规则：高优先级覆盖低优先级；`l3_revision` 与 `l2_user` 冲突时触发 `needs_confirmation`，由用户决定是否强制覆盖。

---

## 文档维护

- **基线版本**：阶段六（Step 25–40.4）
- **生成时间**：2026-08-01
- **维护原则**：模块新增/重命名/职责变更时同步更新本文档；保持模块路径与导出签名的准确性
- **参考文档**：
  - `PixelForge/README.md` — 项目总览
  - `PixelForge/docs/` — 已有专题文档
  - 源码内注释 — 详细实现说明
