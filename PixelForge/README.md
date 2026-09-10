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

- **2859 项**自动化测试(89 个测试文件):2838 通过 + 21 跳过,0 失败
- vue-tsc 零错误
- 注:存储架构提交删除旧 timeline/animation 模块后,测试总数由 3338 调整为 2859

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

## 新环境搭建(换机 / 新同事)

仓库已包含全部源码、锁文件与配置(`package-lock.json`、`Cargo.lock`、图标、`src-tauri/gen/schemas`、`tauri.conf.json` 均在库内),拉下来即可完整重建。**但环境依赖和两类本地数据不会跟着走**,按本节步骤来。

### 1. 前置工具链

| 工具 | 版本 | 备注 |
|------|------|------|
| Node.js | 22.x | CI 用的就是 22;`package-lock.json` 已锁定依赖版本 |
| Rust | stable(edition 2021) | 通过 [rustup](https://rustup.rs) 安装 |
| 平台依赖 | — | **Windows**:MSVC 生成工具(VS Build Tools,勾选"C++ 生成工具")+ WebView2 Runtime;**macOS**:Xcode Command Line Tools;**Linux**:webkit2gtk-4.1 等 Tauri 系统依赖 |

> WebGPU 需要较新的 WebView2 与显卡驱动。Windows 11 一般开箱可用,Windows 10 老机器建议先更新 WebView2 Runtime。

### 2. 拉取与安装

```bash
git clone https://github.com/yangxinchnx-wq/PixelForge-.git
cd PixelForge-/PixelForge   # 仓库根是外层,实际工程在 PixelForge/ 子目录
npm install
```

### 3. 启动

```bash
npm run tauri dev     # 桌面应用(Vite + Rust 一起起)
npm run tauri build   # 打包安装包
npm run dev           # 只跑前端,浏览器里看(Tauri 相关能力不可用)
```

首次 `tauri dev` 会编译全部 Rust 依赖,十几分钟到半小时属正常,之后为增量编译。

### 4. 换机后需要手动补的东西

- **LLM API key**:存在浏览器 localStorage(`src/stores/modelConfigStore.ts`),不进仓库。AI Director / LLM 相关功能需要在应用「设置」里重新填写。
- **本地作品数据**:OPFS 里的图片/视频缓存 + redb 数据库(`pixelforge.redb`)不随仓库迁移。数据库位置:Windows `%APPDATA%\com.pixelforge.app\`、macOS `~/Library/Application Support/com.pixelforge.app/`、Linux `~/.local/share/com.pixelforge.app/`。要保留旧数据就手动拷这个目录。

### 5. 装完自检

```bash
npm test                 # 约 2859 项,期望 0 失败
npx vue-tsc --noEmit     # 期望 0 错误
```

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
