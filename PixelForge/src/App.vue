<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import AssetPanel from '@/components/editor/AssetPanel.vue'
import CanvasView from '@/components/editor/CanvasView.vue'
import ClarifierDialog from '@/components/editor/ClarifierDialog.vue'
import GraphEditor from '@/components/editor/graph/GraphEditor.vue'
import Inspector from '@/components/editor/inspector/InspectorPanel.vue'
import ParameterTrack from '@/components/editor/timeline/ParameterTrack.vue'
import ProTimeline from '@/components/editor/pro-timeline/ProTimeline.vue'
import PromptPanel from '@/components/editor/PromptPanel.vue'
import RenderIRTree from '@/components/editor/RenderIRTree.vue'
import Timeline from '@/components/editor/Timeline.vue'
import TopBar from '@/components/editor/TopBar.vue'
import { applyFrameToRuntime } from '@/editor/timeline/player'
import { useKeyboardShortcuts } from '@/composables/useKeyboardShortcuts'
import { createAutosaver } from '@/project/autosave'
import { loadProjectFromFile, pickProjectFile, saveProjectToFile } from '@/project/fileSystem'
import { useProjectStore } from '@/project/projectStore'
import { useHistoryStore } from '@/stores/history'
import { useRuntimeStore } from '@/stores/runtime'
import { useTimelineStore } from '@/stores/timeline'
import { createEngine, type PixelForgeEngine } from '@/runtime/engine'
import { InputDriver } from '@/animation/drivers/inputDriver'
import { inputRouter } from '@/input/inputRouter'
import { useMaterialGraphStore } from '@/material/materialGraph'
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
import { useGraphStore } from '@/graph/graphStore'
import type { RenderIR } from '@/compiler/ir/renderIR'
import { parsePrompt } from '@/authoring/prompt/promptParser'
import { parse as parseIntent } from '@/compiler/parser/ruleParser'

const runtimeStore = useRuntimeStore()
const timelineStore = useTimelineStore()
const historyStore = useHistoryStore()
const projectStore = useProjectStore()
const graphStore = useGraphStore()
const materialStore = useMaterialGraphStore()
const canvasRef = ref<HTMLCanvasElement | null>(null)

// —— 启用全局键盘快捷键(Ctrl+Z/Y, Space, ←→, Home/End) ——
useKeyboardShortcuts()

// —— 创建 Engine(主循环聚合层:统一驱动 Timeline + Input + GPU 渲染) ——
// Step 30 集成:替换原 createPlayer,支持音频/摄像头/MIDI 实时输入驱动画面
const engine: PixelForgeEngine = createEngine({
  timelineStore,
  runtimeStore,
  graphStore,
  materialStore,
})

// —— 创建 InputDriver(绑定到全局 inputRouter,管理 Signal → 参数 绑定) ——
// 注册到 engine 后,每帧 engine 会调用 driver.update() 把信号应用到 stores
const inputDriver = new InputDriver(inputRouter)
engine.registerInputDriver(inputDriver)

// —— 自动保存(每 10 秒,仅在 dirty 时触发实际写入) ——
const autosaver = createAutosaver(() => {
  projectStore.autosave(runtimeStore, timelineStore, historyStore)
})

// —— 创作态数据(本地维护,接入 ruleParser) ——
const prompt = ref('纯色背景：深蓝\n渐变：从深蓝到紫，垂直方向\n圆形：中心(0.5,0.5)，半径0.2，黄色')

const parseStatus = ref<'idle' | 'parsing' | 'success' | 'error'>('idle')
const parseMessage = ref<string | null>(null)

// —— 快速生成状态(Step 22 promptParser 路径:rule 关键词优先,LLM 兜底) ——
const quickParseStatus = ref<'idle' | 'parsing' | 'success' | 'error'>('idle')
const quickParseMessage = ref<string | null>(null)
const quickParseSource = ref<'rule' | 'llm' | null>(null)
const quickParseConfidence = ref<number | null>(null)

