import { describe, it, expect } from "vitest";
import {
  createNic, createRepeater, createHub, createBridge, createSwitch, createRouter,
  connect, makeFrame, makeIpPacket, makeArpRequest, mac,
  runSimulation, presets,
} from "../device/index.js";

// === NIC ===
describe("NIC", () => {
  it("自分宛フレームを受理する", () => {
    const nic1 = createNic("n1", "PC-A", "192.168.1.1");
    const nic2 = createNic("n2", "PC-B", "192.168.1.2");
    connect(nic1, 0, nic2, 0);
    const frame = makeFrame(mac(1, 0), mac(2, 0), makeIpPacket("192.168.1.1", "192.168.1.2", "Hello"));
    const result = runSimulation([nic1, nic2], [{ fromDevice: "n2", fromPort: 0, frame }]);
    expect(result.events.some((e) => e.type === "forward" && e.device === "PC-B")).toBe(true);
  });

  it("他宛フレームを破棄する", () => {
    const nic = createNic("n1", "PC-A", "192.168.1.1");
    const nic2 = createNic("n2", "PC-B", "192.168.1.2");
    connect(nic, 0, nic2, 0);
    const frame = makeFrame(mac(99, 0), "aa:bb:cc:dd:ee:ff", makeIpPacket("10.0.0.1", "10.0.0.2", "Wrong"));
    const result = runSimulation([nic], [{ fromDevice: "n1", fromPort: 0, frame }]);
    expect(result.events.some((e) => e.type === "drop")).toBe(true);
  });
});

// === リピータ ===
describe("リピータ", () => {
  it("信号を反対側に転送する", () => {
    const nic1 = createNic("n1", "A", "192.168.1.1");
    const rep = createRepeater("r10", "Rep");
    const nic2 = createNic("n2", "B", "192.168.1.2");
    connect(nic1, 0, rep, 0);
    connect(rep, 1, nic2, 0);
    const frame = makeFrame(mac(1, 0), mac(2, 0), makeIpPacket("192.168.1.1", "192.168.1.2", "Test"));
    const result = runSimulation([nic1, rep, nic2], [{ fromDevice: "r10", fromPort: 0, frame }]);
    expect(result.events.some((e) => e.type === "signal_repeat")).toBe(true);
    expect(result.events.some((e) => e.device === "B" && e.type === "receive")).toBe(true);
  });
});

// === ハブ ===
describe("ハブ", () => {
  it("全ポートにフラッディングする", () => {
    const hub = createHub("h20", "Hub", 3);
    const nics = [createNic("n1", "A", "1.1.1.1"), createNic("n2", "B", "1.1.1.2"), createNic("n3", "C", "1.1.1.3")];
    nics.forEach((n, i) => connect(n, 0, hub, i));
    const frame = makeFrame(mac(1, 0), mac(2, 0), makeIpPacket("1.1.1.1", "1.1.1.2", "T"));
    const result = runSimulation([hub, ...nics], [{ fromDevice: "h20", fromPort: 0, frame }]);
    expect(result.events.some((e) => e.type === "flood")).toBe(true);
    // B(n2)とC(n3)両方が受信する
    expect(result.events.filter((e) => e.type === "receive" && e.device !== "Hub").length).toBe(2);
  });
});

// === ブリッジ ===
describe("ブリッジ", () => {
  it("MACアドレスを学習する", () => {
    const br = createBridge("b30", "Bridge");
    const nic1 = createNic("n1", "A", "1.1.1.1");
    const nic2 = createNic("n2", "B", "1.1.1.2");
    connect(nic1, 0, br, 0);
    connect(nic2, 0, br, 1);
    const frame = makeFrame(mac(1, 0), mac(2, 0), makeIpPacket("1.1.1.1", "1.1.1.2", "T"));
    const result = runSimulation([nic1, br, nic2], [{ fromDevice: "b30", fromPort: 0, frame }]);
    expect(result.events.some((e) => e.type === "mac_learn")).toBe(true);
    const bridge = result.devices.find((d) => d.id === "b30");
    expect(bridge?.macTable?.some((e) => e.mac === mac(1, 0))).toBe(true);
  });

  it("学習済みMACへはユニキャスト転送する", () => {
    const br = createBridge("b30", "Bridge");
    const nic1 = createNic("n1", "A", "1.1.1.1");
    const nic2 = createNic("n2", "B", "1.1.1.2");
    connect(nic1, 0, br, 0);
    connect(nic2, 0, br, 1);
    const result = runSimulation([nic1, br, nic2], [
      { fromDevice: "b30", fromPort: 0, frame: makeFrame(mac(1, 0), mac(2, 0), makeIpPacket("1.1.1.1", "1.1.1.2", "1st")) },
      { fromDevice: "b30", fromPort: 1, frame: makeFrame(mac(2, 0), mac(1, 0), makeIpPacket("1.1.1.2", "1.1.1.1", "2nd")) },
      { fromDevice: "b30", fromPort: 0, frame: makeFrame(mac(1, 0), mac(2, 0), makeIpPacket("1.1.1.1", "1.1.1.2", "3rd")) },
    ]);
    // 3回目はMACテーブルヒットで転送
    expect(result.events.some((e) => e.type === "forward" && e.device === "Bridge")).toBe(true);
  });
});

