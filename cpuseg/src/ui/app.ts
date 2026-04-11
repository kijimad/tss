import { presets, runSimulation, encodeSelector, effectiveLimit } from "../seg/index.js";
import type { SimulationResult, Preset } from "../seg/index.js";

const EVENT_COLORS: Record<string, string> = {
  selector_parse: "#3498db", gdt_lookup: "#9b59b6", ldt_lookup: "#8e44ad",
  descriptor_load: "#2980b9", privilege_check: "#f39c12", privilege_ok: "#27ae60",
  privilege_fail: "#e74c3c", null_selector: "#7f8c8d", segment_not_present: "#c0392b",
  limit_check: "#e67e22", limit_ok: "#27ae60", limit_fail: "#e74c3c",
  type_check: "#1abc9c", type_ok: "#27ae60", type_fail: "#e74c3c",
  linear_addr: "#16a085", access_ok: "#2ecc71",
  seg_load: "#3498db", far_call: "#9b59b6", far_jmp: "#8e44ad",
  call_gate: "#f39c12", ring_transition: "#e74c3c",
  gp_fault: "#e74c3c", ss_fault: "#c0392b", np_fault: "#d35400",
};

const RING_COLORS = ["#e74c3c", "#e67e22", "#f39c12", "#3498db"];
const SEG_TYPE_COLORS: Record<string, string> = {
  code: "#3498db", data: "#27ae60", stack: "#e67e22", tss: "#9b59b6",
  call_gate: "#f39c12", null: "#555",
};

