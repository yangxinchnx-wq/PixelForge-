/**
 * Shader Node Registry(Step 28.3 / 28.4-7 / 28.11)— 节点 → WGSL 生成器注册表。
 *
 * 职责:
 * - 注册每种 Material 节点类型对应的 ShaderNodeDefinition
 * - 提供查询接口:getShaderNode(key) / listShaderNodeKeys() / listShaderNodesByCategory()
 * - 每个定义包含:
 *   - inputs / outputs 端口定义(用于 UI 显示 + 类型检查)
 *   - defaultParams 默认参数
 *   - generateWGSL(ctx) 把节点编译为 WGSL 代码片段
 *
 * 已注册节点(11 种,与 spec §4-7 对齐):
 *   - UV          (vec2 输出,从 frag coord 计算)
 *   - TEXTURE     (vec4 输出,采样 texture)
 *   - NOISE       (float 输出,伪随机 hash 噪声)
 *   - FBM         (float 输出,分形布朗运动 - 多层噪声叠加)
 *   - VORONOI     (vec2 输出,细胞噪声 + 距离场)
 *   - COLOR       (vec4 输出,常量颜色)
 *   - MATH_ADD    (float,加法)
 *   - MATH_MUL    (float,乘法)
 *   - MATH_SIN    (float,正弦)
 *   - BLEND       (vec4,两个 vec4 混合)
 *   - COLOR_CORRECT (vec4,亮度/对比度/饱和度调整)
 *   - OUTPUT      (无输出,写入 location(0))
 *
 * 与 graph/nodeRegistry.ts 的关系:
 * - graph/nodeRegistry.ts:  RenderGraph 节点(高层,描述场景结构)
 * - shaderRegistry.ts:       Material 节点(底层,描述像素计算)
 */

import type { JsonLiteral } from '@/shared/types'
import type {
  CompileContext,
  MaterialNodeType,
  MaterialPort,
  PortType,
} from './types'

// ============================================================================
// 1. ShaderNodeDefinition - 节点定义
// ============================================================================

/**
 * Shader 节点定义(注册表中的条目)。
 *
 * - key:           唯一 key(如 'uv' / 'noise' / 'output')
 * - label:         显示名(中文,如 "UV 坐标" / "噪声")
 * - type:          MaterialNodeType
 * - category:      分类(用于 NodeMenu 分组显示)
 * - description:   描述(用于 tooltip)
 * - inputs:        输入端口定义
 * - outputs:       输出端口定义
 * - defaultParams: 默认参数(用户创建节点时的初始值)
 * - generateWGSL:  WGSL 代码生成函数(写入 ctx.builder)
 */
export interface ShaderNodeDefinition {
  key: string
  label: string
  type: MaterialNodeType
  category: 'input' | 'texture' | 'filter' | 'color' | 'math' | 'composite' | 'output'
  description: string
  inputs: MaterialPort[]
  outputs: MaterialPort[]
  defaultParams: Record<string, JsonLiteral>
  /**
   * 生成 WGSL 代码片段(由 compiler 调用)。
   *
   * 实现:
   * - 通过 ctx.inputVarNames.get(portId) 取上游变量名
   * - 通过 ctx.outputVarNames.get(portId) 取本节点赋值的变量名
   * - 通过 ctx.builder.addLine() / addLet() 等写入代码
   * - 若需要 binding(如 TEXTURE),追加到 ctx.bindings
   * - 若需要 helper 函数(如 noise()),追加到 ctx.helperFunctions
   */
  generateWGSL: (ctx: CompileContext) => void
}

// ============================================================================
// 2. 工具:端口定义简化构造
// ============================================================================

function port(
  id: string,
  name: string,
  type: PortType,
  direction: 'input' | 'output',
): MaterialPort {
  return { id, name, type, direction }
}

// ============================================================================
// 3. 内置节点定义
// ============================================================================

