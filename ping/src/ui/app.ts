import {
  PingSimulator, host, router, link,
} from "../engine/ping.js";
import type {
  Topology, PingConfig, TracerouteConfig, PingResult, TracerouteResult,
  PingEvent, PingReply, PingStats, TracerouteHop,
} from "../engine/ping.js";

// ── プリセット実験 ──

export type ExperimentMode = "ping" | "traceroute";

export interface Experiment {
  name: string;
  description: string;
  mode: ExperimentMode;
  topology: Topology;
  pingConfig?: PingConfig;
  tracerouteConfig?: TracerouteConfig;
}

// ── トポロジー定義 ──

/** シンプルな LAN トポロジー */
const simpleLan: Topology = {
  hosts: [
    host("my-pc", "192.168.1.10"),
    host("server", "192.168.1.20", { delay: 0.3 }),
  ],
  routers: [router("gw", ["192.168.1.1"])],
  links: [
    link("my-pc", "gw", 1),
    link("gw", "server", 1),
  ],
};

/** マルチホップ WAN トポロジー */
const wanTopo: Topology = {
  hosts: [
    host("client", "10.0.0.10"),
    host("web-server", "203.0.113.80", { delay: 1 }),
  ],
  routers: [
    router("home-gw", ["10.0.0.1"], { delay: 1, jitter: 0.05 }),
    router("isp-r1", ["100.64.0.1"], { delay: 2, jitter: 0.15 }),
    router("ix-r1", ["198.51.100.1"], { delay: 3, jitter: 0.1 }),
    router("dc-r1", ["203.0.113.1"], { delay: 1, jitter: 0.05 }),
  ],
  links: [
    link("client", "home-gw", 2),
    link("home-gw", "isp-r1", 8),
    link("isp-r1", "ix-r1", 15),
    link("ix-r1", "dc-r1", 12),
    link("dc-r1", "web-server", 1),
  ],
};

/** パケットロスのあるトポロジー */
const lossyTopo: Topology = {
  hosts: [
    host("client", "10.0.0.10"),
    host("remote", "172.16.0.10", { delay: 2 }),
  ],
  routers: [
    router("r1", ["10.0.0.1"], { delay: 2, jitter: 0.3 }),
    router("r2", ["172.16.0.1"], { delay: 3, jitter: 0.4 }),
  ],
  links: [
    link("client", "r1", 5),
    link("r1", "r2", 30, { loss: 0.15 }),
    link("r2", "remote", 5),
  ],
};

/** TTL が足りないトポロジー */
const longPath: Topology = {
  hosts: [
    host("src", "10.0.0.2"),
    host("dst", "10.0.9.2"),
  ],
  routers: [
    router("r1", ["10.0.1.1"], { delay: 1 }),
    router("r2", ["10.0.2.1"], { delay: 1 }),
    router("r3", ["10.0.3.1"], { delay: 1 }),
    router("r4", ["10.0.4.1"], { delay: 1 }),
    router("r5", ["10.0.5.1"], { delay: 2 }),
    router("r6", ["10.0.6.1"], { delay: 1 }),
    router("r7", ["10.0.7.1"], { delay: 1 }),
    router("r8", ["10.0.8.1"], { delay: 1 }),
  ],
  links: [
    link("src", "r1", 3), link("r1", "r2", 5), link("r2", "r3", 4),
    link("r3", "r4", 6), link("r4", "r5", 10), link("r5", "r6", 8),
    link("r6", "r7", 5), link("r7", "r8", 4), link("r8", "dst", 2),
  ],
};

/** MTU 不一致トポロジー */
const mtuTopo: Topology = {
  hosts: [
    host("client", "10.0.0.10", { mtu: 1500 }),
    host("server", "172.16.0.10", { mtu: 1500 }),
  ],
  routers: [
    router("r1", ["10.0.0.1"], { delay: 1, mtu: 1500 }),
    router("vpn-r", ["10.10.0.1"], { delay: 3, mtu: 1280 }),
    router("r2", ["172.16.0.1"], { delay: 1, mtu: 1500 }),
  ],
  links: [
    link("client", "r1", 2),
    link("r1", "vpn-r", 15),
    link("vpn-r", "r2", 10),
    link("r2", "server", 2),
  ],
};

