/** Goroutine状態 */
export type GoroutineState = "runnable" | "running" | "blocked" | "waiting" | "dead";

/** Goroutine */
export interface Goroutine {
  id: number;
  name: string;
  state: GoroutineState;
  /** 所属するP (プロセッサ) */
  pId?: number;
  /** ブロック理由 */
  blockReason?: string;
  /** スタックサイズ (KB) */
  stackSize: number;
}

/** Channel */
export interface Channel {
  id: number;
  name: string;
  /** バッファ容量 (0=unbuffered) */
  capacity: number;
  /** バッファ内データ */
  buffer: string[];
  /** 送信待ちgoroutine */
  sendQueue: number[];
  /** 受信待ちgoroutine */
  recvQueue: number[];
  closed: boolean;
}

/** Mutex */
export interface Mutex {
  id: number;
  name: string;
  locked: boolean;
  /** ロック保持goroutine */
  owner?: number;
  /** ロック待ちgoroutine */
  waitQueue: number[];
}

/** WaitGroup */
export interface WaitGroup {
  id: number;
  name: string;
  counter: number;
  /** Wait()中のgoroutine */
  waiters: number[];
}

/** GMP スケジューラ: P (Processor) */
export interface Processor {
  id: number;
  /** 現在実行中のG */
  currentG?: number;
  /** ローカルランキュー */
  localRunQueue: number[];
}

/** GMP スケジューラ: M (Machine / OS Thread) */
export interface MachineThread {
  id: number;
  /** バインドされたP */
  pId?: number;
  /** 実行中のG */
  currentG?: number;
  state: "running" | "idle" | "syscall";
}

/** シミュレーション操作 */
export type SimOp =
  | { type: "go"; id: number; name: string }
  | { type: "chan_make"; id: number; name: string; capacity: number }
  | { type: "chan_send"; goroutineId: number; chanId: number; value: string }
  | { type: "chan_recv"; goroutineId: number; chanId: number }
  | { type: "chan_close"; goroutineId: number; chanId: number }
  | { type: "select"; goroutineId: number; cases: SelectCase[] }
  | { type: "mutex_make"; id: number; name: string }
  | { type: "mutex_lock"; goroutineId: number; mutexId: number }
  | { type: "mutex_unlock"; goroutineId: number; mutexId: number }
  | { type: "wg_make"; id: number; name: string }
  | { type: "wg_add"; wgId: number; delta: number }
  | { type: "wg_done"; goroutineId: number; wgId: number }
  | { type: "wg_wait"; goroutineId: number; wgId: number }
  | { type: "goroutine_exit"; goroutineId: number }
  | { type: "schedule" }
  | { type: "set_gomaxprocs"; n: number };

/** select case */
export interface SelectCase {
  dir: "send" | "recv";
  chanId: number;
  value?: string;
  /** default caseか */
  isDefault?: boolean;
}

/** イベント種別 */
export type EventType =
  | "goroutine_create"
  | "goroutine_run"
  | "goroutine_block"
  | "goroutine_unblock"
  | "goroutine_exit"
  | "chan_make"
  | "chan_send"
  | "chan_send_block"
  | "chan_recv"
  | "chan_recv_block"
  | "chan_close"
  | "chan_recv_closed"
  | "select_enter"
  | "select_case"
  | "select_default"
  | "mutex_lock"
  | "mutex_lock_block"
  | "mutex_unlock"
  | "wg_add"
  | "wg_done"
  | "wg_wait"
  | "wg_wait_block"
  | "wg_release"
  | "schedule"
  | "set_gomaxprocs"
  | "deadlock"
  | "panic";

/** シミュレーションイベント */
export interface SimEvent {
  step: number;
  type: EventType;
  description: string;
  goroutineId?: number;
  chanId?: number;
}

/** シミュレーション結果 */
export interface SimulationResult {
  events: SimEvent[];
  goroutines: Goroutine[];
  channels: Channel[];
  mutexes: Mutex[];
  waitGroups: WaitGroup[];
  processors: Processor[];
  threads: MachineThread[];
  stats: {
    goroutinesCreated: number;
    goroutinesExited: number;
    channelSends: number;
    channelRecvs: number;
    mutexLocks: number;
    contextSwitches: number;
    deadlocks: number;
  };
}

/** プリセット */
export interface Preset {
  name: string;
  description: string;
  ops: SimOp[];
}
