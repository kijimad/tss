import { describe, it, expect } from "vitest";
import { BPlusTree, HashIndex, Table, executeQuery } from "../engine/index.js";
import type { Row } from "../engine/index.js";

function genRows(n: number): Row[] {
  return Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `u${i + 1}` }));
}

// ── B+Tree ──

describe("BPlusTree", () => {
  it("空の木で検索しても壊れない", () => {
    const bt = new BPlusTree(4);
    const r = bt.searchEq(1);
    expect(r.rowIds).toEqual([]);
  });

  it("等価検索で正しい行 ID を返す", () => {
    const bt = new BPlusTree(4);
    const entries = genRows(20).map((r) => ({ key: r.id as number, rowId: r.id as number }));
    bt.buildFromSorted(entries);
    const r = bt.searchEq(10);
    expect(r.rowIds).toEqual([10]);
    expect(r.trace.length).toBeGreaterThan(0);
  });

  it("存在しないキーは空配列を返す", () => {
    const bt = new BPlusTree(4);
    bt.buildFromSorted(genRows(20).map((r) => ({ key: r.id as number, rowId: r.id as number })));
    expect(bt.searchEq(999).rowIds).toEqual([]);
  });

  it("範囲検索で正しい行 ID 群を返す", () => {
    const bt = new BPlusTree(4);
    bt.buildFromSorted(genRows(30).map((r) => ({ key: r.id as number, rowId: r.id as number })));
    const r = bt.searchRange(10, 15);
    expect(r.rowIds).toEqual([10, 11, 12, 13, 14, 15]);
  });

  it("Full Scan より I/O が少ない (等価検索)", () => {
    const bt = new BPlusTree(4);
    bt.buildFromSorted(genRows(100).map((r) => ({ key: r.id as number, rowId: r.id as number })));
    const table = new Table("t", genRows(100), 10);

    const btResult = bt.searchEq(50);
    const scanResult = table.fullScan({ type: "eq", column: "id", value: 50 });
    expect(btResult.trace.length).toBeLessThan(scanResult.trace.length);
  });

  it("toPages でページ一覧を返す", () => {
    const bt = new BPlusTree(4);
    bt.buildFromSorted(genRows(20).map((r) => ({ key: r.id as number, rowId: r.id as number })));
    const pages = bt.toPages();
    expect(pages.length).toBeGreaterThan(0);
    expect(pages.some((p) => p.type === "leaf")).toBe(true);
  });
});

// ── Hash Index ──

describe("HashIndex", () => {
  it("等価検索で正しい行 ID を返す", () => {
    const hash = new HashIndex(8);
    for (const r of genRows(20)) hash.insert(r.id as number, r.id as number);
    const result = hash.searchEq(10);
    expect(result.rowIds).toEqual([10]);
    expect(result.trace).toHaveLength(1);
  });

  it("存在しないキーは空配列を返す", () => {
    const hash = new HashIndex(8);
    for (const r of genRows(20)) hash.insert(r.id as number, r.id as number);
    expect(hash.searchEq(999).rowIds).toEqual([]);
  });

  it("Hash は常に 1 I/O", () => {
    const hash = new HashIndex(8);
    for (const r of genRows(100)) hash.insert(r.id as number, r.id as number);
    expect(hash.searchEq(50).trace).toHaveLength(1);
  });

  it("バケット数が少ないと衝突が増える", () => {
    const hash4 = new HashIndex(4);
    const hash16 = new HashIndex(16);
    for (const r of genRows(100)) {
      hash4.insert(r.id as number, r.id as number);
      hash16.insert(r.id as number, r.id as number);
    }
    const c4 = hash4.searchEq(50).comparisons;
    const c16 = hash16.searchEq(50).comparisons;
    expect(c4).toBeGreaterThanOrEqual(c16);
  });
});

// ── Table Full Scan ──

describe("Table Full Scan", () => {
  it("全行を返す", () => {
    const table = new Table("t", genRows(20), 5);
    const r = table.fullScan({ type: "full" });
    expect(r.resultRows).toHaveLength(20);
    expect(r.trace).toHaveLength(4);
  });

  it("等価検索で 1 行を返す", () => {
    const table = new Table("t", genRows(20), 5);
    const r = table.fullScan({ type: "eq", column: "id", value: 10 });
    expect(r.resultRows).toHaveLength(1);
    expect(r.resultRows[0]!.id).toBe(10);
  });

  it("全ページを走査する", () => {
    const table = new Table("t", genRows(50), 10);
    const r = table.fullScan({ type: "eq", column: "id", value: 1 });
    expect(r.trace).toHaveLength(5);
  });
});

// ── executeQuery ──

describe("executeQuery", () => {
  it("等価検索で 3 プランを返す", () => {
    const rows = genRows(50);
    const table = new Table("t", rows, 10);
    const bt = new BPlusTree(4);
    bt.buildFromSorted(rows.map((r) => ({ key: r.id as number, rowId: r.id as number })));
    const hash = new HashIndex(8);
    for (const r of rows) hash.insert(r.id as number, r.id as number);

    const { plans } = executeQuery(table, bt, hash, { type: "eq", column: "id", value: 25 });
    expect(plans).toHaveLength(3);
    expect(plans.map((p) => p.method)).toEqual(["full_scan", "btree", "hash"]);
  });

  it("範囲検索で 2 プランを返す (Hash なし)", () => {
    const rows = genRows(50);
    const table = new Table("t", rows, 10);
    const bt = new BPlusTree(4);
    bt.buildFromSorted(rows.map((r) => ({ key: r.id as number, rowId: r.id as number })));
    const hash = new HashIndex(8);

    const { plans } = executeQuery(table, bt, hash, { type: "range", column: "id", from: 10, to: 20 });
    expect(plans).toHaveLength(2);
    expect(plans.map((p) => p.method)).toEqual(["full_scan", "btree"]);
  });

  it("全プランが同じ結果行数を返す", () => {
    const rows = genRows(50);
    const table = new Table("t", rows, 10);
    const bt = new BPlusTree(4);
    bt.buildFromSorted(rows.map((r) => ({ key: r.id as number, rowId: r.id as number })));
    const hash = new HashIndex(8);
    for (const r of rows) hash.insert(r.id as number, r.id as number);

    const { plans } = executeQuery(table, bt, hash, { type: "eq", column: "id", value: 25 });
    const counts = plans.map((p) => p.resultRows.length);
    expect(new Set(counts).size).toBe(1);
  });
});