/**
 * UV 节点:从 fragment coord 计算 uv(归一化到 [0,1])。
 *
 * 输出: vec2 uv
 *
 * 生成 WGSL:
 *   let uv_0: vec2<f32> = input.position.xy / uniforms.resolution;
 */
const UV_NODE: ShaderNodeDefinition = {
  key: 'uv',
  label: 'UV 坐标',
  type: 'UV',
  category: 'input',
  description: '从像素坐标生成归一化 UV(范围 [0,1])',
  inputs: [],
  outputs: [port('uv', 'uv', 'vec2', 'output')],
  defaultParams: {},
  generateWGSL(ctx) {
    const outVar = ctx.outputVarNames.get('uv') ?? 'uv'
    ctx.builder.addLine(
      `let ${outVar}: vec2<f32> = input.position.xy / vec2<f32>(${ctx.resolution.width}.0, ${ctx.resolution.height}.0);`,
    )
  },
}

/**
 * TEXTURE 节点:采样 texture + sampler。
 *
 * 输入:  vec2 uv
 * 输出:  vec4 color
 * 参数:  无(texture/sampler 由 binding 提供)
 *
 * 生成 WGSL:
 *   @group(0) @binding(N) var texTexture: texture_2d<f32>;
 *   @group(0) @binding(N+1) var texSampler: sampler;
 *   let color_0: vec4<f32> = textureSample(texTexture, texSampler, uv_0);
 */
const TEXTURE_NODE: ShaderNodeDefinition = {
  key: 'texture',
  label: '纹理',
  type: 'TEXTURE',
  category: 'texture',
  description: '采样一张纹理(需要绑定 texture + sampler)',
  inputs: [port('uv', 'uv', 'vec2', 'input')],
  outputs: [port('color', 'color', 'vec4', 'output')],
  defaultParams: {},
  generateWGSL(ctx) {
    const uvVar = ctx.inputVarNames.get('uv') ?? 'vec2<f32>(0.0)'
    const outVar = ctx.outputVarNames.get('color') ?? 'color'
    // 唯一 binding name(基于节点 id hash)
    const bindingIdx = ctx.bindings.length
    const texName = `tex_${ctx.nodeId.replace(/[^a-zA-Z0-9]/g, '_')}`
    const samplerName = `sampler_${ctx.nodeId.replace(/[^a-zA-Z0-9]/g, '_')}`
    ctx.bindings.push(
      `@group(0) @binding(${bindingIdx}) var ${texName}: texture_2d<f32>;`,
      `@group(0) @binding(${bindingIdx + 1}) var ${samplerName}: sampler;`,
    )
    ctx.builder.addLine(
      `let ${outVar}: vec4<f32> = textureSample(${texName}, ${samplerName}, ${uvVar});`,
    )
  },
}

/**
 * NOISE 节点:伪随机 hash 噪声(2D → float)。
 *
 * 输入:  vec2 uv
 * 输出:  float value
 * 参数:  scale(默认 4.0,UV 缩放)
 *
 * 生成 WGSL:
 *   fn hash(p: vec2<f32>) -> f32 { return fract(sin(dot(p, vec2<f32>(12.9898, 78.233))) * 43758.5453); }
 *   let scaled_0: vec2<f32> = uv_0 * 4.0;
 *   let noise_0: f32 = hash(scaled_0);
 */
const NOISE_NODE: ShaderNodeDefinition = {
  key: 'noise',
  label: '噪声',
  type: 'FILTER',
  category: 'filter',
  description: '伪随机 hash 噪声(2D → float)',
  inputs: [port('uv', 'uv', 'vec2', 'input')],
  outputs: [port('value', 'value', 'float', 'output')],
  defaultParams: { scale: 4.0 },
  generateWGSL(ctx) {
    const uvVar = ctx.inputVarNames.get('uv') ?? 'vec2<f32>(0.0)'
    const outVar = ctx.outputVarNames.get('value') ?? 'value'
    const scale = Number(ctx.node.params.scale ?? 4.0)
    ctx.helperFunctions.add(
      'fn pf_hash(p: vec2<f32>) -> f32 { return fract(sin(dot(p, vec2<f32>(12.9898, 78.233))) * 43758.5453); }',
    )
    ctx.builder.addLine(`let ${outVar}: f32 = pf_hash(${uvVar} * ${scale.toFixed(1)});`)
  },
}

