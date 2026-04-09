import { describe, it, expect } from "vitest";
import {
  ipHash, loadLatency, estimateCpu,
  TargetSelector, HealthChecker, ElbSimulator,
  createServers, generateUniformRequests, generateBurstRequests,
} from "../engine/elb.js";
import { EXPERIMENTS } from "../ui/app.js";
import type { ElbConfig, ServerState, Request } from "../engine/elb.js";

// ── ユーティリティ関数 ──

describe("ipHash", () => {
  it("同じ IP は同じインデックスを返す", () => {
    const idx1 = ipHash("10.0.1.1", 3);
    const idx2 = ipHash("10.0.1.1", 3);
    expect(idx1).toBe(idx2);
  });

  it("戻り値がサーバー数未満", () => {
    for (const ip of ["10.0.1.1", "192.168.1.10", "172.16.0.5"]) {
      expect(ipHash(ip, 5)).toBeLessThan(5);
      expect(ipHash(ip, 5)).toBeGreaterThanOrEqual(0);
    }
  });

  it("異なる IP は異なるインデックスになりやすい", () => {
    const indices = new Set<number>();
    for (let i = 0; i < 20; i++) {
      indices.add(ipHash(`10.0.${i}.${i * 7}`, 10));
    }
    // 完全な分散は保証できないが複数のインデックスに分散するはず
    expect(indices.size).toBeGreaterThan(1);
  });
});

describe("loadLatency", () => {
  it("接続ゼロでは基本レイテンシを返す", () => {
    const server = createServers([{ name: "test", baseLatency: 50 }])[0]!;
    server.activeConnections = 0;
    expect(loadLatency(server)).toBe(50);
  });

  it("接続が増えるとレイテンシが増加する", () => {
    const server = createServers([{ name: "test", baseLatency: 50, maxConnections: 100 }])[0]!;
    server.activeConnections = 0;
    const low = loadLatency(server);
    server.activeConnections = 50;
    const mid = loadLatency(server);
    server.activeConnections = 90;
    const high = loadLatency(server);
    expect(mid).toBeGreaterThan(low);
    expect(high).toBeGreaterThan(mid);
  });
});

describe("estimateCpu", () => {
  it("0〜1 の範囲を返す", () => {
    const server = createServers([{ name: "test", maxConnections: 100 }])[0]!;
    for (const conn of [0, 10, 50, 100]) {
      server.activeConnections = conn;
      const cpu = estimateCpu(server);
      expect(cpu).toBeGreaterThanOrEqual(0);
      expect(cpu).toBeLessThanOrEqual(1);
    }
  });
});

// ── ターゲット選択 ──

describe("TargetSelector", () => {
  const makeServers = () => createServers([
    { name: "s1", baseLatency: 50 },
    { name: "s2", baseLatency: 50 },
    { name: "s3", baseLatency: 50 },
  ]);

  const makeRequest = (id: number, ip = "10.0.1.1"): Request => ({
    id, sourceIp: ip, path: "/api", arrivalTime: id * 100,
  });

  it("roundRobin は順番に選択する", () => {
    const selector = new TargetSelector();
    const servers = makeServers();
    const ids = [];
    for (let i = 0; i < 6; i++) {
      ids.push(selector.roundRobin(servers)?.id);
    }
    expect(ids).toEqual(["server-1", "server-2", "server-3", "server-1", "server-2", "server-3"]);
  });

  it("leastConnections は最少接続のサーバーを選ぶ", () => {
    const selector = new TargetSelector();
    const servers = makeServers();
    servers[0]!.activeConnections = 10;
    servers[1]!.activeConnections = 2;
    servers[2]!.activeConnections = 5;
    const target = selector.leastConnections(servers);
    expect(target?.id).toBe("server-2");
  });

  it("ipHash は同じ IP に対して同じサーバーを返す", () => {
    const selector = new TargetSelector();
    const servers = makeServers();
    const t1 = selector.ipHashSelect(servers, "10.0.1.1");
    const t2 = selector.ipHashSelect(servers, "10.0.1.1");
    expect(t1?.id).toBe(t2?.id);
  });

  it("全サーバー異常なら undefined を返す", () => {
    const selector = new TargetSelector();
    const servers = makeServers();
    for (const s of servers) s.healthy = false;
    expect(selector.roundRobin(servers)).toBeUndefined();
    expect(selector.leastConnections(servers)).toBeUndefined();
    expect(selector.random(servers)).toBeUndefined();
  });

  it("select が各アルゴリズムで動作する", () => {
    const selector = new TargetSelector();
    const servers = makeServers();
    const req = makeRequest(1);
    const algorithms: Array<"round-robin" | "weighted-round-robin" | "least-connections" | "least-response-time" | "ip-hash" | "random"> = [
      "round-robin", "weighted-round-robin", "least-connections", "least-response-time", "ip-hash", "random",
    ];
    for (const alg of algorithms) {
      selector.reset();
      const target = selector.select(alg, servers, req);
      expect(target).toBeDefined();
    }
  });
});

