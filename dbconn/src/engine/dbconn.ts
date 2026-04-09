/**
 * dbconn.ts — DB コネクションエミュレーションエンジン
 *
 * アプリケーション→DB 間の接続ライフサイクル全体をシミュレーションする。
 * TCP 3-way HS → TLS → 認証 → コネクションプール管理 →
 * クエリ実行 → トランザクション → 切断 / リトライ / フェイルオーバー
 */

// ── 基本型 ──

/** DB エンジン種別 */
export type DbEngine = "PostgreSQL" | "MySQL" | "SQL Server" | "Oracle";

/** 接続状態 */
export type ConnState =
  | "idle"           // プール内で待機中
  | "connecting"     // TCP/TLS/認証中
  | "ready"          // クエリ受付可能
  | "busy"           // クエリ実行中
  | "closing"        // 切断中
  | "closed"         // 切断済み
  | "error";         // エラー

/** 認証方式 */
export type AuthMethod = "password" | "md5" | "scram-sha-256" | "certificate" | "iam-token";

/** TLS 設定 */
export type TlsMode = "disable" | "prefer" | "require" | "verify-ca" | "verify-full";

// ── サーバー / ネットワーク定義 ──

/** DB サーバー */
export interface DbServer {
  host: string;
  port: number;
  engine: DbEngine;
  version: string;
  /** 最大同時接続数 */
  maxConnections: number;
  /** 現在の接続数 */
  currentConnections: number;
  /** 認証方式 */
  authMethod: AuthMethod;
  /** TLS 対応 */
  tlsSupported: boolean;
  /** サーバー基本レイテンシ (ms) */
  baseLatency: number;
  /** サーバーが稼働中か */
  up: boolean;
  /** レプリカか (read-only) */
  isReplica: boolean;
  /** レプリケーション遅延 (ms) */
  replicationLag: number;
}

/** ネットワーク設定 */
export interface NetworkConfig {
  /** RTT (ms) */
  rttMs: number;
  /** パケットロス率 */
  packetLossRate: number;
  /** DNS 解決遅延 (ms) */
  dnsLatency: number;
  /** 帯域幅制限による追加遅延 */
  congestionDelay: number;
}

/** コネクションプール設定 */
export interface PoolConfig {
  /** 最小接続数 (idle に維持) */
  minSize: number;
  /** 最大接続数 */
  maxSize: number;
  /** 接続取得待ちタイムアウト (ms) */
  acquireTimeout: number;
  /** アイドル接続の最大寿命 (ms) */
  idleTimeout: number;
  /** 接続の最大寿命 (ms) */
  maxLifetime: number;
  /** ヘルスチェック間隔 (ms) */
  healthCheckInterval: number;
  /** 接続バリデーション SQL */
  validationQuery: string;
}

/** クエリ定義 */
export interface Query {
  sql: string;
  /** 想定実行時間 (ms) */
  execTime: number;
  /** 結果行数 */
  rowCount: number;
  /** 結果バイト数 */
  resultBytes: number;
  /** トランザクション内か */
  inTransaction: boolean;
  /** 書き込みか (レプリカでは失敗) */
  isWrite: boolean;
}

/** 接続情報 */
export interface Connection {
  id: number;
  state: ConnState;
  serverId: number;
  /** 作成時刻 */
  createdAt: number;
  /** 最後に使用した時刻 */
  lastUsedAt: number;
  /** 処理したクエリ数 */
  queryCount: number;
  /** TLS 有効か */
  tlsEnabled: boolean;
}

/** シミュレーション設定 */
export interface SimConfig {
  /** DB サーバー一覧 (プライマリ + レプリカ) */
  servers: DbServer[];
  network: NetworkConfig;
  pool: PoolConfig;
  /** TLS モード */
  tlsMode: TlsMode;
  /** 認証ユーザー名 */
  username: string;
  /** 実行するクエリ一覧 */
  queries: Query[];
  /** フェイルオーバーを模擬するか (何番目のクエリ後にプライマリをダウンさせるか, 0=無効) */
  failoverAfterQuery: number;
  /** リトライ回数 */
  retryCount: number;
  /** リトライ間隔 (ms) */
  retryDelay: number;
}

