import type { DataSection } from '@/components/ui/types'
import type { RuntimeFrameRecord } from '@/runtime/types'

export interface InspectorProjectionInput {
  runtimeDisplayRecord: RuntimeFrameRecord | null
  fallback: {
    status: string
    canvasFormat: string | null
    canvasSize: { width: number; height: number } | null
    outputFormat: string | null
    currentScenario: string
    currentLayerId: string | null
    currentOpcode: string | null
    lastPatchId: string | null
    lastPatchSummary: string | null
    presentedFrame: number | null
    replayStatus: string
    replayError: string | null
    runtimeError: string | null
  }
  capabilityEntries: Array<[string, string]>
}

export function createInspectorSections(input: InspectorProjectionInput): DataSection[] {
  return [    {
      title: '运行时状态',
      rows: [
        { label: '状态', value: input.runtimeDisplayRecord?.status ?? input.fallback.status },
        { label: '画布格式', value: input.fallback.canvasFormat ?? '无' },
        {
          label: '画布尺寸',
          value: formatCanvasSize(input.runtimeDisplayRecord?.canvasSize ?? input.fallback.canvasSize),
        },
        { label: '输出纹理', value: input.runtimeDisplayRecord?.outputFormat ?? input.fallback.outputFormat ?? '无' },
        { label: '当前显示帧', value: input.fallback.presentedFrame !== null ? String(input.fallback.presentedFrame) : '无' },
        { label: '回放状态', value: input.fallback.replayStatus },
        { label: '回放错误', value: input.fallback.replayError ?? '无' },
        { label: '帧错误', value: input.runtimeDisplayRecord ? (input.runtimeDisplayRecord.error ?? '无') : (input.fallback.runtimeError ?? '无') },
      ],
    },
    {
      title: '补丁调试',
      rows: [
        { label: '当前场景', value: input.runtimeDisplayRecord?.scenario ?? input.fallback.currentScenario },
        { label: '当前图层', value: input.runtimeDisplayRecord?.layerId ?? input.fallback.currentLayerId ?? '无' },
        { label: '当前指令', value: input.runtimeDisplayRecord?.opcode ?? input.fallback.currentOpcode ?? '无' },
        { label: '补丁编号', value: input.runtimeDisplayRecord?.patchId ?? input.fallback.lastPatchId ?? '无' },
        { label: '补丁摘要', value: input.runtimeDisplayRecord?.patchSummary ?? input.fallback.lastPatchSummary ?? '无' },
      ],
    },
    {
      title: '设备能力',
      rows: input.capabilityEntries.map(([label, value]) => ({ label, value })),
    },
  ]
}

function formatCanvasSize(size: { width: number; height: number } | null | undefined): string {
  if (!size) {
    return '无'
  }
  return `${size.width} × ${size.height}`
}
