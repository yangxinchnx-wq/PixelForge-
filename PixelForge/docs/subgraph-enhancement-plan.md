# PixelForge 节点图子图增强方案

## 1. 背景与目标

### 1.1 现状分析
当前节点图实现（Step 25）具备：
- 基本数据结构（GraphNode、GraphEdge、Port）
- 编译流程（GraphCompiler → RenderIR）
- 节点注册表（NodeRegistry）
- UI组件（GraphEditor、GraphNode、GraphCanvas）

**局限性**：
- 不支持子图（SubGraph）机制
- 节点无法复用，复杂场景难以管理
- 缺乏模块化设计

### 1.2 参考对象
**Gigi (EA SEED)** 的子图机制：
- 子图作为独立`.gg`文件
- 通过`SubGraph`节点引用
- 编译时递归内联（`InlineSubGraphs`）
- 变量替换和重命名确保唯一性

### 1.3 目标
1. **子图复用**：将常用节点组合封装为可复用模块
2. **模块化设计**：支持复杂场景的分层管理
3. **AI友好**：子图作为AI Director的能力单元
4. **向后兼容**：不影响现有节点图功能

## 2. 技术方案

### 2.1 数据结构扩展

#### 2.1.1 子图定义（SubGraphDefinition）
```typescript
// src/graph/types.ts 新增
export interface SubGraphDefinition {
  /** 子图唯一ID */
  id: string
  /** 子图名称 */
  name: string
  /** 子图描述 */
  description: string
  /** 子图版本 */
  version: string
  /** 输入端口定义 */
  inputPorts: SubGraphPort[]
  /** 输出端口定义 */
  outputPorts: SubGraphPort[]
  /** 内部节点 */
  nodes: GraphNode[]
  /** 内部边 */
  edges: GraphEdge[]
  /** 子图参数（可外部配置） */
  params: SubGraphParam[]
  /** 创建时间 */
  createdAt: number
  /** 更新时间 */
  updatedAt: number
}

export interface SubGraphPort {
  id: string
  name: string
  type: PortType
  /** 绑定到内部节点的端口 */
  boundTo: { nodeId: string; portId: string }
}

export interface SubGraphParam {
  key: string
  name: string
  type: 'number' | 'string' | 'boolean' | 'color'
  defaultValue: JsonLiteral
  description?: string
}
```

#### 2.1.2 子图节点（SubGraphNode）
```typescript
// 扩展 GraphNode 类型
export interface SubGraphNode extends GraphNode {
  type: 'SUBGRAPH'
  /** 引用的子图ID */
  subgraphId: string
  /** 子图实例参数覆盖 */
  paramOverrides: Record<string, JsonLiteral>
  /** 子图实例ID（用于区分同一子图的不同实例） */
  instanceId: string
}
```

#### 2.1.3 扩展RenderGraph
```typescript
export interface RenderGraph {
  canvas: GraphCanvas
  nodes: GraphNode[]
  edges: GraphEdge[]
  /** 新增：子图定义库 */
  subgraphLibrary: SubGraphDefinition[]
}
```

### 2.2 编译流程扩展

