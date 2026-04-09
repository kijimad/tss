import { ArpSimulator, createHost, segment } from "../engine/arp.js";
import type { Topology, Scenario, SimResult, SimEvent, ArpCacheEntry } from "../engine/arp.js";

export interface Experiment { name: string; description: string; topology: Topology; scenarios: Scenario[]; }

const lanHosts = [
  createHost("PC-A", "192.168.1.10", "aa:aa:aa:00:00:01", { gateway: "192.168.1.1" }),
  createHost("PC-B", "192.168.1.20", "bb:bb:bb:00:00:02", { gateway: "192.168.1.1" }),
  createHost("PC-C", "192.168.1.30", "cc:cc:cc:00:00:03", { gateway: "192.168.1.1" }),
  createHost("Router", "192.168.1.1", "00:11:22:33:44:55"),
];
const lanSeg = segment("LAN", ["PC-A", "PC-B", "PC-C", "Router"]);

export const EXPERIMENTS: Experiment[] = [
  {
    name: "ARP Request / Reply — 基本解決",
    description: "PC-A が PC-B の MAC を知らない状態で通信を試みる。ARP Request (ブロードキャスト) → Reply (ユニキャスト) の基本フロー。",
    topology: { hosts: lanHosts, segments: [lanSeg] },
    scenarios: [
      { name: "PC-A → PC-B の MAC 解決", action: { type: "resolve", from: "PC-A", targetIp: "192.168.1.20" } },
    ],
  },
  {
    name: "ARP キャッシュヒット",
    description: "既にキャッシュにエントリがある場合は ARP パケットを送信せずにキャッシュから解決する。",
    topology: {
      hosts: [
        createHost("PC-A", "192.168.1.10", "aa:aa:aa:00:00:01", { arpCache: [{ ip: "192.168.1.20", mac: "bb:bb:bb:00:00:02", type: "dynamic", createdAt: 0, expiresAt: 30000 }] }),
        createHost("PC-B", "192.168.1.20", "bb:bb:bb:00:00:02"),
      ],
      segments: [segment("LAN", ["PC-A", "PC-B"])],
    },
    scenarios: [
      { name: "PC-A → PC-B (キャッシュヒット)", action: { type: "resolve", from: "PC-A", targetIp: "192.168.1.20" } },
    ],
  },
  {
    name: "Gratuitous ARP — IP/MAC 通知",
    description: "ホストが自分の IP/MAC をブロードキャスト。IP アドレス変更時、NIC 交換後、フェイルオーバー時に使用。全ホストのキャッシュが更新される。",
    topology: {
      hosts: [
        createHost("Server", "192.168.1.100", "ee:ee:ee:00:00:01"),
        createHost("PC-A", "192.168.1.10", "aa:aa:aa:00:00:01", { arpCache: [{ ip: "192.168.1.100", mac: "old:old:old:00:00:01", type: "dynamic", createdAt: 0, expiresAt: 30000 }] }),
        createHost("PC-B", "192.168.1.20", "bb:bb:bb:00:00:02"),
      ],
      segments: [segment("LAN", ["Server", "PC-A", "PC-B"])],
    },
    scenarios: [
      { name: "Server が Gratuitous ARP を送信 (NIC 交換後)", action: { type: "gratuitous", from: "Server" } },
    ],
  },
  {
    name: "ARP Probe — 重複アドレス検出 (DAD)",
    description: "DHCP で IP を取得後、ARP Probe (srcIP=0.0.0.0) を送信して重複を確認。競合がなければ IP を使用開始。",
    topology: { hosts: lanHosts, segments: [lanSeg] },
    scenarios: [
      { name: "未使用 IP (192.168.1.99) を Probe", action: { type: "probe", from: "PC-A", targetIp: "192.168.1.99" } },
      { name: "使用中 IP (192.168.1.20) を Probe → 競合検出", action: { type: "probe", from: "PC-A", targetIp: "192.168.1.20" } },
    ],
  },
  {
    name: "Proxy ARP — 異サブネット代理応答",
    description: "ルーターが他のサブネットの IP に対して自身の MAC で代理応答。サブネットを跨いだ通信を L2 レベルで実現。",
    topology: {
      hosts: [
        createHost("PC-A", "192.168.1.10", "aa:aa:aa:00:00:01", { gateway: "192.168.1.1" }),
        createHost("Router", "192.168.1.1", "00:11:22:33:44:55", { proxyArp: true, proxySubnets: ["10.0.0.0"], mask: "255.255.0.0" }),
      ],
      segments: [segment("LAN", ["PC-A", "Router"])],
    },
    scenarios: [
      { name: "PC-A → 10.0.0.50 (異サブネット → Proxy ARP 応答)", action: { type: "resolve", from: "PC-A", targetIp: "10.0.0.50" } },
    ],
  },
  {
    name: "ARP スプーフィング (MITM 攻撃)",
    description: "攻撃者がゲートウェイの IP に偽の MAC を紐づける偽 ARP Reply を送信。被害者のキャッシュが汚染される。",
    topology: {
      hosts: [
        createHost("Victim", "192.168.1.10", "aa:aa:aa:00:00:01", { arpCache: [{ ip: "192.168.1.1", mac: "00:11:22:33:44:55", type: "dynamic", createdAt: 0, expiresAt: 30000 }] }),
        createHost("Gateway", "192.168.1.1", "00:11:22:33:44:55"),
        createHost("Attacker", "192.168.1.99", "ee:ee:ee:00:00:ff"),
      ],
      segments: [segment("LAN", ["Victim", "Gateway", "Attacker"])],
    },
    scenarios: [
      { name: "攻撃者が GW の IP を詐称", action: { type: "spoof", attacker: "Attacker", victimIp: "192.168.1.1", spoofedMac: "ee:ee:ee:00:00:ff", targetIp: "192.168.1.10" } },
    ],
  },
  {
    name: "ARP スプーフィング防御 (Dynamic ARP Inspection)",
    description: "DAI 有効ホストは不正な ARP パケットを破棄。acceptArp=false で簡易的に DAI を模擬する。",
    topology: {
      hosts: [
        createHost("Victim", "192.168.1.10", "aa:aa:aa:00:00:01", { acceptArp: false, arpCache: [{ ip: "192.168.1.1", mac: "00:11:22:33:44:55", type: "static", createdAt: 0, expiresAt: 999999 }] }),
        createHost("Gateway", "192.168.1.1", "00:11:22:33:44:55", { acceptArp: false }),
        createHost("Attacker", "192.168.1.99", "ee:ee:ee:00:00:ff"),
      ],
      segments: [segment("LAN", ["Victim", "Gateway", "Attacker"])],
    },
    scenarios: [
      { name: "攻撃試行 → DAI で DROP", action: { type: "spoof", attacker: "Attacker", victimIp: "192.168.1.1", spoofedMac: "ee:ee:ee:00:00:ff", targetIp: "192.168.1.10" } },
    ],
  },
  {
    name: "キャッシュエージング & フラッシュ",
    description: "ARP キャッシュの TTL 切れとフラッシュ。エントリの有効期限を超えると自動削除され、再度 ARP が必要になる。",
    topology: {
      hosts: [
        createHost("PC-A", "192.168.1.10", "aa:aa:aa:00:00:01", { arpTimeout: 100, arpCache: [{ ip: "192.168.1.20", mac: "bb:bb:bb:00:00:02", type: "dynamic", createdAt: 0, expiresAt: 100 }, { ip: "192.168.1.1", mac: "00:11:22:33:44:55", type: "static", createdAt: 0, expiresAt: 999999 }] }),
        createHost("PC-B", "192.168.1.20", "bb:bb:bb:00:00:02"),
      ],
      segments: [segment("LAN", ["PC-A", "PC-B"])],
    },
    scenarios: [
      { name: "時間経過 → dynamic エントリが期限切れ", action: { type: "age", time: 150 } },
      { name: "ARP キャッシュフラッシュ", action: { type: "flush", host: "PC-A" } },
      { name: "再度 ARP 解決が必要", action: { type: "resolve", from: "PC-A", targetIp: "192.168.1.20" } },
    ],
  },
  {
    name: "複数ホスト連続解決",
    description: "PC-A が 3 台の MAC を順番に解決。各 ARP Request/Reply でキャッシュが構築される過程を観察。",
    topology: { hosts: lanHosts, segments: [lanSeg] },
    scenarios: [
      { name: "PC-A → PC-B", action: { type: "resolve", from: "PC-A", targetIp: "192.168.1.20" } },
      { name: "PC-A → PC-C", action: { type: "resolve", from: "PC-A", targetIp: "192.168.1.30" } },
      { name: "PC-A → Router (GW)", action: { type: "resolve", from: "PC-A", targetIp: "192.168.1.1" } },
    ],
  },
];

