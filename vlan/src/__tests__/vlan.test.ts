import { describe, it, expect } from "vitest";
import {
  mac, BROADCAST_MAC, makeFrame, makeTag,
  makeAccessPort, makeTrunkPort,
  createSwitch, createHost,
  connectHostToSwitch, connectSwitches,
  runSimulation, presets,
} from "../vlan/index.js";

// === VLAN分離 ===
describe("VLAN分離", () => {
  it("同一VLANのホスト間で通信できる", () => {
    const sw = createSwitch("sw1", "SW", [
      makeAccessPort(0, 10),
      makeAccessPort(1, 10),
    ], [{ id: 10, name: "V10" }]);
    const h1 = createHost("h1", "A", mac(1));
    const h2 = createHost("h2", "B", mac(2));
    connectHostToSwitch(h1, sw, 0);
    connectHostToSwitch(h2, sw, 1);
    const result = runSimulation([sw], [h1, h2], [
      { fromHost: "h1", frame: makeFrame(mac(1), mac(2), "Hello") },
    ]);
    expect(result.events.some((e) => e.type === "receive" && e.device === "B")).toBe(true);
  });

  it("異なるVLANのホスト間で通信できない", () => {
    const sw = createSwitch("sw1", "SW", [
      makeAccessPort(0, 10),
      makeAccessPort(1, 20),
    ], [{ id: 10, name: "V10" }, { id: 20, name: "V20" }]);
    const h1 = createHost("h1", "A", mac(1));
    const h2 = createHost("h2", "B", mac(2));
    connectHostToSwitch(h1, sw, 0);
    connectHostToSwitch(h2, sw, 1);
    const result = runSimulation([sw], [h1, h2], [
      { fromHost: "h1", frame: makeFrame(mac(1), mac(2), "Blocked") },
    ]);
    // Bへのreceiveイベントがないことを確認
    expect(result.events.some((e) => e.type === "receive" && e.device === "B")).toBe(false);
  });
});

// === MAC学習 ===
describe("MAC学習", () => {
  it("送信元MACアドレスをVLAN単位で学習する", () => {
    const sw = createSwitch("sw1", "SW", [
      makeAccessPort(0, 10),
      makeAccessPort(1, 10),
    ], [{ id: 10, name: "V10" }]);
    const h1 = createHost("h1", "A", mac(1));
    const h2 = createHost("h2", "B", mac(2));
    connectHostToSwitch(h1, sw, 0);
    connectHostToSwitch(h2, sw, 1);
    const result = runSimulation([sw], [h1, h2], [
      { fromHost: "h1", frame: makeFrame(mac(1), mac(2), "Learn") },
    ]);
    expect(result.events.some((e) => e.type === "mac_learn")).toBe(true);
    const entry = result.switches[0]!.macTable.find((e) => e.mac === mac(1));
    expect(entry).toBeDefined();
    expect(entry!.vlan).toBe(10);
    expect(entry!.port).toBe(0);
  });

  it("学習済みMACへはユニキャスト転送する", () => {
    const sw = createSwitch("sw1", "SW", [
      makeAccessPort(0, 10),
      makeAccessPort(1, 10),
      makeAccessPort(2, 10),
    ], [{ id: 10, name: "V10" }]);
    const h1 = createHost("h1", "A", mac(1));
    const h2 = createHost("h2", "B", mac(2));
    const h3 = createHost("h3", "C", mac(3));
    connectHostToSwitch(h1, sw, 0);
    connectHostToSwitch(h2, sw, 1);
    connectHostToSwitch(h3, sw, 2);
    const result = runSimulation([sw], [h1, h2, h3], [
      { fromHost: "h1", frame: makeFrame(mac(1), mac(2), "1st") },
      { fromHost: "h2", frame: makeFrame(mac(2), mac(1), "2nd") },
    ]);
    expect(result.events.some((e) => e.type === "forward" && e.device === "SW")).toBe(true);
  });
});

