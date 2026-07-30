# PixelForge 功能说明文档

> 生成时间：2026-07-30
> 版本：Step 40.4 + UI 重构版
> 验证状态：✅ 3338/3338 测试通过 | ✅ TypeScript 类型检查通过 | ✅ UI 渲染正常

---

## 项目概述

**PixelForge** 是一个基于 Tauri + Vue 3 + TypeScript + WebGPU 的可视化编程视觉引擎，支持从自然语言 prompt 生成场景、WDL 声明式渲染、可视化节点编辑、Pro Timeline 多轨道编辑、AI 导演对话、资产基因组管理等功能。

### 技术栈

| 层级 | 技术 |
|------|------|
| 桌面壳 | Tauri 2.5（Rust 2021 edition） |
| 前端框架 | Vue 3.5 + TypeScript 6 |
| 状态管理 | Pinia 4 |
| 路由 | vue-router 4（memory history） |
| 构建 | Vite 8 |
| 图形 | WebGPU + WGSL |
| 编辑器 | Monaco Editor |
| 动画 | anime.js v4.5.0 |
| 测试 | Vitest 3.2（3338 项测试） |

### 验证结果

| 验证项 | 结果 |
|--------|------|
| 单元测试 | ✅ 3338/3338 通过（95 个测试文件，17.13s） |
| TypeScript 类型检查 | ✅ vue-tsc --noEmit 无错误 |
| UI 渲染 | ✅ 211619 字符 HTML，Console 无错误 |
| 开发服务器 | ✅ http://localhost:5173/ 正常运行 |

---

## 功能模块清单

### 一、应用框架层

| 功能 | 说明 | 验证状态 |
|------|------|----------|
| Tauri 桌面应用 | Rust 后端，窗口 1400×900，debug 自动开 devtools | ✅ |
| Vue 3 + Pinia | 响应式状态管理，分模块 store | ✅ |
| Vue Router | memory history 模式 | ✅ |
| 测试套件 | Vitest，95 个测试文件，3338 项测试 | ✅ |
| 错误处理 | errorStore + ErrorBoundary + ErrorToast，运行时错误分层 | ✅ |

### 二、UI 层（当前活跃界面）

| 组件 | 功能 | 验证状态 |
|------|------|----------|
| TopHeader | 顶部栏：创作/时间轴/预览 Tab、撤销重做、生成、导出、设置、主题切换 | ✅ 渲染正常 |
| LeftRail | 左侧导航 8 个 Tab：输入/场景/元素/效果/历史/渲染/性能/设置 | ✅ 渲染正常 |
| ControlPanel | 场景描述输入、图层元素切换、画面调节滑块（星空密度/亮度/色相/对比度） | ✅ 渲染正常 |
| CanvasViewport | 画布预览、帧显示、播放控制、时间码 | ✅ 渲染正常 |
| IRPreviewPanel | 场景图树形结构（3 层嵌套，可展开/可见性切换） | ✅ 渲染正常 |
| TimelinePanel | 多轨道时间轴、片段拖拽/缩放/剪切、缩放控制、波形显示 | ✅ 渲染正常 |
| StatusBar | 保存状态、分辨率、帧率 | ✅ 渲染正常 |
| ExportModal | 导出弹窗（anime.js 进入/离开动画） | ✅ 动画正常 |
| SettingsModal | 设置弹窗：主题/自动保存/重置（anime.js 动画） | ✅ 动画正常 |
| AmbientFluidCanvas | 背景流体画布 | ✅ 渲染正常 |

### 三、创作系统（authoring/）

| 子模块 | 功能 | 验证状态 |
|--------|------|----------|
| Clarifier | 需求澄清：意图分析、缺失检测、问题生成 | ✅ 67 项测试通过 |
| Generator | 场景生成：规划器、参数映射、RenderIR 生成、图层模板 | ✅ |
| Image | 图像分析：自适应分割、颜色块树、积分图、缩放 | ✅ 15 项测试通过 |
| LLM | 大模型调用：callLLM、解析器、prompt 缓存 | ✅ |
| Prompt | 提示词解析：promptParser、ruleParser、schema | ✅ |
| Schema | 数据结构定义 | ✅ 33 项测试通过 |

### 四、WDL 声明式渲染 DSL（world/wdl/）

CSS 风格的声明式渲染描述语言，24 个文件：

