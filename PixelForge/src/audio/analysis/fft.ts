/**
 * FFT 频谱分析(Step 41.6)— 基 2 迭代 Cooley-Tukey + 加窗 + 幅度谱。
 *
 * 职责:
 * - 提供可注入的 FFT 实现(便于用固定序列做单测,也便于替换为 WASM 实现)
 * - 提供窗函数(Hann / 矩形)
 * - 把时域采样转换为归一化幅度谱
 *
 * 纯函数,零 Web Audio / DOM 依赖。
 *
 * 数据流:
 *   时域采样(来自 AnalyserNode 或 AudioBuffer)
 *     ↓ 加窗 → FFT → 取幅度
 *   Float32Array(前 N/2 个 bin,归一化 0~1)
 *     ↓ featureExtractor
 *   AudioFeatures
 */

// ============================================================================
// 1. 工具
// ============================================================================

/**
 * 判断是否为 2 的整数次幂。
 */
export function isPowerOfTwo(n: number): boolean {
  if (!Number.isFinite(n) || n <= 0) return false
  return (n & (n - 1)) === 0
}

/**
 * 返回 >= n 的最小 2 的幂。
 */
export function nextPowerOfTwo(n: number): number {
  if (!Number.isFinite(n) || n <= 1) return 1
  let p = 1
  while (p < n) p <<= 1
  return p
}

/**
 * 返回 <= n 的最大 2 的幂。
 */
export function floorPowerOfTwo(n: number): number {
  if (!Number.isFinite(n) || n <= 1) return 1
  let p = 1
  while (p * 2 <= n) p <<= 1
  return p
}

// ============================================================================
// 2. 窗函数
// ============================================================================

/** 窗函数签名:i 为索引,n 为总长度,返回 0~1 的窗值 */
export type WindowFunction = (i: number, n: number) => number

/**
 * Hann 窗。
 *
 * 两端归零,能有效抑制频谱泄漏,是频谱分析最常用的窗。
 */
export const hannWindow: WindowFunction = (i, n) => {
  if (n <= 1) return 1
  return 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)))
}

/**
 * 矩形窗(不加窗)。
 *
 * 频率分辨率最高但泄漏最严重,保留以便对比。
 */
export const rectangularWindow: WindowFunction = () => 1

/**
 * Hamming 窗。
 *
 * 与 Hann 类似,但两端不为零,适合对端点连续性要求高的场景。
 */
export const hammingWindow: WindowFunction = (i, n) => {
  if (n <= 1) return 1
  return 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (n - 1))
}

// ============================================================================
// 3. FFT
// ============================================================================

/** FFT 函数签名:原地修改 re / im 数组 */
export type FftFunction = (re: Float64Array, im: Float64Array) => void

/**
 * 基 2 迭代 Cooley-Tukey FFT(原地)。
 *
 * 要求 re.length 为 2 的整数次幂且 re.length === im.length;
 * 不满足时直接返回(不抛异常),调用方可用 isPowerOfTwo 预检。
 *
 * 旋转因子用三角函数直接计算而非递推,避免长变换下的累积误差。
 */
export const fftInPlace: FftFunction = (re, im) => {
  const n = Math.min(re.length, im.length)
  if (n <= 1) return
  if (!isPowerOfTwo(n)) return

  // 位反转置换
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) {
      j ^= bit
    }
    j ^= bit
    if (i < j) {
      const tr = re[i]
      re[i] = re[j]
      re[j] = tr
      const ti = im[i]
      im[i] = im[j]
      im[j] = ti
    }
  }

  // 蝶形运算
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < half; k++) {
        const angle = (-2 * Math.PI * k) / len
        const cr = Math.cos(angle)
        const ci = Math.sin(angle)

        const ar = re[i + k]
        const ai = im[i + k]
        const br = re[i + k + half]
        const bi = im[i + k + half]

        const vr = br * cr - bi * ci
        const vi = br * ci + bi * cr

        re[i + k] = ar + vr
        im[i + k] = ai + vi
        re[i + k + half] = ar - vr
        im[i + k + half] = ai - vi
      }
    }
  }
}

// ============================================================================
// 4. 幅度谱
// ============================================================================

/** 幅度谱计算选项 */
export interface MagnitudeSpectrumOptions {
  /** 自定义 FFT 实现(默认 fftInPlace) */
  fft?: FftFunction
  /** 窗函数(默认 hannWindow) */
  window?: WindowFunction
}

/**
 * 计算归一化幅度谱。
 *
 * 返回前 `fftSize / 2` 个 bin 的幅度,归一化到 0~1
 * (满幅正弦在对应 bin 上的峰值约为 1)。
 *
 * @param samples 时域采样
 * @param fftSize FFT 长度,缺省时取 <= 采样数 的最大 2 的幂
 * @param options FFT 实现与窗函数
 * @returns 幅度谱(长度 fftSize/2);输入非法时返回空数组
 */
export function computeMagnitudeSpectrum(
  samples: ArrayLike<number>,
  fftSize?: number,
  options: MagnitudeSpectrumOptions = {},
): Float32Array {
  const n = samples.length
  if (n === 0) return new Float32Array(0)

  let size = fftSize ?? floorPowerOfTwo(n)
  if (!Number.isFinite(size) || size < 2) size = 2
  if (!isPowerOfTwo(size)) size = floorPowerOfTwo(size)
  if (size < 2) return new Float32Array(0)

  const fft = options.fft ?? fftInPlace
  const win = options.window ?? hannWindow

  const re = new Float64Array(size)
  const im = new Float64Array(size)

  for (let i = 0; i < size; i++) {
    const raw = i < n ? samples[i] : 0
    const value = Number.isNaN(raw) ? 0 : raw
    re[i] = value * win(i, size)
  }

  fft(re, im)

  const bins = size >> 1
  const spectrum = new Float32Array(bins)
  const norm = size / 2

  for (let i = 0; i < bins; i++) {
    spectrum[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]) / norm
  }

  return spectrum
}

/**
 * 计算幅度谱(dB 域)。
 *
 * @param spectrum 线性幅度谱
 * @param floorDb 下限,低于此值截断(避免 log(0))
 */
export function spectrumToDb(spectrum: ArrayLike<number>, floorDb = -100): Float32Array {
  const out = new Float32Array(spectrum.length)
  for (let i = 0; i < spectrum.length; i++) {
    const v = spectrum[i]
    out[i] = v > 0 ? Math.max(floorDb, 20 * Math.log10(v)) : floorDb
  }
  return out
}
