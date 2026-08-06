/**
 * 渲染模块 MCP 工具。
 *
 * 暴露渲染控制、状态查询和截图功能。
 * 共 4 个工具。
 */

import type { ToolDefinition, ToolResult } from '../types'
import type { EditorBridge } from '../bridge'
import type { ToolHandler } from '../registry'

export const renderToolDefinitions: ToolDefinition[] = [
  {
    name: 'render_start',
    description:
      '启动渲染流程，将当前节点图编译后的 RenderIR 执行渲染并输出为指定格式。' +
      '输出格式支持 PNG（单帧图片）、JPG（压缩单帧）和 MP4（视频）。' +
      'quality 参数范围 1-100，值越高画质越好但文件越大。渲染为异步操作，需用 render_status 查询进度。',
    inputSchema: {
      type: 'object',
      properties: {
        outputFormat: {
          type: 'string',
          description: '输出格式',
          enum: ['png', 'jpg', 'mp4'],
        },
        quality: {
          type: 'number',
          description: '输出质量（1-100）',
          minimum: 1,
          maximum: 100,
          default: 90,
        },
      },
      required: ['outputFormat'],
    },
    module: 'render',
    readOnly: false,
  },
  {
    name: 'render_pause',
    description: '暂停正在进行的渲染。已渲染的帧会保留，可通过 render_resume 恢复。',
    inputSchema: { type: 'object', properties: {}, required: [] },
    module: 'render',
    readOnly: false,
  },
  {
    name: 'render_resume',
    description: '恢复之前暂停的渲染，从中断处继续。',
    inputSchema: { type: 'object', properties: {}, required: [] },
    module: 'render',
    readOnly: false,
  },
  {
    name: 'render_status',
    description:
      '获取当前渲染的实时状态，包括：渲染状态(idle/rendering/paused/completed/error)、' +
      '进度百分比、当前帧号和总帧数。可用于轮询渲染进度。',
    inputSchema: { type: 'object', properties: {}, required: [] },
    module: 'render',
    readOnly: true,
  },
]

export function createRenderTools(bridge: EditorBridge): Array<{
  definition: ToolDefinition
  handler: ToolHandler
}> {
  return [
    {
      definition: renderToolDefinitions[0],
      handler: async (args): Promise<ToolResult> => {
        const result = await bridge.startRender(
          args.outputFormat as any,
          (args.quality as number) ?? 90,
        )
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          isError: !result.success,
        }
      },
    },
    {
      definition: renderToolDefinitions[1],
      handler: async (): Promise<ToolResult> => {
        const result = await bridge.pauseRender()
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          isError: !result.success,
        }
      },
    },
    {
      definition: renderToolDefinitions[2],
      handler: async (): Promise<ToolResult> => {
        const result = await bridge.resumeRender()
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          isError: !result.success,
        }
      },
    },
    {
      definition: renderToolDefinitions[3],
      handler: async (): Promise<ToolResult> => {
        const result = await bridge.getRenderStatus()
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          isError: false,
        }
      },
    },
  ]
}
