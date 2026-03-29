/**
 * disk-hardware.ts -- ディスクドライブのハードウェアをエミュレート
 *
 * HDD の物理構造:
 *
 *   ┌─────────────────┐
 *   │  スピンドルモータ  │ ← プラッタを回転 (7200 RPM)
 *   │  ┌─────────────┐ │
 *   │  │  プラッタ 0   │ │ ← 磁気ディスク (表面 + 裏面)
 *   │  ├─────────────┤ │
 *   │  │  プラッタ 1   │ │
 *   │  └─────────────┘ │
 *   │     ↑ ヘッド       │ ← 読み書きヘッド (アームで移動)
 *   │     ← アーム →    │ ← シリンダ間をシーク
 *   └─────────────────┘
 *
 * アドレッシング:
 *   CHS: Cylinder(トラック) / Head(面) / Sector(セクタ)
 *   LBA: Logical Block Address (連番、OS はこちらを使う)
 *
 * 時間コスト:
 *   シーク時間: ヘッドを目的のシリンダに移動 (0〜15ms)
 *   回転待ち:   セクタがヘッド下に来るまで (平均 4.17ms @7200RPM)
 *   転送時間:   データ読み書き (0.01ms/sector @150MB/s)
 *
 * SSD は物理構造が異なる（シーク/回転なし）が、比較のためエミュレートする。
 */

// ディスクの種類
export const DiskType = {
  HDD: "hdd",
  SSD: "ssd",
} as const;
export type DiskType = (typeof DiskType)[keyof typeof DiskType];

// ディスクのスペック
export interface DiskSpec {
  type: DiskType;
  name: string;
  // 物理パラメータ (HDD)
  cylinders: number;       // シリンダ(トラック)数
  heads: number;           // ヘッド(面)数
  sectorsPerTrack: number; // トラックあたりセクタ数
  rpm: number;             // 回転速度
  sectorSize: number;      // バイト/セクタ
  // 性能パラメータ
  seekTimeMinMs: number;   // 最小シーク時間 (隣接トラック)
  seekTimeMaxMs: number;   // 最大シーク時間 (端から端)
  rotationalLatencyMs: number; // 平均回転待ち
  transferRateMBs: number; // MB/s
}

// デフォルトの HDD スペック
export function createHDD(): DiskSpec {
  return {
    type: DiskType.HDD,
    name: "Seagate Barracuda 2TB (ST2000DM008)",
    cylinders: 100,          // シミュレーション用に小さく
    heads: 4,
    sectorsPerTrack: 63,
    rpm: 7200,
    sectorSize: 512,
    seekTimeMinMs: 0.5,
    seekTimeMaxMs: 15,
    rotationalLatencyMs: 4.17, // 60000/7200/2
    transferRateMBs: 150,
  };
}

// デフォルトの SSD スペック
export function createSSD(): DiskSpec {
  return {
    type: DiskType.SSD,
    name: "Samsung 980 PRO 1TB",
    cylinders: 100,
    heads: 1,
    sectorsPerTrack: 63,
    rpm: 0,                    // SSD は回転しない
    sectorSize: 512,
    seekTimeMinMs: 0.01,       // SSD のシーク時間は極小
    seekTimeMaxMs: 0.1,
    rotationalLatencyMs: 0,    // 回転待ちなし
    transferRateMBs: 3500,     // NVMe
  };
}

// ディスクの状態
export interface DiskState {
  currentCylinder: number;  // ヘッドの現在位置
  currentHead: number;
  direction: 1 | -1;       // SCAN 用のヘッド移動方向
  busyUntil: number;        // ビジー終了時刻 (ms)
  totalSectors: number;
}

// I/O リクエスト
export interface IoRequest {
  id: number;
  type: "read" | "write";
  lba: number;              // 論理ブロックアドレス
  sectorCount: number;
  data: Uint8Array | undefined; // write 時のデータ
  // CHS に変換した値（ドライバが計算）
  cylinder: number;
  head: number;
  sector: number;
  // タイミング
  submittedAt: number;      // リクエスト投入時刻
  startedAt: number;        // 処理開始時刻
  completedAt: number;      // 完了時刻
  seekTimeMs: number;
  rotationalLatencyMs: number;
  transferTimeMs: number;
  totalTimeMs: number;
  // 結果
  status: "pending" | "active" | "completed" | "error";
  callback: ((success: boolean, data: Uint8Array | undefined) => void) | undefined;
}

// ハードウェアイベント
export type HwEvent =
  | { type: "seek"; from: number; to: number; timeMs: number }
  | { type: "rotate"; waitMs: number }
  | { type: "transfer"; lba: number; sectors: number; mode: "read" | "write"; timeMs: number }
  | { type: "dma_start"; lba: number; direction: "to_memory" | "from_memory" }
  | { type: "dma_complete"; lba: number }
  | { type: "interrupt"; irq: number; request: number }
  | { type: "head_position"; cylinder: number; head: number };

