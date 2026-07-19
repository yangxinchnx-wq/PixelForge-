import { describe, expect, it } from 'vitest'
import { computed, ref } from 'vue'

import { useTimelineViewport } from './timelineViewport'

describe('时间轴视口', () => {
  function createViewport(frameCount: number, containerWidth: number, baseFrameWidth = 56) {
    const frames = computed(() => frameCount)
    const width = ref(containerWidth)
    return useTimelineViewport({
      frameCount: frames,
      containerWidth: width,
      baseFrameWidth,
    })
  }

  it('初始状态下缩放级别为 1 且滚动位置为 0', () => {
    const vp = createViewport(20, 800)
    expect(vp.zoomLevel.value).toBe(1)
    expect(vp.scrollLeft.value).toBe(0)
  })

  it('帧宽度应等于基础宽度乘以缩放级别', () => {
    const vp = createViewport(20, 800, 56)
    expect(vp.frameWidth.value).toBe(56)

    vp.zoomLevel.value = 2
    expect(vp.frameWidth.value).toBe(112)
  })

  it('内容总宽度应等于帧数乘以帧宽度', () => {
    const vp = createViewport(20, 800, 56)
    expect(vp.contentWidth.value).toBe(20 * 56)
  })

  it('帧数不足时内容宽度不应小于容器宽度', () => {
    const vp = createViewport(2, 800, 56)
    expect(vp.contentWidth.value).toBe(800)
  })

  it('缩放级别不应超过最大值', () => {
    const vp = createViewport(20, 800)
    for (let i = 0; i < 20; i++) {
      vp.zoomIn()
    }
    expect(vp.zoomLevel.value).toBe(10)
  })

  it('缩放级别不应低于最小值', () => {
    const vp = createViewport(20, 800)
    for (let i = 0; i < 20; i++) {
      vp.zoomOut()
    }
    expect(vp.zoomLevel.value).toBe(1)
  })

  it('canZoomIn 和 canZoomOut 应正确反映边界', () => {
    const vp = createViewport(20, 800)
    expect(vp.canZoomOut.value).toBe(false)

    vp.zoomIn()
    expect(vp.canZoomOut.value).toBe(true)

    vp.resetZoom()
    expect(vp.canZoomOut.value).toBe(false)
  })

  it('缩放后滚动位置应被钳制在合法范围内', () => {
    const vp = createViewport(20, 400, 56)
    vp.zoomLevel.value = 5
    vp.scrollLeft.value = 1000

    vp.zoomOut()
    expect(vp.scrollLeft.value).toBeLessThanOrEqual(vp.maxScrollLeft.value)
  })

  it('setScrollLeft 应钳制到合法范围', () => {
    const vp = createViewport(20, 400, 56)
    vp.setScrollLeft(-100)
    expect(vp.scrollLeft.value).toBe(0)

    vp.setScrollLeft(99999)
    expect(vp.scrollLeft.value).toBe(vp.maxScrollLeft.value)
  })

  it('scrollToFrame 应将目标帧滚动到视口中央', () => {
    const vp = createViewport(20, 400, 56)
    vp.zoomLevel.value = 3
    vp.scrollToFrame(10)

    const expectedCenter = 10 * 56 * 3 - 400 / 2 + (56 * 3) / 2
    expect(vp.scrollLeft.value).toBe(Math.max(0, Math.min(expectedCenter, vp.maxScrollLeft.value)))
  })

  it('scrollToFrame 目标帧已在视口内时不应滚动', () => {
    const vp = createViewport(20, 800, 56)
    vp.zoomLevel.value = 2
    vp.scrollLeft.value = 0

    const frameIndex = 2
    const targetLeft = frameIndex * 56 * 2
    expect(targetLeft).toBeLessThan(800)
    vp.scrollToFrame(frameIndex)
    expect(vp.scrollLeft.value).toBe(0)
  })

  it('resetZoom 应恢复初始状态', () => {
    const vp = createViewport(20, 800)
    vp.zoomIn()
    vp.scrollLeft.value = 200

    vp.resetZoom()
    expect(vp.zoomLevel.value).toBe(1)
    expect(vp.scrollLeft.value).toBe(0)
  })

  it('handleWheel 带 ctrl 应触发缩放', () => {
    const vp = createViewport(20, 800)
    const event = {
      ctrlKey: true,
      deltaY: -10,
      deltaX: 0,
      preventDefault: () => {},
    } as unknown as WheelEvent

    vp.handleWheel(event)
    expect(vp.zoomLevel.value).toBeGreaterThan(1)
  })

  it('handleWheel 不带 ctrl 应触发水平滚动', () => {
    const vp = createViewport(20, 400, 56)
    vp.zoomLevel.value = 3
    vp.scrollLeft.value = 0

    const event = {
      ctrlKey: false,
      deltaY: 100,
      deltaX: 0,
      preventDefault: () => {},
    } as unknown as WheelEvent

    vp.handleWheel(event)
    expect(vp.scrollLeft.value).toBeGreaterThan(0)
  })

  it('零帧时内容宽度应等于容器宽度', () => {
    const vp = createViewport(0, 800)
    expect(vp.contentWidth.value).toBe(800)
  })

  it('maxScrollLeft 应为内容宽度减去容器宽度', () => {
    const vp = createViewport(20, 400, 56)
    vp.zoomLevel.value = 2
    expect(vp.maxScrollLeft.value).toBe(20 * 56 * 2 - 400)
  })
})

