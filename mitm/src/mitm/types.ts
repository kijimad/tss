/* MITM シミュレーター 型定義 */

// ─── ネットワークノード ───

/** ノード種別 */
export type NodeRole = "client" | "server" | "attacker" | "router" | "dns";

/** ネットワークノード */
export interface NetNode {
  id: string;
  name: string;
  role: NodeRole;
  ip: string;
  mac: string;
}

// ─── プロトコル ───

/** プロトコル種別 */
export type Protocol = "http" | "https" | "dns" | "arp" | "tcp";

/** TLS バージョン */
export type TlsVersion = "none" | "tls1.0" | "tls1.2" | "tls1.3";

/** 証明書 */
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

/** パケット */
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

/** 攻撃手法 */
export type AttackMethod =
  | "arp_spoofing"     // ARPスプーフィング
  | "dns_spoofing"     // DNSスプーフィング
  | "ssl_stripping"    // SSLストリッピング
  | "rogue_cert"       // 偽証明書
  | "session_hijack"   // セッションハイジャック
  | "packet_injection" // パケットインジェクション
  | "passive_sniff";   // パッシブ盗聴

/** ARP テーブルエントリ */
export interface ArpEntry {
  ip: string;
  mac: string;
  /** スプーフィングされたか */
  spoofed: boolean;
}

/** DNS レコード */
export interface DnsRecord {
  domain: string;
  ip: string;
  /** スプーフィングされたか */
  spoofed: boolean;
}

// ─── 防御 ───

/** 防御設定 */
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

/** 攻撃ステップ */
export interface AttackStep {
  phase: string;
  actor: string;
  message: string;
  detail?: string;
  success: boolean;
  /** このステップで生成/傍受したパケット */
  packet?: Packet;
}

/** 攻撃結果 */
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

/** シミュレーション操作 */
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

/** イベント種別 */
export type EventType =
  | "arp" | "dns" | "intercept" | "decrypt" | "tamper"
  | "forward" | "block" | "tls" | "cert" | "info" | "warn" | "attack";

/** シミュレーションイベント */
export interface SimEvent {
  type: EventType;
  actor: string;
  message: string;
  detail?: string;
}

/** シミュレーション結果 */
export interface SimulationResult {
  results: AttackResult[];
  events: SimEvent[];
}

/** プリセット */
export interface Preset {
  name: string;
  description: string;
  build: () => SimOp[];
}