// ── 色 ──
const LC: Record<string, string> = { Ethernet: "#475569", ARP: "#3b82f6", Cache: "#22c55e", Security: "#ef4444", Info: "#64748b" };
const TI: Record<string, string> = { tx: "→", rx: "←", update: "✎", expire: "⏱", drop: "✗", info: "●", warning: "⚠" };

export class ArpApp {
  init(container: HTMLElement): void {
    container.style.cssText = "display:flex;flex-direction:column;height:100vh;font-family:'Fira Code','Cascadia Code',monospace;background:#0f172a;color:#e2e8f0;";
    const header = document.createElement("div"); header.style.cssText = "padding:8px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #1e293b;flex-wrap:wrap;";
    const title = document.createElement("h1"); title.textContent = "ARP Simulator"; title.style.cssText = "margin:0;font-size:15px;white-space:nowrap;"; header.appendChild(title);
    const exSelect = document.createElement("select"); exSelect.style.cssText = "padding:4px 8px;background:#1e293b;border:1px solid #334155;border-radius:4px;color:#f8fafc;font-size:12px;";
    for (let i = 0; i < EXPERIMENTS.length; i++) { const o = document.createElement("option"); o.value = String(i); o.textContent = EXPERIMENTS[i]!.name; exSelect.appendChild(o); }
    header.appendChild(exSelect);
    const runBtn = document.createElement("button"); runBtn.textContent = "\u25B6 Run"; runBtn.style.cssText = "padding:4px 16px;background:#e2e8f0;color:#0f172a;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;"; header.appendChild(runBtn);
    const descSpan = document.createElement("span"); descSpan.style.cssText = "font-size:10px;color:#64748b;margin-left:auto;max-width:500px;"; header.appendChild(descSpan);
    container.appendChild(header);

    const main = document.createElement("div"); main.style.cssText = "flex:1;display:flex;overflow:hidden;";
    const leftPanel = document.createElement("div"); leftPanel.style.cssText = "width:370px;display:flex;flex-direction:column;border-right:1px solid #1e293b;overflow-y:auto;font-size:10px;";
    const ms = (l: string, c: string) => { const lb = document.createElement("div"); lb.style.cssText = `padding:4px 12px;font-size:11px;font-weight:600;color:${c};border-bottom:1px solid #1e293b;`; lb.textContent = l; leftPanel.appendChild(lb); const d = document.createElement("div"); d.style.cssText = "padding:8px 12px;border-bottom:1px solid #1e293b;"; leftPanel.appendChild(d); return d; };
    const cfgDiv = ms("Hosts", "#f59e0b");
    const statsDiv = ms("Stats", "#22c55e");
    const cacheLabel = document.createElement("div"); cacheLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#06b6d4;border-bottom:1px solid #1e293b;"; cacheLabel.textContent = "ARP Caches"; leftPanel.appendChild(cacheLabel);
    const cacheDiv = document.createElement("div"); cacheDiv.style.cssText = "flex:1;padding:4px 8px;overflow-y:auto;font-size:9px;"; leftPanel.appendChild(cacheDiv);
    main.appendChild(leftPanel);

    const rightPanel = document.createElement("div"); rightPanel.style.cssText = "flex:1;display:flex;flex-direction:column;overflow:hidden;";
    const evLabel = document.createElement("div"); evLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#3b82f6;border-bottom:1px solid #1e293b;"; evLabel.textContent = "Packet Trace"; rightPanel.appendChild(evLabel);
    const evDiv = document.createElement("div"); evDiv.style.cssText = "flex:1;padding:4px 8px;font-size:9px;overflow-y:auto;line-height:1.7;"; rightPanel.appendChild(evDiv);
    main.appendChild(rightPanel); container.appendChild(main);

    const addRow = (p: HTMLElement, l: string, v: string, c: string) => { const r = document.createElement("div"); r.style.marginBottom = "2px"; r.innerHTML = `<span style="color:${c};font-weight:600;">${l}:</span> <span style="color:#94a3b8;">${v}</span>`; p.appendChild(r); };

    const renderConfig = (e: Experiment) => { cfgDiv.innerHTML = ""; for (const h of e.topology.hosts) addRow(cfgDiv, h.name, `${h.iface.ip} (${h.iface.mac})${h.proxyArp ? " [Proxy]" : ""}${!h.acceptArp ? " [DAI]" : ""}`, "#e2e8f0"); };
    const renderStats = (r: SimResult) => { statsDiv.innerHTML = ""; addRow(statsDiv, "Requests", String(r.stats.requests), "#3b82f6"); addRow(statsDiv, "Replies", String(r.stats.replies), "#22c55e"); addRow(statsDiv, "Gratuitous", String(r.stats.gratuitous), "#f59e0b"); addRow(statsDiv, "Proxy", String(r.stats.proxyReplies), "#a78bfa"); addRow(statsDiv, "Dropped", String(r.stats.dropped), "#ef4444"); };
    const renderCaches = (caches: Map<string, ArpCacheEntry[]>) => {
      cacheDiv.innerHTML = "";
      for (const [name, entries] of caches) {
        const h = document.createElement("div"); h.style.cssText = "color:#06b6d4;font-weight:600;margin:4px 0 2px;"; h.textContent = `${name} (${entries.length})`; cacheDiv.appendChild(h);
        if (entries.length === 0) { const e = document.createElement("div"); e.style.cssText = "margin-left:8px;color:#475569;"; e.textContent = "(empty)"; cacheDiv.appendChild(e); continue; }
        for (const e of entries) {
          const r = document.createElement("div"); r.style.cssText = `margin-left:8px;color:${e.type === "static" ? "#f59e0b" : e.type === "incomplete" ? "#ef4444" : "#94a3b8"};`;
          r.textContent = `${e.ip} → ${e.mac} [${e.type}]`;
          cacheDiv.appendChild(r);
        }
      }
    };
    const renderEvents = (events: SimEvent[]) => {
      evDiv.innerHTML = "";
      for (const ev of events) {
        const el = document.createElement("div"); el.style.cssText = "display:flex;gap:4px;align-items:flex-start;margin-bottom:1px;";
        const lc = LC[ev.layer] ?? "#94a3b8";
        el.innerHTML = `<span style="min-width:30px;color:#475569;text-align:right;">${ev.time}</span><span style="color:${ev.type === "drop" || ev.type === "warning" ? "#ef4444" : "#94a3b8"};min-width:14px;">${TI[ev.type] ?? "●"}</span><span style="min-width:50px;padding:0 3px;border-radius:2px;font-size:8px;font-weight:600;text-align:center;color:${lc};background:${lc}15;border:1px solid ${lc}33;">${ev.layer}</span><span style="color:#64748b;min-width:50px;">${ev.host}</span><span style="color:#cbd5e1;">${ev.detail}</span>`;
        evDiv.appendChild(el);
        if (ev.frame) {
          const d = document.createElement("div"); d.style.cssText = "margin:1px 0 3px 100px;padding:2px 6px;background:#0a0a1e;border:1px solid #1e293b;border-radius:2px;font-size:8px;color:#475569;";
          const p = ev.frame.payload;
          d.textContent = `[${p.oper}] SHA=${p.sha} SPA=${p.spa} THA=${p.tha} TPA=${p.tpa}`;
          evDiv.appendChild(d);
        }
      }
    };

    const load = (e: Experiment) => { descSpan.textContent = e.description; renderConfig(e); statsDiv.innerHTML = '<span style="color:#475569;">▶ Run</span>'; cacheDiv.innerHTML = ""; evDiv.innerHTML = ""; };
    const run = (e: Experiment) => {
      const topo: Topology = { hosts: e.topology.hosts.map((h) => ({ ...h, iface: { ...h.iface }, arpCache: h.arpCache.map((c) => ({ ...c })) })), segments: e.topology.segments };
      const sim = new ArpSimulator(topo); const r = sim.simulate(e.scenarios);
      renderConfig(e); renderStats(r); renderCaches(r.caches); renderEvents(r.events);
    };
    exSelect.addEventListener("change", () => { const e = EXPERIMENTS[Number(exSelect.value)]; if (e) load(e); });
    runBtn.addEventListener("click", () => { const e = EXPERIMENTS[Number(exSelect.value)]; if (e) run(e); });
    load(EXPERIMENTS[0]!);
  }
}
