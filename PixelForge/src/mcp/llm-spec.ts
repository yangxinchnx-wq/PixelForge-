/**
 * LLM 使用规范文档。
 *
 * 当 LLM 通过 MCP 协议操控 PixelForge 时，必须遵守此规范。
 * 规范内容通过 MCP 的 resources/read 暴露，或在 initialize 时返回给客户端。
 *
 * 注意事项字数要求：≥30字。
 */

/** LLM 使用规范文本 */
export const LLM_SPECIFICATION = `# PixelForge MCP 工具使用规范

## 核心原则
在使用PixelForge MCP工具时，LLM必须严格遵守以下规范：首先，始终在调用任何修改性工具前使用 graph_get 获取当前编辑器状态以确认上下文；其次，严禁在没有获得用户明确确认的情况下执行破坏性操作如 graph_create 和 graph_remove_node；再次，确保所有参数类型正确且符合业务逻辑约束，特别是节点ID和端口ID必须为已存在的有效标识符；最后，对任何不确定的操作应主动向用户询问确认，而非盲目执行可能造成不可逆数据损失的操作。

## 操作流程规范

### 1. 查询优先原则
- 任何操作前先用 \`graph_get\` 获取当前图状态
- 修改节点参数前用 \`graph_get\` 确认节点 ID 和当前参数值
- 连接前确认源端口和目标端口的类型兼容性

### 2. 破坏性操作确认
以下操作需要明确告知用户影响并等待确认：
- \`graph_create\`：会清空当前所有节点和连接
- \`graph_remove_node\`：会删除节点及其所有关联连接
- \`render_start\`：会启动渲染流程

### 3. 参数规范
- **节点 ID**：必须是图中已存在的节点 ID（通过 \`graph_get\` 获取）
- **边 ID**：必须是图中已存在的边 ID
- **registryKey**：必须是预定义的节点类型之一
- **端口 ID**：必须是对应节点定义中存在的端口

### 4. 错误处理
当工具返回错误时：
1. 检查错误消息中的具体原因
2. 如果是参数错误，重新获取正确参数后重试
3. 如果是状态错误，获取当前状态后制定新方案
4. 不要无限重试同一操作

### 5. 常见工作流

#### 创建简单场景
1. \`graph_get\` — 确认当前状态
2. \`graph_create\` — 创建新图（如果需要）
3. \`graph_add_node\` × N — 添加所需节点
4. \`graph_connect\` × M — 建立连接
5. \`graph_compile\` — 编译验证

#### 修改现有场景
1. \`graph_get\` — 获取当前图结构
2. 找到要修改的节点 ID
3. \`graph_update_node_params\` — 更新参数
4. \`graph_compile\` — 重新编译验证

#### AI 生成场景
1. \`ai_generate\` — 提供自然语言描述
2. 检查生成结果
3. \`ai_modify_scene\` — 微调修改
4. \`graph_compile\` — 编译验证

## 安全约束
- 禁止执行任何可能删除系统文件的操作
- 禁止修改系统配置
- 文件操作需要用户确认
- 所有操作都会被审计记录
`

/** 获取 LLM 规范文本 */
export function getLLMSpecification(): string {
  return LLM_SPECIFICATION
}
