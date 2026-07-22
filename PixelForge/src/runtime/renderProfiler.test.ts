/**
 * 渲染性能 Profiler Tests(Step 39.1)
 *
 * 测试策略:
 * - 性能等级判定:judgeLevel(4 级阈值)
 * - 帧采样构造:createFrameSample(从 PerformanceMetrics → FrameSample)
 * - 环形缓冲区:FrameSampleRingBuffer(push/getAll/getRecent/getLatest/clear/容量)
 * - 统计计算:computeStats(平均/P50/P95/P99/min/max/overBudget/level)
 * - 格式化:formatMs/formatBytes/formatFps
 */
import { describe, it, expect } from 'vitest'
import {
  judgeLevel,
  createFrameSample,
  FrameSampleRingBuffer,
  computeStats,
  formatMs,
  formatBytes,
  formatFps,
  LEVEL_LABELS,
  LEVEL_COLORS,
  BUDGET_60FPS_MS,
  DEFAULT_BUFFER_SIZE,
} from './renderProfiler'
import type { PerformanceMetrics } from './profiler'
import { ZERO_METRICS } from './profiler'

// ============================================================================
// 辅助函数
// ============================================================================

/** 创建测试用 PerformanceMetrics */
function makeMetrics(overrides: Partial<PerformanceMetrics> = {}): PerformanceMetrics {
  return {
    cpu: { ...ZERO_METRICS.cpu, ...overrides.cpu },
    gpu: { ...ZERO_METRICS.gpu, ...overrides.gpu },
    memory: { ...ZERO_METRICS.memory, ...overrides.memory },
    totalFrameMs: overrides.totalFrameMs ?? 10,
  }
}

/** 创建指定帧时间的 metrics */
function metricsWithFrameMs(frameMs: number): PerformanceMetrics {
  return makeMetrics({
    totalFrameMs: frameMs,
    cpu: { compileMs: frameMs * 0.3, irBuildMs: 0, patchMs: 0, compileContextMs: 0 },
    gpu: { totalMs: frameMs * 0.5, dispatchMs: frameMs * 0.3, presentMs: frameMs * 0.1, bufferWriteMs: frameMs * 0.1, effectMs: 0 },
    memory: { ...ZERO_METRICS.memory, totalMemoryBytes: 4 * 1024 * 1024, totalBufferBytes: 1024, textureMemoryBytes: 4 * 1024 * 1024 },
  })
}

// ============================================================================
// 测试
// ============================================================================

