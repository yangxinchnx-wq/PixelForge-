import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { createCompileContext } from '@/compiler/context'
import type { CompileContext } from '@/compiler/context'
import {
  artifactCacheSize,
  baseCacheSize,
  getCachedArtifact,
  invalidateByLayerId,
  invalidateByScopes,
  setCachedArtifact,
} from '@/compiler/cache/compileCache'
import { applyPatch } from '@/compiler/ir/patchEngine'
import type { ValuePatch, StructuralPatch } from '@/compiler/ir/patch'
import type { RenderIR } from '@/compiler/ir/renderIR'
import { createPhaseADemoIR, demoScenarios } from '@/compiler/region/demoIR'
import { createRegionEvaluator } from '@/compiler/region/evaluator'
import { compileRenderIRToRegionArtifact } from '@/compiler/region/regionCompiler'
import type { RegionCompileArtifact } from '@/compiler/region/regionCompiler'
import {
  computeProgressiveRenderPlan,
  DEFAULT_PREVIEW_END_LEVEL,
  DEFAULT_PREVIEW_START_LEVEL,
  resolveRenderSequence,
  type PreviewLevel,
} from '@/compiler/preview/previewPyramid'
import { createRenderVerificationSnapshot, renderPresentPass } from '@/runtime/encoder'
import { initRuntime } from '@/runtime/device'
import {
  computeUploadDiffByComparison,
  fullUploadDiff,
  summarizeUploadDiff,
  type UploadDiff,
} from '@/runtime/partialUpload'
import { capturePixelSignature, verifyPixelSignature } from '@/runtime/pixelSignature'
import { calculateMemoryMetrics, createProfiler, ZERO_METRICS } from '@/runtime/profiler'
import type { PerformanceMetrics, Profiler } from '@/runtime/profiler'
import type { ReplayErrorInfo, RuntimeErrorInfo, RuntimeFrameRecord } from '@/runtime/types'
import { classifyError, createReplayError as createStructuredReplayError } from '@/shared/errors'
import { IndexedDBFrameRepository } from '@/services/frame/indexedDbRepository'
import { InMemoryFrameRepository } from '@/services/frame/repository'
import type { FrameRepository } from '@/services/frame/types'
import { textureCache } from '@/assets/textureCache'
import { useHistoryStore } from '@/stores/history'
import { destroyWorkerPool, getWorkerPool } from '@/workers/workerPool'

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

/**
 * 构造通用 ValuePatch(供 ParameterTrack / Inspector 等编辑器组件使用)。
 * targetId 必须是 currentIr.layers[*].id,paramKey 必须是该 layer.params 内的合法 key。
 */
function createValuePatch(
  targetId: string,
  paramKey: string,
  value: ValuePatch['value'],
): ValuePatch {
  return {
    patchId: `patch-${paramKey}-${Date.now()}`,
    tier: 'value',
    source: 'user_patch',
    targetEntity: 'layer',
    targetId,
    paramKey,
    value,
  }
}

/**
 * 构造通用 StructuralPatch(供 Inspector / LayerTree 等编辑器组件使用)。
 * targetId 必须是 currentIr.layers[*].id, field 必须是合法 StructuralField。
 */
