/* Cookie シミュレーター UI */

import { simulate } from "../cookie/engine.js";
import { PRESETS } from "../cookie/presets.js";
import type { SimulationResult, Cookie, CookieJar } from "../cookie/types.js";

const C = {
  bg: "#0c0e13",
  card: "#14171f",
  border: "#222838",
  text: "#d1d5e0",
  muted: "#5e6a80",
  accent: "#e87b35",
  set: "#4caf50",
  block: "#f44336",
  send: "#2196f3",
  expire: "#ff9800",
  secure: "#9c27b0",
  httpOnly: "#009688",
  strict: "#f44336",
  lax: "#ff9800",
  none: "#4caf50",
  partition: "#00bcd4",
};

const SAMESITE_COLORS: Record<string, string> = {
  strict: C.strict, lax: C.lax, none: C.none,
};

const EVENT_COLORS: Record<string, string> = {
  cookie_set: C.set, cookie_reject: C.block, cookie_send: C.send,
  cookie_expire: C.expire, cookie_evict: C.expire, cookie_block: C.block,
  cookie_delete: C.muted, sameSite_block: C.strict, secure_block: C.secure,
  prefix_error: C.block, partition: C.partition, navigate: C.accent, info: C.muted,
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
      <h1>Cookie Simulator</h1>
      <div class="ctrl">
        <select id="sel">${PRESETS.map((p, i) => `<option value="${i}">${p.name}</option>`).join("")}</select>
        <span class="desc" id="desc">${PRESETS[0]?.description ?? ""}</span>
      </div>
    </div>
    <div class="grid">
      <div class="col-l">
        ${renderStats(r)}
        ${renderJar(r.jar)}
        ${renderRequestLog(r)}
      </div>
      <div class="col-r">
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
}

function renderStats(r: SimulationResult): string {
  const jar = r.jar;
  let totalCookies = 0;
  let domains = 0;
  for (const [, cookies] of jar.cookies) {
    totalCookies += cookies.length;
    if (cookies.length > 0) domains++;
  }
  const sets = r.events.filter(e => e.type === "cookie_set").length;
  const blocks = r.events.filter(e =>
    e.type === "cookie_block" || e.type === "cookie_reject" ||
    e.type === "sameSite_block" || e.type === "secure_block"
  ).length;
  const sends = r.events.filter(e => e.type === "cookie_send").length;
  const expires = r.events.filter(e => e.type === "cookie_expire").length;

  const items = [
    { l: "保存Cookie数", v: String(totalCookies), c: C.set },
    { l: "ドメイン数", v: String(domains), c: C.accent },
    { l: "設定回数", v: String(sets), c: C.set },
    { l: "ブロック", v: String(blocks), c: blocks > 0 ? C.block : C.muted },
    { l: "送信回数", v: String(sends), c: C.send },
    { l: "失効", v: String(expires), c: expires > 0 ? C.expire : C.muted },
    { l: "3rdPartyブロック", v: jar.blockThirdParty ? "ON" : "OFF", c: jar.blockThirdParty ? C.block : C.muted },
    { l: "CHIPS", v: jar.partitionEnabled ? "ON" : "OFF", c: jar.partitionEnabled ? C.partition : C.muted },
  ];

  return `<div class="card"><h2>統計</h2><div class="stats">${items.map(i =>
    `<div class="si"><span class="sl">${i.l}</span><span class="sv" style="color:${i.c}">${i.v}</span></div>`
  ).join("")}</div></div>`;
}

function renderJar(jar: CookieJar): string {
  const sections: string[] = [];

  for (const [domainKey, cookies] of jar.cookies) {
    if (cookies.length === 0) continue;
    const rows = cookies.map(c => renderCookieRow(c)).join("");
    sections.push(`
      <div class="domain-group">
        <div class="domain-hdr">${domainKey} <span class="domain-count">(${cookies.length})</span></div>
        <table class="tbl"><thead><tr>
          <th>Name</th><th>Value</th><th>Path</th><th>属性</th><th>SameSite</th><th>有効期限</th>
        </tr></thead><tbody>${rows}</tbody></table>
      </div>
    `);
  }

  if (sections.length === 0) {
    sections.push('<p class="empty">Cookie Jar は空です</p>');
  }

  return `<div class="card"><h2>Cookie Jar</h2>${sections.join("")}</div>`;
}

