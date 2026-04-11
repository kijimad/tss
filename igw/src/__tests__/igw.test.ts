import { describe, it, expect } from "vitest";
import { ipToInt, isInCidr, runSimulation, presets } from "../igw/index.js";
import type { Vpc, PacketDef } from "../igw/index.js";

/** テスト用VPC生成 */
function makeTestVpc(overrides?: Partial<Vpc>): Vpc {
  return {
    id: "vpc-1", name: "TestVPC", cidr: "10.0.0.0/16",
    igw: { id: "igw-1", name: "TestIGW", attachedVpcId: "vpc-1", state: "attached" },
    natGateways: [],
    subnets: [
      { id: "sub-pub", name: "Public", cidr: "10.0.1.0/24", az: "1a",
        isPublic: true, mapPublicIpOnLaunch: true, routeTableId: "rt-pub" },
      { id: "sub-priv", name: "Private", cidr: "10.0.2.0/24", az: "1a",
        isPublic: false, mapPublicIpOnLaunch: false, routeTableId: "rt-priv" },
    ],
    routeTables: [
      { id: "rt-pub", name: "PublicRT", routes: [
        { destination: "10.0.0.0/16", target: "local", targetType: "local" },
        { destination: "0.0.0.0/0", target: "igw-1", targetType: "igw" },
      ]},
      { id: "rt-priv", name: "PrivateRT", routes: [
        { destination: "10.0.0.0/16", target: "local", targetType: "local" },
      ]},
    ],
    instances: [
      { id: "i-pub", name: "PubInst", privateIp: "10.0.1.10", publicIp: "54.250.1.10",
        subnetId: "sub-pub", hasPublicIp: true },
      { id: "i-priv", name: "PrivInst", privateIp: "10.0.2.20",
        subnetId: "sub-priv", hasPublicIp: false },
    ],
    elasticIps: [],
    ...overrides,
  };
}

function outbound(srcId: string, dstIp: string): PacketDef {
  return { direction: "outbound", srcInstanceId: srcId, dstIp,
    protocol: "tcp", srcPort: 50000, dstPort: 443, payload: "test" };
}

function inbound(dstPublicIp: string): PacketDef {
  return { direction: "inbound", srcExternalIp: "203.0.113.1", dstIp: dstPublicIp,
    protocol: "tcp", srcPort: 50000, dstPort: 80, payload: "test" };
}

// === CIDR ===
describe("CIDR", () => {
  it("IPを整数に変換する", () => {
    expect(ipToInt("10.0.1.1")).toBe(0x0A000101);
  });
  it("CIDR判定が正しい", () => {
    expect(isInCidr("10.0.1.10", "10.0.0.0/16")).toBe(true);
    expect(isInCidr("192.168.1.1", "10.0.0.0/16")).toBe(false);
  });
});

// === IGW アウトバウンド ===
describe("IGW アウトバウンド", () => {
  it("パブリックIPありのインスタンスがIGW経由で送信できる", () => {
    const result = runSimulation(makeTestVpc(), [outbound("i-pub", "8.8.8.8")]);
    expect(result.delivered).toBe(true);
    expect(result.events.some((e) => e.type === "igw_nat_outbound")).toBe(true);
    expect(result.natTable.length).toBeGreaterThan(0);
    expect(result.natTable[0]!.translatedSrc).toBe("54.250.1.10");
  });

  it("IGWの1:1 NATでプライベートIP→パブリックIPに変換される", () => {
    const result = runSimulation(makeTestVpc(), [outbound("i-pub", "1.1.1.1")]);
    const natEvent = result.events.find((e) => e.type === "igw_nat_outbound");
    expect(natEvent).toBeDefined();
    expect(natEvent!.description).toContain("10.0.1.10");
    expect(natEvent!.description).toContain("54.250.1.10");
  });

  it("パブリックIPなしのインスタンスはIGWで拒否される", () => {
    const vpc = makeTestVpc({
      routeTables: [
        { id: "rt-pub", name: "PubRT", routes: [
          { destination: "10.0.0.0/16", target: "local", targetType: "local" },
          { destination: "0.0.0.0/0", target: "igw-1", targetType: "igw" },
        ]},
        { id: "rt-priv", name: "PrivRT", routes: [
          { destination: "10.0.0.0/16", target: "local", targetType: "local" },
          { destination: "0.0.0.0/0", target: "igw-1", targetType: "igw" },
        ]},
      ],
    });
    const result = runSimulation(vpc, [outbound("i-priv", "8.8.8.8")]);
    expect(result.delivered).toBe(false);
    expect(result.events.some((e) => e.type === "igw_no_public_ip")).toBe(true);
  });
});

