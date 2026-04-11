import { presets, runSimulation } from "../goconc/index.js";
import type { SimulationResult, Goroutine, Channel } from "../goconc/index.js";

const EVENT_COLORS: Record<string, string> = {
  goroutine_create: "#27ae60", goroutine_run: "#2ecc71",
  goroutine_block: "#e67e22", goroutine_unblock: "#f39c12", goroutine_exit: "#7f8c8d",
  chan_make: "#3498db", chan_send: "#2980b9", chan_send_block: "#e67e22",
  chan_recv: "#1abc9c", chan_recv_block: "#e67e22", chan_close: "#9b59b6", chan_recv_closed: "#8e44ad",
  select_enter: "#16a085", select_case: "#1abc9c", select_default: "#7f8c8d",
  mutex_lock: "#e74c3c", mutex_lock_block: "#c0392b", mutex_unlock: "#27ae60",
  wg_add: "#3498db", wg_done: "#2ecc71", wg_wait: "#f39c12",
  wg_wait_block: "#e67e22", wg_release: "#27ae60",
  schedule: "#555", set_gomaxprocs: "#9b59b6",
  deadlock: "#e74c3c", panic: "#e74c3c",
};

const STATE_COLORS: Record<string, string> = {
  runnable: "#f39c12", running: "#27ae60", blocked: "#e67e22", waiting: "#3498db", dead: "#555",
};

