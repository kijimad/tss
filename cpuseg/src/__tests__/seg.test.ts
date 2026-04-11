import { describe, it, expect } from "vitest";
import { runSimulation, parseSelector, encodeSelector, effectiveLimit, linearAddress, presets } from "../seg/index.js";
import type { SegmentDescriptor, SegmentSelector, CpuState, PrivilegeLevel } from "../seg/index.js";

// ── ヘルパー ──

function nullDesc(): SegmentDescriptor {
  return { index: 0, name: "NULL", base: 0, limit: 0, type: "null", dpl: 0,
    present: false, granularity: false, readable: false, writable: false, conforming: false, accessed: false };
}
function code(idx: number, name: string, base: number, limit: number, dpl: PrivilegeLevel, opts?: { conforming?: boolean; readable?: boolean }): SegmentDescriptor {
  return { index: idx, name, base, limit, type: "code", dpl, present: true,
    granularity: false, readable: opts?.readable ?? true, writable: false, conforming: opts?.conforming ?? false, accessed: false };
}
function data(idx: number, name: string, base: number, limit: number, dpl: PrivilegeLevel, writable = true): SegmentDescriptor {
  return { index: idx, name, base, limit, type: "data", dpl, present: true,
    granularity: false, readable: true, writable, conforming: false, accessed: false };
}
function stack(idx: number, name: string, base: number, limit: number, dpl: PrivilegeLevel): SegmentDescriptor {
  return { index: idx, name, base, limit, type: "stack", dpl, present: true,
    granularity: false, readable: true, writable: true, conforming: false, accessed: false };
}
function sel(index: number, ti: "gdt" | "ldt" = "gdt", rpl: PrivilegeLevel = 0): SegmentSelector {
  return { index, ti, rpl };
}
function cpu(cpl: PrivilegeLevel, cs: SegmentSelector, ds: SegmentSelector, ss: SegmentSelector): CpuState {
  return { cpl, registers: [
    { name: "CS", selector: cs }, { name: "DS", selector: ds }, { name: "SS", selector: ss },
    { name: "ES", selector: sel(0) }, { name: "FS", selector: sel(0) }, { name: "GS", selector: sel(0) },
  ]};
}

const basicGdt = [nullDesc(), code(1, "Code", 0x1000, 0xFFFF, 0), data(2, "Data", 0x2000, 0xFFFF, 0), stack(3, "Stack", 0x3000, 0, 0)];
const basicCpu = cpu(0, sel(1), sel(2), sel(3));

// === ユーティリティ ===
describe("ユーティリティ", () => {
  it("セレクタをパースできる", () => {
    const s = parseSelector(0x0008); // index=1, TI=GDT, RPL=0
    expect(s.index).toBe(1);
    expect(s.ti).toBe("gdt");
    expect(s.rpl).toBe(0);
  });

  it("セレクタをエンコードできる", () => {
    expect(encodeSelector({ index: 2, ti: "gdt", rpl: 3 })).toBe(0x0013);
    expect(encodeSelector({ index: 1, ti: "ldt", rpl: 0 })).toBe(0x000C);
  });

  it("effectiveLimitがバイト粒度で正しい", () => {
    expect(effectiveLimit({ ...data(0, "", 0, 0xFF, 0), granularity: false })).toBe(0xFF);
  });

  it("effectiveLimitが4KB粒度で正しい", () => {
    expect(effectiveLimit({ ...data(0, "", 0, 0xF, 0), granularity: true })).toBe(0xFFFF);
  });

  it("リニアアドレスが計算できる", () => {
    expect(linearAddress(0x1000, 0x100)).toBe(0x1100);
  });
});

// === 基本的なアドレス変換 ===
describe("アドレス変換", () => {
  it("読み取りが成功する", () => {
    const result = runSimulation(basicGdt, [], basicCpu, [{ type: "read", segReg: "DS", offset: 0x100 }]);
    expect(result.stats.successfulAccesses).toBe(1);
    expect(result.events.some((e) => e.type === "linear_addr")).toBe(true);
  });

  it("書き込みが成功する", () => {
    const result = runSimulation(basicGdt, [], basicCpu, [{ type: "write", segReg: "DS", offset: 0x50 }]);
    expect(result.stats.successfulAccesses).toBe(1);
  });

  it("コード実行が成功する", () => {
    const result = runSimulation(basicGdt, [], basicCpu, [{ type: "execute", segReg: "CS", offset: 0x00 }]);
    expect(result.stats.successfulAccesses).toBe(1);
  });
});

