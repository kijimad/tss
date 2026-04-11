/* ルーティングプロトコル プリセット集 */

import type { Preset, SimOp } from "./types.js";
import { mkRouter, mkLink, addStaticRoute } from "./engine.js";

/** 1. スタティックルーティング基礎 */
const staticBasic: Preset = {
  name: "スタティックルーティング",
  description: "手動設定による経路制御。AD=1で最優先。",
  build() {
    const routers = [
      mkRouter("R1", "R1", 100, 100, 200, ["static"]),
      mkRouter("R2", "R2", 100, 300, 200, ["static"]),
      mkRouter("R3", "R3", 100, 500, 200, ["static"]),
    ];
    const links = [
      mkLink("R1", "R2", 10),
      mkLink("R2", "R3", 10),
    ];
    // スタティック経路設定
    addStaticRoute(routers[0]!, "R3", "R2", 0);
    addStaticRoute(routers[0]!, "R2", "R2", 0);
    addStaticRoute(routers[1]!, "R1", "R1", 0);
    addStaticRoute(routers[1]!, "R3", "R3", 0);
    addStaticRoute(routers[2]!, "R1", "R2", 0);
    addStaticRoute(routers[2]!, "R2", "R2", 0);
    return { routers, links, ops: [] };
  },
};

/** 2. RIP収束（三角形トポロジ） */
const ripTriangle: Preset = {
  name: "RIP収束 (三角形)",
  description: "距離ベクトル法でBellman-Ford反復により収束する過程。",
  build() {
    const routers = [
      mkRouter("R1", "R1", 100, 300, 80, ["rip"]),
      mkRouter("R2", "R2", 100, 150, 300, ["rip"]),
      mkRouter("R3", "R3", 100, 450, 300, ["rip"]),
    ];
    const links = [
      mkLink("R1", "R2", 1),
      mkLink("R2", "R3", 1),
      mkLink("R1", "R3", 1),
    ];
    return { routers, links, ops: [] };
  },
};

/** 3. RIPスプリットホライズン */
const ripSplitHorizon: Preset = {
  name: "RIPスプリットホライズン",
  description: "ルーティングループ防止のためのスプリットホライズン。リンク障害時の再収束。",
  build() {
    const routers = [
      mkRouter("R1", "R1", 100, 100, 200, ["rip"]),
      mkRouter("R2", "R2", 100, 300, 200, ["rip"]),
      mkRouter("R3", "R3", 100, 500, 200, ["rip"]),
      mkRouter("R4", "R4", 100, 300, 400, ["rip"]),
    ];
    const links = [
      mkLink("R1", "R2", 1),
      mkLink("R2", "R3", 1),
      mkLink("R2", "R4", 1),
      mkLink("R3", "R4", 1),
    ];
    const ops: SimOp[] = [
      { type: "link_down", from: "R2", to: "R3" },
    ];
    return { routers, links, ops };
  },
};

/** 4. OSPF単一エリア */
const ospfSingle: Preset = {
  name: "OSPF単一エリア",
  description: "リンクステート型。Hello→LSAフラッディング→SPF(Dijkstra)計算。",
  build() {
    const routers = [
      mkRouter("R1", "R1", 100, 100, 150, ["ospf"], 0),
      mkRouter("R2", "R2", 100, 300, 80, ["ospf"], 0),
      mkRouter("R3", "R3", 100, 500, 150, ["ospf"], 0),
      mkRouter("R4", "R4", 100, 300, 300, ["ospf"], 0),
    ];
    const links = [
      mkLink("R1", "R2", 10),
      mkLink("R2", "R3", 20),
      mkLink("R1", "R4", 5),
      mkLink("R4", "R3", 5),
    ];
    return { routers, links, ops: [] };
  },
};

/** 5. OSPFマルチエリア */
const ospfMultiArea: Preset = {
  name: "OSPFマルチエリア",
  description: "Area 0(バックボーン) + Area 1/2。ABRが異なるエリアを接続。",
  build() {
    // バックボーン Area 0
    const r1 = mkRouter("R1", "R1(ABR)", 100, 250, 200, ["ospf"], 0);
    r1.isABR = true;
    const r2 = mkRouter("R2", "R2", 100, 450, 200, ["ospf"], 0);
    const r3 = mkRouter("R3", "R3(ABR)", 100, 350, 100, ["ospf"], 0);
    r3.isABR = true;

    // Area 1
    const r4 = mkRouter("R4", "R4", 100, 80, 100, ["ospf"], 1);
    const r5 = mkRouter("R5", "R5", 100, 80, 300, ["ospf"], 1);

    // Area 2
    const r6 = mkRouter("R6", "R6", 100, 550, 100, ["ospf"], 2);
    const r7 = mkRouter("R7", "R7", 100, 600, 300, ["ospf"], 2);

    const routers = [r1, r2, r3, r4, r5, r6, r7];
    const links = [
      // Area 0 (バックボーン)
      mkLink("R1", "R2", 10),
      mkLink("R1", "R3", 5),
      mkLink("R2", "R3", 8),
      // Area 1 ↔ ABR
      mkLink("R4", "R1", 3),
      mkLink("R5", "R1", 7),
      mkLink("R4", "R5", 2),
      // Area 2 ↔ ABR
      mkLink("R6", "R3", 4),
      mkLink("R7", "R3", 6),
      mkLink("R6", "R7", 3),
    ];
    return { routers, links, ops: [] };
  },
};

