/**
 * @module types
 * @description QUICプロトコルシミュレーターで使用する全ての型定義モジュール。
 * 接続状態、パケット構造、ストリーム、フロー制御、輻輳制御、TLS 1.3、
 * コネクションマイグレーション、ネットワークシミュレーション、
 * およびシミュレーション操作・結果の型を定義する。
 */

// ─── 接続状態 ───

/**
 * QUIC接続の状態遷移を表すユニオン型。
 * idle → handshake_initial → handshake_server → handshake_complete → connected → closing → draining → closed
 * の順に遷移する。retryはサーバーからRetryパケットを受け取った場合に使用。
 */
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

/**
 * QUICの暗号化レベル。
 * ハンドシェイクの進行に応じてinitial → handshake → one_rttと昇格する。
 * zero_rttはPSKを使用した早期データ送信時に使用する。
 */
export type EncryptionLevel = "initial" | "handshake" | "zero_rtt" | "one_rtt";

// ─── パケット ───

/**
 * QUICパケットタイプ。
 * initial/zero_rtt/handshakeはロングヘッダ、one_rttはショートヘッダを使用する。
 * retryはサーバーがアドレス検証のために返すパケットタイプ。
 * version_negotiationはバージョン不一致時にサーバーが返すパケットタイプ。
 */
export type PacketType =
  | "initial"
  | "zero_rtt"
  | "handshake"
  | "retry"
  | "one_rtt"    // Short Header
  | "version_negotiation";

/**
 * QUICパケットヘッダ。
 * ロングヘッダ（initial/handshake/zero_rtt/retry）とショートヘッダ（one_rtt）の共通構造。
 */
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

/**
 * QUICフレームタイプ。
 * QUICパケットは1つ以上のフレームを含み、各フレームが特定の機能を担う。
 * stream: データ転送、ack: 受信確認、crypto: TLSハンドシェイク、
 * connection_close: 接続終了等。
 */
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

/**
 * QUICフレーム。
 * 各フレームタイプに応じたオプショナルフィールドを持つ。
 * フレームタイプによって使用されるフィールドが異なる。
 */
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

/**
 * QUICパケット。
 * ヘッダ、フレーム群、サイズ、送信時刻、暗号化レベル、ACK/ロスト状態を保持する。
 * シミュレーションにおけるパケットのライフサイクル追跡に使用。
 */
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

/**
 * ストリーム状態。
 * idle → open → half_closed_local/half_closed_remote → closed の遷移を表す。
 */
export type StreamState =
  | "idle"
  | "open"
  | "half_closed_local"
  | "half_closed_remote"
  | "closed";

/**
 * ストリーム方向。
 * bidi: 双方向ストリーム（クライアント・サーバー両方がデータ送信可能）
 * uni: 単方向ストリーム（開始側のみデータ送信可能）
 */
export type StreamDirection = "bidi" | "uni";

/**
 * QUICストリーム。
 * QUIC接続内の個々のデータストリームを表現する。
 * 各ストリームは独立したフロー制御とオフセット管理を持つ。
 */
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

/**
 * フロー制御状態。
 * コネクションレベルの送受信量と上限を管理する。
 * MAX_DATAフレームで受信側が上限を拡張する仕組み。
 */
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

/**
 * 輻輳制御アルゴリズムの種別。
 * new_reno: RFC 6582準拠のロスベースアルゴリズム
 * cubic: 3次関数ベースのウィンドウ成長（Linux標準）
 * bbr: 帯域推定ベースのGoogleのアルゴリズム
 */
export type CongestionAlgo = "new_reno" | "cubic" | "bbr";

/**
 * 輻輳制御状態。
 * スロースタート → 輻輳回避 → リカバリのフェーズ遷移と、
 * cwnd、ssthresh、RTT推定値などの輻輳制御パラメータを保持する。
 */
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

/**
 * TLS 1.3 ハンドシェイクメッセージ種別。
 * QUICはTLS 1.3を統合しており、CRYPTOフレーム内でTLSメッセージを交換する。
 */
export type TlsMessage =
  | "client_hello"
  | "server_hello"
  | "encrypted_extensions"
  | "certificate"
  | "certificate_verify"
  | "finished"
  | "new_session_ticket";

/**
 * TLS 1.3の状態。
 * ハンドシェイクの進行状況、0-RTTサポート、暗号スイート、
 * ALPNプロトコル、セッションチケットなどを管理する。
 */
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

/**
 * コネクションマイグレーション時のパス状態。
 * PATH_CHALLENGE/PATH_RESPONSEによる検証状況、
 * ローカル/リモートアドレス、アクティブ状態を保持する。
 */
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

/**
 * QUIC接続全体の状態を表すインターフェース。
 * コネクションID、TLS状態、ストリーム、フロー制御、輻輳制御、
 * パケット履歴、パス情報など、接続に関する全てのデータを集約する。
 */
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

/**
 * シミュレーション用ネットワーク条件。
 * 遅延、パケットロス率、帯域幅、ジッタを設定し、
 * 様々なネットワーク環境をエミュレートする。
 */
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

/**
 * シミュレーション操作のユニオン型。
 * 接続確立、データ送信、ストリーム管理、パスマイグレーション、
 * パケットロスの強制発生、ネットワーク条件の変更など、
 * シミュレーションで実行可能な全操作を表す。
 */
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

/**
 * シミュレーションイベントの種別。
 * UIでのフィルタリングやカラー分けに使用する。
 */
export type EventType =
  | "handshake" | "tls" | "packet_sent" | "packet_recv"
  | "packet_lost" | "packet_ack" | "stream" | "flow_control"
  | "congestion" | "migration" | "close" | "zero_rtt" | "info";

/**
 * シミュレーション中に発生したイベント。
 * 時刻、種別、メッセージ、詳細情報を保持し、イベントログとして表示される。
 */
export interface SimEvent {
  time: number;
  type: EventType;
  message: string;
  detail?: string;
}

/**
 * シミュレーション実行後の結果。
 * 最終的な接続状態、イベントログ、統計情報（ハンドシェイクRTT数、
 * 送信バイト数、ロスト/再送パケット数）を含む。
 */
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

/**
 * シミュレーションプリセット。
 * UI上のセレクトボックスで選択可能な実験シナリオを定義する。
 * 名前、説明、およびシミュレーション操作・ネットワーク条件・輻輳制御アルゴリズムを
 * 生成するビルド関数を持つ。
 */
export interface Preset {
  name: string;
  description: string;
  build: () => {
    ops: SimOp[];
    network: NetworkCondition;
    congestionAlgo: CongestionAlgo;
  };
}
