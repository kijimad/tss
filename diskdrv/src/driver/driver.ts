/**
 * driver.ts -- ディスクドライバ
 *
 * カーネルとハードウェアの間のインターフェース:
 *
 *   ユーザプロセス: read(fd, buf, size)
 *     ↓ システムコール
 *   VFS (Virtual File System)
 *     ↓
 *   ブロックデバイスドライバ (ここ)
 *     ├── バッファキャッシュ (キャッシュヒットなら即返却)
 *     ├── I/O スケジューラ (リクエスト並び替え)
 *     └── ハードウェア制御 (DMA + 割り込み)
 *           ↓
 *   ディスクドライブ (物理 I/O)
 */
import { DiskDrive, type IoRequest, type DiskSpec } from "../hw/disk-hardware.js";
import { IoScheduler, type SchedulerAlgorithm } from "../scheduler/io-scheduler.js";

// バッファキャッシュエントリ
interface CacheEntry {
  lba: number;
  data: Uint8Array;
  dirty: boolean;       // 書き込みが未フラッシュ
  accessCount: number;
  lastAccess: number;
}

// ドライバイベント
export type DriverEvent =
  | { type: "cache_hit"; lba: number }
  | { type: "cache_miss"; lba: number }
  | { type: "cache_evict"; lba: number; dirty: boolean }
  | { type: "cache_flush"; lba: number }
  | { type: "request_submit"; id: number; lba: number; mode: string }
  | { type: "request_complete"; id: number; lba: number; totalMs: number; seekMs: number; rotateMs: number; transferMs: number }
  | { type: "batch_complete"; count: number; totalSeek: number; avgSeek: number; throughput: number };

export class DiskDriver {
  readonly drive: DiskDrive;
  readonly scheduler: IoScheduler;
  // バッファキャッシュ
  private cache = new Map<number, CacheEntry>();
  private cacheMaxSize: number;
  // リクエスト管理
  private nextRequestId = 1;
  private completedRequests: IoRequest[] = [];
  // イベント
  events: DriverEvent[] = [];
  onEvent: ((event: DriverEvent) => void) | undefined;

  constructor(spec: DiskSpec, algorithm: SchedulerAlgorithm, cacheSize = 32) {
    this.drive = new DiskDrive(spec);
    this.scheduler = new IoScheduler(algorithm, spec.cylinders);
    this.cacheMaxSize = cacheSize;
  }

  private emit(event: DriverEvent): void { this.events.push(event); this.onEvent?.(event); }

  // === 公開 API (カーネルから呼ばれる) ===

  // ブロック読み取り
  read(lba: number, sectorCount = 1): Uint8Array {
    // キャッシュチェック
    const cached = this.cache.get(lba);
    if (cached !== undefined) {
      cached.accessCount++;
      cached.lastAccess = this.drive.getCurrentTime();
      this.emit({ type: "cache_hit", lba });
      return cached.data.slice();
    }
    this.emit({ type: "cache_miss", lba });

    // I/O リクエスト発行
    const req = this.createRequest("read", lba, sectorCount);
    this.scheduler.enqueue(req);
    // 即座に処理（シミュレーション）
    this.processQueue();

    // キャッシュに格納
    if (req.data !== undefined) {
      this.cacheStore(lba, req.data);
    }

    return req.data ?? new Uint8Array(sectorCount * this.drive.spec.sectorSize);
  }

  // ブロック書き込み
  write(lba: number, data: Uint8Array): void {
    // ライトバックキャッシュ: まずキャッシュに書き込む
    this.cacheStore(lba, data);
    const entry = this.cache.get(lba);
    if (entry !== undefined) entry.dirty = true;

    // I/O リクエスト発行
    const req = this.createRequest("write", lba, Math.ceil(data.length / this.drive.spec.sectorSize), data);
    this.scheduler.enqueue(req);
    this.processQueue();
  }

  // バッチ読み取り（複数 LBA を一度にリクエスト → スケジューラが最適化）
  readBatch(lbas: number[]): Map<number, Uint8Array> {
    const results = new Map<number, Uint8Array>();

    // キャッシュヒットを先に処理
    const misses: number[] = [];
    for (const lba of lbas) {
      const cached = this.cache.get(lba);
      if (cached !== undefined) {
        cached.accessCount++;
        this.emit({ type: "cache_hit", lba });
        results.set(lba, cached.data.slice());
      } else {
        this.emit({ type: "cache_miss", lba });
        misses.push(lba);
      }
    }

    // キャッシュミスを I/O リクエストとしてキューに投入
    for (const lba of misses) {
      const req = this.createRequest("read", lba, 1);
      this.scheduler.enqueue(req);
    }

    // スケジューラが最適な順序で処理
    this.processQueue();

    // 結果を収集
    for (const req of this.completedRequests) {
      if (req.data !== undefined && misses.includes(req.lba)) {
        results.set(req.lba, req.data);
        this.cacheStore(req.lba, req.data);
      }
    }

    return results;
  }