// === リミットチェック ===
describe("リミットチェック", () => {
  it("リミット内のアクセスは成功", () => {
    const gdt = [nullDesc(), code(1, "C", 0, 0xFFFF, 0), data(2, "D", 0, 0x3F, 0), stack(3, "S", 0, 0, 0)];
    const result = runSimulation(gdt, [], basicCpu, [{ type: "read", segReg: "DS", offset: 0x3F }]);
    expect(result.stats.gpFaults).toBe(0);
  });

  it("リミット超過で#GP", () => {
    const gdt = [nullDesc(), code(1, "C", 0, 0xFFFF, 0), data(2, "D", 0, 0x3F, 0), stack(3, "S", 0, 0, 0)];
    const result = runSimulation(gdt, [], basicCpu, [{ type: "read", segReg: "DS", offset: 0x40 }]);
    expect(result.stats.gpFaults).toBe(1);
  });
});

// === 特権レベル ===
describe("特権レベル", () => {
  it("Ring 3からDPL=3セグメントへのアクセスは成功", () => {
    const gdt = [nullDesc(), code(1, "UC", 0, 0xFFFF, 3), data(2, "UD", 0, 0xFFFF, 3), stack(3, "US", 0, 0, 3)];
    const c = cpu(3, sel(1, "gdt", 3), sel(2, "gdt", 3), sel(3, "gdt", 3));
    const result = runSimulation(gdt, [], c, [{ type: "read", segReg: "DS", offset: 0 }]);
    expect(result.stats.gpFaults).toBe(0);
  });

  it("Ring 3からDPL=0セグメントへのロードは#GP", () => {
    const gdt = [nullDesc(), code(1, "UC", 0, 0xFFFF, 3), data(2, "KD", 0, 0xFFFF, 0), stack(3, "US", 0, 0, 3)];
    const c = cpu(3, sel(1, "gdt", 3), sel(1, "gdt", 3), sel(3, "gdt", 3));
    const result = runSimulation(gdt, [], c, [{ type: "load_seg", targetReg: "DS", newSelector: sel(2, "gdt", 3) }]);
    expect(result.stats.gpFaults).toBe(1);
  });
});

// === コンフォーミング ===
describe("コンフォーミング", () => {
  it("コンフォーミングコードは低特権から呼び出し可", () => {
    const gdt = [nullDesc(), code(1, "Conf", 0, 0xFFFF, 0, { conforming: true }),
      code(2, "UC", 0x10000, 0xFFFF, 3), data(3, "UD", 0, 0xFFFF, 3), stack(4, "US", 0, 0, 3)];
    const c = cpu(3, sel(2, "gdt", 3), sel(3, "gdt", 3), sel(4, "gdt", 3));
    const result = runSimulation(gdt, [], c, [{ type: "far_jmp", newSelector: sel(1, "gdt", 3), offset: 0 }]);
    expect(result.stats.gpFaults).toBe(0);
  });

  it("非コンフォーミングコードは低特権から呼び出し不可", () => {
    const gdt = [nullDesc(), code(1, "NonConf", 0, 0xFFFF, 0, { conforming: false }),
      code(2, "UC", 0x10000, 0xFFFF, 3), data(3, "UD", 0, 0xFFFF, 3), stack(4, "US", 0, 0, 3)];
    const c = cpu(3, sel(2, "gdt", 3), sel(3, "gdt", 3), sel(4, "gdt", 3));
    const result = runSimulation(gdt, [], c, [{ type: "far_jmp", newSelector: sel(1, "gdt", 3), offset: 0 }]);
    expect(result.stats.gpFaults).toBe(1);
  });
});

// === コールゲート ===
describe("コールゲート", () => {
  it("コールゲート経由でリング遷移が発生する", () => {
    const gdt = [nullDesc(), code(1, "KC", 0, 0xFFFF, 0),
      code(2, "UC", 0x10000, 0xFFFF, 3), data(3, "UD", 0, 0xFFFF, 3), stack(4, "US", 0, 0, 3),
      { index: 5, name: "Gate", base: 0, limit: 0, type: "call_gate" as const, dpl: 3 as PrivilegeLevel,
        present: true, granularity: false, readable: false, writable: false, conforming: false, accessed: false,
        gateSelector: (1 << 3), gateOffset: 0x100 },
    ];
    const c = cpu(3, sel(2, "gdt", 3), sel(3, "gdt", 3), sel(4, "gdt", 3));
    const result = runSimulation(gdt, [], c, [{ type: "far_call", newSelector: sel(5, "gdt", 3), offset: 0 }]);
    expect(result.stats.ringTransitions).toBe(1);
    expect(result.finalCpu.cpl).toBe(0);
  });
});