/**
 * FBM 节点:分形布朗运动(多层噪声叠加,产生云雾效果)。
 *
 * 输入:  vec2 uv
 * 输出:  float value
 * 参数:  octaves(默认 4), lacunarity(默认 2.0), gain(默认 0.5)
 */
const FBM_NODE: ShaderNodeDefinition = {
  key: 'fbm',
  label: '分形噪声',
  type: 'FILTER',
  category: 'filter',
  description: '分形布朗运动(多层噪声叠加)',
  inputs: [port('uv', 'uv', 'vec2', 'input')],
  outputs: [port('value', 'value', 'float', 'output')],
  defaultParams: { octaves: 4, lacunarity: 2.0, gain: 0.5, scale: 4.0 },
  generateWGSL(ctx) {
    const uvVar = ctx.inputVarNames.get('uv') ?? 'vec2<f32>(0.0)'
    const outVar = ctx.outputVarNames.get('value') ?? 'value'
    const octaves = Number(ctx.node.params.octaves ?? 4)
    const lacunarity = Number(ctx.node.params.lacunarity ?? 2.0)
    const gain = Number(ctx.node.params.gain ?? 0.5)
    const scale = Number(ctx.node.params.scale ?? 4.0)

    ctx.helperFunctions.add(
      'fn pf_hash(p: vec2<f32>) -> f32 { return fract(sin(dot(p, vec2<f32>(12.9898, 78.233))) * 43758.5453); }',
    )
    ctx.helperFunctions.add(
      `fn pf_fbm(p: vec2<f32>) -> f32 {
        let total: f32 = 0.0;
        let amp: f32 = 0.5;
        let freq: f32 = 1.0;
        for (var i: i32 = 0; i < ${octaves}; i = i + 1) {
          total = total + amp * pf_hash(p * freq);
          freq = freq * ${lacunarity.toFixed(1)};
          amp = amp * ${gain.toFixed(1)};
        }
        return total;
      }`,
    )
    ctx.builder.addLine(`let ${outVar}: f32 = pf_fbm(${uvVar} * ${scale.toFixed(1)});`)
  },
}

/**
 * VORONOI 节点:细胞噪声(返回最近特征点 + 距离)。
 *
 * 输入:  vec2 uv
 * 输出:  vec2 result (x=cellId, y=distance)
 * 参数:  scale(默认 5.0)
 */
const VORONOI_NODE: ShaderNodeDefinition = {
  key: 'voronoi',
  label: '细胞噪声',
  type: 'FILTER',
  category: 'filter',
  description: '细胞噪声(Voronoi 图,返回 cellId + 距离)',
  inputs: [port('uv', 'uv', 'vec2', 'input')],
  outputs: [port('result', 'result', 'vec2', 'output')],
  defaultParams: { scale: 5.0 },
  generateWGSL(ctx) {
    const uvVar = ctx.inputVarNames.get('uv') ?? 'vec2<f32>(0.0)'
    const outVar = ctx.outputVarNames.get('result') ?? 'result'
    const scale = Number(ctx.node.params.scale ?? 5.0)
    ctx.helperFunctions.add(
      `fn pf_voronoi(p: vec2<f32>) -> vec2<f32> {
        let i: vec2<f32> = floor(p);
        let f: vec2<f32> = fract(p);
        var minDist: f32 = 1.0;
        var cellId: f32 = 0.0;
        for (var y: i32 = -1; y <= 1; y = y + 1) {
          for (var x: i32 = -1; x <= 1; x = x + 1) {
            let neighbor: vec2<f32> = vec2<f32>(f32(x), f32(y));
            let point: vec2<f32> = neighbor + vec2<f32>(pf_hash(i + neighbor), pf_hash(i + neighbor + vec2<f32>(1.0, 1.0)));
            let d: f32 = length(neighbor + point - f);
            if (d < minDist) {
              minDist = d;
              cellId = pf_hash(i + neighbor);
            }
          }
        }
        return vec2<f32>(cellId, minDist);
      }`,
    )
    ctx.helperFunctions.add(
      'fn pf_hash(p: vec2<f32>) -> f32 { return fract(sin(dot(p, vec2<f32>(12.9898, 78.233))) * 43758.5453); }',
    )
    ctx.builder.addLine(`let ${outVar}: vec2<f32> = pf_voronoi(${uvVar} * ${scale.toFixed(1)});`)
  },
}

