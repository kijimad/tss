/* QUIC プロトコル シミュレーター 型定義 */

// ─── 接続状態 ───

/** QUIC接続状態 */
export type ConnectionState =
  | "idle"
  | "handshake_initial"   // Initial パケット送信
  | "handshake_retry"     // Retry トークン検証
  | "handshake_server"    // Handshake パケット応答
  | "handshake_complete"  // ハンドシェイク完了
  | "connected"           // 1-RTTデータ転送可能
  | "closing"             // CONNECTION_CLOSE送信済み
  | "draining"            // ドレイン期間
  | "closed";

/** 暗号化レベル */
export type EncryptionLevel = "initial" | "handshake" | "zero_rtt" | "one_rtt";

// ─── パケット ───

/** QUICパケットタイプ */
export type PacketType =
  | "initial"
  | "zero_rtt"
  | "handshake"
  | "retry"
  | "one_rtt"    // Short Header
  | "version_negotiation";

/** QUICパケットヘッダ */
export interface PacketHeader {
  type: PacketType;
  version: number;                // QUICバージョン(1)
  dcid: string;                   // 宛先コネクションID
  scid: string;                   // 送信元コネクションID
  packetNumber: number;
  /** ロングヘッダかショートヘッダか */
  longHeader: boolean;
  /** トークン（Initialパケット、Retry） */
  token?: string;
}

/** QUICフレームタイプ */
export type FrameType =
  | "padding"
  | "ping"
  | "ack"
  | "reset_stream"
  | "stop_sending"
  | "crypto"
  | "new_token"
  | "stream"
  | "max_data"
  | "max_stream_data"
  | "max_streams"
  | "data_blocked"
  | "stream_data_blocked"
  | "streams_blocked"
  | "new_connection_id"
  | "retire_connection_id"
  | "path_challenge"
  | "path_response"
  | "connection_close"
  | "handshake_done";

/** QUICフレーム */
export interface QuicFrame {
  type: FrameType;
  /** ストリームID（streamフレーム） */
  streamId?: number;
  /** データ長 */
  length?: number;
  /** オフセット（streamフレーム） */
  offset?: number;
  /** FINビット */
  fin?: boolean;
  /** ACK範囲 */
  ackRanges?: Array<{ start: number; end: number }>;
  /** ACK遅延 (μs) */
  ackDelay?: number;
  /** エラーコード */
  errorCode?: number;
  /** 暗号データ（cryptoフレーム） */
  cryptoData?: string;
  /** フロー制御上限 */
  maxData?: number;
  /** チャレンジデータ */
  challengeData?: string;
}

/** QUICパケット */
export interface QuicPacket {
  header: PacketHeader;
  frames: QuicFrame[];
  /** パケットサイズ(bytes) */
  size: number;
  /** 送信時刻(ms) */
  sentTime: number;
  /** 暗号化レベル */
  encLevel: EncryptionLevel;
  /** ACK済みか */
  acked: boolean;
  /** ロスト判定 */
  lost: boolean;
}

// ─── ストリーム ───

/** ストリーム状態 */
export type StreamState =
  | "idle"
  | "open"
  | "half_closed_local"
  | "half_closed_remote"
  | "closed";

/** ストリーム方向 */
export type StreamDirection = "bidi" | "uni";

/** QUICストリーム */
export interface QuicStream {
  id: number;
  state: StreamState;
  direction: StreamDirection;
  /** イニシエーター(client=偶数, server=奇数) */
  initiator: "client" | "server";
  /** 送信オフセット */
  sendOffset: number;
  /** 受信オフセット */
  recvOffset: number;
  /** 送信バッファ */
  sendBuf: number;
  /** 受信バッファ */
  recvBuf: number;
  /** フロー制御上限（ストリーム単位） */
  maxStreamData: number;
  /** FIN送信済み */
  finSent: boolean;
  /** FIN受信済み */
  finRecv: boolean;
}

// ─── フロー制御 ───

/** フロー制御状態 */
export interface FlowControl {
  /** コネクションレベル: 送信済みバイト */
  connSendBytes: number;
  /** コネクションレベル: 受信済みバイト */
  connRecvBytes: number;
  /** コネクションレベル: 最大送信許可 */
  connMaxSend: number;
  /** コネクションレベル: 最大受信許可 */
  connMaxRecv: number;
  /** ブロック中か */
  blocked: boolean;
}

// ─── 輻輳制御 ───

/** 輻輳制御アルゴリズム */
export type CongestionAlgo = "new_reno" | "cubic" | "bbr";

