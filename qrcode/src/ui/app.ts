/* QRコード シミュレーター UI */

import { simulate } from "../qrcode/engine.js";
import { PRESETS } from "../qrcode/presets.js";
import type { SimulationResult, QrResult, Module } from "../qrcode/types.js";

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
  finder: "#ef4444",
  timing: "#f59e0b",
  alignment: "#22c55e",
  format: "#3b82f6",
  data: "#cdd4e0",
  darkMod: "#a855f7",
};

const MODULE_COLORS: Record<string, string> = {
  finder: C.finder,
  separator: "#374151",
  timing: C.timing,
  alignment: C.alignment,
  format_info: C.format,
  version_info: C.purple,
  dark_module: C.darkMod,
  data: C.data,
  empty: "#1f2636",
};

const MODULE_LABELS: Record<string, string> = {
  finder: "ファインダー",
  separator: "セパレータ",
  timing: "タイミング",
  alignment: "アライメント",
  format_info: "フォーマット情報",
  version_info: "バージョン情報",
  dark_module: "ダークモジュール",
  data: "データ",
};

const MODE_LABELS: Record<string, string> = {
  numeric: "数字",
  alphanumeric: "英数字",
  byte: "バイト",
  kanji: "漢字",
};

let currentResult: SimulationResult | null = null;
let selectedIdx = 0;
let highlightType: string | null = null;

function run(idx: number): void {
  selectedIdx = idx;
  const preset = PRESETS[idx]!;
  const ops = preset.build();
  currentResult = simulate(ops);
  highlightType = null;
  render();
}

function render(): void {
  const app = document.getElementById("app")!;
  if (!currentResult) return;
  const r = currentResult;

  app.innerHTML = `
    <div class="hdr">
      <h1>QR Code Simulator</h1>
      <div class="ctrl">
        <select id="sel">${PRESETS.map((p, i) =>
          `<option value="${i}" ${i === selectedIdx ? "selected" : ""}>${p.name}</option>`
        ).join("")}</select>
        <span class="desc">${PRESETS[selectedIdx]?.description ?? ""}</span>
      </div>
    </div>

    <div class="results">
      ${r.results.map((qr, i) => renderQrResult(qr, i)).join("")}
    </div>

    <div class="events-section">
      <h2>イベントログ</h2>
      <div class="events">
        ${r.events.map(e => {
          const ec = e.type === "error" ? C.fail
            : e.type === "complete" ? C.pass
            : e.type === "mask" ? C.purple
            : C.muted;
          return `<div class="ev-item">
            <span class="ev-type" style="color:${ec}">${e.type}</span>
            <span class="ev-msg">${escapeHtml(e.message)}</span>
          </div>`;
        }).join("")}
      </div>
    </div>
  `;

  const sel = document.getElementById("sel") as HTMLSelectElement;
  sel.addEventListener("change", () => run(Number(sel.value)));

  // QRキャンバス描画
  r.results.forEach((qr, i) => drawQr(qr, i));

  // モジュールタイプフィルタ
  document.querySelectorAll(".type-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const type = (btn as HTMLElement).dataset.type!;
      highlightType = highlightType === type ? null : type;
      document.querySelectorAll(".type-btn").forEach(b => b.classList.remove("active"));
      if (highlightType) btn.classList.add("active");
      r.results.forEach((qr, i) => drawQr(qr, i));
    });
  });
}

