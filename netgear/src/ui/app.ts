import { presets, runSimulation } from "../device/index.js";
import type { SimulationResult, SimEvent, NetworkDevice } from "../device/index.js";

const LAYER_COLORS: Record<string, string> = { L1: "#ff7043", L2: "#4dd0e1", L3: "#66bb6a" };
const KIND_LABELS: Record<string, string> = {
  nic: "NIC", repeater: "リピータ", hub: "ハブ", bridge: "ブリッジ", switch: "スイッチ", router: "ルーター",
};

export class NetgearApp {
  private container!: HTMLElement;

  init(el: HTMLElement | null): void {
    if (!el) throw new Error("コンテナが見つかりません");
    this.container = el;
    this.render();
    this.runPreset(0);
  }

  private render(): void {
    this.container.innerHTML = `
      <div style="font-family:'Segoe UI',system-ui,sans-serif;background:#0a0a0f;color:#e0e0e0;min-height:100vh;padding:20px;">
        <div style="max-width:1500px;margin:0 auto;">
          <h1 style="font-size:1.5rem;margin-bottom:16px;color:#88ccff;">Network Device Simulator</h1>
          <div style="margin-bottom:20px;display:flex;align-items:center;gap:12px;">
            <label style="font-size:0.9rem;color:#aaa;">プリセット:</label>
            <select id="preset-select" style="padding:8px 12px;background:#1a1a2e;color:#e0e0e0;border:1px solid #333;border-radius:6px;font-size:0.9rem;min-width:400px;cursor:pointer;">
              ${presets.map((p, i) => `<option value="${i}">${p.name}</option>`).join("")}
            </select>
          </div>
          <p id="preset-desc" style="color:#888;font-size:0.85rem;margin-bottom:20px;"></p>
          <div id="content"></div>
        </div>
      </div>
    `;
    const select = this.container.querySelector("#preset-select") as HTMLSelectElement;
    select.addEventListener("change", () => this.runPreset(Number(select.value)));
  }

  private runPreset(index: number): void {
    const preset = presets[index];
    if (!preset) return;
    (this.container.querySelector("#preset-desc") as HTMLElement).textContent = preset.description;
    const result = runSimulation(preset.devices, preset.frames);
    this.renderResult(result);
  }

  private renderResult(result: SimulationResult): void {
    const el = this.container.querySelector("#content") as HTMLElement;
    el.innerHTML = `
      ${this.renderTopology(result.devices)}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
        <div>
          ${this.renderDevices(result.devices)}
        </div>
        <div>
          ${this.renderEvents(result.events)}
        </div>
      </div>
    `;
  }

  private card(title: string, content: string): string {
    return `<div style="background:#12121a;border:1px solid #222;border-radius:8px;padding:16px;margin-bottom:14px;">
      <h3 style="font-size:0.9rem;color:#ffcc66;margin-bottom:10px;">${title}</h3>${content}</div>`;
  }

  private renderTopology(devices: NetworkDevice[]): string {
    const items = devices.map((d) => {
      const color = LAYER_COLORS[d.layer] ?? "#888";
      const kind = KIND_LABELS[d.kind] ?? d.kind;
      const ports = d.ports.map((p) => {
        const linkColor = p.connectedTo ? "#4caf50" : "#555";
        const linkLabel = p.connectedTo ? `→ ${p.connectedTo}:${p.connectedPort}` : "未接続";
        return `<div style="font-size:0.7rem;color:#888;padding-left:12px;">
          <span style="color:${linkColor};">●</span> port${p.id} ${linkLabel}
        </div>`;
      }).join("");
      return `<div style="background:#1a1a2e;border:1px solid #333;border-radius:6px;padding:10px;min-width:140px;">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
          <span style="background:${color};color:#000;padding:1px 6px;border-radius:3px;font-size:0.65rem;font-weight:bold;">${d.layer}</span>
          <span style="font-size:0.8rem;font-weight:bold;">${d.name}</span>
        </div>
        <div style="font-size:0.72rem;color:${color};margin-bottom:4px;">${kind}</div>
        ${ports}
        ${d.ipAddresses ? Object.entries(d.ipAddresses).map(([p, ip]) => `<div style="font-size:0.7rem;color:#66bb6a;padding-left:12px;">IP: ${ip} (port${p})</div>`).join("") : ""}
      </div>`;
    }).join("");
    return this.card("トポロジー", `<div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-start;">${items}</div>`);
  }

