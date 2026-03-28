/**
 * timer.ts — ハードウェアタイマー エミュレーション
 *
 * 一定間隔でタイマー割り込みを発生させる。
 * OS はこの割り込みを使ってプリエンプティブスケジューリング（タイムスライス）を実現する。
 *
 * 実際のハードウェア:
 *   PIT (Programmable Interval Timer) や APIC タイマーに相当。
 *   設定された周期ごとに CPU に割り込み信号を送る。
 */
import { InterruptType, type HwEvent } from "./types.js";

export class Timer {
  // タイマー割り込みの間隔（CPUサイクル数）
  interval = 100;
  // 現在のカウント
  private count = 0;
  // 総ティック数
  private tickCount = 0;
  // 割り込みハンドラ
  private interruptHandler: ((type: InterruptType) => void) | undefined;
  // 有効/無効
  enabled = false;

  onEvent: ((event: HwEvent) => void) | undefined;
  private startTime = performance.now();

  // 割り込みハンドラを登録
  setInterruptHandler(handler: (type: InterruptType) => void): void {
    this.interruptHandler = handler;
  }

  // CPU が1サイクル実行するたびに呼ばれる
  tick(): void {
    if (!this.enabled) return;

    this.count++;
    if (this.count >= this.interval) {
      this.count = 0;
      this.tickCount++;
      this.onEvent?.({
        type: "timer_tick", tickCount: this.tickCount,
        timestamp: performance.now() - this.startTime,
      });
      this.interruptHandler?.(InterruptType.Timer);
    }
  }

  getTickCount(): number {
    return this.tickCount;
  }

  reset(): void {
    this.count = 0;
    this.tickCount = 0;
  }

  resetTime(): void {
    this.startTime = performance.now();
  }
}
