import { ConnectionPool } from "../pool/pool.js";
import type { PoolConfig, ConnState, ConnEvent } from "../pool/connection.js";
import type { PoolStats, WorkloadEntry } from "../pool/pool.js";

/** サンプル例 */
export interface Example {
  name: string;
  description: string;
  config: PoolConfig;
  workload: WorkloadEntry[];
  totalTicks: number;
}

/** ワークロード生成ヘルパー: 一定間隔でクエリを発行 */
function repeat(
  name: string,
  duration: number,
  startTick: number,
  count: number,
  interval: number,
): WorkloadEntry[] {
  const entries: WorkloadEntry[] = [];
  for (let i = 0; i < count; i++) {
    entries.push({ tick: startTick + i * interval, name: `${name}#${i + 1}`, duration });
  }
  return entries;
}

/** ワークロード生成ヘルパー: バースト（一度に大量発行） */
function burst(name: string, duration: number, tick: number, count: number): WorkloadEntry[] {
  const entries: WorkloadEntry[] = [];
  for (let i = 0; i < count; i++) {
    entries.push({ tick, name: `${name}#${i + 1}`, duration });
  }
  return entries;
}

export const EXAMPLES: Example[] = [
  {
    name: "基本的な接続プール",
    description: "min=2, max=5 のプールに定期的なクエリを送信。接続の再利用を観察できる。",
    config: {
      minSize: 2, maxSize: 5, createTime: 2,
      idleTimeout: 0, acquireTimeout: 0, maxLifetime: 0,
      errorRate: 0,
    },
    workload: repeat("SELECT", 3, 5, 12, 3),
    totalTicks: 60,
  },
  {
    name: "バースト負荷",
    description: "max=4 のプールに一度に 8 クエリが到着。キュー待ちが発生する。",
    config: {
      minSize: 1, maxSize: 4, createTime: 2,
      idleTimeout: 0, acquireTimeout: 20, maxLifetime: 0,
      errorRate: 0,
    },
    workload: burst("BURST_Q", 5, 5, 8),
    totalTicks: 50,
  },
  {
    name: "プール枯渇とタイムアウト",
    description: "max=3 でスロークエリが占有。後続リクエストが acquireTimeout で失敗する。",
    config: {
      minSize: 1, maxSize: 3, createTime: 2,
      idleTimeout: 0, acquireTimeout: 8, maxLifetime: 0,
      errorRate: 0,
    },
    workload: [
      ...burst("SLOW", 15, 5, 3),
      ...burst("FAST", 2, 10, 5),
    ],
    totalTicks: 50,
  },
  {
    name: "アイドルタイムアウト",
    description: "負荷がなくなるとアイドル接続が idleTimeout で閉じられ minSize まで縮小する。",
    config: {
      minSize: 1, maxSize: 6, createTime: 1,
      idleTimeout: 10, acquireTimeout: 0, maxLifetime: 0,
      errorRate: 0,
    },
    workload: [
      ...burst("INIT", 3, 3, 6),
      ...repeat("LATE", 2, 40, 3, 3),
    ],
    totalTicks: 60,
  },
  {
    name: "接続エラーとリトライ",
    description: "errorRate=0.3 で接続作成が 30% 失敗する。プールが不安定になる様子。",
    config: {
      minSize: 2, maxSize: 5, createTime: 3,
      idleTimeout: 0, acquireTimeout: 15, maxLifetime: 0,
      errorRate: 0.3,
    },
    workload: repeat("QUERY", 4, 8, 10, 4),
    totalTicks: 70,
  },
  {
    name: "最大生存時間 (maxLifetime)",
    description: "maxLifetime=20 で古い接続が自動更新される。接続の世代交代を観察。",
    config: {
      minSize: 2, maxSize: 4, createTime: 2,
      idleTimeout: 0, acquireTimeout: 0, maxLifetime: 20,
      errorRate: 0,
    },
    workload: repeat("WORK", 3, 5, 15, 4),
    totalTicks: 70,
  },
];