// 物理ディスクドライブ
export class DiskDrive {
  readonly spec: DiskSpec;
  readonly state: DiskState;
  private storage: Uint8Array[];  // セクタ配列
  events: HwEvent[] = [];
  onEvent: ((event: HwEvent) => void) | undefined;
  private currentTime = 0;

  constructor(spec: DiskSpec) {
    this.spec = spec;
    const totalSectors = spec.cylinders * spec.heads * spec.sectorsPerTrack;
    this.state = {
      currentCylinder: 0,
      currentHead: 0,
      direction: 1,
      busyUntil: 0,
      totalSectors,
    };
    // ストレージ初期化
    this.storage = [];
    for (let i = 0; i < totalSectors; i++) {
      this.storage.push(new Uint8Array(spec.sectorSize));
    }
  }

  private emit(event: HwEvent): void { this.events.push(event); this.onEvent?.(event); }

  // LBA → CHS 変換
  lbaToChs(lba: number): { cylinder: number; head: number; sector: number } {
    const spt = this.spec.sectorsPerTrack;
    const heads = this.spec.heads;
    const sector = (lba % spt) + 1;
    const head = Math.floor(lba / spt) % heads;
    const cylinder = Math.floor(lba / (spt * heads));
    return { cylinder, head, sector };
  }

  // CHS → LBA 変換
  chsToLba(cylinder: number, head: number, sector: number): number {
    return (cylinder * this.spec.heads + head) * this.spec.sectorsPerTrack + (sector - 1);
  }

  // シーク時間を計算（シリンダ差に応じた線形補間）
  calculateSeekTime(fromCylinder: number, toCylinder: number): number {
    if (this.spec.type === "ssd") return this.spec.seekTimeMinMs;
    const distance = Math.abs(toCylinder - fromCylinder);
    if (distance === 0) return 0;
    const maxDist = this.spec.cylinders;
    const ratio = distance / maxDist;
    return this.spec.seekTimeMinMs + ratio * (this.spec.seekTimeMaxMs - this.spec.seekTimeMinMs);
  }

  // I/O リクエストを実行
  executeRequest(req: IoRequest): void {
    const chs = this.lbaToChs(req.lba);
    req.cylinder = chs.cylinder;
    req.head = chs.head;
    req.sector = chs.sector;
    req.startedAt = this.currentTime;

    // 1. シーク
    req.seekTimeMs = this.calculateSeekTime(this.state.currentCylinder, chs.cylinder);
    this.emit({ type: "seek", from: this.state.currentCylinder, to: chs.cylinder, timeMs: req.seekTimeMs });
    this.state.currentCylinder = chs.cylinder;
    this.state.currentHead = chs.head;
    this.emit({ type: "head_position", cylinder: chs.cylinder, head: chs.head });

    // 2. 回転待ち
    req.rotationalLatencyMs = this.spec.rotationalLatencyMs;
    if (req.rotationalLatencyMs > 0) {
      this.emit({ type: "rotate", waitMs: req.rotationalLatencyMs });
    }

    // 3. DMA 開始
    this.emit({ type: "dma_start", lba: req.lba, direction: req.type === "read" ? "to_memory" : "from_memory" });

    // 4. データ転送
    req.transferTimeMs = (req.sectorCount * this.spec.sectorSize) / (this.spec.transferRateMBs * 1024) ;
    this.emit({ type: "transfer", lba: req.lba, sectors: req.sectorCount, mode: req.type, timeMs: req.transferTimeMs });

    // 実際のデータ操作
    if (req.type === "read") {
      const data = new Uint8Array(req.sectorCount * this.spec.sectorSize);
      for (let i = 0; i < req.sectorCount; i++) {
        const sectorData = this.storage[req.lba + i];
        if (sectorData !== undefined) data.set(sectorData, i * this.spec.sectorSize);
      }
      req.data = data;
    } else if (req.type === "write" && req.data !== undefined) {
      for (let i = 0; i < req.sectorCount; i++) {
        const offset = i * this.spec.sectorSize;
        const sectorData = this.storage[req.lba + i];
        if (sectorData !== undefined) {
          sectorData.set(req.data.slice(offset, offset + this.spec.sectorSize));
        }
      }
    }

    // 5. DMA 完了 + 割り込み
    this.emit({ type: "dma_complete", lba: req.lba });
    this.emit({ type: "interrupt", irq: 14, request: req.id });

    // タイミング計算
    req.totalTimeMs = req.seekTimeMs + req.rotationalLatencyMs + req.transferTimeMs;
    req.completedAt = req.startedAt + req.totalTimeMs;
    req.status = "completed";
    this.currentTime = req.completedAt;

    req.callback?.(true, req.data);
  }

  // 時刻を進める
  advanceTime(ms: number): void { this.currentTime += ms; }
  getCurrentTime(): number { return this.currentTime; }
  getTotalSectors(): number { return this.state.totalSectors; }

  // セクタ直接書き込み（初期化用）
  writeSectorDirect(lba: number, data: Uint8Array): void {
    const s = this.storage[lba];
    if (s !== undefined) s.set(data.slice(0, this.spec.sectorSize));
  }

  resetEvents(): void { this.events = []; }
}
