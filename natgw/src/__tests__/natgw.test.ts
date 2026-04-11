import { describe, it, expect } from "vitest";
import { ipToInt, isInCidr, getIdleTimeout, runSimulation, presets } from "../natgw/index.js";
import type { Vpc, PacketDef } from "../natgw/index.js";

/** テスト用VPC生成 */
function makeVpc(overrides?: Partial<Vpc>): Vpc {
  return {
    id: "vpc-1", name: "TestVPC", cidr: "10.0.0.0/16",
    igw: { id: "igw-1", name: "TestIGW" },
    natGateways: [{
      id: "nat-1", name: "NAT-GW", subnetId: "sub-pub",
      eip: { allocationId: "eipalloc-1", publicIp: "54.250.10.1" },
      state: "available", maxConnections: 55000, bandwidthGbps: 45,
    }],
    subnets: [
      { id: "sub-pub", name: "Public", cidr: "10.0.1.0/24", az: "1a",
        isPublic: true, routeTableId: "rt-pub" },
      { id: "sub-priv", name: "Private", cidr: "10.0.2.0/24", az: "1a",
        isPublic: false, routeTableId: "rt-priv" },
    ],
    routeTables: [
      { id: "rt-pub", name: "PublicRT", routes: [
        { destination: "10.0.0.0/16", target: "local", targetType: "local" },
        { destination: "0.0.0.0/0", target: "igw-1", targetType: "igw" },
      ]},
      { id: "rt-priv", name: "PrivateRT", routes: [
        { destination: "10.0.0.0/16", target: "local", targetType: "local" },
        { destination: "0.0.0.0/0", target: "nat-1", targetType: "nat" },
      ]},
    ],
    instances: [
      { id: "i-pub", name: "PubInst", privateIp: "10.0.1.10", subnetId: "sub-pub", publicIp: "54.250.20.1" },
      { id: "i-priv", name: "PrivInst", privateIp: "10.0.2.10", subnetId: "sub-priv" },
      { id: "i-priv2", name: "PrivInst2", privateIp: "10.0.2.20", subnetId: "sub-priv" },
    ],
    ...overrides,
  };
}

function outbound(srcId: string, dstIp: string, proto: "tcp" | "udp" | "icmp" = "tcp", srcPort = 50000, dstPort = 443): PacketDef {
  return { direction: "outbound", srcInstanceId: srcId, dstIp, protocol: proto, srcPort, dstPort, payload: "test" };
}

function response(fromIp: string, natEip: string, fromPort: number, extPort: number, proto: "tcp" | "udp" | "icmp" = "tcp"): PacketDef {
  return {
    direction: "inbound", srcInstanceId: "", dstIp: natEip,
    protocol: proto, srcPort: fromPort, dstPort: extPort, payload: "resp",
    isResponse: true, responseFromIp: fromIp,
  };
}

// === CIDR ===
describe("CIDR", () => {
  it("IPを整数に変換する", () => {
    expect(ipToInt("10.0.1.1")).toBe(0x0A000101);
    expect(ipToInt("192.168.0.1")).toBe(0xC0A80001);
  });

  it("CIDR判定が正しい", () => {
    expect(isInCidr("10.0.2.10", "10.0.0.0/16")).toBe(true);
    expect(isInCidr("192.168.1.1", "10.0.0.0/16")).toBe(false);
    expect(isInCidr("10.0.2.10", "10.0.2.0/24")).toBe(true);
  });
});

// === アイドルタイムアウト ===
describe("アイドルタイムアウト", () => {
  it("プロトコル毎のタイムアウト値が正しい", () => {
    expect(getIdleTimeout("tcp")).toBe(350);
    expect(getIdleTimeout("udp")).toBe(120);
    expect(getIdleTimeout("icmp")).toBe(60);
  });
});

