import { describe, it, expect, beforeEach } from "vitest";
import { FirewallEngine, matchCidr } from "../engine/firewall.js";
import type { SecurityGroup, Instance, Packet } from "../engine/firewall.js";

// ── CIDR マッチテスト ──

describe("matchCidr", () => {
  it("0.0.0.0/0 は全 IP にマッチ", () => {
    expect(matchCidr("192.168.1.1", "0.0.0.0/0")).toBe(true);
  });
  it("/24 の同一サブネットにマッチ", () => {
    expect(matchCidr("10.0.1.50", "10.0.1.0/24")).toBe(true);
  });
  it("/24 の別サブネットにマッチしない", () => {
    expect(matchCidr("10.0.2.50", "10.0.1.0/24")).toBe(false);
  });
  it("/16 の広いレンジにマッチ", () => {
    expect(matchCidr("10.0.99.1", "10.0.0.0/16")).toBe(true);
  });
  it("/32 は完全一致のみ", () => {
    expect(matchCidr("10.0.1.1", "10.0.1.1/32")).toBe(true);
    expect(matchCidr("10.0.1.2", "10.0.1.1/32")).toBe(false);
  });
});

// ── ファイアウォールエンジンテスト ──

const webSg: SecurityGroup = {
  id: "sg-web", name: "web-sg",
  inbound: [
    { protocol: "tcp", fromPort: 80, toPort: 80, source: "0.0.0.0/0", description: "HTTP" },
    { protocol: "tcp", fromPort: 443, toPort: 443, source: "0.0.0.0/0", description: "HTTPS" },
  ],
  outbound: [
    { protocol: "all", fromPort: 0, toPort: 65535, source: "0.0.0.0/0", description: "全アウトバウンド" },
  ],
};

const emptySg: SecurityGroup = {
  id: "sg-empty", name: "empty-sg",
  inbound: [], outbound: [],
};

const webInstance: Instance = {
  id: "i-web", name: "web-server", privateIp: "10.0.1.10", subnet: "10.0.1.0/24", sgIds: ["sg-web"],
};

describe("FirewallEngine 基本", () => {
  let engine: FirewallEngine;

  beforeEach(() => {
    engine = new FirewallEngine([webSg], [webInstance]);
  });

  it("許可ルールにマッチするパケットは ALLOW", () => {
    const pkt: Packet = { srcIp: "203.0.113.1", dstIp: "10.0.1.10", srcPort: 50000, dstPort: 80, protocol: "tcp", label: "HTTP" };
    const result = engine.evaluate(pkt, "inbound");
    expect(result.allowed).toBe(true);
    expect(result.matchedSg).toBe("sg-web");
  });

  it("ルールにマッチしないパケットは DENY (implicit deny)", () => {
    const pkt: Packet = { srcIp: "203.0.113.1", dstIp: "10.0.1.10", srcPort: 50000, dstPort: 22, protocol: "tcp", label: "SSH" };
    const result = engine.evaluate(pkt, "inbound");
    expect(result.allowed).toBe(false);
  });

  it("プロトコルが異なるとマッチしない", () => {
    const pkt: Packet = { srcIp: "203.0.113.1", dstIp: "10.0.1.10", srcPort: 50000, dstPort: 80, protocol: "udp", label: "UDP 80" };
    const result = engine.evaluate(pkt, "inbound");
    expect(result.allowed).toBe(false);
  });

  it("HTTPS (443) も許可される", () => {
    const pkt: Packet = { srcIp: "203.0.113.1", dstIp: "10.0.1.10", srcPort: 50000, dstPort: 443, protocol: "tcp", label: "HTTPS" };
    const result = engine.evaluate(pkt, "inbound");
    expect(result.allowed).toBe(true);
  });

  it("アウトバウンドの全許可ルールが動作する", () => {
    const pkt: Packet = { srcIp: "10.0.1.10", dstIp: "8.8.8.8", srcPort: 50000, dstPort: 443, protocol: "tcp", label: "outbound HTTPS" };
    const result = engine.evaluate(pkt, "outbound");
    expect(result.allowed).toBe(true);
  });
});

describe("デフォルト拒否", () => {
  it("ルールが空の SG は全パケットを拒否する", () => {
    const inst: Instance = { id: "i-x", name: "locked", privateIp: "10.0.1.50", subnet: "10.0.1.0/24", sgIds: ["sg-empty"] };
    const engine = new FirewallEngine([emptySg], [inst]);
    const pkt: Packet = { srcIp: "203.0.113.1", dstIp: "10.0.1.50", srcPort: 50000, dstPort: 80, protocol: "tcp", label: "HTTP" };
    expect(engine.evaluate(pkt, "inbound").allowed).toBe(false);
  });
});

