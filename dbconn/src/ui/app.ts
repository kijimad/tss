import { DbConnSimulator, createServer, query } from "../engine/dbconn.js";
import type { SimConfig, SimResult, SimEvent } from "../engine/dbconn.js";

export interface Experiment { name: string; description: string; config: SimConfig; }

const defaultPool = { minSize: 3, maxSize: 10, acquireTimeout: 5000, idleTimeout: 30000, maxLifetime: 600000, healthCheckInterval: 10000, validationQuery: "SELECT 1" };
const defaultNetwork = { rttMs: 10, packetLossRate: 0, dnsLatency: 5, congestionDelay: 0 };

export const EXPERIMENTS: Experiment[] = [
  {
    name: "PostgreSQL — 基本接続 + クエリ",
    description: "プール初期化 (min=3)、TCP/TLS/SCRAM-SHA-256 認証、SELECT/INSERT を実行する基本フロー。",
    config: {
      servers: [createServer("pg-primary.db.local", "PostgreSQL")],
      network: defaultNetwork, pool: defaultPool, tlsMode: "require", username: "app_user",
      queries: [
        query("SELECT id, name FROM users WHERE active = true", 5, 150, 4800),
        query("SELECT * FROM orders WHERE user_id = $1 LIMIT 10", 8, 10, 2400),
        query("INSERT INTO logs (action, ts) VALUES ($1, NOW())", 3, 0, 0, { write: true }),
      ],
      failoverAfterQuery: 0, retryCount: 3, retryDelay: 500,
    },
  },
  {
    name: "MySQL — トランザクション",
    description: "BEGIN/COMMIT 付きトランザクション内で複数クエリを実行。プール接続がトランザクション中は専有される。",
    config: {
      servers: [createServer("mysql-primary.db.local", "MySQL", { authMethod: "password" })],
      network: defaultNetwork, pool: { ...defaultPool, minSize: 2 }, tlsMode: "prefer", username: "root",
      queries: [
        query("SELECT balance FROM accounts WHERE id = 1 FOR UPDATE", 3, 1, 64, { tx: true }),
        query("UPDATE accounts SET balance = balance - 100 WHERE id = 1", 4, 0, 0, { tx: true, write: true }),
        query("UPDATE accounts SET balance = balance + 100 WHERE id = 2", 4, 0, 0, { tx: true, write: true }),
        query("INSERT INTO transfers (from_id, to_id, amount) VALUES (1, 2, 100)", 3, 0, 0, { tx: true, write: true }),
      ],
      failoverAfterQuery: 0, retryCount: 3, retryDelay: 500,
    },
  },
  {
    name: "リードレプリカ分散",
    description: "プライマリ + 2 レプリカ構成。読み取りはレプリカ、書き込みはプライマリにルーティング。レプリケーション遅延も表示。",
    config: {
      servers: [
        createServer("pg-primary.db.local", "PostgreSQL"),
        createServer("pg-replica-1.db.local", "PostgreSQL", { isReplica: true, replicationLag: 50 }),
        createServer("pg-replica-2.db.local", "PostgreSQL", { isReplica: true, replicationLag: 120 }),
      ],
      network: defaultNetwork, pool: { ...defaultPool, minSize: 2, maxSize: 8 }, tlsMode: "require", username: "app_user",
      queries: [
        query("SELECT * FROM products WHERE category = 'electronics'", 10, 500, 25000),
        query("SELECT * FROM products WHERE id = $1", 2, 1, 200),
        query("INSERT INTO cart (user_id, product_id) VALUES ($1, $2)", 3, 0, 0, { write: true }),
        query("SELECT * FROM cart WHERE user_id = $1", 4, 5, 500),
      ],
      failoverAfterQuery: 0, retryCount: 3, retryDelay: 500,
    },
  },
  {
    name: "フェイルオーバー (プライマリダウン)",
    description: "3 番目のクエリ後にプライマリがダウン。レプリカへのフェイルオーバーとリトライ動作を観察。",
    config: {
      servers: [
        createServer("pg-primary.db.local", "PostgreSQL"),
        createServer("pg-replica.db.local", "PostgreSQL", { isReplica: true, replicationLag: 30 }),
      ],
      network: defaultNetwork, pool: { ...defaultPool, minSize: 2 }, tlsMode: "require", username: "app_user",
      queries: [
        query("SELECT 1", 1, 1, 4),
        query("SELECT * FROM users LIMIT 5", 3, 5, 400),
        query("SELECT * FROM logs ORDER BY ts DESC LIMIT 10", 5, 10, 800),
        query("SELECT * FROM config WHERE key = 'version'", 2, 1, 32),
        query("INSERT INTO events (type) VALUES ('login')", 3, 0, 0, { write: true }),
      ],
      failoverAfterQuery: 3, retryCount: 3, retryDelay: 1000,
    },
  },
  {
    name: "プール枯渇 (max_size=2)",
    description: "最大接続数 2 のプールに 5 クエリを同時投入。プール枯渇でタイムアウトが発生する。",
    config: {
      servers: [createServer("pg.db.local", "PostgreSQL")],
      network: defaultNetwork, pool: { ...defaultPool, minSize: 1, maxSize: 2, acquireTimeout: 3000 }, tlsMode: "require", username: "app_user",
      queries: [
        query("SELECT pg_sleep(0.5)", 500, 1, 4),
        query("SELECT pg_sleep(0.5)", 500, 1, 4),
        query("SELECT * FROM users", 5, 100, 5000),
        query("SELECT * FROM orders", 8, 200, 10000),
        query("SELECT 1", 1, 1, 4),
      ],
      failoverAfterQuery: 0, retryCount: 0, retryDelay: 0,
    },
  },
  {
    name: "SQL Server — Windows 認証",
    description: "SQL Server への NTLM 認証接続。LOGIN7 パケットと ENVCHANGE による DB 切り替えを観察。",
    config: {
      servers: [createServer("sql01.corp.local", "SQL Server", { authMethod: "password" })],
      network: { rttMs: 15, packetLossRate: 0, dnsLatency: 8, congestionDelay: 0 },
      pool: { ...defaultPool, minSize: 2 }, tlsMode: "require", username: "sa",
      queries: [
        query("SELECT @@VERSION", 2, 1, 200),
        query("SELECT TOP 10 * FROM sys.databases", 5, 10, 1200),
        query("EXEC sp_who2", 3, 15, 800),
      ],
      failoverAfterQuery: 0, retryCount: 3, retryDelay: 500,
    },
  },
  {
    name: "高レイテンシ + パケットロス",
    description: "RTT=200ms、パケットロス 5% の劣悪なネットワーク。接続確立とクエリの各 RTT が大きく影響する。",
    config: {
      servers: [createServer("remote-pg.db.cloud", "PostgreSQL")],
      network: { rttMs: 200, packetLossRate: 0.05, dnsLatency: 50, congestionDelay: 20 },
      pool: { ...defaultPool, minSize: 1 }, tlsMode: "verify-full", username: "cloud_user",
      queries: [
        query("SELECT 1", 1, 1, 4),
        query("SELECT * FROM users WHERE region = 'asia'", 15, 50, 3000),
        query("INSERT INTO metrics (key, value) VALUES ($1, $2)", 5, 0, 0, { write: true }),
      ],
      failoverAfterQuery: 0, retryCount: 3, retryDelay: 2000,
    },
  },
  {
    name: "接続ライフサイクル全体",
    description: "minSize=1, maxLifetime=200ms, idleTimeout=100ms の短寿命プール。接続の作成→使用→寿命超過→再作成を観察。",
    config: {
      servers: [createServer("pg.local", "PostgreSQL", { baseLatency: 1 })],
      network: { rttMs: 5, packetLossRate: 0, dnsLatency: 2, congestionDelay: 0 },
      pool: { minSize: 1, maxSize: 5, acquireTimeout: 3000, idleTimeout: 100, maxLifetime: 200, healthCheckInterval: 80, validationQuery: "SELECT 1" },
      tlsMode: "disable", username: "dev",
      queries: [
        query("SELECT 1", 1, 1, 4),
        query("SELECT * FROM test", 3, 10, 500),
        query("SELECT * FROM test WHERE id = 1", 2, 1, 50),
      ],
      failoverAfterQuery: 0, retryCount: 0, retryDelay: 0,
    },
  },
];

