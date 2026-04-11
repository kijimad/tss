/* QUIC プロトコル シミュレーター UI */

import { simulate } from "../quic/engine.js";
import { PRESETS } from "../quic/presets.js";
import type { SimulationResult, QuicConnection } from "../quic/types.js";

// ─── カラーパレット ───
const C = {
  bg: "#0a0e14",
  card: "#131820",
  border: "#1e2a3a",
  text: "#c5d0de",
  muted: "#5c6b7f",
  accent: "#00bcd4",    // シアン
  warn: "#ff9800",
  err: "#f44336",
  ok: "#4caf50",
  purple: "#9c27b0",
  blue: "#2196f3",
  teal: "#009688",
  // パケットタイプ別
  initial: "#ff9800",
  handshake: "#9c27b0",
  zero_rtt: "#4caf50",
  one_rtt: "#2196f3",
  retry: "#f44336",
};

const EVENT_COLORS: Record<string, string> = {
  handshake: C.purple, tls: C.purple,
  packet_sent: C.blue, packet_recv: C.teal,
  packet_lost: C.err, packet_ack: C.ok,
  stream: C.accent, flow_control: C.warn,
  congestion: C.err, migration: "#ff5722",
  close: C.muted, zero_rtt: C.ok, info: C.muted,
};

let currentResult: SimulationResult | null = null;

function run(idx: number): void {
  const preset = PRESETS[idx]!;
  const { ops, network, congestionAlgo } = preset.build();
  currentResult = simulate(ops, network, congestionAlgo);
  render();
}

function render(): void {
  const app = document.getElementById("app")!;
  if (!currentResult) return;
  const r = currentResult;
  const conn = r.connection;

  app.innerHTML = `
    <div class="hdr">
      <h1>QUIC Protocol Simulator</h1>
      <div class="ctrl">
        <select id="sel">${PRESETS.map((p, i) => `<option value="${i}">${p.name}</option>`).join("")}</select>
        <span class="desc" id="desc">${PRESETS[0]?.description ?? ""}</span>
      </div>
    </div>
    <div class="grid">
      <div class="col-l">
        ${renderStats(r)}
        ${renderHandshake(conn)}
        ${renderCwndChart(conn)}
        ${renderStreams(conn)}
      </div>
      <div class="col-r">
        ${renderPackets(conn)}
        ${renderPaths(conn)}
        ${renderEvents(r)}
      </div>
    </div>
  `;

  const sel = document.getElementById("sel") as HTMLSelectElement;
  sel.addEventListener("change", () => {
    run(Number(sel.value));
    const d = document.getElementById("desc");
    if (d) d.textContent = PRESETS[Number(sel.value)]?.description ?? "";
  });

  drawCwndCanvas(conn);
}

// ─── 統計 ───
function renderStats(r: SimulationResult): string {
  const conn = r.connection;
  const items = [
    { l: "状態", v: conn.state, c: conn.state === "connected" || conn.state === "closed" ? C.ok : C.warn },
    { l: "ハンドシェイクRTT", v: `${r.handshakeRtts}-RTT`, c: r.handshakeRtts === 0 ? C.ok : C.accent },
    { l: "送信バイト", v: fmtBytes(r.totalBytesSent), c: C.text },
    { l: "ロスト", v: String(r.lostPackets), c: r.lostPackets > 0 ? C.err : C.ok },
    { l: "SRTT", v: `${Math.round(conn.congestion.smoothedRtt)}ms`, c: C.accent },
    { l: "cwnd", v: fmtBytes(conn.congestion.cwnd), c: C.blue },
    { l: "ストリーム", v: String(conn.streams.length), c: C.teal },
    { l: "パケット数", v: `送${conn.sentPackets.length}/受${conn.recvPackets.length}`, c: C.muted },
  ];
  return `<div class="card"><h2>統計情報</h2><div class="stats">${items.map(i =>
    `<div class="si"><span class="sl">${i.l}</span><span class="sv" style="color:${i.c}">${i.v}</span></div>`
  ).join("")}</div></div>`;
}

