import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Opcode } from '@/shared/types'
import { validateStaticBoundary } from '@/compiler/ir/renderIR'
import type { RenderIR } from '@/compiler/ir/renderIR'
import type { LLMOutput, LLMResponse } from '@/authoring/llm/types'
import { llmParse } from '@/authoring/llm/llmParser'
import { callLLM } from '@/authoring/llm/callLLM'
import { parse as parseIntentToRenderIR } from '@/compiler/parser/ruleParser'
import {
  addKeyframe,
  addTrack,
  createKeyframe,
  createTimeline,
  createTrack,
} from '@/world/timeline/timelineManager'
import { evaluateTimeline } from '@/world/timeline/evaluator'
import { applyPatch } from '@/compiler/ir/patchEngine'
import { compileRenderIRToRegionArtifact } from '@/compiler/region/regionCompiler'
import {
  createRenderConfigFromSequence,
  type RenderConfig,
} from '@/editor/render/renderConfig'
import { RenderPipeline } from '@/editor/render/renderPipeline'
import { createSequence, seconds } from '@/editor/render/timelineTypes'
import {
  createProjectSnapshot,
  deserializeProject,
  serializeProject,
} from '@/project/serializer'

vi.mock('@/authoring/llm/callLLM', () => ({
  callLLM: vi.fn(),
}))

const mockedCallLLM = vi.mocked(callLLM)

type StageResult = {
  name: string
  max: number
  passed: boolean
  detail: string
}

function makeLLMResponse(output: LLMOutput): LLMResponse {
  return {
    content: JSON.stringify(output),
    parsed: output,
    usage: { promptTokens: 12, completionTokens: 32, totalTokens: 44 },
    model: 'acceptance-fixture',
    latencyMs: 1,
    cached: false,
  }
}

async function runStage(
  results: StageResult[],
  name: string,
  max: number,
  action: () => void | Promise<void>,
): Promise<boolean> {
  try {
    await action()
    results.push({ name, max, passed: true, detail: '通过' })
    return true
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    results.push({ name, max, passed: false, detail })
    return false
  }
}

function createProjectTimeline() {
  return {
    currentFrame: 0,
    totalFrames: 3,
    fps: 10,
    tracks: [],
    seek: () => {},
  }
}

