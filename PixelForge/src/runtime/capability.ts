import type { CapabilityProfile } from './types'

const STORAGE_TEXTURE_FORMAT: GPUTextureFormat = 'rgba8unorm'

export async function detectCapability(adapter: GPUAdapter): Promise<CapabilityProfile> {
  const storageTextureFeature = 'bgra8unorm-storage' satisfies GPUFeatureName
  const storageFormat = adapter.features.has(storageTextureFeature)
    ? 'bgra8unorm'
    : STORAGE_TEXTURE_FORMAT

  return {
    webgpu: true,
    storageTexture: true,
    storageFormat,
    maxTextureDimension2D: adapter.limits.maxTextureDimension2D,
    maxStorageBufferBindingSize: Number(adapter.limits.maxStorageBufferBindingSize),
    maxComputeWorkgroupSizeX: adapter.limits.maxComputeWorkgroupSizeX,
    maxComputeWorkgroupSizeY: adapter.limits.maxComputeWorkgroupSizeY,
    maxComputeInvocationsPerWorkgroup: adapter.limits.maxComputeInvocationsPerWorkgroup,
  }
}
