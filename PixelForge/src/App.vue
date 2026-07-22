<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { getCurrentWindow } from '@tauri-apps/api/window'

import AssetPanel from '@/components/editor/AssetPanel.vue'
import CanvasView from '@/components/editor/CanvasView.vue'
import ClarifierDialog from '@/components/editor/ClarifierDialog.vue'
import GraphEditor from '@/components/editor/graph/GraphEditor.vue'
import PromptPanel from '@/components/editor/PromptPanel.vue'
import RenderIRTree from '@/components/editor/RenderIRTree.vue'
import Timeline from '@/components/editor/Timeline.vue'
import { applyFrameToRuntime } from '@/editor/timeline/player'
import { useCommandShortcuts } from '@/composables/useCommandShortcuts'
import { commandRegistry, registerDefaultCommands } from '@/composables/commandRegistry'
import { createAutosaver } from '@/project/autosave'
import { loadProjectFromFile, pickProjectFile, saveProjectToFile } from '@/project/fileSystem'
import { useRecentProjectsStore, type RecentProjectEntry } from '@/project/recentProjects'
import { validateProject, formatValidationResult } from '@/project/projectValidator'
import { extractDroppedFiles } from '@/project/projectExport'
import { deserializeProject } from '@/project/serializer'
import { useProjectStore } from '@/project/projectStore'
import type { PixelForgeProject } from '@/project/types'
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
import { useSettingsStore } from '@/preferences/settingsStore'
import SettingsDialog from '@/components/editor/SettingsDialog.vue'
import CommandPalette from '@/components/editor/CommandPalette.vue'

const runtimeStore = useRuntimeStore()
const timelineStore = useTimelineStore()
const historyStore = useHistoryStore()
const projectStore = useProjectStore()
const graphStore = useGraphStore()
const materialStore = useMaterialGraphStore()
const settingsStore = useSettingsStore()
const recentProjectsStore = useRecentProjectsStore()
const showSettings = ref(false)
const showCommandPalette = ref(false)
const canvasRef = ref<HTMLCanvasElement | null>(null)

const appWindow = getCurrentWindow()
async function minimizeWindow() { await appWindow.minimize() }
async function toggleMaximizeWindow() { await appWindow.toggleMaximize() }
async function closeWindow() { await appWindow.close() }

// —— 全局键盘快捷键(Step 40.2:基于 CommandRegistry 统一调度) ——
// 注册默认命令(播放控制 + 撤销/重做),对齐原 useKeyboardShortcuts.ts 行为
registerDefaultCommands({
  togglePlay: () => timelineStore.togglePlay(),
  stepForward: () => timelineStore.stepForward(),
  stepBackward: () => timelineStore.stepBackward(),
  jumpStart: () => timelineStore.jumpStart(),
  jumpEnd: () => timelineStore.jumpEnd(),
  undo: () => historyStore.undo(runtimeStore),
  redo: () => historyStore.redo(runtimeStore),
})
// 命令面板命令(Ctrl+K / Cmd+K)
commandRegistry.register({
  id: 'view.commandPalette',
  name: '打开命令面板',
  description: '搜索并执行任意命令',
  category: 'view',
  shortcut: 'mod+k',
  activeWhenEditing: true,
  execute: () => { showCommandPalette.value = true },
})
useCommandShortcuts()

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
const leftPanelMode = ref<LeftPanelMode>('create')

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

/** 打开项目:弹出文件选择 → 解析 → 还原 store → 记录最近项目 */
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
    // 记录到最近项目(Step 40.3)
    recordRecentProject(project)
  } catch (e) {
    console.error('[project] 打开失败:', e)
    window.alert(`打开项目失败: ${(e as Error).message}`)
  }
}

/**
 * 把打开的项目记录到最近项目列表(Step 40.3)。
 */
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

