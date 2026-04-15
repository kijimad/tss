/**
 * presets.ts — メモリスワッピングプリセット
 *
 * 各種シナリオのアクセスパターンとシミュレーション設定を定義。
 */

import { runSwapSim } from "./engine.js";
import type { SwapPreset, MemoryAccess, SwapConfig } from "./types.js";
import type { SimInput } from "./engine.js";

// ── ヘルパー ──

/** アクセスパターン生成: 順次アクセス */
function sequential(pid: number, start: number, count: number, type: "read" | "write" = "read"): MemoryAccess[] {
  const accesses: MemoryAccess[] = [];
  for (let i = 0; i < count; i++) {
    accesses.push({ pid, vpn: start + i, type, label: `seq_${start + i}` });
  }
  return accesses;
}

/** アクセスパターン生成: ループ (繰り返しアクセス) */
function loop(pid: number, pages: number[], iterations: number, type: "read" | "write" = "read"): MemoryAccess[] {
  const accesses: MemoryAccess[] = [];
  for (let iter = 0; iter < iterations; iter++) {
    for (const vpn of pages) {
      accesses.push({ pid, vpn, type, label: `loop_${vpn}` });
    }
  }
  return accesses;
}

// ── プリセット定義 ──

/** 1. 基本ページフォルト — 空メモリへの初回アクセス */
function presetBasicFault(): SwapPreset {
  return {
    name: "基本ページフォルト",
    description: "空の物理メモリに順次アクセス → 全てページフォルト → フレーム割り当て",
    run: () => {
      const config: SwapConfig = { numFrames: 4, numSwapSlots: 8, tlbSize: 4, algorithm: "fifo" };
      const input: SimInput = {
        config,
        processes: [{ pid: 1, name: "app", numPages: 6 }],
        accesses: sequential(1, 0, 6),
      };
      return runSwapSim(input);
    },
  };
}

/** 2. FIFO置換 — Béládyの異常 */
function presetFifoAnomaly(): SwapPreset {
  return {
    name: "FIFO置換 (Béládyの異常)",
    description: "FIFO置換でフレーム数を増やすとページフォルトが増える (3→4フレーム)",
    run: () => {
      // Béládyの異常を示すアクセスパターン: 1,2,3,4,1,2,5,1,2,3,4,5
      const pattern = [0, 1, 2, 3, 0, 1, 4, 0, 1, 2, 3, 4];
      const config: SwapConfig = { numFrames: 3, numSwapSlots: 8, tlbSize: 4, algorithm: "fifo" };
      const accesses: MemoryAccess[] = pattern.map(vpn => ({ pid: 1, vpn, type: "read" as const, label: `page_${vpn}` }));
      return runSwapSim({ config, processes: [{ pid: 1, name: "app", numPages: 5 }], accesses });
    },
  };
}

/** 3. LRU置換 — 時間的局所性 */
function presetLru(): SwapPreset {
  return {
    name: "LRU置換 — 時間的局所性",
    description: "頻繁にアクセスするページを保持、長期未使用ページを退避",
    run: () => {
      const config: SwapConfig = { numFrames: 3, numSwapSlots: 8, tlbSize: 4, algorithm: "lru" };
      // 局所性のあるアクセスパターン
      const accesses: MemoryAccess[] = [
        { pid: 1, vpn: 0, type: "read", label: "code_main" },
        { pid: 1, vpn: 1, type: "read", label: "code_loop" },
        { pid: 1, vpn: 2, type: "read", label: "data_buf" },
        { pid: 1, vpn: 3, type: "read", label: "data_tmp" },
        // ループ内 — VP0,1が繰り返しアクセスされる
        { pid: 1, vpn: 0, type: "read", label: "code_main" },
        { pid: 1, vpn: 1, type: "read", label: "code_loop" },
        { pid: 1, vpn: 0, type: "read", label: "code_main" },
        { pid: 1, vpn: 1, type: "read", label: "code_loop" },
        // VP4アクセス — LRUはVP2/3のうち古い方を退避
        { pid: 1, vpn: 4, type: "read", label: "data_new" },
        // VP0,1はまだ常駐
        { pid: 1, vpn: 0, type: "read", label: "code_main" },
        { pid: 1, vpn: 1, type: "read", label: "code_loop" },
        // VP2に戻るとページフォルト
        { pid: 1, vpn: 2, type: "read", label: "data_buf" },
      ];
      return runSwapSim({ config, processes: [{ pid: 1, name: "app", numPages: 5 }], accesses });
    },
  };
}