  private renderDevices(devices: NetworkDevice[]): string {
    const tables = devices.filter((d) => d.macTable && d.macTable.length > 0).map((d) => {
      const rows = d.macTable!.map((e) => `
        <tr style="border-bottom:1px solid #1a1a30;">
          <td style="padding:3px 6px;font-family:monospace;font-size:0.72rem;">${e.mac}</td>
          <td style="padding:3px 6px;text-align:center;">${e.port}</td>
        </tr>`).join("");
      return `<div style="margin-bottom:12px;">
        <div style="font-size:0.8rem;color:#4dd0e1;margin-bottom:4px;">${d.name} MACテーブル</div>
        <table style="width:100%;border-collapse:collapse;font-size:0.75rem;">
          <thead><tr style="border-bottom:1px solid #333;color:#888;">
            <th style="padding:3px 6px;text-align:left;">MAC</th>
            <th style="padding:3px 6px;">ポート</th>
          </tr></thead><tbody>${rows}</tbody>
        </table>
      </div>`;
    }).join("");

    const routes = devices.filter((d) => d.routeTable && d.routeTable.length > 0).map((d) => {
      const rows = d.routeTable!.map((r) => `
        <tr style="border-bottom:1px solid #1a1a30;">
          <td style="padding:3px 6px;font-family:monospace;font-size:0.72rem;">${r.network}/${r.mask}</td>
          <td style="padding:3px 6px;font-family:monospace;font-size:0.72rem;">${r.gateway}</td>
          <td style="padding:3px 6px;text-align:center;">${r.iface}</td>
        </tr>`).join("");
      return `<div style="margin-bottom:12px;">
        <div style="font-size:0.8rem;color:#66bb6a;margin-bottom:4px;">${d.name} ルーティングテーブル</div>
        <table style="width:100%;border-collapse:collapse;font-size:0.75rem;">
          <thead><tr style="border-bottom:1px solid #333;color:#888;">
            <th style="padding:3px 6px;text-align:left;">宛先</th>
            <th style="padding:3px 6px;text-align:left;">ゲートウェイ</th>
            <th style="padding:3px 6px;">IF</th>
          </tr></thead><tbody>${rows}</tbody>
        </table>
      </div>`;
    }).join("");

    return this.card("デバイス状態", tables + routes || '<span style="font-size:0.8rem;color:#666;">テーブルなし</span>');
  }

  private renderEvents(events: SimEvent[]): string {
    const typeColors: Record<string, string> = {
      receive: "#78909c", signal_repeat: "#ff7043", flood: "#ff9800",
      mac_learn: "#4dd0e1", mac_lookup: "#7986cb", forward: "#4caf50",
      filter: "#ab47bc", drop: "#f44336", collision: "#ef5350",
      arp_request: "#ffca28", arp_reply: "#66bb6a", route_lookup: "#66bb6a",
      ttl_decrement: "#78909c", decapsulate: "#ce93d8", encapsulate: "#ce93d8",
      broadcast: "#ff9800", info: "#888",
    };
    const typeIcons: Record<string, string> = {
      receive: "📥", signal_repeat: "⚡", flood: "🌊",
      mac_learn: "📝", mac_lookup: "🔍", forward: "➡",
      filter: "🚫", drop: "✗", collision: "💥",
      arp_request: "❓", arp_reply: "✓", route_lookup: "🗺",
      ttl_decrement: "⏱", decapsulate: "📦", encapsulate: "📦",
      broadcast: "📡", info: "ℹ",
    };
    const items = events.map((e) => {
      const color = typeColors[e.type] ?? "#888";
      const icon = typeIcons[e.type] ?? "•";
      return `<div style="padding:4px 0;border-bottom:1px solid #111;display:flex;gap:6px;align-items:flex-start;">
        <span style="min-width:24px;color:#555;font-size:0.7rem;font-family:monospace;text-align:right;">#${e.step}</span>
        <span style="font-size:0.8rem;">${icon}</span>
        <span style="font-size:0.75rem;color:${color};">${e.description}</span>
      </div>`;
    }).join("");
    return this.card(`パケットトレース (${events.length})`, `<div style="max-height:500px;overflow-y:auto;">${items}</div>`);
  }
}
