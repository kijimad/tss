/**
 * types.ts — プロトコルスタック型定義
 *
 * 実際のカプセル化:
 *   Ethernet フレーム
 *     └── IP パケット
 *           └── TCP セグメント
 *                 └── HTTP データ (テキスト)
 *
 * 各レイヤーは上位のデータを「ペイロード」としてバイト列で受け取り、
 * 自分のヘッダを付けて下位に渡す。
 */

// =====================================================
// L2: Ethernet
// =====================================================
export interface EthernetFrame {
  dstMac: string;       // 宛先 MAC "AA:BB:CC:00:00:01"
  srcMac: string;       // 送信元 MAC
  etherType: number;    // 0x0800=IPv4, 0x0806=ARP
  payload: Uint8Array;  // IP パケットのバイナリ
}

// ARP テーブルエントリ
export interface ArpEntry {
  ip: string;
  mac: string;
}

// ARP パケット
export interface ArpPacket {
  operation: 1 | 2;     // 1=リクエスト, 2=リプライ
  senderMac: string;
  senderIp: string;
  targetMac: string;    // リクエスト時は "00:00:00:00:00:00"
  targetIp: string;
}

// =====================================================
// L3: IP
// =====================================================
export interface IpHeader {
  version: 4;
  headerLength: number;  // 通常20バイト
  ttl: number;
  protocol: number;      // 6=TCP
  srcIp: string;
  dstIp: string;
}

export interface IpPacket {
  header: IpHeader;
  payload: Uint8Array;   // TCP セグメントのバイナリ
}

// ルーティングテーブルエントリ
export interface RouteEntry {
  network: string;       // "192.168.1.0"
  mask: string;          // "255.255.255.0"
  gateway: string;       // "0.0.0.0" (直接接続) or ゲートウェイIP
  iface: string;         // インターフェース名
}

// =====================================================
// L4: TCP
// =====================================================
export interface TcpHeader {
  srcPort: number;
  dstPort: number;
  seqNum: number;
  ackNum: number;
  dataOffset: number;    // ヘッダ長 (通常20バイト)
  flags: TcpFlags;
  windowSize: number;
  checksum: number;
}

export interface TcpFlags {
  fin: boolean;
  syn: boolean;
  rst: boolean;
  psh: boolean;
  ack: boolean;
  urg: boolean;
}

export interface TcpSegment {
  header: TcpHeader;
  payload: Uint8Array;   // HTTP データのバイナリ
}

// TCP 接続状態
export const TcpState = {
  Closed: "CLOSED",
  Listen: "LISTEN",
  SynSent: "SYN_SENT",
  SynReceived: "SYN_RECEIVED",
  Established: "ESTABLISHED",
  FinWait1: "FIN_WAIT_1",
  FinWait2: "FIN_WAIT_2",
  CloseWait: "CLOSE_WAIT",
  LastAck: "LAST_ACK",
  TimeWait: "TIME_WAIT",
} as const;
export type TcpState = (typeof TcpState)[keyof typeof TcpState];

// =====================================================
// L7: HTTP
// =====================================================
export interface HttpRequest {
  method: string;
  path: string;
  version: string;
  headers: Map<string, string>;
  body: string;
}

export interface HttpResponse {
  version: string;
  statusCode: number;
  statusText: string;
  headers: Map<string, string>;
  body: string;
}

// =====================================================
// ネットワーク機器のインターフェース
// =====================================================

// NIC（ネットワークインターフェースカード）
export interface NetworkInterface {
  name: string;           // "eth0", "wan0" 等
  mac: string;
  ip: string;
  subnetMask: string;
  // この NIC が接続されているリンク
  link: EthernetLink | undefined;
}

// リンク（L1: 物理的な接続）
export interface EthernetLink {
  id: string;
  endpoints: NetworkInterface[];
}

// =====================================================
// トレース/可視化用
// =====================================================

export type StackEvent =
  | { type: "arp_request"; srcIp: string; srcMac: string; targetIp: string; timestamp: number }
  | { type: "arp_reply"; srcIp: string; srcMac: string; targetIp: string; targetMac: string; timestamp: number }
  | { type: "ethernet_send"; srcMac: string; dstMac: string; etherType: number; size: number; iface: string; timestamp: number }
  | { type: "ethernet_recv"; srcMac: string; dstMac: string; etherType: number; size: number; iface: string; timestamp: number }
  | { type: "ip_send"; srcIp: string; dstIp: string; protocol: number; ttl: number; size: number; timestamp: number }
  | { type: "ip_recv"; srcIp: string; dstIp: string; protocol: number; size: number; timestamp: number }
  | { type: "ip_forward"; srcIp: string; dstIp: string; fromIface: string; toIface: string; timestamp: number }
  | { type: "ip_nat"; originalSrc: string; translatedSrc: string; dstIp: string; timestamp: number }
  | { type: "tcp_send"; srcPort: number; dstPort: number; flags: string; seq: number; ack: number; size: number; timestamp: number }
  | { type: "tcp_recv"; srcPort: number; dstPort: number; flags: string; seq: number; ack: number; size: number; timestamp: number }
  | { type: "tcp_state_change"; from: TcpState; to: TcpState; timestamp: number }
  | { type: "http_request"; method: string; path: string; host: string; timestamp: number }
  | { type: "http_response"; statusCode: number; statusText: string; bodySize: number; timestamp: number }
  | { type: "route_lookup"; dstIp: string; nextHop: string; iface: string; timestamp: number };