// ── 色 ──
function layerColor(l: SimEvent["layer"]): string {
  switch (l) {
    case "DNS": return "#64748b"; case "TCP": return "#475569"; case "TLS": return "#a78bfa";
    case "Auth": return "#ec4899"; case "Pool": return "#3b82f6"; case "Query": return "#22c55e";
    case "Txn": return "#f59e0b"; case "Error": return "#ef4444"; case "Failover": return "#f97316";
  }
}
function typeIcon(t: SimEvent["type"]): string {
  switch (t) { case "send": return "→"; case "recv": return "←"; case "success": return "✓"; case "error": return "✗"; case "warning": return "⚠"; case "info": return "●"; }
}

export class DbConnApp {
  init(container: HTMLElement): void {
    container.style.cssText = "display:flex;flex-direction:column;height:100vh;font-family:'Fira Code','Cascadia Code',monospace;background:#0f172a;color:#e2e8f0;";

    const header = document.createElement("div"); header.style.cssText = "padding:8px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #1e293b;flex-wrap:wrap;";
    const title = document.createElement("h1"); title.textContent = "DB Connection Simulator"; title.style.cssText = "margin:0;font-size:15px;white-space:nowrap;"; header.appendChild(title);
    const exSelect = document.createElement("select"); exSelect.style.cssText = "padding:4px 8px;background:#1e293b;border:1px solid #334155;border-radius:4px;color:#f8fafc;font-size:12px;";
    for (let i = 0; i < EXPERIMENTS.length; i++) { const o = document.createElement("option"); o.value = String(i); o.textContent = EXPERIMENTS[i]!.name; exSelect.appendChild(o); }
    header.appendChild(exSelect);
    const runBtn = document.createElement("button"); runBtn.textContent = "\u25B6 Run"; runBtn.style.cssText = "padding:4px 16px;background:#e2e8f0;color:#0f172a;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;"; header.appendChild(runBtn);
    const descSpan = document.createElement("span"); descSpan.style.cssText = "font-size:10px;color:#64748b;margin-left:auto;max-width:500px;"; header.appendChild(descSpan);
    container.appendChild(header);

    const main = document.createElement("div"); main.style.cssText = "flex:1;display:flex;overflow:hidden;";
    const leftPanel = document.createElement("div"); leftPanel.style.cssText = "width:370px;display:flex;flex-direction:column;border-right:1px solid #1e293b;overflow-y:auto;font-size:10px;";

    const makeSection = (label: string, color: string) => {
      const lbl = document.createElement("div"); lbl.style.cssText = `padding:4px 12px;font-size:11px;font-weight:600;color:${color};border-bottom:1px solid #1e293b;`; lbl.textContent = label; leftPanel.appendChild(lbl);
      const div = document.createElement("div"); div.style.cssText = "padding:8px 12px;border-bottom:1px solid #1e293b;"; leftPanel.appendChild(div); return div;
    };
    const cfgDiv = makeSection("Config", "#f59e0b");
    const poolDiv = makeSection("Pool Stats", "#3b82f6");
    const queryDiv = makeSection("Query Stats", "#22c55e");
    const connLabel = document.createElement("div"); connLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#a78bfa;border-bottom:1px solid #1e293b;"; connLabel.textContent = "Connections"; leftPanel.appendChild(connLabel);
    const connDiv = document.createElement("div"); connDiv.style.cssText = "flex:1;padding:4px 8px;overflow-y:auto;"; leftPanel.appendChild(connDiv);
    main.appendChild(leftPanel);

    const rightPanel = document.createElement("div"); rightPanel.style.cssText = "flex:1;display:flex;flex-direction:column;overflow:hidden;";
    const evLabel = document.createElement("div"); evLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#06b6d4;border-bottom:1px solid #1e293b;"; evLabel.textContent = "Connection Trace"; rightPanel.appendChild(evLabel);
    const evDiv = document.createElement("div"); evDiv.style.cssText = "flex:1;padding:4px 8px;font-size:9px;overflow-y:auto;line-height:1.7;"; rightPanel.appendChild(evDiv);
    main.appendChild(rightPanel); container.appendChild(main);

    const addRow = (p: HTMLElement, l: string, v: string, c: string) => { const r = document.createElement("div"); r.style.marginBottom = "2px"; r.innerHTML = `<span style="color:${c};font-weight:600;">${l}:</span> <span style="color:#94a3b8;">${v}</span>`; p.appendChild(r); };

    const renderConfig = (exp: Experiment) => {
      cfgDiv.innerHTML = "";
      for (const s of exp.config.servers) {
        addRow(cfgDiv, s.isReplica ? "Replica" : "Primary", `${s.engine} ${s.version} @ ${s.host}:${s.port}`, s.isReplica ? "#64748b" : "#22c55e");
      }
      addRow(cfgDiv, "TLS", exp.config.tlsMode, "#a78bfa");
      addRow(cfgDiv, "Auth", exp.config.servers[0]?.authMethod ?? "-", "#ec4899");
      addRow(cfgDiv, "Pool", `min=${exp.config.pool.minSize} max=${exp.config.pool.maxSize}`, "#3b82f6");
      addRow(cfgDiv, "RTT", `${exp.config.network.rttMs}ms`, "#64748b");
      addRow(cfgDiv, "Queries", String(exp.config.queries.length), "#f59e0b");
      if (exp.config.failoverAfterQuery > 0) addRow(cfgDiv, "Failover", `query #${exp.config.failoverAfterQuery} 後`, "#ef4444");
    };

    const renderPool = (r: SimResult) => {
      poolDiv.innerHTML = "";
      addRow(poolDiv, "作成", String(r.poolStats.created), "#22c55e");
      addRow(poolDiv, "破棄", String(r.poolStats.destroyed), "#ef4444");
      addRow(poolDiv, "Active", String(r.poolStats.active), "#f59e0b");
      addRow(poolDiv, "Idle", String(r.poolStats.idle), "#3b82f6");
      addRow(poolDiv, "Timeout", String(r.poolStats.timeouts), "#ef4444");
      if (r.failoverOccurred) addRow(poolDiv, "Failover", "発生", "#f97316");
    };

    const renderQuery = (r: SimResult) => {
      queryDiv.innerHTML = "";
      addRow(queryDiv, "実行", String(r.queryStats.executed), "#e2e8f0");
      addRow(queryDiv, "成功", String(r.queryStats.succeeded), "#22c55e");
      addRow(queryDiv, "失敗", String(r.queryStats.failed), "#ef4444");
      addRow(queryDiv, "平均レイテンシ", `${r.queryStats.avgLatency.toFixed(1)}ms`, "#06b6d4");
      addRow(queryDiv, "合計行数", String(r.queryStats.totalRows), "#64748b");
      addRow(queryDiv, "総時間", `${r.totalTime.toFixed(0)}ms`, "#a78bfa");
    };

    const stateColor = (s: string) => { switch (s) { case "ready": return "#22c55e"; case "busy": return "#f59e0b"; case "closed": return "#64748b"; case "error": return "#ef4444"; default: return "#94a3b8"; } };

    const renderConns = (conns: SimResult["connections"], servers: SimConfig["servers"]) => {
      connDiv.innerHTML = "";
      for (const c of conns) {
        const el = document.createElement("div"); el.style.cssText = "margin-bottom:3px;padding:3px 6px;background:#0a0a1e;border:1px solid #1e293b;border-radius:3px;font-size:9px;";
        const sName = servers[c.serverId]?.host ?? "?";
        el.innerHTML = `<span style="color:${stateColor(c.state)};font-weight:600;">#${c.id} ${c.state}</span> <span style="color:#64748b;">${sName}${c.tlsEnabled ? " 🔒" : ""} queries=${c.queryCount}</span>`;
        connDiv.appendChild(el);
      }
    };

    const renderEvents = (events: SimEvent[]) => {
      evDiv.innerHTML = "";
      for (const ev of events) {
        const el = document.createElement("div"); el.style.cssText = "display:flex;gap:4px;align-items:flex-start;margin-bottom:1px;";
        const lc = layerColor(ev.layer);
        el.innerHTML =
          `<span style="min-width:40px;color:#475569;text-align:right;">${ev.time.toFixed(0)}</span>` +
          `<span style="color:${ev.type === "error" ? "#ef4444" : ev.type === "warning" ? "#f59e0b" : "#94a3b8"};min-width:12px;">${typeIcon(ev.type)}</span>` +
          `<span style="min-width:50px;padding:0 3px;border-radius:2px;font-size:8px;font-weight:600;text-align:center;color:${lc};background:${lc}15;border:1px solid ${lc}33;">${ev.layer}</span>` +
          (ev.connId !== undefined ? `<span style="color:#475569;min-width:24px;">#${ev.connId}</span>` : "") +
          `<span style="color:#cbd5e1;">${ev.detail}</span>`;
        evDiv.appendChild(el);
      }
    };

    const load = (exp: Experiment) => { descSpan.textContent = exp.description; renderConfig(exp); poolDiv.innerHTML = '<span style="color:#475569;">▶ Run をクリック</span>'; queryDiv.innerHTML = ""; connDiv.innerHTML = ""; evDiv.innerHTML = ""; };
    const run = (exp: Experiment) => {
      const cfg: SimConfig = { ...exp.config, servers: exp.config.servers.map((s) => ({ ...s })) };
      const sim = new DbConnSimulator();
      const result = sim.simulate(cfg);
      renderConfig(exp); renderPool(result); renderQuery(result); renderConns(result.connections, exp.config.servers); renderEvents(result.events);
    };
    exSelect.addEventListener("change", () => { const e = EXPERIMENTS[Number(exSelect.value)]; if (e) load(e); });
    runBtn.addEventListener("click", () => { const e = EXPERIMENTS[Number(exSelect.value)]; if (e) run(e); });
    load(EXPERIMENTS[0]!);
  }
}
