import { describe, it, expect } from "vitest";
import {
  rssiFromDistance, randomBdAddr, determinePairingMethod, expandUuid, uuidName,
  BluetoothSimulator, createDevice, svc, char, KNOWN_UUIDS,
} from "../engine/bluetooth.js";
import { EXPERIMENTS } from "../ui/app.js";
import type { SimConfig, BleDevice } from "../engine/bluetooth.js";

// ── ユーティリティ ──

describe("rssiFromDistance", () => {
  it("距離 0 で txPower を返す", () => {
    expect(rssiFromDistance(-4, 0)).toBe(-4);
  });

  it("距離が増えると RSSI が下がる", () => {
    const r1 = rssiFromDistance(-4, 1);
    const r10 = rssiFromDistance(-4, 10);
    expect(r10).toBeLessThan(r1);
  });

  it("1m で txPower と同じ", () => {
    expect(rssiFromDistance(-4, 1)).toBe(-4);
  });
});

describe("randomBdAddr", () => {
  it("正しい形式の BD_ADDR を生成する", () => {
    const addr = randomBdAddr();
    expect(addr).toMatch(/^[0-9A-F]{2}(:[0-9A-F]{2}){5}$/);
  });

  it("毎回異なるアドレスを生成する", () => {
    const a = randomBdAddr();
    const b = randomBdAddr();
    expect(a).not.toBe(b);
  });
});

describe("determinePairingMethod", () => {
  it("no-io 同士は just-works", () => {
    expect(determinePairingMethod("no-io", "no-io")).toBe("just-works");
  });

  it("keyboard-display + display-yesno は numeric-comparison", () => {
    expect(determinePairingMethod("keyboard-display", "display-yesno")).toBe("numeric-comparison");
  });

  it("display-yesno 同士は numeric-comparison", () => {
    expect(determinePairingMethod("display-yesno", "display-yesno")).toBe("numeric-comparison");
  });

  it("keyboard-only を含む場合は passkey", () => {
    expect(determinePairingMethod("keyboard-only", "display-only")).toBe("passkey");
  });

  it("no-io + 何かは always just-works", () => {
    expect(determinePairingMethod("no-io", "keyboard-display")).toBe("just-works");
    expect(determinePairingMethod("display-yesno", "no-io")).toBe("just-works");
  });
});

describe("expandUuid", () => {
  it("16-bit UUID を 128-bit に展開する", () => {
    expect(expandUuid("180d")).toBe("0000180d-0000-1000-8000-00805f9b34fb");
  });

  it("128-bit UUID はそのまま返す", () => {
    const full = "0000180d-0000-1000-8000-00805f9b34fb";
    expect(expandUuid(full)).toBe(full);
  });
});

describe("uuidName", () => {
  it("既知の UUID に名前を返す", () => {
    expect(uuidName("180d")).toBe("Heart Rate");
    expect(uuidName("2a19")).toBe("Battery Level");
  });

  it("不明な UUID はそのまま返す", () => {
    expect(uuidName("ffff")).toBe("ffff");
  });
});

describe("KNOWN_UUIDS", () => {
  it("主要な UUID が定義されている", () => {
    expect(Object.keys(KNOWN_UUIDS).length).toBeGreaterThan(15);
    expect(KNOWN_UUIDS["180d"]).toBe("Heart Rate");
    expect(KNOWN_UUIDS["2902"]).toBe("CCCD");
  });
});

// ── ヘルパー ──

describe("char", () => {
  it("Characteristic を作成する", () => {
    const c = char("2a37", "HR", ["notify"], "10 48", "72 bpm");
    expect(c.uuid).toBe("2a37");
    expect(c.permissions).toContain("notify");
    expect(c.descriptors.length).toBe(1);
    expect(c.descriptors[0]!.uuid).toBe("2902");
  });

  it("通知なしの場合 CCCD を含まない", () => {
    const c = char("2a00", "Name", ["read"], "48", "H");
    expect(c.descriptors.length).toBe(0);
  });
});

describe("svc", () => {
  it("Service を作成する", () => {
    const s = svc("180d", "Heart Rate", [char("2a37", "HR", ["notify"], "00", "0")]);
    expect(s.uuid).toBe("180d");
    expect(s.primary).toBe(true);
    expect(s.characteristics).toHaveLength(1);
  });
});

describe("createDevice", () => {
  it("デフォルトデバイスを作成する", () => {
    const d = createDevice("Test", "AA:BB:CC:DD:EE:FF", []);
    expect(d.name).toBe("Test");
    expect(d.version).toBe("5.0");
    expect(d.connectable).toBe(true);
    expect(d.mtu).toBe(247);
  });

  it("カスタムオプションが反映される", () => {
    const d = createDevice("Test", "AA:BB:CC:DD:EE:FF", [], { version: "5.3", distance: 10, mtu: 512 });
    expect(d.version).toBe("5.3");
    expect(d.distance).toBe(10);
    expect(d.mtu).toBe(512);
  });
});

// ── シミュレーター ──

