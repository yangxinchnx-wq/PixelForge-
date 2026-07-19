# PixelForge 技术实现路线
文档写入不允许批量写入，只允许使用分段式写入。按照文档开发时以最大化性能为基准。不允许为了实现最小化功能去抄近道，一定要按照文档去实施目的，遇到拿不定的主意先停下来询问。
## 一、核心路线总览

核心路线：自然语言描述 → LLM语义解析 → 像素描述符数组 → WebGPU存储缓冲区 → 计算着色器并行执行 → 纹理化渲染输出

核心创新点：

为每个像素（如1920×1080=2073600个）分配独立的32位操作指令，通过GPU计算着色器同时处理所有像素，实现从语言到图像的端到端生成。

## 二、技术栈与数据结构

### 2.1 技术栈

- 运行环境：现代浏览器 Chrome/Edge 113+
- 开发语言：TypeScript + Vite
- 渲染API：WebGPU (计算着色器 + 存储缓冲区)
- AI后端：LLM API (GPT-4 / Claude / 本地模型)
- 应用壳子：Tauri + Vue + Pinia

### 2.1.1 核心设计原则：描述颗粒度

LLM 的“决策”输出颗粒度，决定产品的天花板。三种颗粒度对应三种产品形态：

**方案 A：粗颗粒度**
- LLM 输出：["星空背景", "浅肤色人像", "背景虚化"]
- 程序在本地映射成预设描述符组合
- 优点：可靠、可控
- 缺点：LLM 理解能力被浪费，用户感受到的 AI 智能感不强

**方案 B：中颗粒度（推荐）**
- LLM 输出：结构化参数数组
  ```json
  [
    {
      "region": [0, 0, 1920, 800],
      "type": "starfield",
      "density": 0.005,
      "colors": ["#1a1a4e", "#0d0d2b"],
      "hue": 240
    }
  ]
  ```
- 优点：LLM 的语义理解真正参与画面决策，性能和可靠性有保障
- 缺点：需要 LLM 输出结构化参数，有一定格式要求

**方案 C：细颗粒度（不推荐）**
- LLM 输出：像素级描述符或完整 WGSL
- 缺点：不可靠、不可控、不可调试

**关键洞察：**
- 用户提供的是"感受"，LLM 把它翻译成"参数"——这才是真正的价值
- 操作码集 = LLM 理解能力的"输出带宽"
- 操作码集越丰富，LLM 的理解越能精确表达
- 但操作码不是越多越好，而是要让 LLM 能用最少的参数表达最丰富的语义

### 2.2 像素描述符编码方案（混合方案）

每个像素的描述符长度不固定，根据区域类型自适应选择：

| 方案 | 内存/像素 | 适用场景 | 典型区域 |
|------|----------|----------|----------|
| A 64-bit | 8字节 | 复杂程序化效果 | 噪声、漩涡、星星 |
| C 48-bit | 6字节 | 颜色相近的平滑区域 | 渐变过渡、柔光 |
| B 区域索引 | 1~4字节 | 大片纯色/渐变 | 天空背景、底色 |

内存估算（1080p）：
- 全64-bit：2073600 × 8字节 ≈ 16MB
- 混合方案：根据画面复杂度，通常在 8MB~16MB 之间

## 三、操作码定义表

| 操作码 | 名称 | 描述 | 参数说明 | 典型应用场景 |
|--------|------|------|----------|--------------|
| 0 | 纯色填充 | 固定颜色输出 | R/G/B 分量 | 背景底色 |
| 1 | 线性渐变 | 两点间颜色插值 | 起点色/终点色 | 天空渐变 |
| 2 | 柏林噪声 | 自然纹理生成 | 种子/缩放/对比度 | 云层/大理石 |
| 3 | 漩涡效果 | 旋转扭曲变形 | 中心坐标/强度/色相 | 星云/水流 |
| 4 | 星星光点 | 随机发光点分布 | 密度/亮度/色相 | 星空闪烁 |
| 5 | 棋盘格 | 规则几何图案 | 格子大小/双色 | 测试图案 |
| 6 | 等离子体 | 动态流体效果 | 速度/相位/振幅 | 抽象艺术 |

## 四、编译器实现

### 4.1 编译流程（三层架构）

步骤1 - 需求澄清：
用户输入自然语言 → 系统将模糊需求翻译成精确描述
例："想要个星空，好看一点的" → "写实风格的静态星空，中等密度白色星星，深蓝紫色调夜空背景，无星云效果"

步骤2 - 语义解析：
精确描述 → LLM解析为语义元素树
例："梵高风格的旋转星空" → [{type:"background", color:[10,20,60]}, {type:"star", density:0.003}, {type:"swirl", center:[0.5,0.5]}]

步骤3 - 区域分配：
遍历所有像素(i=0→2073599)，根据语义元素的区域属性判断该像素归属哪个元素

步骤4 - 方案选择：
对每个像素/区域，根据类型和面积选择最优编码方案（64-bit / 48-bit / 区域索引）

步骤5 - 参数计算：
对每个像素，根据其坐标(x,y)和所属元素类型，计算对应的opcode和三个参数

步骤6 - 编码写入：
根据选定方案，将opcode + param1 + param2 + param3编码为对应位宽，写入对应缓冲区

### 4.2 需求澄清层

#### 4.2.1 设计目标

用户不知道怎么跟 LLM 形容需求。系统需要先做一层"需求翻译"，把模糊的人类语言转换成 LLM 能准确理解的结构化描述。

#### 4.2.2 核心职责

- 提取关键词，推断隐含参数
- 标记歧义点，必要时请求用户确认
- 统一术语，消除表达差异
- 补充默认假设，生成精确描述

#### 4.2.3 数据结构

```typescript
interface ClarifiedRequirement {
  original: string                     // 用户原始输入
  elements: {
    type: string
    params: Record<string, number | number[]>
    confidence: number                 // 0~1，系统对这个判断的置信度
  }[]
  ambiguities: string[]                // 无法确定的点
  assumptions: string[]                // 系统做的默认假设
}
```

#### 4.2.4 实现方式

基于规则 + 模板的翻译层，不依赖 LLM：

```typescript
class RequirementClarifier {
  clarify(userInput: string): ClarifiedRequirement {
    const elements: ClarifiedRequirement['elements'] = []
    const ambiguities: string[] = []
    const assumptions: string[] = []

    // 关键词提取 + 隐含参数推断
    if (userInput.includes('星空') || userInput.includes('星星')) {
      elements.push({
        type: 'starfield',
        params: {
          density: this.inferDensity(userInput),
          brightness: this.inferBrightness(userInput),
          hue: this.inferHue(userInput),
        },
        confidence: 0.8,
      })
    }

    // 歧义检测
    if (userInput.includes('紫色') && userInput.includes('星云')) {
      ambiguities.push('紫色是指背景色调还是星云颜色？')
    }

    // 默认假设
    if (!userInput.includes('动态') && !userInput.includes('静态')) {
      assumptions.push('默认静态画面')
    }

    return { original: userInput, elements, ambiguities, assumptions }
  }

  private inferDensity(text: string): number {
    if (text.includes('密集') || text.includes('银河')) return 0.005
    if (text.includes('稀疏')) return 0.001
    if (text.includes('满天星')) return 0.005
    return 0.003
  }

  private inferBrightness(text: string): number {
    if (text.includes('亮') || text.includes('闪耀')) return 200
    if (text.includes('暗') || text.includes('微弱')) return 100
    return 150
  }

  private inferHue(text: string): number {
    if (text.includes('冷色调') || text.includes('蓝紫')) return 270
    if (text.includes('暖色调') || text.includes('橙黄')) return 30
    if (text.includes('红色')) return 0
    if (text.includes('绿色')) return 120
    return 180
  }
}
```

#### 4.2.5 两种交互模式

- **对话式（默认）**：系统引导式提问，逐步澄清模糊需求
- **直接输入（高级）**：用户按 Shift+Enter 跳过澄清，直接进入 LLM

#### 4.2.6 翻译后的输出

将用户的模糊需求转换成精确描述，再交给 LLM：

```
用户输入："想要个星空，好看一点的"
    ↓
翻译后的精确描述：
"写实风格的静态星空，中等密度白色星星，深蓝紫色调夜空背景，无星云效果"
    ↓
交给 LLM 生成结构化 JSON
```

### 4.3 语义解析层

#### 4.3.1 设计目标

将精确描述转换为结构化的语义元素树。这是 LLM 的主要职责。

#### 4.3.2 Prompt 设计

```text
你是 PixelForge 图像生成器的语义解析器。

# 系统约束
- 你只理解以下元素类型：starfield, swirl, gradient, noise, solid, checker, plasma
- 输出必须是合法 JSON 数组
- 参数数值给出合理估计即可，不需要精确
- 如果描述不明确，选择最常见、最保守的默认参数

# 用户需求
{精确描述}

# 输出格式
[
  {
    "type": "starfield",
    "params": { "density": 0.003, "hue": 270, "brightness": 200 },
    "layer": 1,
    "blend": "screen"
  }
]
```

#### 4.3.3 关键参数

- `temperature: 0.2`：低温度保证输出稳定性
- `response_format: json_object`：强制 JSON 输出
- 传入前帧描述（视频场景）：保证时序一致性

#### 4.3.4 输出校验

LLM 输出后，规则引擎做安全兜底：
- 参数范围 clamp
- 非法 type 替换为默认值
- 补全缺失参数

### 4.4 规则解析器（初期实现）

初期不依赖LLM，使用关键词匹配作为编译器前端：

| 关键词 | 映射元素 | 默认参数 |
|--------|----------|----------|
| "星空"/"星星" | starfield | density=0.003, color=[255,255,200] |
| "漩涡"/"星云" | swirl | center=[0.5,0.5], radius=0.4, strength=5.0 |
| "渐变" | gradient | colors=[[0,0,0],[255,255,255]] |
| "噪声"/"纹理" | noise | seed=random, scale=5.0, contrast=1.0 |
| "纯色"/"背景" | solid | color=[30,30,30] |

## 五、GPU并行执行引擎

### 5.1 WGSL计算着色器核心逻辑

```wgsl
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3u) {
    let pixelIndex = id.x;                    // 像素索引 (0 ~ 2073599)
    if (pixelIndex >= PIXEL_COUNT) { return; }

    // 1. 读取我的专属描述符
    let scheme = schemeMap[pixelIndex];
    
    // 2. 计算我的屏幕坐标
    let x = pixelIndex % WIDTH;
    let y = pixelIndex / WIDTH;

    // 3. 根据方案解码并执行
    var color: vec3f;
    switch scheme {
        case 0u: { // 64-bit
            let desc = decode64(descriptors64[pixelIndex]);
            color = eval64(desc, x, y);
        }
        case 1u: { // 48-bit
            let desc = decode48(buffer48, pixelIndex);
            color = eval48(desc, x, y);
        }
        case 2u: { // 区域索引
            let regionId = regionIndices[pixelIndex];
            color = evalRegion(regionTable[regionId], x, y);
        }
    }

    // 4. 写入结果到输出缓冲区
    outputImage[pixelIndex] = vec4f(color, 1.0);
}
```

### 5.2 执行调度

- 工作组大小：@workgroup_size(256)，即每256个线程一组
- 调度数量：ceil(2073600 / 256) = 8097 个工作组
- 并行度：GPU数千个流处理器同时运行所有线程
- 执行时间：目标 < 16ms（达到60FPS实时渲染）

## 六、渲染输出管线

| 阶段 | 操作 | 说明 |
|------|------|------|
| Step 1 | 计算完成 | outputImage缓冲区中已包含所有像素的RGBA值 |
| Step 2 | Buffer→Texture | encoder.copyBufferToTexture() 将数据拷贝到GPU纹理 |
| Step 3 | 全屏三角形 | 顶点着色器输出覆盖全屏的两个三角形(-1,-1)~(1,1) |
| Step 4 | 采样显示 | 片元着色器从纹理采样，输出到Canvas当前帧 |
| Step 5 | 提交呈现 | device.queue.submit([encoder.finish()])，浏览器合成显示 |

## 七、关键技术节点与解决方案

### 节点1：描述符生成性能

问题：JavaScript循环207万次耗时过长

解决方案：
- Web Worker分块并行生成
- 按区域分块处理
- 预计算常用模式缓存

### 节点2：GPU内存管理

问题：频繁上传8MB描述符数组造成带宽压力

解决方案：
- 双缓冲策略（读写分离）
- 增量更新（只上传变化区域）
- 描述符压缩编码

### 节点3：着色器分支效率

问题：switch(opcode)在GPU上可能造成线程分歧

解决方案：
- 按操作码分组批量执行
- 使用函数指针表替代switch
- 将高频操作码内联展开

### 节点4：LLM集成稳定性

问题：LLM输出的参数可能超出合理范围

解决方案：
- 参数范围硬约束 clamp()
- 后处理平滑/归一化
- 规则引擎兜底校验

### 节点5：实时交互延迟

问题：复杂描述编译时间 > 16ms帧预算

解决方案：
- 渐进式编译（先低分辨率预览）
- 局部重编译（只更新修改区域）
- Web Worker异步编译


## 十二、Descriptor Profile 与多 Pipeline 预编译

### 12.1 设计理念

三种方案（64-bit / 48-bit / 区域索引）不再作为独立分支，而是统一为 **Descriptor Profile** 概念。每种位宽是一套完整的协议，包含位域定义、编解码逻辑、opcode 映射表和对应的 WGSL shader 代码。

### 12.2 Profile 结构

```typescript
interface DescriptorProfile {
  id: string                    // 'profile-64' | 'profile-128'
  name: string                  // '64-bit Standard' | '128-bit Extended'
  bitsPerPixel: number          // 64 | 128
  bytesPerPixel: number         // 8 | 16
  layout: BitField[]            // 位域定义
  encode: (opcode: number, params: number[]) => ArrayBuffer
  decode: (data: ArrayBuffer, index: number) => DecodedDescriptor
  shaderCode: string            // 对应的 WGSL 代码
}
```

### 12.3 128-bit 位域分配（推荐）

| 字段 | 位数 | 位范围 | 可表示范围 | 说明 |
|------|------|--------|-----------|------|
| opcode | 8 位 | bit 120-127 | 0~255 | 支持 256 种操作码 |
| param1 | 32 位 | bit 88-119 | 0~4294967295 或浮点 | 颜色分量 / 坐标 / 种子 |
| param2 | 32 位 | bit 56-87 | 同上 | 缩放 / 强度 / 亮度 |
| param3 | 32 位 | bit 24-55 | 同上 | 色相 / 相位 |
| param4 | 24 位 | bit 0-23 | 同上 | 预留 / alpha / 扩展 |

实际使用 128 位（16 字节/像素），存储为 `BigInt64Array`（每像素 2 个元素）或 `Float32Array`（每像素 4 个元素）。

### 12.4 64-bit 与 128-bit 的区别

| 维度 | 64-bit | 128-bit |
|------|--------|---------|
| 内存/像素 | 8 字节 | 16 字节 |
| 4K 内存 | 66 MB | 132 MB |
| 8K 内存 | 265 MB | 530 MB |
| GPU 读取 | 2 次 `u32` 读取拼 64bit | 4 次 `u32` 或 1 次 `vec4u` |
| 参数容量 | 4×16 bit | 4×32 bit |
| 适用复杂度 | 单效果单参数组 | 复合效果、多参数交互 |
| 颜色表示 | 0~255 量化 | 可表示完整 32-bit 浮点颜色 |

### 12.5 128-bit 以上扩展策略

128-bit 是主描述符的实际可用上限。如果还不够：
- 不无限加大主描述符
- 改用辅助 buffer：`layerDescriptors`、`transformBuffer`、`colorLUT`
- 主描述符保持 128-bit，不够时引用辅助 buffer

### 12.6 预编译多 Pipeline

WebGPU 是即时模式 API，pipeline 不能序列化持久化，必须现场编译。但**编译好的 pipeline 可以在同一 `GPUDevice` 内无限复用**。

```typescript
class ShaderManager {
  private pipelines: Map<string, GPUComputePipeline> = new Map()
  private ready: boolean = false

  async init(device: GPUDevice) {
    // 启动时后台静默编译所有 profile
    const profiles = ['profile-64', 'profile-128']
    for (const profileId of profiles) {
      const shaderCode = await loadShaderForProfile(profileId)
      const module = device.createShaderModule({ code: shaderCode })
      const pipeline = device.createComputePipeline({
        layout: 'auto',
        compute: { module, entryPoint: 'main' },
      })
      this.pipelines.set(profileId, pipeline)
    }
    this.ready = true
  }

  getPipeline(profileId: string): GPUComputePipeline {
    return this.pipelines.get(profileId) || this.pipelines.get('profile-64')!
  }

  switchProfile(profileId: string) {
    this.activeProfile = profileId
    // 瞬间切换，零编译成本
  }
}
```

### 12.7 延迟编译策略

启动时只编译默认 profile，其他 profile 延迟到首次使用时编译：

```typescript
async ensurePipeline(device: GPUDevice, profileId: string): Promise<GPUComputePipeline> {
  if (this.pipelines.has(profileId)) {
    return this.pipelines.get(profileId)!
  }
  await this.compilePipeline(device, profileId)
  return this.pipelines.get(profileId)!
}
```

用户切换 profile 时的体验：
- 已编译 → 瞬间切换
- 未编译 → 当前画面继续显示，后台静默编译，完成后自动切换

### 12.8 Shader 模板化

不同 profile 的 shader 共享框架代码，只有 decode 和 eval 部分不同：

```typescript
const FRAMEWORK = `// 坐标计算、output 写入等固定代码`
const DECODER_64 = `fn decodeDescriptor(index: u32) -> DecodedDesc { ... }`
const DECODER_128 = `fn decodeDescriptor(index: u32) -> DecodedDesc { ... }`

function buildShader(profile: string): string {
  return FRAMEWORK + (profile === '128' ? DECODER_128 : DECODER_64) + EVAL + 'fn main(...) { ... }'
}
```

## 十三、GPU Buffer 与纹理采样

### 13.1 完整 Bind Group Layout

所有可能的 buffer 和 texture 一次性定义，不用时绑 dummy 资源：

| Binding | 类型 | 名称 | 用途 | 是否必有 |
|---------|------|------|------|----------|
| 0 | uniform | uniforms | 分辨率、时间、鼠标 | 必有 |
| 1 | storage | descriptors | 主描述符数组 | 必有 |
| 2 | storage | schemeMap | 方案选择 | 可选 |
| 3 | storage | regionTable | 区域定义表 | 可选 |
| 4 | texture | bgTexture | 背景纹理 | 可选 |
| 5 | sampler | bgSampler | 纹理采样器 | 可选 |
| 6 | texture | lutTexture | 颜色查找表 | 可选 |
| 7 | texture | prevFrame | 上一帧 | 可选 |
| 8 | storage | audioData | 音频数据 | 可选 |

### 13.2 Dummy 资源策略

```typescript
function createDummyBuffer(device: GPUDevice, size: number): GPUBuffer {
  return device.createBuffer({ size, usage: GPUBufferUsage.STORAGE })
}

function createDummyTexture(device: GPUDevice): GPUTexture {
  return device.createTexture({
    size: [1, 1],
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  })
}
```

Shader 里绑定 dummy 资源后安全读取，不会越界。

### 13.3 纹理采样用途

**不是 3D，是 2D 程序化生成的增强：**

- **背景填充**：用户说"星空背景"，采样预生成星云纹理，比实时计算噪声快得多
- **细节叠加**：主体用程序化生成，表面细节用纹理采样（木纹、金属划痕）
- **参考图输入**：用户提供参考图，shader 采样后与描述符混合
- **后期处理**：生成完成后拷贝到纹理，做 bloom、blur、color grading

### 13.4 4K/8K 存储与性能策略

| 分辨率 | 像素数 | 全128-bit | 核心问题 |
|--------|--------|-----------|----------|
| 1080p | 207 万 | 33 MB | 无 |
| 4K | 829 万 | 132 MB | CPU 生成性能 |
| 8K | 3318 万 | 530 MB | CPU 生成性能 |

内存不是问题，CPU 生成性能才是瓶颈。

**解决方案：**
- **分块生成（Tile-based）**：256×256 的 tile，Web Worker 并行处理
- **渐进式分辨率**：先 1/4 分辨率预览，确认后全分辨率
- **增量更新**：只重算变化区域
- **GPU 分担计算**：如噪声随机种子，CPU 只传 seed，GPU 实时计算

## 十四、Tauri + Vue 应用架构

### 18.1 技术栈

- 前端框架：Vue 3.5+
- 状态管理：Pinia 2.2+
- 构建工具：Vite 6.0+
- 桌面壳子：Tauri 2.0+
- 语言：TypeScript 5.6+

### 18.2 项目结构

```
pixel-forge/
├── src/
│   ├── main.ts                    # Vue 入口
│   ├── App.vue                    # 根组件
│   ├── style.css                  # 全局样式
│   ├── components/
│   │   ├── CanvasView.vue         # WebGPU Canvas 容器
│   │   ├── ControlPanel.vue       # 参数调试面板
│   │   ├── MetricsPanel.vue       # 性能监控
│   │   └── ShaderEditor.vue       # WGSL 编辑器
│   ├── stores/
│   │   └── app.ts                 # Pinia 全局状态
│   ├── compiler/
│   │   ├── types.ts               # 类型定义
│   │   ├── parser.ts              # 语义解析（LLM / 规则）
│   │   ├── analyzer.ts            # 区域分析
│   │   ├── encoder.ts             # 统一编码接口
│   │   └── compiler.ts            # 编排：parse → analyze → encode → pack
│   └── gpu/
│       ├── shader.wgsl            # WGSL 计算着色器
│       ├── pipeline.ts            # WebGPU pipeline 管理
│       └── buffers.ts             # Buffer 创建/上传
├── src-tauri/                     # Tauri Rust 后端
│   ├── src/
│   │   └── main.rs
│   └── tauri.conf.json
├── index.html
├── package.json
├── vite.config.ts
├── tsconfig.json
└── README.md
```

### 18.3 状态管理（Pinia）

```typescript
// stores/app.ts
export const useAppStore = defineStore('app', () => {
  const prompt = ref('')
  const resolution = ref({ width: 1920, height: 1080 })
  const isCompiling = ref(false)
  const compileResult = ref<CompilerResult | null>(null)
  const fps = ref(0)
  const frameTime = ref(0)
  const error = ref('')

  const pixelCount = computed(() => resolution.value.width * resolution.value.height)
  const memoryMB = computed(() => { /* ... */ })

  async function generate() { /* ... }

  return { /* ... */ }
})
```

### 18.4 核心接口

**编译器入口：**
```typescript
interface CompilerInterface {
  compile(prompt: string, options: CompilerOptions): Promise<CompilerResult>
}
```

**编码策略接口：**
```typescript
interface IEncoder {
  readonly schemeId: SchemeId
  readonly name: string
  encode(ctx: EncodeContext): void
  getBuffer(): ArrayBuffer
}
```

**GPU渲染接口：**
```typescript
interface IRenderer {
  init(device: GPUDevice, canvas: HTMLCanvasElement): Promise<void>
  render(result: CompilerResult): void
  switchProfile(profileId: string): void
  dispose(): void
}
```

**Shader 管理器接口：**
```typescript
interface IShaderManager {
  init(device: GPUDevice): Promise<void>
  getPipeline(profileId: string): GPUComputePipeline
  switchProfile(profileId: string): void
  isReady(profileId: string): boolean
}
```

## 十九、渐进式生成与增量更新

### 19.1 核心思路

不是每帧都全分辨率生成，而是：
- **时间上渐进**：关键帧全分辨率，中间帧基于前后帧插值/局部更新
- **空间上渐进**：先低分辨率预览，再分块精化
- **差异上增量**：只重算变化的部分

### 19.2 时间渐进（关键帧 + 插值）

```
总时长 60s，60fps = 3600 帧

