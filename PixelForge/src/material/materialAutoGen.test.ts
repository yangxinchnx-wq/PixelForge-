/**
 * Material Auto-Generation Tests(Step 28.20-28.23)— 材质自动生成系统测试。
 *
 * 覆盖:
 * - MP: materialPresets(预设库构建 + 参数覆盖 + 主题匹配)
 * - MG: materialGraphGenerator(需求 → 图生成 + 关键词提取)
 * - RM: renderIRToMaterial(RenderIR → MaterialGraph 桥接)
 * - LP: materialPrompt(LLM prompt 构建 + 输出解析)
 */

import { describe, it, expect } from 'vitest'
import { Opcode, type JsonLiteral } from '@/shared/types'
import type { Layer, RenderIR } from '@/compiler/ir/renderIR'
import type { CreativeRequirement } from '@/authoring/clarifier/types'

import {
  buildPreset,
  getPreset,
  listPresetKeys,
  getPresetsForSubject,
  type MaterialPresetKey,
  type PresetParams,
} from './materialPresets'
import {
  generateMaterialGraph,
  generateMaterialGraphFromText,
  mapRequirementToPresetParams,
  selectPresetForSubject,
  appendColorCorrect,
} from './materialGraphGenerator'
import {
  renderIRToMaterialGraph,
  layerToMaterialGraph,
} from './renderIRToMaterial'
import {
  buildMaterialSystemPrompt,
  buildMaterialLLMPrompt,
  parseLLMMaterialOutput,
  MATERIAL_LLM_SCHEMA,
} from './materialPrompt'
import { compileMaterialGraph } from './compiler'

// ============================================================================
// MP: materialPresets
// ============================================================================

describe('materialPresets', () => {
  describe('MP-A: 预设注册', () => {
    it('MP-A1: listPresetKeys 应返回 8 个预设', () => {
      const keys = listPresetKeys()
      expect(keys).toHaveLength(8)
      expect(keys).toContain('starfield')
      expect(keys).toContain('nebula')
      expect(keys).toContain('gradient_bg')
      expect(keys).toContain('cellular')
      expect(keys).toContain('blend_effect')
      expect(keys).toContain('cinematic')
      expect(keys).toContain('galaxy')
      expect(keys).toContain('dust')
    })

    it('MP-A2: getPreset 返回预设定义', () => {
      const preset = getPreset('starfield')
      expect(preset).toBeDefined()
      expect(preset!.key).toBe('starfield')
      expect(preset!.label).toBe('星空')
      expect(preset!.subjects).toContain('宇宙')
    })

    it('MP-A3: getPreset 不存在的 key 返回 undefined', () => {
      expect(getPreset('nonexistent')).toBeUndefined()
    })
  })

  describe('MP-B: 预设构建', () => {
    it('MP-B1: starfield 预设构建 6 个节点 + 5 条边', () => {
      const graph = buildPreset('starfield')
      expect(graph.nodes).toHaveLength(6)
      expect(graph.edges).toHaveLength(5)
      // 应包含 uv, noise, color×2, blend, output
      const types = graph.nodes.map((n) => n.templateKey)
      expect(types).toContain('uv')
      expect(types).toContain('noise')
      expect(types.filter((t) => t === 'color')).toHaveLength(2)
      expect(types).toContain('blend')
      expect(types).toContain('output')
    })

    it('MP-B2: nebula 预设使用 fbm 节点', () => {
      const graph = buildPreset('nebula')
      expect(graph.nodes.some((n) => n.templateKey === 'fbm')).toBe(true)
    })

    it('MP-B3: cellular 预设使用 voronoi 节点', () => {
      const graph = buildPreset('cellular')
      expect(graph.nodes.some((n) => n.templateKey === 'voronoi')).toBe(true)
    })

    it('MP-B4: blend_effect 预设使用 blend 节点', () => {
      const graph = buildPreset('blend_effect')
      expect(graph.nodes.some((n) => n.templateKey === 'blend')).toBe(true)
    })

    it('MP-B5: cinematic 预设使用 color_correct 节点', () => {
      const graph = buildPreset('cinematic')
      expect(graph.nodes.some((n) => n.templateKey === 'color_correct')).toBe(true)
    })

    it('MP-B6: 参数覆盖生效', () => {
      const params: PresetParams = { scale: 99, colorA: [0.1, 0.2, 0.3, 1] }
      const graph = buildPreset('starfield', params)
      const noise = graph.nodes.find((n) => n.templateKey === 'noise')
      expect(Number(noise!.params.scale)).toBe(99)
    })

    it('MP-B7: 不存在的预设 key 抛错', () => {
      expect(() => buildPreset('nonexistent' as MaterialPresetKey)).toThrow(/未知材质预设/)
    })

    it('MP-B8: 所有预设都有 OUTPUT 节点', () => {
      const keys = listPresetKeys()
      for (const key of keys) {
        const graph = buildPreset(key as MaterialPresetKey)
        const outputCount = graph.nodes.filter((n) => n.type === 'OUTPUT').length
        expect(outputCount).toBe(1)
      }
    })

    it('MP-B9: 所有预设都能编译为 WGSL', () => {
      const keys = listPresetKeys()
      for (const key of keys) {
        const graph = buildPreset(key as MaterialPresetKey)
        const result = compileMaterialGraph(graph)
        expect(result.wgsl).toContain('fs_main')
        expect(result.wgsl).toContain('@fragment')
        expect(result.hash.length).toBeGreaterThan(0)
      }
    })
  })

  describe('MP-C: 主题匹配', () => {
    it('MP-C1: 宇宙主题返回多个预设', () => {
      const presets = getPresetsForSubject('宇宙')
      expect(presets.length).toBeGreaterThan(0)
      expect(presets).toContain('nebula')
      expect(presets).toContain('starfield')
    })

    it('MP-C2: 星空主题模糊匹配', () => {
      const presets = getPresetsForSubject('星空夜空')
      expect(presets.length).toBeGreaterThan(0)
    })

    it('MP-C3: 未知主题回退到 gradient_bg', () => {
      const presets = getPresetsForSubject('完全不存在的主题')
      expect(presets).toEqual(['gradient_bg'])
    })
  })
})

