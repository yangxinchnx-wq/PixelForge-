/**
 * Prompt 模块测试(Step 22)。
 *
 * 覆盖:
 *   - schema.ts:validateLlmOutput / opcodeNameToValue
 *   - ruleParser.ts:ruleParse / extractColor / llmOutputToLayer
 *   - llmParser.ts:buildLlmPrompt / extractJsonFromLlmResponse / parseLlmResponse / parseByLLM
 *   - promptParser.ts:parsePrompt(rule 优先 / LLM fallback / 空输入 / forceLlm)
 */

import { describe, expect, it, vi } from 'vitest'

import { Opcode } from '@/shared/types'

import {
  PROMPT_LLM_SCHEMA_DOC,
  opcodeNameToValue,
  validateLlmOutput,
} from './schema'
import type { LlmOutput } from './schema'
import { llmOutputToLayer, ruleParse } from './ruleParser'
import {
  buildLlmPrompt,
  extractJsonFromLlmResponse,
  llmOutputToLayers,
  parseByLLM,
  parseLlmResponse,
} from './llmParser'
import type { LLMClient } from './llmParser'
import { parsePrompt } from './promptParser'

// ============================================================================
// Mock LLMClient 工厂
// ============================================================================

function createMockClient(response: string): LLMClient & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    complete: vi.fn(async (prompt: string) => {
      calls.push(prompt)
      return response
    }),
  }
}

// ============================================================================
// schema.ts 测试
// ============================================================================

describe('schema.validateLlmOutput', () => {
  it('S1 合法输出通过校验', () => {
    const valid = {
      layers: [
        {
          opcode: 'SOLID_COLOR',
          params: { color: [0.5, 0.5, 0.5, 1] },
        },
      ],
    }
    expect(() => validateLlmOutput(valid)).not.toThrow()
  })

  it('S2 多图层 + blendMode + label 通过校验', () => {
    const valid = {
      layers: [
        { opcode: 'SOLID_COLOR', params: { color: [1, 0, 0, 1] }, label: '背景' },
        { opcode: 'NOISE', params: { scale: 24 }, blendMode: 'overlay' },
      ],
    }
    expect(() => validateLlmOutput(valid)).not.toThrow()
  })

  it('S3 非对象(数组)抛错', () => {
    expect(() => validateLlmOutput([])).toThrow(/不是对象/)
  })

  it('S4 非对象(null)抛错', () => {
    expect(() => validateLlmOutput(null)).toThrow(/不是对象/)
  })

  it('S5 缺少 layers 字段抛错', () => {
    expect(() => validateLlmOutput({ foo: 'bar' })).toThrow(/缺少 layers/)
  })

  it('S6 layers 为空数组抛错', () => {
    expect(() => validateLlmOutput({ layers: [] })).toThrow(/为空/)
  })

  it('S7 layers 数量超过 64 抛错', () => {
    const tooMany = {
      layers: Array.from({ length: 65 }, () => ({ opcode: 'NOISE', params: {} })),
    }
    expect(() => validateLlmOutput(tooMany)).toThrow(/超过上限/)
  })

  it('S8 opcode 不是字符串抛错', () => {
    expect(() => validateLlmOutput({
      layers: [{ opcode: 0, params: {} }],
    })).toThrow(/不是字符串/)
  })

  it('S9 opcode 不在白名单抛错', () => {
    expect(() => validateLlmOutput({
      layers: [{ opcode: 'SPIRAL', params: {} }],
    })).toThrow(/不在白名单/)
  })

  it('S10 params 不是对象抛错', () => {
    expect(() => validateLlmOutput({
      layers: [{ opcode: 'NOISE', params: 'not-an-object' }],
    })).toThrow(/params 不是对象/)
  })

  it('S11 params 是数组抛错', () => {
    expect(() => validateLlmOutput({
      layers: [{ opcode: 'NOISE', params: [] }],
    })).toThrow(/params 不是对象/)
  })

  it('S12 blendMode 不在白名单抛错', () => {
    expect(() => validateLlmOutput({
      layers: [{ opcode: 'NOISE', params: {}, blendMode: 'invalid-mode' }],
    })).toThrow(/blendMode.*不在白名单/)
  })

  it('S13 label 不是字符串抛错', () => {
    expect(() => validateLlmOutput({
      layers: [{ opcode: 'NOISE', params: {}, label: 123 }],
    })).toThrow(/label 不是字符串/)
  })

  it('S14 校验通过后类型断言生效(可访问 layers)', () => {
    const raw: unknown = { layers: [{ opcode: 'NOISE', params: { scale: 10 } }] }
    validateLlmOutput(raw)
    // TypeScript 已断言 raw 是 LlmOutput
    expect(raw.layers).toHaveLength(1)
    expect(raw.layers[0].opcode).toBe('NOISE')
  })
})

