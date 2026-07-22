/**
 * errorStore.test.ts — 错误状态管理测试。
 *
 * 测试分组:
 *   P: push / PM: pushMessage / PS: pushStructured
 *   D: dismiss / A: acknowledge / C: clear
 *   F: filter / CT: count / L: latest / LRU: 淘汰
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

import { useErrorStore, MAX_ERROR_QUEUE_SIZE, type ErrorEntry } from './errorStore'
import { createRuntimeError } from '@/shared/errors'

describe('errorStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  // ========================================================================
  // 1. push(从 caught 值创建)
  // ========================================================================

  describe('push', () => {
    it('P01: push Error 对象,队列 +1', () => {
      const store = useErrorStore()
      const id = store.push(new Error('test error'))
      expect(store.count).toBe(1)
      expect(id).toBeTruthy()
      expect(store.queue[0].message).toBe('test error')
    })

    it('P02: push 字符串,归一化为 ErrorEntry', () => {
      const store = useErrorStore()
      store.push('string error')
      expect(store.count).toBe(1)
      expect(store.queue[0].message).toContain('string error')
    })

    it('P03: push 未知值,不崩溃', () => {
      const store = useErrorStore()
      store.push({ custom: 'object' })
      expect(store.count).toBe(1)
    })

    it('P04: push 设置 activeError', () => {
      const store = useErrorStore()
      store.push(new Error('active'))
      expect(store.activeError).not.toBeNull()
      expect(store.activeError?.message).toContain('active')
    })

    it('P05: push 带 userHint', () => {
      const store = useErrorStore()
      store.push(new Error('fail'), '请检查配置')
      expect(store.queue[0].userHint).toBe('请检查配置')
    })

    it('P06: push 返回 id', () => {
      const store = useErrorStore()
      const id = store.push(new Error('test'))
      expect(store.queue[0].id).toBe(id)
    })

    it('P07: push 多次,latest 是最后一条', () => {
      const store = useErrorStore()
      store.push(new Error('first'))
      store.push(new Error('second'))
      store.push(new Error('third'))
      expect(store.count).toBe(3)
      expect(store.latest?.message).toContain('third')
    })
  })

  // ========================================================================
  // 2. pushMessage(直接构造)
  // ========================================================================

  describe('pushMessage', () => {
    it('PM01: pushMessage 默认 level=error', () => {
      const store = useErrorStore()
      store.pushMessage('校验失败')
      expect(store.queue[0].level).toBe('error')
      expect(store.queue[0].message).toBe('校验失败')
    })

    it('PM02: pushMessage 指定 level=warning', () => {
      const store = useErrorStore()
      store.pushMessage('警告信息', 'warning')
      expect(store.queue[0].level).toBe('warning')
    })

    it('PM03: pushMessage 指定 level=info', () => {
      const store = useErrorStore()
      store.pushMessage('提示信息', 'info')
      expect(store.queue[0].level).toBe('info')
    })

    it('PM04: pushMessage 带 userHint', () => {
      const store = useErrorStore()
      store.pushMessage('错误', 'error', '请重试')
      expect(store.queue[0].userHint).toBe('请重试')
    })

    it('PM05: pushMessage code 为 ui/user-message', () => {
      const store = useErrorStore()
      store.pushMessage('msg')
      expect(store.queue[0].code).toBe('ui/user-message')
    })

    it('PM06: pushMessage 设置 activeError', () => {
      const store = useErrorStore()
      store.pushMessage('msg')
      expect(store.activeError).not.toBeNull()
    })
  })

  // ========================================================================
  // 3. pushStructured(从 RuntimeErrorInfo)
  // ========================================================================

  describe('pushStructured', () => {
    it('PS01: pushStructured RuntimeErrorInfo', () => {
      const store = useErrorStore()
      const err = createRuntimeError('runtime/webgpu-unavailable', 'WebGPU 不可用')
      const id = store.pushStructured(err)
      expect(store.count).toBe(1)
      expect(id).toBeTruthy()
      expect(store.queue[0].code).toBe('runtime/webgpu-unavailable')
      expect(store.queue[0].message).toBe('WebGPU 不可用')
    })

    it('PS02: pushStructured 保留 severity 映射', () => {
      const store = useErrorStore()
      const err = createRuntimeError('runtime/shader-compilation-failed', 'shader 编译失败')
      store.pushStructured(err)
      // shader-compilation-failed 是 error 级别
      expect(store.queue[0].level).toBe('error')
    })

    it('PS03: pushStructured 保留 source', () => {
      const store = useErrorStore()
      const err = createRuntimeError('runtime/compile-error', '编译错误')
      store.pushStructured(err)
      expect(store.queue[0].source).toBe('compile')
    })
  })

  // ========================================================================
  // 4. dismiss
  // ========================================================================

  describe('dismiss', () => {
    it('D01: dismiss 移除指定错误', () => {
      const store = useErrorStore()
      const id = store.push(new Error('test'))
      store.dismiss(id)
      expect(store.count).toBe(0)
    })

    it('D02: dismiss 不存在的 id 无变化', () => {
      const store = useErrorStore()
      store.push(new Error('test'))
      store.dismiss('nonexistent')
      expect(store.count).toBe(1)
    })

    it('D03: dismiss 当前 activeError 时清除高亮', () => {
      const store = useErrorStore()
      const id = store.push(new Error('active'))
      expect(store.activeError).not.toBeNull()
      store.dismiss(id)
      expect(store.activeError).toBeNull()
    })

    it('D04: dismiss 当前 activeError 后,latest 回退到队列末尾', () => {
      const store = useErrorStore()
      store.push(new Error('first'))
      const id2 = store.push(new Error('second'))
      store.dismiss(id2)
      expect(store.activeError?.message).toContain('first')
    })
  })

  // ========================================================================
  // 5. acknowledge
  // ========================================================================

  describe('acknowledge', () => {
    it('A01: acknowledge 标记为已读', () => {
      const store = useErrorStore()
      const id = store.push(new Error('test'))
      store.acknowledge(id)
      expect(store.queue[0].acknowledged).toBe(true)
    })

    it('A02: acknowledge 减少 unacknowledgedCount', () => {
      const store = useErrorStore()
      const id = store.push(new Error('test'))
      expect(store.unacknowledgedCount).toBe(1)
      store.acknowledge(id)
      expect(store.unacknowledgedCount).toBe(0)
    })

    it('A03: acknowledge 清除 activeError 高亮', () => {
      const store = useErrorStore()
      const id = store.push(new Error('test'))
      store.acknowledge(id)
      expect(store.activeError).toBeNull()
    })

    it('A04: acknowledge 不存在的 id 无变化', () => {
      const store = useErrorStore()
      store.push(new Error('test'))
      store.acknowledge('nonexistent')
      expect(store.unacknowledgedCount).toBe(1)
    })
  })

  // ========================================================================
  // 6. clear
  // ========================================================================

  describe('clear', () => {
    it('C01: clear 清空所有错误', () => {
      const store = useErrorStore()
      store.push(new Error('a'))
      store.push(new Error('b'))
      store.clear()
      expect(store.count).toBe(0)
      expect(store.isEmpty).toBe(true)
    })

    it('C02: clear 清除 activeError', () => {
      const store = useErrorStore()
      store.push(new Error('a'))
      store.clear()
      expect(store.activeError).toBeNull()
    })

    it('C03: clearAcknowledged 只清除已确认', () => {
      const store = useErrorStore()
      const id1 = store.push(new Error('a'))
      store.push(new Error('b'))
      store.acknowledge(id1)
      store.clearAcknowledged()
      expect(store.count).toBe(1)
      expect(store.queue[0].message).toContain('b')
    })

    it('C04: dismissActive 只清除高亮', () => {
      const store = useErrorStore()
      store.push(new Error('a'))
      store.dismissActive()
      expect(store.activeError).toBeNull()
      expect(store.count).toBe(1)  // 队列不删
    })
  })

  // ========================================================================
  // 7. filter
  // ========================================================================

  describe('filter', () => {
    it('F01: filterByLevel error', () => {
      const store = useErrorStore()
      store.pushMessage('err1', 'error')
      store.pushMessage('warn1', 'warning')
      store.pushMessage('err2', 'error')
      const errors = store.filterByLevel('error')
      expect(errors).toHaveLength(2)
    })

    it('F02: filterByLevel warning', () => {
      const store = useErrorStore()
      store.pushMessage('err1', 'error')
      store.pushMessage('warn1', 'warning')
      const warnings = store.filterByLevel('warning')
      expect(warnings).toHaveLength(1)
    })

    it('F03: filterBySource', () => {
      const store = useErrorStore()
      // createRuntimeError 的 source 来自映射表
      const err = createRuntimeError('runtime/compile-error', 'compile fail')
      store.pushStructured(err)
      store.pushMessage('msg')
      const compileErrors = store.filterBySource('compile')
      expect(compileErrors).toHaveLength(1)
    })
  })

  // ========================================================================
  // 8. count / latest
  // ========================================================================

  describe('count & latest', () => {
    it('CT01: 初始 count=0', () => {
      const store = useErrorStore()
      expect(store.count).toBe(0)
      expect(store.isEmpty).toBe(true)
    })

    it('CT02: errorCount 只统计 error 级别', () => {
      const store = useErrorStore()
      store.pushMessage('e1', 'error')
      store.pushMessage('w1', 'warning')
      store.pushMessage('i1', 'info')
      store.pushMessage('e2', 'error')
      expect(store.errorCount).toBe(2)
      expect(store.warningCount).toBe(1)
      expect(store.infoCount).toBe(1)
    })

    it('L01: latest 返回最后一条', () => {
      const store = useErrorStore()
      store.pushMessage('first')
      store.pushMessage('second')
      expect(store.latest?.message).toBe('second')
    })

    it('L02: latest 空队列返回 null', () => {
      const store = useErrorStore()
      expect(store.latest).toBeNull()
    })
  })

  // ========================================================================
  // 9. LRU 淘汰
  // ========================================================================

  describe('LRU 淘汰', () => {
    it('LRU01: 超过 MAX_ERROR_QUEUE_SIZE 淘汰最早的', () => {
      const store = useErrorStore()
      // 填满队列
      for (let i = 0; i < MAX_ERROR_QUEUE_SIZE; i++) {
        store.pushMessage(`error-${i}`)
      }
      expect(store.count).toBe(MAX_ERROR_QUEUE_SIZE)
      expect(store.queue[0].message).toBe('error-0')

      // 再加一条,最早的被淘汰
      store.pushMessage('new-error')
      expect(store.count).toBe(MAX_ERROR_QUEUE_SIZE)
      expect(store.queue[0].message).toBe('error-1')  // error-0 被淘汰
      expect(store.queue[store.count - 1].message).toBe('new-error')
    })

    it('LRU02: MAX_ERROR_QUEUE_SIZE = 50', () => {
      expect(MAX_ERROR_QUEUE_SIZE).toBe(50)
    })
  })

  // ========================================================================
  // 10. 错误条目结构完整性
  // ========================================================================

  describe('ErrorEntry 结构', () => {
    it('S01: push 创建的条目包含所有必填字段', () => {
      const store = useErrorStore()
      store.push(new Error('test'))
      const entry: ErrorEntry = store.queue[0]
      expect(entry.id).toBeTruthy()
      expect(entry.code).toBeTruthy()
      expect(entry.message).toBe('test')
      expect(entry.level).toBeTruthy()
      expect(entry.source).toBeTruthy()
      expect(typeof entry.recoverable).toBe('boolean')
      expect(typeof entry.timestamp).toBe('number')
      expect(entry.acknowledged).toBe(false)
    })

    it('S02: pushMessage 创建的条目 level 正确', () => {
      const store = useErrorStore()
      store.pushMessage('msg', 'warning')
      expect(store.queue[0].level).toBe('warning')
    })

    it('S03: 条目 id 唯一', () => {
      const store = useErrorStore()
      store.push(new Error('a'))
      store.push(new Error('b'))
      store.push(new Error('c'))
      const ids = store.queue.map((e) => e.id)
      const unique = new Set(ids)
      expect(unique.size).toBe(3)
    })
  })
})