/** ICMP 無効ルーターがあるトポロジー */
const silentTopo: Topology = {
  hosts: [
    host("client", "10.0.0.10"),
    host("server", "10.0.4.10"),
  ],
  routers: [
    router("r1", ["10.0.1.1"], { delay: 1 }),
    router("stealth-r", ["10.0.2.1"], { delay: 2, icmp: false }),
    router("r3", ["10.0.3.1"], { delay: 1 }),
  ],
  links: [
    link("client", "r1", 3),
    link("r1", "stealth-r", 8),
    link("stealth-r", "r3", 8),
    link("r3", "server", 3),
  ],
};

/** ホストダウン (応答なし) */
const downTopo: Topology = {
  hosts: [
    host("client", "192.168.1.10"),
    host("down-host", "192.168.1.99", { reply: false }),
  ],
  routers: [router("gw", ["192.168.1.1"])],
  links: [
    link("client", "gw", 1),
    link("gw", "down-host", 1),
  ],
};

/** 混雑ルーター */
const congestedTopo: Topology = {
  hosts: [
    host("client", "10.0.0.10"),
    host("server", "10.0.3.10", { delay: 0.5 }),
  ],
  routers: [
    router("r1", ["10.0.0.1"], { delay: 1, jitter: 0.05 }),
    router("congested", ["10.0.1.1"], { delay: 15, jitter: 0.6, drop: 0.05 }),
    router("r3", ["10.0.2.1"], { delay: 1, jitter: 0.05 }),
  ],
  links: [
    link("client", "r1", 2),
    link("r1", "congested", 5),
    link("congested", "r3", 5),
    link("r3", "server", 2),
  ],
};

export const EXPERIMENTS: Experiment[] = [
  {
    name: "基本 ping — LAN",
    description: "ローカルネットワーク内の単純な ping。低 RTT・ゼロロスの理想的な状況。",
    mode: "ping",
    topology: simpleLan,
    pingConfig: { source: "my-pc", destination: "server", count: 8, interval: 1000, ttl: 64, payloadSize: 56, df: false, recordRoute: false, timeout: 2000, flood: false },
  },
  {
    name: "マルチホップ ping — WAN",
    description: "4 つのルーターを経由する WAN 通信。各ホップのジッターが累積し RTT に変動が生じる。",
    mode: "ping",
    topology: wanTopo,
    pingConfig: { source: "client", destination: "web-server", count: 10, interval: 1000, ttl: 64, payloadSize: 56, df: false, recordRoute: true, timeout: 3000, flood: false },
  },
  {
    name: "パケットロス環境",
    description: "15% のパケットロスが発生するリンク。RTT の変動とロスを観察。",
    mode: "ping",
    topology: lossyTopo,
    pingConfig: { source: "client", destination: "remote", count: 20, interval: 500, ttl: 64, payloadSize: 56, df: false, recordRoute: false, timeout: 3000, flood: false },
  },
  {
    name: "TTL 超過 (Time Exceeded)",
    description: "TTL=4 で 8 ホップの経路に送信。途中のルーターで TTL=0 となり Time Exceeded が返る。",
    mode: "ping",
    topology: longPath,
    pingConfig: { source: "src", destination: "dst", count: 5, interval: 1000, ttl: 4, payloadSize: 56, df: false, recordRoute: false, timeout: 3000, flood: false },
  },
  {
    name: "MTU 超過 & DF (Frag Needed)",
    description: "DF フラグ付きの大きなパケット (1472B) を MTU=1280 のトンネル経由で送信。Frag Needed エラーを観察。",
    mode: "ping",
    topology: mtuTopo,
    pingConfig: { source: "client", destination: "server", count: 3, interval: 1000, ttl: 64, payloadSize: 1472, df: true, recordRoute: false, timeout: 3000, flood: false },
  },
  {
    name: "応答なしホスト",
    description: "ICMP 応答が無効なホストへの ping。全パケットがタイムアウトし 100% ロスとなる。",
    mode: "ping",
    topology: downTopo,
    pingConfig: { source: "client", destination: "down-host", count: 5, interval: 1000, ttl: 64, payloadSize: 56, df: false, recordRoute: false, timeout: 2000, flood: false },
  },
  {
    name: "Flood ping (-f)",
    description: "間隔なしの高速 ping。50 パケットを一気に送信し、混雑ルーターの影響を観察。",
    mode: "ping",
    topology: congestedTopo,
    pingConfig: { source: "client", destination: "server", count: 50, interval: 0, ttl: 64, payloadSize: 56, df: false, recordRoute: false, timeout: 2000, flood: true },
  },
  {
    name: "traceroute — WAN",
    description: "マルチホップ WAN の各ルーターまでの RTT を計測。経路上のノードを順に発見する。",
    mode: "traceroute",
    topology: wanTopo,
    tracerouteConfig: { source: "client", destination: "web-server", maxHops: 15, probesPerHop: 3, payloadSize: 56, timeout: 3000 },
  },
  {
    name: "traceroute — ICMP 無効ルーター",
    description: "経路上に ICMP を返さないルーターが存在。該当ホップが * * * と表示される。",
    mode: "traceroute",
    topology: silentTopo,
    tracerouteConfig: { source: "client", destination: "server", maxHops: 10, probesPerHop: 3, payloadSize: 56, timeout: 3000 },
  },
];

