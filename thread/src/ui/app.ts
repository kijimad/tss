/* UNIX スレッド シミュレーター UI */

import { simulate } from "../thread/engine.js";
import { PRESETS } from "../thread/presets.js";
import type { SimOp, TickResult, Thread } from "../thread/types.js";

/** アプリ初期化 */
export function initApp(): void {
  const app = document.getElementById("app")!;
  app.innerHTML = `
    <div class="container">
      <h1>UNIX Thread シミュレーター</h1>
      <div class="controls">
        <label for="preset">プリセット:</label>
        <select id="preset"></select>
        <button id="run">実行</button>
      </div>
      <div class="step-nav">
        <button id="prev" disabled>&lt; 前</button>
        <span id="step-info">-</span>
        <button id="next">次 &gt;</button>
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
  document.getElementById("prev")!.addEventListener("click", () => nav(-1));
  document.getElementById("next")!.addEventListener("click", () => nav(1));
  run();
}

let ticks: TickResult[] = [];
let step = 0;

function run(): void {
  const idx = parseInt((document.getElementById("preset") as HTMLSelectElement).value, 10);
  const ops: SimOp[] = PRESETS[idx].build();
  const result = simulate(ops);
  ticks = result.ticks;
  step = 0;
  render();
}

function nav(d: number): void {
  step = Math.max(0, Math.min(ticks.length - 1, step + d));
  render();
}

function render(): void {
  if (ticks.length === 0) return;
  const t = ticks[step];

  (document.getElementById("prev") as HTMLButtonElement).disabled = step === 0;
  (document.getElementById("next") as HTMLButtonElement).disabled = step === ticks.length - 1;
  document.getElementById("step-info")!.textContent = `Tick ${t.tick} (${step + 1}/${ticks.length})`;

  const output = document.getElementById("output")!;
  output.innerHTML = `
    <div class="tick-msg ${t.warning ? 'warn' : ''}">
      <div class="msg">${esc(t.message)}</div>
      ${t.warning ? `<div class="warning">${esc(t.warning)}</div>` : ""}
    </div>
    <div class="grid2">
      <div class="panel">
        <h2>スレッド一覧</h2>
        ${renderThreads(t)}
      </div>
      <div class="panel">
        <h2>同期オブジェクト</h2>
        ${renderSync(t)}
      </div>
    </div>
    <div class="panel">
      <h2>共有変数</h2>
      ${renderVars(t)}
    </div>
  `;
}

function renderThreads(t: TickResult): string {
  return `<div class="thread-list">${t.threads.map(th => {
    const cls = `state-${th.state}`;
    return `
      <div class="thread-row ${cls} ${th.tid === t.runningTid ? 'current' : ''}">
        <span class="tid">T${th.tid}</span>
        <span class="tname">${esc(th.name)}</span>
        <span class="tstate badge-${th.state}">${stateLabel(th)}</span>
        <span class="tcpu">CPU:${th.cpuTime} W:${th.waitTime}</span>
      </div>`;
  }).join("")}</div>`;
}

function stateLabel(th: Thread): string {
  if (th.state === "blocked" && th.blockReason) {
    return `blocked(${th.blockReason}${th.blockDetail ? `:${th.blockDetail}` : ""})`;
  }
  return th.state;
}

function renderSync(t: TickResult): string {
  let html = "";
  for (const m of t.mutexes) {
    html += `<div class="sync-item"><span class="sync-type">Mutex</span><span class="sync-id">${esc(m.id)}</span>
      <span class="sync-detail">owner:${m.owner ?? "none"} wait:[${m.waitQueue.join(",")}]${m.recursive ? " (recursive)" : ""}</span></div>`;
  }
  for (const c of t.condVars) {
    html += `<div class="sync-item"><span class="sync-type">CondVar</span><span class="sync-id">${esc(c.id)}</span>
      <span class="sync-detail">wait:[${c.waitQueue.join(",")}]</span></div>`;
  }
  for (const r of t.rwLocks) {
    html += `<div class="sync-item"><span class="sync-type">RwLock</span><span class="sync-id">${esc(r.id)}</span>
      <span class="sync-detail">readers:[${r.readers.join(",")}] writer:${r.writer ?? "none"}</span></div>`;
  }
  for (const b of t.barriers) {
    html += `<div class="sync-item"><span class="sync-type">Barrier</span><span class="sync-id">${esc(b.id)}</span>
      <span class="sync-detail">${b.arrived.length}/${b.count}</span></div>`;
  }
  return html || '<div class="empty">なし</div>';
}

function renderVars(t: TickResult): string {
  if (t.sharedVars.length === 0) return '<div class="empty">なし</div>';
  return `<div class="var-list">${t.sharedVars.map(sv => `
    <div class="var-row">
      <span class="var-name">${esc(sv.name)}</span>
      <span class="var-val">${sv.value}</span>
      <span class="var-writer">last:T${sv.lastWriter ?? "-"}</span>
      <span class="var-access">${sv.accessLog.length} ops</span>
    </div>
  `).join("")}</div>`;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

initApp();
