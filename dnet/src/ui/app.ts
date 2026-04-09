import { DockerNetSimulator, createNetwork, createContainer, netConfig } from "../engine/dnet.js";
import type { SimConfig, SimResult, SimEvent, DockerNetwork, Container } from "../engine/dnet.js";

export interface Experiment { name: string; description: string; config: SimConfig; }

// ── プリセット ──

export const EXPERIMENTS: Experiment[] = [
  {
    name: "bridge — 基本コンテナ間通信",
    description: "デフォルト bridge ネットワーク上の 2 コンテナ。veth ペア→docker0→veth の経路でパケットが転送される。",
    config: {
      networks: [createNetwork("my-net", "bridge", "172.18.0.0/16", "172.18.0.1", { bridgeName: "br-my-net" })],
      containers: [
        createContainer("web", "nginx:latest", [netConfig("my-net", "172.18.0.2", "172.18.0.1", ["web"])], { ports: [{ hostPort: 8080, containerPort: 80, protocol: "tcp" }] }),
        createContainer("app", "node:22", [netConfig("my-net", "172.18.0.3", "172.18.0.1", ["app"])]),
      ],
      packetFlows: [
        { from: "app", to: "web", dstPort: 80, protocol: "tcp", external: false },
        { from: "web", to: "app", dstPort: 3000, protocol: "tcp", external: false },
      ],
      dnsQueries: [
        { name: "web", type: "A", fromContainer: "app" },
        { name: "app", type: "A", fromContainer: "web" },
      ],
    },
  },
  {
    name: "bridge — ポートマッピング & NAT",
    description: "コンテナのポートをホストに公開。DNAT (外部→コンテナ) と MASQUERADE (コンテナ→外部) の iptables ルールを観察。",
    config: {
      networks: [createNetwork("web-net", "bridge", "172.19.0.0/16", "172.19.0.1", { bridgeName: "br-web" })],
      containers: [
        createContainer("nginx", "nginx:latest", [netConfig("web-net", "172.19.0.2", "172.19.0.1")], { ports: [{ hostPort: 80, containerPort: 80, protocol: "tcp" }, { hostPort: 443, containerPort: 443, protocol: "tcp" }] }),
      ],
      packetFlows: [
        { from: "nginx", to: "8.8.8.8", dstPort: 443, protocol: "tcp", external: true },
      ],
      dnsQueries: [],
    },
  },
  {
    name: "internal ネットワーク (外部遮断)",
    description: "internal=true のネットワーク。コンテナ同士は通信可能だが、外部 (インターネット) への通信は iptables で DROP される。",
    config: {
      networks: [createNetwork("secure-net", "bridge", "172.20.0.0/16", "172.20.0.1", { internal: true, bridgeName: "br-secure" })],
      containers: [
        createContainer("db", "postgres:16", [netConfig("secure-net", "172.20.0.2", "172.20.0.1", ["db"])]),
        createContainer("api", "node:22", [netConfig("secure-net", "172.20.0.3", "172.20.0.1", ["api"])]),
      ],
      packetFlows: [
        { from: "api", to: "db", dstPort: 5432, protocol: "tcp", external: false },
        { from: "api", to: "registry.npmjs.org", dstPort: 443, protocol: "tcp", external: true },
      ],
      dnsQueries: [{ name: "db", type: "A", fromContainer: "api" }],
    },
  },
  {
    name: "ICC 無効 (コンテナ分離)",
    description: "icc=false の bridge ネットワーク。同一ブリッジ上でもコンテナ間の直接通信が iptables DOCKER-ISOLATION チェーンで DROP される。",
    config: {
      networks: [createNetwork("isolated", "bridge", "172.21.0.0/16", "172.21.0.1", { icc: false, bridgeName: "br-isolated" })],
      containers: [
        createContainer("svc-a", "app:1.0", [netConfig("isolated", "172.21.0.2", "172.21.0.1")]),
        createContainer("svc-b", "app:1.0", [netConfig("isolated", "172.21.0.3", "172.21.0.1")]),
      ],
      packetFlows: [
        { from: "svc-a", to: "svc-b", dstPort: 8080, protocol: "tcp", external: false },
      ],
      dnsQueries: [],
    },
  },
  {
    name: "マルチネットワーク接続",
    description: "1 つのコンテナが 2 つのネットワークに接続。フロントエンド→API→DB の 3 層構成で、DB はフロントエンドから直接到達不可。",
    config: {
      networks: [
        createNetwork("frontend", "bridge", "172.22.0.0/16", "172.22.0.1", { bridgeName: "br-front" }),
        createNetwork("backend", "bridge", "172.23.0.0/16", "172.23.0.1", { bridgeName: "br-back" }),
      ],
      containers: [
        createContainer("web", "nginx:latest", [netConfig("frontend", "172.22.0.2", "172.22.0.1", ["web"])], { ports: [{ hostPort: 80, containerPort: 80, protocol: "tcp" }] }),
        createContainer("api", "node:22", [netConfig("frontend", "172.22.0.3", "172.22.0.1", ["api"]), netConfig("backend", "172.23.0.2", "172.23.0.1", ["api"])]),
        createContainer("db", "postgres:16", [netConfig("backend", "172.23.0.3", "172.23.0.1", ["db"])]),
      ],
      packetFlows: [
        { from: "web", to: "api", dstPort: 3000, protocol: "tcp", external: false },
        { from: "api", to: "db", dstPort: 5432, protocol: "tcp", external: false },
        { from: "web", to: "db", dstPort: 5432, protocol: "tcp", external: false },
      ],
      dnsQueries: [
        { name: "api", type: "A", fromContainer: "web" },
        { name: "db", type: "A", fromContainer: "api" },
        { name: "db", type: "A", fromContainer: "web" },
      ],
    },
  },
  {
    name: "overlay ネットワーク (マルチホスト)",
    description: "VXLAN トンネルでカプセル化し、異なるホスト上のコンテナ間で通信。Swarm/Kubernetes の基盤技術。",
    config: {
      networks: [createNetwork("swarm-net", "overlay", "10.0.0.0/24", "10.0.0.1", { vxlanId: 4096, bridgeName: "br0" })],
      containers: [
        createContainer("svc-1", "app:2.0", [netConfig("swarm-net", "10.0.0.2", "10.0.0.1", ["svc-1"])]),
        createContainer("svc-2", "app:2.0", [netConfig("swarm-net", "10.0.0.3", "10.0.0.1", ["svc-2"])]),
      ],
      packetFlows: [
        { from: "svc-1", to: "svc-2", dstPort: 8080, protocol: "tcp", external: false },
      ],
      dnsQueries: [{ name: "svc-2", type: "A", fromContainer: "svc-1" }],
    },
  },
  {
    name: "host ネットワーク",
    description: "ホストのネットワーク名前空間を直接共有。ネットワーク分離なし、ポートマッピング不要だがポート競合のリスク。",
    config: {
      networks: [createNetwork("host-net", "host", "0.0.0.0/0", "0.0.0.0")],
      containers: [
        createContainer("monitor", "prometheus:latest", [{ networkName: "host-net", ip: "host", mac: "host", gateway: "host", ifName: "eth0", vethHost: "", dns: ["host"], aliases: [] }]),
      ],
      packetFlows: [
        { from: "monitor", to: "localhost:9090", dstPort: 9090, protocol: "tcp", external: false },
      ],
      dnsQueries: [],
    },
  },
  {
    name: "none ネットワーク (完全分離)",
    description: "ループバックのみ。セキュリティが最優先のバッチ処理コンテナ等で使用。外部通信は一切不可。",
    config: {
      networks: [createNetwork("none-net", "none", "0.0.0.0/0", "0.0.0.0")],
      containers: [
        createContainer("batch", "python:3.12", [{ networkName: "none-net", ip: "127.0.0.1", mac: "00:00:00:00:00:00", gateway: "", ifName: "lo", vethHost: "", dns: [], aliases: [] }]),
      ],
      packetFlows: [
        { from: "batch", to: "api.example.com", dstPort: 443, protocol: "tcp", external: true },
      ],
      dnsQueries: [],
    },
  },
  {
    name: "macvlan (物理 LAN 参加)",
    description: "コンテナが物理ネットワーク上に独自 MAC/IP で参加。ホストからは到達不可だが、LAN 上の他機器からは直接アクセス可能。",
    config: {
      networks: [createNetwork("lan", "macvlan", "192.168.1.0/24", "192.168.1.1", { bridgeName: "eth0" })],
      containers: [
        createContainer("iot-gw", "mosquitto:latest", [netConfig("lan", "192.168.1.200", "192.168.1.1", ["iot-gw"])]),
        createContainer("sensor-api", "node:22", [netConfig("lan", "192.168.1.201", "192.168.1.1", ["sensor-api"])]),
      ],
      packetFlows: [
        { from: "iot-gw", to: "sensor-api", dstPort: 1883, protocol: "tcp", external: false },
      ],
      dnsQueries: [],
    },
  },
];

