/** IPv4アドレス文字列 */
export type IPv4 = string;

/** トンネルプロトコル種別 */
export type TunnelProtocol = "IPIP" | "GRE" | "6in4" | "GRE6" | "IPsec";

/** IPヘッダ */
export interface IpHeader {
  version: 4 | 6;
  headerLen: number;
  tos: number;
  totalLen: number;
  id: number;
  flags: { df: boolean; mf: boolean };
  ttl: number;
  protocol: number;       // 4=IPIP, 6=IPv6, 17=UDP, 47=GRE, 50=ESP
  src: string;
  dst: string;
}

/** GREヘッダ */
export interface GreHeader {
  checksumPresent: boolean;
  keyPresent: boolean;
  sequencePresent: boolean;
  protocolType: number;   // 0x0800=IPv4, 0x86DD=IPv6
  key?: number;
  sequence?: number;
}

/** IPsec ESPヘッダ */
export interface EspHeader {
  spi: number;
  sequenceNumber: number;
  encrypted: boolean;
}

/** トンネル設定 */
export interface TunnelConfig {
  name: string;
  protocol: TunnelProtocol;
  localEndpoint: string;    // トンネル起点のIP
  remoteEndpoint: string;   // トンネル終点のIP
  localInner: string;       // トンネル内部のIP（送信元）
  remoteInner: string;      // トンネル内部のIP（宛先）
  greKey?: number;
  mtu: number;
}

/** パケット（各レイヤを含む） */
export interface Packet {
  outerIp?: IpHeader;
  greHeader?: GreHeader;
  espHeader?: EspHeader;
  innerIp: IpHeader;
  payload: string;
  payloadSize: number;
}

/** ネットワークノード */
export interface NetworkNode {
  id: string;
  name: string;
  type: "host" | "router" | "tunnel-endpoint";
  interfaces: NodeInterface[];
}

/** ノードのインタフェース */
export interface NodeInterface {
  name: string;
  address: string;
  subnet: string;
  tunnelConfig?: TunnelConfig;
}

/** リンク定義 */
export interface Link {
  from: { nodeId: string; iface: string };
  to: { nodeId: string; iface: string };
  label?: string;
}

/** シミュレーションイベント種別 */
export type EventType =
  | "originate"       // パケット生成
  | "encapsulate"     // トンネルカプセル化
  | "add_outer_ip"    // 外側IPヘッダ付与
  | "add_gre"         // GREヘッダ付与
  | "add_esp"         // ESPヘッダ付与
  | "encrypt"         // 暗号化
  | "route"           // ルーティング
  | "transit"         // 中継転送
  | "decapsulate"     // デカプセル化
  | "remove_outer_ip" // 外側IPヘッダ除去
  | "remove_gre"      // GREヘッダ除去
  | "remove_esp"      // ESPヘッダ除去
  | "decrypt"         // 復号
  | "deliver"         // 最終配送
  | "ttl_expire"      // TTL切れ
  | "mtu_exceed"      // MTU超過
  | "fragment";        // フラグメンテーション

/** シミュレーションイベント */
export interface SimEvent {
  step: number;
  type: EventType;
  node: string;
  packet: Packet;
  description: string;
  headerBytes?: string;  // ヘッダのヘキサダンプ
}

/** シミュレーション結果 */
export interface SimulationResult {
  events: SimEvent[];
  tunnelConfig: TunnelConfig;
}

/** プリセット定義 */
export interface Preset {
  name: string;
  description: string;
  nodes: NetworkNode[];
  links: Link[];
  tunnel: TunnelConfig;
  packets: { src: string; dst: string; payload: string; size: number; ttl?: number; ipv6?: boolean }[];
}
