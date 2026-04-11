import { presets, runSimulation } from "../igw/index.js";
import type { SimulationResult, Preset, Vpc } from "../igw/index.js";

const EVENT_COLORS: Record<string, string> = {
  packet_create: "#3498db", route_lookup: "#95a5a6", route_match: "#2ecc71",
  route_no_match: "#e74c3c", igw_receive: "#1abc9c", igw_nat_outbound: "#e67e22",
  igw_nat_inbound: "#9b59b6", igw_no_public_ip: "#c0392b", igw_forward_internet: "#1abc9c",
  igw_receive_internet: "#16a085", nat_gw_translate: "#f39c12", subnet_forward: "#2980b9",
  deliver: "#27ae60", drop: "#e74c3c", igw_detached: "#7f8c8d", igw_attach: "#2ecc71",
  igw_detach: "#e74c3c",
};

export class IgwApp {
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
                 border-radius: 4px; font-family: inherit; font-size: 13px; min-width: 350px; }
        .desc { color: #888; font-size: 12px; margin-bottom: 16px; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        .panel { background: #12121c; border: 1px solid #1e1e30; border-radius: 6px; padding: 14px; }
        .panel h2 { font-size: 13px; color: #7f8fa6; margin-bottom: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
        .full { grid-column: 1 / -1; }
        .topo { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 12px;
                background: #000; border-radius: 4px; }
        .topo-box { border: 1px solid #333; border-radius: 4px; padding: 8px 12px; text-align: center; font-size: 11px; }
        .topo-box.internet { border-color: #1abc9c; color: #1abc9c; }
        .topo-box.igw { border-color: #e67e22; color: #e67e22; }
        .topo-box.nat { border-color: #f39c12; color: #f39c12; }
        .topo-box.subnet { border-color: #2980b9; }
        .topo-box.subnet.public { border-color: #27ae60; }
        .topo-box.subnet.private { border-color: #e67e22; }
        .topo-arrow { color: #555; font-size: 16px; }
        .inst-line { font-size: 10px; color: #aaa; }
        table { width: 100%; border-collapse: collapse; font-size: 11px; }
        th { text-align: left; color: #7f8fa6; padding: 4px 6px; border-bottom: 1px solid #1e1e30; }
        td { padding: 4px 6px; border-bottom: 1px solid #111; }
        .event-row { padding: 5px 0; border-bottom: 1px solid #111; font-size: 12px; }
        .event-type { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 10px;
                      color: #fff; margin-right: 6px; min-width: 110px; text-align: center; }
        .nat-arrow { color: #e67e22; font-weight: bold; }
        .result-badge { display: inline-block; padding: 4px 12px; border-radius: 4px; font-size: 13px;
                        color: #fff; font-weight: bold; margin-bottom: 8px; }
        .result-ok { background: #27ae60; }
        .result-ng { background: #e74c3c; }
        .events-scroll { max-height: 550px; overflow-y: auto; }
      </style>
      <div class="app">
        <h1>Internet Gateway Simulator</h1>
        <div class="controls">
          <select id="preset-select">
            ${presets.map((p, i) => `<option value="${i}">${p.name}</option>`).join("")}
          </select>
        </div>
        <div class="desc" id="desc"></div>
        <div class="grid">
          <div class="panel full" id="topology"></div>
          <div class="panel" id="nat-table"></div>
          <div class="panel" id="route-tables"></div>
          <div class="panel full" id="events"></div>
        </div>
      </div>
    `;
    const select = this.container.querySelector("#preset-select") as HTMLSelectElement;
    select.addEventListener("change", () => this.runPreset(Number(select.value)));
    this.runPreset(0);
  }

  private runPreset(index: number): void {
    const preset = presets[index]!;
    const vpc: Vpc = JSON.parse(JSON.stringify(preset.vpc));
    const result = runSimulation(vpc, preset.packets);
    this.container.querySelector("#desc")!.textContent = preset.description;
    this.renderTopology(preset);
    this.renderNatTable(result);
    this.renderRouteTables(preset, result);
    this.renderEvents(result);
  }

  private renderTopology(preset: Preset): void {
    const el = this.container.querySelector("#topology")!;
    const vpc = preset.vpc;
    let html = "<h2>Network Topology</h2><div class=\"topo\">";
    html += `<div class="topo-box internet">🌐 Internet</div>`;
    html += `<span class="topo-arrow">⟷</span>`;
    if (vpc.igw) {
      const stateColor = vpc.igw.state === "attached" ? "#27ae60" : "#e74c3c";
      html += `<div class="topo-box igw">🚪 ${vpc.igw.name}<br><span style="font-size:9px;color:${stateColor}">${vpc.igw.state}</span></div>`;
      html += `<span class="topo-arrow">⟷</span>`;
    }
    if (vpc.natGateways.length > 0) {
      for (const nat of vpc.natGateways) {
        html += `<div class="topo-box nat">🔄 ${nat.name}<br><span style="font-size:9px;">${nat.publicIp}</span></div>`;
      }
      html += `<span class="topo-arrow">⟷</span>`;
    }
    for (const sub of vpc.subnets) {
      const cls = sub.isPublic ? "public" : "private";
      const label = sub.isPublic ? "🟢 Public" : "🟠 Private";
      const insts = vpc.instances.filter((i) => i.subnetId === sub.id);
      html += `<div class="topo-box subnet ${cls}">
        ${label}: ${sub.name}<br><span style="font-size:9px;color:#666;">${sub.cidr}</span>`;
      for (const inst of insts) {
        const pubIp = inst.publicIp ? ` / ${inst.publicIp}` : "";
        html += `<div class="inst-line">💻 ${inst.name}: ${inst.privateIp}${pubIp}</div>`;
      }
      html += "</div>";
    }
    html += "</div>";
    el.innerHTML = html;
  }

  private renderNatTable(result: SimulationResult): void {
    const el = this.container.querySelector("#nat-table")!;
    const badge = result.delivered
      ? `<div class="result-badge result-ok">DELIVERED</div>`
      : `<div class="result-badge result-ng">DROPPED</div>`;
    let html = `<h2>IGW NAT Table</h2>${badge}`;
    if (result.natTable.length === 0) {
      html += `<div style="font-size:12px;color:#555;">（NAT変換なし）</div>`;
    } else {
      html += "<table><tr><th>Direction</th><th>Original</th><th></th><th>Translated</th></tr>";
      for (const entry of result.natTable) {
        if (entry.direction === "outbound") {
          html += `<tr><td>→ OUT</td><td>src: ${entry.originalSrc}</td>
            <td class="nat-arrow">→</td><td>src: ${entry.translatedSrc}</td></tr>`;
        } else {
          html += `<tr><td>← IN</td><td>dst: ${entry.originalDst}</td>
            <td class="nat-arrow">→</td><td>${entry.description}</td></tr>`;
        }
      }
      html += "</table>";
    }
    el.innerHTML = html;
  }

  private renderRouteTables(preset: Preset, _result: SimulationResult): void {
    const el = this.container.querySelector("#route-tables")!;
    let html = "<h2>Route Tables</h2>";
    for (const rt of preset.vpc.routeTables) {
      html += `<div style="margin-bottom:10px;"><strong>${rt.name}</strong>`;
      html += "<table><tr><th>Destination</th><th>Target</th><th>Type</th></tr>";
      for (const route of rt.routes) {
        const color = route.targetType === "igw" ? "#1abc9c" : route.targetType === "nat" ? "#f39c12"
          : route.targetType === "blackhole" ? "#e74c3c" : "#888";
        html += `<tr><td>${route.destination}</td><td>${route.target}</td>
          <td style="color:${color}">${route.targetType}</td></tr>`;
      }
      html += "</table></div>";
    }
    el.innerHTML = html;
  }

  private renderEvents(result: SimulationResult): void {
    const el = this.container.querySelector("#events")!;
    let html = "<h2>Packet Flow</h2><div class=\"events-scroll\">";
    for (const ev of result.events) {
      const color = EVENT_COLORS[ev.type] ?? "#555";
      const natInfo = ev.natEntry ? ` <span class="nat-arrow">[NAT: ${ev.natEntry.description}]</span>` : "";
      html += `<div class="event-row">
        <span style="color:#444;font-size:10px;">[${ev.step}]</span>
        <span class="event-type" style="background:${color}">${ev.type}</span>
        <strong style="color:#aaa;">${ev.resource}</strong>
        <span style="color:#888;"> ${ev.description}</span>${natInfo}
      </div>`;
    }
    html += "</div>";
    el.innerHTML = html;
  }
}