// ── 色定義 ──

function eventColor(type: PingEvent["type"]): string {
  switch (type) {
    case "send":          return "#3b82f6";
    case "recv":          return "#22c55e";
    case "forward":       return "#64748b";
    case "drop":          return "#ef4444";
    case "ttl_expired":   return "#f59e0b";
    case "unreachable":   return "#ef4444";
    case "frag_needed":   return "#f97316";
    case "info":          return "#06b6d4";
  }
}

// ── UI ──

export class PingApp {
  init(container: HTMLElement): void {
    container.style.cssText = "display:flex;flex-direction:column;height:100vh;font-family:'Fira Code','Cascadia Code',monospace;background:#0f172a;color:#e2e8f0;";

    // ── ヘッダ ──
    const header = document.createElement("div");
    header.style.cssText = "padding:8px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #1e293b;flex-wrap:wrap;";
    const title = document.createElement("h1");
    title.textContent = "Ping Simulator";
    title.style.cssText = "margin:0;font-size:15px;color:#e2e8f0;white-space:nowrap;";
    header.appendChild(title);

    const exSelect = document.createElement("select");
    exSelect.style.cssText = "padding:4px 8px;background:#1e293b;border:1px solid #334155;border-radius:4px;color:#f8fafc;font-size:12px;";
    for (let i = 0; i < EXPERIMENTS.length; i++) {
      const o = document.createElement("option"); o.value = String(i); o.textContent = EXPERIMENTS[i]!.name; exSelect.appendChild(o);
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

    // 左パネル
    const leftPanel = document.createElement("div");
    leftPanel.style.cssText = "width:360px;display:flex;flex-direction:column;border-right:1px solid #1e293b;overflow-y:auto;font-size:10px;";

    const cfgLabel = document.createElement("div");
    cfgLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#f59e0b;border-bottom:1px solid #1e293b;";
    cfgLabel.textContent = "Config";
    leftPanel.appendChild(cfgLabel);
    const cfgDiv = document.createElement("div");
    cfgDiv.style.cssText = "padding:8px 12px;border-bottom:1px solid #1e293b;";
    leftPanel.appendChild(cfgDiv);

    const statsLabel = document.createElement("div");
    statsLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#22c55e;border-bottom:1px solid #1e293b;";
    statsLabel.textContent = "Statistics";
    leftPanel.appendChild(statsLabel);
    const statsDiv = document.createElement("div");
    statsDiv.style.cssText = "padding:8px 12px;border-bottom:1px solid #1e293b;";
    leftPanel.appendChild(statsDiv);

    const replyLabel = document.createElement("div");
    replyLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#06b6d4;border-bottom:1px solid #1e293b;";
    replyLabel.textContent = "Replies / Hops";
    leftPanel.appendChild(replyLabel);
    const replyDiv = document.createElement("div");
    replyDiv.style.cssText = "flex:1;padding:4px 8px;overflow-y:auto;";
    leftPanel.appendChild(replyDiv);

    main.appendChild(leftPanel);

    // 右パネル
    const rightPanel = document.createElement("div");
    rightPanel.style.cssText = "flex:1;display:flex;flex-direction:column;overflow:hidden;";

    const chartLabel = document.createElement("div");
    chartLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#a78bfa;border-bottom:1px solid #1e293b;";
    chartLabel.textContent = "RTT Chart";
    rightPanel.appendChild(chartLabel);
    const chartCanvas = document.createElement("canvas");
    chartCanvas.style.cssText = "height:220px;width:100%;background:#000;border-bottom:1px solid #1e293b;";
    rightPanel.appendChild(chartCanvas);

    const evLabel = document.createElement("div");
    evLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#3b82f6;border-bottom:1px solid #1e293b;";
    evLabel.textContent = "Packet Trace";
    rightPanel.appendChild(evLabel);
    const evDiv = document.createElement("div");
    evDiv.style.cssText = "flex:1;padding:4px 8px;font-size:9px;overflow-y:auto;line-height:1.7;";
    rightPanel.appendChild(evDiv);

    main.appendChild(rightPanel);
    container.appendChild(main);

    // ── 描画 ──

    const addRow = (p: HTMLElement, l: string, v: string, c: string) => {
      const r = document.createElement("div"); r.style.marginBottom = "2px";
      r.innerHTML = `<span style="color:${c};font-weight:600;">${l}:</span> <span style="color:#94a3b8;">${v}</span>`;
      p.appendChild(r);
    };

    const renderPingConfig = (exp: Experiment) => {
      cfgDiv.innerHTML = "";
      if (exp.pingConfig) {
        const c = exp.pingConfig;
        addRow(cfgDiv, "モード", "ping", "#a78bfa");
        addRow(cfgDiv, "送信元", c.source, "#e2e8f0");
        addRow(cfgDiv, "宛先", c.destination, "#3b82f6");
        addRow(cfgDiv, "回数", String(c.count), "#f59e0b");
        addRow(cfgDiv, "TTL", String(c.ttl), "#22c55e");
        addRow(cfgDiv, "サイズ", `${c.payloadSize} bytes`, "#64748b");
        if (c.df) addRow(cfgDiv, "DF", "set", "#f97316");
        if (c.flood) addRow(cfgDiv, "Flood", "有効", "#ef4444");
        if (c.recordRoute) addRow(cfgDiv, "Record Route", "有効", "#06b6d4");
      } else if (exp.tracerouteConfig) {
        const c = exp.tracerouteConfig;
        addRow(cfgDiv, "モード", "traceroute", "#a78bfa");
        addRow(cfgDiv, "送信元", c.source, "#e2e8f0");
        addRow(cfgDiv, "宛先", c.destination, "#3b82f6");
        addRow(cfgDiv, "最大ホップ", String(c.maxHops), "#f59e0b");
        addRow(cfgDiv, "プローブ/ホップ", String(c.probesPerHop), "#22c55e");
      }
      addRow(cfgDiv, "ルーター数", String(exp.topology.routers.length), "#64748b");
      addRow(cfgDiv, "リンク数", String(exp.topology.links.length), "#64748b");
    };

    const renderPingStats = (stats: PingStats) => {
      statsDiv.innerHTML = "";
      addRow(statsDiv, "送信", String(stats.transmitted), "#e2e8f0");
      addRow(statsDiv, "受信", String(stats.received), "#22c55e");
      addRow(statsDiv, "ロス", `${stats.lossPercent.toFixed(1)}%`, stats.lossPercent > 0 ? "#ef4444" : "#22c55e");
      addRow(statsDiv, "RTT min", `${stats.rttMin.toFixed(3)} ms`, "#06b6d4");
      addRow(statsDiv, "RTT avg", `${stats.rttAvg.toFixed(3)} ms`, "#3b82f6");
      addRow(statsDiv, "RTT max", `${stats.rttMax.toFixed(3)} ms`, "#f59e0b");
      addRow(statsDiv, "RTT mdev", `${stats.rttMdev.toFixed(3)} ms`, "#a78bfa");
    };

    const renderPingReplies = (replies: PingReply[]) => {
      replyDiv.innerHTML = "";
      for (const r of replies) {
        const el = document.createElement("div");
        el.style.cssText = "margin-bottom:2px;font-size:9px;";
        if (r.success) {
          el.innerHTML = `<span style="color:#22c55e;">#${r.seq}</span> <span style="color:#94a3b8;">${r.bytes}B from ${r.fromIp} ttl=${r.ttl} time=</span><span style="color:#06b6d4;">${r.rtt.toFixed(1)}ms</span>`;
          if (r.route) {
            const routeEl = document.createElement("div");
            routeEl.style.cssText = "margin-left:16px;color:#475569;font-size:8px;";
            routeEl.textContent = `RR: ${r.route.join(" → ")}`;
            el.appendChild(routeEl);
          }
        } else {
          el.innerHTML = `<span style="color:#ef4444;">#${r.seq}</span> <span style="color:#ef4444;">${r.error}${r.fromIp ? ` from ${r.fromIp}` : ""}</span>`;
        }
        replyDiv.appendChild(el);
      }
    };

    const renderTracerouteHops = (hops: TracerouteHop[], reached: boolean) => {
      replyDiv.innerHTML = "";
      for (const h of hops) {
        const el = document.createElement("div");
        el.style.cssText = "margin-bottom:2px;font-size:9px;display:flex;gap:4px;";
        const hopNum = `<span style="color:#64748b;min-width:20px;text-align:right;">${h.hop}</span>`;
        const rttStr = h.rtts.map((r) => r < 0 ? '<span style="color:#ef4444;">*</span>' : `<span style="color:#06b6d4;">${r.toFixed(1)}ms</span>`).join("  ");
        if (h.ip === "*") {
          el.innerHTML = `${hopNum} <span style="color:#ef4444;">* * *</span>`;
        } else {
          el.innerHTML = `${hopNum} <span style="color:#e2e8f0;">${h.hostname}</span> <span style="color:#64748b;">(${h.ip})</span> ${rttStr}`;
        }
        replyDiv.appendChild(el);
      }
      if (!reached) {
        const el = document.createElement("div");
        el.style.cssText = "color:#f59e0b;font-size:9px;margin-top:4px;";
        el.textContent = "宛先に到達できませんでした";
        replyDiv.appendChild(el);
      }
    };

    const renderRttChart = (replies: PingReply[]) => {
      const dpr = devicePixelRatio;
      const cw = chartCanvas.clientWidth;
      const ch = chartCanvas.clientHeight;
      chartCanvas.width = cw * dpr;
      chartCanvas.height = ch * dpr;
      const ctx = chartCanvas.getContext("2d")!;
      ctx.scale(dpr, dpr);
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, cw, ch);

      const pad = { left: 50, right: 20, top: 15, bottom: 25 };
      const plotW = cw - pad.left - pad.right;
      const plotH = ch - pad.top - pad.bottom;

      const successReplies = replies.filter((r) => r.success);
      if (successReplies.length === 0) {
        ctx.fillStyle = "#475569";
        ctx.font = "11px monospace";
        ctx.textAlign = "center";
        ctx.fillText("応答なし", cw / 2, ch / 2);
        return;
      }

      const maxRtt = Math.max(...successReplies.map((r) => r.rtt), 1);
      const totalSeqs = replies.length;

      // 軸
      ctx.strokeStyle = "#334155";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pad.left, pad.top);
      ctx.lineTo(pad.left, pad.top + plotH);
      ctx.lineTo(pad.left + plotW, pad.top + plotH);
      ctx.stroke();

      // Y 軸ラベル
      ctx.fillStyle = "#64748b";
      ctx.font = "9px monospace";
      ctx.textAlign = "right";
      for (let i = 0; i <= 4; i++) {
        const v = (maxRtt * i / 4);
        const y = pad.top + plotH - (i / 4) * plotH;
        ctx.fillText(`${v.toFixed(1)}`, pad.left - 5, y + 3);
        ctx.strokeStyle = "#1e293b"; ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + plotW, y); ctx.stroke();
      }

