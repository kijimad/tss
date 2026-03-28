/**
 * types.ts -- ルーティングシミュレータの型定義
 *
 * インターネットの構造:
 *
 *   AS (自律システム) = ISPや企業のネットワーク
 *   各ASの中に複数のルータがあり、AS間はBGPで、AS内はOSPFで経路交換する
 *
 *   簡易版として:
 *   - 各ノード = ルータ（IPアドレス付き）
 *   - リンク = 物理接続（コスト = 遅延ms）
 *   - ルーティングテーブル = ダイクストラ法で計算
 *   - パケット = 送信元/宛先IPを持ち、ホップごとに転送される
 */

// ルータ
export interface Router {
  id: string;           // "R1", "R2", ...
  ip: string;           // "10.0.1.1"
  as: string;           // 所属AS名 "AS100"
  // 描画位置
  x: number;
  y: number;
  // ルーティングテーブル（ダイクストラ法で計算）
  routingTable: RouteEntry[];
}

// ルーティングテーブルエントリ
export interface RouteEntry {
  destination: string;  // 宛先ルータID
  nextHop: string;      // 次に転送するルータID
  cost: number;         // 総コスト
  path: string[];       // 経由するルータIDの列
}

// リンク（2つのルータ間の物理接続）
export interface Link {
  id: string;
  from: string;         // ルータID
  to: string;           // ルータID
  cost: number;         // コスト（遅延 ms）
  bandwidth: string;    // 表示用 "1Gbps" 等
}

// パケット
export interface Packet {
  id: number;
  srcIp: string;
  dstIp: string;
  srcRouter: string;
  dstRouter: string;
  ttl: number;
  payload: string;      // 表示用
}

// パケットが1ホップ進んだ記録
export interface HopEvent {
  packetId: number;
  fromRouter: string;
  toRouter: string;
  linkId: string;
  ttl: number;
  // ルーティング判断の詳細
  routeEntry: RouteEntry | undefined;
  timestamp: number;
}

// シミュレーション結果
export interface SimulationResult {
  packet: Packet;
  hops: HopEvent[];
  delivered: boolean;
  reason: string;       // "delivered" | "ttl_exceeded" | "no_route"
}