// ─── ハンドシェイク ───
function renderHandshake(conn: QuicConnection): string {
  const tls = conn.tls;
  const msgs = tls.messages.map(m => {
    const isClient = ["client_hello"].includes(m);
    const color = isClient ? C.blue : C.purple;
    const arrow = isClient ? "→" : "←";
    return `<div class="hs-msg" style="border-left:3px solid ${color}"><span class="hs-arrow">${arrow}</span> ${m.replace(/_/g, " ").toUpperCase()}</div>`;
  }).join("");

  return `<div class="card"><h2>TLS 1.3 ハンドシェイク</h2>
    <div class="hs-info">
      <span>暗号: ${tls.cipherSuite}</span>
      <span>ALPN: ${tls.alpn}</span>
      ${tls.zeroRttEnabled ? `<span style="color:${C.ok}">0-RTT: ${tls.zeroRttAccepted ? "受理" : "拒否"}</span>` : ""}
      ${tls.sessionTicket ? `<span>チケット: ${tls.sessionTicket.slice(0, 16)}…</span>` : ""}
    </div>
    <div class="hs-timeline">${msgs}</div>
  </div>`;
}

// ─── cwndグラフ ───
function renderCwndChart(conn: QuicConnection): string {
  const cc = conn.congestion;
  return `<div class="card"><h2>輻輳制御 (${cc.algo.toUpperCase()}) — ${cc.phase.replace(/_/g, " ")}</h2>
    <div class="cc-info">
      <span>cwnd=${fmtBytes(cc.cwnd)}</span>
      <span>ssthresh=${cc.ssthresh === Infinity ? "∞" : fmtBytes(cc.ssthresh)}</span>
      <span>minRTT=${cc.minRtt === Infinity ? "-" : Math.round(cc.minRtt) + "ms"}</span>
      <span>PTO=${Math.round(cc.pto)}ms</span>
    </div>
    <canvas id="cwnd-canvas" width="600" height="180"></canvas>
  </div>`;
}

function drawCwndCanvas(conn: QuicConnection): void {
  const canvas = document.getElementById("cwnd-canvas") as HTMLCanvasElement | null;
  if (!canvas) return;
  const ctx = canvas.getContext("2d")!;
  const W = canvas.width, H = canvas.height;
  const hist = conn.congestion.cwndHistory;
  if (hist.length < 2) return;

  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

  const maxCwnd = Math.max(...hist.map(h => h.cwnd), 1);
  const maxTime = Math.max(...hist.map(h => h.time), 1);

  // グリッド
  ctx.strokeStyle = C.border;
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= 4; i++) {
    const y = H - (i / 4) * (H - 20) - 10;
    ctx.beginPath(); ctx.moveTo(40, y); ctx.lineTo(W - 10, y); ctx.stroke();
    ctx.fillStyle = C.muted;
    ctx.font = "9px monospace";
    ctx.textAlign = "right";
    ctx.fillText(fmtBytes(Math.round(maxCwnd * i / 4)), 38, y + 3);
  }

  // cwnd曲線
  ctx.beginPath();
  ctx.strokeStyle = C.accent;
  ctx.lineWidth = 2;
  for (let i = 0; i < hist.length; i++) {
    const x = 40 + (hist[i]!.time / maxTime) * (W - 50);
    const y = H - 10 - (hist[i]!.cwnd / maxCwnd) * (H - 30);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // ssthreshライン
  if (conn.congestion.ssthresh !== Infinity) {
    const sy = H - 10 - (conn.congestion.ssthresh / maxCwnd) * (H - 30);
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = C.warn;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(40, sy); ctx.lineTo(W - 10, sy); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = C.warn;
    ctx.font = "9px monospace";
    ctx.textAlign = "left";
    ctx.fillText("ssthresh", W - 70, sy - 4);
  }

  // 軸ラベル
  ctx.fillStyle = C.muted;
  ctx.font = "9px monospace";
  ctx.textAlign = "center";
  ctx.fillText("time (ms)", W / 2, H - 0);
}

