/* SQLインジェクション シミュレーター UI */

import { simulate, injectionTypeLabel, inputMethodLabel } from "../sqli/engine.js";
import { PRESETS } from "../sqli/presets.js";
import type { AttackResult, SimOp } from "../sqli/types.js";

/** アプリ初期化 */
export function initApp(): void {
  const app = document.getElementById("app")!;
  app.innerHTML = `
    <div class="container">
      <h1>SQL Injection シミュレーター</h1>
      <div class="controls">
        <label for="preset">プリセット:</label>
        <select id="preset"></select>
        <button id="run">実行</button>
      </div>
      <div id="output"></div>
    </div>
  `;

  const select = document.getElementById("preset") as HTMLSelectElement;
  PRESETS.forEach((p, i) => {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = `${p.name} — ${p.description}`;
    select.appendChild(opt);
  });

  document.getElementById("run")!.addEventListener("click", run);
  run();
}

/** シミュレーション実行 */
function run(): void {
  const idx = parseInt((document.getElementById("preset") as HTMLSelectElement).value, 10);
  const preset = PRESETS[idx];
  const ops: SimOp[] = preset.build();
  const { results, events } = simulate(ops);

  const output = document.getElementById("output")!;
  output.innerHTML = "";

  results.forEach((r, i) => output.appendChild(renderResult(r, i)));
  output.appendChild(renderEventLog(events));
}

/** 攻撃結果カード */
function renderResult(r: AttackResult, idx: number): HTMLElement {
  const card = document.createElement("div");
  card.className = "result-card";

  const attackSuccess = r.injectionSucceeded || r.dataLeaked || r.dataModified || r.authBypassed;
  const statusClass = attackSuccess ? "status-danger" : "status-safe";
  const statusText = attackSuccess ? "攻撃成功" : "攻撃失敗（防御成功）";

  card.innerHTML = `
    <div class="card-header ${statusClass}">
      <h2>攻撃 #${idx + 1}: ${injectionTypeLabel(r.injectionType)}</h2>
      <span class="badge ${statusClass}">${statusText}</span>
    </div>
    <div class="card-body">
      <div class="meta">
        <span class="tag">${inputMethodLabel(r.inputMethod)}</span>
        <span class="tag">${injectionTypeLabel(r.injectionType)}</span>
      </div>

      <div class="status-grid">
        <div class="status-item ${r.injectionSucceeded ? 'active' : ''}">
          <span class="label">インジェクション</span>
          <span class="value">${r.injectionSucceeded ? "成功" : "失敗"}</span>
        </div>
        <div class="status-item ${r.dataLeaked ? 'active' : ''}">
          <span class="label">データ漏洩</span>
          <span class="value">${r.dataLeaked ? "漏洩" : "安全"}</span>
        </div>
        <div class="status-item ${r.authBypassed ? 'active' : ''}">
          <span class="label">認証バイパス</span>
          <span class="value">${r.authBypassed ? "突破" : "安全"}</span>
        </div>
        <div class="status-item ${r.dataModified ? 'active' : ''}">
          <span class="label">データ改ざん</span>
          <span class="value">${r.dataModified ? "破壊" : "安全"}</span>
        </div>
      </div>

      ${renderSqlComparison(r)}
      ${renderQueryResult(r)}
      ${renderSteps(r)}
      ${renderBlocked(r.blocked)}
      ${renderMitigations(r.mitigations)}
    </div>
  `;
  return card;
}

/** SQL比較表示 */
function renderSqlComparison(r: AttackResult): string {
  return `
    <div class="sql-section">
      <div class="sql-block">
        <div class="sql-label">クエリテンプレート</div>
        <code class="sql-code">${esc(r.queryTemplate)}</code>
      </div>
      <div class="sql-block">
        <div class="sql-label">攻撃ペイロード</div>
        <code class="sql-code payload">${esc(r.userInput)}</code>
      </div>
      <div class="sql-block">
        <div class="sql-label">構築されたSQL</div>
        <code class="sql-code constructed">${highlightSql(r.constructedSql)}</code>
      </div>
      ${r.parameterizedSql ? `
        <div class="sql-block">
          <div class="sql-label">パラメータ化クエリ</div>
          <code class="sql-code safe">${esc(r.parameterizedSql)}</code>
        </div>
      ` : ""}
    </div>
  `;
}

