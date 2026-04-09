import { describe, it, expect } from "vitest";
import { isBroadcast, ipInSubnet, NetdevSimulator, port, route, acl } from "../engine/netdev.js";
import { EXPERIMENTS } from "../ui/app.js";
import type { Topology, FlowScenario, Device, Frame } from "../engine/netdev.js";

function frame(src: string, dst: string, opts: Partial<Frame> = {}): Frame {
  return { srcMac: src, dstMac: dst, etherType: "IPv4", ttl: 64, size: 64, ...opts };
}

// ── ユーティリティ ──

describe("isBroadcast", () => {
  it("ブロードキャスト MAC を判定する", () => {
    expect(isBroadcast("ff:ff:ff:ff:ff:ff")).toBe(true);
    expect(isBroadcast("aa:bb:cc:dd:ee:ff")).toBe(false);
  });
});

describe("ipInSubnet", () => {
  it("サブネット内を判定する", () => {
    expect(ipInSubnet("10.0.0.10", "10.0.0.0", "255.255.255.0")).toBe(true);
    expect(ipInSubnet("10.0.1.10", "10.0.0.0", "255.255.255.0")).toBe(false);
  });
});

// ── ヘルパー ──

describe("port / route / acl", () => {
  it("ポートを作成する", () => {
    const p = port("p1", "Fa0/1", { vlans: [10], trunk: true });
    expect(p.vlans).toEqual([10]);
    expect(p.trunk).toBe(true);
    expect(p.stpState).toBe("forwarding");
  });

  it("ルートを作成する", () => {
    const r = route("10.0.0.0", "255.255.255.0", "10.0.0.1", "g0", { type: "ospf" });
    expect(r.type).toBe("ospf");
  });

  it("ACL を作成する", () => {
    const a = acl(10, "deny", "tcp", "any", "10.0.0.1", { dstPort: "22", stateful: true });
    expect(a.action).toBe("deny");
    expect(a.stateful).toBe(true);
  });
});

// ── L2 スイッチ ──

describe("L2 Switch", () => {
  const topo: Topology = {
    devices: [
      { name: "SW", type: "l2-switch", model: "Switch", ports: [port("p1", "1", { vlans: [1] }), port("p2", "2", { vlans: [1] }), port("p3", "3", { vlans: [1] })], macTable: [], routeTable: [], aclRules: [], natTable: [], vlans: [{ id: 1, name: "default", subnet: "10.0.0.0", gateway: "10.0.0.1" }] },
      { name: "A", type: "host", model: "PC", ports: [port("eth0", "eth0")], macTable: [], routeTable: [], aclRules: [], natTable: [], vlans: [] },
      { name: "B", type: "host", model: "PC", ports: [port("eth0", "eth0")], macTable: [], routeTable: [], aclRules: [], natTable: [], vlans: [] },
    ],
    links: [["SW:p1", "A:eth0"], ["SW:p2", "B:eth0"]],
  };

  it("MAC アドレスを学習する", () => {
    const sim = new NetdevSimulator(topo);
    const r = sim.simulate([{ name: "test", frame: frame("aa:00:00:00:00:01", "bb:00:00:00:00:02", { srcIp: "10.0.0.1", dstIp: "10.0.0.2" }), ingressDevice: "SW", ingressPort: "p1" }]);
    const macTable = r.macTables.get("SW")!;
    expect(macTable.some((e) => e.mac === "aa:00:00:00:00:01" && e.port === "p1")).toBe(true);
  });

  it("既知 MAC はユニキャスト転送する", () => {
    const topoWithMac: Topology = {
      ...topo,
      devices: topo.devices.map((d) => d.name === "SW" ? { ...d, macTable: [{ mac: "bb:00:00:00:00:02", port: "p2", vlan: 1, type: "dynamic" as const, age: 0 }] } : d),
    };
    const sim = new NetdevSimulator(topoWithMac);
    const r = sim.simulate([{ name: "test", frame: frame("aa:00:00:00:00:01", "bb:00:00:00:00:02"), ingressDevice: "SW", ingressPort: "p1" }]);
    expect(r.flowResults[0]!.reached).toBe(true);
  });

  it("STP blocking ポートではフレームを破棄する", () => {
    const topoStp: Topology = {
      ...topo,
      devices: topo.devices.map((d) => d.name === "SW" ? { ...d, ports: [port("p1", "1", { stpState: "blocking" }), port("p2", "2"), port("p3", "3")] } : d),
    };
    const sim = new NetdevSimulator(topoStp);
    const r = sim.simulate([{ name: "test", frame: frame("aa:01", "bb:02"), ingressDevice: "SW", ingressPort: "p1" }]);
    expect(r.flowResults[0]!.reached).toBe(false);
    expect(r.flowResults[0]!.reason).toContain("STP");
  });
});

