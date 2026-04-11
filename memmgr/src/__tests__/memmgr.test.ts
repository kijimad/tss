import { describe, it, expect } from "vitest";
import {
  createSegmentTable,
  translateSegmentAddress,
  runSegmentSimulation,
  createPageTable,
  translatePageAddress,
  runPagingSimulation,
  splitVirtualAddress,
  splitPhysicalAddress,
  presets,
} from "../mm/index.js";
import type { SegmentEntry, SegmentAddress, PageTableEntry, TlbEntry } from "../mm/index.js";

// ===== セグメント方式 =====

describe("セグメント方式", () => {
  const baseTable: SegmentEntry[] = [
    { id: 0, name: "コード", type: "code", base: 0x1000, limit: 0x0800, readable: true, writable: false, executable: true, present: true },
    { id: 1, name: "データ", type: "data", base: 0x2000, limit: 0x1000, readable: true, writable: true, executable: false, present: true },
    { id: 2, name: "スタック", type: "stack", base: 0x4000, limit: 0x0800, readable: true, writable: true, executable: false, present: true },
  ];

  describe("createSegmentTable", () => {
    it("エントリのコピーを返す", () => {
      const table = createSegmentTable(baseTable);
      expect(table).toHaveLength(3);
      expect(table[0]).not.toBe(baseTable[0]);
      expect(table[0]!.base).toBe(0x1000);
    });
  });

  describe("translateSegmentAddress", () => {
    it("正常なアドレス変換ができる", () => {
      const table = createSegmentTable(baseTable);
      const addr: SegmentAddress = { segment: 0, offset: 0x100 };
      const result = translateSegmentAddress(table, addr, "execute");
      expect(result.success).toBe(true);
      expect(result.physicalAddress).toBe(0x1100); // base(0x1000) + offset(0x100)
    });

    it("データセグメントの読み書きができる", () => {
      const table = createSegmentTable(baseTable);
      const readResult = translateSegmentAddress(table, { segment: 1, offset: 0x0 }, "read");
      expect(readResult.success).toBe(true);
      expect(readResult.physicalAddress).toBe(0x2000);

      const writeResult = translateSegmentAddress(table, { segment: 1, offset: 0x500 }, "write");
      expect(writeResult.success).toBe(true);
      expect(writeResult.physicalAddress).toBe(0x2500);
    });

    it("リミット超過でエラーになる", () => {
      const table = createSegmentTable(baseTable);
      const result = translateSegmentAddress(table, { segment: 0, offset: 0x0800 }, "execute");
      expect(result.success).toBe(false);
      expect(result.error).toContain("limit超過");
    });

    it("コードセグメントへの書き込みでエラーになる", () => {
      const table = createSegmentTable(baseTable);
      const result = translateSegmentAddress(table, { segment: 0, offset: 0x100 }, "write");
      expect(result.success).toBe(false);
      expect(result.error).toContain("書き込み不可");
    });

    it("データセグメントの実行でエラーになる", () => {
      const table = createSegmentTable(baseTable);
      const result = translateSegmentAddress(table, { segment: 1, offset: 0x100 }, "execute");
      expect(result.success).toBe(false);
      expect(result.error).toContain("実行不可");
    });

    it("存在しないセグメントでエラーになる", () => {
      const table = createSegmentTable(baseTable);
      const result = translateSegmentAddress(table, { segment: 99, offset: 0 }, "read");
      expect(result.success).toBe(false);
      expect(result.error).toContain("セグメント不在");
    });

    it("not presentセグメントでフォールトが発生する", () => {
      const table = createSegmentTable([
        { ...baseTable[0]!, present: false },
      ]);
      const result = translateSegmentAddress(table, { segment: 0, offset: 0 }, "read");
      expect(result.success).toBe(false);
      expect(result.error).toContain("not present");
    });

    it("変換過程のステップが記録される", () => {
      const table = createSegmentTable(baseTable);
      const result = translateSegmentAddress(table, { segment: 0, offset: 0x100 }, "execute");
      expect(result.steps.length).toBeGreaterThan(0);
      expect(result.steps.some((s) => s.type === "success")).toBe(true);
    });
  });

  describe("runSegmentSimulation", () => {
    it("複数アクセスのシミュレーションが実行できる", () => {
      const table = createSegmentTable(baseTable);
      const result = runSegmentSimulation(table, [
        { type: "execute", address: 0x100, segment: 0 },
        { type: "read", address: 0x200, segment: 1 },
        { type: "write", address: 0x100, segment: 2 },
      ]);
      expect(result.scheme).toBe("segment");
      expect(result.translations).toHaveLength(3);
      expect(result.stats.totalAccesses).toBe(3);
      expect(result.stats.successCount).toBe(3);
      expect(result.memoryMap.length).toBeGreaterThan(0);
    });

    it("エラーも正しくカウントされる", () => {
      const table = createSegmentTable(baseTable);
      const result = runSegmentSimulation(table, [
        { type: "execute", address: 0x100, segment: 0 },
        { type: "write", address: 0x100, segment: 0 }, // 保護違反
        { type: "read", address: 0xFFFF, segment: 1 }, // リミット超過
      ]);
      expect(result.stats.successCount).toBe(1);
      expect(result.stats.errorCount).toBe(2);
    });
  });
});

