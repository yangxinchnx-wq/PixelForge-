# PixelForge

## 项目简介

PixelForge 是一个基于 Vue 3、TypeScript、Vite、Tauri 和 WebGPU 的可视化编程视觉引擎。项目从"AI 生成器"演进为"可视化编程 + 实时动画 + GPU 计算 + 时间轴 + 渲染导出 + 视频效果链 + Asset Genome"的完整视觉引擎。

项目按阶段管理,当前进入阶段六(可视化编程引擎 + 实时动画 + 专业时间轴 + 渲染导出等)。

---

## 当前状态

阶段六进行中(Step 25-40.4 已完成,Step 40.5+ 待规划;音频重建线已先行启动:Step 41.1-41.6 已完成,尚未接线)。

### 启动约束(强制)

**默认且唯一的运行方式是 Tauri 桌面端,已禁用 Web 端作为日常运行方式。**

```bash
npm run tauri dev     # 标准启动方式
```

禁用原因:

- WebGPU 渲染在桌面 WebView2 与浏览器内核的行为存在差异,以浏览器为准可能掩盖桌面端特有的问题(窗口尺寸、DPI、焦点、最大化、圆角等)。
- Tauri 桥接能力(原生文件 IO、红黑树数据库、系统弹窗)在纯浏览器环境中不可用,Web 端启动会误报"运行正常",掩盖真实的集成缺陷。
- `npm run dev` 仅保留为**内部辅助用途**:Tauri 的 `BeforeDevCommand` 会自动调用它,以及做纯前端 UI 快速预览;不要把它当作日常启动方式,也不要基于它验证功能。

### 已完成阶段

- **阶段一**:图形运行链路可行性验证(已封板)
- **阶段二**:运行时稳定性与历史态一致性(已封板)
- **阶段三**:编辑器工作流与时间轴增强(已封板)
- **阶段四**:多图层 / 多区域 / 效果系统扩展(已封板)
- **阶段五**:产品化与长期演进能力(已封板,IndexedDB 持久化 + 错误码枚举化 + 像素级回放一致性 + GPU profiler)

### 阶段六主要模块(Step 25-41.6)

| 模块 | Step | 说明 |
|------|------|------|
| 可视化编程引擎 + Material/Shader | 25-28 | RenderIR Graph Editor + Graph Runtime + Material/Shader Node System(WGSL 自动生成) |
| 实时动画 + 输入系统 | 29-30 | Advanced Timeline + Animation Engine + Sensor 输入驱动 |
| 时间轴 | 31.1-31.9 | 统一时间轴模型(unifiedTimeline)+ 关键帧 + 吸附 + 渲染帧预算调度 |
| 渲染导出模块 | 32 | RenderConfig(6 预设)+ RenderPipeline(状态机)+ RenderStore + runtimeFrameRenderer |
| 视频效果链 Effect Chain | 34 | 17 种效果 × 5 大类 + effectChainStore |
| Asset Genome | 35.1-35.7 | Registry + Reference Graph + Impact Analysis + Content Hash/Dedup + Lazy Loading + Packaging(逻辑层,Browser UI 已移除) |
| 渲染性能优化 | 39.1-39.4 | Profiler + GPU 资源池化(BufferPool/TexturePool)+ 多 Pass 渲染管线 + 三级渲染签名缓存 |
| 产品化 | 40.1-40.4 | 设置面板 + 快捷键体系(CommandRegistry + CommandPalette)+ 项目导入导出增强 + 错误处理统一化 |
| 音频模块(重建) | 41.1-41.6 | 核心纯函数(mute/solo/增益/声像/限幅)+ 效果链 + Web Audio 运行时 + 音频分析(FFT/节拍);**零外部引用,未接线** |

> 注:以下模块**曾经实现过但已从代码中移除**,上表不再列出:AI Director、WDL 声明式渲染 DSL、Pro Timeline 的多 Sequence / 嵌套编辑 / 模板库、Audio/MIDI/Camera 输入驱动。其中 **Step 33 音频混音器已按 Step 41.1-41.6 重建**(见上表末行,`src/audio/`,提交 `4e574bc`,尚未接线),其余仍处移除状态。完整清单与删除提交见 `git log`(关键删除提交:`0fdcabb` / `6959241` / `ff5d60f`)。

