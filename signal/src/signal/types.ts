/**
 * Unixシグナルシミュレータ — 型定義モジュール
 *
 * Unixシグナルはプロセス間通信（IPC）の非同期通知メカニズムであり、
 * カーネルまたは他のプロセスから対象プロセスに送信される。
 * 各シグナルは番号で識別され、デフォルト動作（終了、コアダンプ、停止、無視など）を持つ。
 *
 * このモジュールでは、シグナルシミュレーションに必要な全ての型・定数を定義する:
 * - シグナル番号とシグナル名の対応
 * - 各シグナルのデフォルト動作
 * - シグナルハンドラ（SIG_DFL / SIG_IGN / カスタム）
 * - プロセスの状態（実行中、停止、ゾンビ、終了など）
 * - シミュレーション操作（kill, raise, sigaction, sigprocmask 等のシステムコールに対応）
 * - シミュレーションイベントと結果
 */

/**
 * 標準シグナル番号の型
 *
 * POSIXで定義される標準シグナル（1〜20）とリアルタイムシグナル（34〜40）を表す。
 * リアルタイムシグナルはSIGRTMIN(34)からSIGRTMAX(64)の範囲で、
 * 標準シグナルと異なり同一番号の重複がキューイングされる。
 * 番号16の欠番はLinux固有のシグナル番号配置を反映している。
 */
export type SignalNumber =
  | 1  | 2  | 3  | 4  | 5  | 6  | 7  | 8  | 9  | 10
  | 11 | 12 | 13 | 14 | 15 | 17 | 18 | 19 | 20
  | 34 | 35 | 36 | 37 | 38 | 39 | 40; // リアルタイムシグナル

/** シグナル名マッピング */
export const SIGNAL_NAMES: Record<number, string> = {
  1: "SIGHUP",    2: "SIGINT",    3: "SIGQUIT",   4: "SIGILL",
  5: "SIGTRAP",   6: "SIGABRT",   7: "SIGBUS",    8: "SIGFPE",
  9: "SIGKILL",   10: "SIGUSR1",  11: "SIGSEGV",  12: "SIGUSR2",
  13: "SIGPIPE",  14: "SIGALRM",  15: "SIGTERM",  17: "SIGCHLD",
  18: "SIGCONT",  19: "SIGSTOP",  20: "SIGTSTP",
  34: "SIGRTMIN",   35: "SIGRTMIN+1", 36: "SIGRTMIN+2",
  37: "SIGRTMIN+3", 38: "SIGRTMIN+4", 39: "SIGRTMIN+5", 40: "SIGRTMIN+6",
};

/** シグナルのデフォルト動作 */
export type DefaultAction = "terminate" | "core_dump" | "stop" | "continue" | "ignore";

export const DEFAULT_ACTIONS: Record<number, DefaultAction> = {
  1: "terminate",  2: "terminate",  3: "core_dump",  4: "core_dump",
  5: "core_dump",  6: "core_dump",  7: "core_dump",  8: "core_dump",
  9: "terminate",  10: "terminate", 11: "core_dump", 12: "terminate",
  13: "terminate", 14: "terminate", 15: "terminate", 17: "ignore",
  18: "continue",  19: "stop",      20: "stop",
  34: "terminate", 35: "terminate", 36: "terminate",
  37: "terminate", 38: "terminate", 39: "terminate", 40: "terminate",
};

/** シグナルハンドラの種別 */
export type HandlerType = "default" | "ignore" | "custom";

/** シグナルハンドラ */
export interface SignalHandler {
  signal: number;
  type: HandlerType;
  /** カスタムハンドラの説明 */
  description?: string;
  /** SA_RESTART フラグ */
  restart?: boolean;
  /** SA_NOCLDSTOP フラグ */
  nocldstop?: boolean;
  /** SA_SIGINFO フラグ (sigqueue対応) */
  siginfo?: boolean;
}

/** プロセス状態 */
export type ProcessState = "running" | "sleeping" | "stopped" | "zombie" | "terminated";

/** プロセス */
export interface Process {
  pid: number;
  ppid: number;
  name: string;
  state: ProcessState;
  uid: number;
  /** シグナルハンドラテーブル */
  handlers: SignalHandler[];
  /** シグナルマスク（ブロック中のシグナル集合） */
  signalMask: number[];
  /** ペンディングシグナル（配送待ち） */
  pendingSignals: PendingSignal[];
}

/** ペンディングシグナル */
export interface PendingSignal {
  signal: number;
  senderPid: number;
  /** sigqueueのデータ */
  value?: number;
  /** タイムスタンプ */
  timestamp: number;
}

/** シミュレーション操作 */
export type SimOp =
  | { type: "process_create"; process: Omit<Process, "handlers" | "signalMask" | "pendingSignals"> }
  | { type: "kill"; senderPid: number; targetPid: number; signal: number }
  | { type: "raise"; pid: number; signal: number }
  | { type: "sigqueue"; senderPid: number; targetPid: number; signal: number; value: number }
  | { type: "sigaction"; pid: number; handler: SignalHandler }
  | { type: "sigmask_block"; pid: number; signals: number[] }
  | { type: "sigmask_unblock"; pid: number; signals: number[] }
  | { type: "sigpending"; pid: number }
  | { type: "sigsuspend"; pid: number; tempMask: number[] }
  | { type: "killpg"; senderPid: number; pgid: number; signal: number }
  | { type: "alarm"; pid: number; seconds: number }
  | { type: "pause"; pid: number }
  | { type: "fork"; parentPid: number; childPid: number; childName: string };

/** イベント種別 */
export type EventType =
  | "process_create"
  | "signal_send"
  | "signal_deliver"
  | "signal_pending"
  | "signal_blocked"
  | "signal_ignored"
  | "handler_invoke"
  | "default_action"
  | "process_terminate"
  | "process_stop"
  | "process_continue"
  | "core_dump"
  | "sigaction_set"
  | "sigmask_update"
  | "sigpending_check"
  | "sigsuspend"
  | "sigqueue_send"
  | "alarm_set"
  | "alarm_fire"
  | "pause"
  | "fork"
  | "killpg"
  | "error";

/** シミュレーションイベント */
export interface SimEvent {
  step: number;
  type: EventType;
  description: string;
  pid?: number;
  signal?: number;
}

/** シミュレーション結果 */
export interface SimulationResult {
  events: SimEvent[];
  processes: Process[];
  stats: {
    totalSignals: number;
    delivered: number;
    blocked: number;
    ignored: number;
    defaultActions: number;
    customHandlers: number;
    processesTerminated: number;
    processesStopped: number;
  };
}

/** プリセット */
export interface Preset {
  name: string;
  description: string;
  ops: SimOp[];
}
