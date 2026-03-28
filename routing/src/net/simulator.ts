/**
 * simulator.ts -- パケット転送シミュレーション
 *
 * パケットを送信元ルータから宛先ルータまでホップごとに転送する。
 * 各ホップで:
 *   1. ルーティングテーブルを参照
 *   2. ネクストホップを決定
 *   3. TTL を減算
 *   4. 次のルータに転送
 */
import type { NetworkGraph } from "./graph.js";
import type { Packet, HopEvent, SimulationResult } from "./types.js";

let nextPacketId = 1;

export function simulatePacket(
  graph: NetworkGraph,
  srcRouterId: string,
  dstRouterId: string,
  payload = "ICMP Echo Request",
): SimulationResult {
  const srcRouter = graph.getRouter(srcRouterId);
  const dstRouter = graph.getRouter(dstRouterId);
  if (srcRouter === undefined || dstRouter === undefined) {
    return {
      packet: { id: nextPacketId++, srcIp: "", dstIp: "", srcRouter: srcRouterId, dstRouter: dstRouterId, ttl: 0, payload },
      hops: [],
      delivered: false,
      reason: "unknown_router",
    };
  }

  const packet: Packet = {
    id: nextPacketId++,
    srcIp: srcRouter.ip,
    dstIp: dstRouter.ip,
    srcRouter: srcRouterId,
    dstRouter: dstRouterId,
    ttl: 64,
    payload,
  };

  const hops: HopEvent[] = [];
  let currentRouter = srcRouterId;
  let time = 0;

  while (currentRouter !== dstRouterId) {
    // TTL チェック
    if (packet.ttl <= 0) {
      return { packet, hops, delivered: false, reason: "ttl_exceeded" };
    }

    // ルーティングテーブル参照
    const router = graph.getRouter(currentRouter);
    if (router === undefined) {
      return { packet, hops, delivered: false, reason: "unknown_router" };
    }

    const route = router.routingTable.find(r => r.destination === dstRouterId);
    if (route === undefined) {
      return { packet, hops, delivered: false, reason: "no_route" };
    }

    // リンクを探す
    const link = graph.findLink(currentRouter, route.nextHop);
    const linkCost = link?.cost ?? 1;

    // ホップを記録
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

    currentRouter = route.nextHop;
  }

  return { packet, hops, delivered: true, reason: "delivered" };
}
