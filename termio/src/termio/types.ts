/* UNIX 端末入出力 シミュレーター 型定義 */

/** 端末モード */
export type TermMode = "canonical" | "raw" | "cbreak";

/** ローカルフラグ (c_lflag) */
export interface LocalFlags {
  /** エコーバック */
  ECHO: boolean;
  /** 正規モード（行バッファリング） */
  ICANON: boolean;
  /** シグナル生成 (Ctrl+C→SIGINT等) */
  ISIG: boolean;
  /** 入力文字のエコーを改行付きで表示 */
  ECHONL: boolean;
  /** EOF文字のエコーを抑制 */
  ECHOCTL: boolean;
}

/** 入力フラグ (c_iflag) */
export interface InputFlags {
  /** CR→NL変換 */
  ICRNL: boolean;
  /** NL→CR変換 */
  INLCR: boolean;
  /** ストリップ8bit目 */
  ISTRIP: boolean;
  /** XON/XOFF フロー制御 */
  IXON: boolean;
}

/** 出力フラグ (c_oflag) */
export interface OutputFlags {
  /** 出力処理有効 */
  OPOST: boolean;
  /** NL→CRNL変換 */
  ONLCR: boolean;
}

/** 特殊文字設定 (c_cc) */
export interface ControlChars {
  VINTR: string;    // Ctrl+C → SIGINT
  VQUIT: string;    // Ctrl+\ → SIGQUIT
  VSUSP: string;    // Ctrl+Z → SIGTSTP
  VEOF: string;     // Ctrl+D → EOF
  VERASE: string;   // Backspace
  VKILL: string;    // Ctrl+U → 行削除
  VSTART: string;   // Ctrl+Q → XON
  VSTOP: string;    // Ctrl+S → XOFF
  VEOL: string;     // 行末文字
  VMIN: number;     // rawモードの最小バイト数
  VTIME: number;    // rawモードのタイムアウト(1/10秒)
}

/** termios 構造体 */
export interface Termios {
  iflag: InputFlags;
  oflag: OutputFlags;
  lflag: LocalFlags;
  cc: ControlChars;
}

/** TTYデバイス */
export interface TTY {
  /** デバイス名 */
  name: string;
  /** termios設定 */
  termios: Termios;
  /** 入力バッファ（line discipline） */
  inputBuffer: string;
  /** 出力バッファ */
  outputBuffer: string;
  /** 画面内容（最終的な表示） */
  screen: string[];
  /** フロー制御停止中 */
  stopped: boolean;
  /** 前景プロセスグループID */
  foregroundPgid: number;
}

/** PTY（擬似端末） */
export interface PTY {
  /** マスター側fd */
  masterFd: number;
  /** スレーブ側デバイス名 */
  slaveName: string;
  /** マスター側出力バッファ */
  masterOutput: string;
}

/** ファイルディスクリプタ */
export interface FileDescriptor {
  fd: number;
  target: "tty" | "pipe" | "file" | "pty_master" | "pty_slave";
  mode: "read" | "write" | "readwrite";
  name: string;
}

/** プロセス */
export interface TermProcess {
  pid: number;
  name: string;
  pgid: number;
  sid: number;
  fds: FileDescriptor[];
  state: "running" | "stopped" | "terminated";
}

/** シグナル */
export type SignalType = "SIGINT" | "SIGQUIT" | "SIGTSTP" | "SIGCONT" | "SIGHUP" | "SIGWINCH" | "SIGTTOU" | "SIGTTIN";

/** シミュレーションイベント */
export interface SimEvent {
  type: "input" | "output" | "signal" | "termios_change" | "line_discipline" | "pty" | "flow_control" | "echo" | "comment";
  tick: number;
  message: string;
  detail?: string;
}

/** 命令 */
export type TermInstr =
  | { op: "keypress"; char: string }
  | { op: "write_stdout"; text: string }
  | { op: "write_stderr"; text: string }
  | { op: "read_stdin" }
  | { op: "tcgetattr" }
  | { op: "tcsetattr"; changes: Partial<{ iflag: Partial<InputFlags>; oflag: Partial<OutputFlags>; lflag: Partial<LocalFlags>; cc: Partial<ControlChars> }> }
  | { op: "set_raw" }
  | { op: "set_canonical" }
  | { op: "set_cbreak" }
  | { op: "pty_open" }
  | { op: "pty_write"; text: string }
  | { op: "pty_read" }
  | { op: "send_signal"; signal: SignalType; pid: number }
  | { op: "fg_process"; pid: number }
  | { op: "bg_process"; pid: number }
  | { op: "spawn"; name: string; pgid?: number }
  | { op: "ansi_escape"; seq: string; desc: string }
  | { op: "comment"; text: string };

/** シミュレーション設定 */
export interface SimConfig {
  maxTicks: number;
}

/** シミュレーション操作 */
export interface SimOp {
  type: "execute";
  config: SimConfig;
  ttyName: string;
  instructions: TermInstr[];
}

/** 1ステップの結果 */
export interface StepResult {
  tick: number;
  instruction: TermInstr;
  tty: TTY;
  pty: PTY | null;
  processes: TermProcess[];
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
