/** プロセスの状態 */
export type ProcessState = "ready" | "running" | "blocked" | "terminated";

/** スケジューリングアルゴリズム */
export type Algorithm =
  | "fcfs"           // First Come First Served
  | "sjf"            // Shortest Job First（非プリエンプティブ）
  | "srtf"           // Shortest Remaining Time First（プリエンプティブ）
  | "rr"             // Round Robin
  | "priority"       // 優先度スケジューリング（非プリエンプティブ）
  | "priority_pre"   // 優先度スケジューリング（プリエンプティブ）
  | "mlfq";          // マルチレベルフィードバックキュー

/** プロセス定義 */
export interface ProcessDef {
  pid: number;
  name: string;
  /** 到着時刻 */
  arrivalTime: number;
  /** CPU実行時間のリスト（I/Oバーストと交互） */
  cpuBursts: number[];
  /** I/Oバースト時間のリスト */
  ioBursts: number[];
  /** 優先度（0が最高） */
  priority: number;
}

/** 実行中のプロセスの状態 */
export interface ProcessRuntime {
  def: ProcessDef;
  state: ProcessState;
  /** 現在のバーストインデックス */
  burstIndex: number;
  /** 現在のバースト残り時間 */
  remainingBurst: number;
  /** 最初に実行された時刻（レスポンスタイム計算用） */
  firstRunTime: number | null;
  /** 完了時刻 */
  finishTime: number | null;
  /** 待ち時間（レディキューで待った時間） */
  waitTime: number;
  /** I/O完了予定時刻 */
  ioCompleteTime: number | null;
  /** MLFQの現在キューレベル */
  queueLevel: number;
  /** 現在のタイムスライス消費量 */
  sliceUsed: number;
}

/** スケジューラ設定 */
export interface SchedulerConfig {
  algorithm: Algorithm;
  /** タイムクォンタム（RR, MLFQ用） */
  timeQuantum: number;
  /** MLFQのキュー数 */
  mlfqLevels: number;
  /** MLFQの各レベルのタイムクォンタム */
  mlfqQuantums: number[];
}

/** タイムラインイベント */
export interface TimelineEvent {
  time: number;
  type:
    | "arrive"       // プロセス到着
    | "dispatch"     // CPUにディスパッチ
    | "preempt"      // プリエンプション
    | "block_io"     // I/Oブロック
    | "io_complete"  // I/O完了
    | "terminate"    // 終了
    | "idle"         // CPUアイドル
    | "queue_demote" // MLFQキュー降格
    | "context_switch"; // コンテキストスイッチ
  pid?: number;
  description: string;
}

/** ガントチャートのエントリ */
export interface GanttEntry {
  pid: number | null; // nullはアイドル
  name: string;
  start: number;
  end: number;
}

/** プロセスごとの統計 */
export interface ProcessStats {
  pid: number;
  name: string;
  arrivalTime: number;
  finishTime: number;
  /** ターンアラウンドタイム */
  turnaroundTime: number;
  /** 待ち時間 */
  waitTime: number;
  /** レスポンスタイム */
  responseTime: number;
}

/** シミュレーション結果 */
export interface SimulationResult {
  algorithm: Algorithm;
  config: SchedulerConfig;
  /** ガントチャート */
  gantt: GanttEntry[];
  /** タイムラインイベント */
  events: TimelineEvent[];
  /** プロセス統計 */
  processStats: ProcessStats[];
  /** 平均ターンアラウンドタイム */
  avgTurnaround: number;
  /** 平均待ち時間 */
  avgWait: number;
  /** 平均レスポンスタイム */
  avgResponse: number;
  /** CPU利用率 */
  cpuUtilization: number;
  /** 総時間 */
  totalTime: number;
}