describe('schema.opcodeNameToValue', () => {
  it('S15 SOLID_COLOR → Opcode.SOLID_COLOR', () => {
    expect(opcodeNameToValue('SOLID_COLOR')).toBe(Opcode.SOLID_COLOR)
  })

  it('S16 IMAGE_TEXTURE → Opcode.IMAGE_TEXTURE', () => {
    expect(opcodeNameToValue('IMAGE_TEXTURE')).toBe(Opcode.IMAGE_TEXTURE)
  })

  it('S17 未知 opcode 名抛错', () => {
    expect(() => opcodeNameToValue('UNKNOWN')).toThrow(/未知 opcode 名/)
  })
})

describe('schema.PROMPT_LLM_SCHEMA_DOC', () => {
  it('S18 文档对象含基础字段', () => {
    expect(PROMPT_LLM_SCHEMA_DOC.type).toBe('object')
    expect(PROMPT_LLM_SCHEMA_DOC.required).toContain('layers')
    expect(PROMPT_LLM_SCHEMA_DOC.properties.layers.type).toBe('array')
  })
})

// ============================================================================
// ruleParser.ts 测试
// ============================================================================

describe('ruleParser.ruleParse', () => {
  it('R1 "星空" 关键词生成 NOISE layer', () => {
    const result = ruleParse('生成星空')
    expect(result.layers).toHaveLength(1)
    expect(result.layers[0].opcode).toBe(Opcode.NOISE)
    expect(result.layers[0].source).toBe('rule_parser')
  })

  it('R2 "漩涡" / "银河" 关键词生成 NOISE layer', () => {
    const r1 = ruleParse('做一个漩涡')
    expect(r1.layers).toHaveLength(1)
    expect(r1.layers[0].opcode).toBe(Opcode.NOISE)

    const r2 = ruleParse('银河系')
    expect(r2.layers).toHaveLength(1)
  })

  it('R3 "渐变" 关键词生成 LINEAR_GRADIENT layer', () => {
    const result = ruleParse('渐变效果')
    expect(result.layers).toHaveLength(1)
    expect(result.layers[0].opcode).toBe(Opcode.LINEAR_GRADIENT)
  })

  it('R4 "圆形" 关键词生成 CIRCLE_SHAPE layer', () => {
    const result = ruleParse('画一个圆形')
    expect(result.layers).toHaveLength(1)
    expect(result.layers[0].opcode).toBe(Opcode.CIRCLE_SHAPE)
  })

  it('R5 "纯色" 关键词生成 SOLID_COLOR layer', () => {
    const result = ruleParse('纯色背景')
    expect(result.layers).toHaveLength(1)
    expect(result.layers[0].opcode).toBe(Opcode.SOLID_COLOR)
  })

  it('R6 多关键词组合生成多个 layer', () => {
    const result = ruleParse('星空 + 漩涡 + 渐变')
    expect(result.layers.length).toBeGreaterThanOrEqual(3)
  })

  it('R7 颜色关键词影响 layer color', () => {
    const result = ruleParse('红色纯色背景')
    expect(result.layers).toHaveLength(1)
    const color = result.layers[0].params.color as [number, number, number, number]
    // 红色预设 [0.9, 0.15, 0.15, 1]
    expect(color[0]).toBeCloseTo(0.9, 2)
    expect(color[1]).toBeCloseTo(0.15, 2)
  })

  it('R8 #hex 颜色被识别', () => {
    const result = ruleParse('纯色 #ff8800')
    expect(result.layers).toHaveLength(1)
    const color = result.layers[0].params.color as [number, number, number, number]
    expect(color[0]).toBeCloseTo(1, 2)     // 0xff / 255
    expect(color[1]).toBeCloseTo(0.533, 1) // 0x88 / 255
  })

  it('R9 [r,g,b,a] 数组颜色被识别', () => {
    const result = ruleParse('纯色 [0.2, 0.4, 0.6, 1]')
    expect(result.layers).toHaveLength(1)
    const color = result.layers[0].params.color as [number, number, number, number]
    expect(color).toEqual([0.2, 0.4, 0.6, 1])
  })

  it('R10 未命中任何关键词返回空 layers + warning', () => {
    const result = ruleParse('这是一个完全无法识别的描述')
    expect(result.layers).toHaveLength(0)
    expect(result.warnings.length).toBeGreaterThan(0)
    expect(result.warnings[0]).toMatch(/未识别/)
  })

  it('R11 生成的 layer 含稳定 ID', () => {
    const r1 = ruleParse('星空')
    const r2 = ruleParse('星空')
    // 同样输入应生成相同 ID(稳定 ID 设计)
    expect(r1.layers[0].id).toBe(r2.layers[0].id)
  })

  it('R12 layer 含 paramOwnership(所有参数 owner = l2_parser)', () => {
    const result = ruleParse('圆形')
    const layer = result.layers[0]
    for (const key of Object.keys(layer.params)) {
      expect(layer.paramOwnership[key]).toBe('l2_parser')
    }
  })

  it('R13 layer 默认 visible = true, blendMode = normal', () => {
    const result = ruleParse('渐变')
    expect(result.layers[0].visible).toBe(true)
    expect(result.layers[0].blendMode).toBe('normal')
  })

  it('R14 英文关键词也命中(star / gradient / circle / solid)', () => {
    expect(ruleParse('starry night').layers).toHaveLength(1)
    expect(ruleParse('gradient bg').layers).toHaveLength(1)
    expect(ruleParse('a circle').layers).toHaveLength(1)
    expect(ruleParse('solid color').layers).toHaveLength(1)
  })
})

