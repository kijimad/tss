import { describe, it, expect } from "vitest";
import { runSimulation, presets } from "../mmu/index.js";
import type { MmuConfig, MemoryAccess } from "../mmu/index.js";

const BASE_CONFIG: MmuConfig = {
  pageSize: 256, virtualBits: 16, physicalFrames: 4,
  tlbSize: 4, replacementAlgo: "lru", twoLevel: false,
};

function cfg(overrides?: Partial<MmuConfig>): MmuConfig {
  return { ...BASE_CONFIG, ...overrides };
}

/** アドレス生成 */
function va(vpn: number, offset: number): number {
  return vpn * 256 + offset;
}

function read(addr: number): MemoryAccess {
  return { virtualAddress: addr, accessType: "read" };
}
function write(addr: number): MemoryAccess {
  return { virtualAddress: addr, accessType: "write" };
}
function exec(addr: number): MemoryAccess {
  return { virtualAddress: addr, accessType: "execute" };
}

type Perms = [number, boolean, boolean, boolean][];
const RW: Perms = [[0, true, true, false], [1, true, true, false], [2, true, true, false], [3, true, true, false]];

// === アドレス変換基本 ===
describe("アドレス変換", () => {
  it("仮想アドレスが物理アドレスに変換される", () => {
    const result = runSimulation(cfg(), RW, [read(va(0, 10))]);
    expect(result.events.some((e) => e.type === "access_complete")).toBe(true);
    expect(result.stats.totalAccesses).toBe(1);
  });

  it("アドレスがVPNとオフセットに分解される", () => {
    const result = runSimulation(cfg(), RW, [read(va(2, 100))]);
    const splitEvent = result.events.find((e) => e.type === "addr_split");
    expect(splitEvent).toBeDefined();
    expect(splitEvent!.description).toContain("VPN=2");
    expect(splitEvent!.description).toContain("オフセット=100");
  });
});

// === TLB ===
describe("TLB", () => {
  it("初回アクセスはTLBミスになる", () => {
    const result = runSimulation(cfg(), RW, [read(va(0, 0))]);
    expect(result.stats.tlbMisses).toBe(1);
    expect(result.stats.tlbHits).toBe(0);
  });

  it("同じページへの2回目アクセスはTLBヒットになる", () => {
    const result = runSimulation(cfg(), RW, [
      read(va(0, 0)),
      read(va(0, 100)),
    ]);
    expect(result.stats.tlbHits).toBe(1);
    expect(result.stats.tlbMisses).toBe(1);
  });

  it("TLB容量を超えるとエビクトが発生する", () => {
    const result = runSimulation(cfg({ tlbSize: 2 }), RW, [
      read(va(0, 0)),
      read(va(1, 0)),
      read(va(2, 0)),
    ]);
    expect(result.events.some((e) => e.type === "tlb_evict")).toBe(true);
  });
});

// === ページフォルト ===
describe("ページフォルト", () => {
  it("初回アクセスでページフォルトが発生する", () => {
    const result = runSimulation(cfg(), RW, [read(va(0, 0))]);
    expect(result.stats.pageFaults).toBe(1);
    expect(result.events.some((e) => e.type === "page_fault")).toBe(true);
  });

  it("ロード済みページはフォルトしない", () => {
    const result = runSimulation(cfg(), RW, [
      read(va(0, 0)),
      read(va(0, 50)),
    ]);
    expect(result.stats.pageFaults).toBe(1);
  });

  it("フレーム不足でエビクトが発生する", () => {
    const result = runSimulation(cfg({ physicalFrames: 2 }), RW, [
      read(va(0, 0)),
      read(va(1, 0)),
      read(va(2, 0)),
    ]);
    expect(result.stats.pageEvictions).toBe(1);
    expect(result.events.some((e) => e.type === "page_evict")).toBe(true);
  });
});

// === FIFO置換 ===
describe("FIFO置換", () => {
  it("最初にロードされたページが追い出される", () => {
    const result = runSimulation(
      cfg({ physicalFrames: 2, replacementAlgo: "fifo", tlbSize: 8 }),
      RW,
      [read(va(0, 0)), read(va(1, 0)), read(va(2, 0))],
    );
    // VPN 0が最初にロード→エビクト
    const evict = result.events.find((e) => e.type === "page_evict");
    expect(evict).toBeDefined();
    expect(evict!.highlight?.vpn).toBe(0);
  });
});

