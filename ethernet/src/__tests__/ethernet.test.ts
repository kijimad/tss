import { describe, it, expect } from "vitest";
import { buildFrame, crc32, simulate, dissectFrame } from "../engine/ethernet.js";
import { EXAMPLES } from "../ui/app.js";
import type { EthNetwork } from "../engine/ethernet.js";

describe("crc32", () => {
  it("同一入力で同一ハッシュ", () => {
    expect(crc32("hello")).toBe(crc32("hello"));
  });
  it("異なる入力で異なるハッシュ", () => {
    expect(crc32("hello")).not.toBe(crc32("world"));
  });
  it("8 桁の16進文字列を返す", () => {
    expect(crc32("test")).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("buildFrame", () => {
  it("基本フレームが構築される", () => {
    const f = buildFrame("AA:BB:CC:DD:EE:01", "AA:BB:CC:DD:EE:02", 0x0800, "Hello");
    expect(f.srcMac).toBe("AA:BB:CC:DD:EE:01");
    expect(f.dstMac).toBe("AA:BB:CC:DD:EE:02");
    expect(f.etherType).toBe(0x0800);
    expect(f.etherTypeName).toBe("IPv4");
    expect(f.fcs).toMatch(/^[0-9a-f]{8}$/);
  });

  it("最小フレームサイズ (64B) を保証 (パディング)", () => {
    const f = buildFrame("AA:00:00:00:00:01", "AA:00:00:00:00:02", 0x0800, "Hi");
    expect(f.totalSize).toBeGreaterThanOrEqual(64);
    expect(f.payload.length).toBeGreaterThanOrEqual(46);
  });

  it("VLAN タグが付与される", () => {
    const f = buildFrame("AA:00:00:00:00:01", "AA:00:00:00:00:02", 0x0800, "data", 100);
    expect(f.vlanTag).not.toBeNull();
    expect(f.vlanTag!.vid).toBe(100);
    expect(f.vlanTag!.tpid).toBe(0x8100);
  });

  it("VLAN なしなら vlanTag は null", () => {
    const f = buildFrame("AA:00:00:00:00:01", "AA:00:00:00:00:02", 0x0800, "data");
    expect(f.vlanTag).toBeNull();
  });

  it("プリアンブルが含まれる", () => {
    const f = buildFrame("AA:00:00:00:00:01", "AA:00:00:00:00:02", 0x0800, "data");
    expect(f.preamble).toContain("AA");
    expect(f.preamble).toContain("AB");
  });
});

describe("dissectFrame", () => {
  it("フィールド一覧を返す", () => {
    const f = buildFrame("AA:00:00:00:00:01", "AA:00:00:00:00:02", 0x0800, "test data here");
    const fields = dissectFrame(f);
    expect(fields.length).toBeGreaterThanOrEqual(5);
    expect(fields.find((f) => f.field === "Dst MAC")).toBeDefined();
    expect(fields.find((f) => f.field === "Src MAC")).toBeDefined();
    expect(fields.find((f) => f.field === "EtherType")).toBeDefined();
    expect(fields.find((f) => f.field === "FCS (CRC-32)")).toBeDefined();
  });

  it("VLAN タグ付きフレームは追加フィールドがある", () => {
    const f = buildFrame("AA:00:00:00:00:01", "AA:00:00:00:00:02", 0x0800, "data", 10);
    const fields = dissectFrame(f);
    expect(fields.find((f) => f.field === "VLAN ID")).toBeDefined();
  });
});

describe("simulate", () => {
  const basicNet: EthNetwork = {
    hosts: [
      { name: "A", mac: "00:00:00:00:00:01", ip: "10.0.0.1", port: 1 },
      { name: "B", mac: "00:00:00:00:00:02", ip: "10.0.0.2", port: 2 },
      { name: "C", mac: "00:00:00:00:00:03", ip: "10.0.0.3", port: 3 },
    ],
    switches: [{
      name: "SW", macTable: [],
      ports: [
        { id: 1, host: "A", vlan: 1, mode: "access", stpState: "forwarding" },
        { id: 2, host: "B", vlan: 1, mode: "access", stpState: "forwarding" },
        { id: 3, host: "C", vlan: 1, mode: "access", stpState: "forwarding" },
      ],
    }],
  };

  it("MAC アドレスを学習する", () => {
    const net: EthNetwork = JSON.parse(JSON.stringify(basicNet));
    const r = simulate(net, "A", "B", 0x0800, "test");
    expect(r.macTableAfter.find((e) => e.mac === "00:00:00:00:00:01")).toBeDefined();
  });

  it("ブロードキャストで全ポートにフラッディング", () => {
    const net: EthNetwork = JSON.parse(JSON.stringify(basicNet));
    const r = simulate(net, "A", "broadcast", 0x0806, "ARP");
    expect(r.trace.some((t) => t.phase === "broadcast")).toBe(true);
  });

  it("MAC テーブルヒットでユニキャスト転送", () => {
    const net: EthNetwork = JSON.parse(JSON.stringify(basicNet));
    net.switches[0]!.macTable = [{ mac: "00:00:00:00:00:02", port: 2, vlan: 1, age: 0 }];
    const r = simulate(net, "A", "B", 0x0800, "data");
    expect(r.trace.some((t) => t.phase === "forward")).toBe(true);
  });

  it("VLAN フィルタが動作する", () => {
    const vlanNet: EthNetwork = {
      hosts: [
        { name: "A", mac: "00:00:00:00:00:01", ip: "10.0.0.1", port: 1, vlan: 10 },
        { name: "B", mac: "00:00:00:00:00:02", ip: "10.0.0.2", port: 2, vlan: 20 },
      ],
      switches: [{
        name: "SW", macTable: [],
        ports: [
          { id: 1, host: "A", vlan: 10, mode: "access", stpState: "forwarding" },
          { id: 2, host: "B", vlan: 20, mode: "access", stpState: "forwarding" },
        ],
      }],
    };
    const r = simulate(vlanNet, "A", "broadcast", 0x0800, "data");
    expect(r.trace.some((t) => t.phase === "vlan_filter")).toBe(true);
  });

  it("STP Blocking ポートでフレームが破棄される", () => {
    const stpNet: EthNetwork = {
      hosts: [{ name: "A", mac: "00:00:00:00:00:01", ip: "10.0.0.1", port: 1 }],
      switches: [{
        name: "SW", macTable: [],
        ports: [{ id: 1, host: "A", vlan: 1, mode: "access", stpState: "blocking" }],
      }],
    };
    const r = simulate(stpNet, "A", "broadcast", 0x0800, "data");
    expect(r.trace.some((t) => t.phase === "stp")).toBe(true);
  });

  it("トレースが生成される", () => {
    const net: EthNetwork = JSON.parse(JSON.stringify(basicNet));
    const r = simulate(net, "A", "B", 0x0800, "data");
    expect(r.trace.length).toBeGreaterThan(0);
    expect(r.trace[0]!.phase).toBe("frame_build");
  });
});

describe("EXAMPLES", () => {
  it("8 つのサンプル", () => { expect(EXAMPLES).toHaveLength(8); });
  it("名前が一意", () => { expect(new Set(EXAMPLES.map((e) => e.name)).size).toBe(EXAMPLES.length); });

  for (const ex of EXAMPLES) {
    it(`${ex.name}: 実行可能`, () => {
      const net: EthNetwork = JSON.parse(JSON.stringify(ex.network));
      const r = simulate(net, ex.srcHost, ex.dstHost, ex.etherType, ex.payload);
      expect(r.trace.length).toBeGreaterThan(0);
      expect(r.frames.length).toBeGreaterThanOrEqual(0);
    });
  }
});
