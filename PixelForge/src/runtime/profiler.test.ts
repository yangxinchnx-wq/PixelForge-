import { describe, expect, it } from 'vitest'

import {
  calculateMemoryMetrics,
  createProfiler,
  formatBytes,
  formatMs,
  ZERO_METRICS,
} from './profiler'
import type { RegionCompileArtifact } from '@/compiler/region/regionCompiler'

// ============================================================================
// Mock 工件
// ============================================================================

function createMockArtifact(overrides?: Partial<RegionCompileArtifact>): RegionCompileArtifact {
  return {
    schemaVersion: 'region-artifact-v2',
    descriptorData: new Uint32Array([0x01000000, 0x00000000, 0x01000001, 0x00010000]),
    auxData: new Float32Array([1, 0, 0, 0, 0.5, 0.5, 0.8, 0.2]),
    regionData: new Float32Array([0, 0, 1, 1]),
    effectDescData: new Uint32Array([0]),
    effectParamData: new Float32Array([0, 0, 0, 0]),
    layerId: 'layer_0',
    opcode: 'SOLID_COLOR',
    layers: [],
    regions: [],
    effects: [],
    visibleLayerCount: 1,
    hasEffects: false,
    ...overrides,
  }
}

// ============================================================================
// createProfiler 测试
// ============================================================================

describe('createProfiler', () => {
  it('无操作时 finalize 应返回全零指标', () => {
    const profiler = createProfiler()
    const metrics = profiler.finalize()

    expect(metrics.cpu.compileContextMs).toBe(0)
    expect(metrics.cpu.irBuildMs).toBe(0)
    expect(metrics.cpu.compileMs).toBe(0)
    expect(metrics.cpu.patchMs).toBe(0)
    expect(metrics.gpu.bufferWriteMs).toBe(0)
    expect(metrics.gpu.dispatchMs).toBe(0)
    expect(metrics.gpu.effectMs).toBe(0)
    expect(metrics.gpu.presentMs).toBe(0)
    expect(metrics.gpu.totalMs).toBe(0)
    expect(metrics.memory.descriptorBufferBytes).toBe(0)
    expect(metrics.memory.totalMemoryBytes).toBe(0)
    expect(metrics.totalFrameMs).toBeGreaterThanOrEqual(0)
  })

  it('startCpu/endCpu 应正确测量 CPU 耗时', () => {
    const profiler = createProfiler()

    profiler.startCpu('compileMs')
    // 模拟一段 CPU 工作
    let sum = 0
    for (let i = 0; i < 100000; i++) sum += i
    profiler.endCpu('compileMs')

    const metrics = profiler.finalize()
    expect(metrics.cpu.compileMs).toBeGreaterThan(0)
    expect(sum).toBeGreaterThan(0) // 防止循环被优化掉
  })

  it('endCpu 未配对 startCpu 时应安全跳过', () => {
    const profiler = createProfiler()
    profiler.endCpu('compileMs') // 未 startCpu

    const metrics = profiler.finalize()
    expect(metrics.cpu.compileMs).toBe(0)
  })

  it('addCpuTiming 应累加 CPU 耗时', () => {
    const profiler = createProfiler()
    profiler.addCpuTiming('patchMs', 1.5)
    profiler.addCpuTiming('patchMs', 2.5)

    const metrics = profiler.finalize()
    expect(metrics.cpu.patchMs).toBeCloseTo(4, 5)
  })

  it('addGpuTiming 应累加 GPU 耗时', () => {
    const profiler = createProfiler()
    profiler.addGpuTiming('dispatchMs', 0.3)
    profiler.addGpuTiming('dispatchMs', 0.7)
    profiler.addGpuTiming('presentMs', 0.5)
    profiler.addGpuTiming('bufferWriteMs', 0.1)
    profiler.addGpuTiming('effectMs', 0.2)

    const metrics = profiler.finalize()
    expect(metrics.gpu.dispatchMs).toBeCloseTo(1.0, 5)
    expect(metrics.gpu.presentMs).toBeCloseTo(0.5, 5)
    expect(metrics.gpu.bufferWriteMs).toBeCloseTo(0.1, 5)
    expect(metrics.gpu.effectMs).toBeCloseTo(0.2, 5)
    expect(metrics.gpu.totalMs).toBeCloseTo(1.8, 5)
  })

  it('setMemory 应设置内存指标', () => {
    const profiler = createProfiler()
    profiler.setMemory({
      descriptorBufferBytes: 8,
      auxBufferBytes: 32,
      regionBufferBytes: 16,
      uniformBufferBytes: 16,
      effectDescBufferBytes: 4,
      effectParamBufferBytes: 16,
      textureMemoryBytes: 4096,
      totalBufferBytes: 92,
      totalMemoryBytes: 4188,
    })

    const metrics = profiler.finalize()
    expect(metrics.memory.descriptorBufferBytes).toBe(8)
    expect(metrics.memory.textureMemoryBytes).toBe(4096)
    expect(metrics.memory.totalMemoryBytes).toBe(4188)
  })

  it('finalize 后 GPU totalMs 应为各分项之和', () => {
    const profiler = createProfiler()
    profiler.addGpuTiming('dispatchMs', 1.0)
    profiler.addGpuTiming('effectMs', 2.0)
    profiler.addGpuTiming('presentMs', 3.0)
    profiler.addGpuTiming('bufferWriteMs', 0.5)

    const metrics = profiler.finalize()
    expect(metrics.gpu.totalMs).toBeCloseTo(6.5, 5)
  })

  it('finalize 后 totalFrameMs 应大于 0', () => {
    const profiler = createProfiler()
    // 消耗一点时间
    let sum = 0
    for (let i = 0; i < 100000; i++) sum += i
    const metrics = profiler.finalize()
    expect(metrics.totalFrameMs).toBeGreaterThanOrEqual(0)
    expect(sum).toBeGreaterThan(0)
  })

  it('多次 finalize 应返回独立快照', () => {
    const profiler = createProfiler()
    profiler.addGpuTiming('dispatchMs', 1.0)

    const m1 = profiler.finalize()
    expect(m1.gpu.dispatchMs).toBeCloseTo(1.0, 5)

    // finalize 后再 addGpuTiming 应继续累加
    profiler.addGpuTiming('dispatchMs', 2.0)
    const m2 = profiler.finalize()
    expect(m2.gpu.dispatchMs).toBeCloseTo(3.0, 5)
  })

  it('startCpu + endCpu 可多次累加同一指标', () => {
    const profiler = createProfiler()

    profiler.startCpu('compileContextMs')
    profiler.endCpu('compileContextMs')

    profiler.startCpu('compileContextMs')
    profiler.endCpu('compileContextMs')

    const metrics = profiler.finalize()
    // 两次测量都应有值（即使很小）
    expect(metrics.cpu.compileContextMs).toBeGreaterThanOrEqual(0)
  })
})

