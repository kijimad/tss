import { describe, it, expect } from "vitest";
import { DbConnSimulator, createServer, query } from "../engine/dbconn.js";
import { EXPERIMENTS } from "../ui/app.js";
import type { SimConfig, PoolConfig, NetworkConfig } from "../engine/dbconn.js";

const defaultPool: PoolConfig = { minSize: 2, maxSize: 5, acquireTimeout: 5000, idleTimeout: 30000, maxLifetime: 600000, healthCheckInterval: 10000, validationQuery: "SELECT 1" };
const defaultNetwork: NetworkConfig = { rttMs: 10, packetLossRate: 0, dnsLatency: 5, congestionDelay: 0 };

function baseConfig(overrides?: Partial<SimConfig>): SimConfig {
  return {
    servers: [createServer("pg.local", "PostgreSQL")],
    network: defaultNetwork, pool: defaultPool, tlsMode: "require", username: "app",
    queries: [query("SELECT 1", 1, 1, 4)],
    failoverAfterQuery: 0, retryCount: 3, retryDelay: 500,
    ...overrides,
  };
}

// ── createServer ──

describe("createServer", () => {
  it("PostgreSQL のデフォルト値", () => {
    const s = createServer("pg.local", "PostgreSQL");
    expect(s.port).toBe(5432);
    expect(s.engine).toBe("PostgreSQL");
    expect(s.up).toBe(true);
    expect(s.isReplica).toBe(false);
  });

  it("MySQL のデフォルト値", () => {
    expect(createServer("mysql.local", "MySQL").port).toBe(3306);
  });

  it("カスタム値が反映される", () => {
    const s = createServer("r.local", "PostgreSQL", { isReplica: true, replicationLag: 100, maxConnections: 50 });
    expect(s.isReplica).toBe(true);
    expect(s.replicationLag).toBe(100);
    expect(s.maxConnections).toBe(50);
  });
});

// ── query ──

describe("query", () => {
  it("クエリを作成する", () => {
    const q = query("SELECT * FROM t", 5, 10, 500);
    expect(q.sql).toBe("SELECT * FROM t");
    expect(q.isWrite).toBe(false);
    expect(q.inTransaction).toBe(false);
  });

  it("書き込み + トランザクション", () => {
    const q = query("INSERT INTO t VALUES (1)", 3, 0, 0, { write: true, tx: true });
    expect(q.isWrite).toBe(true);
    expect(q.inTransaction).toBe(true);
  });
});

// ── シミュレーター ──

