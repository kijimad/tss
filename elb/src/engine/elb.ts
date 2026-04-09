/**
 * elb.ts — Elastic Load Balancer エミュレーションエンジン
 *
 * ハードウェア・ネットワークをコードで表現し、
 * 各種ロードバランシングアルゴリズムをシミュレーションする。
 *
 * パイプライン:
 *   リクエスト受信 → ヘルスチェック → ターゲット選択 →
 *   ネットワーク遅延 → サーバー処理 → レスポンス返却
 */

// ── 基本型 ──

/** サーバーの状態 */
export interface ServerState {
  id: string;
  /** サーバー名 */
  name: string;
  /** サーバーの重み (Weighted Round Robin 用) */
  weight: number;
  /** 現在のアクティブ接続数 */
  activeConnections: number;
  /** CPU 使用率 (0.0〜1.0) */
  cpuUsage: number;
  /** メモリ使用率 (0.0〜1.0) */
  memoryUsage: number;
  /** 基本レスポンスタイム (ms) */
  baseLatency: number;
  /** サーバーが正常かどうか */
  healthy: boolean;
  /** 処理したリクエスト総数 */
  totalRequests: number;
  /** 処理能力 (同時接続上限) */
  maxConnections: number;
}

/** リクエスト */
export interface Request {
  id: number;
  /** 送信元 IP */
  sourceIp: string;
  /** リクエストパス */
  path: string;
  /** リクエスト到着時刻 (ms) */
  arrivalTime: number;
}

/** レスポンス */
export interface Response {
  requestId: number;
  serverId: string;
  /** ステータスコード */
  statusCode: number;
  /** 実際のレスポンスタイム (ms) */
  responseTime: number;
  /** リクエスト到着時刻 */
  arrivalTime: number;
  /** レスポンス完了時刻 */
  completionTime: number;
}

/** ロードバランシングアルゴリズム */
export type Algorithm =
  | "round-robin"
  | "weighted-round-robin"
  | "least-connections"
  | "least-response-time"
  | "ip-hash"
  | "random";

/** ヘルスチェック設定 */
export interface HealthCheckConfig {
  /** チェック間隔 (ms) */
  interval: number;
  /** 異常判定の閾値 (連続失敗回数) */
  unhealthyThreshold: number;
  /** 正常復帰の閾値 (連続成功回数) */
  healthyThreshold: number;
  /** タイムアウト (ms) */
  timeout: number;
}

/** ネットワーク設定 */
export interface NetworkConfig {
  /** ELB ↔ クライアント間のレイテンシ (ms) */
  clientLatency: number;
  /** ELB ↔ サーバー間のレイテンシ (ms) */
  serverLatency: number;
  /** パケットロス率 (0.0〜1.0) */
  packetLossRate: number;
  /** 帯域幅上限 (同時リクエスト数) */
  bandwidth: number;
}

/** ELB 設定 */
export interface ElbConfig {
  algorithm: Algorithm;
  healthCheck: HealthCheckConfig;
  network: NetworkConfig;
  /** スティッキーセッション有効 */
  stickySession: boolean;
  /** 接続ドレイニング待機時間 (ms) */
  drainingTimeout: number;
}

/** シミュレーション全体のイベントログ */
export interface SimEvent {
  time: number;
  type: "request_in" | "health_check" | "route" | "server_process" | "response" | "server_down" | "server_up" | "drop";
  detail: string;
  serverId?: string;
  requestId?: number;
}

/** シミュレーション結果 */
export interface SimulationResult {
  events: SimEvent[];
  responses: Response[];
  /** サーバーごとの最終状態 */
  finalServerStates: ServerState[];
  /** サーバーごとのリクエスト分布 */
  distribution: Map<string, number>;
  /** 平均レスポンスタイム */
  avgResponseTime: number;
  /** 最大レスポンスタイム */
  maxResponseTime: number;
  /** ドロップされたリクエスト数 */
  droppedRequests: number;
  /** 総リクエスト数 */
  totalRequests: number;
  /** シミュレーション時間 (ms) */
  totalTime: number;
  /** サーバーごとのリクエスト履歴 (時系列) */
  serverTimeline: Map<string, { time: number; connections: number; cpu: number }[]>;
}

// ── ユーティリティ ──

/** IP アドレスからハッシュ値を計算する */
export function ipHash(ip: string, serverCount: number): number {
  let hash = 0;
  for (let i = 0; i < ip.length; i++) {
    const ch = ip.charCodeAt(i);
    hash = ((hash << 5) - hash + ch) | 0;
  }
  return Math.abs(hash) % serverCount;
}

