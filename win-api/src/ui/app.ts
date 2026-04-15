// ══════════════════════════════════════
//  Windows API シミュレーター — UI
// ══════════════════════════════════════

import type {
  WinEvent, HandleEntry, WindowInfo,
  DeviceContext, ProcessInfo, VirtualMemRegion,
  FileInfo, RegistryKey, ModuleInfo,
  MutexInfo, EventInfo, SemaphoreInfo, WinMessage, WinSimResult,
} from "../engine/types.js";
import { PRESETS } from "../engine/presets.js";

// ── 色 ──

const EVENT_COLORS: Record<string, string> = {
  handle_create: "#4fc3f7", handle_close: "#90a4ae", handle_ref: "#80cbc4",
  window_create: "#66bb6a", window_destroy: "#ef5350", window_show: "#42a5f5",
  msg_post: "#ab47bc", msg_send: "#7e57c2", msg_dispatch: "#5c6bc0",
  msg_proc: "#26a69a", msg_default: "#78909c", msg_quit: "#ff7043",
  gdi_binddc: "#29b6f6", gdi_releasedc: "#78909c", gdi_draw: "#ffa726",
  process_create: "#66bb6a", process_exit: "#ffa726", process_terminate: "#ef5350",
  thread_create: "#4db6ac", thread_exit: "#ffb74d", thread_suspend: "#ff8a65",
  thread_resume: "#81c784", thread_wait: "#ce93d8", thread_wake: "#aed581",
  vmem_reserve: "#4dd0e1", vmem_commit: "#4fc3f7", vmem_decommit: "#ffb74d", vmem_release: "#ef5350",
  heap_create: "#66bb6a", heap_alloc: "#42a5f5", heap_free: "#ffb74d", heap_destroy: "#ef5350",
  file_open: "#66bb6a", file_write: "#42a5f5", file_read: "#ab47bc", file_seek: "#78909c", file_close: "#90a4ae",
  reg_create: "#66bb6a", reg_set: "#42a5f5", reg_query: "#ab47bc", reg_delete: "#ef5350", reg_close: "#90a4ae",
  dll_load: "#66bb6a", dll_getproc: "#42a5f5", dll_free: "#ef5350",
  sync_create: "#66bb6a", sync_wait: "#ce93d8", sync_signal: "#aed581",
  sync_release: "#ffb74d", sync_timeout: "#ff7043",
  comment: "#b0bec5", error: "#ef5350", return_value: "#80cbc4",
};

function sevBg(sev: string): string {
  switch (sev) {
    case "success": return "rgba(76,175,80,0.15)";
    case "warning": return "rgba(255,167,38,0.15)";
    case "error":   return "rgba(239,83,80,0.15)";
    default:        return "transparent";
  }
}

// ── アプリケーション ──

export class WinApiApp {
  private root!: HTMLElement;
  private result: WinSimResult | null = null;
  private stepIdx = 0;

  init(el: HTMLElement | null) {
    if (!el) return;
    this.root = el;
    this.root.innerHTML = this.buildLayout();
    this.bindEvents();
    this.selectPreset(0);
  }