策略：
- 每 30 帧生成一个关键帧（共 120 个关键帧）
- 关键帧：全分辨率描述符，GPU 渲染
- 中间帧：基于前后关键帧，参数插值 + 局部精化

关键帧间隔 = 0.5s（30帧）
```

**参数插值：**
```typescript
function interpolateFrame(prev: CompilerResult, next: CompilerResult, t: number): CompilerResult {
  const result = clone(prev)
  for (let i = 0; i < result.schemeMap.length; i++) {
    result.descriptors64[i] = lerpDescriptor(prev.descriptors64[i], next.descriptors64[i], t)
  }
  return result
}
```

**收益：**
- 120 个关键帧 × 800ms = 96 秒生成时间
- 3480 个中间帧 × 5ms（纯插值）≈ 17 秒
- 总计 ~113 秒，不到 2 分钟

### 19.3 空间渐进（多分辨率金字塔）

```
分辨率金字塔：
Level 0: 270×152   → 1/8 分辨率预览
Level 1: 540×304   → 1/4 分辨率粗精化
Level 2: 1080×608  → 1/2 分辨率中精化
Level 3: 2160×1216 → 全分辨率输出（约 2K）
Level 4: 3840×2160 → 4K 超采样输出
```

**每一级的描述符可以基于上一级放大：**
```typescript
function upscaleDescriptors(lowResDesc, lowWidth, lowHeight, highWidth, highHeight) {
  const highResDesc = new Uint32Array(highWidth * highHeight)
  for (let y = 0; y < highHeight; y++) {
    for (let x = 0; x < highWidth; x++) {
      const lx = Math.floor(x * lowWidth / highWidth)
      const ly = Math.floor(y * lowHeight / highHeight)
      const lowIndex = ly * lowWidth + lx
      const highIndex = y * highWidth + x
      highResDesc[highIndex] = lowResDesc[lowIndex]
    }
  }
  return highResDesc
}
```

**收益：**
- 用户看到画面的时间：~50ms（1/8 分辨率）
- 1/4 分辨率：~200ms
- 全分辨率：后台继续生成
- 用户感知延迟几乎为零

### 19.4 空间增量（只更新变化区域）

**场景 1：用户拖拽参数**
```typescript
function onSwirlStrengthChanged(newStrength: number) {
  const affectedRegion = getSwirlRegion()
  for (const pixel of affectedRegion) {
    descriptors64[pixel.index] = computeDescriptorForPixel(pixel.x, pixel.y, newStrength)
  }
  uploadPartial(descriptors64, affectedRegion)
  render()
}
```

**场景 2：时间动画（视频生成）**
```typescript
function animate(time: number) {
  for (let i = 0; i < descriptors64.length; i++) {
    const desc = descriptors64[i]
    const opcode = decodeOpcode(desc)
    if (opcode === OPCODE_SWIRL || opcode === OPCODE_PLASMA) {
      descriptors64[i] = updateTimeParam(desc, time)
    }
  }
  uploadAndRender()
}
```

### 19.5 完整方案：三层渐进 + 增量

```
用户点击"生成 60s 4K 视频"
    ↓
┌─────────────────────────────────────────┐
│ Phase 1: 关键帧规划                      │
│ - 确定关键帧间隔（如每 30 帧）            │
│ - 计算关键帧时间点                       │
└────────────────┬────────────────────────┘
                 ▼
┌─────────────────────────────────────────┐
│ Phase 2: 关键帧生成（并行）               │
│ - 120 个关键帧 × 800ms = 96s            │
│ - Web Worker 分块，24 线程并行            │
│ - 每完成一个关键帧立即渲染预览             │
└────────────────┬────────────────────────┘
                 ▼
┌─────────────────────────────────────────┐
│ Phase 3: 中间帧插值（极快）               │
│ - 3480 帧 × 5ms = 17s                  │
│ - 纯 CPU 参数插值，不重新分析语义         │
│ - 可选：对变化大的帧做局部精化             │
└────────────────┬────────────────────────┘
                 ▼
┌─────────────────────────────────────────┐
│ Phase 4: 空间渐进渲染                    │
│ - 先以 1/4 分辨率渲染所有帧               │
│ - 用户确认后，后台精化关键帧到 4K         │
│ - 中间帧用双线性放大                     │
└─────────────────────────────────────────┘
```

## 二十、CPU 并行化与 GPU 分担

### 20.1 CPU 并行化（必须）

CPU 描述符生成是**完全可并行的**（每个像素独立），必须用 Web Worker 把 24 线程用满。

### Web Worker 分块实现

```typescript
async function generateWithWorkers(width: number, height: number, workerCount: number) {
  const tileSize = 256  // 256×256 一个 tile
  const tilesX = Math.ceil(width / tileSize)
  const tilesY = Math.ceil(height / tileSize)
  const totalTiles = tilesX * tilesY
  
  const workers = []
  for (let i = 0; i < workerCount; i++) {
    workers.push(new Worker(new URL('./tile-worker.ts', import.meta.url)))
  }
  
  const tiles = Array.from({ length: totalTiles }, (_, i) => ({
    x: (i % tilesX) * tileSize,
    y: Math.floor(i / tilesX) * tileSize,
    width: Math.min(tileSize, width - (i % tilesX) * tileSize),
    height: Math.min(tileSize, height - Math.floor(i / tilesX) * tileSize),
  }))
  
  const results = await Promise.all(
    tiles.map((tile, index) => 
      dispatchToWorker(workers[index % workerCount], tile, semanticTree)
    )
  )
  
  return mergeTiles(results)
}
```

**Worker 内部：**
```typescript
self.onmessage = (e) => {
  const { tile, semanticTree } = e.data
  const descriptors = new Uint32Array(tile.width * tile.height)
  
  for (let y = 0; y < tile.height; y++) {
    for (let x = 0; x < tile.width; x++) {
      const globalX = tile.x + x
      const globalY = tile.y + y
      const index = y * tile.width + x
      const region = findRegion(globalX, globalY, semanticTree)
      descriptors[index] = encodeDescriptor(region, globalX, globalY)
    }
  }
  
  self.postMessage({ tile, descriptors }, [descriptors.buffer])
}
```

**24 线程下，829 万像素分成约 135 个 tile，每个 worker 处理约 5~6 个 tile。**
- 单 tile 处理时间：~2ms（256×256 = 65536 像素）
- 5~6 个 tile：~10~12ms
- 加上通信 overhead：~20~40ms/worker
- 总计：~20~40ms 完成 4K 描述符生成

### 20.2 GPU 端优化：让 GPU 承担更多图像生成工作

既然显存富余，可以把一些工作从 CPU 搬到 GPU：

**1. GPU 端区域查询**
```wgsl
@group(0) @binding(3) var<storage, read> regionTable: array<RegionInfo;

fn getRegion(x: u32, y: u32) -> RegionInfo {
  for (var i = 0u; i < regionCount; i++) {
    let r = regionTable[i]
    if (x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height) {
      return r
    }
  }
  return regionTable[0]
}
```

**收益：** CPU 完全不生成描述符，只传 regionTable（几 KB）。GPU 自己算每个像素的颜色。

**2. GPU 端噪声计算**
```wgsl
fn op_noise(x: u32, y: u32, seed: u32, scale: f32) -> vec3f {
  let nx = f32(x) * scale
  let ny = f32(y) * scale
  let n = perlinNoise(vec2f(nx, ny), seed)
  return vec3f(n)
}
```

**收益：** 省掉 CPU 预计算噪声值的内存和计算。

**3. GPU 端混合/合成**
```wgsl
fn main(...) {
  let color1 = evalLayer(regionTable[0], x, y)  // 背景
  let color2 = evalLayer(regionTable[1], x, y)  // 前景
  let finalColor = mix(color1, color2, regionTable[1].opacity)
}
```

### 20.3 3070 + 1920X 配置下的视频生成评估

| 场景 | 预估时间 | 说明 |
|------|----------|------|
| 无优化，每帧全新生成 | 24~48 分钟 | 单线程，CPU 瓶颈 |
| Web Worker 24 线程并行 | 3~6 分钟 | 多核利用，GPU 辅助 |
| 渐进式 + 增量更新 | 3~5 分钟 | 最优，适合平滑动画 |
| 如果加入预计算缓存 | 1~2 分钟 | 静态部分缓存，只生成动态部分 |

**瓶颈分析：**
- CPU（1920X）：描述符生成是**完全可并行的**，24 线程可以接近线性 scaling
- GPU（3070）：单帧渲染 2~5ms，3600 帧总渲染时间 7~18 秒，**GPU 时间可忽略**
- 存储 I/O：4K RGBA8 = 33MB/帧，3600 帧 = 118GB，NVMe SSD 写入时间 ~40s

**优化优先级：**

| 优先级 | 优化项 | 预期收益 | 实现复杂度 |
|--------|--------|----------|-----------|
| P0 | Web Worker 24 线程并行 | 48 分钟 → 3~6 分钟 | 中 |
| P0 | 关键帧 + 中间帧插值 | 3~6 分钟 → 2~4 分钟 | 中 |
| P1 | 空间渐进式分辨率 | 用户感知延迟 < 100ms | 中 |
| P1 | GPU 端区域查询/噪声 | CPU 描述符生成再减 30~50% | 中高 |
| P2 | 增量更新（参数变化） | 交互响应 < 50ms | 低 |

**核心结论：**
- CPU 并行化是必须的，没有它 24 分钟起步
- 渐进式/增量更新把时间压到 2~4 分钟，同时保证交互体验
- GPU 资源富余，可以承担区域查询、噪声、混合等图像生成工作
- Ryzen 1920X + RTX 3070 完全能胜任，瓶颈在软件架构不在硬件

## 二十一、以图生图：理解而非猜测

### 21.1 设计理念

不猜测"这张图用什么算法画的"，而是**客观理解图片里有什么**。图片可能是手绘、AI 生成、照片，不需要识别生成手法，只需要理解内容和结构。

### 21.2 核心工作流

```
用户上传图片
    ↓
┌─────────────────────────────────────────┐
│ Step 1: 四象限递归细分                     │
│ - 把图分成 4 块                             │
│ - 每块内部再细分，直到块内颜色一致           │
│ - 输出：色块树（每个叶子节点是一个均匀色块）  │
└────────────────┬────────────────────────┘
                 ▼
┌─────────────────────────────────────────┐
│ Step 2: 色块关系分析                       │
│ - 四象限位置关系：左上/右上/左下/右下         │
│ - 父子层级关系：背景→主体→前景               │
│ - 相邻关系：哪些色块挨在一起                 │
└────────────────┬────────────────────────┘
                 ▼
┌─────────────────────────────────────────┐
│ Step 3: LLM 语义理解                       │
│ 输入：色块树 + 空间关系                     │
│ 输出：这张图"是什么"                       │
│ 例："深蓝夜空背景，右上角有月亮，            │
│      左下角有树林剪影"                      │
└────────────────┬────────────────────────┘
                 ▼
┌─────────────────────────────────────────┐
│ Step 4: 语义 → 描述符                       │
│ 把 LLM 理解的语义转换成程序化描述符           │
│ 例："深蓝夜空" → solid, color=[10,20,60]  │
│     "月亮" → solid, color=[255,255,200]   │
└─────────────────────────────────────────┘
```

### 21.3 Step 1：四象限递归细分

> **注意：本节为早期原型实现，用于快速验证四象限细分思路。产品评审后已确定采用 21.9.3 的增强版策略（Sobel + 积分图 + 自适应阈值 + 噪声鲁棒性），实现时请以 21.9.3 为准。**

**核心算法：区域分裂（Region Splitting）**

```typescript
interface ColorBlock {
  id: string
  rect: { x: number; y: number; width: number; height: number }
  color: [number, number, number]  // 平均色
  variance: number  // 颜色方差，判断是否需要继续细分
  children: ColorBlock[]
}

function splitIntoBlocks(imageData: ImageData, maxDepth = 6): ColorBlock {
  return splitRecursive(imageData, 0, 0, imageData.width, imageData.height, 0)

  function splitRecursive(
    data: ImageData,
    x: number, y: number, w: number, h: number,
    depth: number
  ): ColorBlock {
    const block = analyzeBlock(data, x, y, w, h)

    if (block.variance > VARIANCE_THRESHOLD && depth < maxDepth) {
      const halfW = Math.floor(w / 2)
      const halfH = Math.floor(h / 2)

      block.children = [
        splitRecursive(data, x, y, halfW, halfH, depth + 1),
        splitRecursive(data, x + halfW, y, w - halfW, halfH, depth + 1),
        splitRecursive(data, x, y + halfH, halfW, h - halfH, depth + 1),
        splitRecursive(data, x + halfW, y + halfH, w - halfW, h - halfH, depth + 1),
      ]
    }

    return block
  }
}

function analyzeBlock(data: ImageData, x: number, y: number, w: number, h: number): ColorBlock {
  let totalR = 0, totalG = 0, totalB = 0
  let count = 0
  const colors: [number, number, number][] = []

  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const px = x + dx
      const py = y + dy
      const i = (py * data.width + px) * 4
      const r = data.data[i]
      const g = data.data[i + 1]
      const b = data.data[i + 2]

      totalR += r
      totalG += g
      totalB += b
      colors.push([r, g, b])
      count++
    }
  }

  const avgR = Math.floor(totalR / count)
  const avgG = Math.floor(totalG / count)
  const avgB = Math.floor(totalB / count)

  let variance = 0
  for (const [r, g, b] of colors) {
    variance += (r - avgR) ** 2 + (g - avgG) ** 2 + (b - avgB) ** 2
  }
  variance /= count

  return {
    id: generateId(),
    rect: { x, y, width: w, height: h },
    color: [avgR, avgG, avgB],
    variance,
    children: [],
  }
}
```

**为什么用四象限：**
- 每次分成 4 块，天然对应画面的上下左右关系
- 递归细分后，树结构保留了空间层次：根节点=全图，叶子=局部色块
- 适合后续 LLM 理解"左上角是什么、右下角是什么"

### 21.4 Step 2：色块关系分析

从四象限树中提取空间关系：

```typescript
interface SpatialRelation {
  type: 'contains' | 'above' | 'below' | 'left_of' | 'right_of' | 'adjacent'
  from: ColorBlock
  to: ColorBlock
  description: string
}

function analyzeSpatialRelations(root: ColorBlock): SpatialRelation[] {
  const relations: SpatialRelation[] = []

  function traverse(block: ColorBlock, parent: ColorBlock | null) {
    if (!parent) return

    const parentRect = parent.rect
    const blockRect = block.rect

    if (blockRect.y + blockRect.height < parentRect.y + parentRect.height / 2) {
      relations.push({
        type: 'above',
        from: parent,
        to: block,
        description: `${block.id} 在 ${parent.id} 上方`,
      })
    }

    if (blockRect.x + blockRect.width < parentRect.x + parentRect.width / 2) {
      relations.push({
        type: 'left_of',
        from: parent,
        to: block,
        description: `${block.id} 在 ${parent.id} 左侧`,
      })
    }

    for (const child of block.children) {
      traverse(child, block)
    }
  }

  for (const child of root.children) {
    traverse(child, root)
  }

  return relations
}
```

### 21.5 Step 3：LLM 语义理解

把色块树 + 空间关系送给 LLM，让它理解"这张图是什么"。

```typescript
async function understandImageWithLLM(root: ColorBlock, relations: SpatialRelation[]): Promise<SemanticElement[]> {
  const prompt = `
分析这张图片的色块结构，理解图像内容。

# 色块信息
${describeBlockTree(root)}

# 空间关系
${relations.map(r => r.description).join('\n')}

# 任务
1. 这张图片描述的是什么场景？
2. 每个主要色块代表什么物体/区域？
3. 整体色调和风格是什么？

输出 JSON 格式：
{
  "scene": "星空夜景",
  "elements": [
    {
      "type": "solid",
      "description": "深蓝色夜空背景",
      "color": [10, 20, 60],
      "layer": 0
    },
    {
      "type": "starfield",
      "description": "星星",
      "color": [255, 255, 200],
      "layer": 1
    }
  ],
  "style": "写实",
  "dominantColors": [[10,20,60], [255,255,200]]
}
`

  const response = await callLLM({
    model: 'gpt-4-vision',
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
    temperature: 0.3,
  })

  return JSON.parse(response.content)
}
```

### 21.6 Step 4：语义 → 描述符

LLM 输出的是"语义描述"，转换成程序化描述符：

```typescript
function semanticToDescriptors(semantic: LLMOutput, imageData: ImageData, root: ColorBlock): CompilerResult {
  const { width, height } = imageData
  const pixelCount = width * height
  const descriptors = new BigInt64Array(pixelCount * 2)
  const schemeMap = new Uint8Array(pixelCount)

  for (const element of semantic.elements) {
    const block = findBlockByDescription(root, element.description)

    for (let y = block.rect.y; y < block.rect.y + block.rect.height; y++) {
      for (let x = block.rect.x; x < block.rect.x + block.rect.width; x++) {
        const i = y * width + x
        const desc = encodeFromSemantic(element, x, y, block)
        descriptors[i] = desc
        schemeMap[i] = 0
      }
    }
  }

  return { descriptors, schemeMap, regions: [] }
}
```

### 21.7 用户如何在图片上精确修改

融合后的模型是双向可编辑的：

- **文本指令修改**："把星星变密" → 修改 starfield 的 density
- **参数面板**：可视化调整每个元素的参数
- **区域选择**：用户圈出区域，系统询问修改意图

### 21.8 实现优先级

| 阶段 | 内容 | 工作量 |
|------|------|--------|
| Phase 1 | 四象限递归细分 + 色块提取 | 2~3 天 |
| Phase 2 | 色块关系分析（四象限空间关系） | 1~2 天 |
| Phase 3 | LLM 语义理解（色块 → 语义） | 2~3 天 |
| Phase 4 | 语义 → 描述符转换 | 1~2 天 |
| Phase 5 | 用户编辑界面 | 3~5 天 |

**Phase 1 可以先做最简单的：** 固定深度递归细分（如 4 层），输出色块树。不需要 LLM 就能验证算法。

### 21.9 产品评审与修正

#### 21.9.1 去掉合并步骤

Phase 1 的消费者是 LLM，不是人眼。LLM 能处理 128K token 上下文，200~800 个色块完全在可处理范围内。合并步骤造成的信息损失反而可能让 LLM 误解画面。

**修正：直接输出原始色块树，不合并。**

#### 21.9.2 保留树结构，输出两种视图

同一棵色块树，两种消费视图：

```typescript
interface ColorBlock {
  id: string
  rect: { x: number; y: number; width: number; height: number }
  avgColor: [number, number, number]
  dominantColor: [number, number, number]
  variance: number
  pixelCount: number
  children: ColorBlock[]
  depth: number
  path: string  // "root/0/1/3" 编码空间位置
}

class ColorBlockTree {
  // 视图 1：给 LLM 的文本描述（完整树结构）
  toLLMView(maxDepth = 4): string {
    return describeBlockTree(this.root, maxDepth)
  }

