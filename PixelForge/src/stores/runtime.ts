import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { createCompileContext } from '@/compiler/context'
import type { CompileContext } from '@/compiler/context'
import { applyPatch } from '@/compiler/ir/patchEngine'
import type { ValuePatch } from '@/compiler/ir/patch'
import type { RenderIR } from '@/compiler/ir/renderIR'
import { createPhaseADemoIR, demoScenarios } from '@/compiler/region/demoIR'
import { createRegionEvaluator } from '@/compiler/region/evaluator'
import { compileRenderIRToRegionArtifact } from '@/compiler/region/regionCompiler'
import type { RegionCompileArtifact } from '@/compiler/region/regionCompiler'
import { createRenderVerificationSnapshot, renderFrame } from '@/runtime/encoder'
import { initRuntime } from '@/runtime/device'
import type { ReplayErrorInfo, RuntimeErrorInfo, RuntimeFrameRecord } from '@/runtime/types'
import { InMemoryFrameRepository } from '@/services/frame/repository'
import type { FrameRepository } from '@/services/frame/types'

function createColorPatch(value: [number, number, number, number]): ValuePatch {
  return {
    patchId: `patch-color-${Date.now()}`,
    tier: 'value',
    source: 'user_patch',
    targetEntity: 'layer',
    targetId: 'layer_gradient',
    paramKey: 'colorA',
    value,
  }
}

const 工件结构版本 = 'region-artifact-v2'

