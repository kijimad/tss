import { simulate, dissectFrame } from "../engine/ethernet.js";
import type { EthNetwork, Host, SwitchPort, SimResult, EthTrace, EthernetFrame } from "../engine/ethernet.js";

export interface Example {
  name: string;
  description: string;
  network: EthNetwork;
  srcHost: string;
  dstHost: string;
  etherType: number;
  payload: string;
}

// ── ネットワーク定義ヘルパー ──

function mkHost(name: string, mac: string, ip: string, port: number, vlan?: number): Host {
  return { name, mac, ip, port, vlan };
}

function mkPort(id: number, host: string | null, vlan = 1, mode: "access" | "trunk" = "access", stp: SwitchPort["stpState"] = "forwarding"): SwitchPort {
  return { id, host, vlan, mode, stpState: stp };
}

// ── 基本ネットワーク ──

const basicNet: EthNetwork = {
  hosts: [
    mkHost("PC-A", "00:1A:2B:3C:4D:01", "192.168.1.10", 1),
    mkHost("PC-B", "00:1A:2B:3C:4D:02", "192.168.1.20", 2),
    mkHost("PC-C", "00:1A:2B:3C:4D:03", "192.168.1.30", 3),
    mkHost("PC-D", "00:1A:2B:3C:4D:04", "192.168.1.40", 4),
  ],
  switches: [{
    name: "SW1",
    ports: [mkPort(1, "PC-A"), mkPort(2, "PC-B"), mkPort(3, "PC-C"), mkPort(4, "PC-D")],
    macTable: [],
  }],
};

const vlanNet: EthNetwork = {
  hosts: [
    mkHost("PC-Sales1", "AA:BB:CC:00:00:01", "10.10.10.1", 1, 10),
    mkHost("PC-Sales2", "AA:BB:CC:00:00:02", "10.10.10.2", 2, 10),
    mkHost("PC-Eng1", "AA:BB:CC:00:00:03", "10.20.20.1", 3, 20),
    mkHost("PC-Eng2", "AA:BB:CC:00:00:04", "10.20.20.2", 4, 20),
    mkHost("Server", "AA:BB:CC:00:00:FF", "10.10.10.100", 5, 10),
  ],
  switches: [{
    name: "SW-VLAN",
    ports: [
      mkPort(1, "PC-Sales1", 10), mkPort(2, "PC-Sales2", 10),
      mkPort(3, "PC-Eng1", 20), mkPort(4, "PC-Eng2", 20),
      mkPort(5, "Server", 10),
    ],
    macTable: [],
  }],
};

const stpNet: EthNetwork = {
  hosts: [
    mkHost("PC-X", "DD:EE:FF:00:00:01", "192.168.1.10", 1),
    mkHost("PC-Y", "DD:EE:FF:00:00:02", "192.168.1.20", 2),
    mkHost("PC-Z", "DD:EE:FF:00:00:03", "192.168.1.30", 3),
  ],
  switches: [{
    name: "SW-STP",
    ports: [
      mkPort(1, "PC-X", 1, "access", "forwarding"),
      mkPort(2, "PC-Y", 1, "access", "forwarding"),
      mkPort(3, "PC-Z", 1, "access", "blocking"),
    ],
    macTable: [],
  }],
};

const learnedNet: EthNetwork = {
  hosts: [
    mkHost("PC-A", "00:1A:2B:3C:4D:01", "192.168.1.10", 1),
    mkHost("PC-B", "00:1A:2B:3C:4D:02", "192.168.1.20", 2),
    mkHost("PC-C", "00:1A:2B:3C:4D:03", "192.168.1.30", 3),
  ],
  switches: [{
    name: "SW-Learned",
    ports: [mkPort(1, "PC-A"), mkPort(2, "PC-B"), mkPort(3, "PC-C")],
    macTable: [
      { mac: "00:1A:2B:3C:4D:02", port: 2, vlan: 1, age: 30 },
    ],
  }],
};