/** 4. Clock (Second Chance) アルゴリズム */
function presetClock(): SwapPreset {
  return {
    name: "Clock (Second Chance)",
    description: "参照ビットを使った近似LRU — 針が回って犠牲ページを選択",
    run: () => {
      const config: SwapConfig = { numFrames: 4, numSwapSlots: 8, tlbSize: 4, algorithm: "clock" };
      const accesses: MemoryAccess[] = [
        // フレームを埋める
        { pid: 1, vpn: 0, type: "read", label: "A" },
        { pid: 1, vpn: 1, type: "read", label: "B" },
        { pid: 1, vpn: 2, type: "read", label: "C" },
        { pid: 1, vpn: 3, type: "read", label: "D" },
        // VP0,1を再参照 (参照ビット=1)
        { pid: 1, vpn: 0, type: "read", label: "A" },
        { pid: 1, vpn: 1, type: "read", label: "B" },
        // VP4アクセス → フォルト → 針がVP0(ref=1→0), VP1(ref=1→0), VP2(ref=0)→犠牲
        { pid: 1, vpn: 4, type: "read", label: "E" },
        // VP5アクセス
        { pid: 1, vpn: 5, type: "read", label: "F" },
        // VP2に戻るとフォルト
        { pid: 1, vpn: 2, type: "read", label: "C" },
        // VP0を再参照
        { pid: 1, vpn: 0, type: "read", label: "A" },
      ];
      return runSwapSim({ config, processes: [{ pid: 1, name: "app", numPages: 6 }], accesses });
    },
  };
}

/** 5. Optimal アルゴリズム (理論最適) */
function presetOptimal(): SwapPreset {
  return {
    name: "Optimal (理論最適)",
    description: "将来のアクセスを知っている前提で最もフォルトが少ない置換 — 実用不可だが比較基準に使用",
    run: () => {
      const config: SwapConfig = { numFrames: 3, numSwapSlots: 8, tlbSize: 4, algorithm: "optimal" };
      const accesses: MemoryAccess[] = [
        { pid: 1, vpn: 0, type: "read", label: "A" },
        { pid: 1, vpn: 1, type: "read", label: "B" },
        { pid: 1, vpn: 2, type: "read", label: "C" },
        { pid: 1, vpn: 3, type: "read", label: "D" },  // フォルト: A,B,Cの中で将来最も遠いものを退避
        { pid: 1, vpn: 0, type: "read", label: "A" },
        { pid: 1, vpn: 1, type: "read", label: "B" },
        { pid: 1, vpn: 4, type: "read", label: "E" },  // フォルト
        { pid: 1, vpn: 0, type: "read", label: "A" },
        { pid: 1, vpn: 1, type: "read", label: "B" },
        { pid: 1, vpn: 2, type: "read", label: "C" },
        { pid: 1, vpn: 3, type: "read", label: "D" },
        { pid: 1, vpn: 4, type: "read", label: "E" },
      ];
      return runSwapSim({ config, processes: [{ pid: 1, name: "app", numPages: 5 }], accesses });
    },
  };
}

/** 6. ダーティページの書き戻し */
function presetDirtyWriteback(): SwapPreset {
  return {
    name: "ダーティページの書き戻し",
    description: "書き込みでdirtyビットが立つ → 退避時にスワップへ書き戻し → 読み込みページより退避コストが高い",
    run: () => {
      const config: SwapConfig = { numFrames: 3, numSwapSlots: 8, tlbSize: 4, algorithm: "lru" };
      const accesses: MemoryAccess[] = [
        { pid: 1, vpn: 0, type: "read", label: "code (read)" },
        { pid: 1, vpn: 1, type: "write", label: "data (write!)" },
        { pid: 1, vpn: 2, type: "read", label: "rodata (read)" },
        // フレーム満杯 — VP3アクセスで退避発生
        { pid: 1, vpn: 3, type: "write", label: "heap (write!)" },
        // VP1(dirty)が退避される → 書き戻し発生
        { pid: 1, vpn: 4, type: "read", label: "stack (read)" },
        // VP0(clean)が退避される → 書き戻し不要
        { pid: 1, vpn: 1, type: "read", label: "data (read back)" },
        // スワップからVP1を復元
        { pid: 1, vpn: 0, type: "read", label: "code (read back)" },
      ];
      return runSwapSim({ config, processes: [{ pid: 1, name: "app", numPages: 5 }], accesses });
    },
  };
}

/** 7. マルチプロセスの競合 */
function presetMultiProcess(): SwapPreset {
  return {
    name: "マルチプロセスの競合",
    description: "2つのプロセスが限られた物理メモリを奪い合う",
    run: () => {
      const config: SwapConfig = { numFrames: 4, numSwapSlots: 12, tlbSize: 4, algorithm: "lru" };
      const accesses: MemoryAccess[] = [
        // プロセス1がフレームを占有
        { pid: 1, vpn: 0, type: "read", label: "P1:code" },
        { pid: 1, vpn: 1, type: "read", label: "P1:data" },
        { pid: 1, vpn: 2, type: "write", label: "P1:heap" },
        // プロセス2が割り込み
        { pid: 2, vpn: 0, type: "read", label: "P2:code" },
        { pid: 2, vpn: 1, type: "write", label: "P2:data" },
        // プロセス2のページでプロセス1が押し出される
        { pid: 2, vpn: 2, type: "read", label: "P2:heap" },
        // プロセス1に戻るとページフォルト
        { pid: 1, vpn: 0, type: "read", label: "P1:code (fault!)" },
        { pid: 1, vpn: 1, type: "read", label: "P1:data (fault!)" },
        // プロセス2に戻るとページフォルト
        { pid: 2, vpn: 0, type: "read", label: "P2:code (fault!)" },
        { pid: 2, vpn: 1, type: "read", label: "P2:data (fault!)" },
      ];
      return runSwapSim({
        config,
        processes: [
          { pid: 1, name: "editor", numPages: 4 },
          { pid: 2, name: "compiler", numPages: 4 },
        ],
        accesses,
      });
    },
  };
}

