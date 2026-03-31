/**
 * pool.ts — コネクションプールのシミュレーションエンジン
 *
 * tick ベースの離散イベントシミュレーションで
 * コネクションプールの挙動を再現する。
 */

import { Connection } from "./connection.js";
import type { ConnState, ConnEvent, PoolConfig, QueryRequest } from "./connection.js";

/** プール全体の統計情報 */
export interface PoolStats {
  total: number;
  idle: number;
  active: number;
  creating: number;
  waiting: number;
  completed: number;
  errors: number;
  timeouts: number;
}

/** ワークロード定義（tick ごとに発生するクエリ） */
export interface WorkloadEntry {
  /** 発行する tick */
  tick: number;
  /** クエリ名 */
  name: string;
  /** 実行 tick 数 */
  duration: number;
}

/** コネクションプール */
export class ConnectionPool {
  readonly config: PoolConfig;
  private connections: Connection[] = [];
  private waitQueue: QueryRequest[] = [];
  private pendingCreations: { conn: Connection; readyAt: number }[] = [];
  private events: ConnEvent[] = [];
  private tick = 0;
  private nextConnId = 1;
  private completedCount = 0;
  private errorCount = 0;
  private timeoutCount = 0;

  constructor(config: PoolConfig) {
    this.config = config;
  }

  /** 現在の tick */
  get currentTick(): number {
    return this.tick;
  }

  /** イベントログ */
  get eventLog(): readonly ConnEvent[] {
    return this.events;
  }

  /** 全コネクション */
  get allConnections(): readonly Connection[] {
    return this.connections;
  }

  /** 待機キュー */
  get queue(): readonly QueryRequest[] {
    return this.waitQueue;
  }

  /** 統計情報 */
  get stats(): PoolStats {
    return {
      total: this.connections.length,
      idle: this.connections.filter((c) => c.state === "idle").length,
      active: this.connections.filter((c) => c.state === "active").length,
      creating: this.pendingCreations.length,
      waiting: this.waitQueue.length,
      completed: this.completedCount,
      errors: this.errorCount,
      timeouts: this.timeoutCount,
    };
  }

  /** プールを初期化する（minSize 分のコネクションを作成開始） */
  initialize(): void {
    for (let i = 0; i < this.config.minSize; i++) {
      this.startCreateConnection();
    }
  }

  /** 1 tick 進める */
  step(): void {
    this.tick++;

    // 1. 作成中のコネクションをチェック
    this.processPendingCreations();

    // 2. アクティブなコネクションのクエリ進行
    this.processActiveConnections();

    // 3. アイドルタイムアウトチェック
    this.processIdleTimeouts();

    // 4. 最大生存時間チェック
    this.processMaxLifetime();

    // 5. キュー待ちタイムアウトチェック
    this.processAcquireTimeouts();

    // 6. キューからコネクションを割り当て
    this.processWaitQueue();
  }

  /** クエリリクエストを発行する */
  submitQuery(name: string, duration: number): void {
    const request: QueryRequest = { name, duration, enqueuedAt: this.tick };

    // アイドルコネクションがあれば即割り当て
    const idle = this.connections.find((c) => c.state === "idle");
    if (idle !== undefined) {
      this.assignQuery(idle, request);
      return;
    }

    // プールに空きがあれば新規作成
    if (this.connections.length + this.pendingCreations.length < this.config.maxSize) {
      this.startCreateConnection();
    }

    // キューに追加
    this.waitQueue.push(request);
    this.emit("enqueue", 0, `"${name}" がキューに追加 (待ち: ${this.waitQueue.length})`);
  }

  /** ワークロードを一括シミュレーションして全 tick を返す */
  runWorkload(workload: WorkloadEntry[], totalTicks: number): {
    snapshots: { tick: number; stats: PoolStats; connections: { id: number; state: ConnState; query: string | null }[] }[];
    events: ConnEvent[];
  } {
    this.reset();
    this.initialize();

    const snapshots: { tick: number; stats: PoolStats; connections: { id: number; state: ConnState; query: string | null }[] }[] = [];

    for (let t = 0; t < totalTicks; t++) {
      // ワークロードのクエリを発行
      for (const entry of workload) {
        if (entry.tick === this.tick + 1) {
          this.submitQuery(entry.name, entry.duration);
        }
      }

      this.step();

      snapshots.push({
        tick: this.tick,
        stats: { ...this.stats },
        connections: this.connections.map((c) => ({
          id: c.id,
          state: c.state,
          query: c.currentQuery,
        })),
      });
    }

    return { snapshots, events: [...this.events] };
  }