// ── L3 ルーター ──

describe("L3 Router", () => {
  const topo: Topology = {
    devices: [
      { name: "R1", type: "l3-router", model: "Router", ports: [port("g0", "g0"), port("g1", "g1")], macTable: [], routeTable: [route("10.0.0.0", "255.255.255.0", "0.0.0.0", "g0"), route("10.0.1.0", "255.255.255.0", "0.0.0.0", "g1")], aclRules: [], natTable: [], vlans: [] },
      { name: "A", type: "host", model: "PC", ports: [port("eth0", "eth0")], macTable: [], routeTable: [], aclRules: [], natTable: [], vlans: [] },
      { name: "B", type: "host", model: "Server", ports: [port("eth0", "eth0")], macTable: [], routeTable: [], aclRules: [], natTable: [], vlans: [] },
    ],
    links: [["R1:g0", "A:eth0"], ["R1:g1", "B:eth0"]],
  };

  it("ルーティングテーブルに従って転送する", () => {
    const sim = new NetdevSimulator(topo);
    const r = sim.simulate([{ name: "route", frame: frame("aa:01", "rr:01", { srcIp: "10.0.0.10", dstIp: "10.0.1.10", protocol: "tcp", dstPort: 80 }), ingressDevice: "R1", ingressPort: "g0" }]);
    expect(r.flowResults[0]!.reached).toBe(true);
  });

  it("ルートがなければ破棄する", () => {
    const sim = new NetdevSimulator(topo);
    const r = sim.simulate([{ name: "no-route", frame: frame("aa:01", "rr:01", { srcIp: "10.0.0.10", dstIp: "172.16.0.1" }), ingressDevice: "R1", ingressPort: "g0" }]);
    expect(r.flowResults[0]!.reached).toBe(false);
    expect(r.flowResults[0]!.reason).toContain("no route");
  });

  it("TTL=1 で Time Exceeded", () => {
    const sim = new NetdevSimulator(topo);
    const r = sim.simulate([{ name: "ttl", frame: frame("aa:01", "rr:01", { srcIp: "10.0.0.10", dstIp: "10.0.1.10", ttl: 1 }), ingressDevice: "R1", ingressPort: "g0" }]);
    expect(r.flowResults[0]!.reason).toContain("TTL");
  });

  it("ACL deny でフィルタする", () => {
    const aclTopo: Topology = {
      ...topo,
      devices: topo.devices.map((d) => d.name === "R1" ? { ...d, aclRules: [acl(10, "deny", "tcp", "any", "any", { dstPort: "22" })] } : d),
    };
    const sim = new NetdevSimulator(aclTopo);
    const r = sim.simulate([{ name: "acl", frame: frame("aa:01", "rr:01", { srcIp: "10.0.0.10", dstIp: "10.0.1.10", protocol: "tcp", dstPort: 22 }), ingressDevice: "R1", ingressPort: "g0" }]);
    expect(r.flowResults[0]!.reason).toContain("ACL");
  });
});

// ── ファイアウォール ──

describe("Firewall", () => {
  it("許可ルールで通過する", () => {
    const topo: Topology = {
      devices: [
        { name: "FW", type: "firewall", model: "FW", ports: [port("in", "in"), port("out", "out")], macTable: [], routeTable: [route("0.0.0.0", "0.0.0.0", "0.0.0.0", "out")], aclRules: [acl(10, "permit", "tcp", "any", "any", { dstPort: "80" })], natTable: [], vlans: [], fwZones: [{ name: "trust", ports: ["in"], trust: "trusted" }] },
        { name: "S", type: "host", model: "Server", ports: [port("eth0", "eth0")], macTable: [], routeTable: [], aclRules: [], natTable: [], vlans: [] },
      ],
      links: [["FW:out", "S:eth0"]],
    };
    const sim = new NetdevSimulator(topo);
    const r = sim.simulate([{ name: "fw-pass", frame: frame("a", "b", { srcIp: "1.1.1.1", dstIp: "2.2.2.2", protocol: "tcp", dstPort: 80 }), ingressDevice: "FW", ingressPort: "in" }]);
    expect(r.flowResults[0]!.reached).toBe(true);
  });

  it("拒否ルールでブロックする", () => {
    const topo: Topology = {
      devices: [
        { name: "FW", type: "firewall", model: "FW", ports: [port("in", "in"), port("out", "out")], macTable: [], routeTable: [route("0.0.0.0", "0.0.0.0", "0.0.0.0", "out")], aclRules: [acl(10, "deny", "tcp", "any", "any", { dstPort: "22" })], natTable: [], vlans: [], fwZones: [] },
        { name: "S", type: "host", model: "Server", ports: [port("eth0", "eth0")], macTable: [], routeTable: [], aclRules: [], natTable: [], vlans: [] },
      ],
      links: [["FW:out", "S:eth0"]],
    };
    const sim = new NetdevSimulator(topo);
    const r = sim.simulate([{ name: "fw-block", frame: frame("a", "b", { srcIp: "1.1.1.1", dstIp: "2.2.2.2", protocol: "tcp", dstPort: 22 }), ingressDevice: "FW", ingressPort: "in" }]);
    expect(r.flowResults[0]!.reached).toBe(false);
  });
});