function createStructuralPatch(
  targetId: string,
  field: StructuralPatch['field'],
  value: StructuralPatch['value'],
): StructuralPatch {
  return {
    patchId: `patch-structural-${field}-${Date.now()}`,
    tier: 'structural',
    source: 'user_patch',
    targetEntity: 'layer',
    targetId,
    field,
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
    const performanceMetrics = ref<PerformanceMetrics>({
      cpu: { ...ZERO_METRICS.cpu },
      gpu: { ...ZERO_METRICS.gpu },
      memory: { ...ZERO_METRICS.memory },
      totalFrameMs: 0,
    })
    let lastPatchMs = 0

    // ------------------------------------------------------------------
    // Phase C 状态：Worker Pool + Compile Cache + Partial Upload + Preview
    // ------------------------------------------------------------------

    /** 上一帧的编译产物（用于 partial upload diff 计算） */
    let lastArtifact: RegionCompileArtifact | null = null

    /** 上一帧的上传差异（供性能面板 / 调试展示） */
    const lastUploadDiff = ref<UploadDiff | null>(null)

    /** 是否正在异步编译（Worker Pool 编译中） */
    const isCompiling = ref(false)

    /** 是否正在执行渐进式渲染 */
    const isProgressiveRendering = ref(false)

    /** 当前预览级别（0=1/8 ~ 3=全分辨率） */
    const currentPreviewLevel = ref<PreviewLevel>(DEFAULT_PREVIEW_END_LEVEL)

    /** 渲染竞态控制 token（每次新渲染递增，过期的异步渲染被丢弃） */
    let renderToken = 0

    /** 编译缓存命中标记（供性能面板展示） */
    const lastCompileCacheHit = ref(false)

    const isReady = computed(() => status.value === 'ready')

    /** Worker Pool 运行时统计 */
    const workerPoolStats = computed(() => {
      const pool = getWorkerPool()
      return {
        isAvailable: pool.isAvailable,
        workerCount: pool.workerCount,
        pendingCount: pool.pendingCount,
      }
    })

    /** 编译缓存统计 */
    const compileCacheStats = computed(() => ({
      artifactCacheSize: artifactCacheSize(),
      baseCacheSize: baseCacheSize(),
    }))

    /** 上传差异摘要（人类可读字符串） */
    const uploadDiffSummary = computed(() =>
      lastUploadDiff.value ? summarizeUploadDiff(lastUploadDiff.value) : 'no data',
    )

    /** 渐进式渲染计划（各级别分辨率 / dispatch / 像素量） */
    const progressiveRenderPlan = computed(() => {
      const size = runtime.value?.gpu.canvasSize
      if (!size) return []
      return computeProgressiveRenderPlan(size.width, size.height)
    })
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

      // 加载持久化帧记录到内存缓存
      try {
        await frameRepository.initialize()
        const loadedFrames = frameRepository.listFrames()
        if (loadedFrames.length > 0) {
          // 恢复帧号计数器，避免覆盖已有记录
          const maxFrame = loadedFrames[loadedFrames.length - 1].frame
          nextFrameNumber.value = maxFrame + 1
          // 自动选中最新帧
          selectedFrame.value = maxFrame
          presentedFrame.value = maxFrame
        }
      } catch (persistError) {
        // 持久化加载失败不影响渲染主流程
        console.warn('[runtime] 帧记录持久化加载失败，继续以空状态启动:', persistError)
      }

      try {
        const runtimeResult = await initRuntime({ canvas })
        runtime.value = runtimeResult
        // 绑定 GPU device 到 textureCache, 使后续 register 能上传纹理到 GPU
        textureCache.bindDevice(runtimeResult.gpu.device)
        await renderCurrentIR(runtimeResult)
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
      void renderCurrentIR()
    }

    /**
     * 设置外部 RenderIR（来自 ruleParser / LLM parser 等 L2 层输出）。
     *
     * 链路：
     *   prompt → RequirementClarifier → ParsedIntent → ruleParser → RenderIR
     *   → setRenderIR(ir) → currentIr = ir → renderCurrentIR() → GPU
     */
    function setRenderIR(ir: RenderIR) {
      currentIr.value = ir
      currentScenario.value = 'gradient'
      lastPatchId.value = null
      lastPatchSummary.value = `L2 解析 -> ${ir.layers.length} 个图层`
      void renderCurrentIR()
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
      void renderCurrentIR()
    }

    function applyDemoPatch(color: [number, number, number, number]) {
      if (!runtime.value) {
        return
      }

      try {
        const patchStart = performance.now()
        const patch = createColorPatch(color)
        const outcome = applyPatch(currentIr.value, patch)
        currentIr.value = outcome.ir
        lastPatchId.value = patch.patchId
        lastPatchSummary.value = `${patch.paramKey} -> [${color.join(', ')}]`
        lastPatchMs = performance.now() - patchStart
        void renderCurrentIR()
      } catch (caughtError) {
        status.value = 'error'
        const normalized = classifyError(caughtError, 'patch')
        error.value = normalized.message
        runtimeError.value = normalized
        appendFrameRecord({
          status: 'error',
          patchId: lastPatchId.value,
          patchSummary: lastPatchSummary.value,
          error: error.value,
        })
      }
    }

    /**
     * 通用 ValuePatch 应用入口(供 ParameterTrack / Inspector / history.undo/redo 调用)。
     * - 自动构造 patchId、记录 lastPatchId / lastPatchSummary / patchMs
     * - 失败时归类为 patch 错误并写入 frame 记录
     * - 成功后立即触发 renderCurrentIR(完成 GPU 重调度 + 缓存失效)
     * - 默认记录到 history store(可被 undo/redo 还原)
     *   options.skipHistory = true 时跳过记录(seek/play/undo/redo 自身调用)
     */
    function applyValuePatch(
      targetId: string,
      paramKey: string,
      value: ValuePatch['value'],
      options?: { skipHistory?: boolean },
    ): boolean {
      if (!runtime.value) {
        return false
      }

      try {
        // 读取应用前的旧值(用于 undo)
        const targetLayer = currentIr.value.layers.find((l) => l.id === targetId)
        const targetEffect = targetLayer ? undefined : currentIr.value.effects.find((e) => e.id === targetId)
        const oldValue = targetLayer
          ? targetLayer.params[paramKey]
          : targetEffect?.params[paramKey]

        const patchStart = performance.now()
        const patch = createValuePatch(targetId, paramKey, value)
        const outcome = applyPatch(currentIr.value, patch)
        currentIr.value = outcome.ir
        // 缓存失效:按 patch 影响的 scope + targetId 清理编译缓存
        // (当前缓存为空,这是 Phase B-E 的管路占位)
        invalidateByScopes(outcome.affectedScopes)
        invalidateByLayerId(targetId)
        lastPatchId.value = patch.patchId
        const summary = `${targetId}.${paramKey} -> ${formatPatchValue(value)}`
        lastPatchSummary.value = summary
        lastPatchMs = performance.now() - patchStart

        // 记录到 history store(除非显式跳过)
        if (!options?.skipHistory) {
          const historyStore = useHistoryStore()
          historyStore.pushEntry({
            id: patch.patchId,
            description: summary,
            targetId,
            paramKey,
            oldValue: oldValue as ValuePatch['value'],
            newValue: value,
          })
        }

        void renderCurrentIR()
        return true
      } catch (caughtError) {
        status.value = 'error'
        const normalized = classifyError(caughtError, 'patch')
        error.value = normalized.message
        runtimeError.value = normalized
        appendFrameRecord({
          status: 'error',
          patchId: lastPatchId.value,
          patchSummary: lastPatchSummary.value,
          error: error.value,
        })
        return false
      }
    }

    /**
     * 通用 StructuralPatch 应用入口(供 Inspector / LayerTree 调用)。
     * - 自动构造 patchId、记录 lastPatchId / lastPatchSummary / patchMs
     * - 失败时归类为 patch 错误并写入 frame 记录
     * - 成功后立即触发 renderCurrentIR(完成 GPU 重调度 + 缓存失效)
     * - 默认记录到 history store(可被 undo/redo 还原)
     *   options.skipHistory = true 时跳过记录(seek/play/undo/redo 自身调用)
     */
    function applyStructuralPatch(
      targetId: string,
      field: StructuralPatch['field'],
      value: StructuralPatch['value'],
      options?: { skipHistory?: boolean },
    ): boolean {
      if (!runtime.value) {
        return false
      }

      try {
        // 读取应用前的旧值(用于 undo)
        const targetLayer = currentIr.value.layers.find((l) => l.id === targetId)
        const oldValue: StructuralPatch['value'] = targetLayer
          ? (field === 'visible'
              ? targetLayer.visible
              : field === 'blendMode'
                ? targetLayer.blendMode
                : undefined)
          : undefined

        const patchStart = performance.now()
        const patch = createStructuralPatch(targetId, field, value)
        const outcome = applyPatch(currentIr.value, patch)
        currentIr.value = outcome.ir
        // 缓存失效:structural patch 影响 structural + dynamic scope
        invalidateByScopes(outcome.affectedScopes)
        invalidateByLayerId(targetId)
        lastPatchId.value = patch.patchId
        const summary = `${targetId}.${field} -> ${String(value)}`
        lastPatchSummary.value = summary
        lastPatchMs = performance.now() - patchStart

        // 记录到 history store(除非显式跳过)
        if (!options?.skipHistory) {
          const historyStore = useHistoryStore()
          historyStore.pushEntry({
            id: patch.patchId,
            description: summary,
            targetId,
            paramKey: field,
            oldValue,
            newValue: value,
            tier: 'structural',
          })
        }

        void renderCurrentIR()
        return true
      } catch (caughtError) {
        status.value = 'error'
        const normalized = classifyError(caughtError, 'patch')
        error.value = normalized.message
        runtimeError.value = normalized
        appendFrameRecord({
          status: 'error',
          patchId: lastPatchId.value,
          patchSummary: lastPatchSummary.value,
          error: error.value,
        })
        return false
      }
    }

    /**
     * 渲染当前 IR 到 GPU。
     *
     * Phase C 集成：
     *   1. Compile Cache：先查三层 key 缓存，命中则跳过编译
     *   2. Worker Pool：缓存未命中时通过 Worker 异步编译（不阻塞 UI）
     *   3. Partial Upload：与上一帧 artifact 比较计算上传差异
     *   4. 竞态控制：通过 renderToken 丢弃过期渲染结果
     */
    async function renderCurrentIR(runtimeOverride?: Awaited<ReturnType<typeof initRuntime>>) {
      const runtimeResult = runtimeOverride ?? runtime.value
      if (!runtimeResult) {
        return
      }

      // 竞态控制：每次渲染递增 token
      const token = ++renderToken
      isCompiling.value = true

      const profiler = createProfiler()
      if (lastPatchMs > 0) {
        profiler.addCpuTiming('patchMs', lastPatchMs)
        lastPatchMs = 0
      }

      profiler.startCpu('compileContextMs')
      const compileContext = createCompileContext(runtimeResult.capability, runtimeResult.gpu.canvasSize)
      profiler.endCpu('compileContextMs')

      profiler.startCpu('irBuildMs')
      const irSnapshot = cloneRenderIr(currentIr.value)
      profiler.endCpu('irBuildMs')

      // Phase C-1: Compile Cache 查询
      profiler.startCpu('compileMs')
      let artifact = getCachedArtifact(currentIr.value, compileContext)
      if (artifact) {
        // 缓存命中：跳过编译
        lastCompileCacheHit.value = true
        profiler.endCpu('compileMs')
      } else {
        // 缓存未命中：通过 Worker Pool 编译
        lastCompileCacheHit.value = false
        try {
          const pool = getWorkerPool()
          artifact = await pool.compile(currentIr.value)
        } catch {
          // Worker 编译失败 → 主线程降级编译
          artifact = compileRenderIRToRegionArtifact(currentIr.value)
        }
        // 存入缓存供后续命中
        setCachedArtifact(currentIr.value, compileContext, artifact)
        profiler.endCpu('compileMs')
      }

      // 竞态检查：如果有更新的渲染请求，丢弃当前结果
      if (token !== renderToken) {
        isCompiling.value = false
        return
      }
      isCompiling.value = false

      // Phase C-2: Partial Upload diff 计算
      const uploadDiff = lastArtifact
        ? computeUploadDiffByComparison(lastArtifact, artifact)
        : fullUploadDiff()
      lastArtifact = artifact
      lastUploadDiff.value = uploadDiff

      const verificationCore = createRenderVerificationSnapshot({
        artifact,
        compileContext,
      })

      executeArtifactRender(runtimeResult, compileContext, artifact, profiler)

      profiler.setMemory(calculateMemoryMetrics(artifact, runtimeResult.gpu.canvasSize))
      const metrics = profiler.finalize()
      performanceMetrics.value = metrics

      // 更新预览级别为全分辨率
      currentPreviewLevel.value = DEFAULT_PREVIEW_END_LEVEL

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
        renderIrSnapshot: irSnapshot,
        compileContextSnapshot: {
          canvasSize: { ...compileContext.canvasSize },
          seed: compileContext.seed,
        },
        artifactSchemaVersion: 工件结构版本,
        durationMs: metrics.totalFrameMs,
        performanceMetrics: metrics,
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
          // Phase C 信息
          compileCacheHit: lastCompileCacheHit.value,
          uploadDiffSummary: summarizeUploadDiff(uploadDiff),
          workerPoolAvailable: getWorkerPool().isAvailable,
        },
      })

      // 异步捕获像素签名（不阻塞主渲染流程）
      const capturedFrameNumber = nextFrameNumber.value - 1
      void capturePixelSignature(
        runtimeResult.gpu.device,
        runtimeResult.output.texture,
        runtimeResult.gpu.canvasSize,
      ).then((signature) => {
        if (signature) {
          const record = frameRepository.getFrame(capturedFrameNumber)
          if (record) {
            frameRepository.upsertFrame({
              ...record,
              pixelSignature: signature.hash,
              payload: {
                ...record.payload,
                pixelSignatureGridSize: signature.gridSize,
                pixelSignatureSampleCount: signature.sampleCount,
              },
            })
          }
        }
      })
    }

    /**
     * Phase C: 渐进式渲染。
     *
     * 按预览金字塔级别从低到高依次编译并渲染：
     *   Level 0 (1/8) → Level 1 (1/4) → Level 2 (1/2) → Level 3 (1/1)
     *
     * 低分辨率级别通过 Worker Pool 异步编译，编译完成后立即渲染全分辨率画面。
     * 中间级别仅用于性能预估和 UI 展示（不执行实际的低分辨率 GPU dispatch，
     * 因为当前 evaluator 不支持动态 dispatch size）。
     *
     * @param options.skipIntermediate 是否跳过中间级别（只编译起始和终止级别）
     */
    async function renderProgressive(options?: {
      skipIntermediate?: boolean
    }): Promise<void> {
      const runtimeResult = runtime.value
      if (!runtimeResult) return

      isProgressiveRendering.value = true
      const token = ++renderToken

      const levels = resolveRenderSequence({
        startLevel: DEFAULT_PREVIEW_START_LEVEL,
        endLevel: DEFAULT_PREVIEW_END_LEVEL,
        skipIntermediate: options?.skipIntermediate,
      })

      // 按级别从低到高依次处理
      for (const level of levels) {
        currentPreviewLevel.value = level

        // 竞态检查
        if (token !== renderToken) {
          isProgressiveRendering.value = false
          return
        }

        // 低分辨率级别：仅通过 Worker 预编译（预热缓存），不执行 GPU 渲染
        if (level < DEFAULT_PREVIEW_END_LEVEL) {
          const compileContext = createCompileContext(
            runtimeResult.capability,
            runtimeResult.gpu.canvasSize,
          )
          // 先查缓存
          let artifact = getCachedArtifact(currentIr.value, compileContext)
          if (!artifact) {
            try {
              const pool = getWorkerPool()
              artifact = await pool.compile(currentIr.value)
              setCachedArtifact(currentIr.value, compileContext, artifact)
            } catch {
              // 低分辨率预编译失败不阻塞最终渲染
            }
          }
          continue
        }

        // 最终级别（全分辨率）：执行完整渲染
        await renderCurrentIR()
      }

      isProgressiveRendering.value = false
    }

    /**
     * Phase C: 销毁 Worker Pool 资源。
     *
     * 在应用卸载 / 组件销毁时调用，释放所有 Worker 线程。
     */
    function destroyWorkerResources(): void {
      destroyWorkerPool()
      lastArtifact = null
      lastUploadDiff.value = null
      isCompiling.value = false
      isProgressiveRendering.value = false
    }

    function replayFrame(frame: number) {
      const runtimeResult = runtime.value
      const record = frameRepository.getFrame(frame)

      if (!runtimeResult) {
        replayStatus.value = 'error'
        replayError.value = '运行时不可用，无法执行回放'
        replayErrorInfo.value = createStructuredReplayError('replay/runtime-unavailable', '运行时不可用，无法执行回放')
        return
      }

      if (!record) {
        replayStatus.value = 'error'
        replayError.value = '未找到指定帧记录'
        replayErrorInfo.value = createStructuredReplayError('replay/missing-data', '未找到指定帧记录')
        return
      }

      if (record.artifactSchemaVersion && record.artifactSchemaVersion !== 工件结构版本) {
        replayStatus.value = 'error'
        replayError.value = `工件版本不兼容: ${record.artifactSchemaVersion}`
        replayErrorInfo.value = createStructuredReplayError('replay/incompatible-artifact-version', `工件版本不兼容: ${record.artifactSchemaVersion}`)
        updateRecordVerification(record.frame, false, `工件版本不兼容: ${record.artifactSchemaVersion}`)
        return
      }

      if (!record.artifact || !record.compileContextSnapshot) {
        error.value = '当前帧缺少回放所需数据'
        replayStatus.value = 'error'
        replayError.value = '当前帧缺少回放所需数据'
        replayErrorInfo.value = createStructuredReplayError('replay/missing-data', '当前帧缺少回放所需数据')
        updateRecordVerification(record.frame, false, '当前帧缺少回放所需数据')
        return
      }

      const compileContext: CompileContext = {
        capability: runtimeResult.capability,
        canvasSize: record.compileContextSnapshot.canvasSize,
        seed: record.compileContextSnapshot.seed,
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
          replayErrorInfo.value = createStructuredReplayError('replay/signature-mismatch', '历史帧回放结果与记录签名不一致')
          updateRecordVerification(record.frame, false, '历史帧回放结果与记录签名不一致')
          return
        }
      }

      const replayProfiler = createProfiler()
      executeArtifactRender(runtimeResult, compileContext, record.artifact, replayProfiler)
      replayProfiler.setMemory(calculateMemoryMetrics(record.artifact, record.compileContextSnapshot.canvasSize))
      const replayMetrics = replayProfiler.finalize()
      performanceMetrics.value = replayMetrics

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

      // 异步验证像素级一致性
      if (record.pixelSignature) {
        const expectedSignature = record.pixelSignature
        void capturePixelSignature(
          runtimeResult.gpu.device,
          runtimeResult.output.texture,
          record.compileContextSnapshot.canvasSize,
        ).then((actualSignature) => {
          if (actualSignature) {
            const pixelMatch = verifyPixelSignature(expectedSignature, actualSignature)
            if (pixelMatch) {
              updateRecordVerification(record.frame, true, '历史帧回放签名一致（像素级验证通过）')
            } else {
              updateRecordVerification(record.frame, false, `像素级验证不一致: 预期=${expectedSignature}, 实际=${actualSignature.hash}`)
            }
          }
        })
      }

      if (record.renderIrSnapshot) {
        currentIr.value = cloneRenderIr(record.renderIrSnapshot)
      }
    }

    function executeArtifactRender(
      runtimeResult: Awaited<ReturnType<typeof initRuntime>>,
      compileContext: CompileContext,
      artifact: RegionCompileArtifact,
      profiler?: Profiler,
    ) {
      const evaluator = createRegionEvaluator(runtimeResult.gpu.device, compileContext, runtimeResult.output)

      const dispatchStart = performance.now()
      evaluator.render(artifact)
      const dispatchEnd = performance.now()

      renderPresentPass(runtimeResult.gpu.device, runtimeResult.gpu.context, runtimeResult.present)
      const presentEnd = performance.now()

      if (profiler) {
        profiler.addGpuTiming('dispatchMs', dispatchEnd - dispatchStart)
        profiler.addGpuTiming('presentMs', presentEnd - dispatchEnd)
      }
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
        performanceMetrics: partial.performanceMetrics,
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

    const selectedFrameRange = ref<{ start: number; end: number } | null>(null)

    function selectFrame(frame: number) {
      selectedFrame.value = frameRepository.getFrame(frame)?.frame ?? null
    }

    function selectFrameRange(start: number, end: number) {
      selectedFrame.value = frameRepository.getFrame(start)?.frame ?? null
      selectedFrameRange.value = { start, end }
    }

    /**
     * 等待帧仓储完成所有挂起的异步写入。
     * 应在页面关闭/导出前调用，确保数据落盘。
     */
    async function flushRepository(): Promise<void> {
      await frameRepository.flush()
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
      performanceMetrics,
      // Phase C 状态
      isCompiling,
      isProgressiveRendering,
      currentPreviewLevel,
      lastCompileCacheHit,
      lastUploadDiff,
      workerPoolStats,
      compileCacheStats,
      uploadDiffSummary,
      progressiveRenderPlan,
      initialize,
      setScenario,
      setRenderIR,
      applyWarmPatch,
      applyCoolPatch,
      resetDemoIR,
      applyDemoPatch,
      applyValuePatch,
      applyStructuralPatch,
      renderCurrentIR,
      renderProgressive,
      destroyWorkerResources,
      replayFrame,
      selectFrame,
      selectFrameRange,
      selectedFrameRange,
      flushRepository,
    }
  })
}