describe("DbConnSimulator", () => {
  it("基本的な接続 + クエリが成功する", () => {
    const sim = new DbConnSimulator();
    const result = sim.simulate(baseConfig());
    expect(result.poolStats.created).toBeGreaterThanOrEqual(2);
    expect(result.queryStats.executed).toBe(1);
    expect(result.queryStats.succeeded).toBe(1);
    expect(result.queryStats.failed).toBe(0);
    expect(result.events.length).toBeGreaterThan(5);
  });

  it("minSize 分の接続がプール初期化で作成される", () => {
    const sim = new DbConnSimulator();
    const result = sim.simulate(baseConfig({ pool: { ...defaultPool, minSize: 4 } }));
    expect(result.poolStats.created).toBeGreaterThanOrEqual(4);
  });

  it("TLS 無効の場合 TLS イベントがない", () => {
    const sim = new DbConnSimulator();
    const result = sim.simulate(baseConfig({ tlsMode: "disable" }));
    expect(result.events.some((e) => e.layer === "TLS")).toBe(false);
  });

  it("TLS 有効の場合 TLS イベントがある", () => {
    const sim = new DbConnSimulator();
    const result = sim.simulate(baseConfig({ tlsMode: "require" }));
    expect(result.events.some((e) => e.layer === "TLS")).toBe(true);
  });

  it("トランザクション内クエリで BEGIN/COMMIT がある", () => {
    const sim = new DbConnSimulator();
    const result = sim.simulate(baseConfig({
      queries: [query("UPDATE t SET x=1", 3, 0, 0, { tx: true, write: true })],
    }));
    expect(result.events.some((e) => e.layer === "Txn" && e.detail.includes("BEGIN"))).toBe(true);
    expect(result.events.some((e) => e.layer === "Txn" && e.detail.includes("COMMIT"))).toBe(true);
  });

  it("レプリカへの書き込みが失敗する", () => {
    const sim = new DbConnSimulator();
    const result = sim.simulate(baseConfig({
      servers: [createServer("r.local", "PostgreSQL", { isReplica: true })],
      queries: [query("INSERT INTO t VALUES (1)", 3, 0, 0, { write: true })],
    }));
    expect(result.queryStats.failed).toBeGreaterThan(0);
  });

  it("プライマリ+レプリカで読み取りがレプリカにルーティングされる", () => {
    const sim = new DbConnSimulator();
    const result = sim.simulate(baseConfig({
      servers: [
        createServer("primary.local", "PostgreSQL"),
        createServer("replica.local", "PostgreSQL", { isReplica: true }),
      ],
      queries: [query("SELECT 1", 1, 1, 4)],
    }));
    // レプリカへの接続が作成されている
    expect(result.connections.some((c) => c.serverId === 1)).toBe(true);
  });

  it("フェイルオーバーが動作する", () => {
    const sim = new DbConnSimulator();
    const result = sim.simulate(baseConfig({
      servers: [
        createServer("primary.local", "PostgreSQL"),
        createServer("replica.local", "PostgreSQL", { isReplica: true }),
      ],
      queries: [
        query("SELECT 1", 1, 1, 4),
        query("SELECT 2", 1, 1, 4),
        query("SELECT 3", 1, 1, 4),
        query("SELECT 4", 1, 1, 4),
      ],
      failoverAfterQuery: 2,
    }));
    expect(result.failoverOccurred).toBe(true);
    expect(result.events.some((e) => e.layer === "Failover")).toBe(true);
  });

  it("ダウンサーバーへの接続が失敗する", () => {
    const sim = new DbConnSimulator();
    const result = sim.simulate(baseConfig({
      servers: [createServer("down.local", "PostgreSQL", { up: false })],
    }));
    expect(result.events.some((e) => e.type === "error")).toBe(true);
  });

  it("max_connections 到達で接続拒否される", () => {
    const sim = new DbConnSimulator();
    const result = sim.simulate(baseConfig({
      servers: [createServer("full.local", "PostgreSQL", { maxConnections: 1, currentConnections: 1 })],
    }));
    expect(result.events.some((e) => e.detail.includes("max_connections"))).toBe(true);
  });

  it("各 DB エンジンの認証メッセージが正しい", () => {
    for (const engine of ["PostgreSQL", "MySQL", "SQL Server", "Oracle"] as const) {
      const sim = new DbConnSimulator();
      const result = sim.simulate(baseConfig({ servers: [createServer("db.local", engine)] }));
      expect(result.events.some((e) => e.layer === "Auth")).toBe(true);
    }
  });

  it("ヘルスチェックが実行される", () => {
    const sim = new DbConnSimulator();
    const result = sim.simulate(baseConfig());
    expect(result.events.some((e) => e.detail.includes("ヘルスチェック"))).toBe(true);
  });

  it("複数クエリが成功する", () => {
    const sim = new DbConnSimulator();
    const result = sim.simulate(baseConfig({
      queries: [
        query("SELECT 1", 1, 1, 4),
        query("SELECT 2", 2, 5, 100),
        query("INSERT INTO t VALUES (1)", 3, 0, 0, { write: true }),
      ],
    }));
    expect(result.queryStats.succeeded).toBe(3);
    expect(result.queryStats.totalRows).toBe(6);
  });
});

// ── プリセット実験 ──

describe("EXPERIMENTS", () => {
  it("8 つのプリセット", () => {
    expect(EXPERIMENTS).toHaveLength(8);
  });

  it("名前が一意", () => {
    expect(new Set(EXPERIMENTS.map((e) => e.name)).size).toBe(EXPERIMENTS.length);
  });

  for (const exp of EXPERIMENTS) {
    it(`${exp.name}: シミュレーション可能`, () => {
      const cfg: SimConfig = { ...exp.config, servers: exp.config.servers.map((s) => ({ ...s })) };
      const sim = new DbConnSimulator();
      const result = sim.simulate(cfg);
      expect(result.events.length).toBeGreaterThan(0);
      expect(result.totalTime).toBeGreaterThan(0);
    });
  }
});
