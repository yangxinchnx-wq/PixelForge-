/**
 * GPU Dispatch(Step 27)— 节点图 GPU 调度模块。
 *
 * 职责:
 * - 懒创建并缓存 compute pipeline(每种 shader 只创建一次)
 * - 把 GraphNode.params 序列化为 GPU buffer 格式(与 regionCompiler 对齐)
 * - 提供 dispatchRegion / dispatchEffect / dispatchComposite 三个入口
 *
 * 与 compiler/region/evaluator.ts 的关系:
 * - compiler/region/evaluator.ts: 主运行时, 一次性 dispatch 所有图层
 * - gpuDispatch.ts: 节点图运行时, 每个节点独立 dispatch
 *
 * 纹理要求:
 * - 输出纹理: STORAGE_BINDING | TEXTURE_BINDING | COPY_DST, format=rgba8unorm
 * - 输入纹理(上游): TEXTURE_BINDING, format=rgba8unorm
 */

import nodeShaderSource from '@/shaders/graph_node_eval.wgsl?raw'
import effectShaderSource from '@/shaders/graph_effect.wgsl?raw'
import compositeShaderSource from '@/shaders/graph_composite.wgsl?raw'

import type { GraphNode } from '../types'

// ============================================================================
// GPUBufferUsage 在非浏览器环境中可能未定义, 使用数值 fallback
// ============================================================================

const BUFFER_USAGE_STORAGE = typeof GPUBufferUsage !== 'undefined' ? GPUBufferUsage.STORAGE : 0x0080
const BUFFER_USAGE_UNIFORM = typeof GPUBufferUsage !== 'undefined' ? GPUBufferUsage.UNIFORM : 0x0040
const BUFFER_USAGE_COPY_DST = typeof GPUBufferUsage !== 'undefined' ? GPUBufferUsage.COPY_DST : 0x0008

const TEXTURE_USAGE_STORAGE = typeof GPUTextureUsage !== 'undefined' ? GPUTextureUsage.STORAGE_BINDING : 0x0080
const TEXTURE_USAGE_BINDING = typeof GPUTextureUsage !== 'undefined' ? GPUTextureUsage.TEXTURE_BINDING : 0x0004
const TEXTURE_USAGE_COPY_DST = typeof GPUTextureUsage !== 'undefined' ? GPUTextureUsage.COPY_DST : 0x0008

// ============================================================================
// Pipeline 缓存 — 每个 device 独立缓存
// ============================================================================

interface PipelineCache {
  regionPipeline: GPUComputePipeline | null
  effectPipeline: GPUComputePipeline | null
  compositePipeline: GPUComputePipeline | null
}

const pipelineCaches = new WeakMap<GPUDevice, PipelineCache>()

function getPipelineCache(device: GPUDevice): PipelineCache {
  let cache = pipelineCaches.get(device)
  if (!cache) {
    cache = {
      regionPipeline: null,
      effectPipeline: null,
      compositePipeline: null,
    }
    pipelineCaches.set(device, cache)
  }
  return cache
}

function getRegionPipeline(device: GPUDevice): GPUComputePipeline {
  const cache = getPipelineCache(device)
  if (!cache.regionPipeline) {
    const shaderModule = device.createShaderModule({
      label: 'graph-node-eval-shader',
      code: nodeShaderSource,
    })
    cache.regionPipeline = device.createComputePipeline({
      label: 'graph-node-eval-pipeline',
      layout: 'auto',
      compute: {
        module: shaderModule,
        entryPoint: 'main',
      },
    })
  }
  return cache.regionPipeline
}

function getEffectPipeline(device: GPUDevice): GPUComputePipeline {
  const cache = getPipelineCache(device)
  if (!cache.effectPipeline) {
    const shaderModule = device.createShaderModule({
      label: 'graph-effect-shader',
      code: effectShaderSource,
    })
    cache.effectPipeline = device.createComputePipeline({
      label: 'graph-effect-pipeline',
      layout: 'auto',
      compute: {
        module: shaderModule,
        entryPoint: 'main',
      },
    })
  }
  return cache.effectPipeline
}

function getCompositePipeline(device: GPUDevice): GPUComputePipeline {
  const cache = getPipelineCache(device)
  if (!cache.compositePipeline) {
    const shaderModule = device.createShaderModule({
      label: 'graph-composite-shader',
      code: compositeShaderSource,
    })
    cache.compositePipeline = device.createComputePipeline({
      label: 'graph-composite-pipeline',
      layout: 'auto',
      compute: {
        module: shaderModule,
        entryPoint: 'main',
      },
    })
  }
  return cache.compositePipeline
}

// ============================================================================
// 参数序列化 — 把 GraphNode.params 转为 Float32Array
// 与 regionCompiler createAuxData 逻辑对齐
// ============================================================================

function readNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && !Number.isNaN(value)) return value
  return fallback
}

function readColorVector(value: unknown, fallback: [number, number, number, number]): number[] {
  if (Array.isArray(value) && value.length >= 4) {
    return [
      typeof value[0] === 'number' ? value[0] : fallback[0],
      typeof value[1] === 'number' ? value[1] : fallback[1],
      typeof value[2] === 'number' ? value[2] : fallback[2],
      typeof value[3] === 'number' ? value[3] : fallback[3],
    ]
  }
  return [...fallback]
}

function readVec2(value: unknown, fallback: [number, number]): number[] {
  if (Array.isArray(value) && value.length >= 2) {
    return [
      typeof value[0] === 'number' ? value[0] : fallback[0],
      typeof value[1] === 'number' ? value[1] : fallback[1],
    ]
  }
  return [...fallback]
}

/**
 * 把 REGION 节点参数序列化为 auxBuffer Float32Array。
 *
 * 布局(与 regionCompiler createAuxData 对齐):
 * - SOLID_COLOR:     2 vec4f (color + pad)
 * - LINEAR_GRADIENT: 3 vec4f (fromTo + colorA + colorB)
 * - NOISE:           3 vec4f (scale/amount + colorA + colorB)
 * - CIRCLE_SHAPE:    3 vec4f (center/radius + fill + background)
 */
export function serializeRegionParams(node: GraphNode): Float32Array {
  const opcode = node.opcodeName ?? ''

  switch (opcode) {
    case 'SOLID_COLOR': {
      const color = readColorVector(node.params.color, [0.18, 0.55, 0.92, 1])
      return new Float32Array([
        color[0], color[1], color[2], color[3],
        0, 0, 0, 0,
      ])
    }
    case 'LINEAR_GRADIENT': {
      const from = readVec2(node.params.from, [0, 0])
      const to = readVec2(node.params.to, [1, 1])
      const colorA = readColorVector(node.params.colorA, [0.1, 0.2, 0.9, 1])
      const colorB = readColorVector(node.params.colorB, [0.85, 0.35, 0.6, 1])
      return new Float32Array([
        from[0], from[1], to[0], to[1],
        colorA[0], colorA[1], colorA[2], colorA[3],
        colorB[0], colorB[1], colorB[2], colorB[3],
      ])
    }
    case 'NOISE': {
      const scale = readNumber(node.params.scale, 24)
      const amount = readNumber(node.params.amount, 1)
      const colorA = readColorVector(node.params.colorA, [0.08, 0.11, 0.2, 1])
      const colorB = readColorVector(node.params.colorB, [0.74, 0.85, 0.98, 1])
      return new Float32Array([
        scale, amount, 0, 0,
        colorA[0], colorA[1], colorA[2], colorA[3],
        colorB[0], colorB[1], colorB[2], colorB[3],
      ])
    }
    case 'CIRCLE_SHAPE': {
      const center = readVec2(node.params.center, [0.5, 0.5])
      const radius = readNumber(node.params.radius, 0.25)
      const fill = readColorVector(node.params.fill, [0.96, 0.72, 0.18, 1])
      const background = readColorVector(node.params.background, [0.08, 0.09, 0.12, 1])
      return new Float32Array([
        center[0], center[1], radius, 0,
        fill[0], fill[1], fill[2], fill[3],
        background[0], background[1], background[2], background[3],
      ])
    }
    case 'IMAGE_TEXTURE': {
      // IMAGE_TEXTURE 需要从 textureCache 获取外部纹理, 暂用占位色
      // 完整实现需要 ctx 中注入 textureCache
      const color = readColorVector(node.params.color, [0.5, 0.5, 0.5, 1])
      return new Float32Array([
        color[0], color[1], color[2], color[3],
        0, 0, 0, 0,
      ])
    }
    default: {
      // 未知 opcode: 返回黑色
      return new Float32Array([0, 0, 0, 1, 0, 0, 0, 0])
    }
  }
}

/**
 * 把 EFFECT 节点参数序列化为 paramBuffer Float32Array。
 *
 * 布局(与 regionCompiler createEffectParamData 对齐):
 * - blur:        1 vec4f (radius)
 * - bloom:       1 vec4f (threshold, intensity)
 * - color_shift: 1 vec4f (shift)
 * - vignette:    1 vec4f (strength)
 * - mask:        1 vec4f (center.xy, radius)
 */