// —— 需求澄清状态(Step 23 clarifier 路径:自由文本 → CreativeRequirement) ——
const clarifierVisible = ref(false)
const clarifierQuestions = ref<ClarifyQuestion[]>([])
const clarifierRequirement = ref<CreativeRequirement>({ subject: '', elements: [] })
const clarifierWarnings = ref<string[]>([])

// —— 节点图编辑器状态(Step 25:Requirement → RenderGraph → DAG 编辑 → 编译为 RenderIR) ——
const graphEditorVisible = ref(false)

// —— 时间轴模式切换(Step 31.2:专业时间轴 ProTimeline 与现有帧级 Timeline 并存) ——
// 'frame' = 现有帧级时间轴(用于 AI 生成预览)
// 'pro'   = 专业时间轴(bigint 微秒精度,Clip CRUD)
type TimelineMode = 'frame' | 'pro'
const timelineMode = ref<TimelineMode>('frame')

type LeftPanelMode = 'create' | 'assets'
type RightPanelMode = 'inspect' | 'structure'
const leftPanelMode = ref<LeftPanelMode>('create')
const rightPanelMode = ref<RightPanelMode>('inspect')

function setTimelineMode(mode: TimelineMode) {
  timelineMode.value = mode
}

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

// —— Render IR 树(从 store 派生,简化展示) ——
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

// —— 缩略图时间轴(从 store 派生,空时回落演示数据) ——
const renderClassPool = ['g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'g7', 'g8', 'g9', 'g10']

const timelineFrames = computed(() => {
  const records = runtimeStore.frameRecords
  if (records.length === 0) {
    return [
      { frame: 120, render: 'g1',  status: 'ok' as const,  note: '就绪' },
      { frame: 124, render: 'g3',  status: 'ok' as const,  note: '暖色补丁' },
      { frame: 132, render: 'g5',  status: 'ok' as const,  note: '就绪' },
      { frame: 140, render: 'g2',  status: 'ok' as const,  note: '冷色补丁' },
      { frame: 150, render: 'g7',  status: 'ok' as const,  note: '多图层' },
      { frame: 162, render: 'g5',  status: 'ok' as const,  note: '当前选中' },
      { frame: 168, render: 'g1',  status: 'ok' as const,  note: '就绪' },
    ]
  }
  return records.map((r, i) => ({
    frame: r.frame,
    render: renderClassPool[i % renderClassPool.length] ?? 'g5',
    status: (r.status === 'error' ? 'err' : 'ok') as 'ok' | 'err',
    note: r.patchSummary ?? r.status,
  }))
})

// —— 顶栏 + 画布 HUD ——
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

// —— 属性面板(Inspector 自己从 store 读取 currentIr.layers,无需父组件传 props) ——

// —— 事件处理 ——
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
      // 用已解析的 intent 继续生成 IR
      const ir = parseIntent(result.intent)
      runtimeStore.setRenderIR(ir)
      parseStatus.value = 'success'
      parseMessage.value = `已解析 ${ir.layers.length} 个图层`
      return
    }

    // auto_resolved
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

/**
 * 快速生成(Step 22 promptParser 路径)。
 *
 * 链路:
 *   prompt
 *     → parsePrompt(text)              [rule 关键词优先,LLM 兜底]
 *     → Layer[]
 *     → 追加到 runtimeStore.currentIr.layers
 *     → renderCurrentIR() → GPU 重渲染
 *
 * 与 handleParse(clarify 路径)的区别:
 * - handleParse:重置整个 RenderIR(替换式)
 * - handleQuickParse:追加 Layer 到现有 IR(增量式)
 * - 适合"在现有场景上叠加元素"的场景
 */
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
    // 当前未注入 LLMClient,只走 rule 关键词路径
    // 后续接入真实 LLM 时通过 options.llmClient 注入
    const result = await parsePrompt(prompt.value)

    if (result.layers.length === 0) {
      quickParseStatus.value = 'error'
      quickParseMessage.value = result.metadata.warnings?.[0] ?? '未识别到任何可生成内容'
      quickParseSource.value = result.metadata.source
      quickParseConfidence.value = result.metadata.confidence
      return
    }

    // 追加 layers 到当前 IR(增量式,不替换整个 IR)
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

