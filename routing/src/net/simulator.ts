/**
 * simulator.ts -- パケット転送シミュレーション
 *
 * ============================================================
 * 概要:
 * ============================================================
 * パケットを送信元ルータから宛先ルータまで、ホップバイホップ（hop-by-hop）で転送する。
 * これはIPルーティングの基本動作を忠実に再現している。
 *
 * ■ IPパケット転送の基本フロー（各ルータでの処理）:
 *   1. パケットを受信する
 *   2. 宛先IPアドレスでルーティングテーブルを検索（最長プレフィクス一致）
 *   3. 一致するエントリが見つかればネクストホップを決定
 *   4. TTLを1減算（0になればパケットを破棄しICMP Time Exceededを送信）
 *   5. ネクストホップへパケットを転送
 *   6. 宛先に到達するまでこれを繰り返す
 *
 * ■ TTL (Time To Live) の役割:
 *   ルーティングループ（経路設定の誤りで同じ場所をパケットが周回する現象）を防止する。
 *   tracerouteコマンドはTTLを1から順に増やしたパケットを送り、
 *   各ルータからのICMP Time Exceeded応答で経路を特定する仕組み。
 *
 * ■ 本シミュレータでの簡略化:
 *   - 最長プレフィクス一致の代わりにルータID完全一致で経路検索
 *   - ARP解決やレイヤ2フレーム化は省略
 *   - フラグメンテーション（MTU超過時のパケット分割）は未実装
 */
import type { NetworkGraph } from "./graph.js";
import type { Packet, HopEvent, SimulationResult } from "./types.js";

/** パケットIDの自動採番カウンタ（シミュレーション全体で一意） */
let nextPacketId = 1;

/**
 * パケット転送シミュレーションを実行する。
 *
 * 送信元ルータから宛先ルータまで、各ルータのルーティングテーブルに従って
 * パケットをホップバイホップで転送し、全ホップの記録を返す。
 *
 * @param graph - ルーティングテーブル計算済みのネットワークグラフ
 * @param srcRouterId - 送信元ルータID
 * @param dstRouterId - 宛先ルータID
 * @param payload - パケットのペイロード（表示用。デフォルトはICMP Echo Request = pingコマンド相当）
 * @returns シミュレーション結果（到達可否、全ホップの記録、失敗理由）
 */
export function simulatePacket(
  graph: NetworkGraph,
  srcRouterId: string,
  dstRouterId: string,
  payload = "ICMP Echo Request",
): SimulationResult {
  // 送信元・宛先ルータの存在確認
  const srcRouter = graph.getRouter(srcRouterId);
  const dstRouter = graph.getRouter(dstRouterId);
  if (srcRouter === undefined || dstRouter === undefined) {
    // 存在しないルータが指定された場合は即座にエラーを返す
    return {
      packet: { id: nextPacketId++, srcIp: "", dstIp: "", srcRouter: srcRouterId, dstRouter: dstRouterId, ttl: 0, payload },
      hops: [],
      delivered: false,
      reason: "unknown_router",
    };
  }

  // パケットを生成（IPヘッダの主要フィールドに相当）
  const packet: Packet = {
    id: nextPacketId++,
    srcIp: srcRouter.ip,
    dstIp: dstRouter.ip,
    srcRouter: srcRouterId,
    dstRouter: dstRouterId,
    ttl: 64,              // LinuxのデフォルトTTL値（最大64ホップまで転送可能）
    payload,
  };

  /** 全ホップの記録（tracerouteの出力に相当） */
  const hops: HopEvent[] = [];
  /** 現在パケットが存在するルータのID */
  let currentRouter = srcRouterId;
  /** シミュレーション内の経過時間（リンクコストの累積、ミリ秒単位） */
  let time = 0;

  // ホップバイホップ転送ループ: 宛先に到達するまで繰り返す
  while (currentRouter !== dstRouterId) {
    // TTLチェック: 0以下ならパケットを破棄
    // 実際のルータではICMP Type 11 (Time Exceeded) を送信元に返す
    if (packet.ttl <= 0) {
      return { packet, hops, delivered: false, reason: "ttl_exceeded" };
    }

    // 現在のルータのルーティングテーブルを参照して転送先を決定
    const router = graph.getRouter(currentRouter);
    if (router === undefined) {
      return { packet, hops, delivered: false, reason: "unknown_router" };
    }

    // ルーティングテーブル検索: 宛先ルータIDに一致するエントリを探す
    // 実際のIPルーティングでは最長プレフィクス一致（Longest Prefix Match）で
    // 宛先IPアドレスに最も具体的に一致するエントリが選ばれる
    const route = router.routingTable.find(r => r.destination === dstRouterId);
    if (route === undefined) {
      // 経路が見つからない場合はパケットを破棄
      // 実際のルータではデフォルトルート (0.0.0.0/0) があれば
      // そこに転送されるが、本シミュレータでは未実装
      return { packet, hops, delivered: false, reason: "no_route" };
    }

    // 転送先リンクを探す（コスト情報の取得用）
    const link = graph.findLink(currentRouter, route.nextHop);
    const linkCost = link?.cost ?? 1;

    // ホップイベントを記録し、TTLを1減算してネクストホップへ転送
    time += linkCost;
    packet.ttl--;

    hops.push({
      packetId: packet.id,
      fromRouter: currentRouter,
      toRouter: route.nextHop,
      linkId: link?.id ?? "",
      ttl: packet.ttl,
      routeEntry: route,
      timestamp: time,
    });

    // パケットをネクストホップに移動（次のループ反復で新しいルータから転送を継続）
    currentRouter = route.nextHop;
  }

  // 宛先ルータに到達: パケット配送成功
  return { packet, hops, delivered: true, reason: "delivered" };
}
