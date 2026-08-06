# PixelForge 纹理读写分离（UAV Split）设计文档

> **实现状态：已实现（2026-08-06）** — 核心模块 + 23 个单元测试 + 真实 GPU 后端均已落地。
> 代码位于 `src/runtime/uav/`，通过 `src/runtime/uav/index.ts` 统一导出。

## 1. 背景与问题

### 1.1 WebGPU限制
WebGPU对存储纹理（Storage Texture）的读写访问有严格限制：
- **支持的格式**：仅r32float、r32uint、r32sint
- **其他格式**：如rgba8unorm、rgba16float等不支持同时读写
- **限制原因**：WebGPU设计原则是跨平台兼容性，不同GPU架构对读写纹理的支持不同

### 1.2 PixelForge场景
在多Pass渲染管线中，常见场景：
1. **后处理效果**：读取场景纹理，处理后写入新纹理
2. **累积效果**：如运动模糊、景深，需要读取前一帧结果
3. **反馈效果**：如某些特效需要读写同一纹理

### 1.3 Gigi解决方案参考
Gigi的`Backend_WebGPU.cpp`实现了`PostLoad_WebGPU`函数：
1. 检测所有UAV（读写）纹理访问
2. 为不支持格式的纹理创建只读副本
3. 将原始纹理改为只写，副本作为只读
4. 修改shader声明，添加read/write限定符

## 2. 设计方案

### 2.1 核心思想
**读写分离**：将同时需要读写的纹理拆分为：
- **原始纹理**：只写（Write-Only）
- **只读副本**：只读（Read-Only）
- **复制操作**：在需要时将原始内容复制到只读副本

### 2.2 架构设计
```
┌─────────────────────────────────────────────────────┐
│                TextureAccessAnalyzer                 │
│  分析shader代码，检测纹理访问模式                     │
└─────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────┐
│                TextureSplitPlanner                   │
│  规划哪些纹理需要拆分，生成拆分方案                   │
└─────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────┐
│               TextureSplitExecutor                   │
│  执行拆分：创建副本纹理、修改绑定、注入复制操作       │
└─────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────┐
│               ShaderCodeModifier                     │
│  修改shader代码：添加read/write限定符                 │
└─────────────────────────────────────────────────────┘
```

### 2.3 数据结构
```typescript
// src/runtime/textureAccess.ts
export interface TextureAccessInfo {
  /** 纹理名称 */
  textureName: string
  /** 访问类型 */
  accessType: 'read' | 'write' | 'readwrite'
  /** 使用的shader */
  shaderName: string
  /** 使用的pass */
  passName: string
  /** 纹理格式 */
  format: GPUTextureFormat
}

export interface TextureSplitPlan {
  /** 原始纹理名称 */
  originalTexture: string
  /** 只读副本名称 */
  readOnlyCopy: string
  /** 需要修改的shader列表 */
  affectedShaders: Array<{
    shaderName: string
    /** 原始绑定组索引 */
    originalBinding: number
    /** 新增的只读绑定组索引 */
    readOnlyBinding: number
  }>
  /** 复制操作时机 */
  copyTiming: 'before-pass' | 'before-shader' | 'manual'
}

export interface TextureSplitResult {
  /** 拆分方案 */
  plan: TextureSplitPlan
  /** 新创建的只读纹理 */
  readOnlyTexture: GPUTexture
  /** 复制操作的command encoder */
  copyCommands: GPUCommandBuffer[]
}
```

### 2.4 集成到多Pass管线
```typescript
// src/runtime/multiPassPipeline.ts 扩展
export class MultiPassPipeline {
  private textureAccessAnalyzer: TextureAccessAnalyzer
  private textureSplitPlanner: TextureSplitPlanner
  private textureSplitExecutor: TextureSplitExecutor
  
  constructor(
    private device: GPUDevice,
    private options: MultiPassPipelineOptions
  ) {
    this.textureAccessAnalyzer = new TextureAccessAnalyzer()
    this.textureSplitPlanner = new TextureSplitPlanner()
    this.textureSplitExecutor = new TextureSplitExecutor(device)
  }
  
  async execute(
    frameIndex: number,
    sceneExecutor: ScenePassExecutor,
    presentExecutor: PresentPassExecutor,
    postProcessChain?: PostProcessChain
  ): Promise<MultiPassFrameResult> {
    // 1. 分析当前帧的纹理访问
    const accessInfo = this.textureAccessAnalyzer.analyze(
      sceneExecutor,
      postProcessChain
    )
    
    // 2. 规划纹理拆分
    const splitPlan = this.textureSplitPlanner.plan(accessInfo)
    
    // 3. 执行纹理拆分（创建副本、修改绑定）
    const splitResult = await this.textureSplitExecutor.execute(splitPlan)
    
    // 4. 注入复制命令到渲染流程
    this.injectCopyCommands(splitResult)
    
    // 5. 执行原始渲染流程
    const result = await this.executeOriginalPipeline(
      frameIndex,
      sceneExecutor,
      presentExecutor,
      postProcessChain
    )
    
    // 6. 清理临时资源
    this.cleanupSplitResources(splitResult)
    
    return result
  }
}
```