// ===== ページ方式 =====

describe("ページ方式", () => {
  const basePageTable: PageTableEntry[] = [
    { pageNumber: 0, frameNumber: 3, present: true, dirty: false, referenced: false, readable: true, writable: true, executable: true },
    { pageNumber: 1, frameNumber: 7, present: true, dirty: false, referenced: false, readable: true, writable: true, executable: false },
    { pageNumber: 2, frameNumber: 1, present: true, dirty: false, referenced: false, readable: true, writable: false, executable: false },
    { pageNumber: 3, frameNumber: 0, present: false, dirty: false, referenced: false, readable: true, writable: true, executable: false },
  ];

  describe("splitVirtualAddress", () => {
    it("仮想アドレスを正しく分解する", () => {
      const va = splitVirtualAddress(0x0310, 256);
      expect(va.pageNumber).toBe(3);
      expect(va.offset).toBe(0x10);
    });

    it("ページ0のアドレスを正しく分解する", () => {
      const va = splitVirtualAddress(0x00FF, 256);
      expect(va.pageNumber).toBe(0);
      expect(va.offset).toBe(0xFF);
    });
  });

  describe("splitPhysicalAddress", () => {
    it("物理アドレスを正しく分解する", () => {
      const pa = splitPhysicalAddress(0x0710, 256);
      expect(pa.frameNumber).toBe(7);
      expect(pa.offset).toBe(0x10);
    });
  });

  describe("createPageTable", () => {
    it("デフォルト値で埋められたエントリを作成する", () => {
      const pt = createPageTable([{ pageNumber: 0, frameNumber: 5, present: true }]);
      expect(pt).toHaveLength(1);
      expect(pt[0]!.readable).toBe(true);
      expect(pt[0]!.writable).toBe(true);
      expect(pt[0]!.executable).toBe(false);
      expect(pt[0]!.dirty).toBe(false);
    });
  });

  describe("translatePageAddress", () => {
    it("TLBミスでページテーブルから変換できる", () => {
      const pt = createPageTable(basePageTable);
      const { result, tlbHit } = translatePageAddress(pt, [], 0x0010, "read", 0);
      expect(result.success).toBe(true);
      expect(result.physicalAddress).toBe(3 * 256 + 0x10); // frame 3
      expect(tlbHit).toBe(false);
    });

    it("TLBヒットで高速変換できる", () => {
      const pt = createPageTable(basePageTable);
      const tlb: TlbEntry[] = [{ pageNumber: 0, frameNumber: 3, lastAccess: 0 }];
      const { result, tlbHit } = translatePageAddress(pt, tlb, 0x0020, "read", 1);
      expect(result.success).toBe(true);
      expect(result.physicalAddress).toBe(3 * 256 + 0x20);
      expect(tlbHit).toBe(true);
    });

    it("ページフォールトが検出される", () => {
      const pt = createPageTable(basePageTable);
      const { result, pageFault } = translatePageAddress(pt, [], 0x0310, "read", 0);
      expect(result.success).toBe(false);
      expect(result.error).toContain("ページフォールト");
      expect(pageFault).toBe(true);
    });

    it("書き込み不可ページへの書き込みでエラーになる", () => {
      const pt = createPageTable(basePageTable);
      const { result } = translatePageAddress(pt, [], 0x0210, "write", 0);
      expect(result.success).toBe(false);
      expect(result.error).toContain("書き込み不可");
    });

    it("存在しないページ番号でエラーになる", () => {
      const pt = createPageTable(basePageTable);
      const { result } = translatePageAddress(pt, [], 0xFF10, "read", 0);
      expect(result.success).toBe(false);
      expect(result.error).toContain("無効なページ番号");
    });

    it("TLBが更新される", () => {
      const pt = createPageTable(basePageTable);
      const { newTlb } = translatePageAddress(pt, [], 0x0010, "read", 0);
      expect(newTlb).toHaveLength(1);
      expect(newTlb[0]!.pageNumber).toBe(0);
      expect(newTlb[0]!.frameNumber).toBe(3);
    });

    it("TLBがLRUで置換される", () => {
      const pt = createPageTable(basePageTable);
      const config = { pageSize: 256, tlbSize: 2, totalFrames: 256 };

      // TLBにページ0とページ1を入れる
      const { newTlb: tlb1 } = translatePageAddress(pt, [], 0x0010, "read", 0, config);
      const { newTlb: tlb2 } = translatePageAddress(pt, tlb1, 0x0110, "read", 1, config);
      expect(tlb2).toHaveLength(2);

      // ページ2をアクセス → LRUでページ0が追い出される
      const { newTlb: tlb3 } = translatePageAddress(pt, tlb2, 0x0210, "read", 2, config);
      expect(tlb3).toHaveLength(2);
      expect(tlb3.find((e) => e.pageNumber === 0)).toBeUndefined();
      expect(tlb3.find((e) => e.pageNumber === 1)).toBeDefined();
      expect(tlb3.find((e) => e.pageNumber === 2)).toBeDefined();
    });
  });

  describe("runPagingSimulation", () => {
    it("複数アクセスのシミュレーションが実行できる", () => {
      const pt = createPageTable(basePageTable);
      const result = runPagingSimulation(pt, [
        { type: "read", address: 0x0010 },
        { type: "read", address: 0x0020 },
        { type: "read", address: 0x0110 },
      ]);
      expect(result.scheme).toBe("paging");
      expect(result.translations).toHaveLength(3);
      expect(result.stats.totalAccesses).toBe(3);
      expect(result.stats.tlbHits).toBe(1); // 2回目のページ0アクセスでヒット
      expect(result.stats.tlbMisses).toBe(2);
    });

    it("ページフォールト数が正しくカウントされる", () => {
      const pt = createPageTable(basePageTable);
      const result = runPagingSimulation(pt, [
        { type: "read", address: 0x0010 },
        { type: "read", address: 0x0310 }, // ページ3はnot present
      ]);
      expect(result.stats.pageFaults).toBe(1);
    });

    it("メモリマップが生成される", () => {
      const pt = createPageTable(basePageTable);
      const result = runPagingSimulation(pt, [{ type: "read", address: 0x0010 }]);
      expect(result.memoryMap.length).toBeGreaterThan(0);
      // presentなフレーム（3, 7, 1）が使用中として表示される
      const usedBlocks = result.memoryMap.filter((b) => b.used);
      expect(usedBlocks).toHaveLength(3);
    });
  });
});

// ===== プリセット =====

describe("プリセット", () => {
  it("全プリセットがエラーなく実行できる", () => {
    for (const preset of presets) {
      if (preset.scheme === "segment" && preset.segmentTable) {
        const table = createSegmentTable(preset.segmentTable);
        const result = runSegmentSimulation(table, preset.accesses);
        expect(result.translations.length, `${preset.name}: 結果が空`).toBeGreaterThan(0);
      } else if (preset.scheme === "paging" && preset.pageTable) {
        const pt = createPageTable(preset.pageTable);
        const result = runPagingSimulation(pt, preset.accesses, preset.pagingConfig);
        expect(result.translations.length, `${preset.name}: 結果が空`).toBeGreaterThan(0);
      }
    }
  });

  it("10個のプリセットが定義されている", () => {
    expect(presets.length).toBe(10);
  });

  it("セグメント方式とページ方式の両方がある", () => {
    const segments = presets.filter((p) => p.scheme === "segment");
    const pages = presets.filter((p) => p.scheme === "paging");
    expect(segments.length).toBeGreaterThan(0);
    expect(pages.length).toBeGreaterThan(0);
  });
});