| 功能 | 说明 | 验证状态 |
|------|------|----------|
| Lexer/Parser | 词法/语法分析 → AST | ✅ 测试通过 |
| Compiler | AST → RenderIR | ✅ 测试通过 |
| Validator | 语法校验 | ✅ 测试通过 |
| Monaco Editor 集成 | 语法高亮、自动补全、错误内联提示、主题 | ✅ 34 项测试通过 |
| GraphSync | WDL ↔ 图形编辑器双向同步 | ✅ 测试通过 |
| Templates | 模板库 | ✅ 测试通过 |
| TimelineBinding | ProTimeline 绑定 | ✅ 34 项测试通过 |
| Document | 文档管理 | ✅ 16 项测试通过 |

### 五、动画引擎（animation/）

| 功能 | 说明 | 验证状态 |
|------|------|----------|
| Timeline/Track/Keyframe | 时间轴、轨道、关键帧 | ✅ 测试通过 |
| Curve | 插值曲线（linear/bezier/step） | ✅ |
| Evaluator/Player/Scheduler | 求值器、播放器、调度器 | ✅ |
| Binding/Mapper | 绑定与参数映射 | ✅ |
| UniformUpdater | Uniform 缓冲更新 | ✅ |
| InputDriver | 输入驱动动画 | ✅ |

### 六、输入系统（input/）

| 子模块 | 功能 | 验证状态 |
|--------|------|----------|
| Audio | 音频分析：FFT、节拍检测、特征提取 | ✅ 测试通过 |
| Camera | 摄像头输入、运动检测 | ✅ |
| MIDI | MIDI 输入 | ✅ |
| Sensor | 传感器输入 | ✅ |
| InputRouter | 输入路由（signalId/targetKind/nodeId/property） | ✅ |

### 七、图形运行时（graph/）

| 功能 | 说明 | 验证状态 |
|------|------|----------|
| GraphCompiler/Generator | 图编译器/生成器 | ✅ 测试通过 |
| GraphStore/History | 图状态管理与历史栈 | ✅ |
| NodeRegistry/Validator/Layout | 节点注册、校验、布局 | ✅ |
| Runtime | bufferPool、texturePool、cache、evaluator、executionPlan、gpuDispatch、resourceManager、scheduler | ✅ 测试通过 |
| GraphAnimation | 图动画 | ✅ |

### 八、Material/Shader 系统（material/）

| 功能 | 说明 | 验证状态 |
|------|------|----------|
| MaterialGraph | 材质图 | ✅ 测试通过 |
| Compiler/Optimizer | 编译器、优化器 | ✅ |
| ShaderCache/Registry | 着色器缓存与注册 | ✅ |
| TypeChecker | 类型检查 | ✅ |
| WGSLBuilder | WGSL 代码生成 | ✅ |

### 九、编译器（compiler/）

| 子模块 | 功能 | 验证状态 |
|--------|------|----------|
| Cache | 编译缓存 | ✅ 9 项测试通过 |
| IR | frameEngine、patch、patchEngine、renderIR | ✅ |
| Parser | 规则解析器 | ✅ 测试通过 |
| Preview | 预览金字塔 | ✅ |
| Region | 区域编译器 | ✅ 测试通过 |
| Tile | 瓦片网格 | ✅ |

### 十、渲染系统

| 模块 | 功能 | 验证状态 |
|------|------|----------|
| render/compositor | 合成器：blend/composite/mask passes + WGSL 着色器 | ✅ |
| runtime/ | 设备、引擎、帧调度、多 Pass 管线、GPU 资源管理、渲染缓存、签名、Profiler、后处理链 | ✅ 测试通过 |
| editor/render | 渲染导出：renderConfig/renderPipeline/renderStore | ✅ 测试通过 |
| shaders/ | 6 个 WGSL 着色器：effect_post、graph_composite、graph_effect、graph_node_eval、present、region_eval | ✅ |

### 十一、Asset Genome（editor/asset-genome/）

| 功能 | 说明 | 验证状态 |
|------|------|----------|
| assetRegistry | 资产注册核心 | ✅ 测试通过 |
| referenceGraph | 引用图 | ✅ 测试通过 |
| impactAnalysis | 影响分析 | ✅ 测试通过 |
| contentHash | 内容哈希去重 | ✅ 测试通过 |
| lazyLoader | 懒加载与索引 | ✅ 测试通过 |
| assetPackaging | 资产打包 | ✅ 测试通过 |

### 十二、音频与效果

| 模块 | 功能 | 验证状态 |
|------|------|----------|
| editor/audio | 音频混音器 | ✅ 测试通过 |
| editor/effects | 视频效果链 | ✅ 测试通过 |