  // 视图 2：给用户的简化遮罩（Phase 3 交互式编辑用）
  toUserView(): ColorBlock[] {
    return extractBlocksAtDepth(this.root, 2)
  }
}
```

#### 21.9.3 自适应细分策略

用**边缘检测 + 方差 + 最小尺寸 + 噪声鲁棒性**四重判断，替代固定阈值。

##### 21.9.3.1 为什么不能用简单梯度

原版 `detectEdgeStrength` 只检测水平方向（x 轴）相邻像素差值，会漏掉垂直边缘、对角线边缘。对于星空图这种"点状物体"，水平梯度几乎为 0，导致星星永远不会被细分。

**必须使用完整边缘检测算子。**

##### 21.9.3.2 Sobel 边缘检测（Phase 1 标准）

Sobel 算子同时检测水平和垂直梯度，计算像素的梯度幅值：

> **注意：** 以下 `sobelEdgeStrength` 仅用于说明算法原理。实际实现中，Sobel 在 `IntegralImages.build()` 里一次性预计算到 `edgeIntegral`，`shouldSplit` 通过 `queryEdgeStrength()` 做 O(1) 查询，不会逐块调用此函数。

```typescript
function sobelEdgeStrength(imageData: ImageData, rect: { x: number; y: number; width: number; height: number }): number {
  const { width, height } = rect
  let totalMagnitude = 0
  let count = 0

  for (let y = rect.y + 1; y < rect.y + height - 1; y++) {
    for (let x = rect.x + 1; x < rect.x + width - 1; x++) {
      const idx = (y * imageData.width + x) * 4

      const gx =
        -1 * getGray(imageData, x - 1, y - 1) + 1 * getGray(imageData, x + 1, y - 1) +
        -2 * getGray(imageData, x - 1, y)     + 2 * getGray(imageData, x + 1, y) +
        -1 * getGray(imageData, x - 1, y + 1) + 1 * getGray(imageData, x + 1, y + 1)

      const gy =
        -1 * getGray(imageData, x - 1, y - 1) - 2 * getGray(imageData, x, y - 1) - 1 * getGray(imageData, x + 1, y - 1) +
         1 * getGray(imageData, x - 1, y + 1) + 2 * getGray(imageData, x, y + 1) + 1 * getGray(imageData, x + 1, y + 1)

      totalMagnitude += Math.sqrt(gx * gx + gy * gy)
      count++
    }
  }

  return count > 0 ? totalMagnitude / count : 0
}

function getGray(imageData: ImageData, x: number, y: number): number {
  const i = (y * imageData.width + x) * 4
  return (imageData.data[i] * 0.299 + imageData.data[i + 1] * 0.587 + imageData.data[i + 2] * 0.114)
}
```

**注意：** Sobel 需要至少 3×3 区域，因此 `rect` 宽高必须 ≥ 3。

**边界效应：** 由于 Sobel 依赖 3×3 邻域，图像最外 1 像素宽边框无法计算梯度，`edgeIntegral` 对应区域为 0。`queryEdgeStrength` 查询贴边块时，边缘强度会被这圈 0 拉低，可能出现贴边区域不细分。实现时如发现贴边区域过少，可对边缘块做 1 像素内缩后再查询。

##### 21.9.3.3 积分图加速（Integral Image）

4K 图像上对每个色块做 Sobel 会非常慢。使用积分图把边缘强度和 RGB 方差查询降到 O(1)。

```typescript
class IntegralImages {
  private width: number
  private height: number
  public gray: Float64Array
  public grayIntegral: Float64Array
  public graySqIntegral: Float64Array
  public edgeIntegral: Float64Array

  constructor(imageData: ImageData) {
    this.width = imageData.width
    this.height = imageData.height
    this.gray = new Float64Array(this.width * this.height)
    this.grayIntegral = new Float64Array(this.width * this.height)
    this.graySqIntegral = new Float64Array(this.width * this.height)
    this.edgeIntegral = new Float64Array(this.width * this.height)
    this.build(imageData)
  }

  private build(imageData: ImageData) {
    const edge = new Float64Array(this.width * this.height)

    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const i = y * this.width + x
        const pi = (y * imageData.width + x) * 4
        this.gray[i] = imageData.data[pi] * 0.299 + imageData.data[pi + 1] * 0.587 + imageData.data[pi + 2] * 0.114
      }
    }

    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const i = y * this.width + x
        const left = x > 0 ? this.grayIntegral[i - 1] : 0
        const top = y > 0 ? this.grayIntegral[i - this.width] : 0
        const topLeft = x > 0 && y > 0 ? this.grayIntegral[i - this.width - 1] : 0
        this.grayIntegral[i] = this.gray[i] + left + top - topLeft

        const leftSq = x > 0 ? this.graySqIntegral[i - 1] : 0
        const topSq = y > 0 ? this.graySqIntegral[i - this.width] : 0
        const topLeftSq = x > 0 && y > 0 ? this.graySqIntegral[i - this.width - 1] : 0
        this.graySqIntegral[i] = this.gray[i] * this.gray[i] + leftSq + topSq - topLeftSq
      }
    }

    for (let y = 1; y < this.height - 1; y++) {
      for (let x = 1; x < this.width - 1; x++) {
        const i = y * this.width + x
        const gx = -gray[i - this.width - 1] + gray[i - this.width + 1] +
                    -2 * gray[i - 1] + 2 * gray[i + 1] +
                    -gray[i + this.width - 1] + gray[i + this.width + 1]
        const gy = -gray[i - this.width - 1] - 2 * gray[i - this.width] - gray[i - this.width + 1] +
                    gray[i + this.width - 1] + 2 * gray[i + this.width] + gray[i + this.width + 1]
        edge[i] = Math.sqrt(gx * gx + gy * gy)
      }
    }

    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const i = y * this.width + x
        const left = x > 0 ? this.edgeIntegral[i - 1] : 0
        const top = y > 0 ? this.edgeIntegral[i - this.width] : 0
        const topLeft = x > 0 && y > 0 ? this.edgeIntegral[i - this.width - 1] : 0
        this.edgeIntegral[i] = edge[i] + left + top - topLeft
      }
    }
  }

  queryRectSum(integral: Float64Array, rect: { x: number; y: number; width: number; height: number }): number {
    const x = Math.min(rect.x, this.width - 1)
    const y = Math.min(rect.y, this.height - 1)
    const w = Math.min(rect.width, this.width - x)
    const h = Math.min(rect.height, this.height - y)
    const x2 = x + w - 1
    const y2 = y + h - 1

    const sum = integral[y2 * this.width + x2]
    const left = x > 0 ? integral[y2 * this.width + x - 1] : 0
    const top = y > 0 ? integral[(y - 1) * this.width + x2] : 0
    const topLeft = x > 0 && y > 0 ? integral[(y - 1) * this.width + x - 1] : 0

    return sum - left - top + topLeft
  }

  queryEdgeStrength(rect: { x: number; y: number; width: number; height: number }): number {
    const sum = this.queryRectSum(this.edgeIntegral, rect)
    return sum / (rect.width * rect.height)
  }

  queryVariance(rect: { x: number; y: number; width: number; height: number }): number {
    const sum = this.queryRectSum(this.grayIntegral, rect)
    const sumSq = this.queryRectSum(this.graySqIntegral, rect)
    const count = rect.width * rect.height
    const mean = sum / count
    return sumSq / count - mean * mean
  }
}
```

**内存估算（4K）：**
- grayIntegral：829万 × 8 字节 ≈ 66 MB
- graySqIntegral：同上 ≈ 66 MB
- edgeIntegral：同上 ≈ 66 MB
- **总计：198 MB**

**优化：下采样到 1080p**
```typescript
const downsampleFactor = 4 // 4K → 1080p
const smallWidth = Math.ceil(width / downsampleFactor)
const smallHeight = Math.ceil(height / downsampleFactor)
const smallImageData = downsample(imageData, smallWidth, smallHeight)
const integrals = new IntegralImages(smallImageData)
// 查询时 rect 坐标也按同比例缩小
```
- 1080p 内存：66 MB × 3 = **198 MB → 49.5 MB**
- 精度损失：可接受，边缘检测本身就是近似

##### 21.9.3.4 噪声过滤：Box Blur 近似 Gaussian

**问题：** Sobel 对噪声极其敏感。噪声图会导致每个小块方差都很高，生成上千个色块，token 预算爆炸。

**解决方案：** 在边缘检测前先做模糊。3 次 box blur 近似 Gaussian blur（σ ≈ 1.5）：

```typescript
function boxBlur3Pass(imageData: ImageData, radius: number = 2): ImageData {
  const temp = new ImageData(imageData.width, imageData.height)
  const result = new ImageData(imageData.width, imageData.height)

  horizontalBoxBlur(imageData, temp, radius)
  verticalBoxBlur(temp, result, radius)
  horizontalBoxBlur(result, temp, radius)

  return temp
}

function horizontalBoxBlur(src: ImageData, dst: ImageData, radius: number) {
  const w = src.width
  const h = src.height
  const diameter = radius * 2 + 1
  const divisor = diameter

  for (let y = 0; y < h; y++) {
    let r = 0, g = 0, b = 0

    for (let x = -radius; x <= radius; x++) {
      const xi = Math.min(w - 1, Math.max(0, x))
      const i = (y * w + xi) * 4
      r += src.data[i]
      g += src.data[i + 1]
      b += src.data[i + 2]
    }

    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      dst.data[i] = r / divisor
      dst.data[i + 1] = g / divisor
      dst.data[i + 2] = b / divisor
      dst.data[i + 3] = src.data[i + 3]

      const addX = Math.min(w - 1, x + radius + 1)
      const subX = Math.max(0, x - radius)
      const addI = (y * w + addX) * 4
      const subI = (y * w + subX) * 4

      r += src.data[addI] - src.data[subI]
      g += src.data[addI + 1] - src.data[subI + 1]
      b += src.data[addI + 2] - src.data[subI + 2]
    }
  }
}

function verticalBoxBlur(src: ImageData, dst: ImageData, radius: number) {
  const w = src.width
  const h = src.height
  const diameter = radius * 2 + 1
  const divisor = diameter

  for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0

    for (let y = -radius; y <= radius; y++) {
      const yi = Math.min(h - 1, Math.max(0, y))
      const i = (yi * w + x) * 4
      r += src.data[i]
      g += src.data[i + 1]
      b += src.data[i + 2]
    }

    for (let y = 0; y < h; y++) {
      const i = (y * w + x) * 4
      dst.data[i] = r / divisor
      dst.data[i + 1] = g / divisor
      dst.data[i + 2] = b / divisor
      dst.data[i + 3] = src.data[i + 3]

      const addY = Math.min(h - 1, y + radius + 1)
      const subY = Math.max(0, y - radius)
      const addI = (addY * w + x) * 4
      const subI = (subY * w + x) * 4

      r += src.data[addI] - src.data[subI]
      g += src.data[addI + 1] - src.data[subI + 1]
      b += src.data[addI + 2] - src.data[subI + 2]
    }
  }
}
```

**为什么用 Box Blur 而不是 Gaussian：**
- 3 次 box blur 是 Gaussian 的快速近似（理论上无限次 box blur = Gaussian）
- 实现简单，每 pass 都是 O(n)，且可用滑动窗口优化到 O(1) per pixel
- radius=2 的 3 pass box blur ≈ Gaussian σ=1.5

##### 21.9.3.5 噪声水平估计与自适应阈值补偿

不是所有图都需要同样强度的模糊。先估计噪声水平，再决定阈值：

```typescript
function estimateNoiseLevel(integrals: IntegralImages): number {
  const globalVariance = integrals.queryVariance({
    x: 0, y: 0,
    width: integrals.width,
    height: integrals.height
  })

  let highFreqVariance = 0
  const step = 8
  let count = 0

  for (let y = 0; y < integrals.height; y += step) {
    const remainingH = Math.min(step, integrals.height - y)
    for (let x = 0; x < integrals.width; x += step) {
      const remainingW = Math.min(step, integrals.width - x)
      highFreqVariance += integrals.queryVariance({
        x, y,
        width: remainingW,
        height: remainingH
      })
      count++
    }
  }

  const avgLocalVariance = highFreqVariance / count
  return globalVariance > 0 ? avgLocalVariance / globalVariance : 0
}

function getAdaptiveThreshold(noiseLevel: number, depth: number): { edge: number; variance: number } {
  const noiseCompensation = 1 + noiseLevel * 2
  const baseEdge = 15 * noiseCompensation
  const baseVariance = 50 * Math.pow(1.2, depth)

  return {
    edge: baseEdge,
    variance: baseVariance * noiseCompensation
  }
}
```

**使用方式：**
```typescript
const noiseLevel = estimateNoiseLevel(integrals)
const threshold = getAdaptiveThreshold(noiseLevel, block.depth)

if (edgeStrength < threshold.edge) return false
if (block.variance < threshold.variance) return false
```

**噪声图 vs 干净图的阈值变化：**
- 干净图：noiseLevel ≈ 1.0，edgeThreshold = 15，varianceThreshold = 50 × 1.2^depth
- 噪声图：noiseLevel ≈ 3.0~5.0，edgeThreshold = 45~75，varianceThreshold = 150~250 × 1.2^depth

##### 21.9.3.6 微小物体检测（星星 2-3 像素）

问题：2-3 像素的星星被 Sobel 检测为边缘，但如果它所在的 8×8 块整体方差很低，可能不会被细分。

解决方案：**局部最大值检测 + 强制细分**

```typescript
function detectTinyObjects(
  integrals: IntegralImages,
  rect: { x: number; y: number; width: number; height: number },
  minSize: number = 2
): boolean {
  const w = rect.width
  const h = rect.height

  let brightSpotCount = 0
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const globalX = rect.x + x
      const globalY = rect.y + y
      const idx = globalY * integrals.width + globalX
      const center = integrals.gray[idx]
      const neighbors = [
        integrals.gray[idx - integrals.width],
        integrals.gray[idx + integrals.width],
        integrals.gray[idx - 1],
        integrals.gray[idx + 1]
      ]
      if (neighbors.every(n => center > n + 30)) {
        brightSpotCount++
      }
    }
  }

  return brightSpotCount > 0 && rect.width * rect.height >= minSize * minSize * 4
}
```

**在 shouldSplit 中的使用：**
```typescript
function shouldSplit(block: ColorBlock, ctx: SplitContext): boolean {
  // 1. 硬性最小尺寸
  if (block.rect.width < 8 || block.rect.height < 8) return false
  if (block.depth > 6) return false

  // 2. 噪声估计与自适应阈值
  const noiseLevel = estimateNoiseLevel(ctx.integrals)
  const threshold = getAdaptiveThreshold(noiseLevel, block.depth)

  // 3. 边缘检测（内容感知）
  const edgeStrength = ctx.integrals.queryEdgeStrength(block.rect)
  const hasEdge = edgeStrength >= threshold.edge

  // 4. 方差检查（颜色变化）
  const variance = ctx.integrals.queryVariance(block.rect)
  const hasHighVariance = variance >= threshold.variance

  // 5. 微小物体检测（星星）
  const hasTinyObject = detectTinyObjects(ctx.integrals, block.rect)

  // 优先级：微小物体 > 强边缘 > 高方差
  if (hasTinyObject && block.rect.width <= 32 && block.rect.height <= 32) return true
  if (hasEdge && hasHighVariance) return true
  if (hasEdge) return true

  return false
}
```

**关键修正（来自产品评审）：**
- 原来是 AND 逻辑（edge AND variance），会漏掉"边缘强但方差低"的情况（如星星）
- 现在是 OR + 优先级：微小物体 > 强边缘 + 高方差 > 强边缘 > 高方差
- 确保 2-3 像素的星星在 8×8 块中被检测到并细分

##### 21.9.3.7 下采样策略（4K → 1080p）

```typescript
function prepareAnalysis(imageData: ImageData): { blurred: ImageData; integrals: IntegralImages } {
  const maxDim = 1920
  const scale = Math.min(1, maxDim / Math.max(imageData.width, imageData.height))

  let targetWidth = imageData.width
  let targetHeight = imageData.height

  if (scale < 1) {
    targetWidth = Math.floor(imageData.width * scale)
    targetHeight = Math.floor(imageData.height * scale)
  }

  const resized = resizeImage(imageData, targetWidth, targetHeight)
  const blurred = boxBlur3Pass(resized, 2)
  const integrals = new IntegralImages(blurred)

  return { blurred, integrals }
}
```

**完整预处理流程：**
```
原始 4K 图 (3840×2160)
    ↓ resize（如需要）
1080p 图 (1920×1080)
    ↓ boxBlur3Pass (radius=2)
模糊图（噪声降低）
    ↓ IntegralImages
积分图（边缘 + 灰度 + 灰度平方）
    ↓
用于 shouldSplit 查询
```

##### 21.9.3.8 最终版 shouldSplit 完整代码

```typescript
interface SplitContext {
  integrals: IntegralImages
  noiseLevel: number
  globalEdgeStrength: number
}

function shouldSplit(block: ColorBlock, ctx: SplitContext): boolean {
  // 1. 硬性限制（不可突破）
  if (block.rect.width < 8 || block.rect.height < 8) return false
  if (block.depth >= 6) return false

  // 2. 自适应阈值
  const noiseCompensation = 1 + ctx.noiseLevel * 2
  const edgeThreshold = ctx.globalEdgeStrength * 0.3 * noiseCompensation
  const varianceThreshold = 50 * Math.pow(1.2, block.depth) * noiseCompensation

  // 3. 边缘检测
  const edgeStrength = ctx.integrals.queryEdgeStrength(block.rect)

  // 4. 方差检测
  const variance = ctx.integrals.queryVariance(block.rect)

  // 5. 微小物体检测（仅小尺寸块）
  const hasTinyObject = block.rect.width <= 32 && block.rect.height <= 32
    && detectTinyObjects(ctx.integrals, block.rect)

  // 6. 优先级决策
  if (hasTinyObject) return true
  if (edgeStrength >= edgeThreshold && variance >= varianceThreshold) return true
  if (edgeStrength >= edgeThreshold) return true

  return false
}
```

**决策逻辑说明：**
| 条件 | 结果 | 说明 |
|------|------|------|
| 微小物体 + 小尺寸块 | 强制细分 | 2-3 像素星星必须被捕获 |
| 边缘强 + 方差高 | 细分 | 典型物体边界 |
| 边缘强 + 方差低 | 细分 | 细线、渐变边界 |
| 边缘弱 + 方差高 | 不细分 | 纹理区域（如草地）整体保留 |
| 边缘弱 + 方差低 | 不细分 | 均匀区域 |

#### 21.9.4 修正后的 Phase 1 完整流程

```
用户上传图片
    ↓
┌─────────────────────────────────────────┐
│ Phase 1: 四象限递归细分                    │
│ - 下采样到 1080p                          │
│ - Box blur ×3 去噪                        │
│ - 积分图：边缘 + 灰度 + 灰度平方            │
│ - 噪声水平估计 → 自适应阈值                │
│ - Sobel 边缘检测 + 方差查询                │
│ - 微小物体检测（星星）                     │
│ - 输出：完整色块树（不合并）                │
│ - 两种视图：LLM 视图 + 用户视图             │
└────────────────┬────────────────────────┘
                 ▼
┌─────────────────────────────────────────┐
│ Phase 2: LLM 语义理解 + 融合               │
│ 输入：色块树 + 用户文本                    │
│ 输出：修改后的语义元素树                    │
└────────────────┬────────────────────────┘
                 ▼
┌─────────────────────────────────────────┐
│ Phase 3: 描述符生成                        │
│ 基于色块树空间结构 + 新参数                 │
└────────────────┬────────────────────────┘
                 ▼