// ── 色 ──
function layerColor(l: SimEvent["layer"]): string {
  const m: Record<string, string> = { Docker: "#2496ed", Netns: "#a78bfa", Veth: "#22c55e", Bridge: "#06b6d4", Iptables: "#ef4444", NAT: "#f97316", DNS: "#3b82f6", VXLAN: "#ec4899", Route: "#64748b", App: "#f59e0b" };
  return m[l] ?? "#94a3b8";
}
function typeIcon(t: SimEvent["type"]): string {
  const m: Record<string, string> = { create: "+", packet: "→", resolve: "?", rule: "⚙", info: "●", error: "✗" };
  return m[t] ?? "●";
}

export class DnetApp {
  init(container: HTMLElement): void {
    container.style.cssText = "display:flex;flex-direction:column;height:100vh;font-family:'Fira Code','Cascadia Code',monospace;background:#0f172a;color:#e2e8f0;";

    const header = document.createElement("div"); header.style.cssText = "padding:8px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #1e293b;flex-wrap:wrap;";
    const title = document.createElement("h1"); title.textContent = "Docker Network Simulator"; title.style.cssText = "margin:0;font-size:15px;white-space:nowrap;"; header.appendChild(title);
    const exSelect = document.createElement("select"); exSelect.style.cssText = "padding:4px 8px;background:#1e293b;border:1px solid #334155;border-radius:4px;color:#f8fafc;font-size:12px;";
    for (let i = 0; i < EXPERIMENTS.length; i++) { const o = document.createElement("option"); o.value = String(i); o.textContent = EXPERIMENTS[i]!.name; exSelect.appendChild(o); }
    header.appendChild(exSelect);
    const runBtn = document.createElement("button"); runBtn.textContent = "\u25B6 Run"; runBtn.style.cssText = "padding:4px 16px;background:#e2e8f0;color:#0f172a;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;"; header.appendChild(runBtn);
    const descSpan = document.createElement("span"); descSpan.style.cssText = "font-size:10px;color:#64748b;margin-left:auto;max-width:500px;"; header.appendChild(descSpan);
    container.appendChild(header);

    const main = document.createElement("div"); main.style.cssText = "flex:1;display:flex;overflow:hidden;";

    const leftPanel = document.createElement("div"); leftPanel.style.cssText = "width:380px;display:flex;flex-direction:column;border-right:1px solid #1e293b;overflow-y:auto;font-size:10px;";
    const makeSection = (label: string, color: string) => {
      const lbl = document.createElement("div"); lbl.style.cssText = `padding:4px 12px;font-size:11px;font-weight:600;color:${color};border-bottom:1px solid #1e293b;`; lbl.textContent = label; leftPanel.appendChild(lbl);
      const div = document.createElement("div"); div.style.cssText = "padding:8px 12px;border-bottom:1px solid #1e293b;"; leftPanel.appendChild(div); return div;
    };
    const netDiv = makeSection("Networks", "#2496ed");
    const ctnDiv = makeSection("Containers", "#22c55e");
    const resultDiv = makeSection("Results", "#f59e0b");
    const rulesLabel = document.createElement("div"); rulesLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#ef4444;border-bottom:1px solid #1e293b;"; rulesLabel.textContent = "iptables"; leftPanel.appendChild(rulesLabel);
    const rulesDiv = document.createElement("div"); rulesDiv.style.cssText = "flex:1;padding:4px 8px;overflow-y:auto;font-size:9px;"; leftPanel.appendChild(rulesDiv);
    main.appendChild(leftPanel);

    const rightPanel = document.createElement("div"); rightPanel.style.cssText = "flex:1;display:flex;flex-direction:column;overflow:hidden;";
    const evLabel = document.createElement("div"); evLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#06b6d4;border-bottom:1px solid #1e293b;"; evLabel.textContent = "Trace"; rightPanel.appendChild(evLabel);
    const evDiv = document.createElement("div"); evDiv.style.cssText = "flex:1;padding:4px 8px;font-size:9px;overflow-y:auto;line-height:1.7;"; rightPanel.appendChild(evDiv);
    main.appendChild(rightPanel); container.appendChild(main);

    const addRow = (p: HTMLElement, l: string, v: string, c: string) => { const r = document.createElement("div"); r.style.marginBottom = "2px"; r.innerHTML = `<span style="color:${c};font-weight:600;">${l}:</span> <span style="color:#94a3b8;">${v}</span>`; p.appendChild(r); };

    const renderConfig = (exp: Experiment) => {
      netDiv.innerHTML = "";
      for (const n of exp.config.networks) {
        addRow(netDiv, n.name, `${n.driver} ${n.ipam.subnets[0]?.subnet ?? ""}`, "#2496ed");
        if (n.internal) addRow(netDiv, "  internal", "true", "#f59e0b");
        if (!n.icc) addRow(netDiv, "  icc", "false", "#ef4444");
        if (n.vxlanId) addRow(netDiv, "  vxlan", String(n.vxlanId), "#ec4899");
      }
      ctnDiv.innerHTML = "";
      for (const c of exp.config.containers) {
        addRow(ctnDiv, c.name, c.image, "#22c55e");
        for (const nc of c.networks) addRow(ctnDiv, `  ${nc.networkName}`, `${nc.ip} (${nc.ifName})`, "#64748b");
        for (const pm of c.portMappings) addRow(ctnDiv, "  port", `${pm.hostPort}:${pm.containerPort}/${pm.protocol}`, "#f97316");
      }
    };

    const renderResults = (r: SimResult) => {
      resultDiv.innerHTML = "";
      for (const d of r.dnsResults) addRow(resultDiv, `DNS ${d.query}`, `${d.answer} (from ${d.fromContainer})`, d.answer === "NXDOMAIN" ? "#ef4444" : "#3b82f6");
      for (const f of r.flowResults) addRow(resultDiv, `${f.from}→${f.to}`, f.reached ? `✓ ${f.reason} [${f.path.join("→")}]` : `✗ ${f.reason}`, f.reached ? "#22c55e" : "#ef4444");
      rulesDiv.innerHTML = "";
      for (const rule of r.iptablesRules) {
        const el = document.createElement("div"); el.style.cssText = "margin-bottom:3px;padding:2px 4px;background:#0a0a1e;border:1px solid #1e293b;border-radius:2px;font-size:8px;";
        el.innerHTML = `<span style="color:#ef4444;">${rule.table}/${rule.chain}</span> <span style="color:#94a3b8;">${rule.rule}</span> → <span style="color:#f59e0b;">${rule.target}</span>`;
        rulesDiv.appendChild(el);
      }
    };

    const renderEvents = (events: SimEvent[]) => {
      evDiv.innerHTML = "";
      for (const ev of events) {
        const el = document.createElement("div"); el.style.cssText = "display:flex;gap:4px;align-items:flex-start;margin-bottom:1px;";
        const lc = layerColor(ev.layer);
        el.innerHTML =
          `<span style="min-width:30px;color:#475569;text-align:right;">${ev.time}</span>` +
          `<span style="color:${ev.type === "error" ? "#ef4444" : "#94a3b8"};min-width:12px;">${typeIcon(ev.type)}</span>` +
          `<span style="min-width:55px;padding:0 3px;border-radius:2px;font-size:8px;font-weight:600;text-align:center;color:${lc};background:${lc}15;border:1px solid ${lc}33;">${ev.layer}</span>` +
          `<span style="color:#cbd5e1;">${ev.detail}</span>`;
        evDiv.appendChild(el);
      }
    };

    const load = (e: Experiment) => { descSpan.textContent = e.description; renderConfig(e); resultDiv.innerHTML = '<span style="color:#475569;">▶ Run</span>'; rulesDiv.innerHTML = ""; evDiv.innerHTML = ""; };
    const run = (e: Experiment) => { const sim = new DockerNetSimulator(); const r = sim.simulate(e.config); renderConfig(e); renderResults(r); renderEvents(r.events); };
    exSelect.addEventListener("change", () => { const e = EXPERIMENTS[Number(exSelect.value)]; if (e) load(e); });
    runBtn.addEventListener("click", () => { const e = EXPERIMENTS[Number(exSelect.value)]; if (e) run(e); });
    load(EXPERIMENTS[0]!);
  }
}