describe("BluetoothSimulator", () => {
  const peripheral = createDevice("TestDev", "AA:BB:CC:00:11:22", [
    svc("180f", "Battery", [char("2a19", "Battery Level", ["read", "notify"], "5a", "90%")]),
    svc("180a", "Device Info", [char("2a29", "Manufacturer", ["read"], "54657374", "Test")]),
  ]);
  const central = createDevice("Phone", "11:22:33:44:55:66", [], { ioCap: "keyboard-display", mtu: 517 });

  const baseConfig: SimConfig = {
    central, peripheral, phy: "1M",
    pairing: false, pairingMethod: "just-works",
    readCharacteristics: ["2a19", "2a29"],
    writeCharacteristics: [],
    enableNotifications: ["2a19"],
    notificationValues: [{ uuid: "2a19", value: "59", displayValue: "89%" }],
    noiseFloor: -90, latencyMs: 8,
  };

  it("基本フローが完了する", () => {
    const sim = new BluetoothSimulator();
    const result = sim.simulate(baseConfig);
    expect(result.events.length).toBeGreaterThan(10);
    expect(result.discoveredServices).toHaveLength(2);
    expect(result.readValues).toHaveLength(2);
    expect(result.notifications).toHaveLength(1);
    expect(result.totalTime).toBeGreaterThan(0);
  });

  it("GATT サービスを検出する", () => {
    const sim = new BluetoothSimulator();
    const result = sim.simulate(baseConfig);
    expect(result.discoveredServices.some((s) => s.uuid === "180f")).toBe(true);
    expect(result.discoveredServices.some((s) => s.uuid === "180a")).toBe(true);
  });

  it("Characteristic を読み取る", () => {
    const sim = new BluetoothSimulator();
    const result = sim.simulate(baseConfig);
    const battery = result.readValues.find((v) => v.uuid === "2a19");
    expect(battery).toBeDefined();
    expect(battery!.displayValue).toBe("90%");
  });

  it("通知を受信する", () => {
    const sim = new BluetoothSimulator();
    const result = sim.simulate(baseConfig);
    expect(result.notifications).toHaveLength(1);
    expect(result.notifications[0]!.displayValue).toBe("89%");
  });

  it("ペアリングなしの場合 finalState は disconnected", () => {
    const sim = new BluetoothSimulator();
    const result = sim.simulate(baseConfig);
    expect(result.finalState).toBe("disconnected");
  });

  it("ペアリングありの場合 finalState は bonded", () => {
    const sim = new BluetoothSimulator();
    const result = sim.simulate({ ...baseConfig, pairing: true, pairingMethod: "just-works" });
    expect(result.finalState).toBe("bonded");
    expect(result.events.some((e) => e.layer === "SMP")).toBe(true);
  });

  it("Passkey ペアリングのイベントが含まれる", () => {
    const sim = new BluetoothSimulator();
    const result = sim.simulate({ ...baseConfig, pairing: true, pairingMethod: "passkey" });
    expect(result.events.some((e) => e.detail.includes("Passkey"))).toBe(true);
  });

  it("Numeric Comparison ペアリングのイベントが含まれる", () => {
    const sim = new BluetoothSimulator();
    const result = sim.simulate({ ...baseConfig, pairing: true, pairingMethod: "numeric-comparison" });
    expect(result.events.some((e) => e.detail.includes("Numeric Comparison"))).toBe(true);
  });

  it("2M PHY の場合 PHY Update イベントが含まれる", () => {
    const sim = new BluetoothSimulator();
    const result = sim.simulate({ ...baseConfig, phy: "2M" });
    expect(result.events.some((e) => e.detail.includes("PHY Update"))).toBe(true);
    expect(result.connectionParams!.phy).toBe("2M");
  });

  it("MTU ネゴシエーションが行われる", () => {
    const sim = new BluetoothSimulator();
    const result = sim.simulate(baseConfig);
    expect(result.connectionParams!.mtu).toBe(Math.min(central.mtu, peripheral.mtu));
  });

  it("書き込みが動作する", () => {
    const writableDev = createDevice("W", "00:00:00:00:00:01", [
      svc("fee0", "Custom", [char("fee1", "Cmd", ["write"], "00", "")]),
    ]);
    const sim = new BluetoothSimulator();
    const result = sim.simulate({
      ...baseConfig,
      peripheral: writableDev,
      readCharacteristics: [],
      enableNotifications: [],
      notificationValues: [],
      writeCharacteristics: [{ uuid: "fee1", value: "01", displayValue: "ON" }],
    });
    expect(result.events.some((e) => e.type === "gatt_write")).toBe(true);
  });
});

// ── プリセット実験 ──

describe("EXPERIMENTS", () => {
  it("7 つのプリセット", () => {
    expect(EXPERIMENTS).toHaveLength(7);
  });

  it("名前が一意", () => {
    expect(new Set(EXPERIMENTS.map((e) => e.name)).size).toBe(EXPERIMENTS.length);
  });

  for (const exp of EXPERIMENTS) {
    it(`${exp.name}: シミュレーション可能`, () => {
      const config: SimConfig = {
        ...exp.config,
        peripheral: JSON.parse(JSON.stringify(exp.config.peripheral)),
      };
      const sim = new BluetoothSimulator();
      const result = sim.simulate(config);
      expect(result.events.length).toBeGreaterThan(5);
      expect(result.totalTime).toBeGreaterThan(0);
    });
  }
});
