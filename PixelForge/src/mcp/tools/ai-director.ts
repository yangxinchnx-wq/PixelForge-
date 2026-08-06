/**
 * AI Director 模块 MCP 工具。
 *
 * 暴露自然语言生成、场景修改和建议获取功能。
 * 共 3 个工具。
 */

import type { ToolDefinition, ToolResult } from '../types'
import type { EditorBridge } from '../bridge'
import type { ToolHandler } from '../registry'

export const aiDirectorToolDefinitions: ToolDefinition[] = [
  {
    name: 'ai_generate',
    description:
      '通过自然语言描述生成节点图。AI Director 会将用户描述翻译为像素描述符，' +
      '自动创建对应的节点图结构。描述应尽量具体，包含风格、色调、运动等视觉要素。' +
      'style 可选值：cinematic(电影感)、anime(动漫)、realistic(写实)、abstract(抽象)。',
    inputSchema: {
      type: 'object',
      properties: {
        description: {
          type: 'string',
          description: '视频场景的自然语言描述，需包含足够的视觉细节',
          minLength: 5,
          maxLength: 2000,
        },
        style: {
          type: 'string',
          description: '期望的视觉风格',
          enum: ['cinematic', 'anime', 'realistic', 'abstract'],
        },
        duration: {
          type: 'number',
          description: '视频时长（秒）',
          minimum: 0.1,
          maximum: 300,
        },
      },
      required: ['description'],
    },
    module: 'ai-director',
    readOnly: false,
  },
  {
    name: 'ai_modify_scene',
    description:
      '对已生成的场景进行自然语言修改。modifications 参数描述要做的改动，' +
      '例如"把背景换成蓝色"、"增加模糊效果"、"调整动画速度为2倍"等。' +
      'AI Director 会理解意图并修改对应的节点和参数。',
    inputSchema: {
      type: 'object',
      properties: {
        sceneId: {
          type: 'string',
          description: '场景 ID（通常是当前图的标识）',
        },
        modifications: {
          type: 'string',
          description: '自然语言描述的修改内容',
          minLength: 3,
          maxLength: 1000,
        },
      },
      required: ['sceneId', 'modifications'],
    },
    module: 'ai-director',
    readOnly: false,
  },
  {
    name: 'ai_suggest',
    description:
      '根据当前上下文获取 AI 建议。可请求三种类型的建议：' +
      'improvement(改进现有场景)、alternative(提供替代方案)、optimization(性能优化建议)。' +
      'context 参数应描述当前场景的状态或用户遇到的问题。',
    inputSchema: {
      type: 'object',
      properties: {
        context: {
          type: 'string',
          description: '当前场景的上下文描述',
          minLength: 5,
          maxLength: 1000,
        },
        type: {
          type: 'string',
          description: '建议类型',
          enum: ['improvement', 'alternative', 'optimization'],
        },
      },
      required: ['context', 'type'],
    },
    module: 'ai-director',
    readOnly: true,
  },
]

export function createAIDirectorTools(bridge: EditorBridge): Array<{
  definition: ToolDefinition
  handler: ToolHandler
}> {
  return [
    {
      definition: aiDirectorToolDefinitions[0],
      handler: async (args): Promise<ToolResult> => {
        const result = await bridge.generateFromDescription(
          args.description as string,
          args.style as string | undefined,
          args.duration as number | undefined,
        )
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          isError: !result.success,
        }
      },
    },
    {
      definition: aiDirectorToolDefinitions[1],
      handler: async (args): Promise<ToolResult> => {
        const result = await bridge.modifyScene(
          args.sceneId as string,
          args.modifications as string,
        )
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          isError: !result.success,
        }
      },
    },
    {
      definition: aiDirectorToolDefinitions[2],
      handler: async (args): Promise<ToolResult> => {
        const result = await bridge.getSuggestions(
          args.context as string,
          args.type as any,
        )
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          isError: !result.success,
        }
      },
    },
  ]
}
