import type { NetworkDevice, EthernetFrame } from "./types.js";
import {
  createNic, createRepeater, createHub, createBridge, createSwitch, createRouter,
  connect, makeFrame, makeIpPacket, makeArpRequest, mac,
} from "./engine.js";

export interface Preset {
  name: string;
  description: string;
  devices: NetworkDevice[];
  frames: Array<{ fromDevice: string; fromPort: number; frame: EthernetFrame }>;
}

function buildPreset(
  name: string,
  description: string,
  setup: () => { devices: NetworkDevice[]; frames: Array<{ fromDevice: string; fromPort: number; frame: EthernetFrame }> }
): Preset {
  const { devices, frames } = setup();
  return { name, description, devices, frames };
}

export const presets: Preset[] = [
  // 1. NIC基本
  buildPreset("NIC: フレーム送受信", "NICが自分宛フレームを受理し、他宛を破棄する動作", () => {
    const nic1 = createNic("n1", "PC-A", "192.168.1.1");
    const nic2 = createNic("n2", "PC-B", "192.168.1.2");
    connect(nic1, 0, nic2, 0);
    return {
      devices: [nic1, nic2],
      frames: [
        { fromDevice: "n2", fromPort: 0, frame: makeFrame(mac(2, 0), mac(1, 0), makeIpPacket("192.168.1.2", "192.168.1.1", "Hello")) },
        { fromDevice: "n2", fromPort: 0, frame: makeFrame(mac(2, 0), "aa:bb:cc:dd:ee:ff", makeIpPacket("192.168.1.2", "192.168.1.99", "Wrong")) },
      ],
    };
  }),

  // 2. リピータ
  buildPreset("リピータ: 信号増幅", "L1リピータが電気信号をそのまま増幅して反対側に転送", () => {
    const nic1 = createNic("n1", "PC-A", "192.168.1.1");
    const rep = createRepeater("r10", "Repeater");
    const nic2 = createNic("n2", "PC-B", "192.168.1.2");
    connect(nic1, 0, rep, 0);
    connect(rep, 1, nic2, 0);
    return {
      devices: [nic1, rep, nic2],
      frames: [
        { fromDevice: "r10", fromPort: 0, frame: makeFrame(mac(1, 0), mac(2, 0), makeIpPacket("192.168.1.1", "192.168.1.2", "Ping")) },
      ],
    };
  }),

  // 3. ハブ フラッディング
  buildPreset("ハブ: フラッディング", "L1ハブが全ポートにフレームをフラッディング。コリジョンドメインが1つ", () => {
    const hub = createHub("h20", "Hub-4port", 4);
    const nics = [
      createNic("n1", "PC-A", "192.168.1.1"),
      createNic("n2", "PC-B", "192.168.1.2"),
      createNic("n3", "PC-C", "192.168.1.3"),
      createNic("n4", "PC-D", "192.168.1.4"),
    ];
    nics.forEach((n, i) => connect(n, 0, hub, i));
    return {
      devices: [hub, ...nics],
      frames: [
        { fromDevice: "h20", fromPort: 0, frame: makeFrame(mac(1, 0), mac(3, 0), makeIpPacket("192.168.1.1", "192.168.1.3", "To PC-C")) },
      ],
    };
  }),

  // 4. ブリッジ MAC学習
  buildPreset("ブリッジ: MAC学習とフィルタリング", "L2ブリッジがMACアドレスを学習し、セグメント分離とフィルタリングを実行", () => {
    const br = createBridge("b30", "Bridge");
    const nic1 = createNic("n1", "PC-A", "192.168.1.1");
    const nic2 = createNic("n2", "PC-B", "192.168.1.2");
    connect(nic1, 0, br, 0);
    connect(nic2, 0, br, 1);
    return {
      devices: [nic1, br, nic2],
      frames: [
        // 1回目: MAC未学習→フラッディング
        { fromDevice: "b30", fromPort: 0, frame: makeFrame(mac(1, 0), mac(2, 0), makeIpPacket("192.168.1.1", "192.168.1.2", "First")) },
        // 2回目: PC-Bからの応答→MAC学習
        { fromDevice: "b30", fromPort: 1, frame: makeFrame(mac(2, 0), mac(1, 0), makeIpPacket("192.168.1.2", "192.168.1.1", "Reply")) },
        // 3回目: 学習済み→ユニキャスト転送
        { fromDevice: "b30", fromPort: 0, frame: makeFrame(mac(1, 0), mac(2, 0), makeIpPacket("192.168.1.1", "192.168.1.2", "Learned")) },
      ],
    };
  }),

  // 5. スイッチ基本
  buildPreset("スイッチ: ユニキャスト転送", "L2スイッチのMAC学習→ユニキャスト転送の流れ。フラッディングからの最適化", () => {
    const sw = createSwitch("s40", "Switch-4port", 4);
    const nics = [
      createNic("n1", "PC-A", "192.168.1.1"),
      createNic("n2", "PC-B", "192.168.1.2"),
      createNic("n3", "PC-C", "192.168.1.3"),
      createNic("n4", "PC-D", "192.168.1.4"),
    ];
    nics.forEach((n, i) => connect(n, 0, sw, i));
    return {
      devices: [sw, ...nics],
      frames: [
        // 1回目: MAC未学習→フラッディング
        { fromDevice: "s40", fromPort: 0, frame: makeFrame(mac(1, 0), mac(3, 0), makeIpPacket("192.168.1.1", "192.168.1.3", "Flood")) },
        // PC-Cからの応答→学習
        { fromDevice: "s40", fromPort: 2, frame: makeFrame(mac(3, 0), mac(1, 0), makeIpPacket("192.168.1.3", "192.168.1.1", "Reply")) },
        // 2回目: 学習済み→ユニキャスト
        { fromDevice: "s40", fromPort: 0, frame: makeFrame(mac(1, 0), mac(3, 0), makeIpPacket("192.168.1.1", "192.168.1.3", "Unicast")) },
      ],
    };
  }),

  // 6. スイッチ ブロードキャスト
  buildPreset("スイッチ: ブロードキャスト", "ブロードキャストフレームは全ポートにフラッディングされる", () => {
    const sw = createSwitch("s40", "Switch-3port", 3);
    const nics = [
      createNic("n1", "PC-A", "192.168.1.1"),
      createNic("n2", "PC-B", "192.168.1.2"),
      createNic("n3", "PC-C", "192.168.1.3"),
    ];
    nics.forEach((n, i) => connect(n, 0, sw, i));
    return {
      devices: [sw, ...nics],
      frames: [
        { fromDevice: "s40", fromPort: 0, frame: makeFrame(mac(1, 0), "ff:ff:ff:ff:ff:ff", makeArpRequest(mac(1, 0), "192.168.1.1", "192.168.1.3")) },
      ],
    };
  }),

  // 7. ルーター基本
  buildPreset("ルーター: サブネット間転送", "L3ルーターがIPパケットをデカプセル化→ルーティング→再カプセル化して異なるサブネットへ転送", () => {
    const nic1 = createNic("n1", "PC-A", "192.168.1.10");
    const router = createRouter("r50", "Router", 2, { 0: "192.168.1.1", 1: "10.0.0.1" });
    router.routeTable = [
      { network: "192.168.1.0", mask: "255.255.255.0", gateway: "0.0.0.0", iface: 0, metric: 0 },
      { network: "10.0.0.0", mask: "255.255.255.0", gateway: "0.0.0.0", iface: 1, metric: 0 },
    ];
    router.arpTable = [
      { ip: "192.168.1.10", mac: mac(1, 0) },
      { ip: "10.0.0.10", mac: mac(2, 0) },
    ];
    const nic2 = createNic("n2", "PC-B", "10.0.0.10");
    connect(nic1, 0, router, 0);
    connect(router, 1, nic2, 0);
    return {
      devices: [nic1, router, nic2],
      frames: [
        { fromDevice: "r50", fromPort: 0, frame: makeFrame(mac(1, 0), mac(50, 0), makeIpPacket("192.168.1.10", "10.0.0.10", "Cross-subnet")) },
      ],
    };
  }),

  // 8. ルーター ARP解決
  buildPreset("ルーター: ARP解決", "ルーターが次ホップのMACアドレスをARPで解決する過程", () => {
    const nic1 = createNic("n1", "PC-A", "192.168.1.10");
    const router = createRouter("r50", "Router", 2, { 0: "192.168.1.1", 1: "10.0.0.1" });
    router.routeTable = [
      { network: "192.168.1.0", mask: "255.255.255.0", gateway: "0.0.0.0", iface: 0, metric: 0 },
      { network: "10.0.0.0", mask: "255.255.255.0", gateway: "0.0.0.0", iface: 1, metric: 0 },
    ];
    router.arpTable = [{ ip: "192.168.1.10", mac: mac(1, 0) }]; // PC-Bは未学習
    const nic2 = createNic("n2", "PC-B", "10.0.0.10");
    connect(nic1, 0, router, 0);
    connect(router, 1, nic2, 0);
    return {
      devices: [nic1, router, nic2],
      frames: [
        { fromDevice: "r50", fromPort: 0, frame: makeFrame(mac(1, 0), mac(50, 0), makeIpPacket("192.168.1.10", "10.0.0.10", "Need ARP")) },
      ],
    };
  }),

  // 9. ハブvsスイッチ比較
  buildPreset("比較: ハブ vs スイッチ（ハブ側）", "同じフレームをハブで転送。全ポートにフラッディングされる（スイッチと比較用）", () => {
    const hub = createHub("h20", "Hub", 3);
    const nics = [
      createNic("n1", "PC-A", "192.168.1.1"),
      createNic("n2", "PC-B", "192.168.1.2"),
      createNic("n3", "PC-C", "192.168.1.3"),
    ];
    nics.forEach((n, i) => connect(n, 0, hub, i));
    return {
      devices: [hub, ...nics],
      frames: [
        { fromDevice: "h20", fromPort: 0, frame: makeFrame(mac(1, 0), mac(2, 0), makeIpPacket("192.168.1.1", "192.168.1.2", "Via Hub")) },
        { fromDevice: "h20", fromPort: 1, frame: makeFrame(mac(2, 0), mac(1, 0), makeIpPacket("192.168.1.2", "192.168.1.1", "Reply via Hub")) },
      ],
    };
  }),

  // 10. 複合構成
  buildPreset("複合: ハブ+スイッチ+ルーター", "L1ハブ→L2スイッチ→L3ルーターの階層的ネットワーク構成", () => {
    const hub = createHub("h20", "Hub", 3);
    const sw = createSwitch("s40", "Switch", 3);
    const router = createRouter("r50", "Router", 2, { 0: "192.168.1.1", 1: "10.0.0.1" });
    router.routeTable = [
      { network: "192.168.1.0", mask: "255.255.255.0", gateway: "0.0.0.0", iface: 0, metric: 0 },
      { network: "10.0.0.0", mask: "255.255.255.0", gateway: "0.0.0.0", iface: 1, metric: 0 },
    ];
    router.arpTable = [
      { ip: "192.168.1.10", mac: mac(1, 0) },
      { ip: "10.0.0.10", mac: mac(4, 0) },
    ];

    const nic1 = createNic("n1", "PC-A", "192.168.1.10");
    const nic2 = createNic("n2", "PC-B", "192.168.1.20");
    const nic3 = createNic("n3", "PC-C", "192.168.1.30");
    const nic4 = createNic("n4", "PC-D", "10.0.0.10");

    // PC-A,B → Hub → Switch port0
    connect(nic1, 0, hub, 0);
    connect(nic2, 0, hub, 1);
    connect(hub, 2, sw, 0);
    // PC-C → Switch port1
    connect(nic3, 0, sw, 1);
    // Switch port2 → Router port0
    connect(sw, 2, router, 0);
    // Router port1 → PC-D
    connect(router, 1, nic4, 0);

    return {
      devices: [nic1, nic2, nic3, hub, sw, router, nic4],
      frames: [
        // PC-Aからルーター経由でPC-Dへ
        { fromDevice: "h20", fromPort: 0, frame: makeFrame(mac(1, 0), mac(50, 0), makeIpPacket("192.168.1.10", "10.0.0.10", "Cross-net via Hub+Sw+Router")) },
      ],
    };
  }),
];