/**
 * 拖拽导入项目文件(Step 40.3)。
 *
 * 浏览器拖拽 API:用户把 .pixelforge 文件拖到画布区域触发。
 * 支持拖入单个项目文件,自动校验 + 还原 store + 记录最近项目。
 */
async function handleDropProject(event: DragEvent): Promise<void> {
  const files = extractDroppedFiles(event)
  if (files.length === 0) return
  event.preventDefault()

  if (projectStore.dirty) {
    const ok = window.confirm('当前项目有未保存的修改,是否放弃?')
    if (!ok) return
  }

  try {
    const file = files[0]
    const text = await file.text()
    // 增强校验(Step 40.3)
    const validation = validateProject(JSON.parse(text))
    if (!validation.valid) {
      const msg = formatValidationResult(validation)
      window.alert(`项目文件校验失败:\n${msg}`)
      return
    }
    if (validation.warningCount > 0) {
      const msg = formatValidationResult(validation)
      console.warn('[project] 校验警告:', msg)
    }
    const project = deserializeProject(text)
    projectStore.openProject(project, runtimeStore, timelineStore, historyStore)
    timelineStore.seek(project.timeline.currentFrame)
    applyCurrentFrameToRuntime({ skipHistory: true })
    recordRecentProject(project)
  } catch (e) {
    console.error('[project] 拖拽导入失败:', e)
    window.alert(`拖拽导入失败: ${(e as Error).message}`)
  }
}

