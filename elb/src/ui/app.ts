import {
  ElbSimulator, createServers, generateUniformRequests, generateBurstRequests,
} from "../engine/elb.js";
import type {
  ElbConfig, ServerState, Request, SimulationResult, SimEvent,
} from "../engine/elb.js";

// ── プリセット実験 ──

export interface Experiment {
  name: string;
  description: string;
  servers: ServerState[];
  requests: Request[];
  config: ElbConfig;
}

/** デフォルトのヘルスチェック設定 */
const defaultHealthCheck = { interval: 500, unhealthyThreshold: 3, healthyThreshold: 2, timeout: 100 };
/** デフォルトのネットワーク設定 */
const defaultNetwork = { clientLatency: 5, serverLatency: 3, packetLossRate: 0, bandwidth: 500 };

export const EXPERIMENTS: Experiment[] = [
  {
    name: "Round Robin — 均等分散",
    description: "3台の同一スペックサーバーに Round Robin でリクエストを分配。均等に振り分けられる。",
    servers: createServers([
      { name: "web-1", baseLatency: 50 },
      { name: "web-2", baseLatency: 50 },
      { name: "web-3", baseLatency: 50 },
    ]),
    requests: generateUniformRequests(30, 100),
    config: { algorithm: "round-robin", healthCheck: defaultHealthCheck, network: defaultNetwork, stickySession: false, drainingTimeout: 300 },
  },
  {
    name: "Weighted Round Robin — 重み付き",
    description: "サーバーに weight 3:2:1 を設定。高性能サーバーに多くのリクエストが振られる。",
    servers: createServers([
      { name: "large (w=3)", weight: 3, baseLatency: 30, maxConnections: 200 },
      { name: "medium (w=2)", weight: 2, baseLatency: 50, maxConnections: 100 },
      { name: "small (w=1)", weight: 1, baseLatency: 80, maxConnections: 50 },
    ]),
    requests: generateUniformRequests(30, 100),
    config: { algorithm: "weighted-round-robin", healthCheck: defaultHealthCheck, network: defaultNetwork, stickySession: false, drainingTimeout: 300 },
  },
  {
    name: "Least Connections — 最少接続",
    description: "接続数が最も少ないサーバーにルーティング。レスポンスが遅いサーバーを自然に避ける。",
    servers: createServers([
      { name: "fast", baseLatency: 20, maxConnections: 100 },
      { name: "normal", baseLatency: 60, maxConnections: 100 },
      { name: "slow", baseLatency: 150, maxConnections: 100 },
    ]),
    requests: generateUniformRequests(30, 50),
    config: { algorithm: "least-connections", healthCheck: defaultHealthCheck, network: defaultNetwork, stickySession: false, drainingTimeout: 300 },
  },
  {
    name: "Least Response Time — 最短応答",
    description: "推定レスポンスタイムが最短のサーバーを選択。負荷によるレイテンシ増加を考慮する。",
    servers: createServers([
      { name: "fast", baseLatency: 20, maxConnections: 80 },
      { name: "normal", baseLatency: 60, maxConnections: 120 },
      { name: "slow", baseLatency: 100, maxConnections: 200 },
    ]),
    requests: generateUniformRequests(40, 40),
    config: { algorithm: "least-response-time", healthCheck: defaultHealthCheck, network: defaultNetwork, stickySession: false, drainingTimeout: 300 },
  },
  {
    name: "IP Hash — スティッキー",
    description: "送信元 IP のハッシュでルーティング先を固定。同じクライアントは同じサーバーへ。",
    servers: createServers([
      { name: "web-1", baseLatency: 50 },
      { name: "web-2", baseLatency: 50 },
      { name: "web-3", baseLatency: 50 },
    ]),
    requests: generateUniformRequests(30, 100),
    config: { algorithm: "ip-hash", healthCheck: defaultHealthCheck, network: defaultNetwork, stickySession: true, drainingTimeout: 300 },
  },
  {
    name: "サーバー障害 & ヘルスチェック",
    description: "1台のサーバーを低スペック (maxConnections=5) にし、過負荷で障害を発生させる。ヘルスチェックで除外される様子を観察。",
    servers: createServers([
      { name: "web-1", baseLatency: 50, maxConnections: 100 },
      { name: "web-2", baseLatency: 50, maxConnections: 100 },
      { name: "weak", baseLatency: 80, maxConnections: 5 },
    ]),
    requests: generateUniformRequests(40, 60),
    config: {
      algorithm: "round-robin",
      healthCheck: { interval: 200, unhealthyThreshold: 2, healthyThreshold: 2, timeout: 100 },
      network: defaultNetwork, stickySession: false, drainingTimeout: 300,
    },
  },
  {
    name: "トラフィックスパイク",
    description: "通常トラフィック後にバーストが発生。Least Connections で負荷を分散しつつ、帯域幅制限によるドロップを観察。",
    servers: createServers([
      { name: "web-1", baseLatency: 40, maxConnections: 50 },
      { name: "web-2", baseLatency: 40, maxConnections: 50 },
      { name: "web-3", baseLatency: 40, maxConnections: 50 },
      { name: "web-4", baseLatency: 40, maxConnections: 50 },
    ]),
    requests: generateBurstRequests(15, 40, 200, 1500),
    config: {
      algorithm: "least-connections",
      healthCheck: defaultHealthCheck,
      network: { clientLatency: 5, serverLatency: 3, packetLossRate: 0, bandwidth: 80 },
      stickySession: false, drainingTimeout: 300,
    },
  },
  {
    name: "パケットロス環境",
    description: "10% のパケットロスが発生するネットワーク環境。ドロップされるリクエストの割合を観察。",
    servers: createServers([
      { name: "web-1", baseLatency: 50 },
      { name: "web-2", baseLatency: 50 },
    ]),
    requests: generateUniformRequests(50, 80),
    config: {
      algorithm: "round-robin",
      healthCheck: defaultHealthCheck,
      network: { clientLatency: 20, serverLatency: 10, packetLossRate: 0.1, bandwidth: 500 },
      stickySession: false, drainingTimeout: 300,
    },
  },
];

