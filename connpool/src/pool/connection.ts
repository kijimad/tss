/**
 * connection.ts — 仮想データベースコネクションのシミュレーション
 */

/** コネクションの状態 */
export type ConnState = "creating" | "idle" | "active" | "destroying" | "closed" | "error";

/** コネクションイベント */
export interface ConnEvent {
  time: number;
  connId: number;
  type: "create" | "acquire" | "release" | "destroy" | "error" | "timeout" | "query" | "idle_expire" | "enqueue" | "dequeue";
  detail: string;
}

/** シミュレーション用の仮想コネクション */
export class Connection {
  readonly id: number;
  state: ConnState = "creating";
  /** 作成された時刻（シミュレーション tick） */
  readonly createdAt: number;
  /** 最後に使用された時刻 */
  lastUsedAt: number;
  /** 現在実行中のクエリ名 */
  currentQuery: string | null = null;
  /** クエリ残りティック数 */
  queryRemaining = 0;
  /** エラー発生フラグ */
  hasError = false;

  constructor(id: number, tick: number) {
    this.id = id;
    this.createdAt = tick;
    this.lastUsedAt = tick;
  }
}

/** プール設定 */
export interface PoolConfig {
  /** 最小接続数 */
  minSize: number;
  /** 最大接続数 */
  maxSize: number;
  /** 接続作成にかかる tick 数 */
  createTime: number;
  /** アイドルタイムアウト（tick 数、0 で無制限） */
  idleTimeout: number;
  /** キュー待ちの最大 tick 数（0 で無制限） */
  acquireTimeout: number;
  /** 接続の最大生存 tick 数（0 で無制限） */
  maxLifetime: number;
  /** 接続エラー確率（0〜1） */
  errorRate: number;
}

/** クエリリクエスト */
export interface QueryRequest {
  name: string;
  /** クエリ実行にかかる tick 数 */
  duration: number;
  /** リクエスト発行 tick */
  enqueuedAt: number;
  /** タイムアウトしたか */
  timedOut?: boolean;
}
