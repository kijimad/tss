/* ルーティングプロトコル シミュレーター 型定義 */

/** プロトコル種別 */
export type Protocol = "static" | "rip" | "ospf" | "bgp";

/** 管理距離（AD） */
export const ADMIN_DISTANCE: Record<Protocol, number> = {
  static: 1,
  rip: 120,
  ospf: 110,
  bgp: 20, // eBGP。iBGPは200
};

/** ルーター */
export interface Router {
  id: string;
  name: string;
  asNumber: number; // AS番号
  x: number;
  y: number;
  /** 各プロトコルで学習した経路 */
  protocolRoutes: Map<Protocol, RouteEntry[]>;
  /** 統合ルーティングテーブル（最良経路のみ） */
  rib: RouteEntry[];
  /** OSPF状態 */
  ospfState: OspfRouterState;
  /** BGP状態 */
  bgpState: BgpRouterState;
  /** RIP状態 */
  ripState: RipRouterState;
  /** 有効プロトコル */
  enabledProtocols: Protocol[];
  /** OSPFエリア */
  ospfArea: number;
  /** ABRかどうか */
  isABR: boolean;
}

/** ネットワークリンク */
export interface Link {
  from: string;
  to: string;
  cost: number;      // OSPFコスト
  bandwidth: number;  // Mbps
  status: "up" | "down";
}

/** ルーティングテーブルエントリ */
export interface RouteEntry {
  destination: string;  // 宛先ルーターID
  nextHop: string;      // 次ホップルーターID
  metric: number;       // プロトコル固有メトリック
  protocol: Protocol;
  ad: number;           // 管理距離
  path: string[];       // 経路（ルーターID列）
  /** BGP属性 */
  bgpAttrs?: BgpAttributes;
  /** タイムスタンプ(tick) */
  learnedAt: number;
}

/** OSPF LSA */
export interface OspfLsa {
  type: "router" | "network" | "summary"; // LSAタイプ1,2,3
  originRouter: string;
  area: number;
  linkStateId: string;
  neighbors: Array<{ routerId: string; cost: number }>;
  sequence: number;
  age: number;
}

/** OSPFルーター状態 */
export interface OspfRouterState {
  lsdb: OspfLsa[];
  neighborTable: Array<{
    routerId: string;
    state: "down" | "init" | "2way" | "full";
  }>;
  routerId: string;
}

/** BGP属性 */
export interface BgpAttributes {
  asPath: number[];
  localPref: number;
  med: number;
  origin: "igp" | "egp" | "incomplete";
  nextHop: string;
  community: string[];
}

/** BGPピア */
export interface BgpPeer {
  peerId: string;
  peerAs: number;
  localAs: number;
  type: "ebgp" | "ibgp";
  state: "idle" | "connect" | "open_sent" | "established";
  receivedRoutes: BgpRoute[];
  advertisedRoutes: BgpRoute[];
}

/** BGP経路 */
export interface BgpRoute {
  prefix: string;     // 宛先ルーターID
  attrs: BgpAttributes;
  bestPath: boolean;
  validRoute: boolean;
}

/** BGPルーター状態 */
export interface BgpRouterState {
  peers: BgpPeer[];
  adjRibIn: BgpRoute[];   // 受信経路
  locRib: BgpRoute[];     // ベスト経路
  adjRibOut: BgpRoute[];  // 広告経路
}

/** RIPルーター状態 */
export interface RipRouterState {
  distanceVector: Map<string, { metric: number; nextHop: string; changed: boolean }>;
  /** スプリットホライズン有効 */
  splitHorizon: boolean;
  /** ポイズンリバース有効 */
  poisonReverse: boolean;
}

/** シミュレーション操作 */
export type SimOp =
  | { type: "init_topology"; routers: Router[]; links: Link[] }
  | { type: "rip_send_update"; routerId: string }
  | { type: "rip_receive_update"; routerId: string; fromId: string }
  | { type: "ospf_send_hello"; routerId: string }
  | { type: "ospf_flood_lsa"; routerId: string; lsa: OspfLsa }
  | { type: "ospf_run_spf"; routerId: string }
  | { type: "bgp_open"; peerId: string; routerId: string }
  | { type: "bgp_update_send"; routerId: string; toId: string }
  | { type: "bgp_update_recv"; routerId: string; fromId: string }
  | { type: "bgp_best_path"; routerId: string }
  | { type: "rib_update"; routerId: string; protocol: Protocol }
  | { type: "link_down"; from: string; to: string }
  | { type: "link_up"; from: string; to: string }
  | { type: "converged"; protocol: Protocol; ticks: number }
  | { type: "redistribute"; from: Protocol; to: Protocol; routerId: string };

/** イベント種別 */
export type EventType =
  | "rip_update" | "rip_converge" | "rip_poison"
  | "ospf_hello" | "ospf_lsa" | "ospf_spf" | "ospf_converge"
  | "bgp_open" | "bgp_update" | "bgp_decision" | "bgp_converge"
  | "rib_install" | "link_change" | "redistribute" | "info";

/** シミュレーションイベント */
export interface SimEvent {
  tick: number;
  type: EventType;
  message: string;
  routerId?: string;
  protocol?: Protocol;
  detail?: string;
}

/** シミュレーション結果 */
export interface SimulationResult {
  routers: Router[];
  links: Link[];
  events: SimEvent[];
  ops: SimOp[];
  ticks: number;
  /** プロトコル別収束tick */
  convergence: Partial<Record<Protocol, number>>;
}

/** プリセット */
export interface Preset {
  name: string;
  description: string;
  build: () => { routers: Router[]; links: Link[]; ops: SimOp[] };
}
