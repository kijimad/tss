/**
 * @module types
 * VLANシミュレーションで使用する型定義モジュール。
 * ネットワーク機器（スイッチ、ホスト）、フレーム、シミュレーションイベントなどの
 * データ構造をTypeScriptの型として定義する。
 */

/** MACアドレス文字列（例: "00:00:00:00:00:01"） */
export type MacAddr = string;

/** VLAN ID（IEEE 802.1Qで規定される1〜4094の範囲） */
export type VlanId = number;

/** ポートモード（accessモードまたはtrunkモード） */
export type PortMode = "access" | "trunk";

/**
 * IEEE 802.1Qタグ。
 * イーサネットフレームに付加されるVLAN識別情報を表す。
 */
export interface Dot1QTag {
  /** タグプロトコル識別子（常に0x8100） */
  tpid: 0x8100;
  /** 優先度コードポイント（0〜7） */
  pcp: number;
  /** 破棄適格インジケータ（0または1） */
  dei: number;
  /** VLAN識別子 */
  vid: VlanId;
}

/**
 * イーサネットフレーム。
 * 802.1Qタグはオプションで、トランクポート経由の場合に付加される。
 */
export interface EthernetFrame {
  /** 送信元MACアドレス */
  src: MacAddr;
  /** 宛先MACアドレス */
  dst: MacAddr;
  /** 802.1Qタグ（タグ付きフレームの場合のみ） */
  tag?: Dot1QTag;
  /** フレームのペイロード（データ内容） */
  payload: string;
}

/**
 * スイッチポート定義。
 * accessモードとtrunkモードの両方の設定を保持する。
 */
export interface SwitchPort {
  /** ポート番号 */
  id: number;
  /** ポートの動作モード */
  mode: PortMode;
  /** accessモード時に割り当てられるVLAN ID */
  accessVlan: VlanId;
  /** trunkモード時に通過を許可するVLAN IDのリスト */
  allowedVlans: VlanId[];
  /** trunkモード時のネイティブVLAN（タグなしフレームに適用） */
  nativeVlan: VlanId;
  /** 接続先デバイスとポートの情報 */
  link?: { deviceId: string; portId: number };
}

/**
 * MACアドレステーブルのエントリ。
 * スイッチが学習したMACアドレスとVLAN、ポートの対応関係を保持する。
 */
export interface MacTableEntry {
  /** 学習されたMACアドレス */
  mac: MacAddr;
  /** MACアドレスが所属するVLAN */
  vlan: VlanId;
  /** MACアドレスが学習されたポート番号 */
  port: number;
}

/**
 * VLAN定義。
 * スイッチに設定されるVLANのIDと名称を保持する。
 */
export interface VlanEntry {
  /** VLAN ID */
  id: VlanId;
  /** VLANの名称（例: "Sales", "Engineering"） */
  name: string;
}

/**
 * VLANスイッチ。
 * ポート、MACアドレステーブル、VLAN設定を持つL2スイッチを表す。
 */
export interface VlanSwitch {
  /** スイッチの一意識別子 */
  id: string;
  /** スイッチの表示名 */
  name: string;
  /** スイッチに搭載されたポートの一覧 */
  ports: SwitchPort[];
  /** MACアドレス学習テーブル */
  macTable: MacTableEntry[];
  /** スイッチに設定されたVLANの一覧 */
  vlans: VlanEntry[];
}

/**
 * ホスト（PC等のエンドデバイス）。
 * スイッチのポートに接続してフレームを送受信する。
 */
export interface Host {
  /** ホストの一意識別子 */
  id: string;
  /** ホストの表示名 */
  name: string;
  /** ホストのMACアドレス */
  mac: MacAddr;
  /** 接続先スイッチポートの情報 */
  portLink?: { deviceId: string; portId: number };
}

/**
 * シミュレーションイベント種別。
 * フレーム処理の各段階で発生するイベントの種類を表す。
 */
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

/**
 * シミュレーションイベント。
 * シミュレーション中に発生した各イベントの詳細情報を保持する。
 */
export interface SimEvent {
  /** イベント発生時のステップ番号 */
  step: number;
  /** イベントの種類 */
  type: EventType;
  /** イベントが発生したデバイス名 */
  device: string;
  /** イベントに関連するポート番号 */
  port?: number;
  /** イベントに関連するVLAN ID */
  vlan?: VlanId;
  /** イベントに関連するフレーム */
  frame?: EthernetFrame;
  /** イベントの説明文（日本語） */
  description: string;
}

/**
 * 注入フレーム。
 * シミュレーション開始時にホストから送信されるフレームを定義する。
 */
export interface InjectFrame {
  /** フレーム送信元ホストのID */
  fromHost: string;
  /** 送信するイーサネットフレーム */
  frame: EthernetFrame;
}

/**
 * シミュレーション結果。
 * シミュレーション実行後のイベントログとスイッチの最終状態を保持する。
 */
export interface SimulationResult {
  /** シミュレーション中に発生したイベントのログ */
  events: SimEvent[];
  /** シミュレーション後のスイッチ状態（MACテーブル含む） */
  switches: VlanSwitch[];
}

/**
 * プリセット定義。
 * シミュレーション実験のプリセット構成を定義する。
 * スイッチ、ホスト、注入フレームの組み合わせで実験シナリオを構成する。
 */
export interface Preset {
  /** プリセットの名称 */
  name: string;
  /** プリセットの説明文 */
  description: string;
  /** プリセットに含まれるスイッチの構成 */
  switches: VlanSwitch[];
  /** プリセットに含まれるホストの構成 */
  hosts: Host[];
  /** シミュレーション時に注入するフレーム */
  frames: InjectFrame[];
}