      // Y 軸タイトル
      ctx.save();
      ctx.translate(12, pad.top + plotH / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillStyle = "#94a3b8";
      ctx.font = "9px monospace";
      ctx.textAlign = "center";
      ctx.fillText("RTT (ms)", 0, 0);
      ctx.restore();

      // X 軸
      ctx.textAlign = "center";
      ctx.fillStyle = "#64748b";
      for (let i = 0; i < totalSeqs; i += Math.max(1, Math.floor(totalSeqs / 10))) {
        const x = pad.left + ((i + 0.5) / totalSeqs) * plotW;
        ctx.fillText(`#${i + 1}`, x, pad.top + plotH + 14);
      }

      // バー + ドット
      const barW = Math.max(2, plotW / totalSeqs - 2);
      for (let i = 0; i < replies.length; i++) {
        const r = replies[i]!;
        const x = pad.left + ((i + 0.5) / totalSeqs) * plotW - barW / 2;

        if (r.success) {
          const barH = (r.rtt / maxRtt) * plotH;
          const y = pad.top + plotH - barH;
          ctx.fillStyle = "#22c55e55";
          ctx.fillRect(x, y, barW, barH);
          // ドット
          ctx.beginPath();
          ctx.arc(x + barW / 2, y, 2.5, 0, Math.PI * 2);
          ctx.fillStyle = "#22c55e";
          ctx.fill();
        } else {
          // 失敗マーカー
          const cx = x + barW / 2;
          const cy = pad.top + plotH - 5;
          ctx.strokeStyle = "#ef4444";
          ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(cx - 3, cy - 3); ctx.lineTo(cx + 3, cy + 3); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(cx + 3, cy - 3); ctx.lineTo(cx - 3, cy + 3); ctx.stroke();
        }
      }

      // 平均線
      if (successReplies.length > 1) {
        const avg = successReplies.reduce((a, r) => a + r.rtt, 0) / successReplies.length;
        const avgY = pad.top + plotH - (avg / maxRtt) * plotH;
        ctx.strokeStyle = "#f59e0b88";
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(pad.left, avgY); ctx.lineTo(pad.left + plotW, avgY); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = "#f59e0b";
        ctx.textAlign = "left";
        ctx.fillText(`avg ${avg.toFixed(1)}ms`, pad.left + plotW + 2, avgY + 3);
      }
    };