### 十三、Pro Timeline Core（editor/timeline/）

| 子模块 | 功能 | 验证状态 |
|--------|------|----------|
| core | clip/project/range/sequence/sequenceTemplate/time/timelineIndex/track | ✅ |
| operation | 剪贴板、命令、历史、多片段命令、序列命令、吸附、轨道命令 | ✅ |
| resolver | 帧解析、嵌套序列解析、序列对齐、面包屑、时间轴解析 | ✅ |
| store | selectionStore、timelineStore | ✅ |
| evaluator/player | 求值器、播放器 | ✅ 12 项测试通过 |

### 十四、Pro Timeline UI（components/editor/pro-timeline/）

17 个组件：ProTimeline、AddClipDialog、AssetBrowser、AudioMixer、Breadcrumb、Clip、ContextMenu、DirectorPanel、EffectChain、Inspector、Playhead、RenderPanel、Ruler、SequenceBar、TemplatePicker、Toolbar、TrackHeader、WDLEditor

| 验证状态 | ✅ 3 项测试套件通过（pro-timeline.test.ts / pro-timeline-tracks.test.ts / pro-timeline-advanced.test.ts） |
|----------|------|

### 十五、可视化编程编辑器（components/editor/graph/）

| 组件 | 功能 |
|------|------|
| GraphEditor/Canvas | 图编辑器画布 |
| GraphNode/Port/ConnectionLine | 节点、端口、连线 |
| NodeMenu/NodeToolbar | 节点菜单、工具栏 |
| Minimap | 小地图 |
| useGraphInteraction/Shortcuts | 交互与快捷键 |

### 十六、动画时间轴（components/editor/timeline/）

AnimationKeyframe/Playhead/Ruler/Timeline/Track、CurveCanvas、KeyframePoint、ParameterTrack、TrackHeader

### 十七、AI Director（world/director/）

| 功能 | 说明 | 验证状态 |
|------|------|----------|
| director | AI 导演核心 | ✅ 10 项测试通过 |
| directorContext | 上下文管理 | ✅ 测试通过 |
| directorConversation | 对话系统 | ✅ 测试通过 |
| directorEnhanced | 增强版导演 | ✅ 测试通过 |

### 十八、World 编排与修订

| 模块 | 功能 | 验证状态 |
|------|------|----------|
| world/orchestrator | L3 编排器、导演应用器、修订应用器、时间轴播放器 | ✅ 24 项测试通过 |
| world/revision | 修订层 | ✅ 测试通过 |
| world/sceneGraph | 场景图 | ✅ 测试通过 |
| world/timeline | 时间轴管理器 | ✅ 27 项测试通过 |

### 十九、项目管理（project/）

| 功能 | 说明 | 验证状态 |
|------|------|----------|
| autosave | 自动保存 | ✅ |
| fileSystem | 文件系统 | ✅ |
| projectExport | 项目导出 | ✅ 测试通过 |
| projectStore/Validator | 项目状态与校验 | ✅ 测试通过 |
| recentProjects | 最近项目 | ✅ 测试通过 |
| serializer | 序列化器 | ✅ 测试通过 |

### 二十、媒体处理（media/）

| 子模块 | 功能 |
|--------|------|
| thumbnail | 缩略图缓存 |
| video/cache | 帧缓存 |
| video/decoder | 解码器、Worker、帧调度 |
| video/demux | MP4/WebM 解封装 |
| video/metadata | 视频元数据 |
| video/texture | 帧上传到 GPU |

### 二十一、其他系统

| 模块 | 功能 | 验证状态 |
|------|------|----------|
| preferences | 设置面板、主题 | ✅ 测试通过 |
| composables | 命令注册、快捷键、anime.js 动画 | ✅ 测试通过 |
| timeline | 时间轴核心/交互/操作/解析/工具（刀片/手型/选择/修剪）/虚拟化 | ✅ |
| workers | 瓦片 Worker、Worker 池 | ✅ |
| services/frame | IndexedDB 帧仓库、播放、适配器、时间轴视口 | ✅ 27 项测试通过 |
| stores | app/errorStore/history/runtime/runtime-inspector/timeline | ✅ 测试通过 |

---

## 核心数据流