// ── イベントの色 ──

function eventColor(type: SimEvent["type"]): string {
  switch (type) {
    case "request_in":    return "#3b82f6";
    case "health_check":  return "#64748b";
    case "route":         return "#22c55e";
    case "server_process":return "#f59e0b";
    case "response":      return "#06b6d4";
    case "server_down":   return "#ef4444";
    case "server_up":     return "#10b981";
    case "drop":          return "#f97316";
  }
}

// サーバーごとの色
const SERVER_COLORS = ["#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#a78bfa", "#ec4899", "#06b6d4", "#f97316"];

// ── UI ──

export class ElbApp {
  init(container: HTMLElement): void {
    container.style.cssText = "display:flex;flex-direction:column;height:100vh;font-family:'Fira Code','Cascadia Code',monospace;background:#0f172a;color:#e2e8f0;";

    // ── ヘッダ ──
    const header = document.createElement("div");
    header.style.cssText = "padding:8px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #1e293b;flex-wrap:wrap;";

    const title = document.createElement("h1");
    title.textContent = "ELB Simulator";
    title.style.cssText = "margin:0;font-size:15px;color:#e2e8f0;white-space:nowrap;";
    header.appendChild(title);

    const exSelect = document.createElement("select");
    exSelect.style.cssText = "padding:4px 8px;background:#1e293b;border:1px solid #334155;border-radius:4px;color:#f8fafc;font-size:12px;";
    for (let i = 0; i < EXPERIMENTS.length; i++) {
      const o = document.createElement("option");
      o.value = String(i);
      o.textContent = EXPERIMENTS[i]!.name;
      exSelect.appendChild(o);
    }
    header.appendChild(exSelect);

    const runBtn = document.createElement("button");
    runBtn.textContent = "\u25B6 Run";
    runBtn.style.cssText = "padding:4px 16px;background:#e2e8f0;color:#0f172a;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;";
    header.appendChild(runBtn);

    const descSpan = document.createElement("span");
    descSpan.style.cssText = "font-size:10px;color:#64748b;margin-left:auto;max-width:500px;";
    header.appendChild(descSpan);
    container.appendChild(header);

    // ── メイン ──
    const main = document.createElement("div");
    main.style.cssText = "flex:1;display:flex;overflow:hidden;";

    // 左パネル: 設定 + イベントログ
    const leftPanel = document.createElement("div");
    leftPanel.style.cssText = "width:380px;display:flex;flex-direction:column;border-right:1px solid #1e293b;overflow-y:auto;font-size:10px;";

    const cfgLabel = document.createElement("div");
    cfgLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#f59e0b;border-bottom:1px solid #1e293b;";
    cfgLabel.textContent = "Configuration";
    leftPanel.appendChild(cfgLabel);
    const cfgDiv = document.createElement("div");
    cfgDiv.style.cssText = "padding:8px 12px;border-bottom:1px solid #1e293b;";
    leftPanel.appendChild(cfgDiv);

    const statsLabel = document.createElement("div");
    statsLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#06b6d4;border-bottom:1px solid #1e293b;";
    statsLabel.textContent = "Results";
    leftPanel.appendChild(statsLabel);
    const statsDiv = document.createElement("div");
    statsDiv.style.cssText = "padding:8px 12px;border-bottom:1px solid #1e293b;";
    leftPanel.appendChild(statsDiv);

    const evLabel = document.createElement("div");
    evLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#22c55e;border-bottom:1px solid #1e293b;";
    evLabel.textContent = "Event Log";
    leftPanel.appendChild(evLabel);
    const evDiv = document.createElement("div");
    evDiv.style.cssText = "flex:1;padding:4px 8px;font-size:9px;overflow-y:auto;line-height:1.6;";
    leftPanel.appendChild(evDiv);
    main.appendChild(leftPanel);

    // 右パネル: ビジュアライゼーション
    const rightPanel = document.createElement("div");
    rightPanel.style.cssText = "flex:1;display:flex;flex-direction:column;overflow:hidden;";

    // 分布バーチャート
    const distLabel = document.createElement("div");
    distLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#e2e8f0;border-bottom:1px solid #1e293b;";
    distLabel.textContent = "Request Distribution";
    rightPanel.appendChild(distLabel);
    const distCanvas = document.createElement("canvas");
    distCanvas.style.cssText = "height:140px;width:100%;background:#000;border-bottom:1px solid #1e293b;";
    rightPanel.appendChild(distCanvas);

    // タイムライン
    const tlLabel = document.createElement("div");
    tlLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#a78bfa;border-bottom:1px solid #1e293b;";
    tlLabel.textContent = "Connection Timeline";
    rightPanel.appendChild(tlLabel);
    const tlCanvas = document.createElement("canvas");
    tlCanvas.style.cssText = "flex:1;width:100%;background:#000;";
    rightPanel.appendChild(tlCanvas);

    main.appendChild(rightPanel);
    container.appendChild(main);

    // ── 描画ロジック ──

    const renderConfig = (exp: Experiment) => {
      cfgDiv.innerHTML = "";
      const add = (l: string, v: string, c: string) => {
        const row = document.createElement("div");
        row.style.marginBottom = "2px";
        row.innerHTML = `<span style="color:${c};font-weight:600;">${l}:</span> <span style="color:#94a3b8;">${v}</span>`;
        cfgDiv.appendChild(row);
      };
      add("アルゴリズム", exp.config.algorithm, "#e2e8f0");
      add("サーバー数", String(exp.servers.length), "#3b82f6");
      add("リクエスト数", String(exp.requests.length), "#f59e0b");
      add("クライアント遅延", `${exp.config.network.clientLatency}ms`, "#64748b");
      add("サーバー遅延", `${exp.config.network.serverLatency}ms`, "#64748b");
      add("パケットロス率", `${(exp.config.network.packetLossRate * 100).toFixed(0)}%`, "#ef4444");
      add("帯域幅", `${exp.config.network.bandwidth} 同時接続`, "#06b6d4");
      add("HC 間隔", `${exp.config.healthCheck.interval}ms`, "#22c55e");
      for (const s of exp.servers) {
        add(`  ${s.name}`, `latency=${s.baseLatency}ms, w=${s.weight}, max=${s.maxConnections}`, SERVER_COLORS[exp.servers.indexOf(s) % SERVER_COLORS.length]!);
      }
    };

    const renderStats = (result: SimulationResult) => {
      statsDiv.innerHTML = "";
      const add = (l: string, v: string, c: string) => {
        const row = document.createElement("div");
        row.style.marginBottom = "2px";
        row.innerHTML = `<span style="color:${c};font-weight:600;">${l}:</span> <span style="color:#94a3b8;">${v}</span>`;
        statsDiv.appendChild(row);
      };
      add("平均レスポンスタイム", `${result.avgResponseTime.toFixed(1)}ms`, "#06b6d4");
      add("最大レスポンスタイム", `${result.maxResponseTime.toFixed(1)}ms`, "#f59e0b");
      add("ドロップ数", `${result.droppedRequests} / ${result.totalRequests}`, result.droppedRequests > 0 ? "#ef4444" : "#22c55e");
      add("成功率", `${(((result.totalRequests - result.droppedRequests) / result.totalRequests) * 100).toFixed(1)}%`, "#22c55e");
      add("シミュレーション時間", `${result.totalTime.toFixed(0)}ms`, "#64748b");

      // サーバーごとの分布
      for (const [serverId, count] of result.distribution) {
        const server = result.finalServerStates.find((s) => s.id === serverId);
        const idx = result.finalServerStates.indexOf(server!);
        const pct = ((count / result.totalRequests) * 100).toFixed(1);
        add(`  ${server?.name ?? serverId}`, `${count} req (${pct}%)`, SERVER_COLORS[idx % SERVER_COLORS.length]!);
      }
    };

    const renderEvents = (events: SimEvent[]) => {
      evDiv.innerHTML = "";
      for (const ev of events) {
        const el = document.createElement("div");
        el.style.cssText = "display:flex;gap:4px;align-items:flex-start;margin-bottom:1px;";
        const color = eventColor(ev.type);
        el.innerHTML =
          `<span style="min-width:36px;color:#475569;text-align:right;">${ev.time.toFixed(0)}</span>` +
          `<span style="min-width:80px;padding:0 4px;border-radius:2px;font-size:8px;font-weight:600;text-align:center;color:${color};background:${color}15;border:1px solid ${color}33;">${ev.type}</span>` +
          `<span style="color:#cbd5e1;">${ev.detail}</span>`;
        evDiv.appendChild(el);
      }
    };

    const renderDistribution = (result: SimulationResult) => {
      const dpr = devicePixelRatio;
      const cw = distCanvas.clientWidth;
      const ch = distCanvas.clientHeight;
      distCanvas.width = cw * dpr;
      distCanvas.height = ch * dpr;
      const ctx = distCanvas.getContext("2d")!;
      ctx.scale(dpr, dpr);
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, cw, ch);

      const servers = result.finalServerStates;
      const maxCount = Math.max(...result.distribution.values(), 1);
      const barWidth = Math.min(60, (cw - 40) / servers.length - 10);
      const startX = (cw - (barWidth + 10) * servers.length) / 2;
      const barMaxH = ch - 50;

      for (let i = 0; i < servers.length; i++) {
        const s = servers[i]!;
        const count = result.distribution.get(s.id) ?? 0;
        const barH = (count / maxCount) * barMaxH;
        const x = startX + i * (barWidth + 10);
        const y = ch - 30 - barH;
        const color = SERVER_COLORS[i % SERVER_COLORS.length]!;

        // バー
        ctx.fillStyle = color + "cc";
        ctx.fillRect(x, y, barWidth, barH);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, barWidth, barH);

        // ラベル
        ctx.fillStyle = "#94a3b8";
        ctx.font = "9px monospace";
        ctx.textAlign = "center";
        ctx.fillText(s.name, x + barWidth / 2, ch - 18);
        ctx.fillStyle = color;
        ctx.fillText(String(count), x + barWidth / 2, y - 4);

        // ヘルスインジケータ
        ctx.beginPath();
        ctx.arc(x + barWidth / 2, ch - 8, 3, 0, Math.PI * 2);
        ctx.fillStyle = s.healthy ? "#22c55e" : "#ef4444";
        ctx.fill();
      }
    };

    const renderTimeline = (result: SimulationResult) => {
      const dpr = devicePixelRatio;
      const cw = tlCanvas.clientWidth;
      const ch = tlCanvas.clientHeight;
      tlCanvas.width = cw * dpr;
      tlCanvas.height = ch * dpr;
      const ctx = tlCanvas.getContext("2d")!;
      ctx.scale(dpr, dpr);
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, cw, ch);

      if (result.totalTime === 0) return;

      const pad = { left: 50, right: 20, top: 20, bottom: 30 };
      const plotW = cw - pad.left - pad.right;
      const plotH = ch - pad.top - pad.bottom;

      // 最大接続数を算出
      let maxConn = 1;
      for (const [, timeline] of result.serverTimeline) {
        for (const pt of timeline) {
          if (pt.connections > maxConn) maxConn = pt.connections;
        }
      }

      // 軸
      ctx.strokeStyle = "#334155";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pad.left, pad.top);
      ctx.lineTo(pad.left, pad.top + plotH);
      ctx.lineTo(pad.left + plotW, pad.top + plotH);
      ctx.stroke();

      // Y軸ラベル
      ctx.fillStyle = "#64748b";
      ctx.font = "9px monospace";
      ctx.textAlign = "right";
      for (let i = 0; i <= 4; i++) {
        const v = Math.round((maxConn * i) / 4);
        const y = pad.top + plotH - (i / 4) * plotH;
        ctx.fillText(String(v), pad.left - 5, y + 3);
        // グリッド線
        ctx.strokeStyle = "#1e293b";
        ctx.beginPath();
        ctx.moveTo(pad.left, y);
        ctx.lineTo(pad.left + plotW, y);
        ctx.stroke();
      }

      // X軸ラベル
      ctx.textAlign = "center";
      const timeSteps = 5;
      for (let i = 0; i <= timeSteps; i++) {
        const t = (result.totalTime * i) / timeSteps;
        const x = pad.left + (i / timeSteps) * plotW;
        ctx.fillText(`${t.toFixed(0)}ms`, x, pad.top + plotH + 15);
      }

      // Y軸ラベルタイトル
      ctx.save();
      ctx.translate(12, pad.top + plotH / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillStyle = "#94a3b8";
      ctx.font = "9px monospace";
      ctx.textAlign = "center";
      ctx.fillText("connections", 0, 0);
      ctx.restore();

      // サーバーごとのタイムライン描画
      const servers = result.finalServerStates;
      for (let si = 0; si < servers.length; si++) {
        const s = servers[si]!;
        const timeline = result.serverTimeline.get(s.id) ?? [];
        if (timeline.length === 0) continue;
        const color = SERVER_COLORS[si % SERVER_COLORS.length]!;

        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        let first = true;
        for (const pt of timeline) {
          const x = pad.left + (pt.time / result.totalTime) * plotW;
          const y = pad.top + plotH - (pt.connections / maxConn) * plotH;
          if (first) { ctx.moveTo(x, y); first = false; } else { ctx.lineTo(x, y); }
        }
        ctx.stroke();

        // 凡例
        const legendX = pad.left + 10 + si * 100;
        const legendY = pad.top + 8;
        ctx.fillStyle = color;
        ctx.fillRect(legendX, legendY - 4, 12, 3);
        ctx.fillStyle = "#94a3b8";
        ctx.font = "9px monospace";
        ctx.textAlign = "left";
        ctx.fillText(s.name, legendX + 16, legendY);
      }
    };

    // ── ロジック ──

    const loadExperiment = (exp: Experiment) => {
      descSpan.textContent = exp.description;
      renderConfig(exp);
      statsDiv.innerHTML = '<span style="color:#475569;">▶ Run をクリックしてシミュレーションを実行</span>';
      evDiv.innerHTML = "";
    };

    const runSimulation = (exp: Experiment) => {
      // サーバー状態のディープコピー
      const servers = exp.servers.map((s) => ({ ...s }));
      const requests = exp.requests.map((r) => ({ ...r }));
      const sim = new ElbSimulator();
      const result = sim.simulate(servers, requests, exp.config);

      renderConfig(exp);
      renderStats(result);
      renderEvents(result.events);
      renderDistribution(result);
      renderTimeline(result);
    };

    exSelect.addEventListener("change", () => {
      const exp = EXPERIMENTS[Number(exSelect.value)];
      if (exp) loadExperiment(exp);
    });
    runBtn.addEventListener("click", () => {
      const exp = EXPERIMENTS[Number(exSelect.value)];
      if (exp) runSimulation(exp);
    });
    loadExperiment(EXPERIMENTS[0]!);
  }
}
