/* XSS シミュレーター UI */

import { simulate } from "../xss/engine.js";
import { PRESETS } from "../xss/presets.js";
import type { SimulationResult, AttackResult } from "../xss/types.js";

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

const TYPE_LABELS: Record<string, string> = {
  reflected: "Reflected",
  stored: "Stored",
  dom_based: "DOM-based",
};

const CTX_LABELS: Record<string, string> = {
  html_body: "HTMLボディ",
  html_attribute: "HTML属性",
  href_attribute: "href属性",
  script_string: "JS文字列",
  script_block: "JSブロック",
  event_handler: "イベントハンドラ",
  style: "スタイル",
  url_param: "URLパラメータ",
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

  const executed = r.results.filter(a => a.scriptExecuted).length;
  const blocked = r.results.filter(a => !a.scriptExecuted).length;
  const stolen = r.results.filter(a => a.cookieStolen).length;

  app.innerHTML = `
    <div class="hdr">
      <h1>XSS Simulator</h1>
      <div class="ctrl">
        <select id="sel">${PRESETS.map((p, i) =>
          `<option value="${i}" ${i === selectedIdx ? "selected" : ""}>${p.name}</option>`
        ).join("")}</select>
        <span class="desc">${PRESETS[selectedIdx]?.description ?? ""}</span>
      </div>
    </div>

    <div class="stats">
      <div class="stat"><span class="stat-val">${r.results.length}</span><span class="stat-lbl">攻撃</span></div>
      <div class="stat"><span class="stat-val" style="color:${C.fail}">${executed}</span><span class="stat-lbl">実行成功</span></div>
      <div class="stat"><span class="stat-val" style="color:${C.pass}">${blocked}</span><span class="stat-lbl">ブロック</span></div>
      <div class="stat"><span class="stat-val" style="color:${stolen > 0 ? C.fail : C.pass}">${stolen}</span><span class="stat-lbl">Cookie窃取</span></div>
    </div>

    <div class="results">
      ${r.results.map((a, i) => renderAttack(a, i)).join("")}
    </div>
  `;

  const sel = document.getElementById("sel") as HTMLSelectElement;
  sel.addEventListener("change", () => run(Number(sel.value)));
}

