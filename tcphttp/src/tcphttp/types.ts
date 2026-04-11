/** TCPソケット状態 */
export type TcpState =
  | "CLOSED" | "LISTEN" | "SYN_SENT" | "SYN_RECEIVED"
  | "ESTABLISHED" | "FIN_WAIT_1" | "FIN_WAIT_2" | "CLOSE_WAIT"
  | "CLOSING" | "LAST_ACK" | "TIME_WAIT";

/** TCPフラグ */
export interface TcpFlags {
  syn: boolean;
  ack: boolean;
  fin: boolean;
  rst: boolean;
  psh: boolean;
}

/** TCPセグメント */
export interface TcpSegment {
  srcPort: number;
  dstPort: number;
  seq: number;
  ack: number;
  flags: TcpFlags;
  window: number;
  payload: string;
  payloadSize: number;
}

/** ソケットアドレス */
export interface SocketAddr {
  ip: string;
  port: number;
}

/** TCPソケット */
export interface TcpSocket {
  localAddr: SocketAddr;
  remoteAddr: SocketAddr;
  state: TcpState;
  /** 送信シーケンス番号 */
  sendNext: number;
  /** 送信未確認シーケンス番号 */
  sendUnack: number;
  /** 受信期待シーケンス番号 */
  recvNext: number;
  /** 受信ウィンドウサイズ */
  recvWindow: number;
  /** 送信ウィンドウサイズ */
  sendWindow: number;
  /** 送信バッファ */
  sendBuffer: string[];
  /** 受信バッファ */
  recvBuffer: string[];
}

/** HTTPメソッド */
export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "HEAD" | "OPTIONS";

/** HTTPリクエスト */
export interface HttpRequest {
  method: HttpMethod;
  path: string;
  version: "1.0" | "1.1";
  headers: Record<string, string>;
  body?: string;
}

/** HTTPレスポンス */
export interface HttpResponse {
  statusCode: number;
  statusText: string;
  version: "1.0" | "1.1";
  headers: Record<string, string>;
  body?: string;
}

/** シミュレーション操作 */
export type SimOp =
  | { type: "socket_create"; side: "client" | "server" }
  | { type: "bind"; side: "server"; port: number }
  | { type: "listen"; side: "server" }
  | { type: "connect"; side: "client" }
  | { type: "accept"; side: "server" }
  | { type: "send"; side: "client" | "server"; data: string }
  | { type: "recv"; side: "client" | "server" }
  | { type: "close"; side: "client" | "server" }
  | { type: "http_request"; request: HttpRequest }
  | { type: "http_response"; response: HttpResponse }
  | { type: "rst"; side: "client" | "server" };

/** イベント種別 */
export type EventType =
  | "socket_create"
  | "bind"
  | "listen"
  | "connect"
  | "accept"
  | "tcp_send"
  | "tcp_recv"
  | "tcp_ack"
  | "state_change"
  | "handshake_syn"
  | "handshake_syn_ack"
  | "handshake_ack"
  | "handshake_complete"
  | "data_send"
  | "data_recv"
  | "data_ack"
  | "window_update"
  | "fin_send"
  | "fin_recv"
  | "fin_ack"
  | "teardown_complete"
  | "rst_send"
  | "rst_recv"
  | "http_request_send"
  | "http_request_recv"
  | "http_response_send"
  | "http_response_recv"
  | "http_parse"
  | "keep_alive"
  | "close";

/** シミュレーションイベント */
export interface SimEvent {
  step: number;
  type: EventType;
  description: string;
  /** セグメント情報（表示用） */
  segment?: TcpSegment;
  /** 方向 */
  direction?: "client→server" | "server→client" | "local";
}

/** シミュレーション結果 */
export interface SimulationResult {
  events: SimEvent[];
  clientSocket: TcpSocket;
  serverSocket: TcpSocket;
  segments: TcpSegment[];
  httpExchanges: { request?: HttpRequest; response?: HttpResponse }[];
  stats: {
    totalSegments: number;
    dataSegments: number;
    ackSegments: number;
    retransmissions: number;
    handshakeSegments: number;
    teardownSegments: number;
  };
}

/** プリセット */
export interface Preset {
  name: string;
  description: string;
  clientAddr: SocketAddr;
  serverAddr: SocketAddr;
  ops: SimOp[];
}
