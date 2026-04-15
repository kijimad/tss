/**
 * @module types
 * MITM（中間者攻撃）シミュレーターの型定義モジュール。
 *
 * ネットワークノード、パケット、攻撃手法、防御設定、シミュレーション結果など、
 * シミュレーター全体で使用されるインターフェースと型エイリアスを定義する。
 */

// ─── ネットワークノード ───

/** ノード種別 */
export type NodeRole = "client" | "server" | "attacker" | "router" | "dns";

/**
 * ネットワークノード。
 * シミュレーション上の各ネットワーク参加者（クライアント、サーバー、攻撃者等）を表す。
 */
export interface NetNode {
  /** ノードの一意識別子 */
  id: string;
  /** ノードの表示名 */
  name: string;
  /** ノードの役割 */
  role: NodeRole;
  /** IPアドレス */
  ip: string;
  /** MACアドレス */
  mac: string;
}

// ─── プロトコル ───

/** プロトコル種別 */
export type Protocol = "http" | "https" | "dns" | "arp" | "tcp";

/** TLS バージョン */
export type TlsVersion = "none" | "tls1.0" | "tls1.2" | "tls1.3";

/**
 * TLS/SSL証明書。
 * サーバーの身元を証明するために使用される。攻撃者は偽の証明書を生成して
 * MITM攻撃を試みることがある。
 */
export interface Certificate {
  subject: string;
  issuer: string;
  /** 正規のCAが発行したか */
  validCa: boolean;
  /** ドメイン名一致 */
  domainMatch: boolean;
  /** 有効期限内か */
  notExpired: boolean;
  /** 自己署名か */
  selfSigned: boolean;
  fingerprint: string;
}

// ─── パケット ───

/**
 * ネットワークパケット。
 * シミュレーション上でノード間を流れるデータの単位。
 * 傍受・改ざん・暗号化の状態を追跡する。
 */
export interface Packet {
  id: number;
  protocol: Protocol;
  srcIp: string;
  dstIp: string;
  srcMac: string;
  dstMac: string;
  /** ペイロード（平文 or 暗号化済み） */
  payload: string;
  /** 暗号化されているか */
  encrypted: boolean;
  /** TLSバージョン */
  tls: TlsVersion;
  /** 改ざんされたか */
  tampered: boolean;
  /** 元のペイロード（改ざん前） */
  originalPayload?: string;
  timestamp: number;
}

// ─── MITM攻撃手法 ───

/**
 * MITM攻撃手法の種別。
 * 各手法はネットワーク層や攻撃の性質が異なり、異なる防御策が必要となる。
 */
export type AttackMethod =
  | "arp_spoofing"     // ARPスプーフィング
  | "dns_spoofing"     // DNSスプーフィング
  | "ssl_stripping"    // SSLストリッピング
  | "rogue_cert"       // 偽証明書
  | "session_hijack"   // セッションハイジャック
  | "packet_injection" // パケットインジェクション
  | "passive_sniff";   // パッシブ盗聴

/**
 * ARPテーブルエントリ。
 * IPアドレスとMACアドレスの対応関係を保持する。
 * ARPスプーフィング攻撃ではこの対応が偽装される。
 */
export interface ArpEntry {
  ip: string;
  mac: string;
  /** スプーフィングされたか */
  spoofed: boolean;
}

/**
 * DNSレコード。
 * ドメイン名からIPアドレスへの名前解決情報を保持する。
 * DNSスプーフィング攻撃ではこの解決先が偽装される。
 */
export interface DnsRecord {
  domain: string;
  ip: string;
  /** スプーフィングされたか */
  spoofed: boolean;
}

// ─── 防御 ───

/**
 * 防御設定。
 * MITM攻撃に対する各種防御メカニズムの有効/無効を制御する。
 * シミュレーションで防御の効果を検証するために使用する。
 */
export interface Defense {
  /** HSTS有効 */
  hsts: boolean;
  /** 証明書ピンニング */
  certPinning: boolean;
  /** DNSSECバリデーション */
  dnssec: boolean;
  /** 静的ARPエントリ */
  staticArp: boolean;
  /** TLS最小バージョン */
  minTls: TlsVersion;
  /** 証明書検証を厳格にするか */
  strictCertValidation: boolean;
}

// ─── シミュレーション ───

/**
 * 攻撃ステップ。
 * シミュレーション中の各フェーズにおける動作と結果を記録する。
 */
export interface AttackStep {
  /** フェーズ名（例: "ARPスプーフィング", "パケット傍受"） */
  phase: string;
  /** 動作の実行者（例: "攻撃者", "クライアント"） */
  actor: string;
  /** ステップの説明メッセージ */
  message: string;
  /** 詳細情報（任意） */
  detail?: string;
  /** ステップが成功したか */
  success: boolean;
  /** このステップで生成/傍受したパケット */
  packet?: Packet;
}

/**
 * 攻撃結果。
 * 単一の攻撃シミュレーションの全結果を保持する。
 * 攻撃の成否、傍受されたパケット、防御の効果などを含む。
 */
export interface AttackResult {
  method: AttackMethod;
  /** ネットワークノード */
  nodes: NetNode[];
  /** ARPテーブル（攻撃後） */
  arpTable: ArpEntry[];
  /** DNSレコード（攻撃後） */
  dnsRecords: DnsRecord[];
  /** 傍受・改ざんされたパケット */
  packets: Packet[];
  /** 攻撃ステップ */
  steps: AttackStep[];
  /** 攻撃成功したか */
  intercepted: boolean;
  /** データ漏洩したか */
  dataLeaked: boolean;
  /** 改ざん成功したか */
  tampered: boolean;
  /** 防御によりブロックされた理由 */
  blocked: string[];
  /** 防御勧告 */
  mitigations: string[];
}

/**
 * シミュレーション操作。
 * 実行する攻撃の種類、プロトコル、TLS設定、防御設定などを指定する。
 * エンジンはこの情報に基づいて攻撃シミュレーションを実行する。
 */
export type SimOp = {
  type: "attack";
  method: AttackMethod;
  /** 通信プロトコル */
  protocol: Protocol;
  tls: TlsVersion;
  /** サーバー証明書 */
  serverCert?: Certificate;
  /** 防御設定 */
  defense: Defense;
  /** 通信内容（シミュレーション用） */
  httpPayload: string;
};

/**
 * イベント種別。
 * シミュレーション中に発生する各種イベントを分類するための型。
 */
export type EventType =
  | "arp" | "dns" | "intercept" | "decrypt" | "tamper"
  | "forward" | "block" | "tls" | "cert" | "info" | "warn" | "attack";

/**
 * シミュレーションイベント。
 * シミュレーション中に発生した個々のイベントを記録する。
 * UIのイベントログに表示される。
 */
export interface SimEvent {
  /** イベントの種別 */
  type: EventType;
  /** イベントの実行者 */
  actor: string;
  /** イベントの説明メッセージ */
  message: string;
  /** 追加の詳細情報（任意） */
  detail?: string;
}

/** シミュレーション結果。複数攻撃の実行結果とイベントログを集約する。 */
export interface SimulationResult {
  results: AttackResult[];
  events: SimEvent[];
}

/**
 * シミュレーションプリセット。
 * よくある攻撃シナリオを定義し、UIのセレクトボックスから選択可能にする。
 */
export interface Preset {
  /** プリセット名（UI表示用） */
  name: string;
  /** プリセットの説明 */
  description: string;
  /** シミュレーション操作の一覧を生成する関数 */
  build: () => SimOp[];
}