// === スイッチ ===
describe("スイッチ", () => {
  it("MAC未学習時にフラッディングする", () => {
    const sw = createSwitch("s40", "Switch", 3);
    const nics = [createNic("n1", "A", "1.1.1.1"), createNic("n2", "B", "1.1.1.2"), createNic("n3", "C", "1.1.1.3")];
    nics.forEach((n, i) => connect(n, 0, sw, i));
    const frame = makeFrame(mac(1, 0), mac(3, 0), makeIpPacket("1.1.1.1", "1.1.1.3", "T"));
    const result = runSimulation([sw, ...nics], [{ fromDevice: "s40", fromPort: 0, frame }]);
    expect(result.events.some((e) => e.type === "flood" && e.device === "Switch")).toBe(true);
  });

  it("ブロードキャストを全ポートに転送する", () => {
    const sw = createSwitch("s40", "Switch", 3);
    const nics = [createNic("n1", "A", "1.1.1.1"), createNic("n2", "B", "1.1.1.2"), createNic("n3", "C", "1.1.1.3")];
    nics.forEach((n, i) => connect(n, 0, sw, i));
    const frame = makeFrame(mac(1, 0), "ff:ff:ff:ff:ff:ff", makeArpRequest(mac(1, 0), "1.1.1.1", "1.1.1.3"));
    const result = runSimulation([sw, ...nics], [{ fromDevice: "s40", fromPort: 0, frame }]);
    expect(result.events.some((e) => e.type === "broadcast")).toBe(true);
  });
});

// === ルーター ===
describe("ルーター", () => {
  it("サブネット間でパケットを転送する", () => {
    const nic1 = createNic("n1", "A", "192.168.1.10");
    const router = createRouter("r50", "Router", 2, { 0: "192.168.1.1", 1: "10.0.0.1" });
    router.routeTable = [
      { network: "192.168.1.0", mask: "255.255.255.0", gateway: "0.0.0.0", iface: 0, metric: 0 },
      { network: "10.0.0.0", mask: "255.255.255.0", gateway: "0.0.0.0", iface: 1, metric: 0 },
    ];
    router.arpTable = [{ ip: "10.0.0.10", mac: mac(2, 0) }];
    const nic2 = createNic("n2", "B", "10.0.0.10");
    connect(nic1, 0, router, 0);
    connect(router, 1, nic2, 0);
    const frame = makeFrame(mac(1, 0), mac(50, 0), makeIpPacket("192.168.1.10", "10.0.0.10", "Cross"));
    const result = runSimulation([nic1, router, nic2], [{ fromDevice: "r50", fromPort: 0, frame }]);
    expect(result.events.some((e) => e.type === "route_lookup")).toBe(true);
    expect(result.events.some((e) => e.type === "encapsulate")).toBe(true);
  });

  it("TTLを減算する", () => {
    const router = createRouter("r50", "R", 2, { 0: "1.1.1.1", 1: "2.2.2.1" });
    router.routeTable = [{ network: "2.2.2.0", mask: "255.255.255.0", gateway: "0.0.0.0", iface: 1, metric: 0 }];
    router.arpTable = [{ ip: "2.2.2.2", mac: "aa:bb:cc:dd:ee:ff" }];
    const nic = createNic("n1", "A", "2.2.2.2");
    connect(router, 1, nic, 0);
    const frame = makeFrame("11:22:33:44:55:66", mac(50, 0), makeIpPacket("1.1.1.2", "2.2.2.2", "T", 64));
    const result = runSimulation([router, nic], [{ fromDevice: "r50", fromPort: 0, frame }]);
    expect(result.events.some((e) => e.type === "ttl_decrement")).toBe(true);
  });

  it("TTL=1のパケットを破棄する", () => {
    const router = createRouter("r50", "R", 2, { 0: "1.1.1.1", 1: "2.2.2.1" });
    router.routeTable = [{ network: "2.2.2.0", mask: "255.255.255.0", gateway: "0.0.0.0", iface: 1, metric: 0 }];
    const frame = makeFrame("11:22:33:44:55:66", mac(50, 0), makeIpPacket("1.1.1.2", "2.2.2.2", "T", 1));
    const result = runSimulation([router], [{ fromDevice: "r50", fromPort: 0, frame }]);
    expect(result.events.some((e) => e.description.includes("TTL=0"))).toBe(true);
  });

  it("ルート不明時にパケットを破棄する", () => {
    const router = createRouter("r50", "R", 2, { 0: "1.1.1.1", 1: "2.2.2.1" });
    router.routeTable = [];
    const frame = makeFrame("11:22:33:44:55:66", mac(50, 0), makeIpPacket("1.1.1.2", "99.99.99.99", "T"));
    const result = runSimulation([router], [{ fromDevice: "r50", fromPort: 0, frame }]);
    expect(result.events.some((e) => e.type === "drop")).toBe(true);
  });
});

// === プリセット ===
describe("プリセット", () => {
  it("全プリセットがエラーなく実行できる", () => {
    for (const preset of presets) {
      const result = runSimulation(preset.devices, preset.frames);
      expect(result.events.length, `${preset.name}: イベントが空`).toBeGreaterThan(0);
    }
  });

  it("10個のプリセットが定義されている", () => {
    expect(presets.length).toBe(10);
  });
});
