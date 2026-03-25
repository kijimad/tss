import type { PageStore } from "../types.js";

const STORE_NAME = "pages";

// IndexedDB ベースの PageStore 実装
export class IdbPageStore implements PageStore {
  private db: IDBDatabase;

  private constructor(db: IDBDatabase) {
    this.db = db;
  }

  static async open(dbName: string): Promise<IdbPageStore> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(new IdbPageStore(request.result));
      request.onerror = () => reject(request.error);
    });
  }

  async readPage(pageId: number): Promise<ArrayBuffer | undefined> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(pageId);
      request.onsuccess = () => {
        const result: unknown = request.result;
        if (result instanceof ArrayBuffer) {
          resolve(result);
        } else {
          resolve(undefined);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  async writePage(pageId: number, data: ArrayBuffer): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const request = store.put(data, pageId);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getMaxPageId(): Promise<number> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const request = store.openCursor(null, "prev");
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor !== null && cursor !== undefined) {
          const key = cursor.key;
          resolve(typeof key === "number" ? key : 0);
        } else {
          resolve(0);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  async close(): Promise<void> {
    this.db.close();
  }
}

// テスト用インメモリ PageStore
export class MemoryPageStore implements PageStore {
  private pages = new Map<number, ArrayBuffer>();

  async readPage(pageId: number): Promise<ArrayBuffer | undefined> {
    const page = this.pages.get(pageId);
    if (page === undefined) return undefined;
    // コピーを返す（意図しない変更を防ぐ — ただしパフォーマンスのため直接返す）
    return page;
  }

  async writePage(pageId: number, data: ArrayBuffer): Promise<void> {
    this.pages.set(pageId, data.slice(0));
  }

  async getMaxPageId(): Promise<number> {
    let max = 0;
    for (const id of this.pages.keys()) {
      if (id > max) max = id;
    }
    return max;
  }

  async close(): Promise<void> {
    this.pages.clear();
  }
}