// ── NAT ──

describe("NAT Gateway", () => {
  it("SNAT で送信元 IP を変換する", () => {
    const topo: Topology = {
      devices: [
        { name: "NAT", type: "nat-gateway", model: "NAT", ports: [port("in", "in"), port("out", "out")], macTable: [], routeTable: [route("0.0.0.0", "0.0.0.0", "0.0.0.0", "out")], aclRules: [], natTable: [{ type: "snat", insideLocal: "192.168.0.10", insideGlobal: "203.0.113.1", outsideGlobal: "" }], vlans: [] },
        { name: "WAN", type: "host", model: "Cloud", ports: [port("eth0", "eth0")], macTable: [], routeTable: [], aclRules: [], natTable: [], vlans: [] },
      ],
      links: [["NAT:out", "WAN:eth0"]],
    };
    const sim = new NetdevSimulator(topo);
    const r = sim.simulate([{ name: "snat", frame: frame("a", "b", { srcIp: "192.168.0.10", dstIp: "8.8.8.8" }), ingressDevice: "NAT", ingressPort: "in" }]);
    expect(r.events.some((e) => e.layer === "NAT" && e.detail.includes("SNAT"))).toBe(true);
    expect(r.flowResults[0]!.reached).toBe(true);
  });
});

// ── ロードバランサー ──

describe("Load Balancer", () => {
  it("バックエンドに転送する", () => {
    const topo: Topology = {
      devices: [
        { name: "LB", type: "load-balancer", model: "LB", ports: [port("vip", "vip"), port("be", "be")], macTable: [], routeTable: [route("10.0.1.0", "255.255.255.0", "0.0.0.0", "be")], aclRules: [], natTable: [], vlans: [], lbBackends: [{ ip: "10.0.1.10", port: 8080, weight: 1, healthy: true, connections: 0 }], lbAlgorithm: "round-robin" },
        { name: "Web", type: "host", model: "Server", ports: [port("eth0", "eth0")], macTable: [], routeTable: [], aclRules: [], natTable: [], vlans: [] },
      ],
      links: [["LB:be", "Web:eth0"]],
    };
    const sim = new NetdevSimulator(topo);
    const r = sim.simulate([{ name: "lb", frame: frame("c", "lb", { srcIp: "1.1.1.1", dstIp: "10.0.0.100", dstPort: 80, protocol: "tcp" }), ingressDevice: "LB", ingressPort: "vip" }]);
    expect(r.flowResults[0]!.reached).toBe(true);
    expect(r.events.some((e) => e.layer === "LB")).toBe(true);
  });

  it("健全なバックエンドがなければ 503", () => {
    const topo: Topology = {
      devices: [
        { name: "LB", type: "load-balancer", model: "LB", ports: [port("vip", "vip")], macTable: [], routeTable: [], aclRules: [], natTable: [], vlans: [], lbBackends: [{ ip: "10.0.1.10", port: 8080, weight: 1, healthy: false, connections: 0 }], lbAlgorithm: "round-robin" },
      ],
      links: [],
    };
    const sim = new NetdevSimulator(topo);
    const r = sim.simulate([{ name: "no-be", frame: frame("c", "lb", { dstPort: 80, protocol: "tcp" }), ingressDevice: "LB", ingressPort: "vip" }]);
    expect(r.flowResults[0]!.reached).toBe(false);
  });
});

// ── プリセット ──

describe("EXPERIMENTS", () => {
  it("9 つのプリセット", () => { expect(EXPERIMENTS).toHaveLength(9); });
  it("名前が一意", () => { expect(new Set(EXPERIMENTS.map((e) => e.name)).size).toBe(EXPERIMENTS.length); });
  for (const exp of EXPERIMENTS) {
    it(`${exp.name}: シミュレーション可能`, () => {
      const sim = new NetdevSimulator(exp.topology);
      const r = sim.simulate(exp.scenarios);
      expect(r.events.length).toBeGreaterThan(0);
    });
  }
});
