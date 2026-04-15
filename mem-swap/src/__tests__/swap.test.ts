import { describe, it, expect } from "vitest";
import { runSwapSim, defaultConfig } from "../swap/engine.js";
import { PRESETS } from "../swap/presets.js";
import type { SimInput } from "../swap/engine.js";
import type { SwapConfig, MemoryAccess } from "../swap/types.js";

// ── ヘルパー ──

function simpleInput(config: Partial<SwapConfig>, numPages: number, accesses: MemoryAccess[]): SimInput {
  return {
    config: { ...defaultConfig(), ...config },
    processes: [{ pid: 1, name: "test", numPages }],
    accesses,
  };
}

function accessSeq(vpns: number[], type: "read" | "write" = "read"): MemoryAccess[] {
  return vpns.map(vpn => ({ pid: 1, vpn, type }));
}

// ── 基本テスト ──

describe("基本動作", () => {
  it("空のアクセス列で初期スナップショットのみ", () => {
    const result = runSwapSim(simpleInput({}, 4, []));
    expect(result.snapshots).toHaveLength(1);
    expect(result.snapshots[0]!.step).toBe(0);
  });

  it("初期状態で全フレームが空", () => {
    const result = runSwapSim(simpleInput({ numFrames: 4 }, 4, []));
    const frames = result.snapshots[0]!.frames;
    expect(frames.every(f => f.free)).toBe(true);
  });

  it("初期状態でプロセスが作成される", () => {
    const result = runSwapSim(simpleInput({}, 4, []));
    expect(result.snapshots[0]!.processes).toHaveLength(1);
    expect(result.snapshots[0]!.processes[0]!.pid).toBe(1);
  });

  it("アクセス数+1のスナップショットが生成される", () => {
    const result = runSwapSim(simpleInput({}, 4, accessSeq([0, 1, 2])));
    expect(result.snapshots).toHaveLength(4); // 初期 + 3アクセス
  });
});

// ── ページフォルト ──

describe("ページフォルト", () => {
  it("初回アクセスで必ずページフォルト", () => {
    const result = runSwapSim(simpleInput({ numFrames: 4 }, 4, accessSeq([0])));
    const events = result.snapshots[1]!.events;
    expect(events.some(e => e.type === "page_fault")).toBe(true);
  });

  it("ページフォルト後にフレームに配置される", () => {
    const result = runSwapSim(simpleInput({ numFrames: 4 }, 4, accessSeq([0])));
    const frames = result.snapshots[1]!.frames;
    const occupied = frames.filter(f => !f.free);
    expect(occupied).toHaveLength(1);
    expect(occupied[0]!.vpn).toBe(0);
    expect(occupied[0]!.pid).toBe(1);
  });

  it("同一ページの再アクセスはページヒット", () => {
    const result = runSwapSim(simpleInput({ numFrames: 4 }, 4, accessSeq([0, 0])));
    const events = result.snapshots[2]!.events;
    expect(events.some(e => e.type === "page_hit")).toBe(true);
    expect(events.filter(e => e.type === "page_fault")).toHaveLength(0);
  });

  it("フレーム数を超えるアクセスで犠牲ページ選択が発生", () => {
    const result = runSwapSim(simpleInput({ numFrames: 2 }, 4, accessSeq([0, 1, 2])));
    const events = result.snapshots[3]!.events;
    expect(events.some(e => e.type === "victim_select")).toBe(true);
  });
});

// ── FIFO置換 ──

describe("FIFO置換", () => {
  it("最初にロードされたページが最初に退避される", () => {
    const result = runSwapSim(simpleInput({ numFrames: 2, algorithm: "fifo" }, 4, accessSeq([0, 1, 2])));
    // VP2アクセス時にVP0が退避されるはず
    const snap = result.snapshots[3]!;
    const resident = snap.frames.filter(f => !f.free).map(f => f.vpn).sort();
    expect(resident).toEqual([1, 2]);
  });
});

// ── LRU置換 ──

describe("LRU置換", () => {
  it("最も長く未使用のページが退避される", () => {
    // VP0,1をロード → VP0を再アクセス → VP2アクセスでVP1が退避
    const result = runSwapSim(simpleInput(
      { numFrames: 2, algorithm: "lru" }, 4,
      accessSeq([0, 1, 0, 2]),
    ));
    const snap = result.snapshots[4]!;
    const resident = snap.frames.filter(f => !f.free).map(f => f.vpn).sort();
    expect(resident).toEqual([0, 2]);
  });
});

// ── Clock置換 ──

