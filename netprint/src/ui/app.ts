/* ネットワークプリンタ シミュレーター UI */

import { simulate } from "../netprint/engine.js";
import { PRESETS } from "../netprint/presets.js";
import type { StepResult, SimEvent } from "../netprint/types.js";

let currentSteps: StepResult[] = [];
let allEvents: SimEvent[] = [];
let currentStep = 0;
let playing = false;
let playTimer: ReturnType<typeof setInterval> | null = null;

function init(): void {
  const app = document.getElementById("app")!;
  app.innerHTML = `
    <div class="controls">
      <label>プリセット:
        <select id="preset">${PRESETS.map((p, i) => `<option value="${i}">${p.name}</option>`).join("")}</select>
      </label>
      <span id="presetDesc" class="desc"></span>
    </div>
    <div class="controls">
      <button id="run">実行</button>
      <button id="stepBack" disabled>◀</button>
      <button id="stepFwd" disabled>▶</button>
      <button id="playPause" disabled>▶ 再生</button>
      <label>速度: <input id="speed" type="range" min="100" max="1500" value="500" step="100"></label>
      <span id="stepInfo" class="step-info"></span>
    </div>
    <div class="panels top">
      <div class="panel"><h3>プリンタ</h3><div id="printerList"></div></div>
      <div class="panel"><h3>ネットワークパケット</h3><div id="packetList"></div></div>
    </div>
    <div class="panels mid">
      <div class="panel"><h3>印刷キュー / ジョブ</h3><div id="jobList"></div></div>
      <div class="panel"><h3>イベント</h3><div id="eventList"></div></div>
    </div>
    <div class="panels bot">
      <div class="panel wide"><h3>実行ログ</h3><div id="logList"></div></div>
    </div>
  `;

  document.getElementById("preset")!.addEventListener("change", updateDesc);
  document.getElementById("run")!.addEventListener("click", runSim);
  document.getElementById("stepBack")!.addEventListener("click", () => step(-1));
  document.getElementById("stepFwd")!.addEventListener("click", () => step(1));
  document.getElementById("playPause")!.addEventListener("click", togglePlay);
  updateDesc();
}

function updateDesc(): void {
  const idx = (document.getElementById("preset") as HTMLSelectElement).selectedIndex;
  document.getElementById("presetDesc")!.textContent = PRESETS[idx].description;
}

function runSim(): void {
  stopPlay();
  const idx = (document.getElementById("preset") as HTMLSelectElement).selectedIndex;
  const result = simulate(PRESETS[idx].build());
  currentSteps = result.steps;
  allEvents = result.events;
  currentStep = 0;
  (document.getElementById("stepBack") as HTMLButtonElement).disabled = false;
  (document.getElementById("stepFwd") as HTMLButtonElement).disabled = false;
  (document.getElementById("playPause") as HTMLButtonElement).disabled = false;
  render();
}

function step(d: number): void {
  const n = currentStep + d;
  if (n >= 0 && n < currentSteps.length) { currentStep = n; render(); }
}

function togglePlay(): void {
  if (playing) { stopPlay(); return; }
  playing = true;
  document.getElementById("playPause")!.textContent = "⏸ 停止";
  const speed = parseInt((document.getElementById("speed") as HTMLInputElement).value);
  playTimer = setInterval(() => {
    if (currentStep < currentSteps.length - 1) { currentStep++; render(); }
    else stopPlay();
  }, speed);
}

function stopPlay(): void {
  playing = false;
  if (playTimer) { clearInterval(playTimer); playTimer = null; }
  const btn = document.getElementById("playPause");
  if (btn) btn.textContent = "▶ 再生";
}

/** プリンタ状態の表示名 */
function stateLabel(s: string): string {
  const map: Record<string, string> = {
    idle: "待機", printing: "印刷中", warming_up: "ウォームアップ",
    error: "エラー", offline: "オフライン", paper_jam: "紙詰まり",
    toner_low: "トナー低", sleep: "スリープ",
  };
  return map[s] ?? s;
}

/** トナーレベルのバー色 */
function tonerColor(level: number): string {
  if (level > 30) return "#4ade80";
  if (level > 10) return "#facc15";
  return "#f87171";
}