/** シミュレーションイベント */
export interface SimEvent {
  time: number;
  layer: "DNS" | "TCP" | "TLS" | "Auth" | "Pool" | "Query" | "Txn" | "Error" | "Failover";
  type: "info" | "send" | "recv" | "success" | "error" | "warning";
  detail: string;
  connId?: number;
  serverId?: number;
}

/** シミュレーション結果 */
export interface SimResult {
  events: SimEvent[];
  /** プール内の接続一覧 */
  connections: Connection[];
  /** プール統計 */
  poolStats: {
    created: number;
    destroyed: number;
    active: number;
    idle: number;
    waiters: number;
    timeouts: number;
  };
  /** クエリ統計 */
  queryStats: {
    executed: number;
    succeeded: number;
    failed: number;
    avgLatency: number;
    totalRows: number;
  };
  /** フェイルオーバーが発生したか */
  failoverOccurred: boolean;
  totalTime: number;
}

// ── プロトコル固有メッセージ ──

/** エンジン別のハンドシェイクメッセージ */
function engineHandshake(engine: DbEngine, version: string): { serverGreeting: string; authRequest: string; authOk: string } {
  switch (engine) {
    case "PostgreSQL": return {
      serverGreeting: `R: AuthenticationRequest (method)`,
      authRequest: `F: PasswordMessage / SASLInitialResponse`,
      authOk: `R: AuthenticationOk + ParameterStatus(server_version=${version}) + ReadyForQuery`,
    };
    case "MySQL": return {
      serverGreeting: `Server Greeting (version=${version}, auth_plugin=caching_sha2_password)`,
      authRequest: `Handshake Response (user, auth_data, database)`,
      authOk: `OK_Packet (affected_rows=0, server_status=0x0002)`,
    };
    case "SQL Server": return {
      serverGreeting: `PRELOGIN Response (version=${version}, encryption=required)`,
      authRequest: `LOGIN7 (username, NTLM/Kerberos)`,
      authOk: `LOGINACK + ENVCHANGE(database) + DONE`,
    };
    case "Oracle": return {
      serverGreeting: `ACCEPT (version=${version}, service_name)`,
      authRequest: `AUTH_DATA (username, O5LOGON verifier)`,
      authOk: `AUTH_COMPLETE + SESSKEY`,
    };
  }
}

// ── シミュレーター ──

