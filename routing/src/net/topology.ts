/**
 * topology.ts -- サンプルネットワークトポロジ
 *
 * 複数のASにまたがるインターネットを模したトポロジ。
 *
 *          AS100 (東京)              AS200 (大阪)           AS300 (米国)
 *     ┌───────────────┐       ┌──────────────┐      ┌──────────────┐
 *     │  R1 ── R2     │       │  R5 ── R6    │      │  R8 ── R9    │
 *     │  |     |      │       │  |     |     │      │  |     |     │
 *     │  R3 ── R4     │       │  R7          │      │  R10         │
 *     └───────┼───────┘       └──────┼───────┘      └──────┼───────┘
 *             │                      │                      │
 *             └──── IX1 ────────────┘                      │
 *                    │                                      │
 *                    └──────── IX2 ────────────────────────┘
 *
 *   IX = Internet Exchange Point (AS間の接続点)
 */
import { NetworkGraph } from "./graph.js";

export function buildInternetTopology(): NetworkGraph {
  const g = new NetworkGraph();

  // === AS100: 東京 ===
  g.addRouter({ id: "R1", ip: "10.100.1.1", as: "AS100", x: 100, y: 100, routingTable: [] });
  g.addRouter({ id: "R2", ip: "10.100.2.1", as: "AS100", x: 250, y: 100, routingTable: [] });
  g.addRouter({ id: "R3", ip: "10.100.3.1", as: "AS100", x: 100, y: 220, routingTable: [] });
  g.addRouter({ id: "R4", ip: "10.100.4.1", as: "AS100", x: 250, y: 220, routingTable: [] });

  // AS100 内部リンク
  g.addLink({ id: "L1", from: "R1", to: "R2", cost: 2, bandwidth: "10Gbps" });
  g.addLink({ id: "L2", from: "R1", to: "R3", cost: 1, bandwidth: "10Gbps" });
  g.addLink({ id: "L3", from: "R2", to: "R4", cost: 1, bandwidth: "10Gbps" });
  g.addLink({ id: "L4", from: "R3", to: "R4", cost: 3, bandwidth: "1Gbps" });

  // === AS200: 大阪 ===
  g.addRouter({ id: "R5", ip: "10.200.1.1", as: "AS200", x: 500, y: 100, routingTable: [] });
  g.addRouter({ id: "R6", ip: "10.200.2.1", as: "AS200", x: 650, y: 100, routingTable: [] });
  g.addRouter({ id: "R7", ip: "10.200.3.1", as: "AS200", x: 500, y: 220, routingTable: [] });

  g.addLink({ id: "L5", from: "R5", to: "R6", cost: 1, bandwidth: "10Gbps" });
  g.addLink({ id: "L6", from: "R5", to: "R7", cost: 2, bandwidth: "1Gbps" });
  g.addLink({ id: "L7", from: "R6", to: "R7", cost: 3, bandwidth: "1Gbps" });

  // === AS300: 米国 ===
  g.addRouter({ id: "R8", ip: "10.300.1.1", as: "AS300", x: 500, y: 380, routingTable: [] });
  g.addRouter({ id: "R9", ip: "10.300.2.1", as: "AS300", x: 650, y: 380, routingTable: [] });
  g.addRouter({ id: "R10", ip: "10.300.3.1", as: "AS300", x: 575, y: 470, routingTable: [] });

  g.addLink({ id: "L8", from: "R8", to: "R9", cost: 2, bandwidth: "100Gbps" });
  g.addLink({ id: "L9", from: "R8", to: "R10", cost: 5, bandwidth: "10Gbps" });
  g.addLink({ id: "L10", from: "R9", to: "R10", cost: 3, bandwidth: "10Gbps" });

  // === IX (Internet Exchange) / AS間接続 ===
  // IX1: 東京 ↔ 大阪 (R4 ↔ R5)
  g.addLink({ id: "IX1", from: "R4", to: "R5", cost: 5, bandwidth: "100Gbps" });
  // IX2: 大阪 ↔ 米国 (R7 ↔ R8)
  g.addLink({ id: "IX2", from: "R7", to: "R8", cost: 50, bandwidth: "100Gbps" });
  // IX3: 東京 ↔ 米国 直結 (R2 ↔ R9) 太平洋海底ケーブル
  g.addLink({ id: "IX3", from: "R2", to: "R9", cost: 80, bandwidth: "40Gbps" });

  // 全ルータのルーティングテーブルを計算
  g.computeAllRoutes();

  return g;
}
