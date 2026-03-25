import { type PageStore, type PageType } from "../types.js";
import { initPage } from "../storage/page.js";

// LRUページキャッシュ付きPager
export class Pager {
  private cache = new Map<number, ArrayBuffer>();
  private dirty = new Set<number>();
  private maxPageId = 0;
  private maxCacheSize: number;

  constructor(
    private store: PageStore,
    maxCacheSize = 64,
  ) {
    this.maxCacheSize = maxCacheSize;
  }

  async init(): Promise<void> {
    this.maxPageId = await this.store.getMaxPageId();
  }

  async getPage(pageId: number): Promise<ArrayBuffer> {
    // キャッシュチェック
    const cached = this.cache.get(pageId);
    if (cached !== undefined) {
      // LRU更新: 削除して再挿入
      this.cache.delete(pageId);
      this.cache.set(pageId, cached);
      return cached;
    }

    // ストアから読み込み
    const data = await this.store.readPage(pageId);
    if (data === undefined) {
      throw new Error(`ページ ${String(pageId)} が見つかりません`);
    }

    this.addToCache(pageId, data);
    return data;
  }

  async allocatePage(pageType: PageType): Promise<{ pageId: number; buffer: ArrayBuffer }> {
    this.maxPageId++;
    const pageId = this.maxPageId;
    const buffer = initPage(pageType);
    this.addToCache(pageId, buffer);
    this.dirty.add(pageId);
    return { pageId, buffer };
  }

  markDirty(pageId: number): void {
    this.dirty.add(pageId);
  }

  async flush(): Promise<void> {
    for (const pageId of this.dirty) {
      const buf = this.cache.get(pageId);
      if (buf !== undefined) {
        await this.store.writePage(pageId, buf);
      }
    }
    this.dirty.clear();
  }

  getMaxPageId(): number {
    return this.maxPageId;
  }

  // ページデータを直接セット（B+Treeの分割などで使用）
  setPage(pageId: number, buffer: ArrayBuffer): void {
    this.cache.set(pageId, buffer);
    this.dirty.add(pageId);
    if (pageId > this.maxPageId) {
      this.maxPageId = pageId;
    }
  }

  private addToCache(pageId: number, data: ArrayBuffer): void {
    // キャッシュサイズ超過時にLRU eviction
    if (this.cache.size >= this.maxCacheSize) {
      const oldest = this.cache.keys().next();
      if (!oldest.done) {
        const oldPageId = oldest.value;
        // dirtyなら書き込みは flush() で行う
        if (!this.dirty.has(oldPageId)) {
          this.cache.delete(oldPageId);
        }
      }
    }
    this.cache.set(pageId, data);
  }
}