/** 輻輳制御状態 */
export interface CongestionState {
  algo: CongestionAlgo;
  /** 輻輳ウィンドウ (bytes) */
  cwnd: number;
  /** スロースタート閾値 */
  ssthresh: number;
  /** フェーズ */
  phase: "slow_start" | "congestion_avoidance" | "recovery";
  /** bytes in flight */
  bytesInFlight: number;
  /** RTT推定 */
  smoothedRtt: number;
  /** RTT分散 */
  rttVar: number;
  /** 最小RTT */
  minRtt: number;
  /** PTO (Probe Timeout) */
  pto: number;
  /** cwnd履歴 */
  cwndHistory: Array<{ time: number; cwnd: number }>;
}

// ─── TLS 1.3 ───

/** TLS 1.3 ハンドシェイクメッセージ */
export type TlsMessage =
  | "client_hello"
  | "server_hello"
  | "encrypted_extensions"
  | "certificate"
  | "certificate_verify"
  | "finished"
  | "new_session_ticket";

/** TLS状態 */
export interface TlsState {
  /** ハンドシェイク完了 */
  handshakeComplete: boolean;
  /** 0-RTTサポート */
  zeroRttEnabled: boolean;
  /** 0-RTTが受理されたか */
  zeroRttAccepted: boolean;
  /** 交換済みメッセージ */
  messages: TlsMessage[];
  /** 暗号スイート */
  cipherSuite: string;
  /** ALPNプロトコル */
  alpn: string;
  /** セッションチケット */
  sessionTicket?: string;
}

// ─── コネクションマイグレーション ───

/** パス状態 */
export interface PathState {
  id: number;
  localAddr: string;
  remoteAddr: string;
  active: boolean;
  validated: boolean;
  /** パス検証チャレンジ */
  challenge?: string;
  rtt: number;
}

// ─── 接続全体 ───

/** QUIC接続 */
export interface QuicConnection {
  /** ローカルコネクションID */
  localCid: string;
  /** リモートコネクションID */
  remoteCid: string;
  /** 接続状態 */
  state: ConnectionState;
  /** TLS状態 */
  tls: TlsState;
  /** ストリーム */
  streams: QuicStream[];
  /** フロー制御 */
  flowControl: FlowControl;
  /** 輻輳制御 */
  congestion: CongestionState;
  /** 送信済みパケット */
  sentPackets: QuicPacket[];
  /** 受信済みパケット */
  recvPackets: QuicPacket[];
  /** 次のパケット番号 */
  nextPacketNumber: number;
  /** パス */
  paths: PathState[];
  /** 現在時刻(ms) */
  currentTime: number;
  /** 最大ストリーム数 */
  maxStreams: { bidi: number; uni: number };
}

// ─── ネットワークシミュレーション ───

/** ネットワーク条件 */
export interface NetworkCondition {
  /** 遅延(ms) */
  latency: number;
  /** パケットロス率(0-1) */
  lossRate: number;
  /** 帯域幅(bytes/s) */
  bandwidth: number;
  /** ジッタ(ms) */
  jitter: number;
}

// ─── シミュレーション ───

/** シミュレーション操作 */
export type SimOp =
  | { type: "connect" }
  | { type: "connect_0rtt" }
  | { type: "send_data"; streamId: number; size: number }
  | { type: "open_stream"; direction: StreamDirection }
  | { type: "close_stream"; streamId: number }
  | { type: "migrate_path"; newAddr: string }
  | { type: "trigger_loss"; packetNumbers: number[] }
  | { type: "update_network"; condition: Partial<NetworkCondition> }
  | { type: "close_connection" }
  | { type: "tick"; ms: number };

/** イベント種別 */
export type EventType =
  | "handshake" | "tls" | "packet_sent" | "packet_recv"
  | "packet_lost" | "packet_ack" | "stream" | "flow_control"
  | "congestion" | "migration" | "close" | "zero_rtt" | "info";

/** シミュレーションイベント */
export interface SimEvent {
  time: number;
  type: EventType;
  message: string;
  detail?: string;
}

/** シミュレーション結果 */
export interface SimulationResult {
  connection: QuicConnection;
  events: SimEvent[];
  /** ハンドシェイクRTT数 */
  handshakeRtts: number;
  /** 転送済みバイト */
  totalBytesSent: number;
  /** ロストパケット数 */
  lostPackets: number;
  /** 再送パケット数 */
  retransmittedPackets: number;
}

/** プリセット */
export interface Preset {
  name: string;
  description: string;
  build: () => {
    ops: SimOp[];
    network: NetworkCondition;
    congestionAlgo: CongestionAlgo;
  };
}
