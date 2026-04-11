/* UNIX セマフォ シミュレーター 型定義 */

/** プロセス/スレッドID */
export type Pid = number;

/** プロセス状態 */
export type ProcessState = "ready" | "running" | "blocked" | "terminated";

/** ブロック理由 */
export type BlockReason = "sem_wait" | "sleep" | "join";

/** プロセス/スレッド */
export interface Process {
  pid: Pid;
  name: string;
  state: ProcessState;
  pc: number;
  /** ブロック理由 */
  blockReason?: BlockReason;
  blockDetail?: string;
  /** join待ちの対象 */
  joinTarget?: Pid;
  /** CPU時間 */
  cpuTime: number;
  /** 待ち時間 */
  waitTime: number;
  /** ローカル変数 */
  locals: Record<string, number>;
}

/** セマフォ種別 */
export type SemType = "counting" | "binary";

/** セマフォ */
export interface Semaphore {
  /** セマフォ名 */
  name: string;
  /** 現在の値 */
  value: number;
  /** 初期値 */
  initialValue: number;
  /** 種別 */
  type: SemType;
  /** 待ちキュー */
  waitQueue: Pid[];
  /** 名前付きセマフォか */
  named: boolean;
  /** 累計 post 回数 */
  postCount: number;
  /** 累計 wait 回数 */
  waitCount: number;
}

/** 共有変数 */
export interface SharedVar {
  name: string;
  value: number;
  lastWriter: Pid | null;
  accessLog: AccessLog[];
}

/** アクセスログ */
export interface AccessLog {
  pid: Pid;
  op: "read" | "write";
  value: number;
  tick: number;
}

/** 命令 */
export type SemInstr =
  | { op: "sem_init"; name: string; value: number; type?: SemType }
  | { op: "sem_open"; name: string; value: number }
  | { op: "sem_wait"; name: string }
  | { op: "sem_trywait"; name: string }
  | { op: "sem_timedwait"; name: string; timeout: number }
  | { op: "sem_post"; name: string }
  | { op: "sem_getvalue"; name: string; into: string }
  | { op: "sem_close"; name: string }
  | { op: "sem_destroy"; name: string }
  | { op: "create"; name: string; instructions: SemInstr[] }
  | { op: "join"; pid: Pid }
  | { op: "read"; varName: string; into: string }
  | { op: "write"; varName: string; value: number }
  | { op: "increment"; varName: string }
  | { op: "decrement"; varName: string }
  | { op: "sleep"; ticks: number }
  | { op: "yield" }
  | { op: "exit"; code?: number }
  | { op: "comment"; text: string };

/** シミュレーション設定 */
export interface SimConfig {
  scheduler: "round_robin" | "fifo";
  timeSlice: number;
  maxTicks: number;
}

/** シミュレーション操作 */
export interface SimOp {
  type: "execute";
  config: SimConfig;
  sharedVars: { name: string; value: number }[];
  mainInstructions: SemInstr[];
}

/** イベント種別 */
export type EventType =
  | "create" | "terminate" | "schedule"
  | "sem_wait" | "sem_post" | "sem_block" | "sem_wakeup"
  | "sem_trywait_fail" | "sem_timedout"
  | "deadlock" | "race" | "comment";

/** シミュレーションイベント */
export interface SimEvent {
  type: EventType;
  tick: number;
  message: string;
}

/** 1ティックの結果 */
export interface TickResult {
  tick: number;
  runningPid: Pid | null;
  instruction?: SemInstr;
  processes: Process[];
  semaphores: Semaphore[];
  sharedVars: SharedVar[];
  message: string;
  warning?: string;
}

/** シミュレーション結果 */
export interface SimulationResult {
  ticks: TickResult[];
  events: SimEvent[];
  deadlockDetected: boolean;
}

/** プリセット */
export interface Preset {
  name: string;
  description: string;
  build: () => SimOp[];
}
