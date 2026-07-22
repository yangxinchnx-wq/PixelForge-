<script setup lang="ts">
/**
 * PixelForge — 全新主界面(Step 40.5 UI 重构)
 *
 * 布局:
 *   ┌──────────────────────────────────────────────────────┐
 *   │ TopBar: Logo | 项目 | 播放 | 面板入口 | 设置          │
 *   ├───────┬────────────────────────────┬─────────────────┤
 *   │ Left  │       Canvas + HUD         │   Right Panel   │
 *   │ Panel │                            │                 │
 *   │ Tabs: │                            │   Tabs:         │
 *   │ 创作  │                            │   属性          │
 *   │ 节点图│                            │   IR树          │
 *   │ 素材  │                            │   运行时        │
 *   │       │                            │   帧数据        │
 *   ├───────┴────────────────────────────┴─────────────────┤
 *   │  Bottom Panel (Tabs: ProTimeline | 动画 | 音频 | 效果)│
 *   └──────────────────────────────────────────────────────┘
 *
 * 所有 Step 25-40.4 功能模块均有 UI 入口。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { getCurrentWindow } from '@tauri-apps/api/window'

// —— 组件 ——
import CanvasView from '@/components/editor/CanvasView.vue'
import ClarifierDialog from '@/components/editor/ClarifierDialog.vue'
import GraphEditor from '@/components/editor/graph/GraphEditor.vue'
import RenderIRTree from '@/components/editor/RenderIRTree.vue'
import Timeline from '@/components/editor/Timeline.vue'
import ParameterTrack from '@/components/editor/timeline/ParameterTrack.vue'
import ProTimeline from '@/components/editor/pro-timeline/ProTimeline.vue'
import ProTimelineAudioMixer from '@/components/editor/pro-timeline/ProTimelineAudioMixer.vue'
import ProTimelineEffectChain from '@/components/editor/pro-timeline/ProTimelineEffectChain.vue'
import ProTimelineRenderPanel from '@/components/editor/pro-timeline/ProTimelineRenderPanel.vue'
import ProTimelineDirectorPanel from '@/components/editor/pro-timeline/ProTimelineDirectorPanel.vue'
import ProTimelineWDLEditor from '@/components/editor/pro-timeline/ProTimelineWDLEditor.vue'
import ProTimelineAssetBrowser from '@/components/editor/pro-timeline/ProTimelineAssetBrowser.vue'
import AssetPanel from '@/components/editor/AssetPanel.vue'
import CommandPalette from '@/components/editor/CommandPalette.vue'
import SettingsDialog from '@/components/editor/SettingsDialog.vue'
import ErrorToast from '@/components/editor/ErrorToast.vue'
import ErrorBoundary from '@/components/editor/ErrorBoundary.vue'
import PromptPanel from '@/components/editor/PromptPanel.vue'
import InspectorPanel from '@/components/editor/inspector/InspectorPanel.vue'

// —— Stores ——
import { useRuntimeStore } from '@/stores/runtime'
import { useTimelineStore } from '@/stores/timeline'
import { useHistoryStore } from '@/stores/history'
import { useErrorStore } from '@/stores/errorStore'
import { useProjectStore } from '@/project/projectStore'
import { useRecentProjectsStore, type RecentProjectEntry } from '@/project/recentProjects'
import { useSettingsStore } from '@/preferences/settingsStore'
import { useGraphStore } from '@/graph/graphStore'
import { useMaterialGraphStore } from '@/material/materialGraph'
import { useProTimelineStore } from '@/editor/timeline/store/timelineStore'
import { useAudioMixerStore } from '@/editor/audio/audioMixerStore'
import { useEffectChainStore } from '@/editor/effects/effectChainStore'
import { useRenderStore } from '@/editor/render/renderStore'
import { useAssetRegistryStore } from '@/editor/asset-genome/assetRegistryStore'

// —— Composables / 工具 ——
import { useCommandShortcuts } from '@/composables/useCommandShortcuts'
import { commandRegistry, registerDefaultCommands } from '@/composables/commandRegistry'
import { createAutosaver } from '@/project/autosave'
import { loadProjectFromFile, pickProjectFile, saveProjectToFile } from '@/project/fileSystem'
import { validateProject, formatValidationResult } from '@/project/projectValidator'
import { extractDroppedFiles } from '@/project/projectExport'
import { deserializeProject } from '@/project/serializer'
import type { PixelForgeProject } from '@/project/types'
import { createEngine, type PixelForgeEngine } from '@/runtime/engine'
import { InputDriver } from '@/animation/drivers/inputDriver'
import { inputRouter } from '@/input/inputRouter'
import { applyFrameToRuntime } from '@/editor/timeline/player'
import { clarify } from '@/authoring/clarify/requirementClarifier'
import {
  applyAnswers as applyClarifierAnswers,
  clarify as clarifyIntent,
  skipWithDefaults as skipClarifierDefaults,
} from '@/authoring/clarifier/clarifier'
import type {
  ClarifyAnswer,
  ClarifyQuestion,
  CreativeRequirement,
} from '@/authoring/clarifier/types'
import { generateRenderIR, summarizeGeneratedIR } from '@/authoring/generator/renderIRGenerator'
import { generateGraph, summarizeGraph } from '@/graph/graphGenerator'
import type { RenderIR } from '@/compiler/ir/renderIR'
import { parsePrompt } from '@/authoring/prompt/promptParser'
import { parse as parseIntent } from '@/compiler/parser/ruleParser'

// ============================================================================
// Store 初始化
// ============================================================================
const runtimeStore = useRuntimeStore()
const timelineStore = useTimelineStore()
const historyStore = useHistoryStore()
const projectStore = useProjectStore()
const graphStore = useGraphStore()
const materialStore = useMaterialGraphStore()
const settingsStore = useSettingsStore()
const recentProjectsStore = useRecentProjectsStore()
const errorStore = useErrorStore()
const proTimelineStore = useProTimelineStore()
const audioMixerStore = useAudioMixerStore()
const effectChainStore = useEffectChainStore()
const renderStore = useRenderStore()
const assetRegistryStore = useAssetRegistryStore()

// ============================================================================
// 窗口控制(Tauri)
// ============================================================================
const appWindow = getCurrentWindow()
async function minimizeWindow() { await appWindow.minimize() }
async function toggleMaximizeWindow() { await appWindow.toggleMaximize() }
async function closeWindow() { await appWindow.close() }

// ============================================================================
// UI 状态
// ============================================================================
const canvasRef = ref<HTMLCanvasElement | null>(null)
const showSettings = ref(false)
const showCommandPalette = ref(false)
const showRenderPanel = ref(false)
const showDirectorPanel = ref(false)
const showWDLEditor = ref(false)
const showAssetBrowser = ref(false)

// 左侧栏 tabs
type LeftTab = 'create' | 'graph' | 'assets'
const leftTab = ref<LeftTab>('create')

// 右侧栏 tabs
type RightTab = 'inspector' | 'ir' | 'runtime' | 'frames'
const rightTab = ref<RightTab>('inspector')

// 底部面板 tabs
type BottomTab = 'pro' | 'animation' | 'audio' | 'effects'
const bottomTab = ref<BottomTab>('pro')

// ============================================================================
// Engine + InputDriver
// ============================================================================
const engine: PixelForgeEngine = createEngine({
  timelineStore,
  runtimeStore,
  graphStore,
  materialStore,
})
const inputDriver = new InputDriver(inputRouter)
engine.registerInputDriver(inputDriver)

// ============================================================================
// 自动保存
// ============================================================================
const autosaver = createAutosaver(() => {
  projectStore.autosave(runtimeStore, timelineStore, historyStore)
})

// ============================================================================
// 快捷键(Step 40.2: CommandRegistry)
// ============================================================================
registerDefaultCommands({
  togglePlay: () => engine.toggle(),
  stepForward: () => handleStepForward(),
  stepBackward: () => handleStepBackward(),
  jumpStart: () => handleJumpStart(),
  jumpEnd: () => handleJumpEnd(),
  undo: () => historyStore.undo(runtimeStore),
  redo: () => historyStore.redo(runtimeStore),
})
commandRegistry.register({
  id: 'view.commandPalette',
  name: '打开命令面板',
  description: '搜索并执行任意命令',
  category: 'view',
  shortcut: 'mod+k',
  activeWhenEditing: true,
  execute: () => { showCommandPalette.value = true },
})
// 面板入口快捷键
commandRegistry.register({
  id: 'view.render',
  name: '渲染导出',
  description: '打开渲染导出面板',
  category: 'view',
  shortcut: '',
  execute: () => { showRenderPanel.value = true },
})
commandRegistry.register({
  id: 'view.director',
  name: 'AI Director',
  description: '打开 AI Director 对话面板',
  category: 'view',
  shortcut: '',
  execute: () => { showDirectorPanel.value = true },
})
commandRegistry.register({
  id: 'view.wdl',
  name: 'WDL 编辑器',
  description: '打开 WDL 声明式渲染 DSL 编辑器',
  category: 'view',
  shortcut: '',
  execute: () => { showWDLEditor.value = true },
})
commandRegistry.register({
  id: 'view.assets',
  name: '资产浏览器',
  description: '打开 Asset Genome 资产浏览器',
  category: 'view',
  shortcut: '',
  execute: () => { showAssetBrowser.value = true },
})
commandRegistry.register({
  id: 'view.settings',
  name: '设置',
  description: '打开设置面板',
  category: 'view',
  shortcut: '',
  execute: () => { showSettings.value = true },
})
useCommandShortcuts()

// ============================================================================
// 创作数据
// ============================================================================
const prompt = ref('纯色背景：深蓝\n渐变：从深蓝到紫，垂直方向\n圆形：中心(0.5,0.5)，半径0.2，黄色')
const parseStatus = ref<'idle' | 'parsing' | 'success' | 'error'>('idle')
const parseMessage = ref<string | null>(null)
const quickParseStatus = ref<'idle' | 'parsing' | 'success' | 'error'>('idle')
const quickParseMessage = ref<string | null>(null)
const quickParseSource = ref<'rule' | 'llm' | null>(null)
const quickParseConfidence = ref<number | null>(null)

// 需求澄清(Step 23)
const clarifierVisible = ref(false)
const clarifierQuestions = ref<ClarifyQuestion[]>([])
const clarifierRequirement = ref<CreativeRequirement>({ subject: '', elements: [] })
const clarifierWarnings = ref<string[]>([])

// 节点图(Step 25)
const graphEditorVisible = ref(false)

// ============================================================================
// Computed
// ============================================================================
const llmResults = computed(() => {
  const ir = runtimeStore.currentIr
  return ir.layers.map((layer, i) => ({
    name: `图层 ${i}`,
    tag: layer.id.substring(0, 12),
  }))
})

const presets = computed(() => [
  { name: '星空密度', value: 0.80 },
  { name: '漩涡强度', value: 0.60 },
  { name: '色相偏移', value: 0.70 },
  { name: '整体亮度', value: 0.90 },
])

const irTree = computed(() => {
  const layerId = runtimeStore.currentLayerId ?? 'layer_0'
  const opcode = runtimeStore.currentOpcode ?? 'LINEAR_GRADIENT'
  return [
    {
      name: 'Layer 0',
      label: '星空',
      tag: 'layer',
      children: [
        { name: 'Region 0', tag: opcode },
        { name: 'Region 1', tag: 'NOISE' },
        { name: 'Region 2', tag: 'CIRCLE_SHAPE' },
      ],
    },
    {
      name: 'Layer 1',
      label: layerId,
      tag: 'layer',
      children: [{ name: 'Region 0', tag: 'SWIRL' }],
    },
  ]
})

const renderClassPool = ['g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'g7', 'g8', 'g9', 'g10']

const timelineFrames = computed(() => {
  const records = runtimeStore.frameRecords
  if (records.length === 0) {
    return [
      { frame: 120, render: 'g1', status: 'ok' as const, note: '就绪' },
      { frame: 124, render: 'g3', status: 'ok' as const, note: '暖色补丁' },
      { frame: 132, render: 'g5', status: 'ok' as const, note: '就绪' },
      { frame: 140, render: 'g2', status: 'ok' as const, note: '冷色补丁' },
      { frame: 150, render: 'g7', status: 'ok' as const, note: '多图层' },
      { frame: 162, render: 'g5', status: 'ok' as const, note: '当前选中' },
      { frame: 168, render: 'g1', status: 'ok' as const, note: '就绪' },
    ]
  }
  return records.map((r, i) => ({
    frame: r.frame,
    render: renderClassPool[i % renderClassPool.length] ?? 'g5',
    status: (r.status === 'error' ? 'err' : 'ok') as 'ok' | 'err',
    note: r.patchSummary ?? r.status,
  }))
})

const topbarStatus = computed(() => runtimeStore.status)
const currentFrame = computed(() => timelineStore.currentFrame)
const totalFrames = computed(() => timelineStore.totalFrames)

const canvasHud = computed(() => {
  const metrics = runtimeStore.performanceMetrics
  return {
    fps: timelineStore.fps,
    frame: currentFrame.value,
    gpuMs: metrics?.gpu.totalMs ?? 3.2,
    memMb: metrics ? metrics.memory.totalMemoryBytes / 1024 / 1024 : 4.2,
  }
})

// 运行时状态面板数据
const runtimeStatus = computed(() => ({
  status: runtimeStore.status,
  isReady: runtimeStore.isReady,
  layerCount: runtimeStore.currentIr.layers.length,
  effectCount: runtimeStore.currentIr.effects.length,
  regionCount: runtimeStore.currentIr.regions.length,
  currentLayerId: runtimeStore.currentLayerId ?? '-',
  currentOpcode: runtimeStore.currentOpcode ?? '-',
  compileCacheHit: runtimeStore.lastCompileCacheHit ?? false,
  isCompiling: runtimeStore.isCompiling,
  progressiveLevel: runtimeStore.currentPreviewLevel ?? 0,
  frameRecords: runtimeStore.frameRecords.length,
}))

// Pro Timeline 状态
const proTimelineInfo = computed(() => ({
  sequenceName: proTimelineStore.activeSequence?.name ?? '未命名序列',
  trackCount: proTimelineStore.tracks.length,
  clipCount: proTimelineStore.activeClips.length,
  duration: proTimelineStore.duration,
  currentFrame: proTimelineStore.currentFrame,
  isPlaying: proTimelineStore.playing,
}))

// 音频混音器状态
const audioMixerInfo = computed(() => ({
  trackCount: audioMixerStore.trackCount,
  hasSolo: audioMixerStore.hasSolo,
  masterVolume: audioMixerStore.masterVolume,
  masterPan: audioMixerStore.masterPan,
  limiterEnabled: audioMixerStore.limiterEnabled,
}))

// 效果链状态
const effectChainInfo = computed(() => ({
  currentClipId: effectChainStore.currentClipId ?? '-',
  effectCount: effectChainStore.currentEffectCount,
  enabledCount: effectChainStore.currentEnabledCount,
}))

// 渲染导出状态
const renderInfo = computed(() => ({
  isRendering: renderStore.isRendering,
  progress: renderStore.progress,
  completedFrames: renderStore.completedFrames,
  totalFrames: renderStore.totalFrames,
  status: renderStore.status,
}))

// 资产注册表状态
const assetInfo = computed(() => ({
  totalAssets: assetRegistryStore.count,
  builtinCount: assetRegistryStore.builtinCount,
  userCount: assetRegistryStore.userCount,
  importedCount: assetRegistryStore.importedCount,
}))

// ============================================================================
// 创作功能
// ============================================================================
async function handleParse() {
  if (!prompt.value || prompt.value.trim().length === 0) {
    parseStatus.value = 'error'
    parseMessage.value = '请输入 prompt'
    return
  }
  parseStatus.value = 'parsing'
  parseMessage.value = null
  try {
    const result = await clarify(prompt.value)
    if (result.status === 'rejected') {
      parseStatus.value = 'error'
      parseMessage.value = result.reason
      return
    }
    if (result.status === 'needs_confirmation') {
      const confirmed = window.confirm(result.questions.join('\n'))
      if (!confirmed) {
        parseStatus.value = 'idle'
        parseMessage.value = '用户取消'
        return
      }
      const ir = parseIntent(result.intent)
      runtimeStore.setRenderIR(ir)
      parseStatus.value = 'success'
      parseMessage.value = `已解析 ${ir.layers.length} 个图层`
      return
    }
    const ir = parseIntent(result.intent)
    runtimeStore.setRenderIR(ir)
    parseStatus.value = 'success'
    parseMessage.value = `已解析 ${ir.layers.length} 个图层${
      ir.effects.length > 0 ? `, ${ir.effects.length} 个效果` : ''
    }`
  } catch (e) {
    parseStatus.value = 'error'
    parseMessage.value = (e as Error).message
  }
}

async function handleQuickParse() {
  if (!prompt.value || prompt.value.trim().length === 0) {
    quickParseStatus.value = 'error'
    quickParseMessage.value = '请输入 prompt'
    return
  }
  quickParseStatus.value = 'parsing'
  quickParseMessage.value = null
  quickParseSource.value = null
  quickParseConfidence.value = null
  try {
    const result = await parsePrompt(prompt.value)
    if (result.layers.length === 0) {
      quickParseStatus.value = 'error'
      quickParseMessage.value = result.metadata.warnings?.[0] ?? '未识别到任何可生成内容'
      quickParseSource.value = result.metadata.source
      quickParseConfidence.value = result.metadata.confidence
      return
    }
    const newIr = {
      ...runtimeStore.currentIr,
      layers: [...runtimeStore.currentIr.layers, ...result.layers],
    }
    runtimeStore.setRenderIR(newIr)
    quickParseStatus.value = 'success'
    quickParseMessage.value = `已追加 ${result.layers.length} 个图层(共 ${newIr.layers.length} 个)`
    quickParseSource.value = result.metadata.source
    quickParseConfidence.value = result.metadata.confidence
  } catch (e) {
    quickParseStatus.value = 'error'
    quickParseMessage.value = (e as Error).message
  }
}

async function handleClarify() {
  if (!prompt.value || prompt.value.trim().length === 0) {
    parseStatus.value = 'error'
    parseMessage.value = '请输入 prompt'
    return
  }
  try {
    const result = await clarifyIntent(prompt.value)
    if (result.status === 'rejected') {
      parseStatus.value = 'error'
      parseMessage.value = result.reason ?? '无法识别创作意图'
      return
    }
    if (result.status === 'needs_clarify') {
      clarifierRequirement.value = result.requirement
      clarifierQuestions.value = result.questions
      clarifierWarnings.value = result.warnings ?? []
      clarifierVisible.value = true
      parseStatus.value = 'idle'
      parseMessage.value = `已识别到 "${result.requirement.subject}",请补全 ${result.questions.length} 项缺失信息`
      return
    }
    finalizeClarifierRequirement(result.requirement)
  } catch (e) {
    parseStatus.value = 'error'
    parseMessage.value = (e as Error).message
  }
}

async function handleClarifierSubmit(answers: ClarifyAnswer[]) {
  try {
    const result = await applyClarifierAnswers(clarifierRequirement.value, answers)
    if (result.status === 'needs_clarify') {
      clarifierRequirement.value = result.requirement
      clarifierQuestions.value = result.questions
      clarifierWarnings.value = result.warnings ?? []
      clarifierVisible.value = true
      return
    }
    finalizeClarifierRequirement(result.requirement)
  } catch (e) {
    parseStatus.value = 'error'
    parseMessage.value = (e as Error).message
  }
}

async function handleClarifierSkip() {
  try {
    const result = await skipClarifierDefaults(clarifierRequirement.value)
    if (result.status === 'needs_clarify') {
      clarifierRequirement.value = result.requirement
      clarifierQuestions.value = result.questions
      clarifierWarnings.value = result.warnings ?? []
      clarifierVisible.value = true
      return
    }
    finalizeClarifierRequirement(result.requirement)
  } catch (e) {
    parseStatus.value = 'error'
    parseMessage.value = (e as Error).message
  }
}

function finalizeClarifierRequirement(req: CreativeRequirement) {
  try {
    const ir = generateRenderIR(req)
    runtimeStore.setRenderIR(ir)
    const parts: string[] = [`主题: ${req.subject}`]
    if (req.style?.tone) parts.push(`调性: ${req.style.tone}`)
    if (req.style?.color) parts.push(`色调: ${req.style.color}`)
    if (req.camera?.movement) parts.push(`镜头: ${req.camera.movement}`)
    if (req.motion?.direction) parts.push(`方向: ${req.motion.direction}`)
    if (req.elements.length > 0) parts.push(`元素: ${req.elements.join(', ')}`)
    parseStatus.value = 'success'
    parseMessage.value = `已生成场景 ${summarizeGeneratedIR(ir)} | ${parts.join(' | ')}`
    clarifierVisible.value = false
  } catch (e) {
    parseStatus.value = 'error'
    parseMessage.value = `生成场景失败: ${(e as Error).message}`
    clarifierVisible.value = false
  }
}

// ============================================================================
// 节点图(Step 25)
// ============================================================================
async function handleOpenGraphEditor() {
  if (!prompt.value || prompt.value.trim().length === 0) {
    parseStatus.value = 'error'
    parseMessage.value = '请输入 prompt'
    return
  }
  try {
    let req = clarifierRequirement.value
    if (!req.subject) {
      const result = await clarifyIntent(prompt.value)
      if (result.status === 'rejected') {
        parseStatus.value = 'error'
        parseMessage.value = result.reason ?? '无法识别创作意图'
        return
      }
      if (result.status === 'needs_clarify') {
        clarifierRequirement.value = result.requirement
        clarifierQuestions.value = result.questions
        clarifierWarnings.value = result.warnings ?? []
        clarifierVisible.value = true
        parseStatus.value = 'idle'
        parseMessage.value = `请先在需求澄清中补全信息,再打开节点图编辑`
        return
      }
      req = result.requirement
      clarifierRequirement.value = req
    }
    const graph = generateGraph(req)
    graphStore.loadGraph(graph)
    graphEditorVisible.value = true
    parseStatus.value = 'success'
    parseMessage.value = `已生成节点图 ${summarizeGraph(graph)}`
  } catch (e) {
    parseStatus.value = 'error'
    parseMessage.value = `生成节点图失败: ${(e as Error).message}`
  }
}

function handleApplyIR(ir: RenderIR) {
  runtimeStore.setRenderIR(ir)
  parseStatus.value = 'success'
  parseMessage.value = `已应用节点图编译结果(${ir.layers.length} 图层 / ${ir.effects.length} 效果)`
}

// ============================================================================
// Canvas 操作
// ============================================================================
function handleInit() {
  if (canvasRef.value) {
    runtimeStore.setScenario('blend_demo')
    historyStore.clear()
    projectStore.newProject('未命名项目')
    void runtimeStore.initialize(canvasRef.value)
    timelineStore.seek(0)
    autosaver.start()
    engine.start()
    projectStore.loadAutosave()
  }
}

function handleRender() {
  void runtimeStore.renderCurrentIR()
}

const batchStatus = ref<'idle' | 'running' | 'success' | 'error'>('idle')
const batchProgress = ref<{ current: number; total: number } | null>(null)

async function handleBatch() {
  if (!runtimeStore.isReady) {
    parseStatus.value = 'error'
    parseMessage.value = '运行时未就绪,请先初始化'
    return
  }
  const startFrame = 0
  const endFrame = timelineStore.totalFrames - 1
  const total = endFrame - startFrame + 1
  batchStatus.value = 'running'
  batchProgress.value = { current: 0, total }
  const originalFrame = timelineStore.currentFrame
  try {
    let rendered = 0
    for (let frame = startFrame; frame <= endFrame; frame++) {
      timelineStore.seek(frame)
      applyCurrentFrameToRuntime({ skipHistory: true })
      await runtimeStore.renderCurrentIR()
      rendered++
      batchProgress.value = { current: rendered, total }
    }
    batchStatus.value = 'success'
  } catch (e) {
    batchStatus.value = 'error'
    parseMessage.value = `批量生成失败: ${(e as Error).message}`
  } finally {
    timelineStore.seek(originalFrame)
    applyCurrentFrameToRuntime({ skipHistory: true })
    batchProgress.value = null
  }
}

function handleSelectFrame(frame: number) {
  runtimeStore.selectFrame(frame)
  runtimeStore.replayFrame(frame)
}

function applyCurrentFrameToRuntime(options: { skipHistory?: boolean } = {}) {
  if (!runtimeStore.isReady) return
  applyFrameToRuntime(
    timelineStore.tracks,
    timelineStore.currentFrame,
    runtimeStore,
    options,
  )
}

function handleTimelineSeek(frame: number) {
  timelineStore.seek(frame)
  applyCurrentFrameToRuntime({ skipHistory: true })
}

// ============================================================================
// 播放控制
// ============================================================================
function handlePlay() { engine.play() }
function handlePause() { engine.pause() }
function handleStepForward() {
  timelineStore.stepForward()
  applyCurrentFrameToRuntime()
}
function handleStepBackward() {
  timelineStore.stepBackward()
  applyCurrentFrameToRuntime()
}
function handleJumpStart() {
  timelineStore.jumpStart()
  applyCurrentFrameToRuntime()
}
function handleJumpEnd() {
  timelineStore.jumpEnd()
  applyCurrentFrameToRuntime()
}

// ============================================================================
// 项目操作(Step 40.3)
// ============================================================================
function handleNewProject() {
  if (projectStore.dirty) {
    if (!window.confirm('当前项目有未保存的修改,是否放弃?')) return
  }
  runtimeStore.setScenario('blend_demo')
  historyStore.clear()
  projectStore.newProject('未命名项目')
  timelineStore.seek(0)
  applyCurrentFrameToRuntime({ skipHistory: true })
}

async function handleOpenProject() {
  if (projectStore.dirty) {
    if (!window.confirm('当前项目有未保存的修改,是否放弃?')) return
  }
  try {
    const file = await pickProjectFile()
    if (!file) return
    const project = await loadProjectFromFile(file)
    projectStore.openProject(project, runtimeStore, timelineStore, historyStore)
    timelineStore.seek(project.timeline.currentFrame)
    applyCurrentFrameToRuntime({ skipHistory: true })
    recordRecentProject(project)
  } catch (e) {
    errorStore.push(e, '请检查项目文件是否损坏')
  }
}

function recordRecentProject(project: PixelForgeProject): void {
  const entry: RecentProjectEntry = {
    id: project.metadata.id,
    name: project.metadata.name,
    filePath: '',
    fileSize: undefined,
    openedAt: Date.now(),
    createdAt: project.metadata.createdAt,
    canvasSize: { ...project.metadata.canvasSize },
  }
  recentProjectsStore.recordOpen(entry)
}

async function handleDropProject(event: DragEvent): Promise<void> {
  const files = extractDroppedFiles(event)
  if (files.length === 0) return
  event.preventDefault()
  if (projectStore.dirty) {
    if (!window.confirm('当前项目有未保存的修改,是否放弃?')) return
  }
  try {
    const file = files[0]
    const text = await file.text()
    const validation = validateProject(JSON.parse(text))
    if (!validation.valid) {
      const msg = formatValidationResult(validation)
      errorStore.pushMessage(`项目文件校验失败:\n${msg}`, 'error', '请检查文件格式')
      return
    }
    if (validation.warningCount > 0) {
      const msg = formatValidationResult(validation)
      errorStore.pushMessage(msg, 'warning')
    }
    const project = deserializeProject(text)
    projectStore.openProject(project, runtimeStore, timelineStore, historyStore)
    timelineStore.seek(project.timeline.currentFrame)
    applyCurrentFrameToRuntime({ skipHistory: true })
    recordRecentProject(project)
  } catch (e) {
    errorStore.push(e, '拖拽导入失败,请检查文件格式')
  }
}

function handleDragOver(event: DragEvent): void {
  event.preventDefault()
}

function handleSaveProject() {
  const project = projectStore.snapshotCurrent(
    runtimeStore,
    timelineStore,
    historyStore,
  )
  if (!project) {
    errorStore.pushMessage('当前没有可保存的项目', 'warning')
    return
  }
  saveProjectToFile(project, project.metadata.name)
  if (projectStore.current) {
    projectStore.current.updatedAt = Date.now()
    projectStore.dirty = false
  }
}

// ============================================================================
// Watchers
// ============================================================================
watch(
  () => historyStore.undoStack.length,
  () => {
    if (projectStore.hasProject) projectStore.markDirty()
  },
)

watch(
  () => timelineStore.tracks,
  () => {
    applyCurrentFrameToRuntime({ skipHistory: false })
  },
  { deep: true },
)

// ============================================================================
// 生命周期
// ============================================================================
settingsStore.init()
recentProjectsStore.init()

onBeforeUnmount(() => {
  autosaver.flush()
  autosaver.stop()
  engine.dispose()
  void runtimeStore.flushRepository()
  settingsStore.dispose()
})
</script>

<template>
  <div class="app-shell">
    <!-- ========== 顶栏 ========== -->
    <header class="topbar" data-tauri-drag-region>
      <div class="topbar-left">
        <div class="topbar-logo">PF</div>
        <div class="topbar-project">
          <span class="project-status" :class="{ live: runtimeStore.isReady }"></span>
          <strong>{{ projectStore.projectName || '未命名项目' }}</strong>
          <span class="project-dirty">{{ projectStore.dirty ? '未保存' : '已保存' }}</span>
        </div>
      </div>

      <div class="topbar-center">
        <button class="tb-btn" @click="handleNewProject" title="新建项目">新建</button>
        <button class="tb-btn" @click="handleOpenProject" title="打开项目">打开</button>
        <button class="tb-btn save" @click="handleSaveProject" title="保存项目">保存</button>
        <span class="tb-sep"></span>
        <button class="tb-btn" @click="handleJumpStart" title="跳到开头">⏮</button>
        <button v-if="timelineStore.isPlaying" class="tb-btn play" @click="handlePause" title="暂停">⏸</button>
        <button v-else class="tb-btn play" @click="handlePlay" title="播放">▶</button>
        <button class="tb-btn" @click="handleStepForward" title="步进">⏭</button>
        <span class="tb-frame">{{ String(currentFrame).padStart(3, '0') }} / {{ totalFrames }}</span>
      </div>

      <div class="topbar-right">
        <button class="tb-panel-btn" @click="showRenderPanel = true" title="渲染导出 (Step 32)">
          <span class="pb-icon">◉</span><span class="pb-label">渲染</span>
        </button>
        <button class="tb-panel-btn" @click="showDirectorPanel = true" title="AI Director (Step 36)">
          <span class="pb-icon">✦</span><span class="pb-label">Director</span>
        </button>
        <button class="tb-panel-btn" @click="showWDLEditor = true" title="WDL 编辑器 (Step 37-38)">
          <span class="pb-icon">⌘</span><span class="pb-label">WDL</span>
        </button>
        <button class="tb-panel-btn" @click="showAssetBrowser = true" title="资产浏览器 (Step 35)">
          <span class="pb-icon">▧</span><span class="pb-label">资产</span>
        </button>
        <span class="tb-sep"></span>
        <button class="tb-panel-btn" @click="showSettings = true" title="设置 (Step 40.1)">
          <span class="pb-icon">⚙</span><span class="pb-label">设置</span>
        </button>
        <div class="window-controls">
          <button class="window-button" aria-label="最小化" @click="minimizeWindow"><span class="minimize-icon"></span></button>
          <button class="window-button" aria-label="最大化" @click="toggleMaximizeWindow"><span class="maximize-icon"></span></button>
          <button class="window-button close" aria-label="关闭" @click="closeWindow"><span class="close-icon"></span></button>
        </div>
      </div>
    </header>

    <!-- ========== 主体区域 ========== -->
    <div class="app-body">
      <!-- ========== 左侧栏 ========== -->
      <aside class="left-panel">
        <nav class="panel-tabs">
          <button :class="{ active: leftTab === 'create' }" @click="leftTab = 'create'">创作</button>
          <button :class="{ active: leftTab === 'graph' }" @click="leftTab = 'graph'">节点图</button>
          <button :class="{ active: leftTab === 'assets' }" @click="leftTab = 'assets'">素材</button>
        </nav>
        <div class="panel-content">
          <ErrorBoundary>
            <!-- 创作工坊 (Step 22-23) -->
            <div v-if="leftTab === 'create'" class="create-workspace">
              <PromptPanel
                :prompt="prompt"
                :llm-results="llmResults"
                :presets="presets"
                :parse-status="parseStatus"
                :parse-message="parseMessage"
                :quick-parse-status="quickParseStatus"
                :quick-parse-message="quickParseMessage"
                :quick-parse-source="quickParseSource"
                :quick-parse-confidence="quickParseConfidence"
                @update:prompt="prompt = $event"
                @parse="handleParse"
                @quick-parse="handleQuickParse"
                @clarify="handleClarify"
                @open-graph="handleOpenGraphEditor"
              />
            </div>

            <!-- 节点图编辑器入口 (Step 25-28) -->
            <div v-else-if="leftTab === 'graph'" class="graph-workspace">
              <div class="workspace-header">
                <strong>节点图编辑器</strong>
                <span class="hint">Step 25-28</span>
              </div>
              <div class="graph-info">
                <div class="info-row"><span>节点数</span><b>{{ graphStore.nodeCount }}</b></div>
                <div class="info-row"><span>连线数</span><b>{{ graphStore.edgeCount }}</b></div>
                <div class="info-row"><span>有效性</span><b :class="{ ok: graphStore.isValid, err: !graphStore.isValid }">{{ graphStore.isValid ? '有效' : '无效' }}</b></div>
                <div class="info-row"><span>材质节点</span><b>{{ materialStore.nodeCount }}</b></div>
                <div class="info-row"><span>材质输出</span><b>{{ materialStore.outputNodeCount }}</b></div>
              </div>
              <button class="action-btn" @click="handleOpenGraphEditor">打开节点图编辑器</button>
              <div class="graph-desc">
                <p>可视化编程引擎,支持 DAG 节点图编辑、Material/Shader WGSL 自动生成、GPU 核融合。</p>
                <p>在编辑器中拖拽节点、连线、编译并应用 RenderIR。</p>
              </div>
            </div>

            <!-- 素材库 (Step 35) -->
            <div v-else-if="leftTab === 'assets'" class="assets-workspace">
              <AssetPanel />
            </div>
          </ErrorBoundary>
        </div>
      </aside>

      <!-- ========== 中央画布 ========== -->
      <main class="canvas-area" @drop="handleDropProject" @dragover="handleDragOver">
        <div class="canvas-header">
          <div class="canvas-title-row">
            <span class="context-kicker">画布</span>
            <strong>WebGPU 渲染</strong>
          </div>
          <div class="canvas-actions">
            <span class="canvas-state" :class="{ live: runtimeStore.isReady }">
              <i></i>{{ runtimeStore.isReady ? '已就绪' : '未初始化' }}
            </span>
            <button class="action-btn small" @click="handleInit">初始化</button>
            <button class="action-btn small" @click="handleRender">渲染</button>
            <button class="action-btn small" @click="handleBatch">批量生成</button>
          </div>
        </div>
        <ErrorBoundary>
          <CanvasView :status="topbarStatus" :hud="canvasHud" @init="handleInit" @render="handleRender" @batch="handleBatch">
            <template #canvas>
              <canvas ref="canvasRef" class="runtime-canvas" />
            </template>
          </CanvasView>
        </ErrorBoundary>
        <div v-if="batchStatus === 'running' && batchProgress" class="batch-progress">
          <span>批量生成中... {{ batchProgress.current }} / {{ batchProgress.total }}</span>
          <div class="progress-bar"><i :style="{ width: `${(batchProgress.current / batchProgress.total) * 100}%` }"></i></div>
        </div>
      </main>

      <!-- ========== 右侧栏 ========== -->
      <aside class="right-panel">
        <nav class="panel-tabs">
          <button :class="{ active: rightTab === 'inspector' }" @click="rightTab = 'inspector'">属性</button>
          <button :class="{ active: rightTab === 'ir' }" @click="rightTab = 'ir'">IR树</button>
          <button :class="{ active: rightTab === 'runtime' }" @click="rightTab = 'runtime'">运行时</button>
          <button :class="{ active: rightTab === 'frames' }" @click="rightTab = 'frames'">帧数据</button>
        </nav>
        <div class="panel-content">
          <ErrorBoundary>
            <!-- 属性面板 -->
            <div v-if="rightTab === 'inspector'" class="inspector-workspace">
              <InspectorPanel />
            </div>

            <!-- IR 树 -->
            <div v-else-if="rightTab === 'ir'" class="ir-workspace">
              <div class="workspace-header">
                <strong>Render IR</strong>
                <span class="hint">{{ runtimeStore.currentIr.layers.length }} 图层</span>
              </div>
              <RenderIRTree :tree="irTree" />
            </div>

            <!-- 运行时状态 (Step 39) -->
            <div v-else-if="rightTab === 'runtime'" class="runtime-workspace">
              <div class="workspace-header">
                <strong>运行时状态</strong>
                <span class="hint">Step 39 性能监控</span>
              </div>
              <div class="info-grid">
                <div class="info-item"><span class="info-label">状态</span><b class="info-value">{{ runtimeStatus.status }}</b></div>
                <div class="info-item"><span class="info-label">就绪</span><b class="info-value" :class="{ ok: runtimeStatus.isReady }">{{ runtimeStatus.isReady ? '是' : '否' }}</b></div>
                <div class="info-item"><span class="info-label">图层数</span><b class="info-value">{{ runtimeStatus.layerCount }}</b></div>
                <div class="info-item"><span class="info-label">效果数</span><b class="info-value">{{ runtimeStatus.effectCount }}</b></div>
                <div class="info-item"><span class="info-label">区域数</span><b class="info-value">{{ runtimeStatus.regionCount }}</b></div>
                <div class="info-item"><span class="info-label">当前图层</span><b class="info-value mono">{{ runtimeStatus.currentLayerId }}</b></div>
                <div class="info-item"><span class="info-label">当前 Opcode</span><b class="info-value mono">{{ runtimeStatus.currentOpcode }}</b></div>
                <div class="info-item"><span class="info-label">编译缓存</span><b class="info-value" :class="{ ok: runtimeStatus.compileCacheHit }">{{ runtimeStatus.compileCacheHit ? '命中' : '未命中' }}</b></div>
                <div class="info-item"><span class="info-label">渐进渲染</span><b class="info-value">L{{ runtimeStatus.progressiveLevel }}</b></div>
                <div class="info-item"><span class="info-label">帧记录</span><b class="info-value">{{ runtimeStatus.frameRecords }}</b></div>
              </div>
              <div class="metrics-section">
                <div class="metric-row"><span>GPU</span><b>{{ canvasHud.gpuMs.toFixed(1) }} ms</b></div>
                <div class="metric-row"><span>FPS</span><b>{{ canvasHud.fps.toFixed(1) }}</b></div>
                <div class="metric-row"><span>内存</span><b>{{ canvasHud.memMb.toFixed(1) }} MB</b></div>
              </div>
              <!-- 模块状态摘要 -->
              <div class="module-status">
                <div class="module-header">模块状态</div>
                <div class="module-item">
                  <span class="module-name">Pro Timeline</span>
                  <span class="module-info">{{ proTimelineInfo.trackCount }} 轨道 · {{ proTimelineInfo.clipCount }} 片段</span>
                </div>
                <div class="module-item">
                  <span class="module-name">音频混音器</span>
                  <span class="module-info">{{ audioMixerInfo.trackCount }} 轨道 · 主音量 {{ audioMixerInfo.masterVolume.toFixed(2) }}</span>
                </div>
                <div class="module-item">
                  <span class="module-name">视频效果链</span>
                  <span class="module-info">{{ effectChainInfo.effectCount }} 效果 · {{ effectChainInfo.enabledCount }} 启用</span>
                </div>
                <div class="module-item">
                  <span class="module-name">渲染导出</span>
                  <span class="module-info" :class="{ active: renderInfo.isRendering }">{{ renderInfo.status }}</span>
                </div>
                <div class="module-item">
                  <span class="module-name">Asset Genome</span>
                  <span class="module-info">{{ assetInfo.totalAssets }} 资产</span>
                </div>
              </div>
            </div>

            <!-- 帧数据 -->
            <div v-else-if="rightTab === 'frames'" class="frames-workspace">
              <div class="workspace-header">
                <strong>帧数据</strong>
                <span class="hint">{{ timelineFrames.length }} 帧</span>
              </div>
              <Timeline :frames="timelineFrames" @select="handleSelectFrame" @seek="handleTimelineSeek" />
            </div>
          </ErrorBoundary>
        </div>
      </aside>
    </div>

    <!-- ========== 底部面板 ========== -->
    <footer class="bottom-panel">
      <nav class="panel-tabs">
        <button :class="{ active: bottomTab === 'pro' }" @click="bottomTab = 'pro'">
          Pro Timeline <span class="tab-badge">{{ proTimelineInfo.trackCount }}</span>
        </button>
        <button :class="{ active: bottomTab === 'animation' }" @click="bottomTab = 'animation'">动画轨道</button>
        <button :class="{ active: bottomTab === 'audio' }" @click="bottomTab = 'audio'">
          音频混音器 <span class="tab-badge">{{ audioMixerInfo.trackCount }}</span>
        </button>
        <button :class="{ active: bottomTab === 'effects' }" @click="bottomTab = 'effects'">
          视频效果链 <span class="tab-badge">{{ effectChainInfo.effectCount }}</span>
        </button>
      </nav>
      <div class="bottom-content">
        <ErrorBoundary>
          <!-- Pro Timeline (Step 31.x) -->
          <ProTimeline v-if="bottomTab === 'pro'" />

          <!-- 动画时间轴 (Step 29) -->
          <div v-else-if="bottomTab === 'animation'" class="animation-tab">
            <div class="workspace-header">
              <strong>动画轨道</strong>
              <span class="hint">Step 29 · {{ timelineStore.fps }} FPS · {{ totalFrames }} 帧</span>
            </div>
            <ParameterTrack />
          </div>

          <!-- 音频混音器 (Step 33) -->
          <ProTimelineAudioMixer v-else-if="bottomTab === 'audio'" />

          <!-- 视频效果链 (Step 34) -->
          <ProTimelineEffectChain v-else-if="bottomTab === 'effects'" />
        </ErrorBoundary>
      </div>
    </footer>

    <!-- ========== 浮动面板 ========== -->
    <!-- 命令面板 (Step 40.2, Ctrl+K) -->
    <CommandPalette :open="showCommandPalette" @close="showCommandPalette = false" />

    <!-- 设置面板 (Step 40.1) -->
    <SettingsDialog :open="showSettings" @close="showSettings = false" />

    <!-- 全局错误通知 (Step 40.4) -->
    <ErrorToast />

    <!-- ========== 模态面板 ========== -->
    <!-- 需求澄清 (Step 23) -->
    <ClarifierDialog
      v-model:visible="clarifierVisible"
      :questions="clarifierQuestions"
      :requirement="clarifierRequirement"
      :warnings="clarifierWarnings"
      @submit="handleClarifierSubmit"
      @skip="handleClarifierSkip"
    />

    <!-- 节点图编辑器 (Step 25) -->
    <GraphEditor v-model:visible="graphEditorVisible" @apply-i-r="handleApplyIR" />

    <!-- 渲染导出面板 (Step 32) -->
    <ProTimelineRenderPanel v-if="showRenderPanel" @close="showRenderPanel = false" />

    <!-- AI Director 面板 (Step 36) -->
    <ProTimelineDirectorPanel v-if="showDirectorPanel" @close="showDirectorPanel = false" />

    <!-- WDL 编辑器 (Step 37-38) -->
    <ProTimelineWDLEditor v-if="showWDLEditor" @close="showWDLEditor = false" />

    <!-- 资产浏览器 (Step 35) -->
    <ProTimelineAssetBrowser v-if="showAssetBrowser" @close="showAssetBrowser = false" />
  </div>
</template>

<style>
/* 主题令牌 */
:root {
  --pf-paper: #111315;
  --pf-surface: #171a1d;
  --pf-surface-soft: #1d2125;
  --pf-surface-sunk: #101214;
  --pf-line: rgba(255, 255, 255, 0.08);
  --pf-line-strong: rgba(255, 255, 255, 0.15);
  --pf-ink: #ece8e1;
  --pf-ink-soft: #b8b4ac;
  --pf-ink-muted: #817f79;
  --pf-ink-faint: #5d5c58;
  --pf-accent: #ef855d;
  --pf-accent-soft: rgba(239, 133, 93, 0.14);
  --pf-accent-deep: #d96945;
  --pf-success: #71c69a;
  --pf-warning: #e6b86a;
  --pf-danger: #e8797f;
  --pf-r-xs: 6px;
  --pf-r-sm: 8px;
  --pf-r-md: 10px;
  --pf-r-lg: 12px;
  --pf-r-xl: 14px;
  --pf-easing: cubic-bezier(0.22, 1, 0.36, 1);
  --pf-duration: 180ms;
}
</style>