/** 負荷に応じた追加レイテンシを計算する */
export function loadLatency(server: ServerState): number {
  const connectionRatio = server.activeConnections / server.maxConnections;
  // 負荷が高いほどレイテンシが指数的に増加
  return server.baseLatency * (1 + Math.pow(connectionRatio, 2) * 3);
}

/** CPU 使用率を接続数から推定する */
export function estimateCpu(server: ServerState): number {
  const ratio = server.activeConnections / server.maxConnections;
  return Math.min(1.0, ratio * 0.8 + Math.random() * 0.1);
}

// ── ターゲット選択アルゴリズム ──

export class TargetSelector {
  private rrIndex = 0;
  private wrrIndex = 0;
  private wrrCounter = 0;

  /** Round Robin */
  roundRobin(servers: ServerState[]): ServerState | undefined {
    const healthy = servers.filter((s) => s.healthy);
    if (healthy.length === 0) return undefined;
    const target = healthy[this.rrIndex % healthy.length]!;
    this.rrIndex++;
    return target;
  }

  /** Weighted Round Robin */
  weightedRoundRobin(servers: ServerState[]): ServerState | undefined {
    const healthy = servers.filter((s) => s.healthy);
    if (healthy.length === 0) return undefined;

    while (true) {
      const server = healthy[this.wrrIndex % healthy.length]!;
      if (this.wrrCounter < server.weight) {
        this.wrrCounter++;
        return server;
      }
      this.wrrCounter = 0;
      this.wrrIndex++;
      if (this.wrrIndex >= healthy.length) this.wrrIndex = 0;
    }
  }

  /** Least Connections */
  leastConnections(servers: ServerState[]): ServerState | undefined {
    const healthy = servers.filter((s) => s.healthy);
    if (healthy.length === 0) return undefined;
    return healthy.reduce((min, s) => (s.activeConnections < min.activeConnections ? s : min));
  }

  /** Least Response Time */
  leastResponseTime(servers: ServerState[]): ServerState | undefined {
    const healthy = servers.filter((s) => s.healthy);
    if (healthy.length === 0) return undefined;
    return healthy.reduce((min, s) => {
      const sTime = loadLatency(s);
      const minTime = loadLatency(min);
      return sTime < minTime ? s : min;
    });
  }

  /** IP Hash */
  ipHashSelect(servers: ServerState[], ip: string): ServerState | undefined {
    const healthy = servers.filter((s) => s.healthy);
    if (healthy.length === 0) return undefined;
    const idx = ipHash(ip, healthy.length);
    return healthy[idx];
  }

  /** Random */
  random(servers: ServerState[]): ServerState | undefined {
    const healthy = servers.filter((s) => s.healthy);
    if (healthy.length === 0) return undefined;
    return healthy[Math.floor(Math.random() * healthy.length)];
  }

  /** アルゴリズムに応じてターゲットを選択する */
  select(algorithm: Algorithm, servers: ServerState[], request: Request): ServerState | undefined {
    switch (algorithm) {
      case "round-robin": return this.roundRobin(servers);
      case "weighted-round-robin": return this.weightedRoundRobin(servers);
      case "least-connections": return this.leastConnections(servers);
      case "least-response-time": return this.leastResponseTime(servers);
      case "ip-hash": return this.ipHashSelect(servers, request.sourceIp);
      case "random": return this.random(servers);
    }
  }

  /** 内部状態をリセットする */
  reset(): void {
    this.rrIndex = 0;
    this.wrrIndex = 0;
    this.wrrCounter = 0;
  }
}

// ── ヘルスチェッカー ──

export class HealthChecker {
  private failCounts: Map<string, number> = new Map();
  private successCounts: Map<string, number> = new Map();

  /** ヘルスチェックを実行する */
  check(server: ServerState, config: HealthCheckConfig, time: number): SimEvent[] {
    const events: SimEvent[] = [];
    // CPU が高すぎるか接続が上限に達している場合は異常
    const isResponding = server.cpuUsage < 0.95 && server.activeConnections < server.maxConnections;

    if (isResponding) {
      this.failCounts.set(server.id, 0);
      const successes = (this.successCounts.get(server.id) ?? 0) + 1;
      this.successCounts.set(server.id, successes);

      if (!server.healthy && successes >= config.healthyThreshold) {
        server.healthy = true;
        events.push({ time, type: "server_up", detail: `${server.name} が正常復帰 (${successes}回連続成功)`, serverId: server.id });
      } else {
        events.push({ time, type: "health_check", detail: `${server.name} OK (CPU: ${(server.cpuUsage * 100).toFixed(0)}%, Conn: ${server.activeConnections})`, serverId: server.id });
      }
    } else {
      this.successCounts.set(server.id, 0);
      const fails = (this.failCounts.get(server.id) ?? 0) + 1;
      this.failCounts.set(server.id, fails);

      if (server.healthy && fails >= config.unhealthyThreshold) {
        server.healthy = false;
        events.push({ time, type: "server_down", detail: `${server.name} が異常判定 (${fails}回連続失敗)`, serverId: server.id });
      } else {
        events.push({ time, type: "health_check", detail: `${server.name} FAIL (CPU: ${(server.cpuUsage * 100).toFixed(0)}%, Conn: ${server.activeConnections})`, serverId: server.id });
      }
    }
    return events;
  }

