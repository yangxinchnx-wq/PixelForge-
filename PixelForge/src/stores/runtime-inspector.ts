import type { DataSection } from '@/components/ui/types'
import type { ReplayErrorInfo, RuntimeFrameRecord, RuntimeErrorInfo } from '@/runtime/types'
import type { PerformanceMetrics } from '@/runtime/profiler'
import { formatBytes, formatMs } from '@/runtime/profiler'
import { getErrorCodeLabel, getSeverityLabel } from '@/shared/errors'

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
  /** 结构化运行时错误（阶段五新增） */
  runtimeErrorInfo?: RuntimeErrorInfo | null
  /** 结构化回放错误（阶段五新增） */
  replayErrorInfo?: ReplayErrorInfo | null
  /** 性能指标（阶段五 5.4 新增） */
  performanceMetrics?: PerformanceMetrics | null
}

export function createInspectorSections(input: InspectorProjectionInput): DataSection[] {
  const sections: DataSection[] = [
    {
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

  // 错误诊断面板（仅在存在错误时显示）
  const errorDiagnosisRows = createErrorDiagnosisRows(input)
  if (errorDiagnosisRows.length > 0) {
    sections.push({
      title: '错误诊断',
      rows: errorDiagnosisRows,
    })
  }

  // 性能指标面板（阶段五 5.4 新增）
  const performanceRows = createPerformanceRows(input)
  if (performanceRows.length > 0) {
    sections.push({
      title: '性能指标',
      rows: performanceRows,
    })
  }

  return sections
}

/**
 * 根据结构化错误信息生成错误诊断面板行。
 */
function createErrorDiagnosisRows(input: InspectorProjectionInput): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = []

  // 运行时错误诊断
  if (input.runtimeErrorInfo) {
    rows.push({ label: '错误码', value: input.runtimeErrorInfo.code })
    rows.push({ label: '错误名称', value: getErrorCodeLabel(input.runtimeErrorInfo.code) })
    rows.push({ label: '严重等级', value: getSeverityLabel(input.runtimeErrorInfo.severity) })
    rows.push({ label: '来源模块', value: input.runtimeErrorInfo.source })
    rows.push({ label: '可恢复', value: input.runtimeErrorInfo.recoverable ? '是' : '否' })
    rows.push({ label: '错误消息', value: input.runtimeErrorInfo.message })
  }

  // 回放错误诊断
  if (input.replayErrorInfo) {
    rows.push({ label: '回放错误码', value: input.replayErrorInfo.code })
    rows.push({ label: '回放错误名称', value: getErrorCodeLabel(input.replayErrorInfo.code) })
    rows.push({ label: '回放严重等级', value: getSeverityLabel(input.replayErrorInfo.severity) })
    rows.push({ label: '回放来源', value: input.replayErrorInfo.source })
    rows.push({ label: '回放可恢复', value: input.replayErrorInfo.recoverable ? '是' : '否' })
    rows.push({ label: '回放错误消息', value: input.replayErrorInfo.message })
  }

  return rows
}

function formatCanvasSize(size: { width: number; height: number } | null | undefined): string {
  if (!size) {
    return '无'
  }
  return `${size.width} × ${size.height}`
}

/**
 * 根据性能指标生成性能面板行。
 */
function createPerformanceRows(input: InspectorProjectionInput): Array<{ label: string; value: string }> {
  const metrics = input.performanceMetrics
  if (!metrics) return []

  const rows: Array<{ label: string; value: string }> = []

  // CPU 耗时
  rows.push({ label: '帧总耗时', value: formatMs(metrics.totalFrameMs) })
  rows.push({ label: '编译上下文', value: formatMs(metrics.cpu.compileContextMs) })
  rows.push({ label: 'IR 构建', value: formatMs(metrics.cpu.irBuildMs) })
  rows.push({ label: '区域编译', value: formatMs(metrics.cpu.compileMs) })
  if (metrics.cpu.patchMs > 0) {
    rows.push({ label: '补丁应用', value: formatMs(metrics.cpu.patchMs) })
  }

  // GPU 耗时
  rows.push({ label: 'GPU 总耗时', value: formatMs(metrics.gpu.totalMs) })
  rows.push({ label: '计算调度', value: formatMs(metrics.gpu.dispatchMs) })
  rows.push({ label: '呈现 Pass', value: formatMs(metrics.gpu.presentMs) })
  if (metrics.gpu.effectMs > 0) {
    rows.push({ label: '效果后处理', value: formatMs(metrics.gpu.effectMs) })
  }
  if (metrics.gpu.bufferWriteMs > 0) {
    rows.push({ label: '缓冲区写入', value: formatMs(metrics.gpu.bufferWriteMs) })
  }

  // 内存指标
  rows.push({ label: '描述符缓冲区', value: formatBytes(metrics.memory.descriptorBufferBytes) })
  rows.push({ label: '辅助参数缓冲区', value: formatBytes(metrics.memory.auxBufferBytes) })
  rows.push({ label: '区域缓冲区', value: formatBytes(metrics.memory.regionBufferBytes) })
  rows.push({ label: 'Uniform 缓冲区', value: formatBytes(metrics.memory.uniformBufferBytes) })
  if (metrics.memory.effectDescBufferBytes > 4) {
    rows.push({ label: '效果描述符', value: formatBytes(metrics.memory.effectDescBufferBytes) })
    rows.push({ label: '效果参数', value: formatBytes(metrics.memory.effectParamBufferBytes) })
  }
  rows.push({ label: '纹理内存', value: formatBytes(metrics.memory.textureMemoryBytes) })
  rows.push({ label: '缓冲区总计', value: formatBytes(metrics.memory.totalBufferBytes) })
  rows.push({ label: 'GPU 内存总计', value: formatBytes(metrics.memory.totalMemoryBytes) })

  return rows
}