  // キャッシュの dirty エントリをディスクに書き戻す
  flush(): void {
    for (const [lba, entry] of this.cache) {
      if (entry.dirty) {
        const req = this.createRequest("write", lba, 1, entry.data);
        this.scheduler.enqueue(req);
        entry.dirty = false;
        this.emit({ type: "cache_flush", lba });
      }
    }
    this.processQueue();
  }

  // === 内部処理 ===

  // キューの全リクエストを処理
  private processQueue(): void {
    const batch: IoRequest[] = [];
    let totalSeek = 0;
    let req: IoRequest | undefined;

    while ((req = this.scheduler.dequeue()) !== undefined) {
      this.drive.executeRequest(req);
      this.completedRequests.push(req);
      batch.push(req);
      totalSeek += req.seekTimeMs;

      this.emit({
        type: "request_complete", id: req.id, lba: req.lba,
        totalMs: req.totalTimeMs, seekMs: req.seekTimeMs,
        rotateMs: req.rotationalLatencyMs, transferMs: req.transferTimeMs,
      });
    }

    if (batch.length > 0) {
      const avgSeek = totalSeek / batch.length;
      const totalTime = batch.reduce((sum, r) => sum + r.totalTimeMs, 0);
      const totalBytes = batch.reduce((sum, r) => sum + r.sectorCount * this.drive.spec.sectorSize, 0);
      const throughput = totalTime > 0 ? (totalBytes / 1024 / 1024) / (totalTime / 1000) : 0;
      this.emit({ type: "batch_complete", count: batch.length, totalSeek, avgSeek, throughput });
    }
  }

  private createRequest(type: "read" | "write", lba: number, sectorCount: number, data?: Uint8Array): IoRequest {
    const id = this.nextRequestId++;
    const chs = this.drive.lbaToChs(lba);
    const req: IoRequest = {
      id, type, lba, sectorCount, data,
      cylinder: chs.cylinder, head: chs.head, sector: chs.sector,
      submittedAt: this.drive.getCurrentTime(), startedAt: 0, completedAt: 0,
      seekTimeMs: 0, rotationalLatencyMs: 0, transferTimeMs: 0, totalTimeMs: 0,
      status: "pending", callback: undefined,
    };
    this.emit({ type: "request_submit", id, lba, mode: type });
    return req;
  }

  // LRU キャッシュ
  private cacheStore(lba: number, data: Uint8Array): void {
    if (this.cache.size >= this.cacheMaxSize) {
      // LRU eviction
      let oldestLba = -1; let oldestTime = Infinity;
      for (const [k, v] of this.cache) {
        if (v.lastAccess < oldestTime) { oldestTime = v.lastAccess; oldestLba = k; }
      }
      if (oldestLba >= 0) {
        const evicted = this.cache.get(oldestLba);
        this.emit({ type: "cache_evict", lba: oldestLba, dirty: evicted?.dirty ?? false });
        // dirty ならフラッシュ
        if (evicted?.dirty) {
          const flushReq = this.createRequest("write", oldestLba, 1, evicted.data);
          this.drive.executeRequest(flushReq);
        }
        this.cache.delete(oldestLba);
      }
    }
    this.cache.set(lba, { lba, data: data.slice(), dirty: false, accessCount: 1, lastAccess: this.drive.getCurrentTime() });
  }

  // === 情報取得 ===

  getCompletedRequests(): IoRequest[] { return this.completedRequests; }
  getCacheSize(): number { return this.cache.size; }
  getCacheEntries(): { lba: number; dirty: boolean; accessCount: number }[] {
    return [...this.cache.values()].map(e => ({ lba: e.lba, dirty: e.dirty, accessCount: e.accessCount }));
  }
  getHeadPosition(): number { return this.drive.state.currentCylinder; }

  resetStats(): void {
    this.completedRequests = [];
    this.events = [];
    this.drive.resetEvents();
    this.scheduler.resetEvents();
  }
}