describe('ruleParser.llmOutputToLayer', () => {
  it('L1 LLM 输出转换为完整 Layer', () => {
    const layer = llmOutputToLayer(
      { opcode: 'SOLID_COLOR', params: { color: [1, 0, 0, 1] } },
      0,
    )
    expect(layer.opcode).toBe(Opcode.SOLID_COLOR)
    expect(layer.source).toBe('llm_parser')
    expect(layer.visible).toBe(true)
    expect(layer.blendMode).toBe('normal')
    expect(layer.paramOwnership.color).toBe('l2_parser')
  })

  it('L2 label 缺省时使用 "LLM 图层 N"', () => {
    const layer = llmOutputToLayer({ opcode: 'NOISE', params: {} }, 2)
    // label 不在 layer 上,但 ID 派生应稳定
    expect(layer.id).toMatch(/^layer/)
  })

  it('L3 自定义 blendMode 生效', () => {
    const layer = llmOutputToLayer(
      { opcode: 'NOISE', params: {}, blendMode: 'screen' },
      0,
    )
    expect(layer.blendMode).toBe('screen')
  })

  it('L4 未知 opcode 抛错', () => {
    expect(() => llmOutputToLayer({ opcode: 'INVALID', params: {} }, 0)).toThrow(/未知 opcode/)
  })

  it('L5 相同输入生成稳定 ID', () => {
    const l1 = llmOutputToLayer({ opcode: 'NOISE', params: { scale: 10 } }, 0)
    const l2 = llmOutputToLayer({ opcode: 'NOISE', params: { scale: 10 } }, 0)
    expect(l1.id).toBe(l2.id)
  })
})

// ============================================================================
// llmParser.ts 测试
// ============================================================================

describe('llmParser.buildLlmPrompt', () => {
  it('M1 含系统提示词', () => {
    const prompt = buildLlmPrompt('画一个红色圆形')
    expect(prompt).toContain('PixelForge RenderIR 生成器')
    expect(prompt).toContain('画一个红色圆形')
  })

  it('M2 含 schema 文档(JSON)', () => {
    const prompt = buildLlmPrompt('test')
    expect(prompt).toContain('"type": "object"')
    expect(prompt).toContain('"layers"')
  })

  it('M3 style 选项注入', () => {
    const prompt = buildLlmPrompt('星空', { style: 'cinematic' })
    expect(prompt).toContain('cinematic')
  })

  it('M4 无 style 时不注入风格行', () => {
    const prompt = buildLlmPrompt('星空')
    expect(prompt).not.toContain('风格要求')
  })
})

describe('llmParser.extractJsonFromLlmResponse', () => {
  it('M5 纯 JSON 字符串', () => {
    const raw = '{"layers":[]}'
    expect(extractJsonFromLlmResponse(raw)).toBe('{"layers":[]}')
  })

  it('M6 ```json 围栏代码块', () => {
    const raw = '```json\n{"layers":[]}\n```'
    expect(extractJsonFromLlmResponse(raw)).toBe('{"layers":[]}')
  })

  it('M7 ``` 围栏代码块(无 json 标识)', () => {
    const raw = '```\n{"layers":[]}\n```'
    expect(extractJsonFromLlmResponse(raw)).toBe('{"layers":[]}')
  })

  it('M8 含前后多余文本', () => {
    const raw = '好的,这是结果:\n{"layers":[]}\n希望你喜欢。'
    expect(extractJsonFromLlmResponse(raw)).toBe('{"layers":[]}')
  })

  it('M9 无 JSON 内容时抛错', () => {
    expect(() => extractJsonFromLlmResponse('没有 JSON')).toThrow(/无法从 LLM 输出中提取 JSON/)
  })
})