## 3. 实现细节

### 3.1 纹理访问分析器
```typescript
// src/runtime/textureAccessAnalyzer.ts
export class TextureAccessAnalyzer {
  /**
   * 分析shader代码，检测纹理访问模式
   */
  analyzeShaderCode(shaderCode: string): TextureAccessPattern[] {
    const patterns: TextureAccessPattern[] = []
    
    // 检测storage texture声明
    const storageTextureRegex = /var\s+(\w+)\s*:\s*texture_storage_2d<(\w+),\s*(\w+)>/g
    let match
    
    while ((match = storageTextureRegex.exec(shaderCode)) !== null) {
      const [_, name, format, access] = match
      
      patterns.push({
        textureName: name,
        format: this.parseTextureFormat(format),
        accessType: this.parseAccessType(access),
        location: match.index
      })
    }
    
    return patterns
  }
  
  /**
   * 分析渲染图，检测所有纹理访问
   */
  analyzeRenderGraph(renderGraph: RenderGraph): TextureAccessInfo[] {
    const accessInfos: TextureAccessInfo[] = []
    
    // 遍历所有pass
    for (const pass of renderGraph.passes) {
      // 分析每个pass的shader
      for (const shader of pass.shaders) {
        const patterns = this.analyzeShaderCode(shader.code)
        
        for (const pattern of patterns) {
          accessInfos.push({
            textureName: pattern.textureName,
            accessType: pattern.accessType,
            shaderName: shader.name,
            passName: pass.name,
            format: pattern.format
          })
        }
      }
    }
    
    return accessInfos
  }
}
```

### 3.2 纹理拆分规划器
```typescript
// src/runtime/textureSplitPlanner.ts
export class TextureSplitPlanner {
  /**
   * 检查纹理格式是否支持读写存储
   */
  private isFormatReadWriteSupported(format: GPUTextureFormat): boolean {
    const supportedFormats: GPUTextureFormat[] = [
      'r32float',
      'r32uint', 
      'r32sint'
    ]
    return supportedFormats.includes(format)
  }
  
  /**
   * 规划纹理拆分
   */
  plan(accessInfos: TextureAccessInfo[]): TextureSplitPlan[] {
    const plans: TextureSplitPlan[] = []
    
    // 按纹理分组
    const textureGroups = this.groupByTexture(accessInfos)
    
    for (const [textureName, accesses] of textureGroups) {
      // 检查是否同时有读和写访问
      const hasRead = accesses.some(a => a.accessType === 'read')
      const hasWrite = accesses.some(a => a.accessType === 'write')
      const hasReadWrite = accesses.some(a => a.accessType === 'readwrite')
      
      if ((hasRead && hasWrite) || hasReadWrite) {
        // 检查格式是否支持
        const format = accesses[0].format
        if (!this.isFormatReadWriteSupported(format)) {
          // 需要拆分
          plans.push(this.createSplitPlan(textureName, accesses))
        }
      }
    }
    
    return plans
  }
  
  private createSplitPlan(
    textureName: string,
    accesses: TextureAccessInfo[]
  ): TextureSplitPlan {
    const readOnlyCopyName = `${textureName}_readOnly`
    
    // 收集受影响的shader
    const affectedShaders = accesses.map(access => ({
      shaderName: access.shaderName,
      originalBinding: this.findBindingIndex(access),
      readOnlyBinding: this.allocateNewBinding(access)
    }))
    
    return {
      originalTexture: textureName,
      readOnlyCopy: readOnlyCopyName,
      affectedShaders,
      copyTiming: 'before-pass'
    }
  }
}
```