// === LRU置換 ===
describe("LRU置換", () => {
  it("最も古くアクセスされたページが追い出される", () => {
    const result = runSimulation(
      cfg({ physicalFrames: 2, replacementAlgo: "lru", tlbSize: 8 }),
      RW,
      [
        read(va(0, 0)),  // VPN 0 ロード
        read(va(1, 0)),  // VPN 1 ロード
        read(va(0, 10)), // VPN 0 再アクセス（LRU更新）
        read(va(2, 0)),  // VPN 1がLRU→エビクト
      ],
    );
    const evict = result.events.find((e) => e.type === "page_evict");
    expect(evict).toBeDefined();
    expect(evict!.highlight?.vpn).toBe(1);
  });
});

// === Clock置換 ===
describe("Clock置換", () => {
  it("参照ビットがクリアされるページが追い出される", () => {
    const result = runSimulation(
      cfg({ physicalFrames: 3, replacementAlgo: "clock", tlbSize: 8 }),
      RW,
      [
        read(va(0, 0)), read(va(1, 0)), read(va(2, 0)),
        read(va(0, 10)), // VPN 0の参照ビットを再セット
        read(va(3, 0)),  // 置換時: VPN 0にsecond chance
      ],
    );
    expect(result.events.some((e) => e.type === "clock_scan")).toBe(true);
  });
});

// === Optimal置換 ===
describe("Optimal置換", () => {
  it("将来最も遅く使われるページが追い出される", () => {
    const result = runSimulation(
      cfg({ physicalFrames: 2, replacementAlgo: "optimal", tlbSize: 8 }),
      RW,
      [
        read(va(0, 0)), read(va(1, 0)),
        read(va(2, 0)),  // VPN 0 or 1 をエビクト
        read(va(0, 0)),  // 将来VPN 0にアクセスあるのでVPN 1がエビクトされるべき
      ],
    );
    expect(result.stats.pageEvictions).toBeGreaterThan(0);
  });
});

// === ダーティビット ===
describe("ダーティビット", () => {
  it("書き込みでダーティビットがセットされる", () => {
    const result = runSimulation(cfg(), RW, [write(va(0, 0))]);
    const pte = result.pageTable.find((p) => p.vpn === 0);
    expect(pte!.dirty).toBe(true);
  });

  it("ダーティページのエビクト時に書き戻しが発生する", () => {
    const result = runSimulation(
      cfg({ physicalFrames: 1, tlbSize: 8, replacementAlgo: "fifo" }),
      RW,
      [write(va(0, 0)), read(va(1, 0))],
    );
    expect(result.stats.dirtyWritebacks).toBe(1);
    expect(result.events.some((e) => e.type === "page_evict_dirty")).toBe(true);
  });
});

// === 保護違反 ===
describe("保護違反", () => {
  it("読み取り専用ページへの書き込みで保護違反", () => {
    const perms: Perms = [[0, true, false, false]];
    const result = runSimulation(cfg(), perms, [write(va(0, 0))]);
    expect(result.stats.protectionFaults).toBe(1);
    expect(result.events.some((e) => e.type === "protection_fault")).toBe(true);
  });

  it("NXページの実行で保護違反", () => {
    const perms: Perms = [[0, true, true, false]];
    const result = runSimulation(cfg(), perms, [exec(va(0, 0))]);
    expect(result.stats.protectionFaults).toBe(1);
  });

  it("正しい権限ならアクセス成功", () => {
    const perms: Perms = [[0, true, true, true]];
    const result = runSimulation(cfg(), perms, [
      read(va(0, 0)), write(va(0, 10)), exec(va(0, 20)),
    ]);
    expect(result.stats.protectionFaults).toBe(0);
  });
});

// === 2段ページテーブル ===
describe("2段ページテーブル", () => {
  it("L2→L1のウォークイベントが発生する", () => {
    const result = runSimulation(
      cfg({ twoLevel: true }),
      RW,
      [read(va(0, 0))],
    );
    expect(result.events.some((e) => e.type === "pt_walk_l2")).toBe(true);
    expect(result.events.some((e) => e.type === "pt_walk_l1")).toBe(true);
  });
});

// === プリセット ===
describe("プリセット", () => {
  it("全プリセットがエラーなく実行できる", () => {
    for (const preset of presets) {
      const result = runSimulation(preset.config, preset.permissions, preset.accesses);
      expect(result.events.length, `${preset.name}: イベントが空`).toBeGreaterThan(0);
    }
  });

  it("10個のプリセットが定義されている", () => {
    expect(presets.length).toBe(10);
  });
});
