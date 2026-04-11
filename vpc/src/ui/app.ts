import { presets, runSimulation } from "../vpc/index.js";
import type { SimulationResult, Preset, Vpc, Subnet } from "../vpc/index.js";

/** イベント色 */
const EVENT_COLORS: Record<string, string> = {
  packet_create: "#3498db", route_lookup: "#95a5a6", route_match: "#2ecc71",
  route_no_match: "#e74c3c", nacl_evaluate: "#f39c12", nacl_allow: "#27ae60",
  nacl_deny: "#c0392b", sg_evaluate: "#9b59b6", sg_allow: "#2ecc71",
  sg_deny: "#e74c3c", igw_forward: "#1abc9c", nat_translate: "#e67e22",
  peering_forward: "#8e44ad", subnet_forward: "#2980b9", deliver: "#27ae60",
  drop: "#e74c3c",
};

export class VpcApp {
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
        .vpc-box { border: 2px solid #2980b9; border-radius: 8px; padding: 12px; margin-bottom: 12px; background: #0d1117; }
        .vpc-title { color: #3498db; font-weight: bold; font-size: 14px; margin-bottom: 8px; }
        .subnet-row { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
        .subnet-box { border: 1px solid #333; border-radius: 4px; padding: 8px; min-width: 200px; flex: 1; }
        .subnet-box.public { border-color: #27ae60; }
        .subnet-box.private { border-color: #e67e22; }
        .subnet-name { font-weight: bold; font-size: 12px; }
        .subnet-name.public { color: #27ae60; }
        .subnet-name.private { color: #e67e22; }
        .subnet-info { font-size: 10px; color: #666; }
        .instance { background: #1a1a2e; border-radius: 3px; padding: 4px 6px; margin-top: 4px; font-size: 11px; }
        .instance-name { color: #e2e5e8; }
        .instance-ip { color: #888; }
        .gw-row { display: flex; gap: 8px; margin-top: 8px; font-size: 11px; }
        .gw-badge { padding: 2px 8px; border-radius: 3px; color: #fff; }
        .gw-igw { background: #1abc9c; }
        .gw-nat { background: #e67e22; }
        .gw-peer { background: #8e44ad; }
        table { width: 100%; border-collapse: collapse; font-size: 11px; }
        th { text-align: left; color: #7f8fa6; padding: 3px 6px; border-bottom: 1px solid #1e1e30; }
        td { padding: 3px 6px; border-bottom: 1px solid #111; }
        .event-row { padding: 6px 0; border-bottom: 1px solid #111; font-size: 12px; }
        .event-type { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 10px;
                      color: #fff; margin-right: 6px; min-width: 95px; text-align: center; }
        .result-badge { display: inline-block; padding: 4px 12px; border-radius: 4px; font-size: 13px;
                        color: #fff; font-weight: bold; margin-bottom: 8px; }
        .result-ok { background: #27ae60; }
        .result-ng { background: #e74c3c; }
        .events-scroll { max-height: 600px; overflow-y: auto; }
      </style>
      <div class="app">
        <h1>VPC Simulator</h1>
        <div class="controls">
          <select id="preset-select">
            ${presets.map((p, i) => `<option value="${i}">${p.name}</option>`).join("")}
          </select>
        </div>
        <div class="desc" id="desc"></div>
        <div class="grid">
          <div class="panel full" id="topology"></div>
          <div class="panel" id="route-tables"></div>
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
    const vpcs = JSON.parse(JSON.stringify(preset.vpcs));
    const result = runSimulation(vpcs, preset.packets);
    this.container.querySelector("#desc")!.textContent = preset.description;
    this.renderTopology(preset);
    this.renderRouteTables(preset, result);
    this.renderEvents(result);
  }

  private renderTopology(preset: Preset): void {
    const el = this.container.querySelector("#topology")!;
    let html = "<h2>VPC Topology</h2>";
    for (const vpc of preset.vpcs) {
      html += this.renderVpc(vpc);
    }
    el.innerHTML = html;
  }

  private renderVpc(vpc: Vpc): string {
    let html = `<div class="vpc-box">
      <div class="vpc-title">☁️ ${vpc.name} (${vpc.cidr})</div>
      <div class="subnet-row">`;
    for (const sub of vpc.subnets) {
      html += this.renderSubnet(sub);
    }
    html += "</div><div class=\"gw-row\">";
    if (vpc.igw) html += `<span class="gw-badge gw-igw">🌐 ${vpc.igw.name}</span>`;
    for (const nat of vpc.natGateways) {
      html += `<span class="gw-badge gw-nat">🔄 ${nat.name} (${nat.publicIp})</span>`;
    }
    for (const peer of vpc.peeringConnections) {
      html += `<span class="gw-badge gw-peer">🔗 ${peer.name}</span>`;
    }
    html += "</div></div>";
    return html;
  }

  private renderSubnet(sub: Subnet): string {
    const cls = sub.isPublic ? "public" : "private";
    const label = sub.isPublic ? "Public" : "Private";
    let html = `<div class="subnet-box ${cls}">
      <div class="subnet-name ${cls}">${label}: ${sub.name}</div>
      <div class="subnet-info">${sub.cidr} | ${sub.az} | RT: ${sub.routeTableId}</div>`;
    for (const inst of sub.instances) {
      const pubIp = inst.publicIp ? ` / ${inst.publicIp}` : "";
      html += `<div class="instance">
        <span class="instance-name">💻 ${inst.name}</span>
        <span class="instance-ip">${inst.privateIp}${pubIp}</span>
        <span style="font-size:9px;color:#666;"> [${inst.securityGroups.map((s) => s.name).join(",")}]</span>
      </div>`;
    }
    html += "</div>";
    return html;
  }

  private renderRouteTables(preset: Preset, result: SimulationResult): void {
    const el = this.container.querySelector("#route-tables")!;
    let html = "<h2>Route Tables & Security</h2>";

    const badge = result.delivered
      ? `<div class="result-badge result-ok">DELIVERED</div>`
      : `<div class="result-badge result-ng">DROPPED</div>`;
    html += badge;

    for (const vpc of preset.vpcs) {
      for (const rt of vpc.routeTables) {
        html += `<div style="margin-bottom:10px;"><strong>${rt.name}</strong>`;
        html += "<table><tr><th>Destination</th><th>Target</th><th>Type</th></tr>";
        for (const route of rt.routes) {
          html += `<tr><td>${route.destination}</td><td>${route.target}</td><td>${route.targetType}</td></tr>`;
        }
        html += "</table></div>";
      }
      for (const acl of vpc.networkAcls) {
        html += `<div style="margin-bottom:10px;"><strong>${acl.name}</strong> <span style="font-size:10px;color:#666;">[${acl.subnetIds.join(",")}]</span>`;
        html += "<table><tr><th>#</th><th>Proto</th><th>Ports</th><th>CIDR</th><th>Action</th></tr>";
        for (const rule of acl.inboundRules) {
          const actionColor = rule.action === "allow" ? "#27ae60" : "#e74c3c";
          html += `<tr><td>${rule.ruleNumber}</td><td>${rule.protocol}</td><td>${rule.fromPort}-${rule.toPort}</td>
            <td>${rule.cidr}</td><td style="color:${actionColor}">${rule.action}</td></tr>`;
        }
        html += "</table></div>";
      }
    }
    el.innerHTML = html;
  }

  private renderEvents(result: SimulationResult): void {
    const el = this.container.querySelector("#events")!;
    let html = "<h2>Packet Flow</h2><div class=\"events-scroll\">";
    for (const ev of result.events) {
      const color = EVENT_COLORS[ev.type] ?? "#555";
      html += `<div class="event-row">
        <span style="color:#444;font-size:10px;">[${ev.step}]</span>
        <span class="event-type" style="background:${color}">${ev.type}</span>
        <strong style="color:#aaa;">${ev.resource}</strong>
        <span style="color:#888;"> ${ev.description}</span>
      </div>`;
    }
    html += "</div>";
    el.innerHTML = html;
  }
}