/** 拖拽悬停(阻止默认行为,允许 drop) */
function handleDragOver(event: DragEvent): void {
  event.preventDefault()
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

// 保留未使用的 handler 供模板/外部调用
void handlePause
void handleStepBackward
void handleJumpEnd
void handleUndo
void handleRedo

// —— 初始化设置(主题持久化 + 系统监听) ——
settingsStore.init()
// —— 初始化最近项目列表(从 localStorage 加载) ——
recentProjectsStore.init()

onBeforeUnmount(() => {
  // 卸载前立即 flush 一次自动保存(避免丢失最近 10 秒内的修改)
  autosaver.flush()
  autosaver.stop()
  engine.dispose()
  void runtimeStore.flushRepository()
  settingsStore.dispose()
})
</script>

<template>
  <div class="editor-shell">
    <div class="app-frame">
      <div class="window-drag-strip" data-tauri-drag-region>
        <span>PixelForge</span>
        <span class="drag-hint">星空湖泊项目 · 制作工作区</span>
        <div class="window-controls">
          <button class="window-button" aria-label="最小化" data-tip="最小化" @click="minimizeWindow"><span class="minimize-icon"></span></button>
          <button class="window-button" aria-label="最大化" data-tip="最大化 / 还原" @click="toggleMaximizeWindow"><span class="maximize-icon"></span></button>
          <button class="window-button close" aria-label="关闭" data-tip="关闭" @click="closeWindow"><span class="close-icon"></span></button>
        </div>
      </div>
      <aside class="app-sidebar">
        <div class="sidebar-logo">PF</div>
        <button class="sidebar-icon active" data-tip="工作区"><span>⌂</span></button>
        <button class="sidebar-icon" data-tip="项目文件" @click="handleOpenProject"><span>□</span></button>
        <button class="sidebar-icon" data-tip="素材库" @click="leftPanelMode = 'assets'"><span>▧</span></button>
        <div class="sidebar-spacer"></div>
        <button class="sidebar-icon" data-tip="节点图" @click="handleOpenGraphEditor"><span>⌘</span></button>
        <button class="sidebar-icon" data-tip="保存项目" @click="handleSaveProject"><span>↓</span></button>
      </aside>
      <div class="app-content">
        <div class="project-strip">
          <div class="project-strip-title"><span class="project-status"></span><strong>{{ projectStore.projectName || '未命名项目' }}</strong><span class="project-dirty">{{ projectStore.dirty ? '未保存' : '已保存' }}</span></div>
          <div class="project-strip-center"><span>编辑工作区</span><span class="strip-separator">/</span><span>{{ timelineMode === 'frame' ? '实时预览' : '专业时间轴' }}</span></div>
          <div class="project-strip-actions"><button @click="handleNewProject">新建</button><button @click="handleOpenProject">打开</button><button class="save" @click="handleSaveProject">保存</button></div>
        </div>
        <div class="editor-workspace">
          <aside class="editor-left">
            <nav class="tool-rail" aria-label="制作工具">
              <div class="rail-brand">PF</div>
              <button class="rail-tool active" @click="leftPanelMode = 'create'"><span class="rail-icon">✦</span><span>输入</span></button>
              <button class="rail-tool" @click="leftPanelMode = 'assets'"><span class="rail-icon">▧</span><span>素材</span></button>
              <button class="rail-tool" @click="handleOpenGraphEditor"><span class="rail-icon">⌘</span><span>节点</span></button>
              <div class="rail-spacer"></div>
              <button class="rail-tool" @click="showSettings = true"><span class="rail-icon">⚙</span><span>设置</span></button>
            </nav>
            <section class="tool-drawer">
              <div class="drawer-head"><div><span class="context-kicker">Creation Workspace</span><strong>{{ leftPanelMode === 'create' ? '描述你的画面' : '项目素材' }}</strong></div><span class="drawer-count">{{ leftPanelMode === 'create' ? '01 / 04' : 'LIB' }}</span></div>
              <PromptPanel v-if="leftPanelMode === 'create'" :prompt="prompt" :llm-results="llmResults" :presets="presets" :parse-status="parseStatus" :parse-message="parseMessage" :quick-parse-status="quickParseStatus" :quick-parse-message="quickParseMessage" :quick-parse-source="quickParseSource" :quick-parse-confidence="quickParseConfidence" @update:prompt="prompt = $event" @parse="handleParse" @quick-parse="handleQuickParse" @clarify="handleClarify" @open-graph="handleOpenGraphEditor" />
              <AssetPanel v-else />
              <div v-if="leftPanelMode === 'create'" class="creation-sections">
                <section><h3>2. 风格与元素</h3><div class="creation-tags"><button>✦ 星空</button><button>◎ 银河</button><button>⌂ 山脉</button><button>◌ 湖泊</button></div></section>
                <section><h3>3. 参数调节</h3><label>星星密度<input type="range" min="0" max="1" step="0.01" value="0.45" /></label><label>亮度<input type="range" min="0" max="1" step="0.01" value="0.6" /></label><label>色调<input type="range" min="0" max="360" value="270" /></label></section>
                <section><h3>4. 输出设置</h3><div class="output-row"><span>分辨率</span><b>1920 × 1080</b></div><div class="output-row"><span>帧率</span><b>30 fps</b></div></section>
              </div>
            </section>
          </aside>

          <section class="canvas-workspace" @drop="handleDropProject" @dragover="handleDragOver">
            <div class="workspace-context"><div><span class="context-kicker">画布</span><strong>星空湖泊演示</strong></div><div class="context-actions"><span class="context-state"><i :class="{ live: runtimeStore.isReady }"></i>{{ runtimeStore.isReady ? '已就绪' : '未初始化' }}</span><button class="context-action" @click="handleInit">初始化</button></div></div>
            <CanvasView :status="topbarStatus" :hud="canvasHud" @init="handleInit" @render="handleRender" @batch="handleBatch"><template #canvas><canvas ref="canvasRef" class="runtime-canvas" /></template></CanvasView>
            <div class="canvas-controls"><button @click="handleJumpStart">⏮</button><button class="play-control" @click="handlePlay">▶</button><button @click="handleStepForward">⏭</button><span>{{ String(currentFrame).padStart(3, '0') }} / {{ totalFrames }}</span><div class="mini-progress"><i :style="{ width: `${(currentFrame / Math.max(totalFrames, 1)) * 100}%` }"></i></div></div>
          </section>

          <section class="ir-workspace"><div class="panel-title-row"><strong>IR 预览</strong><span>Render IR</span></div><RenderIRTree :tree="irTree" /></section>
          <section class="inspect-workspace" style="display:none"><Inspector /></section>
          <section class="filmstrip-workspace"><div class="panel-title-row"><strong>帧列表 <small>({{ totalFrames }} 帧)</small></strong><span class="filmstrip-hint">选择帧查看历史渲染</span></div><Timeline :frames="timelineFrames" @select="handleSelectFrame" @seek="handleTimelineSeek" /></section>
          <section class="tracks-workspace"><div class="panel-title-row"><strong>时间轴</strong><span class="timeline-live">{{ timelineStore.fps }} FPS · {{ totalFrames }} 帧</span></div><ParameterTrack /></section>
          <footer class="metrics-workspace"><span class="metrics-state"><i></i>就绪</span><span>GPU <b>{{ canvasHud.gpuMs.toFixed(1) }} ms</b></span><span>CPU <b>{{ canvasHud.gpuMs.toFixed(1) }} ms</b></span><span>FPS <b>{{ canvasHud.fps.toFixed(1) }}</b></span><span>Memory <b>{{ canvasHud.memMb.toFixed(1) }} MB</b></span><span>Layers <b>{{ runtimeStore.currentIr.layers.length }}</b></span><em>PixelForge v0.1.0</em></footer>
        </div>
    </div>
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

    <!-- 设置面板(Step 40.1) -->
    <SettingsDialog
      :open="showSettings"
      @close="showSettings = false"
    />

    <!-- 命令面板(Step 40.2,Ctrl+K) -->
    <CommandPalette
      :open="showCommandPalette"
      @close="showCommandPalette = false"
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
  position: relative;
  width: 100%;
  height: 100vh;
  min-height: 600px;
  background: var(--pf-paper);
  color: var(--pf-ink);
  overflow: hidden;
  font-family: 'DM Sans', system-ui, sans-serif;
}