/**
 * 需求澄清(Step 23 clarifier 路径)。
 *
 * 链路:
 *   prompt
 *     → clarifyIntent(text)              [意图分析 → CreativeRequirement]
 *     → 若 rejected:        提示错误
 *     → 若 needs_clarify:   打开 ClarifierDialog 让用户作答
 *     → 若 auto_resolved:   直接进入 Step 24(暂未实现,先 console 输出 requirement)
 *
 * 与 handleParse(clarify/ 路径)和 handleQuickParse(prompt/ 路径)的区别:
 * - handleParse:       结构化 prompt("纯色：红色\n渐变：从红到蓝") → ParsedIntent → RenderIR
 * - handleQuickParse:  关键词命中("星空漩涡") → Layer[](追加)
 * - handleClarify:     自由文本("电影感宇宙") → CreativeRequirement → 追问 → Step 24
 */
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

    // auto_resolved:意图完整,无需追问
    finalizeClarifierRequirement(result.requirement)
  } catch (e) {
    parseStatus.value = 'error'
    parseMessage.value = (e as Error).message
  }
}

/**
 * 用户在 ClarifierDialog 中点击"确认生成"提交答案。
 *
 * 链路:
 *   answers
 *     → applyClarifierAnswers(requirement, answers)  [合并答案 → 重新检测缺失]
 *     → 若仍 needs_clarify: 重新打开 dialog(理论上不应发生)
 *     → 若 auto_resolved:   进入 Step 24
 */
