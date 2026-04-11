/* HLS シミュレーター UI */

import { simulate } from "../hls/engine.js";
import { PRESETS } from "../hls/presets.js";
import type { SimulationResult, PlaybackResult, SimEvent } from "../hls/types.js";

const C = {
  bg: "#0b0d12",
  card: "#131720",
  border: "#1f2636",
  text: "#cdd4e0",
  muted: "#5a6478",
  accent: "#3b82f6",
  pass: "#22c55e",
  fail: "#ef4444",
  warn: "#f59e0b",
  purple: "#a855f7",
  cyan: "#06b6d4",
};

const ABR_LABELS: Record<string, string> = {
  bandwidth: "帯域幅ベース",
  buffer: "バッファベース",
  hybrid: "ハイブリッド",
};

let currentResult: SimulationResult | null = null;
let selectedIdx = 0;

function run(idx: number): void {
  selectedIdx = idx;
  const preset = PRESETS[idx]!;
  const ops = preset.build();
  currentResult = simulate(ops);
  render();
}

function render(): void {
  const app = document.getElementById("app")!;
  if (!currentResult) return;
  const r = currentResult;

  app.innerHTML = `
    <div class="hdr">
      <h1>HLS Simulator</h1>
      <div class="ctrl">
        <select id="sel">${PRESETS.map((p, i) =>
          `<option value="${i}" ${i === selectedIdx ? "selected" : ""}>${p.name}</option>`
        ).join("")}</select>
        <span class="desc">${PRESETS[selectedIdx]?.description ?? ""}</span>
      </div>
    </div>

    <div class="results">
      ${r.results.map((pb, i) => renderPlayback(pb, i)).join("")}
    </div>
  `;

  const sel = document.getElementById("sel") as HTMLSelectElement;
  sel.addEventListener("change", () => run(Number(sel.value)));

  // チャート描画
  r.results.forEach((pb, i) => {
    drawThroughputChart(pb, i);
    drawBufferChart(pb, i);
  });
}

function renderPlayback(pb: PlaybackResult, idx: number): string {
  const p = pb.player;
  const totalSegs = p.downloadedSegments.length;
  const avgThroughput = totalSegs > 0
    ? p.downloadedSegments.reduce((s, d) => s + d.throughput, 0) / totalSegs
    : 0;

  return `
    <div class="pb-card">
      <div class="pb-header">
        <span class="pb-num">#${idx + 1}</span>
        <span class="pb-title">ABR: ${ABR_LABELS[p.abrAlgorithm] ?? p.abrAlgorithm}</span>
        <span class="state-badge state-${p.state}">${p.state}</span>
      </div>

      <div class="stats">
        <div class="stat"><span class="stat-val">${totalSegs}</span><span class="stat-lbl">セグメント</span></div>
        <div class="stat"><span class="stat-val" style="color:${C.pass}">${p.qualitySwitches}</span><span class="stat-lbl">品質切替</span></div>
        <div class="stat"><span class="stat-val" style="color:${p.rebufferCount > 0 ? C.fail : C.pass}">${p.rebufferCount}</span><span class="stat-lbl">リバッファ</span></div>
        <div class="stat"><span class="stat-val">${(p.rebufferDuration / 1000).toFixed(1)}s</span><span class="stat-lbl">リバッファ計</span></div>
        <div class="stat"><span class="stat-val">${(avgThroughput / 1_000_000).toFixed(1)}</span><span class="stat-lbl">平均Mbps</span></div>
        <div class="stat"><span class="stat-val">${p.buffer.totalDuration.toFixed(0)}s</span><span class="stat-lbl">総時間</span></div>
      </div>

      <div class="charts">
        <div class="chart-wrap">
          <div class="chart-title">スループット / 品質</div>
          <canvas id="tp-chart-${idx}" height="120"></canvas>
        </div>
        <div class="chart-wrap">
          <div class="chart-title">バッファレベル</div>
          <canvas id="buf-chart-${idx}" height="120"></canvas>
        </div>
      </div>

      <div class="playlist-section">
        <details>
          <summary>マスタープレイリスト</summary>
          <pre class="playlist-raw">${escapeHtml(pb.masterPlaylistStr)}</pre>
        </details>
        <details>
          <summary>メディアプレイリスト</summary>
          <pre class="playlist-raw">${escapeHtml(pb.mediaPlaylistStr)}</pre>
        </details>
      </div>

      <div class="segments-section">
        <h3>ダウンロードセグメント</h3>
        <div class="seg-list">
          ${p.downloadedSegments.map((ds, i) => {
            const res = getResLabel(pb, ds.renditionIdx);
            return `<div class="seg-item">
              <span class="seg-idx">#${i}</span>
              <span class="seg-res" style="color:${getResColor(ds.renditionIdx, pb)}">${res}</span>
              <span class="seg-size">${(ds.segment.sizeBytes / 1024).toFixed(0)}KB</span>
              <span class="seg-time">${ds.downloadTime.toFixed(0)}ms</span>
              <span class="seg-tp">${(ds.throughput / 1_000_000).toFixed(1)}Mbps</span>
              ${ds.segment.encrypted ? '<span class="seg-enc">AES</span>' : ""}
            </div>`;
          }).join("")}
        </div>
      </div>

      <div class="events-section">
        <h3>イベントログ</h3>
        <div class="events">
          ${pb.events.map(e => renderEvent(e)).join("")}
        </div>
      </div>
    </div>
  `;
}