.editor-shell > :deep(.topbar) { display: none; }
.app-frame { position: absolute; inset: 0; display: grid; grid-template-columns: 62px minmax(0, 1fr); min-width: 0; min-height: 0; overflow: hidden; }
.window-drag-strip { position: absolute; z-index: 20; top: 0; right: 0; left: 0; height: 34px; display: flex; align-items: center; padding-left: 76px; color: rgba(245,245,247,.58); font-size: 11px; pointer-events: auto; -webkit-app-region: drag; background: rgba(5,7,13,.18); }
.window-drag-strip > span { pointer-events: none; }
.window-drag-strip > span:first-child { color: rgba(245,245,247,.84); font-weight: 600; }
.drag-hint { margin-left: 12px; color: rgba(245,245,247,.34) !important; }
.window-controls { display: flex; align-items: center; height: 34px; margin-left: auto; -webkit-app-region: no-drag; }
.window-button { width: 46px; height: 34px; display: grid; place-items: center; color: rgba(245,245,247,.64); cursor: pointer; transition: background .16s ease, color .16s ease; }
.window-button:hover { color: #fff; background: rgba(255,255,255,.1); }
.window-button.close:hover { background: #d94e5d; color: #fff; }
.window-button, .window-button:hover, .window-button:focus, .window-button:active { outline: 0 !important; box-shadow: none !important; }
.minimize-icon, .maximize-icon, .close-icon { position: relative; display: block; width: 12px; height: 12px; }
.minimize-icon::before { content: ''; position: absolute; left: 1px; right: 1px; top: 7px; height: 1px; background: currentColor; }
.maximize-icon { position: relative; width: 13px; height: 13px; border: 0; border-radius: 0; }
.maximize-icon::before, .maximize-icon::after { content: ''; position: absolute; width: 8px; height: 8px; border: 1px solid currentColor; border-radius: 1px; }
.maximize-icon::before { top: 1px; left: 1px; }
.maximize-icon::after { right: 1px; bottom: 1px; background: transparent; }
.close-icon::before, .close-icon::after { content: ''; position: absolute; top: 5px; left: 0; width: 13px; height: 1px; background: currentColor; transform: rotate(45deg); }
.close-icon::after { transform: rotate(-45deg); }
.app-sidebar { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 14px 8px; background: #0b0d0f; border-right: 1px solid var(--pf-line); }
.sidebar-logo { width: 34px; height: 34px; display: grid; place-items: center; margin-bottom: 10px; background: var(--pf-accent); color: #17120f; border-radius: 9px; font: 700 12px 'JetBrains Mono', monospace; }
.sidebar-icon { width: 42px; height: 42px; display: grid; place-items: center; color: var(--pf-ink-muted); border-radius: 9px; cursor: pointer; }
.sidebar-icon span { font-size: 20px; line-height: 1; }
.sidebar-icon:hover, .sidebar-icon.active { color: var(--pf-ink); background: var(--pf-accent-soft); }
.sidebar-spacer { flex: 1; }
.app-content { min-width: 0; min-height: 0; display: grid; grid-template-rows: 48px minmax(0, 1fr); overflow: hidden; padding-top: 34px; }
.project-strip { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 16px; padding: 0 18px; background: #151719; border-bottom: 1px solid var(--pf-line); }
.project-strip-title, .project-strip-center, .project-strip-actions { display: flex; align-items: center; gap: 9px; }
.project-strip-title { min-width: 0; }
.project-strip-title strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
.project-status { width: 7px; height: 7px; border-radius: 50%; background: var(--pf-success); }
.project-dirty { color: var(--pf-ink-muted); font-size: 10px; }
.project-strip-center { color: var(--pf-ink-muted); font-size: 11px; }
.strip-separator { color: var(--pf-ink-faint); }
.project-strip-actions { justify-content: flex-end; }
.project-strip-actions button { height: 28px; padding: 0 10px; color: var(--pf-ink-soft); border: 1px solid var(--pf-line); border-radius: 6px; font-size: 11px; cursor: pointer; }
.project-strip-actions button:hover { color: var(--pf-ink); border-color: var(--pf-line-strong); }
.project-strip-actions .save { color: #17120f; background: var(--pf-accent); border-color: var(--pf-accent); }

.editor-workspace {
  display: grid;
  grid-template-columns: 300px minmax(0, 1fr) 300px;
  grid-template-rows: minmax(300px, 340px) 90px minmax(0, 1fr) 48px;
  grid-template-areas:
    'left canvas ir'
    'left film ir'
    'left tracks ir'
    'metrics metrics metrics';
  gap: 8px;
  min-height: 0;
  padding: 8px;
  background: #080a0d;
}
.editor-left { grid-area: left; display: grid; grid-template-columns: 48px minmax(0, 1fr); min-height: 0; padding: 0; overflow: hidden; background: #101318; border: 1px solid var(--pf-line); border-radius: 8px; }
.canvas-workspace { grid-area: canvas; display: grid; grid-template-rows: 38px minmax(0, 1fr) 38px; min-width: 0; min-height: 0; padding: 10px; background: #11151b; border: 1px solid var(--pf-line); border-radius: 8px; }
.canvas-controls { display: flex; align-items: center; gap: 12px; color: var(--pf-ink-muted); font: 11px 'JetBrains Mono', monospace; }
.canvas-controls button { width: 26px; height: 26px; color: var(--pf-ink-soft); border: 1px solid var(--pf-line); border-radius: 6px; cursor: pointer; }
.canvas-controls button:hover, .canvas-controls .play-control { color: #fff; background: var(--pf-accent); border-color: var(--pf-accent); }
.mini-progress { flex: 1; height: 3px; background: var(--pf-line-strong); border-radius: 99px; overflow: hidden; }
.mini-progress i { display: block; height: 100%; background: var(--pf-accent); }
.creation-sections { display: grid; gap: 18px; padding: 4px; overflow: auto; }
.creation-sections h3 { margin-bottom: 10px; color: var(--pf-ink-soft); font-size: 12px; font-weight: 600; }
.creation-tags { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }
.creation-tags button { height: 31px; color: var(--pf-ink-soft); background: var(--pf-surface); border: 1px solid var(--pf-line); border-radius: 6px; font-size: 11px; cursor: pointer; }
.creation-tags button:hover { color: var(--pf-accent); border-color: var(--pf-accent); }
.creation-sections label { display: grid; grid-template-columns: 65px minmax(0, 1fr); align-items: center; gap: 8px; margin: 10px 0; color: var(--pf-ink-muted); font-size: 11px; }
.creation-sections input[type='range'] { width: 100%; accent-color: var(--pf-accent); }
.output-row { display: flex; justify-content: space-between; padding: 9px 0; color: var(--pf-ink-muted); font-size: 11px; border-bottom: 1px solid var(--pf-line); }
.output-row b { color: var(--pf-ink-soft); font-weight: 500; }
.ir-workspace { grid-area: ir; min-width: 0; min-height: 0; padding: 12px; overflow: auto; background: #101318; border: 1px solid var(--pf-line); border-radius: 8px; }
.inspect-workspace { display: none !important; }
.filmstrip-workspace { grid-area: film; min-width: 0; min-height: 0; padding: 8px 12px; overflow: hidden; background: #101318; border: 1px solid var(--pf-line); border-radius: 8px; }
.tracks-workspace { grid-area: tracks; min-width: 0; min-height: 0; padding: 8px 12px; overflow: hidden; background: #101318; border: 1px solid var(--pf-line); border-radius: 8px; }
.metrics-workspace { grid-area: metrics; display: flex; align-items: center; gap: clamp(12px, 3vw, 48px); min-height: 0; padding: 0 18px; color: var(--pf-ink-muted); background: #101318; border: 1px solid var(--pf-line); border-radius: 8px; font-size: 11px; }
.metrics-workspace b { margin-left: 5px; color: var(--pf-ink); font: 500 12px 'JetBrains Mono', monospace; }
.metrics-workspace em { margin-left: auto; color: var(--pf-ink-faint); font-style: normal; }
.metrics-state { display: inline-flex; align-items: center; gap: 7px; color: var(--pf-success); }
.metrics-state i { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.panel-title-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 24px; color: var(--pf-ink-soft); font-size: 12px; }
.panel-title-row small, .filmstrip-hint { color: var(--pf-ink-muted); font-size: 10px; font-weight: 400; }
.panel-title-row button { color: var(--pf-ink-muted); cursor: pointer; }
.timeline-live { color: var(--pf-ink-muted); font: 10px 'JetBrains Mono', monospace; }
.tracks-workspace > .timeline-mode-switch { float: right; margin-top: -26px; }
.tracks-workspace > :deep(.pro-timeline), .tracks-workspace > :deep(.parameter-track) { height: calc(100% - 26px); }
.tool-rail { border-right: 1px solid var(--pf-line); }
.tool-drawer { padding: 12px; }

.editor-center, .editor-right { display: none; }

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
  .editor-workspace { grid-template-columns: 280px minmax(0, 1fr); grid-template-rows: minmax(300px, 340px) 90px minmax(0, 1fr) 48px; grid-template-areas: 'left canvas' 'left film' 'left tracks' 'metrics metrics'; }
  .ir-workspace { display: none; }
  .inspect-workspace { display: none !important; }
}
@media (max-width: 900px) {
  .editor-workspace { grid-template-columns: 1fr; grid-template-rows: auto 340px 90px 240px 48px; grid-template-areas: 'left' 'canvas' 'film' 'tracks' 'metrics'; overflow: auto; }
  .editor-left { min-height: 520px; }
  .ir-workspace { display: none; }
}
</style>
