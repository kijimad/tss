import { describe, it, expect } from "vitest";
import {
  jitteredDelay, icmpChecksum, calculateStats,
  findRoute, nodeIp, getLink, nodeMtu,
  PingSimulator, host, router, link,
} from "../engine/ping.js";
import { EXPERIMENTS } from "../ui/app.js";
import type { Topology, PingConfig, TracerouteConfig } from "../engine/ping.js";

// ── ユーティリティ ──

describe("jitteredDelay", () => {
  it("ジッター 0 なら基本値を返す", () => {
    expect(jitteredDelay(10, 0)).toBe(10);
  });

  it("負の値にならない", () => {
    for (let i = 0; i < 50; i++) {
      expect(jitteredDelay(5, 0.9)).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("icmpChecksum", () => {
  it("同じパケットで同じチェックサムを返す", () => {
    const pkt = { type: "echo-request" as const, code: 0, id: 1, seq: 1, ttl: 64, payloadSize: 56, df: false, srcIp: "0", dstIp: "0" };
    expect(icmpChecksum(pkt)).toBe(icmpChecksum(pkt));
  });
});

describe("calculateStats", () => {
  it("全成功の統計", () => {
    const replies = [
      { seq: 1, fromIp: "1.2.3.4", fromName: "a", rtt: 10, ttl: 64, success: true, icmpType: "echo-reply" as const, bytes: 84 },
      { seq: 2, fromIp: "1.2.3.4", fromName: "a", rtt: 20, ttl: 64, success: true, icmpType: "echo-reply" as const, bytes: 84 },
      { seq: 3, fromIp: "1.2.3.4", fromName: "a", rtt: 15, ttl: 64, success: true, icmpType: "echo-reply" as const, bytes: 84 },
    ];
    const stats = calculateStats(replies, 3);
    expect(stats.transmitted).toBe(3);
    expect(stats.received).toBe(3);
    expect(stats.lossPercent).toBe(0);
    expect(stats.rttMin).toBe(10);
    expect(stats.rttMax).toBe(20);
    expect(stats.rttAvg).toBe(15);
  });

  it("一部失敗の統計", () => {
    const replies = [
      { seq: 1, fromIp: "1.2.3.4", fromName: "a", rtt: 10, ttl: 64, success: true, icmpType: "echo-reply" as const, bytes: 84 },
      { seq: 2, fromIp: "", fromName: "", rtt: 0, ttl: 0, success: false, icmpType: "echo-request" as const, bytes: 56, error: "lost" },
    ];
    const stats = calculateStats(replies, 2);
    expect(stats.received).toBe(1);
    expect(stats.lossPercent).toBe(50);
  });

  it("全失敗の統計", () => {
    const stats = calculateStats([], 5);
    expect(stats.received).toBe(0);
    expect(stats.lossPercent).toBe(100);
    expect(stats.rttAvg).toBe(0);
  });
});

// ── 経路探索 ──

describe("findRoute", () => {
  const topo: Topology = {
    hosts: [host("a", "10.0.0.1"), host("c", "10.0.2.1")],
    routers: [router("r1", ["10.0.1.1"])],
    links: [link("a", "r1", 1), link("r1", "c", 1)],
  };

  it("経路が見つかる", () => {
    const route = findRoute(topo, "a", "c");
    expect(route).toEqual(["a", "r1", "c"]);
  });

  it("存在しないノードは undefined", () => {
    expect(findRoute(topo, "a", "unknown")).toBeUndefined();
  });

  it("同じノードへの経路", () => {
    const route = findRoute(topo, "a", "a");
    expect(route).toEqual(["a"]);
  });
});

describe("nodeIp", () => {
  const topo: Topology = {
    hosts: [host("h", "10.0.0.1")],
    routers: [router("r", ["10.0.1.1", "10.0.2.1"])],
    links: [],
  };

  it("ホストの IP を取得", () => {
    expect(nodeIp(topo, "h")).toBe("10.0.0.1");
  });

  it("ルーターの最初の IP を取得", () => {
    expect(nodeIp(topo, "r")).toBe("10.0.1.1");
  });

  it("不明ノードは 0.0.0.0", () => {
    expect(nodeIp(topo, "x")).toBe("0.0.0.0");
  });
});

describe("getLink", () => {
  const topo: Topology = {
    hosts: [], routers: [],
    links: [link("a", "b", 10)],
  };

  it("順方向でリンクを取得", () => {
    expect(getLink(topo, "a", "b")).toBeDefined();
  });

  it("逆方向でもリンクを取得", () => {
    expect(getLink(topo, "b", "a")).toBeDefined();
  });

  it("存在しないリンクは undefined", () => {
    expect(getLink(topo, "a", "c")).toBeUndefined();
  });
});

describe("nodeMtu", () => {
  const topo: Topology = {
    hosts: [host("h", "10.0.0.1", { mtu: 9000 })],
    routers: [router("r", ["10.0.1.1"], { mtu: 1280 })],
    links: [],
  };

  it("ホスト MTU", () => expect(nodeMtu(topo, "h")).toBe(9000));
  it("ルーター MTU", () => expect(nodeMtu(topo, "r")).toBe(1280));
  it("不明ノードは 1500", () => expect(nodeMtu(topo, "x")).toBe(1500));
});

// ── Ping シミュレーター ──

describe("PingSimulator — ping", () => {
  const topo: Topology = {
    hosts: [host("src", "10.0.0.1"), host("dst", "10.0.2.1")],
    routers: [router("r1", ["10.0.1.1"], { delay: 1, jitter: 0 })],
    links: [link("src", "r1", 5), link("r1", "dst", 5)],
  };

  const baseCfg: PingConfig = {
    source: "src", destination: "dst", count: 5, interval: 100,
    ttl: 64, payloadSize: 56, df: false, recordRoute: false, timeout: 2000, flood: false,
  };

  it("基本 ping が成功する", () => {
    const sim = new PingSimulator(topo);
    const result = sim.ping(baseCfg);
    expect(result.replies).toHaveLength(5);
    expect(result.replies.every((r) => r.success)).toBe(true);
    expect(result.stats.lossPercent).toBe(0);
    expect(result.stats.rttAvg).toBeGreaterThan(0);
  });

  it("Record Route が記録される", () => {
    const sim = new PingSimulator(topo);
    const result = sim.ping({ ...baseCfg, count: 1, recordRoute: true });
    expect(result.replies[0]!.route).toBeDefined();
    expect(result.replies[0]!.route!.length).toBeGreaterThan(1);
  });

  it("宛先不明で失敗する", () => {
    const sim = new PingSimulator(topo);
    const result = sim.ping({ ...baseCfg, destination: "unknown", count: 1 });
    expect(result.replies[0]!.success).toBe(false);
  });

  it("TTL 超過で Time Exceeded を返す", () => {
    const sim = new PingSimulator(topo);
    const result = sim.ping({ ...baseCfg, ttl: 1, count: 1 });
    expect(result.replies[0]!.success).toBe(false);
    expect(result.replies[0]!.icmpType).toBe("time-exceeded");
  });

  it("ICMP 応答無効ホストで失敗する", () => {
    const noReply: Topology = {
      hosts: [host("src", "10.0.0.1"), host("dst", "10.0.1.1", { reply: false })],
      routers: [],
      links: [link("src", "dst", 5)],
    };
    const sim = new PingSimulator(noReply);
    const result = sim.ping({ ...baseCfg, count: 2 });
    expect(result.replies.every((r) => !r.success)).toBe(true);
    expect(result.stats.lossPercent).toBe(100);
  });

  it("DF + MTU 超過で Frag Needed を返す", () => {
    const mtuTopo: Topology = {
      hosts: [host("src", "10.0.0.1"), host("dst", "10.0.2.1")],
      routers: [router("r1", ["10.0.1.1"], { mtu: 576 })],
      links: [link("src", "r1", 5), link("r1", "dst", 5)],
    };
    const sim = new PingSimulator(mtuTopo);
    const result = sim.ping({ ...baseCfg, count: 1, payloadSize: 1472, df: true });
    expect(result.replies[0]!.icmpType).toBe("frag-needed");
  });

  it("Flood モードで間隔なし送信", () => {
    const sim = new PingSimulator(topo);
    const result = sim.ping({ ...baseCfg, count: 10, flood: true });
    expect(result.replies).toHaveLength(10);
  });
});

describe("PingSimulator — traceroute", () => {
  const topo: Topology = {
    hosts: [host("src", "10.0.0.1"), host("dst", "10.0.3.1")],
    routers: [
      router("r1", ["10.0.1.1"], { delay: 1, jitter: 0 }),
      router("r2", ["10.0.2.1"], { delay: 1, jitter: 0 }),
    ],
    links: [
      link("src", "r1", 5), link("r1", "r2", 10), link("r2", "dst", 5),
    ],
  };

  const baseCfg: TracerouteConfig = {
    source: "src", destination: "dst", maxHops: 10, probesPerHop: 3, payloadSize: 56, timeout: 2000,
  };

  it("traceroute が宛先に到達する", () => {
    const sim = new PingSimulator(topo);
    const result = sim.traceroute(baseCfg);
    expect(result.reached).toBe(true);
    expect(result.hops.length).toBeGreaterThan(0);
  });

  it("各ホップの IP が記録される", () => {
    const sim = new PingSimulator(topo);
    const result = sim.traceroute(baseCfg);
    const ips = result.hops.map((h) => h.ip);
    expect(ips).toContain("10.0.1.1");
  });

  it("ICMP 無効ルーターは * になる", () => {
    const silentTopo: Topology = {
      hosts: [host("src", "10.0.0.1"), host("dst", "10.0.3.1")],
      routers: [
        router("r1", ["10.0.1.1"]),
        router("silent", ["10.0.2.1"], { icmp: false }),
      ],
      links: [link("src", "r1", 5), link("r1", "silent", 5), link("silent", "dst", 5)],
    };
    const sim = new PingSimulator(silentTopo);
    const result = sim.traceroute(baseCfg);
    expect(result.hops.some((h) => h.ip === "*")).toBe(true);
  });

  it("経路なしで到達不能", () => {
    const noLink: Topology = { hosts: [host("src", "10.0.0.1"), host("dst", "10.0.1.1")], routers: [], links: [] };
    const sim = new PingSimulator(noLink);
    const result = sim.traceroute(baseCfg);
    expect(result.reached).toBe(false);
  });
});

// ── ヘルパー ──

describe("host / router / link", () => {
  it("ホストを作成する", () => {
    const h = host("test", "10.0.0.1");
    expect(h.name).toBe("test");
    expect(h.iface.ip).toBe("10.0.0.1");
    expect(h.replyEnabled).toBe(true);
  });

  it("ルーターを作成する", () => {
    const r = router("gw", ["10.0.0.1", "10.0.1.1"]);
    expect(r.interfaces).toHaveLength(2);
    expect(r.icmpEnabled).toBe(true);
    expect(r.ttlDecrement).toBe(true);
  });

  it("リンクを作成する", () => {
    const l = link("a", "b", 10, { loss: 0.05 });
    expect(l.latency).toBe(10);
    expect(l.lossRate).toBe(0.05);
  });
});

// ── プリセット実験 ──

describe("EXPERIMENTS", () => {
  it("9 つのプリセット", () => {
    expect(EXPERIMENTS).toHaveLength(9);
  });

  it("名前が一意", () => {
    expect(new Set(EXPERIMENTS.map((e) => e.name)).size).toBe(EXPERIMENTS.length);
  });

  for (const exp of EXPERIMENTS) {
    it(`${exp.name}: 実行可能`, () => {
      const sim = new PingSimulator(exp.topology);
      if (exp.mode === "ping" && exp.pingConfig) {
        const result = sim.ping(exp.pingConfig);
        expect(result.replies.length).toBeGreaterThan(0);
        expect(result.events.length).toBeGreaterThan(0);
      } else if (exp.mode === "traceroute" && exp.tracerouteConfig) {
        const result = sim.traceroute(exp.tracerouteConfig);
        expect(result.events.length).toBeGreaterThan(0);
      }
    });
  }
});
