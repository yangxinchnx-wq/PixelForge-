import { describe, expect, it } from 'vitest'

import { createAudioEngine } from '@/audio/runtime/audioEngine'
import { FakeAudioContext } from '@/audio/runtime/fakeAudioContext'
import type { AudioContextLike } from '@/audio/runtime/types'

/** 永不返回上下文的工厂(模拟环境不支持) */
const nullFactory = (): AudioContextLike | null => null

/** 抛异常的工厂 */
const throwingFactory = (): AudioContextLike | null => {
  throw new Error('no web audio')
}

// ============================================================================
// 初始化测试
// ============================================================================

describe('createAudioEngine 初始化', () => {
  it('未初始化时状态应为 uninitialized 且上下文为 null', async () => {
    const ctx = new FakeAudioContext()
    const engine = createAudioEngine(() => ctx)
    expect(engine.state).toBe('uninitialized')
    expect(engine.context).toBeNull()
  })

  it('init 后应持有上下文', async () => {
    const ctx = new FakeAudioContext({ initialState: 'running' })
    const engine = createAudioEngine(() => ctx)
    await engine.init()
    expect(engine.context).toBe(ctx)
  })

  it('上下文初始为 running 时应直接进入 running 且不需要手势', async () => {
    const ctx = new FakeAudioContext({ initialState: 'running' })
    const engine = createAudioEngine(() => ctx)
    await engine.init()
    expect(engine.state).toBe('running')
    expect(engine.needsUserGesture).toBe(false)
  })

  it('上下文初始为 suspended 时应尝试 resume', async () => {
    const ctx = new FakeAudioContext({ initialState: 'suspended' })
    const engine = createAudioEngine(() => ctx)
    await engine.init()
    expect(ctx.resumeCount).toBe(1)
    expect(engine.state).toBe('running')
  })

  it('init 应幂等,重复调用不创建新上下文', async () => {
    let created = 0
    const engine = createAudioEngine(() => {
      created++
      return new FakeAudioContext({ initialState: 'running' })
    })
    await engine.init()
    await engine.init()
    await engine.init()
    expect(created).toBe(1)
  })

  it('并发 init 应共享同一次初始化', async () => {
    let created = 0
    const engine = createAudioEngine(() => {
      created++
      return new FakeAudioContext({ initialState: 'running' })
    })
    await Promise.all([engine.init(), engine.init(), engine.init()])
    expect(created).toBe(1)
  })
})

// ============================================================================
// 自动播放策略测试
// ============================================================================

describe('自动播放策略', () => {
  it('resume 被拒绝时应标记需要用户手势', async () => {
    const ctx = new FakeAudioContext({
      initialState: 'suspended',
      resumeSucceeds: false,
    })
    const engine = createAudioEngine(() => ctx)
    await engine.init()
    expect(engine.needsUserGesture).toBe(true)
    expect(engine.state).toBe('suspended')
  })

  it('resume 成功但未切换状态时仍应标记需要手势', async () => {
    const ctx = new FakeAudioContext({
      initialState: 'suspended',
      resumeTransitions: false,
    })
    const engine = createAudioEngine(() => ctx)
    await engine.init()
    expect(engine.needsUserGesture).toBe(true)
  })

  it('用户手势后再次 resume 应转为 running', async () => {
    const ctx = new FakeAudioContext({
      initialState: 'suspended',
      resumeSucceeds: false,
    })
    const engine = createAudioEngine(() => ctx)
    await engine.init()
    expect(engine.needsUserGesture).toBe(true)

    // 模拟用户手势:上下文恢复可用
    ctx.setState('suspended')
    ctx.resumeSucceeds = true
    const ok = await engine.resume()
    expect(ok).toBe(true)
    expect(engine.needsUserGesture).toBe(false)
    expect(engine.state).toBe('running')
  })

  it('resume 在未初始化时应自动先 init', async () => {
    const ctx = new FakeAudioContext({ initialState: 'running' })
    const engine = createAudioEngine(() => ctx)
    const ok = await engine.resume()
    expect(ok).toBe(true)
    expect(engine.context).toBe(ctx)
  })
})

// ============================================================================
// 环境不支持时的降级测试
// ============================================================================

