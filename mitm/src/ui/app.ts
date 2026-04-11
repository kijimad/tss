/* MITM シミュレーター UI */

import { simulate, attackMethodLabel } from "../mitm/engine.js";
import { PRESETS } from "../mitm/presets.js";
import type { AttackResult, SimOp, Packet } from "../mitm/types.js";

/** アプリ初期化 */
export function initApp(): void {
  const app = document.getElementById("app")!;
  app.innerHTML = `
    <div class="container">
      <h1>MITM 攻撃シミュレーター</h1>
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
  // 初回実行
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

  // 結果カード
  results.forEach((r, i) => {
    output.appendChild(renderResult(r, i));
  });

  // イベントログ
  output.appendChild(renderEventLog(events));
}

/** 攻撃結果カードを描画 */
function renderResult(r: AttackResult, idx: number): HTMLElement {
  const card = document.createElement("div");
  card.className = "result-card";

  // 攻撃成功/失敗の判定
  const attackSuccess = r.dataLeaked || r.tampered;
  const statusClass = attackSuccess ? "status-danger" : "status-safe";
  const statusText = attackSuccess ? "攻撃成功" : "攻撃失敗（防御成功）";

  card.innerHTML = `
    <div class="card-header ${statusClass}">
      <h2>攻撃 #${idx + 1}: ${attackMethodLabel(r.method)}</h2>
      <span class="badge ${statusClass}">${statusText}</span>
    </div>
    <div class="card-body">
      <div class="status-grid">
        <div class="status-item ${r.intercepted ? 'active' : ''}">
          <span class="label">傍受</span>
          <span class="value">${r.intercepted ? "○" : "×"}</span>
        </div>
        <div class="status-item ${r.dataLeaked ? 'active' : ''}">
          <span class="label">データ漏洩</span>
          <span class="value">${r.dataLeaked ? "○" : "×"}</span>
        </div>
        <div class="status-item ${r.tampered ? 'active' : ''}">
          <span class="label">改ざん</span>
          <span class="value">${r.tampered ? "○" : "×"}</span>
        </div>
      </div>

      ${renderSteps(r)}
      ${renderArpTable(r)}
      ${renderDnsTable(r)}
      ${renderPackets(r.packets)}
      ${renderBlocked(r.blocked)}
      ${renderMitigations(r.mitigations)}
    </div>
  `;
  return card;
}

/** 攻撃ステップ表示 */
function renderSteps(r: AttackResult): string {
  if (r.steps.length === 0) return "";
  return `
    <details open>
      <summary>攻撃ステップ (${r.steps.length})</summary>
      <div class="steps">
        ${r.steps.map(s => `
          <div class="step ${s.success ? 'step-success' : 'step-fail'}">
            <span class="step-icon">${s.success ? "✓" : "✗"}</span>
            <div class="step-content">
              <span class="step-phase">[${s.phase}]</span>
              <span class="step-actor">${s.actor}</span>
              <span class="step-msg">${esc(s.message)}</span>
              ${s.detail ? `<div class="step-detail">${esc(s.detail)}</div>` : ""}
            </div>
          </div>
        `).join("")}
      </div>
    </details>
  `;
}

/** ARPテーブル表示 */
function renderArpTable(r: AttackResult): string {
  const spoofed = r.arpTable.filter(e => e.spoofed);
  if (spoofed.length === 0 && r.method !== "arp_spoofing") return "";
  return `
    <details>
      <summary>ARPテーブル${spoofed.length > 0 ? " (汚染あり)" : ""}</summary>
      <table class="data-table">
        <thead><tr><th>IP</th><th>MAC</th><th>状態</th></tr></thead>
        <tbody>
          ${r.arpTable.map(e => `
            <tr class="${e.spoofed ? 'row-danger' : ''}">
              <td>${e.ip}</td><td>${e.mac}</td>
              <td>${e.spoofed ? "⚠ 偽装" : "正常"}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </details>
  `;
}

/** DNSテーブル表示 */
function renderDnsTable(r: AttackResult): string {
  const spoofed = r.dnsRecords.filter(e => e.spoofed);
  if (spoofed.length === 0 && r.method !== "dns_spoofing") return "";
  return `
    <details>
      <summary>DNSレコード${spoofed.length > 0 ? " (汚染あり)" : ""}</summary>
      <table class="data-table">
        <thead><tr><th>ドメイン</th><th>IP</th><th>状態</th></tr></thead>
        <tbody>
          ${r.dnsRecords.map(e => `
            <tr class="${e.spoofed ? 'row-danger' : ''}">
              <td>${e.domain}</td><td>${e.ip}</td>
              <td>${e.spoofed ? "⚠ 偽装" : "正常"}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </details>
  `;
}

/** パケット表示 */
function renderPackets(packets: Packet[]): string {
  if (packets.length === 0) return "";
  return `
    <details>
      <summary>パケット (${packets.length})</summary>
      <div class="packets">
        ${packets.map(p => `
          <div class="packet ${p.tampered ? 'packet-tampered' : ''}">
            <div class="packet-header">
              <span class="proto-badge proto-${p.protocol}">${p.protocol.toUpperCase()}</span>
              <span>${p.srcIp} → ${p.dstIp}</span>
              ${p.encrypted ? '<span class="badge-small badge-enc">暗号化</span>' : '<span class="badge-small badge-plain">平文</span>'}
              ${p.tampered ? '<span class="badge-small badge-tamper">改ざん</span>' : ''}
            </div>
            <div class="packet-payload">
              <code>${esc(p.payload.slice(0, 120))}${p.payload.length > 120 ? "..." : ""}</code>
            </div>
            ${p.originalPayload ? `<div class="packet-original">元: <code>${esc(p.originalPayload.slice(0, 120))}</code></div>` : ""}
          </div>
        `).join("")}
      </div>
    </details>
  `;
}

/** ブロック理由表示 */
function renderBlocked(blocked: string[]): string {
  if (blocked.length === 0) return "";
  return `
    <div class="blocked-list">
      <h3>防御によるブロック</h3>
      <ul>${blocked.map(b => `<li>${esc(b)}</li>`).join("")}</ul>
    </div>
  `;
}

/** 防御勧告表示 */
function renderMitigations(mitigations: string[]): string {
  if (mitigations.length === 0) return "";
  return `
    <div class="mitigations">
      <h3>防御勧告</h3>
      <ul>${mitigations.map(m => `<li>${esc(m)}</li>`).join("")}</ul>
    </div>
  `;
}

/** イベントログ表示 */
function renderEventLog(events: { type: string; actor: string; message: string }[]): HTMLElement {
  const section = document.createElement("div");
  section.className = "event-log";
  section.innerHTML = `
    <details>
      <summary>イベントログ (${events.length})</summary>
      <div class="events">
        ${events.map(e => `
          <div class="event event-${e.type}">
            <span class="event-type">${e.type}</span>
            <span class="event-actor">${e.actor}</span>
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

// 初期化
initApp();