┌─────────────────────────────────────────┐
│ GPU 渲染                                  │
└─────────────────────────────────────────┘
```

### 21.10 产品定位确认

```
Phase 1 = 图片 → LLM 能理解的结构
Phase 2 = 用户文本 + 结构 → 新描述符
Phase 3 = 交互式编辑（可选）
```

**Phase 1 的目标不是"做用户编辑器"，而是"做 LLM 的图像理解接口"。**

### 21.11 关键风险与应对

| 风险 | 问题 | 应对 |
|------|------|------|
| LLM 能否理解色块树 | 色块树是纯空间+颜色，没有语义 | Prompt 中加入语义映射层，引导 LLM 推断 |
| Phase 2 修改边界 | 用户说"画个星空"，是保留构图还是自由创作 | Prompt 中加入场景分类：修改/重画/风格迁移 |
| 色块树 token 成本 | 200~800 个色块的文本描述 | 128K 上下文下完全可接受，无需担心 |
| 噪声图导致色块爆炸 | Sobel 对噪声敏感，生成上千个色块 | Box blur ×3 + 噪声估计 + 自适应阈值 |
| 微小物体丢失 | 2-3 像素星星被忽略 | 局部最大值检测 + 强制细分 |

### 21.12 实操建议

**立刻做：**
1. 实现 Phase 1 核心算法（四象限递归细分 + Sobel + 积分图 + 自适应阈值）
2. 定义色块树输出格式（JSON schema）
3. 写示例 prompt，测试 LLM 是否能理解色块树

**短期内做：**
4. 定义 Phase 2 的 LLM 接口（输入输出格式）
5. 做 3~5 个测试用例（星空、人像、风景、抽象画、渐变）
6. 评估 LLM 理解准确率

**中期考虑：**
7. 如果 LLM 理解准确率 < 80%，加入"语义映射层"
8. 如果用户反馈"改的不对"，加入"交互式校正"（Phase 3）

## 二十二、未实现接口与 TODO

本章节汇总文档中引用的但尚未定义的函数、类型、常量，作为实现阶段的 TODO 清单。

### 22.1 全局常量

| 名称 | 位置 | 说明 | 建议值/方向 |
|------|------|------|-------------|
| `VARIANCE_THRESHOLD` | 21.3 | 旧版固定方差阈值 | 已被 21.9.3 自适应阈值替代，可删除 |
| `EDGE_THRESHOLD` | 21.9.3 | 旧版固定边缘阈值 | 已被 21.9.3 自适应阈值替代，可删除 |

### 22.2 工具函数

| 名称 | 位置 | 说明 | 实现方向 |
|------|------|------|----------|
| `generateId()` | 21.3 | 为色块生成唯一 ID | 用 `crypto.randomUUID()` 或递增计数器 |
| `resizeImage()` | 21.9.3.7 | 图像缩放（4K→1080p） | 可用 Canvas 2D `drawImage` 或 OffscreenCanvas |
| `downsample()` | 21.9.3.3 | 下采样函数 | 与 `resizeImage` 合并，或实现最近邻/双线性 |
| `callLLM()` | 21.5 | LLM API 调用封装 | 封装 OpenAI/Claude API，支持流式、重试、temperature |
| `encodeFromSemantic()` | 21.6 | 语义元素转描述符 | 根据 element.type 调用对应 encode 函数 |
| `findBlockByDescription()` | 21.6 | 按自然语言描述查找色块 | 方案 A：LLM 匹配；方案 B：关键词+颜色相似度 |

### 22.3 类型定义

| 名称 | 位置 | 说明 | 实现方向 |
|------|------|------|----------|
| `SemanticElement` | 21.5 | LLM 输出的语义元素类型 | 定义 JSON schema，包含 type/params/layer/blend |
| `LLMOutput` | 21.6 | LLM 返回的完整输出结构 | 包含 scene/style/elements/dominantColors |
| `CompilerResult` | 21.6 | 编译器最终输出 | 包含 descriptors/schemeMap/regions |
| `CompilerOptions` | 18.4 | 编译选项 | 包含 resolution/profile/seed/time |
| `EncodeContext` | 18.4 | 编码上下文 | 包含 width/height/semanticTree/regionTable |
| `DecodedDescriptor` | 12.3 | 解码后的描述符 | 包含 opcode/params |
| `RegionInfo` | 20.2 | GPU 端区域信息 | 包含 x/y/width/height/type/opacity |
| `BitField` | 12.2 | 位域定义 | 包含 name/offset/bits/type |

### 22.4 类/组件方法

| 名称 | 位置 | 说明 | 实现方向 |
|------|------|------|----------|
| `ColorBlockTree.toLLMView()` | 21.9.2 | 生成 LLM 可读的文本描述 | 递归遍历树，输出树形文本 |
| `ColorBlockTree.toUserView()` | 21.9.2 | 提取指定深度的色块 | 递归到目标深度，收集叶子节点 |
| `describeBlockTree()` | 21.5 | 递归描述色块树 | 输出带缩进的文本树 |
| `extractBlocksAtDepth()` | 21.9.2 | 提取指定深度色块 | BFS 到目标深度 |
| `mergeTiles()` | 20.1 | 合并 Worker 结果 | 按 tile 位置拼回完整描述符数组 |
| `dispatchToWorker()` | 20.1 | 分发任务到 Worker | 使用 `worker.postMessage` + Transferable |
| `getSwirlRegion()` | 19.4 | 获取漩涡影响区域 | 根据 swirl 中心/半径计算矩形区域 |
| `updateTimeParam()` | 19.4 | 更新时间参数 | 根据时间 t 插值参数 |
| `encodeDescriptor()` | 20.1 | 编码单个像素描述符 | 根据 region 类型选择 encode 函数 |
| `findRegion()` | 20.1 | 查找像素所属区域 | 遍历 regionTable，点-in-矩形测试 |
| `clone()` | 19.2 | 深拷贝 CompilerResult | 拷贝 descriptors/schemeMap/regions |
| `lerpDescriptor()` | 19.2 | 描述符线性插值 | 对数值参数做 lerp，opcode 保持不变 |
| `analyzeSpatialRelations()` | 21.4 | 分析色块空间关系 | 实现 contains/below/right_of/adjacent |

### 22.5 接口契约

| 名称 | 位置 | 说明 | 契约 |
|------|------|------|------|
| `IEncoder.encode()` | 18.4 | 编码一批像素 | 输入 EncodeContext，写入内部 buffer |
| `IEncoder.getBuffer()` | 18.4 | 获取编码后的 buffer | 返回 ArrayBuffer，可Transferable |
| `IRenderer.render()` | 18.4 | 渲染一帧 | 输入 CompilerResult，异步执行 |
| `IRenderer.switchProfile()` | 18.4 | 切换描述符 profile | 零编译成本（已预编译） |
| `IShaderManager.init()` | 18.4 | 初始化所有 pipeline | 异步，后台编译 |
| `IShaderManager.getPipeline()` | 18.4 | 获取指定 profile pipeline | 同步返回，必须已初始化 |

### 22.6 实现优先级建议

| 优先级 | 接口 | 原因 |
|--------|------|------|
| P0 | `generateId()` | 21.3 原型必需 |
| P0 | `resizeImage()` / `downsample()` | 21.9.3 预处理必需 |
| P0 | `IEncoder` 接口 + 64-bit 实现 | 12.x 核心编码 |
| P1 | `callLLM()` | 21.5 语义理解必需 |
| P1 | `ColorBlockTree.toLLMView()` | 21.9.2 序列化必需 |
| P1 | `describeBlockTree()` | 21.5 prompt 生成必需 |
| P2 | `findBlockByDescription()` | 21.6 实现复杂，可先用坐标匹配 |
| P2 | `extractBlocksAtDepth()` | Phase 3 交互式编辑才需要 |
| P3 | `mergeTiles()` | 20.1 并行化优化，初期可单线程 |
| P3 | `dispatchToWorker()` | 20.1 并行化优化，初期可单线程 |

## 二十三、World Description Language（WDL）

### 23.1 系统定位

World Description Language（以下简称WDL）是PixelForge的核心中间层。

它的目标：

> 将人类自然语言产生的创作意图，转换为一种机器可理解、可编辑、可编译、可渲染的世界描述格式。

---

传统流程：

```
用户

↓

3D建模软件

↓

模型文件

↓

渲染器

↓

GPU

```

问题：

用户必须理解：

* 模型
* 材质
* 灯光
* 摄像机
* 动画

---

PixelForge流程：

```
用户

↓

自然语言

↓

AI理解

↓

WDL

↓

World Compiler

↓

GPU

```

---

WDL不是：

* 图片描述
* 提示词
* JSON参数集合

---

WDL本质：

> 描述一个可以被计算机理解的世界。

---

### 23.2 WDL设计目标

WDL必须满足：

---

#### 23.2.1 人类可理解

设计者可以查看：

知道世界是什么。

---

例如：

```
TREE_001

位置：

房子后方5米

年龄：

80年

状态：

秋季

```

---

#### 23.2.2 AI可生成

LLM可以稳定输出。

---

#### 23.2.3 程序可解析

Rust可以读取。

---

#### 23.2.4 可修改

用户修改：

不是重新生成。

---

例如：

改变树。

不是：

重新生成整个森林。

---

#### 23.2.5 可编译

最终转换：

GPU指令。

---

### 23.3 WDL整体结构

一个完整世界：

```
WORLD

|

├── Environment

|

├── Space

|

├── Entities

|

├── Relations

|

├── Camera

|

├── Timeline

|

├── Rules

|

└── Render Settings

```

---

### 23.4 WORLD层

最高级节点。

定义：

整个世界。

示例：

```
WORLD {

name:
"Rainy Tokyo"

genre:
"Cinematic"

scale:
"city"

}

```

---

包含：

* 世界名称
* 世界类型
* 世界尺度
* 时间范围
* 风格

---

### 23.5 Environment环境系统

描述：

世界整体环境。

包括：

* 天气
* 时间
* 气候
* 空气

---

示例：

```
ENVIRONMENT {


time:

22:00


weather:

rain


temperature:

8


humidity:

0.8


fog:

medium


}

```

---

#### 23.5.1 天气不是图片效果

错误：

```
增加雨滴图片

```

---

正确：

```
Weather State


↓

Particle System


↓

Lighting Change


↓

Surface Wetness

```

---

雨影响：

* 地面反射
* 材质
* 光照
* 声音
* 人物动作

---

### 23.6 Space空间系统

解决：

> 东西在哪里？

---

空间采用：

三维坐标。

```
X

左右


Y

高度


Z

前后

```

---

例如：

```
TREE001


position:

{

x:10,

y:0,

z:20

}

```

---

### 23.7 坐标系统扩展

单纯坐标不够。

增加：

语义位置。

---

例如：

用户：

> 房子后面的树

AI转换：

```
POSITION:


relation:

behind


target:

HOUSE001


distance:

5m

```

---

然后Compiler计算：

实际坐标。

---

### 23.8 Entity实体系统

世界中的一切：

都是Entity。

---

包括：

* 房子
* 人
* 树
* 汽车
* 灯
* 云

---

结构：

```
ENTITY {


id:

TREE001


type:

tree


genome:

OakTree


}

```

---

### 23.9 Entity ID系统

每个对象必须唯一。

---

原因：

AI修改需要定位。

---

例如：

用户：

> 删除那棵树。

系统不能依赖视觉。

需要：

```
TREE001

```

---

### 23.10 Entity Type类型

基础分类：

```
Nature

Architecture

Character

Vehicle

Object

Effect

Light

Camera

```

---

### 23.11 Entity Genome基因引用

对象不是固定模型。

而是：

基因。

---

例如：

```
ENTITY


type:

Tree


Genome:

Oak_Adult_01


```

---

Genome负责：

生成：

* 外观
* 结构
* 行为

---

### 23.12 Transform系统

每个对象：

拥有：

```
Position

Rotation

Scale

```

---

例如：

```
TREE001


Position:

(10,0,5)


Rotation:

30°


Scale:

1.2

```

---

### 23.13 Relation关系系统

这是PixelForge核心。

因为世界不是列表。

而是关系。

---

传统：

```
Tree

House

```

---

PixelForge：

```
House

 |

behind

 |

Tree

```

---

### 23.14 Relation类型

基础关系：

---

#### 空间关系

```
near

far

behind

front

inside

above

below

```

---

#### 所属关系

```
part_of

belongs_to

```

---

#### 逻辑关系

```
causes

affects

depends_on

```

---

### 23.15 示例：删除房子后面的树

用户：

> 删除房子后面的树。

---

AI解析：

目标：

删除。

对象：

Tree。

关系：

behind。

参考：

House。

---

WDL：

```
OPERATION {


action:

DELETE


target_type:

Tree


relation:

behind


reference:

House001


}

```

---

系统查询：

```
House001

↓

behind

↓

Tree001

```

---

找到：

Tree001。

---

### 23.16 Operation操作系统

WDL不仅描述。

还执行操作。

---

基本操作：

```
CREATE

DELETE

UPDATE

MOVE

COPY

MUTATE

```

---

### 23.17 CREATE

创建对象。

例如：

```
CREATE TREE


Genome:

Oak


Position:

Garden

```

---

### 23.18 DELETE

删除。

但是：

必须经过检查。

---

流程：

```
AI


↓

Operation


↓

Dependency Check


↓

User Confirm


↓

Execute

```

---

### 23.19 UPDATE

修改属性。

例如：

```
UPDATE TREE001


color:

dark


age:

100

```

---

### 23.20 MUTATE

基因变化。

例如：

```
MUTATE CAR001


style:

futuristic

```

---

不是替换模型。

而是：

修改基因。

---

### 23.21 Camera描述

摄像机也是Entity。

---

结构：

```
CAMERA {


position


lens


focus


movement


}

```

---

例如：

电影镜头：

```
Camera:

35mm


Movement:

slow_push


Focus:

Character001

```

---

### 23.22 Timeline描述

时间属于世界。

---

结构：

```
TIMELINE {


EVENT


time:

10s


action:

rain_start


}

```

---

例如：

```
0s

sunny


10s

rain


20s

storm

```

---

### 23.23 Render描述

控制最终视觉。

---

包括：

```
Style

Quality

Lighting

PostProcess

```

---

例如：

```
STYLE:


cinematic


COLOR:


cold


QUALITY:


4K

```

---

### 23.24 WDL完整示例

用户：

> 一个雨夜东京街道，一个女孩站在路灯下，远处有汽车经过。

AI生成：

```
WORLD

name:

Tokyo Night


ENVIRONMENT

{

time:

23:00


weather:

rain

}



ENTITY


ROAD001


type:

road



ENTITY


LAMP001


type:

street_light



ENTITY


PERSON001


type:

character


position:

near LAMP001


appearance:

female


clothing:

black coat




ENTITY


CAR001


type:

vehicle


movement:

passing



RELATION


PERSON001

near

LAMP001



CAMERA


lens:

35mm


focus:

PERSON001


```

---

### 23.25 WDL与GPU关系

重要：

WDL不会直接控制GPU。

中间还有：

World Compiler。

---

流程：

```
WDL

↓

Parser

↓

Scene Graph

↓

Render Graph

↓

GPU Commands

```

---

### 23.26 为什么需要WDL？

因为：

图片没有结构。

例如：

一张房子图片。

AI知道：

看起来像房子。

但是不知道：

* 门在哪里
* 墙在哪里
* 删除哪部分
* 修改哪部分

---

WDL保存：

世界结构。

---

### 23.27 WDL最终目标

未来：

用户不操作：

模型。

用户操作：

世界。

---

传统：

```
Move Object

```

PixelForge：

```
Move the house closer to the lake.

```

---

传统：

```
Change texture

```

PixelForge：

```
Make the wall look 200 years old.

```

---

### 23.28 Chapter 20总结

WDL解决：

✅ 自然语言结构化
✅ 世界可编辑
✅ AI可理解
✅ 对象可定位
✅ 修改可追踪
✅ GPU可编译

---

下一章：

## 二十四、Scene Graph（场景关系图完整规范）

### 24.1 系统定位

Scene Graph是PixelForge中承接：

> World Description Language（WDL）

到：

> Render Compiler（渲染编译器）

之间的核心数据结构。

---

简单理解：

WDL负责：

> 描述世界。

Scene Graph负责：

> 保存世界。

---

关系：

```text
用户语言

↓

AI理解

↓

WDL

↓

Scene Graph

↓

World Compiler

↓

GPU

```

---

### 24.2 为什么需要Scene Graph？

因为现实世界不是：

一堆图片。

现实世界是：

大量对象 + 对象之间关系。

---

例如：

用户说：

> 删除房子后面的树。

如果只有图片：

AI看到：

```
房子
树
天空
```

但是不知道：

哪个树？

为什么？

---

如果有Scene Graph：

```
World

 |

 ├── House001

 |

 ├── Garden001

 |

 └── Tree001


Relationship:

Tree001

↓

behind

↓

House001

```

---

系统可以准确定位。

---

### 24.3 Scene Graph核心理念

## 传统3D引擎

Scene Graph：

主要为了：

渲染。

例如：

Unity：

```
Scene

↓

GameObject

↓

Transform

↓

Mesh

```

---

PixelForge：

Scene Graph：

不仅为了渲染。

还为了：

AI理解。

---

所以：

PixelForge Scene Graph =

```
空间结构

+

语义结构

+

关系结构

+

行为结构

```

---

### 24.4 Scene Graph总体结构

完整结构：

```
SCENE GRAPH


World Root


|

├── Spatial Tree

|

├── Semantic Tree

|

├── Relation Graph

|

├── Dependency Graph

|

├── Timeline Graph

|

└── Render Graph

```

---

### 24.5 Spatial Tree（空间树）

负责：

> 东西在哪里。

---

类似：

文件夹。

例如：

一个城市：

```
World


└── Tokyo


    └── Shinjuku


        └── Street001


            ├── Building001

            ├── Tree001

            └── Car001

```

---

空间层级：

帮助：

快速查询。

---

### 24.6 Semantic Tree（语义树）

负责：

> 这是什么。

---

例如：

空间：

```
Building001

```

但是语义：

```
Architecture

↓

Building

↓

House

↓

Residential House

```

---

为什么需要？

因为AI需要理解。

---

例如：

用户：

> 删除建筑。

系统搜索：

不是搜索：

Building001。

而搜索：

所有：

Type=Architecture。

---

### 24.7 Relation Graph（关系图）

这是最重要部分。

因为：

现实世界核心不是层级。

而是关系。

---

例如：

树和房子：

可能：

空间：

```
World

 ├ House

 └ Tree

```

---

但是关系：

```
Tree

behind

House

```

---

关系独立存在。

---

### 24.8 为什么不能只用父子结构？

错误：

```
House

 └ Tree

```

表示：

树属于房子。

错误。

---

真实：

```
House

Tree

```

两个独立对象。

关系：

```
Tree

behind

House

```

---

所以：

Scene Graph必须：

树结构 + 图结构结合。

---

### 24.9 Entity Node（实体节点）

每一个世界对象：

都是Node。

---

结构：

```json
{

id:

"Tree001",


type:

"Tree",


position:

{

x:10,

y:0,

z:5

},


genome:

"Oak_50"


}

```

---

### 24.10 Node基本属性

每个Node拥有：

## Identity

身份。

例如：

```
Tree001
```

---

## Type

类型。

例如：

```
Tree

```

---

## Transform

位置。

---

## Genome

生成规则。

---

## State

当前状态。

---

## Relations

关系。

---

### 24.11 Transform系统

所有空间对象：

必须拥有：

```
Position

Rotation

Scale

```

---

例如：

```json
{

position:

[10,0,5],


rotation:

[0,90,0],


scale:

1.2

}

```

---

### 24.12 四象限空间定位系统（核心）

这里结合你的想法。

传统坐标：

只知道：

XYZ。

但是AI理解困难。

---

增加：

Semantic Quadrant。

---

### 24.13 什么是四象限？

以目标对象作为中心。

例如：

房子。

建立局部空间。

```

          FRONT


            ↑


LEFT ← HOUSE → RIGHT


            ↓


          BACK


```

---

四个方向：

Front

Back

Left

Right

---

### 24.14 为什么需要四象限？

因为自然语言：

大量使用：

相对位置。

例如：

用户：

> 房子后面的树。

不是：

坐标。

---

系统转换：

```
Reference:

House001


Relation:

Behind


Search Area:

Back Quadrant

```

---

### 24.15 四象限查询流程

用户：

删除房子后面的树。

---

步骤1：

识别：

目标：

House。

---

步骤2：

建立：

House局部坐标。

---

步骤3：

打开：

Back Quadrant。

---

步骤4：

搜索：

Tree。

---

步骤5：

排序。

---

### 24.16 多个树怎么办？

例如：

房子后面有：

10棵树。

怎么办？

---

需要：

评分系统。

---

### 24.17 Spatial Score（空间评分）

公式：

```
Score =

Distance

+

Direction

+

Semantic Match

+

Attention

```

---

例如：

Tree001：

距离：

5m

方向：

正后方

类型：

树

评分：

98

---

Tree002：

距离：

50m

方向：

偏后

评分：

40

---

选择：

Tree001。

---

### 24.18 AI删除保护机制

非常重要。

AI不能直接执行。

---

流程：

```
User Command


↓

AI Intent


↓

Scene Query


↓

Candidate List


↓

Risk Check


↓

Preview


↓

Confirm


↓

Execute

```

---

### 24.19 Candidate List候选列表

例如：

用户：

删除房子后面的树。

系统显示：

```
找到3棵树：

Tree001

距离5m

推荐删除


Tree002

距离20m


Tree003

距离40m

```

---

用户确认。

---

### 24.20 Dependency Graph（依赖图）

对象不是孤立。

---

例如：

删除树。

影响：

```
Tree

↓

Shadow

↓

Lighting

↓

Ground

```

---

所以：

删除之前：

检查影响。

---

### 24.21 Dependency类型

## Visual Dependency

视觉影响。

例如：

阴影。

---

## Physical Dependency

物理。

例如：

树支撑。

---

## Narrative Dependency

剧情。

例如：

电影角色靠树。

---

### 24.22 Object Lock机制

防止AI误修改。

---

例如：

用户：

保护主角。

设置：

```
Character001

LOCK

```

---

AI不能修改。

---

### 24.23 Scene Graph中的时间

对象不仅存在空间。

还存在时间。

---

例如：

树：

```
Year 0

Seed


Year 50

Tree


Year 100

Old Tree

```

---

加入：

Temporal Node。

---

### 24.24 Timeline Graph

结构：

```
Tree001


|

Growth Event


|

Year 50

```

---

### 24.25 Scene Graph和视频生成

视频不是：

连续图片。

---

而是：

世界状态变化。

---

例如：

第一秒：

```
Person Position:

A

```

---

第二秒：

```
Person Position:

B

```

---

系统生成：

中间运动。

---

### 24.26 Scene Graph和细节系统关系

Scene Graph决定：

有什么。

Detail System决定：

有多细。

---

例如：

Scene Graph：

```
Door001

```

---

Detail：

```
Wood Texture

Scratch

Dust

Paint Damage

```

---

### 24.27 Scene Graph和Asset Genome关系

Scene Graph：

引用资产。

---

例如：

```
Tree001


Genome:

OakTree

