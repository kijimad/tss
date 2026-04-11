import type { Preset } from "./types.js";
import {
  mac, makeFrame, makeAccessPort, makeTrunkPort, createSwitch, createHost,
  connectHostToSwitch, connectSwitches, BROADCAST_MAC, makeTag,
} from "./engine.js";

/** VLAN定義ヘルパー */
const vlan = (id: number, name: string) => ({ id, name });

export const presets: Preset[] = [
  // 1. 基本VLAN分離
  (() => {
    const sw = createSwitch("sw1", "Switch1", [
      makeAccessPort(0, 10),
      makeAccessPort(1, 10),
      makeAccessPort(2, 20),
      makeAccessPort(3, 20),
    ], [vlan(10, "Sales"), vlan(20, "Engineering")]);
    const hosts = [
      createHost("h1", "PC-A(VLAN10)", mac(1)),
      createHost("h2", "PC-B(VLAN10)", mac(2)),
      createHost("h3", "PC-C(VLAN20)", mac(3)),
      createHost("h4", "PC-D(VLAN20)", mac(4)),
    ];
    hosts.forEach((h, i) => connectHostToSwitch(h, sw, i));
    return {
      name: "基本VLAN分離",
      description: "VLAN10とVLAN20を分離し、同一VLAN内のみ通信可能であることを確認",
      switches: [sw],
      hosts,
      frames: [
        { fromHost: "h1", frame: makeFrame(mac(1), mac(2), "Hello from A to B") },
        { fromHost: "h1", frame: makeFrame(mac(1), mac(3), "Hello from A to C (blocked)") },
      ],
    };
  })(),

  // 2. VLANフラッディング
  (() => {
    const sw = createSwitch("sw1", "Switch1", [
      makeAccessPort(0, 10),
      makeAccessPort(1, 10),
      makeAccessPort(2, 10),
      makeAccessPort(3, 20),
    ], [vlan(10, "Sales"), vlan(20, "Engineering")]);
    const hosts = [
      createHost("h1", "PC-A(VLAN10)", mac(1)),
      createHost("h2", "PC-B(VLAN10)", mac(2)),
      createHost("h3", "PC-C(VLAN10)", mac(3)),
      createHost("h4", "PC-D(VLAN20)", mac(4)),
    ];
    hosts.forEach((h, i) => connectHostToSwitch(h, sw, i));
    return {
      name: "VLANフラッディング",
      description: "未学習MACへの送信でVLAN内の全ポートにフラッディングされることを確認",
      switches: [sw],
      hosts,
      frames: [
        { fromHost: "h1", frame: makeFrame(mac(1), mac(99), "Unknown dest") },
      ],
    };
  })(),

  // 3. MAC学習とユニキャスト
  (() => {
    const sw = createSwitch("sw1", "Switch1", [
      makeAccessPort(0, 10),
      makeAccessPort(1, 10),
      makeAccessPort(2, 10),
    ], [vlan(10, "Default")]);
    const hosts = [
      createHost("h1", "PC-A", mac(1)),
      createHost("h2", "PC-B", mac(2)),
      createHost("h3", "PC-C", mac(3)),
    ];
    hosts.forEach((h, i) => connectHostToSwitch(h, sw, i));
    return {
      name: "MAC学習とユニキャスト",
      description: "1回目はフラッディング、学習後はユニキャスト転送されることを確認",
      switches: [sw],
      hosts,
      frames: [
        { fromHost: "h1", frame: makeFrame(mac(1), mac(2), "1st: flood") },
        { fromHost: "h2", frame: makeFrame(mac(2), mac(1), "2nd: unicast") },
      ],
    };
  })(),

  // 4. ブロードキャスト（VLAN内）
  (() => {
    const sw = createSwitch("sw1", "Switch1", [
      makeAccessPort(0, 10),
      makeAccessPort(1, 10),
      makeAccessPort(2, 20),
      makeAccessPort(3, 10),
    ], [vlan(10, "Sales"), vlan(20, "Engineering")]);
    const hosts = [
      createHost("h1", "PC-A(VLAN10)", mac(1)),
      createHost("h2", "PC-B(VLAN10)", mac(2)),
      createHost("h3", "PC-C(VLAN20)", mac(3)),
      createHost("h4", "PC-D(VLAN10)", mac(4)),
    ];
    hosts.forEach((h, i) => connectHostToSwitch(h, sw, i));
    return {
      name: "VLANブロードキャスト",
      description: "ブロードキャストが同一VLAN内のみに送信されることを確認",
      switches: [sw],
      hosts,
      frames: [
        { fromHost: "h1", frame: makeFrame(mac(1), BROADCAST_MAC, "Broadcast in VLAN10") },
      ],
    };
  })(),

  // 5. トランクリンク基本
  (() => {
    const sw1 = createSwitch("sw1", "Switch1", [
      makeAccessPort(0, 10),
      makeAccessPort(1, 20),
      makeTrunkPort(2, [10, 20]),
    ], [vlan(10, "Sales"), vlan(20, "Engineering")]);
    const sw2 = createSwitch("sw2", "Switch2", [
      makeTrunkPort(0, [10, 20]),
      makeAccessPort(1, 10),
      makeAccessPort(2, 20),
    ], [vlan(10, "Sales"), vlan(20, "Engineering")]);
    connectSwitches(sw1, 2, sw2, 0);
    const hosts = [
      createHost("h1", "SW1-A(VLAN10)", mac(1)),
      createHost("h2", "SW1-B(VLAN20)", mac(2)),
      createHost("h3", "SW2-C(VLAN10)", mac(3)),
      createHost("h4", "SW2-D(VLAN20)", mac(4)),
    ];
    connectHostToSwitch(hosts[0]!, sw1, 0);
    connectHostToSwitch(hosts[1]!, sw1, 1);
    connectHostToSwitch(hosts[2]!, sw2, 1);
    connectHostToSwitch(hosts[3]!, sw2, 2);
    return {
      name: "トランクリンク基本",
      description: "802.1Qトランクを使い、スイッチ間でVLAN情報を伝搬",
      switches: [sw1, sw2],
      hosts,
      frames: [
        { fromHost: "h1", frame: makeFrame(mac(1), mac(3), "Cross-switch VLAN10") },
      ],
    };
  })(),

  // 6. トランクVLAN許可リスト
  (() => {
    const sw1 = createSwitch("sw1", "Switch1", [
      makeAccessPort(0, 10),
      makeAccessPort(1, 20),
      makeTrunkPort(2, [10]),  // VLAN20は許可しない
    ], [vlan(10, "Sales"), vlan(20, "Engineering")]);
    const sw2 = createSwitch("sw2", "Switch2", [
      makeTrunkPort(0, [10]),
      makeAccessPort(1, 10),
      makeAccessPort(2, 20),
    ], [vlan(10, "Sales"), vlan(20, "Engineering")]);
    connectSwitches(sw1, 2, sw2, 0);
    const hosts = [
      createHost("h1", "SW1-A(VLAN10)", mac(1)),
      createHost("h2", "SW1-B(VLAN20)", mac(2)),
      createHost("h3", "SW2-C(VLAN10)", mac(3)),
      createHost("h4", "SW2-D(VLAN20)", mac(4)),
    ];
    connectHostToSwitch(hosts[0]!, sw1, 0);
    connectHostToSwitch(hosts[1]!, sw1, 1);
    connectHostToSwitch(hosts[2]!, sw2, 1);
    connectHostToSwitch(hosts[3]!, sw2, 2);
    return {
      name: "トランクVLAN許可リスト",
      description: "トランクでVLAN20を許可しない設定。VLAN10は通過、VLAN20は遮断",
      switches: [sw1, sw2],
      hosts,
      frames: [
        { fromHost: "h1", frame: makeFrame(mac(1), mac(3), "VLAN10 allowed") },
        { fromHost: "h2", frame: makeFrame(mac(2), mac(4), "VLAN20 blocked") },
      ],
    };
  })(),

  // 7. ネイティブVLAN
  (() => {
    const sw1 = createSwitch("sw1", "Switch1", [
      makeAccessPort(0, 10),
      makeTrunkPort(1, [10, 20], 10),  // ネイティブVLAN=10
    ], [vlan(10, "Native"), vlan(20, "Tagged")]);
    const sw2 = createSwitch("sw2", "Switch2", [
      makeTrunkPort(0, [10, 20], 10),
      makeAccessPort(1, 10),
      makeAccessPort(2, 20),
    ], [vlan(10, "Native"), vlan(20, "Tagged")]);
    connectSwitches(sw1, 1, sw2, 0);
    const hosts = [
      createHost("h1", "SW1-A(VLAN10)", mac(1)),
      createHost("h2", "SW2-B(VLAN10)", mac(2)),
      createHost("h3", "SW2-C(VLAN20)", mac(3)),
    ];
    connectHostToSwitch(hosts[0]!, sw1, 0);
    connectHostToSwitch(hosts[1]!, sw2, 1);
    connectHostToSwitch(hosts[2]!, sw2, 2);
    return {
      name: "ネイティブVLAN",
      description: "ネイティブVLAN（10）のフレームはタグなしでトランクを通過",
      switches: [sw1, sw2],
      hosts,
      frames: [
        { fromHost: "h1", frame: makeFrame(mac(1), mac(2), "Native VLAN (untagged)") },
        { fromHost: "h1", frame: makeFrame(mac(1), mac(3), "To VLAN20 (will be tagged)") },
      ],
    };
  })(),

  // 8. 複数スイッチチェーン
  (() => {
    const sw1 = createSwitch("sw1", "Switch1", [
      makeAccessPort(0, 10),
      makeTrunkPort(1, [10, 20]),
    ], [vlan(10, "VLAN10"), vlan(20, "VLAN20")]);
    const sw2 = createSwitch("sw2", "Switch2", [
      makeTrunkPort(0, [10, 20]),
      makeTrunkPort(1, [10, 20]),
      makeAccessPort(2, 20),
    ], [vlan(10, "VLAN10"), vlan(20, "VLAN20")]);
    const sw3 = createSwitch("sw3", "Switch3", [
      makeTrunkPort(0, [10, 20]),
      makeAccessPort(1, 10),
      makeAccessPort(2, 20),
    ], [vlan(10, "VLAN10"), vlan(20, "VLAN20")]);
    connectSwitches(sw1, 1, sw2, 0);
    connectSwitches(sw2, 1, sw3, 0);
    const hosts = [
      createHost("h1", "SW1-A(V10)", mac(1)),
      createHost("h2", "SW2-B(V20)", mac(2)),
      createHost("h3", "SW3-C(V10)", mac(3)),
      createHost("h4", "SW3-D(V20)", mac(4)),
    ];
    connectHostToSwitch(hosts[0]!, sw1, 0);
    connectHostToSwitch(hosts[1]!, sw2, 2);
    connectHostToSwitch(hosts[2]!, sw3, 1);
    connectHostToSwitch(hosts[3]!, sw3, 2);
    return {
      name: "複数スイッチチェーン",
      description: "3台のスイッチをトランクで接続し、VLANがエンドツーエンドで分離されることを確認",
      switches: [sw1, sw2, sw3],
      hosts,
      frames: [
        { fromHost: "h1", frame: makeFrame(mac(1), mac(3), "V10: SW1→SW2→SW3") },
      ],
    };
  })(),

  // 9. 802.1Qタグ付きフレーム
  (() => {
    const sw = createSwitch("sw1", "Switch1", [
      makeTrunkPort(0, [10, 20, 30]),
      makeAccessPort(1, 10),
      makeAccessPort(2, 20),
      makeAccessPort(3, 30),
    ], [vlan(10, "Red"), vlan(20, "Green"), vlan(30, "Blue")]);
    const hosts = [
      createHost("h1", "Trunk-Host", mac(1)),
      createHost("h2", "PC-Red(V10)", mac(2)),
      createHost("h3", "PC-Green(V20)", mac(3)),
      createHost("h4", "PC-Blue(V30)", mac(4)),
    ];
    connectHostToSwitch(hosts[0]!, sw, 0);
    connectHostToSwitch(hosts[1]!, sw, 1);
    connectHostToSwitch(hosts[2]!, sw, 2);
    connectHostToSwitch(hosts[3]!, sw, 3);
    return {
      name: "802.1Qタグ付きフレーム",
      description: "トランクポートからタグ付きフレームを受信し、対応するVLANに転送",
      switches: [sw],
      hosts,
      frames: [
        { fromHost: "h1", frame: makeFrame(mac(1), mac(3), "Tagged VLAN20", makeTag(20)) },
        { fromHost: "h1", frame: makeFrame(mac(1), mac(4), "Tagged VLAN30", makeTag(30)) },
      ],
    };
  })(),

  // 10. 総合：マルチVLAN + マルチスイッチ + ブロードキャスト
  (() => {
    const sw1 = createSwitch("sw1", "CoreSwitch", [
      makeTrunkPort(0, [10, 20, 30]),
      makeTrunkPort(1, [10, 20, 30]),
      makeAccessPort(2, 30),
    ], [vlan(10, "Sales"), vlan(20, "Dev"), vlan(30, "Mgmt")]);
    const sw2 = createSwitch("sw2", "FloorSwitch1", [
      makeTrunkPort(0, [10, 20, 30]),
      makeAccessPort(1, 10),
      makeAccessPort(2, 10),
      makeAccessPort(3, 20),
    ], [vlan(10, "Sales"), vlan(20, "Dev"), vlan(30, "Mgmt")]);
    const sw3 = createSwitch("sw3", "FloorSwitch2", [
      makeTrunkPort(0, [10, 20, 30]),
      makeAccessPort(1, 20),
      makeAccessPort(2, 20),
      makeAccessPort(3, 10),
    ], [vlan(10, "Sales"), vlan(20, "Dev"), vlan(30, "Mgmt")]);
    connectSwitches(sw1, 0, sw2, 0);
    connectSwitches(sw1, 1, sw3, 0);
    const hosts = [
      createHost("h1", "Mgr(V30)", mac(1)),
      createHost("h2", "Sales1(V10)", mac(2)),
      createHost("h3", "Sales2(V10)", mac(3)),
      createHost("h4", "Dev1(V20)", mac(4)),
      createHost("h5", "Dev2(V20)", mac(5)),
      createHost("h6", "Dev3(V20)", mac(6)),
      createHost("h7", "Sales3(V10)", mac(7)),
    ];
    connectHostToSwitch(hosts[0]!, sw1, 2);
    connectHostToSwitch(hosts[1]!, sw2, 1);
    connectHostToSwitch(hosts[2]!, sw2, 2);
    connectHostToSwitch(hosts[3]!, sw2, 3);
    connectHostToSwitch(hosts[4]!, sw3, 1);
    connectHostToSwitch(hosts[5]!, sw3, 2);
    connectHostToSwitch(hosts[6]!, sw3, 3);
    return {
      name: "総合：マルチVLAN企業ネットワーク",
      description: "コアスイッチ＋2台のフロアスイッチで3VLANの企業ネットワークを構築。ブロードキャストのVLAN分離を確認",
      switches: [sw1, sw2, sw3],
      hosts,
      frames: [
        { fromHost: "h2", frame: makeFrame(mac(2), BROADCAST_MAC, "Sales broadcast") },
        { fromHost: "h4", frame: makeFrame(mac(4), mac(6), "Dev1→Dev3 cross-switch") },
      ],
    };
  })(),
];