describe("CIDR 制限", () => {
  it("指定 CIDR 内からのみ許可される", () => {
    const sg: SecurityGroup = {
      id: "sg-ssh", name: "ssh-sg",
      inbound: [{ protocol: "tcp", fromPort: 22, toPort: 22, source: "10.0.0.0/16", description: "VPC 内 SSH" }],
      outbound: [],
    };
    const inst: Instance = { id: "i-a", name: "srv", privateIp: "10.0.1.10", subnet: "10.0.1.0/24", sgIds: ["sg-ssh"] };
    const engine = new FirewallEngine([sg], [inst]);

    const internal: Packet = { srcIp: "10.0.2.50", dstIp: "10.0.1.10", srcPort: 50000, dstPort: 22, protocol: "tcp", label: "VPC SSH" };
    expect(engine.evaluate(internal, "inbound").allowed).toBe(true);

    const external: Packet = { srcIp: "203.0.113.1", dstIp: "10.0.1.10", srcPort: 50000, dstPort: 22, protocol: "tcp", label: "External SSH" };
    expect(engine.evaluate(external, "inbound").allowed).toBe(false);
  });
});

describe("セキュリティグループ参照", () => {
  it("ソース SG にアタッチされたインスタンスからのトラフィックを許可する", () => {
    const sgA: SecurityGroup = { id: "sg-a", name: "sg-a", inbound: [], outbound: [{ protocol: "all", fromPort: 0, toPort: 65535, source: "0.0.0.0/0", description: "all" }] };
    const sgB: SecurityGroup = {
      id: "sg-b", name: "sg-b",
      inbound: [{ protocol: "tcp", fromPort: 8080, toPort: 8080, source: "sg-a", description: "sg-a から" }],
      outbound: [],
    };
    const instA: Instance = { id: "i-a", name: "app-a", privateIp: "10.0.1.10", subnet: "10.0.1.0/24", sgIds: ["sg-a"] };
    const instB: Instance = { id: "i-b", name: "app-b", privateIp: "10.0.2.10", subnet: "10.0.2.0/24", sgIds: ["sg-b"] };
    const engine = new FirewallEngine([sgA, sgB], [instA, instB]);

    const fromA: Packet = { srcIp: "10.0.1.10", dstIp: "10.0.2.10", srcPort: 50000, dstPort: 8080, protocol: "tcp", label: "A→B" };
    expect(engine.evaluate(fromA, "inbound").allowed).toBe(true);

    const fromExternal: Packet = { srcIp: "203.0.113.1", dstIp: "10.0.2.10", srcPort: 50000, dstPort: 8080, protocol: "tcp", label: "Ext→B" };
    expect(engine.evaluate(fromExternal, "inbound").allowed).toBe(false);
  });
});

describe("ステートフル動作", () => {
  it("許可されたインバウンドの応答パケットはアウトバウンドで自動許可される", () => {
    const engine = new FirewallEngine([webSg], [webInstance]);

    // インバウンド HTTP を許可
    const request: Packet = { srcIp: "203.0.113.1", dstIp: "10.0.1.10", srcPort: 50000, dstPort: 80, protocol: "tcp", label: "request" };
    expect(engine.evaluate(request, "inbound").allowed).toBe(true);

    // 応答（逆方向）はステートフルで自動許可
    const response: Packet = { srcIp: "10.0.1.10", dstIp: "203.0.113.1", srcPort: 80, dstPort: 50000, protocol: "tcp", label: "response" };
    const result = engine.evaluate(response, "outbound");
    expect(result.allowed).toBe(true);
    expect(result.matchedSg).toBe("stateful");
  });
});

describe("複数 SG アタッチ", () => {
  it("いずれかの SG のルールにマッチすれば許可される (OR 評価)", () => {
    const sg1: SecurityGroup = {
      id: "sg-1", name: "sg-1",
      inbound: [{ protocol: "tcp", fromPort: 22, toPort: 22, source: "0.0.0.0/0", description: "SSH" }],
      outbound: [],
    };
    const sg2: SecurityGroup = {
      id: "sg-2", name: "sg-2",
      inbound: [{ protocol: "tcp", fromPort: 80, toPort: 80, source: "0.0.0.0/0", description: "HTTP" }],
      outbound: [],
    };
    const inst: Instance = { id: "i-x", name: "multi", privateIp: "10.0.1.10", subnet: "10.0.1.0/24", sgIds: ["sg-1", "sg-2"] };
    const engine = new FirewallEngine([sg1, sg2], [inst]);

    const ssh: Packet = { srcIp: "1.1.1.1", dstIp: "10.0.1.10", srcPort: 50000, dstPort: 22, protocol: "tcp", label: "SSH" };
    expect(engine.evaluate(ssh, "inbound").allowed).toBe(true);

    const http: Packet = { srcIp: "1.1.1.1", dstIp: "10.0.1.10", srcPort: 50000, dstPort: 80, protocol: "tcp", label: "HTTP" };
    expect(engine.evaluate(http, "inbound").allowed).toBe(true);

    const other: Packet = { srcIp: "1.1.1.1", dstIp: "10.0.1.10", srcPort: 50000, dstPort: 3000, protocol: "tcp", label: "3000" };
    expect(engine.evaluate(other, "inbound").allowed).toBe(false);
  });
});

describe("トレース", () => {
  it("全評価でトレースが生成される", () => {
    const engine = new FirewallEngine([webSg], [webInstance]);
    const pkt: Packet = { srcIp: "1.1.1.1", dstIp: "10.0.1.10", srcPort: 50000, dstPort: 80, protocol: "tcp", label: "test" };
    const result = engine.evaluate(pkt, "inbound");
    expect(result.trace.length).toBeGreaterThan(0);
    expect(result.trace[0]!.phase).toBe("lookup");
  });
});
