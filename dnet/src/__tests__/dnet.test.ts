import { describe, it, expect } from "vitest";
import {
  genMac, allocateIp, shortId,
  DockerNetSimulator, createNetwork, createContainer, netConfig,
} from "../engine/dnet.js";
import { EXPERIMENTS } from "../ui/app.js";
import type { SimConfig } from "../engine/dnet.js";

// ── ユーティリティ ──

describe("genMac", () => {
  it("有効な MAC アドレスを生成する", () => {
    expect(genMac()).toMatch(/^02:42:ac:11:[0-9a-f]{2}:[0-9a-f]{2}$/);
  });
  it("呼び出すたびに異なる", () => {
    expect(genMac()).not.toBe(genMac());
  });
});

describe("allocateIp", () => {
  it("サブネットからオフセットで IP を割り当てる", () => {
    const ip = allocateIp("172.18.0.0/16", 5);
    expect(ip).toBe("172.18.0.5");
  });
});

describe("shortId", () => {
  it("12 文字の hex を生成する", () => {
    expect(shortId().length).toBe(12);
    expect(shortId()).toMatch(/^[0-9a-f]+$/);
  });
});

// ── ヘルパー ──

describe("createNetwork", () => {
  it("bridge ネットワークを作成する", () => {
    const n = createNetwork("test", "bridge", "172.20.0.0/16", "172.20.0.1");
    expect(n.driver).toBe("bridge");
    expect(n.ipam.subnets[0]!.subnet).toBe("172.20.0.0/16");
    expect(n.internal).toBe(false);
    expect(n.icc).toBe(true);
  });

  it("internal オプションが反映される", () => {
    const n = createNetwork("sec", "bridge", "10.0.0.0/24", "10.0.0.1", { internal: true });
    expect(n.internal).toBe(true);
  });
});

describe("createContainer", () => {
  it("コンテナを作成する", () => {
    const c = createContainer("web", "nginx", [netConfig("net", "10.0.0.2", "10.0.0.1")]);
    expect(c.name).toBe("web");
    expect(c.networks).toHaveLength(1);
    expect(c.running).toBe(true);
  });

  it("ポートマッピングが設定される", () => {
    const c = createContainer("web", "nginx", [], { ports: [{ hostPort: 80, containerPort: 80, protocol: "tcp" }] });
    expect(c.portMappings).toHaveLength(1);
  });
});

describe("netConfig", () => {
  it("ネットワーク設定を作成する", () => {
    const nc = netConfig("my-net", "172.18.0.2", "172.18.0.1", ["web"]);
    expect(nc.networkName).toBe("my-net");
    expect(nc.ip).toBe("172.18.0.2");
    expect(nc.aliases).toEqual(["web"]);
    expect(nc.dns).toEqual(["127.0.0.11"]);
  });
});

// ── シミュレーター ──