// === IGW インバウンド ===
describe("IGW インバウンド", () => {
  it("パブリックIPへのインバウンドがプライベートIPに変換される", () => {
    const result = runSimulation(makeTestVpc(), [inbound("54.250.1.10")]);
    expect(result.delivered).toBe(true);
    expect(result.events.some((e) => e.type === "igw_nat_inbound")).toBe(true);
  });

  it("存在しないパブリックIPへのインバウンドは破棄される", () => {
    const result = runSimulation(makeTestVpc(), [inbound("99.99.99.99")]);
    expect(result.delivered).toBe(false);
    expect(result.events.some((e) => e.type === "drop")).toBe(true);
  });
});

// === IGW状態 ===
describe("IGW状態", () => {
  it("デタッチ状態のIGWではパケットが破棄される", () => {
    const vpc = makeTestVpc({
      igw: { id: "igw-1", name: "DetachedIGW", state: "detached" },
    });
    const result = runSimulation(vpc, [outbound("i-pub", "8.8.8.8")]);
    expect(result.delivered).toBe(false);
    expect(result.events.some((e) => e.type === "igw_detached")).toBe(true);
  });

  it("IGWなしではパケットが破棄される", () => {
    const vpc = makeTestVpc({ igw: undefined });
    const result = runSimulation(vpc, [outbound("i-pub", "8.8.8.8")]);
    expect(result.delivered).toBe(false);
  });
});

// === NAT Gateway ===
describe("NAT Gateway", () => {
  it("NATゲートウェイ経由でプライベートインスタンスが送信できる", () => {
    const vpc = makeTestVpc({
      natGateways: [{ id: "nat-1", name: "NAT-GW", subnetId: "sub-pub", publicIp: "54.250.2.1" }],
      routeTables: [
        { id: "rt-pub", name: "PubRT", routes: [
          { destination: "10.0.0.0/16", target: "local", targetType: "local" },
          { destination: "0.0.0.0/0", target: "igw-1", targetType: "igw" },
        ]},
        { id: "rt-priv", name: "PrivRT", routes: [
          { destination: "10.0.0.0/16", target: "local", targetType: "local" },
          { destination: "0.0.0.0/0", target: "nat-1", targetType: "nat" },
        ]},
      ],
    });
    const result = runSimulation(vpc, [outbound("i-priv", "8.8.8.8")]);
    expect(result.delivered).toBe(true);
    expect(result.events.some((e) => e.type === "nat_gw_translate")).toBe(true);
  });
});

// === ローカルルーティング ===
describe("ローカルルーティング", () => {
  it("VPC内通信はIGWを経由しない", () => {
    const result = runSimulation(makeTestVpc(), [outbound("i-pub", "10.0.2.20")]);
    expect(result.delivered).toBe(true);
    expect(result.events.some((e) => e.type === "igw_receive")).toBe(false);
    expect(result.events.some((e) => e.type === "subnet_forward")).toBe(true);
  });
});

// === ルートなし ===
describe("ルートなし", () => {
  it("デフォルトルートがなければパケット破棄", () => {
    const result = runSimulation(makeTestVpc(), [outbound("i-priv", "8.8.8.8")]);
    expect(result.delivered).toBe(false);
    expect(result.events.some((e) => e.type === "route_no_match")).toBe(true);
  });
});

// === ブラックホール ===
describe("ブラックホールルート", () => {
  it("ブラックホールルートでパケットが破棄される", () => {
    const vpc = makeTestVpc({
      routeTables: [
        { id: "rt-pub", name: "PubRT", routes: [
          { destination: "10.0.0.0/16", target: "local", targetType: "local" },
          { destination: "198.51.100.0/24", target: "blackhole", targetType: "blackhole" },
          { destination: "0.0.0.0/0", target: "igw-1", targetType: "igw" },
        ]},
        { id: "rt-priv", name: "PrivRT", routes: [
          { destination: "10.0.0.0/16", target: "local", targetType: "local" },
        ]},
      ],
    });
    const result = runSimulation(vpc, [outbound("i-pub", "198.51.100.50")]);
    expect(result.delivered).toBe(false);
    expect(result.events.some((e) => e.type === "drop")).toBe(true);
  });
});

// === プリセット ===
describe("プリセット", () => {
  it("全プリセットがエラーなく実行できる", () => {
    for (const preset of presets) {
      const vpc = JSON.parse(JSON.stringify(preset.vpc));
      const result = runSimulation(vpc, preset.packets);
      expect(result.events.length, `${preset.name}: イベントが空`).toBeGreaterThan(0);
    }
  });

  it("10個のプリセットが定義されている", () => {
    expect(presets.length).toBe(10);
  });
});
