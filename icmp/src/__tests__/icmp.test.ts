import { describe, it, expect } from "vitest";
import {
  ICMP_TYPES, UNREACH_CODES, TIME_EXCEEDED_CODES, REDIRECT_CODES,
  icmpTypeName, unreachCodeName,
  ipToInt, intToIp, matchSubnet, computeChecksum,
  makeIpHeader, makeIcmpMessage, findPath, getLink,
  IcmpSimulator, node, routerNode, netLink,
} from "../engine/icmp.js";
import { EXPERIMENTS } from "../ui/app.js";
import type { Topology, Scenario } from "../engine/icmp.js";

// ── 定数 ──

describe("ICMP_TYPES", () => {
  it("主要なタイプが定義されている", () => {
    expect(ICMP_TYPES.ECHO_REQUEST).toBe(8);
    expect(ICMP_TYPES.ECHO_REPLY).toBe(0);
    expect(ICMP_TYPES.DEST_UNREACHABLE).toBe(3);
    expect(ICMP_TYPES.TIME_EXCEEDED).toBe(11);
    expect(ICMP_TYPES.REDIRECT).toBe(5);
    expect(ICMP_TYPES.TIMESTAMP_REQUEST).toBe(13);
  });
});

describe("icmpTypeName", () => {
  it("既知のタイプに名前を返す", () => {
    expect(icmpTypeName(0)).toBe("Echo Reply");
    expect(icmpTypeName(8)).toBe("Echo Request");
    expect(icmpTypeName(3)).toBe("Destination Unreachable");
  });

  it("不明なタイプは Unknown", () => {
    expect(icmpTypeName(99)).toContain("Unknown");
  });
});

describe("unreachCodeName", () => {
  it("既知のコードに名前を返す", () => {
    expect(unreachCodeName(0)).toBe("Network Unreachable");
    expect(unreachCodeName(3)).toBe("Port Unreachable");
    expect(unreachCodeName(4)).toContain("Fragmentation");
  });
});

// ── IP ユーティリティ ──

describe("ipToInt / intToIp", () => {
  it("相互変換が正しい", () => {
    expect(intToIp(ipToInt("10.0.0.1"))).toBe("10.0.0.1");
    expect(intToIp(ipToInt("255.255.255.0"))).toBe("255.255.255.0");
  });
});

describe("matchSubnet", () => {
  it("同一サブネット内にマッチする", () => {
    expect(matchSubnet("10.0.0.10", "10.0.0.0", "255.255.255.0")).toBe(true);
  });

  it("異なるサブネットにマッチしない", () => {
    expect(matchSubnet("10.0.1.10", "10.0.0.0", "255.255.255.0")).toBe(false);
  });
});

describe("computeChecksum", () => {
  it("チェックサムが 16bit 範囲", () => {
    const chk = computeChecksum(8, 0, 0x00010001, 56);
    expect(chk).toBeGreaterThanOrEqual(0);
    expect(chk).toBeLessThanOrEqual(0xffff);
  });
});

// ── パケット作成 ──

describe("makeIpHeader", () => {
  it("IP ヘッダを作成する", () => {
    const h = makeIpHeader("10.0.0.1", "10.0.0.2", 64, 64, true);
    expect(h.srcIp).toBe("10.0.0.1");
    expect(h.dstIp).toBe("10.0.0.2");
    expect(h.ttl).toBe(64);
    expect(h.flags.df).toBe(true);
    expect(h.protocol).toBe(1);
  });
});

describe("makeIcmpMessage", () => {
  it("ICMP メッセージを作成する", () => {
    const m = makeIcmpMessage("10.0.0.1", "10.0.0.2", 8, 0, 0x00010001, 64, 56, false);
    expect(m.icmpHeader.type).toBe(8);
    expect(m.icmpHeader.code).toBe(0);
    expect(m.totalBytes).toBe(20 + 8 + 56);
    expect(m.label).toBe("Echo Request");
  });

  it("extra フィールドが設定される", () => {
    const m = makeIcmpMessage("1.1.1.1", "2.2.2.2", 3, 4, 0, 64, 28, false, { nextHopMtu: 1280 });
    expect(m.extra?.nextHopMtu).toBe(1280);
  });
});

// ── 経路探索 ──

