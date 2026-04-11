import { presets, runSimulation } from "../tunnel/index.js";
import type { SimulationResult, Preset, Packet } from "../tunnel/index.js";

/** プロトコル色 */
const PROTO_COLORS: Record<string, string> = {
  IPIP: "#e74c3c", GRE: "#2ecc71", "6in4": "#3498db",
  GRE6: "#9b59b6", IPsec: "#f39c12",
};

/** イベント色 */
const EVENT_COLORS: Record<string, string> = {
  originate: "#3498db", encapsulate: "#e67e22", add_outer_ip: "#e67e22",
  add_gre: "#2ecc71", add_esp: "#f39c12", encrypt: "#f1c40f",
  route: "#95a5a6", transit: "#7f8c8d", decapsulate: "#9b59b6",
  remove_outer_ip: "#9b59b6", remove_gre: "#1abc9c", remove_esp: "#e74c3c",
  decrypt: "#f1c40f", deliver: "#2ecc71", ttl_expire: "#e74c3c",
  mtu_exceed: "#c0392b", fragment: "#d35400",
};

export class IpTunnelApp {
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
        .tunnel-info { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 8px; }
        .info-item { font-size: 12px; }
        .info-label { color: #666; }
        .info-value { color: #e2e5e8; font-weight: bold; }
        .proto-badge { display: inline-block; padding: 2px 10px; border-radius: 4px;
                       font-size: 12px; color: #fff; font-weight: bold; }
        .topo-diagram { background: #000; border-radius: 4px; padding: 16px; font-size: 11px;
                        overflow-x: auto; white-space: nowrap; }
        .topo-node { display: inline-block; background: #1a1a2e; border: 1px solid #333;
                     border-radius: 4px; padding: 6px 10px; margin: 4px 2px; vertical-align: middle; }
        .topo-node.endpoint { border-color: #e67e22; }
        .topo-node.host { border-color: #3498db; }
        .topo-link { display: inline-block; color: #555; vertical-align: middle; margin: 0 2px; }
        .packet-viz { background: #000; border-radius: 4px; padding: 12px; margin-bottom: 8px; }
        .pkt-layer { display: inline-block; padding: 4px 8px; border-radius: 3px; margin: 2px;
                     font-size: 11px; color: #fff; }
        .pkt-outer { background: #e67e22; }
        .pkt-gre { background: #2ecc71; }
        .pkt-esp { background: #f39c12; }
        .pkt-inner { background: #3498db; }
        .pkt-payload { background: #555; }
        .event-row { padding: 6px 0; border-bottom: 1px solid #111; font-size: 12px; }
        .event-type { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 10px;
                      color: #fff; margin-right: 6px; min-width: 90px; text-align: center; }
        .event-node { color: #aaa; font-weight: bold; margin-right: 6px; }
        .event-hex { font-size: 10px; color: #666; font-style: italic; display: block; margin-top: 2px; }
        .events-scroll { max-height: 600px; overflow-y: auto; }
      </style>
      <div class="app">
        <h1>IP Tunneling Simulator</h1>
        <div class="controls">
          <select id="preset-select">
            ${presets.map((p, i) => `<option value="${i}">${p.name}</option>`).join("")}
          </select>
        </div>
        <div class="desc" id="desc"></div>
        <div class="grid">
          <div class="panel full" id="tunnel-info"></div>
          <div class="panel full" id="topology"></div>
          <div class="panel" id="packet-viz"></div>
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
    const result = runSimulation(preset);
    this.container.querySelector("#desc")!.textContent = preset.description;
    this.renderTunnelInfo(preset, result);
    this.renderTopology(preset);
    this.renderPacketViz(result);
    this.renderEvents(result);
  }

  private renderTunnelInfo(_preset: Preset, result: SimulationResult): void {
    const el = this.container.querySelector("#tunnel-info")!;
    const t = result.tunnelConfig;
    const color = PROTO_COLORS[t.protocol] ?? "#888";
    el.innerHTML = `
      <h2>Tunnel Configuration</h2>
      <div class="tunnel-info">
        <div class="info-item"><span class="info-label">Protocol: </span>
          <span class="proto-badge" style="background:${color}">${t.protocol}</span></div>
        <div class="info-item"><span class="info-label">Name: </span><span class="info-value">${t.name}</span></div>
        <div class="info-item"><span class="info-label">Local EP: </span><span class="info-value">${t.localEndpoint}</span></div>
        <div class="info-item"><span class="info-label">Remote EP: </span><span class="info-value">${t.remoteEndpoint}</span></div>
        <div class="info-item"><span class="info-label">Inner Src: </span><span class="info-value">${t.localInner}</span></div>
        <div class="info-item"><span class="info-label">Inner Dst: </span><span class="info-value">${t.remoteInner}</span></div>
        <div class="info-item"><span class="info-label">MTU: </span><span class="info-value">${t.mtu}</span></div>
        ${t.greKey !== undefined ? `<div class="info-item"><span class="info-label">GRE Key: </span><span class="info-value">${t.greKey}</span></div>` : ""}
      </div>
    `;
  }

  private renderTopology(preset: Preset): void {
    const el = this.container.querySelector("#topology")!;
    let html = "<h2>Network Topology</h2><div class=\"topo-diagram\">";
    for (let i = 0; i < preset.nodes.length; i++) {
      const node = preset.nodes[i]!;
      const cls = node.type === "tunnel-endpoint" ? "endpoint" : node.type === "host" ? "host" : "";
      const icon = node.type === "host" ? "💻" : node.type === "tunnel-endpoint" ? "🔒" : "🔀";
      const addrs = node.interfaces.map((f) => `${f.name}:${f.address}`).join(", ");
      html += `<span class="topo-node ${cls}">${icon} ${node.name}<br><span style="font-size:9px;color:#666;">${addrs}</span></span>`;
      if (i < preset.nodes.length - 1) {
        const link = preset.links[i];
        const label = link?.label ?? "";
        html += `<span class="topo-link">──${label ? `[${label}]` : ""}──▶</span>`;
      }
    }
    html += "</div>";
    el.innerHTML = html;
  }

  private renderPacketViz(result: SimulationResult): void {
    const el = this.container.querySelector("#packet-viz")!;
    let html = "<h2>Packet Structure</h2>";

    // カプセル化後のパケット構造を表示
    const encapEvent = result.events.find((e) =>
      e.type === "encapsulate" && e.packet.outerIp,
    );
    if (encapEvent) {
      html += this.renderPacketDiagram(encapEvent.packet, "カプセル化後");
    }

    // デカプセル化後
    const decapEvent = [...result.events].reverse().find((e) =>
      e.type === "decapsulate" && !e.packet.outerIp,
    );
    if (decapEvent) {
      html += this.renderPacketDiagram(decapEvent.packet, "デカプセル化後");
    }

    // オーバーヘッド計算
    if (encapEvent?.packet.outerIp) {
      const outer = encapEvent.packet.outerIp.totalLen;
      const inner = encapEvent.packet.innerIp.totalLen;
      const overhead = outer - inner;
      html += `<div style="margin-top:8px;font-size:12px;">
        <span class="info-label">オーバーヘッド: </span>
        <span class="info-value">${overhead} bytes</span>
        (外側 ${outer}B − 内側 ${inner}B)
      </div>`;
    }

    el.innerHTML = html;
  }

  private renderPacketDiagram(pkt: Packet, label: string): string {
    let html = `<div style="font-size:11px;color:#888;margin:4px 0;">${label}:</div><div class="packet-viz">`;
    if (pkt.outerIp) {
      html += `<span class="pkt-layer pkt-outer">外側IP (${pkt.outerIp.src}→${pkt.outerIp.dst}, proto=${pkt.outerIp.protocol})</span>`;
    }
    if (pkt.greHeader) {
      const keyStr = pkt.greHeader.keyPresent ? ` key=${pkt.greHeader.key}` : "";
      html += `<span class="pkt-layer pkt-gre">GRE (0x${pkt.greHeader.protocolType.toString(16)}${keyStr})</span>`;
    }
    if (pkt.espHeader) {
      html += `<span class="pkt-layer pkt-esp">ESP (SPI=0x${pkt.espHeader.spi.toString(16)})</span>`;
    }
    html += `<span class="pkt-layer pkt-inner">内側IP (${pkt.innerIp.src}→${pkt.innerIp.dst})</span>`;
    html += `<span class="pkt-layer pkt-payload">Payload (${pkt.payloadSize}B)</span>`;
    html += "</div>";
    return html;
  }

  private renderEvents(result: SimulationResult): void {
    const el = this.container.querySelector("#events")!;
    let html = "<h2>Event Log</h2><div class=\"events-scroll\">";

    for (const ev of result.events) {
      const color = EVENT_COLORS[ev.type] ?? "#555";
      html += `<div class="event-row">
        <span style="color:#444;font-size:10px;">[${ev.step}]</span>
        <span class="event-type" style="background:${color}">${ev.type}</span>
        <span class="event-node">${ev.node}</span>
        <span style="color:#aaa;">${ev.description}</span>
        ${ev.headerBytes ? `<span class="event-hex">${ev.headerBytes}</span>` : ""}
      </div>`;
    }

    html += "</div>";
    el.innerHTML = html;
  }
}
