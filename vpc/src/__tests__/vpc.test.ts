import { describe, it, expect } from "vitest";
import {
  ipToInt, intToIp, parseCidr, isInCidr,
  findRoute, evaluateAcl, evaluateSg,
  runSimulation, presets,
} from "../vpc/index.js";
import type { RouteTable, AclRule, SecurityGroup, Packet } from "../vpc/index.js";

// === CIDR / IP操作 ===
describe("CIDR/IP操作", () => {
  it("IPアドレスを整数に変換できる", () => {
    expect(ipToInt("10.0.1.1")).toBe(0x0A000101);
    expect(ipToInt("192.168.1.1")).toBe(0xC0A80101);
    expect(ipToInt("255.255.255.255")).toBe(0xFFFFFFFF);
  });

  it("整数をIPアドレスに変換できる", () => {
    expect(intToIp(0x0A000101)).toBe("10.0.1.1");
    expect(intToIp(0xC0A80101)).toBe("192.168.1.1");
  });

  it("CIDRをパースできる", () => {
    const result = parseCidr("10.0.0.0/16");
    expect(result.prefix).toBe(16);
    expect(result.network).toBe(ipToInt("10.0.0.0"));
  });

  it("IPがCIDR範囲内か判定できる", () => {
    expect(isInCidr("10.0.1.10", "10.0.0.0/16")).toBe(true);
    expect(isInCidr("10.0.1.10", "10.0.1.0/24")).toBe(true);
    expect(isInCidr("10.0.2.10", "10.0.1.0/24")).toBe(false);
    expect(isInCidr("192.168.1.1", "10.0.0.0/8")).toBe(false);
  });

  it("0.0.0.0/0は全IPにマッチする", () => {
    expect(isInCidr("1.2.3.4", "0.0.0.0/0")).toBe(true);
    expect(isInCidr("255.255.255.255", "0.0.0.0/0")).toBe(true);
  });
});

// === ルートテーブル ===
describe("ルートテーブル", () => {
  const rt: RouteTable = {
    id: "rt-1", name: "TestRT",
    routes: [
      { destination: "10.0.0.0/16", target: "local", targetType: "local" },
      { destination: "10.0.1.0/24", target: "local", targetType: "local" },
      { destination: "0.0.0.0/0", target: "igw-1", targetType: "igw" },
    ],
  };

  it("最長一致でルートを選択する", () => {
    const route = findRoute(rt, "10.0.1.10");
    expect(route?.destination).toBe("10.0.1.0/24");
  });

  it("デフォルトルートにフォールバックする", () => {
    const route = findRoute(rt, "8.8.8.8");
    expect(route?.destination).toBe("0.0.0.0/0");
    expect(route?.targetType).toBe("igw");
  });

  it("マッチするルートがなければnullを返す", () => {
    const rtNoDefault: RouteTable = {
      id: "rt-2", name: "Limited",
      routes: [{ destination: "10.0.0.0/16", target: "local", targetType: "local" }],
    };
    const route = findRoute(rtNoDefault, "8.8.8.8");
    expect(route).toBeNull();
  });
});

// === NACL ===
describe("ネットワークACL", () => {
  const rules: AclRule[] = [
    { ruleNumber: 10, protocol: "tcp", fromPort: 80, toPort: 80, cidr: "0.0.0.0/0", action: "allow" },
    { ruleNumber: 20, protocol: "tcp", fromPort: 22, toPort: 22, cidr: "10.0.1.0/24", action: "deny" },
    { ruleNumber: 100, protocol: "all", fromPort: 0, toPort: 65535, cidr: "0.0.0.0/0", action: "allow" },
  ];

  const httpPacket: Packet = { srcIp: "1.1.1.1", dstIp: "10.0.2.10", protocol: "tcp", srcPort: 50000, dstPort: 80, payload: "" };
  const sshPacket: Packet = { srcIp: "10.0.1.10", dstIp: "10.0.2.10", protocol: "tcp", srcPort: 50000, dstPort: 22, payload: "" };

  it("ルール番号順に評価する", () => {
    const result = evaluateAcl(rules, httpPacket, "inbound");
    expect(result.action).toBe("allow");
    expect(result.rule?.ruleNumber).toBe(10);
  });

  it("先にマッチしたDenyルールが適用される", () => {
    const result = evaluateAcl(rules, sshPacket, "inbound");
    expect(result.action).toBe("deny");
    expect(result.rule?.ruleNumber).toBe(20);
  });

  it("マッチするルールがなければdeny", () => {
    const result = evaluateAcl([], httpPacket, "inbound");
    expect(result.action).toBe("deny");
  });
});

