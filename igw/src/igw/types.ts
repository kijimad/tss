/** IPv4アドレス */
export type IPv4 = string;
/** CIDR表記 */
export type Cidr = string;
/** リソースID */
export type ResourceId = string;

/** パケット方向 */
export type Direction = "outbound" | "inbound";

/** Elastic IP */
export interface ElasticIp {
  allocationId: ResourceId;
  publicIp: IPv4;
  associatedInstanceId?: ResourceId;
}

/** EC2インスタンス */
export interface Instance {
  id: ResourceId;
  name: string;
  privateIp: IPv4;
  publicIp?: IPv4;          // EIP or 自動割り当てパブリックIP
  subnetId: ResourceId;
  hasPublicIp: boolean;     // パブリックIP割り当て有無
}

/** サブネット */
export interface Subnet {
  id: ResourceId;
  name: string;
  cidr: Cidr;
  az: string;
  isPublic: boolean;
  mapPublicIpOnLaunch: boolean;
  routeTableId: ResourceId;
}

/** ルートエントリ */
export interface Route {
  destination: Cidr;
  target: string;
  targetType: "local" | "igw" | "nat" | "blackhole";
}

/** ルートテーブル */
export interface RouteTable {
  id: ResourceId;
  name: string;
  routes: Route[];
}

/** インターネットゲートウェイ */
export interface InternetGateway {
  id: ResourceId;
  name: string;
  attachedVpcId?: ResourceId;
  state: "attached" | "detached" | "attaching" | "detaching";
}

/** NATゲートウェイ */
export interface NatGateway {
  id: ResourceId;
  name: string;
  subnetId: ResourceId;
  publicIp: IPv4;
}

/** VPC */
export interface Vpc {
  id: ResourceId;
  name: string;
  cidr: Cidr;
  subnets: Subnet[];
  routeTables: RouteTable[];
  igw?: InternetGateway;
  natGateways: NatGateway[];
  instances: Instance[];
  elasticIps: ElasticIp[];
}

/** パケット */
export interface Packet {
  srcIp: IPv4;
  dstIp: IPv4;
  protocol: "tcp" | "udp" | "icmp";
  srcPort: number;
  dstPort: number;
  payload: string;
}

/** NAT変換テーブルエントリ */
export interface NatEntry {
  originalSrc: IPv4;
  translatedSrc: IPv4;
  originalDst: IPv4;
  direction: Direction;
  description: string;
}

/** シミュレーションイベント種別 */
export type EventType =
  | "packet_create"
  | "route_lookup"
  | "route_match"
  | "route_no_match"
  | "igw_receive"
  | "igw_nat_outbound"    // IGWでの送信時NAT: private→public
  | "igw_nat_inbound"     // IGWでの受信時NAT: public→private
  | "igw_no_public_ip"    // パブリックIPなしでIGW到達
  | "igw_forward_internet"
  | "igw_receive_internet"
  | "nat_gw_translate"
  | "subnet_forward"
  | "deliver"
  | "drop"
  | "igw_detached"
  | "igw_attach"
  | "igw_detach";

/** シミュレーションイベント */
export interface SimEvent {
  step: number;
  type: EventType;
  resource: string;
  description: string;
  packet?: Packet;
  natEntry?: NatEntry;
}

/** パケット送信定義 */
export interface PacketDef {
  direction: Direction;
  srcInstanceId?: ResourceId;   // outbound時
  srcExternalIp?: IPv4;         // inbound時
  dstIp: IPv4;
  protocol: "tcp" | "udp" | "icmp";
  srcPort: number;
  dstPort: number;
  payload: string;
}

/** シミュレーション結果 */
export interface SimulationResult {
  events: SimEvent[];
  natTable: NatEntry[];
  delivered: boolean;
}

/** プリセット定義 */
export interface Preset {
  name: string;
  description: string;
  vpc: Vpc;
  packets: PacketDef[];
}
