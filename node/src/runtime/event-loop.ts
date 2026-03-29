/**
 * event-loop.ts -- Node.js のイベントループ
 *
 * Node.js の心臓部。libuv が実装している処理を TypeScript で再現する。
 *
 * イベントループのフェーズ（実際の Node.js と同じ順序）:
 *
 *   ┌───────────────────────────┐
 *   │    timers                 │ ← setTimeout/setInterval のコールバック
 *   ├───────────────────────────┤
 *   │    pending callbacks      │ ← I/O コールバック（fs.readFile 等）
 *   ├───────────────────────────┤
 *   │    idle, prepare          │ ← 内部処理
 *   ├───────────────────────────┤
 *   │    poll                   │ ← 新しい I/O イベントを取得
 *   ├───────────────────────────┤
 *   │    check                  │ ← setImmediate のコールバック
 *   ├───────────────────────────┤
 *   │    close callbacks        │ ← close イベント
 *   └───────────────────────────┘
 *        ↓
 *   process.nextTick → Promise microtasks → 次のフェーズへ
 */

// イベントループのフェーズ
export const Phase = {
  Timers: "timers",
  PendingCallbacks: "pending_callbacks",
  Poll: "poll",
  Check: "check",
  Close: "close",
} as const;
export type Phase = (typeof Phase)[keyof typeof Phase];

// タイマーエントリ
interface TimerEntry {
  id: number;
  callback: () => void;
  delay: number;          // ms
  registeredAt: number;   // ms (イベントループ内部時間)
  interval: boolean;      // setInterval なら true
  cancelled: boolean;
}

// I/O コールバックエントリ
interface PendingCallback {
  id: number;
  callback: () => void;
  description: string;
}

// イベントループのトレースイベント
export type LoopEvent =
  | { type: "phase_enter"; phase: Phase; timestamp: number }
  | { type: "timer_fire"; timerId: number; delay: number; timestamp: number }
  | { type: "timer_register"; timerId: number; delay: number; interval: boolean; timestamp: number }
  | { type: "timer_cancel"; timerId: number; timestamp: number }
  | { type: "io_callback"; description: string; timestamp: number }
  | { type: "immediate_fire"; timestamp: number }
  | { type: "nexttick"; timestamp: number }
  | { type: "microtask"; timestamp: number }
  | { type: "tick_complete"; tickNumber: number; timestamp: number }
  | { type: "loop_idle"; timestamp: number }
  | { type: "loop_exit"; timestamp: number };

export class EventLoop {
  // タイマーキュー
  private timers: TimerEntry[] = [];
  private nextTimerId = 1;

  // I/O 完了コールバック
  private pendingCallbacks: PendingCallback[] = [];
  private nextCallbackId = 1;

  // setImmediate キュー
  private immediateQueue: (() => void)[] = [];

  // process.nextTick キュー
  private nextTickQueue: (() => void)[] = [];

  // Promise microtask キュー
  private microtaskQueue: (() => void)[] = [];

  // 内部時間（ms）
  private currentTime = 0;
  private tickCount = 0;

  // 実行中フラグ
  private running = false;

  // トレース
  events: LoopEvent[] = [];
  onEvent: ((event: LoopEvent) => void) | undefined;

  private emit(event: LoopEvent): void {
    this.events.push(event);
    this.onEvent?.(event);
  }

  // === タイマー API（setTimeout / setInterval）===

  setTimeout(callback: () => void, delay: number): number {
    const id = this.nextTimerId++;
    this.timers.push({
      id, callback, delay: Math.max(0, delay),
      registeredAt: this.currentTime, interval: false, cancelled: false,
    });
    this.emit({ type: "timer_register", timerId: id, delay, interval: false, timestamp: this.currentTime });
    return id;
  }

  setInterval(callback: () => void, delay: number): number {
    const id = this.nextTimerId++;
    this.timers.push({
      id, callback, delay: Math.max(0, delay),
      registeredAt: this.currentTime, interval: true, cancelled: false,
    });
    this.emit({ type: "timer_register", timerId: id, delay, interval: true, timestamp: this.currentTime });
    return id;
  }

  clearTimeout(id: number): void {
    const timer = this.timers.find(t => t.id === id);
    if (timer !== undefined) {
      timer.cancelled = true;
      this.emit({ type: "timer_cancel", timerId: id, timestamp: this.currentTime });
    }
  }

  clearInterval(id: number): void {
    this.clearTimeout(id);
  }

  // === setImmediate ===

  setImmediate(callback: () => void): void {
    this.immediateQueue.push(callback);
  }

  // === process.nextTick ===

  nextTick(callback: () => void): void {
    this.nextTickQueue.push(callback);
  }

  // === Promise microtask ===

  queueMicrotask(callback: () => void): void {
    this.microtaskQueue.push(callback);
  }

