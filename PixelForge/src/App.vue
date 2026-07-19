<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { demoScenarios } from './compiler/region/demoIR'
import AppSidebar from './components/ui/AppSidebar.vue'
import CanvasWorkspace from './components/ui/CanvasWorkspace.vue'
import FrameDataConsole from './components/ui/FrameDataConsole.vue'
import InspectorPanel from './components/ui/InspectorPanel.vue'
import TimelinePanel from './components/ui/TimelinePanel.vue'
import type { DataSection } from './components/ui/types'
import { createFrameSections, createFrameSnapshotList, toTimelineFrame } from './services/frame/adapter'
import { useFramePlaybackController } from './services/frame/playback'
import { InMemoryFrameRepository } from './services/frame/repository'
import { createInspectorSections } from './stores/runtime-inspector'
import { useRuntimeStore } from './stores/runtime'

const runtimeStore = useRuntimeStore()
const canvasRef = ref<HTMLCanvasElement | null>(null)

const frameRepository = computed(() => new InMemoryFrameRepository(runtimeStore.frameRecords))
const frameSnapshots = computed(() => createFrameSnapshotList(frameRepository.value))
const timelineFrames = computed(() => frameSnapshots.value.map(toTimelineFrame))
const currentFrame = computed(() => runtimeStore.selectedFrame)

const playback = useFramePlaybackController({
  frames: frameSnapshots,
  selectedFrame: computed({
    get: () => runtimeStore.selectedFrame,
    set: (frame) => {
      if (frame !== null) {
        runtimeStore.selectFrame(frame)
      }
    },
  }),
  presentedFrame: computed({
    get: () => runtimeStore.presentedFrame,
    set: () => undefined,
  }),
  onSelectFrame: (frame) => runtimeStore.selectFrame(frame),
  onReplayFrame: (frame) => runtimeStore.replayFrame(frame),
})

const capabilityEntries = computed(() => {
  if (!runtimeStore.capability) {
    return []
  }

  return [
    ['存储格式', runtimeStore.capability.storageFormat],
    ['最大二维纹理尺寸', String(runtimeStore.capability.maxTextureDimension2D)],
    ['最大存储缓冲区大小', String(runtimeStore.capability.maxStorageBufferBindingSize)],
    ['最大计算工作组 X', String(runtimeStore.capability.maxComputeWorkgroupSizeX)],
    ['最大计算工作组 Y', String(runtimeStore.capability.maxComputeWorkgroupSizeY)],
    ['最大计算调用数', String(runtimeStore.capability.maxComputeInvocationsPerWorkgroup)],
  ]
})

const runtimeDisplayRecord = computed(() => runtimeStore.selectedFrameRecord ?? runtimeStore.latestFrame)

const inspectorSections = computed<DataSection[]>(() => createInspectorSections({
  runtimeDisplayRecord: runtimeDisplayRecord.value,
  fallback: {
    status: runtimeStore.status,
    canvasFormat: runtimeStore.runtime?.gpu.canvasFormat ?? '无',
    canvasSize: runtimeStore.canvasSize,
    outputFormat: runtimeStore.outputFormat ?? '无',
    currentScenario: runtimeStore.currentScenario,
    currentLayerId: runtimeStore.currentLayerId,
    currentOpcode: runtimeStore.currentOpcode,
    lastPatchId: runtimeStore.lastPatchId,
    lastPatchSummary: runtimeStore.lastPatchSummary,
    presentedFrame: runtimeStore.presentedFrame,
    replayStatus: runtimeStore.replayStatus,
    replayError: runtimeStore.replayError,
    runtimeError: runtimeStore.error,
  },
  capabilityEntries: capabilityEntries.value,
}))

const activeFrame = computed(() => {
  return frameSnapshots.value.find((frame) => frame.frame === currentFrame.value) ?? undefined
})

const frameSections = computed<DataSection[]>(() => createFrameSections(activeFrame.value))
const playbackState = computed(() => playback.state.value)

onMounted(async () => {
  if (canvasRef.value) {
    await runtimeStore.initialize(canvasRef.value)
  }
})

function selectFrame(frame: number) {
  runtimeStore.selectFrame(frame)
  runtimeStore.replayFrame(frame)
}

function selectRange(start: number, end: number) {
  runtimeStore.selectFrame(start)
  runtimeStore.replayFrame(start)
  // end 参数保留给后续区间回放功能使用
  void end
}
</script>

<template>
  <div class="app-shell">
    <AppSidebar
      :scenarios="demoScenarios"
      :current-scenario="runtimeStore.currentScenario"
      :current-layer-id="runtimeStore.currentLayerId"
      :current-opcode="runtimeStore.currentOpcode"
      @select-scenario="runtimeStore.setScenario"
    />

    <main class="main-layout">
      <div class="workspace-grid">
        <CanvasWorkspace
          title="补丁 / 编译 / 渲染"
          :status="runtimeDisplayRecord?.status ?? runtimeStore.status"
          :canvas-format="runtimeStore.runtime?.gpu.canvasFormat ?? null"
          :canvas-size="runtimeDisplayRecord?.canvasSize ?? runtimeStore.canvasSize"
          :current-scenario="runtimeDisplayRecord?.scenario ?? runtimeStore.currentScenario"
          :current-layer-id="runtimeDisplayRecord?.layerId ?? runtimeStore.currentLayerId"
          :current-opcode="runtimeDisplayRecord?.opcode ?? runtimeStore.currentOpcode"
          :error="runtimeDisplayRecord?.error ?? runtimeStore.error"
          @warm-patch="runtimeStore.applyWarmPatch"
          @cool-patch="runtimeStore.applyCoolPatch"
          @reset="runtimeStore.resetDemoIR"
        >
          <template #canvas>
            <canvas ref="canvasRef" class="runtime-canvas" />
          </template>
        </CanvasWorkspace>

        <InspectorPanel :sections="inspectorSections" />
      </div>

      <section class="bottom-dock">
        <TimelinePanel
          :frames="timelineFrames"
          :current-frame="currentFrame"
          :presented-frame="runtimeStore.presentedFrame"
          :playback-state="playbackState"
          :replay-status="runtimeStore.replayStatus"
          @select-frame="selectFrame"
          @select-range="selectRange"
          @play="playback.play"
          @pause="playback.pause"
          @step-forward="playback.stepForward"
          @step-backward="playback.stepBackward"
        />

        <FrameDataConsole :frame="activeFrame" :sections="frameSections" />
      </section>
    </main>
  </div>
</template>
