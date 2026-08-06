# PixelForge MCP协议暴露设计文档

## 1. 概述

### 1.1 背景
PixelForge是一个AI原生视频生成器，核心是AI Director翻译用户自然语言生成像素描述符。为了实现LLM对编辑器的深度控制，需要通过MCP（Model Context Protocol）协议暴露编辑器能力。

### 1.2 目标
1. **模块化暴露**：将编辑器能力封装为独立的MCP工具
2. **LLM友好**：提供清晰的工具描述和参数规范
3. **安全控制**：防止LLM执行危险操作
4. **可扩展性**：支持未来新增能力模块

### 1.3 参考对象
**GigiMCP**（EA SEED）：
- 通过`ViewerPythonFunctionList.h`宏定义工具
- 自动生成MCP工具列表
- 支持参数验证和错误处理
- 通过TCP连接GigiViewer

## 2. MCP协议规范

### 2.1 协议版本
- **MCP规范版本**：2024-11-05
- **JSON-RPC版本**：2.0
- **传输方式**：stdio（标准输入输出）

### 2.2 核心方法
1. `initialize`：初始化连接
2. `initialized`：确认初始化完成
3. `tools/list`：获取可用工具列表
4. `tools/call`：调用工具

### 2.3 工具定义格式
```json
{
  "name": "tool_name",
  "description": "工具描述",
  "inputSchema": {
    "type": "object",
    "properties": {
      "param1": {
        "type": "string",
        "description": "参数描述"
      }
    },
    "required": ["param1"]
  }
}
```

## 3. PixelForge能力模块化

### 3.1 能力分类
基于PixelForge的核心功能，划分为以下模块：

#### 3.1.1 节点图模块（Graph Module）
- **图操作**：创建、编辑、删除节点图
- **节点管理**：添加、删除、连接节点
- **子图管理**：创建、编辑、使用子图
- **编译执行**：编译节点图为RenderIR

#### 3.1.2 时间轴模块（Timeline Module）
- **序列管理**：创建、编辑、删除序列
- **关键帧操作**：添加、删除、修改关键帧
- **动画控制**：播放、暂停、跳转
- **效果应用**：添加、删除、调整效果

#### 3.1.3 渲染模块（Render Module）
- **渲染控制**：开始、暂停、恢复渲染
- **性能监控**：获取渲染性能数据
- **资源管理**：加载、卸载资源
- **输出控制**：截图、录制视频

#### 3.1.4 AI Director模块（AI Module）
- **自然语言处理**：解析用户描述
- **场景生成**：生成像素描述符
- **对话管理**：多轮对话上下文
- **意图理解**：理解用户修改意图

#### 3.1.5 资产模块（Asset Module）
- **资产浏览**：查看可用资产
- **资产加载**：加载图像、视频、3D模型
- **资产搜索**：按类型、标签搜索资产
- **资产管理**：导入、导出、删除资产

### 3.2 工具清单

#### 3.2.1 节点图工具
```typescript
// 图操作
interface GraphTools {
  // 创建新节点图
  createGraph(params: {
    name: string
    width: number
    height: number
  }): GraphResult
  
  // 获取当前节点图
  getCurrentGraph(): GraphResult
  
  // 编译节点图
  compileGraph(params: {
    graphId?: string
  }): CompileResult
}

// 节点操作
interface NodeTools {
  // 添加节点
  addNode(params: {
    type: NodeType
    name: string
    position: { x: number; y: number }
    params?: Record<string, JsonLiteral>
  }): NodeResult
  
  // 删除节点
  removeNode(params: {
    nodeId: string
  }): void
  
  // 连接节点
  connectNodes(params: {
    fromNodeId: string
    fromPortId: string
    toNodeId: string
    toPortId: string
  }): EdgeResult
  
  // 断开连接
  disconnectNodes(params: {
    edgeId: string
  }): void
}
```