  private buildLayout(): string {
    const options = PRESETS.map((p, i) =>
      `<option value="${i}">${p.name}</option>`).join("");
    return `
<div style="padding:12px;max-width:1400px;margin:0 auto">
  <h1 style="color:#64b5f6;font-size:18px;margin-bottom:8px">Windows API Simulator</h1>
  <div style="display:flex;gap:12px;align-items:center;margin-bottom:12px">
    <select id="preset" style="background:#1a1a2e;color:#e0e0e0;border:1px solid #333;padding:4px 8px;font-family:inherit;font-size:12px">${options}</select>
    <span id="desc" style="color:#888;font-size:11px"></span>
  </div>
  <div style="display:flex;gap:8px;align-items:center;margin-bottom:12px">
    <button id="prev" style="background:#1a1a2e;color:#e0e0e0;border:1px solid #444;padding:4px 12px;cursor:pointer;font-family:inherit">◀</button>
    <span id="stepLabel" style="color:#aaa;min-width:100px;text-align:center">Step 0</span>
    <button id="next" style="background:#1a1a2e;color:#e0e0e0;border:1px solid #444;padding:4px 12px;cursor:pointer;font-family:inherit">▶</button>
    <button id="play" style="background:#1a1a2e;color:#e0e0e0;border:1px solid #444;padding:4px 12px;cursor:pointer;font-family:inherit">▶ Play</button>
    <input id="speed" type="range" min="100" max="2000" value="500" style="width:100px">
    <span id="speedLabel" style="color:#666;font-size:11px">500ms</span>
  </div>
  <div style="display:flex;gap:12px;flex-wrap:wrap">
    <div style="flex:1;min-width:400px">
      <div id="apiCall" style="background:#1a1a2e;border:1px solid #333;padding:8px;margin-bottom:8px;border-radius:4px;min-height:28px"></div>
      <div id="handles" style="background:#1a1a2e;border:1px solid #333;padding:8px;margin-bottom:8px;border-radius:4px"></div>
      <div id="windows" style="background:#1a1a2e;border:1px solid #333;padding:8px;margin-bottom:8px;border-radius:4px"></div>
      <div id="gdi" style="background:#1a1a2e;border:1px solid #333;padding:8px;margin-bottom:8px;border-radius:4px"></div>
      <div id="processes" style="background:#1a1a2e;border:1px solid #333;padding:8px;margin-bottom:8px;border-radius:4px"></div>
      <div id="memory" style="background:#1a1a2e;border:1px solid #333;padding:8px;margin-bottom:8px;border-radius:4px"></div>
    </div>
    <div style="flex:1;min-width:400px">
      <div id="files" style="background:#1a1a2e;border:1px solid #333;padding:8px;margin-bottom:8px;border-radius:4px"></div>
      <div id="registry" style="background:#1a1a2e;border:1px solid #333;padding:8px;margin-bottom:8px;border-radius:4px"></div>
      <div id="modules" style="background:#1a1a2e;border:1px solid #333;padding:8px;margin-bottom:8px;border-radius:4px"></div>
      <div id="sync" style="background:#1a1a2e;border:1px solid #333;padding:8px;margin-bottom:8px;border-radius:4px"></div>
      <div id="msgQueue" style="background:#1a1a2e;border:1px solid #333;padding:8px;margin-bottom:8px;border-radius:4px"></div>
      <div id="eventLog" style="background:#1a1a2e;border:1px solid #333;padding:8px;border-radius:4px;max-height:400px;overflow-y:auto"></div>
    </div>
  </div>
</div>`;
  }

  private bindEvents() {
    const $ = (id: string) => this.root.querySelector(`#${id}`) as HTMLElement;
    $("preset").addEventListener("change", (e) => {
      this.selectPreset(+(e.target as HTMLSelectElement).value);
    });
    $("prev").addEventListener("click", () => this.goStep(-1));
    $("next").addEventListener("click", () => this.goStep(1));

    let timer: ReturnType<typeof setInterval> | null = null;
    $("play").addEventListener("click", () => {
      if (timer) { clearInterval(timer); timer = null; $("play").textContent = "▶ Play"; return; }
      $("play").textContent = "⏸ Stop";
      const speed = +($("speed") as HTMLInputElement).value;
      timer = setInterval(() => {
        if (!this.result || this.stepIdx >= this.result.snapshots.length - 1) {
          clearInterval(timer!); timer = null; $("play").textContent = "▶ Play"; return;
        }
        this.goStep(1);
      }, speed);
    });
    $("speed").addEventListener("input", (e) => {
      $("speedLabel").textContent = (e.target as HTMLInputElement).value + "ms";
    });
  }

  private selectPreset(idx: number) {
    const preset = PRESETS[idx];
    if (!preset) return;
    this.result = preset.run();
    this.stepIdx = 0;
    const desc = this.root.querySelector("#desc") as HTMLElement;
    if (desc) desc.textContent = preset.description;
    this.render();
  }

  private goStep(delta: number) {
    if (!this.result) return;
    this.stepIdx = Math.max(0, Math.min(this.result.snapshots.length - 1, this.stepIdx + delta));
    this.render();
  }

