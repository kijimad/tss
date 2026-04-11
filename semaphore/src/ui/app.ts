/* UNIX セマフォ シミュレーター UI */

import { simulate } from "../semaphore/engine.js";
import { PRESETS } from "../semaphore/presets.js";
import type { TickResult, SimEvent } from "../semaphore/types.js";

let currentTicks: TickResult[] = [];
let currentEvents: SimEvent[] = [];
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
      <label>速度: <input id="speed" type="range" min="50" max="1000" value="300" step="50"></label>
      <span id="stepInfo" class="step-info"></span>
    </div>
    <div class="panels">
      <div class="panel" id="processPanel"><h3>プロセス一覧</h3><div id="processList"></div></div>
      <div class="panel" id="semPanel"><h3>セマフォ</h3><div id="semList"></div></div>
      <div class="panel" id="varPanel"><h3>共有変数</h3><div id="varList"></div></div>
    </div>
    <div class="panels">
      <div class="panel wide" id="logPanel"><h3>実行ログ</h3><div id="logList"></div></div>
      <div class="panel" id="eventPanel"><h3>イベント</h3><div id="eventList"></div></div>
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
  const preset = PRESETS[idx];
  const ops = preset.build();
  const result = simulate(ops);
  currentTicks = result.ticks;
  currentEvents = result.events;
  currentStep = 0;

  (document.getElementById("stepBack") as HTMLButtonElement).disabled = false;
  (document.getElementById("stepFwd") as HTMLButtonElement).disabled = false;
  (document.getElementById("playPause") as HTMLButtonElement).disabled = false;

  render();
}

function step(dir: number): void {
  const next = currentStep + dir;
  if (next >= 0 && next < currentTicks.length) {
    currentStep = next;
    render();
  }
}

function togglePlay(): void {
  if (playing) { stopPlay(); return; }
  playing = true;
  document.getElementById("playPause")!.textContent = "⏸ 停止";
  const speed = parseInt((document.getElementById("speed") as HTMLInputElement).value);
  playTimer = setInterval(() => {
    if (currentStep < currentTicks.length - 1) {
      currentStep++;
      render();
    } else {
      stopPlay();
    }
  }, speed);
}

function stopPlay(): void {
  playing = false;
  if (playTimer) { clearInterval(playTimer); playTimer = null; }
  const btn = document.getElementById("playPause");
  if (btn) btn.textContent = "▶ 再生";
}

function render(): void {
  if (currentTicks.length === 0) return;
  const tick = currentTicks[currentStep];

  document.getElementById("stepInfo")!.textContent =
    `Step ${currentStep + 1} / ${currentTicks.length} (tick=${tick.tick})`;

  // プロセス一覧
  const procHtml = tick.processes.map(p => {
    const stateClass = p.state === "running" ? "running" :
      p.state === "blocked" ? "blocked" :
      p.state === "terminated" ? "terminated" : "ready";
    const blockInfo = p.blockReason ? ` [${p.blockReason}${p.blockDetail ? `: ${p.blockDetail}` : ""}]` : "";
    return `<div class="item ${stateClass}">
      <span class="pid">P${p.pid}</span>
      <span class="name">${p.name}</span>
      <span class="state">${p.state}${blockInfo}</span>
      <span class="stats">cpu=${p.cpuTime} wait=${p.waitTime}</span>
    </div>`;
  }).join("");
  document.getElementById("processList")!.innerHTML = procHtml;

  // セマフォ
  const semHtml = tick.semaphores.map(s => {
    const barWidth = Math.min(s.value / Math.max(s.initialValue, 1) * 100, 100);
    const waitInfo = s.waitQueue.length > 0 ? ` 待ち=[${s.waitQueue.map(p => `P${p}`).join(",")}]` : "";
    return `<div class="sem-item">
      <div class="sem-header">
        <span class="sem-name">${s.name}</span>
        <span class="sem-type">${s.type}${s.named ? " (named)" : ""}</span>
      </div>
      <div class="sem-bar-container">
        <div class="sem-bar" style="width:${barWidth}%"></div>
        <span class="sem-value">value=${s.value}/${s.initialValue}</span>
      </div>
      <div class="sem-stats">post=${s.postCount} wait=${s.waitCount}${waitInfo}</div>
    </div>`;
  }).join("");
  document.getElementById("semList")!.innerHTML = semHtml || "<div class='empty'>セマフォなし</div>";

  // 共有変数
  const varHtml = tick.sharedVars.map(v => {
    const writer = v.lastWriter !== null ? `P${v.lastWriter}` : "-";
    return `<div class="var-item">
      <span class="var-name">${v.name}</span>
      <span class="var-value">${v.value}</span>
      <span class="var-writer">last: ${writer}</span>
    </div>`;
  }).join("");
  document.getElementById("varList")!.innerHTML = varHtml || "<div class='empty'>共有変数なし</div>";

  // 実行ログ（現在ステップまで）
  const logHtml = currentTicks.slice(0, currentStep + 1).map((t, i) => {
    const cls = i === currentStep ? "log-current" : "";
    const runner = t.runningPid !== null ? `P${t.runningPid}` : "--";
    return `<div class="log-item ${cls}">[${t.tick}] ${runner}: ${t.message}</div>`;
  }).join("");
  document.getElementById("logList")!.innerHTML = logHtml;
  const logEl = document.getElementById("logList")!;
  logEl.scrollTop = logEl.scrollHeight;

  // イベント
  const eventsUpToTick = currentEvents.filter(e => e.tick <= tick.tick);
  const eventHtml = eventsUpToTick.map(e =>
    `<div class="event-item event-${e.type}">[${e.tick}] ${e.message}</div>`
  ).join("");
  document.getElementById("eventList")!.innerHTML = eventHtml;
  const evEl = document.getElementById("eventList")!;
  evEl.scrollTop = evEl.scrollHeight;
}

document.addEventListener("DOMContentLoaded", init);