  // === I/O コールバック登録（fs モジュール等から呼ばれる）===

  enqueuePendingCallback(callback: () => void, description: string): void {
    const id = this.nextCallbackId++;
    this.pendingCallbacks.push({ id, callback, description });
  }

  // === イベントループ実行 ===

  // 1 tick（全フェーズを1周）実行
  tick(): boolean {
    this.tickCount++;
    // 時間を進める（タイマー判定の前に）
    this.currentTime++;

    // --- nextTick + microtask（各フェーズの間に実行）---
    this.drainNextTickAndMicrotasks();

    // --- Phase 1: Timers ---
    this.emit({ type: "phase_enter", phase: Phase.Timers, timestamp: this.currentTime });
    this.processTimers();
    this.drainNextTickAndMicrotasks();

    // --- Phase 2: Pending Callbacks ---
    this.emit({ type: "phase_enter", phase: Phase.PendingCallbacks, timestamp: this.currentTime });
    this.processPendingCallbacks();
    this.drainNextTickAndMicrotasks();

    // --- Phase 3: Poll ---
    this.emit({ type: "phase_enter", phase: Phase.Poll, timestamp: this.currentTime });
    // (シミュレータでは poll は明示的に何もしない)

    // --- Phase 4: Check (setImmediate) ---
    this.emit({ type: "phase_enter", phase: Phase.Check, timestamp: this.currentTime });
    this.processImmediates();
    this.drainNextTickAndMicrotasks();

    // --- Phase 5: Close ---
    this.emit({ type: "phase_enter", phase: Phase.Close, timestamp: this.currentTime });

    this.emit({ type: "tick_complete", tickNumber: this.tickCount, timestamp: this.currentTime });

    // ループを続けるべきか判定
    return this.hasWork();
  }

  // 指定回数の tick を実行
  run(maxTicks = 1000): number {
    this.running = true;
    let executed = 0;
    while (this.running && executed < maxTicks) {
      if (!this.tick()) {
        this.emit({ type: "loop_exit", timestamp: this.currentTime });
        break;
      }
      executed++;
    }
    this.running = false;
    return executed;
  }

  stop(): void {
    this.running = false;
  }

  // まだ処理すべきものがあるか
  private hasWork(): boolean {
    const activeTimers = this.timers.filter(t => !t.cancelled);
    return activeTimers.length > 0 ||
           this.pendingCallbacks.length > 0 ||
           this.immediateQueue.length > 0 ||
           this.nextTickQueue.length > 0 ||
           this.microtaskQueue.length > 0;
  }

  // --- 各フェーズの処理 ---

  private processTimers(): void {
    // 期限が来たタイマーを発火
    const readyTimers = this.timers.filter(t =>
      !t.cancelled && (this.currentTime - t.registeredAt) >= t.delay,
    );

    for (const timer of readyTimers) {
      if (timer.cancelled) continue;
      this.emit({ type: "timer_fire", timerId: timer.id, delay: timer.delay, timestamp: this.currentTime });
      timer.callback();

      if (timer.interval) {
        // interval: 次の発火時刻を再設定
        timer.registeredAt = this.currentTime;
      } else {
        // timeout: 削除
        timer.cancelled = true;
      }
    }

    // キャンセルされたタイマーを掃除
    this.timers = this.timers.filter(t => !t.cancelled);
  }

  private processPendingCallbacks(): void {
    const callbacks = [...this.pendingCallbacks];
    this.pendingCallbacks = [];
    for (const cb of callbacks) {
      this.emit({ type: "io_callback", description: cb.description, timestamp: this.currentTime });
      cb.callback();
    }
  }

  private processImmediates(): void {
    const queue = [...this.immediateQueue];
    this.immediateQueue = [];
    for (const cb of queue) {
      this.emit({ type: "immediate_fire", timestamp: this.currentTime });
      cb();
    }
  }

  private drainNextTickAndMicrotasks(): void {
    // nextTick は microtask より先に処理される
    while (this.nextTickQueue.length > 0 || this.microtaskQueue.length > 0) {
      while (this.nextTickQueue.length > 0) {
        const cb = this.nextTickQueue.shift();
        if (cb !== undefined) {
          this.emit({ type: "nexttick", timestamp: this.currentTime });
          cb();
        }
      }
      while (this.microtaskQueue.length > 0) {
        const cb = this.microtaskQueue.shift();
        if (cb !== undefined) {
          this.emit({ type: "microtask", timestamp: this.currentTime });
          cb();
        }
      }
    }
  }

  getCurrentTime(): number { return this.currentTime; }
  getTickCount(): number { return this.tickCount; }
  getTimerCount(): number { return this.timers.filter(t => !t.cancelled).length; }
  getPendingCount(): number { return this.pendingCallbacks.length; }

  resetEvents(): void {
    this.events = [];
  }
}
