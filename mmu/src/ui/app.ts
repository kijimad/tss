import { presets, runSimulation } from "../mmu/index.js";
import type { SimulationResult, Preset } from "../mmu/index.js";

const EVENT_COLORS: Record<string, string> = {
  access_start: "#3498db", addr_split: "#2980b9",
  tlb_lookup: "#95a5a6", tlb_hit: "#2ecc71", tlb_miss: "#e67e22",
  pt_walk: "#9b59b6", pt_walk_l2: "#8e44ad", pt_walk_l1: "#9b59b6", pt_hit: "#27ae60",
  page_fault: "#e74c3c", page_load: "#1abc9c", page_evict: "#e67e22", page_evict_dirty: "#c0392b",
  clock_scan: "#f39c12", frame_alloc: "#16a085",
  tlb_update: "#3498db", tlb_evict: "#e67e22",
  access_complete: "#27ae60", protection_fault: "#e74c3c",
  physical_access: "#2ecc71", dirty_set: "#f39c12",
};

export class MmuApp {
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
                 border-radius: 4px; font-family: inherit; font-size: 13px; min-width: 420px; }
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
                      color: #fff; margin-right: 6px; min-width: 120px; text-align: center; }
        .events-scroll { max-height: 500px; overflow-y: auto; }
        .stat-val { color: #f39c12; font-weight: bold; }
        .algo-badge { display: inline-block; padding: 3px 10px; border-radius: 3px; font-size: 11px;
                      color: #fff; background: #8e44ad; margin-left: 8px; }
        .frame-grid { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
        .frame-box { border: 1px solid #333; border-radius: 4px; padding: 6px 10px; text-align: center;
                     font-size: 10px; min-width: 70px; }
        .frame-box.occupied { border-color: #27ae60; }
        .frame-box.empty { border-color: #333; color: #555; }
        .frame-label { font-weight: bold; color: #7f8fa6; font-size: 9px; }
        .frame-content { color: #e2e5e8; margin-top: 2px; }
        .perm { font-family: monospace; letter-spacing: 1px; }
        .perm-on { color: #2ecc71; }
        .perm-off { color: #555; }
        .bit-on { color: #f39c12; }
        .bit-off { color: #333; }
        .tlb-tag { font-size: 9px; color: #3498db; }
        .hit-rate { font-size: 14px; font-weight: bold; }
      </style>
      <div class="app">
        <h1>MMU / Virtual Memory Simulator</h1>
        <div class="controls">
          <select id="preset-select">
            ${presets.map((p, i) => `<option value="${i}">${p.name}</option>`).join("")}
          </select>
        </div>
        <div class="desc" id="desc"></div>
        <div class="grid">
          <div class="panel" id="pt-panel"></div>
          <div class="panel" id="tlb-panel"></div>
          <div class="panel" id="frames-panel"></div>
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
    const result = runSimulation(preset.config, preset.permissions, preset.accesses);
    this.container.querySelector("#desc")!.textContent = preset.description;
    this.renderPageTable(preset, result);
    this.renderTlb(result);
    this.renderFrames(result);
    this.renderStats(preset, result);
    this.renderEvents(result);
  }

  private renderPageTable(_preset: Preset, result: SimulationResult): void {
    const el = this.container.querySelector("#pt-panel")!;
    let html = `<h2>Page Table</h2>`;
    html += `<table><tr><th>VPN</th><th>PFN</th><th>P</th><th>D</th><th>R</th><th>Perms</th></tr>`;
    for (const pte of result.pageTable) {
      const present = pte.present
        ? `<span class="bit-on">1</span>` : `<span class="bit-off">0</span>`;
      const dirty = pte.dirty
        ? `<span class="bit-on">1</span>` : `<span class="bit-off">0</span>`;
      const ref = pte.referenced
        ? `<span class="bit-on">1</span>` : `<span class="bit-off">0</span>`;
      const perms = `<span class="perm">`
        + `<span class="${pte.readable ? "perm-on" : "perm-off"}">R</span>`
        + `<span class="${pte.writable ? "perm-on" : "perm-off"}">W</span>`
        + `<span class="${pte.executable ? "perm-on" : "perm-off"}">X</span>`
        + `</span>`;
      const pfnStr = pte.present ? String(pte.pfn) : `<span style="color:#555">—</span>`;
      html += `<tr><td>${pte.vpn}</td><td>${pfnStr}</td><td>${present}</td><td>${dirty}</td><td>${ref}</td><td>${perms}</td></tr>`;
    }
    html += `</table>`;
    el.innerHTML = html;
  }

  private renderTlb(result: SimulationResult): void {
    const el = this.container.querySelector("#tlb-panel")!;
    let html = `<h2>TLB <span class="tlb-tag">${result.tlb.length} entries</span></h2>`;
    if (result.tlb.length === 0) {
      html += `<div style="font-size:11px;color:#555;">（TLBは空）</div>`;
    } else {
      html += `<table><tr><th>VPN</th><th>PFN</th><th>Valid</th><th>Dirty</th></tr>`;
      for (const entry of result.tlb) {
        const valid = entry.valid
          ? `<span class="bit-on">✓</span>` : `<span class="bit-off">✗</span>`;
        const dirty = entry.dirty
          ? `<span class="bit-on">1</span>` : `<span class="bit-off">0</span>`;
        const style = entry.valid ? "" : "opacity:0.4;";
        html += `<tr style="${style}"><td>${entry.vpn}</td><td>${entry.pfn}</td><td>${valid}</td><td>${dirty}</td></tr>`;
      }
      html += `</table>`;
    }
    el.innerHTML = html;
  }

  private renderFrames(result: SimulationResult): void {
    const el = this.container.querySelector("#frames-panel")!;
    let html = `<h2>Physical Frames</h2>`;
    html += `<div class="frame-grid">`;
    for (const frame of result.frames) {
      const cls = frame.occupied ? "occupied" : "empty";
      const content = frame.occupied
        ? `<div class="frame-content">VPN ${frame.vpn}</div>`
        : `<div class="frame-content" style="color:#555;">空き</div>`;
      html += `<div class="frame-box ${cls}">
        <div class="frame-label">Frame ${frame.pfn}</div>
        ${content}
      </div>`;
    }
    html += `</div>`;
    el.innerHTML = html;
  }

  private renderStats(preset: Preset, result: SimulationResult): void {
    const el = this.container.querySelector("#stats-panel")!;
    const s = result.stats;
    const tlbHitRate = s.totalAccesses > 0 ? ((s.tlbHits / s.totalAccesses) * 100).toFixed(1) : "0.0";
    const pageFaultRate = s.totalAccesses > 0 ? ((s.pageFaults / s.totalAccesses) * 100).toFixed(1) : "0.0";

    let html = `<h2>Statistics <span class="algo-badge">${preset.config.replacementAlgo.toUpperCase()}</span></h2>`;
    html += `<div style="margin-bottom:12px;">
      <span style="color:#888;font-size:11px;">TLB Hit Rate: </span>
      <span class="hit-rate" style="color:${Number(tlbHitRate) > 50 ? "#2ecc71" : "#e74c3c"}">${tlbHitRate}%</span>
    </div>`;
    html += `<table>
      <tr><td>総アクセス数</td><td class="stat-val">${s.totalAccesses}</td></tr>
      <tr><td>TLBヒット</td><td class="stat-val">${s.tlbHits}</td></tr>
      <tr><td>TLBミス</td><td class="stat-val">${s.tlbMisses}</td></tr>
      <tr><td>ページフォルト</td><td class="stat-val">${s.pageFaults}</td></tr>
      <tr><td>ページフォルト率</td><td class="stat-val">${pageFaultRate}%</td></tr>
      <tr><td>エビクション</td><td class="stat-val">${s.pageEvictions}</td></tr>
      <tr><td>ダーティ書き戻し</td><td class="stat-val">${s.dirtyWritebacks}</td></tr>
      <tr><td>保護違反</td><td class="stat-val">${s.protectionFaults}</td></tr>
    </table>`;

    // 設定情報
    html += `<div style="margin-top:14px;"><strong style="color:#7f8fa6;font-size:11px;">CONFIG</strong></div>`;
    html += `<table>
      <tr><td>ページサイズ</td><td>${preset.config.pageSize}B</td></tr>
      <tr><td>物理フレーム数</td><td>${preset.config.physicalFrames}</td></tr>
      <tr><td>TLBサイズ</td><td>${preset.config.tlbSize}</td></tr>
      <tr><td>置換アルゴリズム</td><td>${preset.config.replacementAlgo.toUpperCase()}</td></tr>
      <tr><td>ページテーブル</td><td>${preset.config.twoLevel ? "2段" : "1段"}</td></tr>
    </table>`;

    el.innerHTML = html;
  }

  private renderEvents(result: SimulationResult): void {
    const el = this.container.querySelector("#events-panel")!;
    let html = `<h2>MMU Events (${result.events.length})</h2><div class="events-scroll">`;
    for (const ev of result.events) {
      const color = EVENT_COLORS[ev.type] ?? "#555";
      const addrInfo = ev.highlight
        ? ` <span style="color:#555;font-size:10px;">${ev.highlight.vpn !== undefined ? `VPN:${ev.highlight.vpn}` : ""}${ev.highlight.pfn !== undefined ? ` PFN:${ev.highlight.pfn}` : ""}</span>`
        : "";
      html += `<div class="event-row">
        <span style="color:#444;font-size:10px;">[${ev.step}]</span>
        <span class="event-type" style="background:${color}">${ev.type}</span>
        <span style="color:#888;">${ev.description}</span>${addrInfo}
      </div>`;
    }
    html += `</div>`;
    el.innerHTML = html;
  }
}