// === セキュリティグループ ===
describe("セキュリティグループ", () => {
  const sg: SecurityGroup = {
    id: "sg-1", name: "test-sg",
    inboundRules: [
      { protocol: "tcp", fromPort: 80, toPort: 80, source: "0.0.0.0/0", description: "HTTP" },
      { protocol: "tcp", fromPort: 22, toPort: 22, source: "10.0.0.0/16", description: "SSH" },
    ],
    outboundRules: [
      { protocol: "all", fromPort: 0, toPort: 65535, source: "0.0.0.0/0", description: "All" },
    ],
  };

  it("許可ルールにマッチすればallow", () => {
    const pkt: Packet = { srcIp: "1.1.1.1", dstIp: "10.0.1.10", protocol: "tcp", srcPort: 50000, dstPort: 80, payload: "" };
    const result = evaluateSg([sg], pkt, "inbound");
    expect(result.allowed).toBe(true);
  });

  it("ルールにマッチしなければdeny", () => {
    const pkt: Packet = { srcIp: "1.1.1.1", dstIp: "10.0.1.10", protocol: "tcp", srcPort: 50000, dstPort: 3306, payload: "" };
    const result = evaluateSg([sg], pkt, "inbound");
    expect(result.allowed).toBe(false);
  });

  it("SSHはVPC内からのみ許可", () => {
    const fromVpc: Packet = { srcIp: "10.0.2.5", dstIp: "10.0.1.10", protocol: "tcp", srcPort: 50000, dstPort: 22, payload: "" };
    const fromExt: Packet = { srcIp: "1.1.1.1", dstIp: "10.0.1.10", protocol: "tcp", srcPort: 50000, dstPort: 22, payload: "" };
    expect(evaluateSg([sg], fromVpc, "inbound").allowed).toBe(true);
    expect(evaluateSg([sg], fromExt, "inbound").allowed).toBe(false);
  });
});

// === シミュレーション ===
describe("シミュレーション", () => {
  it("VPC内ローカル転送が成功する", () => {
    const result = runSimulation(
      JSON.parse(JSON.stringify(presets[0]!.vpcs)),
      presets[0]!.packets,
    );
    expect(result.delivered).toBe(true);
    expect(result.events.some((e) => e.type === "deliver")).toBe(true);
  });

  it("SG拒否でパケットがドロップされる", () => {
    const result = runSimulation(
      JSON.parse(JSON.stringify(presets[1]!.vpcs)),
      presets[1]!.packets,
    );
    expect(result.events.some((e) => e.type === "sg_deny")).toBe(true);
  });

  it("NACL拒否でパケットがドロップされる", () => {
    const result = runSimulation(
      JSON.parse(JSON.stringify(presets[2]!.vpcs)),
      presets[2]!.packets,
    );
    expect(result.events.some((e) => e.type === "nacl_deny")).toBe(true);
  });

  it("NATゲートウェイ経由で送信できる", () => {
    const result = runSimulation(
      JSON.parse(JSON.stringify(presets[3]!.vpcs)),
      presets[3]!.packets,
    );
    expect(result.events.some((e) => e.type === "nat_translate")).toBe(true);
    expect(result.delivered).toBe(true);
  });

  it("ルートなしでパケットが破棄される", () => {
    const result = runSimulation(
      JSON.parse(JSON.stringify(presets[5]!.vpcs)),
      presets[5]!.packets,
    );
    expect(result.events.some((e) => e.type === "route_no_match")).toBe(true);
  });

  it("VPCピアリングで転送できる", () => {
    const result = runSimulation(
      JSON.parse(JSON.stringify(presets[6]!.vpcs)),
      presets[6]!.packets,
    );
    expect(result.events.some((e) => e.type === "peering_forward")).toBe(true);
    expect(result.delivered).toBe(true);
  });
});

// === プリセット ===
describe("プリセット", () => {
  it("全プリセットがエラーなく実行できる", () => {
    for (const preset of presets) {
      const vpcs = JSON.parse(JSON.stringify(preset.vpcs));
      const result = runSimulation(vpcs, preset.packets);
      expect(result.events.length, `${preset.name}: イベントが空`).toBeGreaterThan(0);
    }
  });

  it("10個のプリセットが定義されている", () => {
    expect(presets.length).toBe(10);
  });
});
