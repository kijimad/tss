/** ネットワークアドレス */
export interface NetAddr {
  ip: string;
  port: number;
}

/** ホスト情報 */
export interface Host {
  name: string;
  ip: string;
  /** 参加中のマルチキャストグループ */
  joinedGroups: string[];
  /** ネットワークインターフェース */
  iface: string;
}

/** ルーター情報 */
export interface Router {
  name: string;
  ip: string;
  /** 接続インターフェース */
  interfaces: RouterInterface[];
}

/** ルーターインターフェース */
export interface RouterInterface {
  name: string;
  ip: string;
  /** マルチキャストグループメンバーシップ（IGMPスヌーピング） */
  groups: GroupMembership[];
}

/** グループメンバーシップ */
export interface GroupMembership {
  group: string;
  members: string[];
  /** タイマー（秒） */
  timer: number;
}

/** UDPデータグラム */
export interface UdpDatagram {
  srcAddr: NetAddr;
  dstAddr: NetAddr;
  /** TTL (Time To Live) */
  ttl: number;
  payload: string;
  payloadSize: number;
  /** マルチキャストかどうか */
  isMulticast: boolean;
}

/** IGMPメッセージ種別 */
export type IgmpType =
  | "membership_query"       // ルーターがグループメンバーシップを問い合わせ
  | "membership_report_v2"   // ホストがグループ参加を報告 (IGMPv2)
  | "membership_report_v3"   // ホストがグループ参加を報告 (IGMPv3)
  | "leave_group";           // ホストがグループ離脱を報告

/** IGMPメッセージ */
export interface IgmpMessage {
  type: IgmpType;
  group: string;
  srcIp: string;
  /** IGMPv3: ソースフィルタモード */
  filterMode?: "include" | "exclude";
  /** IGMPv3: ソースリスト */
  sourceList?: string[];
  /** 最大応答時間（秒） */
  maxResponseTime?: number;
}

/** マルチキャストスコープ */
export type MulticastScope =
  | "link_local"    // 224.0.0.0/24 — TTL=1、ローカルサブネットのみ
  | "site_local"    // 239.0.0.0/8 — TTL≤32、組織内
  | "global";       // 224.0.1.0-238.255.255.255 — インターネット全体

/** シミュレーション操作 */
export type SimOp =
  | { type: "add_host"; host: Host }
  | { type: "add_router"; router: Router }
  | { type: "igmp_join"; hostIp: string; group: string }
  | { type: "igmp_leave"; hostIp: string; group: string }
  | { type: "igmp_query"; routerIp: string; group?: string }
  | { type: "send_multicast"; srcIp: string; srcPort: number; group: string; dstPort: number; data: string; ttl: number }
  | { type: "send_unicast"; srcIp: string; srcPort: number; dstIp: string; dstPort: number; data: string }
  | { type: "ttl_expire"; srcIp: string; group: string; ttl: number }
  | { type: "igmp_v3_join"; hostIp: string; group: string; filterMode: "include" | "exclude"; sourceList: string[] }
  | { type: "multicast_forward"; routerIp: string; group: string; inIface: string; outIfaces: string[] };

/** イベント種別 */
export type EventType =
  | "host_add"
  | "router_add"
  | "igmp_join"
  | "igmp_report"
  | "igmp_leave"
  | "igmp_query"
  | "igmp_query_response"
  | "group_membership_update"
  | "udp_send"
  | "udp_deliver"
  | "udp_drop"
  | "multicast_resolve"
  | "multicast_forward"
  | "ttl_decrement"
  | "ttl_expire"
  | "scope_check"
  | "unicast_send"
  | "unicast_deliver";

/** シミュレーションイベント */
export interface SimEvent {
  step: number;
  type: EventType;
  description: string;
  /** 送信元→送信先 */
  from?: string;
  to?: string;
  /** 関連データグラム */
  datagram?: UdpDatagram;
  /** IGMPメッセージ */
  igmp?: IgmpMessage;
}

/** シミュレーション結果 */
export interface SimulationResult {
  events: SimEvent[];
  hosts: Host[];
  routers: Router[];
  datagrams: UdpDatagram[];
  groupTable: Record<string, string[]>;
  stats: {
    totalDatagrams: number;
    multicastDatagrams: number;
    unicastDatagrams: number;
    deliveredCount: number;
    droppedCount: number;
    igmpMessages: number;
    ttlExpired: number;
  };
}

/** プリセット */
export interface Preset {
  name: string;
  description: string;
  ops: SimOp[];
}