  private render() {
    if (!this.result) return;
    const snap = this.result.snapshots[this.stepIdx];
    if (!snap) return;
    const $ = (id: string) => this.root.querySelector(`#${id}`) as HTMLElement;

    $("stepLabel").textContent = `Step ${snap.step} / ${this.result.snapshots.length - 1}`;

    // API呼び出し
    $("apiCall").innerHTML = snap.apiCall
      ? `<span style="color:#64b5f6;font-weight:bold">${snap.apiCall.api}</span> <span style="color:#888">${JSON.stringify(snap.apiCall).substring(0, 120)}</span>`
      : `<span style="color:#555">初期状態</span>`;

    // ハンドル
    $("handles").innerHTML = this.renderHandles(snap.handles);
    // ウィンドウ
    $("windows").innerHTML = this.renderWindows(snap.windows);
    // GDI
    $("gdi").innerHTML = this.renderGdi(snap.deviceContexts);
    // プロセス
    $("processes").innerHTML = this.renderProcesses(snap.processes);
    // 仮想メモリ
    $("memory").innerHTML = this.renderMemory(snap.virtualMemory);
    // ファイル
    $("files").innerHTML = this.renderFiles(snap.files);
    // レジストリ
    $("registry").innerHTML = this.renderRegistry(snap.registryKeys);
    // モジュール
    $("modules").innerHTML = this.renderModules(snap.modules);
    // 同期
    $("sync").innerHTML = this.renderSync(snap.mutexes, snap.events, snap.semaphores);
    // メッセージキュー
    $("msgQueue").innerHTML = this.renderMsgQueue(snap.messageQueue);
    // イベントログ
    $("eventLog").innerHTML = this.renderEvents(snap.simEvents);
  }

  private renderHandles(handles: HandleEntry[]): string {
    const active = handles.filter(h => !h.closed);
    if (active.length === 0) return `<div style="color:#555">Handles: なし</div>`;
    const rows = active.map(h =>
      `<span style="display:inline-block;background:#252540;border:1px solid #444;padding:2px 6px;margin:2px;border-radius:3px;font-size:11px">` +
      `<span style="color:#64b5f6">0x${h.handle.toString(16)}</span> ` +
      `<span style="color:#aaa">${h.type}</span> ` +
      `<span style="color:#666">"${h.name}"</span></span>`
    ).join("");
    return `<div style="color:#90a4ae;font-size:11px;margin-bottom:4px">Handles (${active.length})</div>${rows}`;
  }

  private renderWindows(windows: WindowInfo[]): string {
    if (windows.length === 0) return `<div style="color:#555">Windows: なし</div>`;
    const rows = windows.map(w =>
      `<div style="background:#252540;border:1px solid #444;padding:4px 8px;margin:2px 0;border-radius:3px">` +
      `<span style="color:#66bb6a">HWND=0x${w.hwnd.toString(16)}</span> ` +
      `<span style="color:#e0e0e0">"${w.title}"</span> ` +
      `<span style="color:#888">${w.width}×${w.height}</span> ` +
      `<span style="color:${w.visible ? '#4fc3f7' : '#666'}">${w.visible ? 'visible' : 'hidden'}</span></div>`
    ).join("");
    return `<div style="color:#66bb6a;font-size:11px;margin-bottom:4px">Windows (${windows.length})</div>${rows}`;
  }

  private renderGdi(dcs: DeviceContext[]): string {
    if (dcs.length === 0) return `<div style="color:#555">GDI: アクティブDCなし</div>`;
    const rows = dcs.map(dc => {
      const cmds = dc.commands.map(c =>
        `<span style="color:#ffa726;font-size:10px">${c.op}</span>`
      ).join(" → ");
      return `<div style="background:#252540;border:1px solid #444;padding:4px 8px;margin:2px 0;border-radius:3px">` +
        `<span style="color:#29b6f6">HDC=0x${dc.hdc.toString(16)}</span> ` +
        `pen:<span style="color:${dc.penColor}">${dc.penColor}</span> ` +
        `brush:<span style="color:${dc.brushColor}">${dc.brushColor}</span>` +
        (dc.commands.length > 0 ? `<div style="margin-top:2px">${cmds}</div>` : "") +
        `</div>`;
    }).join("");
    return `<div style="color:#ffa726;font-size:11px;margin-bottom:4px">GDI Device Contexts</div>${rows}`;
  }