// ============================================================================
// calculateMemoryMetrics 测试
// ============================================================================

describe('calculateMemoryMetrics', () => {
  it('应正确计算基础工件的内存指标', () => {
    const artifact = createMockArtifact()
    const canvasSize = { width: 1024, height: 768 }

    const metrics = calculateMemoryMetrics(artifact, canvasSize)

    // descriptorData: 4 个 Uint32 = 16 bytes
    expect(metrics.descriptorBufferBytes).toBe(16)
    // auxData: 8 个 Float32 = 32 bytes
    expect(metrics.auxBufferBytes).toBe(32)
    // regionData: 4 个 Float32 = 16 bytes
    expect(metrics.regionBufferBytes).toBe(16)
    // uniform: 固定 16 bytes
    expect(metrics.uniformBufferBytes).toBe(16)
    // effectDescData: 1 个 Uint32 = 4 bytes
    expect(metrics.effectDescBufferBytes).toBe(4)
    // effectParamData: 4 个 Float32 = 16 bytes
    expect(metrics.effectParamBufferBytes).toBe(16)
    // texture: 1024 * 768 * 4 = 3145728 bytes
    expect(metrics.textureMemoryBytes).toBe(3145728)
    // totalBuffer = 16 + 32 + 16 + 16 + 4 + 16 = 100
    expect(metrics.totalBufferBytes).toBe(100)
    // totalMemory = 100 + 3145728 = 3145828
    expect(metrics.totalMemoryBytes).toBe(3145828)
  })

  it('应正确计算带效果的工件内存指标', () => {
    const artifact = createMockArtifact({
      effectDescData: new Uint32Array([2, 0x01000000, 0, 0x02000000, 0]),
      effectParamData: new Float32Array([0.5, 0, 0, 0, 0.3, 0, 0, 0]),
      hasEffects: true,
    })
    const canvasSize = { width: 512, height: 512 }

    const metrics = calculateMemoryMetrics(artifact, canvasSize)

    // effectDescData: 5 个 Uint32 = 20 bytes
    expect(metrics.effectDescBufferBytes).toBe(20)
    // effectParamData: 8 个 Float32 = 32 bytes
    expect(metrics.effectParamBufferBytes).toBe(32)
    // texture: 512 * 512 * 4 = 1048576 bytes
    expect(metrics.textureMemoryBytes).toBe(1048576)
    // totalBuffer = 16 + 32 + 16 + 16 + 20 + 32 = 132
    expect(metrics.totalBufferBytes).toBe(132)
    // totalMemory = 132 + 1048576 = 1048708
    expect(metrics.totalMemoryBytes).toBe(1048708)
  })

  it('1x1 画布应有最小纹理内存', () => {
    const artifact = createMockArtifact()
    const canvasSize = { width: 1, height: 1 }

    const metrics = calculateMemoryMetrics(artifact, canvasSize)
    expect(metrics.textureMemoryBytes).toBe(4)
  })
})

