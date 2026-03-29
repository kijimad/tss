/**
 * io-scheduler.ts -- I/O スケジューラ
 *
 * ディスクへの I/O リクエストを効率的に並び替えるアルゴリズム。
 * HDD ではヘッドの移動(シーク)が最も遅いので、シーク距離を最小化する。
 *
 * アルゴリズム:
 *   FIFO:   先着順。公平だがシーク最適化なし
 *   SSTF:   最短シーク時間優先。シーク最小化だが飢餓(starvation)の問題
 *   SCAN:   エレベーター。端まで行って折り返す。公平性とシーク最適化のバランス
 *   C-SCAN: 片方向のみサービスし、端で先頭に戻る。均一な待ち時間
 */
import type { IoRequest } from "../hw/disk-hardware.js";

export const SchedulerAlgorithm = {
  FIFO: "FIFO",
  SSTF: "SSTF",
  SCAN: "SCAN",
  CSCAN: "C-SCAN",
} as const;
export type SchedulerAlgorithm = (typeof SchedulerAlgorithm)[keyof typeof SchedulerAlgorithm];

// スケジューライベント
export type SchedulerEvent =
  | { type: "enqueue"; requestId: number; lba: number; cylinder: number }
  | { type: "dequeue"; requestId: number; lba: number; cylinder: number; algorithm: string; reason: string }
  | { type: "reorder"; algorithm: string; queueBefore: number[]; queueAfter: number[] }
  | { type: "direction_change"; from: number; to: number }
  | { type: "stats"; avgSeek: number; totalSeek: number; throughput: number };

export class IoScheduler {
  algorithm: SchedulerAlgorithm;
  private queue: IoRequest[] = [];
  private currentCylinder = 0;
  private direction: 1 | -1 = 1; // SCAN 用
  private maxCylinder = 100;
  events: SchedulerEvent[] = [];
  onEvent: ((event: SchedulerEvent) => void) | undefined;

  constructor(algorithm: SchedulerAlgorithm, maxCylinder = 100) {
    this.algorithm = algorithm;
    this.maxCylinder = maxCylinder;
  }

  private emit(event: SchedulerEvent): void { this.events.push(event); this.onEvent?.(event); }

  // リクエストをキューに追加
  enqueue(request: IoRequest): void {
    this.queue.push(request);
    this.emit({ type: "enqueue", requestId: request.id, lba: request.lba, cylinder: request.cylinder });
  }

  // 次に処理すべきリクエストを取り出す
  dequeue(): IoRequest | undefined {
    if (this.queue.length === 0) return undefined;

    let selected: IoRequest | undefined;
    let selectedIndex = -1;
    let reason = "";

    switch (this.algorithm) {
      case SchedulerAlgorithm.FIFO: {
        selected = this.queue[0];
        selectedIndex = 0;
        reason = "first-in first-out";
        break;
      }

      case SchedulerAlgorithm.SSTF: {
        // 最短シーク距離のリクエストを選択
        let minDist = Infinity;
        for (let i = 0; i < this.queue.length; i++) {
          const req = this.queue[i];
          if (req === undefined) continue;
          const dist = Math.abs(req.cylinder - this.currentCylinder);
          if (dist < minDist) {
            minDist = dist;
            selected = req;
            selectedIndex = i;
          }
        }
        reason = `shortest seek: distance=${String(selected !== undefined ? Math.abs(selected.cylinder - this.currentCylinder) : 0)} cylinders`;
        break;
      }

      case SchedulerAlgorithm.SCAN: {
        // 現在の方向に進みながらサービス
        const inDirection = this.queue
          .map((req, i) => ({ req, i }))
          .filter(({ req }) => {
            if (this.direction === 1) return req.cylinder >= this.currentCylinder;
            return req.cylinder <= this.currentCylinder;
          })
          .sort((a, b) => {
            if (this.direction === 1) return a.req.cylinder - b.req.cylinder;
            return b.req.cylinder - a.req.cylinder;
          });

        if (inDirection.length > 0 && inDirection[0] !== undefined) {
          selected = inDirection[0].req;
          selectedIndex = inDirection[0].i;
          reason = `SCAN ${this.direction === 1 ? "→" : "←"} cylinder ${String(selected.cylinder)}`;
        } else {
          // 方向を反転
          this.direction = this.direction === 1 ? -1 : 1;
          this.emit({ type: "direction_change", from: this.direction === 1 ? -1 : 1, to: this.direction });
          // 反転後の最初のリクエスト
          const reversed = this.queue
            .map((req, i) => ({ req, i }))
            .sort((a, b) => {
              if (this.direction === 1) return a.req.cylinder - b.req.cylinder;
              return b.req.cylinder - a.req.cylinder;
            });
          if (reversed[0] !== undefined) {
            selected = reversed[0].req;
            selectedIndex = reversed[0].i;
            reason = `SCAN reversed ${this.direction === 1 ? "→" : "←"} cylinder ${String(selected.cylinder)}`;
          }
        }
        break;
      }

      case SchedulerAlgorithm.CSCAN: {
        // 一方向のみサービス（常に小→大）
        const forward = this.queue
          .map((req, i) => ({ req, i }))
          .filter(({ req }) => req.cylinder >= this.currentCylinder)
          .sort((a, b) => a.req.cylinder - b.req.cylinder);

        if (forward.length > 0 && forward[0] !== undefined) {
          selected = forward[0].req;
          selectedIndex = forward[0].i;
          reason = `C-SCAN → cylinder ${String(selected.cylinder)}`;
        } else {
          // 先頭に戻る
          this.emit({ type: "direction_change", from: this.maxCylinder, to: 0 });
          this.currentCylinder = 0;
          const all = this.queue
            .map((req, i) => ({ req, i }))
            .sort((a, b) => a.req.cylinder - b.req.cylinder);
          if (all[0] !== undefined) {
            selected = all[0].req;
            selectedIndex = all[0].i;
            reason = `C-SCAN wrapped → cylinder ${String(selected.cylinder)}`;
          }
        }
        break;
      }
    }

    if (selected !== undefined && selectedIndex >= 0) {
      this.queue.splice(selectedIndex, 1);
      this.currentCylinder = selected.cylinder;
      this.emit({ type: "dequeue", requestId: selected.id, lba: selected.lba, cylinder: selected.cylinder, algorithm: this.algorithm, reason });
    }

    return selected;
  }

  // 現在のキュー状態
  getQueue(): IoRequest[] { return [...this.queue]; }
  getQueueCylinders(): number[] { return this.queue.map(r => r.cylinder); }
  setCurrentCylinder(c: number): void { this.currentCylinder = c; }
  getCurrentCylinder(): number { return this.currentCylinder; }
  getDirection(): number { return this.direction; }
  queueLength(): number { return this.queue.length; }

  resetEvents(): void { this.events = []; }
}