export function serializeEffectParams(node: GraphNode): Float32Array {
  const effectType = (node.opcodeName ?? '').toLowerCase()

  switch (effectType) {
    case 'blur': {
      const radius = readNumber(node.params.radius, 0.005)
      return new Float32Array([radius, 0, 0, 0])
    }
    case 'bloom': {
      const threshold = readNumber(node.params.threshold, 0.7)
      const intensity = readNumber(node.params.intensity, 0.5)
      return new Float32Array([threshold, intensity, 0, 0])
    }
    case 'color_shift': {
      const shift = readNumber(node.params.shift, 0.1)
      return new Float32Array([shift, 0, 0, 0])
    }
    case 'vignette': {
      const strength = readNumber(node.params.strength, 0.5)
      return new Float32Array([strength, 0, 0, 0])
    }
    case 'mask': {
      const center = readVec2(node.params.center, [0.5, 0.5])
      const radius = readNumber(node.params.radius, 0.3)
      return new Float32Array([center[0], center[1], radius, 0])
    }
    default: {
      return new Float32Array([0, 0, 0, 0])
    }
  }
}

// ============================================================================
// Opcode / EffectType / BlendMode 映射
// ============================================================================

const OPCODE_IDS: Record<string, number> = {
  SOLID_COLOR: 0,
  LINEAR_GRADIENT: 1,
  NOISE: 2,
  BLEND: 3,
  CIRCLE_SHAPE: 4,
  IMAGE_TEXTURE: 5,
}

const EFFECT_TYPE_IDS: Record<string, number> = {
  blur: 0,
  bloom: 1,
  color_shift: 2,
  vignette: 3,
  mask: 4,
}

const BLEND_MODE_IDS: Record<string, number> = {
  normal: 0,
  multiply: 1,
  screen: 2,
  overlay: 3,
  add: 4,
  subtract: 5,
}

// ============================================================================
// 纹理创建辅助
// ============================================================================

/**
 * 创建适合节点图运行时的 GPUTexture。
 *
 * 使用 STORAGE_BINDING | TEXTURE_BINDING | COPY_DST:
 * - STORAGE_BINDING: compute shader 写入 (textureStore)
 * - TEXTURE_BINDING: compute shader 读取 (textureLoad)
 * - COPY_DST: copyExternalImageToTexture (textureCache 上传)
 */
export function createGraphGpuTexture(
  device: GPUDevice,
  width: number,
  height: number,
  label: string,
): GPUTexture {
  return device.createTexture({
    label,
    size: { width, height },
    format: 'rgba8unorm',
    usage: TEXTURE_USAGE_STORAGE | TEXTURE_USAGE_BINDING | TEXTURE_USAGE_COPY_DST,
  })
}

// ============================================================================
// Dispatch 入口
// ============================================================================

/**
 * Dispatch 单个 REGION 节点的 GPU 计算。
 *
 * @param device       GPUDevice
 * @param node         REGION 节点
 * @param outputTexture 输出 GPUTexture (由 TexturePool 创建)
 * @param canvas       画布尺寸
 * @param seed         随机种子
 */
export function dispatchRegion(
  device: GPUDevice,
  node: GraphNode,
  outputTexture: GPUTexture,
  canvas: { width: number; height: number },
  seed: number = 42,
): void {
  const pipeline = getRegionPipeline(device)
  const auxData = serializeRegionParams(node)
  const opcodeId = OPCODE_IDS[node.opcodeName ?? ''] ?? 0

  // Uniforms: resolution(vec2f) + seed(u32) + opcode(u32) = 16 bytes
  const uniformBuffer = device.createBuffer({
    label: `graph-region-uniform:${node.id}`,
    size: 16,
    usage: BUFFER_USAGE_UNIFORM | BUFFER_USAGE_COPY_DST,
  })
  device.queue.writeBuffer(uniformBuffer, 0, new Float32Array([
    canvas.width, canvas.height, seed, opcodeId,
  ]))

  // Aux buffer
  const auxBuffer = device.createBuffer({
    label: `graph-region-aux:${node.id}`,
    size: Math.max(auxData.byteLength, 16),
    usage: BUFFER_USAGE_STORAGE | BUFFER_USAGE_COPY_DST,
  })
  device.queue.writeBuffer(auxBuffer, 0, auxData)

  // Bind group
  const bindGroup = device.createBindGroup({
    label: `graph-region-bg:${node.id}`,
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: outputTexture.createView() },
      { binding: 2, resource: { buffer: auxBuffer } },
    ],
  })

  // Dispatch
  const encoder = device.createCommandEncoder({ label: `graph-region-enc:${node.id}` })
  const pass = encoder.beginComputePass({ label: `graph-region-pass:${node.id}` })
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, bindGroup)
  pass.dispatchWorkgroups(
    Math.ceil(canvas.width / 16),
    Math.ceil(canvas.height / 16),
  )
  pass.end()
  device.queue.submit([encoder.finish()])

  // 清理本帧 buffer(uniform/aux 可复用但当前简化为每帧新建)
  uniformBuffer.destroy()
  auxBuffer.destroy()
}