// === ヌルセレクタ ===
describe("ヌルセレクタ", () => {
  it("ヌルセレクタでのメモリアクセスは#GP", () => {
    const c = cpu(0, sel(1), sel(0), sel(3)); // DS=ヌル
    const result = runSimulation(basicGdt, [], c, [{ type: "read", segReg: "DS", offset: 0 }]);
    expect(result.stats.gpFaults).toBe(1);
  });

  it("CSにヌルセレクタのロードは#GP", () => {
    const result = runSimulation(basicGdt, [], basicCpu, [{ type: "load_seg", targetReg: "CS", newSelector: sel(0) }]);
    expect(result.stats.gpFaults).toBe(1);
  });

  it("ESにヌルセレクタのロードは許可", () => {
    const result = runSimulation(basicGdt, [], basicCpu, [{ type: "load_seg", targetReg: "ES", newSelector: sel(0) }]);
    expect(result.stats.gpFaults).toBe(0);
    expect(result.events.some((e) => e.type === "null_selector")).toBe(true);
  });
});

// === 非存在セグメント ===
describe("非存在セグメント", () => {
  it("Present=0のセグメントで#NP", () => {
    const gdt = [nullDesc(), code(1, "C", 0, 0xFFFF, 0), data(2, "D", 0, 0xFFFF, 0), stack(3, "S", 0, 0, 0),
      { ...data(4, "NP", 0x5000, 0xFFFF, 0), present: false }];
    const result = runSimulation(gdt, [], basicCpu, [{ type: "load_seg", targetReg: "ES", newSelector: sel(4) }]);
    expect(result.stats.npFaults).toBe(1);
  });
});

// === 種別チェック ===
describe("種別チェック", () => {
  it("コードセグメントへの書き込みは#GP", () => {
    const c = cpu(0, sel(1), sel(1), sel(3)); // DS=コードセグメント
    const result = runSimulation(basicGdt, [], c, [{ type: "write", segReg: "DS", offset: 0 }]);
    expect(result.stats.gpFaults).toBe(1);
  });

  it("読み取り不可コードセグメントの読み取りは#GP", () => {
    const gdt = [nullDesc(), code(1, "ExecOnly", 0, 0xFFFF, 0, { readable: false }), data(2, "D", 0, 0xFFFF, 0), stack(3, "S", 0, 0, 0)];
    const c = cpu(0, sel(1), sel(1), sel(3));
    const result = runSimulation(gdt, [], c, [{ type: "read", segReg: "DS", offset: 0 }]);
    expect(result.stats.gpFaults).toBe(1);
  });

  it("読み取り専用データへの書き込みは#GP", () => {
    const gdt = [nullDesc(), code(1, "C", 0, 0xFFFF, 0), data(2, "RO", 0, 0xFFFF, 0, false), stack(3, "S", 0, 0, 0)];
    const result = runSimulation(gdt, [], basicCpu, [{ type: "write", segReg: "DS", offset: 0 }]);
    expect(result.stats.gpFaults).toBe(1);
  });
});

// === LDT ===
describe("LDT", () => {
  it("LDTのセグメントにアクセスできる", () => {
    const ldt = [code(1, "LC", 0x40000, 0xFFF, 3), data(2, "LD", 0x42000, 0xFFF, 3), stack(3, "LS", 0x50000, 0, 3)];
    const c = cpu(3, sel(1, "ldt", 3), sel(2, "ldt", 3), sel(3, "ldt", 3));
    const result = runSimulation([nullDesc()], ldt, c, [{ type: "read", segReg: "DS", offset: 0x100 }]);
    expect(result.stats.gpFaults).toBe(0);
    expect(result.events.some((e) => e.type === "ldt_lookup")).toBe(true);
  });
});

// === プリセット ===
describe("プリセット", () => {
  it("全プリセットがエラーなく実行できる", () => {
    for (const preset of presets) {
      const result = runSimulation(preset.gdt, preset.ldt, preset.initialCpu, preset.ops);
      expect(result.events.length, `${preset.name}: イベントが空`).toBeGreaterThan(0);
    }
  });

  it("10個のプリセットが定義されている", () => {
    expect(presets.length).toBe(10);
  });
});