describe("Clock置換", () => {
  it("参照ビットが0のページが選択される", () => {
    // VP0,VP1をロード(両方ref=1) → VP0を再参照 → VP2フォルト
    // Clock: F0(VP0,ref=1→0), F1(VP1,ref=1→0), F0(VP0,ref=0)→犠牲
    const result = runSwapSim(simpleInput(
      { numFrames: 2, algorithm: "clock" }, 4,
      accessSeq([0, 1, 0, 2]),
    ));
    const snap = result.snapshots[4]!;
    const resident = snap.frames.filter(f => !f.free).map(f => f.vpn).sort();
    expect(resident).toEqual([1, 2]);
  });

  it("clock_handイベントが発生する", () => {
    const result = runSwapSim(simpleInput(
      { numFrames: 2, algorithm: "clock" }, 3,
      accessSeq([0, 1, 0, 2]),
    ));
    const allEvents = result.allEvents;
    expect(allEvents.some(e => e.type === "clock_hand")).toBe(true);
  });
});

// ── Optimal置換 ──

describe("Optimal置換", () => {
  it("将来最も遠いページが退避される", () => {
    // VP0,1をロード → VP2アクセス: VP0は直後にアクセス、VP1は遠い → VP1退避
    const result = runSwapSim(simpleInput(
      { numFrames: 2, algorithm: "optimal" }, 4,
      accessSeq([0, 1, 2, 0]),
    ));
    const snap3 = result.snapshots[3]!;
    const resident = snap3.frames.filter(f => !f.free).map(f => f.vpn).sort();
    expect(resident).toEqual([0, 2]);
  });
});

// ── ダーティページ ──

describe("ダーティページ", () => {
  it("書き込みアクセスでdirtyビットが立つ", () => {
    const result = runSwapSim(simpleInput({ numFrames: 4 }, 4, [
      { pid: 1, vpn: 0, type: "write" },
    ]));
    const pte = result.snapshots[1]!.processes[0]!.pageTable[0]!;
    expect(pte.dirty).toBe(true);
  });

  it("ダーティページ退避時にdirty_writebackイベントが発生", () => {
    const result = runSwapSim(simpleInput({ numFrames: 2, algorithm: "fifo" }, 4, [
      { pid: 1, vpn: 0, type: "write" },
      { pid: 1, vpn: 1, type: "read" },
      { pid: 1, vpn: 2, type: "read" }, // VP0(dirty)が退避
    ]));
    expect(result.allEvents.some(e => e.type === "dirty_writeback")).toBe(true);
  });

  it("クリーンページ退避時はdirty_writebackなし", () => {
    const result = runSwapSim(simpleInput({ numFrames: 2, algorithm: "fifo" }, 4, [
      { pid: 1, vpn: 0, type: "read" },
      { pid: 1, vpn: 1, type: "read" },
      { pid: 1, vpn: 2, type: "read" },
    ]));
    // VP0はread-onlyなのでdirty_writebackなし
    const snap3Events = result.snapshots[3]!.events;
    expect(snap3Events.filter(e => e.type === "dirty_writeback")).toHaveLength(0);
  });
});

// ── スワップイン/アウト ──

describe("スワップイン/アウト", () => {
  it("退避されたページが再アクセスでスワップインされる", () => {
    const result = runSwapSim(simpleInput({ numFrames: 2, algorithm: "fifo" }, 4, [
      { pid: 1, vpn: 0, type: "write" },
      { pid: 1, vpn: 1, type: "read" },
      { pid: 1, vpn: 2, type: "read" },  // VP0退避
      { pid: 1, vpn: 0, type: "read" },  // VP0スワップイン
    ]));
    expect(result.allEvents.some(e => e.type === "swap_in")).toBe(true);
    expect(result.allEvents.some(e => e.type === "swap_out")).toBe(true);
  });

  it("スワップスロットにデータが保存される", () => {
    const result = runSwapSim(simpleInput({ numFrames: 2, algorithm: "fifo" }, 4, [
      { pid: 1, vpn: 0, type: "write" },
      { pid: 1, vpn: 1, type: "read" },
      { pid: 1, vpn: 2, type: "read" },
    ]));
    const usedSlots = result.snapshots[3]!.swapSlots.filter(s => s.used);
    expect(usedSlots.length).toBeGreaterThan(0);
  });
});

// ── TLB ──