/** 8. スラッシング */
function presetThrashing(): SwapPreset {
  return {
    name: "スラッシング",
    description: "ワーキングセットがメモリ容量を超過 → 常にページフォルト → システム停滞",
    run: () => {
      // フレーム3つに対し5ページを循環アクセス → 常にフォルト
      const config: SwapConfig = { numFrames: 3, numSwapSlots: 10, tlbSize: 4, algorithm: "fifo" };
      const accesses: MemoryAccess[] = loop(1, [0, 1, 2, 3, 4], 3);
      return runSwapSim({ config, processes: [{ pid: 1, name: "app", numPages: 5 }], accesses });
    },
  };
}

/** 9. TLBの効果 */
function presetTlbEffect(): SwapPreset {
  return {
    name: "TLBの効果",
    description: "同一ページへの繰り返しアクセスでTLBヒット率が向上 — アドレス変換の高速化",
    run: () => {
      const config: SwapConfig = { numFrames: 4, numSwapSlots: 8, tlbSize: 2, algorithm: "lru" };
      const accesses: MemoryAccess[] = [
        // VP0に3回アクセス — 初回はTLBミス、2回目以降はTLBヒット
        { pid: 1, vpn: 0, type: "read", label: "code" },
        { pid: 1, vpn: 0, type: "read", label: "code (TLB hit)" },
        { pid: 1, vpn: 0, type: "read", label: "code (TLB hit)" },
        // VP1
        { pid: 1, vpn: 1, type: "read", label: "data" },
        { pid: 1, vpn: 1, type: "write", label: "data (write, TLB hit)" },
        // VP2アクセスでTLBサイズ(2)超過 → VP0がTLBから追い出される
        { pid: 1, vpn: 2, type: "read", label: "heap" },
        // VP0に戻るとTLBミス (ページは物理メモリにある)
        { pid: 1, vpn: 0, type: "read", label: "code (TLB miss, page hit)" },
        // VP1
        { pid: 1, vpn: 1, type: "read", label: "data (TLB miss)" },
        // 再びVP0,1にアクセス → TLBヒット
        { pid: 1, vpn: 0, type: "read", label: "code (TLB hit)" },
        { pid: 1, vpn: 1, type: "read", label: "data (TLB hit)" },
      ];
      return runSwapSim({ config, processes: [{ pid: 1, name: "app", numPages: 4 }], accesses });
    },
  };
}

/** 10. アルゴリズム比較 (同一パターンでFIFO/LRU/Clock/Optimal) */
function presetAlgoCompare(): SwapPreset {
  return {
    name: "アルゴリズム比較 (FIFO vs LRU)",
    description: "同じアクセスパターンでFIFOとLRUのフォルト回数を比較 — LRUのほうが局所性を活用",
    run: () => {
      // LRUで実行 (UIで他のアルゴリズムに切り替え可能)
      const config: SwapConfig = { numFrames: 3, numSwapSlots: 8, tlbSize: 4, algorithm: "lru" };
      const accesses: MemoryAccess[] = [
        { pid: 1, vpn: 0, type: "read", label: "A" },
        { pid: 1, vpn: 1, type: "read", label: "B" },
        { pid: 1, vpn: 2, type: "read", label: "C" },
        { pid: 1, vpn: 3, type: "read", label: "D" },
        { pid: 1, vpn: 0, type: "read", label: "A" },  // LRU: ヒット可能? (VP1が退避される)
        { pid: 1, vpn: 1, type: "read", label: "B" },
        { pid: 1, vpn: 4, type: "read", label: "E" },
        { pid: 1, vpn: 0, type: "read", label: "A" },
        { pid: 1, vpn: 1, type: "read", label: "B" },
        { pid: 1, vpn: 2, type: "read", label: "C" },
        { pid: 1, vpn: 3, type: "read", label: "D" },
        { pid: 1, vpn: 4, type: "read", label: "E" },
      ];
      return runSwapSim({ config, processes: [{ pid: 1, name: "app", numPages: 5 }], accesses });
    },
  };
}

// ── 公開API ──

export const PRESETS: SwapPreset[] = [
  presetBasicFault(),
  presetFifoAnomaly(),
  presetLru(),
  presetClock(),
  presetOptimal(),
  presetDirtyWriteback(),
  presetMultiProcess(),
  presetThrashing(),
  presetTlbEffect(),
  presetAlgoCompare(),
];
