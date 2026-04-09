import {
  IcmpSimulator, node, routerNode, netLink,
  ICMP_TYPES, icmpTypeName,
} from "../engine/icmp.js";
import type { Topology, Scenario, SimResult, SimEvent, IcmpMessage } from "../engine/icmp.js";

export interface Experiment {
  name: string;
  description: string;
  topology: Topology;
  scenarios: Scenario[];
}

// ── トポロジー ──

const basicTopo: Topology = {
  nodes: [
    node("client", "10.0.0.10", { openPorts: [{ port: 80, proto: "tcp" }] }),
    routerNode("r1", "10.0.0.1"),
    routerNode("r2", "10.0.1.1"),
    node("server", "10.0.2.10", { openPorts: [{ port: 80, proto: "tcp" }, { port: 443, proto: "tcp" }] }),
  ],
  links: [netLink("client", "r1", 2), netLink("r1", "r2", 8), netLink("r2", "server", 2)],
};

const mtuTopo: Topology = {
  nodes: [
    node("client", "10.0.0.10"),
    routerNode("r1", "10.0.0.1"),
    routerNode("vpn-tun", "10.0.1.1", { mtu: 1280 }),
    routerNode("r2", "10.0.2.1"),
    node("server", "10.0.3.10"),
  ],
  links: [netLink("client", "r1", 2), netLink("r1", "vpn-tun", 5), netLink("vpn-tun", "r2", 5, { mtu: 1280 }), netLink("r2", "server", 2)],
};

const redirectTopo: Topology = {
  nodes: [
    node("client", "192.168.1.10"),
    routerNode("gw-old", "192.168.1.1", { redirectGateway: "192.168.1.2" }),
    routerNode("gw-new", "192.168.1.2"),
    node("server", "10.0.0.10"),
  ],
  links: [netLink("client", "gw-old", 1), netLink("gw-old", "gw-new", 1), netLink("gw-new", "server", 5), netLink("client", "gw-new", 1)],
};

const fwTopo: Topology = {
  nodes: [
    node("client", "10.0.0.10"),
    routerNode("r1", "10.0.0.1"),
    node("fw-host", "10.0.1.10", { firewall: [{ icmpType: 8, action: "drop" }, { icmpType: 13, action: "reject" }] }),
  ],
  links: [netLink("client", "r1", 2), netLink("r1", "fw-host", 3)],
};

const portUnreachTopo: Topology = {
  nodes: [
    node("client", "10.0.0.10"),
    routerNode("r1", "10.0.0.1"),
    node("server", "10.0.1.10", { openPorts: [{ port: 53, proto: "udp" }, { port: 80, proto: "tcp" }] }),
  ],
  links: [netLink("client", "r1", 2), netLink("r1", "server", 3)],
};

const longTopo: Topology = {
  nodes: [
    node("src", "10.0.0.2"),
    routerNode("r1", "10.0.1.1"), routerNode("r2", "10.0.2.1"), routerNode("r3", "10.0.3.1"),
    routerNode("r4", "10.0.4.1"), routerNode("r5", "10.0.5.1"),
    node("dst", "10.0.6.2"),
  ],
  links: [
    netLink("src", "r1", 3), netLink("r1", "r2", 5), netLink("r2", "r3", 4),
    netLink("r3", "r4", 6), netLink("r4", "r5", 8), netLink("r5", "dst", 2),
  ],
};

const silentRouterTopo: Topology = {
  nodes: [
    node("client", "10.0.0.10"),
    routerNode("r1", "10.0.0.1"),
    routerNode("silent", "10.0.1.1", { icmpEnabled: false }),
    node("server", "10.0.2.10"),
  ],
  links: [netLink("client", "r1", 2), netLink("r1", "silent", 5), netLink("silent", "server", 3)],
};