function render(): void {
  if (currentSteps.length === 0) return;
  const s = currentSteps[currentStep];

  document.getElementById("stepInfo")!.textContent =
    `Step ${currentStep + 1} / ${currentSteps.length}`;

  // プリンタ一覧
  const printerHtml = s.printers.length === 0
    ? '<div class="empty">プリンタ未登録</div>'
    : s.printers.map(p => {
      const qLen = p.queue.length + (p.currentJob ? 1 : 0);
      const tCol = tonerColor(p.tonerLevel);
      return `
      <div class="printer-card">
        <div class="printer-header">
          <span class="printer-name">${esc(p.name)}</span>
          <span class="printer-state state-${p.state}">${stateLabel(p.state)}</span>
        </div>
        <div class="printer-detail">
          <div>${p.ip} | ${p.type} | ${p.ppm}ppm</div>
          <div>用紙: <strong>${p.paperRemaining}</strong>枚 | キュー: <strong>${qLen}</strong>件</div>
          <div class="toner-bar">
            <span class="toner-label">トナー ${p.tonerLevel.toFixed(1)}%</span>
            <span class="toner-fill" style="width:${Math.max(0, p.tonerLevel)}%;background:${tCol}"></span>
          </div>
          ${p.currentJob ? `<div class="cur-job">印刷中: Job#${p.currentJob.id} "${esc(p.currentJob.name)}" ${p.currentJob.printedPages}/${p.currentJob.pages * p.currentJob.copies}p</div>` : ""}
          ${p.errorMessage ? `<div class="err-msg">${esc(p.errorMessage)}</div>` : ""}
        </div>
      </div>`;
    }).join("");
  document.getElementById("printerList")!.innerHTML = printerHtml;

  // パケット
  const pkts = s.packets.slice(-12);
  const pktHtml = pkts.length === 0
    ? '<div class="empty">パケットなし</div>'
    : pkts.map(p => `
      <div class="pkt pkt-${p.type}">
        <span class="pkt-dir">${p.src} → ${p.dst}</span>
        <span class="pkt-proto">${p.protocol}</span>
        <span class="pkt-type">${p.type}</span>
        <div class="pkt-payload">${esc(p.payload)}</div>
      </div>
    `).join("");
  document.getElementById("packetList")!.innerHTML = pktHtml;

  // ジョブ一覧
  const allJobs = s.printers.flatMap(p => {
    const jobs = [...p.queue];
    if (p.currentJob) jobs.unshift(p.currentJob);
    return jobs.map(j => ({ ...j, printerName: p.name }));
  });
  const jobHtml = allJobs.length === 0
    ? '<div class="empty">ジョブなし</div>'
    : allJobs.map(j => {
      const totalP = j.pages * j.copies;
      const transPct = j.sizeBytes > 0 ? ((j.transferredBytes / j.sizeBytes) * 100).toFixed(0) : "0";
      const printPct = totalP > 0 ? ((j.printedPages / totalP) * 100).toFixed(0) : "0";
      return `
      <div class="job-card job-${j.state}">
        <div class="job-header">
          <span class="job-id">Job#${j.id}</span>
          <span class="job-name">"${esc(j.name)}"</span>
          <span class="job-state">${j.state}</span>
        </div>
        <div class="job-detail">
          <div>${j.owner} → ${(j as unknown as { printerName: string }).printerName} | ${j.protocol} | 優先度${j.priority}</div>
          <div>${j.paperSize} ${j.quality} ${j.color ? "カラー" : "モノクロ"} ${j.duplex ? "両面" : "片面"} ×${j.copies}部</div>
          <div>転送: ${transPct}% (${(j.transferredBytes / 1024).toFixed(0)}/${(j.sizeBytes / 1024).toFixed(0)}KB) | 印刷: ${printPct}% (${j.printedPages}/${totalP}p)</div>
        </div>
      </div>`;
    }).join("");
  document.getElementById("jobList")!.innerHTML = jobHtml;

  // イベント
  const evUpTo = allEvents.filter(e => e.tick <= s.tick);
  const eventHtml = evUpTo.slice(-20).map(e => {
    const detail = e.detail ? `<div class="ev-detail">${esc(e.detail)}</div>` : "";
    return `<div class="ev ev-${e.type}">[${e.tick}] ${esc(e.message)}${detail}</div>`;
  }).join("");
  document.getElementById("eventList")!.innerHTML = eventHtml;
  const evEl = document.getElementById("eventList")!;
  evEl.scrollTop = evEl.scrollHeight;

  // ログ
  const logHtml = currentSteps.slice(0, currentStep + 1).map((st, i) => {
    const cls = i === currentStep ? "log-cur" : "";
    return `<div class="log ${cls}">[${st.tick}] ${esc(st.message)}</div>`;
  }).join("");
  document.getElementById("logList")!.innerHTML = logHtml;
  const logEl = document.getElementById("logList")!;
  logEl.scrollTop = logEl.scrollHeight;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

document.addEventListener("DOMContentLoaded", init);
