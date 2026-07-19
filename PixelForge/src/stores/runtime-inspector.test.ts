import { describe, expect, it } from 'vitest'

import type { RuntimeFrameRecord } from '@/runtime/types'

import { createInspectorSections } from './runtime-inspector'

describe('检查面板历史态一致性', () => {
  function buildRecord(): RuntimeFrameRecord {
    return {
      frame: 145,
      timestampMs: 2000,
      durationMs: 3.2,
      status: 'ready',
      scenario: 'noise',
      layerId: 'layer_noise',
      opcode: 'NOISE',
      patchId: 'patch-145',
      patchSummary: '补丁-145',
      canvasSize: { width: 1024, height: 768 },
      outputFormat: 'rgba8unorm',
      error: null,
      artifactSchemaVersion: 'region-artifact-v1',
      payload: {},
    }
  }

  it('有历史帧记录时应优先读取历史态字段', () => {
    const sections = createInspectorSections({
      runtimeDisplayRecord: buildRecord(),
      fallback: {
        status: 'error',
        canvasFormat: 'bgra8unorm',
        canvasSize: { width: 512, height: 256 },
        outputFormat: 'fallback-format',
        currentScenario: 'gradient',
        currentLayerId: 'layer_gradient',
        currentOpcode: 'LINEAR_GRADIENT',
        lastPatchId: 'patch-fallback',
        lastPatchSummary: 'fallback',
        presentedFrame: 145,
        replayStatus: 'success',
        replayError: null,
        runtimeError: 'fallback-runtime-error',
      },
      capabilityEntries: [['存储格式', 'rgba8unorm']],
    })

    const runtimeRows = sections[0].rows
    const patchRows = sections[1].rows

    expect(runtimeRows.find((row) => row.label === '状态')?.value).toBe('ready')
    expect(runtimeRows.find((row) => row.label === '画布尺寸')?.value).toBe('1024 × 768')
    expect(runtimeRows.find((row) => row.label === '输出纹理')?.value).toBe('rgba8unorm')
    expect(runtimeRows.find((row) => row.label === '回放状态')?.value).toBe('success')
    expect(runtimeRows.find((row) => row.label === '回放错误')?.value).toBe('无')
    expect(runtimeRows.find((row) => row.label === '帧错误')?.value).toBe('无')
    expect(patchRows.find((row) => row.label === '当前场景')?.value).toBe('noise')
    expect(patchRows.find((row) => row.label === '当前图层')?.value).toBe('layer_noise')
    expect(patchRows.find((row) => row.label === '当前指令')?.value).toBe('NOISE')
    expect(patchRows.find((row) => row.label === '补丁编号')?.value).toBe('patch-145')
    expect(patchRows.find((row) => row.label === '补丁摘要')?.value).toBe('补丁-145')
  })

  it('无历史帧记录时应回退到最新运行态字段', () => {
    const sections = createInspectorSections({
      runtimeDisplayRecord: null,
      fallback: {
        status: 'ready',
        canvasFormat: 'bgra8unorm',
        canvasSize: { width: 1024, height: 768 },
        outputFormat: 'rgba8unorm',
        currentScenario: 'gradient',
        currentLayerId: 'layer_gradient',
        currentOpcode: 'LINEAR_GRADIENT',
        lastPatchId: 'patch-live',
        lastPatchSummary: '实时补丁',
        presentedFrame: null,
        replayStatus: 'idle',
        replayError: null,
        runtimeError: null,
      },
      capabilityEntries: [['存储格式', 'rgba8unorm']],
    })

    const runtimeRows = sections[0].rows
    const patchRows = sections[1].rows

    expect(runtimeRows.find((row) => row.label === '状态')?.value).toBe('ready')
    expect(runtimeRows.find((row) => row.label === '画布尺寸')?.value).toBe('1024 × 768')
    expect(runtimeRows.find((row) => row.label === '输出纹理')?.value).toBe('rgba8unorm')
    expect(runtimeRows.find((row) => row.label === '当前显示帧')?.value).toBe('无')
    expect(runtimeRows.find((row) => row.label === '回放状态')?.value).toBe('idle')
    expect(runtimeRows.find((row) => row.label === '帧错误')?.value).toBe('无')
    expect(patchRows.find((row) => row.label === '当前场景')?.value).toBe('gradient')
    expect(patchRows.find((row) => row.label === '补丁编号')?.value).toBe('patch-live')
    expect(patchRows.find((row) => row.label === '补丁摘要')?.value).toBe('实时补丁')
  })

  it('有回放错误时应显示错误内容', () => {
    const sections = createInspectorSections({
      runtimeDisplayRecord: null,
      fallback: {
        status: 'error',
        canvasFormat: 'bgra8unorm',
        canvasSize: null,
        outputFormat: 'rgba8unorm',
        currentScenario: 'gradient',
        currentLayerId: 'layer_gradient',
        currentOpcode: 'LINEAR_GRADIENT',
        lastPatchId: null,
        lastPatchSummary: null,
        presentedFrame: 120,
        replayStatus: 'error',
        replayError: '工件版本不兼容: old-artifact-v0',
        runtimeError: null,
      },
      capabilityEntries: [['存储格式', 'rgba8unorm']],
    })

    const runtimeRows = sections[0].rows
    expect(runtimeRows.find((row) => row.label === '回放错误')?.value).toBe('工件版本不兼容: old-artifact-v0')
  })

  it('历史帧有错误时应显示帧错误内容', () => {
    const errorRecord = { ...buildRecord(), status: 'error' as const, error: 'GPU 纹理创建失败' }
    const sections = createInspectorSections({
      runtimeDisplayRecord: errorRecord,
      fallback: {
        status: 'ready',
        canvasFormat: 'bgra8unorm',
        canvasSize: { width: 1024, height: 768 },
        outputFormat: 'rgba8unorm',
        currentScenario: 'gradient',
        currentLayerId: 'layer_gradient',
        currentOpcode: 'LINEAR_GRADIENT',
        lastPatchId: null,
        lastPatchSummary: null,
        presentedFrame: 145,
        replayStatus: 'idle',
        replayError: null,
        runtimeError: null,
      },
      capabilityEntries: [['存储格式', 'rgba8unorm']],
    })

    const runtimeRows = sections[0].rows
    expect(runtimeRows.find((row) => row.label === '状态')?.value).toBe('error')
    expect(runtimeRows.find((row) => row.label === '帧错误')?.value).toBe('GPU 纹理创建失败')
  })

  it('无历史帧且有运行时错误时应显示运行时错误', () => {
    const sections = createInspectorSections({
      runtimeDisplayRecord: null,
      fallback: {
        status: 'error',
        canvasFormat: 'bgra8unorm',
        canvasSize: null,
        outputFormat: null,
        currentScenario: 'gradient',
        currentLayerId: null,
        currentOpcode: null,
        lastPatchId: null,
        lastPatchSummary: null,
        presentedFrame: null,
        replayStatus: 'idle',
        replayError: null,
        runtimeError: '无法创建输出纹理',
      },
      capabilityEntries: [['存储格式', 'rgba8unorm']],
    })

    const runtimeRows = sections[0].rows
    expect(runtimeRows.find((row) => row.label === '状态')?.value).toBe('error')
    expect(runtimeRows.find((row) => row.label === '帧错误')?.value).toBe('无法创建输出纹理')
    expect(runtimeRows.find((row) => row.label === '画布尺寸')?.value).toBe('无')
  })
})
