import { presets, runSimulation, SIGNAL_NAMES } from "../signal/index.js";
import type { SimulationResult, Process } from "../signal/index.js";

const EVENT_COLORS: Record<string, string> = {
  process_create: "#7f8c8d", signal_send: "#3498db", signal_deliver: "#27ae60",
  signal_pending: "#f39c12", signal_blocked: "#e67e22", signal_ignored: "#555",
  handler_invoke: "#9b59b6", default_action: "#2980b9",
  process_terminate: "#e74c3c", process_stop: "#c0392b", process_continue: "#27ae60",
  core_dump: "#e74c3c", sigaction_set: "#1abc9c", sigmask_update: "#8e44ad",
  sigpending_check: "#f39c12", sigsuspend: "#16a085",
  sigqueue_send: "#3498db", alarm_set: "#e67e22", alarm_fire: "#d35400",
  pause: "#7f8c8d", fork: "#2ecc71", killpg: "#e74c3c", error: "#e74c3c",
};

const STATE_COLORS: Record<string, string> = {
  running: "#27ae60", sleeping: "#3498db", stopped: "#e67e22",
  zombie: "#7f8c8d", terminated: "#e74c3c",
};

function sigName(sig: number): string {
  return SIGNAL_NAMES[sig] ?? `SIG${sig}`;
}

export class SignalApp {
  private container!: HTMLElement;

  init(el: HTMLElement | null): void {
    if (!el) return;
    this.container = el;
    this.render();
  }

  private render(): void {
    this.container.innerHTML = `
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: "SF Mono", "Cascadia Code", "Consolas", monospace; background: #0a0a0f; color: #c8ccd0; }
        .app { max-width: 1440px; margin: 0 auto; padding: 20px; }
        h1 { font-size: 20px; color: #e2e5e8; margin-bottom: 16px; }
        .controls { display: flex; gap: 12px; align-items: center; margin-bottom: 16px; }
        select { background: #1a1a2e; color: #c8ccd0; border: 1px solid #333; padding: 8px 12px;
                 border-radius: 4px; font-family: inherit; font-size: 13px; min-width: 460px; }
        .desc { color: #888; font-size: 12px; margin-bottom: 16px; line-height: 1.5; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        .panel { background: #12121c; border: 1px solid #1e1e30; border-radius: 6px; padding: 14px; }
        .panel h2 { font-size: 13px; color: #7f8fa6; margin-bottom: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
        .full { grid-column: 1 / -1; }
        table { width: 100%; border-collapse: collapse; font-size: 11px; }
        th { text-align: left; color: #7f8fa6; padding: 4px 6px; border-bottom: 1px solid #1e1e30; }
        td { padding: 4px 6px; border-bottom: 1px solid #111; }
        .event-row { padding: 5px 0; border-bottom: 1px solid #111; font-size: 12px; }
        .event-type { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 10px;
                      color: #fff; margin-right: 6px; min-width: 130px; text-align: center; }
        .events-scroll { max-height: 500px; overflow-y: auto; }
        .stat-val { color: #f39c12; font-weight: bold; }
        .badge { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 9px; color: #fff; }
        .pid-badge { background: #e67e22; }
        .sig-badge { background: #3498db; }
        .state-badge { font-weight: bold; font-size: 10px; }
        .proc-box { background: #0d0d18; border: 1px solid #1e1e30; border-radius: 4px; padding: 8px; margin-bottom: 6px; }
        .handler-row { font-size: 10px; color: #888; padding: 1px 0; }
        .mask-tag { display: inline-block; padding: 1px 4px; border-radius: 2px; font-size: 9px;
                    background: #e67e2233; color: #e67e22; border: 1px solid #e67e2255; margin: 1px; }
        .pending-tag { display: inline-block; padding: 1px 4px; border-radius: 2px; font-size: 9px;
                       background: #f39c1233; color: #f39c12; border: 1px solid #f39c1255; margin: 1px; }
      </style>
      <div class="app">
        <h1>Signal IPC Simulator</h1>
        <div class="controls">
          <select id="preset-select">
            ${presets.map((p, i) => `<option value="${i}">${p.name}</option>`).join("")}
          </select>
        </div>
        <div class="desc" id="desc"></div>
        <div class="grid">
          <div class="panel" id="proc-panel"></div>
          <div class="panel" id="stats-panel"></div>
          <div class="panel full" id="events-panel"></div>
        </div>
      </div>
    `;
    const select = this.container.querySelector("#preset-select") as HTMLSelectElement;
    select.addEventListener("change", () => this.runPreset(Number(select.value)));
    this.runPreset(0);
  }

  private runPreset(index: number): void {
    const preset = presets[index]!;
    const result = runSimulation(preset.ops);
    this.container.querySelector("#desc")!.textContent = preset.description;
    this.renderProcesses(result);
    this.renderStats(result);
    this.renderEvents(result);
  }

  private renderProcesses(result: SimulationResult): void {
    const el = this.container.querySelector("#proc-panel")!;
    let html = `<h2>Processes</h2>`;
    for (const proc of result.processes) {
      html += this.renderProcess(proc);
    }
    el.innerHTML = html;
  }