function renderCookieRow(c: Cookie): string {
  const ssColor = SAMESITE_COLORS[c.sameSite] ?? C.muted;
  const attrs: string[] = [];
  if (c.secure) attrs.push(`<span class="attr" style="color:${C.secure}">Secure</span>`);
  if (c.httpOnly) attrs.push(`<span class="attr" style="color:${C.httpOnly}">HttpOnly</span>`);
  if (c.partitioned) attrs.push(`<span class="attr" style="color:${C.partition}">Partitioned</span>`);
  if (c.securePrefix) attrs.push(`<span class="attr" style="color:${C.secure}">__Secure-</span>`);
  if (c.hostPrefix) attrs.push(`<span class="attr" style="color:${C.secure}">__Host-</span>`);

  const expStr = c.expires
    ? new Date(c.expires).toLocaleString("ja-JP", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : "Session";

  return `<tr>
    <td class="ck-name">${c.name}</td>
    <td class="ck-val">${truncate(c.value, 16)}</td>
    <td>${c.path}</td>
    <td>${attrs.join(" ") || "-"}</td>
    <td><span class="ss-badge" style="background:${ssColor}18;color:${ssColor};border:1px solid ${ssColor}33">${c.sameSite}</span></td>
    <td class="ck-exp">${expStr}</td>
  </tr>`;
}

function renderRequestLog(r: SimulationResult): string {
  if (r.requestLog.length === 0) return "";

  const entries = r.requestLog.map((log, i) => {
    const sentList = log.sentCookies.map(c =>
      `<span class="ck-sent">${c.name}</span>`
    ).join(" ");
    const blockedList = log.blockedCookies.map(b =>
      `<span class="ck-blocked" title="${b.reason}">${b.cookie.name}</span>`
    ).join(" ");

    return `<div class="req-entry">
      <div class="req-hdr">
        <span class="req-num">#${i + 1}</span>
        <span class="req-method">${log.request.method}</span>
        <span class="req-url">${log.request.url}</span>
        ${log.request.crossSite ? '<span class="req-cross">cross-site</span>' : ""}
      </div>
      <div class="req-cookies">
        ${sentList ? `<div>送信: ${sentList}</div>` : '<div class="empty-sm">送信Cookie なし</div>'}
        ${blockedList ? `<div>ブロック: ${blockedList}</div>` : ""}
      </div>
    </div>`;
  }).join("");

  return `<div class="card"><h2>リクエストログ (${r.requestLog.length})</h2>${entries}</div>`;
}

function renderEvents(r: SimulationResult): string {
  const rows = r.events.map(e => {
    const color = EVENT_COLORS[e.type] ?? C.muted;
    return `<div class="ev">
      <span class="ev-badge" style="background:${color}15;color:${color};border:1px solid ${color}30">${e.type.replace("cookie_", "").replace("sameSite_", "ss:")}</span>
      <span class="ev-m">${e.message}</span>
      ${e.detail ? `<div class="ev-d">${e.detail}</div>` : ""}
    </div>`;
  }).join("");

  return `<div class="card"><h2>イベントログ (${r.events.length})</h2>
    <div class="ev-scroll">${rows}</div>
  </div>`;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
}

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
      padding: 5px 8px; border-radius: 4px; font-family: inherit; font-size: 12px; max-width: 300px;
    }
    .desc { color: ${C.muted}; font-size: 11px; }
    .grid { display: grid; grid-template-columns: 3fr 2fr; gap: 10px; }
    .col-l, .col-r { display: flex; flex-direction: column; gap: 10px; }
    .card { background: ${C.card}; border: 1px solid ${C.border}; border-radius: 6px; padding: 10px; }
    .card h2 { margin: 0 0 8px; font-size: 12px; color: ${C.muted}; text-transform: uppercase; letter-spacing: 0.5px; }

    .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
    .si { display: flex; flex-direction: column; }
    .sl { font-size: 9px; color: ${C.muted}; }
    .sv { font-size: 15px; font-weight: bold; }

    .domain-group { margin-bottom: 10px; }
    .domain-hdr { font-size: 12px; font-weight: bold; color: ${C.accent}; margin-bottom: 4px; }
    .domain-count { color: ${C.muted}; font-weight: normal; }
    .tbl { width: 100%; border-collapse: collapse; font-size: 10px; }
    .tbl th { text-align: left; padding: 3px 5px; border-bottom: 1px solid ${C.border}; color: ${C.muted}; font-size: 9px; }
    .tbl td { padding: 3px 5px; border-bottom: 1px solid ${C.border}11; }
    .ck-name { font-weight: bold; color: ${C.text}; }
    .ck-val { color: ${C.muted}; max-width: 100px; overflow: hidden; text-overflow: ellipsis; }
    .ck-exp { font-size: 9px; color: ${C.muted}; white-space: nowrap; }
    .attr { font-size: 9px; padding: 1px 4px; border-radius: 2px; white-space: nowrap; }
    .ss-badge { padding: 1px 5px; border-radius: 3px; font-size: 9px; }

    .req-entry { margin-bottom: 8px; padding: 6px; background: ${C.bg}; border-radius: 4px; }
    .req-hdr { display: flex; gap: 6px; align-items: center; margin-bottom: 4px; }
    .req-num { color: ${C.muted}; font-size: 10px; }
    .req-method { color: ${C.send}; font-size: 11px; font-weight: bold; }
    .req-url { font-size: 10px; color: ${C.text}; }
    .req-cross { font-size: 9px; color: ${C.block}; background: ${C.block}15; padding: 1px 4px; border-radius: 3px; }
    .req-cookies { font-size: 10px; }
    .ck-sent { color: ${C.set}; background: ${C.set}15; padding: 1px 4px; border-radius: 2px; margin-right: 3px; }
    .ck-blocked { color: ${C.block}; background: ${C.block}15; padding: 1px 4px; border-radius: 2px; margin-right: 3px; text-decoration: line-through; cursor: help; }
    .empty { color: ${C.muted}; font-size: 11px; }
    .empty-sm { color: ${C.muted}; font-size: 9px; }

    .ev-scroll { max-height: 600px; overflow-y: auto; }
    .ev { padding: 3px 0; font-size: 10px; }
    .ev-badge { padding: 1px 4px; border-radius: 3px; font-size: 8px; white-space: nowrap; margin-right: 4px; }
    .ev-m { color: ${C.text}; }
    .ev-d { color: ${C.muted}; font-size: 9px; padding-left: 60px; }

    @media (max-width: 900px) { .grid { grid-template-columns: 1fr; } }
  `;
  document.head.appendChild(s);

  const app = document.createElement("div");
  app.id = "app";
  document.body.appendChild(app);

  run(0);
}

init();