// ============================================================================
// MG: materialGraphGenerator
// ============================================================================

describe('materialGraphGenerator', () => {
  describe('MG-A: mapRequirementToPresetParams', () => {
    it('MG-A1: 颜色映射', () => {
      const req: CreativeRequirement = {
        subject: '宇宙',
        style: { color: '蓝紫色' },
        elements: [],
      }
      const params = mapRequirementToPresetParams(req)
      expect(params.colorA).toEqual([0.2, 0.3, 1.0, 1])
    })

    it('MG-A2: tone=cinematic 映射到亮度/对比度/饱和度', () => {
      const req: CreativeRequirement = {
        subject: '宇宙',
        style: { tone: 'cinematic' },
        elements: [],
      }
      const params = mapRequirementToPresetParams(req)
      expect(params.brightness).toBe(-0.1)
      expect(params.contrast).toBe(1.3)
      expect(params.saturation).toBe(0.85)
    })

    it('MG-A3: tone=cyberpunk 映射', () => {
      const req: CreativeRequirement = {
        subject: '城市',
        style: { tone: 'cyberpunk' },
        elements: [],
      }
      const params = mapRequirementToPresetParams(req)
      expect(params.contrast).toBe(1.45)
      expect(params.saturation).toBe(1.3)
    })

    it('MG-A4: motion.speed 影响 scale', () => {
      const req: CreativeRequirement = {
        subject: '宇宙',
        motion: { speed: 0.1 },
        elements: [],
      }
      const params = mapRequirementToPresetParams(req)
      expect(params.scale).toBe(0.5)
    })

    it('MG-A5: 快速运动 scale=2.0', () => {
      const req: CreativeRequirement = {
        subject: '宇宙',
        motion: { speed: 0.9 },
        elements: [],
      }
      const params = mapRequirementToPresetParams(req)
      expect(params.scale).toBe(2.0)
    })

    it('MG-A6: 无 style / motion 返回空对象', () => {
      const req: CreativeRequirement = {
        subject: '宇宙',
        elements: [],
      }
      const params = mapRequirementToPresetParams(req)
      expect(Object.keys(params).length).toBe(0)
    })
  })

  describe('MG-B: selectPresetForSubject', () => {
    it('MG-B1: 宇宙 → nebula', () => {
      expect(selectPresetForSubject('宇宙')).toBe('nebula')
    })

    it('MG-B2: 星空 → starfield', () => {
      expect(selectPresetForSubject('星空')).toBe('starfield')
    })

    it('MG-B3: 银河 → galaxy', () => {
      expect(selectPresetForSubject('银河')).toBe('galaxy')
    })

    it('MG-B4: 电影 → cinematic', () => {
      expect(selectPresetForSubject('电影')).toBe('cinematic')
    })

    it('MG-B5: 模糊匹配', () => {
      expect(selectPresetForSubject('美丽的宇宙星空')).toBe('nebula')
    })

    it('MG-B6: 未知主题回退', () => {
      const key = selectPresetForSubject('未知主题')
      expect(key).toBeDefined()
      expect(typeof key).toBe('string')
    })
  })

  describe('MG-C: generateMaterialGraph', () => {
    it('MG-C1: 基本生成返回有效图', () => {
      const req: CreativeRequirement = {
        subject: '宇宙',
        style: { color: '蓝紫色', tone: 'cinematic' },
        elements: [],
      }
      const result = generateMaterialGraph(req)
      expect(result.graph.nodes.length).toBeGreaterThan(0)
      expect(result.graph.edges.length).toBeGreaterThan(0)
      expect(result.presetKey).toBe('nebula')
    })

    it('MG-C2: 生成的图有 OUTPUT 节点', () => {
      const result = generateMaterialGraph({ subject: '星空', elements: [] })
      const outputCount = result.graph.nodes.filter((n) => n.type === 'OUTPUT').length
      expect(outputCount).toBe(1)
    })

    it('MG-C3: cinematic tone 追加或更新 ColorCorrect', () => {
      const req: CreativeRequirement = {
        subject: '宇宙',
        style: { tone: 'cinematic' },
        elements: [],
      }
      const result = generateMaterialGraph(req)
      expect(result.hasColorCorrect).toBe(true)
    })

    it('MG-C4: 生成的图可编译为 WGSL', () => {
      const result = generateMaterialGraph({ subject: '宇宙', elements: [] })
      const compileResult = compileMaterialGraph(result.graph)
      expect(compileResult.wgsl).toContain('fs_main')
      expect(compileResult.wgsl).toContain('@fragment')
    })

    it('MG-C5: summary 包含预设 key', () => {
      const result = generateMaterialGraph({ subject: '星空', elements: [] })
      expect(result.summary).toContain('starfield')
    })

    it('MG-C6: 颜色参数传递到 COLOR 节点', () => {
      const req: CreativeRequirement = {
        subject: '宇宙',
        style: { color: '红色' },
        elements: [],
      }
      const result = generateMaterialGraph(req)
      // nebula 预设有 colorA（固定深色背景）和 colorB（用户颜色高亮）
      // mapRequirementToPresetParams 把 style.color 映射到 params.colorA
      // nebula 预设中 colorB 使用 p.colorA 作为高亮色
      const colorNodes = result.graph.nodes.filter((n) => n.templateKey === 'color')
      expect(colorNodes.length).toBeGreaterThanOrEqual(2)
      // colorB（高亮色）应包含用户指定的红色
      const colorB = colorNodes.find((n) => Number(n.params.r) > 0.5)
      expect(colorB).toBeDefined()
      expect(Number(colorB!.params.r)).toBeCloseTo(0.9, 1)
    })
  })

  describe('MG-D: generateMaterialGraphFromText', () => {
    it('MG-D1: 从文本提取主题', () => {
      const result = generateMaterialGraphFromText('做一个蓝紫色的宇宙星空')
      expect(result.graph.nodes.length).toBeGreaterThan(0)
    })

    it('MG-D2: 从文本提取调性', () => {
      const result = generateMaterialGraphFromText('电影感的星空')
      expect(result.hasColorCorrect).toBe(true)
    })

    it('MG-D3: 无关键词时回退', () => {
      const result = generateMaterialGraphFromText('随便什么效果')
      expect(result.graph.nodes.length).toBeGreaterThan(0)
    })
  })

  describe('MG-E: appendColorCorrect', () => {
    it('MG-E1: 在没有 CC 的图上追加 CC 节点', () => {
      const graph = buildPreset('starfield')
      const result = appendColorCorrect(graph, { brightness: -0.2, contrast: 1.5 })
      const ccNode = result.nodes.find((n) => n.templateKey === 'color_correct')
      expect(ccNode).toBeDefined()
      expect(Number(ccNode!.params.brightness)).toBe(-0.2)
      expect(Number(ccNode!.params.contrast)).toBe(1.5)
    })

    it('MG-E2: 在已有 CC 的图上更新参数', () => {
      const graph = buildPreset('cinematic')
      const result = appendColorCorrect(graph, { brightness: 0.3 })
      const updatedCC = result.nodes.find((n) => n.templateKey === 'color_correct')!
      // 节点数不变(不追加新节点)
      expect(result.nodes.length).toBe(graph.nodes.length)
      expect(Number(updatedCC.params.brightness)).toBe(0.3)
    })

    it('MG-E3: 无调色参数时返回原图', () => {
      const graph = buildPreset('starfield')
      const result = appendColorCorrect(graph, {})
      expect(result.nodes.length).toBe(graph.nodes.length)
    })
  })
})