describe('渲染性能 Profiler', () => {
  // ==========================================================================
  // 性能等级判定
  // ==========================================================================
  describe('judgeLevel', () => {
    it('L01: ≤ 16.67ms 应为 good', () => {
      expect(judgeLevel(10)).toBe('good')
      expect(judgeLevel(16.67)).toBe('good')
    })

    it('L02: 16.67-25ms 应为 ok', () => {
      expect(judgeLevel(20)).toBe('ok')
      expect(judgeLevel(25)).toBe('ok')
    })

    it('L03: 25-33.33ms 应为 warn', () => {
      expect(judgeLevel(30)).toBe('warn')
      expect(judgeLevel(33.33)).toBe('warn')
    })

    it('L04: > 33.33ms 应为 bad', () => {
      expect(judgeLevel(40)).toBe('bad')
      expect(judgeLevel(100)).toBe('bad')
    })

    it('L05: LEVEL_LABELS 应有 4 个中文标签', () => {
      expect(Object.keys(LEVEL_LABELS)).toHaveLength(4)
      expect(LEVEL_LABELS.good).toBe('优秀')
      expect(LEVEL_LABELS.bad).toBe('糟糕')
    })

    it('L06: LEVEL_COLORS 应有 4 个颜色', () => {
      expect(Object.keys(LEVEL_COLORS)).toHaveLength(4)
    })
  })

  // ==========================================================================
  // 帧采样构造
  // ==========================================================================
  describe('createFrameSample', () => {
    it('S01: 应正确提取帧时间', () => {
      const m = metricsWithFrameMs(15)
      const sample = createFrameSample(m, 0)
      expect(sample.frameMs).toBe(15)
    })

    it('S02: 应正确计算 FPS', () => {
      const m = metricsWithFrameMs(16.67)
      const sample = createFrameSample(m, 0)
      expect(sample.fps).toBeCloseTo(60, 0)
    })

    it('S03: 应正确提取 CPU 时间', () => {
      const m = makeMetrics({
        totalFrameMs: 20,
        cpu: { compileMs: 3, irBuildMs: 2, patchMs: 1, compileContextMs: 0 },
      })
      const sample = createFrameSample(m, 0)
      expect(sample.cpuMs).toBe(6) // compile(3) + irBuild(2) + patch(1)
    })

    it('S04: 应正确提取 GPU 时间', () => {
      const m = makeMetrics({
        totalFrameMs: 20,
        gpu: { totalMs: 10, dispatchMs: 4, presentMs: 2, bufferWriteMs: 3, effectMs: 1 },
      })
      const sample = createFrameSample(m, 0)
      expect(sample.gpuMs).toBe(6) // dispatch(4) + present(2)
      expect(sample.gpuTotalMs).toBe(10)
    })

    it('S05: 应正确提取内存', () => {
      const m = makeMetrics({
        totalFrameMs: 10,
        memory: { ...ZERO_METRICS.memory, totalMemoryBytes: 8388608, totalBufferBytes: 1048576, textureMemoryBytes: 7340032 },
      })
      const sample = createFrameSample(m, 0)
      expect(sample.memoryBytes).toBe(8388608)
      expect(sample.bufferBytes).toBe(1048576)
      expect(sample.textureBytes).toBe(7340032)
    })

    it('S06: 帧时间超预算应标记 overBudget', () => {
      const m = metricsWithFrameMs(20)
      const sample = createFrameSample(m, 0)
      expect(sample.overBudget).toBe(true)
    })

    it('S07: 帧时间在预算内应标记 !overBudget', () => {
      const m = metricsWithFrameMs(10)
      const sample = createFrameSample(m, 0)
      expect(sample.overBudget).toBe(false)
    })

    it('S08: 性能等级应与帧时间匹配', () => {
      expect(createFrameSample(metricsWithFrameMs(10), 0).level).toBe('good')
      expect(createFrameSample(metricsWithFrameMs(20), 0).level).toBe('ok')
      expect(createFrameSample(metricsWithFrameMs(30), 0).level).toBe('warn')
      expect(createFrameSample(metricsWithFrameMs(50), 0).level).toBe('bad')
    })

    it('S09: 应携带帧序号', () => {
      const sample = createFrameSample(makeMetrics(), 42)
      expect(sample.frameIndex).toBe(42)
    })

    it('S10: gpuResourceCount 默认应为 null', () => {
      const sample = createFrameSample(makeMetrics(), 0)
      expect(sample.gpuResourceCount).toBeNull()
    })

    it('S11: gpuResourceCount 可显式传入', () => {
      const sample = createFrameSample(makeMetrics(), 0, undefined, 15)
      expect(sample.gpuResourceCount).toBe(15)
    })
  })

  // ==========================================================================
  // 环形缓冲区
  // ==========================================================================
  describe('FrameSampleRingBuffer', () => {
    it('R01: 新建缓冲区应为空', () => {
      const buf = new FrameSampleRingBuffer(10)
      expect(buf.size()).toBe(0)
      expect(buf.getLatest()).toBeNull()
    })

    it('R02: push 应增加帧数', () => {
      const buf = new FrameSampleRingBuffer(10)
      buf.push(makeMetrics())
      buf.push(makeMetrics())
      expect(buf.size()).toBe(2)
    })

    it('R03: 超容量时最旧帧应被移除', () => {
      const buf = new FrameSampleRingBuffer(3)
      buf.push(makeMetrics({ totalFrameMs: 1 }))
      buf.push(makeMetrics({ totalFrameMs: 2 }))
      buf.push(makeMetrics({ totalFrameMs: 3 }))
      buf.push(makeMetrics({ totalFrameMs: 4 })) // 应移除 frameMs=1
      expect(buf.size()).toBe(3)
      const all = buf.getAll()
      expect(all[0].frameMs).toBe(2)
      expect(all[2].frameMs).toBe(4)
    })

    it('R04: getLatest 应返回最新帧', () => {
      const buf = new FrameSampleRingBuffer(10)
      buf.push(makeMetrics({ totalFrameMs: 5 }))
      buf.push(makeMetrics({ totalFrameMs: 10 }))
      const latest = buf.getLatest()
      expect(latest).not.toBeNull()
      expect(latest!.frameMs).toBe(10)
    })

    it('R05: getRecent(N) 应返回最近 N 帧', () => {
      const buf = new FrameSampleRingBuffer(10)
      for (let i = 0; i < 5; i++) {
        buf.push(makeMetrics({ totalFrameMs: i + 1 }))
      }
      const recent = buf.getRecent(3)
      expect(recent).toHaveLength(3)
      expect(recent[0].frameMs).toBe(3)
      expect(recent[2].frameMs).toBe(5)
    })

    it('R06: getRecent 超过帧数应返回全部', () => {
      const buf = new FrameSampleRingBuffer(10)
      buf.push(makeMetrics())
      const recent = buf.getRecent(10)
      expect(recent).toHaveLength(1)
    })

    it('R07: getAll 应返回副本(修改不影响原缓冲区)', () => {
      const buf = new FrameSampleRingBuffer(10)
      buf.push(makeMetrics())
      const all = buf.getAll()
      all.pop()
      expect(buf.size()).toBe(1)
    })

    it('R08: clear 应清空缓冲区', () => {
      const buf = new FrameSampleRingBuffer(10)
      buf.push(makeMetrics())
      buf.push(makeMetrics())
      buf.clear()
      expect(buf.size()).toBe(0)
    })

    it('R09: 帧序号应递增', () => {
      const buf = new FrameSampleRingBuffer(10)
      buf.push(makeMetrics())
      buf.push(makeMetrics())
      const all = buf.getAll()
      expect(all[0].frameIndex).toBe(0)
      expect(all[1].frameIndex).toBe(1)
    })

    it('R10: clear 后帧序号应重置', () => {
      const buf = new FrameSampleRingBuffer(10)
      buf.push(makeMetrics())
      buf.clear()
      buf.push(makeMetrics())
      expect(buf.getLatest()!.frameIndex).toBe(0)
    })

    it('R11: 默认容量应为 DEFAULT_BUFFER_SIZE', () => {
      const buf = new FrameSampleRingBuffer()
      expect(buf.getCapacity()).toBe(DEFAULT_BUFFER_SIZE)
    })

    it('R12: pushSample 应支持直接推入帧采样', () => {
      const buf = new FrameSampleRingBuffer(10)
      const sample = createFrameSample(makeMetrics(), 99)
      buf.pushSample(sample)
      expect(buf.size()).toBe(1)
      expect(buf.getLatest()!.frameIndex).toBe(99)
    })

    it('R13: 容量为 1 应正常工作', () => {
      const buf = new FrameSampleRingBuffer(1)
      buf.push(makeMetrics({ totalFrameMs: 1 }))
      buf.push(makeMetrics({ totalFrameMs: 2 }))
      expect(buf.size()).toBe(1)
      expect(buf.getLatest()!.frameMs).toBe(2)
    })
  })

  // ==========================================================================
  // 统计计算
  // ==========================================================================
  describe('computeStats', () => {
    it('ST01: 空列表应返回零值统计', () => {
      const stats = computeStats([])
      expect(stats.count).toBe(0)
      expect(stats.avgFrameMs).toBe(0)
      expect(stats.overallLevel).toBe('bad')
    })

    it('ST02: 单帧应正确计算', () => {
      const buf = new FrameSampleRingBuffer(10)
      buf.push(metricsWithFrameMs(10))
      const stats = computeStats(buf.getAll())
      expect(stats.count).toBe(1)
      expect(stats.avgFrameMs).toBe(10)
      expect(stats.minFrameMs).toBe(10)
      expect(stats.maxFrameMs).toBe(10)
    })

    it('ST03: 多帧应正确计算平均值', () => {
      const buf = new FrameSampleRingBuffer(10)
      buf.push(metricsWithFrameMs(10))
      buf.push(metricsWithFrameMs(20))
      buf.push(metricsWithFrameMs(30))
      const stats = computeStats(buf.getAll())
      expect(stats.avgFrameMs).toBeCloseTo(20, 1)
    })

    it('ST04: P50 应为中位数', () => {
      const buf = new FrameSampleRingBuffer(10)
      buf.push(metricsWithFrameMs(10))
      buf.push(metricsWithFrameMs(20))
      buf.push(metricsWithFrameMs(30))
      const stats = computeStats(buf.getAll())
      expect(stats.p50FrameMs).toBe(20)
    })

    it('ST05: overBudgetCount 应正确统计', () => {
      const buf = new FrameSampleRingBuffer(10)
      buf.push(metricsWithFrameMs(10)) // !overBudget
      buf.push(metricsWithFrameMs(20)) // overBudget
      buf.push(metricsWithFrameMs(30)) // overBudget
      const stats = computeStats(buf.getAll())
      expect(stats.overBudgetCount).toBe(2)
      expect(stats.overBudgetRatio).toBeCloseTo(0.667, 1)
    })

    it('ST06: overallLevel 应基于 P95 判定', () => {
      const buf = new FrameSampleRingBuffer(100)
      // 5 帧 good + 15 帧 bad(超过 33.33ms)
      for (let i = 0; i < 5; i++) buf.push(metricsWithFrameMs(10))
      for (let i = 0; i < 15; i++) buf.push(metricsWithFrameMs(50))
      const stats = computeStats(buf.getAll())
      // P95 应为 50ms,bad
      expect(stats.overallLevel).toBe('bad')
    })

    it('ST07: 全 good 帧的 overallLevel 应为 good', () => {
      const buf = new FrameSampleRingBuffer(100)
      for (let i = 0; i < 20; i++) buf.push(metricsWithFrameMs(10))
      const stats = computeStats(buf.getAll())
      expect(stats.overallLevel).toBe('good')
    })

    it('ST08: avgFps 应正确计算', () => {
      const buf = new FrameSampleRingBuffer(10)
      buf.push(metricsWithFrameMs(10)) // 100 FPS
      buf.push(metricsWithFrameMs(20)) // 50 FPS
      const stats = computeStats(buf.getAll())
      expect(stats.avgFps).toBeCloseTo(75, 0)
    })

    it('ST09: avgMemoryMb 应正确计算', () => {
      const buf = new FrameSampleRingBuffer(10)
      buf.push(metricsWithFrameMs(10))
      const stats = computeStats(buf.getAll())
      expect(stats.avgMemoryMb).toBeCloseTo(4, 0) // 4MB
    })

    it('ST10: min/max 应正确', () => {
      const buf = new FrameSampleRingBuffer(10)
      buf.push(metricsWithFrameMs(5))
      buf.push(metricsWithFrameMs(50))
      buf.push(metricsWithFrameMs(15))
      const stats = computeStats(buf.getAll())
      expect(stats.minFrameMs).toBe(5)
      expect(stats.maxFrameMs).toBe(50)
    })
  })

  // ==========================================================================
  // 格式化
  // ==========================================================================
  describe('格式化', () => {
    it('F01: formatMs 应保留 1 位小数', () => {
      expect(formatMs(3.14159)).toBe('3.1 ms')
      expect(formatMs(0)).toBe('0.0 ms')
    })

    it('F02: formatBytes 应自动选择单位', () => {
      expect(formatBytes(500)).toBe('500 B')
      expect(formatBytes(1024)).toBe('1.0 KB')
      expect(formatBytes(1048576)).toBe('1.0 MB')
      expect(formatBytes(8388608)).toBe('8.0 MB')
    })

    it('F03: formatFps 应取整', () => {
      expect(formatFps(59.7)).toBe('60 FPS')
      expect(formatFps(29.4)).toBe('29 FPS')
    })
  })

  // ==========================================================================
  // 常量
  // ==========================================================================
  describe('常量', () => {
    it('C01: BUDGET_60FPS_MS 应为 16.67', () => {
      expect(BUDGET_60FPS_MS).toBe(16.67)
    })

    it('C02: DEFAULT_BUFFER_SIZE 应为 240', () => {
      expect(DEFAULT_BUFFER_SIZE).toBe(240)
    })
  })
})