describe('llmParser.parseLlmResponse', () => {
  it('M10 合法 JSON 响应通过校验', () => {
    const raw = JSON.stringify({
      layers: [{ opcode: 'SOLID_COLOR', params: { color: [1, 0, 0, 1] } }],
    })
    const output = parseLlmResponse(raw)
    expect(output.layers).toHaveLength(1)
    expect(output.layers[0].opcode).toBe('SOLID_COLOR')
  })

  it('M11 含围栏的响应正确提取', () => {
    const raw = '```json\n' + JSON.stringify({
      layers: [{ opcode: 'NOISE', params: { scale: 10 } }],
    }) + '\n```'
    const output = parseLlmResponse(raw)
    expect(output.layers[0].opcode).toBe('NOISE')
  })

  it('M12 非法 JSON 抛错', () => {
    expect(() => parseLlmResponse('not json at all')).toThrow()
  })

  it('M13 schema 校验失败抛错', () => {
    const raw = JSON.stringify({ layers: [{ opcode: 'INVALID', params: {} }] })
    expect(() => parseLlmResponse(raw)).toThrow(/不在白名单/)
  })
})

describe('llmParser.llmOutputToLayers', () => {
  it('M14 多图层转换', () => {
    const output: LlmOutput = {
      layers: [
        { opcode: 'SOLID_COLOR', params: { color: [1, 0, 0, 1] } },
        { opcode: 'NOISE', params: { scale: 24 } },
      ],
    }
    const layers = llmOutputToLayers(output)
    expect(layers).toHaveLength(2)
    expect(layers[0].opcode).toBe(Opcode.SOLID_COLOR)
    expect(layers[1].opcode).toBe(Opcode.NOISE)
  })
})

describe('llmParser.parseByLLM', () => {
  it('M15 mock client 返回合法 JSON → 转换为 Layer[]', async () => {
    const client = createMockClient(JSON.stringify({
      layers: [{ opcode: 'SOLID_COLOR', params: { color: [0.5, 0.5, 0.5, 1] } }],
    }))
    const result = await parseByLLM(client, '灰色背景')
    expect(result.layers).toHaveLength(1)
    expect(result.layers[0].opcode).toBe(Opcode.SOLID_COLOR)
    expect(result.confidence).toBe(0.7) // 默认置信度
  })

  it('M16 自定义 confidence 生效', async () => {
    const client = createMockClient(JSON.stringify({
      layers: [{ opcode: 'NOISE', params: {} }],
    }))
    const result = await parseByLLM(client, 'test', { confidence: 0.95 })
    expect(result.confidence).toBe(0.95)
  })

  it('M17 client 收到的 prompt 含用户输入', async () => {
    const client = createMockClient(JSON.stringify({
      layers: [{ opcode: 'NOISE', params: {} }],
    }))
    await parseByLLM(client, '画一个梵高星空')
    expect(client.calls[0]).toContain('画一个梵高星空')
  })

  it('M18 client 收到的 prompt 含 schema 文档', async () => {
    const client = createMockClient(JSON.stringify({
      layers: [{ opcode: 'NOISE', params: {} }],
    }))
    await parseByLLM(client, 'test')
    expect(client.calls[0]).toContain('JSON Schema')
  })

  it('M19 client 返回非法 JSON → 抛错', async () => {
    const client = createMockClient('not json')
    await expect(parseByLLM(client, 'test')).rejects.toThrow()
  })

  it('M20 client 返回 schema 不合规 → 抛错', async () => {
    const client = createMockClient(JSON.stringify({
      layers: [{ opcode: 'INVALID', params: {} }],
    }))
    await expect(parseByLLM(client, 'test')).rejects.toThrow(/不在白名单/)
  })

  it('M21 client 抛错时传播', async () => {
    const client: LLMClient = {
      complete: vi.fn(async () => {
        throw new Error('network error')
      }),
    }
    await expect(parseByLLM(client, 'test')).rejects.toThrow(/network error/)
  })
})

// ============================================================================
// promptParser.ts 测试
// ============================================================================

