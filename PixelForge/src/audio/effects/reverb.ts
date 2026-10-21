/**
 * 混响(Step 41.2)— 参数模型 + 脉冲响应(IR)生成纯函数。
 *
 * 职责:
 * - 定义混响参数模型与默认值
 * - 生成用于 ConvolverNode 的脉冲响应缓冲区
 *
 * 纯函数,零 Web Audio / DOM 依赖。**随机数可注入种子**,保证同样的参数
 * 永远生成同样的 IR(便于测试与工程可复现)。
 *
 * 生成算法:
 *   预延迟静音段 → 指数衰减噪声(尾音) → 逐采样一阶低通(高频阻尼)
 *
 * 数据流:
 *   ReverbParams
 *     ↓ generateImpulseResponse
 *   Float32Array(脉冲响应)
 *     ↓ runtime: ConvolverNode.buffer
 *   混响输出
 */

// ============================================================================
// 1. 参数模型
// ============================================================================

/** 混响参数 */
export type ReverbParams = {
  /** 混响时间 RT60(秒),即衰减 60dB 所需时间 */
  decaySeconds: number
  /** 预延迟(毫秒),直达声与第一次反射之间的间隔 */
  preDelayMs: number
  /** 高频阻尼(0 ~ 1),越大高频衰减越快 */
  damping: number
  /** 干湿比(0 全干 ~ 1 全湿) */
  mix: number
  /** 房间大小(0 ~ 1),影响尾音形态 */
  roomSize: number
}

/** 混响默认参数(中等房间) */
export const DEFAULT_REVERB_PARAMS: ReverbParams = {
  decaySeconds: 2,
  preDelayMs: 20,
  damping: 0.5,
  mix: 0.25,
  roomSize: 0.5,
}

// ============================================================================
// 2. 确定性随机源
// ============================================================================

/**
 * mulberry32 伪随机数生成器。
 *
 * 同样的种子必然产出同样的序列,避免 IR 在不同会话间抖动。
 *
 * @param seed 32 位整数种子
 * @returns 返回 [0,1) 区间的随机函数
 */
export function createRandomSource(seed: number): () => number {
  let a = seed >>> 0
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ============================================================================
// 3. 参数校验
// ============================================================================

/**
 * 把混响参数限制在合法范围内。
 */
export function clampReverbParams(params: ReverbParams): ReverbParams {
  const clamp = (v: number, min: number, max: number, fallback: number): number => {
    if (Number.isNaN(v)) return fallback
    return Math.min(max, Math.max(min, v))
  }

  return {
    decaySeconds: clamp(params.decaySeconds, 0.1, 10, DEFAULT_REVERB_PARAMS.decaySeconds),
    preDelayMs: clamp(params.preDelayMs, 0, 200, DEFAULT_REVERB_PARAMS.preDelayMs),
    damping: clamp(params.damping, 0, 1, DEFAULT_REVERB_PARAMS.damping),
    mix: clamp(params.mix, 0, 1, DEFAULT_REVERB_PARAMS.mix),
    roomSize: clamp(params.roomSize, 0, 1, DEFAULT_REVERB_PARAMS.roomSize),
  }
}

// ============================================================================
// 4. 脉冲响应生成
// ============================================================================

/**
 * 生成混响脉冲响应。
 *
 * @param params 混响参数(会被 clamp)
 * @param sampleRate 采样率
 * @param durationSeconds IR 时长(秒),默认取 decaySeconds 的 1.2 倍以容纳完整衰减
 * @param seed 随机种子,默认 0x9e3779b9
 * @returns 脉冲响应采样数据(已归一化到峰值 1)
 */
export function generateImpulseResponse(
  params: ReverbParams,
  sampleRate: number,
  durationSeconds?: number,
  seed: number = 0x9e3779b9,
): Float32Array {
  const p = clampReverbParams(params)

  if (!Number.isFinite(sampleRate) || sampleRate <= 0) return new Float32Array(0)

  const duration = durationSeconds ?? p.decaySeconds * 1.2
  if (!Number.isFinite(duration) || duration <= 0) return new Float32Array(0)

  const length = Math.max(1, Math.floor(duration * sampleRate))
  const ir = new Float32Array(length)
  const random = createRandomSource(seed)

  const preDelaySamples = Math.min(length, Math.floor((p.preDelayMs / 1000) * sampleRate))

  // RT60 换算:exp(-t/τ) 衰减 60dB(即到 0.001)需要 t = τ·ln(1000) ≈ 6.908τ
  // 因此 τ = decaySeconds / 6.908
  const tau = p.decaySeconds / 6.908

  // 高频阻尼:一阶低通系数,damping 越大高频衰减越快
  // 同时受 roomSize 影响——大房间的高频衰减相对更慢
  const dampingCoef = 0.1 + p.damping * 0.8 * (1 - p.roomSize * 0.3)

  let lowpassState = 0
  let peak = 0

  for (let i = preDelaySamples; i < length; i++) {
    const t = (i - preDelaySamples) / sampleRate

    // 指数衰减包络
    const envelope = Math.exp(-t / tau)

    // 白噪声(双边,均值为 0)
    const noise = random() * 2 - 1

    // 一阶低通模拟高频吸收(空气与墙面吸声)
    lowpassState += (noise - lowpassState) * (1 - dampingCoef)
    const damped = lowpassState

    // 房间越大,早期反射越稀疏、尾音越平滑;这里用包络的幂次近似
    const shape = Math.pow(envelope, 1 + (1 - p.roomSize) * 0.5)

    const value = damped * shape
    ir[i] = value

    const abs = Math.abs(value)
    if (abs > peak) peak = abs
  }

  // 归一化到峰值 1,避免不同参数下响度差异过大
  if (peak > 0) {
    for (let i = 0; i < length; i++) {
      ir[i] /= peak
    }
  }

  return ir
}

/**
 * 计算干湿混合系数。
 *
 * 混响通常以"湿信号叠加在干信号上"的方式接入,mix 为 0 时完全干声,
 * 为 1 时完全湿声。返回的一对系数满足等功率混合,避免中间位置响度下陷。
 *
 * @param mix 干湿比(0 全干 ~ 1 全湿)
 */
export function computeWetDryGains(mix: number): { dry: number; wet: number } {
  const m = Math.min(1, Math.max(0, Number.isNaN(mix) ? 0 : mix))
  const angle = (m * Math.PI) / 2
  return {
    dry: Math.cos(angle),
    wet: Math.sin(angle),
  }
}

/**
 * 估算 IR 的有效长度(衰减到 -60dB 所需的采样数)。
 *
 * 用于运行时层决定 ConvolverNode 缓冲区大小,避免生成过长的无用尾音。
 */
export function estimateReverbTailSamples(
  params: ReverbParams,
  sampleRate: number,
): number {
  const p = clampReverbParams(params)
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) return 0
  const tail = Math.ceil(p.decaySeconds * 1.2 * sampleRate)
  return tail + Math.floor((p.preDelayMs / 1000) * sampleRate)
}