export class DbConnSimulator {
  simulate(config: SimConfig): SimResult {
    const events: SimEvent[] = [];
    const connections: Connection[] = [];
    let time = 0;
    let connIdSeq = 0;
    let created = 0, destroyed = 0, timeouts = 0;
    let qExecuted = 0, qSucceeded = 0, qFailed = 0, totalRows = 0;
    const queryLatencies: number[] = [];
    let failoverOccurred = false;

    const primaryIdx = config.servers.findIndex((s) => !s.isReplica);
    const servers = config.servers.map((s) => ({ ...s }));

    // ── 1. プール初期化: minSize 分の接続を作成 ──
    events.push({ time, layer: "Pool", type: "info", detail: `コネクションプール初期化: min=${config.pool.minSize} max=${config.pool.maxSize} idleTimeout=${config.pool.idleTimeout}ms` });

    for (let i = 0; i < config.pool.minSize; i++) {
      const servIdx = primaryIdx >= 0 ? primaryIdx : 0;
      const result = this.createConnection(config, servers, servIdx, ++connIdSeq, time, events);
      if (result) {
        connections.push(result.conn);
        time = result.endTime;
        created++;
      }
    }

    events.push({ time, layer: "Pool", type: "info", detail: `プール準備完了: ${connections.filter((c) => c.state === "ready").length} 接続 (idle)` });

    // ── 2. クエリ実行 ──
    for (let qi = 0; qi < config.queries.length; qi++) {
      const query = config.queries[qi]!;
      time += 5;

      // フェイルオーバートリガー
      if (config.failoverAfterQuery > 0 && qi === config.failoverAfterQuery && primaryIdx >= 0) {
        const primary = servers[primaryIdx]!;
        primary.up = false;
        failoverOccurred = true;
        events.push({ time, layer: "Failover", type: "error", detail: `⚠ プライマリ "${primary.host}" がダウン!`, serverId: primaryIdx });
      }

      // 接続取得
      const targetServerIdx = this.selectServer(servers, query.isWrite);
      if (targetServerIdx < 0) {
        events.push({ time, layer: "Error", type: "error", detail: `利用可能なサーバーなし (write=${query.isWrite})` });
        qExecuted++; qFailed++;

        // リトライ
        let retried = false;
        for (let r = 0; r < config.retryCount; r++) {
          time += config.retryDelay;
          events.push({ time, layer: "Failover", type: "warning", detail: `リトライ ${r + 1}/${config.retryCount}...` });
          const retryIdx = this.selectServer(servers, query.isWrite);
          if (retryIdx >= 0) {
            events.push({ time, layer: "Failover", type: "success", detail: `サーバー "${servers[retryIdx]!.host}" で再接続成功` });
            // 新しい接続を作成
            const newConn = this.createConnection(config, servers, retryIdx, ++connIdSeq, time, events);
            if (newConn) { connections.push(newConn.conn); time = newConn.endTime; created++; }
            retried = true;
            qFailed--; // 上でカウントした失敗を取消
            break;
          }
        }
        if (!retried) continue;
      }

      // アイドル接続を取得、なければ新規作成
      let conn = connections.find((c) => c.state === "ready" && (targetServerIdx < 0 || c.serverId === targetServerIdx));
      if (!conn && connections.filter((c) => c.state !== "closed" && c.state !== "error").length < config.pool.maxSize) {
        const si = targetServerIdx >= 0 ? targetServerIdx : (primaryIdx >= 0 ? primaryIdx : 0);
        const newResult = this.createConnection(config, servers, si, ++connIdSeq, time, events);
        if (newResult) {
          connections.push(newResult.conn);
          conn = newResult.conn;
          time = newResult.endTime;
          created++;
        }
      }
      if (!conn) {
        conn = connections.find((c) => c.state === "ready");
      }
      if (!conn) {
        events.push({ time, layer: "Pool", type: "error", detail: `接続取得タイムアウト (pool exhausted, max=${config.pool.maxSize})` });
        timeouts++; qExecuted++; qFailed++;
        continue;
      }

      // レプリカへの書き込みチェック
      const server = servers[conn.serverId]!;
      if (query.isWrite && server.isReplica) {
        events.push({ time, layer: "Error", type: "error", detail: `読み取り専用サーバー "${server.host}" に書き込み不可`, connId: conn.id });
        qExecuted++; qFailed++;
        continue;
      }

      // クエリ実行
      conn.state = "busy";
      conn.lastUsedAt = time;
      qExecuted++;

      if (query.inTransaction) {
        events.push({ time, layer: "Txn", type: "send", detail: `BEGIN`, connId: conn.id, serverId: conn.serverId });
        time += config.network.rttMs / 2;
        events.push({ time, layer: "Txn", type: "recv", detail: `BEGIN OK`, connId: conn.id });
      }

      const queryStart = time;
      events.push({
        time, layer: "Query", type: "send",
        detail: `${query.sql.slice(0, 80)}${query.sql.length > 80 ? "..." : ""}`,
        connId: conn.id, serverId: conn.serverId,
      });

      // ネットワーク遅延 + サーバー実行時間
      time += config.network.rttMs / 2;
      time += query.execTime + server.baseLatency;

      // パケットロスでリトライ
      if (Math.random() < config.network.packetLossRate) {
        events.push({ time, layer: "TCP", type: "warning", detail: `パケットロス → TCP 再送`, connId: conn.id });
        time += config.network.rttMs;
      }

      // レプリケーション遅延
      if (server.isReplica && server.replicationLag > 0) {
        events.push({ time, layer: "Query", type: "warning", detail: `レプリカ遅延: ${server.replicationLag}ms (データが古い可能性)`, connId: conn.id });
      }

      time += config.network.rttMs / 2;
      const queryLatency = time - queryStart;
      queryLatencies.push(queryLatency);

      events.push({
        time, layer: "Query", type: "recv",
        detail: `結果: ${query.rowCount} rows, ${query.resultBytes}B (${queryLatency.toFixed(1)}ms)`,
        connId: conn.id,
      });
      qSucceeded++;
      totalRows += query.rowCount;
      conn.queryCount++;

      if (query.inTransaction) {
        events.push({ time, layer: "Txn", type: "send", detail: `COMMIT`, connId: conn.id });
        time += config.network.rttMs / 2;
        events.push({ time, layer: "Txn", type: "recv", detail: `COMMIT OK`, connId: conn.id });
      }

      conn.state = "ready";

      // maxLifetime チェック
      if (time - conn.createdAt > config.pool.maxLifetime) {
        events.push({ time, layer: "Pool", type: "info", detail: `接続 #${conn.id} maxLifetime 超過 → 切断`, connId: conn.id });
        conn.state = "closed";
        destroyed++;
      }
    }

    // ── 3. ヘルスチェック ──
    time += config.pool.healthCheckInterval;
    const liveConns = connections.filter((c) => c.state === "ready");
    for (const c of liveConns) {
      const server = servers[c.serverId]!;
      if (!server.up) {
        events.push({ time, layer: "Pool", type: "error", detail: `ヘルスチェック失敗: #${c.id} → "${server.host}" ダウン → 接続除去`, connId: c.id });
        c.state = "error";
        destroyed++;
      } else {
        events.push({ time, layer: "Pool", type: "info", detail: `ヘルスチェック OK: #${c.id} "${config.pool.validationQuery}"`, connId: c.id });
      }
    }

    // ── 4. アイドル接続の解放 ──
    for (const c of connections) {
      if (c.state === "ready" && time - c.lastUsedAt > config.pool.idleTimeout) {
        events.push({ time, layer: "Pool", type: "info", detail: `接続 #${c.id} idleTimeout 超過 → 切断`, connId: c.id });
        c.state = "closed";
        destroyed++;
      }
    }

    const active = connections.filter((c) => c.state === "busy").length;
    const idle = connections.filter((c) => c.state === "ready").length;
    const avgLatency = queryLatencies.length > 0 ? queryLatencies.reduce((a, b) => a + b, 0) / queryLatencies.length : 0;

    events.push({
      time, layer: "Pool", type: "info",
      detail: `最終状態: active=${active} idle=${idle} created=${created} destroyed=${destroyed}`,
    });

    return {
      events, connections,
      poolStats: { created, destroyed, active, idle, waiters: 0, timeouts },
      queryStats: { executed: qExecuted, succeeded: qSucceeded, failed: qFailed, avgLatency, totalRows },
      failoverOccurred, totalTime: time,
    };
  }