const lossyTopo: Topology = {
  nodes: [
    node("client", "10.0.0.10"),
    routerNode("r1", "10.0.0.1"),
    node("server", "10.0.1.10"),
  ],
  links: [netLink("client", "r1", 3), netLink("r1", "server", 10, { loss: 0.3 })],
};

export const EXPERIMENTS: Experiment[] = [
  {
    name: "Echo Request / Reply (Type 8→0)",
    description: "最も基本的な ICMP。Type 8 Echo Request を送信し、宛先が Type 0 Echo Reply を返す。ルーターでの TTL デクリメントも観察。",
    topology: basicTopo,
    scenarios: [{ src: "client", dstIp: "10.0.2.10", icmpType: ICMP_TYPES.ECHO_REQUEST, icmpCode: 0, ttl: 64, payloadSize: 56, df: false, count: 3 }],
  },
  {
    name: "Dest Unreachable — Network (Type 3, Code 0)",
    description: "存在しない宛先ネットワークへの送信。ルーターが経路を持たないため Type 3 Code 0 (Network Unreachable) を返す。",
    topology: basicTopo,
    scenarios: [{ src: "client", dstIp: "172.16.99.99", icmpType: ICMP_TYPES.ECHO_REQUEST, icmpCode: 0, ttl: 64, payloadSize: 56, df: false, count: 2 }],
  },
  {
    name: "Dest Unreachable — Port (Type 3, Code 3)",
    description: "閉じた UDP ポート (9999) への送信。サーバーが Type 3 Code 3 (Port Unreachable) を返す。traceroute の仕組みでもある。",
    topology: portUnreachTopo,
    scenarios: [{ src: "client", dstIp: "10.0.1.10", icmpType: ICMP_TYPES.ECHO_REQUEST, icmpCode: 0, ttl: 64, payloadSize: 56, df: false, dstPort: 9999, count: 2 }],
  },
  {
    name: "Frag Needed & DF — PMTUD (Type 3, Code 4)",
    description: "DF フラグ付き 1500B パケットが MTU=1280 のトンネルに遭遇。RFC 1191 Path MTU Discovery の核心。Next-Hop MTU がエラーに含まれる。",
    topology: mtuTopo,
    scenarios: [
      { src: "client", dstIp: "10.0.3.10", icmpType: ICMP_TYPES.ECHO_REQUEST, icmpCode: 0, ttl: 64, payloadSize: 1472, df: true, count: 1 },
      { src: "client", dstIp: "10.0.3.10", icmpType: ICMP_TYPES.ECHO_REQUEST, icmpCode: 0, ttl: 64, payloadSize: 1200, df: true, count: 1 },
    ],
  },
  {
    name: "Redirect (Type 5) — 経路最適化",
    description: "ルーターが「より良いゲートウェイ」を ICMP Redirect で通知。送信元はルーティングテーブルを更新する。",
    topology: redirectTopo,
    scenarios: [{ src: "client", dstIp: "10.0.0.10", icmpType: ICMP_TYPES.ECHO_REQUEST, icmpCode: 0, ttl: 64, payloadSize: 56, df: false, count: 2 }],
  },
  {
    name: "Time Exceeded — TTL=3 で 5 ホップ (Type 11)",
    description: "TTL が途中のルーターで 0 になり Time Exceeded (Type 11, Code 0) が返る。traceroute の原理。",
    topology: longTopo,
    scenarios: [
      { src: "src", dstIp: "10.0.6.2", icmpType: ICMP_TYPES.ECHO_REQUEST, icmpCode: 0, ttl: 3, payloadSize: 56, df: false, count: 1 },
      { src: "src", dstIp: "10.0.6.2", icmpType: ICMP_TYPES.ECHO_REQUEST, icmpCode: 0, ttl: 64, payloadSize: 56, df: false, count: 1 },
    ],
  },
  {
    name: "Timestamp Request / Reply (Type 13→14)",
    description: "Type 13 Timestamp Request で相手のシステム時刻を取得。originate/receive/transmit の 3 タイムスタンプ。",
    topology: basicTopo,
    scenarios: [{ src: "client", dstIp: "10.0.2.10", icmpType: ICMP_TYPES.TIMESTAMP_REQUEST, icmpCode: 0, ttl: 64, payloadSize: 12, df: false, count: 2 }],
  },
  {
    name: "ファイアウォールによる ICMP フィルタ",
    description: "Echo Request は DROP、Timestamp は REJECT (Admin Prohibited) される。セキュリティポリシーによる ICMP 制御。",
    topology: fwTopo,
    scenarios: [
      { src: "client", dstIp: "10.0.1.10", icmpType: ICMP_TYPES.ECHO_REQUEST, icmpCode: 0, ttl: 64, payloadSize: 56, df: false, count: 1 },
      { src: "client", dstIp: "10.0.1.10", icmpType: ICMP_TYPES.TIMESTAMP_REQUEST, icmpCode: 0, ttl: 64, payloadSize: 12, df: false, count: 1 },
    ],
  },
  {
    name: "ICMP 無効ルーター + パケットロス",
    description: "ICMP を返さないルーター (TTL 切れが silent) と 30% パケットロスの組み合わせ。障害切り分けの難しさ。",
    topology: { nodes: [...silentRouterTopo.nodes, ...lossyTopo.nodes.filter((n) => n.name === "server")], links: [...silentRouterTopo.links] },
    scenarios: [
      { src: "client", dstIp: "10.0.2.10", icmpType: ICMP_TYPES.ECHO_REQUEST, icmpCode: 0, ttl: 2, payloadSize: 56, df: false, count: 2 },
      { src: "client", dstIp: "10.0.2.10", icmpType: ICMP_TYPES.ECHO_REQUEST, icmpCode: 0, ttl: 64, payloadSize: 56, df: false, count: 3 },
    ],
  },
];

