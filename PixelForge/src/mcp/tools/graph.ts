/**
 * 图模块 MCP 工具。
 *
 * 暴露节点图的 CRUD 操作、节点管理、连接管理和子图操作。
 * 共 8 个工具。
 */

import type { ToolDefinition, ToolResult } from '../types'
import type { EditorBridge } from '../bridge'
import type { ToolHandler } from '../registry'

// ─── 工具定义 ───

export const graphToolDefinitions: ToolDefinition[] = [
  {
    name: 'graph_get',
    description:
      '获取当前节点图的完整结构，包含所有节点、连接和画布尺寸。' +
      '在执行任何修改操作前，应先调用此工具确认当前编辑器状态。返回 JSON 格式的图数据。',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
    module: 'graph',
    readOnly: true,
  },
  {
    name: 'graph_create',
    description:
      '创建一个全新的空节点图，替换当前图。注意：此操作会清空当前所有节点和连接，' +
      '请确认用户确实需要新建图。建议先用 graph_get 获取当前图确认状态。',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '节点图名称，不能为空' },
        width: { type: 'number', description: '画布宽度（像素）', default: 1920, minimum: 1, maximum: 7680 },
        height: { type: 'number', description: '画布高度（像素）', default: 1080, minimum: 1, maximum: 4320 },
      },
      required: ['name'],
    },
    module: 'graph',
    readOnly: false,
    requiresConfirmation: true,
  },
  {
    name: 'graph_compile',
    description:
      '将当前节点图编译为 RenderIR 渲染指令集。编译前会自动执行图校验，' +
      '包括：OUTPUT 节点唯一性、无循环依赖、端口兼容性等。校验失败时返回具体错误列表。',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
    module: 'graph',
    readOnly: true,
  },
  {
    name: 'graph_add_node',
    description:
      '向当前节点图添加一个新节点。可用的节点类型（registryKey）包括：' +
      'Background（背景）、SolidColor（纯色）、Gradient（渐变）、Noise（噪声）、Checkerboard（棋盘格）、' +
      'Blur（模糊）、BrightnessContrast（亮度对比度）、ColorAdjust（色彩调整）、Grayscale（灰度）、Invert（反色）、' +
      'Composite（合成）、Output（输出）、SubGraph（子图实例）。' +
      '每个节点有唯一的输入/输出端口，添加后需要通过 graph_connect 连接到其他节点。',
    inputSchema: {
      type: 'object',
      properties: {
        registryKey: {
          type: 'string',
          description: '节点注册表键名，必须是预定义的节点类型之一',
          enum: [
            'Background', 'SolidColor', 'Gradient', 'Noise', 'Checkerboard',
            'Blur', 'BrightnessContrast', 'ColorAdjust', 'Grayscale', 'Invert',
            'Composite', 'Output', 'SubGraph',
          ],
        },
        name: { type: 'string', description: '节点显示名称', minLength: 1, maxLength: 64 },
        x: { type: 'number', description: '节点在画布上的 X 坐标', default: 0 },
        y: { type: 'number', description: '节点在画布上的 Y 坐标', default: 0 },
        params: {
          type: 'object',
          description: '节点参数（可选），键值对格式，值可以是 string/number/boolean/array',
        },
      },
      required: ['registryKey', 'name'],
    },
    module: 'graph',
    readOnly: false,
  },
  {
    name: 'graph_remove_node',
    description:
      '从当前节点图中删除指定节点及其所有关联连接。删除前请确认不会破坏关键数据流。' +
      '被删除的节点 ID 会从图中永久移除，相关连接也会一并断开。',
    inputSchema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: '要删除的节点 ID' },
      },
      required: ['nodeId'],
    },
    module: 'graph',
    readOnly: false,
  },
  {
    name: 'graph_connect',
    description:
      '在两个节点之间建立数据流连接。连接规则：' +
      '(1) 不能连接到自身；(2) 同一对端口不能重复连接；(3) 端口类型必须兼容（texture→texture）；' +
      '(4) 不能产生循环依赖。连接成功后返回新建的边信息。',
    inputSchema: {
      type: 'object',
      properties: {
        fromNodeId: { type: 'string', description: '源节点 ID' },
        fromPortId: { type: 'string', description: '源节点输出端口 ID' },
        toNodeId: { type: 'string', description: '目标节点 ID' },
        toPortId: { type: 'string', description: '目标节点输入端口 ID' },
      },
      required: ['fromNodeId', 'fromPortId', 'toNodeId', 'toPortId'],
    },
    module: 'graph',
    readOnly: false,
  },
  {
    name: 'graph_disconnect',
    description:
      '断开两个节点之间的连接。通过边 ID 指定要断开的连接。' +
      '可通过 graph_get 获取当前所有连接的 ID。',
    inputSchema: {
      type: 'object',
      properties: {
        edgeId: { type: 'string', description: '要断开的边 ID' },
      },
      required: ['edgeId'],
    },
    module: 'graph',
    readOnly: false,
  },
  {
    name: 'graph_update_node_params',
    description:
      '更新指定节点的参数。参数以键值对格式提供，只更新传入的字段，未传入的字段保持不变。' +
      '常用参数示例：color(颜色值)、radius(模糊半径)、brightness(亮度)、opacity(不透明度)。',
    inputSchema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: '节点 ID' },
        params: {
          type: 'object',
          description: '要更新的参数键值对',
        },
      },
      required: ['nodeId', 'params'],
    },
    module: 'graph',
    readOnly: false,
  },
]