function renderQrResult(qr: QrResult, idx: number): string {
  const a = qr.analysis;
  const e = qr.encoded;
  const m = qr.matrix;

  return `
    <div class="qr-card">
      <div class="qr-header">
        <span class="qr-num">#${idx + 1}</span>
        <span class="qr-title">V${a.version} (${m.size}x${m.size})</span>
        <span class="mode-badge">${MODE_LABELS[a.mode] ?? a.mode}</span>
        <span class="ec-badge ec-${a.ecLevel}">${a.ecLevel}</span>
      </div>

      <div class="qr-body">
        <div class="qr-canvas-wrap">
          <canvas id="qr-canvas-${idx}" width="${m.size * 6}" height="${m.size * 6}"></canvas>
          <div class="type-filter">
            ${Object.entries(MODULE_LABELS).map(([type, label]) =>
              `<button class="type-btn" data-type="${type}" style="--tc:${MODULE_COLORS[type]}">
                <span class="type-dot" style="background:${MODULE_COLORS[type]}"></span>${label}
              </button>`
            ).join("")}
          </div>
        </div>

        <div class="qr-info">
          <div class="info-section">
            <h3>データ分析</h3>
            <div class="info-row"><span>入力:</span><span class="info-val">${escapeHtml(a.input.slice(0, 40))}${a.input.length > 40 ? "…" : ""}</span></div>
            <div class="info-row"><span>モード:</span><span class="info-val">${MODE_LABELS[a.mode] ?? a.mode}</span></div>
            <div class="info-row"><span>文字数:</span><span class="info-val">${a.charCount}</span></div>
            <div class="info-row"><span>バージョン:</span><span class="info-val">${a.version} (${m.size}x${m.size})</span></div>
            <div class="info-row"><span>EC レベル:</span><span class="info-val">${a.ecLevel} (${{ L: 7, M: 15, Q: 25, H: 30 }[a.ecLevel]}%復元)</span></div>
          </div>

          <div class="info-section">
            <h3>エンコード</h3>
            <div class="info-row"><span>モードインジケータ:</span><span class="info-val mono">${e.modeIndicator}</span></div>
            <div class="info-row"><span>文字数インジケータ:</span><span class="info-val mono">${e.charCountIndicator}</span></div>
            <div class="info-row"><span>データビット:</span><span class="info-val">${e.dataBits.length}bit</span></div>
            <div class="info-row"><span>ビットストリーム:</span><span class="info-val">${e.fullBitstream.length}bit</span></div>
            <div class="info-row"><span>データCW:</span><span class="info-val">${e.dataCodewords.length}個</span></div>
            <div class="info-row"><span>EC CW:</span><span class="info-val">${e.ecCodewords.length}個</span></div>
            <div class="info-row"><span>合計CW:</span><span class="info-val">${e.finalCodewords.length}個</span></div>
          </div>

          <div class="info-section">
            <h3>マスク</h3>
            <div class="info-row"><span>パターン:</span><span class="info-val">${m.maskPattern}</span></div>
            <div class="info-row"><span>Rule 1 (連続):</span><span class="info-val">${m.penalties.rule1}</span></div>
            <div class="info-row"><span>Rule 2 (2x2):</span><span class="info-val">${m.penalties.rule2}</span></div>
            <div class="info-row"><span>Rule 3 (類似):</span><span class="info-val">${m.penalties.rule3}</span></div>
            <div class="info-row"><span>Rule 4 (比率):</span><span class="info-val">${m.penalties.rule4}</span></div>
            <div class="info-row"><span>合計ペナルティ:</span><span class="info-val" style="color:${C.warn}">${m.penalties.total}</span></div>
          </div>
        </div>
      </div>

      <div class="steps-section">
        <h3>処理ステップ</h3>
        <div class="steps">
          ${qr.steps.map(s => {
            const phaseColor: Record<string, string> = {
              analyze: C.accent, encode: C.pass, ec: C.purple,
              interleave: C.warn, place: C.timing, mask: C.darkMod, format: C.format,
            };
            return `<div class="step-item">
              <span class="step-phase" style="color:${phaseColor[s.phase] ?? C.muted}">${s.phase}</span>
              <span class="step-msg">${escapeHtml(s.message)}</span>
              ${s.detail ? `<span class="step-detail">${escapeHtml(s.detail)}</span>` : ""}
            </div>`;
          }).join("")}
        </div>
      </div>

      ${renderCodewords(e.dataCodewords, "データコードワード", C.pass)}
      ${renderCodewords(e.ecCodewords, "ECコードワード", C.purple)}
    </div>
  `;
}

function renderCodewords(cw: number[], title: string, color: string): string {
  if (cw.length > 40) {
    return `<div class="cw-section">
      <span class="cw-title" style="color:${color}">${title} (${cw.length}個):</span>
      <span class="cw-vals">${cw.slice(0, 40).map(v => v.toString(16).padStart(2, "0")).join(" ")} …</span>
    </div>`;
  }
  return `<div class="cw-section">
    <span class="cw-title" style="color:${color}">${title} (${cw.length}個):</span>
    <span class="cw-vals">${cw.map(v => v.toString(16).padStart(2, "0")).join(" ")}</span>
  </div>`;
}