/**
 * COLOR 节点:常量颜色(参数 r/g/b/a)。
 *
 * 输出: vec4 color
 */
const COLOR_NODE: ShaderNodeDefinition = {
  key: 'color',
  label: '颜色',
  type: 'COLOR',
  category: 'color',
  description: '常量颜色(r/g/b/a)',
  inputs: [],
  outputs: [port('color', 'color', 'vec4', 'output')],
  defaultParams: { r: 1.0, g: 0.5, b: 0.2, a: 1.0 },
  generateWGSL(ctx) {
    const outVar = ctx.outputVarNames.get('color') ?? 'color'
    const r = Number(ctx.node.params.r ?? 1.0)
    const g = Number(ctx.node.params.g ?? 0.5)
    const b = Number(ctx.node.params.b ?? 0.2)
    const a = Number(ctx.node.params.a ?? 1.0)
    ctx.builder.addLine(
      `let ${outVar}: vec4<f32> = vec4<f32>(${r.toFixed(3)}, ${g.toFixed(3)}, ${b.toFixed(3)}, ${a.toFixed(3)});`,
    )
  },
}

/**
 * MATH_ADD 节点:加法(a + b)。
 *
 * 输入:  float a, float b
 * 输出:  float result
 */
const MATH_ADD_NODE: ShaderNodeDefinition = {
  key: 'math_add',
  label: '加法',
  type: 'MATH',
  category: 'math',
  description: '加法: a + b',
  inputs: [
    port('a', 'a', 'float', 'input'),
    port('b', 'b', 'float', 'input'),
  ],
  outputs: [port('result', 'result', 'float', 'output')],
  defaultParams: {},
  generateWGSL(ctx) {
    const aVar = ctx.inputVarNames.get('a') ?? '0.0'
    const bVar = ctx.inputVarNames.get('b') ?? '0.0'
    const outVar = ctx.outputVarNames.get('result') ?? 'result'
    ctx.builder.addLine(`let ${outVar}: f32 = ${aVar} + ${bVar};`)
  },
}

/**
 * MATH_MUL 节点:乘法(a × b)。
 */
const MATH_MUL_NODE: ShaderNodeDefinition = {
  key: 'math_mul',
  label: '乘法',
  type: 'MATH',
  category: 'math',
  description: '乘法: a × b',
  inputs: [
    port('a', 'a', 'float', 'input'),
    port('b', 'b', 'float', 'input'),
  ],
  outputs: [port('result', 'result', 'float', 'output')],
  defaultParams: {},
  generateWGSL(ctx) {
    const aVar = ctx.inputVarNames.get('a') ?? '0.0'
    const bVar = ctx.inputVarNames.get('b') ?? '0.0'
    const outVar = ctx.outputVarNames.get('result') ?? 'result'
    ctx.builder.addLine(`let ${outVar}: f32 = ${aVar} * ${bVar};`)
  },
}

