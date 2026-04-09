import { ConnCostSimulator, NETWORKS, DEFAULT_SERVER } from "../engine/conncost.js";
import type { SimConfig, SimResult, SimEvent, RequestResult, Phasecost } from "../engine/conncost.js";

export interface Experiment { name: string; description: string; config: SimConfig; }

export const EXPERIMENTS: Experiment[] = [
  {
    name: "TCP vs TLS 1.2 vs TLS 1.3 (LAN)",
    description: "LAN (RTT=1ms) で TCP 平文 / TLS 1.2 / TLS 1.3 のコスト差を比較。HS の RTT 数が直接レイテンシに反映される。",
    config: { protocol: "tls13", connMode: "new-per-request", network: NETWORKS.lan!, server: DEFAULT_SERVER, requestCount: 1 },
  },
  {
    name: "TLS 1.2 (2-RTT) — 大陸間 150ms",
    description: "RTT=150ms で TLS 1.2。TCP HS (1-RTT=150ms) + TLS HS (2-RTT=300ms) = TTFB に 450ms の接続オーバーヘッド。",
    config: { protocol: "tls12", connMode: "new-per-request", network: NETWORKS.global!, server: DEFAULT_SERVER, requestCount: 3 },
  },
  {
    name: "TLS 1.3 (1-RTT) — 大陸間 150ms",
    description: "TLS 1.3 なら TLS HS が 1-RTT に短縮。同じ 150ms RTT で TLS 1.2 より 150ms 速い。",
    config: { protocol: "tls13", connMode: "new-per-request", network: NETWORKS.global!, server: DEFAULT_SERVER, requestCount: 3 },
  },
  {
    name: "TLS 1.3 0-RTT 再接続",
    description: "初回はフル TLS 1.3、2 回目以降は 0-RTT で TLS HS コスト=0。リピートユーザーの体感速度が劇的に改善。",
    config: { protocol: "tls13-0rtt", connMode: "new-per-request", network: NETWORKS.crossReg!, server: DEFAULT_SERVER, requestCount: 5 },
  },
  {
    name: "QUIC (1-RTT, TCP+TLS 統合)",
    description: "QUIC は UDP 上で TCP+TLS を 1-RTT で統合。TCP の HS 1-RTT + TLS 1-RTT = 2-RTT が 1-RTT に。",
    config: { protocol: "quic", connMode: "new-per-request", network: NETWORKS.global!, server: DEFAULT_SERVER, requestCount: 3 },
  },
  {
    name: "QUIC 0-RTT — モバイル 3G",
    description: "RTT=200ms のモバイル環境で QUIC 0-RTT。初回以降の接続確立がほぼゼロに。",
    config: { protocol: "quic-0rtt", connMode: "new-per-request", network: NETWORKS.mobile3g!, server: DEFAULT_SERVER, requestCount: 5 },
  },
  {
    name: "Keep-Alive の効果 (10 リクエスト)",
    description: "HTTP/1.1 Keep-Alive で 10 リクエスト。初回のみ接続確立、残り 9 回は再利用。HS オーバーヘッドが 1/10 に。",
    config: { protocol: "tls13", connMode: "keep-alive", network: NETWORKS.crossReg!, server: DEFAULT_SERVER, requestCount: 10 },
  },
  {
    name: "毎回新規接続 vs Keep-Alive 比較",
    description: "同条件 (TLS 1.2, RTT=80ms, 10req) で毎回新規 vs Keep-Alive を比較。接続コストの累積差を観察。",
    config: { protocol: "tls12", connMode: "new-per-request", network: NETWORKS.crossReg!, server: DEFAULT_SERVER, requestCount: 10 },
  },
  {
    name: "衛星回線 (RTT=600ms) の衝撃",
    description: "RTT=600ms の衛星回線。TLS 1.2 だと接続確立だけで 1800ms。QUIC 0-RTT なら劇的改善。",
    config: { protocol: "tls12", connMode: "new-per-request", network: NETWORKS.satellite!, server: { authCostMs: 10, sessionResumption: true, processingMs: 20 }, requestCount: 3 },
  },
];

