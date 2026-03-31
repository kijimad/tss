import { describe, it, expect } from "vitest";
import { EXAMPLES } from "../ui/app.js";
import { BPlusTree, HashIndex, Table, executeQuery } from "../engine/index.js";

describe("EXAMPLES", () => {
  it("6 つのサンプルが定義されている", () => {
    expect(EXAMPLES).toHaveLength(6);
  });

  it("各サンプルに必要なフィールドがある", () => {
    for (const ex of EXAMPLES) {
      expect(ex.name.length).toBeGreaterThan(0);
      expect(ex.rows.length).toBeGreaterThan(0);
      expect(ex.queryLabel.length).toBeGreaterThan(0);
    }
  });

  it("サンプル名が重複していない", () => {
    const names = EXAMPLES.map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("各サンプルの実行", () => {
  for (const ex of EXAMPLES) {
    it(`${ex.name}: 全プランが実行可能`, () => {
      const table = new Table("users", ex.rows, ex.rowsPerPage);
      const bt = new BPlusTree(ex.btreeOrder);
      bt.buildFromSorted(ex.rows.map((r) => ({ key: r.id, rowId: r.id })));
      const hash = new HashIndex(ex.hashBuckets);
      for (const r of ex.rows) hash.insert(r.id, r.id);

      const { plans } = executeQuery(table, bt, hash, ex.query);
      expect(plans.length).toBeGreaterThanOrEqual(1);
      for (const plan of plans) {
        expect(plan.totalIo).toBeGreaterThan(0);
        expect(plan.trace.length).toBeGreaterThan(0);
      }
    });
  }

  it("200 行の等価検索: B+Tree < Full Scan", () => {
    const ex = EXAMPLES[1]!;
    const table = new Table("users", ex.rows, ex.rowsPerPage);
    const bt = new BPlusTree(ex.btreeOrder);
    bt.buildFromSorted(ex.rows.map((r) => ({ key: r.id, rowId: r.id })));
    const hash = new HashIndex(ex.hashBuckets);
    for (const r of ex.rows) hash.insert(r.id, r.id);

    const { plans } = executeQuery(table, bt, hash, ex.query);
    const scan = plans.find((p) => p.method === "full_scan")!;
    const btree = plans.find((p) => p.method === "btree")!;
    expect(btree.totalIo).toBeLessThan(scan.totalIo);
  });
});