  reset(): void {
    this.failCounts.clear();
    this.successCounts.clear();
  }
}

// ── ELB シミュレーター ──

export class ElbSimulator {
  private selector = new TargetSelector();
  private healthChecker = new HealthChecker();

  /** シミュレーションを実行する */
  simulate(
    servers: ServerState[],
    requests: Request[],
    config: ElbConfig,
  ): SimulationResult {
    this.selector.reset();
    this.healthChecker.reset();

    const events: SimEvent[] = [];
    const responses: Response[] = [];
    const distribution = new Map<string, number>();
    const serverTimeline = new Map<string, { time: number; connections: number; cpu: number }[]>();

    // タイムラインの初期化
    for (const s of servers) {
      distribution.set(s.id, 0);
      serverTimeline.set(s.id, []);
    }

    let droppedRequests = 0;
    let lastHealthCheck = 0;

    // 完了予定のリクエストキュー (時刻順)
    const pendingCompletions: { time: number; serverId: string; requestId: number; responseTime: number; arrivalTime: number }[] = [];

    for (const req of requests) {
      // 完了予定のリクエストを処理する (現在時刻以前のもの)
      this.processCompletions(pendingCompletions, req.arrivalTime, servers, events, responses, serverTimeline);

      // ヘルスチェック
      if (req.arrivalTime - lastHealthCheck >= config.healthCheck.interval) {
        for (const s of servers) {
          const hcEvents = this.healthChecker.check(s, config.healthCheck, req.arrivalTime);
          events.push(...hcEvents);
        }
        lastHealthCheck = req.arrivalTime;
      }

      events.push({ time: req.arrivalTime, type: "request_in", detail: `リクエスト #${req.id} (${req.sourceIp} → ${req.path})`, requestId: req.id });

      // ターゲット選択
      const target = this.selector.select(config.algorithm, servers, req);
      if (target === undefined) {
        events.push({ time: req.arrivalTime, type: "drop", detail: `リクエスト #${req.id} ドロップ: 利用可能なサーバーなし`, requestId: req.id });
        droppedRequests++;
        continue;
      }

      // パケットロス判定
      if (Math.random() < config.network.packetLossRate) {
        events.push({ time: req.arrivalTime, type: "drop", detail: `リクエスト #${req.id} パケットロス`, requestId: req.id });
        droppedRequests++;
        continue;
      }

      // 帯域幅チェック
      const totalActive = servers.reduce((sum, s) => sum + s.activeConnections, 0);
      if (totalActive >= config.network.bandwidth) {
        events.push({ time: req.arrivalTime, type: "drop", detail: `リクエスト #${req.id} ドロップ: 帯域幅超過`, requestId: req.id });
        droppedRequests++;
        continue;
      }

      // ルーティング
      target.activeConnections++;
      target.totalRequests++;
      target.cpuUsage = estimateCpu(target);
      distribution.set(target.id, (distribution.get(target.id) ?? 0) + 1);

      const serverResponseTime = loadLatency(target);
      const totalLatency = config.network.clientLatency + config.network.serverLatency + serverResponseTime;
      const completionTime = req.arrivalTime + totalLatency;

      events.push({
        time: req.arrivalTime,
        type: "route",
        detail: `#${req.id} → ${target.name} (接続: ${target.activeConnections}, 推定: ${totalLatency.toFixed(0)}ms)`,
        serverId: target.id,
        requestId: req.id,
      });

      // タイムライン記録
      const timeline = serverTimeline.get(target.id)!;
      timeline.push({ time: req.arrivalTime, connections: target.activeConnections, cpu: target.cpuUsage });

      // 完了予定に追加
      pendingCompletions.push({
        time: completionTime,
        serverId: target.id,
        requestId: req.id,
        responseTime: totalLatency,
        arrivalTime: req.arrivalTime,
      });
      // 時刻順にソート
      pendingCompletions.sort((a, b) => a.time - b.time);
    }

    // 残りの完了予定を処理
    const lastTime = requests.length > 0 ? requests[requests.length - 1]!.arrivalTime + 10000 : 0;
    this.processCompletions(pendingCompletions, lastTime, servers, events, responses, serverTimeline);

    // 結果の集計
    const responseTimes = responses.map((r) => r.responseTime);
    const avgResponseTime = responseTimes.length > 0 ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length : 0;
    const maxResponseTime = responseTimes.length > 0 ? Math.max(...responseTimes) : 0;
    const totalTime = events.length > 0 ? Math.max(...events.map((e) => e.time)) : 0;

    return {
      events,
      responses,
      finalServerStates: servers.map((s) => ({ ...s })),
      distribution,
      avgResponseTime,
      maxResponseTime,
      droppedRequests,
      totalRequests: requests.length,
      totalTime,
      serverTimeline,
    };
  }