// ─── 工具处理器 ───

/**
 * 创建图模块工具处理器列表。
 *
 * 每个处理器绑定到 EditorBridge，实现具体的图操作逻辑。
 */
export function createGraphTools(bridge: EditorBridge): Array<{
  definition: ToolDefinition
  handler: ToolHandler
}> {
  return [
    {
      definition: graphToolDefinitions[0],
      handler: async (): Promise<ToolResult> => {
        const result = await bridge.getCurrentGraph()
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          isError: !result.success,
        }
      },
    },
    {
      definition: graphToolDefinitions[1],
      handler: async (args): Promise<ToolResult> => {
        const result = await bridge.createGraph(
          args.name as string,
          (args.width as number) ?? 1920,
          (args.height as number) ?? 1080,
        )
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          isError: !result.success,
        }
      },
    },
    {
      definition: graphToolDefinitions[2],
      handler: async (): Promise<ToolResult> => {
        const result = await bridge.compileGraph()
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          isError: !result.success,
        }
      },
    },
    {
      definition: graphToolDefinitions[3],
      handler: async (args): Promise<ToolResult> => {
        const result = await bridge.addNode(
          args.registryKey as any,
          args.name as string,
          { x: (args.x as number) ?? 0, y: (args.y as number) ?? 0 },
          (args.params as any) ?? {},
        )
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          isError: !result.success,
        }
      },
    },
    {
      definition: graphToolDefinitions[4],
      handler: async (args): Promise<ToolResult> => {
        const result = await bridge.removeNode(args.nodeId as string)
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          isError: !result.success,
        }
      },
    },
    {
      definition: graphToolDefinitions[5],
      handler: async (args): Promise<ToolResult> => {
        const result = await bridge.connectNodes(
          args.fromNodeId as string,
          args.fromPortId as string,
          args.toNodeId as string,
          args.toPortId as string,
        )
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          isError: !result.success,
        }
      },
    },
    {
      definition: graphToolDefinitions[6],
      handler: async (args): Promise<ToolResult> => {
        const result = await bridge.disconnectNodes(args.edgeId as string)
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          isError: !result.success,
        }
      },
    },
    {
      definition: graphToolDefinitions[7],
      handler: async (args): Promise<ToolResult> => {
        const result = await bridge.updateNodeParams(
          args.nodeId as string,
          args.params as any,
        )
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          isError: !result.success,
        }
      },
    },
  ]
}
