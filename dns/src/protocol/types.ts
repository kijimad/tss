/**
 * types.ts — DNS プロトコルの型定義
 *
 * RFC 1035 に基づく DNS メッセージの構造を TypeScript で表現する。
 *
 * DNS メッセージのバイナリ構造:
 *   ┌────────────────────────────────┐
 *   │ ヘッダ (12バイト固定)            │
 *   ├────────────────────────────────┤
 *   │ Question セクション (可変長)     │ ← 問い合わせ内容
 *   ├────────────────────────────────┤
 *   │ Answer セクション (可変長)       │ ← 回答レコード
 *   ├────────────────────────────────┤
 *   │ Authority セクション (可変長)    │ ← 権威サーバ情報
 *   ├────────────────────────────────┤
 *   │ Additional セクション (可変長)   │ ← 追加情報
 *   └────────────────────────────────┘
 *
 * ヘッダ (12バイト):
 *   [ID:u16] [Flags:u16] [QDCOUNT:u16] [ANCOUNT:u16] [NSCOUNT:u16] [ARCOUNT:u16]
 *
 *   Flags の内訳 (16ビット):
 *     QR(1) OPCODE(4) AA(1) TC(1) RD(1) RA(1) Z(3) RCODE(4)
 */

// === レコード型 ===
export const RecordType = {
  A: 1,        // IPv4 アドレス
  NS: 2,       // ネームサーバ
  CNAME: 5,    // 正規名（エイリアス）
  SOA: 6,      // 権威の開始
  MX: 15,      // メール交換
  TXT: 16,     // テキスト
  AAAA: 28,    // IPv6 アドレス
} as const;
export type RecordType = (typeof RecordType)[keyof typeof RecordType];

// レコード型を文字列に変換
export function recordTypeToString(type: number): string {
  const map: Record<number, string | undefined> = {
    [RecordType.A]: "A",
    [RecordType.NS]: "NS",
    [RecordType.CNAME]: "CNAME",
    [RecordType.SOA]: "SOA",
    [RecordType.MX]: "MX",
    [RecordType.TXT]: "TXT",
    [RecordType.AAAA]: "AAAA",
  };
  return map[type] ?? `TYPE${String(type)}`;
}

// === レコードクラス ===
export const RecordClass = {
  IN: 1,       // インターネット
} as const;

// === レスポンスコード ===
export const ResponseCode = {
  NoError: 0,
  FormatError: 1,
  ServerFailure: 2,
  NameError: 3,      // NXDOMAIN: ドメインが存在しない
  NotImplemented: 4,
  Refused: 5,
} as const;
export type ResponseCode = (typeof ResponseCode)[keyof typeof ResponseCode];

// === DNS ヘッダ ===
export interface DnsHeader {
  id: number;           // トランザクションID (16ビット)
  qr: 0 | 1;           // 0=クエリ, 1=レスポンス
  opcode: number;       // 操作コード (通常0=標準クエリ)
  aa: boolean;          // 権威ある回答
  tc: boolean;          // 切り詰め（UDPで512バイト超え時）
  rd: boolean;          // 再帰要求
  ra: boolean;          // 再帰可能
  rcode: ResponseCode;  // レスポンスコード
  qdcount: number;      // Question の数
  ancount: number;      // Answer の数
  nscount: number;      // Authority の数
  arcount: number;      // Additional の数
}

// === Question セクション ===
// "example.com の A レコードを教えて" という問い合わせ
export interface DnsQuestion {
  name: string;         // ドメイン名 (例: "example.com")
  type: RecordType;     // レコード型 (例: A)
  class: number;        // クラス (通常 IN=1)
}

// === Resource Record ===
// 回答・権威・追加セクションに含まれるレコード
export interface DnsRecord {
  name: string;         // ドメイン名
  type: RecordType;     // レコード型
  class: number;        // クラス
  ttl: number;          // 生存時間（秒）。キャッシュの有効期限
  data: string;         // レコードデータ (A なら "93.184.216.34" など)
}

// === DNS メッセージ全体 ===
export interface DnsMessage {
  header: DnsHeader;
  questions: DnsQuestion[];
  answers: DnsRecord[];
  authorities: DnsRecord[];
  additionals: DnsRecord[];
}

// === ネットワークシミュレーション用の型 ===

// 仮想ネットワーク上のアドレス
export interface NetworkAddress {
  ip: string;
  port: number;
}

// UDPパケット
export interface UdpPacket {
  source: NetworkAddress;
  destination: NetworkAddress;
  data: ArrayBuffer;       // DNS メッセージのバイナリ表現
}

// ネットワークイベント（トレース用）
export type NetworkEvent =
  | { type: "udp_send"; from: string; to: string; messageId: number; questionName: string; timestamp: number }
  | { type: "udp_recv"; from: string; to: string; messageId: number; answerCount: number; timestamp: number }
  | { type: "cache_hit"; name: string; recordType: string; ttl: number; timestamp: number }
  | { type: "cache_miss"; name: string; recordType: string; timestamp: number }
  | { type: "cache_store"; name: string; recordType: string; ttl: number; timestamp: number }
  | { type: "resolve_step"; serverName: string; serverIp: string; question: string; timestamp: number };

// 解決トレース全体
export interface ResolveTrace {
  query: string;
  recordType: string;
  events: NetworkEvent[];
  totalQueries: number;
  cacheHits: number;
  result: DnsRecord[];
  elapsedMs: number;
}

// ゾーンデータ: 1つのDNSサーバが持つレコード群
export interface ZoneData {
  records: DnsRecord[];
}

// サーバ設定
export interface DnsServerConfig {
  name: string;            // サーバの名前 (例: "a.root-servers.net")
  ip: string;              // IPアドレス
  zones: Map<string, ZoneData>;  // 管理するゾーン → レコード
}
