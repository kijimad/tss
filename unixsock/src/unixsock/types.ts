/** UNIXドメインソケットタイプ */
export type SocketType = "SOCK_STREAM" | "SOCK_DGRAM" | "SOCK_SEQPACKET";

/** ソケットアドレスの種類 */
export type AddressType =
  | "pathname"    // 名前付き（ファイルシステムパス）
  | "unnamed"     // 無名（socketpair で作成）
  | "abstract";   // 抽象名前空間（Linux固有、\0プレフィックス）

/** ソケットアドレス */
export interface SockAddr {
  type: AddressType;
  path: string;      // パス名 or 抽象名
}

/** ソケット状態 */
export type SockState =
  | "UNBOUND"       // 作成直後
  | "BOUND"         // bind済み
  | "LISTENING"     // listen中（STREAM/SEQPACKET）
  | "CONNECTING"    // connect中
  | "CONNECTED"     // 接続確立
  | "CLOSED";       // 閉じた

/** ソケット（fd） */
export interface UnixSocket {
  fd: number;
  socketType: SocketType;
  state: SockState;
  addr?: SockAddr;
  peerAddr?: SockAddr;
  /** 所有プロセス */
  pid: number;
  /** ソケットバッファ（受信データ） */
  recvBuffer: string[];
  /** ソケットバッファサイズ上限 */
  bufferSize: number;
  /** 参照カウント */
  refCount: number;
  /** ピアのfd（接続時） */
  peerFd?: number;
}

/** プロセス情報 */
export interface Process {
  pid: number;
  name: string;
  /** 所有するfd一覧 */
  fds: number[];
  uid: number;
  gid: number;
}

/** ファイルディスクリプタ（fd渡し用） */
export interface FileDescriptor {
  fd: number;
  type: "file" | "socket" | "pipe";
  path?: string;
  description: string;
}

/** 補助データ（制御メッセージ） */
export interface AncillaryData {
  level: "SOL_SOCKET";
  type: "SCM_RIGHTS" | "SCM_CREDENTIALS";
  /** SCM_RIGHTS: 渡すfd一覧 */
  fds?: FileDescriptor[];
  /** SCM_CREDENTIALS: ピアの認証情報 */
  credentials?: { pid: number; uid: number; gid: number };
}

/** シミュレーション操作 */
export type SimOp =
  | { type: "process_create"; process: Process }
  | { type: "socket"; pid: number; socketType: SocketType }
  | { type: "socketpair"; pid: number; socketType: SocketType }
  | { type: "bind"; fd: number; addr: SockAddr }
  | { type: "listen"; fd: number; backlog: number }
  | { type: "connect"; fd: number; addr: SockAddr }
  | { type: "accept"; fd: number }
  | { type: "send"; fd: number; data: string }
  | { type: "recv"; fd: number }
  | { type: "sendmsg"; fd: number; data: string; ancillary: AncillaryData }
  | { type: "recvmsg"; fd: number }
  | { type: "sendto"; fd: number; data: string; addr: SockAddr }
  | { type: "close"; fd: number }
  | { type: "unlink"; path: string }
  | { type: "getpeername"; fd: number }
  | { type: "getsockname"; fd: number }
  | { type: "shutdown"; fd: number; how: "SHUT_RD" | "SHUT_WR" | "SHUT_RDWR" };

/** イベント種別 */
export type EventType =
  | "process_create"
  | "socket_create"
  | "socketpair_create"
  | "bind"
  | "listen"
  | "connect"
  | "accept"
  | "send"
  | "recv"
  | "sendmsg"
  | "recvmsg"
  | "sendto"
  | "close"
  | "unlink"
  | "fd_pass"
  | "credential_pass"
  | "getpeername"
  | "getsockname"
  | "shutdown"
  | "error"
  | "inode_create"
  | "buffer_update";

/** シミュレーションイベント */
export interface SimEvent {
  step: number;
  type: EventType;
  description: string;
  pid?: number;
  fd?: number;
}

/** シミュレーション結果 */
export interface SimulationResult {
  events: SimEvent[];
  processes: Process[];
  sockets: UnixSocket[];
  /** ファイルシステム上のソケットファイル */
  socketFiles: string[];
  stats: {
    totalSyscalls: number;
    socketCreated: number;
    bytesSent: number;
    bytesReceived: number;
    fdsPassed: number;
    errors: number;
  };
}

/** プリセット */
export interface Preset {
  name: string;
  description: string;
  ops: SimOp[];
}