#### 2.2.1 子图内联算法
```typescript
// src/graph/subgraphInliner.ts
export function inlineSubGraphs(graph: RenderGraph): RenderGraph {
  // 1. 深拷贝图（避免修改原图）
  const inlinedGraph = deepClone(graph)
  
  // 2. 递归内联子图节点
  let hasChanges = true
  while (hasChanges) {
    hasChanges = false
    
    for (const node of inlinedGraph.nodes) {
      if (node.type !== 'SUBGRAPH') continue
      
      const subgraphDef = inlinedGraph.subgraphLibrary
        .find(sg => sg.id === (node as SubGraphNode).subgraphId)
      
      if (!subgraphDef) {
        throw new Error(`子图定义未找到: ${(node as SubGraphNode).subgraphId}`)
      }
      
      // 3. 内联子图到主图
      inlineSingleSubGraph(inlinedGraph, node as SubGraphNode, subgraphDef)
      hasChanges = true
      break // 重新开始循环，因为节点列表已改变
    }
  }
  
  // 4. 清理子图定义（编译后不再需要）
  inlinedGraph.subgraphLibrary = []
  
  return inlinedGraph
}

function inlineSingleSubGraph(
  graph: RenderGraph,
  subgraphNode: SubGraphNode,
  subgraphDef: SubGraphDefinition
): void {
  // 1. 为内部节点生成唯一ID（避免冲突）
  const idMap = new Map<string, string>()
  const instancePrefix = subgraphNode.instanceId
  
  for (const internalNode of subgraphDef.nodes) {
    const newId = `${instancePrefix}_${internalNode.id}`
    idMap.set(internalNode.id, newId)
  }
  
  // 2. 克隆内部节点并重命名ID
  const clonedNodes: GraphNode[] = subgraphDef.nodes.map(node => ({
    ...deepClone(node),
    id: idMap.get(node.id)!,
    // 调整位置（相对于子图节点位置）
    position: {
      x: subgraphNode.position.x + node.position.x,
      y: subgraphNode.position.y + node.position.y,
    }
  }))
  
  // 3. 克隆内部边并重命名端点
  const clonedEdges: GraphEdge[] = subgraphDef.edges.map(edge => ({
    ...deepClone(edge),
    id: `${idMap.get(edge.from)}:${edge.fromPort}->${idMap.get(edge.to)}:${edge.toPort}`,
    from: idMap.get(edge.from)!,
    to: idMap.get(edge.to)!,
  }))
  
  // 4. 处理输入端口连接
  for (const inputPort of subgraphDef.inputPorts) {
    const boundNodeId = idMap.get(inputPort.boundTo.nodeId)!
    const boundPortId = inputPort.boundTo.portId
    
    // 查找连接到子图输入端口的外部边
    const incomingEdges = graph.edges.filter(e => 
      e.to === subgraphNode.id && e.toPort === inputPort.id
    )
    
    // 重定向外部边到内部节点
    for (const edge of incomingEdges) {
      edge.to = boundNodeId
      edge.toPort = boundPortId
    }
  }
  
  // 5. 处理输出端口连接
  for (const outputPort of subgraphDef.outputPorts) {
    const boundNodeId = idMap.get(outputPort.boundTo.nodeId)!
    const boundPortId = outputPort.boundTo.portId
    
    // 查找从子图输出端口发出的外部边
    const outgoingEdges = graph.edges.filter(e => 
      e.from === subgraphNode.id && e.fromPort === outputPort.id
    )
    
    // 重定向外部边到内部节点
    for (const edge of outgoingEdges) {
      edge.from = boundNodeId
      edge.fromPort = boundPortId
    }
  }
  
  // 6. 处理参数替换
  for (const param of subgraphDef.params) {
    const overrideValue = subgraphNode.paramOverrides[param.key]
    if (overrideValue !== undefined) {
      // 在内部节点中查找使用该参数的地方
      replaceParamInNodes(clonedNodes, param.key, overrideValue)
    }
  }
  
  // 7. 移除子图节点，添加内部节点和边
  const nodeIndex = graph.nodes.findIndex(n => n.id === subgraphNode.id)
  graph.nodes.splice(nodeIndex, 1, ...clonedNodes)
  graph.edges.push(...clonedEdges)
}
```

#### 2.2.2 GraphCompiler集成
```typescript
// src/graph/graphCompiler.ts 修改
export function compileGraph(
  graph: RenderGraph,
  options: CompileOptions = {}
): CompileResult {
  // 1. 新增：子图内联
  const inlinedGraph = inlineSubGraphs(graph)
  
  // 2. 验证（现有逻辑）
  const validation = validateGraph(inlinedGraph)
  if (!validation.valid) {
    return {
      ir: { layers: [], effects: [], regions: [] },
      topologicalOrder: [],
      nodeToEntity: {},
      warnings: validation.errors,
    }
  }
  
  // 3. 拓扑排序（现有逻辑）
  const topologicalOrder = topologicalSort(inlinedGraph)
  
  // 4. 编译为RenderIR（现有逻辑）
  // ... 其余代码不变
}
```

### 2.3 UI交互设计

#### 2.3.1 子图节点类型
在`nodeRegistry.ts`中添加：
```typescript
{
  key: 'SubGraph',
  label: '子图',
  type: 'SUBGRAPH',
  description: '引用已定义的子图模块',
  inputs: [], // 动态生成
  outputs: [], // 动态生成
  defaultParams: {},
  category: 'composite',
}
```

#### 2.3.2 子图管理面板
新增组件：`src/components/editor/graph/SubGraphPanel.vue`
- 子图库列表
- 创建新子图
- 导入/导出子图
- 子图预览

#### 2.3.3 子图编辑模式
- 双击子图节点进入编辑模式
- 显示子图内部结构
- 支持参数覆盖配置

### 2.4 文件格式