  /** プールをリセットする */
  private reset(): void {
    this.connections = [];
    this.waitQueue = [];
    this.pendingCreations = [];
    this.events = [];
    this.tick = 0;
    this.nextConnId = 1;
    this.completedCount = 0;
    this.errorCount = 0;
    this.timeoutCount = 0;
  }

  /** コネクション作成を開始する */
  private startCreateConnection(): void {
    const conn = new Connection(this.nextConnId++, this.tick);
    this.pendingCreations.push({ conn, readyAt: this.tick + this.config.createTime });
    this.emit("create", conn.id, `Conn#${conn.id} 作成開始 (${this.config.createTime} tick)`);
  }

  /** 作成中のコネクションをチェック */
  private processPendingCreations(): void {
    const ready: Connection[] = [];
    this.pendingCreations = this.pendingCreations.filter((p) => {
      if (this.tick >= p.readyAt) {
        // エラー判定
        if (Math.random() < this.config.errorRate) {
          p.conn.state = "error";
          p.conn.hasError = true;
          this.errorCount++;
          this.emit("error", p.conn.id, `Conn#${p.conn.id} 接続エラー`);
          return false;
        }
        p.conn.state = "idle";
        ready.push(p.conn);
        return false;
      }
      return true;
    });
    for (const conn of ready) {
      this.connections.push(conn);
      this.emit("create", conn.id, `Conn#${conn.id} 作成完了 → idle`);
    }
  }

  /** アクティブコネクションのクエリ実行を進行 */
  private processActiveConnections(): void {
    for (const conn of this.connections) {
      if (conn.state !== "active") continue;
      conn.queryRemaining--;
      if (conn.queryRemaining <= 0) {
        const qName = conn.currentQuery ?? "?";
        conn.currentQuery = null;
        conn.state = "idle";
        conn.lastUsedAt = this.tick;
        this.completedCount++;
        this.emit("release", conn.id, `Conn#${conn.id} "${qName}" 完了 → idle`);
      }
    }
  }

  /** アイドルタイムアウトを処理 */
  private processIdleTimeouts(): void {
    if (this.config.idleTimeout <= 0) return;
    const toRemove: Connection[] = [];
    for (const conn of this.connections) {
      if (conn.state !== "idle") continue;
      if (this.tick - conn.lastUsedAt >= this.config.idleTimeout) {
        // minSize 以下にはしない
        const activeCount = this.connections.length - toRemove.length;
        if (activeCount <= this.config.minSize) continue;
        conn.state = "closed";
        toRemove.push(conn);
        this.emit("idle_expire", conn.id, `Conn#${conn.id} アイドルタイムアウト → closed`);
      }
    }
    this.connections = this.connections.filter((c) => !toRemove.includes(c));
  }

  /** 最大生存時間を処理 */
  private processMaxLifetime(): void {
    if (this.config.maxLifetime <= 0) return;
    const toRemove: Connection[] = [];
    for (const conn of this.connections) {
      if (conn.state === "active") continue;
      if (this.tick - conn.createdAt >= this.config.maxLifetime) {
        conn.state = "closed";
        toRemove.push(conn);
        this.emit("destroy", conn.id, `Conn#${conn.id} 最大生存時間超過 → closed`);
      }
    }
    this.connections = this.connections.filter((c) => !toRemove.includes(c));
  }

  /** キュー待ちタイムアウトを処理 */
  private processAcquireTimeouts(): void {
    if (this.config.acquireTimeout <= 0) return;
    this.waitQueue = this.waitQueue.filter((req) => {
      if (this.tick - req.enqueuedAt >= this.config.acquireTimeout) {
        req.timedOut = true;
        this.timeoutCount++;
        this.emit("timeout", 0, `"${req.name}" 取得タイムアウト (${this.config.acquireTimeout} tick 待機)`);
        return false;
      }
      return true;
    });
  }

  /** キューからコネクションを割り当て */
  private processWaitQueue(): void {
    while (this.waitQueue.length > 0) {
      const idle = this.connections.find((c) => c.state === "idle");
      if (idle === undefined) break;
      const request = this.waitQueue.shift()!;
      this.emit("dequeue", idle.id, `"${request.name}" をキューから取得 → Conn#${idle.id}`);
      this.assignQuery(idle, request);
    }
  }

  /** コネクションにクエリを割り当てる */
  private assignQuery(conn: Connection, request: QueryRequest): void {
    conn.state = "active";
    conn.currentQuery = request.name;
    conn.queryRemaining = request.duration;
    conn.lastUsedAt = this.tick;
    this.emit("acquire", conn.id, `Conn#${conn.id} ← "${request.name}" (${request.duration} tick)`);
  }

  /** イベントを記録する */
  private emit(type: ConnEvent["type"], connId: number, detail: string): void {
    this.events.push({ time: this.tick, connId, type, detail });
  }
}
