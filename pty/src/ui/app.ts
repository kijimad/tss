/* UNIX 擬似端末 (PTY) シミュレーター UI */

import { simulate } from "../pty/engine.js";
import { PRESETS } from "../pty/presets.js";
import type { StepResult, SimEvent } from "../pty/types.js";

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
      <div class="panel"><h3>PTY ペア</h3><div id="ptyList"></div></div>
      <div class="panel"><h3>データフロー</h3><div id="flowDiagram"></div></div>
    </div>
    <div class="panels mid">
      <div class="panel"><h3>プロセス / FD</h3><div id="procList"></div></div>
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

function render(): void {
  if (currentSteps.length === 0) return;
  const s = currentSteps[currentStep];

  document.getElementById("stepInfo")!.textContent =
    `Step ${currentStep + 1} / ${currentSteps.length}`;

  // PTYペア
  const ptyHtml = s.ptyPairs.length === 0
    ? '<div class="empty">PTY未確保</div>'
    : s.ptyPairs.map(p => `
      <div class="pty-card">
        <div class="pty-header">
          <span class="pty-id">PTY${p.id}</span>
          <span class="pty-state state-${p.state}">${p.state}</span>
        </div>
        <div class="pty-detail">
          <div>master fd: <strong>${p.masterFd}</strong></div>
          <div>slave: <strong>${p.slavePath}</strong> ${p.slaveFd !== null ? `(fd=${p.slaveFd})` : "(未open)"}</div>
          <div>session: ${p.controllingSession ?? "なし"} | ${p.winSize.rows}×${p.winSize.cols}</div>
          <div>echo=${p.echo ? "on" : "off"} canon=${p.canonical ? "on" : "off"}</div>
          <div class="pty-buf">
            <span>M→S: "${escHtml(p.masterToSlave) || "(empty)"}"</span>
            <span>S→M: "${escHtml(p.slaveToMaster) || "(empty)"}"</span>
          </div>
        </div>
      </div>
    `).join("");
  document.getElementById("ptyList")!.innerHTML = ptyHtml;

  // データフロー
  const flows = s.dataFlows;
  const flowHtml = flows.length === 0
    ? '<div class="empty">データフローなし</div>'
    : flows.slice(-6).map(f => `
      <div class="flow-item flow-${f.direction === "master→slave" ? "ms" : "sm"}">
        <div class="flow-dir">${f.direction}</div>
        <div class="flow-path">${f.from} → ${f.through} → ${f.to}</div>
        <div class="flow-data">"${escHtml(f.data)}"</div>
      </div>
    `).join("");
  document.getElementById("flowDiagram")!.innerHTML = flowHtml;

  // プロセス
  const procHtml = s.processes.map(p => {
    const cls = p.state === "running" ? "p-run" : p.state === "stopped" ? "p-stop" : "p-term";
    const leader = p.sessionLeader ? " [session-leader]" : "";
    const fds = p.fds.map(f =>
      `<span class="fd-badge">fd${f.fd}→${f.target}</span>`
    ).join(" ");
    return `<div class="proc ${cls}">
      <div class="proc-head">
        <span class="proc-pid">P${p.pid}</span>
        <span class="proc-name">${p.name}</span>
        <span class="proc-info">pgid=${p.pgid} sid=${p.sid}${leader}</span>
        <span class="proc-ctty">${p.ctty ?? "no ctty"}</span>
      </div>
      <div class="proc-fds">${fds}</div>
    </div>`;
  }).join("");
  document.getElementById("procList")!.innerHTML = procHtml;

  // イベント
  const evUpTo = allEvents.filter(e => e.tick <= s.tick);
  const eventHtml = evUpTo.slice(-20).map(e => {
    const detail = e.detail ? `<div class="ev-detail">${e.detail}</div>` : "";
    return `<div class="ev ev-${e.type}">[${e.tick}] ${e.message}${detail}</div>`;
  }).join("");
  document.getElementById("eventList")!.innerHTML = eventHtml;
  const evEl = document.getElementById("eventList")!;
  evEl.scrollTop = evEl.scrollHeight;

  // ログ
  const logHtml = currentSteps.slice(0, currentStep + 1).map((st, i) => {
    const cls = i === currentStep ? "log-cur" : "";
    return `<div class="log ${cls}">[${st.tick}] ${st.message}</div>`;
  }).join("");
  document.getElementById("logList")!.innerHTML = logHtml;
  const logEl = document.getElementById("logList")!;
  logEl.scrollTop = logEl.scrollHeight;
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/\n/g, "\\n").replace(/\r/g, "\\r");
}

document.addEventListener("DOMContentLoaded", init);