export class SegApp {
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
        .ring-badge { display: inline-block; padding: 2px 8px; border-radius: 3px; font-size: 10px;
                      color: #fff; font-weight: bold; }
        .seg-type-badge { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 9px;
                          color: #fff; min-width: 50px; text-align: center; }
        .reg-box { display: inline-flex; align-items: center; gap: 6px; border: 1px solid #333;
                   border-radius: 4px; padding: 4px 8px; margin: 3px; font-size: 11px; }
        .reg-name { color: #7f8fa6; font-weight: bold; }
        .reg-val { color: #f39c12; }
        .addr-bar { display: flex; gap: 2px; margin-top: 8px; height: 24px; }
        .addr-block { border-radius: 2px; font-size: 8px; color: #fff; display: flex;
                      align-items: center; justify-content: center; min-width: 20px; }
        .bit-on { color: #2ecc71; }
        .bit-off { color: #555; }
      </style>
      <div class="app">
        <h1>CPU Segmentation Simulator</h1>
        <div class="controls">
          <select id="preset-select">
            ${presets.map((p, i) => `<option value="${i}">${p.name}</option>`).join("")}
          </select>
        </div>
        <div class="desc" id="desc"></div>
        <div class="grid">
          <div class="panel" id="gdt-panel"></div>
          <div class="panel" id="cpu-panel"></div>
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
    const result = runSimulation(preset.gdt, preset.ldt, preset.initialCpu, preset.ops);
    this.container.querySelector("#desc")!.textContent = preset.description;
    this.renderGdt(preset, result);
    this.renderCpu(result);
    this.renderEvents(result);
  }

  private renderGdt(_preset: Preset, result: SimulationResult): void {
    const el = this.container.querySelector("#gdt-panel")!;
    let html = `<h2>Descriptor Tables</h2>`;

    // GDT
    html += `<div style="margin-bottom:12px;"><strong style="color:#7f8fa6;font-size:11px;">GDT (Global Descriptor Table)</strong></div>`;
    html += this.renderTable(result.gdt);

    // LDT
    if (result.ldt.length > 0) {
      html += `<div style="margin-top:14px;margin-bottom:6px;"><strong style="color:#7f8fa6;font-size:11px;">LDT (Local Descriptor Table)</strong></div>`;
      html += this.renderTable(result.ldt);
    }

    // メモリマップ
    html += `<div style="margin-top:14px;"><strong style="color:#7f8fa6;font-size:11px;">MEMORY MAP</strong></div>`;
    html += `<div class="addr-bar">`;
    const allDescs = [...result.gdt, ...result.ldt].filter((d) => d.type !== "null" && d.type !== "call_gate" && d.present);
    const maxAddr = Math.max(...allDescs.map((d) => d.base + effectiveLimit(d)), 1);
    for (const desc of allDescs.sort((a, b) => a.base - b.base)) {
      const left = (desc.base / maxAddr) * 100;
      const width = Math.max((effectiveLimit(desc) / maxAddr) * 100, 3);
      const color = SEG_TYPE_COLORS[desc.type] ?? "#555";
      html += `<div class="addr-block" style="margin-left:${left > 0 ? 1 : 0}px;width:${width}%;background:${color};"
        title="${desc.name}: 0x${desc.base.toString(16)}-0x${(desc.base + effectiveLimit(desc)).toString(16)}">${desc.name.slice(0, 8)}</div>`;
    }
    html += `</div>`;

    el.innerHTML = html;
  }

  private renderTable(descs: import("../seg/index.js").SegmentDescriptor[]): string {
    let html = `<table><tr><th>#</th><th>Name</th><th>Type</th><th>Base</th><th>Limit</th><th>DPL</th><th>P</th><th>G</th><th>Flags</th></tr>`;
    for (const d of descs) {
      const typeColor = SEG_TYPE_COLORS[d.type] ?? "#555";
      const ringColor = RING_COLORS[d.dpl] ?? "#555";
      const present = d.present ? `<span class="bit-on">1</span>` : `<span class="bit-off">0</span>`;
      const gran = d.granularity ? `<span class="bit-on">4K</span>` : `<span class="bit-off">1B</span>`;
      let flags = "";
      if (d.type === "code") {
        flags = `${d.readable ? "R" : "-"}${d.conforming ? "C" : "-"}`;
      } else if (d.type === "data" || d.type === "stack") {
        flags = `${d.writable ? "W" : "-"}`;
      }
      if (d.accessed) flags += "A";

      html += `<tr>
        <td>${d.index}</td>
        <td>${d.name}</td>
        <td><span class="seg-type-badge" style="background:${typeColor}">${d.type}</span></td>
        <td>0x${d.base.toString(16).padStart(8, "0")}</td>
        <td>0x${d.limit.toString(16)}</td>
        <td><span class="ring-badge" style="background:${ringColor}">Ring ${d.dpl}</span></td>
        <td>${present}</td>
        <td>${gran}</td>
        <td style="color:#888">${flags}</td>
      </tr>`;
    }
    html += `</table>`;
    return html;
  }

  private renderCpu(result: SimulationResult): void {
    const el = this.container.querySelector("#cpu-panel")!;
    const cpu = result.finalCpu;
    const ringColor = RING_COLORS[cpu.cpl] ?? "#555";

    let html = `<h2>CPU State</h2>`;
    html += `<div style="margin-bottom:12px;">
      <span style="color:#888;font-size:11px;">Current Privilege Level: </span>
      <span class="ring-badge" style="background:${ringColor};font-size:13px;">Ring ${cpu.cpl}</span>
    </div>`;

    // セグメントレジスタ
    html += `<div style="margin-bottom:8px;"><strong style="color:#7f8fa6;font-size:11px;">SEGMENT REGISTERS</strong></div>`;
    html += `<div style="display:flex;flex-wrap:wrap;">`;
    for (const reg of cpu.registers) {
      const selVal = encodeSelector(reg.selector);
      const ti = reg.selector.ti.toUpperCase();
      html += `<div class="reg-box">
        <span class="reg-name">${reg.name}</span>
        <span class="reg-val">0x${selVal.toString(16).padStart(4, "0")}</span>
        <span style="color:#555;font-size:9px;">[${ti}:${reg.selector.index} RPL=${reg.selector.rpl}]</span>
      </div>`;
    }
    html += `</div>`;

    // 統計
    html += `<div style="margin-top:14px;"><strong style="color:#7f8fa6;font-size:11px;">STATISTICS</strong></div>`;
    const s = result.stats;
    html += `<table>
      <tr><td>総操作数</td><td class="stat-val">${s.totalOps}</td></tr>
      <tr><td>成功アクセス</td><td class="stat-val">${s.successfulAccesses}</td></tr>
      <tr><td>#GP (General Protection)</td><td class="stat-val" style="color:${s.gpFaults > 0 ? "#e74c3c" : "#27ae60"}">${s.gpFaults}</td></tr>
      <tr><td>#SS (Stack Segment)</td><td class="stat-val" style="color:${s.ssFaults > 0 ? "#e74c3c" : "#27ae60"}">${s.ssFaults}</td></tr>
      <tr><td>#NP (Not Present)</td><td class="stat-val" style="color:${s.npFaults > 0 ? "#e74c3c" : "#27ae60"}">${s.npFaults}</td></tr>
      <tr><td>リング遷移</td><td class="stat-val">${s.ringTransitions}</td></tr>
    </table>`;

    // セレクタ構造の図
    html += `<div style="margin-top:14px;"><strong style="color:#7f8fa6;font-size:11px;">SELECTOR FORMAT (16bit)</strong></div>`;
    html += `<div style="display:flex;gap:2px;margin-top:6px;font-size:10px;">
      <div style="background:#9b59b6;color:#fff;padding:4px 8px;border-radius:2px;flex:5;">Index [15:3]</div>
      <div style="background:#e67e22;color:#fff;padding:4px 6px;border-radius:2px;flex:1;text-align:center;">TI [2]</div>
      <div style="background:#3498db;color:#fff;padding:4px 6px;border-radius:2px;flex:1;text-align:center;">RPL [1:0]</div>
    </div>`;

    el.innerHTML = html;
  }

  private renderEvents(result: SimulationResult): void {
    const el = this.container.querySelector("#events-panel")!;
    let html = `<h2>Segmentation Events (${result.events.length})</h2><div class="events-scroll">`;
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