// ── 色 ──

function layerColor(layer: SimEvent["layer"]): string {
  switch (layer) { case "IP": return "#64748b"; case "ICMP": return "#3b82f6"; case "Link": return "#475569"; case "App": return "#f59e0b"; }
}
function dirColor(dir: SimEvent["direction"]): string {
  switch (dir) { case "tx": return "#22c55e"; case "rx": return "#06b6d4"; case "gen": return "#a78bfa"; case "drop": return "#ef4444"; case "info": return "#64748b"; }
}
function dirIcon(dir: SimEvent["direction"]): string {
  switch (dir) { case "tx": return "→"; case "rx": return "←"; case "gen": return "⚡"; case "drop": return "✗"; case "info": return "●"; }
}
function typeTagColor(type: number): string {
  if (type === 0 || type === 8) return "#22c55e";
  if (type === 3) return "#ef4444";
  if (type === 5) return "#f59e0b";
  if (type === 11) return "#f97316";
  if (type === 13 || type === 14) return "#a78bfa";
  return "#64748b";
}

export class IcmpApp {
  init(container: HTMLElement): void {
    container.style.cssText = "display:flex;flex-direction:column;height:100vh;font-family:'Fira Code','Cascadia Code',monospace;background:#0f172a;color:#e2e8f0;";

    const header = document.createElement("div");
    header.style.cssText = "padding:8px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #1e293b;flex-wrap:wrap;";
    const title = document.createElement("h1"); title.textContent = "ICMP Simulator"; title.style.cssText = "margin:0;font-size:15px;white-space:nowrap;";
    header.appendChild(title);
    const exSelect = document.createElement("select");
    exSelect.style.cssText = "padding:4px 8px;background:#1e293b;border:1px solid #334155;border-radius:4px;color:#f8fafc;font-size:12px;";
    for (let i = 0; i < EXPERIMENTS.length; i++) { const o = document.createElement("option"); o.value = String(i); o.textContent = EXPERIMENTS[i]!.name; exSelect.appendChild(o); }
    header.appendChild(exSelect);
    const runBtn = document.createElement("button"); runBtn.textContent = "\u25B6 Run"; runBtn.style.cssText = "padding:4px 16px;background:#e2e8f0;color:#0f172a;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;";
    header.appendChild(runBtn);
    const descSpan = document.createElement("span"); descSpan.style.cssText = "font-size:10px;color:#64748b;margin-left:auto;max-width:500px;";
    header.appendChild(descSpan);
    container.appendChild(header);

    const main = document.createElement("div"); main.style.cssText = "flex:1;display:flex;overflow:hidden;";

    // 左パネル
    const leftPanel = document.createElement("div"); leftPanel.style.cssText = "width:370px;display:flex;flex-direction:column;border-right:1px solid #1e293b;overflow-y:auto;font-size:10px;";
    const addSection = (label: string, color: string) => {
      const lbl = document.createElement("div"); lbl.style.cssText = `padding:4px 12px;font-size:11px;font-weight:600;color:${color};border-bottom:1px solid #1e293b;`; lbl.textContent = label; leftPanel.appendChild(lbl);
      const div = document.createElement("div"); div.style.cssText = "padding:8px 12px;border-bottom:1px solid #1e293b;"; leftPanel.appendChild(div); return div;
    };
    const cfgDiv = addSection("Scenarios", "#f59e0b");
    const statsDiv = addSection("Statistics", "#22c55e");
    const msgLabel = document.createElement("div"); msgLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#a78bfa;border-bottom:1px solid #1e293b;"; msgLabel.textContent = "Messages";
    leftPanel.appendChild(msgLabel);
    const msgDiv = document.createElement("div"); msgDiv.style.cssText = "flex:1;padding:4px 8px;overflow-y:auto;"; leftPanel.appendChild(msgDiv);
    main.appendChild(leftPanel);

    // 右パネル
    const rightPanel = document.createElement("div"); rightPanel.style.cssText = "flex:1;display:flex;flex-direction:column;overflow:hidden;";
    const evLabel = document.createElement("div"); evLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#3b82f6;border-bottom:1px solid #1e293b;"; evLabel.textContent = "Packet Trace";
    rightPanel.appendChild(evLabel);
    const evDiv = document.createElement("div"); evDiv.style.cssText = "flex:1;padding:4px 8px;font-size:9px;overflow-y:auto;line-height:1.7;"; rightPanel.appendChild(evDiv);
    main.appendChild(rightPanel);
    container.appendChild(main);

    const addRow = (p: HTMLElement, l: string, v: string, c: string) => { const r = document.createElement("div"); r.style.marginBottom = "2px"; r.innerHTML = `<span style="color:${c};font-weight:600;">${l}:</span> <span style="color:#94a3b8;">${v}</span>`; p.appendChild(r); };

    const renderConfig = (exp: Experiment) => {
      cfgDiv.innerHTML = "";
      addRow(cfgDiv, "ノード数", String(exp.topology.nodes.length), "#e2e8f0");
      addRow(cfgDiv, "リンク数", String(exp.topology.links.length), "#64748b");
      for (let i = 0; i < exp.scenarios.length; i++) {
        const sc = exp.scenarios[i]!;
        addRow(cfgDiv, `#${i + 1}`, `${sc.src} → ${sc.dstIp}`, "#3b82f6");
        addRow(cfgDiv, "  Type", `${sc.icmpType} (${icmpTypeName(sc.icmpType)})`, typeTagColor(sc.icmpType));
        addRow(cfgDiv, "  TTL/Size", `TTL=${sc.ttl} ${sc.payloadSize}B${sc.df ? " DF" : ""} ×${sc.count}`, "#64748b");
        if (sc.dstPort !== undefined) addRow(cfgDiv, "  Port", String(sc.dstPort), "#f97316");
      }
    };

    const renderStats = (result: SimResult) => {
      statsDiv.innerHTML = "";
      addRow(statsDiv, "送信", String(result.stats.sent), "#e2e8f0");
      addRow(statsDiv, "受信", String(result.stats.received), "#22c55e");
      addRow(statsDiv, "エラー", String(result.stats.errors), "#ef4444");
      addRow(statsDiv, "ドロップ", String(result.stats.dropped), "#f97316");
      addRow(statsDiv, "リダイレクト", String(result.stats.redirects), "#f59e0b");
      addRow(statsDiv, "総時間", `${result.totalTime}ms`, "#06b6d4");
    };

    const renderMessages = (msgs: IcmpMessage[]) => {
      msgDiv.innerHTML = "";
      for (const m of msgs) {
        const el = document.createElement("div"); el.style.cssText = "margin-bottom:4px;padding:4px 6px;background:#0a0a1e;border:1px solid #1e293b;border-radius:3px;";
        const tc = typeTagColor(m.icmpHeader.type);
        let html = `<div><span style="color:${tc};font-weight:600;">${m.label}</span> <span style="color:#475569;">${m.totalBytes}B</span></div>`;
        html += `<div style="font-size:8px;color:#64748b;">IP: ${m.ipHeader.srcIp} → ${m.ipHeader.dstIp} TTL=${m.ipHeader.ttl} proto=${m.ipHeader.protocol}${m.ipHeader.flags.df ? " DF" : ""}</div>`;
        html += `<div style="font-size:8px;color:#64748b;">ICMP: type=${m.icmpHeader.type} code=${m.icmpHeader.code} chksum=0x${m.icmpHeader.checksum.toString(16)} rest=0x${m.icmpHeader.restOfHeader.toString(16).padStart(8, "0")}</div>`;
        if (m.extra) {
          for (const [k, v] of Object.entries(m.extra)) {
            html += `<div style="font-size:8px;color:#06b6d4;">  ${k}: ${v}</div>`;
          }
        }
        el.innerHTML = html;
        msgDiv.appendChild(el);
      }
    };

    const renderEvents = (events: SimEvent[]) => {
      evDiv.innerHTML = "";
      for (const ev of events) {
        const el = document.createElement("div"); el.style.cssText = "display:flex;gap:4px;align-items:flex-start;margin-bottom:1px;";
        const dc = dirColor(ev.direction); const lc = layerColor(ev.layer);
        el.innerHTML =
          `<span style="min-width:36px;color:#475569;text-align:right;">${ev.time.toFixed(0)}</span>` +
          `<span style="color:${dc};min-width:14px;text-align:center;">${dirIcon(ev.direction)}</span>` +
          `<span style="min-width:36px;padding:0 3px;border-radius:2px;font-size:8px;font-weight:600;text-align:center;color:${lc};background:${lc}15;border:1px solid ${lc}33;">${ev.layer}</span>` +
          `<span style="color:#64748b;min-width:60px;">${ev.node}</span>` +
          `<span style="color:#cbd5e1;">${ev.detail}</span>`;
        evDiv.appendChild(el);
      }
    };

    const loadExperiment = (exp: Experiment) => { descSpan.textContent = exp.description; renderConfig(exp); statsDiv.innerHTML = '<span style="color:#475569;">▶ Run をクリック</span>'; msgDiv.innerHTML = ""; evDiv.innerHTML = ""; };
    const runSimulation = (exp: Experiment) => {
      const sim = new IcmpSimulator(exp.topology);
      const result = sim.simulate(exp.scenarios);
      renderConfig(exp); renderStats(result); renderMessages(result.messages); renderEvents(result.events);
    };

    exSelect.addEventListener("change", () => { const e = EXPERIMENTS[Number(exSelect.value)]; if (e) loadExperiment(e); });
    runBtn.addEventListener("click", () => { const e = EXPERIMENTS[Number(exSelect.value)]; if (e) runSimulation(e); });
    loadExperiment(EXPERIMENTS[0]!);
  }
}
