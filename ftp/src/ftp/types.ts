/** FTPコマンド種別 */
export type FtpCommand =
  | "USER" | "PASS" | "SYST" | "PWD" | "CWD" | "CDUP"
  | "TYPE" | "PASV" | "PORT" | "LIST" | "NLST"
  | "RETR" | "STOR" | "DELE" | "MKD" | "RMD"
  | "RNFR" | "RNTO" | "SIZE" | "QUIT" | "NOOP"
  | "FEAT" | "OPTS" | "STAT";

/** 転送モード */
export type TransferMode = "active" | "passive";

/** データ型 */
export type DataType = "A" | "I"; // ASCII / Image(Binary)

/** ファイルシステムエントリ */
export interface FsEntry {
  name: string;
  type: "file" | "directory";
  size: number;
  modified: string;     // "YYYY-MM-DD HH:mm"
  permissions: string;  // "rwxr-xr-x" 等
  owner: string;
  content?: string;     // ファイルの場合の中身
  children?: FsEntry[]; // ディレクトリの場合
}

/** FTPユーザー */
export interface FtpUser {
  username: string;
  password: string;
  homeDir: string;
}

/** コントロール接続メッセージ */
export interface ControlMessage {
  direction: "client" | "server";
  raw: string;
  description: string;
}

/** データ転送イベント */
export interface DataTransfer {
  mode: TransferMode;
  type: DataType;
  direction: "upload" | "download" | "listing";
  data: string;
  size: number;
}

/** FTPセッション状態 */
export interface SessionState {
  connected: boolean;
  authenticated: boolean;
  username: string;
  cwd: string;
  transferMode: TransferMode;
  dataType: DataType;
  renameFrom: string | null;
  pasvPort: number | null;
}

/** シミュレーションステップ */
export interface SimStep {
  step: number;
  command?: { cmd: FtpCommand; arg: string };
  control: ControlMessage[];
  dataTransfer?: DataTransfer;
  session: SessionState;
  description: string;
}

/** シミュレーション結果 */
export interface SimulationResult {
  steps: SimStep[];
  finalFs: FsEntry;
}

/** クライアントコマンド */
export interface ClientCommand {
  cmd: FtpCommand;
  arg: string;
}

/** プリセット定義 */
export interface Preset {
  name: string;
  description: string;
  users: FtpUser[];
  fs: FsEntry;
  commands: ClientCommand[];
}
