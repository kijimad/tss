import { describe, it, expect } from "vitest";
import { NetworkGraph } from "../net/graph.js";
import { simulatePacket } from "../net/simulator.js";
import { buildInternetTopology } from "../net/topology.js";

describe("NetworkGraph", () => {
  it("ルータとリンクを追加できる", () => {
    const g = new NetworkGraph();
    g.addRouter({ id: "A", ip: "10.0.0.1", as: "AS1", x: 0, y: 0, routingTable: [] });
    g.addRouter({ id: "B", ip: "10.0.0.2", as: "AS1", x: 0, y: 0, routingTable: [] });
    g.addLink({ id: "L1", from: "A", to: "B", cost: 1, bandwidth: "1Gbps" });
    expect(g.routers.size).toBe(2);
    expect(g.links).toHaveLength(1);
  });

  it("ダイクストラ法でルーティングテーブルを計算する", () => {
    const g = new NetworkGraph();
    g.addRouter({ id: "A", ip: "10.0.0.1", as: "AS1", x: 0, y: 0, routingTable: [] });
    g.addRouter({ id: "B", ip: "10.0.0.2", as: "AS1", x: 0, y: 0, routingTable: [] });
    g.addRouter({ id: "C", ip: "10.0.0.3", as: "AS1", x: 0, y: 0, routingTable: [] });
    g.addLink({ id: "L1", from: "A", to: "B", cost: 1, bandwidth: "1Gbps" });
    g.addLink({ id: "L2", from: "B", to: "C", cost: 2, bandwidth: "1Gbps" });
    g.addLink({ id: "L3", from: "A", to: "C", cost: 10, bandwidth: "1Gbps" });
    g.computeAllRoutes();

    const routerA = g.getRouter("A");
    expect(routerA).toBeDefined();
    // A→C: A→B→C (cost 3) が A→C (cost 10) より安い
    const routeToC = routerA?.routingTable.find(r => r.destination === "C");
    expect(routeToC?.nextHop).toBe("B");
    expect(routeToC?.cost).toBe(3);
    expect(routeToC?.path).toEqual(["A", "B", "C"]);
  });

  it("直接接続の方が安い場合はそちらを選ぶ", () => {
    const g = new NetworkGraph();
    g.addRouter({ id: "A", ip: "10.0.0.1", as: "AS1", x: 0, y: 0, routingTable: [] });
    g.addRouter({ id: "B", ip: "10.0.0.2", as: "AS1", x: 0, y: 0, routingTable: [] });
    g.addRouter({ id: "C", ip: "10.0.0.3", as: "AS1", x: 0, y: 0, routingTable: [] });
    g.addLink({ id: "L1", from: "A", to: "B", cost: 100, bandwidth: "1Gbps" });
    g.addLink({ id: "L2", from: "B", to: "C", cost: 100, bandwidth: "1Gbps" });
    g.addLink({ id: "L3", from: "A", to: "C", cost: 1, bandwidth: "1Gbps" });
    g.computeAllRoutes();

    const routeToC = g.getRouter("A")?.routingTable.find(r => r.destination === "C");
    expect(routeToC?.nextHop).toBe("C");
    expect(routeToC?.cost).toBe(1);
  });
});

describe("パケット転送シミュレーション", () => {
  it("隣接ルータに1ホップで到達する", () => {
    const g = new NetworkGraph();
    g.addRouter({ id: "A", ip: "10.0.0.1", as: "AS1", x: 0, y: 0, routingTable: [] });
    g.addRouter({ id: "B", ip: "10.0.0.2", as: "AS1", x: 0, y: 0, routingTable: [] });
    g.addLink({ id: "L1", from: "A", to: "B", cost: 1, bandwidth: "1Gbps" });
    g.computeAllRoutes();

    const result = simulatePacket(g, "A", "B");
    expect(result.delivered).toBe(true);
    expect(result.hops).toHaveLength(1);
    expect(result.hops[0]?.fromRouter).toBe("A");
    expect(result.hops[0]?.toRouter).toBe("B");
  });

  it("複数ホップで到達する", () => {
    const g = new NetworkGraph();
    g.addRouter({ id: "A", ip: "10.0.0.1", as: "AS1", x: 0, y: 0, routingTable: [] });
    g.addRouter({ id: "B", ip: "10.0.0.2", as: "AS1", x: 0, y: 0, routingTable: [] });
    g.addRouter({ id: "C", ip: "10.0.0.3", as: "AS1", x: 0, y: 0, routingTable: [] });
    g.addLink({ id: "L1", from: "A", to: "B", cost: 1, bandwidth: "1Gbps" });
    g.addLink({ id: "L2", from: "B", to: "C", cost: 1, bandwidth: "1Gbps" });
    g.computeAllRoutes();

    const result = simulatePacket(g, "A", "C");
    expect(result.delivered).toBe(true);
    expect(result.hops).toHaveLength(2);
  });

  it("存在しないルータへの送信は失敗する", () => {
    const g = new NetworkGraph();
    g.addRouter({ id: "A", ip: "10.0.0.1", as: "AS1", x: 0, y: 0, routingTable: [] });
    g.computeAllRoutes();

    const result = simulatePacket(g, "A", "Z");
    expect(result.delivered).toBe(false);
  });

  it("各ホップでTTLが減少する", () => {
    const g = new NetworkGraph();
    g.addRouter({ id: "A", ip: "10.0.0.1", as: "AS1", x: 0, y: 0, routingTable: [] });
    g.addRouter({ id: "B", ip: "10.0.0.2", as: "AS1", x: 0, y: 0, routingTable: [] });
    g.addRouter({ id: "C", ip: "10.0.0.3", as: "AS1", x: 0, y: 0, routingTable: [] });
    g.addLink({ id: "L1", from: "A", to: "B", cost: 1, bandwidth: "1Gbps" });
    g.addLink({ id: "L2", from: "B", to: "C", cost: 1, bandwidth: "1Gbps" });
    g.computeAllRoutes();

    const result = simulatePacket(g, "A", "C");
    expect(result.hops[0]?.ttl).toBe(63);
    expect(result.hops[1]?.ttl).toBe(62);
  });
});

describe("インターネットトポロジ", () => {
  it("全ルータが存在する", () => {
    const g = buildInternetTopology();
    expect(g.routers.size).toBe(10);
  });

  it("東京(R1)から大阪(R6)にパケットが届く", () => {
    const g = buildInternetTopology();
    const result = simulatePacket(g, "R1", "R6");
    expect(result.delivered).toBe(true);
    expect(result.hops.length).toBeGreaterThan(1);
  });

  it("東京(R1)から米国(R10)にパケットが届く", () => {
    const g = buildInternetTopology();
    const result = simulatePacket(g, "R1", "R10");
    expect(result.delivered).toBe(true);
    expect(result.hops.length).toBeGreaterThan(2);
  });

  it("米国(R9)から東京(R3)にパケットが届く（逆方向）", () => {
    const g = buildInternetTopology();
    const result = simulatePacket(g, "R9", "R3");
    expect(result.delivered).toBe(true);
  });

  it("最短経路を選択する", () => {
    const g = buildInternetTopology();
    // R1→R4: R1→R3→R4 (cost 4) ではなく R1→R2→R4 (cost 3)
    const result = simulatePacket(g, "R1", "R4");
    expect(result.delivered).toBe(true);
    const path = result.hops.map(h => h.fromRouter);
    path.push(result.hops[result.hops.length - 1]?.toRouter ?? "");
    expect(path).toEqual(["R1", "R2", "R4"]);
  });
});