/**
 * MATH_SIN 节点:正弦。
 *
 * 输入:  float x
 * 输出:  float result
 * 参数:  scale(默认 1.0),offset(默认 0.0)
 */
const MATH_SIN_NODE: ShaderNodeDefinition = {
  key: 'math_sin',
  label: '正弦',
  type: 'MATH',
  category: 'math',
  description: '正弦: sin(x * scale + offset)',
  inputs: [port('x', 'x', 'float', 'input')],
  outputs: [port('result', 'result', 'float', 'output')],
  defaultParams: { scale: 1.0, offset: 0.0 },
  generateWGSL(ctx) {
    const xVar = ctx.inputVarNames.get('x') ?? '0.0'
    const outVar = ctx.outputVarNames.get('result') ?? 'result'
    const scale = Number(ctx.node.params.scale ?? 1.0)
    const offset = Number(ctx.node.params.offset ?? 0.0)
    ctx.builder.addLine(
      `let ${outVar}: f32 = sin(${xVar} * ${scale.toFixed(2)} + ${offset.toFixed(2)});`,
    )
  },
}

/**
 * BLEND 节点:两个 vec4 混合(线性插值)。
 *
 * 输入:  vec4 a, vec4 b, float t
 * 输出:  vec4 result
 */
const BLEND_NODE: ShaderNodeDefinition = {
  key: 'blend',
  label: '混合',
  type: 'FILTER',
  category: 'composite',
  description: '线性混合: mix(a, b, t)',
  inputs: [
    port('a', 'a', 'vec4', 'input'),
    port('b', 'b', 'vec4', 'input'),
    port('t', 't', 'float', 'input'),
  ],
  outputs: [port('result', 'result', 'vec4', 'output')],
  defaultParams: {},
  generateWGSL(ctx) {
    const aVar = ctx.inputVarNames.get('a') ?? 'vec4<f32>(0.0)'
    const bVar = ctx.inputVarNames.get('b') ?? 'vec4<f32>(0.0)'
    const tVar = ctx.inputVarNames.get('t') ?? '0.5'
    const outVar = ctx.outputVarNames.get('result') ?? 'result'
    // 注意:castPortType 处理类型转换(float → float 直接返回原变量名)
    ctx.builder.addLine(
      `let ${outVar}: vec4<f32> = mix(${aVar}, ${bVar}, ${tVar});`,
    )
  },
}

/**
 * COLOR_CORRECT 节点:亮度/对比度/饱和度调整。
 *
 * 输入:  vec4 color
 * 输出:  vec4 result
 * 参数:  brightness(默认 0.0),contrast(默认 1.0),saturation(默认 1.0)
 */
const COLOR_CORRECT_NODE: ShaderNodeDefinition = {
  key: 'color_correct',
  label: '颜色校正',
  type: 'FILTER',
  category: 'filter',
  description: '调整亮度 / 对比度 / 饱和度',
  inputs: [port('color', 'color', 'vec4', 'input')],
  outputs: [port('result', 'result', 'vec4', 'output')],
  defaultParams: { brightness: 0.0, contrast: 1.0, saturation: 1.0 },
  generateWGSL(ctx) {
    const colorVar = ctx.inputVarNames.get('color') ?? 'vec4<f32>(0.0)'
    const outVar = ctx.outputVarNames.get('result') ?? 'result'
    const brightness = Number(ctx.node.params.brightness ?? 0.0)
    const contrast = Number(ctx.node.params.contrast ?? 1.0)
    const saturation = Number(ctx.node.params.saturation ?? 1.0)

    ctx.helperFunctions.add(
      `fn pf_luma(c: vec3<f32>) -> f32 { return dot(c, vec3<f32>(0.299, 0.587, 0.114)); }`,
    )
    ctx.helperFunctions.add(
      `fn pf_color_correct(c: vec4<f32>, brightness: f32, contrast: f32, saturation: f32) -> vec4<f32> {
        var rgb: vec3<f32> = c.rgb;
        rgb = rgb + brightness;
        rgb = (rgb - 0.5) * contrast + 0.5;
        let l: f32 = pf_luma(rgb);
        rgb = mix(vec3<f32>(l, l, l), rgb, saturation);
        return vec4<f32>(rgb, c.a);
      }`,
    )
    ctx.builder.addLine(
      `let ${outVar}: vec4<f32> = pf_color_correct(${colorVar}, ${brightness.toFixed(3)}, ${contrast.toFixed(3)}, ${saturation.toFixed(3)});`,
    )
  },
}

