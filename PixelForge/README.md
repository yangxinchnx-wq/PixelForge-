# PixelForge

## 项目简介

PixelForge 是一个基于 Vue 3、TypeScript、Vite、Tauri 和 WebGPU 的可视化编程视觉引擎。项目从"AI 生成器"演进为"可视化编程 + 实时动画 + GPU 计算 + 专业时间轴 + 渲染导出 + 音频混音 + 视频效果链 + Asset Genome + AI Director 对话式创作 + WDL 声明式渲染 DSL"的完整视觉引擎。

项目按阶段管理,当前进入阶段六(可视化编程引擎 + 实时动画 + 专业时间轴 + 渲染导出等)。

---

## 当前状态

阶段六进行中(Step 25-40.4 已完成,Step 40.5+ 待规划)。

### 已完成阶段

- **阶段一**:图形运行链路可行性验证(已封板)
- **阶段二**:运行时稳定性与历史态一致性(已封板)
- **阶段三**:编辑器工作流与时间轴增强(已封板)
- **阶段四**:多图层 / 多区域 / 效果系统扩展(已封板)
- **阶段五**:产品化与长期演进能力(已封板,IndexedDB 持久化 + 错误码枚举化 + 像素级回放一致性 + GPU profiler)

### 阶段六主要模块(Step 25-40.4)

| 模块 | Step | 说明 |
|------|------|------|
| 可视化编程引擎 + Material/Shader | 25-28 | RenderIR Graph Editor + Graph Runtime + Material/Shader Node System(WGSL 自动生成) |
| 实时动画 + 输入系统 | 29-30 | Advanced Timeline + Animation Engine + Audio/MIDI/Camera/Sensor 输入驱动 |
| 专业时间轴 Pro Timeline | 31.1-31.9 | Project/Sequence/Track/Clip + Frame Scheduler + 多 Sequence + 嵌套 + 模板库 |
| 渲染导出模块 | 32 | RenderConfig(6 预设)+ RenderPipeline(状态机)+ RenderStore + ProTimelineRenderPanel |
| 音频混音器 | 33 | audioMix + audioMixerStore(Web Audio API)+ ProTimelineAudioMixer |
| 视频效果链 Effect Chain | 34 | 17 种效果 × 5 大类 + effectChainStore + ProTimelineEffectChain |
| Asset Genome | 35.1-35.7 | Registry + Reference Graph + Impact Analysis + Content Hash/Dedup + Lazy Loading + Browser UI + Packaging |
| AI Director | 36.1-36.6 | DirectorContext + EnhancedIntent + Multi-turn Conversation + Timeline 自动生成 + Director Panel UI |
| WDL 声明式渲染 DSL | 37.1-38.6 | Lexer + Parser + Compiler + Validator + Monaco Editor(语法高亮 + 自动补全 + 错误内联 + Graph 双向同步 + 模板库 + ProTimeline 绑定) |
| 渲染性能优化 | 39.1-39.4 | Profiler + GPU 资源池化(BufferPool/TexturePool)+ 多 Pass 渲染管线 + 三级渲染签名缓存 |
| 产品化 | 40.1-40.4 | 设置面板 + 快捷键体系(CommandRegistry + CommandPalette)+ 项目导入导出增强 + 错误处理统一化 |

### 测试基线

- **3338 项**自动化测试全部通过(对比阶段五封板时 258 项,增长 12.9 倍)
- vue-tsc 零新增错误

---

## 技术栈

- 前端框架:Vue 3 + TypeScript
- 状态管理:Pinia
- 构建工具:Vite
- 桌面壳:Tauri
- 图形能力:WebGPU(计算着色器 + 存储缓冲区)
- 代码编辑器:Monaco Editor(WDL 语法高亮/补全/诊断)
- 测试:Vitest

---

## 开发命令

安装依赖:

```bash
npm install
```

启动开发环境:

```bash
npm run dev
```

构建项目:

```bash
npm run build
```

运行测试:

```bash
npm test
```

类型检查:

```bash
npx vue-tsc --noEmit
```

---

## 推荐阅读顺序

1. `项目阶段划分.md` — 阶段总览与当前状态
2. `分阶段任务清单.md` — 每个 Step 的可执行任务明细
3. `文档索引.md` — 全部文档导航
4. `项目链路总览.md` — 主链路模块说明
5. `运行时错误分类与界面映射.md` — 错误码清单与界面展示策略

---

## 项目阶段

完整阶段划分见 `项目阶段划分.md`。当前建议先看该文档,再决定后续开发方向。