### 3.3 纹理拆分执行器
```typescript
// src/runtime/textureSplitExecutor.ts
export class TextureSplitExecutor {
  constructor(private device: GPUDevice) {}
  
  async execute(plan: TextureSplitPlan): Promise<TextureSplitResult> {
    // 1. 创建只读副本纹理
    const readOnlyTexture = await this.createReadOnlyTexture(plan)
    
    // 2. 创建复制命令
    const copyCommands = this.createCopyCommands(plan, readOnlyTexture)
    
    // 3. 修改shader绑定
    this.modifyShaderBindings(plan)
    
    return {
      plan,
      readOnlyTexture,
      copyCommands
    }
  }
  
  private async createReadOnlyTexture(
    plan: TextureSplitPlan
  ): Promise<GPUTexture> {
    // 获取原始纹理描述
    const originalTexture = this.getTextureByName(plan.originalTexture)
    
    // 创建只读副本
    return this.device.createTexture({
      label: `${plan.originalTexture}_readOnly`,
      size: originalTexture.size,
      format: originalTexture.format,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
    })
  }
  
  private createCopyCommands(
    plan: TextureSplitPlan,
    readOnlyTexture: GPUTexture
  ): GPUCommandBuffer[] {
    const commands: GPUCommandBuffer[] = []
    
    // 创建复制命令编码器
    const encoder = this.device.createCommandEncoder({
      label: `copy_${plan.originalTexture}_to_readOnly`
    })
    
    // 复制原始纹理到只读副本
    const originalTexture = this.getTextureByName(plan.originalTexture)
    encoder.copyTextureToTexture(
      { texture: originalTexture },
      { texture: readOnlyTexture },
      originalTexture.size
    )
    
    commands.push(encoder.finish())
    return commands
  }
}
```

### 3.4 Shader代码修改器
```typescript
// src/runtime/shaderCodeModifier.ts
export class ShaderCodeModifier {
  /**
   * 修改shader代码，为拆分纹理添加read/write限定符
   */
  modifyShaderCode(
    shaderCode: string,
    splitPlan: TextureSplitPlan
  ): string {
    let modifiedCode = shaderCode
    
    // 查找原始纹理声明
    const originalRegex = new RegExp(
      `var\\s+${splitPlan.originalTexture}\\s*:\\s*texture_storage_2d<([^,]+),\\s*([^>]+)>`,
      'g'
    )
    
    // 替换为只写声明
    modifiedCode = modifiedCode.replace(
      originalRegex,
      `var ${splitPlan.originalTexture} : texture_storage_2d<$1, write>`
    )
    
    // 添加只读纹理声明
    const readOnlyDeclaration = `