    const renderTracerouteChart = (hops: TracerouteHop[]) => {
      const dpr = devicePixelRatio;
      const cw = chartCanvas.clientWidth;
      const ch = chartCanvas.clientHeight;
      chartCanvas.width = cw * dpr;
      chartCanvas.height = ch * dpr;
      const ctx = chartCanvas.getContext("2d")!;
      ctx.scale(dpr, dpr);
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, cw, ch);

      const pad = { left: 50, right: 20, top: 15, bottom: 30 };
      const plotW = cw - pad.left - pad.right;
      const plotH = ch - pad.top - pad.bottom;

      const allRtts = hops.flatMap((h) => h.rtts.filter((r) => r >= 0));
      if (allRtts.length === 0) return;
      const maxRtt = Math.max(...allRtts, 1);

      // 軸
      ctx.strokeStyle = "#334155";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pad.left, pad.top); ctx.lineTo(pad.left, pad.top + plotH); ctx.lineTo(pad.left + plotW, pad.top + plotH);
      ctx.stroke();

      // Y 軸
      ctx.fillStyle = "#64748b"; ctx.font = "9px monospace"; ctx.textAlign = "right";
      for (let i = 0; i <= 4; i++) {
        const v = maxRtt * i / 4;
        const y = pad.top + plotH - (i / 4) * plotH;
        ctx.fillText(`${v.toFixed(0)}`, pad.left - 5, y + 3);
      }

      // ホップごとのバー
      const barW = Math.max(8, plotW / hops.length - 6);
      for (let i = 0; i < hops.length; i++) {
        const h = hops[i]!;
        const cx = pad.left + ((i + 0.5) / hops.length) * plotW;

        ctx.fillStyle = "#64748b"; ctx.font = "8px monospace"; ctx.textAlign = "center";
        ctx.fillText(`${h.hop}`, cx, pad.top + plotH + 12);
        ctx.fillText(h.ip === "*" ? "*" : h.hostname, cx, pad.top + plotH + 22);

        for (let j = 0; j < h.rtts.length; j++) {
          const rtt = h.rtts[j]!;
          if (rtt < 0) {
            ctx.fillStyle = "#ef4444"; ctx.font = "10px monospace";
            ctx.fillText("*", cx + (j - 1) * 6, pad.top + plotH / 2);
            continue;
          }
          const barH = (rtt / maxRtt) * plotH;
          const x = cx - barW / 2 + j * (barW / h.rtts.length);
          const y = pad.top + plotH - barH;
          const w = barW / h.rtts.length - 1;
          ctx.fillStyle = `hsl(${160 - (rtt / maxRtt) * 120}, 70%, 50%)`;
          ctx.fillRect(x, y, w, barH);
        }
      }
    };

    const renderEvents = (events: PingEvent[]) => {
      evDiv.innerHTML = "";
      for (const ev of events) {
        const el = document.createElement("div");
        el.style.cssText = "display:flex;gap:4px;align-items:flex-start;margin-bottom:1px;";
        const ec = eventColor(ev.type);
        el.innerHTML =
          `<span style="min-width:40px;color:#475569;text-align:right;">${ev.time.toFixed(1)}</span>` +
          `<span style="min-width:70px;padding:0 3px;border-radius:2px;font-size:8px;font-weight:600;text-align:center;color:${ec};background:${ec}15;border:1px solid ${ec}33;">${ev.type}</span>` +
          (ev.node ? `<span style="color:#64748b;min-width:50px;">${ev.node}</span>` : "") +
          `<span style="color:#cbd5e1;white-space:pre-wrap;">${ev.detail}</span>`;
        evDiv.appendChild(el);
      }
    };

    // ── ロジック ──

    const loadExperiment = (exp: Experiment) => {
      descSpan.textContent = exp.description;
      renderPingConfig(exp);
      statsDiv.innerHTML = '<span style="color:#475569;">▶ Run をクリックして実行</span>';
      replyDiv.innerHTML = "";
      evDiv.innerHTML = "";
    };

    const runExperiment = (exp: Experiment) => {
      const sim = new PingSimulator(exp.topology);
      renderPingConfig(exp);

      if (exp.mode === "ping" && exp.pingConfig) {
        const result = sim.ping(exp.pingConfig);
        renderPingStats(result.stats);
        renderPingReplies(result.replies);
        renderRttChart(result.replies);
        renderEvents(result.events);
      } else if (exp.mode === "traceroute" && exp.tracerouteConfig) {
        const result = sim.traceroute(exp.tracerouteConfig);
        // traceroute 統計
        statsDiv.innerHTML = "";
        addRow(statsDiv, "ホップ数", String(result.hops.length), "#e2e8f0");
        addRow(statsDiv, "到達", result.reached ? "✓" : "✗", result.reached ? "#22c55e" : "#ef4444");
        renderTracerouteHops(result.hops, result.reached);
        renderTracerouteChart(result.hops);
        renderEvents(result.events);
      }
    };

    exSelect.addEventListener("change", () => { const exp = EXPERIMENTS[Number(exSelect.value)]; if (exp) loadExperiment(exp); });
    runBtn.addEventListener("click", () => { const exp = EXPERIMENTS[Number(exSelect.value)]; if (exp) runExperiment(exp); });
    loadExperiment(EXPERIMENTS[0]!);
  }
}