function drawQr(qr: QrResult, idx: number): void {
  const canvas = document.getElementById(`qr-canvas-${idx}`) as HTMLCanvasElement | null;
  if (!canvas) return;

  const size = qr.matrix.size;
  const scale = 6;
  canvas.width = size * scale;
  canvas.height = size * scale;

  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const mod = qr.matrix.matrix[r][c];
      ctx.fillStyle = getModuleColor(mod);
      ctx.fillRect(c * scale, r * scale, scale, scale);
    }
  }
}

function getModuleColor(mod: Module): string {
  if (highlightType) {
    if (mod.type === highlightType) {
      return mod.dark ? MODULE_COLORS[mod.type] : "#1a1a2e";
    }
    return mod.dark ? "#2a2a3e" : "#0d0d14";
  }

  if (mod.dark) {
    // 色付きモード
    if (mod.type === "data") return "#e0e0e0";
    return MODULE_COLORS[mod.type] ?? "#ffffff";
  }
  return "#0f1015";
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

    .qr-card {
      background: ${C.card}; border: 1px solid ${C.border};
      border-radius: 6px; padding: 14px;
    }
    .qr-header { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
    .qr-num { color: ${C.muted}; font-size: 11px; }
    .qr-title { font-size: 16px; font-weight: bold; }
    .mode-badge { background: ${C.pass}18; color: ${C.pass}; padding: 2px 8px; border-radius: 4px; font-size: 11px; }
    .ec-badge { padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; }
    .ec-L { background: ${C.pass}18; color: ${C.pass}; }
    .ec-M { background: ${C.accent}18; color: ${C.accent}; }
    .ec-Q { background: ${C.warn}18; color: ${C.warn}; }
    .ec-H { background: ${C.fail}18; color: ${C.fail}; }

    .qr-body { display: flex; gap: 16px; flex-wrap: wrap; }
    .qr-canvas-wrap { flex-shrink: 0; }
    .qr-canvas-wrap canvas {
      border: 2px solid ${C.border}; border-radius: 4px;
      image-rendering: pixelated;
      width: auto; height: auto;
      max-width: 300px; max-height: 300px;
    }
    .type-filter { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; max-width: 300px; }
    .type-btn {
      background: ${C.bg}; border: 1px solid ${C.border}; border-radius: 3px;
      color: ${C.muted}; font-size: 9px; padding: 2px 6px; cursor: pointer;
      font-family: inherit; display: flex; align-items: center; gap: 3px;
    }
    .type-btn:hover { border-color: var(--tc); }
    .type-btn.active { border-color: var(--tc); color: var(--tc); background: ${C.card}; }
    .type-dot { width: 6px; height: 6px; border-radius: 50%; }

    .qr-info { flex: 1; min-width: 250px; }
    .info-section { margin-bottom: 10px; }
    .info-section h3 { font-size: 11px; color: ${C.muted}; margin: 0 0 4px; border-bottom: 1px solid ${C.border}; padding-bottom: 2px; }
    .info-row { display: flex; justify-content: space-between; font-size: 11px; padding: 1px 0; }
    .info-row span:first-child { color: ${C.muted}; }
    .info-val { color: ${C.text}; }
    .info-val.mono { font-family: monospace; letter-spacing: 1px; }

    .steps-section { margin-top: 10px; }
    .steps-section h3 { font-size: 11px; color: ${C.muted}; margin: 0 0 4px; }
    .steps { display: flex; flex-direction: column; gap: 2px; }
    .step-item { display: flex; gap: 6px; font-size: 10px; padding: 2px 4px; align-items: baseline; }
    .step-phase { min-width: 70px; font-size: 9px; }
    .step-msg { color: ${C.text}; }
    .step-detail { color: ${C.muted}; font-size: 9px; }

    .cw-section { margin-top: 6px; font-size: 10px; }
    .cw-title { font-weight: bold; }
    .cw-vals { color: ${C.muted}; font-family: monospace; word-break: break-all; }

    .events-section { margin-top: 20px; }
    .events-section h2 { font-size: 14px; color: ${C.accent}; margin: 0 0 8px; }
    .events {
      background: ${C.card}; border: 1px solid ${C.border}; border-radius: 6px;
      padding: 10px; max-height: 250px; overflow-y: auto;
    }
    .ev-item { display: flex; gap: 6px; font-size: 10px; padding: 2px 0; }
    .ev-type { min-width: 80px; font-size: 9px; }
    .ev-msg { color: ${C.text}; }
  `;
  document.head.appendChild(s);

  const app = document.createElement("div");
  app.id = "app";
  document.body.appendChild(app);

  run(0);
}

init();
