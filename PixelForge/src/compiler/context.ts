import type { CapabilityProfile, RuntimeCanvasSize } from '@/runtime/types'

export interface CompileContext {
  capability: CapabilityProfile
  canvasSize: RuntimeCanvasSize
  seed: number
  time: number
}

export function createCompileContext(
  capability: CapabilityProfile,
  canvasSize: RuntimeCanvasSize,
): CompileContext {
  return {
    capability,
    canvasSize,
    seed: 1337,
    time: 0,
  }
}