describe('PixelForge core chain acceptance', () => {
  beforeEach(() => {
    mockedCallLLM.mockReset()
  })

  it('runs the deterministic authoring-to-export chain and prints a score', async () => {
    const results: StageResult[] = []
    let aiIntent: Awaited<ReturnType<typeof llmParse>> | null = null
    let baseIr: RenderIR | null = null
    let patchedIr: RenderIR | null = null
    let artifact: ReturnType<typeof compileRenderIRToRegionArtifact> | null = null

    const llmOutput: LLMOutput = {
      scene: '深蓝星空',
      style: 'cinematic',
      elements: [
        {
          type: 'background',
          description: '深蓝背景',
          color: [8, 12, 30],
          layer: 0,
        },
        {
          type: 'starfield',
          description: '金色星点',
          color: [255, 238, 180],
          layer: 1,
          params: { scale: 32, intensity: 0.8 },
        },
      ],
      dominantColors: [[8, 12, 30], [255, 238, 180]],
    }

    await runStage(results, '1. AI 输出契约与 schema 校验', 1.25, async () => {
      mockedCallLLM.mockResolvedValueOnce(makeLLMResponse(llmOutput))
      aiIntent = await llmParse('生成一幅电影感深蓝星空', {
        disableCache: true,
      })
      expect(aiIntent.usedLLM).toBe(true)
      expect(aiIntent.warnings).toHaveLength(0)
      expect(aiIntent.intent.layers).toHaveLength(2)
      expect(aiIntent.intent.layers[0].opcode).toBe(Opcode.SOLID_COLOR)
      expect(aiIntent.intent.layers[1].opcode).toBe(Opcode.NOISE)
    })

    await runStage(results, '2. ParsedIntent → RenderIR', 1.25, () => {
      expect(aiIntent).not.toBeNull()
      baseIr = parseIntentToRenderIR(aiIntent!.intent)
      expect(baseIr.layers).toHaveLength(2)
      expect(baseIr.regions).toHaveLength(1)
      expect(baseIr.regions[0].layerRefs).toHaveLength(2)
      expect(validateStaticBoundary(baseIr)).toEqual([])
    })

    await runStage(results, '3. Timeline → ValuePatch → PatchEngine', 1.25, () => {
      expect(baseIr).not.toBeNull()
      const targetLayer = baseIr!.layers[0]
      let timeline = createTimeline(1, 10, false)
      const track = createTrack('background color', 'layer', targetLayer.id, 'color')
      timeline = addTrack(timeline, track)
      timeline = addKeyframe(timeline, track.id, createKeyframe(0, [0, 0, 0, 1]))
      timeline = addKeyframe(timeline, track.id, createKeyframe(1, [1, 0.2, 0.1, 1]))

      const evaluation = evaluateTimeline(timeline, 0.5)
      expect(evaluation.patches).toHaveLength(1)
      expect(evaluation.patches[0].source).toBe('l3_timeline')
      expect(evaluation.patches[0].value).toEqual([0.5, 0.1, 0.05, 1])

      const outcome = applyPatch(baseIr!, evaluation.patches[0])
      patchedIr = outcome.ir
      expect(outcome.appliedCount).toBe(1)
      expect(patchedIr.layers[0].params.color).toEqual([0.5, 0.1, 0.05, 1])
    })

    await runStage(results, '4. RenderIR → Region Artifact', 1.25, () => {
      expect(patchedIr).not.toBeNull()
      artifact = compileRenderIRToRegionArtifact(patchedIr!)
      expect(artifact.schemaVersion).toBe('region-artifact-v2')
      expect(artifact.visibleLayerCount).toBe(2)
      expect(artifact.regions).toHaveLength(1)
      expect(artifact.effects).toHaveLength(0)
      expect(artifact.descriptorData.length).toBe(4)
      expect(artifact.hasEffects).toBe(false)
    })

    await runStage(results, '5. RenderPipeline 逐帧调度与导出回调', 1.25, async () => {
      expect(artifact).not.toBeNull()
      const sequence = createSequence({
        id: 'acceptance-sequence',
        name: 'acceptance',
        width: 640,
        height: 360,
        fps: 10,
        duration: seconds(0.3),
      })
      const config: RenderConfig = createRenderConfigFromSequence(sequence)
      let renderedFrames = 0
      const pipeline = new RenderPipeline(
        sequence.id,
        config,
        async (frameIndex, time) => {
          renderedFrames++
          return {
            frameIndex,
            time,
            data: new Uint8Array(artifact!.descriptorData.buffer),
          }
        },
        async (frame) => `acceptance_${frame.frameIndex}.png`,
      )

      const job = await pipeline.start()
      expect(job.status).toBe('completed')
      expect(job.totalFrames).toBe(3)
      expect(job.completedFrames).toBe(3)
      expect(renderedFrames).toBe(3)
      expect(job.outputFiles).toEqual([
        'acceptance_0.png',
        'acceptance_1.png',
        'acceptance_2.png',
      ])
    })

    await runStage(results, '6. 项目快照序列化与反序列化', 1.25, () => {
      expect(patchedIr).not.toBeNull()
      const project = createProjectSnapshot(
        '链路验收项目',
        {
          currentIr: patchedIr,
          currentScenario: 'acceptance',
        } as never,
        createProjectTimeline(),
      )
      const restored = deserializeProject(serializeProject(project))
      expect(restored.metadata.name).toBe('链路验收项目')
      expect(restored.renderIR.layers[0].params.color).toEqual([0.5, 0.1, 0.05, 1])
      expect(restored.timeline.fps).toBe(10)
    })

    const score = results.reduce((sum, result) => sum + (result.passed ? result.max : 0), 0)
    const maxScore = results.reduce((sum, result) => sum + result.max, 0)
    const failed = results.filter((result) => !result.passed)

    console.log(`\n[PixelForge chain acceptance] ${score.toFixed(2)}/${maxScore.toFixed(2)}`)
    for (const result of results) {
      console.log(
        `${result.passed ? 'PASS' : 'FAIL'} ${result.name} (${result.max.toFixed(2)}): ${result.detail}`,
      )
    }
    console.log('Boundary note: this suite validates deterministic CPU orchestration and injected frame export; it does not claim real WebGPU pixels or a browser UI smoke test.')

    expect(failed, failed.map((result) => `${result.name}: ${result.detail}`).join('\n')).toHaveLength(0)
  })
})