/** 6. BGP eBGPピアリング */
const bgpEbgp: Preset = {
  name: "BGP eBGPピアリング",
  description: "異なるAS間でのeBGP経路交換。ASパスによる経路選択。",
  build() {
    const routers = [
      mkRouter("R1", "R1", 100, 100, 200, ["bgp"]),
      mkRouter("R2", "R2", 200, 300, 100, ["bgp"]),
      mkRouter("R3", "R3", 300, 500, 200, ["bgp"]),
      mkRouter("R4", "R4", 200, 300, 300, ["bgp"]),
    ];
    const links = [
      mkLink("R1", "R2", 10),
      mkLink("R2", "R3", 10),
      mkLink("R1", "R4", 10),
      mkLink("R4", "R3", 10),
    ];
    return { routers, links, ops: [] };
  },
};

/** 7. BGP経路選択（LocalPref vs ASPath） */
const bgpSelection: Preset = {
  name: "BGP経路選択",
  description: "LocalPreference, ASパス長, MEDによるベストパス選択アルゴリズム。",
  build() {
    // AS100のR1がAS300のR5に到達する2つの経路
    const routers = [
      mkRouter("R1", "R1", 100, 100, 200, ["bgp"]),
      mkRouter("R2", "R2", 200, 300, 100, ["bgp"]), // AS200経由（短いパス）
      mkRouter("R3", "R3", 300, 500, 200, ["bgp"]),
      mkRouter("R4", "R4", 400, 300, 350, ["bgp"]), // AS400経由
      mkRouter("R5", "R5", 500, 500, 350, ["bgp"]),
    ];
    const links = [
      mkLink("R1", "R2", 10), // R1(AS100) → R2(AS200)
      mkLink("R2", "R3", 10), // R2(AS200) → R3(AS300)
      mkLink("R1", "R4", 10), // R1(AS100) → R4(AS400)
      mkLink("R4", "R5", 10), // R4(AS400) → R5(AS500)
      mkLink("R3", "R5", 10), // R3(AS300) → R5(AS500)
    ];
    return { routers, links, ops: [] };
  },
};

/** 8. OSPF + BGPマルチプロトコル */
const multiProtocol: Preset = {
  name: "OSPF + BGP連携",
  description: "AS内部はOSPF、AS間はBGP。管理距離による最良経路選択。",
  build() {
    // AS100 (OSPF + BGP)
    const r1 = mkRouter("R1", "R1", 100, 100, 150, ["ospf", "bgp"]);
    const r2 = mkRouter("R2", "R2", 100, 250, 150, ["ospf", "bgp"]);
    // AS200 (OSPF + BGP)
    const r3 = mkRouter("R3", "R3", 200, 400, 150, ["ospf", "bgp"]);
    const r4 = mkRouter("R4", "R4", 200, 550, 150, ["ospf", "bgp"]);

    const routers = [r1, r2, r3, r4];
    const links = [
      mkLink("R1", "R2", 10),  // AS100内部
      mkLink("R3", "R4", 10),  // AS200内部
      mkLink("R2", "R3", 20),  // AS間リンク
    ];
    return { routers, links, ops: [] };
  },
};

/** 9. リンク障害と再収束 */
const linkFailure: Preset = {
  name: "リンク障害と再収束",
  description: "プライマリリンクのダウン後にバックアップ経路へ切り替え。OSPFの高速再収束。",
  build() {
    const routers = [
      mkRouter("R1", "R1", 100, 100, 200, ["ospf"]),
      mkRouter("R2", "R2", 100, 300, 100, ["ospf"]),
      mkRouter("R3", "R3", 100, 500, 200, ["ospf"]),
      mkRouter("R4", "R4", 100, 300, 350, ["ospf"]),
    ];
    const links = [
      mkLink("R1", "R2", 5),   // プライマリ
      mkLink("R2", "R3", 5),
      mkLink("R1", "R4", 15),  // バックアップ
      mkLink("R4", "R3", 15),
    ];
    const ops: SimOp[] = [
      { type: "link_down", from: "R1", to: "R2" },
    ];
    return { routers, links, ops };
  },
};

/** 10. 経路再配布（OSPF→BGP） */
const redistribution: Preset = {
  name: "経路再配布 (OSPF→BGP)",
  description: "AS内部のOSPF経路をBGPへ再配布し、外部ASに広告する。",
  build() {
    // AS100: OSPF内部ネットワーク
    const r1 = mkRouter("R1", "R1", 100, 100, 200, ["ospf"]);
    const r2 = mkRouter("R2", "R2(ASBR)", 100, 300, 200, ["ospf", "bgp"]);
    // AS200: BGPのみ
    const r3 = mkRouter("R3", "R3", 200, 500, 200, ["bgp"]);

    const routers = [r1, r2, r3];
    const links = [
      mkLink("R1", "R2", 10),  // OSPF内部
      mkLink("R2", "R3", 20),  // eBGPリンク
    ];
    const ops: SimOp[] = [
      { type: "redistribute", from: "ospf", to: "bgp", routerId: "R2" },
    ];
    return { routers, links, ops };
  },
};

export const PRESETS: Preset[] = [
  staticBasic,
  ripTriangle,
  ripSplitHorizon,
  ospfSingle,
  ospfMultiArea,
  bgpEbgp,
  bgpSelection,
  multiProtocol,
  linkFailure,
  redistribution,
];
