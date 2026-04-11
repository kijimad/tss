/* CORS シミュレーター UI */

import { simulate } from "../cors/engine.js";
import { PRESETS } from "../cors/presets.js";
import type { SimulationResult, RequestResult, SimStep } from "../cors/types.js";

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
  preflight: "#a855f7",
  same: "#64748b",
  opaque: "#6b7280",
};

const VERDICT_COLORS: Record<string, string> = {
  allowed: C.pass, same_origin: C.same, opaque: C.opaque,
  blocked_origin: C.fail, blocked_method: C.fail,
  blocked_header: C.fail, blocked_credentials: C.fail,
  blocked_preflight: C.fail, no_cors_header: C.fail,
};

const VERDICT_LABELS: Record<string, string> = {
  allowed: "許可", same_origin: "同一オリジン", opaque: "不透明",
  blocked_origin: "オリジン拒否", blocked_method: "メソッド拒否",
  blocked_header: "ヘッダ拒否", blocked_credentials: "クレデンシャルエラー",
  blocked_preflight: "プリフライト失敗", no_cors_header: "CORSヘッダなし",
};

const CLASS_LABELS: Record<string, string> = {
  same_origin: "同一オリジン",
  simple_cors: "単純リクエスト",
  preflight_cors: "プリフライト必要",
  no_cors: "no-cors",
};

let currentResult: SimulationResult | null = null;