### 测试基线

- **3089 项**自动化测试(101 个测试文件):3068 通过 + 21 跳过,0 失败
- vue-tsc 零错误
- 注:测试总数演进 3338 → 2859(存储架构提交删除旧 timeline/animation 模块)→ 2577(删除 Director / WDL 功能链)→ 3089(新增音频模块 491 项)

---

## 技术栈

- 前端框架:Vue 3 + TypeScript
- 状态管理:Pinia
- 构建工具:Vite
- 桌面壳:Tauri
- 图形能力:WebGPU(计算着色器 + 存储缓冲区)
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

> **想省事的话可以不手动敲**:仓库根目录提供了一键脚本,会自动检查 Node / Rust / 平台依赖,然后装依赖并自检。
>
> ```bash
> # Windows(PowerShell)
> powershell -ExecutionPolicy Bypass -File setup.ps1
>
> # macOS / Linux
> bash setup.sh
> ```
>
> 两个脚本都支持 `--skip-install`(`-SkipInstall`)只做检查、`--skip-checks`(`-SkipChecks`)跳过自检。放在仓库根或 `PixelForge/` 子目录下都能跑。

### 3. 启动

**唯一标准启动方式(禁用 Web 端作为日常运行):**

```bash
npm run tauri dev     # 桌面应用(Vite + Rust 一起起),日常开发必用
npm run tauri build   # 打包安装包
```

`npm run dev`(仅起前端 Vite)**不作为日常启动方式**,只用于:

- 被 Tauri 的 `BeforeDevCommand` 自动调用(即 `npm run tauri dev` 会先拉起它,无需手动执行)
- 纯前端 UI 快速预览

原因:WebGPU 渲染与 Tauri 桥接能力(原生文件 IO / redb 数据库 / 系统弹窗 / 窗口圆角与最大化)在纯浏览器中不可用或行为不一致,用浏览器验证会掩盖桌面端集成缺陷。功能验证一律以桌面端为准。

首次 `tauri dev` 会编译全部 Rust 依赖,十几分钟到半小时属正常,之后为增量编译。

Windows 本机一键启动脚本(已内置 Node 22 + Rust GNU 工具链的 PATH 配置):

```bash
start-tauri.cmd     # 桌面端开发(推荐)
start-dev.cmd       # 仅前端 Vite(辅助预览,勿用于功能验证)
```

### 4. 换机后需要手动补的东西

- **LLM API key**:存在浏览器 localStorage(`src/stores/modelConfigStore.ts`),不进仓库。LLM 相关功能需要在应用「设置」里重新填写。
- **本地作品数据**:OPFS 里的图片/视频缓存 + redb 数据库(`pixelforge.redb`)不随仓库迁移。数据库位置:Windows `%APPDATA%\com.pixelforge.app\`、macOS `~/Library/Application Support/com.pixelforge.app/`、Linux `~/.local/share/com.pixelforge.app/`。要保留旧数据就手动拷这个目录。

### 5. 装完自检

```bash
npm test                 # 约 3089 项,期望 0 失败
npx vue-tsc --noEmit     # 期望 0 错误
```

---

## 开发命令

安装依赖:

```bash
npm install
```

启动开发环境(**唯一标准方式,禁用 Web 端作为日常运行**):

```bash
npm run tauri dev
```

`npm run dev` 仅保留为内部辅助(Tauri 的 `BeforeDevCommand` 会自动调用它,或做纯前端 UI 预览),**不要用它做功能验证**——WebGPU 与 Tauri 桥接能力在浏览器中不可用或行为不一致,详见上文「启动约束」。

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

1. `docs/CodeWiki.md` — 代码架构参考:目录结构 / 分层 / 核心数据流 / 模块详解
2. `docs/` — 各模块设计文档(mcp-protocol-design / uav-split-design / subgraph-enhancement-plan 等)
3. `git log` — 阶段执行记录与模块增删历史

---

## 项目阶段

阶段执行历史见 `git log`;代码架构见 `docs/CodeWiki.md`。项目状态以代码与测试为准,不再维护独立的阶段规划文档。