/** コネクション状態の表示色 */
function stateColor(state: ConnState): string {
  switch (state) {
    case "creating":   return "#fbbf24";
    case "idle":       return "#10b981";
    case "active":     return "#3b82f6";
    case "destroying": return "#f97316";
    case "closed":     return "#6b7280";
    case "error":      return "#ef4444";
  }
}

/** イベントタイプの表示色 */
function eventColor(type: ConnEvent["type"]): string {
  switch (type) {
    case "create":      return "#10b981";
    case "acquire":     return "#3b82f6";
    case "release":     return "#8b5cf6";
    case "destroy":     return "#f97316";
    case "error":       return "#ef4444";
    case "timeout":     return "#ef4444";
    case "query":       return "#06b6d4";
    case "idle_expire": return "#f59e0b";
    case "enqueue":     return "#a78bfa";
    case "dequeue":     return "#34d399";
  }
}

type Snapshot = {
  tick: number;
  stats: PoolStats;
  connections: { id: number; state: ConnState; query: string | null }[];
};

export class ConnPoolApp {
  init(container: HTMLElement): void {
    container.style.cssText =
      "display:flex;flex-direction:column;height:100vh;font-family:'Fira Code','Cascadia Code',monospace;background:#0f172a;color:#e2e8f0;";

    // ── ヘッダ ──
    const header = document.createElement("div");
    header.style.cssText =
      "padding:8px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #1e293b;flex-wrap:wrap;";

    const title = document.createElement("h1");
    title.textContent = "Connection Pool Simulator";
    title.style.cssText = "margin:0;font-size:15px;color:#06b6d4;";
    header.appendChild(title);

    const exampleSelect = document.createElement("select");
    exampleSelect.style.cssText =
      "padding:4px 8px;background:#1e293b;border:1px solid #334155;border-radius:4px;color:#f8fafc;font-size:12px;";
    for (let i = 0; i < EXAMPLES.length; i++) {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = EXAMPLES[i]!.name;
      exampleSelect.appendChild(opt);
    }
    header.appendChild(exampleSelect);

    const playBtn = document.createElement("button");
    playBtn.textContent = "\u25B6 Play";
    playBtn.style.cssText =
      "padding:4px 16px;background:#06b6d4;color:#0f172a;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;";
    header.appendChild(playBtn);

    const speedLabel = document.createElement("span");
    speedLabel.style.cssText = "font-size:11px;color:#64748b;";
    speedLabel.textContent = "Speed:";
    header.appendChild(speedLabel);

    const speedSlider = document.createElement("input");
    speedSlider.type = "range";
    speedSlider.min = "20";
    speedSlider.max = "500";
    speedSlider.value = "150";
    speedSlider.style.cssText = "width:80px;accent-color:#06b6d4;";
    header.appendChild(speedSlider);

    const configInfo = document.createElement("span");
    configInfo.style.cssText = "font-size:10px;color:#64748b;margin-left:auto;";
    header.appendChild(configInfo);

    container.appendChild(header);

    // ── メインエリア ──
    const main = document.createElement("div");
    main.style.cssText = "flex:1;display:flex;overflow:hidden;";

    // 左パネル: プール可視化 + 説明
    const leftPanel = document.createElement("div");
    leftPanel.style.cssText = "flex:1;display:flex;flex-direction:column;border-right:1px solid #1e293b;overflow-y:auto;";

    // 説明
    const descDiv = document.createElement("div");
    descDiv.style.cssText = "padding:8px 12px;font-size:11px;color:#94a3b8;border-bottom:1px solid #1e293b;line-height:1.5;";
    leftPanel.appendChild(descDiv);

    // 統計バー
    const statsBar = document.createElement("div");
    statsBar.style.cssText = "padding:6px 12px;display:flex;gap:12px;font-size:11px;border-bottom:1px solid #1e293b;flex-wrap:wrap;";
    leftPanel.appendChild(statsBar);

    // プール可視化エリア
    const poolLabel = document.createElement("div");
    poolLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#06b6d4;border-bottom:1px solid #1e293b;";
    poolLabel.textContent = "Connection Pool";
    leftPanel.appendChild(poolLabel);

    const poolViz = document.createElement("div");
    poolViz.style.cssText = "padding:12px;display:flex;gap:8px;flex-wrap:wrap;min-height:80px;align-content:flex-start;";
    leftPanel.appendChild(poolViz);

    // キュー可視化
    const queueLabel = document.createElement("div");
    queueLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#a78bfa;border-bottom:1px solid #1e293b;border-top:1px solid #1e293b;";
    queueLabel.textContent = "Wait Queue";
    leftPanel.appendChild(queueLabel);

    const queueViz = document.createElement("div");
    queueViz.style.cssText = "padding:8px 12px;display:flex;gap:6px;flex-wrap:wrap;min-height:30px;align-content:flex-start;";
    leftPanel.appendChild(queueViz);

    // tick 表示
    const tickDiv = document.createElement("div");
    tickDiv.style.cssText = "padding:4px 12px;font-size:11px;color:#64748b;border-top:1px solid #1e293b;margin-top:auto;";
    leftPanel.appendChild(tickDiv);

    main.appendChild(leftPanel);

    // 右パネル: イベントログ
    const rightPanel = document.createElement("div");
    rightPanel.style.cssText = "width:380px;display:flex;flex-direction:column;";

    const logLabel = document.createElement("div");
    logLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#f59e0b;border-bottom:1px solid #1e293b;";
    logLabel.textContent = "Event Log";
    rightPanel.appendChild(logLabel);

    const logDiv = document.createElement("div");
    logDiv.style.cssText = "flex:1;padding:4px 8px;font-size:10px;overflow-y:auto;line-height:1.5;";
    rightPanel.appendChild(logDiv);

    main.appendChild(rightPanel);
    container.appendChild(main);

    // ── 状態管理 ──
    let snapshots: Snapshot[] = [];
    let events: ConnEvent[] = [];
    let currentFrame = 0;
    let animTimer: ReturnType<typeof setInterval> | null = null;
    let playing = false;

    // ── 描画 ──

    const renderStats = (stats: PoolStats) => {
      statsBar.innerHTML = "";
      const items: [string, number, string][] = [
        ["Total", stats.total, "#e2e8f0"],
        ["Idle", stats.idle, "#10b981"],
        ["Active", stats.active, "#3b82f6"],
        ["Creating", stats.creating, "#fbbf24"],
        ["Waiting", stats.waiting, "#a78bfa"],
        ["Done", stats.completed, "#8b5cf6"],
        ["Errors", stats.errors, "#ef4444"],
        ["Timeouts", stats.timeouts, "#f97316"],
      ];
      for (const [label, value, color] of items) {
        const span = document.createElement("span");
        span.innerHTML = `<span style="color:${color};font-weight:600;">${value}</span> ${label}`;
        statsBar.appendChild(span);
      }
    };

    const renderPool = (snapshot: Snapshot) => {
      poolViz.innerHTML = "";
      for (const conn of snapshot.connections) {
        const box = document.createElement("div");
        const color = stateColor(conn.state);
        box.style.cssText =
          `width:80px;padding:6px 8px;border:2px solid ${color};border-radius:6px;background:${color}15;text-align:center;font-size:10px;transition:all 0.15s;`;
        box.innerHTML =
          `<div style="font-weight:600;color:${color};">Conn#${conn.id}</div>` +
          `<div style="color:#94a3b8;font-size:9px;margin-top:2px;">${conn.state}</div>` +
          (conn.query ? `<div style="color:#e2e8f0;font-size:9px;margin-top:1px;">${conn.query}</div>` : "");
        poolViz.appendChild(box);
      }
      if (snapshot.connections.length === 0) {
        const empty = document.createElement("div");
        empty.style.cssText = "color:#475569;font-size:11px;";
        empty.textContent = "(接続なし)";
        poolViz.appendChild(empty);
      }
    };

    const renderQueue = (snapshot: Snapshot) => {
      queueViz.innerHTML = "";
      // キュー情報はイベントログから推定（snapshotのstats.waitingで表示）
      if (snapshot.stats.waiting > 0) {
        for (let i = 0; i < snapshot.stats.waiting; i++) {
          const box = document.createElement("div");
          box.style.cssText =
            "padding:3px 8px;border:1px solid #a78bfa;border-radius:4px;background:#a78bfa15;font-size:9px;color:#a78bfa;";
          box.textContent = `\u23F3 waiting`;
          queueViz.appendChild(box);
        }
      } else {
        const empty = document.createElement("div");
        empty.style.cssText = "color:#475569;font-size:10px;";
        empty.textContent = "(キュー空)";
        queueViz.appendChild(empty);
      }
    };

    const renderEvents = (tick: number) => {
      logDiv.innerHTML = "";
      const relevant = events.filter((e) => e.time <= tick);
      // 最新50件を表示
      const recent = relevant.slice(-50);
      for (const ev of recent) {
        const line = document.createElement("div");
        line.style.cssText = "display:flex;gap:4px;align-items:flex-start;margin-bottom:1px;";

        const tickSpan = document.createElement("span");
        tickSpan.style.cssText = "color:#475569;min-width:28px;text-align:right;";
        tickSpan.textContent = `t${ev.time}`;
        line.appendChild(tickSpan);

        const badge = document.createElement("span");
        const color = eventColor(ev.type);
        badge.style.cssText = `min-width:58px;padding:0 4px;border-radius:2px;font-size:9px;font-weight:600;text-align:center;color:${color};background:${color}15;border:1px solid ${color}33;`;
        badge.textContent = ev.type;
        line.appendChild(badge);

        const detail = document.createElement("span");
        detail.style.color = "#94a3b8";
        detail.textContent = ev.detail;
        line.appendChild(detail);

        logDiv.appendChild(line);
      }
      logDiv.scrollTop = logDiv.scrollHeight;
    };

    const renderFrame = (frame: number) => {
      const snapshot = snapshots[frame];
      if (snapshot === undefined) return;
      renderStats(snapshot.stats);
      renderPool(snapshot);
      renderQueue(snapshot);
      renderEvents(snapshot.tick);
      tickDiv.textContent = `Tick: ${snapshot.tick} / ${snapshots.length}`;
    };

    // ── シミュレーション実行 ──

    const runSimulation = (example: Example) => {
      stopAnimation();
      const pool = new ConnectionPool(example.config);
      const result = pool.runWorkload(example.workload, example.totalTicks);
      snapshots = result.snapshots;
      events = result.events;
      currentFrame = 0;

      const cfg = example.config;
      configInfo.textContent = `min=${cfg.minSize} max=${cfg.maxSize} create=${cfg.createTime}t idle=${cfg.idleTimeout || "∞"}t acquire=${cfg.acquireTimeout || "∞"}t maxLife=${cfg.maxLifetime || "∞"}t err=${(cfg.errorRate * 100).toFixed(0)}%`;
      descDiv.textContent = example.description;

      renderFrame(0);
    };

    const startAnimation = () => {
      if (playing) return;
      playing = true;
      playBtn.textContent = "\u23F8 Pause";
      animTimer = setInterval(() => {
        if (currentFrame >= snapshots.length - 1) {
          stopAnimation();
          return;
        }
        currentFrame++;
        renderFrame(currentFrame);
      }, Number(speedSlider.value));
    };

    const stopAnimation = () => {
      playing = false;
      playBtn.textContent = "\u25B6 Play";
      if (animTimer !== null) {
        clearInterval(animTimer);
        animTimer = null;
      }
    };

    // ── イベント ──

    exampleSelect.addEventListener("change", () => {
      const ex = EXAMPLES[Number(exampleSelect.value)];
      if (ex !== undefined) runSimulation(ex);
    });

    playBtn.addEventListener("click", () => {
      if (playing) {
        stopAnimation();
      } else {
        if (currentFrame >= snapshots.length - 1) {
          const ex = EXAMPLES[Number(exampleSelect.value)];
          if (ex !== undefined) runSimulation(ex);
        }
        startAnimation();
      }
    });

    speedSlider.addEventListener("input", () => {
      if (playing) {
        stopAnimation();
        startAnimation();
      }
    });

    // 初期表示
    runSimulation(EXAMPLES[0]!);
  }
}