// ── 色 ──
const PHASE_COLORS: Record<string, string> = {
  "DNS Lookup": "#64748b", "TCP Handshake": "#3b82f6", "TLS 1.2 Handshake": "#a78bfa",
  "TLS 1.3 Handshake": "#8b5cf6", "TLS 1.3 0-RTT": "#22c55e", "QUIC Handshake": "#06b6d4",
  "QUIC 0-RTT": "#10b981", "App Auth": "#ec4899", "Request/Response": "#f59e0b",
  "Connection Reuse": "#22c55e", "Packet Loss Retry": "#ef4444",
};
function phaseColor(phase: string): string { return PHASE_COLORS[phase] ?? "#94a3b8"; }

export class ConnCostApp {
  init(container: HTMLElement): void {
    container.style.cssText = "display:flex;flex-direction:column;height:100vh;font-family:'Fira Code','Cascadia Code',monospace;background:#0f172a;color:#e2e8f0;";

    const header = document.createElement("div"); header.style.cssText = "padding:8px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #1e293b;flex-wrap:wrap;";
    const title = document.createElement("h1"); title.textContent = "Connection Cost Simulator"; title.style.cssText = "margin:0;font-size:15px;white-space:nowrap;"; header.appendChild(title);
    const exSelect = document.createElement("select"); exSelect.style.cssText = "padding:4px 8px;background:#1e293b;border:1px solid #334155;border-radius:4px;color:#f8fafc;font-size:12px;";
    for (let i = 0; i < EXPERIMENTS.length; i++) { const o = document.createElement("option"); o.value = String(i); o.textContent = EXPERIMENTS[i]!.name; exSelect.appendChild(o); }
    header.appendChild(exSelect);
    const runBtn = document.createElement("button"); runBtn.textContent = "\u25B6 Run"; runBtn.style.cssText = "padding:4px 16px;background:#e2e8f0;color:#0f172a;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;"; header.appendChild(runBtn);
    const descSpan = document.createElement("span"); descSpan.style.cssText = "font-size:10px;color:#64748b;margin-left:auto;max-width:500px;"; header.appendChild(descSpan);
    container.appendChild(header);

    const main = document.createElement("div"); main.style.cssText = "flex:1;display:flex;overflow:hidden;";

    // 左パネル
    const leftPanel = document.createElement("div"); leftPanel.style.cssText = "width:370px;display:flex;flex-direction:column;border-right:1px solid #1e293b;overflow-y:auto;font-size:10px;";
    const ms = (l: string, c: string) => { const lb = document.createElement("div"); lb.style.cssText = `padding:4px 12px;font-size:11px;font-weight:600;color:${c};border-bottom:1px solid #1e293b;`; lb.textContent = l; leftPanel.appendChild(lb); const d = document.createElement("div"); d.style.cssText = "padding:8px 12px;border-bottom:1px solid #1e293b;"; leftPanel.appendChild(d); return d; };
    const cfgDiv = ms("Config", "#f59e0b");
    const sumDiv = ms("Summary", "#22c55e");
    const reqLabel = document.createElement("div"); reqLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#06b6d4;border-bottom:1px solid #1e293b;"; reqLabel.textContent = "Requests"; leftPanel.appendChild(reqLabel);
    const reqDiv = document.createElement("div"); reqDiv.style.cssText = "flex:1;padding:4px 8px;overflow-y:auto;"; leftPanel.appendChild(reqDiv);
    main.appendChild(leftPanel);

    // 右パネル
    const rightPanel = document.createElement("div"); rightPanel.style.cssText = "flex:1;display:flex;flex-direction:column;overflow:hidden;";
    const chartLabel = document.createElement("div"); chartLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#a78bfa;border-bottom:1px solid #1e293b;"; chartLabel.textContent = "Cost Breakdown"; rightPanel.appendChild(chartLabel);
    const chartCanvas = document.createElement("canvas"); chartCanvas.style.cssText = "height:260px;width:100%;background:#000;border-bottom:1px solid #1e293b;"; rightPanel.appendChild(chartCanvas);
    const evLabel = document.createElement("div"); evLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#3b82f6;border-bottom:1px solid #1e293b;"; evLabel.textContent = "Trace"; rightPanel.appendChild(evLabel);
    const evDiv = document.createElement("div"); evDiv.style.cssText = "flex:1;padding:4px 8px;font-size:9px;overflow-y:auto;line-height:1.7;"; rightPanel.appendChild(evDiv);
    main.appendChild(rightPanel); container.appendChild(main);

    const addRow = (p: HTMLElement, l: string, v: string, c: string) => { const r = document.createElement("div"); r.style.marginBottom = "2px"; r.innerHTML = `<span style="color:${c};font-weight:600;">${l}:</span> <span style="color:#94a3b8;">${v}</span>`; p.appendChild(r); };

    const renderConfig = (e: Experiment) => {
      cfgDiv.innerHTML = "";
      addRow(cfgDiv, "プロトコル", e.config.protocol, "#a78bfa");
      addRow(cfgDiv, "接続モード", e.config.connMode, "#3b82f6");
      addRow(cfgDiv, "ネットワーク", e.config.network.name, "#f59e0b");
      addRow(cfgDiv, "RTT", `${e.config.network.rttMs}ms`, "#e2e8f0");
      addRow(cfgDiv, "DNS", `${e.config.network.dnsMs}ms`, "#64748b");
      addRow(cfgDiv, "ロス率", `${(e.config.network.lossRate * 100).toFixed(0)}%`, "#ef4444");
      addRow(cfgDiv, "サーバー処理", `${e.config.server.processingMs}ms`, "#22c55e");
      addRow(cfgDiv, "リクエスト数", String(e.config.requestCount), "#06b6d4");
    };

    const renderSummary = (r: SimResult) => {
      sumDiv.innerHTML = "";
      const s = r.summary;
      addRow(sumDiv, "合計時間", `${s.totalTimeMs.toFixed(1)}ms`, "#e2e8f0");
      addRow(sumDiv, "平均 TTFB", `${s.avgTtfbMs.toFixed(1)}ms`, "#06b6d4");
      addRow(sumDiv, "合計 RTT", String(s.totalRtts), "#3b82f6");
      addRow(sumDiv, "合計パケット", String(s.totalPackets), "#64748b");
      addRow(sumDiv, "接続作成", String(s.connectionsCreated), "#f59e0b");
      addRow(sumDiv, "接続再利用", String(s.connectionsReused), "#22c55e");
      addRow(sumDiv, "HS オーバーヘッド", `${s.handshakeOverheadMs.toFixed(0)}ms (${s.handshakeOverheadPercent.toFixed(1)}%)`, "#ef4444");
    };

    const renderRequests = (reqs: RequestResult[]) => {
      reqDiv.innerHTML = "";
      for (const r of reqs) {
        const card = document.createElement("div"); card.style.cssText = "margin-bottom:6px;padding:4px 6px;background:#0a0a1e;border:1px solid #1e293b;border-radius:3px;";
        card.innerHTML = `<div><span style="color:#e2e8f0;font-weight:600;">#${r.requestIndex + 1}</span> <span style="color:${r.connectionReused ? "#22c55e" : "#f59e0b"};">${r.connectionReused ? "再利用" : "新規"}</span> <span style="color:#06b6d4;">${r.totalMs.toFixed(1)}ms</span> <span style="color:#64748b;">${r.totalRtts}RTT ${r.totalPackets}pkt</span></div>`;
        for (const p of r.phases) {
          if (p.durationMs === 0 && p.cpuCost === 0) continue;
          const pc = phaseColor(p.phase);
          const bar = document.createElement("div"); bar.style.cssText = `margin:1px 0;display:flex;align-items:center;gap:4px;font-size:8px;`;
          const maxW = 150;
          const maxMs = Math.max(...reqs.flatMap((rr) => rr.phases.map((pp) => pp.durationMs)), 1);
          const w = Math.max(2, (p.durationMs / maxMs) * maxW);
          bar.innerHTML = `<span style="min-width:100px;color:${pc};">${p.phase}</span><span style="display:inline-block;width:${w}px;height:8px;background:${pc};border-radius:2px;"></span><span style="color:#64748b;">${p.durationMs.toFixed(0)}ms</span>`;
          card.appendChild(bar);
        }
        reqDiv.appendChild(card);
      }
    };

    const renderChart = (reqs: RequestResult[]) => {
      const dpr = devicePixelRatio;
      const cw = chartCanvas.clientWidth; const ch = chartCanvas.clientHeight;
      chartCanvas.width = cw * dpr; chartCanvas.height = ch * dpr;
      const ctx = chartCanvas.getContext("2d")!; ctx.scale(dpr, dpr);
      ctx.fillStyle = "#000"; ctx.fillRect(0, 0, cw, ch);

      if (reqs.length === 0) return;
      const pad = { left: 50, right: 20, top: 20, bottom: 30 };
      const plotW = cw - pad.left - pad.right;
      const plotH = ch - pad.top - pad.bottom;

      const maxMs = Math.max(...reqs.map((r) => r.totalMs), 1);
      const barW = Math.min(50, plotW / reqs.length - 4);
      const startX = pad.left + (plotW - (barW + 4) * reqs.length) / 2;

      // Y軸
      ctx.fillStyle = "#64748b"; ctx.font = "9px monospace"; ctx.textAlign = "right";
      for (let i = 0; i <= 4; i++) {
        const v = (maxMs * i / 4); const y = pad.top + plotH - (i / 4) * plotH;
        ctx.fillText(`${v.toFixed(0)}`, pad.left - 5, y + 3);
        ctx.strokeStyle = "#1e293b"; ctx.lineWidth = 0.5; ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + plotW, y); ctx.stroke();
      }
      ctx.save(); ctx.translate(12, pad.top + plotH / 2); ctx.rotate(-Math.PI / 2);
      ctx.fillStyle = "#94a3b8"; ctx.textAlign = "center"; ctx.fillText("TTFB (ms)", 0, 0); ctx.restore();

      // スタックドバー
      for (let i = 0; i < reqs.length; i++) {
        const r = reqs[i]!;
        const x = startX + i * (barW + 4);
        let y = pad.top + plotH;

        for (const p of r.phases) {
          if (p.durationMs <= 0) continue;
          const h = (p.durationMs / maxMs) * plotH;
          y -= h;
          ctx.fillStyle = phaseColor(p.phase) + "cc";
          ctx.fillRect(x, y, barW, h);
          ctx.strokeStyle = phaseColor(p.phase);
          ctx.lineWidth = 0.5;
          ctx.strokeRect(x, y, barW, h);
        }

        ctx.fillStyle = "#94a3b8"; ctx.font = "9px monospace"; ctx.textAlign = "center";
        ctx.fillText(`#${i + 1}`, x + barW / 2, pad.top + plotH + 14);
        ctx.fillStyle = "#e2e8f0";
        ctx.fillText(`${r.totalMs.toFixed(0)}`, x + barW / 2, y - 4);
      }

      // 凡例
      const phases = [...new Set(reqs.flatMap((r) => r.phases.filter((p) => p.durationMs > 0).map((p) => p.phase)))];
      let lx = pad.left;
      ctx.font = "8px monospace"; ctx.textAlign = "left";
      for (const p of phases) {
        const pc = phaseColor(p);
        ctx.fillStyle = pc; ctx.fillRect(lx, 4, 8, 8);
        ctx.fillStyle = "#94a3b8"; ctx.fillText(p, lx + 10, 11);
        lx += ctx.measureText(p).width + 18;
        if (lx > cw - 60) { lx = pad.left; }
      }
    };