export class GoConcApp {
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
        .g-badge { background: #27ae60; }
        .ch-badge { background: #3498db; }
        .state-badge { font-weight: bold; font-size: 10px; }
        .item-box { background: #0d0d18; border: 1px solid #1e1e30; border-radius: 4px; padding: 8px; margin-bottom: 6px; }
        .buf-cell { display: inline-block; padding: 2px 6px; border-radius: 2px; font-size: 9px;
                    background: #3498db33; color: #3498db; border: 1px solid #3498db55; margin: 1px; }
        .buf-empty { background: #1e1e30; color: #444; border-color: #333; }
        .queue-tag { display: inline-block; padding: 1px 4px; border-radius: 2px; font-size: 9px;
                     background: #e67e2233; color: #e67e22; margin: 1px; }
      </style>
      <div class="app">
        <h1>Go Concurrency Simulator</h1>
        <div class="controls">
          <select id="preset-select">
            ${presets.map((p, i) => `<option value="${i}">${p.name}</option>`).join("")}
          </select>
        </div>
        <div class="desc" id="desc"></div>
        <div class="grid">
          <div class="panel" id="goroutine-panel"></div>
          <div class="panel" id="sync-panel"></div>
          <div class="panel full" id="channel-panel"></div>
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
    this.renderGoroutines(result);
    this.renderSync(result);
    this.renderChannels(result);
    this.renderEvents(result);
  }

  private renderGoroutines(result: SimulationResult): void {
    const el = this.container.querySelector("#goroutine-panel")!;
    let html = `<h2>Goroutines (${result.goroutines.length})</h2>`;
    for (const g of result.goroutines) {
      html += this.renderG(g);
    }
    // GMP スケジューラ
    if (result.processors.length > 1 || result.threads.length > 1) {
      html += `<div style="margin-top:10px;"><div style="color:#7f8fa6;font-size:10px;text-transform:uppercase;margin-bottom:4px;">GMP Scheduler</div>`;
      for (const p of result.processors) {
        html += `<div style="font-size:10px;margin:2px 0;"><span style="color:#9b59b6;font-weight:bold;">P${p.id}</span>`;
        html += ` current=${p.currentG !== undefined ? `G${p.currentG}` : "idle"}`;
        html += ` runq=[${p.localRunQueue.map((id) => `G${id}`).join(", ") || "empty"}]</div>`;
      }
      html += `</div>`;
    }
    // 統計
    const s = result.stats;
    html += `<div style="margin-top:10px;"><div style="color:#7f8fa6;font-size:10px;text-transform:uppercase;margin-bottom:4px;">Stats</div>
      <div style="font-size:10px;color:#888;">
        作成: <span class="stat-val">${s.goroutinesCreated}</span> |
        終了: <span class="stat-val">${s.goroutinesExited}</span> |
        送信: <span class="stat-val">${s.channelSends}</span> |
        受信: <span class="stat-val">${s.channelRecvs}</span> |
        Lock: <span class="stat-val">${s.mutexLocks}</span> |
        CS: <span class="stat-val">${s.contextSwitches}</span>
        ${s.deadlocks > 0 ? `| <span style="color:#e74c3c;font-weight:bold;">DEADLOCK!</span>` : ""}
      </div></div>`;
    el.innerHTML = html;
  }

  private renderG(g: Goroutine): string {
    const sc = STATE_COLORS[g.state] ?? "#555";
    return `<div class="item-box">
      <span class="badge g-badge">G${g.id}</span>
      <span style="color:#e2e5e8;font-size:11px;margin-left:4px;">${g.name}</span>
      <span class="badge state-badge" style="background:${sc};margin-left:4px;">${g.state}</span>
      <span style="color:#555;font-size:9px;margin-left:4px;">stack=${g.stackSize}KB${g.pId !== undefined ? ` P${g.pId}` : ""}</span>
      ${g.blockReason ? `<div style="color:#e67e22;font-size:9px;margin-top:2px;">blocked: ${g.blockReason}</div>` : ""}
    </div>`;
  }

  private renderSync(result: SimulationResult): void {
    const el = this.container.querySelector("#sync-panel")!;
    let html = `<h2>Sync Primitives</h2>`;

    // Mutexes
    for (const mu of result.mutexes) {
      const lockColor = mu.locked ? "#e74c3c" : "#27ae60";
      html += `<div class="item-box">
        <span style="color:#e74c3c;font-weight:bold;font-size:10px;">MUTEX</span>
        <span style="margin-left:4px;font-size:11px;">${mu.name}</span>
        <span class="badge" style="background:${lockColor};margin-left:4px;">${mu.locked ? `locked(G${mu.owner})` : "unlocked"}</span>
        ${mu.waitQueue.length > 0 ? `<div style="margin-top:2px;">${mu.waitQueue.map((id) => `<span class="queue-tag">G${id} waiting</span>`).join(" ")}</div>` : ""}
      </div>`;
    }

    // WaitGroups
    for (const wg of result.waitGroups) {
      html += `<div class="item-box">
        <span style="color:#3498db;font-weight:bold;font-size:10px;">WAITGROUP</span>
        <span style="margin-left:4px;font-size:11px;">${wg.name}</span>
        <span class="badge" style="background:${wg.counter > 0 ? "#f39c12" : "#27ae60"};margin-left:4px;">counter=${wg.counter}</span>
        ${wg.waiters.length > 0 ? `<div style="margin-top:2px;">${wg.waiters.map((id) => `<span class="queue-tag">G${id} Wait()</span>`).join(" ")}</div>` : ""}
      </div>`;
    }

    if (result.mutexes.length === 0 && result.waitGroups.length === 0) {
      html += `<div style="color:#555;font-size:11px;">sync primitiveなし</div>`;
    }

    // Go concurrency reference
    html += `<div style="margin-top:14px;">
      <div style="color:#7f8fa6;font-size:10px;text-transform:uppercase;margin-bottom:6px;">Go Concurrency Model</div>
      <div style="font-size:10px;color:#888;line-height:1.6;">
        <div><span style="color:#27ae60;">goroutine</span> — 軽量スレッド (2KB初期スタック)</div>
        <div><span style="color:#3498db;">channel</span> — goroutine間通信</div>
        <div><span style="color:#e74c3c;">Mutex</span> — 排他制御</div>
        <div><span style="color:#f39c12;">WaitGroup</span> — 完了待ち</div>
        <div><span style="color:#9b59b6;">select</span> — 多重チャネル待ち</div>
      </div>
    </div>`;
    el.innerHTML = html;
  }

  private renderChannels(result: SimulationResult): void {
    const el = this.container.querySelector("#channel-panel")!;
    if (result.channels.length === 0) {
      el.innerHTML = `<h2>Channels</h2><div style="color:#555;font-size:11px;">チャネルなし</div>`;
      return;
    }
    let html = `<h2>Channels (${result.channels.length})</h2>`;
    for (const ch of result.channels) {
      html += this.renderChannel(ch);
    }
    el.innerHTML = html;
  }

  private renderChannel(ch: Channel): string {
    const bufType = ch.capacity === 0 ? "unbuffered" : `buffered(${ch.capacity})`;
    const closedBadge = ch.closed ? `<span class="badge" style="background:#e74c3c;margin-left:4px;">closed</span>` : "";
    let html = `<div class="item-box">
      <span class="badge ch-badge">Ch${ch.id}</span>
      <span style="color:#e2e5e8;font-size:11px;margin-left:4px;">${ch.name}</span>
      <span style="color:#555;font-size:9px;margin-left:4px;">[${bufType}]</span>
      ${closedBadge}`;

    // バッファ表示
    if (ch.capacity > 0) {
      html += `<div style="margin-top:4px;">`;
      for (let i = 0; i < ch.capacity; i++) {
        const val = ch.buffer[i];
        html += val
          ? `<span class="buf-cell">${val}</span>`
          : `<span class="buf-cell buf-empty">_</span>`;
      }
      html += `<span style="color:#555;font-size:9px;margin-left:4px;">${ch.buffer.length}/${ch.capacity}</span>`;
      html += `</div>`;
    }

    // 送受信キュー
    if (ch.sendQueue.length > 0) {
      html += `<div style="margin-top:2px;">${ch.sendQueue.map((id) => `<span class="queue-tag">G${id} send</span>`).join(" ")}</div>`;
    }
    if (ch.recvQueue.length > 0) {
      html += `<div style="margin-top:2px;">${ch.recvQueue.map((id) => `<span class="queue-tag">G${id} recv</span>`).join(" ")}</div>`;
    }

    html += `</div>`;
    return html;
  }

  private renderEvents(result: SimulationResult): void {
    const el = this.container.querySelector("#events-panel")!;
    let html = `<h2>Events (${result.events.length})</h2><div class="events-scroll">`;
    for (const ev of result.events) {
      const color = EVENT_COLORS[ev.type] ?? "#555";
      let meta = "";
      if (ev.goroutineId !== undefined) meta += `<span class="badge g-badge" style="margin-right:4px;">G${ev.goroutineId}</span>`;
      if (ev.chanId !== undefined) meta += `<span class="badge ch-badge" style="margin-right:4px;">Ch${ev.chanId}</span>`;
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