function normalizeRuntimeError(caughtError: unknown): RuntimeErrorInfo {
  return classifyError(caughtError)
}

/** 把 ValuePatch.value 格式化为可读字符串(用于 lastPatchSummary)。 */
function formatPatchValue(value: ValuePatch['value']): string {
  if (Array.isArray(value)) {
    return '[' + value.map((v) => formatScalar(v)).join(', ') + ']'
  }
  return formatScalar(value)
}

function formatScalar(v: unknown): string {
  if (typeof v === 'number') {
    return Number.isInteger(v) ? String(v) : v.toFixed(3)
  }
  return String(v)
}

function replacerForVerification(key: string, value: unknown) {
  if (key === 'valid' || key === 'message') {
    return undefined
  }

  return value
}

/**
 * 创建帧仓储实例。
 *
 * 优先使用 IndexedDB 持久化仓储，如果 IndexedDB 不可用则降级为内存仓储。
 * 在测试环境中，由测试代码通过 createRuntimeStore 注入 InMemoryFrameRepository。
 */
function createDefaultFrameRepository(): FrameRepository {
  if (typeof indexedDB !== 'undefined') {
    return new IndexedDBFrameRepository()
  }
  return new InMemoryFrameRepository()
}

export const useRuntimeStore = createRuntimeStore(createDefaultFrameRepository())
export { createRuntimeStore, 工件结构版本 }