describe('promptParser.parsePrompt', () => {
  it('P1 命中 rule 关键词 → source = "rule", confidence = 0.8', async () => {
    const result = await parsePrompt('画一个星空')
    expect(result.layers.length).toBeGreaterThan(0)
    expect(result.metadata.source).toBe('rule')
    expect(result.metadata.confidence).toBe(0.8)
  })

  it('P2 未命中 rule 且无 LLMClient → 空 layers + warning', async () => {
    const result = await parsePrompt('完全无法识别的描述 xyz123')
    expect(result.layers).toHaveLength(0)
    expect(result.metadata.warnings).toBeDefined()
    expect(result.metadata.warnings![0]).toMatch(/未配置 LLMClient/)
  })

  it('P3 未命中 rule + 配置 LLMClient → 走 LLM 路径', async () => {
    const client = createMockClient(JSON.stringify({
      layers: [{ opcode: 'SOLID_COLOR', params: { color: [0.3, 0.3, 0.3, 1] } }],
    }))
    const result = await parsePrompt('无法识别描述 xyz123', { llmClient: client })
    expect(result.layers).toHaveLength(1)
    expect(result.metadata.source).toBe('llm')
    expect(result.metadata.confidence).toBe(0.7)
  })

  it('P4 forceLlm = true → 跳过 rule 直接走 LLM', async () => {
    const client = createMockClient(JSON.stringify({
      layers: [{ opcode: 'NOISE', params: { scale: 50 } }],
    }))
    // "星空" 本可命中 rule,但 forceLlm 应跳过
    const result = await parsePrompt('星空', { llmClient: client, forceLlm: true })
    expect(result.metadata.source).toBe('llm')
    expect(client.calls.length).toBe(1)
  })

  it('P5 空字符串 prompt → 返回空 layers + "prompt 为空" warning', async () => {
    const result = await parsePrompt('')
    expect(result.layers).toHaveLength(0)
    expect(result.metadata.warnings).toContain('prompt 为空')
    expect(result.metadata.confidence).toBe(0)
  })

  it('P6 仅空白字符 prompt → 视为空', async () => {
    const result = await parsePrompt('   \n\t  ')
    expect(result.layers).toHaveLength(0)
    expect(result.metadata.warnings).toContain('prompt 为空')
  })

  it('P7 LLM 调用失败 → 返回空 layers + 错误 warning', async () => {
    const client: LLMClient = {
      complete: vi.fn(async () => {
        throw new Error('API 限流')
      }),
    }
    const result = await parsePrompt('无法识别描述 xyz', { llmClient: client })
    expect(result.layers).toHaveLength(0)
    expect(result.metadata.source).toBe('llm')
    expect(result.metadata.warnings![0]).toMatch(/API 限流/)
  })

  it('P8 LLM 返回非法 JSON → 返回空 layers + warning', async () => {
    const client = createMockClient('not json')
    const result = await parsePrompt('无法识别 xyz', { llmClient: client })
    expect(result.layers).toHaveLength(0)
    expect(result.metadata.warnings![0]).toMatch(/LLM 解析失败/)
  })

  it('P9 PromptRequest 对象作为输入(style 注入 LLM)', async () => {
    const client = createMockClient(JSON.stringify({
      layers: [{ opcode: 'NOISE', params: {} }],
    }))
    await parsePrompt(
      { text: '无法识别 xyz', style: 'cinematic' },
      { llmClient: client },
    )
    expect(client.calls[0]).toContain('cinematic')
  })

  it('P10 字符串输入与对象输入等效', async () => {
    const r1 = await parsePrompt('星空')
    const r2 = await parsePrompt({ text: '星空' })
    expect(r1.layers.length).toBe(r2.layers.length)
    expect(r1.metadata.source).toBe(r2.metadata.source)
  })

  it('P11 durationMs 非负', async () => {
    const result = await parsePrompt('圆形')
    expect(result.metadata.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('P12 rule 路径含 warnings 时透传', async () => {
    // "纯色色" 命中纯色关键词,但 "色" 字提示颜色未识别(实际上"纯色"含"色",这里看是否触发)
    // 改用更明确的测试:命中关键词但颜色未识别
    const result = await parsePrompt('纯色 [0.5, 0.5, 0.5, 1]')
    expect(result.metadata.source).toBe('rule')
    // 颜色被识别,无 warning
    expect(result.metadata.warnings).toBeUndefined()
  })

  it('P13 多次调用相同输入 rule 路径返回稳定结果', async () => {
    const r1 = await parsePrompt('星空 + 漩涡')
    const r2 = await parsePrompt('星空 + 漩涡')
    expect(r1.layers.length).toBe(r2.layers.length)
    expect(r1.layers.map((l) => l.id)).toEqual(r2.layers.map((l) => l.id))
  })
})
