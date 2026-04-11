/** MACアドレス */
export type MacAddr = string;
/** IPv4アドレス */
export type IPv4 = string;

/** OSI参照モデルの層 */
export type OsiLayer = "L1" | "L2" | "L3";

/** 機器の種類 */
export type DeviceKind = "nic" | "repeater" | "hub" | "bridge" | "switch" | "router";

/** イーサネットフレーム */
export interface EthernetFrame {
  srcMac: MacAddr;
  dstMac: MacAddr;
  /** EtherType (0x0800=IPv4, 0x0806=ARP) */
  etherType: number;
  payload: Packet | ArpPacket;
  /** フレームサイズ（バイト） */
  size: number;
}

/** IPパケット */
export interface Packet {
  type: "ip";
  srcIp: IPv4;
  dstIp: IPv4;
  ttl: number;
  protocol: "icmp" | "tcp" | "udp";
  data: string;
}

/** ARPパケット */
export interface ArpPacket {
  type: "arp";
  operation: "request" | "reply";
  senderMac: MacAddr;
  senderIp: IPv4;
  targetMac: MacAddr;
  targetIp: IPv4;
}

/** ポート（物理インタフェース） */
export interface Port {
  id: number;
  name: string;
  mac: MacAddr;
  linkUp: boolean;
  /** 接続先デバイスID */
  connectedTo: string | null;
  /** 接続先ポートID */
  connectedPort: number | null;
}

/** MACアドレステーブルのエントリ */
export interface MacTableEntry {
  mac: MacAddr;
  port: number;
  age: number;
}

/** ルーティングテーブルのエントリ */
export interface RouteEntry {
  network: IPv4;
  mask: IPv4;
  gateway: IPv4;
  iface: number;
  metric: number;
}

/** ARPテーブルのエントリ */
export interface ArpEntry {
  ip: IPv4;
  mac: MacAddr;
}

/** ネットワーク機器の基本インタフェース */
export interface NetworkDevice {
  id: string;
  kind: DeviceKind;
  name: string;
  layer: OsiLayer;
  ports: Port[];
  /** MACアドレステーブル（ブリッジ、スイッチ） */
  macTable?: MacTableEntry[];
  /** ルーティングテーブル（ルーター） */
  routeTable?: RouteEntry[];
  /** ARPテーブル（ルーター） */
  arpTable?: ArpEntry[];
  /** IPアドレス（ルーター、NIC） */
  ipAddresses?: Record<number, IPv4>;
}

/** シミュレーションイベント */
export interface SimEvent {
  step: number;
  device: string;
  type:
    | "receive"         // フレーム受信
    | "signal_repeat"   // 信号増幅（リピータ）
    | "flood"           // フラッディング（ハブ、ブリッジ学習前）
    | "mac_learn"       // MAC学習
    | "mac_lookup"      // MACテーブル参照
    | "forward"         // 転送
    | "filter"          // フィルタリング（同一セグメント）
    | "drop"            // 破棄
    | "collision"       // コリジョン
    | "arp_request"     // ARP要求
    | "arp_reply"       // ARP応答
    | "route_lookup"    // ルーティング参照
    | "ttl_decrement"   // TTL減算
    | "decapsulate"     // デカプセル化
    | "encapsulate"     // 再カプセル化
    | "broadcast"       // ブロードキャスト
    | "info";
  description: string;
  port?: number;
  frame?: EthernetFrame;
}

/** シミュレーション結果 */
export interface SimulationResult {
  events: SimEvent[];
  /** 最終的なデバイス状態 */
  devices: NetworkDevice[];
  /** 送信されたフレーム数 */
  totalFrames: number;
  /** コリジョン数 */
  collisions: number;
}
