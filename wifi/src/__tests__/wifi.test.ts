import { describe, it, expect } from "vitest";
import { fspl, calcRssi, rssiToBar, rssiQuality, simulate, STANDARDS } from "../engine/wifi.js";
import { EXAMPLES } from "../ui/app.js";
import type { SimConfig, AccessPoint, Station } from "../engine/wifi.js";

const mkAp = (opts?: Partial<AccessPoint>): AccessPoint => ({
  ssid: "Test-AP", bssid: "AA:BB:CC:DD:EE:FF", channel: 36, frequency: 5180,
  standard: "802.11ac", security: "WPA2-PSK", txPower: 20, beaconInterval: 100,
  connectedStations: 1, x: 0, y: 0, ...opts,
});
const mkSta = (opts?: Partial<Station>): Station => ({
  name: "STA", mac: "11:22:33:44:55:66", x: 5, y: 0,
  supportedStandards: ["802.11ac"], ...opts,
});
const mkConfig = (opts?: Partial<SimConfig>): SimConfig => ({
  ap: mkAp(), station: mkSta(), dataPayload: "test", hiddenNode: false, lossRate: 0, ...opts,
});

describe("fspl (自由空間パスロス)", () => {
  it("距離 0 でロス 0", () => { expect(fspl(0, 5180)).toBe(0); });
  it("距離が増えるとロスが増える", () => { expect(fspl(20, 5180)).toBeGreaterThan(fspl(10, 5180)); });
  it("周波数が高いとロスが増える", () => { expect(fspl(10, 5180)).toBeGreaterThan(fspl(10, 2437)); });
});

describe("calcRssi", () => {
  it("近距離で高い RSSI", () => {
    const rssi = calcRssi(20, 1, 5180);
    expect(rssi).toBeGreaterThan(-30);
  });
  it("遠距離で低い RSSI", () => {
    const rssi = calcRssi(20, 100, 5180);
    expect(rssi).toBeLessThan(-60);
  });
});

describe("rssiToBar / rssiQuality", () => {
  it("-40 dBm → 4 bars, Excellent", () => {
    expect(rssiToBar(-40)).toBe(4);
    expect(rssiQuality(-40)).toBe("Excellent");
  });
  it("-65 dBm → 2 bars, Fair", () => {
    expect(rssiToBar(-65)).toBe(2);
    expect(rssiQuality(-65)).toBe("Fair");
  });
  it("-95 dBm → 0 bars, Unusable", () => {
    expect(rssiToBar(-95)).toBe(0);
    expect(rssiQuality(-95)).toBe("Unusable");
  });
});

describe("STANDARDS", () => {
  it("802.11ax (Wi-Fi 6) が定義されている", () => {
    expect(STANDARDS["802.11ax"]).toBeDefined();
    expect(STANDARDS["802.11ax"]!.generation).toBe("Wi-Fi 6");
  });
  it("6 規格が定義されている", () => {
    expect(Object.keys(STANDARDS)).toHaveLength(6);
  });
});

describe("simulate", () => {
  it("正常接続でマッチ結果が返る", () => {
    const result = simulate(mkConfig());
    expect(result.trace.length).toBeGreaterThan(0);
    expect(result.frames.length).toBeGreaterThan(0);
    expect(result.connectTicks).toBeGreaterThan(0);
  });

  it("ビーコン + プローブ + 認証 + アソシエーションのフェーズがある", () => {
    const result = simulate(mkConfig());
    const phases = result.trace.map((t) => t.phase);
    expect(phases).toContain("beacon");
    expect(phases).toContain("probe");
    expect(phases).toContain("auth");
    expect(phases).toContain("assoc");
  });

  it("WPA2-PSK で EAPOL 4-way handshake がある", () => {
    const result = simulate(mkConfig({ ap: mkAp({ security: "WPA2-PSK" }) }));
    const eapol = result.trace.filter((t) => t.phase === "eapol");
    expect(eapol.length).toBeGreaterThanOrEqual(4);
  });

  it("WPA3-SAE で SAE 認証がある", () => {
    const result = simulate(mkConfig({ ap: mkAp({ security: "WPA3-SAE" }) }));
    const auth = result.trace.filter((t) => t.phase === "auth");
    expect(auth.some((t) => t.detail.includes("SAE"))).toBe(true);
  });

  it("Open では EAPOL がない", () => {
    const result = simulate(mkConfig({ ap: mkAp({ security: "Open" }) }));
    expect(result.trace.filter((t) => t.phase === "eapol")).toHaveLength(0);
  });

  it("CSMA/CA + ACK がある", () => {
    const result = simulate(mkConfig());
    const phases = result.trace.map((t) => t.phase);
    expect(phases).toContain("csma_ca");
    expect(phases).toContain("ack");
  });

  it("隠れ端末モードで RTS/CTS がある", () => {
    const result = simulate(mkConfig({ hiddenNode: true }));
    expect(result.trace.some((t) => t.phase === "rts_cts")).toBe(true);
    expect(result.trace.some((t) => t.phase === "nav")).toBe(true);
  });

  it("圏外で接続失敗", () => {
    const result = simulate(mkConfig({ station: mkSta({ x: 5000 }) }));
    expect(result.trace.some((t) => t.phase === "error")).toBe(true);
    expect(result.frames).toHaveLength(0);
  });

  it("データフレームが暗号化される (WPA2)", () => {
    const result = simulate(mkConfig());
    const dataFrames = result.frames.filter((f) => f.type === "Data");
    expect(dataFrames.length).toBeGreaterThan(0);
    expect(dataFrames[0]!.encrypted).toBe(true);
  });
});

describe("EXAMPLES", () => {
  it("8 つのサンプル", () => { expect(EXAMPLES).toHaveLength(8); });
  it("名前が一意", () => { expect(new Set(EXAMPLES.map((e) => e.name)).size).toBe(EXAMPLES.length); });

  for (const ex of EXAMPLES) {
    it(`${ex.name}: 実行可能`, () => {
      const result = simulate(ex.config);
      expect(result.trace.length).toBeGreaterThan(0);
    });
  }
});