// ─── ストリーム ───
function renderStreams(conn: QuicConnection): string {
  if (conn.streams.length === 0) return "";
  const rows = conn.streams.map(s => {
    const stColor = s.state === "open" ? C.ok : s.state === "closed" ? C.muted : C.warn;
    return `<tr>
      <td>#${s.id}</td>
      <td><span style="color:${stColor}">${s.state}</span></td>
      <td>${s.direction}</td>
      <td>${fmtBytes(s.sendOffset)}</td>
      <td>${fmtBytes(s.recvOffset)}</td>
      <td>${fmtBytes(s.maxStreamData)}</td>
      <td>${s.finSent ? "✓" : ""} ${s.finRecv ? "✓" : ""}</td>
    </tr>`;
  }).join("");

  return `<div class="card"><h2>ストリーム (${conn.streams.length})</h2>
    <table class="tbl"><thead><tr>
      <th>ID</th><th>状態</th><th>方向</th><th>送信</th><th>受信</th><th>上限</th><th>FIN</th>
    </tr></thead><tbody>${rows}</tbody></table>
  </div>`;
}

// ─── パケット一覧 ───
function renderPackets(conn: QuicConnection): string {
  const allPkts = [
    ...conn.sentPackets.map(p => ({ ...p, dir: "→" as const })),
    ...conn.recvPackets.map(p => ({ ...p, dir: "←" as const })),
  ].sort((a, b) => a.sentTime - b.sentTime || a.header.packetNumber - b.header.packetNumber);

  const rows = allPkts.slice(0, 40).map(p => {
    const typeColor = (C as Record<string, string>)[p.header.type] ?? C.muted;
    const status = p.lost ? `<span style="color:${C.err}">LOST</span>` :
                   p.acked ? `<span style="color:${C.ok}">ACK</span>` : "";
    const frames = p.frames.map(f => f.type).join(", ");
    return `<tr>
      <td style="color:${p.dir === "→" ? C.blue : C.teal}">${p.dir}</td>
      <td><span class="pkt-type" style="background:${typeColor}22;color:${typeColor};border:1px solid ${typeColor}44">${p.header.type}</span></td>
      <td>#${p.header.packetNumber}</td>
      <td>${p.size}B</td>
      <td>${Math.round(p.sentTime)}ms</td>
      <td>${status}</td>
      <td class="frames-cell">${frames}</td>
    </tr>`;
  }).join("");

  return `<div class="card"><h2>パケット (${allPkts.length})</h2>
    <div class="pkt-scroll"><table class="tbl"><thead><tr>
      <th></th><th>Type</th><th>PN</th><th>Size</th><th>Time</th><th>Status</th><th>Frames</th>
    </tr></thead><tbody>${rows}</tbody></table></div>
  </div>`;
}

// ─── パス ───
function renderPaths(conn: QuicConnection): string {
  if (conn.paths.length <= 1) return "";
  const rows = conn.paths.map(p => {
    const stColor = p.active ? C.ok : C.muted;
    return `<div class="path-item" style="border-left:3px solid ${stColor}">
      <span>Path ${p.id}</span>
      <span>${p.localAddr} → ${p.remoteAddr}</span>
      <span style="color:${stColor}">${p.active ? "Active" : "Inactive"} ${p.validated ? "✓" : "…"}</span>
      ${p.rtt > 0 ? `<span>RTT=${p.rtt}ms</span>` : ""}
    </div>`;
  }).join("");

  return `<div class="card"><h2>パス (${conn.paths.length})</h2>${rows}</div>`;
}