/** SQLハイライト */
function highlightSql(sql: string): string {
  return esc(sql)
    .replace(/\b(SELECT|FROM|WHERE|AND|OR|UNION|INSERT|UPDATE|DELETE|DROP|TABLE|INTO|SET|VALUES)\b/gi,
      '<span class="kw">$1</span>')
    .replace(/(--.*$)/gm, '<span class="comment">$1</span>');
}

/** クエリ結果表示 */
function renderQueryResult(r: AttackResult): string {
  const qr = r.queryResult;
  if (!qr.success && qr.error) {
    return `
      <details>
        <summary>クエリ結果（エラー）</summary>
        <div class="error-msg">${esc(qr.error)}</div>
      </details>
    `;
  }
  if (qr.rows.length === 0) {
    return `
      <details>
        <summary>クエリ結果（${qr.affectedRows}行影響）</summary>
        <div class="no-data">結果なし（影響行数: ${qr.affectedRows}）</div>
      </details>
    `;
  }

  const cols = Object.keys(qr.rows[0]);
  return `
    <details open>
      <summary>クエリ結果（${qr.rows.length}行）</summary>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr>${cols.map(c => `<th>${esc(c)}</th>`).join("")}</tr></thead>
          <tbody>
            ${qr.rows.slice(0, 20).map(row => `
              <tr>${cols.map(c => `<td>${esc(String(row[c] ?? "NULL"))}</td>`).join("")}</tr>
            `).join("")}
          </tbody>
        </table>
      </div>
      ${qr.rows.length > 20 ? `<div class="more">... 他 ${qr.rows.length - 20} 行</div>` : ""}
    </details>
  `;
}

/** ステップ表示 */
function renderSteps(r: AttackResult): string {
  if (r.steps.length === 0) return "";
  return `
    <details>
      <summary>処理ステップ (${r.steps.length})</summary>
      <div class="steps">
        ${r.steps.map(s => `
          <div class="step ${s.success ? 'step-success' : 'step-fail'}">
            <span class="step-icon">${s.success ? "✓" : "✗"}</span>
            <div class="step-content">
              <span class="step-phase">[${esc(s.phase)}]</span>
              <span class="step-actor">${esc(s.actor)}</span>
              <span class="step-msg">${esc(s.message)}</span>
              ${s.detail ? `<div class="step-detail">${esc(s.detail)}</div>` : ""}
            </div>
          </div>
        `).join("")}
      </div>
    </details>
  `;
}

/** ブロック理由 */
function renderBlocked(blocked: string[]): string {
  if (blocked.length === 0) return "";
  return `
    <div class="blocked-list">
      <h3>防御によるブロック</h3>
      <ul>${blocked.map(b => `<li>${esc(b)}</li>`).join("")}</ul>
    </div>
  `;
}

/** 防御勧告 */
function renderMitigations(mitigations: string[]): string {
  if (mitigations.length === 0) return "";
  return `
    <div class="mitigations">
      <h3>防御勧告</h3>
      <ul>${mitigations.map(m => `<li>${esc(m)}</li>`).join("")}</ul>
    </div>
  `;
}

/** イベントログ */
function renderEventLog(events: { type: string; actor: string; message: string }[]): HTMLElement {
  const section = document.createElement("div");
  section.className = "event-log";
  section.innerHTML = `
    <details>
      <summary>イベントログ (${events.length})</summary>
      <div class="events">
        ${events.map(e => `
          <div class="event">
            <span class="event-type">${esc(e.type)}</span>
            <span class="event-actor">${esc(e.actor)}</span>
            <span class="event-msg">${esc(e.message)}</span>
          </div>
        `).join("")}
      </div>
    </details>
  `;
  return section;
}

/** HTMLエスケープ */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

initApp();