#### 3.2.2 时间轴工具
```typescript
interface TimelineTools {
  // 创建序列
  createSequence(params: {
    name: string
    duration: number
    fps: number
  }): SequenceResult
  
  // 添加关键帧
  addKeyframe(params: {
    sequenceId: string
    trackId: string
    time: number
    value: JsonLiteral
  }): KeyframeResult
  
  // 修改关键帧
  updateKeyframe(params: {
    keyframeId: string
    value: JsonLiteral
  }): KeyframeResult
  
  // 删除关键帧
  removeKeyframe(params: {
    keyframeId: string
  }): void
  
  // 播放控制
  playbackControl(params: {
    action: 'play' | 'pause' | 'stop' | 'seek'
    time?: number
  }): void
}
```

#### 3.2.3 渲染工具
```typescript
interface RenderTools {
  // 开始渲染
  startRender(params: {
    outputFormat: 'png' | 'jpg' | 'mp4'
    quality?: number
  }): RenderResult
  
  // 暂停渲染
  pauseRender(): void
  
  // 恢复渲染
  resumeRender(): void
  
  // 获取渲染状态
  getRenderStatus(): RenderStatus
  
  // 截图
  takeScreenshot(params: {
    format: 'png' | 'jpg'
    quality?: number
  }): ScreenshotResult
}
```

#### 3.2.4 AI Director工具
```typescript
interface AIDirectorTools {
  // 自然语言生成
  generateFromDescription(params: {
    description: string
    style?: string
    duration?: number
  }): GenerationResult
  
  // 修改现有场景
  modifyScene(params: {
    sceneId: string
    modifications: string
  }): ModificationResult
  
  // 获取建议
  getSuggestions(params: {
    context: string
    type: 'improvement' | 'alternative' | 'optimization'
  }): SuggestionResult
}
```

#### 3.2.5 资产工具
```typescript
interface AssetTools {
  // 浏览资产
  browseAssets(params: {
    type?: AssetType
    tags?: string[]
    limit?: number
  }): AssetListResult
  
  // 加载资产
  loadAsset(params: {
    assetId: string
    targetNodeId?: string
  }): AssetResult
  
  // 搜索资产
  searchAssets(params: {
    query: string
    type?: AssetType
  }): AssetListResult
}
```

## 4. LLM规范文档

### 4.1 工具使用规范
**注意事项（≥30字）**：
在使用PixelForge MCP工具时，LLM必须严格遵守以下规范：首先，始终在调用任何工具前确认当前编辑器状态；其次，避免在没有用户明确确认的情况下执行破坏性操作；最后，确保所有参数类型正确且符合业务逻辑约束。

### 4.2 错误处理规范
1. **参数验证错误**：检查参数类型和范围
2. **状态错误**：检查编辑器当前状态是否允许操作
3. **权限错误**：检查是否有权限执行操作
4. **资源错误**：检查资源是否存在且可用

### 4.3 安全规范
1. **禁止操作**：
   - 删除系统关键文件
   - 修改系统配置
   - 执行恶意代码
   - 访问未授权资源

2. **限制操作**：
   - 文件操作需要用户确认
   - 网络请求需要白名单
   - 资源加载需要验证来源

3. **审计日志**：
   - 记录所有工具调用
   - 记录参数和结果
   - 记录错误和异常

### 4.4 性能规范
1. **批量操作**：尽量使用批量工具，减少调用次数
2. **异步处理**：长时间操作使用异步模式
3. **缓存利用**：合理使用缓存，避免重复计算
4. **资源释放**：及时释放不再使用的资源

## 5. 实现架构

### 5.1 架构图
```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   LLM/AI    │───▶│  MCP Server │───▶│   PixelForge│
│   Agent     │    │  (stdio)    │    │   Editor    │
└─────────────┘    └─────────────┘    └─────────────┘
```

### 5.2 核心组件
1. **MCP Server**：处理JSON-RPC请求
2. **工具注册器**：管理工具定义和实现
3. **参数验证器**：验证工具参数
4. **执行引擎**：执行工具逻辑
5. **结果格式化器**：格式化工具结果