  private renderProcesses(procs: ProcessInfo[]): string {
    const rows = procs.map(p => {
      const stateColor = p.state === "running" ? "#66bb6a" : p.state === "terminated" ? "#ef5350" : "#ffa726";
      const threads = p.threads.map(t => {
        const tc = t.state === "running" ? "#4db6ac" : t.state === "terminated" ? "#ef5350" : "#ce93d8";
        return `<span style="color:${tc};font-size:10px">T${t.tid}(${t.state})</span>`;
      }).join(" ");
      return `<div style="background:#252540;border:1px solid #444;padding:4px 8px;margin:2px 0;border-radius:3px">` +
        `<span style="color:${stateColor}">PID=${p.pid}</span> ` +
        `<span style="color:#e0e0e0">${p.name}</span> ` +
        `<span style="color:${stateColor}">[${p.state}]</span> ` +
        `<span style="color:#888">heaps:${p.heaps.length}</span> ` +
        `<div style="margin-top:2px">${threads}</div></div>`;
    }).join("");
    return `<div style="color:#4db6ac;font-size:11px;margin-bottom:4px">Processes</div>${rows}`;
  }

  private renderMemory(regions: VirtualMemRegion[]): string {
    if (regions.length === 0) return `<div style="color:#555">Virtual Memory: なし</div>`;
    const rows = regions.map(v => {
      const sc = v.state === "committed" ? "#4fc3f7" : v.state === "reserved" ? "#ffa726" : "#555";
      return `<div style="background:#252540;border:1px solid #444;padding:4px 8px;margin:2px 0;border-radius:3px">` +
        `<span style="color:${sc}">0x${v.baseAddress.toString(16)}</span> ` +
        `<span style="color:#aaa">${v.size}B</span> ` +
        `<span style="color:${sc}">[${v.state}]</span> ` +
        `<span style="color:#888">${v.protect}</span></div>`;
    }).join("");
    return `<div style="color:#4fc3f7;font-size:11px;margin-bottom:4px">Virtual Memory (${regions.length})</div>${rows}`;
  }

  private renderFiles(files: FileInfo[]): string {
    if (files.length === 0) return `<div style="color:#555">Files: なし</div>`;
    const rows = files.map(f =>
      `<div style="background:#252540;border:1px solid #444;padding:4px 8px;margin:2px 0;border-radius:3px">` +
      `<span style="color:#42a5f5">0x${f.hFile.toString(16)}</span> ` +
      `<span style="color:#e0e0e0">${f.path}</span> ` +
      `<span style="color:#888">[${f.accessMode}] pos=${f.position} size=${f.size}</span>` +
      (f.content ? `<div style="color:#aed581;font-size:10px;margin-top:2px;white-space:pre">${f.content.substring(0, 100)}</div>` : "") +
      `</div>`
    ).join("");
    return `<div style="color:#42a5f5;font-size:11px;margin-bottom:4px">Open Files</div>${rows}`;
  }

  private renderRegistry(keys: RegistryKey[]): string {
    if (keys.length === 0) return `<div style="color:#555">Registry: なし</div>`;
    const rows = keys.map(k => {
      const vals = k.values.map(v =>
        `<span style="font-size:10px;color:#ab47bc">${v.name}</span>=<span style="color:#aed581">${JSON.stringify(v.data)}</span> <span style="color:#555">(${v.type})</span>`
      ).join("<br>");
      return `<div style="background:#252540;border:1px solid #444;padding:4px 8px;margin:2px 0;border-radius:3px">` +
        `<span style="color:#ffa726">${k.path}</span>` +
        (vals ? `<div style="margin-top:2px;margin-left:12px">${vals}</div>` : "") +
        `</div>`;
    }).join("");
    return `<div style="color:#ffa726;font-size:11px;margin-bottom:4px">Registry</div>${rows}`;
  }

