import { describe, expect, it } from 'vitest'

import { createRenderVerificationSnapshot } from './encoder'

describe('渲染验证快照', () => {
  it('应生成可用于回放一致性校验的渲染签名', () => {
    const snapshot = createRenderVerificationSnapshot({
      artifact: {
        descriptorData: new Uint32Array([1, 0]),
        auxData: new Float32Array([0.1, 0.2, 0.3, 1]),
        regionData: new Float32Array([0, 0, 1, 1]),
        effectDescData: new Uint32Array([0]),
        effectParamData: new Float32Array([0, 0, 0, 0]),
        visibleLayerCount: 1,
        hasEffects: false,
      },
      compileContext: {
        canvasSize: { width: 1024, height: 768 },
        seed: 1337,
      },
    })

    expect(snapshot).toEqual({
      descriptorData: [1, 0],
      auxData: [0.10000000149011612, 0.20000000298023224, 0.30000001192092896, 1],
      regionData: [0, 0, 1, 1],
      effectDescData: [0],
      effectParamData: [0, 0, 0, 0],
      canvasWidth: 1024,
      canvasHeight: 768,
      seed: 1337,
      visibleLayerCount: 1,
      hasEffects: false,
    })
  })
})