async function handleClarifierSubmit(answers: ClarifyAnswer[]) {
  try {
    const result = await applyClarifierAnswers(clarifierRequirement.value, answers)
    if (result.status === 'needs_clarify') {
      // 仍有缺失字段(罕见,用户跳过某些必填项时可能发生)
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

/**
 * 用户在 ClarifierDialog 中点击"使用默认值"。
 *
 * 链路:
 *   requirement
 *     → skipClarifierDefaults(requirement)  [用 defaultValue 填充所有缺失字段]
 *     → auto_resolved → 进入 Step 24
 */
async function handleClarifierSkip() {
  try {
    const result = await skipClarifierDefaults(clarifierRequirement.value)
    if (result.status === 'needs_clarify') {
      // 极端情况:某些字段无 defaultValue,继续追问
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

/**
 * Clarifier 完成(需求已确认),进入 Step 24 RenderIR Generator。
 *
 * 链路:
 *   requirement
 *     → generateRenderIR(requirement)              [planner + parameterMapper + layerTemplates]
 *     → RenderIR
 *     → runtimeStore.setRenderIR(ir)               [触发 GPU 重渲染]
 *
 * Step 24 接入后,这一步真正"生成 PixelForge 场景"。
 */
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

    console.info('[generator] 已生成 RenderIR:', ir)
  } catch (e) {
    parseStatus.value = 'error'
    parseMessage.value = `生成场景失败: ${(e as Error).message}`
    clarifierVisible.value = false
  }
}

/**
 * 打开节点图编辑器(Step 25 路径)。
 *
 * 链路:
 *   prompt
 *     → 若 clarifierRequirement 为空 → clarifyIntent(prompt)  [意图分析]
 *     → 若 needs_clarify              → 打开 ClarifierDialog(等用户补全后再来)
 *     → CreativeRequirement
 *     → generateGraph(requirement)                              [planner + NodeRegistry]
 *     → graphStore.loadGraph(graph)                             [灌入 store]
 *     → graphEditorVisible = true                               [打开编辑器]
 *
 * 用户在 GraphEditor 中编辑后,点击"编译并应用":
 *   → compileGraph(graph) → RenderIR → handleApplyIR → runtimeStore.setRenderIR
 */
async function handleOpenGraphEditor() {
  if (!prompt.value || prompt.value.trim().length === 0) {
    parseStatus.value = 'error'
    parseMessage.value = '请输入 prompt'
    return
  }

  try {
    // 如果尚未通过 clarify 路径解析过 requirement,先跑一次 clarifier
    let req = clarifierRequirement.value
    if (!req.subject) {
      const result = await clarifyIntent(prompt.value)

      if (result.status === 'rejected') {
        parseStatus.value = 'error'
        parseMessage.value = result.reason ?? '无法识别创作意图'
        return
      }

      if (result.status === 'needs_clarify') {
        // 需求不完整,先打开澄清弹窗让用户补全
        clarifierRequirement.value = result.requirement
        clarifierQuestions.value = result.questions
        clarifierWarnings.value = result.warnings ?? []
        clarifierVisible.value = true
        parseStatus.value = 'idle'
        parseMessage.value = `已识别到 "${result.requirement.subject}",请先在需求澄清中补全 ${result.questions.length} 项缺失信息,再打开节点图编辑`
        return
      }

      req = result.requirement
      clarifierRequirement.value = req
    }

    // Requirement → RenderGraph(复用 Step 24 planner + NodeRegistry)
    const graph = generateGraph(req)
    graphStore.loadGraph(graph)

    graphEditorVisible.value = true
    parseStatus.value = 'success'
    parseMessage.value = `已生成节点图 ${summarizeGraph(graph)},可在编辑器中继续修改并编译应用`
  } catch (e) {
    parseStatus.value = 'error'
    parseMessage.value = `生成节点图失败: ${(e as Error).message}`
  }
}

/**
 * 接收 GraphEditor 编译后的 RenderIR,应用到 runtime(触发 GPU 重渲染)。
 *
 * 用户在 GraphEditor 中点击"编译并应用"时触发:
 *   graph.exportGraph() → compileGraph(graph) → RenderIR → emit('applyIR', ir)
 *   → 此处调用 runtimeStore.setRenderIR(ir)
 */
function handleApplyIR(ir: RenderIR) {
  runtimeStore.setRenderIR(ir)
  parseStatus.value = 'success'
  parseMessage.value = `已应用节点图编译结果(${ir.layers.length} 图层 / ${ir.effects.length} 效果 / ${ir.regions.length} 区域)`
}

function handleInit() {
  if (canvasRef.value) {
    // 切换到 blend_demo 场景(4 个 layer,匹配 timeline store 默认 tracks 配置)
    runtimeStore.setScenario('blend_demo')
    // 场景切换 → 历史 stack 失效(老 patch 不再适用)
    historyStore.clear()
    // 创建/打开项目:初始化时自动新建一个项目(便于 autosave)
    projectStore.newProject('未命名项目')
    void runtimeStore.initialize(canvasRef.value)
    // 重置播放头到开头
    timelineStore.seek(0)
    // 启动自动保存
    autosaver.start()
    // 启动 Engine 主循环(Timeline + Input + GPU 渲染)
    engine.start()
    // 启动时尝试从 localStorage 恢复自动保存(若有,提示用户)
    const recovered = projectStore.loadAutosave()
    if (recovered) {
      console.info('[project] 检测到自动保存,可点击"打开"恢复:', recovered.metadata.name)
    }
  }
}

// —— 项目文件操作 ——

/** 新建项目:重置场景 + 清空历史 + 新建 metadata */
function handleNewProject() {
  if (projectStore.dirty) {
    const ok = window.confirm('当前项目有未保存的修改,是否放弃?')
    if (!ok) return
  }
  runtimeStore.setScenario('blend_demo')
  historyStore.clear()
  projectStore.newProject('未命名项目')
  timelineStore.seek(0)
  applyCurrentFrameToRuntime({ skipHistory: true })
}

/** 打开项目:弹出文件选择 → 解析 → 还原 store */
async function handleOpenProject() {
  if (projectStore.dirty) {
    const ok = window.confirm('当前项目有未保存的修改,是否放弃?')
    if (!ok) return
  }
  try {
    const file = await pickProjectFile()
    if (!file) return  // 用户取消
    const project = await loadProjectFromFile(file)
    projectStore.openProject(project, runtimeStore, timelineStore, historyStore)
    // 重置播放头到加载项目的位置
    timelineStore.seek(project.timeline.currentFrame)
    applyCurrentFrameToRuntime({ skipHistory: true })
  } catch (e) {
    console.error('[project] 打开失败:', e)
    window.alert(`打开项目失败: ${(e as Error).message}`)
  }
}

/** 保存项目:快照 → 触发浏览器下载 .pixelforge 文件 */
function handleSaveProject() {
  const project = projectStore.snapshotCurrent(
    runtimeStore,
    timelineStore,
    historyStore,
  )
  if (!project) {
    window.alert('当前没有可保存的项目')
    return
  }
  saveProjectToFile(project, project.metadata.name)
  // 保存成功后清 dirty 标记
  if (projectStore.current) {
    projectStore.current.updatedAt = Date.now()
    projectStore.dirty = false
  }
}

// —— 监听编辑操作 → 标记 dirty(用于自动保存提示) ——
watch(
  () => historyStore.undoStack.length,
  () => {
    if (projectStore.hasProject) projectStore.markDirty()
  },
)

function handleRender() {
void runtimeStore.renderCurrentIR()
}

// —— 批量生成状态 ——
const batchStatus = ref<'idle' | 'running' | 'success' | 'error'>('idle')
const batchProgress = ref<{ current: number; total: number } | null>(null)

/**
 * 批量生成:遍历时间轴帧范围,逐帧求值轨道参数并渲染。
 *
 * 链路(每帧):
 *   timelineStore.seek(frame)
 *     → applyFrameToRuntime(tracks, frame, runtime)   关键帧插值 → ValuePatch → IR 更新
 *     → await runtimeStore.renderCurrentIR()             RegionCompiler + GPU dispatch + 帧记录
 *     → 下一帧
 *
 * 完成后恢复原始帧位置。
 */
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
  parseStatus.value = 'parsing'
  parseMessage.value = `批量生成 ${startFrame} → ${endFrame} (共 ${total} 帧)`

  const originalFrame = timelineStore.currentFrame

  try {
    let rendered = 0
    for (let frame = startFrame; frame <= endFrame; frame++) {
      timelineStore.seek(frame)
      applyCurrentFrameToRuntime({ skipHistory: true })
      // 等待当前帧渲染完成(包括编译 + GPU dispatch + 帧记录写入)
      await runtimeStore.renderCurrentIR()
      rendered++
      batchProgress.value = { current: rendered, total }
    }

    batchStatus.value = 'success'
    parseStatus.value = 'success'
    parseMessage.value = `批量生成完成: ${rendered} 帧已渲染`
  } catch (e) {
    batchStatus.value = 'error'
    parseStatus.value = 'error'
    parseMessage.value = `批量生成失败: ${(e as Error).message}`
  } finally {
    // 恢复原始帧位置
    timelineStore.seek(originalFrame)
    applyCurrentFrameToRuntime({ skipHistory: true })
    batchProgress.value = null
  }
}

function handleSelectFrame(frame: number) {
  runtimeStore.selectFrame(frame)
  runtimeStore.replayFrame(frame)
}

/**
 * 把当前帧上的所有轨道求值结果应用到 runtime(求值 → ValuePatch → GPU 重渲染)。
 *
 * 链路:
 *   timelineStore.currentFrame
 *     → evaluateTrack(track, frame)        关键帧插值
 *     → runtimeStore.applyValuePatch       生成 ValuePatch
 *     → patchEngine.applyPatch             IR 更新
 *     → renderCurrentIR                    RegionCompiler + GPU dispatch
 *
 * @param options.skipHistory 默认 true(seek/play 等浏览操作不记录历史)
 *                            编辑入口(如拖关键帧)传 false
 */
function applyCurrentFrameToRuntime(options: { skipHistory?: boolean } = {}) {
  if (!runtimeStore.isReady) return
  applyFrameToRuntime(
    timelineStore.tracks,
    timelineStore.currentFrame,
    runtimeStore,
    options,
  )
}

/** 时间轴标尺 seek(点击 / 拖动) → 应用所有轨道 patch(浏览操作,不记历史) */
function handleTimelineSeek(frame: number) {
  timelineStore.seek(frame)
  applyCurrentFrameToRuntime({ skipHistory: true })
}

/**
 * 监听 tracks 深度变化(关键帧拖动 / 添加 / 删除 / 重置)
 * → 重新求值当前帧并应用到 runtime,保证 canvas 实时反馈曲线编辑
 * → 这是"编辑"操作,记录到 history(可被 undo 还原)
 */
watch(
  () => timelineStore.tracks,
  () => {
    applyCurrentFrameToRuntime({ skipHistory: false })
  },
  { deep: true },
)

// —— TopBar 播放控制 ——
function handlePlay() {
  engine.play()
}

function handlePause() {
  engine.pause()
}

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

// —— TopBar 历史控制 ——
function handleUndo() {
  historyStore.undo(runtimeStore)
}

function handleRedo() {
  historyStore.redo(runtimeStore)
}

onBeforeUnmount(() => {
  // 卸载前立即 flush 一次自动保存(避免丢失最近 10 秒内的修改)
  autosaver.flush()
  autosaver.stop()
  engine.dispose()
  void runtimeStore.flushRepository()
})
</script>

<template>
  <div class="editor-shell">
    <TopBar
      :status="topbarStatus"
      :current-frame="currentFrame"
      :total-frames="totalFrames"
      @play="handlePlay"
      @pause="handlePause"
      @step-forward="handleStepForward"
      @step-backward="handleStepBackward"
      @jump-start="handleJumpStart"
      @jump-end="handleJumpEnd"
      @undo="handleUndo"
      @redo="handleRedo"
      @new-project="handleNewProject"
      @open-project="handleOpenProject"
      @save-project="handleSaveProject"
    />

    <div class="editor-workspace">
      <aside class="editor-left">
        <nav class="tool-rail" aria-label="工作区工具">
          <div class="rail-brand">PF</div>
          <button class="rail-tool" :class="{ active: leftPanelMode === 'create' }" data-tip="创作" @click="leftPanelMode = leftPanelMode === 'create' ? 'create' : 'create'">
            <span class="rail-icon">✦</span><span>创作</span>
          </button>
          <button class="rail-tool" :class="{ active: leftPanelMode === 'assets' }" data-tip="素材" @click="leftPanelMode = 'assets'">
            <span class="rail-icon">▧</span><span>素材</span>
          </button>
          <div class="rail-spacer"></div>
          <button class="rail-tool" data-tip="节点图" @click="handleOpenGraphEditor"><span class="rail-icon">⌘</span><span>节点</span></button>
          <button class="rail-tool" data-tip="项目设置" @click="handleSaveProject"><span class="rail-icon">⚙</span><span>设置</span></button>
        </nav>
        <section class="tool-drawer" :class="{ open: leftPanelMode }">
          <div class="drawer-head">
            <div>
              <span class="context-kicker">工作台</span>
              <strong>{{ leftPanelMode === 'create' ? '创作指令' : '项目素材' }}</strong>
            </div>
            <span class="drawer-count">{{ leftPanelMode === 'create' ? 'AI' : 'LIB' }}</span>
          </div>
          <PromptPanel v-if="leftPanelMode === 'create'"
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
          <AssetPanel v-else />
        </section>
      </aside>

      <main class="editor-center">
        <div class="canvas-workspace">
          <div class="workspace-context">
          <div>
            <span class="context-kicker">工作区 / 预览</span>
            <h1>把想法变成可编辑的画面</h1>
          </div>
          <div class="context-actions">
            <span class="context-state"><i :class="{ live: runtimeStore.isReady }"></i>{{ runtimeStore.isReady ? '实时预览' : '等待初始化' }}</span>
            <button class="context-action" @click="handleInit">初始化画布</button>
          </div>
        </div>
        <CanvasView
          :status="topbarStatus"
          :hud="canvasHud"
          @init="handleInit"
          @render="handleRender"
          @batch="handleBatch"
        >
          <template #canvas><canvas ref="canvasRef" class="runtime-canvas" /></template>
        </CanvasView>
        </div>
        <div class="timeline-dock-head">
          <div>
            <span class="context-kicker">时间控制</span>
            <strong>{{ timelineMode === 'frame' ? '预览时间轴' : '专业剪辑时间轴' }}</strong>
          </div>
          <div class="timeline-mode-switch">
            <button class="mode-btn" :class="{ active: timelineMode === 'frame' }" @click="setTimelineMode('frame')">预览</button>
            <button class="mode-btn" :class="{ active: timelineMode === 'pro' }" @click="setTimelineMode('pro')">专业</button>
          </div>
        </div>
        <Timeline v-if="timelineMode === 'frame'" :frames="timelineFrames" @select="handleSelectFrame" @seek="handleTimelineSeek" />
        <ProTimeline v-else />
        <ParameterTrack />
      </main>

      <aside class="editor-right">
        <div class="inspector-rail">
          <div class="rail-brand">CHK</div>
          <button class="rail-tool" :class="{ active: rightPanelMode === 'inspect' }" data-tip="属性检查" @click="rightPanelMode = 'inspect'"><span class="rail-icon">◉</span><span>属性</span></button>
          <button class="rail-tool" :class="{ active: rightPanelMode === 'structure' }" data-tip="结构检查" @click="rightPanelMode = 'structure'"><span class="rail-icon">≡</span><span>结构</span></button>
          <div class="rail-spacer"></div>
          <span class="rail-status">{{ runtimeStore.isReady ? 'LIVE' : 'IDLE' }}</span>
        </div>
        <section class="inspector-drawer">
          <div class="drawer-head">
            <div><span class="context-kicker">检查器</span><strong>{{ rightPanelMode === 'inspect' ? '属性面板' : 'Render IR' }}</strong></div>
            <span class="drawer-count">{{ rightPanelMode === 'inspect' ? 'EDIT' : 'DATA' }}</span>
          </div>
          <template v-if="rightPanelMode === 'inspect'"><Inspector /><div class="right-guide"><span class="context-kicker">当前上下文</span><strong>调整选中对象</strong><p>属性变化会立即反映到画布和时间轴。</p></div></template>
          <RenderIRTree v-else :tree="irTree" />
        </section>
      </aside>
    </div>

    <!-- 需求澄清弹窗(Step 23) -->
    <ClarifierDialog
      v-model:visible="clarifierVisible"
      :questions="clarifierQuestions"
      :requirement="clarifierRequirement"
      :warnings="clarifierWarnings"
      @submit="handleClarifierSubmit"
      @skip="handleClarifierSkip"
    />

    <!-- 节点图编辑器(Step 25) -->
    <GraphEditor
      v-model:visible="graphEditorVisible"
      @apply-i-r="handleApplyIR"
    />
  </div>
</template>

<style>
/* Editor theme tokens */
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
}
</style>

<style scoped>
.editor-shell {
  height: 100vh;
  background: var(--pf-paper);
  color: var(--pf-ink);
  padding: 0;
  display: grid;
  grid-template-rows: 52px minmax(0, 1fr);
  overflow: hidden;
  font-family: 'DM Sans', system-ui, sans-serif;
}

.editor-workspace {
  display: grid;
  grid-template-columns: 320px minmax(0, 1fr) 320px;
  gap: 1px;
  min-height: 0;
  padding: 0;
  background: var(--pf-line);
}

.editor-left, .editor-right { display: grid; grid-template-columns: 54px minmax(0, 1fr); min-height: 0; padding: 0; overflow: hidden; }
.tool-rail, .inspector-rail { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 12px 6px; background: #0c0e10; border-right: 1px solid var(--pf-line); }
.inspector-rail { border-right: 0; border-left: 1px solid var(--pf-line); order: 2; }
.rail-brand { color: var(--pf-accent); font: 600 11px 'JetBrains Mono', monospace; padding: 8px 0 13px; }
.rail-tool { width: 42px; min-height: 48px; display: grid; place-items: center; gap: 2px; color: var(--pf-ink-muted); cursor: pointer; border-radius: var(--pf-r-xs); font-size: 9px; }
.rail-tool:hover, .rail-tool.active { color: var(--pf-ink); background: var(--pf-accent-soft); }
.rail-icon { font-size: 17px; line-height: 1; }
.rail-spacer { flex: 1; }
.rail-status { writing-mode: vertical-rl; color: var(--pf-success); font: 9px 'JetBrains Mono', monospace; letter-spacing: .08em; padding-bottom: 8px; }
.tool-drawer, .inspector-drawer { min-width: 0; min-height: 0; display: flex; flex-direction: column; overflow: hidden; padding: 12px; background: var(--pf-surface-sunk); }
.inspector-drawer { order: 1; overflow: auto; }
.drawer-head { display: flex; justify-content: space-between; align-items: flex-start; padding: 2px 2px 10px; border-bottom: 1px solid var(--pf-line); }
.drawer-head strong { display: block; margin-top: 4px; font-size: 13px; font-weight: 600; }
.drawer-count { color: var(--pf-ink-faint); font: 10px 'JetBrains Mono', monospace; }

.editor-center {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto auto auto;
  gap: 8px;
  padding: 12px 14px 10px;
  overflow: hidden;
}

.workspace-context, .timeline-dock-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.workspace-context { padding: 2px 4px 5px; }
.context-kicker { display: block; color: var(--pf-ink-muted); font: 500 10px 'JetBrains Mono', monospace; letter-spacing: .05em; text-transform: uppercase; }
.workspace-context h1 { margin-top: 3px; font-size: 18px; font-weight: 600; letter-spacing: 0; }
.context-actions { display: flex; align-items: center; gap: 12px; }
.context-state { display: inline-flex; align-items: center; gap: 7px; color: var(--pf-ink-muted); font-size: 11px; }
.context-state i { width: 6px; height: 6px; border-radius: 50%; background: var(--pf-warning); }
.context-state i.live { background: var(--pf-success); box-shadow: 0 0 0 3px rgba(113, 198, 154, .12); }
.context-action { height: 30px; padding: 0 10px; border: 1px solid var(--pf-line-strong); border-radius: var(--pf-r-xs); background: var(--pf-surface); color: var(--pf-ink-soft); font-size: 11px; cursor: pointer; }
.context-action:hover { color: var(--pf-ink); border-color: var(--pf-accent); }
.timeline-dock-head { min-height: 30px; padding: 3px 4px 0; }
.timeline-dock-head strong { display: block; margin-top: 2px; font-size: 12px; font-weight: 600; }

.editor-right { gap: 8px; padding: 10px; }
.right-guide { padding: 13px; border-top: 1px solid var(--pf-line); color: var(--pf-ink-muted); }
.right-guide strong { display: block; margin-top: 7px; color: var(--pf-ink-soft); font-size: 12px; }
.right-guide p { margin-top: 5px; font-size: 11px; line-height: 1.5; }

/* 时间轴模式切换 */
.timeline-mode-switch {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  background: var(--pf-surface);
  border: 1px solid var(--pf-line);
  border-radius: var(--pf-r-xs);
  width: fit-content;
}
.mode-btn { height: 25px; padding: 0 10px; border: none; background: transparent; color: var(--pf-ink-muted); font-size: 11px; border-radius: 5px; cursor: pointer; }
.mode-btn:hover { color: var(--pf-ink); }
.mode-btn.active { background: var(--pf-accent-soft); color: var(--pf-accent); }

.runtime-canvas {
  display: block;
}

@media (max-width: 1280px) {
  .editor-workspace { grid-template-columns: 280px minmax(0, 1fr); }
  .editor-right { display: none; }
}

@media (max-width: 860px) {
  .editor-workspace { grid-template-columns: 1fr; }
  .editor-center { grid-template-rows: auto auto auto; }
}
</style>