  /** 接続を作成する (TCP + TLS + Auth) */
  private createConnection(
    config: SimConfig, servers: DbServer[], serverIdx: number, connId: number,
    startTime: number, events: SimEvent[],
  ): { conn: Connection; endTime: number } | null {
    let time = startTime;
    const server = servers[serverIdx]!;
    if (!server.up) {
      events.push({ time, layer: "TCP", type: "error", detail: `接続失敗: ${server.host}:${server.port} ダウン`, connId, serverId: serverIdx });
      return null;
    }
    if (server.currentConnections >= server.maxConnections) {
      events.push({ time, layer: "Error", type: "error", detail: `接続拒否: ${server.host} max_connections(${server.maxConnections}) 到達`, connId, serverId: serverIdx });
      return null;
    }

    // DNS
    time += config.network.dnsLatency;
    events.push({ time, layer: "DNS", type: "recv", detail: `${server.host} → 解決済み (${config.network.dnsLatency}ms)`, connId, serverId: serverIdx });

    // TCP 3-way HS
    const halfRtt = config.network.rttMs / 2;
    events.push({ time, layer: "TCP", type: "send", detail: `SYN → ${server.host}:${server.port}`, connId, serverId: serverIdx });
    time += halfRtt;
    events.push({ time, layer: "TCP", type: "recv", detail: `SYN-ACK ← ${server.host}:${server.port}`, connId });
    time += halfRtt;
    events.push({ time, layer: "TCP", type: "send", detail: `ACK → TCP 接続確立`, connId });

    // TLS
    const tlsEnabled = config.tlsMode !== "disable" && server.tlsSupported;
    if (tlsEnabled) {
      events.push({ time, layer: "TLS", type: "send", detail: `SSLRequest / ClientHello`, connId });
      time += config.network.rttMs;
      events.push({ time, layer: "TLS", type: "recv", detail: `ServerHello + Certificate`, connId });
      time += halfRtt;
      events.push({ time, layer: "TLS", type: "send", detail: `ClientKeyExchange + Finished`, connId });
      time += halfRtt;
      events.push({ time, layer: "TLS", type: "recv", detail: `Finished → TLS ${config.tlsMode} 確立`, connId });
    }

    // Auth
    const hs = engineHandshake(server.engine, server.version);
    events.push({ time, layer: "Auth", type: "recv", detail: `${hs.serverGreeting}`, connId, serverId: serverIdx });
    time += halfRtt;
    events.push({ time, layer: "Auth", type: "send", detail: `${hs.authRequest} (user=${config.username}, method=${server.authMethod})`, connId });
    time += halfRtt + server.baseLatency;
    events.push({ time, layer: "Auth", type: "recv", detail: `${hs.authOk}`, connId });

    events.push({ time, layer: "Pool", type: "success", detail: `接続 #${connId} 確立: ${server.engine} ${server.version} @ ${server.host}:${server.port}${tlsEnabled ? " (TLS)" : ""}${server.isReplica ? " [replica]" : ""}`, connId, serverId: serverIdx });

    server.currentConnections++;

    return {
      conn: { id: connId, state: "ready", serverId: serverIdx, createdAt: time, lastUsedAt: time, queryCount: 0, tlsEnabled },
      endTime: time,
    };
  }

