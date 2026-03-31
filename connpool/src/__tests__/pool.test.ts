import { describe, it, expect, beforeEach } from "vitest";
import { ConnectionPool } from "../pool/pool.js";
import type { PoolConfig } from "../pool/connection.js";

function defaultConfig(overrides?: Partial<PoolConfig>): PoolConfig {
  return {
    minSize: 2,
    maxSize: 5,
    createTime: 1,
    idleTimeout: 0,
    acquireTimeout: 0,
    maxLifetime: 0,
    errorRate: 0,
    ...overrides,
  };
}

describe("ConnectionPool 基本", () => {
  let pool: ConnectionPool;

  beforeEach(() => {
    pool = new ConnectionPool(defaultConfig());
  });

  it("initialize で minSize 分のコネクション作成が開始される", () => {
    pool.initialize();
    expect(pool.stats.creating).toBe(2);
  });

  it("createTime tick 後にコネクションが idle になる", () => {
    pool.initialize();
    pool.step(); // tick 1: 作成完了 (createTime=1)
    expect(pool.stats.idle).toBe(2);
    expect(pool.stats.creating).toBe(0);
  });

  it("クエリを送信するとコネクションが active になる", () => {
    pool.initialize();
    pool.step();
    pool.submitQuery("SELECT 1", 3);
    expect(pool.stats.active).toBe(1);
    expect(pool.stats.idle).toBe(1);
  });

  it("クエリ完了後にコネクションが idle に戻る", () => {
    pool.initialize();
    pool.step();
    pool.submitQuery("SELECT 1", 2);
    pool.step(); // tick 2: remaining=1
    pool.step(); // tick 3: remaining=0 → idle
    expect(pool.stats.active).toBe(0);
    expect(pool.stats.idle).toBe(2);
    expect(pool.stats.completed).toBe(1);
  });
});

describe("ConnectionPool キュー待ち", () => {
  it("全コネクションが使用中のときキューに入る", () => {
    const pool = new ConnectionPool(defaultConfig({ minSize: 1, maxSize: 2, createTime: 1 }));
    pool.initialize();
    pool.step(); // conn#1 idle
    pool.submitQuery("Q1", 5); // conn#1 active
    // maxSize=2 なので新規作成開始
    pool.submitQuery("Q2", 5); // 作成中 → キュー
    pool.submitQuery("Q3", 5); // maxSize 到達 → キュー
    expect(pool.stats.active).toBe(1);
    expect(pool.stats.waiting).toBeGreaterThanOrEqual(1);
  });

  it("コネクションが解放されるとキューから取り出される", () => {
    const pool = new ConnectionPool(defaultConfig({ minSize: 1, maxSize: 1, createTime: 1 }));
    pool.initialize();
    pool.step();
    pool.submitQuery("Q1", 2);
    pool.submitQuery("Q2", 2); // キュー待ち
    expect(pool.stats.waiting).toBe(1);
    pool.step(); // Q1 remaining=1
    pool.step(); // Q1 完了 → idle → Q2 割り当て
    expect(pool.stats.completed).toBe(1);
    expect(pool.stats.active).toBe(1);
    expect(pool.stats.waiting).toBe(0);
  });
});

describe("ConnectionPool acquireTimeout", () => {
  it("タイムアウトしたリクエストがキューから除外される", () => {
    const pool = new ConnectionPool(
      defaultConfig({ minSize: 1, maxSize: 1, createTime: 1, acquireTimeout: 3 }),
    );
    pool.initialize();
    pool.step();
    pool.submitQuery("LONG", 10);
    pool.submitQuery("WAIT", 2); // キュー待ち
    for (let i = 0; i < 4; i++) pool.step();
    expect(pool.stats.timeouts).toBe(1);
    expect(pool.stats.waiting).toBe(0);
  });
});

describe("ConnectionPool idleTimeout", () => {
  it("アイドル接続が idleTimeout 後に閉じられる", () => {
    const pool = new ConnectionPool(
      defaultConfig({ minSize: 1, maxSize: 3, createTime: 1, idleTimeout: 5 }),
    );
    pool.initialize();
    pool.step(); // 2 idle
    // 追加のコネクションを作成
    pool.submitQuery("Q1", 1);
    pool.submitQuery("Q2", 1);
    pool.submitQuery("Q3", 1);
    for (let i = 0; i < 2; i++) pool.step(); // 全クエリ完了、3 idle
    const before = pool.stats.total;
    for (let i = 0; i < 6; i++) pool.step(); // idleTimeout 超過
    // minSize=1 まで縮小
    expect(pool.stats.total).toBeLessThan(before);
    expect(pool.stats.total).toBeGreaterThanOrEqual(1);
  });
});

describe("ConnectionPool maxLifetime", () => {
  it("古いコネクションが maxLifetime 後に閉じられる", () => {
    const pool = new ConnectionPool(
      defaultConfig({ minSize: 2, maxSize: 4, createTime: 1, maxLifetime: 5 }),
    );
    pool.initialize();
    pool.step(); // 2 idle
    expect(pool.stats.total).toBe(2);
    for (let i = 0; i < 5; i++) pool.step(); // maxLifetime 到達
    expect(pool.stats.total).toBe(0);
  });
});

describe("ConnectionPool errorRate", () => {
  it("エラー率 1.0 で全接続が失敗する", () => {
    const pool = new ConnectionPool(
      defaultConfig({ minSize: 3, maxSize: 3, createTime: 1, errorRate: 1.0 }),
    );
    pool.initialize();
    pool.step();
    expect(pool.stats.errors).toBe(3);
    expect(pool.stats.total).toBe(0);
  });

  it("エラー率 0 で全接続が成功する", () => {
    const pool = new ConnectionPool(
      defaultConfig({ minSize: 3, maxSize: 3, createTime: 1, errorRate: 0 }),
    );
    pool.initialize();
    pool.step();
    expect(pool.stats.errors).toBe(0);
    expect(pool.stats.total).toBe(3);
  });
});

describe("ConnectionPool runWorkload", () => {
  it("ワークロードを実行してスナップショットを返す", () => {
    const pool = new ConnectionPool(defaultConfig());
    const workload = [
      { tick: 3, name: "Q1", duration: 2 },
      { tick: 3, name: "Q2", duration: 2 },
    ];
    const result = pool.runWorkload(workload, 10);
    expect(result.snapshots).toHaveLength(10);
    expect(result.events.length).toBeGreaterThan(0);
    // tick 3 以降にクエリが実行される
    const tick5 = result.snapshots[4]!;
    expect(tick5.stats.completed).toBeGreaterThanOrEqual(0);
  });

  it("全クエリが最終的に完了する", () => {
    const pool = new ConnectionPool(defaultConfig({ minSize: 2, maxSize: 5 }));
    const workload = [
      { tick: 3, name: "Q1", duration: 3 },
      { tick: 3, name: "Q2", duration: 3 },
      { tick: 3, name: "Q3", duration: 3 },
    ];
    const result = pool.runWorkload(workload, 20);
    const last = result.snapshots[result.snapshots.length - 1]!;
    expect(last.stats.completed).toBe(3);
  });
});

describe("イベントログ", () => {
  it("create, acquire, release イベントが記録される", () => {
    const pool = new ConnectionPool(defaultConfig({ minSize: 1, createTime: 1 }));
    pool.initialize();
    pool.step();
    pool.submitQuery("Q1", 1);
    pool.step();
    const types = pool.eventLog.map((e) => e.type);
    expect(types).toContain("create");
    expect(types).toContain("acquire");
    expect(types).toContain("release");
  });
});
