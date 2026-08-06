/**
 * 资产模块 MCP 工具。
 *
 * 暴露资产浏览、搜索和加载功能。
 * 共 3 个工具。
 */

import type { ToolDefinition, ToolResult } from '../types'
import type { EditorBridge } from '../bridge'
import type { ToolHandler } from '../registry'

export const assetToolDefinitions: ToolDefinition[] = [
  {
    name: 'asset_browse',
    description:
      '浏览可用资产库。可按类型和标签过滤。支持的资产类型：' +
      'image(图片)、video(视频)、audio(音频)、3d-model(3D模型)、shader(着色器)、font(字体)。' +
      '返回资产列表，包含 ID、名称、类型、标签、大小等信息。',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description: '资产类型过滤',
          enum: ['image', 'video', 'audio', '3d-model', 'shader', 'font'],
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: '标签过滤（数组中任一标签匹配即可）',
        },
        limit: {
          type: 'number',
          description: '返回数量上限',
          default: 20,
          minimum: 1,
          maximum: 100,
        },
      },
      required: [],
    },
    module: 'asset',
    readOnly: true,
  },
  {
    name: 'asset_search',
    description:
      '通过关键词搜索资产。搜索范围包括资产名称、描述和标签。' +
      '可指定类型缩小搜索范围。返回匹配的资产列表。',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '搜索关键词',
          minLength: 1,
          maxLength: 200,
        },
        type: {
          type: 'string',
          description: '资产类型过滤',
          enum: ['image', 'video', 'audio', '3d-model', 'shader', 'font'],
        },
      },
      required: ['query'],
    },
    module: 'asset',
    readOnly: true,
  },
  {
    name: 'asset_load',
    description:
      '将指定资产加载到节点图中。如果提供了 targetNodeId，资产会被绑定到该节点；' +
      '否则自动创建合适的节点类型。加载成功后返回资产信息和关联的节点。',
    inputSchema: {
      type: 'object',
      properties: {
        assetId: {
          type: 'string',
          description: '要加载的资产 ID',
        },
        targetNodeId: {
          type: 'string',
          description: '目标节点 ID（可选，不指定则自动创建节点）',
        },
      },
      required: ['assetId'],
    },
    module: 'asset',
    readOnly: false,
  },
]

export function createAssetTools(bridge: EditorBridge): Array<{
  definition: ToolDefinition
  handler: ToolHandler
}> {
  return [
    {
      definition: assetToolDefinitions[0],
      handler: async (args): Promise<ToolResult> => {
        const result = await bridge.browseAssets(
          args.type as any,
          args.tags as string[] | undefined,
          (args.limit as number) ?? 20,
        )
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          isError: !result.success,
        }
      },
    },
    {
      definition: assetToolDefinitions[1],
      handler: async (args): Promise<ToolResult> => {
        const result = await bridge.searchAssets(
          args.query as string,
          args.type as any,
        )
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          isError: !result.success,
        }
      },
    },
    {
      definition: assetToolDefinitions[2],
      handler: async (args): Promise<ToolResult> => {
        const result = await bridge.loadAsset(
          args.assetId as string,
          args.targetNodeId as string | undefined,
        )
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          isError: !result.success,
        }
      },
    },
  ]
}