describe('环境不支持时降级', () => {
  it('工厂返回 null 时 init 应返回 false', async () => {
    const engine = createAudioEngine(nullFactory)
    const ok = await engine.init()
    expect(ok).toBe(false)
    expect(engine.context).toBeNull()
    expect(engine.state).toBe('uninitialized')
  })

  it('工厂抛异常时 init 应返回 false 而不是崩溃', async () => {
    const engine = createAudioEngine(throwingFactory)
    const ok = await engine.init()
    expect(ok).toBe(false)
  })

  it('不支持时 isSupported 应为 false', () => {
    expect(createAudioEngine(nullFactory).isSupported()).toBe(false)
    expect(createAudioEngine(throwingFactory).isSupported()).toBe(false)
  })

  it('支持时 isSupported 应为 true', () => {
    expect(createAudioEngine(() => new FakeAudioContext()).isSupported()).toBe(true)
  })

  it('探测用的临时上下文应被立即关闭(不占用浏览器 AudioContext 配额)', () => {
    const ctx = new FakeAudioContext()
    const engine = createAudioEngine(() => ctx)
    expect(engine.isSupported()).toBe(true)
    expect(ctx.closeCount).toBe(1)
  })

  it('已初始化后调用 isSupported 不应再创建或关闭上下文', async () => {
    const ctx = new FakeAudioContext({ initialState: 'running' })
    const engine = createAudioEngine(() => ctx)
    await engine.init()
    expect(engine.isSupported()).toBe(true)
    expect(ctx.closeCount).toBe(0)
  })

  it('不支持时 resume 应返回 false', async () => {
    expect(await createAudioEngine(nullFactory).resume()).toBe(false)
  })

  it('不支持时 suspend 应返回 false', async () => {
    expect(await createAudioEngine(nullFactory).suspend()).toBe(false)
  })

  it('不支持时 getSampleRate 应返回 0', () => {
    expect(createAudioEngine(nullFactory).getSampleRate()).toBe(0)
  })

  it('不支持时 getCurrentTime 应返回 0', () => {
    expect(createAudioEngine(nullFactory).getCurrentTime()).toBe(0)
  })

  it('不支持时 close 不应抛异常', async () => {
    const engine = createAudioEngine(nullFactory)
    await expect(engine.close()).resolves.toBeUndefined()
    expect(engine.state).toBe('closed')
  })
})

// ============================================================================
// suspend / close 测试
// ============================================================================

describe('suspend 与 close', () => {
  it('suspend 应切换状态并计入调用次数', async () => {
    const ctx = new FakeAudioContext({ initialState: 'running' })
    const engine = createAudioEngine(() => ctx)
    await engine.init()
    const ok = await engine.suspend()
    expect(ok).toBe(true)
    expect(ctx.suspendCount).toBe(1)
    expect(engine.state).toBe('suspended')
  })

  it('close 后状态应为 closed 且上下文被释放', async () => {
    const ctx = new FakeAudioContext({ initialState: 'running' })
    const engine = createAudioEngine(() => ctx)
    await engine.init()
    await engine.close()
    expect(engine.state).toBe('closed')
    expect(engine.context).toBeNull()
    expect(ctx.closeCount).toBe(1)
  })

  it('close 后再次 init 不应复活', async () => {
    const ctx = new FakeAudioContext({ initialState: 'running' })
    const engine = createAudioEngine(() => ctx)
    await engine.init()
    await engine.close()
    const ok = await engine.init()
    expect(ok).toBe(false)
    expect(engine.context).toBeNull()
  })
})

// ============================================================================
// 只读信息测试
// ============================================================================

describe('只读信息', () => {
  it('应暴露采样率', async () => {
    const ctx = new FakeAudioContext({ sampleRate: 44100, initialState: 'running' })
    const engine = createAudioEngine(() => ctx)
    await engine.init()
    expect(engine.getSampleRate()).toBe(44100)
  })

  it('应暴露上下文当前时间', async () => {
    const ctx = new FakeAudioContext({ initialState: 'running' })
    const engine = createAudioEngine(() => ctx)
    await engine.init()
    ctx.advanceTime(2.5)
    expect(engine.getCurrentTime()).toBeCloseTo(2.5, 10)
  })
})