describe("TLB", () => {
  it("初回アクセスはTLBミス", () => {
    const result = runSwapSim(simpleInput({ tlbSize: 4 }, 4, accessSeq([0])));
    expect(result.snapshots[1]!.events.some(e => e.type === "tlb_miss")).toBe(true);
  });

  it("再アクセスでTLBヒット", () => {
    const result = runSwapSim(simpleInput({ tlbSize: 4 }, 4, accessSeq([0, 0])));
    expect(result.snapshots[2]!.events.some(e => e.type === "tlb_hit")).toBe(true);
  });

  it("TLBにエントリが追加される", () => {
    const result = runSwapSim(simpleInput({ tlbSize: 4 }, 4, accessSeq([0])));
    const validTlb = result.snapshots[1]!.tlb.filter(t => t.valid);
    expect(validTlb).toHaveLength(1);
    expect(validTlb[0]!.vpn).toBe(0);
  });
});

// ── マルチプロセス ──

describe("マルチプロセス", () => {
  it("複数プロセスが物理メモリを共有", () => {
    const input: SimInput = {
      config: { ...defaultConfig(), numFrames: 3 },
      processes: [
        { pid: 1, name: "A", numPages: 3 },
        { pid: 2, name: "B", numPages: 3 },
      ],
      accesses: [
        { pid: 1, vpn: 0, type: "read" },
        { pid: 2, vpn: 0, type: "read" },
        { pid: 1, vpn: 1, type: "read" },
        { pid: 2, vpn: 1, type: "read" },
      ],
    };
    const result = runSwapSim(input);
    const lastSnap = result.snapshots[result.snapshots.length - 1]!;
    const pids = lastSnap.frames.filter(f => !f.free).map(f => f.pid);
    expect(pids).toContain(1);
    expect(pids).toContain(2);
  });
});

// ── スラッシング検出 ──

describe("スラッシング", () => {
  it("ワーキングセット超過で高いフォルト率", () => {
    // 3フレームに5ページを循環アクセス
    const vpns: number[] = [];
    for (let i = 0; i < 15; i++) vpns.push(i % 5);
    const result = runSwapSim(simpleInput({ numFrames: 3, algorithm: "fifo" }, 5, accessSeq(vpns)));
    const lastSnap = result.snapshots[result.snapshots.length - 1]!;
    expect(lastSnap.stats.faultRate).toBeGreaterThan(50);
  });

  it("thrash_detectイベントが発生する", () => {
    const vpns: number[] = [];
    for (let i = 0; i < 15; i++) vpns.push(i % 5);
    const result = runSwapSim(simpleInput({ numFrames: 3, algorithm: "fifo" }, 5, accessSeq(vpns)));
    expect(result.allEvents.some(e => e.type === "thrash_detect")).toBe(true);
  });
});

// ── 統計 ──

describe("統計", () => {
  it("totalAccessesがアクセス数と一致", () => {
    const result = runSwapSim(simpleInput({}, 4, accessSeq([0, 1, 2])));
    const last = result.snapshots[result.snapshots.length - 1]!;
    expect(last.stats.totalAccesses).toBe(3);
  });

  it("pageHits + pageFaults = totalAccesses", () => {
    const result = runSwapSim(simpleInput({ numFrames: 2 }, 4, accessSeq([0, 1, 0, 2, 1])));
    const last = result.snapshots[result.snapshots.length - 1]!;
    expect(last.stats.pageHits + last.stats.pageFaults).toBe(last.stats.totalAccesses);
  });

  it("faultRateが正しく計算される", () => {
    const result = runSwapSim(simpleInput({ numFrames: 4 }, 4, accessSeq([0, 0, 0])));
    const last = result.snapshots[result.snapshots.length - 1]!;
    // 3アクセス中1回ページフォルト (初回のみ)
    expect(last.stats.faultRate).toBeCloseTo(33.3, 0);
  });
});

// ── プリセット ──

describe("PRESETS", () => {
  it("10個のプリセットが定義されている", () => {
    expect(PRESETS).toHaveLength(10);
  });

  it("名前が一意", () => {
    const names = PRESETS.map(p => p.name);
    expect(new Set(names).size).toBe(names.length);
  });

  for (const preset of PRESETS) {
    it(`${preset.name}: 実行可能でスナップショットが生成される`, () => {
      const result = preset.run();
      expect(result.snapshots.length).toBeGreaterThanOrEqual(2);
      expect(result.config).toBeDefined();
    });
  }
});

// ── defaultConfig ──

describe("defaultConfig", () => {
  it("デフォルト設定が返される", () => {
    const config = defaultConfig();
    expect(config.numFrames).toBe(4);
    expect(config.numSwapSlots).toBe(8);
    expect(config.tlbSize).toBe(4);
    expect(config.algorithm).toBe("lru");
  });
});
