/* UNIX 擬似端末 (PTY) シミュレーター 型定義 */

/** ファイルディスクリプタ番号 */
export type Fd = number;

/** プロセスID */
export type Pid = number;

/** セッションID */
export type Sid = number;

/** PTY状態 */
export type PtyState = "allocated" | "granted" | "unlocked" | "open" | "closed";

/** PTYペア */
export interface PtyPair {
  id: number;
  /** マスター側fd */
  masterFd: Fd;
  /** スレーブ側デバイスパス */
  slavePath: string;
  /** スレーブ側fd（openされている場合） */
  slaveFd: Fd | null;
  /** 状態 */
  state: PtyState;
  /** マスター→スレーブのデータバッファ */
  masterToSlave: string;
  /** スレーブ→マスターのデータバッファ */
  slaveToMaster: string;
  /** 制御端末として割当済みセッション */
  controllingSession: Sid | null;
  /** ウィンドウサイズ */
  winSize: { rows: number; cols: number };
  /** エコーモード */
  echo: boolean;
  /** 正規モード */
  canonical: boolean;
}

/** プロセス */
export interface PtyProcess {
  pid: Pid;
  name: string;
  ppid: Pid;
  pgid: Pid;
  sid: Sid;
  state: "running" | "stopped" | "terminated";
  /** 開いているfd一覧 */
  fds: FdEntry[];
  /** セッションリーダーか */
  sessionLeader: boolean;
  /** 制御端末 */
  ctty: string | null;
}

/** FDエントリ */
export interface FdEntry {
  fd: Fd;
  target: string;
  mode: "read" | "write" | "readwrite";
}

/** データフロー経路 */
export interface DataFlow {
  from: string;
  through: string;
  to: string;
  data: string;
  direction: "master→slave" | "slave→master";
}

/** イベント種別 */
export type EventType =
  | "pty_alloc" | "pty_grant" | "pty_unlock" | "pty_open" | "pty_close"
  | "data_flow" | "session" | "ctty" | "signal" | "winsize"
  | "fork" | "exec" | "setsid" | "ioctl"
  | "comment";

/** シミュレーションイベント */
export interface SimEvent {
  type: EventType;
  tick: number;
  message: string;
  detail?: string;
}

/** 命令 */
export type PtyInstr =
  | { op: "posix_openpt" }
  | { op: "grantpt" }
  | { op: "unlockpt" }
  | { op: "ptsname" }
  | { op: "open_slave" }
  | { op: "close_fd"; fd: Fd }
  | { op: "write_master"; data: string }
  | { op: "read_master" }
  | { op: "write_slave"; data: string }
  | { op: "read_slave" }
  | { op: "fork"; childName: string; childInstrs?: PtyInstr[] }
  | { op: "exec"; program: string }
  | { op: "setsid" }
  | { op: "ioctl_tiocsctty" }
  | { op: "ioctl_tiocgwinsz" }
  | { op: "ioctl_tiocswinsz"; rows: number; cols: number }
  | { op: "dup2"; srcFd: Fd; dstFd: Fd }
  | { op: "set_echo"; enabled: boolean }
  | { op: "set_canonical"; enabled: boolean }
  | { op: "send_sigwinch" }
  | { op: "send_sigint" }
  | { op: "send_sighup" }
  | { op: "wait_child" }
  | { op: "comment"; text: string };

/** シミュレーション設定 */
export interface SimConfig {
  maxTicks: number;
}

/** シミュレーション操作 */
export interface SimOp {
  type: "execute";
  config: SimConfig;
  instructions: PtyInstr[];
}

/** 1ステップの結果 */
export interface StepResult {
  tick: number;
  instruction: PtyInstr;
  ptyPairs: PtyPair[];
  processes: PtyProcess[];
  dataFlows: DataFlow[];
  events: SimEvent[];
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