  /** クエリに適したサーバーを選択する */
  private selectServer(servers: DbServer[], isWrite: boolean): number {
    if (isWrite) {
      return servers.findIndex((s) => s.up && !s.isReplica);
    }
    // 読み取りはレプリカ優先
    const replicaIdx = servers.findIndex((s) => s.up && s.isReplica);
    if (replicaIdx >= 0) return replicaIdx;
    return servers.findIndex((s) => s.up);
  }
}

// ── ヘルパー ──

export function createServer(host: string, engine: DbEngine, opts?: Partial<DbServer>): DbServer {
  const defaults: Record<DbEngine, { port: number; version: string }> = {
    PostgreSQL: { port: 5432, version: "16.2" },
    MySQL: { port: 3306, version: "8.4.0" },
    "SQL Server": { port: 1433, version: "2022" },
    Oracle: { port: 1521, version: "23c" },
  };
  const d = defaults[engine];
  return {
    host, port: opts?.port ?? d.port, engine, version: opts?.version ?? d.version,
    maxConnections: opts?.maxConnections ?? 100, currentConnections: opts?.currentConnections ?? 0,
    authMethod: opts?.authMethod ?? "scram-sha-256", tlsSupported: opts?.tlsSupported ?? true,
    baseLatency: opts?.baseLatency ?? 2, up: opts?.up ?? true,
    isReplica: opts?.isReplica ?? false, replicationLag: opts?.replicationLag ?? 0,
  };
}

export function query(sql: string, execTime: number, rows: number, bytes: number, opts?: { tx?: boolean; write?: boolean }): Query {
  return { sql, execTime, rowCount: rows, resultBytes: bytes, inTransaction: opts?.tx ?? false, isWrite: opts?.write ?? false };
}