function run(idx: number): void {
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
      <h1>CORS Simulator</h1>
      <div class="ctrl">
        <select id="sel">${PRESETS.map((p, i) => `<option value="${i}">${p.name}</option>`).join("")}</select>
        <span class="desc" id="desc">${PRESETS[0]?.description ?? ""}</span>
      </div>
    </div>
    <div class="results">
      ${r.results.map((res, i) => renderRequest(res, i)).join("")}
    </div>
  `;

  const sel = document.getElementById("sel") as HTMLSelectElement;
  sel.addEventListener("change", () => {
    run(Number(sel.value));
    const d = document.getElementById("desc");
    if (d) d.textContent = PRESETS[Number(sel.value)]?.description ?? "";
  });
}

function renderRequest(res: RequestResult, idx: number): string {
  const vc = VERDICT_COLORS[res.verdict] ?? C.muted;
  const vl = VERDICT_LABELS[res.verdict] ?? res.verdict;
  const cl = CLASS_LABELS[res.classification] ?? res.classification;

  return `
    <div class="req-card" style="border-left: 3px solid ${vc}">
      <div class="req-header">
        <div class="req-title">
          <span class="req-num">#${idx + 1}</span>
          <span class="req-method">${res.request.method}</span>
          <span class="req-url">${res.request.url}</span>
          <span class="verdict-badge" style="background:${vc}18;color:${vc};border:1px solid ${vc}33">${vl}</span>
        </div>
        <div class="req-meta">
          <span>Origin: <b>${res.request.origin}</b></span>
          <span class="class-badge">${cl}</span>
          ${res.request.credentials ? '<span class="cred-badge">credentials</span>' : ""}
          ${res.preflightCached ? '<span class="cache-badge">キャッシュ</span>' : ""}
        </div>
      </div>

      ${Object.keys(res.request.headers).length > 0 ? `
        <div class="req-headers">
          <span class="hdr-label">リクエストヘッダ:</span>
          ${Object.entries(res.request.headers).map(([k, v]) =>
            `<span class="hdr-item">${k}: ${v.length > 30 ? v.slice(0, 30) + "…" : v}</span>`
          ).join("")}
        </div>
      ` : ""}

      <div class="steps">
        ${res.steps.map(s => renderStep(s)).join("")}
      </div>

      ${res.preflightResponse ? renderHeaders("プリフライトレスポンス", res.preflightResponse) : ""}
      ${res.actualResponse ? renderHeaders("レスポンスCORSヘッダ", res.actualResponse) : ""}

      <div class="req-events">
        ${res.events.map(e => {
          const ec = e.type.includes("pass") || e.type === "same_origin" || e.type === "cache_hit"
            ? C.pass
            : e.type.includes("fail") || e.type.includes("error")
              ? C.fail
              : e.type === "preflight" || e.type === "preflight_pass" ? C.preflight : C.muted;
          return `<div class="ev-item">
            <span class="ev-badge" style="color:${ec}">${e.type}</span>
            <span>${e.message}</span>
          </div>`;
        }).join("")}
      </div>
    </div>
  `;
}

function renderStep(step: SimStep): string {
  const icon = step.success ? "✓" : "✗";
  const color = step.success ? (step.verdict === "allowed" ? C.pass : C.accent) : C.fail;
  const phaseLabel: Record<string, string> = {
    classify: "分類",
    preflight_send: "Preflight送信",
    preflight_check: "Preflightチェック",
    actual_send: "リクエスト送信",
    cors_check: "CORSチェック",
    result: "結果",
  };

  return `
    <div class="step ${step.success ? "" : "step-fail"}">
      <span class="step-icon" style="color:${color}">${icon}</span>
      <span class="step-phase">${phaseLabel[step.phase] ?? step.phase}</span>
      <span class="step-msg">${step.message}</span>
      ${step.detail ? `<span class="step-detail">${step.detail}</span>` : ""}
      ${step.headers ? `<div class="step-headers">${Object.entries(step.headers).map(([k, v]) =>
        `<div class="sh-item"><span class="sh-key">${k}:</span> <span class="sh-val">${v}</span></div>`
      ).join("")}</div>` : ""}
    </div>
  `;
}

function renderHeaders(title: string, headers: Record<string, string | undefined>): string {
  const entries = Object.entries(headers).filter((e): e is [string, string] => e[1] !== undefined);
  if (entries.length === 0) return "";

  return `
    <div class="cors-headers">
      <span class="ch-title">${title}</span>
      ${entries.map(([k, v]) => {
        const isAcao = k === "access-control-allow-origin";
        const isAcac = k === "access-control-allow-credentials";
        const highlight = isAcao ? C.pass : isAcac ? C.warn : C.accent;
        return `<div class="ch-item">
          <span class="ch-key" style="color:${highlight}">${k}:</span>
          <span class="ch-val">${v}</span>
        </div>`;
      }).join("")}
    </div>
  `;
}

function init(): void {
  document.body.style.margin = "0";
  document.body.style.background = C.bg;
  document.body.style.color = C.text;
  document.body.style.fontFamily = "'JetBrains Mono', 'Fira Code', monospace";

  const s = document.createElement("style");
  s.textContent = `
    * { box-sizing: border-box; }
    #app { max-width: 960px; margin: 0 auto; padding: 16px; }
    .hdr { margin-bottom: 16px; }
    .hdr h1 { font-size: 20px; margin: 0 0 8px; color: ${C.accent}; }
    .ctrl { display: flex; align-items: center; gap: 10px; }
    .ctrl select {
      background: ${C.card}; color: ${C.text}; border: 1px solid ${C.border};
      padding: 6px 10px; border-radius: 4px; font-family: inherit; font-size: 12px;
    }
    .desc { color: ${C.muted}; font-size: 11px; }

    .results { display: flex; flex-direction: column; gap: 14px; }

    .req-card {
      background: ${C.card}; border: 1px solid ${C.border};
      border-radius: 6px; padding: 14px;
    }
    .req-header { margin-bottom: 10px; }
    .req-title { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .req-num { color: ${C.muted}; font-size: 11px; }
    .req-method { color: ${C.accent}; font-weight: bold; font-size: 14px; }
    .req-url { font-size: 13px; }
    .verdict-badge { padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; }
    .req-meta { display: flex; gap: 12px; font-size: 11px; color: ${C.muted}; margin-top: 4px; align-items: center; }
    .req-meta b { color: ${C.text}; }
    .class-badge { background: ${C.preflight}15; color: ${C.preflight}; padding: 1px 6px; border-radius: 3px; font-size: 10px; }
    .cred-badge { background: ${C.warn}15; color: ${C.warn}; padding: 1px 6px; border-radius: 3px; font-size: 10px; }
    .cache-badge { background: ${C.pass}15; color: ${C.pass}; padding: 1px 6px; border-radius: 3px; font-size: 10px; }

    .req-headers { display: flex; flex-wrap: wrap; gap: 6px; font-size: 10px; color: ${C.muted}; margin-bottom: 8px; }
    .hdr-label { color: ${C.muted}; }
    .hdr-item { background: ${C.bg}; padding: 2px 6px; border-radius: 3px; }

    .steps { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; }
    .step { display: flex; gap: 6px; align-items: flex-start; font-size: 11px; padding: 4px 6px; border-radius: 4px; }
    .step-fail { background: ${C.fail}08; }
    .step-icon { font-weight: bold; min-width: 14px; }
    .step-phase { color: ${C.muted}; min-width: 110px; font-size: 10px; }
    .step-msg { color: ${C.text}; }
    .step-detail { color: ${C.muted}; font-size: 10px; }
    .step-headers { margin-top: 3px; padding-left: 130px; }
    .sh-item { font-size: 10px; }
    .sh-key { color: ${C.accent}; }
    .sh-val { color: ${C.text}; }

    .cors-headers { margin: 6px 0; padding: 6px 8px; background: ${C.bg}; border-radius: 4px; }
    .ch-title { font-size: 10px; color: ${C.muted}; display: block; margin-bottom: 3px; }
    .ch-item { font-size: 11px; }
    .ch-key { margin-right: 4px; }
    .ch-val { color: ${C.text}; }

    .req-events { margin-top: 8px; border-top: 1px solid ${C.border}; padding-top: 6px; }
    .ev-item { display: flex; gap: 6px; font-size: 10px; padding: 1px 0; }
    .ev-badge { min-width: 90px; font-size: 9px; }
  `;
  document.head.appendChild(s);

  const app = document.createElement("div");
  app.id = "app";
  document.body.appendChild(app);

  run(0);
}

init();