describe("findPath", () => {
  const topo: Topology = {
    nodes: [node("a", "10.0.0.1"), routerNode("r", "10.0.1.1"), node("b", "10.0.2.1")],
    links: [netLink("a", "r", 1), netLink("r", "b", 1)],
  };

  it("経路を見つける", () => {
    expect(findPath(topo, "a", "10.0.2.1")).toEqual(["a", "r", "b"]);
  });

  it("存在しない宛先は undefined", () => {
    expect(findPath(topo, "a", "99.99.99.99")).toBeUndefined();
  });
});

describe("getLink", () => {
  const topo: Topology = { nodes: [], links: [netLink("a", "b", 5)] };
  it("双方向でリンクを取得", () => {
    expect(getLink(topo, "a", "b")).toBeDefined();
    expect(getLink(topo, "b", "a")).toBeDefined();
  });
});

// ── シミュレーター ──

describe("IcmpSimulator", () => {
  const topo: Topology = {
    nodes: [
      node("client", "10.0.0.10"),
      routerNode("r1", "10.0.0.1"),
      node("server", "10.0.1.10", { openPorts: [{ port: 80, proto: "tcp" }] }),
    ],
    links: [netLink("client", "r1", 2), netLink("r1", "server", 3)],
  };

  const echoScenario: Scenario = {
    src: "client", dstIp: "10.0.1.10", icmpType: ICMP_TYPES.ECHO_REQUEST, icmpCode: 0,
    ttl: 64, payloadSize: 56, df: false, count: 1,
  };

  it("Echo Request → Echo Reply が成功する", () => {
    const sim = new IcmpSimulator(topo);
    const result = sim.simulate([echoScenario]);
    expect(result.stats.sent).toBe(1);
    expect(result.stats.received).toBe(1);
    expect(result.messages.some((m) => m.icmpHeader.type === ICMP_TYPES.ECHO_REPLY)).toBe(true);
  });

  it("Network Unreachable が返る (宛先不明)", () => {
    const sim = new IcmpSimulator(topo);
    const result = sim.simulate([{ ...echoScenario, dstIp: "172.16.99.99" }]);
    expect(result.stats.errors).toBe(1);
    expect(result.messages.some((m) => m.icmpHeader.type === ICMP_TYPES.DEST_UNREACHABLE && m.icmpHeader.code === UNREACH_CODES.NET_UNREACH)).toBe(true);
  });

  it("Time Exceeded が返る (TTL=1)", () => {
    const sim = new IcmpSimulator(topo);
    const result = sim.simulate([{ ...echoScenario, ttl: 1 }]);
    expect(result.stats.errors).toBe(1);
    expect(result.messages.some((m) => m.icmpHeader.type === ICMP_TYPES.TIME_EXCEEDED)).toBe(true);
  });

  it("Frag Needed が返る (DF + 大パケット)", () => {
    const mtuTopo: Topology = {
      nodes: [node("c", "10.0.0.10"), routerNode("r", "10.0.0.1", { mtu: 576 }), node("s", "10.0.1.10")],
      links: [netLink("c", "r", 2), netLink("r", "s", 2, { mtu: 576 })],
    };
    const sim = new IcmpSimulator(mtuTopo);
    const result = sim.simulate([{ ...echoScenario, src: "c", dstIp: "10.0.1.10", payloadSize: 1472, df: true }]);
    expect(result.messages.some((m) => m.icmpHeader.type === ICMP_TYPES.DEST_UNREACHABLE && m.icmpHeader.code === UNREACH_CODES.FRAG_NEEDED)).toBe(true);
  });

  it("Port Unreachable が返る (閉じた UDP ポート)", () => {
    const puTopo: Topology = {
      nodes: [node("c", "10.0.0.10"), node("s", "10.0.1.10", { openPorts: [{ port: 80, proto: "tcp" }] })],
      links: [netLink("c", "s", 2)],
    };
    const sim = new IcmpSimulator(puTopo);
    // Echo Request ではなく汎用パケット (Type 0 をダミーとして使い default ケースに入る)
    const result = sim.simulate([{ src: "c", dstIp: "10.0.1.10", icmpType: 0, icmpCode: 0, ttl: 64, payloadSize: 56, df: false, dstPort: 9999, count: 1 }]);
    expect(result.messages.some((m) => m.icmpHeader.type === ICMP_TYPES.DEST_UNREACHABLE && m.icmpHeader.code === UNREACH_CODES.PORT_UNREACH)).toBe(true);
  });

  it("Redirect が生成される", () => {
    const rdTopo: Topology = {
      nodes: [
        node("c", "192.168.1.10"),
        routerNode("old", "192.168.1.1", { redirectGateway: "192.168.1.2" }),
        routerNode("new", "192.168.1.2"),
        node("s", "10.0.0.10"),
      ],
      // c→old→new→s のみ (c→new の直結リンクなし)
      links: [netLink("c", "old", 1), netLink("old", "new", 1), netLink("new", "s", 1)],
    };
    const sim = new IcmpSimulator(rdTopo);
    const result = sim.simulate([{ ...echoScenario, src: "c", dstIp: "10.0.0.10" }]);
    expect(result.stats.redirects).toBe(1);
    expect(result.messages.some((m) => m.icmpHeader.type === ICMP_TYPES.REDIRECT)).toBe(true);
  });

  it("Timestamp Request → Reply が成功する", () => {
    const sim = new IcmpSimulator(topo);
    const result = sim.simulate([{ ...echoScenario, icmpType: ICMP_TYPES.TIMESTAMP_REQUEST, payloadSize: 12 }]);
    expect(result.stats.received).toBe(1);
    expect(result.messages.some((m) => m.icmpHeader.type === ICMP_TYPES.TIMESTAMP_REPLY)).toBe(true);
  });

  it("ファイアウォール DROP でドロップされる", () => {
    const fwTopo: Topology = {
      nodes: [node("c", "10.0.0.10"), node("s", "10.0.1.10", { firewall: [{ icmpType: 8, action: "drop" }] })],
      links: [netLink("c", "s", 2)],
    };
    const sim = new IcmpSimulator(fwTopo);
    const result = sim.simulate([{ ...echoScenario, src: "c", dstIp: "10.0.1.10" }]);
    expect(result.stats.dropped).toBe(1);
  });

  it("ファイアウォール REJECT で Admin Prohibited が返る", () => {
    const fwTopo: Topology = {
      nodes: [node("c", "10.0.0.10"), node("s", "10.0.1.10", { firewall: [{ icmpType: 8, action: "reject" }] })],
      links: [netLink("c", "s", 2)],
    };
    const sim = new IcmpSimulator(fwTopo);
    const result = sim.simulate([{ ...echoScenario, src: "c", dstIp: "10.0.1.10" }]);
    expect(result.stats.errors).toBe(1);
  });

  it("複数シナリオを実行する", () => {
    const sim = new IcmpSimulator(topo);
    const result = sim.simulate([echoScenario, { ...echoScenario, count: 2 }]);
    expect(result.stats.sent).toBe(3);
  });

  it("ICMP 無効ルーターで TTL 超過が silent", () => {
    const silentTopo: Topology = {
      nodes: [node("c", "10.0.0.10"), routerNode("r", "10.0.0.1", { icmpEnabled: false }), node("s", "10.0.1.10")],
      links: [netLink("c", "r", 2), netLink("r", "s", 2)],
    };
    const sim = new IcmpSimulator(silentTopo);
    const result = sim.simulate([{ ...echoScenario, src: "c", dstIp: "10.0.1.10", ttl: 1 }]);
    // エラーだが Time Exceeded メッセージは生成されない
    expect(result.stats.errors).toBe(1);
    expect(result.messages.some((m) => m.icmpHeader.type === ICMP_TYPES.TIME_EXCEEDED)).toBe(false);
  });
});

// ── ヘルパー ──

describe("node / routerNode / netLink", () => {
  it("ノードを作成する", () => {
    const n = node("test", "10.0.0.1");
    expect(n.isRouter).toBe(false);
    expect(n.initialTtl).toBe(64);
  });

  it("ルーターを作成する", () => {
    const r = routerNode("gw", "10.0.0.1");
    expect(r.isRouter).toBe(true);
    expect(r.initialTtl).toBe(255);
  });

  it("リンクを作成する", () => {
    const l = netLink("a", "b", 5, { loss: 0.1, mtu: 1280 });
    expect(l.latency).toBe(5);
    expect(l.lossRate).toBe(0.1);
    expect(l.mtu).toBe(1280);
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
    it(`${exp.name}: シミュレーション可能`, () => {
      const sim = new IcmpSimulator(exp.topology);
      const result = sim.simulate(exp.scenarios);
      expect(result.events.length).toBeGreaterThan(0);
      expect(result.stats.sent).toBeGreaterThan(0);
    });
  }
});
