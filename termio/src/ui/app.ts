/* UNIX 端末入出力 シミュレーター UI */

import { simulate, charName } from "../termio/engine.js";
import { PRESETS } from "../termio/presets.js";
import type { StepResult, SimEvent } from "../termio/types.js";

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
      <label>速度: <input id="speed" type="range" min="50" max="1000" value="400" step="50"></label>
      <span id="stepInfo" class="step-info"></span>
    </div>
    <div class="panels top-panels">
      <div class="panel screen-panel">
        <h3>端末画面</h3>
        <div id="screen" class="screen"></div>
      </div>
      <div class="panel">
        <h3>termios 設定</h3>
        <div id="termios"></div>
      </div>
    </div>
    <div class="panels bottom-panels">
      <div class="panel">
        <h3>Line Discipline</h3>
        <div id="lineDisc"></div>
      </div>
      <div class="panel">
        <h3>プロセス / FD</h3>
        <div id="procList"></div>
      </div>
    </div>
    <div class="panels log-panels">
      <div class="panel wide">
        <h3>実行ログ</h3>
        <div id="logList"></div>
      </div>
      <div class="panel">
        <h3>イベント</h3>
        <div id="eventList"></div>
      </div>
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
  const ops = PRESETS[idx].build();
  const result = simulate(ops);
  currentSteps = result.steps;
  allEvents = result.events;
  currentStep = 0;

  (document.getElementById("stepBack") as HTMLButtonElement).disabled = false;
  (document.getElementById("stepFwd") as HTMLButtonElement).disabled = false;
  (document.getElementById("playPause") as HTMLButtonElement).disabled = false;
  render();
}

function step(dir: number): void {
  const next = currentStep + dir;
  if (next >= 0 && next < currentSteps.length) { currentStep = next; render(); }
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

  // 端末画面
  const screenHtml = s.tty.screen.map(line =>
    `<div class="screen-line">${escapeHtml(line) || "&nbsp;"}</div>`
  ).join("");
  document.getElementById("screen")!.innerHTML = screenHtml || '<div class="screen-line">&nbsp;</div>';

  // termios設定
  const t = s.tty.termios;
  const mode = t.lflag.ICANON ? "canonical" : (t.lflag.ISIG ? "cbreak" : "raw");
  const termiosHtml = `
    <div class="termios-mode">モード: <strong>${mode}</strong></div>
    <div class="flag-group">
      <div class="flag-title">c_lflag (ローカル)</div>
      ${flagBadge("ECHO", t.lflag.ECHO)}
      ${flagBadge("ICANON", t.lflag.ICANON)}
      ${flagBadge("ISIG", t.lflag.ISIG)}
      ${flagBadge("ECHONL", t.lflag.ECHONL)}
      ${flagBadge("ECHOCTL", t.lflag.ECHOCTL)}
    </div>
    <div class="flag-group">
      <div class="flag-title">c_iflag (入力)</div>
      ${flagBadge("ICRNL", t.iflag.ICRNL)}
      ${flagBadge("INLCR", t.iflag.INLCR)}
      ${flagBadge("ISTRIP", t.iflag.ISTRIP)}
      ${flagBadge("IXON", t.iflag.IXON)}
    </div>
    <div class="flag-group">
      <div class="flag-title">c_oflag (出力)</div>
      ${flagBadge("OPOST", t.oflag.OPOST)}
      ${flagBadge("ONLCR", t.oflag.ONLCR)}
    </div>
    <div class="flag-group">
      <div class="flag-title">c_cc (制御文字)</div>
      <div class="cc-list">
        ${ccEntry("VINTR", t.cc.VINTR)}${ccEntry("VEOF", t.cc.VEOF)}
        ${ccEntry("VSUSP", t.cc.VSUSP)}${ccEntry("VERASE", t.cc.VERASE)}
        ${ccEntry("VKILL", t.cc.VKILL)}${ccEntry("VQUIT", t.cc.VQUIT)}
      </div>
    </div>
  `;
  document.getElementById("termios")!.innerHTML = termiosHtml;

  // Line Discipline
  const ldHtml = `
    <div class="ld-item"><span class="ld-label">入力バッファ:</span>
      <span class="ld-value">"${escapeHtml(s.tty.inputBuffer)}" (${s.tty.inputBuffer.length} bytes)</span></div>
    <div class="ld-item"><span class="ld-label">出力バッファ:</span>
      <span class="ld-value">"${escapeHtml(s.tty.outputBuffer)}" (${s.tty.outputBuffer.length} bytes)</span></div>
    <div class="ld-item"><span class="ld-label">フロー制御:</span>
      <span class="ld-value ${s.tty.stopped ? "stopped" : "running"}">${s.tty.stopped ? "停止中 (XOFF)" : "通常"}</span></div>
    <div class="ld-item"><span class="ld-label">FG pgid:</span>
      <span class="ld-value">${s.tty.foregroundPgid}</span></div>
    ${s.pty ? `<div class="ld-item"><span class="ld-label">PTY:</span>
      <span class="ld-value">master_fd=${s.pty.masterFd}, slave=${s.pty.slaveName}</span></div>` : ""}
  `;
  document.getElementById("lineDisc")!.innerHTML = ldHtml;

  // プロセス
  const procHtml = s.processes.map(p => {
    const stCls = p.state === "running" ? "proc-running" : p.state === "stopped" ? "proc-stopped" : "proc-term";
    const fds = p.fds.map(f => `<span class="fd">fd${f.fd}→${f.name}</span>`).join(" ");
    return `<div class="proc-item ${stCls}">
      <span class="proc-pid">P${p.pid}</span>
      <span class="proc-name">${p.name}</span>
      <span class="proc-pgid">pgid=${p.pgid}</span>
      <span class="proc-state">${p.state}</span>
      <div class="proc-fds">${fds}</div>
    </div>`;
  }).join("");
  document.getElementById("procList")!.innerHTML = procHtml;

  // ログ
  const logHtml = currentSteps.slice(0, currentStep + 1).map((st, i) => {
    const cls = i === currentStep ? "log-current" : "";
    const instrOp = st.instruction.op;
    const detail = instrOp === "keypress" ? ` ${charName((st.instruction as { char: string }).char)}` : "";
    return `<div class="log-item ${cls}">[${st.tick}] ${instrOp}${detail}: ${st.message}</div>`;
  }).join("");
  document.getElementById("logList")!.innerHTML = logHtml;
  const logEl = document.getElementById("logList")!;
  logEl.scrollTop = logEl.scrollHeight;

  // イベント
  const eventsUpTo = allEvents.filter(e => e.tick <= s.tick);
  const eventHtml = eventsUpTo.map(e =>
    `<div class="event-item ev-${e.type}">[${e.tick}] ${e.message}</div>`
  ).join("");
  document.getElementById("eventList")!.innerHTML = eventHtml;
  const evEl = document.getElementById("eventList")!;
  evEl.scrollTop = evEl.scrollHeight;
}

function flagBadge(name: string, on: boolean): string {
  return `<span class="flag ${on ? "flag-on" : "flag-off"}">${name}</span>`;
}

function ccEntry(name: string, value: string): string {
  return `<span class="cc-entry">${name}=${charName(value)}</span>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

document.addEventListener("DOMContentLoaded", init);
