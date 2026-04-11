import { presets, runSimulation, multicastIpToMac } from "../udpmcast/index.js";
import type { SimulationResult } from "../udpmcast/index.js";

const EVENT_COLORS: Record<string, string> = {
  host_add: "#7f8c8d", router_add: "#7f8c8d",
  igmp_join: "#27ae60", igmp_report: "#2ecc71", igmp_leave: "#e74c3c",
  igmp_query: "#f39c12", igmp_query_response: "#e67e22",
  group_membership_update: "#9b59b6",
  udp_send: "#3498db", udp_deliver: "#2ecc71", udp_drop: "#e74c3c",
  multicast_resolve: "#8e44ad", multicast_forward: "#1abc9c",
  ttl_decrement: "#7f8c8d", ttl_expire: "#c0392b",
  scope_check: "#16a085",
  unicast_send: "#2980b9", unicast_deliver: "#27ae60",
};

export class UdpMcastApp {
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
                      color: #fff; margin-right: 6px; min-width: 140px; text-align: center; }
        .events-scroll { max-height: 500px; overflow-y: auto; }
        .stat-val { color: #f39c12; font-weight: bold; }
        .badge { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 9px; color: #fff; }
        .group-badge { background: #9b59b6; }
        .host-badge { background: #3498db; }
        .mac-badge { background: #555; font-family: inherit; }
        .member-tag { display: inline-block; padding: 1px 5px; border-radius: 2px; font-size: 9px;
                      background: #1a1a2e; color: #c8ccd0; margin: 1px; border: 1px solid #333; }
        .arrow { color: #555; margin: 0 4px; }
      </style>
      <div class="app">
        <h1>UDP Multicast Simulator</h1>
        <div class="controls">
          <select id="preset-select">
            ${presets.map((p, i) => `<option value="${i}">${p.name}</option>`).join("")}
          </select>
        </div>
        <div class="desc" id="desc"></div>
        <div class="grid">
          <div class="panel" id="group-panel"></div>
          <div class="panel" id="stats-panel"></div>
          <div class="panel full" id="topology-panel"></div>
          <div class="panel full" id="datagrams-panel"></div>
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
    this.renderGroups(result);
    this.renderStats(result);
    this.renderTopology(result);
    this.renderDatagrams(result);
    this.renderEvents(result);
  }

  private renderGroups(result: SimulationResult): void {
    const el = this.container.querySelector("#group-panel")!;
    let html = `<h2>Multicast Group Table</h2>`;
    const groups = Object.entries(result.groupTable);
    if (groups.length === 0) {
      html += `<div style="color:#555;font-size:11px;">アクティブなグループなし</div>`;
    } else {
      html += `<table><tr><th>Group IP</th><th>MAC</th><th>Members</th></tr>`;
      for (const [group, members] of groups) {
        const mac = multicastIpToMac(group);
        html += `<tr>
          <td><span class="badge group-badge">${group}</span></td>
          <td><span class="badge mac-badge">${mac}</span></td>
          <td>${members.map((m) => {
            const host = result.hosts.find((h) => h.ip === m);
            return `<span class="member-tag">${host?.name ?? m} (${m})</span>`;
          }).join(" ")}</td>
        </tr>`;
      }
      html += `</table>`;
    }
    el.innerHTML = html;
  }

  private renderStats(result: SimulationResult): void {
    const el = this.container.querySelector("#stats-panel")!;
    const s = result.stats;
    el.innerHTML = `<h2>Statistics</h2>
      <table>
        <tr><td>総データグラム</td><td class="stat-val">${s.totalDatagrams}</td></tr>
        <tr><td>マルチキャスト</td><td class="stat-val">${s.multicastDatagrams}</td></tr>
        <tr><td>ユニキャスト</td><td class="stat-val">${s.unicastDatagrams}</td></tr>
        <tr><td>配送成功</td><td class="stat-val" style="color:#27ae60">${s.deliveredCount}</td></tr>
        <tr><td>破棄</td><td class="stat-val" style="color:${s.droppedCount > 0 ? "#e74c3c" : "#27ae60"}">${s.droppedCount}</td></tr>
        <tr><td>IGMPメッセージ</td><td class="stat-val">${s.igmpMessages}</td></tr>
        <tr><td>TTL期限切れ</td><td class="stat-val" style="color:${s.ttlExpired > 0 ? "#e67e22" : "#27ae60"}">${s.ttlExpired}</td></tr>
      </table>
      <div style="margin-top:14px;">
        <div style="color:#7f8fa6;font-size:10px;text-transform:uppercase;margin-bottom:6px;">Multicast Address Ranges</div>
        <div style="font-size:10px;color:#888;line-height:1.6;">
          <div><span style="color:#16a085;">224.0.0.0/24</span> — Link-Local (TTL=1)</div>
          <div><span style="color:#f39c12;">224.0.1.0-238.255.255.255</span> — Global</div>
          <div><span style="color:#9b59b6;">239.0.0.0/8</span> — Site-Local (TTL≤32)</div>
          <div><span style="color:#3498db;">232.0.0.0/8</span> — SSM (Source-Specific)</div>
        </div>
      </div>`;
  }

  private renderTopology(result: SimulationResult): void {
    const el = this.container.querySelector("#topology-panel")!;
    let html = `<h2>Network Topology</h2>`;
    html += `<div style="display:flex;gap:24px;flex-wrap:wrap;">`;

    // ホスト一覧
    html += `<div style="flex:1;min-width:200px;">
      <div style="color:#7f8fa6;font-size:10px;text-transform:uppercase;margin-bottom:6px;">Hosts (${result.hosts.length})</div>`;
    for (const host of result.hosts) {
      html += `<div style="background:#0d0d18;border:1px solid #1e1e30;border-radius:4px;padding:8px;margin-bottom:6px;">
        <div style="font-size:12px;"><span class="badge host-badge">${host.name}</span> <span style="color:#888">${host.ip}</span></div>
        <div style="font-size:10px;color:#555;margin-top:2px;">iface: ${host.iface}</div>
        <div style="font-size:10px;margin-top:4px;">
          ${host.joinedGroups.length > 0
            ? host.joinedGroups.map((g) => `<span class="badge group-badge">${g}</span>`).join(" ")
            : `<span style="color:#555;">グループ未参加</span>`}
        </div>
      </div>`;
    }
    html += `</div>`;

    // ルーター一覧
    if (result.routers.length > 0) {
      html += `<div style="flex:1;min-width:200px;">
        <div style="color:#7f8fa6;font-size:10px;text-transform:uppercase;margin-bottom:6px;">Routers (${result.routers.length})</div>`;
      for (const router of result.routers) {
        html += `<div style="background:#0d0d18;border:1px solid #1e1e30;border-radius:4px;padding:8px;margin-bottom:6px;">
          <div style="font-size:12px;"><span style="color:#e67e22;font-weight:bold;">${router.name}</span> <span style="color:#888">${router.ip}</span></div>`;
        for (const iface of router.interfaces) {
          html += `<div style="margin-top:4px;padding-left:8px;border-left:2px solid #333;">
            <div style="font-size:10px;color:#7f8fa6;">${iface.name} (${iface.ip})</div>`;
          for (const g of iface.groups) {
            html += `<div style="font-size:9px;margin-top:2px;">
              <span class="badge group-badge">${g.group}</span>
              <span style="color:#555;">members=[${g.members.join(", ")}] timer=${g.timer}s</span>
            </div>`;
          }
          html += `</div>`;
        }
        html += `</div>`;
      }
      html += `</div>`;
    }

    html += `</div>`;
    el.innerHTML = html;
  }

  private renderDatagrams(result: SimulationResult): void {
    const el = this.container.querySelector("#datagrams-panel")!;
    if (result.datagrams.length === 0) {
      el.innerHTML = `<h2>UDP Datagrams</h2><div style="color:#555;font-size:11px;">データグラムなし</div>`;
      return;
    }
    let html = `<h2>UDP Datagrams (${result.datagrams.length})</h2>`;
    html += `<table><tr><th>#</th><th>Type</th><th>Src</th><th>Dst</th><th>TTL</th><th>Size</th><th>Payload</th></tr>`;
    for (let i = 0; i < result.datagrams.length; i++) {
      const d = result.datagrams[i]!;
      const typeColor = d.isMulticast ? "#9b59b6" : "#3498db";
      const typeLabel = d.isMulticast ? "MCAST" : "UCAST";
      html += `<tr>
        <td style="color:#555">${i + 1}</td>
        <td><span class="badge" style="background:${typeColor}">${typeLabel}</span></td>
        <td>${d.srcAddr.ip}:${d.srcAddr.port}</td>
        <td>${d.dstAddr.ip}:${d.dstAddr.port}</td>
        <td>${d.ttl}</td>
        <td>${d.payloadSize}B</td>
        <td style="color:#888;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${d.payload}</td>
      </tr>`;
    }
    html += `</table>`;
    el.innerHTML = html;
  }

  private renderEvents(result: SimulationResult): void {
    const el = this.container.querySelector("#events-panel")!;
    let html = `<h2>Events (${result.events.length})</h2><div class="events-scroll">`;
    for (const ev of result.events) {
      const color = EVENT_COLORS[ev.type] ?? "#555";
      let arrow = "";
      if (ev.from && ev.to) {
        arrow = `<span style="color:#888;font-size:10px;margin-right:6px;">${ev.from} <span class="arrow">→</span> ${ev.to}</span>`;
      }
      html += `<div class="event-row">
        <span style="color:#444;font-size:10px;">[${ev.step}]</span>
        <span class="event-type" style="background:${color}">${ev.type}</span>
        ${arrow}
        <span style="color:#888;">${ev.description}</span>
      </div>`;
    }
    html += `</div>`;
    el.innerHTML = html;
  }
}