/**
 * OUTPUT 节点:最终输出(写入 @location(0))。
 *
 * 输入:  vec4 color
 * 输出:  无
 */
const OUTPUT_NODE: ShaderNodeDefinition = {
  key: 'output',
  label: '输出',
  type: 'OUTPUT',
  category: 'output',
  description: '最终输出(写入 location(0))',
  inputs: [port('color', 'color', 'vec4', 'input')],
  outputs: [],
  defaultParams: {},
  generateWGSL(ctx) {
    const colorVar = ctx.inputVarNames.get('color') ?? 'vec4<f32>(0.0, 0.0, 0.0, 1.0)'
    ctx.builder.addLine(`return ${colorVar};`)
  },
}

// ============================================================================
// 4. 注册表
// ============================================================================

/**
 * 全部节点定义(按 key 索引)。
 *
 * 顺序与注册顺序一致(用于 listShaderNodeKeys 的稳定输出)。
 */
const REGISTRY: Record<string, ShaderNodeDefinition> = {
  uv: UV_NODE,
  texture: TEXTURE_NODE,
  noise: NOISE_NODE,
  fbm: FBM_NODE,
  voronoi: VORONOI_NODE,
  color: COLOR_NODE,
  math_add: MATH_ADD_NODE,
  math_mul: MATH_MUL_NODE,
  math_sin: MATH_SIN_NODE,
  blend: BLEND_NODE,
  color_correct: COLOR_CORRECT_NODE,
  output: OUTPUT_NODE,
}

export type ShaderNodeKey = keyof typeof REGISTRY

/**
 * 获取节点定义。
 *
 * @param key 节点 key(如 'uv' / 'noise')
 * @returns 节点定义,不存在返回 undefined
 */
export function getShaderNode(key: string): ShaderNodeDefinition | undefined {
  return REGISTRY[key]
}

/**
 * 列出所有节点 key(按注册顺序)。
 */
export function listShaderNodeKeys(): string[] {
  return Object.keys(REGISTRY)
}

/**
 * 按 category 分组列出节点 key。
 *
 * @returns Record<category, key[]>
 */
export function listShaderNodeKeysByCategory(): Record<string, string[]> {
  const result: Record<string, string[]> = {}
  for (const [key, def] of Object.entries(REGISTRY)) {
    if (!result[def.category]) {
      result[def.category] = []
    }
    result[def.category].push(key)
  }
  return result
}

/**
 * 从节点定义创建 MaterialNode 实例(用户在编辑器中添加节点时调用)。
 */
export function createNodeFromTemplate(
  key: string,
  nodeId: string,
  position: { x: number; y: number },
): import('./types').MaterialNode | null {
  const def = getShaderNode(key)
  if (!def) return null
  return {
    id: nodeId,
    type: def.type,
    name: def.label,
    position,
    inputs: def.inputs.map((p) => ({ ...p })),
    outputs: def.outputs.map((p) => ({ ...p })),
    params: { ...def.defaultParams },
    templateKey: def.key,
  }
}

/** category 中文标签(用于 NodeMenu) */
export const SHADER_CATEGORY_LABELS: Record<string, string> = {
  input: '输入',
  texture: '纹理',
  filter: '滤镜',
  color: '颜色',
  math: '数学',
  composite: '合成',
  output: '输出',
}
