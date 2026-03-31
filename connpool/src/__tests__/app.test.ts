import { describe, it, expect } from "vitest";
import { EXAMPLES } from "../ui/app.js";
import { ConnectionPool } from "../pool/pool.js";

describe("EXAMPLES 配列", () => {
  it("6 つのサンプルが定義されている", () => {
    expect(EXAMPLES).toHaveLength(6);
  });

  it("各サンプルに必要なフィールドがある", () => {
    for (const ex of EXAMPLES) {
      expect(ex.name.length).toBeGreaterThan(0);
      expect(ex.description.length).toBeGreaterThan(0);
      expect(ex.config.maxSize).toBeGreaterThanOrEqual(ex.config.minSize);
      expect(ex.workload.length).toBeGreaterThan(0);
      expect(ex.totalTicks).toBeGreaterThan(0);
    }
  });

  it("サンプル名が重複していない", () => {
    const names = EXAMPLES.map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("各サンプルのシミュレーション実行", () => {
  for (const ex of EXAMPLES) {
    it(`${ex.name}: ワークロードが正常に実行される`, () => {
      const pool = new ConnectionPool(ex.config);
      const result = pool.runWorkload(ex.workload, ex.totalTicks);
      expect(result.snapshots).toHaveLength(ex.totalTicks);
      expect(result.events.length).toBeGreaterThan(0);
    });

    it(`${ex.name}: 最終スナップショットが存在する`, () => {
      const pool = new ConnectionPool(ex.config);
      const result = pool.runWorkload(ex.workload, ex.totalTicks);
      const last = result.snapshots[result.snapshots.length - 1]!;
      expect(last.tick).toBe(ex.totalTicks);
      expect(typeof last.stats.total).toBe("number");
    });
  }

  it("バースト負荷: キュー待ちが発生する", () => {
    const ex = EXAMPLES[1]!;
    const pool = new ConnectionPool(ex.config);
    const result = pool.runWorkload(ex.workload, ex.totalTicks);
    const hasWaiting = result.snapshots.some((s) => s.stats.waiting > 0);
    expect(hasWaiting).toBe(true);
  });

  it("プール枯渇: タイムアウトが発生する", () => {
    const ex = EXAMPLES[2]!;
    const pool = new ConnectionPool(ex.config);
    const result = pool.runWorkload(ex.workload, ex.totalTicks);
    const last = result.snapshots[result.snapshots.length - 1]!;
    expect(last.stats.timeouts).toBeGreaterThan(0);
  });

  it("アイドルタイムアウト: 接続数が減少する", () => {
    const ex = EXAMPLES[3]!;
    const pool = new ConnectionPool(ex.config);
    const result = pool.runWorkload(ex.workload, ex.totalTicks);
    const maxTotal = Math.max(...result.snapshots.map((s) => s.stats.total));
    const last = result.snapshots[result.snapshots.length - 1]!;
    expect(last.stats.total).toBeLessThan(maxTotal);
  });
});
