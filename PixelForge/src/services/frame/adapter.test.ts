import { describe, expect, it } from 'vitest'

import type { RuntimeFrameRecord } from '@/runtime/types'

import { createFrameSections, createFrameSnapshotList, toFrameSnapshot, toTimelineFrame } from './adapter'
import { InMemoryFrameRepository } from './repository'

describe('帧适配层', () => {
  const baseRecord: RuntimeFrameRecord = {
    frame: 128,
    timestampMs: 1000,
    durationMs: 2.5,
    status: 'ready',
    scenario: 'gradient',
    layerId: 'layer_gradient',
    opcode: 'LINEAR_GRADIENT',
    patchId: 'patch-1',
    patchSummary: 'colorA -> [0.1, 0.2, 0.3, 1]',
    canvasSize: { width: 1024, height: 768 },
    outputFormat: 'rgba8unorm',
    error: null,
    artifactSchemaVersion: 'region-artifact-v2',
    compileContextSnapshot: {
      canvasSize: { width: 1024, height: 768 },
      seed: 1337,
    },
    renderIrSnapshot: {
      canvas: { width: 1024, height: 768 },
      layers: [],
      regions: [],
      effects: [],
      compileHints: { preferredProfile: 'region' },
    },
    artifact: {
      schemaVersion: 'region-artifact-v2',
      descriptorData: new Uint32Array([1, 0]),
      auxData: new Float32Array([0, 1, 1, 0]),
      regionData: new Float32Array([0, 0, 1, 1]),
      effectDescData: new Uint32Array([0]),
      effectParamData: new Float32Array([0, 0, 0, 0]),
      layerId: 'layer_gradient',
      opcode: 'LINEAR_GRADIENT',
      layers: [],
      regions: [],
      effects: [],
      visibleLayerCount: 1,
      hasEffects: false,
    },
    payload: {
      compileHints: { preferredProfile: 'region' },
      capabilitySummary: {
        storageFormat: 'rgba8unorm',
      },
      renderVerificationSnapshot: {
        descriptorData: [1, 0],
        auxData: [0, 1, 1, 0],
        regionData: [0, 0, 1, 1],
        effectDescData: [0],
        effectParamData: [0, 0, 0, 0],
        canvasWidth: 1024,
        canvasHeight: 768,
        seed: 1337,
        visibleLayerCount: 1,
        hasEffects: false,
        valid: true,
        message: '历史帧回放签名一致',
      },
    },
  }

  it('应将运行时记录转换为界面快照', () => {
    const snapshot = toFrameSnapshot(baseRecord)

    expect(snapshot.frame).toBe(128)
    expect(snapshot.label).toBe('第 128 帧')
    expect(snapshot.hasPatch).toBe(true)
    expect(snapshot.artifactSchemaVersion).toBe('region-artifact-v2')
    expect(snapshot.renderVerificationState).toBe('一致')
    expect(snapshot.renderVerificationMessage).toBe('历史帧回放签名一致')
    expect(snapshot.payload.descriptorData).toEqual([1, 0])
    expect(snapshot.payload.auxData).toEqual([0, 1, 1, 0])
  })

  it('应从仓储生成快照列表并保持帧号升序', () => {
    const repository = new InMemoryFrameRepository([
      { ...baseRecord, frame: 130 },
      { ...baseRecord, frame: 129 },
    ])

    const snapshots = createFrameSnapshotList(repository.listFrames())

    expect(snapshots.map((item) => item.frame)).toEqual([129, 130])
  })

  it('应将快照转换为时间轴项', () => {
    const timelineFrame = toTimelineFrame(toFrameSnapshot(baseRecord))

    expect(timelineFrame.frame).toBe(128)
    expect(timelineFrame.label).toBe('第 128 帧')
    expect(timelineFrame.patchSummary).toBe('colorA -> [0.1, 0.2, 0.3, 1]')
    expect(timelineFrame.status).toBe('ready')
  })

  it('应生成帧详情面板数据', () => {
    const sections = createFrameSections(toFrameSnapshot(baseRecord))

    expect(sections).toHaveLength(4)
    expect(sections[0].title).toBe('摘要数据')
    expect(sections[1].title).toBe('技术数据')
    expect(sections[1].rows.some((row) => row.label === '工件版本' && row.value === 'region-artifact-v2')).toBe(true)
    expect(sections[2].title).toBe('一致性校验')
    expect(sections[2].rows.some((row) => row.label === '渲染签名状态' && row.value === '一致')).toBe(true)
    expect(sections[3].rows.some((row) => row.label === 'descriptorData')).toBe(true)
  })

  it('在无快照时应返回空详情列表', () => {
    expect(createFrameSections(undefined)).toEqual([])
  })
})
