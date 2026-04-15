/**
 * UNIX スレッド シミュレーター 型定義モジュール
 *
 * POSIXスレッド（pthread）の動作をシミュレートするために必要な
 * 全ての型定義を提供する。スレッド、同期プリミティブ、共有メモリ、
 * 命令セット、シミュレーション設定・結果の型を含む。
 */

// ─── スレッド ───

/**
 * スレッド状態
 * - created: 生成直後（まだスケジュール対象外）
 * - ready: 実行可能（スケジューラによる選択待ち）
 * - running: 現在CPU上で実行中
 * - blocked: 同期オブジェクト等で待機中
 * - terminated: 実行完了済み
 */
export type ThreadState = "created" | "ready" | "running" | "blocked" | "terminated";

/**
 * ブロック理由
 * スレッドがblocked状態になった原因を示す
 */
export type BlockReason = "mutex" | "condvar" | "join" | "rwlock" | "barrier" | "sleep";

/** スレッドID */
export type Tid = number;

/**
 * スレッド
 * POSIXスレッドの状態を表現するインターフェース。
 * スレッドID、状態、プログラムカウンタ、ローカル変数などを保持する。
 */
export interface Thread {
  tid: Tid;
  name: string;
  state: ThreadState;
  /** 親スレッドID */
  parentTid: Tid | null;
  /** プログラムカウンタ（命令インデックス） */
  pc: number;
  /** スレッドローカル変数 */
  locals: Record<string, number>;
  /** ブロック理由 */
  blockReason?: BlockReason;
  /** ブロック詳細 */
  blockDetail?: string;
  /** CPU使用時間（タイムスライス数） */
  cpuTime: number;
  /** 待機時間 */
  waitTime: number;
  /** 終了コード */
  exitCode?: number;
  /** join待ちの対象TID */
  joinTarget?: Tid;
  /** detached状態か */
  detached: boolean;
}

// ─── 同期プリミティブ ───

/** Mutex */
export interface Mutex {
  id: string;
  /** ロック保持スレッド */
  owner: Tid | null;
  /** 待ちキュー */
  waitQueue: Tid[];
  /** 再帰ロック回数 */
  lockCount: number;
  /** 再帰mutex か */
  recursive: boolean;
}

/** 条件変数 */
export interface CondVar {
  id: string;
  /** 関連するMutex */
  mutexId: string;
  /** 待ちキュー */
  waitQueue: Tid[];
}

/** Read-Writeロック */
export interface RwLock {
  id: string;
  /** 読み取りロック保持スレッド */
  readers: Tid[];
  /** 書き込みロック保持スレッド */
  writer: Tid | null;
  /** 待ちキュー */
  waitQueue: { tid: Tid; mode: "read" | "write" }[];
}

/** バリア */
export interface Barrier {
  id: string;
  /** 必要スレッド数 */
  count: number;
  /** 到着済みスレッド */
  arrived: Tid[];
}

// ─── 共有メモリ ───

/** 共有変数 */
export interface SharedVar {
  name: string;
  value: number;
  /** 最終書込みスレッド */
  lastWriter: Tid | null;
  /** アクセス履歴 */
  accessLog: { tid: Tid; op: "read" | "write"; value: number; tick: number }[];
}

// ─── スレッド命令 ───

/**
 * スレッド命令
 * シミュレーション中にスレッドが実行可能な全ての操作を定義する判別共用体型。
 * スレッド生成、同期プリミティブ操作、共有変数アクセス、制御フローを含む。
 */
export type ThreadInstr =
  | { op: "create"; name: string; instructions: ThreadInstr[] }
  | { op: "mutex_init"; id: string; recursive?: boolean }
  | { op: "mutex_lock"; id: string }
  | { op: "mutex_unlock"; id: string }
  | { op: "mutex_trylock"; id: string }
  | { op: "cond_init"; id: string; mutexId: string }
  | { op: "cond_wait"; id: string }
  | { op: "cond_signal"; id: string }
  | { op: "cond_broadcast"; id: string }
  | { op: "rwlock_init"; id: string }
  | { op: "rwlock_rdlock"; id: string }
  | { op: "rwlock_wrlock"; id: string }
  | { op: "rwlock_unlock"; id: string }
  | { op: "barrier_init"; id: string; count: number }
  | { op: "barrier_wait"; id: string }
  | { op: "join"; tid: Tid }
  | { op: "detach" }
  | { op: "read"; varName: string; into: string }
  | { op: "write"; varName: string; value: number }
  | { op: "increment"; varName: string }
  | { op: "sleep"; ticks: number }
  | { op: "yield" }
  | { op: "exit"; code?: number }
  | { op: "comment"; text: string };

// ─── シミュレーション ───

/**
 * スケジューラ種別
 * - round_robin: タイムスライスベースのラウンドロビン方式
 * - priority: 優先度ベース（TIDが小さいほど高優先度）
 * - fifo: 先着順実行（プリエンプションなし）
 */
export type SchedulerType = "round_robin" | "priority" | "fifo";

/** シミュレーション設定 */
export interface SimConfig {
  /** スケジューラ */
  scheduler: SchedulerType;
  /** タイムスライス（ラウンドロビン用） */
  timeSlice: number;
  /** 最大実行ティック */
  maxTicks: number;
}

/**
 * 1ティックの実行結果
 * シミュレーションの各ステップにおけるスナップショットを保持する。
 * 全スレッド、同期オブジェクト、共有変数の状態を含む。
 */
export interface TickResult {
  tick: number;
  /** 実行スレッド */
  runningTid: Tid | null;
  /** 実行された命令 */
  instruction?: ThreadInstr;
  /** 全スレッド状態 */
  threads: Thread[];
  /** 同期オブジェクト */
  mutexes: Mutex[];
  condVars: CondVar[];
  rwLocks: RwLock[];
  barriers: Barrier[];
  /** 共有変数 */
  sharedVars: SharedVar[];
  /** メッセージ */
  message: string;
  /** 警告（デッドロック、レースコンディション等） */
  warning?: string;
}

/**
 * シミュレーション操作
 * 1回のシミュレーション実行に必要な設定と命令を定義する。
 */
export interface SimOp {
  type: "execute";
  config: SimConfig;
  /** メインスレッドの命令 */
  mainInstructions: ThreadInstr[];
  /** 共有変数の初期値 */
  sharedVars: { name: string; value: number }[];
}

/** イベント種別 */
export type EventType =
  | "create" | "terminate" | "schedule" | "lock" | "unlock"
  | "wait" | "signal" | "race" | "deadlock" | "info" | "warn";

/**
 * イベント
 * シミュレーション中に発生したイベントの記録。
 * デバッグやログ表示に使用する。
 */
export interface SimEvent {
  type: EventType;
  tick: number;
  message: string;
  detail?: string;
}

/**
 * シミュレーション結果
 * シミュレーション全体の実行結果を保持する。
 * 全ティックの履歴、イベントログ、検出された問題を含む。
 */
export interface SimulationResult {
  ticks: TickResult[];
  events: SimEvent[];
  /** デッドロック検出 */
  deadlockDetected: boolean;
  /** レースコンディション検出 */
  raceConditions: { varName: string; tids: Tid[] }[];
}

/**
 * プリセット
 * UIのセレクトボックスから選択可能な実験シナリオの定義。
 * 名前、説明、およびSimOp配列を生成するビルダ関数を持つ。
 */
export interface Preset {
  name: string;
  description: string;
  build: () => SimOp[];
}