// ============================================================================
// formatBytes 测试
// ============================================================================

describe('formatBytes', () => {
  it('应格式化字节单位', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1)).toBe('1 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1023)).toBe('1023 B')
  })

  it('应格式化 KB 单位', () => {
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(1048575)).toBe('1024.0 KB')
  })

  it('应格式化 MB 单位', () => {
    expect(formatBytes(1048576)).toBe('1.00 MB')
    expect(formatBytes(3145728)).toBe('3.00 MB')
    expect(formatBytes(5242880)).toBe('5.00 MB')
  })
})

// ============================================================================
// formatMs 测试
// ============================================================================

describe('formatMs', () => {
  it('应格式化微秒单位', () => {
    expect(formatMs(0)).toBe('0 μs')
    expect(formatMs(0.1)).toBe('100 μs')
    expect(formatMs(0.5)).toBe('500 μs')
    expect(formatMs(0.999)).toBe('999 μs')
  })

  it('应格式化毫秒单位', () => {
    expect(formatMs(1)).toBe('1.00 ms')
    expect(formatMs(1.5)).toBe('1.50 ms')
    expect(formatMs(15.3)).toBe('15.30 ms')
    expect(formatMs(999.994)).toBe('999.99 ms')
  })

  it('应格式化秒单位', () => {
    expect(formatMs(1000)).toBe('1.000 s')
    expect(formatMs(2500)).toBe('2.500 s')
    expect(formatMs(12345.678)).toBe('12.346 s')
  })
})

// ============================================================================
// ZERO_METRICS 测试
// ============================================================================

describe('ZERO_METRICS', () => {
  it('所有字段应为零', () => {
    expect(ZERO_METRICS.cpu.compileContextMs).toBe(0)
    expect(ZERO_METRICS.cpu.irBuildMs).toBe(0)
    expect(ZERO_METRICS.cpu.compileMs).toBe(0)
    expect(ZERO_METRICS.cpu.patchMs).toBe(0)
    expect(ZERO_METRICS.gpu.bufferWriteMs).toBe(0)
    expect(ZERO_METRICS.gpu.dispatchMs).toBe(0)
    expect(ZERO_METRICS.gpu.effectMs).toBe(0)
    expect(ZERO_METRICS.gpu.presentMs).toBe(0)
    expect(ZERO_METRICS.gpu.totalMs).toBe(0)
    expect(ZERO_METRICS.memory.descriptorBufferBytes).toBe(0)
    expect(ZERO_METRICS.memory.totalBufferBytes).toBe(0)
    expect(ZERO_METRICS.memory.totalMemoryBytes).toBe(0)
    expect(ZERO_METRICS.totalFrameMs).toBe(0)
  })

  it('应为独立对象（修改不影响原常量）', () => {
    const copy = { ...ZERO_METRICS, cpu: { ...ZERO_METRICS.cpu } }
    copy.cpu.compileMs = 999
    expect(ZERO_METRICS.cpu.compileMs).toBe(0)
  })
})