  private renderModules(modules: ModuleInfo[]): string {
    if (modules.length === 0) return `<div style="color:#555">Modules: なし</div>`;
    const rows = modules.map(m =>
      `<div style="background:#252540;border:1px solid #444;padding:4px 8px;margin:2px 0;border-radius:3px">` +
      `<span style="color:#66bb6a">0x${m.hModule.toString(16)}</span> ` +
      `<span style="color:#e0e0e0">${m.name}</span> ` +
      `<span style="color:#888">base=0x${m.baseAddress.toString(16)}</span>` +
      `<div style="font-size:10px;color:#78909c;margin-top:2px">${m.exports.join(", ")}</div></div>`
    ).join("");
    return `<div style="color:#66bb6a;font-size:11px;margin-bottom:4px">Loaded Modules</div>${rows}`;
  }

  private renderSync(mutexes: MutexInfo[], events: EventInfo[], sems: SemaphoreInfo[]): string {
    if (mutexes.length === 0 && events.length === 0 && sems.length === 0) {
      return `<div style="color:#555">Sync Objects: なし</div>`;
    }
    let html = `<div style="color:#ce93d8;font-size:11px;margin-bottom:4px">Sync Objects</div>`;
    for (const m of mutexes) {
      const sc = m.signaled ? "#aed581" : "#ef5350";
      html += `<div style="background:#252540;border:1px solid #444;padding:4px 8px;margin:2px 0;border-radius:3px">` +
        `<span style="color:#ffa726">Mutex</span> "${m.name}" ` +
        `<span style="color:${sc}">${m.signaled ? "signaled" : "non-signaled"}</span>` +
        (m.ownerTid > 0 ? ` <span style="color:#888">owner=TID${m.ownerTid}</span>` : "") +
        `</div>`;
    }
    for (const e of events) {
      const sc = e.signaled ? "#aed581" : "#ef5350";
      html += `<div style="background:#252540;border:1px solid #444;padding:4px 8px;margin:2px 0;border-radius:3px">` +
        `<span style="color:#42a5f5">Event</span> "${e.name}" ` +
        `<span style="color:${sc}">${e.signaled ? "signaled" : "non-signaled"}</span> ` +
        `<span style="color:#888">${e.manualReset ? "manual" : "auto"}-reset</span></div>`;
    }
    for (const s of sems) {
      html += `<div style="background:#252540;border:1px solid #444;padding:4px 8px;margin:2px 0;border-radius:3px">` +
        `<span style="color:#ab47bc">Semaphore</span> "${s.name}" ` +
        `<span style="color:#4fc3f7">${s.count}/${s.maxCount}</span></div>`;
    }
    return html;
  }

  private renderMsgQueue(queue: WinMessage[]): string {
    if (queue.length === 0) return `<div style="color:#555">Message Queue: 空</div>`;
    const rows = queue.map(m =>
      `<span style="display:inline-block;background:#252540;border:1px solid #444;padding:2px 6px;margin:2px;border-radius:3px;font-size:10px">` +
      `<span style="color:#ab47bc">${m.msg}</span> ` +
      `<span style="color:#666">→0x${m.hwnd.toString(16)}</span></span>`
    ).join("");
    return `<div style="color:#ab47bc;font-size:11px;margin-bottom:4px">Message Queue (${queue.length})</div>${rows}`;
  }

  private renderEvents(events: WinEvent[]): string {
    if (events.length === 0) return `<div style="color:#555">Events: なし</div>`;
    const rows = events.map(e => {
      const color = EVENT_COLORS[e.type] ?? "#888";
      return `<div style="padding:2px 4px;margin:1px 0;background:${sevBg(e.severity)};border-radius:2px">` +
        `<span style="color:${color};font-size:10px">[${e.type}]</span> ` +
        `<span style="color:#e0e0e0;font-size:11px">${e.message}</span>` +
        (e.detail ? `<span style="color:#666;font-size:10px"> ${e.detail}</span>` : "") +
        `</div>`;
    }).join("");
    return `<div style="color:#b0bec5;font-size:11px;margin-bottom:4px">Events</div>${rows}`;
  }
}