function getResLabel(pb: PlaybackResult, renditionIdx: number): string {
  // マスタープレイリストからバリアント情報取得
  const segs = pb.player.downloadedSegments;
  if (segs.length === 0) return "?";
  // レンディションインデックスに基づく解像度推定
  const resLabels = ["240p", "360p", "480p", "720p", "1080p", "4K"];
  return resLabels[renditionIdx] ?? `R${renditionIdx}`;
}

function getResColor(renditionIdx: number, _pb: PlaybackResult): string {
  const colors = [C.muted, C.cyan, C.accent, C.pass, C.warn, C.purple];
  return colors[renditionIdx] ?? C.text;
}

function renderEvent(e: SimEvent): string {
  const ec =
    e.type === "error" || e.type === "rebuffer" ? C.fail
    : e.type === "quality_up" ? C.pass
    : e.type === "quality_down" ? C.warn
    : e.type === "abr_switch" ? C.purple
    : e.type === "network_change" ? C.cyan
    : e.type === "state_change" ? C.accent
    : e.type === "encryption" ? C.warn
    : C.muted;

  return `<div class="ev-item">
    <span class="ev-time">${e.time.toFixed(0)}ms</span>
    <span class="ev-type" style="color:${ec}">${e.type}</span>
    <span class="ev-msg">${escapeHtml(e.message)}</span>
    ${e.detail ? `<span class="ev-detail">${escapeHtml(e.detail)}</span>` : ""}
  </div>`;
}

function drawThroughputChart(pb: PlaybackResult, idx: number): void {
  const canvas = document.getElementById(`tp-chart-${idx}`) as HTMLCanvasElement | null;
  if (!canvas) return;

  const segs = pb.player.downloadedSegments;
  if (segs.length === 0) return;

  const w = canvas.parentElement!.clientWidth - 20;
  canvas.width = w;
  const h = canvas.height;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, w, h);

  const maxTp = Math.max(...segs.map(s => s.throughput)) * 1.2;
  const barW = Math.max(2, (w - 40) / segs.length - 1);

  // スループットバー
  segs.forEach((ds, i) => {
    const x = 30 + i * (barW + 1);
    const barH = (ds.throughput / maxTp) * (h - 25);
    ctx.fillStyle = getResColor(ds.renditionIdx, pb);
    ctx.fillRect(x, h - 15 - barH, barW, barH);
  });

  // 軸
  ctx.strokeStyle = C.border;
  ctx.beginPath();
  ctx.moveTo(28, 5);
  ctx.lineTo(28, h - 15);
  ctx.lineTo(w, h - 15);
  ctx.stroke();

  ctx.fillStyle = C.muted;
  ctx.font = "9px monospace";
  ctx.fillText(`${(maxTp / 1_000_000).toFixed(0)}M`, 0, 12);
  ctx.fillText("0", 12, h - 16);
}