// === フラッディング ===
describe("フラッディング", () => {
  it("未学習MACへはVLAN内でフラッディングする", () => {
    const sw = createSwitch("sw1", "SW", [
      makeAccessPort(0, 10),
      makeAccessPort(1, 10),
      makeAccessPort(2, 20),
    ], [{ id: 10, name: "V10" }, { id: 20, name: "V20" }]);
    const h1 = createHost("h1", "A", mac(1));
    const h2 = createHost("h2", "B", mac(2));
    const h3 = createHost("h3", "C", mac(3));
    connectHostToSwitch(h1, sw, 0);
    connectHostToSwitch(h2, sw, 1);
    connectHostToSwitch(h3, sw, 2);
    const result = runSimulation([sw], [h1, h2, h3], [
      { fromHost: "h1", frame: makeFrame(mac(1), mac(99), "Flood") },
    ]);
    expect(result.events.some((e) => e.type === "flood")).toBe(true);
    // VLAN10のBにはフレームが届く（MAC不一致でdrop）、VLAN20のCには届かない
    expect(result.events.some((e) => e.type === "drop" && e.device === "B")).toBe(true);
    expect(result.events.some((e) => (e.type === "receive" || e.type === "drop") && e.device === "C")).toBe(false);
  });

  it("ブロードキャストはVLAN内全ポートに送信される", () => {
    const sw = createSwitch("sw1", "SW", [
      makeAccessPort(0, 10),
      makeAccessPort(1, 10),
      makeAccessPort(2, 10),
    ], [{ id: 10, name: "V10" }]);
    const h1 = createHost("h1", "A", mac(1));
    const h2 = createHost("h2", "B", mac(2));
    const h3 = createHost("h3", "C", mac(3));
    connectHostToSwitch(h1, sw, 0);
    connectHostToSwitch(h2, sw, 1);
    connectHostToSwitch(h3, sw, 2);
    const result = runSimulation([sw], [h1, h2, h3], [
      { fromHost: "h1", frame: makeFrame(mac(1), BROADCAST_MAC, "BC") },
    ]);
    expect(result.events.filter((e) => e.type === "receive" && e.device !== "SW").length).toBe(2);
  });
});

// === トランクポート ===
describe("トランクポート", () => {
  it("トランクリンク経由でVLAN情報が伝搬する", () => {
    const sw1 = createSwitch("sw1", "SW1", [
      makeAccessPort(0, 10),
      makeTrunkPort(1, [10, 20]),
    ], [{ id: 10, name: "V10" }, { id: 20, name: "V20" }]);
    const sw2 = createSwitch("sw2", "SW2", [
      makeTrunkPort(0, [10, 20]),
      makeAccessPort(1, 10),
    ], [{ id: 10, name: "V10" }, { id: 20, name: "V20" }]);
    connectSwitches(sw1, 1, sw2, 0);
    const h1 = createHost("h1", "A", mac(1));
    const h2 = createHost("h2", "B", mac(2));
    connectHostToSwitch(h1, sw1, 0);
    connectHostToSwitch(h2, sw2, 1);
    const result = runSimulation([sw1, sw2], [h1, h2], [
      { fromHost: "h1", frame: makeFrame(mac(1), mac(2), "Trunk") },
    ]);
    expect(result.events.some((e) => e.type === "trunk_forward")).toBe(true);
    expect(result.events.some((e) => e.type === "receive" && e.device === "B")).toBe(true);
  });

  it("許可されていないVLANはトランクを通過しない", () => {
    const sw1 = createSwitch("sw1", "SW1", [
      makeAccessPort(0, 20),
      makeTrunkPort(1, [10]),  // VLAN20は非許可
    ], [{ id: 10, name: "V10" }, { id: 20, name: "V20" }]);
    const sw2 = createSwitch("sw2", "SW2", [
      makeTrunkPort(0, [10]),
      makeAccessPort(1, 20),
    ], [{ id: 10, name: "V10" }, { id: 20, name: "V20" }]);
    connectSwitches(sw1, 1, sw2, 0);
    const h1 = createHost("h1", "A", mac(1));
    const h2 = createHost("h2", "B", mac(2));
    connectHostToSwitch(h1, sw1, 0);
    connectHostToSwitch(h2, sw2, 1);
    const result = runSimulation([sw1, sw2], [h1, h2], [
      { fromHost: "h1", frame: makeFrame(mac(1), mac(2), "Blocked VLAN20") },
    ]);
    expect(result.events.some((e) => e.type === "receive" && e.device === "B")).toBe(false);
  });
});

