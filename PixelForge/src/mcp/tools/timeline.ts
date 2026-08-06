/**
 * 时间轴模块 MCP 工具。
 *
 * 暴露序列管理、关键帧操作和播放控制。
 * 共 5 个工具。
 */

import type { ToolDefinition, ToolResult } from '../types'
import type { EditorBridge } from '../bridge'
import type { ToolHandler } from '../registry'

export const timelineToolDefinitions: ToolDefinition[] = [
  {
    name: 'timeline_get_sequence',
    description:
      '获取当前活动的时间轴序列信息，包含所有轨道和关键帧数据。' +
      '序列是时间轴的基本单位，包含多个轨道（视频/音频/效果），每个轨道由关键帧组成。',
    inputSchema: { type: 'object', properties: {}, required: [] },
    module: 'timeline',
    readOnly: true,
  },
  {
    name: 'timeline_create_sequence',
    description:
      '创建一个新的时间轴序列。序列定义了视频的时间范围和帧率。' +
      'duration 单位为秒，fps 为每秒帧数（常用值：24、30、60）。',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '序列名称', minLength: 1 },
        duration: { type: 'number', description: '序列时长（秒）', minimum: 0.1, maximum: 3600 },
        fps: { type: 'number', description: '帧率', enum: [24, 25, 30, 48, 50, 60, 120] },
      },
      required: ['name', 'duration', 'fps'],
    },
    module: 'timeline',
    readOnly: false,
  },
  {
    name: 'timeline_add_keyframe',
    description:
      '在指定轨道的指定时间点添加关键帧。关键帧定义了属性在该时间点的值。' +
      '支持线性(linear)、阶跃(step)和贝塞尔(bezier)三种插值方式。',
    inputSchema: {
      type: 'object',
      properties: {
        sequenceId: { type: 'string', description: '序列 ID' },
        trackId: { type: 'string', description: '轨道 ID' },
        time: { type: 'number', description: '时间点（秒）', minimum: 0 },
        value: { type: 'string', description: '关键帧的值（number/string/boolean/array/object），JSON 字符串格式' },
        interpolation: {
          type: 'string',
          description: '插值方式',
          enum: ['linear', 'step', 'bezier'],
          default: 'linear',
        },
      },
      required: ['sequenceId', 'trackId', 'time', 'value'],
    },
    module: 'timeline',
    readOnly: false,
  },
  {
    name: 'timeline_update_keyframe',
    description:
      '修改已有关键帧的值或时间位置。只更新传入的字段。' +
      '可通过 timeline_get_sequence 获取关键帧 ID。',
    inputSchema: {
      type: 'object',
      properties: {
        keyframeId: { type: 'string', description: '关键帧 ID' },
        value: { type: 'string', description: '新的关键帧值（JSON 字符串格式）' },
        time: { type: 'number', description: '新的时间位置（秒）', minimum: 0 },
      },
      required: ['keyframeId'],
    },
    module: 'timeline',
    readOnly: false,
  },
  {
    name: 'timeline_playback_control',
    description:
      '控制时间轴的播放状态。支持播放(play)、暂停(pause)、停止(stop)和跳转(seek)。' +
      '跳转时必须提供 time 参数指定目标时间点。',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: '播放控制动作',
          enum: ['play', 'pause', 'stop', 'seek'],
        },
        time: {
          type: 'number',
          description: '跳转目标时间（秒），仅 seek 时需要',
          minimum: 0,
        },
      },
      required: ['action'],
    },
    module: 'timeline',
    readOnly: false,
  },
]

export function createTimelineTools(bridge: EditorBridge): Array<{
  definition: ToolDefinition
  handler: ToolHandler
}> {
  return [
    {
      definition: timelineToolDefinitions[0],
      handler: async (): Promise<ToolResult> => {
        const result = await bridge.getCurrentSequence()
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          isError: !result.success,
        }
      },
    },
    {
      definition: timelineToolDefinitions[1],
      handler: async (args): Promise<ToolResult> => {
        const result = await bridge.createSequence(
          args.name as string,
          args.duration as number,
          args.fps as number,
        )
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          isError: !result.success,
        }
      },
    },
    {
      definition: timelineToolDefinitions[2],
      handler: async (args): Promise<ToolResult> => {
        const result = await bridge.addKeyframe(
          args.sequenceId as string,
          args.trackId as string,
          args.time as number,
          args.value as any,
          (args.interpolation as any) ?? 'linear',
        )
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          isError: !result.success,
        }
      },
    },
    {
      definition: timelineToolDefinitions[3],
      handler: async (args): Promise<ToolResult> => {
        const result = await bridge.updateKeyframe(
          args.keyframeId as string,
          args.value as any,
          args.time as number | undefined,
        )
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          isError: !result.success,
        }
      },
    },
    {
      definition: timelineToolDefinitions[4],
      handler: async (args): Promise<ToolResult> => {
        const result = await bridge.playbackControl(
          args.action as any,
          args.time as number | undefined,
        )
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          isError: !result.success,
        }
      },
    },
  ]
}
