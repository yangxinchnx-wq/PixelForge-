/**
 * GpuUavSplitBackend — 基于真实 GPUDevice 的 UAV Split 后端。
 *
 * 生产环境使用：将抽象的 UavSplitBackend 接口对接到 WebGPU。
 *   - createReadOnlyTexture → device.createTexture(...)
 *   - copyTextureToTexture  → 默认创建一次性 command encoder 并立即提交
 *   - destroyTexture        → texture.destroy()
 *
 * 若需要把复制操作并入已有 encoder（更精确的帧内时序），
 * 请改用 recordUavCopy() 工具函数手动记录。
 */

import type { RuntimeDeviceHandle } from '../types'
import type { ReadOnlyTextureDescriptor, UavSplitBackend } from './types'

export class GpuUavSplitBackend implements UavSplitBackend {
  constructor(private readonly device: RuntimeDeviceHandle) {}

  createReadOnlyTexture(desc: ReadOnlyTextureDescriptor): GPUTexture {
    // 只读副本以「只读存储纹理」身份绑定（texture_storage_2d<..., read>），
    // 因此必须带 STORAGE_BINDING；COPY_DST 用于接收逐帧从输出纹理复制的内容。
    return this.device.createTexture({
      label: desc.label,
      size: [desc.width, desc.height, 1],
      format: desc.format as GPUTextureFormat,
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_DST,
    })
  }

  copyTextureToTexture(source: unknown, destination: unknown): void {
    const src = source as GPUTexture
    const dst = destination as GPUTexture
    const encoder = this.device.createCommandEncoder({
      label: `uav_split_copy_${dst.label ?? 'readonly'}`,
    })
    recordUavCopy(encoder, src, dst)
    this.device.queue.submit([encoder.finish()])
  }

  destroyTexture(handle: unknown): void {
    ;(handle as GPUTexture).destroy()
  }
}

/**
 * 将一个纹理的内容复制到另一个纹理（记录到给定 encoder，不自行提交）。
 *
 * 用于需要精确控制录制时序的场景（例如并入主渲染 encoder）。
 *
 * @param encoder 目标 command encoder
 * @param source 源 GPUTexture
 * @param destination 目标 GPUTexture
 */
export function recordUavCopy(
  encoder: GPUCommandEncoder,
  source: GPUTexture,
  destination: GPUTexture,
): void {
  encoder.copyTextureToTexture(
    { texture: source },
    { texture: destination },
    {
      width: source.width,
      height: source.height,
      depthOrArrayLayers: source.depthOrArrayLayers,
    },
  )
}
