import type { Preset, MemoryAccess } from "./types.js";

/** アドレス生成ヘルパー (VPN * pageSize + offset) */
function va(vpn: number, offset: number, pageSize = 256): number {
  return vpn * pageSize + offset;
}

function read(addr: number): MemoryAccess {
  return { virtualAddress: addr, accessType: "read" };
}
function write(addr: number, data = "data"): MemoryAccess {
  return { virtualAddress: addr, accessType: "write", data };
}
function exec(addr: number): MemoryAccess {
  return { virtualAddress: addr, accessType: "execute" };
}

export const presets: Preset[] = [
  // 1. 基本的なアドレス変換
  {
    name: "1. 基本 — 仮想→物理アドレス変換",
    description: "仮想アドレスをVPN+オフセットに分解し、ページテーブルで物理フレームにマッピング。TLBキャッシュの動作を観察。",
    config: {
      pageSize: 256, virtualBits: 16, physicalFrames: 4,
      tlbSize: 4, replacementAlgo: "lru", twoLevel: false,
    },
    permissions: [
      [0, true, true, false],
      [1, true, true, false],
      [2, true, false, false],
    ],
    accesses: [
      read(va(0, 10)),   // ページ0読み取り
      read(va(1, 20)),   // ページ1読み取り
      read(va(0, 50)),   // ページ0再読み取り（TLBヒット）
    ],
  },

  // 2. TLBヒット vs ミス
  {
    name: "2. TLB — ヒットとミスの比較",
    description: "同じページに連続アクセス→TLBヒット。異なるページに散らばるアクセス→TLBミス多発。局所性の重要性。",
    config: {
      pageSize: 256, virtualBits: 16, physicalFrames: 8,
      tlbSize: 2, replacementAlgo: "lru", twoLevel: false,
    },
    permissions: [
      [0, true, true, false],
      [1, true, true, false],
      [2, true, true, false],
      [3, true, true, false],
    ],
    accesses: [
      read(va(0, 0)),    // ミス
      read(va(0, 64)),   // ヒット（同じページ）
      read(va(0, 128)),  // ヒット
      read(va(1, 0)),    // ミス
      read(va(2, 0)),    // ミス（TLB容量2なのでVPN 0がエビクト）
      read(va(0, 0)),    // ミス（VPN 0はTLBから追い出された）
    ],
  },

  // 3. ページフォルトと物理フレーム割り当て
  {
    name: "3. ページフォルト — ディスクからのロード",
    description: "初回アクセスでページフォルトが発生し、ディスクからメモリにロード。物理フレームの割り当て過程を観察。",
    config: {
      pageSize: 256, virtualBits: 16, physicalFrames: 3,
      tlbSize: 4, replacementAlgo: "fifo", twoLevel: false,
    },
    permissions: [
      [0, true, true, false],
      [1, true, true, false],
      [2, true, true, false],
      [3, true, true, false],
    ],
    accesses: [
      read(va(0, 0)),   // フォルト→フレーム0
      read(va(1, 0)),   // フォルト→フレーム1
      read(va(2, 0)),   // フォルト→フレーム2
      read(va(3, 0)),   // フォルト→フレーム不足→エビクト
    ],
  },

  // 4. FIFO置換
  {
    name: "4. FIFO — 先入れ先出し置換",
    description: "物理メモリが満杯になると、最初にロードされたページが追い出される（FIFO）。Béládyの異常現象が起きうるアルゴリズム。",
    config: {
      pageSize: 256, virtualBits: 16, physicalFrames: 3,
      tlbSize: 8, replacementAlgo: "fifo", twoLevel: false,
    },
    permissions: [
      [0, true, true, false], [1, true, true, false],
      [2, true, true, false], [3, true, true, false],
    ],
    accesses: [
      read(va(0, 0)), read(va(1, 0)), read(va(2, 0)),
      read(va(3, 0)),  // フレーム不足→VPN 0をエビクト（最初にロード）
      read(va(0, 0)),  // VPN 0を再ロード→VPN 1をエビクト
      read(va(1, 0)),  // VPN 1を再ロード→VPN 2をエビクト
    ],
  },

  // 5. LRU置換
  {
    name: "5. LRU — 最近最も使われていないページを置換",
    description: "最も長い間アクセスされていないページが追い出される（LRU）。時間的局所性を活用する優秀なアルゴリズム。",
    config: {
      pageSize: 256, virtualBits: 16, physicalFrames: 3,
      tlbSize: 8, replacementAlgo: "lru", twoLevel: false,
    },
    permissions: [
      [0, true, true, false], [1, true, true, false],
      [2, true, true, false], [3, true, true, false],
    ],
    accesses: [
      read(va(0, 0)), read(va(1, 0)), read(va(2, 0)),
      read(va(0, 0)),  // VPN 0にアクセス（LRU更新: VPN 1が最古に）
      read(va(3, 0)),  // フレーム不足→VPN 1をエビクト（LRU）
      read(va(1, 0)),  // VPN 1再ロード→VPN 2をエビクト（LRU）
    ],
  },

  // 6. Clock (Second Chance) 置換
  {
    name: "6. Clock — Second Chanceアルゴリズム",
    description: "参照ビットを使ったClock方式。参照されたページにはsecond chanceを与え、参照されていないページを追い出す。",
    config: {
      pageSize: 256, virtualBits: 16, physicalFrames: 3,
      tlbSize: 8, replacementAlgo: "clock", twoLevel: false,
    },
    permissions: [
      [0, true, true, false], [1, true, true, false],
      [2, true, true, false], [3, true, true, false],
    ],
    accesses: [
      read(va(0, 0)), read(va(1, 0)), read(va(2, 0)),
      read(va(0, 0)),  // VPN 0の参照ビットをセット
      read(va(3, 0)),  // 置換時: VPN 0はsecond chance, VPN 1がエビクト
    ],
  },

  // 7. Optimal置換（理論最適）
  {
    name: "7. Optimal — 理論上最適な置換 (Bélády)",
    description: "将来最も長く使われないページを追い出す。実装不可能だが比較の基準として使用される最適アルゴリズム。",
    config: {
      pageSize: 256, virtualBits: 16, physicalFrames: 3,
      tlbSize: 8, replacementAlgo: "optimal", twoLevel: false,
    },
    permissions: [
      [0, true, true, false], [1, true, true, false],
      [2, true, true, false], [3, true, true, false],
    ],
    accesses: [
      read(va(0, 0)), read(va(1, 0)), read(va(2, 0)),
      read(va(3, 0)),  // VPN 1が将来最も遅くアクセスされる→VPN 1をエビクト
      read(va(0, 0)),  // TLBヒットまたはページテーブルヒット
      read(va(2, 0)),  // ヒット
      read(va(1, 0)),  // VPN 1を再ロード
    ],
  },

  // 8. ダーティページの書き戻し
  {
    name: "8. ダーティビット — 書き込みと書き戻し",
    description: "書き込みでダーティビットがセットされたページは、エビクト時にディスクに書き戻しが必要（コスト大）。",
    config: {
      pageSize: 256, virtualBits: 16, physicalFrames: 2,
      tlbSize: 4, replacementAlgo: "fifo", twoLevel: false,
    },
    permissions: [
      [0, true, true, false], [1, true, true, false],
      [2, true, false, false],
    ],
    accesses: [
      write(va(0, 0), "Hello"),  // ページ0に書き込み→dirty
      read(va(1, 0)),             // ページ1読み取り
      read(va(2, 0)),             // ページ2→フレーム不足→ページ0をエビクト（dirty書き戻し）
    ],
  },

  // 9. 保護違反（NXビット、読み取り専用）
  {
    name: "9. 保護違反 — アクセス権限チェック",
    description: "読み取り専用ページへの書き込みや、NX（実行不可）ページの実行で保護違反が発生。セキュリティの基盤。",
    config: {
      pageSize: 256, virtualBits: 16, physicalFrames: 4,
      tlbSize: 4, replacementAlgo: "lru", twoLevel: false,
    },
    permissions: [
      [0, true, false, false],  // 読み取り専用
      [1, true, true, true],    // RWX
      [2, true, true, false],   // NX (実行不可)
    ],
    accesses: [
      read(va(0, 0)),     // OK: 読み取り可能
      write(va(0, 10)),   // NG: 書き込み不可→保護違反
      exec(va(1, 0)),     // OK: 実行可能
      exec(va(2, 0)),     // NG: NXビット→保護違反
      write(va(1, 20)),   // OK: 書き込み可能
    ],
  },

  // 10. 2段ページテーブル
  {
    name: "10. 2段ページテーブル — 多段ウォーク",
    description: "VPNをL2インデックスとL1インデックスに分割する2段ページテーブル。大きなアドレス空間でもテーブルサイズを抑える。",
    config: {
      pageSize: 256, virtualBits: 16, physicalFrames: 4,
      tlbSize: 2, replacementAlgo: "lru", twoLevel: true,
    },
    permissions: [
      [0, true, true, false],
      [5, true, true, false],
      [16, true, true, false],
      [20, true, true, false],
    ],
    accesses: [
      read(va(0, 0)),    // L2[0] → L1[0] → PFN
      read(va(5, 10)),   // L2[0] → L1[5] → PFN
      read(va(16, 0)),   // L2[1] → L1[0] → PFN（異なるL2エントリ）
      read(va(0, 50)),   // TLBミス（TLBサイズ2で追い出し済み）
      read(va(20, 0)),   // L2[1] → L1[4]
    ],
  },
];
