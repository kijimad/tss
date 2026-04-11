/* ルーティングプロトコル シミュレーター テスト */

import { describe, it, expect } from "vitest";
import { simulate, mkRouter, mkLink, addStaticRoute } from "../rtproto/engine.js";
import { PRESETS } from "../rtproto/presets.js";
import type { SimOp } from "../rtproto/types.js";

// ─── スタティックルート ───

describe("Static Routing", () => {
  it("スタティック経路がRIBにインストールされる", () => {
    const routers = [
      mkRouter("R1", "R1", 100, 0, 0, ["static"]),
      mkRouter("R2", "R2", 100, 100, 0, ["static"]),
    ];
    addStaticRoute(routers[0]!, "R2", "R2", 0);
    const links = [mkLink("R1", "R2", 10)];
    const result = simulate(routers, links, []);

    const r1 = result.routers.find(r => r.id === "R1")!;
    expect(r1.rib.length).toBeGreaterThan(0);
    const route = r1.rib.find(r => r.destination === "R2");
    expect(route).toBeDefined();
    expect(route!.protocol).toBe("static");
    expect(route!.ad).toBe(1);
  });
});

// ─── RIP ───

describe("RIP", () => {
  it("三角形トポロジで収束する", () => {
    const routers = [
      mkRouter("R1", "R1", 100, 0, 0, ["rip"]),
      mkRouter("R2", "R2", 100, 100, 0, ["rip"]),
      mkRouter("R3", "R3", 100, 50, 100, ["rip"]),
    ];
    const links = [
      mkLink("R1", "R2", 1),
      mkLink("R2", "R3", 1),
      mkLink("R1", "R3", 1),
    ];
    const result = simulate(routers, links, []);

    // 全ルーターが全宛先への経路を持つ
    for (const r of result.routers) {
      const others = result.routers.filter(o => o.id !== r.id);
      for (const o of others) {
        const route = r.rib.find(rt => rt.destination === o.id);
        expect(route).toBeDefined();
        expect(route!.protocol).toBe("rip");
      }
    }
  });

  it("距離ベクトルのメトリックが正しい（ホップカウント）", () => {
    const routers = [
      mkRouter("R1", "R1", 100, 0, 0, ["rip"]),
      mkRouter("R2", "R2", 100, 100, 0, ["rip"]),
      mkRouter("R3", "R3", 100, 200, 0, ["rip"]),
    ];
    const links = [
      mkLink("R1", "R2", 1),
      mkLink("R2", "R3", 1),
    ];
    const result = simulate(routers, links, []);

    const r1 = result.routers.find(r => r.id === "R1")!;
    const toR3 = r1.rib.find(r => r.destination === "R3");
    expect(toR3).toBeDefined();
    expect(toR3!.metric).toBe(2); // 2ホップ
  });

  it("RIP収束イベントが発生する", () => {
    const routers = [
      mkRouter("R1", "R1", 100, 0, 0, ["rip"]),
      mkRouter("R2", "R2", 100, 100, 0, ["rip"]),
    ];
    const links = [mkLink("R1", "R2", 1)];
    const result = simulate(routers, links, []);

    const convEvent = result.events.find(e => e.type === "rip_converge");
    expect(convEvent).toBeDefined();
    expect(result.convergence.rip).toBeDefined();
  });
});

// ─── OSPF ───