describe('时间轴区间选择', () => {
  function createViewport(frameCount: number, containerWidth: number, baseFrameWidth = 56) {
    const frames = computed(() => frameCount)
    const width = ref(containerWidth)
    return useTimelineViewport({
      frameCount: frames,
      containerWidth: width,
      baseFrameWidth,
    })
  }

  it('初始状态下无区间选择', () => {
    const vp = createViewport(20, 800)
    expect(vp.rangeStart.value).toBeNull()
    expect(vp.rangeEnd.value).toBeNull()
    expect(vp.hasRange.value).toBe(false)
  })

  it('startRange 应同时设置起点和终点', () => {
    const vp = createViewport(20, 800)
    vp.startRange(5)
    expect(vp.rangeStart.value).toBe(5)
    expect(vp.rangeEnd.value).toBe(5)
    expect(vp.hasRange.value).toBe(true)
  })

  it('extendRange 应更新终点但不改变起点', () => {
    const vp = createViewport(20, 800)
    vp.startRange(5)
    vp.extendRange(10)
    expect(vp.rangeStart.value).toBe(5)
    expect(vp.rangeEnd.value).toBe(10)
  })

  it('extendRange 在未设置起点时不应生效', () => {
    const vp = createViewport(20, 800)
    vp.extendRange(10)
    expect(vp.rangeStart.value).toBeNull()
    expect(vp.rangeEnd.value).toBeNull()
  })

  it('clearRange 应清除区间', () => {
    const vp = createViewport(20, 800)
    vp.startRange(5)
    vp.extendRange(10)
    vp.clearRange()
    expect(vp.rangeStart.value).toBeNull()
    expect(vp.rangeEnd.value).toBeNull()
    expect(vp.hasRange.value).toBe(false)
  })

  it('startRange 应钳制到合法范围', () => {
    const vp = createViewport(20, 800)
    vp.startRange(-5)
    expect(vp.rangeStart.value).toBe(0)

    vp.startRange(100)
    expect(vp.rangeStart.value).toBe(19)
  })

  it('extendRange 应钳制到合法范围', () => {
    const vp = createViewport(20, 800)
    vp.startRange(5)
    vp.extendRange(100)
    expect(vp.rangeEnd.value).toBe(19)
  })

  it('rangeStartPx 应返回起点像素位置', () => {
    const vp = createViewport(20, 800, 56)
    vp.startRange(5)
    expect(vp.rangeStartPx.value).toBe(5 * 56)
  })

  it('rangeEndPx 应返回终点帧后一格的像素位置', () => {
    const vp = createViewport(20, 800, 56)
    vp.startRange(5)
    vp.extendRange(8)
    expect(vp.rangeEndPx.value).toBe(9 * 56)
  })

  it('rangeEndPx 小于 rangeStartPx 时区间宽度可以为负（允许反向拖拽）', () => {
    const vp = createViewport(20, 800, 56)
    vp.startRange(10)
    vp.extendRange(3)
    expect(vp.rangeEndPx.value).toBe(4 * 56)
    expect(vp.rangeEndPx.value).toBeLessThan(vp.rangeStartPx.value)
  })

  it('零帧时 startRange 应钳制为 0', () => {
    const vp = createViewport(0, 800)
    vp.startRange(5)
    expect(vp.rangeStart.value).toBe(0)
  })
})