function createRuntimeStore(frameRepository: FrameRepository) {
  return defineStore('runtime', () => {
    const status = ref<'idle' | 'initializing' | 'ready' | 'error'>('idle')
    const error = ref<string | null>(null)
    const runtimeError = ref<RuntimeErrorInfo | null>(null)
    const replayStatus = ref<'idle' | 'success' | 'error'>('idle')
    const replayError = ref<string | null>(null)
    const replayErrorInfo = ref<ReplayErrorInfo | null>(null)
    const runtime = ref<Awaited<ReturnType<typeof initRuntime>> | null>(null)
    const currentIr = ref<RenderIR>(createPhaseADemoIR())
    const currentLayerId = ref<string | null>(null)
    const currentOpcode = ref<string | null>(null)
    const currentScenario = ref((demoScenarios[0] ?? 'gradient') as (typeof demoScenarios)[number])
    const lastPatchId = ref<string | null>(null)
    const lastPatchSummary = ref<string | null>(null)
    const nextFrameNumber = ref(120)
    const selectedFrame = ref<number | null>(null)
    const presentedFrame = ref<number | null>(null)

    const isReady = computed(() => status.value === 'ready')
    const canvasSize = computed(() => runtime.value?.gpu.canvasSize ?? null)
    const capability = computed(() => runtime.value?.capability ?? null)
    const outputFormat = computed(() => runtime.value?.output.format ?? null)
    const frameRecords = computed(() => frameRepository.listFrames())
    const latestFrame = computed(() => {
      const frames = frameRecords.value
      return frames.length > 0 ? frames[frames.length - 1] : null
    })
    const selectedFrameRecord = computed(() => {
      if (selectedFrame.value === null) {
        return null
      }

      return frameRepository.getFrame(selectedFrame.value) ?? null
    })

    async function initialize(canvas: HTMLCanvasElement) {
      if (status.value === 'initializing') {
        return
      }

      status.value = 'initializing'
      error.value = null
      runtimeError.value = null

      try {
        const runtimeResult = await initRuntime({ canvas })
        runtime.value = runtimeResult
        renderCurrentIR(runtimeResult)
        status.value = 'ready'
      } catch (caughtError) {
        runtime.value = null
        currentLayerId.value = null
        currentOpcode.value = null
        lastPatchId.value = null
        lastPatchSummary.value = null
        status.value = 'error'
        const normalized = normalizeRuntimeError(caughtError)
        error.value = normalized.message
        runtimeError.value = normalized
        appendFrameRecord({
          status: 'error',
          error: error.value,
        })
      }
    }

    function setScenario(scenario: (typeof demoScenarios)[number]) {
      currentScenario.value = scenario
      currentIr.value = createPhaseADemoIR(scenario)
      lastPatchId.value = null
      lastPatchSummary.value = `场景 -> ${scenario}`
      renderCurrentIR()
    }

    function applyWarmPatch() {
      applyDemoPatch([0.98, 0.64, 0.18, 1])
    }

    function applyCoolPatch() {
      applyDemoPatch([0.2, 0.46, 0.98, 1])
    }

    function resetDemoIR() {
      currentIr.value = createPhaseADemoIR(currentScenario.value)
      lastPatchId.value = null
      lastPatchSummary.value = '重置当前渲染输入'
      renderCurrentIR()
    }

    function applyDemoPatch(color: [number, number, number, number]) {
      if (!runtime.value) {
        return
      }

      try {
        const patch = createColorPatch(color)
        const outcome = applyPatch(currentIr.value, patch)
        currentIr.value = outcome.ir
        lastPatchId.value = patch.patchId
        lastPatchSummary.value = `${patch.paramKey} -> [${color.join(', ')}]`
        renderCurrentIR()
      } catch (caughtError) {
        status.value = 'error'
        error.value = caughtError instanceof Error ? caughtError.message : String(caughtError)
        appendFrameRecord({
          status: 'error',
          patchId: lastPatchId.value,
          patchSummary: lastPatchSummary.value,
          error: error.value,
        })
      }
    }

    function renderCurrentIR(runtimeOverride?: Awaited<ReturnType<typeof initRuntime>>) {
      const runtimeResult = runtimeOverride ?? runtime.value
      if (!runtimeResult) {
        return
      }

      const startedAt = performance.now()
      const compileContext = createCompileContext(runtimeResult.capability, runtimeResult.gpu.canvasSize)
      const artifact = compileRenderIRToRegionArtifact(currentIr.value)
      const verificationCore = createRenderVerificationSnapshot({
        artifact,
        compileContext,
      })

      executeArtifactRender(runtimeResult, compileContext, artifact)

      currentLayerId.value = artifact.layers[0]?.layerId ?? artifact.layerId
      currentOpcode.value = artifact.layers[0]?.opcode ?? artifact.opcode
      error.value = null
      runtimeError.value = null

      appendFrameRecord({
        status: 'ready',
        layerId: currentLayerId.value,
        opcode: currentOpcode.value,
        patchId: lastPatchId.value,
        patchSummary: lastPatchSummary.value,
        artifact,
        renderIrSnapshot: cloneRenderIr(currentIr.value),
        compileContextSnapshot: {
          canvasSize: { ...compileContext.canvasSize },
          seed: compileContext.seed,
          time: compileContext.time,
        },
        artifactSchemaVersion: 工件结构版本,
        durationMs: performance.now() - startedAt,
        payload: {
          compileHints: currentIr.value.compileHints,
          capabilitySummary: runtimeResult.capability
            ? {
                storageFormat: runtimeResult.capability.storageFormat,
                maxTextureDimension2D: String(runtimeResult.capability.maxTextureDimension2D),
                maxStorageBufferBindingSize: String(runtimeResult.capability.maxStorageBufferBindingSize),
              }
            : undefined,
          renderVerificationSnapshot: {
            ...verificationCore,
            valid: true,
            message: '实时渲染签名已记录',
          },
          layerCount: artifact.visibleLayerCount,
          layerIds: artifact.layers.map((l: { layerId: string }) => l.layerId),
          layerOpcodes: artifact.layers.map((l: { opcode: string }) => l.opcode),
          layerBlendModes: artifact.layers.map((l: { blendMode: string }) => l.blendMode),
          regionCount: artifact.regions.length,
          effectCount: artifact.effects.length,
          effectTypes: artifact.effects.map((e: { type: string }) => e.type),
          hasEffects: artifact.hasEffects,
        },
      })
    }

    function replayFrame(frame: number) {
      const runtimeResult = runtime.value
      const record = frameRepository.getFrame(frame)

      if (!runtimeResult) {
        replayStatus.value = 'error'
        replayError.value = '运行时不可用，无法执行回放'
        replayErrorInfo.value = {
          code: 'replay/runtime-unavailable',
          message: '运行时不可用，无法执行回放',
        }
        return
      }

      if (!record) {
        replayStatus.value = 'error'
        replayError.value = '未找到指定帧记录'
        replayErrorInfo.value = {
          code: 'replay/missing-data',
          message: '未找到指定帧记录',
        }
        return
      }

      if (record.artifactSchemaVersion && record.artifactSchemaVersion !== 工件结构版本) {
        replayStatus.value = 'error'
        replayError.value = `工件版本不兼容: ${record.artifactSchemaVersion}`
        replayErrorInfo.value = {
          code: 'replay/incompatible-artifact-version',
          message: `工件版本不兼容: ${record.artifactSchemaVersion}`,
        }
        updateRecordVerification(record.frame, false, `工件版本不兼容: ${record.artifactSchemaVersion}`)
        return
      }

      if (!record.artifact || !record.compileContextSnapshot) {
        error.value = '当前帧缺少回放所需数据'
        replayStatus.value = 'error'
        replayError.value = '当前帧缺少回放所需数据'
        replayErrorInfo.value = {
          code: 'replay/missing-data',
          message: '当前帧缺少回放所需数据',
        }
        updateRecordVerification(record.frame, false, '当前帧缺少回放所需数据')
        return
      }

      const compileContext: CompileContext = {
        capability: runtimeResult.capability,
        canvasSize: record.compileContextSnapshot.canvasSize,
        seed: record.compileContextSnapshot.seed,
        time: record.compileContextSnapshot.time,
      }

      const replaySignature = createRenderVerificationSnapshot({
        artifact: record.artifact,
        compileContext,
      })

      if (record.payload?.renderVerificationSnapshot) {
        const expectedSignature = JSON.stringify(record.payload.renderVerificationSnapshot, replacerForVerification)
        const actualSignature = JSON.stringify({
          ...replaySignature,
          valid: true,
          message: '历史帧回放签名一致',
        }, replacerForVerification)
        if (expectedSignature !== actualSignature) {
          replayStatus.value = 'error'
          replayError.value = '历史帧回放结果与记录签名不一致'
          replayErrorInfo.value = {
            code: 'replay/signature-mismatch',
            message: '历史帧回放结果与记录签名不一致',
          }
          updateRecordVerification(record.frame, false, '历史帧回放结果与记录签名不一致')
          return
        }
      }

      executeArtifactRender(runtimeResult, compileContext, record.artifact)

      presentedFrame.value = record.frame
      selectedFrame.value = record.frame
      currentScenario.value = record.scenario as (typeof demoScenarios)[number]
      currentLayerId.value = record.layerId
      currentOpcode.value = record.opcode
      lastPatchId.value = record.patchId
      lastPatchSummary.value = record.patchSummary
      error.value = record.error
      replayStatus.value = 'success'
      replayError.value = null
      replayErrorInfo.value = null
      updateRecordVerification(record.frame, true, '历史帧回放签名一致')

      if (record.renderIrSnapshot) {
        currentIr.value = cloneRenderIr(record.renderIrSnapshot)
      }
    }

    function executeArtifactRender(
      runtimeResult: Awaited<ReturnType<typeof initRuntime>>,
      compileContext: CompileContext,
      artifact: RegionCompileArtifact,
    ) {
      const evaluator = createRegionEvaluator(runtimeResult.gpu.device, compileContext, runtimeResult.output)

      renderFrame(
        evaluator,
        artifact,
        runtimeResult.gpu.device,
        runtimeResult.gpu.context,
        runtimeResult.present,
      )
    }

    function appendFrameRecord(partial: Partial<RuntimeFrameRecord>) {
      const frame = partial.frame ?? nextFrameNumber.value
      const record: RuntimeFrameRecord = {
        frame,
        timestampMs: performance.now(),
        durationMs: partial.durationMs ?? 0,
        status: partial.status ?? status.value,
        scenario: partial.scenario ?? currentScenario.value,
        layerId: partial.layerId ?? currentLayerId.value,
        opcode: partial.opcode ?? currentOpcode.value,
        patchId: partial.patchId ?? lastPatchId.value,
        patchSummary: partial.patchSummary ?? lastPatchSummary.value,
        canvasSize: partial.canvasSize ?? runtime.value?.gpu.canvasSize ?? null,
        outputFormat: partial.outputFormat ?? runtime.value?.output.format ?? null,
        error: partial.error ?? error.value,
        artifact: partial.artifact,
        renderIrSnapshot: partial.renderIrSnapshot,
        compileContextSnapshot: partial.compileContextSnapshot,
        artifactSchemaVersion: partial.artifactSchemaVersion ?? 工件结构版本,
        payload: partial.payload ?? {},
      }

      frameRepository.upsertFrame(record)
      nextFrameNumber.value = frame + 1
      selectedFrame.value = frame
      presentedFrame.value = frame
    }

    function updateRecordVerification(frame: number, valid: boolean, message: string) {
      const record = frameRepository.getFrame(frame)
      if (!record) {
        return
      }

      frameRepository.upsertFrame({
        ...record,
        payload: {
          ...record.payload,
          renderVerificationSnapshot: {
            ...(record.payload?.renderVerificationSnapshot as Record<string, unknown> | undefined),
            valid,
            message,
          },
        },
      })
    }

    function selectFrame(frame: number) {
      selectedFrame.value = frameRepository.getFrame(frame)?.frame ?? null
    }

    function cloneRenderIr(ir: RenderIR): RenderIR {
      return JSON.parse(JSON.stringify(ir)) as RenderIR
    }

    return {
      status,
      error,
      runtimeError,
      replayStatus,
      replayError,
      replayErrorInfo,
      runtime,
      currentIr,
      currentLayerId,
      currentOpcode,
      currentScenario,
      lastPatchId,
      lastPatchSummary,
      isReady,
      canvasSize,
      capability,
      outputFormat,
      frameRecords,
      latestFrame,
      selectedFrameRecord,
      nextFrameNumber,
      selectedFrame,
      presentedFrame,
      initialize,
      setScenario,
      applyWarmPatch,
      applyCoolPatch,
      resetDemoIR,
      applyDemoPatch,
      renderCurrentIR,
      replayFrame,
      selectFrame,
    }
  })
}

function normalizeRuntimeError(caughtError: unknown): RuntimeErrorInfo {
  if (
    typeof caughtError === 'object' &&
    caughtError !== null &&
    'code' in caughtError &&
    'message' in caughtError
  ) {
    return {
      code: String((caughtError as RuntimeErrorInfo).code) as RuntimeErrorInfo['code'],
      message: String((caughtError as RuntimeErrorInfo).message),
    }
  }

  if (caughtError instanceof Error) {
    return {
      code: 'runtime/unknown',
      message: caughtError.message,
    }
  }

  return {
    code: 'runtime/unknown',
    message: String(caughtError),
  }
}

function replacerForVerification(key: string, value: unknown) {
  if (key === 'valid' || key === 'message') {
    return undefined
  }

  return value
}

export const useRuntimeStore = createRuntimeStore(new InMemoryFrameRepository())
export { createRuntimeStore, 工件结构版本 }
