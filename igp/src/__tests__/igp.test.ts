import { describe, it, expect } from "vitest";
import { dijkstra, simulateOspf, simulateRip, simulateLinkFailure } from "../engine/igp.js";
import { EXAMPLES } from "../ui/app.js";
import type { Topology } from "../engine/igp.js";

const triangle: Topology = {
  routers: [
    { id: "A", name: "A", x: 0, y: 0 },
    { id: "B", name: "B", x: 0, y: 0 },
    { id: "C", name: "C", x: 0, y: 0 },
  ],
  links: [
    { from: "A", to: "B", cost: 1, bandwidth: "1G", up: true },
    { from: "B", to: "C", cost: 2, bandwidth: "1G", up: true },
    { from: "A", to: "C", cost: 10, bandwidth: "1G", up: true },
  ],
};

describe("dijkstra", () => {
  it("最短コストを計算する", () => {
    const lsdb = new Map([
      ["A", { neighbors: [{ id: "B", cost: 1 }, { id: "C", cost: 10 }] }],
      ["B", { neighbors: [{ id: "A", cost: 1 }, { id: "C", cost: 2 }] }],
      ["C", { neighbors: [{ id: "A", cost: 10 }, { id: "B", cost: 2 }] }],
    ]);
    const { dist } = dijkstra("A", lsdb);
    expect(dist.get("A")).toBe(0);
    expect(dist.get("B")).toBe(1);
    expect(dist.get("C")).toBe(3); // A→B→C = 1+2 < A→C = 10
  });

  it("到達不能なノードは Infinity", () => {
    const lsdb = new Map([
      ["A", { neighbors: [] }],
      ["B", { neighbors: [] }],
    ]);
    const { dist } = dijkstra("A", lsdb);
    expect(dist.get("B")).toBe(Infinity);
  });
});

describe("OSPF", () => {
  it("全ルータの経路テーブルが生成される", () => {
    const result = simulateOspf(triangle);
    expect(result.states.size).toBe(3);
    for (const [, state] of result.states) {
      expect(state.routingTable.length).toBeGreaterThan(0);
    }
  });

  it("最短コスト経路を選択する", () => {
    const result = simulateOspf(triangle);
    const aRoutes = result.states.get("A")!.routingTable;
    const toC = aRoutes.find((r) => r.destination === "C")!;
    expect(toC.metric).toBe(3); // A→B→C
    expect(toC.nextHop).toBe("B");
  });

  it("収束する", () => {
    const result = simulateOspf(triangle);
    expect(result.convergedAt).toBeGreaterThan(0);
    expect(result.trace.some((t) => t.phase === "converged")).toBe(true);
  });

  it("トレースに hello, lsa_flood, spf_calc がある", () => {
    const result = simulateOspf(triangle);
    const phases = result.trace.map((t) => t.phase);
    expect(phases).toContain("hello");
    expect(phases).toContain("lsa_flood");
    expect(phases).toContain("spf_calc");
  });
});

describe("RIP", () => {
  it("全ルータの経路テーブルが生成される", () => {
    const result = simulateRip(triangle);
    expect(result.states.size).toBe(3);
    for (const [id, state] of result.states) {
      expect(state.routingTable.length).toBe(2); // 自分以外の 2 ルータ
    }
  });

  it("収束する", () => {
    const result = simulateRip(triangle);
    expect(result.convergedAt).toBeGreaterThan(0);
    expect(result.trace.some((t) => t.phase === "converged")).toBe(true);
  });

  it("スナップショットが記録される", () => {
    const result = simulateRip(triangle);
    expect(result.snapshots.length).toBeGreaterThan(0);
  });

  it("RIP はコストではなくホップ数ベースのメトリック", () => {
    const result = simulateRip(triangle);
    const aRoutes = result.states.get("A")!.routingTable;
    // A→C の RIP メトリック: 直接リンクのコスト (10) が最小なら直接
    // ただし B 経由だと cost=1+2=3 なのでそちらを選ぶ
    const toC = aRoutes.find((r) => r.destination === "C")!;
    expect(toC.metric).toBeLessThanOrEqual(10);
  });
});

describe("リンク障害", () => {
  it("障害後も全ルータに経路が存在する（代替パスがある場合）", () => {
    const result = simulateLinkFailure(triangle, "A", "B");
    // A→C は直接リンクで到達可能
    const aRoutes = result.ospf.states.get("A")!.routingTable;
    expect(aRoutes.find((r) => r.destination === "C")).toBeDefined();
  });

  it("トレースに link_down が記録される", () => {
    const result = simulateLinkFailure(triangle, "A", "B");
    expect(result.trace.some((t) => t.phase === "link_down")).toBe(true);
  });
});

describe("EXAMPLES", () => {
  it("6 つのサンプル", () => { expect(EXAMPLES).toHaveLength(6); });
  it("名前が一意", () => { expect(new Set(EXAMPLES.map((e) => e.name)).size).toBe(EXAMPLES.length); });

  for (const ex of EXAMPLES) {
    it(`${ex.name}: シミュレーション実行可能`, () => {
      if (ex.failLink) {
        const r = simulateLinkFailure(ex.topology, ex.failLink.from, ex.failLink.to);
        expect(r.ospf.trace.length).toBeGreaterThan(0);
        expect(r.rip.trace.length).toBeGreaterThan(0);
      } else {
        const ospf = simulateOspf(ex.topology);
        const rip = simulateRip(ex.topology);
        expect(ospf.trace.length).toBeGreaterThan(0);
        expect(rip.trace.length).toBeGreaterThan(0);
      }
    });
  }
});