/**
 * Dispatch 单个 EFFECT 节点的 GPU 计算。
 *
 * @param device        GPUDevice
 * @param node          EFFECT 节点
 * @param inputTexture  上游输入 GPUTexture
 * @param outputTexture 输出 GPUTexture
 * @param canvas        画布尺寸
 */
export function dispatchEffect(
  device: GPUDevice,
  node: GraphNode,
  inputTexture: GPUTexture,
  outputTexture: GPUTexture,
  canvas: { width: number; height: number },
): void {
  const pipeline = getEffectPipeline(device)
  const paramData = serializeEffectParams(node)
  const effectTypeId = EFFECT_TYPE_IDS[(node.opcodeName ?? '').toLowerCase()] ?? 0

  // Uniforms: resolution(vec2f) + effectType(u32) + pad*2 = 16 bytes
  const uniformBuffer = device.createBuffer({
    label: `graph-effect-uniform:${node.id}`,
    size: 16,
    usage: BUFFER_USAGE_UNIFORM | BUFFER_USAGE_COPY_DST,
  })
  device.queue.writeBuffer(uniformBuffer, 0, new Float32Array([
    canvas.width, canvas.height, effectTypeId, 0,
  ]))

  // Param buffer
  const paramBuffer = device.createBuffer({
    label: `graph-effect-param:${node.id}`,
    size: Math.max(paramData.byteLength, 16),
    usage: BUFFER_USAGE_STORAGE | BUFFER_USAGE_COPY_DST,
  })
  device.queue.writeBuffer(paramBuffer, 0, paramData)

  // Bind group
  const bindGroup = device.createBindGroup({
    label: `graph-effect-bg:${node.id}`,
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: inputTexture.createView() },
      { binding: 2, resource: outputTexture.createView() },
      { binding: 3, resource: { buffer: paramBuffer } },
    ],
  })

  // Dispatch
  const encoder = device.createCommandEncoder({ label: `graph-effect-enc:${node.id}` })
  const pass = encoder.beginComputePass({ label: `graph-effect-pass:${node.id}` })
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, bindGroup)
  pass.dispatchWorkgroups(
    Math.ceil(canvas.width / 16),
    Math.ceil(canvas.height / 16),
  )
  pass.end()
  device.queue.submit([encoder.finish()])

  uniformBuffer.destroy()
  paramBuffer.destroy()
}

/**
 * Dispatch COMPOSITE 节点的 GPU 合成。
 *
 * @param device         GPUDevice
 * @param inputTextures  上游输入 GPUTexture 列表(最多 2 个)
 * @param outputTexture  输出 GPUTexture
 * @param canvas         画布尺寸
 * @param blendMode      混合模式字符串
 */
export function dispatchComposite(
  device: GPUDevice,
  inputTextures: GPUTexture[],
  outputTexture: GPUTexture,
  canvas: { width: number; height: number },
  blendMode: string = 'normal',
): void {
  const pipeline = getCompositePipeline(device)
  const blendModeId = BLEND_MODE_IDS[blendMode] ?? 0
  const inputCount = Math.min(inputTextures.length, 2)

  // Uniforms: resolution(vec2f) + inputCount(u32) + blendMode(u32) + pad = 16 bytes
  const uniformBuffer = device.createBuffer({
    label: 'graph-composite-uniform',
    size: 16,
    usage: BUFFER_USAGE_UNIFORM | BUFFER_USAGE_COPY_DST,
  })
  device.queue.writeBuffer(uniformBuffer, 0, new Float32Array([
    canvas.width, canvas.height, inputCount, blendModeId,
  ]))

  // Bind group
  const entries: GPUBindGroupEntry[] = [
    { binding: 0, resource: { buffer: uniformBuffer } },
    { binding: 1, resource: inputTextures[0].createView() },
  ]

  // 如果只有 1 个输入, 仍需提供 binding 2 (WebGPU 要求所有 binding 都有资源)
  // 复用 inputTextures[0] 作为占位
  const secondTex = inputTextures[1] ?? inputTextures[0]
  entries.push({ binding: 2, resource: secondTex.createView() })
  entries.push({ binding: 3, resource: outputTexture.createView() })

  const bindGroup = device.createBindGroup({
    label: 'graph-composite-bg',
    layout: pipeline.getBindGroupLayout(0),
    entries,
  })

  // Dispatch
  const encoder = device.createCommandEncoder({ label: 'graph-composite-enc' })
  const pass = encoder.beginComputePass({ label: 'graph-composite-pass' })
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, bindGroup)
  pass.dispatchWorkgroups(
    Math.ceil(canvas.width / 16),
    Math.ceil(canvas.height / 16),
  )
  pass.end()
  device.queue.submit([encoder.finish()])

  uniformBuffer.destroy()
}