// ============================================================================
// RM: renderIRToMaterial
// ============================================================================

describe('renderIRToMaterial', () => {
  function makeLayer(opcode: Opcode, params: Record<string, JsonLiteral>): Layer {
    return {
      id: `layer_${opcode}_${Math.random().toString(36).slice(2, 8)}`,
      opcode,
      params,
      source: 'system_default',
      paramOwnership: {},
      visible: true,
      blendMode: 'normal',
    }
  }

  function makeIR(layers: Layer[]): RenderIR {
    return {
      canvas: { width: 1920, height: 1080 },
      layers,
      regions: [],
      effects: [],
      compileHints: { preferredProfile: 'region' },
    }
  }

  describe('RM-A: 单 Layer 转换', () => {
    it('RM-A1: SOLID_COLOR → COLOR + OUTPUT', () => {
      const layer = makeLayer(Opcode.SOLID_COLOR, { color: [1, 0, 0, 1] })
      const graph = layerToMaterialGraph(layer)
      expect(graph.nodes.some((n) => n.templateKey === 'color')).toBe(true)
      expect(graph.nodes.some((n) => n.type === 'OUTPUT')).toBe(true)
    })

    it('RM-A2: NOISE → UV + NOISE + COLOR + OUTPUT', () => {
      const layer = makeLayer(Opcode.NOISE, { scale: 16, colorA: [0, 0, 0.5, 1], colorB: [1, 1, 1, 1] })
      const graph = layerToMaterialGraph(layer)
      expect(graph.nodes.some((n) => n.templateKey === 'uv')).toBe(true)
      expect(graph.nodes.some((n) => n.templateKey === 'noise')).toBe(true)
      expect(graph.nodes.some((n) => n.templateKey === 'color')).toBe(true)
    })

    it('RM-A3: CIRCLE_SHAPE → UV + COLOR + OUTPUT', () => {
      const layer = makeLayer(Opcode.CIRCLE_SHAPE, { fill: [1, 1, 0, 1], radius: 0.3 })
      const graph = layerToMaterialGraph(layer)
      expect(graph.nodes.some((n) => n.templateKey === 'color')).toBe(true)
    })

    it('RM-A4: IMAGE_TEXTURE → UV + TEXTURE + OUTPUT', () => {
      const layer = makeLayer(Opcode.IMAGE_TEXTURE, {})
      const graph = layerToMaterialGraph(layer)
      expect(graph.nodes.some((n) => n.templateKey === 'uv')).toBe(true)
      expect(graph.nodes.some((n) => n.templateKey === 'texture')).toBe(true)
    })

    it('RM-A5: LINEAR_GRADIENT → UV + COLOR + COLOR + BLEND + OUTPUT', () => {
      const layer = makeLayer(Opcode.LINEAR_GRADIENT, {
        from: [0, 0], to: [1, 1],
        colorA: [0, 0, 0.5, 1], colorB: [0.5, 0.5, 1, 1],
      })
      const graph = layerToMaterialGraph(layer)
      expect(graph.nodes.some((n) => n.templateKey === 'blend')).toBe(true)
    })
  })

  describe('RM-B: 多 Layer 合成', () => {
    it('RM-B1: 两个 Layer 使用 BLEND 合成', () => {
      const ir = makeIR([
        makeLayer(Opcode.SOLID_COLOR, { color: [0.1, 0.1, 0.2, 1] }),
        makeLayer(Opcode.SOLID_COLOR, { color: [0.9, 0.9, 0.1, 1] }),
      ])
      const result = renderIRToMaterialGraph(ir)
      expect(result.hasBlend).toBe(true)
      expect(result.layerCount).toBe(2)
    })

    it('RM-B2: 三个 Layer 链式合成', () => {
      const ir = makeIR([
        makeLayer(Opcode.SOLID_COLOR, { color: [0.1, 0.1, 0.2, 1] }),
        makeLayer(Opcode.SOLID_COLOR, { color: [0.9, 0.1, 0.1, 1] }),
        makeLayer(Opcode.SOLID_COLOR, { color: [0.1, 0.9, 0.1, 1] }),
      ])
      const result = renderIRToMaterialGraph(ir)
      expect(result.hasBlend).toBe(true)
      const blendCount = result.graph.nodes.filter((n) => n.templateKey === 'blend').length
      expect(blendCount).toBe(2) // 3 层需要 2 个 BLEND
    })

    it('RM-B3: 不可见 Layer 被跳过', () => {
      const invisibleLayer = makeLayer(Opcode.SOLID_COLOR, { color: [1, 0, 0, 1] })
      invisibleLayer.visible = false
      const ir = makeIR([
        invisibleLayer,
        makeLayer(Opcode.SOLID_COLOR, { color: [0, 1, 0, 1] }),
      ])
      const result = renderIRToMaterialGraph(ir)
      expect(result.layerCount).toBe(1)
      expect(result.skippedCount).toBe(1)
    })

    it('RM-B4: 空 layers 生成默认图', () => {
      const ir = makeIR([])
      const result = renderIRToMaterialGraph(ir)
      expect(result.graph.nodes.length).toBeGreaterThan(0)
      expect(result.graph.nodes.some((n) => n.type === 'OUTPUT')).toBe(true)
    })
  })

  describe('RM-C: 编译验证', () => {
    it('RM-C1: 单 Layer 转换后可编译', () => {
      const layer = makeLayer(Opcode.SOLID_COLOR, { color: [1, 0.5, 0.2, 1] })
      const graph = layerToMaterialGraph(layer)
      const result = compileMaterialGraph(graph)
      expect(result.wgsl).toContain('fs_main')
    })

    it('RM-C2: 多 Layer 转换后可编译', () => {
      const ir = makeIR([
        makeLayer(Opcode.SOLID_COLOR, { color: [0.1, 0.1, 0.2, 1] }),
        makeLayer(Opcode.NOISE, { scale: 16, colorB: [1, 1, 1, 1] }),
      ])
      const result = renderIRToMaterialGraph(ir)
      const compileResult = compileMaterialGraph(result.graph)
      expect(compileResult.wgsl).toContain('fs_main')
    })
  })
})