function drawBufferChart(pb: PlaybackResult, idx: number): void {
  const canvas = document.getElementById(`buf-chart-${idx}`) as HTMLCanvasElement | null;
  if (!canvas) return;

  const segs = pb.player.downloadedSegments;
  if (segs.length === 0) return;

  const w = canvas.parentElement!.clientWidth - 20;
  canvas.width = w;
  const h = canvas.height;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, w, h);

  // バッファレベル推定（ダウンロード時のhealth推移）
  const bufPoints: number[] = [];
  let buffered = 0;
  let played = 0;
  for (const ds of segs) {
    buffered += ds.segment.duration;
    played += ds.downloadTime / 1000;
    bufPoints.push(Math.max(0, buffered - played));
  }

  const maxBuf = Math.max(...bufPoints, 10) * 1.2;

  // 折れ線
  ctx.strokeStyle = C.accent;
  ctx.lineWidth = 2;
  ctx.beginPath();
  bufPoints.forEach((val, i) => {
    const x = 30 + i * ((w - 40) / (bufPoints.length - 1 || 1));
    const y = h - 15 - (val / maxBuf) * (h - 25);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // 危険ゾーン
  const dangerY = h - 15 - (2 / maxBuf) * (h - 25);
  ctx.strokeStyle = C.fail + "44";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(30, dangerY);
  ctx.lineTo(w, dangerY);
  ctx.stroke();
  ctx.setLineDash([]);

  // 軸
  ctx.strokeStyle = C.border;
  ctx.beginPath();
  ctx.moveTo(28, 5);
  ctx.lineTo(28, h - 15);
  ctx.lineTo(w, h - 15);
  ctx.stroke();

  ctx.fillStyle = C.muted;
  ctx.font = "9px monospace";
  ctx.fillText(`${maxBuf.toFixed(0)}s`, 0, 12);
  ctx.fillText("0", 12, h - 16);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function init(): void {
  document.body.style.margin = "0";
  document.body.style.background = C.bg;
  document.body.style.color = C.text;
  document.body.style.fontFamily = "'JetBrains Mono', 'Fira Code', monospace";

  const s = document.createElement("style");
  s.textContent = `
    * { box-sizing: border-box; }
    #app { max-width: 1100px; margin: 0 auto; padding: 16px; }
    .hdr { margin-bottom: 16px; }
    .hdr h1 { font-size: 20px; margin: 0 0 8px; color: ${C.accent}; }
    .ctrl { display: flex; align-items: center; gap: 10px; }
    .ctrl select {
      background: ${C.card}; color: ${C.text}; border: 1px solid ${C.border};
      padding: 6px 10px; border-radius: 4px; font-family: inherit; font-size: 12px;
    }
    .desc { color: ${C.muted}; font-size: 11px; }

    .results { display: flex; flex-direction: column; gap: 16px; }

    .pb-card {
      background: ${C.card}; border: 1px solid ${C.border};
      border-radius: 6px; padding: 14px;
    }
    .pb-header { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
    .pb-num { color: ${C.muted}; font-size: 11px; }
    .pb-title { font-size: 15px; font-weight: bold; }
    .state-badge { padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: bold; }
    .state-ended { background: ${C.pass}18; color: ${C.pass}; }
    .state-playing { background: ${C.accent}18; color: ${C.accent}; }
    .state-buffering { background: ${C.warn}18; color: ${C.warn}; }
    .state-error { background: ${C.fail}18; color: ${C.fail}; }

    .stats {
      display: flex; gap: 10px; margin-bottom: 14px; flex-wrap: wrap;
    }
    .stat {
      background: ${C.bg}; border: 1px solid ${C.border}; border-radius: 6px;
      padding: 8px 14px; display: flex; flex-direction: column; align-items: center; min-width: 75px;
    }
    .stat-val { font-size: 16px; font-weight: bold; }
    .stat-lbl { font-size: 9px; color: ${C.muted}; margin-top: 2px; }

    .charts { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 14px; }
    .chart-wrap {
      background: ${C.bg}; border: 1px solid ${C.border}; border-radius: 6px; padding: 10px;
    }
    .chart-title { font-size: 10px; color: ${C.muted}; margin-bottom: 6px; }
    .chart-wrap canvas { width: 100%; }

    .playlist-section { margin-bottom: 12px; }
    .playlist-section details { margin-bottom: 4px; }
    .playlist-section summary {
      font-size: 11px; color: ${C.accent}; cursor: pointer; padding: 4px 0;
    }
    .playlist-raw {
      font-size: 10px; background: ${C.bg}; padding: 8px; border-radius: 4px;
      overflow-x: auto; margin: 4px 0 0; white-space: pre; line-height: 1.5;
      border: 1px solid ${C.border};
    }

    .segments-section { margin-bottom: 12px; }
    .segments-section h3 { font-size: 11px; color: ${C.muted}; margin: 0 0 6px; }
    .seg-list { max-height: 200px; overflow-y: auto; }
    .seg-item { display: flex; gap: 8px; font-size: 10px; padding: 2px 4px; align-items: center; }
    .seg-item:nth-child(even) { background: ${C.bg}44; }
    .seg-idx { color: ${C.muted}; min-width: 24px; }
    .seg-res { font-weight: bold; min-width: 40px; }
    .seg-size { min-width: 50px; color: ${C.muted}; }
    .seg-time { min-width: 50px; }
    .seg-tp { min-width: 55px; color: ${C.accent}; }
    .seg-enc { background: ${C.warn}18; color: ${C.warn}; padding: 0 4px; border-radius: 2px; font-size: 9px; }

    .events-section { margin-top: 10px; }
    .events-section h3 { font-size: 11px; color: ${C.muted}; margin: 0 0 6px; }
    .events {
      max-height: 250px; overflow-y: auto; background: ${C.bg};
      border: 1px solid ${C.border}; border-radius: 4px; padding: 6px;
    }
    .ev-item { display: flex; gap: 6px; font-size: 10px; padding: 2px 0; align-items: baseline; }
    .ev-time { min-width: 50px; color: ${C.muted}; text-align: right; font-size: 9px; }
    .ev-type { min-width: 90px; font-size: 9px; }
    .ev-msg { color: ${C.text}; }
    .ev-detail { color: ${C.muted}; font-size: 9px; }

    @media (max-width: 700px) {
      .charts { grid-template-columns: 1fr; }
    }
  `;
  document.head.appendChild(s);

  const app = document.createElement("div");
  app.id = "app";
  document.body.appendChild(app);

  run(0);
}

init();
