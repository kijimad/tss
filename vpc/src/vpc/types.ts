/** IPv4 CIDR表記 */
export type Cidr = string;   // "10.0.0.0/16"
/** IPv4アドレス */
export type IPv4 = string;
/** リソースID */
export type ResourceId = string;

/** VPC */
export interface Vpc {
  id: ResourceId;
  name: string;
  cidr: Cidr;
  subnets: Subnet[];
  routeTables: RouteTable[];
  igw?: InternetGateway;
  natGateways: NatGateway[];
  networkAcls: NetworkAcl[];
  peeringConnections: VpcPeering[];
}

/** サブネット */
export interface Subnet {
  id: ResourceId;
  name: string;
  cidr: Cidr;
  az: string;               // アベイラビリティゾーン
  isPublic: boolean;
  routeTableId: ResourceId;
  instances: Instance[];
}

/** EC2インスタンス */
export interface Instance {
  id: ResourceId;
  name: string;
  privateIp: IPv4;
  publicIp?: IPv4;
  securityGroups: SecurityGroup[];
}

/** セキュリティグループ */
export interface SecurityGroup {
  id: ResourceId;
  name: string;
  inboundRules: SgRule[];
  outboundRules: SgRule[];
}

/** セキュリティグループルール */
export interface SgRule {
  protocol: "tcp" | "udp" | "icmp" | "all";
  fromPort: number;
  toPort: number;
  source: string;  // CIDR or SG ID
  description: string;
}

/** ルートテーブル */
export interface RouteTable {
  id: ResourceId;
  name: string;
  routes: Route[];
}

/** ルートエントリ */
export interface Route {
  destination: Cidr;
  target: string;       // "local" | "igw-xxx" | "nat-xxx" | "pcx-xxx"
  targetType: "local" | "igw" | "nat" | "peering";
}

/** インターネットゲートウェイ */
export interface InternetGateway {
  id: ResourceId;
  name: string;
}

/** NATゲートウェイ */
export interface NatGateway {
  id: ResourceId;
  name: string;
  subnetId: ResourceId;
  publicIp: IPv4;
}

/** ネットワークACL */
export interface NetworkAcl {
  id: ResourceId;
  name: string;
  subnetIds: ResourceId[];
  inboundRules: AclRule[];
  outboundRules: AclRule[];
}

/** ACLルール */
export interface AclRule {
  ruleNumber: number;
  protocol: "tcp" | "udp" | "icmp" | "all";
  fromPort: number;
  toPort: number;
  cidr: Cidr;
  action: "allow" | "deny";
}

/** VPCピアリング */
export interface VpcPeering {
  id: ResourceId;
  name: string;
  peerVpcId: ResourceId;
  localCidr: Cidr;
  peerCidr: Cidr;
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

/** シミュレーションイベント種別 */
export type EventType =
  | "packet_create"
  | "route_lookup"
  | "route_match"
  | "route_no_match"
  | "nacl_evaluate"
  | "nacl_allow"
  | "nacl_deny"
  | "sg_evaluate"
  | "sg_allow"
  | "sg_deny"
  | "igw_forward"
  | "nat_translate"
  | "peering_forward"
  | "subnet_forward"
  | "deliver"
  | "drop";

/** シミュレーションイベント */
export interface SimEvent {
  step: number;
  type: EventType;
  resource: string;
  description: string;
  packet?: Packet;
}

/** パケット送信定義 */
export interface PacketDef {
  srcInstanceId: ResourceId;
  dstIp: IPv4;
  protocol: "tcp" | "udp" | "icmp";
  srcPort: number;
  dstPort: number;
  payload: string;
}

/** シミュレーション結果 */
export interface SimulationResult {
  events: SimEvent[];
  delivered: boolean;
}

/** プリセット定義 */
export interface Preset {
  name: string;
  description: string;
  vpcs: Vpc[];
  packets: PacketDef[];
}
