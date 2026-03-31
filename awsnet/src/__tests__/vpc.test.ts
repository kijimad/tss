import { describe, it, expect } from "vitest";
import { AwsVpc, cidrContains } from "../net/vpc.js";
import { EXAMPLES } from "../ui/app.js";

describe("cidrContains", () => {
  it("0.0.0.0/0 は全 IP にマッチ", () => { expect(cidrContains("0.0.0.0/0", "1.2.3.4")).toBe(true); });
  it("/24 の同一サブネット", () => { expect(cidrContains("10.0.1.0/24", "10.0.1.50")).toBe(true); });
  it("/24 の別サブネット", () => { expect(cidrContains("10.0.1.0/24", "10.0.2.50")).toBe(false); });
  it("/16 の広いレンジ", () => { expect(cidrContains("10.0.0.0/16", "10.0.99.1")).toBe(true); });
});

describe("基本 VPC パケットトレース", () => {
  it("外部 → パブリック Web (HTTP 許可)", () => {
    const vpc = new AwsVpc();
    EXAMPLES[0]!.build(vpc);
    const result = vpc.tracePacket(EXAMPLES[0]!.packets[0]!);
    expect(result.allowed).toBe(true);
  });

  it("外部 → パブリック Web (SSH 拒否: SG)", () => {
    const vpc = new AwsVpc();
    EXAMPLES[0]!.build(vpc);
    const result = vpc.tracePacket(EXAMPLES[0]!.packets[1]!);
    expect(result.allowed).toBe(false);
  });

  it("Web → DB (VPC 内 PostgreSQL)", () => {
    const vpc = new AwsVpc();
    EXAMPLES[0]!.build(vpc);
    const result = vpc.tracePacket(EXAMPLES[0]!.packets[2]!);
    expect(result.allowed).toBe(true);
  });

  it("DB → Internet (NAT GW 経由)", () => {
    const vpc = new AwsVpc();
    EXAMPLES[0]!.build(vpc);
    const result = vpc.tracePacket(EXAMPLES[0]!.packets[3]!);
    expect(result.allowed).toBe(true);
    expect(result.hops.some((h) => h.component.includes("NAT"))).toBe(true);
  });

  it("外部 → プライベート DB (到達不可)", () => {
    const vpc = new AwsVpc();
    EXAMPLES[0]!.build(vpc);
    const result = vpc.tracePacket(EXAMPLES[0]!.packets[4]!);
    expect(result.allowed).toBe(false);
  });
});

describe("NACL ブロック", () => {
  it("ブロック IP からのアクセスを NACL が拒否する", () => {
    const vpc = new AwsVpc();
    EXAMPLES[2]!.build(vpc);
    const result = vpc.tracePacket(EXAMPLES[2]!.packets[1]!);
    expect(result.allowed).toBe(false);
    expect(result.hops.some((h) => h.component.includes("NACL") && h.result === "drop")).toBe(true);
  });

  it("一般 IP からのアクセスは許可", () => {
    const vpc = new AwsVpc();
    EXAMPLES[2]!.build(vpc);
    const result = vpc.tracePacket(EXAMPLES[2]!.packets[0]!);
    expect(result.allowed).toBe(true);
  });
});

describe("プライベートのみ VPC", () => {
  it("VPC 内通信は可能", () => {
    const vpc = new AwsVpc();
    EXAMPLES[3]!.build(vpc);
    const result = vpc.tracePacket(EXAMPLES[3]!.packets[0]!);
    expect(result.allowed).toBe(true);
  });

  it("インターネットへのルートがない", () => {
    const vpc = new AwsVpc();
    EXAMPLES[3]!.build(vpc);
    const result = vpc.tracePacket(EXAMPLES[3]!.packets[1]!);
    expect(result.allowed).toBe(false);
  });
});

describe("全サンプルの実行", () => {
  for (const ex of EXAMPLES) {
    it(`${ex.name}: 全パケットがトレース可能`, () => {
      const vpc = new AwsVpc();
      ex.build(vpc);
      for (const pkt of ex.packets) {
        const result = vpc.tracePacket(pkt);
        expect(result.hops.length).toBeGreaterThan(0);
        expect(typeof result.allowed).toBe("boolean");
      }
    });
  }
});

describe("EXAMPLES", () => {
  it("4 つのサンプルが定義されている", () => {
    expect(EXAMPLES).toHaveLength(4);
  });
  it("サンプル名が重複していない", () => {
    const names = EXAMPLES.map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