function renderAttack(a: AttackResult, idx: number): string {
  const statusColor = a.scriptExecuted ? C.fail : C.pass;
  const statusLabel = a.scriptExecuted ? "実行成功" : "ブロック";
  const typeColor = a.xssType === "stored" ? C.fail : a.xssType === "dom_based" ? C.purple : C.warn;

  return `
    <div class="atk-card" style="border-left:3px solid ${statusColor}">
      <div class="atk-header">
        <span class="atk-num">#${idx + 1}</span>
        <span class="type-badge" style="background:${typeColor}18;color:${typeColor}">${TYPE_LABELS[a.xssType]}</span>
        <span class="ctx-badge">${CTX_LABELS[a.context] ?? a.context}</span>
        <span class="status-badge" style="background:${statusColor}18;color:${statusColor};border:1px solid ${statusColor}33">${statusLabel}</span>
        ${a.cookieStolen ? `<span class="steal-badge">Cookie窃取</span>` : ""}
        ${a.cspBlocked ? `<span class="csp-badge">CSPブロック</span>` : ""}
      </div>

      <div class="atk-desc">
        <span class="desc-label">攻撃:</span> ${esc(a.payload.description)}
        <span class="desc-intent">(${esc(a.payload.intent)})</span>
      </div>

      <div class="payload-section">
        <div class="payload-box">
          <div class="payload-title">入力ペイロード</div>
          <pre class="payload-code">${esc(a.payload.input)}</pre>
        </div>
        <div class="payload-box">
          <div class="payload-title">サニタイズ後</div>
          <pre class="payload-code">${esc(a.sanitizedHtml)}</pre>
        </div>
      </div>

      <div class="rendered-section">
        <div class="rendered-title">レンダリング結果HTML</div>
        <pre class="rendered-code">${esc(a.renderedHtml)}</pre>
      </div>

      ${a.executedScript ? `
        <div class="exec-section">
          <div class="exec-title">実行されたスクリプト</div>
          <pre class="exec-code">${esc(a.executedScript)}</pre>
        </div>
      ` : ""}

      <div class="steps-section">
        <div class="steps-title">処理ステップ</div>
        ${a.steps.map(s => {
          const sc = s.blocked ? C.fail : s.phase === "execute" && !s.blocked ? C.warn : C.pass;
          const icon = s.blocked ? "✗" : "✓";
          return `<div class="step-item">
            <span class="step-icon" style="color:${sc}">${icon}</span>
            <span class="step-phase">${s.phase}</span>
            <span class="step-msg">${esc(s.message)}</span>
            ${s.detail ? `<span class="step-detail">${esc(s.detail.slice(0, 120))}</span>` : ""}
          </div>`;
        }).join("")}
      </div>

      ${a.blockReasons.length > 0 ? `
        <div class="block-section">
          <div class="block-title">ブロック理由</div>
          ${a.blockReasons.map(r => `<div class="block-item">${esc(r)}</div>`).join("")}
        </div>
      ` : ""}

      <div class="mitigation-section">
        <div class="mitigation-title">防御勧告</div>
        ${a.mitigations.map(m => `<div class="mitigation-item">${esc(m)}</div>`).join("")}
      </div>
    </div>
  `;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function init(): void {
  document.body.style.margin = "0";
  document.body.style.background = C.bg;
  document.body.style.color = C.text;
  document.body.style.fontFamily = "'JetBrains Mono', 'Fira Code', monospace";

  const s = document.createElement("style");
  s.textContent = `
    * { box-sizing: border-box; }
    #app { max-width: 1050px; margin: 0 auto; padding: 16px; }
    .hdr { margin-bottom: 16px; }
    .hdr h1 { font-size: 20px; margin: 0 0 8px; color: ${C.fail}; }
    .ctrl { display: flex; align-items: center; gap: 10px; }
    .ctrl select {
      background: ${C.card}; color: ${C.text}; border: 1px solid ${C.border};
      padding: 6px 10px; border-radius: 4px; font-family: inherit; font-size: 12px;
    }
    .desc { color: ${C.muted}; font-size: 11px; }

    .stats { display: flex; gap: 10px; margin-bottom: 16px; flex-wrap: wrap; }
    .stat {
      background: ${C.card}; border: 1px solid ${C.border}; border-radius: 6px;
      padding: 8px 16px; display: flex; flex-direction: column; align-items: center; min-width: 75px;
    }
    .stat-val { font-size: 18px; font-weight: bold; }
    .stat-lbl { font-size: 9px; color: ${C.muted}; margin-top: 2px; }

    .results { display: flex; flex-direction: column; gap: 14px; }

    .atk-card {
      background: ${C.card}; border: 1px solid ${C.border};
      border-radius: 6px; padding: 14px;
    }
    .atk-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; flex-wrap: wrap; }
    .atk-num { color: ${C.muted}; font-size: 11px; }
    .type-badge { padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; }
    .ctx-badge { background: ${C.accent}18; color: ${C.accent}; padding: 2px 8px; border-radius: 4px; font-size: 10px; }
    .status-badge { padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; }
    .steal-badge { background: ${C.fail}18; color: ${C.fail}; padding: 2px 6px; border-radius: 3px; font-size: 10px; }
    .csp-badge { background: ${C.cyan}18; color: ${C.cyan}; padding: 2px 6px; border-radius: 3px; font-size: 10px; }

    .atk-desc { font-size: 11px; color: ${C.muted}; margin-bottom: 10px; }
    .desc-label { color: ${C.text}; font-weight: bold; }
    .desc-intent { color: ${C.muted}; font-size: 10px; }

    .payload-section { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 8px; }
    .payload-box { background: ${C.bg}; border-radius: 4px; padding: 8px; }
    .payload-title { font-size: 10px; color: ${C.muted}; margin-bottom: 4px; }
    .payload-code {
      font-size: 11px; margin: 0; white-space: pre-wrap; word-break: break-all;
      color: ${C.warn}; line-height: 1.4;
    }

    .rendered-section { background: ${C.bg}; border-radius: 4px; padding: 8px; margin-bottom: 8px; }
    .rendered-title { font-size: 10px; color: ${C.muted}; margin-bottom: 4px; }
    .rendered-code {
      font-size: 11px; margin: 0; white-space: pre-wrap; word-break: break-all;
      color: ${C.text}; line-height: 1.4;
    }

    .exec-section {
      background: ${C.fail}08; border: 1px solid ${C.fail}22;
      border-radius: 4px; padding: 8px; margin-bottom: 8px;
    }
    .exec-title { font-size: 10px; color: ${C.fail}; margin-bottom: 4px; font-weight: bold; }
    .exec-code { font-size: 11px; margin: 0; color: ${C.fail}; white-space: pre-wrap; }

    .steps-section { margin-bottom: 8px; }
    .steps-title { font-size: 10px; color: ${C.muted}; margin-bottom: 4px; }
    .step-item { display: flex; gap: 6px; font-size: 10px; padding: 2px 4px; align-items: baseline; }
    .step-icon { font-weight: bold; min-width: 12px; }
    .step-phase { color: ${C.muted}; min-width: 60px; font-size: 9px; }
    .step-msg { color: ${C.text}; }
    .step-detail { color: ${C.muted}; font-size: 9px; max-width: 400px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    .block-section {
      background: ${C.pass}08; border: 1px solid ${C.pass}22;
      border-radius: 4px; padding: 8px; margin-bottom: 8px;
    }
    .block-title { font-size: 10px; color: ${C.pass}; margin-bottom: 4px; font-weight: bold; }
    .block-item { font-size: 10px; color: ${C.text}; padding: 1px 0; }

    .mitigation-section {
      background: ${C.accent}08; border: 1px solid ${C.accent}22;
      border-radius: 4px; padding: 8px;
    }
    .mitigation-title { font-size: 10px; color: ${C.accent}; margin-bottom: 4px; font-weight: bold; }
    .mitigation-item { font-size: 10px; color: ${C.text}; padding: 1px 0; }
    .mitigation-item::before { content: "→ "; color: ${C.accent}; }

    @media (max-width: 600px) {
      .payload-section { grid-template-columns: 1fr; }
    }
  `;
  document.head.appendChild(s);

  const app = document.createElement("div");
  app.id = "app";
  document.body.appendChild(app);

  run(0);
}

init();