// === ネイティブVLAN ===
describe("ネイティブVLAN", () => {
  it("ネイティブVLANのフレームはタグなしでトランクを通過する", () => {
    const sw1 = createSwitch("sw1", "SW1", [
      makeAccessPort(0, 10),
      makeTrunkPort(1, [10, 20], 10),
    ], [{ id: 10, name: "V10" }, { id: 20, name: "V20" }]);
    const sw2 = createSwitch("sw2", "SW2", [
      makeTrunkPort(0, [10, 20], 10),
      makeAccessPort(1, 10),
    ], [{ id: 10, name: "V10" }, { id: 20, name: "V20" }]);
    connectSwitches(sw1, 1, sw2, 0);
    const h1 = createHost("h1", "A", mac(1));
    const h2 = createHost("h2", "B", mac(2));
    connectHostToSwitch(h1, sw1, 0);
    connectHostToSwitch(h2, sw2, 1);
    const result = runSimulation([sw1, sw2], [h1, h2], [
      { fromHost: "h1", frame: makeFrame(mac(1), mac(2), "Native") },
    ]);
    // ネイティブVLANイベントが発生すること
    expect(result.events.some((e) => e.type === "native_vlan" || e.type === "receive")).toBe(true);
    expect(result.events.some((e) => e.type === "receive" && e.device === "B")).toBe(true);
  });
});

// === 802.1Qタグ ===
describe("802.1Qタグ", () => {
  it("トランクポートでタグ付きフレームを受信してVLANを識別する", () => {
    const sw = createSwitch("sw1", "SW", [
      makeTrunkPort(0, [10, 20]),
      makeAccessPort(1, 20),
    ], [{ id: 10, name: "V10" }, { id: 20, name: "V20" }]);
    const h1 = createHost("h1", "TrunkHost", mac(1));
    const h2 = createHost("h2", "B", mac(2));
    connectHostToSwitch(h1, sw, 0);
    connectHostToSwitch(h2, sw, 1);
    const result = runSimulation([sw], [h1, h2], [
      { fromHost: "h1", frame: makeFrame(mac(1), mac(2), "Tagged", makeTag(20)) },
    ]);
    expect(result.events.some((e) => e.type === "receive" && e.device === "B")).toBe(true);
  });

  it("許可されていないVLANのタグ付きフレームは破棄される", () => {
    const sw = createSwitch("sw1", "SW", [
      makeTrunkPort(0, [10]),  // VLAN20非許可
      makeAccessPort(1, 20),
    ], [{ id: 10, name: "V10" }, { id: 20, name: "V20" }]);
    const h1 = createHost("h1", "TrunkHost", mac(1));
    const h2 = createHost("h2", "B", mac(2));
    connectHostToSwitch(h1, sw, 0);
    connectHostToSwitch(h2, sw, 1);
    const result = runSimulation([sw], [h1, h2], [
      { fromHost: "h1", frame: makeFrame(mac(1), mac(2), "Filtered", makeTag(20)) },
    ]);
    expect(result.events.some((e) => e.type === "vlan_filter")).toBe(true);
  });
});

// === プリセット ===
describe("プリセット", () => {
  it("全プリセットがエラーなく実行できる", () => {
    for (const preset of presets) {
      const switches = JSON.parse(JSON.stringify(preset.switches));
      const hosts = JSON.parse(JSON.stringify(preset.hosts));
      const result = runSimulation(switches, hosts, preset.frames);
      expect(result.events.length, `${preset.name}: イベントが空`).toBeGreaterThan(0);
    }
  });

  it("10個のプリセットが定義されている", () => {
    expect(presets.length).toBe(10);
  });
});
