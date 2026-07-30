/**
 * 存储层统一导出
 */

export {
  MemoryCache,
  estimateSize,
  frameMemoryCache,
  textMemoryCache,
  type MemoryCacheOptions,
  type MemoryCacheStats,
  type CacheEntry,
} from './memoryCache'

export {
  OpfsStore,
  opfsStore,
  isOpfsAvailable,
  OPFS_NAMESPACES,
} from './opfsStore'

export {
  UnifiedStore,
  unifiedStore,
  initStorage,
  type UnifiedStoreStats,
  type StorageCategory,
} from './unifiedStore'

export * as tauriDb from './tauriDb'
