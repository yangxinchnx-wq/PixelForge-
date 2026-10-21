/**
 * 音频模块统一出口。
 *
 * 当前进度:
 * - Step 41.1 核心纯函数层 ✅
 * - Step 41.2 音频效果链 ✅
 * - Step 41.6 音频分析(FFT / 特征提取 / 节拍检测)✅
 * - Step 41.3 Web Audio 运行时(AudioContext 注入 / 节点图 / 源调度)✅
 *
 * 后续 Step 41.4(Store)/ 41.5(UI)/ 41.7(驱动画面)/ 41.8(导出)
 * 完成后在此追加导出。
 */

// ─── 核心纯函数层(Step 41.1) ───
export * from './core/types'
export * from './core/units'
export * from './core/mixer'
export * from './core/meter'

// ─── 音频效果链(Step 41.2) ───
export * from './effects/eq'
export * from './effects/compressor'
export * from './effects/reverb'
export * from './effects/gain'
export * from './effects/chain'

// ─── 音频分析(Step 41.6) ───
export * from './analysis/fft'
export * from './analysis/featureExtractor'
export * from './analysis/beatDetector'

// ─── Web Audio 运行时(Step 41.3) ───
export * from './runtime/types'
export * from './runtime/audioEngine'
export * from './runtime/audioGraph'
export * from './runtime/audioSource'