```

---

Genome：

负责生成。

---

Scene Graph：

负责放置。

---

### 24.28 Scene Graph和GPU关系

GPU不直接读取：

自然语言。

---

最终：

Scene Graph：

↓

Render Graph

↓

GPU。

---

例如：

Scene Graph：

```
Tree001

position:

10,0,5

Genome:

Oak

```

---

Compiler：

转换：

```
Mesh Buffer

Vertex Buffer

Material Buffer

Shader Parameter

```

---

GPU执行。

---

### 24.29 Scene Graph存储格式

建议：

内部：

Rust结构。

例如：

```rust
struct Entity {


id:String,


entity_type:EntityType,


transform:Transform,


genome:GenomeID,


relations:Vec<Relation>


}

```

---

保存：

```
.pfscene

```

---

### 24.30 Scene Graph修改案例

用户：

> 把房子旁边的大树变成枯树。

---

AI：

解析：

目标：

Tree

关系：

Near House

操作：

Mutate

---

查询：

```
House001

↓

Near

↓

Tree001

```

---

执行：

```
Genome:

Oak Healthy


↓

Oak Dead

```

---

结果：

重新生成：

树。

---

### 24.31 Scene Graph核心优势

## 1. 精确修改

不是改图片。

改对象。

---

## 2. 无限扩展

世界可以越来越大。

---

## 3. AI理解世界

因为有结构。

---

## 4. 支持视频

因为世界可以变化。

---

## 5. 支持局部重生成

只改目标。

---

### 24.32 Scene Graph最终架构

```
                 WORLD


                   |


              Scene Graph


                   |


 ------------------------------------------------


Spatial Tree

Semantic Tree

Relation Graph

Dependency Graph

Timeline Graph


 ------------------------------------------------


                   |


             World Compiler


                   |


                 GPU

```

---

### 24.33 Chapter 21总结

Scene Graph解决了PixelForge最关键的问题：

> AI如何知道“哪个东西在哪里，它是什么，以及它和其他东西有什么关系”。

---

完成后：

PixelForge具备：

✅ 对象级理解
✅ 空间理解
✅ 语义理解
✅ 四象限定位
✅ 精确修改
✅ 安全删除
✅ 局部生成
✅ 视频连续世界基础

## 二十五、Detail Generation System（细节生成系统完整规范）

### 25.1 系统定位

#### 25.1.1 为什么需要Detail Generation System？

PixelForge的核心目标：

> 让AI生成一个可编辑、可运行、可渲染的世界。

但是，一个巨大问题出现：

---

如果AI生成：

一座城市。

一个森林。

一个人物。

那么：

世界里面到底需要多少细节？

---

传统AI图片生成的问题：

它直接生成：

```text
1920 × 1080

2073600个像素

```

看起来：

很高清。

但是：

高清 ≠ 真实细节。

---

原因：

图片只是结果。

没有：

* 对象结构
* 空间关系
* 材质逻辑
* 微观信息

---

例如：

一张4K木门图片：

看起来有：

木纹。

但是：

你放大：

可能只是：

重复纹理。

---

真实世界：

木门包含：

```text
木材结构

↓

木纹方向

↓

纤维

↓

裂纹

↓

灰尘

↓

磨损

↓

油漆脱落

↓

微小光反射

```

---

所以PixelForge采用：

# 分层细节生成系统

Detail Generation System。

---

核心思想：

> 不生成所有细节，而根据观察需求动态生成细节。

---

### 25.2 Detail Generation核心原则

## 原则1：

世界不是图片。

世界是：

层级结构。

---

例如：

树。

不是：

一张树图片。

而是：

```text
Tree


|

├── Trunk

|

├── Branch

|

├── Leaf

|

├── Texture

|

├── Micro Detail

```

---

### 25.3 Detail Hierarchy（细节层级）

PixelForge定义：

7级细节系统。

---

# Level 0：World Detail（世界级）

最高层。

描述：

世界整体。

---

例如：

城市：

```text
Tokyo

Night

Rain

Neon

```

---

没有：

建筑纹理。

---

用途：

远距离。

---

# Level 1：Region Detail（区域级）

描述：

区域。

例如：

东京：

```text
Shinjuku

Commercial Area

```

---

包含：

* 建筑密度
* 道路结构
* 人流

---

# Level 2：Object Detail（对象级）

描述：

具体物体。

例如：

建筑。

```text
Building001


Type:

Office


Height:

30m

```

---

包含：

基本形态。

---

# Level 3：Structure Detail（结构级）

深入对象。

例如：

建筑：

```text
Building


|

├── Door

├── Window

├── Wall

└── Roof

```

---

# Level 4：Surface Detail（表面级）

材质。

例如：

墙：

```text
Paint

Dust

Crack

Reflection

```

---

# Level 5：Micro Detail（微观级）

毫米级。

例如：

木头：

```text
Fiber

Scratch

Pore

```

---

# Level 6：Physical Detail（物理级）

真实世界行为。

例如：

雨滴：

撞击：

木头。

产生：

湿润变化。

---

### 25.4 为什么不是无限细节？

你的问题：

> 细节总不能无限生成。

正确。

所以需要：

# Detail Budget（细节预算）

---

GPU能力有限。

每一帧：

拥有：

固定计算预算。

---

例如：

60FPS。

每帧：

16.6ms。

---

系统必须决定：

哪里值得计算。

---

### 25.5 Detail Importance（细节重要性计算）

每个对象：

计算：

Detail Score。

---

公式：

```
Detail Score =

Distance

+

Screen Size

+

User Attention

+

Semantic Importance

+

Motion Importance

+

Narrative Importance

```

---

### 25.6 Distance距离权重

最基础。

---

摄像机距离：

决定基础细节。

---

例如：

树：

距离：

500米。

只需要：

```text
颜色

轮廓

```

---

距离：

5米。

需要：

```text
树皮

树枝

叶子

```

---

距离：

10厘米。

需要：

```text
纹理

裂痕

细胞结构

```

---

### 25.7 Screen Size屏幕占比

距离不是唯一。

---

例如：

一个小物体：

距离远。

但是：

被镜头特写。

仍然需要细节。

---

计算：

对象占屏幕比例。

例如：

```text
Tree:

占画面70%

↓

High Detail


Tree:

占画面1%

↓

Low Detail

```

---

### 25.8 User Attention用户注意力

这是AI视频时代的重要因素。

---

例如：

两个对象：

A：

主角。

B：

背景树。

---

距离一样。

但是：

用户关注A。

---

A：

细节提升。

B：

降低。

---

如何判断？

来源：

* 镜头中心
* 用户点击
* 剧情
* AI理解

---

### 25.9 Narrative Importance剧情重要性

电影特别重要。

---

例如：

一个戒指。

普通：

小物件。

---

但是：

剧情：

“这是主角母亲留下的戒指。”

---

系统提升：

```text
Narrative Score ↑

```

---

自动生成：

* 划痕
* 历史痕迹
* 特殊纹理

---

### 25.10 Motion Importance运动重要性

动态对象：

需要更多。

---

例如：

汽车高速移动。

需要：

* 轮胎
* 运动模糊
* 反射变化

---

静止墙：

低。

---

### 25.11 四象限细节系统

结合你的核心思想。

---

不是：

全世界展开。

---

而是：

以观察中心递进。

---

例如：

摄像机看到：

房子。

---

第一层：

```text
Quadrant 0

整个房子

```

---

第二层：

```text
Quadrant 1

门

窗

屋顶

```

---

第三层：

```text
Quadrant 2

门把手

玻璃

木纹

```

---

第四层：

```text
Quadrant 3

划痕

灰尘

纤维

```

---

### 25.12 四象限递进结构

空间：

```text

                 Q1


        Q2       Q0       Q2


                 Q1


```

---

Q0：

主体。

---

Q1：

主要组成。

---

Q2：

局部结构。

---

Q3：

微观细节。

---

### 25.13 Detail Expansion（细节展开）

默认：

不展开。

---

流程：

```
Camera

↓

Detect Object

↓

Calculate Score

↓

Increase Detail Level

↓

Generate

```

---

### 25.14 AI如何判断哪里增加细节？

不是AI自己猜。

使用：

多因素系统。

---

输入：

```text
Camera

+

Scene Graph

+

User Intent

+

Timeline

+

Style

```

---

输出：

Detail Request。

---

例如：

用户：

> 镜头慢慢推进门。

系统：

```text
Door Importance:

HIGH


Generate:

Level 5 Detail

```

---

### 25.15 Detail Generator（细节生成器）

负责：

产生细节。

---

不是一个模型。

而是一套系统。

---

包括：

---

## Geometry Generator

生成：

几何。

例如：

裂缝。

---

## Material Generator

生成：

材质。

例如：

木纹。

---

## Texture Generator

生成：

纹理。

---

## Simulation Generator

生成：

变化。

---

### 25.16 Geometry Detail

例如：

石头。

Level 2：

```text
石头形状

```

---

Level 5：

增加：

```text
凹陷

裂缝

边缘

```

---

不是图片。

是真实结构。

---

### 25.17 Material Detail

真实感主要来自材质。

---

材质包含：

```text
Base Color

Roughness

Metallic

Normal

Height

```

---

例如：

旧木门。

不是：

贴旧图片。

而是：

```text
Wood Material


Age:

80 years


Moisture:

0.3


Damage:

0.6

```

---

Shader计算。

---

### 25.18 Texture Detail

纹理分层。

---

例如：

墙。

基础：

颜色。

↓

砖纹。

↓

裂纹。

↓

灰尘。

↓

污渍。

---

### 25.19 Procedural Detail（程序化细节）

非常重要。

不能全部靠AI生成。

---

例如：

树叶。

AI：

决定：

树种。

程序：

生成：

10000片叶子。

---

优势：

* 快
* 可控制
* 无限变化

---

### 25.20 AI + Procedural混合

最佳方案：

AI负责：

```text
理解

设计

规则

```

---

程序负责：

```text
生成

计算

重复结构

```

---

例如：

森林。

AI：

森林生态。

程序：

生成树。

---

### 25.21 Detail Cache（细节缓存）

避免重复生成。

---

例如：

门纹理。

第一次：

生成。

保存：

```text
Door_Texture_001

```

---

以后：

复用。

---

### 25.22 Detail Streaming（细节流）

类似游戏加载。

---

摄像机移动：

附近增加细节。

远处减少。

---

例如：

镜头推进。

系统：

提前预测。

---

### 25.23 Predictive Detail（预测细节）

AI预测：

下一秒看哪里。

---

例如：

镜头：

向门移动。

---

提前生成：

门把手细节。

---

避免：

突然出现。

---

### 25.24 Detail Consistency（细节一致性）

AI生成最大问题：

前后不一致。

---

例如：

第一帧：

门把手金色。

第二帧：

银色。

---

解决：

Scene Graph绑定。

---

对象：

拥有：

固定ID。

---

所有细节：

继承。

---

### 25.25 Detail Mutation（细节变异）

同类对象：

不能完全一样。

---

例如：

森林。

不能：

10000棵相同树。

---

Genome：

控制变化。

---

例如：

树：

```text
Height

Branch

Leaf

Age

Damage

```

随机变化。

---

### 25.26 无限细节的解决方案

核心：

不是无限生成。

而是：

无限规则。

---

例如：

一棵树。

不保存：

10万个叶子。

保存：

```text
Tree Genome

+

Growth Rule

+

Seed

```

---

需要时生成。

---

### 25.27 Detail系统和GPU关系

最终：

Detail System输出：

Render Data。

---

流程：

```text
Scene Graph


↓

Detail Manager


↓

Geometry


↓

Material


↓

Shader


↓

GPU

```

---

### 25.28 Detail System完整架构

```text
Camera


↓

Importance Analysis


↓

Detail Budget


↓

Detail Level Selection


↓

AI Generator


+

Procedural Generator


↓

Cache


↓

Render Pipeline


↓

GPU

```

---

### 25.29 与传统AI视频区别

传统：

Prompt

↓

Image

↓

Video

---

PixelForge：

```text
Prompt


↓

World


↓

Objects


↓

Relations


↓

Detail Rules


↓

Render


↓

Video

```

---

## 二十六、Asset Genome System（资产基因系统完整规范）

### 26.1 系统定位

#### 26.1.1 Asset Genome是什么？

Asset Genome（资产基因系统）是PixelForge中负责：

> 描述、生成、控制、变异世界对象的核心系统。

---

传统3D软件：

一个资产 = 一个模型文件。

例如：

```text
Car.fbx

Tree.obj

House.blend

```

---

问题：

模型只是结果。

它不知道：

* 为什么这样设计？
* 可以怎么修改？
* 可以生成多少变化？
* 属于什么类别？
* 如何适应不同世界？

---

PixelForge：

资产不是模型。

资产是：

# Genome（基因）

---

例如：

传统：

```text
一辆车

=
一个模型

```

---

PixelForge：

```text
一辆车

=

车辆基因

+

结构规则

+

材质规则

+

行为规则

+

变化范围

+

生成方式

```

---

### 26.2 Asset Genome设计目标

Asset Genome必须解决：

---

#### 26.2.1 可复用

同一个资产：

可以进入：

不同世界。

---

例如：

同一棵树基因：

可以生成：

* 森林树
* 城市树
* 庭院树

---

#### 26.2.2 可变化

不能每次一样。

---

例如：

生成汽车。

不能：

100辆完全相同。

---

需要：

基因变异。

---

#### 26.2.3 可控制

不能随机失控。

---

例如：

汽车：

允许：

* 颜色变化
* 灯变化

不允许：

* 四个轮子变成三个
* 车身违反物理

---

#### 26.2.4 可理解

AI必须知道：

它是什么。

---

例如：

AI看到：

Tree Genome。

知道：

这是树。

不是：

一堆绿色像素。

---

### 26.3 Asset Genome整体结构

完整资产：

```text
Asset Genome


|

├── Identity Gene

|

├── Structure Gene

|

├── Appearance Gene

|

├── Material Gene

|

├── Behavior Gene

|

├── Environment Gene

|

├── Mutation Gene

|

├── Constraint Gene

|

└── Generation Rule

```

---

### 26.4 Identity Gene（身份基因）

定义：

“它是谁”。

---

例如：

汽车：

```json
{

type:

"Vehicle",


category:

"Sports Car",


era:

"2035",


style:

"Cyberpunk"

}

```

---

作用：

让AI理解。

---

用户：

> 一辆未来跑车。

AI查询：

```text
Vehicle

↓

Sports Car

↓

Future Style

```

---

### 26.5 Category Hierarchy（分类系统）

资产必须拥有层级。

例如：

汽车：

```text
Object


↓

Vehicle


↓

Car


↓

Sports Car


↓

Electric Sports Car

```

---

树：

```text
Nature


↓

Plant


↓

Tree


↓

Oak


↓

Ancient Oak

```

---

这样：

AI可以泛化。

---

### 26.6 Structure Gene（结构基因）

描述：

资产由什么组成。

---

例如：

汽车：

```text
Car Genome


|

├── Body

├── Wheel

├── Window

├── Engine

├── Interior

└── Light

```

---

房子：

```text
House


|

├── Foundation

├── Wall

├── Door

├── Window

├── Roof

└── Furniture

```

---

### 26.7 为什么结构基因重要？

因为修改必须针对部分。

---

用户：

> 把房子的门换成木门。

---

系统不能：

重新生成房子。

---

需要：

找到：

```text
House001

↓

Door Component

↓

Replace Genome

```

---

### 26.8 Appearance Gene（外观基因）

定义：

视觉表现。

包括：

---

## Shape

形状。

---

例如：

汽车：

```text
low

wide

aggressive

```

---

## Proportion

比例。

例如：

```text
long hood

small cabin

```

---

## Style

风格。

例如：

```text
minimal

luxury

industrial

```

---

### 26.9 Material Gene（材质基因）

真实感核心。

---

材质不是图片。

而是：

参数。

---

例如：

木材：

```json
{

material:

"Oak Wood",


roughness:

0.8,


grain:

"straight",


age:

50

}

```

---

GPU根据：

材质参数。

生成视觉。

---

### 26.10 Material Layer（材质层）

真实物体：

不是单层。

---

例如：

墙。

结构：

```text
Wall Material


|

├── Base Paint

|

├── Dust

|

├── Moisture

|

├── Crack

|

└── Dirt

```

---

### 26.11 Behavior Gene（行为基因）

定义：

对象如何变化。

---

例如：

树：

```text
Tree Behavior


|

├── Growth

├── Wind Response

├── Seasonal Change

└── Damage

```

---

汽车：

```text
Vehicle Behavior


|

├── Drive

├── Brake

├── Damage

└── Maintenance

```

---

### 26.12 Environment Adaptation Gene（环境适应基因）

非常重要。

同一个资产：

进入不同世界。

需要变化。

---

例如：

树。

森林：

```text
dense

healthy

large

```

---

城市：

```text
trimmed

small

polluted

```

---

基因：

不变。

环境：

改变表现。

---

### 26.13 Mutation Gene（变异基因）

这是核心。

解决：

> 为什么生成的东西不会完全一样？

---

Mutation Gene定义：

允许变化范围。

---

例如：

汽车：

```json
{

color:

{

range:

wide

},


wheel:

{

range:

medium

},


engine:

{

range:

limited

}

}

```

---

### 26.14 Mutation Layer（变异层级）

分三层。

---

# Level 1：Safe Mutation（安全变异）

不会破坏身份。

---

例如：

汽车：

* 颜色
* 轮毂
* 灯光

---

# Level 2：Creative Mutation（创造变异）

改变设计。

---

例如：

* 车身比例
* 内饰
* 结构

---

# Level 3：Experimental Mutation（实验变异）

可能改变类别。

---

例如：

汽车：

↓

飞行汽车。

---

需要确认。

---

### 26.15 Mutation Seed（随机种子）

关键。

---

如果完全随机：

无法复现。

---

所以：

每个生成：

拥有Seed。

---

例如：

```text
Car001

Seed:

938271

```

---

以后：

重新打开。

仍然一样。

---

### 26.16 Genome + Seed生成机制

流程：

```text
Genome


+

Seed


↓

Generator


↓

Asset

```

---

例如：

同一个汽车基因。

不同Seed：

生成：

不同车型。

---

### 26.17 Constraint Gene（约束基因）

防止错误生成。

---

例如：

人体。

约束：

```text
Head:

1

Arm:

2

Leg:

2

```

---

汽车：

```text
Wheel:

>=4

```

---

建筑：

```text
Foundation Required

```

---

### 26.18 Physical Constraint（物理约束）

非常重要。

---

例如：

房子：

不能：

悬空。

---

系统检查：

```text
Weight

Support

Gravity

Material Strength

```

---

### 26.19 Style Genome（风格基因）

风格不能只是颜色。

---

例如：

赛博朋克。

包含：

```text
Lighting

Material

Shape

Color

Technology Level

```

---

所以：

风格也是基因。

---

### 26.20 Style Inheritance（风格继承）

例如：

父：

未来科技。

---

子：

未来住宅。

继承：

```text
Technology

+

Material

+

Lighting

```

---

但是增加：

Residential。

---

### 26.21 Genome Combination（基因融合）

创造新资产。

---

例如：

用户：

> 一个像植物一样生长的建筑。

---

系统：

组合：

```text
Architecture Genome


+

Plant Genome


+

Organic Style Genome

```

---

生成：

植物建筑。

---

### 26.22 Genome Compatibility（基因兼容）

不是所有基因都能组合。

---

例如：

鱼：

*

汽车。

可以。

形成：

水陆车。

---

但是：

鱼：

*

砖墙。

意义弱。

---

需要：

Compatibility Score。

---

### 26.23 Genome Evolution（基因进化）

资产可以长期变化。

---

例如：

一个村庄。

100年后：

房屋：

老化。

道路：

变化。

植物：

生长。

---

不是重新生成。

而是：

Genome Evolution。

---

### 26.24 Evolution Rules（进化规则）

例如：

树：

```text
Age +10

↓

Height +20%

↓

Branch Increase

↓

Color Change

```

---

### 26.25 Asset State（资产状态）

基因决定：

可能性。

状态决定：

当前表现。

---

例如：

同一棵树：

Genome：

Oak Tree。State：

```text
Age:

80


Health:

0.5


Season:

Winter

```

---

显示：

老树。

---

### 26.26 Asset Instance（资产实例）

一个基因：

可以生成多个实例。

---

例如：

```text
Tree Genome


↓

Tree001

Tree002

Tree003

```

---

每个：

拥有不同状态。

---

### 26.27 Genome与Scene Graph关系

非常重要。

关系：

```text
Scene Graph

负责:

在哪里


Asset Genome

负责:

是什么

```

---

例如：

Scene：

```text
Tree001

Position:

(10,0,5)

```

---

Genome：

```text
Oak Tree

Age 50

```

---

组合：

世界中的树。

---

### 26.28 Genome与Detail System关系

Genome决定：

细节规则。

---

例如：

树：

Genome：

Oak。

---

Detail：

生成：

* 树皮
* 叶子
* 裂纹

---

### 26.29 Genome与World Compiler关系

流程：

```text
Genome


↓

Generator


↓

Geometry


↓

Material


↓

Shader


↓

GPU

```

---

### 26.30 Asset Generation完整流程

用户：

> 创建一辆未来跑车。

---

步骤：

---

## Step 1

AI理解。

```text
Vehicle

Future

Sports

```

---

## Step 2

选择基础Genome。

```text
Future_Sports_Car

```

---

## Step 3

Mutation。

生成：

```text
Shape Variant

Color Variant

Interior Variant