// ─── イベントログ ───
function renderEvents(r: SimulationResult): string {
  const rows = r.events.map(e => {
    const color = EVENT_COLORS[e.type] ?? C.muted;
    return `<div class="ev">
      <span class="ev-t">${Math.round(e.time)}ms</span>
      <span class="ev-badge" style="background:${color}18;color:${color};border:1px solid ${color}33">${e.type}</span>
      <span class="ev-m">${e.message}</span>
      ${e.detail ? `<span class="ev-d">${e.detail}</span>` : ""}
    </div>`;
  }).join("");

  return `<div class="card"><h2>イベントログ (${r.events.length})</h2>
    <div class="ev-scroll">${rows}</div>
  </div>`;
}

// ─── ユーティリティ ───
function fmtBytes(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "MB";
  if (n >= 1000) return (n / 1000).toFixed(1) + "KB";
  return n + "B";
}

// ─── 初期化 ───
function init(): void {
  document.body.style.margin = "0";
  document.body.style.background = C.bg;
  document.body.style.color = C.text;
  document.body.style.fontFamily = "'JetBrains Mono', 'Fira Code', monospace";

  const s = document.createElement("style");
  s.textContent = `
    * { box-sizing: border-box; }
    #app { max-width: 1280px; margin: 0 auto; padding: 12px; }
    .hdr { margin-bottom: 12px; }
    .hdr h1 { font-size: 18px; margin: 0 0 6px; color: ${C.accent}; }
    .ctrl { display: flex; align-items: center; gap: 10px; }
    .ctrl select {
      background: ${C.card}; color: ${C.text}; border: 1px solid ${C.border};
      padding: 5px 8px; border-radius: 4px; font-family: inherit; font-size: 12px;
    }
    .desc { color: ${C.muted}; font-size: 11px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .col-l, .col-r { display: flex; flex-direction: column; gap: 10px; }
    .card {
      background: ${C.card}; border: 1px solid ${C.border};
      border-radius: 6px; padding: 10px;
    }
    .card h2 { margin: 0 0 8px; font-size: 12px; color: ${C.muted}; text-transform: uppercase; letter-spacing: 0.5px; }
    .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
    .si { display: flex; flex-direction: column; }
    .sl { font-size: 9px; color: ${C.muted}; }
    .sv { font-size: 15px; font-weight: bold; }

    .hs-info { display: flex; flex-wrap: wrap; gap: 10px; font-size: 10px; color: ${C.muted}; margin-bottom: 8px; }
    .hs-timeline { display: flex; flex-direction: column; gap: 3px; }
    .hs-msg { font-size: 11px; padding: 3px 8px; }
    .hs-arrow { font-weight: bold; }

    .cc-info { display: flex; gap: 12px; font-size: 10px; color: ${C.muted}; margin-bottom: 6px; }
    canvas { display: block; border-radius: 4px; width: 100%; }

    .tbl { width: 100%; border-collapse: collapse; font-size: 10px; }
    .tbl th { text-align: left; padding: 3px 5px; border-bottom: 1px solid ${C.border}; color: ${C.muted}; font-size: 9px; }
    .tbl td { padding: 3px 5px; border-bottom: 1px solid ${C.border}11; }
    .pkt-type { padding: 1px 5px; border-radius: 3px; font-size: 9px; }
    .frames-cell { font-size: 9px; color: ${C.muted}; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pkt-scroll { max-height: 320px; overflow-y: auto; }

    .path-item { display: flex; gap: 10px; padding: 4px 8px; font-size: 11px; align-items: center; margin-bottom: 4px; }

    .ev-scroll { max-height: 300px; overflow-y: auto; }
    .ev { display: flex; gap: 5px; padding: 2px 0; align-items: baseline; font-size: 10px; flex-wrap: wrap; }
    .ev-t { color: ${C.muted}; font-size: 9px; min-width: 40px; }
    .ev-badge { padding: 1px 4px; border-radius: 3px; font-size: 8px; white-space: nowrap; }
    .ev-m { color: ${C.text}; }
    .ev-d { color: ${C.muted}; font-size: 9px; }

    @media (max-width: 900px) { .grid { grid-template-columns: 1fr; } }
  `;
  document.head.appendChild(s);

  const app = document.createElement("div");
  app.id = "app";
  document.body.appendChild(app);

  run(0);
}

init();