var ${splitPlan.readOnlyCopy} : texture_storage_2d<$1, read>;
`
    modifiedCode = readOnlyDeclaration + modifiedCode
    
    // 修改读取操作，使用只读纹理
    const readRegex = new RegExp(
      `textureLoad\\(${splitPlan.originalTexture}`,
      'g'
    )
    modifiedCode = modifiedCode.replace(
      readRegex,
      `textureLoad(${splitPlan.readOnlyCopy}`
    )
    
    return modifiedCode
  }
}
```

## 4. 集成到现有系统

### 4.1 与RenderGraph集成
```typescript
// src/runtime/renderGraph/renderGraph.ts 扩展
export class RenderGraph {
  private textureSplitExecutor: TextureSplitExecutor
  private shaderCodeModifier: ShaderCodeModifier
  
  constructor(options: RenderGraphOptions) {
    // ... 现有初始化
    this.textureSplitExecutor = new TextureSplitExecutor(options.device)
    this.shaderCodeModifier = new ShaderCodeModifier()
  }
  
  /**
   * 编译时自动处理纹理拆分
   */
  async compile(): Promise<CompiledRenderGraph> {
    // 1. 分析纹理访问
    const accessAnalyzer = new TextureAccessAnalyzer()
    const accessInfos = accessAnalyzer.analyzeRenderGraph(this)
    
    // 2. 规划拆分
    const splitPlanner = new TextureSplitPlanner()
    const splitPlans = splitPlanner.plan(accessInfos)
    
    // 3. 执行拆分
    for (const plan of splitPlans) {
      await this.textureSplitExecutor.execute(plan)
    }
    
    // 4. 修改shader代码
    this.modifyShadersForSplits(splitPlans)
    
    // 5. 继续原有编译流程
    return this.compileOriginal()
  }
}
```

### 4.2 与MaterialCompiler集成
```typescript
// src/compiler/material/materialCompiler.ts 扩展
export class MaterialCompiler {
  private shaderCodeModifier: ShaderCodeModifier
  
  /**
   * 编译材质时自动处理纹理拆分
   */
  compileMaterial(material: Material): CompiledMaterial {
    // 1. 分析材质shader
    const accessAnalyzer = new TextureAccessAnalyzer()
    const patterns = accessAnalyzer.analyzeShaderCode(material.shaderCode)
    
    // 2. 检查是否需要拆分
    const needsSplit = patterns.some(p => 
      p.accessType === 'readwrite' && 
      !this.isFormatReadWriteSupported(p.format)
    )
    
    if (needsSplit) {
      // 3. 创建拆分计划
      const splitPlan = this.createSplitPlanForMaterial(material, patterns)
      
      // 4. 修改shader代码
      material.shaderCode = this.shaderCodeModifier.modifyShaderCode(
        material.shaderCode,
        splitPlan
      )
    }
    
    // 5. 继续原有编译流程
    return this.compileMaterialOriginal(material)
  }
}
```

## 5. 性能优化

### 5.1 复制操作优化
1. **延迟复制**：只在真正需要时才复制
2. **增量复制**：只复制变化的区域
3. **异步复制**：使用WebGPU的异步API

### 5.2 内存优化
1. **纹理复用**：多个shader共享同一只读副本
2. **生命周期管理**：及时释放不再需要的只读纹理
3. **格式优化**：选择最节省内存的格式

### 5.3 缓存策略
1. **拆分结果缓存**：相同shader组合的拆分结果缓存
2. **纹理描述缓存**：避免重复创建相同规格的纹理

## 6. 测试策略

### 6.1 单元测试
```typescript
// src/runtime/__tests__/textureSplit.test.ts
describe('TextureSplit', () => {
  it('应该正确分析shader中的纹理访问', () => {
    const analyzer = new TextureAccessAnalyzer()
    const shaderCode = `
      var inputTex : texture_storage_2d<rgba8unorm, read>;
      var outputTex : texture_storage_2d<rgba8unorm, write>;
    `
    const patterns = analyzer.analyzeShaderCode(shaderCode)
    
    expect(patterns).toHaveLength(2)
    expect(patterns[0].accessType).toBe('read')
    expect(patterns[1].accessType).toBe('write')
  })
  
  it('应该为不支持格式创建拆分计划', () => {
    const planner = new TextureSplitPlanner()
    const accessInfos: TextureAccessInfo[] = [
      {
        textureName: 'sceneTexture',
        accessType: 'readwrite',
        shaderName: 'postProcess',
        passName: 'bloom',
        format: 'rgba8unorm'
      }
    ]
    
    const plans = planner.plan(accessInfos)
    
    expect(plans).toHaveLength(1)
    expect(plans[0].originalTexture).toBe('sceneTexture')
    expect(plans[0].readOnlyCopy).toBe('sceneTexture_readOnly')
  })
})
```

### 6.2 集成测试
```typescript
// src/runtime/__tests__/multiPassWithSplit.test.ts
describe('MultiPass with Texture Split', () => {
  it('应该正确执行带纹理拆分的多Pass渲染', async () => {
    const pipeline = new MultiPassPipeline(device, options)
    
    // 模拟需要读写分离的后处理效果
    const result = await pipeline.execute(
      1,
      sceneExecutor,
      presentExecutor,
      postProcessChain
    )
    
    expect(result.totalMs).toBeGreaterThan(0)
    expect(result.phases).toHaveLength(3)
  })
})
```

## 7. 风险评估

### 7.1 技术风险
- **性能开销**：纹理复制可能影响性能
  - 解决方案：优化复制策略，使用异步API
- **内存占用**：只读副本增加内存使用
  - 解决方案：及时释放，纹理复用
- **兼容性**：不同WebGPU实现可能有差异
  - 解决方案：特性检测，降级方案

### 7.2 实现风险
- **shader代码解析**：复杂shader可能解析错误
  - 解决方案：严格的语法检查，错误恢复
- **绑定组修改**：可能影响现有绑定布局
  - 解决方案：保持向后兼容，渐进式修改

## 8. 验收标准

### 8.1 功能验收
- [ ] 能正确检测需要拆分的纹理
- [ ] 能正确创建只读副本
- [ ] 能正确修改shader代码
- [ ] 能正确注入复制命令
- [ ] 能正确处理边界情况

### 8.2 性能验收
- [ ] 纹理复制开销 < 5%总渲染时间
- [ ] 内存占用增加 < 20%
- [ ] 不影响现有渲染性能

### 8.3 兼容性验收
- [ ] 兼容主流WebGPU实现
- [ ] 兼容现有shader代码
- [ ] 兼容现有渲染管线

## 9. 实施计划

### 9.1 Phase 1：基础分析（1周）
1. 实现TextureAccessAnalyzer
2. 实现纹理格式支持检测
3. 实现基础单元测试

### 9.2 Phase 2：拆分规划（1周）
1. 实现TextureSplitPlanner
2. 实现拆分方案生成
3. 实现规划算法测试

### 9.3 Phase 3：拆分执行（2周）
1. 实现TextureSplitExecutor
2. 实现ShaderCodeModifier
3. 实现与多Pass管线集成
4. 实现集成测试

### 9.4 Phase 4：优化和测试（1周）
1. 性能优化
2. 内存优化
3. 兼容性测试
4. 文档编写

## 10. 实现状态与集成方式（已实现部分）

### 10.1 实际文件结构
```
src/runtime/uav/
├── types.ts                  # 共享类型 + READ_WRITE_STORAGE_FORMATS
├── textureAccessAnalyzer.ts  # WGSL 存储纹理声明解析（纯函数）
├── textureSplitPlanner.ts    # 拆分方案生成（纯函数）
├── shaderCodeModifier.ts     # WGSL 读写分离改写（纯函数）
├── textureSplitExecutor.ts   # 执行器 + applyUavSplit 便捷入口
├── gpuBackend.ts             # GpuUavSplitBackend（GPUDevice 实现）+ recordUavCopy
├── index.ts                  # 统一导出
└── __tests__/uavSplit.test.ts# 23 个单元测试（含 Mock backend）
```

### 10.2 与原始设计 §4 的差异说明
- **未直接侵入 `RenderGraph.compile` / `MaterialCompiler.compileMaterial`**：
  原设计把拆分逻辑写进这两个类的编译流程。实测中，后处理链以 `shaderKey` 引用 shader（注册表查找），
  不直接持有 WGSL 源码；材质编译器产出 fragment shader（一般不含 `read_write` 存储纹理）。
  因此改为**独立的、GPU 注入式模块**，由调用方在合适的时机显式调用，避免破坏既有编译链路。
- **执行器解耦 GPU**：`TextureSplitExecutor` 通过 `UavSplitBackend` 接口工作，测试用 `MockUavBackend`
  验证行为；生产环境用 `GpuUavSplitBackend`（包装 `GPUDevice`）。

### 10.3 集成示例（生产环境）
```ts
import { applyUavSplit, GpuUavSplitBackend } from '@/runtime/uav'

const backend = new GpuUavSplitBackend(device)

// shaders：后处理/计算 pass 的 WGSL 源码集合
// sourceTextures：需要拆分的 read_write 纹理名 → { handle, size }
const { modifiedShaders, plans, results } = applyUavSplit(shaders, sourceTextures, backend)

// 用 modifiedShaders 重新编译受影响的 pipeline；
// 每帧在读取前确保 results[i].readOnlyTexture 已复制（GpuUavSplitBackend 默认立即提交复制）。
// 若需精确帧内时序，改用 recordUavCopy(encoder, src, dst) 并入主 encoder。
```

### 10.4 验收对照（§8）
- [x] 能正确检测需要拆分的纹理（analyzer + planner 单测覆盖）
- [x] 能正确创建只读副本（executor + GpuUavSplitBackend）
- [x] 能正确修改 shader 代码（modifier 单测覆盖 read_write→write + 读重定向）
- [x] 能正确记录复制命令（executor / recordUavCopy）
- [x] 边界情况：支持的 r32 格式不拆分、跨 shader read+write 不拆分、缺少句柄跳过执行

## 11. 参考资料

1. **WebGPU规范**：https://www.w3.org/TR/webgpu/
2. **Gigi Backend_WebGPU.cpp**：UAV Split实现
3. **WebGPU纹理格式支持**：https://gpuweb.github.io/gpuweb/#plain-color-formats
4. **WGSL存储纹理**：https://www.w3.org/TR/WGSL/#texture-storage

---

**文档版本**：1.1.0  
**创建时间**：2026-08-06  
**更新时间**：2026-08-06（补充实现状态与集成方式）  
**作者**：WorkBuddy  
**状态**：已实现