```

---

## Step 4

Constraint检查。

---

## Step 5

生成实例。

---

## Step 6

进入Scene Graph。

---

## Step 7

Render。

---

### 26.31 Asset Genome存储格式

示例：

```json
{

id:

"Car_Genome_001",


identity:

{

type:"vehicle",

class:"sports"

},


structure:

{

body:true,

wheel:true

},


mutation:

{

color:1,

shape:0.5

},


constraints:

{

wheel:4

}

}

```

---

### 26.32 为什么Asset Genome比模型更重要？

模型：

告诉GPU：

怎么画。

---

Genome：

告诉系统：

它是什么。

---

未来AI时代：

理解比绘制重要。

---

### 26.33 Asset Genome系统最终架构

```text
                User


                 ↓


              Prompt


                 ↓


          Asset Genome AI


                 ↓


          Genome Database


                 ↓


      Mutation + Constraint


                 ↓


            Instance


                 ↓


          Scene Graph


                 ↓


            Renderer


                 ↓


              GPU

```

---

### 26.34 Chapter 23总结

Asset Genome解决：

✅ 资产理解
✅ 资产复用
✅ 无限变化
✅ 风格统一
✅ 可编辑
✅ 可进化
✅ AI可控制
✅ 避免重复生成

---

# 当前PixelForge核心链路：

```text
自然语言

↓

WDL

↓

Scene Graph

↓

Asset Genome

↓

Detail Generation

↓

Timeline

↓

World Compiler

↓

WebGPU

↓

GPU

↓

Video

```

---

### 25.30 Chapter 22总结

Detail Generation System解决：

✅ 为什么4K没有真实细节
✅ 如何决定哪里需要细节
✅ 如何避免无限生成
✅ 如何动态增加细节
✅ 如何保持视频连续性
✅ 如何结合AI和程序生成
✅ 如何实现电影级镜头推进

---

## 二十七、World Compiler（世界编译器完整规范）

版本：1.0

---

# 1. 系统定位

## 1.1 什么是World Compiler？

World Compiler（世界编译器）是PixelForge整个系统中最关键的转换层。

它负责解决最初提出的核心问题：

> 人类自然语言，如何最终变成GPU可以执行的计算指令？

---

完整流程：

```text
用户语言

↓

LLM理解

↓

World Description Language (WDL)

↓

Scene Graph

↓

Asset Genome

↓

Detail System

↓

World Compiler

↓

WebGPU

↓

GPU

↓

视频帧

```

---

# 2. 为什么需要World Compiler？

传统3D流程：

```text
艺术家

↓

模型

↓

材质

↓

动画

↓

渲染器

↓

GPU

```

---

问题：

每一步都是人工完成。

---

AI时代：

用户：

> 一个雨夜城市，一个女孩走过霓虹街道。

AI产生：

```text
World

Character

Building

Rain

Camera

Lighting

```

---

但是GPU不知道：

"女孩"、"雨夜"、"城市"是什么意思。

GPU只认识：

* Vertex Buffer
* Index Buffer
* Texture
* Shader
* Compute Command

---

所以必须存在：

翻译层。

这个翻译层：

就是World Compiler。

---

# 3. World Compiler核心理念

不是：

把文字翻译成代码。

---

而是：

把：

# 世界语义

转换成：

# 可计算世界

---

例如：

WDL：

```text
Tree001

Type:

Oak Tree


Position:

Behind House


Age:

80


Season:

Autumn

```

---

Compiler：

理解：

需要：

* 一个树结构
* 一个材质
* 一组叶子
* 一个位置
* 一个动画规则

---

输出：

GPU数据。

---

# 4. World Compiler总体架构

```text
                 WDL


                  ↓


              WDL Parser


                  ↓


              World IR


                  ↓


        Scene Optimization


                  ↓


            Render Graph


                  ↓


        Resource Compiler


                  ↓


          WebGPU Backend


                  ↓


                 GPU

```

---

# 5. WDL Parser（世界解析器）

## 5.1 作用

读取：

World Description Language。

转换：

机器结构。

---

例如：

输入：

```text
CREATE TREE

TYPE:

OAK

POSITION:

HOUSE BACK

```

---

输出：

```json
{
object:"Tree",
type:"Oak",
relation:"Behind",
target:"House"
}

```

---

# 6. Parser不是简单读取文字

它需要：

语义理解。

---

例如：

用户：

> 房子后面的树删除。

不是：

字符串：

"树"。

---

解析：

```text
Action:

DELETE


Target:

Tree


Reference:

House


Relation:

Behind

```

---

# 7. WDL Syntax Tree（语法树）

Parser产生：

AST。

---

结构：

```text
Operation


|

DELETE


|

Object


|

Tree


|

Relation


|

Behind House

```

---

类似：

编程语言解析。

---

# 8. World Intermediate Representation（WIR）

## 世界中间表示

这是整个系统的重要部分。

---

为什么需要WIR？

因为：

WDL太高级。

GPU太底层。

需要中间层。

---

类似：

编程语言：

```text
Python

↓

LLVM IR

↓

Machine Code

```

---

PixelForge：

```text
WDL

↓

WIR

↓

GPU

```

---

# 9. WIR定义

WIR描述：

一个可计算世界。

---

例如：

WDL：

```text
Create Tree

```

---

WIR：

```json
{
entity:"Tree001",

geometry:"OakGenerator",

material:"AutumnLeaf",

transform:[10,0,5],

behavior:"WindResponse"

}

```

---

# 10. WIR核心结构

```text
World IR


|

├── Entity Data

|

├── Geometry Data

|

├── Material Data

|

├── Animation Data

|

├── Lighting Data

|

├── Camera Data

|

└── Compute Data

```

---

# 11. Entity Compilation（实体编译）

Scene Graph中的对象：

转换为：

GPU可理解对象。

---

例如：

Scene Graph：

```text
Tree001

Genome:

Oak

Position:

10,0,5

```

---

Compiler：

生成：

```text
Mesh

Transform

Material

Shader

Instance Data

```

---

# 12. Geometry Compiler（几何编译）

负责：

生成形状。

---

来源：

Asset Genome。

---

例如：

Tree Genome：

```text
Oak Tree

Age:

50

```

---

Geometry Compiler：

生成：

```text
Trunk Mesh

Branch Mesh

Leaf Instances

```

---

# 13. 程序化几何生成

不是所有东西保存模型。

---

例如：

森林。

保存：

```text
Tree Genome

+

Seed

```

---

运行时：

生成：

10000棵树。

---

优势：

文件小。

变化无限。

---

# 14. Mesh Generation Pipeline

流程：

```text
Genome


↓

Geometry Rule


↓

Primitive Generation


↓

Mesh Optimization


↓

GPU Buffer

```

---

# 15. Primitive生成

基础形状：

GPU喜欢。

例如：

```text
Cube

Sphere

Plane

Curve

```

---

复杂物体：

由基础组合。

---

例如：

汽车：

```text
Body

+

Wheel

+

Glass

```

---

# 16. Geometry Optimization

生成后：

优化。

包括：

---

## Mesh Simplification

减少面数。

---

## Instance Merging

重复对象合并。

---

## Culling

隐藏不可见对象。

---

# 17. Material Compiler（材质编译）

负责：

把材质基因：

转换成Shader参数。

---

例如：

Material Genome：

```text
Old Wood

Age:

80

Moisture:

0.5

```

---

转换：

```text
BaseColor

Roughness

Normal

Height

```

---

# 18. Material不是图片

重要。

---

传统：

贴图。

---

PixelForge：

材质规则。

---

例如：

木头：

```text
Wood Fiber Rule

+

Age Rule

+

Damage Rule

```

---

Shader实时计算。

---

# 19. Shader Generation（着色器生成）

Shader：

负责GPU最终计算。

---

例如：

雨天。

Compiler生成：

```text
Rain Shader


Input:

Surface


Output:

Wet Reflection

```

---

# 20. Shader Graph

为了避免AI直接写Shader。

---

内部：

节点系统。

---

例如：

```text
Rain


↓

Wetness


↓

Reflection


↓

Final Color

```

---

# 21. Lighting Compiler（光照编译）

用户：

> 黄昏阳光。

---

WDL：

```text
Time:

18:30

Light:

Warm

```

---

Compiler：

转换：

```text
Sun Position

Color Temperature

Intensity

Shadow

```

---

# 22. Camera Compiler

摄像机也是世界对象。

---

输入：

```text
Camera:

35mm

Focus:

Person

Movement:

Push

```

---

输出：

```text
Projection Matrix

View Matrix

Motion Path

```

---

# 23. Animation Compiler

视频必须有时间变化。

---

例如：

人物走路。

Genome：

```text
Human

Behavior:

Walk

```

---

Compiler：

生成：

```text
Skeleton

Motion

Interpolation

```

---

# 24. Render Graph（渲染图）

这是GPU执行计划。

---

不是：

直接画。

---

而是：

安排任务。

---

结构：

```text
Scene


↓

Geometry Pass


↓

Shadow Pass


↓

Lighting Pass


↓

Material Pass


↓

Post Process


↓

Output

```

---

# 25. 为什么需要Render Graph？

因为GPU有限。

必须安排：

先做什么。

---

例如：

没有光：

材质无法正确计算。

---

所以：

顺序重要。

---

# 26. WebGPU Backend

最终连接：

GPU。

---

WebGPU负责：

跨平台。

支持：

* Windows
* macOS
* Linux
* Browser

---

# 27. WebGPU数据结构

GPU需要：

Buffer。

---

例如：

## Vertex Buffer

保存：

顶点。

---

## Index Buffer

保存：

连接关系。

---

## Uniform Buffer

保存：

参数。

---

## Texture

保存：

图像数据。

---

# 28. World Compiler输出

最终：

```text
GPU Command


|

├── Create Buffer

├── Upload Texture

├── Bind Shader

├── Draw Mesh

└── Compute

```

---

# 29. AI和Compiler关系

非常重要。

AI不应该：

直接控制GPU。

---

错误：

```text
AI

↓

WebGPU代码

```

---

原因：

AI容易错误。

---

正确：

```text
AI

↓

WDL

↓

Compiler

↓

GPU

```

---

Compiler负责：

安全。

---

# 30. Error Correction System（错误纠正）

AI生成必然错误。

---

例如：

AI：

生成：

悬空房子。

---

Compiler检查：

```text
Gravity Error

Structural Error

Material Error

```

---

然后：

反馈AI。

---

形成：

闭环。

---

# 31. Compiler Feedback Loop

流程：

```text
AI


↓

WDL


↓

Compiler


↓

Validation


↓

Error


↓

AI Repair


↓

Compile Again

```

---

# 32. World Validation（世界验证）

检查：

---

## 空间合理性

例如：

物体重叠。

---

## 物理合理性

例如：

汽车没有轮子。

---

## 美学合理性

例如：

颜色冲突。

---

## 性能合理性

例如：

细节过多。

---

# 33. Adaptive Compilation（自适应编译）

不同设备：

不同输出。

---

手机：

降低：

* 面数
* 纹理
* 粒子

---

电脑：

提高。

---

同一个世界：

不同质量。

---

# 34. Incremental Compilation（增量编译）

非常重要。

因为你做：

AE/PR。

---

用户：

修改门颜色。

---

错误：

重新编译整个世界。

---

正确：

```text
Detect Change


↓

Recompile Door Material


↓

Update GPU Resource

```

---

# 35. Partial Rendering（局部渲染）

用户圈选区域。

例如：

圈汽车。

修改：

汽车。

---

流程：

```text
Selection Mask


↓

Entity ID


↓

Genome Change


↓

Partial Compile


↓

Partial Render

```

---

# 36. World Compiler完整流程

最终：

```text
User Prompt


↓

LLM


↓

WDL


↓

Scene Graph


↓

Genome


↓

Detail Manager


↓

WIR


↓

Geometry Compiler


↓

Material Compiler


↓

Shader Compiler


↓

Render Graph


↓

WebGPU


↓

GPU


↓

Frame

```

---

# 37. World Compiler核心价值

解决：

你的最初问题：

> AI如何把自然语言交给显卡？

答案：

不是直接交。

而是：

创造一个世界编译链。

---

# 38. Chapter 27总结

World Compiler实现：

✅ 自然语言到GPU
✅ 世界结构转换
✅ 自动生成几何
✅ 自动生成材质
✅ 自动生成Shader
✅ 自动安排渲染
✅ 错误检测
✅ 局部重新编译
✅ 视频实时生成基础

---

# PixelForge当前完整技术链：

```text
自然语言

↓

LLM

↓

WDL

↓

Scene Graph

↓

Asset Genome

↓

Detail System

↓

World Compiler

↓

WebGPU

↓

GPU

↓

Video

```

# 当前PixelForge核心链路：

```text
自然语言

↓

WDL

↓

Scene Graph

↓

Asset Genome

↓

Detail System

↓

Timeline

↓

World Compiler

↓

WebGPU

↓

GPU

↓

Video

```


# Chapter 25：AI Revision System（AI修改系统完整规范）

版本：1.0

---

# 1. 系统定位

## 1.1 什么是AI Revision System？

AI Revision System（AI修改系统）是PixelForge从：

> AI生成工具

升级成为：

> AI创作编辑平台

的关键模块。

---

传统AI生成：

```text
用户输入Prompt

↓

AI生成视频

↓

结束

```

问题：

生成之后：

用户只能：

* 重新生成
* 修改Prompt
* 接受结果

---

但是专业创作流程：

例如：

* Adobe After Effects
* Premiere Pro
* Blender
* Unreal Engine

核心不是一次生成。

而是：

持续修改。

---

PixelForge目标：

实现：

> 用户可以像操作AE、PR一样修改AI生成的世界。

---

# 2. 核心理念

## 2.1 从Pixel Editing转向World Editing

传统视频：

修改像素。

例如：

改变汽车颜色。

需要：

修改：

几万个像素。

---

PixelForge：

修改对象。

例如：

```text
Car001

Color:

Red

↓

Blue

```

---

然后：

重新渲染。

---

区别：

```text
传统：

Pixel → 修改


PixelForge：

World Object → 修改 → Pixel

```

---

# 3. 非破坏式编辑（Non-destructive Editing）

这是核心。

---

传统剪辑：

修改后：

可能破坏原素材。

---

PixelForge：

永远保存：

原始世界。

---

结构：

```text
Original World


+

Modification Layer


+

Render Result

```

---

例如：

原始：

```text
Car001

Black

```

---

修改层：

```text
Change:

Color

Value:

Red

```

---

最终显示：

红车。

---

但是：

原始基因仍然存在。

---

# 4. Revision Layer（修改层）

所有修改：

保存为Layer。

---

类似：

Photoshop：

图层。

After Effects：

Effect Layer。

---

结构：

```text
WORLD


|

├── Base Layer

|

├── Lighting Layer

|

├── Character Layer

|

├── Material Layer

|

└── User Revision Layer

```

---

# 5. 为什么需要修改层？

因为AI生成不是一次完成。

用户会：

不断调整。

---

例如：

第一版：

```text
雨夜城市

```

---

第二版：

增加：

```text
更多雨

```

---

第三版：

修改：

```text
人物衣服

```

---

如果直接修改：

无法回退。

---

Revision Layer：

保存历史。

---

# 6. User Intent Understanding（用户修改意图理解）

用户不是工程师。

不会说：

修改Shader。

---

用户说：

> 让这个房子看起来旧一点。

---

AI需要理解：

不是：

换房子。

---

而是：

修改：

```text
House001

Material

Age

Damage

```

---

# 7. 修改意图解析流程

```text
用户语言


↓

LLM理解


↓

Intent Extraction


↓

Target Identification


↓

Operation Generation


↓

Preview


↓

Execute

```

---

# 8. Intent分类系统

基本操作：

---

## MODIFY

修改。

例如：

> 换颜色。

---

## DELETE

删除。

例如：

> 删除树。

---

## ADD

增加。

例如：

> 加一辆车。

---

## MOVE

移动。

例如：

> 房子靠近河。

---

## STYLE

风格修改。

例如：

> 更电影感。

---

## CAMERA

镜头修改。

例如：

> 镜头靠近人物。

---

# 9. Target Identification（目标识别）

最大难点：

用户说：

“这个”。

---

例如：

> 把这个改成红色。

---

系统需要：

知道：

这个是什么。

---

解决：

## Selection System

---

# 10. Entity Selection System

PixelForge中的每个对象：

都有：

Entity ID。

---

例如：

画面：

汽车。

内部：

```text
Car001

ID:

928372

```

---

用户点击汽车。

系统：

返回：

```text
Selected:

Car001

```

---

# 11. 多模态选择

支持：

多种方式。

---

## 点击

用户点击。

---

## 框选

类似AE。

---

## 圈选

类似Photoshop。

---

## 语音

> 修改那个门。

---

## 文字

> 删除左边建筑。

---

# 12. Mask Selection系统

对于像素区域：

需要Mask。

---

例如：

用户圈汽车。

生成：

```text
Mask:


1

1

0

0

1

```

---

表示：

哪些像素属于汽车。

---

但是PixelForge不只使用Mask。

---

# 13. Entity ID + Mask混合系统

Mask：

解决视觉范围。

Entity：

解决世界对象。

---

流程：

```text
User Selection


↓

Pixel Mask


↓

Object Detection


↓

Entity Mapping


↓

Object ID

```

---

例如：

圈汽车。

找到：

```text
Car001

```

---

然后：

修改对象。

---

# 14. Local Regeneration（局部重生成）

这是核心。

---

传统AI：

修改一个地方。

重新生成整个视频。

---

问题：

* 时间长
* 其他地方变化
* 一致性破坏

---

PixelForge：

只重新生成目标。

---

例如：

修改：

汽车。

流程：

```text
Car001


↓

Genome Change


↓

Detail Update


↓

Compile


↓

Render

```

---

其他：

保持。

---

# 15. Dependency Update（依赖更新）

但是：

对象变化会影响环境。

---

例如：

汽车变大。

影响：

* 阴影
* 反射
* 道路

---

所以：

需要：

依赖检测。

---

# 16. Dependency Graph

例如：

```text
Car001


|

├── Shadow001

|

├── Reflection001

|

└── WheelTrack001

```

---

修改汽车：

自动更新。

---

# 17. Revision Preview（修改预览）

AI不能直接执行。

---

流程：

```text
用户请求


↓

AI生成修改方案


↓

显示变化


↓

用户确认


↓

执行

```

---

例如：

用户：

> 删除房子。

---

AI：

显示：

```
即将删除：

House001

影响：

Tree Shadow

Lighting

Camera Composition

```

---

确认：

执行。

---

# 18. AI Modification Safety

防止错误。

---

例如：

用户：

> 删除人物。

---

AI判断：

人物：

可能是主角。

---

提示：

```
该对象为主要角色。

是否确认删除？

```

---

# 19. Change Confidence（修改置信度）

AI给每次修改评分。

---

例如：

```text
Target:

Car001


Confidence:

96%

```

---

低于阈值：

要求确认。

---

# 20. Revision History（修改历史）

所有修改：

记录。

---

结构：

```text
Version 1

↓

Version 2

↓

Version 3

```

---

类似：

Git。

---

# 21. World Git（世界版本控制）

PixelForge可以拥有：

世界版本。

---

例如：

```
World_v001

World_v002

World_v003

```

---

可以：

回滚。

---

# 22. Branch Editing（分支创作）

专业功能。

---

例如：

两个方案。

版本A：

晴天。

版本B：

雨天。

---

结构：

```text
Main World


 |

 ├── Sunny Version


 └── Rain Version

```

---

# 23. Timeline Revision（时间轴修改）

视频必须：

按时间修改。

---

例如：

用户：

> 第10秒以后开始下雨。

---

解析：

```text
Timeline Event


Time:

10s


Action:

Rain Start

```

---

不是：

修改整段视频。

---

# 24. Timeline结构

```text
Timeline


|

├── Camera Track

|

├── Object Track

|

├── Material Track

|

├── Environment Track

|

└── Effect Track

```

---

# 25. Object Track

控制对象变化。

---

例如：

汽车。

```text
0s

Position A


5s

Position B


10s

Disappear

```

---

# 26. AI Keyframe Generation

用户：

> 汽车慢慢开走。

---

AI生成：

关键帧。

```text
Frame 0

Position A


Frame 120

Position B

```

---

中间：

自动插值。

---

# 27. Style Revision（风格修改）

用户：

> 变成宫崎骏风格。

---

不是重新生成。

---

修改：

Style Genome。

---

影响：

* 色彩
* 光照
* 材质
* 资产风格

---

# 28. Camera Revision（镜头修改）

用户：

> 更像电影。

---

AI调整：

```text
Camera


Lens

Depth of Field

Movement

Composition

```

---

---

# 29. AI Director模式

高级模式。

用户：

> 让这一幕更紧张。

---

AI分析：

改变：

* 镜头
* 光线
* 动作
* 音效

---

类似：

导演助手。

---

# 30. Revision Compiler

修改不是直接改变世界。

---

流程：

```text
Revision Request


↓

Revision Layer


↓

Scene Update


↓

Dependency Check


↓

World Compiler


↓

GPU Update

```

---

# 31. GPU增量更新

重点。

---

不要重新上传全部资源。

---

例如：

修改车颜色。

只更新：

Material Buffer。

---

流程：

```text
Old Material


↓

New Material


↓

GPU Buffer Update

```

---

# 32. AI Revision完整案例

用户：

> 把左边的树变成秋天黄色。

---

Step 1：

AI理解。

```text
Action:

Modify


Target:

Tree


Property:

Season

```

---

Step 2：

定位。

```text
Tree001

```

---

Step 3：

修改Genome。

```text
Season:

