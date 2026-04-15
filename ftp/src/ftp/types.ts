/**
 * FTPプロトコルシミュレーションで使用する型定義モジュール。
 * RFC 959に基づくFTPコマンド、セッション状態、ファイルシステム構造、
 * シミュレーション結果などのインターフェースを定義する。
 * @module ftp/types
 */

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

/**
 * 仮想ファイルシステムのエントリ（ファイルまたはディレクトリ）。
 * ディレクトリの場合はchildrenを、ファイルの場合はcontentを持つ。
 */
export interface FsEntry {
  /** エントリ名（ファイル名またはディレクトリ名） */
  name: string;
  /** エントリの種別 */
  type: "file" | "directory";
  /** ファイルサイズ（バイト単位） */
  size: number;
  /** 最終更新日時（"YYYY-MM-DD HH:mm"形式） */
  modified: string;
  /** UNIXパーミッション文字列（例: "rwxr-xr-x"） */
  permissions: string;
  /** 所有者ユーザー名 */
  owner: string;
  /** ファイルの内容（ファイルの場合のみ） */
  content?: string;
  /** 子エントリの配列（ディレクトリの場合のみ） */
  children?: FsEntry[];
}

/** FTP認証用のユーザー情報 */
export interface FtpUser {
  /** ログインユーザー名 */
  username: string;
  /** ログインパスワード */
  password: string;
  /** ログイン後のホームディレクトリパス */
  homeDir: string;
}

/** FTPコントロール接続上のメッセージ（クライアントコマンドまたはサーバーレスポンス） */
export interface ControlMessage {
  /** メッセージの送信元方向 */
  direction: "client" | "server";
  /** 生のプロトコルメッセージ文字列 */
  raw: string;
  /** メッセージの日本語説明 */
  description: string;
}

/** FTPデータ接続上で行われるデータ転送の情報 */
export interface DataTransfer {
  /** 転送モード（アクティブまたはパッシブ） */
  mode: TransferMode;
  /** データ型（ASCIIまたはバイナリ） */
  type: DataType;
  /** 転送方向（アップロード、ダウンロード、一覧取得） */
  direction: "upload" | "download" | "listing";
  /** 転送データの内容 */
  data: string;
  /** 転送データのサイズ（バイト単位） */
  size: number;
}

/** FTPセッションの現在の状態を表す */
export interface SessionState {
  /** サーバーに接続中かどうか */
  connected: boolean;
  /** 認証済みかどうか */
  authenticated: boolean;
  /** 認証済みのユーザー名 */
  username: string;
  /** 現在の作業ディレクトリ */
  cwd: string;
  /** 現在の転送モード */
  transferMode: TransferMode;
  /** 現在のデータ型 */
  dataType: DataType;
  /** RNFR（リネーム元）で指定されたパス（RNTO待ち状態） */
  renameFrom: string | null;
  /** パッシブモードで割り当てられたポート番号 */
  pasvPort: number | null;
}

/** シミュレーションの1ステップを表す（コマンド実行とその結果） */
export interface SimStep {
  /** ステップ番号（0始まり） */
  step: number;
  /** 実行されたFTPコマンド（接続ステップではundefined） */
  command?: { cmd: FtpCommand; arg: string };
  /** コントロール接続上のメッセージ一覧 */
  control: ControlMessage[];
  /** データ転送が発生した場合の情報 */
  dataTransfer?: DataTransfer;
  /** このステップ終了時のセッション状態 */
  session: SessionState;
  /** ステップの日本語説明 */
  description: string;
}

/** シミュレーション全体の実行結果 */
export interface SimulationResult {
  /** 全ステップの記録 */
  steps: SimStep[];
  /** セッション終了後のファイルシステム状態 */
  finalFs: FsEntry;
}

/** クライアントが送信するFTPコマンドの定義 */
export interface ClientCommand {
  /** FTPコマンド名 */
  cmd: FtpCommand;
  /** コマンド引数（引数なしの場合は空文字列） */
  arg: string;
}

/** シミュレーションプリセットの定義（シナリオ） */
export interface Preset {
  /** プリセット名（UIに表示される） */
  name: string;
  /** プリセットの説明文 */
  description: string;
  /** シミュレーションで使用するユーザー一覧 */
  users: FtpUser[];
  /** シミュレーション開始時のファイルシステム */
  fs: FsEntry;
  /** 順次実行するFTPコマンドの配列 */
  commands: ClientCommand[];
}
