import { describe, it, expect } from "vitest";
import {
  sameSubnet, makeArpPacket, makeArpRequest, makeArpReply, makeGratuitousArp, makeArpProbe, arpSummary,
  BROADCAST_MAC, ZERO_MAC, ARP_ETHERTYPE,
  ArpSimulator, createHost, segment,
} from "../engine/arp.js";
import { EXPERIMENTS } from "../ui/app.js";
import type { Topology, Scenario } from "../engine/arp.js";

// ── ユーティリティ ──

describe("sameSubnet", () => {
  it("同一サブネット", () => { expect(sameSubnet("192.168.1.10", "192.168.1.20", "255.255.255.0")).toBe(true); });
  it("異なるサブネット", () => { expect(sameSubnet("192.168.1.10", "192.168.2.10", "255.255.255.0")).toBe(false); });
});

describe("makeArpPacket", () => {
  it("REQUEST パケットを作成する", () => {
    const pkt = makeArpPacket("REQUEST", "aa:bb", "1.1.1.1", ZERO_MAC, "2.2.2.2");
    expect(pkt.oper).toBe("REQUEST");
    expect(pkt.htype).toBe(1);
    expect(pkt.ptype).toBe(0x0800);
    expect(pkt.sha).toBe("aa:bb");
    expect(pkt.tha).toBe(ZERO_MAC);
  });
});

describe("makeArpRequest", () => {
  it("ブロードキャスト ARP Request を作成する", () => {
    const f = makeArpRequest("aa:01", "10.0.0.1", "10.0.0.2");
    expect(f.dstMac).toBe(BROADCAST_MAC);
    expect(f.etherType).toBe(ARP_ETHERTYPE);
    expect(f.payload.oper).toBe("REQUEST");
    expect(f.payload.tpa).toBe("10.0.0.2");
  });
});

describe("makeArpReply", () => {
  it("ユニキャスト ARP Reply を作成する", () => {
    const f = makeArpReply("bb:02", "10.0.0.2", "aa:01", "10.0.0.1");
    expect(f.dstMac).toBe("aa:01");
    expect(f.payload.oper).toBe("REPLY");
  });
});

describe("makeGratuitousArp", () => {
  it("Gratuitous ARP を作成する (src IP == dst IP)", () => {
    const f = makeGratuitousArp("cc:03", "10.0.0.3");
    expect(f.dstMac).toBe(BROADCAST_MAC);
    expect(f.payload.spa).toBe("10.0.0.3");
    expect(f.payload.tpa).toBe("10.0.0.3");
  });
});

describe("makeArpProbe", () => {
  it("ARP Probe を作成する (src IP = 0.0.0.0)", () => {
    const f = makeArpProbe("dd:04", "10.0.0.99");
    expect(f.payload.spa).toBe("0.0.0.0");
    expect(f.payload.tpa).toBe("10.0.0.99");
  });
});

describe("arpSummary", () => {
  it("Request サマリ", () => {
    expect(arpSummary(makeArpPacket("REQUEST", "a", "1.1.1.1", ZERO_MAC, "2.2.2.2"))).toContain("Who has 2.2.2.2");
  });
  it("Reply サマリ", () => {
    expect(arpSummary(makeArpPacket("REPLY", "bb:02", "2.2.2.2", "aa:01", "1.1.1.1"))).toContain("is-at bb:02");
  });
  it("Gratuitous サマリ", () => {
    expect(arpSummary(makeArpPacket("REQUEST", "cc", "3.3.3.3", ZERO_MAC, "3.3.3.3"))).toContain("Gratuitous");
  });
  it("Probe サマリ", () => {
    expect(arpSummary(makeArpPacket("REQUEST", "dd", "0.0.0.0", ZERO_MAC, "5.5.5.5"))).toContain("Probe");
  });
});

// ── シミュレーター ──

