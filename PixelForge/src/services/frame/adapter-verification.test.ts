import { describe, expect, it } from 'vitest'

import type { RuntimeFrameRecord } from '@/runtime/types'

import { createFrameSections, toFrameSnapshot } from './adapter'

describe('帧适配层', () => {
  function buildRecord(): RuntimeFrameRecord {
    return {
      frame: 200,
      timestampMs: 1000,
      durationMs: 2.5,
      status: 'ready',
      scenario: 'gradient',
      layerId: 'layer_gradient',
      opcode: 'LINEAR_GRADIENT',
      patchId: 'patch-200',
      patchSummary: '补丁-200',
      canvasSize: { width: 1024, height: 768 },
      outputFormat: 'rgba8unorm',
      error: null,
      artifactSchemaVersion: 'region-artifact-v1',
      payload: {
        renderVerificationSnapshot: {
          descriptorData: [1, 0],
          auxData: [0, 1],
          canvasWidth: 1024,
          canvasHeight: 768,
          seed: 1337,
          valid: true,
          message: '历史帧回放签名一致',
        },
      },
    }
  }

  it('应把渲染签名状态映射到快照中', () => {
    const snapshot = toFrameSnapshot(buildRecord())

    expect(snapshot.renderVerificationState).toBe('一致')
    expect(snapshot.renderVerificationMessage).toBe('历史帧回放签名一致')
  })

  it('应把一致性校验加入帧详情面板', () => {
    const sections = createFrameSections(toFrameSnapshot(buildRecord()))
    const verificationSection = sections.find((item) => item.title === '一致性校验')

    expect(verificationSection).toBeTruthy()
    expect(verificationSection?.rows.find((row) => row.label === '渲染签名状态')?.value).toBe('一致')
    expect(verificationSection?.rows.find((row) => row.label === '签名说明')?.value).toBe('历史帧回放签名一致')
  })
})
