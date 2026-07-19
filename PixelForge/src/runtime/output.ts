import type { RuntimeCanvasSize, RuntimeDeviceHandle, RuntimeTextureBundle } from './types'

export function createOutputTexture(
  device: RuntimeDeviceHandle,
  size: RuntimeCanvasSize,
  format: GPUTextureFormat,
): RuntimeTextureBundle {
  const texture = device.createTexture({
    size: [size.width, size.height],
    format,
    usage:
      GPUTextureUsage.STORAGE_BINDING |
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_SRC |
      GPUTextureUsage.RENDER_ATTACHMENT,
  })

  return {
    texture,
    view: texture.createView(),
    size,
    format,
  }
}