// ============================================================================
// LP: materialPrompt
// ============================================================================

describe('materialPrompt', () => {
  describe('LP-A: buildMaterialSystemPrompt', () => {
    it('LP-A1: 包含节点类型描述', () => {
      const prompt = buildMaterialSystemPrompt()
      expect(prompt).toContain('uv')
      expect(prompt).toContain('noise')
      expect(prompt).toContain('color')
      expect(prompt).toContain('output')
      expect(prompt).toContain('blend')
      expect(prompt).toContain('color_correct')
    })

    it('LP-A2: 包含预设列表', () => {
      const prompt = buildMaterialSystemPrompt()
      expect(prompt).toContain('starfield')
      expect(prompt).toContain('nebula')
      expect(prompt).toContain('cinematic')
    })

    it('LP-A3: 包含规则说明', () => {
      const prompt = buildMaterialSystemPrompt()
      expect(prompt).toContain('DAG')
      expect(prompt.toLowerCase()).toContain('output')
      expect(prompt).toContain('strict JSON')
    })
  })

  describe('LP-B: buildMaterialLLMPrompt', () => {
    it('LP-B1: 返回 system + user prompt', () => {
      const { systemPrompt, userPrompt } = buildMaterialLLMPrompt('做一个星空')
      expect(systemPrompt.length).toBeGreaterThan(100)
      expect(userPrompt).toContain('星空')
    })
  })

  describe('LP-C: parseLLMMaterialOutput', () => {
    it('LP-C1: 预设模式(只给 preset key)', () => {
      const result = parseLLMMaterialOutput({
        preset: 'starfield',
        nodes: [],
        edges: [],
      })
      expect(result.usedPreset).toBe(true)
      expect(result.graph.nodes.length).toBeGreaterThan(0)
    })

    it('LP-C2: 节点模式(自定义节点)', () => {
      const result = parseLLMMaterialOutput({
        nodes: [
          { type: 'uv', id: 'n1' },
          { type: 'noise', id: 'n2', params: { scale: 32 } },
          { type: 'color', id: 'n3', params: { r: 1, g: 1, b: 1, a: 1 } },
          { type: 'output', id: 'n4' },
        ],
        edges: [
          { from: 'n1', fromPort: 'uv', to: 'n2', toPort: 'uv' },
          { from: 'n3', fromPort: 'color', to: 'n4', toPort: 'color' },
        ],
      })
      expect(result.usedPreset).toBe(false)
      expect(result.graph.nodes).toHaveLength(4)
      expect(result.graph.edges).toHaveLength(2)
    })

    it('LP-C3: 不存在的预设 key 回退到节点构建', () => {
      const result = parseLLMMaterialOutput({
        preset: 'nonexistent',
        nodes: [
          { type: 'color', id: 'n1' },
          { type: 'output', id: 'n2' },
        ],
        edges: [
          { from: 'n1', fromPort: 'color', to: 'n2', toPort: 'color' },
        ],
      })
      expect(result.usedPreset).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
      expect(result.graph.nodes).toHaveLength(2)
    })

    it('LP-C4: 不存在的节点类型记录错误', () => {
      const result = parseLLMMaterialOutput({
        nodes: [
          { type: 'nonexistent_node', id: 'n1' },
          { type: 'output', id: 'n2' },
        ],
        edges: [],
      })
      expect(result.errors.some((e) => e.includes('不存在'))).toBe(true)
    })

    it('LP-C5: 缺少 OUTPUT 节点记录错误', () => {
      const result = parseLLMMaterialOutput({
        nodes: [
          { type: 'uv', id: 'n1' },
        ],
        edges: [],
      })
      expect(result.errors.some((e) => e.includes('OUTPUT'))).toBe(true)
    })

    it('LP-C6: 多个 OUTPUT 节点只保留第一个', () => {
      const result = parseLLMMaterialOutput({
        nodes: [
          { type: 'color', id: 'n1' },
          { type: 'output', id: 'n2' },
          { type: 'output', id: 'n3' },
        ],
        edges: [
          { from: 'n1', fromPort: 'color', to: 'n2', toPort: 'color' },
        ],
      })
      const outputCount = result.graph.nodes.filter((n) => n.type === 'OUTPUT').length
      expect(outputCount).toBe(1)
      expect(result.warnings.some((w) => w.includes('OUTPUT'))).toBe(true)
    })

    it('LP-C7: 参数覆盖到节点', () => {
      const result = parseLLMMaterialOutput({
        nodes: [
          { type: 'noise', id: 'n1', params: { scale: 99 } },
          { type: 'output', id: 'n2' },
        ],
        edges: [],
      })
      const noiseNode = result.graph.nodes.find((n) => n.templateKey === 'noise')
      expect(Number(noiseNode!.params.scale)).toBe(99)
    })

    it('LP-C8: 边引用不存在的节点产生警告', () => {
      const result = parseLLMMaterialOutput({
        nodes: [
          { type: 'color', id: 'n1' },
          { type: 'output', id: 'n2' },
        ],
        edges: [
          { from: 'n1', fromPort: 'color', to: 'n2', toPort: 'color' },
          { from: 'nonexistent', fromPort: 'x', to: 'n2', toPort: 'color' },
        ],
      })
      expect(result.warnings.some((w) => w.includes('不存在'))).toBe(true)
      // 有效边仍然保留
      expect(result.graph.edges.length).toBe(1)
    })

    it('LP-C9: 解析后的图可编译', () => {
      const result = parseLLMMaterialOutput({
        nodes: [
          { type: 'uv', id: 'n1' },
          { type: 'noise', id: 'n2', params: { scale: 16 } },
          { type: 'color', id: 'n3', params: { r: 0.5, g: 0.5, b: 0.5, a: 1 } },
          { type: 'output', id: 'n4' },
        ],
        edges: [
          { from: 'n1', fromPort: 'uv', to: 'n2', toPort: 'uv' },
          { from: 'n3', fromPort: 'color', to: 'n4', toPort: 'color' },
        ],
      })
      const compileResult = compileMaterialGraph(result.graph)
      expect(compileResult.wgsl).toContain('fs_main')
    })
  })

  describe('LP-D: Schema', () => {
    it('LP-D1: schema 包含必要字段', () => {
      expect(MATERIAL_LLM_SCHEMA.type).toBe('object')
      expect(MATERIAL_LLM_SCHEMA.required).toContain('nodes')
      expect(MATERIAL_LLM_SCHEMA.required).toContain('edges')
    })
  })
})