// === 基本的なSNAT ===
describe("NAT Gateway SNAT", () => {
  it("プライベートインスタンスがNAT GW経由で送信できる", () => {
    const result = runSimulation(makeVpc(), [outbound("i-priv", "8.8.8.8")]);
    expect(result.delivered).toBe(true);
    expect(result.events.some((e) => e.type === "nat_gw_snat")).toBe(true);
    expect(result.natMappings.length).toBe(1);
    expect(result.natMappings[0]!.externalIp).toBe("54.250.10.1");
  });

  it("SNATでプライベートIP→EIPに変換される", () => {
    const result = runSimulation(makeVpc(), [outbound("i-priv", "1.1.1.1")]);
    const mapping = result.natMappings[0]!;
    expect(mapping.internalIp).toBe("10.0.2.10");
    expect(mapping.externalIp).toBe("54.250.10.1");
    expect(mapping.externalPort).toBeGreaterThanOrEqual(1024);
  });

  it("IGW経由でインターネットに到達する", () => {
    const result = runSimulation(makeVpc(), [outbound("i-priv", "8.8.8.8")]);
    expect(result.events.some((e) => e.type === "igw_forward")).toBe(true);
    expect(result.events.some((e) => e.type === "deliver")).toBe(true);
  });
});

// === DNAT（レスポンス戻り） ===
describe("NAT Gateway DNAT", () => {
  it("レスポンスパケットがDNATで内部IPに戻される", () => {
    const result = runSimulation(makeVpc(), [
      outbound("i-priv", "93.184.216.34", "tcp", 50000, 443),
      response("93.184.216.34", "54.250.10.1", 443, 1024),
    ]);
    expect(result.events.some((e) => e.type === "nat_gw_dnat")).toBe(true);
    expect(result.events.filter((e) => e.type === "deliver").length).toBe(2);
  });

  it("マッピングがないレスポンスは破棄される", () => {
    const result = runSimulation(makeVpc(), [
      response("93.184.216.34", "54.250.10.1", 443, 9999),
    ]);
    expect(result.delivered).toBe(false);
    expect(result.events.some((e) => e.type === "drop")).toBe(true);
  });
});

// === ポート割り当て ===
describe("ポート割り当て", () => {
  it("複数接続に異なるポートが割り当てられる", () => {
    const result = runSimulation(makeVpc(), [
      outbound("i-priv", "8.8.8.8", "tcp", 50000, 443),
      outbound("i-priv2", "1.1.1.1", "tcp", 50001, 443),
    ]);
    expect(result.natMappings.length).toBe(2);
    const ports = result.natMappings.map((m) => m.externalPort);
    expect(new Set(ports).size).toBe(2);
  });
});

// === 同時接続数上限 ===
describe("同時接続数上限", () => {
  it("上限を超えるとErrorPortAllocationが発生する", () => {
    const vpc = makeVpc({
      natGateways: [{
        id: "nat-1", name: "NAT-GW", subnetId: "sub-pub",
        eip: { allocationId: "eipalloc-1", publicIp: "54.250.10.1" },
        state: "available", maxConnections: 1, bandwidthGbps: 45,
      }],
    });
    const result = runSimulation(vpc, [
      outbound("i-priv", "8.8.8.8", "tcp", 50000, 443),
      outbound("i-priv2", "1.1.1.1", "tcp", 50001, 443),
    ]);
    expect(result.events.some((e) => e.type === "nat_gw_conn_limit")).toBe(true);
    expect(result.natMappings.length).toBe(1);
  });
});

// === NAT GW状態異常 ===
describe("NAT GW状態異常", () => {
  it("availableでないNAT GWはパケットを破棄する", () => {
    const vpc = makeVpc({
      natGateways: [{
        id: "nat-1", name: "NAT-GW", subnetId: "sub-pub",
        eip: { allocationId: "eipalloc-1", publicIp: "54.250.10.1" },
        state: "failed", maxConnections: 55000, bandwidthGbps: 45,
      }],
    });
    const result = runSimulation(vpc, [outbound("i-priv", "8.8.8.8")]);
    expect(result.delivered).toBe(false);
    expect(result.events.some((e) => e.type === "nat_gw_state_error")).toBe(true);
  });

  it("pending状態でも破棄される", () => {
    const vpc = makeVpc({
      natGateways: [{
        id: "nat-1", name: "NAT-GW", subnetId: "sub-pub",
        eip: { allocationId: "eipalloc-1", publicIp: "54.250.10.1" },
        state: "pending", maxConnections: 55000, bandwidthGbps: 45,
      }],
    });
    const result = runSimulation(vpc, [outbound("i-priv", "8.8.8.8")]);
    expect(result.delivered).toBe(false);
    expect(result.events.some((e) => e.type === "nat_gw_state_error")).toBe(true);
  });
});