  private renderProcess(proc: Process): string {
    const sc = STATE_COLORS[proc.state] ?? "#555";
    let html = `<div class="proc-box">
      <div style="margin-bottom:4px;">
        <span class="badge pid-badge">PID ${proc.pid}</span>
        <span style="color:#e2e5e8;font-size:12px;margin-left:4px;">${proc.name}</span>
        <span class="badge state-badge" style="background:${sc};margin-left:4px;">${proc.state}</span>
        <span style="color:#555;font-size:10px;margin-left:4px;">ppid=${proc.ppid} uid=${proc.uid}</span>
      </div>`;

    // ハンドラ
    if (proc.handlers.length > 0) {
      html += `<div style="margin-top:4px;"><span style="color:#7f8fa6;font-size:9px;">HANDLERS:</span>`;
      for (const h of proc.handlers) {
        const typeColor = h.type === "custom" ? "#9b59b6" : h.type === "ignore" ? "#555" : "#3498db";
        html += `<div class="handler-row">
          <span class="badge sig-badge">${sigName(h.signal)}</span>
          <span style="color:${typeColor};margin-left:4px;">${h.type === "custom" ? h.description : h.type === "ignore" ? "SIG_IGN" : "SIG_DFL"}</span>
        </div>`;
      }
      html += `</div>`;
    }

    // マスク
    if (proc.signalMask.length > 0) {
      html += `<div style="margin-top:4px;"><span style="color:#7f8fa6;font-size:9px;">MASK: </span>`;
      html += proc.signalMask.map((s) => `<span class="mask-tag">${sigName(s)}</span>`).join(" ");
      html += `</div>`;
    }

    // ペンディング
    if (proc.pendingSignals.length > 0) {
      html += `<div style="margin-top:4px;"><span style="color:#7f8fa6;font-size:9px;">PENDING: </span>`;
      html += proc.pendingSignals.map((p) => `<span class="pending-tag">${sigName(p.signal)}${p.value !== undefined ? `(${p.value})` : ""}</span>`).join(" ");
      html += `</div>`;
    }

    html += `</div>`;
    return html;
  }

  private renderStats(result: SimulationResult): void {
    const el = this.container.querySelector("#stats-panel")!;
    const s = result.stats;
    el.innerHTML = `<h2>Statistics</h2>
      <table>
        <tr><td>送信シグナル数</td><td class="stat-val">${s.totalSignals}</td></tr>
        <tr><td>配送済み</td><td class="stat-val" style="color:#27ae60">${s.delivered}</td></tr>
        <tr><td>ブロック(ペンディング)</td><td class="stat-val" style="color:#e67e22">${s.blocked}</td></tr>
        <tr><td>無視</td><td class="stat-val" style="color:#555">${s.ignored}</td></tr>
        <tr><td>デフォルト動作</td><td class="stat-val">${s.defaultActions}</td></tr>
        <tr><td>カスタムハンドラ</td><td class="stat-val" style="color:#9b59b6">${s.customHandlers}</td></tr>
        <tr><td>終了プロセス</td><td class="stat-val" style="color:${s.processesTerminated > 0 ? "#e74c3c" : "#27ae60"}">${s.processesTerminated}</td></tr>
        <tr><td>停止プロセス</td><td class="stat-val" style="color:${s.processesStopped > 0 ? "#e67e22" : "#27ae60"}">${s.processesStopped}</td></tr>
      </table>
      <div style="margin-top:14px;">
        <div style="color:#7f8fa6;font-size:10px;text-transform:uppercase;margin-bottom:6px;">Signal Reference</div>
        <div style="font-size:10px;color:#888;line-height:1.6;">
          <div><span style="color:#e74c3c;">SIGKILL(9)</span> — 強制終了 (ブロック・ハンドラ不可)</div>
          <div><span style="color:#e67e22;">SIGSTOP(19)</span> — 強制停止 (ブロック・ハンドラ不可)</div>
          <div><span style="color:#3498db;">SIGTERM(15)</span> — 丁寧な終了要求</div>
          <div><span style="color:#f39c12;">SIGINT(2)</span> — Ctrl+C</div>
          <div><span style="color:#27ae60;">SIGCONT(18)</span> — 停止プロセス再開</div>
          <div><span style="color:#9b59b6;">SIGRTMIN(34+)</span> — リアルタイム (キューイング)</div>
        </div>
      </div>`;
  }

  private renderEvents(result: SimulationResult): void {
    const el = this.container.querySelector("#events-panel")!;
    let html = `<h2>Events (${result.events.length})</h2><div class="events-scroll">`;
    for (const ev of result.events) {
      const color = EVENT_COLORS[ev.type] ?? "#555";
      let meta = "";
      if (ev.pid !== undefined) meta += `<span class="badge pid-badge" style="margin-right:4px;">PID ${ev.pid}</span>`;
      if (ev.signal !== undefined) meta += `<span class="badge sig-badge" style="margin-right:4px;">${sigName(ev.signal)}</span>`;
      html += `<div class="event-row">
        <span style="color:#444;font-size:10px;">[${ev.step}]</span>
        <span class="event-type" style="background:${color}">${ev.type}</span>
        ${meta}
        <span style="color:#888;">${ev.description}</span>
      </div>`;
    }
    html += `</div>`;
    el.innerHTML = html;
  }
}