```
创作 prompt → Clarifier 澄清 → Generator 生成 → RenderIR
                                                    ↓
WDL 编辑 → Lexer → Parser → Compiler → RenderIR
                                                    ↓
Timeline → evaluateTrack → ParamPatch → GraphNode/MaterialNode
                                                    ↓
compiler → WGSL + UniformBuffer → WebGPU → Canvas
                                                    ↑
InputDriver (audio/midi/camera/sensor) → 信号驱动参数更新
```

### 引擎主循环

```
Timeline step → FeatureExtractor update → InputDriver update → GPU render
```

---

## 测试统计

| 测试套件 | 测试数 | 状态 |
|----------|--------|------|
| 总计 | 3338 | ✅ 全部通过 |
| 测试文件 | 95 | ✅ 全部通过 |
| 运行时长 | 17.13s | - |

### 主要测试文件（部分）

| 文件 | 测试数 |
|------|--------|
| authoring/clarifier/clarifier.test.ts | 67 |
| world/wdl/wdlCompletion.test.ts | 34 |
| world/wdl/wdlTimelineBinding.test.ts | 34 |
| world/orchestrator/orchestrator.test.ts | 24 |
| authoring/schema/schemas.llm.test.ts | 23 |
| world/timeline/timeline.test.ts | 27 |
| services/frame/timelineViewport.test.ts | 27 |
| assets/assetToLayer.test.ts | 26 |
| authoring/image/integralImage.test.ts | 15 |
| world/wdl/wdlDocument.test.ts | 16 |

---

## 当前状态说明

### UI 层与后端模块的关系

当前活跃 UI（基于 `stores/app.ts`）是**展示性**的，暂未完全接入 master 上的后端模块（WDL/ProTimeline/Asset Genome/AI Director 等）。后端模块代码和 3338 项测试完整保留，是未来集成的基础。

### 已完成阶段

| 阶段 | 内容 | 状态 |
|------|------|------|
| Stage 1-5（Phase A-F） | 基础架构 | ✅ 已封存，258 项测试 |
| Stage 6 Step 25-28 | 可视化编程引擎 + Material/Shader 系统 | ✅ 完成 |
| Stage 6 Step 29-30 | 动画引擎 + 输入系统（音频/MIDI/摄像头） | ✅ 完成 |
| Stage 6 Step 31.1-31.9 | Pro Timeline（Core/UI/多轨道/嵌套/模板） | ✅ 完成 |
| Stage 6 Step 32 | 渲染导出模块 | ✅ 完成 |
| Stage 6 Step 33 | 音频混音器 | ✅ 完成 |
| Stage 6 Step 34 | 视频效果链 | ✅ 完成 |
| Stage 6 Step 35 | Asset Genome（资产注册/引用图/影响分析/哈希去重/懒加载/浏览器 UI/打包） | ✅ 完成 |
| Stage 6 Step 36.1-36.6 | AI 导演（上下文/增强/对话/ProTimelineDirectorPanel） | ✅ 完成 |
| Stage 6 Step 37.1-38.6 | WDL 声明式渲染 DSL（Lexer/Parser/Compiler/Validator/Editor/Monaco/补全/诊断/Graph 同步/模板库/ProTimeline 绑定） | ✅ 完成 |
| Stage 6 Step 39.1-39.4 | 渲染性能优化（Profiler/资源池化/多 Pass 管线/签名缓存） | ✅ 完成 |
| Stage 6 Step 40.1-40.4 | 产品化（设置面板/快捷键系统/项目导入导出增强/统一通知层） | ✅ 完成 |
| UI 重构 | Downloads 版本 UI 替换 + 中文化 + anime.js v4 动画 | ✅ 完成 |

---

## 修复记录

| 问题 | 修复 |
|------|------|
| App.vue 在浏览器环境调用 getCurrentWindow() 导致 setup 中断 | 添加 Tauri 环境检测，浏览器降级为 null |
| anime.js v4 API 误用 utils.easing() | 改用顶层 cubicBezier() 导出 |
| 4 个 TS6133 未使用变量错误 | 清理未使用的 import 和变量 |

---

## 开发命令

```bash
# 安装依赖
npm install

# 启动开发服务器（浏览器）
npm run dev

# 启动 Tauri 桌面应用
npm run tauri dev

# 运行测试
npm test

# 类型检查
npx vue-tsc --noEmit

# 构建
npm run build
```

---

## 项目仓库

- **GitHub**: https://github.com/yangxinchnx-wq/PixelForge-
- **最新提交**: `0a870ac` feat(ui): 替换 UI 层 + 全面中文化 + 引入 anime.js v4 动画
