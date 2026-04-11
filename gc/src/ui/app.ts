import { presets, runSimulation } from "../gc/index.js";
import type { SimulationResult, Preset, HeapObject } from "../gc/index.js";

const EVENT_COLORS: Record<string, string> = {
  alloc: "#3498db", root_set: "#2980b9",
  ref_add: "#16a085", ref_remove: "#e67e22",
  gc_start: "#e74c3c", gc_mark_root: "#f39c12", gc_mark_traverse: "#f1c40f",
  gc_mark_complete: "#e67e22", gc_sweep: "#c0392b",
  gc_sweep_free: "#e74c3c", gc_sweep_survive: "#27ae60",
  gc_compact_compute: "#9b59b6", gc_compact_move: "#8e44ad", gc_compact_update_ref: "#7f8c8d",
  gc_complete: "#2ecc71",
  refcount_inc: "#1abc9c", refcount_dec: "#e67e22", refcount_free: "#e74c3c",
  gen_minor_gc: "#f39c12", gen_promote: "#9b59b6", gen_major_gc: "#e74c3c",
};

const GEN_COLORS: Record<string, string> = { young: "#3498db", old: "#e67e22" };

export class GcApp {
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
        .algo-badge { display: inline-block; padding: 3px 10px; border-radius: 3px; font-size: 11px;
                      color: #fff; background: #8e44ad; margin-left: 8px; }
        .heap-viz { display: flex; flex-wrap: wrap; gap: 6px; padding: 10px; background: #000; border-radius: 4px; min-height: 60px; }
        .heap-obj { border: 1px solid #444; border-radius: 4px; padding: 6px 8px; font-size: 10px;
                    text-align: center; min-width: 60px; position: relative; }
        .heap-obj.marked { border-color: #f39c12; box-shadow: 0 0 6px rgba(243,156,18,0.4); }
        .heap-obj.dead { opacity: 0.3; border-color: #e74c3c; text-decoration: line-through; }
        .heap-obj .obj-name { font-weight: bold; color: #e2e5e8; }
        .heap-obj .obj-info { color: #888; font-size: 9px; margin-top: 2px; }
        .heap-obj .refcount { position: absolute; top: -6px; right: -6px; background: #e67e22; color: #fff;
                              border-radius: 50%; width: 16px; height: 16px; font-size: 8px;
                              display: flex; align-items: center; justify-content: center; }
        .heap-obj .gen-badge { position: absolute; top: -6px; left: -6px; color: #fff;
                               border-radius: 50%; width: 16px; height: 16px; font-size: 7px;
                               display: flex; align-items: center; justify-content: center; }
        .roots-viz { display: flex; gap: 10px; flex-wrap: wrap; padding: 8px; }
        .root-box { border: 1px solid #2ecc71; border-radius: 4px; padding: 6px 10px; font-size: 11px; }
        .root-box .root-name { color: #2ecc71; font-weight: bold; }
        .root-box .root-target { color: #888; font-size: 10px; }
        table { width: 100%; border-collapse: collapse; font-size: 11px; }
        th { text-align: left; color: #7f8fa6; padding: 4px 6px; border-bottom: 1px solid #1e1e30; }
        td { padding: 4px 6px; border-bottom: 1px solid #111; }
        .stat-val { color: #f39c12; font-weight: bold; }
        .event-row { padding: 5px 0; border-bottom: 1px solid #111; font-size: 12px; }
        .event-type { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 10px;
                      color: #fff; margin-right: 6px; min-width: 130px; text-align: center; }
        .events-scroll { max-height: 500px; overflow-y: auto; }
        .frag-bar { height: 12px; border-radius: 4px; background: #1e1e30; margin-top: 4px; display: flex; overflow: hidden; }
        .frag-used { background: #27ae60; }
        .frag-free { background: #333; }
        .addr-bar { display: flex; flex-wrap: wrap; gap: 2px; margin-top: 8px; }
        .addr-block { height: 20px; border-radius: 2px; font-size: 8px; color: #fff; display: flex;
                      align-items: center; justify-content: center; min-width: 30px; }
      </style>
      <div class="app">
        <h1>Garbage Collection Simulator</h1>
        <div class="controls">
          <select id="preset-select">
            ${presets.map((p, i) => `<option value="${i}">${p.name}</option>`).join("")}
          </select>
        </div>
        <div class="desc" id="desc"></div>
        <div class="grid">
          <div class="panel" id="heap-panel"></div>
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
    const result = runSimulation(preset.algorithm, preset.roots, preset.actions);
    this.container.querySelector("#desc")!.textContent = preset.description;
    this.renderHeap(preset, result);
    this.renderStats(preset, result);
    this.renderEvents(result);
  }

  private renderHeap(preset: Preset, result: SimulationResult): void {
    const el = this.container.querySelector("#heap-panel")!;
    let html = `<h2>Heap State <span class="algo-badge">${preset.algorithm}</span></h2>`;

    // ルート表示
    html += `<div style="margin-bottom:10px;"><strong style="color:#7f8fa6;font-size:11px;">GC ROOTS</strong></div>`;
    html += `<div class="roots-viz">`;
    for (const root of result.finalRoots) {
      const targetName = root.targetId
        ? result.finalHeap.find((o) => o.id === root.targetId)?.name ?? root.targetId
        : "null";
      const targetColor = root.targetId ? "#3498db" : "#555";
      html += `<div class="root-box">
        <div class="root-name">${root.name}</div>
        <div class="root-target" style="color:${targetColor}">→ ${targetName}</div>
      </div>`;
    }
    html += `</div>`;

    // ヒープオブジェクト表示
    html += `<div style="margin:10px 0 6px;"><strong style="color:#7f8fa6;font-size:11px;">HEAP OBJECTS</strong></div>`;
    html += `<div class="heap-viz">`;
    if (result.finalHeap.length === 0) {
      html += `<div style="color:#555;font-size:11px;padding:10px;">（ヒープは空）</div>`;
    }
    for (const obj of result.finalHeap) {
      const genColor = GEN_COLORS[obj.generation] ?? "#888";
      html += `<div class="heap-obj" style="border-color:${genColor}">`;
      if (preset.algorithm === "ref-count") {
        html += `<div class="refcount">${obj.refCount}</div>`;
      }
      if (preset.algorithm === "generational") {
        html += `<div class="gen-badge" style="background:${genColor}">${obj.generation[0]!.toUpperCase()}</div>`;
      }
      html += `<div class="obj-name">${obj.name}</div>`;
      html += `<div class="obj-info">${obj.size}B | addr:${obj.address}</div>`;
      if (obj.refs.length > 0) {
        const refNames = obj.refs.map((r) => result.finalHeap.find((o) => o.id === r)?.name ?? r).join(", ");
        html += `<div class="obj-info">→ ${refNames}</div>`;
      }
      html += `</div>`;
    }
    html += `</div>`;

    // アドレスマップ
    html += this.renderAddressMap(result.finalHeap);

    el.innerHTML = html;
  }

  private renderAddressMap(heap: HeapObject[]): string {
    if (heap.length === 0) return "";
    const sorted = [...heap].sort((a, b) => a.address - b.address);
    const maxAddr = Math.max(...sorted.map((o) => o.address + o.size));
    if (maxAddr === 0) return "";

    let html = `<div style="margin-top:10px;"><strong style="color:#7f8fa6;font-size:11px;">ADDRESS MAP</strong></div>`;
    html += `<div class="addr-bar">`;

    let pos = 0;
    for (const obj of sorted) {
      // 隙間（フラグメンテーション）
      if (obj.address > pos) {
        const gapW = Math.max(((obj.address - pos) / maxAddr) * 100, 2);
        html += `<div class="addr-block" style="width:${gapW}%;background:#333;" title="空き ${obj.address - pos}B">∅</div>`;
      }
      const w = Math.max((obj.size / maxAddr) * 100, 4);
      const genColor = GEN_COLORS[obj.generation] ?? "#888";
      html += `<div class="addr-block" style="width:${w}%;background:${genColor};" title="${obj.name} ${obj.size}B @${obj.address}">${obj.name}</div>`;
      pos = obj.address + obj.size;
    }
    html += `</div>`;
    return html;
  }

  private renderStats(_preset: Preset, result: SimulationResult): void {
    const el = this.container.querySelector("#stats-panel")!;
    const s = result.stats;
    const fragPct = (s.fragmentationRatio * 100).toFixed(1);
    const usedPct = s.peakHeapSize > 0 ? ((s.finalHeapSize / s.peakHeapSize) * 100).toFixed(0) : "0";

    let html = `<h2>Statistics</h2>`;
    html += `<table>
      <tr><td>総割り当て量</td><td class="stat-val">${s.totalAllocated} B</td></tr>
      <tr><td>総解放量</td><td class="stat-val">${s.totalFreed} B</td></tr>
      <tr><td>GCサイクル数</td><td class="stat-val">${s.gcCycles}</td></tr>
      <tr><td>ピークヒープサイズ</td><td class="stat-val">${s.peakHeapSize} B</td></tr>
      <tr><td>最終ヒープサイズ</td><td class="stat-val">${s.finalHeapSize} B</td></tr>
      <tr><td>回収率</td><td class="stat-val">${s.totalAllocated > 0 ? ((s.totalFreed / s.totalAllocated) * 100).toFixed(0) : 0}%</td></tr>
      <tr><td>フラグメンテーション率</td><td class="stat-val">${fragPct}%</td></tr>
    </table>`;

    // フラグメンテーションバー
    html += `<div style="margin-top:12px;font-size:11px;color:#888;">ヒープ使用率</div>`;
    html += `<div class="frag-bar">
      <div class="frag-used" style="width:${usedPct}%"></div>
      <div class="frag-free" style="width:${100 - Number(usedPct)}%"></div>
    </div>`;
    html += `<div style="font-size:10px;color:#555;margin-top:2px;">使用中 ${s.finalHeapSize}B / ピーク ${s.peakHeapSize}B</div>`;

    // 最終ヒープのオブジェクト一覧
    html += `<div style="margin-top:14px;"><strong style="color:#7f8fa6;font-size:11px;">LIVE OBJECTS</strong></div>`;
    if (result.finalHeap.length === 0) {
      html += `<div style="font-size:11px;color:#555;margin-top:4px;">（なし）</div>`;
    } else {
      html += `<table><tr><th>Name</th><th>Size</th><th>Gen</th><th>Survived</th></tr>`;
      for (const obj of result.finalHeap) {
        const genColor = GEN_COLORS[obj.generation] ?? "#888";
        html += `<tr><td>${obj.name}</td><td>${obj.size}B</td>
          <td style="color:${genColor}">${obj.generation}</td>
          <td>${obj.survivalCount}</td></tr>`;
      }
      html += `</table>`;
    }

    el.innerHTML = html;
  }

  private renderEvents(result: SimulationResult): void {
    const el = this.container.querySelector("#events-panel")!;
    let html = `<h2>GC Events (${result.events.length})</h2><div class="events-scroll">`;
    for (const ev of result.events) {
      const color = EVENT_COLORS[ev.type] ?? "#555";
      html += `<div class="event-row">
        <span style="color:#444;font-size:10px;">[${ev.step}]</span>
        <span class="event-type" style="background:${color}">${ev.type}</span>
        <span style="color:#888;">${ev.description}</span>
      </div>`;
    }
    html += `</div>`;
    el.innerHTML = html;
  }
}