// ── ヘルスチェッカー ──

describe("HealthChecker", () => {
  const hcConfig = { interval: 500, unhealthyThreshold: 2, healthyThreshold: 2, timeout: 100 };

  it("正常なサーバーに対して OK イベントを返す", () => {
    const checker = new HealthChecker();
    const server = createServers([{ name: "s1" }])[0]!;
    const events = checker.check(server, hcConfig, 0);
    expect(events.length).toBe(1);
    expect(events[0]!.type).toBe("health_check");
    expect(events[0]!.detail).toContain("OK");
  });

  it("過負荷サーバーを連続失敗で異常判定する", () => {
    const checker = new HealthChecker();
    const server = createServers([{ name: "s1", maxConnections: 10 }])[0]!;
    server.cpuUsage = 0.99;
    checker.check(server, hcConfig, 0);
    const events = checker.check(server, hcConfig, 500);
    // 2回連続失敗で異常判定
    expect(events.some((e) => e.type === "server_down")).toBe(true);
    expect(server.healthy).toBe(false);
  });

  it("復帰時に server_up イベントを発行する", () => {
    const checker = new HealthChecker();
    const server = createServers([{ name: "s1", maxConnections: 10 }])[0]!;
    server.cpuUsage = 0.99;
    checker.check(server, hcConfig, 0);
    checker.check(server, hcConfig, 500);
    expect(server.healthy).toBe(false);

    // 正常に戻す
    server.cpuUsage = 0.3;
    server.activeConnections = 0;
    checker.check(server, hcConfig, 1000);
    const events = checker.check(server, hcConfig, 1500);
    expect(events.some((e) => e.type === "server_up")).toBe(true);
    expect(server.healthy).toBe(true);
  });
});

// ── ELB シミュレーター ──