// === ルートなし ===
describe("ルートなし", () => {
  it("デフォルトルートがなければパケット破棄", () => {
    const vpc = makeVpc({
      routeTables: [
        { id: "rt-pub", name: "PubRT", routes: [
          { destination: "10.0.0.0/16", target: "local", targetType: "local" },
          { destination: "0.0.0.0/0", target: "igw-1", targetType: "igw" },
        ]},
        { id: "rt-priv", name: "PrivRT", routes: [
          { destination: "10.0.0.0/16", target: "local", targetType: "local" },
        ]},
      ],
    });
    const result = runSimulation(vpc, [outbound("i-priv", "8.8.8.8")]);
    expect(result.delivered).toBe(false);
    expect(result.events.some((e) => e.type === "route_no_match")).toBe(true);
  });
});

// === ローカルルーティング ===
describe("ローカルルーティング", () => {
  it("VPC内通信はNAT GWを経由しない", () => {
    const result = runSimulation(makeVpc(), [outbound("i-priv", "10.0.1.10")]);
    expect(result.delivered).toBe(true);
    expect(result.events.some((e) => e.type === "local_route")).toBe(true);
    expect(result.events.some((e) => e.type === "nat_gw_snat")).toBe(false);
  });
});

// === パブリックサブネット（IGW直接） ===
describe("パブリックサブネット", () => {
  it("パブリックIPありのインスタンスはIGW経由で送信", () => {
    const result = runSimulation(makeVpc(), [outbound("i-pub", "8.8.8.8")]);
    expect(result.delivered).toBe(true);
    expect(result.events.some((e) => e.type === "igw_forward")).toBe(true);
    expect(result.events.some((e) => e.type === "nat_gw_snat")).toBe(false);
  });
});

// === UDPプロトコル ===
describe("UDPプロトコル", () => {
  it("UDPパケットのNAT変換が正しい", () => {
    const result = runSimulation(makeVpc(), [outbound("i-priv", "8.8.8.8", "udp", 50000, 53)]);
    expect(result.delivered).toBe(true);
    expect(result.natMappings[0]!.protocol).toBe("udp");
    expect(result.natMappings[0]!.idleTimeoutSec).toBe(120);
  });
});

// === ICMPプロトコル ===
describe("ICMPプロトコル", () => {
  it("ICMPパケットのNAT変換が正しい", () => {
    const result = runSimulation(makeVpc(), [outbound("i-priv", "8.8.8.8", "icmp", 0, 0)]);
    expect(result.delivered).toBe(true);
    expect(result.natMappings[0]!.protocol).toBe("icmp");
    expect(result.natMappings[0]!.idleTimeoutSec).toBe(60);
  });
});

// === ブラックホール ===
describe("ブラックホールルート", () => {
  it("ブラックホールルートでパケットが破棄される", () => {
    const vpc = makeVpc({
      routeTables: [
        { id: "rt-pub", name: "PubRT", routes: [
          { destination: "10.0.0.0/16", target: "local", targetType: "local" },
          { destination: "0.0.0.0/0", target: "igw-1", targetType: "igw" },
        ]},
        { id: "rt-priv", name: "PrivRT", routes: [
          { destination: "10.0.0.0/16", target: "local", targetType: "local" },
          { destination: "198.51.100.0/24", target: "blackhole", targetType: "blackhole" },
          { destination: "0.0.0.0/0", target: "nat-1", targetType: "nat" },
        ]},
      ],
    });
    const result = runSimulation(vpc, [outbound("i-priv", "198.51.100.50")]);
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