  /** 完了予定のリクエストを処理する */
  private processCompletions(
    pending: { time: number; serverId: string; requestId: number; responseTime: number; arrivalTime: number }[],
    currentTime: number,
    servers: ServerState[],
    events: SimEvent[],
    responses: Response[],
    serverTimeline: Map<string, { time: number; connections: number; cpu: number }[]>,
  ): void {
    while (pending.length > 0 && pending[0]!.time <= currentTime) {
      const completion = pending.shift()!;
      const server = servers.find((s) => s.id === completion.serverId);
      if (server) {
        server.activeConnections = Math.max(0, server.activeConnections - 1);
        server.cpuUsage = estimateCpu(server);

        const timeline = serverTimeline.get(server.id)!;
        timeline.push({ time: completion.time, connections: server.activeConnections, cpu: server.cpuUsage });
      }

      events.push({
        time: completion.time,
        type: "response",
        detail: `#${completion.requestId} 完了 (${completion.responseTime.toFixed(0)}ms)`,
        serverId: completion.serverId,
        requestId: completion.requestId,
      });

      responses.push({
        requestId: completion.requestId,
        serverId: completion.serverId,
        statusCode: 200,
        responseTime: completion.responseTime,
        arrivalTime: completion.arrivalTime,
        completionTime: completion.time,
      });
    }
  }
}

// ── リクエスト生成ヘルパー ──

/** 均等間隔のリクエストを生成する */
export function generateUniformRequests(count: number, intervalMs: number, ips?: string[]): Request[] {
  const defaultIps = ["10.0.1.1", "10.0.1.2", "10.0.1.3", "10.0.2.1", "10.0.2.2", "192.168.1.10", "192.168.1.20", "172.16.0.5"];
  const ipPool = ips ?? defaultIps;
  const requests: Request[] = [];
  for (let i = 0; i < count; i++) {
    requests.push({
      id: i + 1,
      sourceIp: ipPool[i % ipPool.length]!,
      path: "/api/data",
      arrivalTime: i * intervalMs,
    });
  }
  return requests;
}

/** バースト (スパイク) トラフィックを生成する */
export function generateBurstRequests(normalCount: number, burstCount: number, normalInterval: number, burstStart: number): Request[] {
  const ips = ["10.0.1.1", "10.0.1.2", "10.0.1.3", "10.0.2.1", "10.0.2.2"];
  const requests: Request[] = [];
  let id = 1;

  // 通常トラフィック
  for (let i = 0; i < normalCount; i++) {
    requests.push({ id: id++, sourceIp: ips[i % ips.length]!, path: "/api/data", arrivalTime: i * normalInterval });
  }

  // バーストトラフィック
  for (let i = 0; i < burstCount; i++) {
    requests.push({ id: id++, sourceIp: `10.0.3.${i % 255}`, path: "/api/data", arrivalTime: burstStart + i * 5 });
  }

  requests.sort((a, b) => a.arrivalTime - b.arrivalTime);
  return requests;
}

/** サーバーの初期状態を生成する */
export function createServers(configs: { name: string; weight?: number; baseLatency?: number; maxConnections?: number }[]): ServerState[] {
  return configs.map((c, i) => ({
    id: `server-${i + 1}`,
    name: c.name,
    weight: c.weight ?? 1,
    activeConnections: 0,
    cpuUsage: 0,
    memoryUsage: 0,
    baseLatency: c.baseLatency ?? 50,
    healthy: true,
    totalRequests: 0,
    maxConnections: c.maxConnections ?? 100,
  }));
}
