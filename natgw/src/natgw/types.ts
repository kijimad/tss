/** プロトコル種別 */
export type Protocol = "tcp" | "udp" | "icmp";

/** 接続の方向 */
export type Direction = "outbound" | "inbound";

/** NAT Gatewayの状態 */
export type NatGwState = "available" | "pending" | "deleting" | "deleted" | "failed";

/** Elastic IP */
export interface ElasticIp {
  allocationId: string;
  publicIp: string;
}

/** NAT Gateway */
export interface NatGateway {
  id: string;
  name: string;
  subnetId: string;
  /** 割り当てられたElastic IP */
  eip: ElasticIp;
  state: NatGwState;
  /** 最大同時接続数（デフォルト: 55000） */
  maxConnections: number;
  /** 帯域制限（Gbps、デフォルト: 45） */
  bandwidthGbps: number;
}

/** サブネット */
export interface Subnet {
  id: string;
  name: string;
  cidr: string;
  az: string;
  isPublic: boolean;
  routeTableId: string;
}

/** EC2インスタンス */
export interface Instance {
  id: string;
  name: string;
  privateIp: string;
  subnetId: string;
  /** パブリックIPがある場合（パブリックサブネット上） */
  publicIp?: string;
}

/** ルートエントリ */
export interface Route {
  destination: string;
  target: string;
  targetType: "local" | "igw" | "nat" | "blackhole";
}

/** ルートテーブル */
export interface RouteTable {
  id: string;
  name: string;
  routes: Route[];
}

/** Internet Gateway */
export interface InternetGateway {
  id: string;
  name: string;
}

/** VPC全体 */
export interface Vpc {
  id: string;
  name: string;
  cidr: string;
  igw: InternetGateway;
  natGateways: NatGateway[];
  subnets: Subnet[];
  routeTables: RouteTable[];
  instances: Instance[];
}

/** NAT変換テーブルのエントリ */
export interface NatMapping {
  /** 内部ソースIP */
  internalIp: string;
  /** 内部ソースポート */
  internalPort: number;
  /** NAT後の外部IP（EIP） */
  externalIp: string;
  /** NAT後の外部ポート */
  externalPort: number;
  /** 宛先IP */
  destinationIp: string;
  /** 宛先ポート */
  destinationPort: number;
  protocol: Protocol;
  /** マッピング作成時刻（シミュレーション上のステップ） */
  createdAt: number;
  /** アイドルタイムアウト秒（TCP: 350s, UDP: 120s, ICMP: 60s） */
  idleTimeoutSec: number;
}

/** パケット定義 */
export interface PacketDef {
  direction: Direction;
  srcInstanceId: string;
  dstIp: string;
  protocol: Protocol;
  srcPort: number;
  dstPort: number;
  payload: string;
  /** レスポンス戻りパケットか */
  isResponse?: boolean;
  /** 応答元の外部IP（レスポンス用） */
  responseFromIp?: string;
}

/** シミュレーションイベント種別 */
export type EventType =
  | "packet_create"
  | "route_lookup"
  | "route_match"
  | "route_no_match"
  | "nat_gw_receive"
  | "nat_gw_snat"
  | "nat_gw_port_alloc"
  | "nat_gw_forward"
  | "nat_gw_reverse"
  | "nat_gw_dnat"
  | "nat_gw_conn_limit"
  | "nat_gw_port_exhaust"
  | "nat_gw_state_error"
  | "nat_gw_idle_timeout"
  | "igw_forward"
  | "igw_receive"
  | "deliver"
  | "drop"
  | "local_route"
  | "response_arrive";

/** シミュレーションイベント */
export interface SimEvent {
  step: number;
  type: EventType;
  resource: string;
  description: string;
  /** 関連するNATマッピング */
  mapping?: NatMapping;
}

/** シミュレーション結果 */
export interface SimulationResult {
  delivered: boolean;
  events: SimEvent[];
  natMappings: NatMapping[];
  /** ポート使用状況 */
  portUsage: { allocated: number; max: number };
}

/** プリセット定義 */
export interface Preset {
  name: string;
  description: string;
  vpc: Vpc;
  packets: PacketDef[];
}
