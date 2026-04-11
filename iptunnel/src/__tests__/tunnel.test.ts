import { describe, it, expect } from "vitest";
import { runSimulation, presets } from "../tunnel/index.js";
import type { TunnelProtocol } from "../tunnel/index.js";

/** 指定プロトコルのプリセットを実行 */
function runByProtocol(protocol: TunnelProtocol): ReturnType<typeof runSimulation> {
  const preset = presets.find((p) => p.tunnel.protocol === protocol);
  if (!preset) throw new Error(`Preset not found for ${protocol}`);
  return runSimulation(preset);
}

// === IP-in-IP ===
describe("IP-in-IP", () => {
  it("外側IPヘッダのプロトコルが4(IPIP)である", () => {
    const result = runByProtocol("IPIP");
    const encap = result.events.find((e) => e.type === "encapsulate" && e.packet.outerIp);
    expect(encap).toBeDefined();
    expect(encap!.packet.outerIp!.protocol).toBe(4);
  });

  it("内側パケットが保持されている", () => {
    const result = runByProtocol("IPIP");
    const deliver = result.events.find((e) => e.type === "deliver");
    expect(deliver).toBeDefined();
    expect(deliver!.packet.innerIp.src).toBe("10.0.1.10");
    expect(deliver!.packet.innerIp.dst).toBe("10.0.2.10");
  });
});

// === GRE ===
describe("GRE", () => {
  it("GREヘッダが付与される", () => {
    const result = runByProtocol("GRE");
    const greEvent = result.events.find((e) => e.type === "add_gre");
    expect(greEvent).toBeDefined();
  });

  it("外側IPのプロトコルが47(GRE)である", () => {
    const result = runByProtocol("GRE");
    const encap = result.events.find((e) => e.type === "encapsulate" && e.packet.outerIp);
    expect(encap!.packet.outerIp!.protocol).toBe(47);
  });

  it("GREキーが設定される", () => {
    const preset = presets.find((p) => p.tunnel.greKey !== undefined)!;
    const result = runSimulation(preset);
    const greEvent = result.events.find((e) => e.type === "add_gre");
    expect(greEvent).toBeDefined();
    expect(greEvent!.packet.greHeader ?? result.events.some(
      (e) => e.description.includes("key="),
    )).toBeTruthy();
  });

  it("GREデカプセル化でGREヘッダが除去される", () => {
    const result = runByProtocol("GRE");
    expect(result.events.some((e) => e.type === "remove_gre")).toBe(true);
  });
});

// === 6in4 ===
describe("6in4", () => {
  it("外側IPのプロトコルが41(IPv6)である", () => {
    const result = runByProtocol("6in4");
    const encap = result.events.find((e) => e.type === "encapsulate" && e.packet.outerIp);
    expect(encap!.packet.outerIp!.protocol).toBe(41);
  });

  it("内側パケットがIPv6である", () => {
    const result = runByProtocol("6in4");
    const deliver = result.events.find((e) => e.type === "deliver");
    expect(deliver!.packet.innerIp.version).toBe(6);
  });
});

// === IPsec ===
describe("IPsec", () => {
  it("暗号化イベントが発生する", () => {
    const result = runByProtocol("IPsec");
    expect(result.events.some((e) => e.type === "encrypt")).toBe(true);
  });

  it("ESPヘッダが付与される", () => {
    const result = runByProtocol("IPsec");
    expect(result.events.some((e) => e.type === "add_esp")).toBe(true);
  });

  it("復号イベントが発生する", () => {
    const result = runByProtocol("IPsec");
    expect(result.events.some((e) => e.type === "decrypt")).toBe(true);
  });

  it("外側IPのプロトコルが50(ESP)である", () => {
    const result = runByProtocol("IPsec");
    const encap = result.events.find((e) => e.type === "encapsulate" && e.packet.outerIp);
    expect(encap!.packet.outerIp!.protocol).toBe(50);
  });
});

// === カプセル化/デカプセル化 ===
describe("カプセル化", () => {
  it("カプセル化でパケットサイズが増加する", () => {
    const result = runByProtocol("GRE");
    const encap = result.events.find((e) => e.type === "encapsulate" && e.packet.outerIp);
    expect(encap!.packet.outerIp!.totalLen).toBeGreaterThan(encap!.packet.innerIp.totalLen);
  });

  it("デカプセル化で内側パケットが復元される", () => {
    const result = runByProtocol("GRE");
    const decap = result.events.filter((e) => e.type === "decapsulate");
    const lastDecap = decap[decap.length - 1]!;
    expect(lastDecap.packet.outerIp).toBeUndefined();
    expect(lastDecap.packet.innerIp).toBeDefined();
  });
});

// === 中継 ===
describe("中継転送", () => {
  it("中継ルータは外側IPだけを見て転送する", () => {
    const result = runByProtocol("IPIP");
    const transit = result.events.filter((e) => e.type === "transit");
    expect(transit.length).toBeGreaterThan(0);
    // 中継時にはカプセル化されたパケットが渡される
    expect(transit[0]!.packet.outerIp).toBeDefined();
  });

  it("TTLが減算される", () => {
    const result = runByProtocol("IPIP");
    const routes = result.events.filter((e) => e.type === "route");
    expect(routes.length).toBeGreaterThan(0);
    expect(routes[0]!.description).toContain("TTL=");
  });
});

// === MTU ===
describe("MTU", () => {
  it("MTU超過でフラグメンテーションが発生する", () => {
    const mtuPreset = presets.find((p) => p.name.includes("MTU"))!;
    const result = runSimulation(mtuPreset);
    expect(result.events.some((e) => e.type === "fragment")).toBe(true);
  });
});

// === プリセット ===
describe("プリセット", () => {
  it("全プリセットがエラーなく実行できる", () => {
    for (const preset of presets) {
      const result = runSimulation(preset);
      expect(result.events.length, `${preset.name}: イベントが空`).toBeGreaterThan(0);
    }
  });

  it("10個のプリセットが定義されている", () => {
    expect(presets.length).toBe(10);
  });

  it("全プリセットでdeliverイベントが少なくとも1つ存在する（MTU/TTL除く）", () => {
    for (const preset of presets) {
      if (preset.name.includes("TTL")) continue; // TTLテストは途中で破棄される場合がある
      const result = runSimulation(preset);
      expect(result.events.some((e) => e.type === "deliver"),
        `${preset.name}: deliverイベントがない`).toBe(true);
    }
  });
});