Summer

↓

Autumn

```

---

Step 4：

Detail更新。

重新生成：

* 叶子颜色
* 部分落叶

---

Step 5：

更新：

* 光照
* 地面落叶

---

Step 6：

局部渲染。

---

# 33. AI Revision系统架构

```text
                User


                 ↓


          Prompt / Selection


                 ↓


        Intent Understanding


                 ↓


          Entity Resolver


                 ↓


        Revision Generator


                 ↓


        Revision Layer


                 ↓


       Dependency Update


                 ↓


        World Compiler


                 ↓


             GPU

```

---

# 34. Chapter 25总结

AI Revision System实现：

✅ 类AE/PR编辑
✅ 对象级修改
✅ 非破坏编辑
✅ 局部重新生成
✅ 时间轴控制
✅ AI理解修改意图
✅ 版本控制
✅ 修改安全确认
✅ GPU增量更新

---

# PixelForge当前完整架构：

```text
自然语言

↓

LLM

↓

WDL

↓

Scene Graph

↓

Asset Genome

↓

Detail System

↓

Timeline System

↓

AI Revision System

↓

World Compiler

↓

WebGPU

↓

GPU

↓

Video

```



# PixelForge V20 架构补充文档

# Chapter 26：Timeline System（AI视频时间轴系统完整规范）

版本：1.0

---

# 1. 系统定位

## 1.1 什么是Timeline System？

Timeline System（时间轴系统）是PixelForge从：

> 世界生成器

转变为：

> AI视频创作平台

的核心模块。

---

传统视频软件：

例如：

* Premiere Pro
* After Effects
* Final Cut Pro

核心：

时间轴。

---

因为视频本质：

不是一张图片。

而是：

连续变化的世界状态。

---

传统方式：

```text
Frame 1

↓

Frame 2

↓

Frame 3

↓

Frame 4

```

---

PixelForge：

不是保存每一帧。

而是：

保存：

# 世界变化规则。

---

例如：

传统：

保存：

10秒视频。

PixelForge：

保存：

```text
人物：

0秒站立

5秒开始走路

10秒离开


天气：

0秒晴天

8秒开始下雨

```

---

GPU根据规则：

生成每一帧。

---

# 2. 核心理念

## 2.1 Video = Time + World State

视频不是：

图片排列。

而是：

世界状态随时间变化。

---

公式：

```text
Video Frame

=

World State

+

Camera State

+

Time

```

---

每一帧：

由世界计算得到。

---

# 3. Timeline与Scene Graph关系

非常重要。

Scene Graph：

负责：

空间。

Timeline：

负责：

时间。

---

结合：

```text
Scene Graph


告诉：

有什么


↓

Timeline


告诉：

什么时候变化


↓

World Compiler


生成：

每一帧

```

---

# 4. Timeline总体结构

```text
TIMELINE


|

├── Master Track

|

├── Camera Track

|

├── Object Track

|

├── Character Track

|

├── Material Track

|

├── Environment Track

|

├── Effect Track

|

├── Audio Track

|

└── AI Event Track

```

---

# 5. Master Timeline（主时间轴）

控制：

整个作品。

---

包含：

* 总长度
* FPS
* 时间范围
* 输出格式

---

示例：

```json
TIMELINE {

duration:

60s,


fps:

30,


resolution:

4K

}

```

---

# 6. Track系统（轨道系统）

PixelForge采用：

对象轨道。

---

传统PR：

轨道放视频。

---

PixelForge：

轨道放：

世界变化。

---

例如：

```text
Timeline


0s ---------------- 60s


Camera

|------------------|


Character

|---------|---------|


Weather

|------------------|


Car

      |-------|

```

---

# 7. Camera Track（摄像机轨道）

电影感核心。

---

摄像机不是固定。

它是世界对象。

---

Camera Track控制：

* 位置
* 旋转
* 焦距
* 景深
* 运动

---

# 8. Camera Keyframe（摄像机关键帧）

例如：

用户：

> 镜头慢慢靠近女孩。

---

AI转换：

```text
Frame 0

Camera:

Distance 20m



Frame 300

Camera:

Distance 5m

```

---

中间：

自动插值。

---

# 9. Camera Motion Generator

AI不需要用户手动调曲线。

---

用户：

> 一个电影感推进镜头。

---

AI生成：

```text
Movement:

Dolly In


Speed:

Slow


Acceleration:

Smooth


Lens:

35mm

```

---

生成：

摄像机轨迹。

---

# 10. Camera智能规则

摄影语言进入系统。

---

例如：

用户：

> 紧张一点。

AI理解：

可能：

* 镜头靠近
* 景深降低
* 手持抖动增加
* 光线降低

---

不是：

随机移动。

---

# 11. Object Track（对象轨道）

控制：

任何Entity。

---

例如：

汽车。

```text
CAR001 TRACK


0s

Position A


5s

Drive


10s

Position B

```

---

对应：

Scene Graph：

```text
Car001

```

---

# 12. Character Track（角色轨道）

人物动画。

---

包括：

* 位置
* 动作
* 表情
* 姿态

---

例如：

用户：

> 女孩慢慢转头。

---

生成：

```text
Character001


0s:

Forward


3s:

Rotate Head


5s:

Look Camera

```

---

# 13. AI Motion Generation（AI动作生成）

不需要手动骨骼。

---

用户：

> 一个人跑向汽车。

---

AI：

理解：

目标：

Car。

动作：

Run。

路径：

人物→汽车。

---

生成：

```text
Animation

+

Path

+

Timing

```

---

# 14. Environment Track（环境轨道）

控制世界。

---

例如：

天气。

```text
Weather Track


0s:

Sunny


20s:

Cloud


30s:

Rain


50s:

Storm

```

---

# 15. Material Track（材质轨道）

控制：

外观变化。

---

例如：

一天变化。

```text
Sunlight


Morning:

Warm


Noon:

Strong


Night:

Blue

```

---

# 16. Effect Track（效果轨道）

例如：

* 雾
* 火
* 爆炸
* 粒子
* 魔法

---

但是：

效果也是世界对象。

---

# 17. AI Event Track（AI事件轨道）

这是PixelForge特色。

---

传统：

时间轴只有动画。

---

PixelForge：

时间轴包含：

事件。

---

例如：

```text
10s

Character enters


20s

Rain starts


30s

Car explodes

```

---

# 18. Event System（事件系统）

事件结构：

```json
EVENT {

time:

10,


target:

Character001,


action:

EnterScene

}

```

---

# 19. Timeline与WDL关系

WDL描述：

世界。

Timeline描述：

变化。

---

例如：

WDL：

```text
Tree001

Season:

Summer

```

---

Timeline：

```text
20s

Season:

Autumn

```

---

结果：

树变化。

---

# 20. Timeline与Genome关系

Genome：

定义：

可能。

Timeline：

定义：

发生。

---

例如：

汽车Genome：

```text
Can Drive

```

---

Timeline：

```text
5s

Drive Start

```

---

# 21. Timeline与Detail System关系

重要。

---

细节不是固定。

---

例如：

汽车开始移动。

需要：

增加：

* 轮胎纹理
* 运动模糊
* 灰尘

---

Timeline触发：

Detail升级。

---

# 22. AI自动生成时间轴

这是核心体验。

---

用户：

> 创建一个30秒电影镜头，一个女孩走过雨夜街道。

---

AI生成：

```text
0-5s

建立环境


5-15s

女孩进入


15-25s

镜头跟随


25-30s

女孩离开

```

---

自动生成：

* 镜头
* 动作
* 节奏

---

# 23. Story Timeline（故事时间轴）

高级功能。

---

不是：

控制动作。

而是：

控制叙事。

---

例如：

用户：

> 制作一个英雄出现的场景。

---

AI：

生成：

```text
Beginning

↓

Conflict

↓

Reveal

↓

Ending

```

---

然后转换：

时间事件。

---

# 24. Non-linear Timeline（非线性时间轴）

支持：

电影剪辑。

---

例如：

时间跳跃。

```text
Scene A


↓

Flashback


↓

Scene B

```

---

世界状态：

独立保存。

---

# 25. Timeline Version System

类似Git。

---

不同剪辑版本：

```text
Timeline A

Timeline B

Timeline C

```

---

例如：

导演版本。

---

# 26. AI Cut System（AI剪辑系统）

未来模块。

---

用户：

> 删除无聊部分。

---

AI分析：

* 节奏
* 镜头
* 情绪

---

生成：

剪辑方案。

---

# 27. Timeline与AI Revision结合

例如：

用户：

> 第20秒以后，把车换成飞机。

---

系统：

定位：

Timeline。

找到：

20秒以后。

修改：

Car001。

替换：

Vehicle Genome。

---

生成：

新的事件。

---

# 28. Timeline数据结构

示例：

```json
{

timeline:"Scene001",


duration:30,


tracks:[


{


type:"camera",


keyframes:[...]

},



{


type:"object",


target:"Car001",


events:[...]

}


]

}

```

---

# 29. Keyframe系统

关键帧不是只有数值。

---

包含：

```text
Time

Value

Interpolation

Target

Operation

```

---

例如：

```json
{

time:

5,


target:

Camera,


property:

Position,


value:

[10,5,2],


curve:

Smooth

}

```

---

# 30. AI Interpolation（AI补间）

传统：

数学插值。

---

PixelForge：

增加：

语义插值。

---

例如：

人物走路。

不是简单：

A→B。

---

AI生成：

* 步态
* 重心
* 手臂运动

---

# 31. Timeline Cache系统

视频生成：

计算量巨大。

---

所以缓存：

```text
World State Cache

+

Frame Cache

+

GPU Resource Cache

```

---

修改：

只更新变化部分。

---

# 32. Real-time Preview（实时预览）

类似：

Unreal Engine。

---

低质量：

快速查看。

---

最终：

高质量渲染。

---

质量等级：

```text
Draft

↓

Preview

↓

Final

```

---

# 33. Timeline Export系统

输出：

* 视频
* 图片序列
* 3D场景
* 项目文件

---

格式：

```text
MP4

MOV

PNG Sequence

World Project

```

---

# 34. Timeline完整生成案例

用户：

> 生成10秒视频，一个机器人在未来城市行走。

---

AI：

---

## Scene

创建：

城市。

---

## Character

创建：

机器人。

---

## Timeline：

```text
0s

Robot Spawn


2s

Start Walking


5s

Camera Follow


8s

Look Camera


10s

End

```

---

## Renderer

生成：

每一帧。

---

# 35. Timeline系统最终架构

```text
                User Prompt


                    ↓


              AI Director


                    ↓


             Timeline Generator


                    ↓


 ------------------------------------------------


Camera Track

Object Track

Character Track

Environment Track

Effect Track

Event Track


 ------------------------------------------------


                    ↓


              World State


                    ↓


             World Compiler


                    ↓


                  GPU

```

---

# 36. Chapter 26总结

Timeline System解决：

✅ AI生成视频
✅ 世界随时间变化
✅ 类PR时间轴
✅ 类AE动画控制
✅ 摄像机电影化
✅ AI自动关键帧
✅ 对象级动画
✅ 环境变化
✅ 局部修改
✅ 视频编辑基础

---

# PixelForge当前完整架构：

```text
自然语言

↓

LLM

↓

WDL

↓

Scene Graph

↓

Asset Genome

↓

Detail System

↓

Timeline System

↓

AI Revision System

↓

World Compiler

↓

WebGPU

↓

GPU

↓

Video

```

---


# Chapter 27：AI Director System（AI导演系统规范）

---

## 关于 §29 AI Director 模式

Chapter 25 §29（[L10848](file:///c:/Users/yangx/Desktop/2号想法/PixelForge_技术实现路线.md#L10848)）只有 26 行概念性描述，未给出数据结构、流程、字段定义。

本章是 §29 的完整规范。

建议将 §29 改为：

```text
# 29. AI Director模式

完整规范见 Chapter 27。
```

---

## 与 Chapter 26 已有 AI 功能的关系

Chapter 26（Timeline System）已存在多个 AI 相关子节：

```text
§9   Camera Motion Generator    AI 生成运镜
§22  AI自动生成时间轴            核心体验
§26  AI Cut System              未来模块
§30  AI Interpolation            语义补间
```

Chapter 27 不重复定义这些功能，而是作为它们的**上游协调者**：

```text
User Prompt
     ↓
AI Director System（Chapter 27）
     ↓
┌──────────────┬──────────────┬──────────────┐
↓              ↓              ↓              ↓
§22 AI自动    §9 Camera     §26 AI Cut    §30 AI
生成时间轴    Motion         System        Interpolation
              Generator
```

---

## 1. 系统定位

### 1.1 在完整链路中的位置

参考 Chapter 26 §35 最终架构（[L12585](file:///c:/Users/yangx/Desktop/2号想法/PixelForge_技术实现路线.md#L12585)）：

```text
User Prompt
     ↓
AI Director          ← 本章
     ↓
Timeline Generator
     ↓
9 条 Track
     ↓
World State
     ↓
World Compiler
     ↓
GPU
```

---

### 1.2 AI Director 的双重职责

文档对 AI Director 的定位存在两处来源：

```text
来源 A：Chapter 26 §35（L12594）
        定位：User Prompt → Timeline Generator 之间的中间层
        职责：生成（从 Prompt 到 Timeline）

来源 B：Chapter 25 §29（L10848）
        定位：AI Revision System 的高级修改模式
        职责：修改（让某一幕更紧张）
```

---

Chapter 27 明确：AI Director 同时承担**生成**与**修改**两种职责。

```text
生成模式（Creation）
  输入：User Prompt
  输出：完整 Timeline Track 内容 + AI Event

修改模式（Revision）
  输入：用户对现有作品的修改指令
  输出：对 Timeline 的局部修改请求
  走：Chapter 25 §30 Revision Compiler 流程
```

---

### 1.3 AI Director 不做什么

参考 Chapter 24/25/26 的真实能力边界：

```text
不做：
  * 不直接渲染像素（由 World Compiler + GPU 负责）
  * 不生成几何/材质（由 Asset Genome 负责）
  * 不维护空间关系（由 Scene Graph 负责）
  * 不决定细节层级（由 Detail System 负责）

只做：
  * 把 User Prompt 翻译为可被 Timeline 消费的内容
  * 协调 §9 / §22 / §26 / §30 的 AI 生成功能
  * 在修改模式下产生 Revision Request
```

---

## 2. 输入与输出

### 2.1 输入

```text
User Prompt（自然语言）
+
可选上下文：
  - 当前 Scene Graph 状态
  - 当前 Timeline 状态
  - 当前 Persona 选择
  - 当前 Object Lock 列表
```

---

### 2.2 输出

AI Director 的输出**必须能被 Chapter 26 Timeline System 消费**。

参考 Chapter 26 真实结构，输出包含：

```text
1. Master Timeline 元数据
   - duration
   - fps
   - resolution

2. Keyframe 序列（统一 Keyframe 结构，参考 Chapter 26 §29 L12332）
   每个 Keyframe 含：
   - time
   - value
   - interpolation
   - target（Camera / Object / Character / Material / Environment / Effect）
   - operation

3. AI Event（供 AI Event Track 使用，参考 Chapter 26 §18 L11920）
   每个 Event 含：
   - time
   - target（Entity ID）
   - action

4. 修改模式下：Revision Request
   走 Chapter 25 §30 Revision Compiler 流程
```

---

### 2.3 输出格式示例

```json
{
  "master": {
    "duration": 30,
    "fps": 30,
    "resolution": "4K"
  },
  "keyframes": [
    {
      "time": 0,
      "target": "Camera",
      "property": "Distance",
      "value": 20,
      "interpolation": "Smooth"
    },
    {
      "time": 5,
      "target": "Character001",
      "property": "Position",
      "value": [10, 0, 5],
      "interpolation": "Linear"
    }
  ],
  "events": [
    {
      "time": 10,
      "target": "Character001",
      "action": "EnterScene"
    }
  ]
}
```

---

注意：以上 Keyframe 字段命名与 Chapter 26 §29 原文一致（time/value/interpolation/target/operation），Camera Track 的属性字段沿用 Chapter 26 §7 的中文术语（位置/旋转/焦距/景深/运动）。

---


## 3. Director Intent（导演意图）

### 3.1 为什么需要 Intent

参考 Chapter 25 §29 原文（L10858）："AI分析：改变：镜头 / 光线 / 动作 / 音效"。

但原文未说明：AI 根据什么分析？

Chapter 27 引入 Director Intent 作为**分析的中介**：

```text
User Prompt
     ↓
Director Intent
     ↓
具体修改（镜头 / 光线 / 动作 / 音效）
```

---

### 3.2 Intent 的两类

```text
Creation Intent（创作意图）
  描述：用户想要什么
  例：孤独的女孩在雨夜街道走着

Revision Intent（修改意图）
  描述：用户想改什么
  例：让这一幕更紧张
```

---

### 3.3 Intent 的解析

AI Director 接收 User Prompt 后，解析为结构化字段：

```text
Prompt: "一个孤独的女孩在雨夜街道走着"

解析输出：
  - mood:        孤独
  - character:   女孩
  - setting:     雨夜街道
  - action:      走
  - pacing:      慢
  - tone:        忧郁
```

---

解析过程调用 Chapter 22 §22.2 中的 `callLLM()`（[L1820](file:///c:/Users/yangx/Desktop/2号想法/PixelForge_技术实现路线.md#L1820)）。

---

### 3.4 Intent 不立即生成 Keyframe

Intent 是**抽象意图**，不是具体帧。

```text
Intent "孤独"
  ↓
不直接生成 Keyframe
  ↓
而是选择：景别收紧 + 节奏放慢 + 冷色调
  ↓
最后才生成具体 Keyframe
```

---

中间的"选择"步骤由 Persona 决定。

---

## 4. Persona（导演人格）

### 4.1 为什么需要 Persona

同一个 Prompt，不同导演会拍出不同作品：

```text
"孤独的女孩在雨夜街道走着"

王家卫：    慢镜头 + 暖黄调色 + 独白
希区柯克：  推进 + 紧张音效 + 特写
塔可夫斯基：长镜头 + 缓慢推近 + 雨声
```

---

Persona 决定 AI Director 在"Intent → Keyframe"环节的**风格选择**。

---

### 4.2 Persona 包含什么

```text
Persona:
  - name           名字（如 "Wong Kar-wai"）
  - shot_type      景别偏好（CU / LS / ELS ...）
  - camera_motion  运镜偏好（DOLLY_IN / STATIC / HANDHELD ...）
  - pacing         节奏偏好（快 / 慢 / 渐进）
  - color          调色偏好（暖 / 冷 / 高对比）
  - lighting       灯光偏好（高调 / 低调 / 霓虹）
  - signature      标志手法（抽帧 / 独白 / 长镜头）
  - avoids         禁用项（如：不用变焦、不用手持）
```

---

### 4.3 内置 Persona（建议数量）

为避免过度设计，初版仅内置少量 Persona：

```text
默认 Persona：
  - Default           系统默认（中性风格）
  - Wong Kar-wai      王家卫（暖调、慢镜、独白）
  - Hitchcock         希区柯克（紧张、推进、悬念）
  - Tarkovsky         塔可夫斯基（长镜、缓慢、诗意）
  - Bay               贝（快剪、动作、低角度）
```

---

### 4.4 Persona 选择

```text
方式 A：用户显式指定
  > 用王家卫风格拍

方式 B：AI 根据 Prompt 推断
  Prompt 含"雨夜、孤独、街道" → 推断为王家卫契合
  Prompt 含"追逐、爆炸、紧张" → 推断为贝契合

方式 C：用户混合
  > 70% 王家卫 + 30% 希区柯克
```

---

### 4.5 Persona 不强制

用户可以不选 Persona（使用 Default）。

也可以在生成后随时切换 Persona，AI Director 重跑生成流程。

---


## 5. 生成模式工作流程

### 5.1 端到端流程

```text
Step 1: Prompt 接收
   ↓
Step 2: Intent 解析（调用 callLLM，参考 Chapter 22 §22.2 L1820）
   ↓
Step 3: Persona 选择（用户指定 或 AI 推断）
   ↓
Step 4: Scene Graph 查询
        （需要知道：角色位置、关系、空间结构）
   ↓
Step 5: 调用 Chapter 26 §22 AI自动生成时间轴
        - 生成 Keyframe 序列
        - 生成 Event
   ↓
Step 6: 调用 Chapter 26 §9 Camera Motion Generator
        - 为 Camera Keyframe 生成运镜细节
   ↓
Step 7: 输出 Master Timeline 元数据 + Keyframes + Events
   ↓
Step 8: 交给 Timeline Generator
```

---

### 5.2 每步的输入输出

```text
Step 1 → Step 2:
  in:  User Prompt (string)
  out: ParsedIntent (mood, character, setting, action, pacing, tone)

Step 2 → Step 3:
  in:  ParsedIntent
  out: SelectedPersona

Step 3 → Step 4:
  in:  SelectedPersona + ParsedIntent
  out: SceneQueryResult（从 Scene Graph 查询得到的空间信息）

Step 4 → Step 5:
  in:  ParsedIntent + Persona + SceneQueryResult
  out: Keyframe[] + Event[]

Step 5 → Step 6:
  in:  Keyframe[] (其中 target=Camera 的部分)
  out: Camera Keyframe[] (含运镜细节)

Step 6 → Step 7:
  out: TimelineContent