describe("ElbSimulator", () => {
  const defaultConfig: ElbConfig = {
    algorithm: "round-robin",
    healthCheck: { interval: 500, unhealthyThreshold: 3, healthyThreshold: 2, timeout: 100 },
    network: { clientLatency: 5, serverLatency: 3, packetLossRate: 0, bandwidth: 500 },
    stickySession: false,
    drainingTimeout: 300,
  };

  it("基本的なシミュレーションが完了する", () => {
    const sim = new ElbSimulator();
    const servers = createServers([{ name: "s1" }, { name: "s2" }]);
    const requests = generateUniformRequests(10, 100);
    const result = sim.simulate(servers, requests, defaultConfig);

    expect(result.totalRequests).toBe(10);
    expect(result.responses.length).toBe(10);
    expect(result.droppedRequests).toBe(0);
    expect(result.avgResponseTime).toBeGreaterThan(0);
    expect(result.events.length).toBeGreaterThan(0);
  });

  it("Round Robin で均等に分散する", () => {
    const sim = new ElbSimulator();
    const servers = createServers([{ name: "s1" }, { name: "s2" }, { name: "s3" }]);
    const requests = generateUniformRequests(30, 100);
    const result = sim.simulate(servers, requests, defaultConfig);

    // 各サーバーが 10 リクエストずつ受ける
    expect(result.distribution.get("server-1")).toBe(10);
    expect(result.distribution.get("server-2")).toBe(10);
    expect(result.distribution.get("server-3")).toBe(10);
  });

  it("全サーバーダウン時はリクエストがドロップされる", () => {
    const sim = new ElbSimulator();
    const servers = createServers([{ name: "s1" }, { name: "s2" }]);
    for (const s of servers) s.healthy = false;
    const requests = generateUniformRequests(5, 100);
    const result = sim.simulate(servers, requests, defaultConfig);

    expect(result.droppedRequests).toBe(5);
    expect(result.responses.length).toBe(0);
  });

  it("パケットロスが発生する", () => {
    const sim = new ElbSimulator();
    const servers = createServers([{ name: "s1" }]);
    const requests = generateUniformRequests(100, 50);
    const lossyConfig = {
      ...defaultConfig,
      network: { ...defaultConfig.network, packetLossRate: 0.5 },
    };
    const result = sim.simulate(servers, requests, lossyConfig);
    // 50% のパケットロスなので全部は成功しない (確率的なので緩い条件)
    expect(result.droppedRequests).toBeGreaterThan(0);
    expect(result.responses.length).toBeLessThan(100);
  });
});

// ── リクエスト生成ヘルパー ──

describe("generateUniformRequests", () => {
  it("指定数のリクエストを生成する", () => {
    const reqs = generateUniformRequests(20, 50);
    expect(reqs).toHaveLength(20);
  });

  it("均等間隔で到着する", () => {
    const reqs = generateUniformRequests(5, 100);
    expect(reqs[0]!.arrivalTime).toBe(0);
    expect(reqs[1]!.arrivalTime).toBe(100);
    expect(reqs[4]!.arrivalTime).toBe(400);
  });

  it("各リクエストに一意の ID が付く", () => {
    const reqs = generateUniformRequests(10, 50);
    const ids = new Set(reqs.map((r) => r.id));
    expect(ids.size).toBe(10);
  });
});

describe("generateBurstRequests", () => {
  it("通常 + バースト合計数のリクエストを生成する", () => {
    const reqs = generateBurstRequests(10, 20, 100, 1000);
    expect(reqs).toHaveLength(30);
  });

  it("時系列順にソートされている", () => {
    const reqs = generateBurstRequests(10, 20, 100, 500);
    for (let i = 1; i < reqs.length; i++) {
      expect(reqs[i]!.arrivalTime).toBeGreaterThanOrEqual(reqs[i - 1]!.arrivalTime);
    }
  });
});

describe("createServers", () => {
  it("指定数のサーバーを生成する", () => {
    const servers = createServers([{ name: "a" }, { name: "b" }]);
    expect(servers).toHaveLength(2);
    expect(servers[0]!.id).toBe("server-1");
    expect(servers[1]!.id).toBe("server-2");
  });

  it("初期状態が正常", () => {
    const servers = createServers([{ name: "a" }]);
    expect(servers[0]!.healthy).toBe(true);
    expect(servers[0]!.activeConnections).toBe(0);
    expect(servers[0]!.totalRequests).toBe(0);
  });

  it("カスタム値が反映される", () => {
    const servers = createServers([{ name: "x", weight: 5, baseLatency: 100, maxConnections: 200 }]);
    expect(servers[0]!.weight).toBe(5);
    expect(servers[0]!.baseLatency).toBe(100);
    expect(servers[0]!.maxConnections).toBe(200);
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
      const sim = new ElbSimulator();
      const servers = exp.servers.map((s) => ({ ...s }));
      const requests = exp.requests.map((r) => ({ ...r }));
      const result = sim.simulate(servers, requests, exp.config);
      expect(result.events.length).toBeGreaterThan(0);
      expect(result.totalRequests).toBeGreaterThan(0);
    });
  }
});