<style scoped>
.app-shell {
  display: grid;
  grid-template-rows: 44px minmax(0, 1fr) 260px;
  width: 100vw;
  height: 100vh;
  min-height: 600px;
  background: var(--pf-paper);
  color: var(--pf-ink);
  overflow: hidden;
  font-family: 'DM Sans', system-ui, sans-serif;
}

/* ========== 顶栏 ========== */
.topbar {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 16px;
  padding: 0 12px;
  background: #151719;
  border-bottom: 1px solid var(--pf-line);
  -webkit-app-region: drag;
}
.topbar-left, .topbar-center, .topbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
  -webkit-app-region: no-drag;
}
.topbar-right { justify-content: flex-end; }
.topbar-logo {
  width: 28px; height: 28px;
  display: grid; place-items: center;
  background: var(--pf-accent); color: #17120f;
  border-radius: 7px;
  font: 700 11px 'JetBrains Mono', monospace;
}
.topbar-project {
  display: flex; align-items: center; gap: 8px;
}
.topbar-project strong {
  font-size: 13px; font-weight: 600;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  max-width: 200px;
}
.project-status {
  width: 7px; height: 7px; border-radius: 50%;
  background: var(--pf-ink-faint);
  transition: background var(--pf-duration) var(--pf-easing);
}
.project-status.live { background: var(--pf-success); }
.project-dirty {
  color: var(--pf-ink-muted); font-size: 10px;
}
.tb-btn {
  height: 28px; padding: 0 10px;
  color: var(--pf-ink-soft);
  border: 1px solid var(--pf-line);
  border-radius: var(--pf-r-xs);
  font-size: 11px; cursor: pointer;
  transition: all var(--pf-duration) var(--pf-easing);
}
.tb-btn:hover {
  color: var(--pf-ink); border-color: var(--pf-line-strong);
  background: var(--pf-surface-soft);
}
.tb-btn.save, .tb-btn.play {
  color: #17120f; background: var(--pf-accent); border-color: var(--pf-accent);
}
.tb-btn.play { width: 28px; padding: 0; }
.tb-sep {
  width: 1px; height: 18px; background: var(--pf-line);
  margin: 0 4px;
}
.tb-frame {
  color: var(--pf-ink-muted);
  font: 11px 'JetBrains Mono', monospace;
  min-width: 80px;
}
.tb-panel-btn {
  display: flex; align-items: center; gap: 5px;
  height: 28px; padding: 0 8px;
  color: var(--pf-ink-soft);
  border: 1px solid var(--pf-line);
  border-radius: var(--pf-r-xs);
  font-size: 11px; cursor: pointer;
  transition: all var(--pf-duration) var(--pf-easing);
}
.tb-panel-btn:hover {
  color: var(--pf-accent); border-color: var(--pf-accent);
  background: var(--pf-accent-soft);
}
.pb-icon { font-size: 14px; line-height: 1; }
.pb-label { font-size: 11px; }
.window-controls {
  display: flex; align-items: center; gap: 0;
  height: 44px; margin-left: 8px;
}
.window-button {
  width: 40px; height: 44px;
  display: grid; place-items: center;
  color: rgba(245,245,247,.64); cursor: pointer;
  transition: background .16s ease, color .16s ease;
}
.window-button:hover { color: #fff; background: rgba(255,255,255,.1); }
.window-button.close:hover { background: #d94e5d; color: #fff; }
.minimize-icon, .maximize-icon, .close-icon {
  position: relative; display: block; width: 12px; height: 12px;
}
.minimize-icon::before {
  content: ''; position: absolute; left: 1px; right: 1px; top: 7px;
  height: 1px; background: currentColor;
}
.maximize-icon { width: 13px; height: 13px; }
.maximize-icon::before, .maximize-icon::after {
  content: ''; position: absolute; width: 8px; height: 8px;
  border: 1px solid currentColor; border-radius: 1px;
}
.maximize-icon::before { top: 1px; left: 1px; }
.maximize-icon::after { right: 1px; bottom: 1px; }
.close-icon::before, .close-icon::after {
  content: ''; position: absolute; top: 5px; left: 0;
  width: 13px; height: 1px; background: currentColor; transform: rotate(45deg);
}
.close-icon::after { transform: rotate(-45deg); }

/* ========== 主体区域 ========== */
.app-body {
  display: grid;
  grid-template-columns: 300px minmax(0, 1fr) 300px;
  min-height: 0;
  gap: 1px;
  background: var(--pf-line);
}

/* ========== 左/右侧栏 ========== */
.left-panel, .right-panel {
  display: grid;
  grid-template-rows: 36px minmax(0, 1fr);
  min-height: 0;
  background: var(--pf-surface-sunk);
  overflow: hidden;
}
.panel-tabs {
  display: flex;
  align-items: center;
  gap: 0;
  padding: 0 8px;
  background: #0b0d0f;
  border-bottom: 1px solid var(--pf-line);
  overflow-x: auto;
}
.panel-tabs button {
  height: 36px;
  padding: 0 12px;
  color: var(--pf-ink-muted);
  border: none;
  border-bottom: 2px solid transparent;
  font-size: 11px; cursor: pointer;
  white-space: nowrap;
  transition: all var(--pf-duration) var(--pf-easing);
}
.panel-tabs button:hover { color: var(--pf-ink-soft); }
.panel-tabs button.active {
  color: var(--pf-accent);
  border-bottom-color: var(--pf-accent);
}
.tab-badge {
  display: inline-block;
  min-width: 16px; height: 16px;
  padding: 0 4px;
  margin-left: 4px;
  line-height: 16px;
  text-align: center;
  background: var(--pf-line-strong);
  border-radius: 8px;
  font-size: 10px;
}
.panel-content {
  min-height: 0;
  overflow: auto;
  padding: 8px;
}

/* ========== 画布区域 ========== */
.canvas-area {
  display: grid;
  grid-template-rows: 36px minmax(0, 1fr) auto;
  min-width: 0; min-height: 0;
  background: #080a0d;
  overflow: hidden;
}
.canvas-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 14px;
  background: #0b0d0f;
  border-bottom: 1px solid var(--pf-line);
}
.canvas-title-row {
  display: flex; align-items: center; gap: 8px;
}
.context-kicker {
  color: var(--pf-ink-faint);
  font: 10px 'JetBrains Mono', monospace;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.canvas-actions {
  display: flex; align-items: center; gap: 8px;
}
.canvas-state {
  display: inline-flex; align-items: center; gap: 6px;
  color: var(--pf-ink-muted); font-size: 11px;
}
.canvas-state i {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--pf-ink-faint);
  transition: background var(--pf-duration) var(--pf-easing);
}
.canvas-state.live i { background: var(--pf-success); }
.action-btn {
  height: 26px; padding: 0 10px;
  color: var(--pf-ink-soft);
  border: 1px solid var(--pf-line);
  border-radius: var(--pf-r-xs);
  font-size: 11px; cursor: pointer;
  transition: all var(--pf-duration) var(--pf-easing);
}
.action-btn:hover {
  color: var(--pf-accent); border-color: var(--pf-accent);
  background: var(--pf-accent-soft);
}
.action-btn.small { height: 24px; padding: 0 8px; }
.batch-progress {
  display: flex; align-items: center; gap: 10px;
  padding: 6px 14px;
  background: var(--pf-accent-soft);
  color: var(--pf-accent);
  font-size: 11px;
}
.progress-bar {
  flex: 1; height: 3px;
  background: var(--pf-line-strong);
  border-radius: 99px; overflow: hidden;
}
.progress-bar i {
  display: block; height: 100%;
  background: var(--pf-accent);
  transition: width var(--pf-duration) var(--pf-easing);
}

/* ========== 底部面板 ========== */
.bottom-panel {
  display: grid;
  grid-template-rows: 36px minmax(0, 1fr);
  min-height: 0;
  background: var(--pf-surface-sunk);
  border-top: 1px solid var(--pf-line);
  overflow: hidden;
}
.bottom-content {
  min-height: 0; overflow: auto;
}

/* ========== 通用面板样式 ========== */
.workspace-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--pf-line);
}
.workspace-header strong {
  font-size: 12px; font-weight: 600;
}
.hint {
  color: var(--pf-ink-faint);
  font: 10px 'JetBrains Mono', monospace;
}
.info-row {
  display: flex; justify-content: space-between; align-items: center;
  padding: 7px 12px;
  border-bottom: 1px solid var(--pf-line);
  font-size: 11px;
}
.info-row span { color: var(--pf-ink-muted); }
.info-row b { color: var(--pf-ink-soft); font-weight: 500; }
.info-row b.ok { color: var(--pf-success); }
.info-row b.err { color: var(--pf-danger); }
.graph-info, .info-grid {
  padding: 4px 0;
}
.info-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1px;
  background: var(--pf-line);
  margin-bottom: 8px;
}
.info-item {
  display: flex; flex-direction: column;
  gap: 4px;
  padding: 8px 12px;
  background: var(--pf-surface-sunk);
}
.info-label {
  color: var(--pf-ink-faint);
  font-size: 10px;
}
.info-value {
  color: var(--pf-ink); font-size: 12px;
}
.info-value.mono { font-family: 'JetBrains Mono', monospace; font-size: 11px; }
.info-value.ok { color: var(--pf-success); }
.metrics-section {
  padding: 8px 12px;
  border-top: 1px solid var(--pf-line);
  margin-top: 8px;
}
.metric-row {
  display: flex; justify-content: space-between; align-items: center;
  padding: 5px 0;
  color: var(--pf-ink-muted);
  font-size: 11px;
}
.metric-row b {
  color: var(--pf-ink);
  font: 500 12px 'JetBrains Mono', monospace;
}
.module-status {
  padding: 8px 12px;
  border-top: 1px solid var(--pf-line);
  margin-top: 8px;
}
.module-header {
  color: var(--pf-ink-soft);
  font-size: 11px; font-weight: 600;
  margin-bottom: 8px;
}
.module-item {
  display: flex; justify-content: space-between; align-items: center;
  padding: 5px 0;
  border-bottom: 1px solid var(--pf-line);
  font-size: 11px;
}
.module-name { color: var(--pf-ink-soft); }
.module-info { color: var(--pf-ink-muted); font: 10px 'JetBrains Mono', monospace; }
.module-info.active { color: var(--pf-accent); }
.graph-desc {
  padding: 12px;
  color: var(--pf-ink-muted);
  font-size: 11px;
  line-height: 1.6;
}
.graph-desc p { margin-bottom: 8px; }

/* ========== 动画轨道 tab ========== */
.animation-tab {
  display: grid;
  grid-template-rows: 36px minmax(0, 1fr);
  min-height: 0;
}

/* ========== 响应式滚动 ========== */
.panel-content::-webkit-scrollbar,
.bottom-content::-webkit-scrollbar {
  width: 6px; height: 6px;
}
.panel-content::-webkit-scrollbar-thumb,
.bottom-content::-webkit-scrollbar-thumb {
  background: var(--pf-line-strong);
  border-radius: 3px;
}
.panel-content::-webkit-scrollbar-track,
.bottom-content::-webkit-scrollbar-track {
  background: transparent;
}
</style>
