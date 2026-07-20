import type { RuntimeFrameRecord } from '@/runtime/types'

import type { DataSection, FrameSnapshot, TimelineFrame } from '@/components/ui/types'

export function toFrameSnapshot(record: RuntimeFrameRecord): FrameSnapshot {
  const renderVerificationState = readRenderVerificationState(record)
  const renderVerificationMessage = readRenderVerificationMessage(record)

  return {
    frame: record.frame,
    label: `第 ${record.frame} 帧`,
    timestampMs: record.timestampMs,
    durationMs: record.durationMs,
    status: record.status,
    scenario: record.scenario,
    layerId: record.layerId,
    opcode: record.opcode,
    patchId: record.patchId,
    patchSummary: record.patchSummary,
    hasPatch: record.patchId !== null || record.patchSummary !== null,
    isKeyframe: record.frame % 4 === 0,
    canvasSize: record.canvasSize,
    outputFormat: record.outputFormat,
    error: record.error,
    artifactSchemaVersion: record.artifactSchemaVersion ?? null,
    renderVerificationState,
    renderVerificationMessage,
    payload: {
      ...record.payload,
      descriptorData: record.artifact?.descriptorData ? Array.from(record.artifact.descriptorData) : undefined,
      auxData: record.artifact?.auxData ? Array.from(record.artifact.auxData) : undefined,
      compileContextSnapshot: record.compileContextSnapshot,
      renderIrSnapshot: record.renderIrSnapshot,
    },
  }
}

export function createFrameSnapshotList(records: RuntimeFrameRecord[]): FrameSnapshot[] {
  return records.map(toFrameSnapshot)
}

export function toTimelineFrame(snapshot: FrameSnapshot): TimelineFrame {
  return {
    frame: snapshot.frame,
    label: snapshot.label,
    patchSummary: snapshot.patchSummary ?? '渲染检查点',
    durationMs: snapshot.durationMs,
    hasPatch: snapshot.hasPatch,
    isKeyframe: snapshot.isKeyframe,
    status: snapshot.status,
    renderVerificationState: snapshot.renderVerificationState,
  }
}

export function createFrameSections(snapshot: FrameSnapshot | undefined): DataSection[] {
  if (!snapshot) {
    return []
  }

  return [
    {
      title: '摘要数据',
      rows: [
        { label: '帧编号', value: String(snapshot.frame) },
        { label: '时间戳', value: `${snapshot.timestampMs.toFixed(2)} 毫秒` },
        { label: '耗时', value: `${snapshot.durationMs.toFixed(2)} 毫秒` },
        { label: '状态', value: snapshot.status },
        { label: '补丁摘要', value: snapshot.patchSummary ?? '无' },
      ],
    },
    {
      title: '技术数据',
      rows: [
        { label: '补丁编号', value: snapshot.patchId ?? '无' },
        { label: '工件版本', value: snapshot.artifactSchemaVersion ?? '无' },
        { label: '场景', value: snapshot.scenario },
        { label: '图层', value: snapshot.layerId ?? '无' },
        { label: '指令', value: snapshot.opcode ?? '无' },
        {
          label: '画布',
          value: snapshot.canvasSize ? `${snapshot.canvasSize.width} × ${snapshot.canvasSize.height}` : '无',
        },
        { label: '输出格式', value: snapshot.outputFormat ?? '无' },
        { label: '错误信息', value: snapshot.error ?? '无' },
      ],
    },
    {
      title: '一致性校验',
      rows: [
        { label: '渲染签名状态', value: snapshot.renderVerificationState },
        { label: '签名说明', value: snapshot.renderVerificationMessage ?? '无' },
      ],
    },
    {
      title: '原始载荷',
      rows: Object.entries(snapshot.payload)
        .filter(([, value]) => value !== undefined)
        .map(([label, value]) => ({
          label,
          value: formatPayloadValue(value),
        })),
    },
  ]
}

export interface FrameExportData {
  snapshot: FrameSnapshot
  sections: DataSection[]
}

export function createSnapshotExport(snapshot: FrameSnapshot | undefined): string {
  if (!snapshot) return '{}'
  const summary = {
    frame: snapshot.frame,
    timestampMs: snapshot.timestampMs,
    durationMs: snapshot.durationMs,
    status: snapshot.status,
    patchSummary: snapshot.patchSummary,
    scenario: snapshot.scenario,
    layerId: snapshot.layerId,
    opcode: snapshot.opcode,
  }
  return JSON.stringify(summary, null, 2)
}

export function createDebugExport(snapshot: FrameSnapshot | undefined): string {
  if (!snapshot) return '{}'
  return JSON.stringify(snapshot, null, 2)
}

export function createCsvExport(snapshot: FrameSnapshot | undefined): string {
  if (!snapshot) return 'field,value\n'
  const rows: Array<[string, string]> = [
    ['frame', String(snapshot.frame)],
    ['timestampMs', snapshot.timestampMs.toFixed(2)],
    ['durationMs', snapshot.durationMs.toFixed(2)],
    ['status', snapshot.status],
    ['scenario', snapshot.scenario],
    ['layerId', snapshot.layerId ?? ''],
    ['opcode', snapshot.opcode ?? ''],
    ['patchId', snapshot.patchId ?? ''],
    ['patchSummary', snapshot.patchSummary ?? ''],
    ['artifactSchemaVersion', snapshot.artifactSchemaVersion ?? ''],
    ['renderVerificationState', snapshot.renderVerificationState],
    ['error', snapshot.error ?? ''],
  ]
  const header = 'field,value'
  const body = rows.map(([field, value]) => `${field},${value}`).join('\n')
  return `${header}\n${body}\n`
}

function readRenderVerificationState(record: RuntimeFrameRecord): FrameSnapshot['renderVerificationState'] {
  const snapshot = record.payload?.renderVerificationSnapshot as Record<string, unknown> | undefined
  const valid = snapshot?.valid

  if (valid === true) {
    return '一致'
  }

  if (valid === false) {
    return '不一致'
  }

  return '未校验'
}

function readRenderVerificationMessage(record: RuntimeFrameRecord): string | null {
  const snapshot = record.payload?.renderVerificationSnapshot as Record<string, unknown> | undefined
  const message = snapshot?.message
  return typeof message === 'string' ? message : null
}

function formatPayloadValue(value: unknown): string {
  if (value === null) {
    return 'null'
  }

  if (typeof value === 'string') {
    return value
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  try {
    return JSON.stringify(value)
  } catch {
    return '[无法序列化的载荷]'
  }
}
