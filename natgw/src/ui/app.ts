import { presets, runSimulation } from "../natgw/index.js";
import type { SimulationResult, Preset, Vpc } from "../natgw/index.js";

const EVENT_COLORS: Record<string, string> = {
  packet_create: "#3498db", route_lookup: "#95a5a6", route_match: "#2ecc71",
  route_no_match: "#e74c3c", nat_gw_receive: "#e67e22", nat_gw_snat: "#f39c12",
  nat_gw_port_alloc: "#9b59b6", nat_gw_forward: "#1abc9c", nat_gw_reverse: "#16a085",
  nat_gw_dnat: "#8e44ad", nat_gw_conn_limit: "#c0392b", nat_gw_port_exhaust: "#c0392b",
  nat_gw_state_error: "#7f8c8d", nat_gw_idle_timeout: "#95a5a6",
  igw_forward: "#1abc9c", igw_receive: "#16a085",
  deliver: "#27ae60", drop: "#e74c3c", local_route: "#2980b9", response_arrive: "#3498db",
};

export class NatGwApp {
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
                 border-radius: 4px; font-family: inherit; font-size: 13px; min-width: 400px; }
        .desc { color: #888; font-size: 12px; margin-bottom: 16px; line-height: 1.5; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        .panel { background: #12121c; border: 1px solid #1e1e30; border-radius: 6px; padding: 14px; }
        .panel h2 { font-size: 13px; color: #7f8fa6; margin-bottom: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
        .full { grid-column: 1 / -1; }
        .topo { display: flex; align-items: flex-start; gap: 8px; flex-wrap: wrap; padding: 12px;
                background: #000; border-radius: 4px; }
        .topo-box { border: 1px solid #333; border-radius: 4px; padding: 8px 12px; text-align: center; font-size: 11px; min-width: 100px; }
        .topo-box.internet { border-color: #1abc9c; color: #1abc9c; }
        .topo-box.igw { border-color: #2ecc71; color: #2ecc71; }
        .topo-box.natgw { border-color: #f39c12; color: #f39c12; }
        .topo-box.subnet { border-color: #2980b9; }
        .topo-box.subnet.public { border-color: #27ae60; }
        .topo-box.subnet.private { border-color: #e67e22; }
        .topo-arrow { color: #555; font-size: 16px; align-self: center; }
        .inst-line { font-size: 10px; color: #aaa; }
        .az-group { border: 1px dashed #333; border-radius: 4px; padding: 8px; margin: 4px; }
        .az-label { font-size: 9px; color: #555; margin-bottom: 4px; }
        table { width: 100%; border-collapse: collapse; font-size: 11px; }
        th { text-align: left; color: #7f8fa6; padding: 4px 6px; border-bottom: 1px solid #1e1e30; }
        td { padding: 4px 6px; border-bottom: 1px solid #111; }
        .event-row { padding: 5px 0; border-bottom: 1px solid #111; font-size: 12px; }
        .event-type { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 10px;
                      color: #fff; margin-right: 6px; min-width: 130px; text-align: center; }
        .nat-arrow { color: #f39c12; font-weight: bold; }
        .result-badge { display: inline-block; padding: 4px 12px; border-radius: 4px; font-size: 13px;
                        color: #fff; font-weight: bold; margin-bottom: 8px; }
        .result-ok { background: #27ae60; }
        .result-ng { background: #e74c3c; }
        .port-bar { height: 8px; border-radius: 4px; background: #1e1e30; margin-top: 6px; }
        .port-bar-fill { height: 100%; border-radius: 4px; background: #f39c12; transition: width .3s; }
        .timeout-info { font-size: 10px; color: #888; margin-top: 4px; }
        .events-scroll { max-height: 550px; overflow-y: auto; }
      </style>
      <div class="app">
        <h1>NAT Gateway Simulator</h1>
        <div class="controls">
          <select id="preset-select">
            ${presets.map((p, i) => `<option value="${i}">${p.name}</option>`).join("")}
          </select>
        </div>
        <div class="desc" id="desc"></div>
        <div class="grid">
          <div class="panel full" id="topology"></div>
          <div class="panel" id="nat-table"></div>
          <div class="panel" id="port-usage"></div>
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
    this.renderPortUsage(preset, result);
    this.renderEvents(result);
  }

  private renderTopology(preset: Preset): void {
    const el = this.container.querySelector("#topology")!;
    const vpc = preset.vpc;

    // AZでグループ化
    const azs = [...new Set(vpc.subnets.map((s) => s.az))];

    let html = "<h2>Network Topology</h2><div class=\"topo\">";
    html += `<div class="topo-box internet">🌐 Internet</div>`;
    html += `<span class="topo-arrow">⟷</span>`;
    html += `<div class="topo-box igw">🚪 ${vpc.igw.name}</div>`;
    html += `<span class="topo-arrow">⟷</span>`;

    for (const az of azs) {
      const azSubnets = vpc.subnets.filter((s) => s.az === az);
      const azNats = vpc.natGateways.filter((n) => azSubnets.some((s) => s.id === n.subnetId));

      html += `<div class="az-group"><div class="az-label">${az}</div>`;

      // NAT GW
      for (const nat of azNats) {
        html += `<div class="topo-box natgw">🔄 ${nat.name}<br>
          <span style="font-size:9px;">${nat.eip.publicIp}</span><br>
          <span style="font-size:8px;color:${nat.state === "available" ? "#27ae60" : "#e74c3c"}">${nat.state}</span>
        </div>`;
      }

      // サブネット
      for (const sub of azSubnets) {
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
    }
    html += "</div>";
    el.innerHTML = html;
  }

  private renderNatTable(result: SimulationResult): void {
    const el = this.container.querySelector("#nat-table")!;
    const badge = result.delivered
      ? `<div class="result-badge result-ok">DELIVERED</div>`
      : `<div class="result-badge result-ng">DROPPED</div>`;

    let html = `<h2>NAT Mapping Table</h2>${badge}`;
    if (result.natMappings.length === 0) {
      html += `<div style="font-size:12px;color:#555;">（NATマッピングなし）</div>`;
    } else {
      html += `<table>
        <tr><th>Proto</th><th>Internal</th><th></th><th>External</th><th>Destination</th><th>Timeout</th></tr>`;
      for (const m of result.natMappings) {
        html += `<tr>
          <td>${m.protocol.toUpperCase()}</td>
          <td>${m.internalIp}:${m.internalPort}</td>
          <td class="nat-arrow">→</td>
          <td>${m.externalIp}:${m.externalPort}</td>
          <td>${m.destinationIp}:${m.destinationPort}</td>
          <td class="timeout-info">${m.idleTimeoutSec}s</td>
        </tr>`;
      }
      html += "</table>";
    }
    el.innerHTML = html;
  }

  private renderPortUsage(preset: Preset, result: SimulationResult): void {
    const el = this.container.querySelector("#port-usage")!;
    let html = "<h2>Port Usage & Route Tables</h2>";

    // ポート使用状況
    for (const nat of preset.vpc.natGateways) {
      const used = result.natMappings.filter((m) => m.externalIp === nat.eip.publicIp).length;
      const pct = nat.maxConnections > 0 ? Math.min((used / nat.maxConnections) * 100, 100) : 0;
      const barColor = pct > 80 ? "#e74c3c" : pct > 50 ? "#f39c12" : "#27ae60";
      html += `<div style="margin-bottom:12px;">
        <strong>${nat.name}</strong> (${nat.eip.publicIp})
        <div style="font-size:11px;color:#888;">接続: ${used} / ${nat.maxConnections} | 帯域: ${nat.bandwidthGbps} Gbps</div>
        <div class="port-bar"><div class="port-bar-fill" style="width:${Math.max(pct, 1)}%;background:${barColor}"></div></div>
      </div>`;
    }

    // ルートテーブル
    html += `<div style="margin-top:14px;">`;
    for (const rt of preset.vpc.routeTables) {
      html += `<div style="margin-bottom:10px;"><strong>${rt.name}</strong>`;
      html += "<table><tr><th>Destination</th><th>Target</th><th>Type</th></tr>";
      for (const route of rt.routes) {
        const color = route.targetType === "nat" ? "#f39c12" : route.targetType === "igw" ? "#1abc9c"
          : route.targetType === "blackhole" ? "#e74c3c" : "#888";
        html += `<tr><td>${route.destination}</td><td>${route.target}</td>
          <td style="color:${color}">${route.targetType}</td></tr>`;
      }
      html += "</table></div>";
    }
    html += "</div>";
    el.innerHTML = html;
  }

  private renderEvents(result: SimulationResult): void {
    const el = this.container.querySelector("#events")!;
    let html = "<h2>Packet Flow</h2><div class=\"events-scroll\">";
    for (const ev of result.events) {
      const color = EVENT_COLORS[ev.type] ?? "#555";
      const mappingInfo = ev.mapping
        ? ` <span class="nat-arrow">[${ev.mapping.internalIp}:${ev.mapping.internalPort} ↔ ${ev.mapping.externalIp}:${ev.mapping.externalPort}]</span>`
        : "";
      html += `<div class="event-row">
        <span style="color:#444;font-size:10px;">[${ev.step}]</span>
        <span class="event-type" style="background:${color}">${ev.type}</span>
        <strong style="color:#aaa;">${ev.resource}</strong>
        <span style="color:#888;"> ${ev.description}</span>${mappingInfo}
      </div>`;
    }
    html += "</div>";
    el.innerHTML = html;
  }
}