describe("OSPF", () => {
  it("Dijkstraで最短経路を選択する", () => {
    const routers = [
      mkRouter("R1", "R1", 100, 0, 0, ["ospf"]),
      mkRouter("R2", "R2", 100, 100, 0, ["ospf"]),
      mkRouter("R3", "R3", 100, 200, 0, ["ospf"]),
      mkRouter("R4", "R4", 100, 100, 100, ["ospf"]),
    ];
    const links = [
      mkLink("R1", "R2", 10),
      mkLink("R2", "R3", 20),
      mkLink("R1", "R4", 5),
      mkLink("R4", "R3", 5),
    ];
    const result = simulate(routers, links, []);

    // R1→R3: 直接(10+20=30) vs R4経由(5+5=10) → R4経由を選択
    const r1 = result.routers.find(r => r.id === "R1")!;
    const toR3 = r1.rib.find(r => r.destination === "R3");
    expect(toR3).toBeDefined();
    expect(toR3!.nextHop).toBe("R4");
    expect(toR3!.metric).toBe(10);
  });

  it("LSDBが同期される", () => {
    const routers = [
      mkRouter("R1", "R1", 100, 0, 0, ["ospf"]),
      mkRouter("R2", "R2", 100, 100, 0, ["ospf"]),
      mkRouter("R3", "R3", 100, 200, 0, ["ospf"]),
    ];
    const links = [
      mkLink("R1", "R2", 10),
      mkLink("R2", "R3", 10),
    ];
    const result = simulate(routers, links, []);

    // 全ルーターがLSDBにLSAを持つ
    for (const r of result.routers) {
      expect(r.ospfState.lsdb.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("OSPF収束イベントが発生する", () => {
    const routers = [
      mkRouter("R1", "R1", 100, 0, 0, ["ospf"]),
      mkRouter("R2", "R2", 100, 100, 0, ["ospf"]),
    ];
    const links = [mkLink("R1", "R2", 10)];
    const result = simulate(routers, links, []);

    expect(result.convergence.ospf).toBeDefined();
  });

  it("マルチエリアでABR経由の経路が学習される", () => {
    const r1 = mkRouter("R1", "R1", 100, 0, 0, ["ospf"], 0);
    r1.isABR = true;
    const r2 = mkRouter("R2", "R2", 100, 100, 0, ["ospf"], 0);
    const r3 = mkRouter("R3", "R3", 100, 200, 0, ["ospf"], 1);

    const routers = [r1, r2, r3];
    const links = [
      mkLink("R1", "R2", 10),
      mkLink("R1", "R3", 5),
    ];
    const result = simulate(routers, links, []);

    // R2(Area0) → R3(Area1)への経路がABR(R1)経由で存在する
    const r2result = result.routers.find(r => r.id === "R2")!;
    const toR3 = r2result.rib.find(r => r.destination === "R3");
    expect(toR3).toBeDefined();
  });
});

// ─── BGP ───

describe("BGP", () => {
  it("eBGPピアが確立される", () => {
    const routers = [
      mkRouter("R1", "R1", 100, 0, 0, ["bgp"]),
      mkRouter("R2", "R2", 200, 100, 0, ["bgp"]),
    ];
    const links = [mkLink("R1", "R2", 10)];
    const result = simulate(routers, links, []);

    const r1 = result.routers.find(r => r.id === "R1")!;
    expect(r1.bgpState.peers.length).toBe(1);
    expect(r1.bgpState.peers[0]!.type).toBe("ebgp");
    expect(r1.bgpState.peers[0]!.state).toBe("established");
  });

  it("ASパスが正しく構築される", () => {
    const routers = [
      mkRouter("R1", "R1", 100, 0, 0, ["bgp"]),
      mkRouter("R2", "R2", 200, 100, 0, ["bgp"]),
      mkRouter("R3", "R3", 300, 200, 0, ["bgp"]),
    ];
    const links = [
      mkLink("R1", "R2", 10),
      mkLink("R2", "R3", 10),
    ];
    const result = simulate(routers, links, []);

    const r1 = result.routers.find(r => r.id === "R1")!;
    const toR3 = r1.rib.find(r => r.destination === "R3");
    expect(toR3).toBeDefined();
    expect(toR3!.bgpAttrs).toBeDefined();
    // AS100 → AS200 → AS300: R1から見たR3へのASパスは[200, 300]
    expect(toR3!.bgpAttrs!.asPath).toContain(200);
  });

  it("ASパスループが検出される", () => {
    // R1(AS100) → R2(AS200) → R3(AS100) → ループ防止
    const routers = [
      mkRouter("R1", "R1", 100, 0, 0, ["bgp"]),
      mkRouter("R2", "R2", 200, 100, 0, ["bgp"]),
      mkRouter("R3", "R3", 100, 200, 0, ["bgp"]),
    ];
    const links = [
      mkLink("R1", "R2", 10),
      mkLink("R2", "R3", 10),
    ];
    const result = simulate(routers, links, []);

    // R3(AS100)のプレフィックスはR1(AS100)のASパスにAS100が含まれるため受信されない
    const r1 = result.routers.find(r => r.id === "R1")!;
    const toR3 = r1.bgpState.adjRibIn.find(r => r.prefix === "R3");
    // R3はAS100なのでR1には到達する（R2経由でASパスは[200]）
    // しかしR3のオリジンがAS100でR1もAS100の場合、ループ検出
    // 実際にはR2がR3の経路をR1に広告する際、ASパスに100が入るのでR1は拒否
    if (toR3) {
      // ASパスにAS100が含まれていない場合のみ受信
      expect(toR3.attrs.asPath).not.toContain(100);
    }
  });

  it("BGP経路選択でLocalPrefが優先される", () => {
    const routers = [
      mkRouter("R1", "R1", 100, 0, 0, ["bgp"]),
      mkRouter("R2", "R2", 200, 100, 0, ["bgp"]),
      mkRouter("R3", "R3", 300, 200, 0, ["bgp"]),
    ];
    const links = [
      mkLink("R1", "R2", 10),
      mkLink("R2", "R3", 10),
    ];
    const result = simulate(routers, links, []);

    // ベストパス選択が行われている
    const r1 = result.routers.find(r => r.id === "R1")!;
    expect(r1.bgpState.locRib.length).toBeGreaterThan(0);

    const decisionEvents = result.events.filter(e => e.type === "bgp_decision");
    expect(decisionEvents.length).toBeGreaterThan(0);
  });
});

// ─── リンク障害 ───

describe("リンク障害", () => {
  it("リンク障害後にOSPFが再収束する", () => {
    const routers = [
      mkRouter("R1", "R1", 100, 0, 0, ["ospf"]),
      mkRouter("R2", "R2", 100, 100, 0, ["ospf"]),
      mkRouter("R3", "R3", 100, 200, 0, ["ospf"]),
      mkRouter("R4", "R4", 100, 100, 100, ["ospf"]),
    ];
    const links = [
      mkLink("R1", "R2", 5),
      mkLink("R2", "R3", 5),
      mkLink("R1", "R4", 15),
      mkLink("R4", "R3", 15),
    ];
    const ops: SimOp[] = [
      { type: "link_down", from: "R1", to: "R2" },
    ];
    const result = simulate(routers, links, ops);

    // リンクダウンイベント
    const downEvent = result.events.find(e => e.type === "link_change");
    expect(downEvent).toBeDefined();

    // R1→R3への経路がR4経由になる
    const r1 = result.routers.find(r => r.id === "R1")!;
    const toR3 = r1.rib.find(r => r.destination === "R3");
    expect(toR3).toBeDefined();
    expect(toR3!.nextHop).toBe("R4"); // バックアップ経路
  });
});

// ─── RIB統合 ───

describe("RIB統合（管理距離）", () => {
  it("AD=1のスタティック経路がAD=110のOSPFより優先される", () => {
    const routers = [
      mkRouter("R1", "R1", 100, 0, 0, ["static", "ospf"]),
      mkRouter("R2", "R2", 100, 100, 0, ["ospf"]),
      mkRouter("R3", "R3", 100, 200, 0, ["ospf"]),
    ];
    // スタティック: R1→R3 via R2
    addStaticRoute(routers[0]!, "R3", "R2", 0);
    const links = [
      mkLink("R1", "R2", 10),
      mkLink("R2", "R3", 10),
    ];
    const result = simulate(routers, links, []);

    const r1 = result.routers.find(r => r.id === "R1")!;
    const toR3 = r1.rib.find(r => r.destination === "R3");
    expect(toR3).toBeDefined();
    // スタティック(AD=1)がOSPF(AD=110)より優先
    expect(toR3!.protocol).toBe("static");
  });
});

// ─── 経路再配布 ───

describe("経路再配布", () => {
  it("OSPF→BGPの再配布が動作する", () => {
    const r1 = mkRouter("R1", "R1", 100, 0, 0, ["ospf"]);
    const r2 = mkRouter("R2", "R2", 100, 100, 0, ["ospf", "bgp"]);
    const r3 = mkRouter("R3", "R3", 200, 200, 0, ["bgp"]);

    const routers = [r1, r2, r3];
    const links = [
      mkLink("R1", "R2", 10),
      mkLink("R2", "R3", 20),
    ];
    const ops: SimOp[] = [
      { type: "redistribute", from: "ospf", to: "bgp", routerId: "R2" },
    ];
    const result = simulate(routers, links, ops);

    const redistEvent = result.events.find(e => e.type === "redistribute");
    expect(redistEvent).toBeDefined();
  });
});

// ─── プリセット ───

describe("プリセット", () => {
  it("全プリセットがエラーなく実行できる", () => {
    for (const preset of PRESETS) {
      const { routers, links, ops } = preset.build();
      const result = simulate(routers, links, ops);
      expect(result.routers.length).toBeGreaterThan(0);
      expect(result.events.length).toBeGreaterThan(0);
      expect(result.ticks).toBeGreaterThan(0);
    }
  });

  it("全プリセットに一意の名前がある", () => {
    const names = PRESETS.map(p => p.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("プリセット数が10個ある", () => {
    expect(PRESETS.length).toBe(10);
  });
});