export const EXAMPLES: Example[] = [
  {
    name: "ユニキャスト (MAC テーブルなし → フラッディング)",
    description: "スイッチの MAC テーブルが空の状態。宛先不明のため全ポートにフラッディング (Unknown Unicast)。",
    network: JSON.parse(JSON.stringify(basicNet)),
    srcHost: "PC-A", dstHost: "PC-B", etherType: 0x0800,
    payload: "GET / HTTP/1.1\r\nHost: example.com",
  },
  {
    name: "ユニキャスト (MAC テーブルあり → 直接転送)",
    description: "宛先 MAC が既に学習済み。スイッチはピンポイントでポート 2 に転送。",
    network: JSON.parse(JSON.stringify(learnedNet)),
    srcHost: "PC-A", dstHost: "PC-B", etherType: 0x0800,
    payload: "Hello, PC-B!",
  },
  {
    name: "ブロードキャスト (ARP Request)",
    description: "ARP Request は FF:FF:FF:FF:FF:FF 宛のブロードキャスト。全ポートに配信。",
    network: JSON.parse(JSON.stringify(basicNet)),
    srcHost: "PC-A", dstHost: "broadcast", etherType: 0x0806,
    payload: "ARP: Who has 192.168.1.20? Tell 192.168.1.10",
  },
  {
    name: "802.1Q VLAN (同一 VLAN 内通信)",
    description: "VLAN 10 の Sales1 → Sales2。同じ VLAN なので転送される。Eng (VLAN 20) には届かない。",
    network: JSON.parse(JSON.stringify(vlanNet)),
    srcHost: "PC-Sales1", dstHost: "broadcast", etherType: 0x0800,
    payload: "Sales broadcast data",
  },
  {
    name: "802.1Q VLAN (異なる VLAN → フィルタ)",
    description: "VLAN 10 の Sales → VLAN 20 の Eng にユニキャスト試行。VLAN が異なるため転送されない。",
    network: JSON.parse(JSON.stringify(vlanNet)),
    srcHost: "PC-Sales1", dstHost: "PC-Eng1", etherType: 0x0800,
    payload: "Cross-VLAN attempt",
  },
  {
    name: "STP ブロッキングポート",
    description: "ポート 3 が STP Blocking 状態。PC-X → PC-Z はポート 3 がブロックされているため破棄。",
    network: JSON.parse(JSON.stringify(stpNet)),
    srcHost: "PC-Z", dstHost: "PC-X", etherType: 0x0800,
    payload: "STP blocked?",
  },
  {
    name: "最小フレーム (パディング付き)",
    description: "ペイロード 5 バイトは最小 46 バイトに満たないため、パディングが追加される。",
    network: JSON.parse(JSON.stringify(basicNet)),
    srcHost: "PC-A", dstHost: "broadcast", etherType: 0x0800,
    payload: "short",
  },
  {
    name: "IPv6 フレーム",
    description: "EtherType 0x86DD (IPv6) のフレーム。フレーム構造は同じだが EtherType が異なる。",
    network: JSON.parse(JSON.stringify(basicNet)),
    srcHost: "PC-A", dstHost: "PC-B", etherType: 0x86DD,
    payload: "IPv6 packet simulation data payload here...",
  },
];

// ── 色 ──

function phaseColor(p: EthTrace["phase"]): string {
  switch (p) {
    case "frame_build":  return "#3b82f6";
    case "preamble":     return "#64748b";
    case "csma_cd":      return "#06b6d4";
    case "collision":    return "#ef4444";
    case "backoff":      return "#f97316";
    case "transmit":     return "#22c55e";
    case "mac_learn":    return "#a78bfa";
    case "mac_lookup":   return "#f59e0b";
    case "forward":      return "#10b981";
    case "broadcast":    return "#ec4899";
    case "vlan_tag":     return "#f59e0b";
    case "vlan_filter":  return "#ef4444";
    case "stp":          return "#dc2626";
    case "receive":      return "#22c55e";
    case "drop":         return "#ef4444";
    case "fcs_check":    return "#8b5cf6";
  }
}