describe("DockerNetSimulator", () => {
  it("bridge ネットワークでコンテナ間通信が成功する", () => {
    const config: SimConfig = {
      networks: [createNetwork("net", "bridge", "172.18.0.0/16", "172.18.0.1", { bridgeName: "br-net" })],
      containers: [
        createContainer("a", "img", [netConfig("net", "172.18.0.2", "172.18.0.1")]),
        createContainer("b", "img", [netConfig("net", "172.18.0.3", "172.18.0.1")]),
      ],
      packetFlows: [{ from: "a", to: "b", dstPort: 80, protocol: "tcp", external: false }],
      dnsQueries: [],
    };
    const sim = new DockerNetSimulator();
    const r = sim.simulate(config);
    expect(r.flowResults[0]!.reached).toBe(true);
    expect(r.vethPairs.length).toBeGreaterThanOrEqual(2);
  });

  it("DNS でコンテナ名を解決する", () => {
    const config: SimConfig = {
      networks: [createNetwork("net", "bridge", "172.18.0.0/16", "172.18.0.1", { bridgeName: "br-test" })],
      containers: [
        createContainer("web", "nginx", [netConfig("net", "172.18.0.2", "172.18.0.1", ["web"])]),
        createContainer("app", "node", [netConfig("net", "172.18.0.3", "172.18.0.1")]),
      ],
      packetFlows: [],
      dnsQueries: [{ name: "web", type: "A", fromContainer: "app" }],
    };
    const sim = new DockerNetSimulator();
    const r = sim.simulate(config);
    expect(r.dnsResults[0]!.answer).toBe("172.18.0.2");
  });

  it("異なるネットワーク間で DNS が解決できない", () => {
    const config: SimConfig = {
      networks: [
        createNetwork("net-a", "bridge", "172.18.0.0/16", "172.18.0.1", { bridgeName: "br-a" }),
        createNetwork("net-b", "bridge", "172.19.0.0/16", "172.19.0.1", { bridgeName: "br-b" }),
      ],
      containers: [
        createContainer("a", "img", [netConfig("net-a", "172.18.0.2", "172.18.0.1", ["a"])]),
        createContainer("b", "img", [netConfig("net-b", "172.19.0.2", "172.19.0.1", ["b"])]),
      ],
      packetFlows: [],
      dnsQueries: [{ name: "b", type: "A", fromContainer: "a" }],
    };
    const sim = new DockerNetSimulator();
    const r = sim.simulate(config);
    expect(r.dnsResults[0]!.answer).toBe("NXDOMAIN");
  });

  it("internal ネットワークでは外部通信が DROP される", () => {
    const config: SimConfig = {
      networks: [createNetwork("sec", "bridge", "172.20.0.0/16", "172.20.0.1", { internal: true, bridgeName: "br-sec" })],
      containers: [createContainer("a", "img", [netConfig("sec", "172.20.0.2", "172.20.0.1")])],
      packetFlows: [{ from: "a", to: "external.com", dstPort: 443, protocol: "tcp", external: true }],
      dnsQueries: [],
    };
    const sim = new DockerNetSimulator();
    const r = sim.simulate(config);
    expect(r.flowResults[0]!.reached).toBe(false);
    expect(r.flowResults[0]!.reason).toContain("internal");
  });

  it("ICC 無効でコンテナ間通信が DROP される", () => {
    const config: SimConfig = {
      networks: [createNetwork("iso", "bridge", "172.21.0.0/16", "172.21.0.1", { icc: false, bridgeName: "br-iso" })],
      containers: [
        createContainer("a", "img", [netConfig("iso", "172.21.0.2", "172.21.0.1")]),
        createContainer("b", "img", [netConfig("iso", "172.21.0.3", "172.21.0.1")]),
      ],
      packetFlows: [{ from: "a", to: "b", dstPort: 80, protocol: "tcp", external: false }],
      dnsQueries: [],
    };
    const sim = new DockerNetSimulator();
    const r = sim.simulate(config);
    expect(r.flowResults[0]!.reached).toBe(false);
    expect(r.flowResults[0]!.reason).toContain("ICC");
  });

  it("ポートマッピングで DNAT ルールが生成される", () => {
    const config: SimConfig = {
      networks: [createNetwork("n", "bridge", "172.22.0.0/16", "172.22.0.1", { bridgeName: "br-n" })],
      containers: [createContainer("web", "nginx", [netConfig("n", "172.22.0.2", "172.22.0.1")], { ports: [{ hostPort: 8080, containerPort: 80, protocol: "tcp" }] })],
      packetFlows: [], dnsQueries: [],
    };
    const sim = new DockerNetSimulator();
    const r = sim.simulate(config);
    expect(r.iptablesRules.some((rule) => rule.chain === "DOCKER" && rule.target.includes("DNAT"))).toBe(true);
  });

  it("overlay ネットワークで VXLAN encap が行われる", () => {
    const config: SimConfig = {
      networks: [createNetwork("ovl", "overlay", "10.0.0.0/24", "10.0.0.1", { vxlanId: 100, bridgeName: "br0" })],
      containers: [
        createContainer("s1", "img", [netConfig("ovl", "10.0.0.2", "10.0.0.1")]),
        createContainer("s2", "img", [netConfig("ovl", "10.0.0.3", "10.0.0.1")]),
      ],
      packetFlows: [{ from: "s1", to: "s2", dstPort: 80, protocol: "tcp", external: false }],
      dnsQueries: [],
    };
    const sim = new DockerNetSimulator();
    const r = sim.simulate(config);
    expect(r.events.some((e) => e.layer === "VXLAN")).toBe(true);
    expect(r.flowResults[0]!.reached).toBe(true);
  });

  it("none ネットワークでは外部通信不可", () => {
    const config: SimConfig = {
      networks: [createNetwork("n", "none", "0.0.0.0/0", "0.0.0.0")],
      containers: [createContainer("batch", "py", [{ networkName: "n", ip: "127.0.0.1", mac: "00:00:00:00:00:00", gateway: "", ifName: "lo", vethHost: "", dns: [], aliases: [] }])],
      packetFlows: [{ from: "batch", to: "external", dstPort: 443, protocol: "tcp", external: true }],
      dnsQueries: [],
    };
    const sim = new DockerNetSimulator();
    const r = sim.simulate(config);
    expect(r.flowResults[0]!.reached).toBe(false);
  });

  it("MASQUERADE ルールが bridge ネットワークに生成される", () => {
    const config: SimConfig = {
      networks: [createNetwork("n", "bridge", "172.18.0.0/16", "172.18.0.1", { bridgeName: "br-n" })],
      containers: [], packetFlows: [], dnsQueries: [],
    };
    const sim = new DockerNetSimulator();
    const r = sim.simulate(config);
    expect(r.iptablesRules.some((rule) => rule.target === "MASQUERADE")).toBe(true);
  });
});

// ── プリセット ──

describe("EXPERIMENTS", () => {
  it("9 つのプリセット", () => {
    expect(EXPERIMENTS).toHaveLength(9);
  });

  it("名前が一意", () => {
    expect(new Set(EXPERIMENTS.map((e) => e.name)).size).toBe(EXPERIMENTS.length);
  });

  for (const exp of EXPERIMENTS) {
    it(`${exp.name}: シミュレーション可能`, () => {
      const sim = new DockerNetSimulator();
      const r = sim.simulate(exp.config);
      expect(r.events.length).toBeGreaterThan(0);
    });
  }
});