#### 2.4.1 子图文件（.pfg）
```json
{
  "version": "1.0.0",
  "id": "subgraph_noise_effect",
  "name": "噪声效果",
  "description": "噪声 + 模糊 + 颜色调整的标准组合",
  "inputPorts": [
    {
      "id": "input",
      "name": "背景",
      "type": "texture",
      "boundTo": { "nodeId": "noise_node", "portId": "input" }
    }
  ],
  "outputPorts": [
    {
      "id": "output",
      "name": "效果",
      "type": "texture",
      "boundTo": { "nodeId": "color_shift_node", "portId": "output" }
    }
  ],
  "nodes": [
    {
      "id": "noise_node",
      "type": "REGION",
      "name": "噪声",
      "opcodeName": "NOISE",
      "position": { "x": 0, "y": 0 },
      "inputs": [{ "id": "input", "name": "背景", "type": "texture" }],
      "outputs": [{ "id": "output", "name": "纹理", "type": "texture" }],
      "params": { "scale": 2.0, "octaves": 4 }
    },
    {
      "id": "blur_node",
      "type": "EFFECT",
      "name": "模糊",
      "opcodeName": "blur",
      "position": { "x": 250, "y": 0 },
      "inputs": [{ "id": "input", "name": "源", "type": "texture" }],
      "outputs": [{ "id": "output", "name": "纹理", "type": "texture" }],
      "params": { "radius": 5.0 }
    },
    {
      "id": "color_shift_node",
      "type": "EFFECT",
      "name": "颜色调整",
      "opcodeName": "colorShift",
      "position": { "x": 500, "y": 0 },
      "inputs": [{ "id": "input", "name": "源", "type": "texture" }],
      "outputs": [{ "id": "output", "name": "纹理", "type": "texture" }],
      "params": { "hue": 0.1, "saturation": 1.2 }
    }
  ],
  "edges": [
    {
      "id": "noise_node:output->blur_node:input",
      "from": "noise_node",
      "fromPort": "output",
      "to": "blur_node",
      "toPort": "input"
    },
    {
      "id": "blur_node:output->color_shift_node:input",
      "from": "blur_node",
      "fromPort": "output",
      "to": "color_shift_node",
      "toPort": "input"
    }
  ],
  "params": [
    {
      "key": "noiseScale",
      "name": "噪声缩放",
      "type": "number",
      "defaultValue": 2.0,
      "description": "噪声的缩放比例"
    }
  ],
  "createdAt": 1691234567890,
  "updatedAt": 1691234567890
}
```

## 3. 实施计划

### 3.1 Phase 1：基础子图支持（2周）
1. 扩展数据结构（types.ts）
2. 实现子图内联算法（subgraphInliner.ts）
3. 修改GraphCompiler集成内联
4. 添加子图节点类型到NodeRegistry

### 3.2 Phase 2：UI交互（2周）
1. 子图管理面板
2. 子图节点动态端口
3. 子图编辑模式
4. 参数覆盖配置

### 3.3 Phase 3：文件系统（1周）
1. 子图文件格式定义
2. 导入/导出功能
3. 子图版本管理

### 3.4 Phase 4：AI集成（1周）
1. 子图作为AI Director的能力单元
2. 子图推荐和自动应用
3. 子图参数智能调整

## 4. 风险评估

### 4.1 技术风险
- **循环引用**：子图A引用子图B，子图B引用子图A
  - 解决方案：内联时检测循环，限制递归深度
- **性能影响**：深层子图内联可能导致图过大
  - 解决方案：限制子图嵌套层级（建议最多3层）

### 4.2 兼容性风险
- **现有图破坏**：子图内联可能改变节点顺序
  - 解决方案：内联后重新验证图结构
- **UI性能**：大量子图节点可能影响渲染性能
  - 解决方案：子图节点默认折叠显示

## 5. 验收标准

### 5.1 功能验收
- [ ] 能创建、编辑、删除子图定义
- [ ] 能在节点图中使用子图节点
- [ ] 子图节点能正确编译为RenderIR
- [ ] 支持子图参数覆盖
- [ ] 支持子图导入导出

### 5.2 性能验收
- [ ] 子图内联时间 < 100ms（100个节点规模）
- [ ] 子图节点渲染不影响UI流畅度（60fps）
- [ ] 内存占用增加 < 10%

### 5.3 兼容性验收
- [ ] 现有节点图功能不受影响
- [ ] 现有测试全部通过
- [ ] vue-tsc无新增类型错误

## 6. 参考资料

1. **Gigi SubGraphs.cpp**：子图内联算法实现
2. **UE5 Blueprint**：子图/宏节点设计
3. **Unity Shader Graph**：Sub Graph节点
4. **Blender Geometry Nodes**：节点组机制

---

**文档版本**：1.0.0  
**创建时间**：2026-08-06  
**作者**：WorkBuddy  
**状态**：待评审