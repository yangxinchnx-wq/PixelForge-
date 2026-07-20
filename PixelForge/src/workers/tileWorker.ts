/**
 * PixelForge - Tile Worker（骨架 §2.1 workers/tileWorker.ts）
 *
 * Phase C: 在 Web Worker 中执行 L1 编译（RenderIR → RegionCompileArtifact），
 * 避免编译过程阻塞主线程。
 *
 * 消息协议：
 *   主线程 → Worker:  { type: 'compile', id: number, ir: RenderIR }
 *   Worker → 主线程:  { type: 'result', id: number, artifact: RegionCompileArtifact }
 *                     或
 *                     { type: 'error', id: number, message: string }
 *
 * 传输优化：
 *   artifact 中的 TypedArray（descriptorData / auxData / regionData / effectDescData / effectParamData）
 *   通过 Transferable 传输，避免拷贝。
 *
 * 注意：
 *   - Worker 中不依赖任何浏览器 DOM / WebGPU API
 *   - 仅依赖 regionCompiler（纯数据操作）+ shared/errors（纯 Error 创建）
 *   - Worker 不可用时由 workerPool 自动降级为主线程编译
 */

import { compileRenderIRToRegionArtifact } from '@/compiler/region/regionCompiler'
import type { RegionCompileArtifact } from '@/compiler/region/regionCompiler'
import type { RenderIR } from '@/compiler/ir/renderIR'

// ============================================================================
// 消息类型定义
// ============================================================================

export interface CompileRequest {
  type: 'compile'
  id: number
  ir: RenderIR
}

export interface CompileResult {
  type: 'result'
  id: number
  artifact: RegionCompileArtifact
}

export interface CompileError {
  type: 'error'
  id: number
  message: string
}

export type WorkerResponse = CompileResult | CompileError

// ============================================================================
// Worker 消息处理
// ============================================================================

self.onmessage = (e: MessageEvent<CompileRequest>) => {
  const { type, id, ir } = e.data

  if (type !== 'compile') {
    return
  }

  try {
    const artifact = compileRenderIRToRegionArtifact(ir)

    // 收集所有 TypedArray 用于 transfer
    const transferList: Transferable[] = [
      artifact.descriptorData.buffer,
      artifact.auxData.buffer,
      artifact.regionData.buffer,
      artifact.effectDescData.buffer,
      artifact.effectParamData.buffer,
    ]

    const response: CompileResult = {
      type: 'result',
      id,
      artifact,
    }

    ;(self as unknown as Worker).postMessage(response, transferList)
  } catch (err) {
    const response: CompileError = {
      type: 'error',
      id,
      message: err instanceof Error ? err.message : String(err),
    }

    ;(self as unknown as Worker).postMessage(response)
  }
}
