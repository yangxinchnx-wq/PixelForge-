import { describe, expect, it } from 'vitest'

import {
  classifyError,
  createReplayError,
  createRuntimeError,
  getErrorCodeLabel,
  getSeverityLabel,
} from '@/shared/errors'

// ============================================================================
// createRuntimeError 测试
// ============================================================================

describe('createRuntimeError', () => {
  it('应创建带完整诊断字段的结构化错误', () => {
    const error = createRuntimeError('runtime/webgpu-unavailable', 'WebGPU 不可用')

    expect(error.code).toBe('runtime/webgpu-unavailable')
    expect(error.message).toBe('WebGPU 不可用')
    expect(error.severity).toBe('fatal')
    expect(error.source).toBe('device-init')
    expect(error.recoverable).toBe(false)
    expect(error.timestamp).toBeGreaterThan(0)
    expect(error).toBeInstanceOf(Error)
  })

  it('编译错误应映射为 error 严重等级和 compile 来源', () => {
    const error = createRuntimeError('runtime/compile-error', '不支持的 opcode')

    expect(error.severity).toBe('error')
    expect(error.source).toBe('compile')
    expect(error.recoverable).toBe(true)
  })

  it('持久化错误应映射为 warning 严重等级', () => {
    const error = createRuntimeError('runtime/persistence-failed', 'IndexedDB 写入失败')

    expect(error.severity).toBe('warning')
    expect(error.source).toBe('persistence')
    expect(error.recoverable).toBe(true)
  })

  it('GPU 设备丢失应为 fatal 且不可恢复', () => {
    const error = createRuntimeError('runtime/gpu-device-lost', '设备已丢失')

    expect(error.severity).toBe('fatal')
    expect(error.recoverable).toBe(false)
  })
})

// ============================================================================
// createReplayError 测试
// ============================================================================

describe('createReplayError', () => {
  it('应创建带完整诊断字段的回放错误', () => {
    const error = createReplayError('replay/signature-mismatch', '签名不一致')

    expect(error.code).toBe('replay/signature-mismatch')
    expect(error.message).toBe('签名不一致')
    expect(error.severity).toBe('error')
    expect(error.source).toBe('replay')
    expect(error.recoverable).toBe(true)
    expect(error.timestamp).toBeGreaterThan(0)
  })

  it('运行时不可用回放错误应为 fatal', () => {
    const error = createReplayError('replay/runtime-unavailable', '运行时不可用')

    expect(error.severity).toBe('fatal')
    expect(error.recoverable).toBe(true)
  })
})

// ============================================================================
// classifyError 测试
// ============================================================================

describe('classifyError', () => {
  it('已是结构化错误时应直接返回', () => {
    const original = createRuntimeError('runtime/shader-compilation-failed', '着色器编译失败')

    const classified = classifyError(original)

    expect(classified.code).toBe('runtime/shader-compilation-failed')
    expect(classified.severity).toBe('error')
  })

  it('编译错误消息应匹配为 compile-error', () => {
    const error = new Error('RenderIR does not contain any visible layer for rendering')

    const classified = classifyError(error)

    expect(classified.code).toBe('runtime/compile-error')
    expect(classified.source).toBe('compile')
  })

  it('不支持 opcode 错误消息应匹配为 compile-error', () => {
    const error = new Error('Unsupported opcode: SOMETHING')

    const classified = classifyError(error)

    expect(classified.code).toBe('runtime/compile-error')
  })

  it('WebGPU 不可用错误消息应匹配为 webgpu-unavailable', () => {
    const error = new Error('WebGPU is unavailable in this environment')

    const classified = classifyError(error)

    expect(classified.code).toBe('runtime/webgpu-unavailable')
    expect(classified.severity).toBe('fatal')
  })

  it('着色器编译错误消息应匹配为 shader-compilation-failed', () => {
    const error = new Error('Shader compilation error in region_eval.wgsl')

    const classified = classifyError(error)

    expect(classified.code).toBe('runtime/shader-compilation-failed')
  })

  it('GPU 设备丢失错误消息应匹配为 gpu-device-lost', () => {
    const error = new Error('GPU device lost during rendering')

    const classified = classifyError(error)

    expect(classified.code).toBe('runtime/gpu-device-lost')
    expect(classified.severity).toBe('fatal')
    expect(classified.recoverable).toBe(false)
  })

  it('未知错误应归类为 runtime/unknown', () => {
    const error = new Error('一些无法分类的错误消息')

    const classified = classifyError(error)

    expect(classified.code).toBe('runtime/unknown')
    expect(classified.severity).toBe('error')
  })

  it('非 Error 对象应归类为 runtime/unknown', () => {
    const classified = classifyError('just a string')

    expect(classified.code).toBe('runtime/unknown')
    expect(classified.message).toBe('just a string')
  })

  it('应支持指定默认来源', () => {
    const error = new Error('Some error')
    const classified = classifyError(error, 'patch')

    expect(classified.source).toBe('patch')
  })

  it('结构化错误传入 defaultSource 不应覆盖原有 source', () => {
    const original = createRuntimeError('runtime/compile-error', '编译错误')
    const classified = classifyError(original, 'render')

    // 原有 source（compile）不应被覆盖
    expect(classified.source).toBe('compile')
  })
})

// ============================================================================
// 标签函数测试
// ============================================================================

describe('getErrorCodeLabel', () => {
  it('应返回错误码的人类可读名称', () => {
    expect(getErrorCodeLabel('runtime/webgpu-unavailable')).toBe('WebGPU 不可用')
    expect(getErrorCodeLabel('runtime/compile-error')).toBe('编译错误')
    expect(getErrorCodeLabel('runtime/gpu-device-lost')).toBe('GPU 设备丢失')
    expect(getErrorCodeLabel('replay/signature-mismatch')).toBe('回放签名不一致')
  })

  it('未知错误码应返回原始码', () => {
    expect(getErrorCodeLabel('unknown/code')).toBe('unknown/code')
  })
})

describe('getSeverityLabel', () => {
  it('应返回严重等级的人类可读名称', () => {
    expect(getSeverityLabel('fatal')).toBe('致命')
    expect(getSeverityLabel('error')).toBe('错误')
    expect(getSeverityLabel('warning')).toBe('警告')
    expect(getSeverityLabel('info')).toBe('信息')
  })
})