### 5.3 工具定义机制
```typescript
// src/mcp/tools/decorators.ts
export function Tool(definition: ToolDefinition) {
  return function(target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    // 注册工具定义
    ToolRegistry.register(definition, target[propertyKey])
    return descriptor
  }
}

// 使用示例
class GraphTools {
  @Tool({
    name: 'create_graph',
    description: '创建新的节点图',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '节点图名称' },
        width: { type: 'number', description: '画布宽度', default: 1920 },
        height: { type: 'number', description: '画布高度', default: 1080 }
      },
      required: ['name']
    }
  })
  async createGraph(params: CreateGraphParams): Promise<GraphResult> {
    // 实现逻辑
  }
}
```

### 5.4 错误处理机制
```typescript
// src/mcp/errors.ts
export class MCPError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public data?: any
  ) {
    super(message)
  }
}

export enum ErrorCode {
  ParseError = -32700,
  InvalidRequest = -32600,
  MethodNotFound = -32601,
  InvalidParams = -32602,
  InternalError = -32603,
  // 自定义错误码
  GraphNotFound = -1001,
  NodeNotFound = -1002,
  InvalidConnection = -1003,
  CompileError = -1004,
  RenderError = -1005,
  AssetNotFound = -1006,
  TimelineError = -1007,
  AIDirectorError = -1008,
}
```

## 6. 实施计划

### 6.1 Phase 1：基础框架（1周）
1. 实现MCP Server基础框架
2. 实现工具注册机制
3. 实现参数验证
4. 实现错误处理

### 6.2 Phase 2：核心工具（2周）
1. 实现节点图工具（5个）
2. 实现时间轴工具（5个）
3. 实现渲染工具（4个）
4. 实现基础测试

### 6.3 Phase 3：高级工具（2周）
1. 实现AI Director工具（3个）
2. 实现资产工具（4个）
3. 实现工具组合和批量操作
4. 实现性能优化

### 6.4 Phase 4：文档和测试（1周）
1. 编写LLM使用规范
2. 编写API文档
3. 编写集成测试
4. 编写性能测试

## 7. 验收标准

### 7.1 功能验收
- [ ] MCP Server能正常启动和响应
- [ ] 所有工具能正确执行
- [ ] 参数验证能正确拒绝无效输入
- [ ] 错误处理能提供清晰错误信息

### 7.2 性能验收
- [ ] 工具调用响应时间 < 100ms（简单操作）
- [ ] 工具调用响应时间 < 1s（复杂操作）
- [ ] 支持并发工具调用
- [ ] 内存占用稳定

### 7.3 安全验收
- [ ] 能阻止危险操作
- [ ] 能验证参数安全性
- [ ] 能记录审计日志
- [ ] 能限制资源访问

### 7.4 兼容性验收
- [ ] 兼容主流LLM（GPT-4、Claude、Gemini）
- [ ] 兼容MCP协议规范
- [ ] 兼容不同操作系统
- [ ] 兼容不同Node.js版本

## 8. 风险评估

### 8.1 技术风险
- **协议兼容性**：MCP协议可能更新
  - 解决方案：设计可扩展的协议解析器
- **性能瓶颈**：大量工具调用可能影响性能
  - 解决方案：实现工具缓存和批量处理
- **内存泄漏**：长时间运行可能内存泄漏
  - 解决方案：实现资源管理和垃圾回收

### 8.2 安全风险
- **权限提升**：LLM可能尝试越权操作
  - 解决方案：严格的权限检查和沙箱环境
- **数据泄露**：敏感数据可能通过工具暴露
  - 解决方案：数据脱敏和访问控制
- **拒绝服务**：恶意调用可能导致服务不可用
  - 解决方案：速率限制和资源限制

## 9. 参考资料

1. **MCP协议规范**：https://modelcontextprotocol.io/specification/2024-11-05
2. **GigiMCP实现**：GigiMCP/main.cpp
3. **JSON-RPC 2.0规范**：https://www.jsonrpc.org/specification
4. **TypeScript装饰器**：https://www.typescriptlang.org/docs/handbook/decorators.html

---

**文档版本**：1.0.0  
**创建时间**：2026-08-06  
**作者**：WorkBuddy  
**状态**：待评审