    const renderEvents = (events: SimEvent[]) => {
      evDiv.innerHTML = "";
      for (const ev of events) {
        const el = document.createElement("div"); el.style.cssText = "display:flex;gap:4px;align-items:flex-start;margin-bottom:1px;";
        const pc = phaseColor(ev.phase);
        el.innerHTML = `<span style="min-width:40px;color:#475569;text-align:right;">${ev.time.toFixed(0)}</span><span style="min-width:14px;color:${ev.type === "reuse" ? "#22c55e" : ev.type === "crypto" ? "#a78bfa" : "#94a3b8"};">${ev.type === "start" ? "▶" : ev.type === "end" ? "■" : ev.type === "reuse" ? "♻" : ev.type === "crypto" ? "🔐" : "●"}</span><span style="color:${pc};min-width:40px;font-size:8px;font-weight:600;">${ev.phase}</span><span style="color:#cbd5e1;">${ev.detail}</span>`;
        evDiv.appendChild(el);
      }
    };

    const load = (e: Experiment) => { descSpan.textContent = e.description; renderConfig(e); sumDiv.innerHTML = '<span style="color:#475569;">▶ Run</span>'; reqDiv.innerHTML = ""; evDiv.innerHTML = ""; };
    const run = (e: Experiment) => {
      const sim = new ConnCostSimulator(); const r = sim.simulate(e.config);
      renderConfig(e); renderSummary(r); renderRequests(r.requests); renderChart(r.requests); renderEvents(r.events);
    };
    exSelect.addEventListener("change", () => { const e = EXPERIMENTS[Number(exSelect.value)]; if (e) load(e); });
    runBtn.addEventListener("click", () => { const e = EXPERIMENTS[Number(exSelect.value)]; if (e) run(e); });
    load(EXPERIMENTS[0]!);
  }
}
