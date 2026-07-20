import type { CapabilityProfile } from './types'

/**
 * 存储纹理格式。
 *
 * WGSL 着色器（region_eval.wgsl / effect_post.wgsl）中硬编码声明为
 * texture_storage_2d<rgba8unorm, ...>，因此输出纹理必须始终使用 rgba8unorm，
 * 否则 pipeline 创建时会触发 WebGPU 验证错误。
 *
 * rgba8unorm 作为 storage texture 格式属于 WebGPU 核心规范，所有实现均支持。
 */
const STORAGE_TEXTURE_FORMAT: GPUTextureFormat = 'rgba8unorm'

export async function detectCapability(adapter: GPUAdapter): Promise<CapabilityProfile> {
  return {
    webgpu: true,
    storageTexture: true,
    storageFormat: STORAGE_TEXTURE_FORMAT,
    maxTextureDimension2D: adapter.limits.maxTextureDimension2D,
    maxStorageBufferBindingSize: Number(adapter.limits.maxStorageBufferBindingSize),
    maxComputeWorkgroupSizeX: adapter.limits.maxComputeWorkgroupSizeX,
    maxComputeWorkgroupSizeY: adapter.limits.maxComputeWorkgroupSizeY,
    maxComputeInvocationsPerWorkgroup: adapter.limits.maxComputeInvocationsPerWorkgroup,
  }
}