describe("ArpSimulator", () => {
  const topo: Topology = {
    hosts: [
      createHost("A", "192.168.1.10", "aa:00:00:00:00:01"),
      createHost("B", "192.168.1.20", "bb:00:00:00:00:02"),
      createHost("C", "192.168.1.30", "cc:00:00:00:00:03"),
    ],
    segments: [segment("LAN", ["A", "B", "C"])],
  };

  it("ARP Request → Reply で MAC を解決する", () => {
    const sim = new ArpSimulator(topo);
    const r = sim.simulate([{ name: "test", action: { type: "resolve", from: "A", targetIp: "192.168.1.20" } }]);
    expect(r.stats.requests).toBe(1);
    expect(r.stats.replies).toBe(1);
    const cache = r.caches.get("A")!;
    expect(cache.some((e) => e.ip === "192.168.1.20" && e.mac === "bb:00:00:00:00:02")).toBe(true);
  });

  it("ブロードキャストで全ホストがキャッシュ更新する", () => {
    const sim = new ArpSimulator(topo);
    const r = sim.simulate([{ name: "test", action: { type: "resolve", from: "A", targetIp: "192.168.1.20" } }]);
    // B と C が A のキャッシュを学習
    expect(r.caches.get("B")!.some((e) => e.ip === "192.168.1.10")).toBe(true);
    expect(r.caches.get("C")!.some((e) => e.ip === "192.168.1.10")).toBe(true);
  });

  it("キャッシュヒットで ARP パケットを送信しない", () => {
    const cachedTopo: Topology = {
      hosts: [
        createHost("A", "192.168.1.10", "aa:01", { arpCache: [{ ip: "192.168.1.20", mac: "bb:02", type: "dynamic", createdAt: 0, expiresAt: 30000 }] }),
        createHost("B", "192.168.1.20", "bb:02"),
      ],
      segments: [segment("LAN", ["A", "B"])],
    };
    const sim = new ArpSimulator(cachedTopo);
    const r = sim.simulate([{ name: "hit", action: { type: "resolve", from: "A", targetIp: "192.168.1.20" } }]);
    expect(r.stats.requests).toBe(0);
    expect(r.events.some((e) => e.detail.includes("キャッシュヒット"))).toBe(true);
  });

  it("Gratuitous ARP で全ホストのキャッシュが更新される", () => {
    const gTopo: Topology = {
      hosts: [
        createHost("S", "192.168.1.100", "ee:01"),
        createHost("A", "192.168.1.10", "aa:01", { arpCache: [{ ip: "192.168.1.100", mac: "old:old", type: "dynamic", createdAt: 0, expiresAt: 30000 }] }),
      ],
      segments: [segment("LAN", ["S", "A"])],
    };
    const sim = new ArpSimulator(gTopo);
    const r = sim.simulate([{ name: "grat", action: { type: "gratuitous", from: "S" } }]);
    expect(r.stats.gratuitous).toBe(1);
    expect(r.caches.get("A")!.find((e) => e.ip === "192.168.1.100")?.mac).toBe("ee:01");
  });

  it("ARP Probe: 競合なしで DAD 成功", () => {
    const sim = new ArpSimulator(topo);
    const r = sim.simulate([{ name: "probe", action: { type: "probe", from: "A", targetIp: "192.168.1.99" } }]);
    expect(r.events.some((e) => e.detail.includes("DAD 成功"))).toBe(true);
  });

  it("ARP Probe: 競合ありで DAD 失敗", () => {
    const sim = new ArpSimulator(topo);
    const r = sim.simulate([{ name: "probe", action: { type: "probe", from: "A", targetIp: "192.168.1.20" } }]);
    expect(r.events.some((e) => e.detail.includes("DAD 失敗"))).toBe(true);
    expect(r.stats.replies).toBe(1);
  });

  it("Proxy ARP で代理応答する", () => {
    const proxyTopo: Topology = {
      hosts: [
        createHost("A", "192.168.1.10", "aa:01"),
        createHost("R", "192.168.1.1", "rr:01", { proxyArp: true, proxySubnets: ["10.0.0.0"], mask: "255.255.0.0" }),
      ],
      segments: [segment("LAN", ["A", "R"])],
    };
    const sim = new ArpSimulator(proxyTopo);
    const r = sim.simulate([{ name: "proxy", action: { type: "resolve", from: "A", targetIp: "10.0.0.50" } }]);
    expect(r.stats.proxyReplies).toBe(1);
    expect(r.caches.get("A")!.some((e) => e.ip === "10.0.0.50" && e.mac === "rr:01")).toBe(true);
  });

  it("ARP スプーフィングでキャッシュが汚染される", () => {
    const spoofTopo: Topology = {
      hosts: [
        createHost("V", "192.168.1.10", "aa:01", { arpCache: [{ ip: "192.168.1.1", mac: "gw:mac", type: "dynamic", createdAt: 0, expiresAt: 30000 }] }),
        createHost("GW", "192.168.1.1", "gw:mac"),
        createHost("ATK", "192.168.1.99", "evil:mac"),
      ],
      segments: [segment("LAN", ["V", "GW", "ATK"])],
    };
    const sim = new ArpSimulator(spoofTopo);
    const r = sim.simulate([{ name: "spoof", action: { type: "spoof", attacker: "ATK", victimIp: "192.168.1.1", spoofedMac: "evil:mac", targetIp: "192.168.1.10" } }]);
    expect(r.caches.get("V")!.find((e) => e.ip === "192.168.1.1")?.mac).toBe("evil:mac");
  });

  it("acceptArp=false でスプーフィングが防御される", () => {
    const daiTopo: Topology = {
      hosts: [
        createHost("V", "192.168.1.10", "aa:01", { acceptArp: false }),
        createHost("ATK", "192.168.1.99", "evil:mac"),
      ],
      segments: [segment("LAN", ["V", "ATK"])],
    };
    const sim = new ArpSimulator(daiTopo);
    const r = sim.simulate([{ name: "dai", action: { type: "spoof", attacker: "ATK", victimIp: "192.168.1.1", spoofedMac: "evil:mac", targetIp: "192.168.1.10" } }]);
    expect(r.stats.dropped).toBeGreaterThan(0);
  });

  it("キャッシュエージングで期限切れエントリが削除される", () => {
    const ageTopo: Topology = {
      hosts: [createHost("A", "10.0.0.1", "aa:01", { arpTimeout: 100, arpCache: [{ ip: "10.0.0.2", mac: "bb:02", type: "dynamic", createdAt: 0, expiresAt: 100 }] })],
      segments: [segment("LAN", ["A"])],
    };
    const sim = new ArpSimulator(ageTopo);
    const r = sim.simulate([{ name: "age", action: { type: "age", time: 150 } }]);
    expect(r.caches.get("A")!.length).toBe(0);
  });

  it("フラッシュで全エントリが削除される", () => {
    const flushTopo: Topology = {
      hosts: [createHost("A", "10.0.0.1", "aa:01", { arpCache: [{ ip: "10.0.0.2", mac: "bb:02", type: "static", createdAt: 0, expiresAt: 999999 }] })],
      segments: [segment("LAN", ["A"])],
    };
    const sim = new ArpSimulator(flushTopo);
    const r = sim.simulate([{ name: "flush", action: { type: "flush", host: "A" } }]);
    expect(r.caches.get("A")!.length).toBe(0);
  });
});

// ── プリセット ──

describe("EXPERIMENTS", () => {
  it("9 つのプリセット", () => { expect(EXPERIMENTS).toHaveLength(9); });
  it("名前が一意", () => { expect(new Set(EXPERIMENTS.map((e) => e.name)).size).toBe(EXPERIMENTS.length); });
  for (const exp of EXPERIMENTS) {
    it(`${exp.name}: シミュレーション可能`, () => {
      const topo: Topology = { hosts: exp.topology.hosts.map((h) => ({ ...h, iface: { ...h.iface }, arpCache: h.arpCache.map((c) => ({ ...c })) })), segments: exp.topology.segments };
      const sim = new ArpSimulator(topo);
      const r = sim.simulate(exp.scenarios);
      expect(r.events.length).toBeGreaterThan(0);
    });
  }
});
