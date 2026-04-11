/** MACアドレス文字列 */
export type MacAddr = string;

/** VLAN ID (1-4094) */
export type VlanId = number;

/** ポートモード */
export type PortMode = "access" | "trunk";

/** 802.1Qタグ */
export interface Dot1QTag {
  tpid: 0x8100;
  pcp: number;       // Priority Code Point (0-7)
  dei: number;       // Drop Eligible Indicator (0/1)
  vid: VlanId;       // VLAN Identifier
}

/** イーサネットフレーム（タグなし） */
export interface EthernetFrame {
  src: MacAddr;
  dst: MacAddr;
  tag?: Dot1QTag;
  payload: string;
}

/** スイッチポート定義 */
export interface SwitchPort {
  id: number;
  mode: PortMode;
  accessVlan: VlanId;           // accessモード時のVLAN
  allowedVlans: VlanId[];       // trunkモード時の許可VLAN
  nativeVlan: VlanId;           // trunkモード時のネイティブVLAN
  link?: { deviceId: string; portId: number };
}

/** MACアドレステーブルエントリ */
export interface MacTableEntry {
  mac: MacAddr;
  vlan: VlanId;
  port: number;
}

/** VLAN定義 */
export interface VlanEntry {
  id: VlanId;
  name: string;
}

/** VLANスイッチ */
export interface VlanSwitch {
  id: string;
  name: string;
  ports: SwitchPort[];
  macTable: MacTableEntry[];
  vlans: VlanEntry[];
}

/** ホスト（PC等） */
export interface Host {
  id: string;
  name: string;
  mac: MacAddr;
  portLink?: { deviceId: string; portId: number };
}

/** シミュレーションイベント種別 */
export type EventType =
  | "receive"
  | "tag_add"
  | "tag_remove"
  | "mac_learn"
  | "forward"
  | "flood"
  | "drop"
  | "vlan_filter"
  | "trunk_forward"
  | "native_vlan";

/** シミュレーションイベント */
export interface SimEvent {
  step: number;
  type: EventType;
  device: string;
  port?: number;
  vlan?: VlanId;
  frame?: EthernetFrame;
  description: string;
}

/** 注入フレーム */
export interface InjectFrame {
  fromHost: string;
  frame: EthernetFrame;
}

/** シミュレーション結果 */
export interface SimulationResult {
  events: SimEvent[];
  switches: VlanSwitch[];
}

/** プリセット定義 */
export interface Preset {
  name: string;
  description: string;
  switches: VlanSwitch[];
  hosts: Host[];
  frames: InjectFrame[];
}