export class EthernetApp {
  init(container: HTMLElement): void {
    container.style.cssText = "display:flex;flex-direction:column;height:100vh;font-family:'Fira Code','Cascadia Code',monospace;background:#0f172a;color:#e2e8f0;";

    const header = document.createElement("div");
    header.style.cssText = "padding:8px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #1e293b;flex-wrap:wrap;";
    const title = document.createElement("h1");
    title.textContent = "Ethernet Simulator";
    title.style.cssText = "margin:0;font-size:15px;color:#06b6d4;";
    header.appendChild(title);

    const exSelect = document.createElement("select");
    exSelect.style.cssText = "padding:4px 8px;background:#1e293b;border:1px solid #334155;border-radius:4px;color:#f8fafc;font-size:12px;";
    for (let i = 0; i < EXAMPLES.length; i++) { const o = document.createElement("option"); o.value = String(i); o.textContent = EXAMPLES[i]!.name; exSelect.appendChild(o); }
    header.appendChild(exSelect);

    const runBtn = document.createElement("button");
    runBtn.textContent = "\u25B6 Send Frame";
    runBtn.style.cssText = "padding:4px 16px;background:#06b6d4;color:#0f172a;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;";
    header.appendChild(runBtn);

    const descSpan = document.createElement("span");
    descSpan.style.cssText = "font-size:10px;color:#64748b;margin-left:auto;max-width:400px;";
    header.appendChild(descSpan);
    container.appendChild(header);

    const main = document.createElement("div");
    main.style.cssText = "flex:1;display:flex;overflow:hidden;";

    // 左: フレーム構造
    const leftPanel = document.createElement("div");
    leftPanel.style.cssText = "width:360px;display:flex;flex-direction:column;border-right:1px solid #1e293b;overflow-y:auto;font-size:10px;";

    const frameLabel = document.createElement("div");
    frameLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#3b82f6;border-bottom:1px solid #1e293b;";
    frameLabel.textContent = "Ethernet Frame Structure";
    leftPanel.appendChild(frameLabel);
    const frameDiv = document.createElement("div");
    frameDiv.style.cssText = "padding:8px 12px;border-bottom:1px solid #1e293b;";
    leftPanel.appendChild(frameDiv);

    const macLabel = document.createElement("div");
    macLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#a78bfa;border-bottom:1px solid #1e293b;";
    macLabel.textContent = "MAC Address Table (after)";
    leftPanel.appendChild(macLabel);
    const macDiv = document.createElement("div");
    macDiv.style.cssText = "padding:8px 12px;border-bottom:1px solid #1e293b;";
    leftPanel.appendChild(macDiv);

    const netLabel = document.createElement("div");
    netLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#f59e0b;border-bottom:1px solid #1e293b;";
    netLabel.textContent = "Network Topology";
    leftPanel.appendChild(netLabel);
    const netDiv = document.createElement("div");
    netDiv.style.cssText = "flex:1;padding:8px 12px;";
    leftPanel.appendChild(netDiv);
    main.appendChild(leftPanel);

    // 右: トレース
    const rightPanel = document.createElement("div");
    rightPanel.style.cssText = "flex:1;display:flex;flex-direction:column;";
    const trLabel = document.createElement("div");
    trLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#22c55e;border-bottom:1px solid #1e293b;";
    trLabel.textContent = "Frame Processing Trace";
    rightPanel.appendChild(trLabel);
    const trDiv = document.createElement("div");
    trDiv.style.cssText = "flex:1;padding:4px 8px;font-size:9px;overflow-y:auto;line-height:1.6;";
    rightPanel.appendChild(trDiv);
    main.appendChild(rightPanel);
    container.appendChild(main);

    // ── 描画 ──

    const renderFrame = (frame: EthernetFrame) => {
      frameDiv.innerHTML = "";
      const fields = dissectFrame(frame);

      // 視覚的なフレーム図
      const barDiv = document.createElement("div");
      barDiv.style.cssText = "display:flex;margin-bottom:8px;border-radius:4px;overflow:hidden;";
      for (const f of fields) {
        const seg = document.createElement("div");
        seg.style.cssText = `flex:1;padding:2px 4px;background:${f.color}22;border-right:1px solid #1e293b;text-align:center;min-width:40px;`;
        seg.innerHTML = `<div style="color:${f.color};font-size:8px;font-weight:600;">${f.field}</div><div style="color:#94a3b8;font-size:7px;">${f.size}</div>`;
        barDiv.appendChild(seg);
      }
      frameDiv.appendChild(barDiv);

      // 詳細テーブル
      for (const f of fields) {
        const row = document.createElement("div");
        row.style.cssText = "display:flex;gap:6px;margin-bottom:2px;";
        row.innerHTML =
          `<span style="color:${f.color};font-weight:600;min-width:95px;">${f.field}</span>` +
          `<span style="color:#64748b;min-width:40px;">${f.size}</span>` +
          `<span style="color:#94a3b8;">${f.value}</span>`;
        frameDiv.appendChild(row);
      }

      const total = document.createElement("div");
      total.style.cssText = "margin-top:4px;color:#e2e8f0;font-weight:600;";
      total.textContent = `合計: ${frame.totalSize} バイト (min 64B, max 1518B${frame.vlanTag !== null ? " / 1522B with VLAN" : ""})`;
      frameDiv.appendChild(total);
    };

    const renderMacTable = (entries: SimResult["macTableAfter"]) => {
      macDiv.innerHTML = "";
      if (entries.length === 0) {
        macDiv.textContent = "(空)";
        return;
      }
      for (const e of entries) {
        const row = document.createElement("div");
        row.style.cssText = "display:flex;gap:6px;margin-bottom:2px;";
        row.innerHTML =
          `<span style="color:#3b82f6;min-width:120px;">${e.mac}</span>` +
          `<span style="color:#22c55e;">Port ${e.port}</span>` +
          `<span style="color:#f59e0b;">VLAN ${e.vlan}</span>` +
          `<span style="color:#64748b;">age=${e.age}</span>`;
        macDiv.appendChild(row);
      }
    };

    const renderNetwork = (network: EthNetwork) => {
      netDiv.innerHTML = "";
      const sw = network.switches[0]!;
      const swEl = document.createElement("div");
      swEl.style.cssText = "border:1px solid #334155;border-radius:6px;padding:8px;margin-bottom:6px;";
      swEl.innerHTML = `<div style="color:#f59e0b;font-weight:600;margin-bottom:4px;">\u{1F4E1} ${sw.name}</div>`;
      for (const port of sw.ports) {
        const host = network.hosts.find((h) => h.name === port.host);
        const stpTag = port.stpState !== "forwarding" ? ` <span style="color:#ef4444;">[${port.stpState}]</span>` : "";
        const vlanTag = port.vlan !== 1 ? ` <span style="color:#f59e0b;">VLAN${port.vlan}</span>` : "";
        swEl.innerHTML += `<div style="color:#94a3b8;margin-left:8px;">Port ${port.id}: ${host ? `\u{1F5A5} ${host.name} (${host.mac})` : "(空)"}${vlanTag}${stpTag}</div>`;
      }
      netDiv.appendChild(swEl);
    };

    const renderTrace = (trace: EthTrace[]) => {
      trDiv.innerHTML = "";
      for (const step of trace) {
        const el = document.createElement("div");
        el.style.cssText = "display:flex;gap:4px;align-items:flex-start;margin-bottom:2px;";
        const color = phaseColor(step.phase);
        el.innerHTML =
          `<span style="color:#475569;min-width:18px;">t${step.tick}</span>` +
          `<span style="min-width:72px;padding:0 3px;border-radius:2px;font-size:8px;font-weight:600;text-align:center;color:${color};background:${color}15;border:1px solid ${color}33;">${step.phase}</span>` +
          `<span style="color:#f59e0b;min-width:55px;">${step.device}</span>` +
          `<span style="color:#cbd5e1;">${step.detail}</span>`;
        trDiv.appendChild(el);
      }
    };

    // ── ロジック ──

    const loadExample = (ex: Example) => {
      descSpan.textContent = ex.description;
      renderNetwork(ex.network);
      frameDiv.innerHTML = ""; macDiv.innerHTML = ""; trDiv.innerHTML = "";
    };

    const runSim = (ex: Example) => {
      const network: EthNetwork = JSON.parse(JSON.stringify(ex.network));
      const result = simulate(network, ex.srcHost, ex.dstHost, ex.etherType, ex.payload);
      renderNetwork(network);
      if (result.frames[0]) renderFrame(result.frames[0]);
      renderMacTable(result.macTableAfter);
      renderTrace(result.trace);
    };

    exSelect.addEventListener("change", () => { const ex = EXAMPLES[Number(exSelect.value)]; if (ex) loadExample(ex); });
    runBtn.addEventListener("click", () => { const ex = EXAMPLES[Number(exSelect.value)]; if (ex) runSim(ex); });
    loadExample(EXAMPLES[0]!);
  }
}
