import { presets, runSimulation } from "../vlan/index.js";
import type { SimulationResult, Preset } from "../vlan/index.js";

/** VLAN色マップ */
const VLAN_COLORS: Record<number, string> = {
  10: "#e74c3c", 20: "#2ecc71", 30: "#3498db",
  40: "#f39c12", 50: "#9b59b6", 60: "#1abc9c",
};

function vlanColor(vid: number): string {
  return VLAN_COLORS[vid] ?? `hsl(${(vid * 47) % 360}, 65%, 55%)`;
}

export class VlanApp {
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
        .app { max-width: 1400px; margin: 0 auto; padding: 20px; }
        h1 { font-size: 20px; color: #e2e5e8; margin-bottom: 16px; }
        .controls { display: flex; gap: 12px; align-items: center; margin-bottom: 20px; }
        select { background: #1a1a2e; color: #c8ccd0; border: 1px solid #333; padding: 8px 12px;
                 border-radius: 4px; font-family: inherit; font-size: 13px; min-width: 300px; }
        .desc { color: #888; font-size: 12px; margin-bottom: 16px; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        .panel { background: #12121c; border: 1px solid #1e1e30; border-radius: 6px; padding: 14px; }
        .panel h2 { font-size: 13px; color: #7f8fa6; margin-bottom: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
        .topology { grid-column: 1 / -1; }
        table { width: 100%; border-collapse: collapse; font-size: 12px; }
        th { text-align: left; color: #7f8fa6; padding: 4px 8px; border-bottom: 1px solid #1e1e30; }
        td { padding: 4px 8px; border-bottom: 1px solid #111; }
        .vlan-badge { display: inline-block; padding: 1px 8px; border-radius: 10px; font-size: 11px;
                      color: #fff; font-weight: bold; }
        .event-row { padding: 4px 0; border-bottom: 1px solid #111; font-size: 12px; }
        .event-type { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 10px;
                      color: #fff; margin-right: 6px; min-width: 80px; text-align: center; }
        .event-type.receive { background: #2980b9; }
        .event-type.tag_add { background: #27ae60; }
        .event-type.tag_remove { background: #8e44ad; }
        .event-type.mac_learn { background: #f39c12; }
        .event-type.forward { background: #2ecc71; }
        .event-type.flood { background: #e67e22; }
        .event-type.drop { background: #e74c3c; }
        .event-type.vlan_filter { background: #c0392b; }
        .event-type.trunk_forward { background: #16a085; }
        .event-type.native_vlan { background: #2c3e50; }
        .switch-box { display: inline-block; background: #1a1a2e; border: 1px solid #333;
                      border-radius: 6px; padding: 10px 14px; margin: 6px; vertical-align: top; }
        .switch-name { font-weight: bold; color: #e2e5e8; margin-bottom: 6px; }
        .port-row { font-size: 11px; color: #aaa; padding: 2px 0; }
        .port-mode { font-size: 10px; padding: 1px 4px; border-radius: 2px; color: #fff; }
        .port-mode.access { background: #2980b9; }
        .port-mode.trunk { background: #8e44ad; }
        .host-box { display: inline-block; background: #0d1117; border: 1px solid #222;
                    border-radius: 4px; padding: 6px 10px; margin: 4px; font-size: 11px; }
        .events-scroll { max-height: 500px; overflow-y: auto; }
      </style>
      <div class="app">
        <h1>VLAN Simulator</h1>
        <div class="controls">
          <select id="preset-select">
            ${presets.map((p, i) => `<option value="${i}">${p.name}</option>`).join("")}
          </select>
        </div>
        <div class="desc" id="desc"></div>
        <div class="grid">
          <div class="panel topology" id="topology"></div>
          <div class="panel" id="mac-tables"></div>
          <div class="panel" id="events"></div>
        </div>
      </div>
    `;

    const select = this.container.querySelector("#preset-select") as HTMLSelectElement;
    select.addEventListener("change", () => this.runPreset(Number(select.value)));
    this.runPreset(0);
  }

  private runPreset(index: number): void {
    const preset = presets[index]!;
    // ディープコピーしてシミュレーション
    const switches = JSON.parse(JSON.stringify(preset.switches));
    const hosts = JSON.parse(JSON.stringify(preset.hosts));
    const result = runSimulation(switches, hosts, preset.frames);

    this.container.querySelector("#desc")!.textContent = preset.description;
    this.renderTopology(preset, result);
    this.renderMacTables(result);
    this.renderEvents(result);
  }

  private renderTopology(preset: Preset, _result: SimulationResult): void {
    const el = this.container.querySelector("#topology")!;
    let html = "<h2>Topology</h2><div>";

    for (const sw of preset.switches) {
      html += `<div class="switch-box"><div class="switch-name">🔲 ${sw.name}</div>`;
      html += `<div style="font-size:10px;color:#666;margin-bottom:4px;">VLANs: ${sw.vlans.map((v) => v.name).join(", ")}</div>`;
      for (const port of sw.ports) {
        const modeClass = port.mode;
        const modeLabel = port.mode === "access"
          ? `VLAN ${port.accessVlan}`
          : `Trunk [${port.allowedVlans.join(",")}] native=${port.nativeVlan}`;
        const link = port.link ? ` → ${port.link.deviceId}:${port.link.portId}` : "";
        html += `<div class="port-row">
          Port${port.id}: <span class="port-mode ${modeClass}">${port.mode}</span>
          ${modeLabel}${link}
        </div>`;
      }
      html += "</div>";
    }

    for (const host of preset.hosts) {
      const link = host.portLink ? ` → ${host.portLink.deviceId}:${host.portLink.portId}` : "";
      html += `<div class="host-box">💻 ${host.name} (${host.mac})${link}</div>`;
    }

    html += "</div>";
    el.innerHTML = html;
  }

  private renderMacTables(result: SimulationResult): void {
    const el = this.container.querySelector("#mac-tables")!;
    let html = "<h2>MAC Address Tables</h2>";

    for (const sw of result.switches) {
      html += `<div style="margin-bottom:12px;"><strong>${sw.name}</strong>`;
      if (sw.macTable.length === 0) {
        html += `<div style="font-size:11px;color:#555;padding:4px;">（エントリなし）</div>`;
      } else {
        html += "<table><tr><th>MAC</th><th>VLAN</th><th>Port</th></tr>";
        for (const entry of sw.macTable) {
          html += `<tr>
            <td style="font-family:monospace;">${entry.mac}</td>
            <td><span class="vlan-badge" style="background:${vlanColor(entry.vlan)}">${entry.vlan}</span></td>
            <td>${entry.port}</td>
          </tr>`;
        }
        html += "</table>";
      }
      html += "</div>";
    }

    el.innerHTML = html;
  }

  private renderEvents(result: SimulationResult): void {
    const el = this.container.querySelector("#events")!;
    let html = "<h2>Event Log</h2><div class=\"events-scroll\">";

    for (const ev of result.events) {
      const vlanBadge = ev.vlan != null
        ? ` <span class="vlan-badge" style="background:${vlanColor(ev.vlan)};font-size:10px;">V${ev.vlan}</span>`
        : "";
      html += `<div class="event-row">
        <span style="color:#555;font-size:10px;">[${ev.step}]</span>
        <span class="event-type ${ev.type}">${ev.type}</span>
        <strong>${ev.device}</strong>${ev.port != null ? `:${ev.port}` : ""}${vlanBadge}
        <span style="color:#888;"> ${ev.description}</span>
      </div>`;
    }

    html += "</div>";
    el.innerHTML = html;
  }
}
