/**
 * PixelForge Media — ThumbnailCache（缩略图缓存）。
 *
 * 不能每次重新解码视频帧，需要缓存。
 *
 * 例如：Clip 60 秒，每秒一个缩略图，缓存 60 ImageBitmap。
 * 4K 视频一帧约 8MB，100 帧 800MB，所以使用 LRU。
 */

/** 缓存条目。 */
export interface CacheEntry {
  /** 对应时间戳（秒） */
  time: number;
  /** 缩略图图片 */
  bitmap: ImageBitmap | null;
}

/**
 * LRU 缓存 — 最近最少使用淘汰策略。
 *
 * limit = 120（约 120 帧缩略图）。
 */
export class LRUCache<K, V> {
  private map: Map<K, V> = new Map();
  private limit: number;

  constructor(limit: number = 120) {
    this.limit = limit;
  }

  /** 获取值（同时更新为最近使用）。 */
  get(key: K): V | undefined {
    const value = this.map.get(key);
    if (value !== undefined) {
      // 删除再设置，使其成为最新
      this.map.delete(key);
      this.map.set(key, value);
    }
    return value;
  }

  /** 设置值（淘汰最旧的）。 */
  set(key: K, value: V): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.limit) {
      // 淘汰最旧的（Map 迭代顺序 = 插入顺序）
      const oldest = this.map.keys().next();
      if (!oldest.done) {
        this.map.delete(oldest.value);
      }
    }
    this.map.set(key, value);
  }

  /** 是否包含 key。 */
  has(key: K): boolean {
    return this.map.has(key);
  }

  /** 当前缓存大小。 */
  get size(): number {
    return this.map.size;
  }

  /** 清空缓存。 */
  clear(): void {
    this.map.clear();
  }
}

/**
 * ThumbnailCache — 按 assetId 分组管理缩略图缓存。
 *
 * 用法：
 *   const cache = new ThumbnailCache();
 *   cache.set('asset01', 0, bitmap);
 *   const thumb = cache.get('asset01', 0);
 */
export class ThumbnailCache {
  /** assetId → LRU 缓存（time → bitmap） */
  private caches: Map<string, LRUCache<number, ImageBitmap | null>> = new Map();

  /**
   * 获取某素材指定时间的缩略图。
   *
   * @param assetId 素材 ID
   * @param time    时间（秒）
   * @returns 缩略图，或 undefined（未缓存）
   */
  get(assetId: string, time: number): ImageBitmap | null | undefined {
    const cache = this.caches.get(assetId);
    if (!cache) return undefined;
    return cache.get(time);
  }

  /**
   * 设置某素材指定时间的缩略图。
   *
   * @param assetId 素材 ID
   * @param time    时间（秒）
   * @param bitmap  缩略图
   */
  set(assetId: string, time: number, bitmap: ImageBitmap | null): void {
    let cache = this.caches.get(assetId);
    if (!cache) {
      cache = new LRUCache<number, ImageBitmap | null>(120);
      this.caches.set(assetId, cache);
    }
    cache.set(time, bitmap);
  }

  /** 是否已缓存。 */
  has(assetId: string, time: number): boolean {
    const cache = this.caches.get(assetId);
    if (!cache) return false;
    return cache.has(time);
  }

  /** 清空指定素材的缓存。 */
  clearAsset(assetId: string): void {
    this.caches.delete(assetId);
  }

  /** 清空所有缓存。 */
  clear(): void {
    this.caches.clear();
  }
}
