/* ネットワークプリンタ シミュレーター 型定義 */

/** プリンタ状態 */
export type PrinterState = "idle" | "printing" | "warming_up" | "error" | "offline" | "paper_jam" | "toner_low" | "sleep";

/** プリンタ種別 */
export type PrinterType = "laser_bw" | "laser_color" | "inkjet" | "thermal";

/** 用紙サイズ */
export type PaperSize = "A4" | "A3" | "Letter" | "Legal" | "B5";

/** 印刷品質 */
export type PrintQuality = "draft" | "normal" | "high";

/** プロトコル */
export type Protocol = "ipp" | "lpd" | "raw9100" | "snmp" | "bonjour" | "ws_discovery";

/** プリンタ */
export interface Printer {
  id: string;
  name: string;
  type: PrinterType;
  ip: string;
  mac: string;
  state: PrinterState;
  /** 印刷速度 (pages per minute) */
  ppm: number;
  /** 用紙残量 (枚) */
  paperRemaining: number;
  /** トナー/インク残量 (%) */
  tonerLevel: number;
  /** 対応プロトコル */
  protocols: Protocol[];
  /** 印刷キュー */
  queue: PrintJob[];
  /** 現在印刷中のジョブ */
  currentJob: PrintJob | null;
  /** 印刷済みページ数 */
  totalPrinted: number;
  /** 両面印刷対応 */
  duplex: boolean;
  /** カラー対応 */
  color: boolean;
  /** ウォームアップ時間 (tick) */
  warmupTicks: number;
  /** エラーメッセージ */
  errorMessage?: string;
}

/** 印刷ジョブ */
export interface PrintJob {
  id: number;
  name: string;
  owner: string;
  /** 送信元IP */
  sourceIp: string;
  pages: number;
  /** 印刷済みページ */
  printedPages: number;
  paperSize: PaperSize;
  quality: PrintQuality;
  color: boolean;
  duplex: boolean;
  copies: number;
  /** バイト数 */
  sizeBytes: number;
  /** 転送済みバイト */
  transferredBytes: number;
  state: "queued" | "transferring" | "processing" | "printing" | "completed" | "cancelled" | "error";
  /** 送信プロトコル */
  protocol: Protocol;
  /** 作成時刻 (tick) */
  createdAt: number;
  /** 優先度 (1-9, 1=最高) */
  priority: number;
}

/** ネットワークパケット */
export interface NetPacket {
  src: string;
  dst: string;
  protocol: Protocol;
  type: "discovery" | "job_submit" | "data_transfer" | "status_query" | "status_response" | "ack" | "error";
  payload: string;
}

/** クライアントPC */
export interface Client {
  name: string;
  ip: string;
  os: string;
}

/** イベント種別 */
export type EventType =
  | "discovery" | "connect" | "submit" | "transfer" | "process"
  | "print_start" | "print_page" | "print_done"
  | "status" | "error" | "paper_jam" | "toner_low" | "paper_out"
  | "warmup" | "cancel" | "queue" | "network" | "comment";

/** シミュレーションイベント */
export interface SimEvent {
  type: EventType;
  tick: number;
  message: string;
  detail?: string;
}

/** 命令 */
export type PrintInstr =
  | { op: "add_printer"; printer: Omit<Printer, "queue" | "currentJob" | "totalPrinted" | "errorMessage"> }
  | { op: "add_client"; client: Client }
  | { op: "discover"; clientName: string; protocol: Protocol }
  | { op: "submit_job"; clientName: string; printerName: string; job: Omit<PrintJob, "id" | "printedPages" | "transferredBytes" | "state" | "createdAt"> }
  | { op: "transfer_data"; printerName: string }
  | { op: "process_queue"; printerName: string }
  | { op: "print_tick"; printerName: string }
  | { op: "cancel_job"; printerName: string; jobId: number }
  | { op: "status_query"; clientName: string; printerName: string; protocol: Protocol }
  | { op: "paper_jam"; printerName: string }
  | { op: "clear_jam"; printerName: string }
  | { op: "add_paper"; printerName: string; sheets: number }
  | { op: "replace_toner"; printerName: string }
  | { op: "set_offline"; printerName: string }
  | { op: "set_online"; printerName: string }
  | { op: "comment"; text: string };

/** シミュレーション設定 */
export interface SimConfig {
  maxTicks: number;
}

/** シミュレーション操作 */
export interface SimOp {
  type: "execute";
  config: SimConfig;
  instructions: PrintInstr[];
}

/** 1ステップの結果 */
export interface StepResult {
  tick: number;
  instruction: PrintInstr;
  printers: Printer[];
  clients: Client[];
  packets: NetPacket[];
  message: string;
}

/** シミュレーション結果 */
export interface SimulationResult {
  steps: StepResult[];
  events: SimEvent[];
}

/** プリセット */
export interface Preset {
  name: string;
  description: string;
  build: () => SimOp[];
}