```

---

### 5.3 Scene Graph 查询需求

参考 Chapter 24 真实能力，AI Director 需要查询的信息：

```text
- 角色 Entity 的位置（参考 Chapter 24 §24.10 Transform）
- 角色 Entity 的朝向
- 角色 Entity 之间的关系（参考 §24.7 Relation Graph）
- 场景的空间结构
- Object Lock 列表（参考 §24.22）
```

---

注意：Chapter 24 **没有定义查询 API 函数签名**（只有流程图和 JSON 示例）。

AI Director 实现时应通过 Scene Graph 暴露的接口（待 Chapter 22 追加 TODO）查询上述信息。

---

### 5.4 与 Detail System 的关系

参考 Chapter 25 §25.5（[L5098](file:///c:/Users/yangx/Desktop/2号想法/PixelForge_技术实现路线.md#L5098)）Detail Score 公式：

```text
Detail Score =
  Distance
  + Screen Size
  + User Attention
  + Semantic Importance
  + Motion Importance
  + Narrative Importance
```

---

其中 `Narrative Importance`（叙事重要性）需要 AI Director 提供：

```text
当前 Keyframe 叙述的核心内容是什么？
  → 决定该对象的 Detail Score

例：
  当前 Beat 是"女孩的脸部表情"
  → 女孩脸的 Narrative Importance = 高
  → 背景人物 = 低
```

---

AI Director 不直接分配 Detail Budget，而是为每个对象提供 Narrative Importance 输入。

---

## 6. 修改模式工作流程

### 6.1 修改模式的入口

参考 Chapter 25 §29（L10852）：

```text
用户：
> 让这一幕更紧张。
```

---

### 6.2 修改流程走 Revision Compiler

参考 Chapter 25 §30（[L10875](file:///c:/Users/yangx/Desktop/2号想法/PixelForge_技术实现路线.md#L10875)）：

```text
Revision Request      ← AI Director 产生
     ↓
Revision Layer        ← Chapter 25 §4 L9843
     ↓
Scene Update
     ↓
Dependency Check
     ↓
World Compiler
     ↓
GPU Update
```

---

### 6.3 AI Director 在修改流程中的职责

```text
1. 接收用户修改指令
   > 让这一幕更紧张

2. 解析为 Revision Intent
   - 目标：哪一幕（时间范围）
   - 修改方向：紧张度提升
   - 影响范围：镜头 / 光线 / 节奏 / 音效

3. 生成 Revision Request
   - 修改哪些 Keyframe
   - 修改哪些 Event
   - 是否需要 Scene Graph 变更
   - 是否需要 Asset Genome 变异

4. 提交给 Revision Layer（Chapter 25 §4）
   - 走 §30 Revision Compiler 流程
```

---

### 6.4 Revision Layer 的真实结构

参考 Chapter 25 §4（[L9843](file:///c:/Users/yangx/Desktop/2号想法/PixelForge_技术实现路线.md#L9843)）：

```text
WORLD
  ├── Base Layer
  ├── Lighting Layer
  ├── Character Layer
  ├── Material Layer
  └── User Revision Layer
```

---

AI Director 的修改请求**进入 User Revision Layer**，不直接覆盖其他层。

```text
例：用户"让这一幕更紧张"
  → 不直接修改 Lighting Layer
  → 而是在 User Revision Layer 添加：
      "在 5s-12s 范围内，灯光降低 30%"
  → 渲染时合成所有 Layer
```

---

### 6.5 修改的影响范围

```text
修改可能触发：
  1. Timeline 内的 Keyframe 调整（局部，快速）
  2. Scene Graph 内的 Entity 变更（中量）
  3. Asset Genome 变异请求（重量）

例：
  "把女孩裙子改成红色"
  → Timeline Keyframe 不变
  → Scene Graph 不变
  → Asset Genome: Material Gene 的 color 字段变更
     （参考 Chapter 25 §26.9 L6746）
```

---

### 6.6 Asset Genome 变异

参考 Chapter 25 §26.13（[L6944](file:///c:/Users/yangx/Desktop/2号想法/PixelForge_技术实现路线.md#L6944)）Mutation Gene + §26.14（L7005）Mutation Layer：

```text
Mutation Layer 三层：
  Level 1: Safe Mutation       不破坏身份（颜色、轮毂）
  Level 2: Creative Mutation   改变设计（比例、结构）
  Level 3: Experimental        可能改变类别（汽车→飞行汽车）
```

---

AI Director 可以触发前两层：

```text
Safe + Creative：AI Director 可自主触发
Experimental：必须用户确认
```

---

### 6.7 修改的回退

参考 Chapter 25 §5（[L9893](file:///c:/Users/yangx/Desktop/2号想法/PixelForge_技术实现路线.md#L9893)）：

```text
Revision Layer 保存历史
  → 任何修改都可回退
  → AI Director 的修改同样进入 Revision Layer
  → 用户可回退 AI Director 的修改
```

---


## 7. 电影语言词典

### 7.1 为什么需要词典

用户说"更紧张"，AI Director 需要把它翻译为可执行操作。

翻译需要**词典**：

```text
"更紧张"
  ↓ 词典查询
镜头靠近 + 手持抖动 + 低照度 + 快剪 + 低频音效
  ↓ 映射到具体字段
Camera.focal_length 增大
Camera.handheld_shake 增大
Lighting.intensity 降低
Pacing.cut_interval 减小
```

---

### 7.2 词典内容（最小集）

```text
【景别】
  ECU  极特写
  CU   特写
  MCU  中特写
  MS   中景
  MLS  中远景
  LS   远景
  ELS  极远景

【运镜】（对齐 Chapter 26 §9 Camera Motion Generator）
  STATIC     固定
  PAN        摇
  TILT       俯仰
  DOLLY_IN   推进
  DOLLY_OUT  拉出
  TRACK      横移
  CRANE      升降
  HANDHELD   手持
  STEADICAM  稳定器

【节奏】
  SLOW_BURN   慢热
  DRAMATIC    戏剧
  ACTION      动作
  MONTAGE     蒙太奇
  SUSPENSE    悬念

【灯光】
  HIGH_KEY    高调
  LOW_KEY     低调
  NEON_WASH   霓虹
  GOLDEN_HOUR 黄金时段
  BLUE_HOUR   蓝调时段

【调色】
  BLEACH_BYPASS  漂白旁路
  TEAL_ORANGE    青橙
  DESATURATED    去饱和
  WARM_GLOW      暖光
  MONOCHROME     黑白
  CYBERPUNK      赛博朋克
```

---

### 7.3 词典的扩展

初版仅内置上述最小集。

未来可扩展：
- 调色 LUT 预设
- 运镜曲线预设
- 镜头组合模板（建立镜头 → 反应镜头）

---

## 8. Timeline 9 条 Track 的责任分配

### 8.1 Chapter 26 §4 真实 Track 列表

参考 Chapter 26 §4（[L11377](file:///c:/Users/yangx/Desktop/2号想法/PixelForge_技术实现路线.md#L11377)）：

```text
1. Master Track
2. Camera Track
3. Object Track
4. Character Track
5. Material Track
6. Environment Track
7. Effect Track
8. Audio Track
9. AI Event Track
```

---

### 8.2 AI Director 对每条 Track 的责任

```text
Master Track       → AI Director 设置元数据（duration / fps / resolution）
Camera Track       → AI Director 生成 Keyframe（位置/旋转/焦距/景深/运动）
Object Track       → AI Director 生成 Object 的位置关键帧
Character Track    → AI Director 生成角色的位置/动作/表情/姿态关键帧
Material Track     → AI Director 生成材质变化（如服装颜色随剧情变化）
Environment Track  → AI Director 生成天气/光线等环境变化
Effect Track       → AI Director 触发效果（雾/火/粒子）
Audio Track        → AI Director 输出声音意图（最终由专门的声音模块处理）
AI Event Track     → AI Director 生成 Event 序列
```

---

### 8.3 Audio Track 的特殊处理

Chapter 26 §4 列出了 Audio Track（L11413），但**没有为它定义字段**。

AI Director 在 Audio 上的能力受限：

```text
可做：
  - 决定何时该有声音事件（生成 AI Event，target=Audio）
  - 决定声音的情绪基调

不可做：
  - 生成具体音频波形
  - 处理混音
```

---

具体声音生成属于未来模块（参考 Chapter 26 §26 AI Cut System 的"未来模块"风格）。

---

## 9. 设计原则

### 9.1 三大原则

参考 Chapter 25 §29 原文的简洁性，AI Director 遵守：

```text
原则 1：意图优先
  所有 Keyframe 决策必须可追溯到 User Prompt
  不允许"AI 自作主张"的镜头

原则 2：可解释
  每个 Keyframe 可回答："为什么这里这么设置？"

原则 3：可修改
  用户可否定任意 Keyframe
  系统撤销该决策，重跑下游
```

---

### 9.2 与 Chapter 24 Object Lock 的关系

参考 Chapter 24 §24.22（[L4208](file:///c:/Users/yangx/Desktop/2号想法/PixelForge_技术实现路线.md#L4208)）：

```text
Object Lock: "Character001 LOCK"
  → AI Director 不能修改 Character001 的位置
  → 但仍可修改其动作、表情
```

---

AI Director 在生成 Keyframe 前必须查询 Object Lock 列表。

---

### 9.3 与 Chapter 25 §25.24 Detail Consistency 的关系

参考 Chapter 25 §25.24（[L5933](file:///c:/Users/yangx/Desktop/2号想法/PixelForge_技术实现路线.md#L5933)）：

```text
Detail Consistency 通过：
  - Scene Graph 绑定
  - 固定 ID
  - 细节继承

来保证对象在前后帧一致。
```

---

AI Director 不破坏 Detail Consistency：

```text
AI Director 修改 Keyframe 时：
  → 不创建新的 Entity ID（除非用户明确要求新角色）
  → 修改走 Asset Genome Mutation 机制（保留 Seed 复现）
  → 不直接修改对象的细节字段
```

---

### 9.4 渐进式生成

参考 Chapter 19 渐进式生成理念（[L916](file:///c:/Users/yangx/Desktop/2号想法/PixelForge_技术实现路线.md#L916)）：

```text
AI Director 的生成分为两阶段：

阶段 1：低精度预览
  - 快速生成 Keyframe 骨架（仅 time + target + value）
  - 不含运镜细节、不含调色
  - 让用户预览整体结构

阶段 2：高精度完整生成
  - 用户确认方向后
  - 补全所有字段
  - 调用 §9 Camera Motion Generator 等下游模块
```

---

### 9.5 局部重跑

```text
用户修改 1 个 Keyframe 时：
  → 不重跑整个 AI Director 流程
  → 只重跑受影响的 Step
  → 例：修改 camera.focal_length
       → 重跑 Step 5（Keyframe 生成）局部
       → 重跑 Step 6（Camera Motion Generator）
       → 不影响 Event 生成
```


## 10. 端到端示例

### 10.1 输入

```text
User Prompt: "一个孤独的女孩在雨夜街道走着"
Persona:    Wong Kar-wai（用户指定）
```

---

### 10.2 Step 2：Intent 解析

```text
mood:       lonely
character:  女孩
setting:    雨夜街道
action:     走
pacing:     慢
tone:       忧郁
duration:   30s（默认）
```

---

### 10.3 Step 4：Scene Graph 查询

```text
角色：       Character001（女孩）
初始位置：   [0, 0, 0]
最终位置：   [10, 0, 0]（沿街道走 10m）
道具：       Streetlamp001 / Streetlamp002 / Streetlamp003
环境：       Rain / Night / Neon Lights
```

---

### 10.4 Step 5：生成 Keyframe 骨架

```text
Master:
  duration: 30
  fps: 30
  resolution: 4K

Camera Keyframes:
  [0s]   位置=[-5,2,5]   焦距=35    景深=浅
  [10s]  位置=[-3,2,3]   焦距=50    景深=浅
  [20s]  位置=[0,2,2]    焦距=85    景深=极浅
  [30s]  位置=[3,2,2]    焦距=85    景深=极浅

Character Keyframes:
  [0s]   Position=[0,0,0]  动作=走   表情=低头
  [15s]  Position=[5,0,0]  动作=停   表情=抬头
  [30s]  Position=[10,0,0] 动作=走   表情=平静

Environment Keyframes:
  [0s]   Rain=中  Neon=亮
  [30s]  Rain=弱  Neon=渐暗

AI Events:
  [15s]  target=Character001  action=StopWalking
  [15s]  target=Character001  action=LookUp
```

---

### 10.5 Step 6：Camera Motion Generator 补充

参考 Chapter 26 §9（[L11578](file:///c:/Users/yangx/Desktop/2号想法/PixelForge_技术实现路线.md#L11578)）：

```text
[0s-10s]   Movement: Dolly In
           Speed: Slow
           Acceleration: Smooth
           Lens: 35mm

[10s-20s]  Movement: Track
           Speed: Slow
           Lens: 50mm

[20s-30s]  Movement: Steadicam
           Speed: Slow
           Lens: 85mm
```

---

### 10.6 最终输出

合并为 Chapter 26 可消费的格式：

```json
{
  "master": { "duration": 30, "fps": 30, "resolution": "4K" },
  "keyframes": [
    { "time": 0, "target": "Camera", "property": "Position", "value": [-5,2,5], "interpolation": "Smooth" },
    { "time": 0, "target": "Camera", "property": "焦距", "value": 35, "interpolation": "Linear" },
    { "time": 0, "target": "Character001", "property": "Position", "value": [0,0,0], "interpolation": "Linear" }
  ],
  "events": [
    { "time": 15, "target": "Character001", "action": "StopWalking" },
    { "time": 15, "target": "Character001", "action": "LookUp" }
  ]
}
```

---

## 11. 现有代码现状

### 11.1 项目结构

```text
my-app/
├── src/
│   ├── components/HelloWorld.vue   （Vue demo，非业务）
│   ├── stores/counter.ts           （Pinia demo，非业务）
│   ├── App.vue                     （Vue demo）
│   ├── env.d.ts
│   ├── main.ts
│   └── style.css
├── src-tauri/
│   ├── src/lib.rs                  （Tauri 默认配置 + 未注册的 greet 命令）
│   ├── Cargo.toml
│   └── tauri.conf.json             （productName 仍为 "My App"）
├── package.json                    （Vue 3.5.39 + Pinia 4.0.2 + vue-router 4.6.4）
└── Cargo.toml
```

---

### 11.2 关键缺失

```text
- 无 src/director/ 目录
- 无 src/compiler/ 目录
- 无 src/gpu/ 目录
- 无 shader.wgsl 文件
- 无 WebGPU 初始化代码
- 无 LLM 调用代码
- 无 Persona 配置文件
- 无 callLLM() 实现（Chapter 22 P1）
- 无 generateId() 实现（Chapter 22 P0）
- 无 IEncoder 实现（Chapter 22 P0）
- Rust 侧仅有未注册的 greet 命令
```

---

### 11.3 含义

Chapter 27 描述的是**从零开始的设计规范**，不是对齐既有实现的补丁。

实现顺序应：

```text
1. 先完成 Chapter 22 的 P0 项（generateId / IEncoder / resizeImage）
2. 再完成 P1 项（callLLM / ColorBlockTree.toLLMView）
3. 然后才能启动 AI Director 实现
```

---

## 12. Chapter 22 TODO 同步建议

按 Chapter 22 §22.1-22.6 的表格格式，本章引入的待定义项应同步追加到 Chapter 22。

### 12.1 工具函数（追加到 §22.2）

| 名称 | 位置 | 说明 | 实现方向 |
|------|------|------|----------|
| `parsePrompt()` | 27.3.3 | 解析 User Prompt 为 Intent | 调用 `callLLM()`，输出 mood/character/setting/action/pacing/tone 等字段 |
| `selectPersona()` | 27.4.4 | 根据 Intent 选择 Persona | 规则匹配 + LLM 推断 |
| `querySceneForDirector()` | 27.5.3 | 从 Scene Graph 查询导演所需信息 | 待 Chapter 24 追加查询 API 后实现 |
| `generateKeyframes()` | 27.5.2 | 生成 Keyframe 序列 | 调用 Chapter 26 §22 AI 自动生成时间轴 |
| `generateEvents()` | 27.5.2 | 生成 AI Event 序列 | 基于 Intent + Scene Graph 生成 Event 列表 |
| `generateRevisionRequest()` | 27.6.3 | 生成修改请求 | 输出 Revision Request，提交给 Chapter 25 §4 Revision Layer |

---

### 12.2 类型定义（追加到 §22.3）

| 名称 | 位置 | 说明 | 实现方向 |
|------|------|------|----------|
| `DirectorIntent` | 27.3 | 导演意图结构 | 包含 mood/character/setting/action/pacing/tone/duration |
| `RevisionIntent` | 27.6 | 修改意图结构 | 包含 target_range/direction/scope |
| `DirectorPersona` | 27.4.2 | 导演人格 | 包含 name/shot_type/camera_motion/pacing/color/lighting/signature/avoids |
| `TimelineContent` | 27.2.2 | AI Director 输出 | 包含 master/keyframes/events |
| `NarrativeImportance` | 27.5.4 | 叙事重要性输入 | 提供给 Chapter 25 §25.5 Detail Score 公式 |

---

### 12.3 接口契约（追加到 §22.5）

| 名称 | 位置 | 说明 | 契约 |
|------|------|------|------|
| `IAIDirector.create()` | 27.5 | 生成模式入口 | 输入 User Prompt + Persona，输出 TimelineContent |
| `IAIDirector.revise()` | 27.6 | 修改模式入口 | 输入 RevisionIntent，输出 Revision Request |
| `IAIDirector.explain()` | 27.9.1 | 解释决策 | 输入 Keyframe ID，输出自然语言解释 |
| `ISceneGraphForDirector.query()` | 27.5.3 | Scene Graph 查询接口 | 待 Chapter 24 追加，提供位置/朝向/关系查询 |

---

### 12.4 不另写优先级表

Chapter 22 §22.6 的 P0-P3 表格**没有正式定义**每一级含义，仅以"原因"列描述。

本章不另写优先级表。

实现顺序应按 Chapter 22 现有 P0 优先级推进：

```text
1. 完成 Chapter 22 §22.6 中所有 P0 项
2. 完成 Chapter 22 §22.6 中所有 P1 项
3. 启动 AI Director 实现（基于本章 §12.1-12.3 追加的 TODO）
4. Chapter 22 §22.6 中 P2/P3 按需推进
```

---

## 13. Chapter 27 总结

### 13.1 本章核心

```text
AI Director 是 User Prompt → Timeline Generator 之间的中间层
       +
AI Director 是 AI Revision System 的高级修改模式
```

---

### 13.2 与现有 Chapter 的对齐

| Chapter | 关系 |
|---------|------|
| Chapter 22 | 本章引入的 TODO 应追加到 Chapter 22（见 §12） |
| Chapter 24 Scene Graph | AI Director 通过 Scene Graph 查询空间信息（查询 API 待 Chapter 24 追加） |
| Chapter 25 §25.5 Detail System | AI Director 提供 Narrative Importance 输入 |
| Chapter 25 §25.24 Detail Consistency | AI Director 不破坏此一致性 |
| Chapter 25 §26.13 Asset Genome Mutation | AI Director 可触发 Safe + Creative 变异 |
| Chapter 25 §29 AI Director 模式 | 本章是 §29 的完整规范，建议 §29 改为引用本章 |
| Chapter 25 §30 Revision Compiler | AI Director 修改模式走此流程 |
| Chapter 26 §4 9 条 Track | AI Director 为每条 Track 生成对应内容 |
| Chapter 26 §9 Camera Motion Generator | AI Director 调用此模块生成运镜细节 |
| Chapter 26 §22 AI自动生成时间轴 | AI Director 调用此模块生成 Keyframe |
| Chapter 26 §26 AI Cut System | 未来模块，与 AI Director 修改模式协同 |
| Chapter 26 §30 AI Interpolation | AI Director 不直接参与，由 Timeline 内部使用 |

---

### 13.3 不引入的过度设计

为避免初稿的过度设计问题，本章**不引入**：

```text
- 不定义 Shot List 数据结构（Timeline 不消费此结构）
- 不定义 CameraKeyframe 独立类型（用 Chapter 26 §29 统一 Keyframe）
- 不定义 MasterClip（文档中不存在此概念）
- 不定义 Transition 类型（文档中不存在此概念）
- 不定义 ShotLock（用 Chapter 24 §24.22 Object Lock）
- 不定义 Mutation Consistency（用 Chapter 25 §25.24 Detail Consistency）
- 不自创 P0-P3 分级标准（用 Chapter 22 §22.6 现有格式）
- 不写大量 TypeScript interface（按文档风格用流程图 + JSON 示例）
```

---

### 13.4 留待讨论的开放问题

以下问题本章不强行决定，留待实现时讨论：

```text
1. Persona Mix 的具体算法
   （直接加权平均？主从式？保留待定）

2. AI Director 是否需要"导演剧本"中间表示
   （类似 Story/Scene/Beat/Shot 层级？或直接 Prompt → Keyframe？）

3. 修改模式下，AI Director 与 AI Revision System 的边界
   （§29 把 AI Director 放在 AI Revision System 内部，
    但生成模式又独立于 Revision System。
    边界如何划分？）

4. Audio Track 的处理
   （Chapter 26 §4 列出但未定义字段，
    AI Director 在声音上能力受限，是否需要独立的 Audio Director 模块？）

5. AI Cut System（Chapter 26 §26）与 AI Director 修改模式的关系
   （AI Cut 删除无聊部分，AI Director 修改任意方面，
    是否合并？或保持独立？）
```

---

Chapter 27 完。

---
