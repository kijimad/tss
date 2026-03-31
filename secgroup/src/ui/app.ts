import { FirewallEngine } from "../engine/firewall.js";
import type { SecurityGroup, Instance, Packet, EvalResult, TraceStep } from "../engine/firewall.js";

export interface Example {
  name: string;
  description: string;
  groups: SecurityGroup[];
  instances: Instance[];
  packets: { packet: Packet; direction: "inbound" | "outbound" }[];
}

export const EXAMPLES: Example[] = [
  {
    name: "Web サーバー (HTTP/HTTPS のみ許可)",
    description: "ポート 80/443 のみインバウンド許可。SSH や他のポートは拒否される。",
    groups: [
      {
        id: "sg-web", name: "web-server-sg",
        inbound: [
          { protocol: "tcp", fromPort: 80, toPort: 80, source: "0.0.0.0/0", description: "HTTP" },
          { protocol: "tcp", fromPort: 443, toPort: 443, source: "0.0.0.0/0", description: "HTTPS" },
        ],
        outbound: [
          { protocol: "all", fromPort: 0, toPort: 65535, source: "0.0.0.0/0", description: "全アウトバウンド許可" },
        ],
      },
    ],
    instances: [
      { id: "i-web1", name: "web-server", privateIp: "10.0.1.10", subnet: "10.0.1.0/24", sgIds: ["sg-web"] },
    ],
    packets: [
      { packet: { srcIp: "203.0.113.50", dstIp: "10.0.1.10", srcPort: 52000, dstPort: 80, protocol: "tcp", label: "HTTP リクエスト" }, direction: "inbound" },
      { packet: { srcIp: "203.0.113.50", dstIp: "10.0.1.10", srcPort: 52001, dstPort: 443, protocol: "tcp", label: "HTTPS リクエスト" }, direction: "inbound" },
      { packet: { srcIp: "203.0.113.50", dstIp: "10.0.1.10", srcPort: 52002, dstPort: 22, protocol: "tcp", label: "SSH 試行 (拒否)" }, direction: "inbound" },
      { packet: { srcIp: "203.0.113.50", dstIp: "10.0.1.10", srcPort: 52003, dstPort: 3306, protocol: "tcp", label: "MySQL 直接接続 (拒否)" }, direction: "inbound" },
      { packet: { srcIp: "10.0.1.10", dstIp: "203.0.113.50", srcPort: 80, dstPort: 52000, protocol: "tcp", label: "HTTP レスポンス (ステートフル)" }, direction: "outbound" },
    ],
  },
  {
    name: "踏み台 (Bastion) 構成",
    description: "Bastion は SSH のみ許可。内部サーバーは Bastion からの SSH のみ許可。",
    groups: [
      {
        id: "sg-bastion", name: "bastion-sg",
        inbound: [
          { protocol: "tcp", fromPort: 22, toPort: 22, source: "198.51.100.0/24", description: "オフィスからの SSH" },
        ],
        outbound: [
          { protocol: "all", fromPort: 0, toPort: 65535, source: "0.0.0.0/0", description: "全アウトバウンド" },
        ],
      },
      {
        id: "sg-internal", name: "internal-sg",
        inbound: [
          { protocol: "tcp", fromPort: 22, toPort: 22, source: "sg-bastion", description: "Bastion からの SSH のみ" },
        ],
        outbound: [
          { protocol: "all", fromPort: 0, toPort: 65535, source: "0.0.0.0/0", description: "全アウトバウンド" },
        ],
      },
    ],
    instances: [
      { id: "i-bastion", name: "bastion", privateIp: "10.0.0.5", subnet: "10.0.0.0/24", sgIds: ["sg-bastion"] },
      { id: "i-app1", name: "app-server", privateIp: "10.0.1.20", subnet: "10.0.1.0/24", sgIds: ["sg-internal"] },
    ],
    packets: [
      { packet: { srcIp: "198.51.100.10", dstIp: "10.0.0.5", srcPort: 50000, dstPort: 22, protocol: "tcp", label: "オフィス → Bastion SSH" }, direction: "inbound" },
      { packet: { srcIp: "203.0.113.99", dstIp: "10.0.0.5", srcPort: 50001, dstPort: 22, protocol: "tcp", label: "外部 → Bastion SSH (拒否)" }, direction: "inbound" },
      { packet: { srcIp: "10.0.0.5", dstIp: "10.0.1.20", srcPort: 50002, dstPort: 22, protocol: "tcp", label: "Bastion → App SSH (SG参照)" }, direction: "inbound" },
      { packet: { srcIp: "203.0.113.99", dstIp: "10.0.1.20", srcPort: 50003, dstPort: 22, protocol: "tcp", label: "外部 → App 直接SSH (拒否)" }, direction: "inbound" },
    ],
  },
  {
    name: "3層アーキテクチャ (Web/App/DB)",
    description: "Web→App→DB の順にしか通信できない。DB への直接アクセスは拒否。",
    groups: [
      {
        id: "sg-web", name: "web-tier-sg",
        inbound: [
          { protocol: "tcp", fromPort: 80, toPort: 80, source: "0.0.0.0/0", description: "HTTP" },
          { protocol: "tcp", fromPort: 443, toPort: 443, source: "0.0.0.0/0", description: "HTTPS" },
        ],
        outbound: [
          { protocol: "all", fromPort: 0, toPort: 65535, source: "0.0.0.0/0", description: "全アウトバウンド" },
        ],
      },
      {
        id: "sg-app", name: "app-tier-sg",
        inbound: [
          { protocol: "tcp", fromPort: 8080, toPort: 8080, source: "sg-web", description: "Web 層からのみ" },
        ],
        outbound: [
          { protocol: "all", fromPort: 0, toPort: 65535, source: "0.0.0.0/0", description: "全アウトバウンド" },
        ],
      },
      {
        id: "sg-db", name: "db-tier-sg",
        inbound: [
          { protocol: "tcp", fromPort: 5432, toPort: 5432, source: "sg-app", description: "App 層からの PostgreSQL のみ" },
        ],
        outbound: [
          { protocol: "all", fromPort: 0, toPort: 65535, source: "0.0.0.0/0", description: "全アウトバウンド" },
        ],
      },
    ],
    instances: [
      { id: "i-web", name: "web-server", privateIp: "10.0.1.10", subnet: "10.0.1.0/24", sgIds: ["sg-web"] },
      { id: "i-app", name: "app-server", privateIp: "10.0.2.10", subnet: "10.0.2.0/24", sgIds: ["sg-app"] },
      { id: "i-db", name: "db-server", privateIp: "10.0.3.10", subnet: "10.0.3.0/24", sgIds: ["sg-db"] },
    ],
    packets: [
      { packet: { srcIp: "203.0.113.1", dstIp: "10.0.1.10", srcPort: 60000, dstPort: 80, protocol: "tcp", label: "外部 → Web (HTTP)" }, direction: "inbound" },
      { packet: { srcIp: "10.0.1.10", dstIp: "10.0.2.10", srcPort: 60001, dstPort: 8080, protocol: "tcp", label: "Web → App (8080)" }, direction: "inbound" },
      { packet: { srcIp: "10.0.2.10", dstIp: "10.0.3.10", srcPort: 60002, dstPort: 5432, protocol: "tcp", label: "App → DB (PostgreSQL)" }, direction: "inbound" },
      { packet: { srcIp: "203.0.113.1", dstIp: "10.0.3.10", srcPort: 60003, dstPort: 5432, protocol: "tcp", label: "外部 → DB 直接 (拒否)" }, direction: "inbound" },
      { packet: { srcIp: "10.0.1.10", dstIp: "10.0.3.10", srcPort: 60004, dstPort: 5432, protocol: "tcp", label: "Web → DB 直接 (拒否)" }, direction: "inbound" },
    ],
  },
  {
    name: "デフォルト全拒否",
    description: "ルールなしのセキュリティグループ。全トラフィックが暗黙的に拒否される。",
    groups: [
      { id: "sg-empty", name: "empty-sg", inbound: [], outbound: [] },
    ],
    instances: [
      { id: "i-locked", name: "locked-server", privateIp: "10.0.1.50", subnet: "10.0.1.0/24", sgIds: ["sg-empty"] },
    ],
    packets: [
      { packet: { srcIp: "203.0.113.1", dstIp: "10.0.1.50", srcPort: 50000, dstPort: 80, protocol: "tcp", label: "HTTP (拒否)" }, direction: "inbound" },
      { packet: { srcIp: "203.0.113.1", dstIp: "10.0.1.50", srcPort: 50001, dstPort: 22, protocol: "tcp", label: "SSH (拒否)" }, direction: "inbound" },
      { packet: { srcIp: "203.0.113.1", dstIp: "10.0.1.50", srcPort: 0, dstPort: 0, protocol: "icmp", label: "Ping (拒否)" }, direction: "inbound" },
      { packet: { srcIp: "10.0.1.50", dstIp: "8.8.8.8", srcPort: 50002, dstPort: 443, protocol: "tcp", label: "外向き HTTPS (拒否)" }, direction: "outbound" },
    ],
  },
  {
    name: "CIDR 制限 + 複数 SG",
    description: "社内ネットワークからの SSH と、全体への HTTP を別 SG で管理。1 インスタンスに 2 SG。",
    groups: [
      {
        id: "sg-ssh", name: "ssh-access-sg",
        inbound: [
          { protocol: "tcp", fromPort: 22, toPort: 22, source: "10.0.0.0/16", description: "VPC 内からの SSH" },
        ],
        outbound: [],
      },
      {
        id: "sg-http", name: "http-access-sg",
        inbound: [
          { protocol: "tcp", fromPort: 80, toPort: 80, source: "0.0.0.0/0", description: "全 HTTP" },
        ],
        outbound: [
          { protocol: "all", fromPort: 0, toPort: 65535, source: "0.0.0.0/0", description: "全アウトバウンド" },
        ],
      },
    ],
    instances: [
      { id: "i-multi", name: "multi-sg-server", privateIp: "10.0.1.100", subnet: "10.0.1.0/24", sgIds: ["sg-ssh", "sg-http"] },
    ],
    packets: [
      { packet: { srcIp: "10.0.2.50", dstIp: "10.0.1.100", srcPort: 50000, dstPort: 22, protocol: "tcp", label: "VPC 内 SSH (許可)" }, direction: "inbound" },
      { packet: { srcIp: "203.0.113.1", dstIp: "10.0.1.100", srcPort: 50001, dstPort: 22, protocol: "tcp", label: "外部 SSH (拒否)" }, direction: "inbound" },
      { packet: { srcIp: "203.0.113.1", dstIp: "10.0.1.100", srcPort: 50002, dstPort: 80, protocol: "tcp", label: "外部 HTTP (許可)" }, direction: "inbound" },
      { packet: { srcIp: "10.0.2.50", dstIp: "10.0.1.100", srcPort: 50003, dstPort: 80, protocol: "tcp", label: "VPC 内 HTTP (許可)" }, direction: "inbound" },
      { packet: { srcIp: "203.0.113.1", dstIp: "10.0.1.100", srcPort: 50004, dstPort: 3000, protocol: "tcp", label: "外部 port 3000 (拒否)" }, direction: "inbound" },
    ],
  },
];

function phaseColor(phase: TraceStep["phase"]): string {
  switch (phase) {
    case "lookup":       return "#60a5fa";
    case "sg_eval":      return "#a78bfa";
    case "rule_check":   return "#94a3b8";
    case "match":        return "#10b981";
    case "default_deny": return "#ef4444";
    case "stateful":     return "#f59e0b";
  }
}

function resultIcon(r: TraceStep["result"]): string {
  switch (r) {
    case "allow": return "\u2714";
    case "deny":  return "\u2718";
    case "info":  return "\u2022";
    case "skip":  return "\u2500";
  }
}

export class SecGroupApp {
  init(container: HTMLElement): void {
    container.style.cssText =
      "display:flex;flex-direction:column;height:100vh;font-family:'Fira Code','Cascadia Code',monospace;background:#0f172a;color:#e2e8f0;";

    // ── ヘッダ ──
    const header = document.createElement("div");
    header.style.cssText = "padding:8px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #1e293b;flex-wrap:wrap;";

    const title = document.createElement("h1");
    title.textContent = "Security Group Simulator";
    title.style.cssText = "margin:0;font-size:15px;color:#ef4444;";
    header.appendChild(title);

    const exSelect = document.createElement("select");
    exSelect.style.cssText = "padding:4px 8px;background:#1e293b;border:1px solid #334155;border-radius:4px;color:#f8fafc;font-size:12px;";
    for (let i = 0; i < EXAMPLES.length; i++) {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = EXAMPLES[i]!.name;
      exSelect.appendChild(opt);
    }
    header.appendChild(exSelect);

    const runBtn = document.createElement("button");
    runBtn.textContent = "\u25B6 Run All Packets";
    runBtn.style.cssText = "padding:4px 16px;background:#ef4444;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;";
    header.appendChild(runBtn);

    const descSpan = document.createElement("span");
    descSpan.style.cssText = "font-size:10px;color:#64748b;margin-left:auto;max-width:400px;";
    header.appendChild(descSpan);

    container.appendChild(header);

    // ── メイン ──
    const main = document.createElement("div");
    main.style.cssText = "flex:1;display:flex;overflow:hidden;";

    // 左: SG ルール + インスタンス
    const leftPanel = document.createElement("div");
    leftPanel.style.cssText = "width:340px;display:flex;flex-direction:column;border-right:1px solid #1e293b;overflow-y:auto;";

    const sgLabel = document.createElement("div");
    sgLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#a78bfa;border-bottom:1px solid #1e293b;";
    sgLabel.textContent = "Security Groups";
    leftPanel.appendChild(sgLabel);

    const sgDiv = document.createElement("div");
    sgDiv.style.cssText = "padding:8px 12px;font-size:10px;border-bottom:1px solid #1e293b;";
    leftPanel.appendChild(sgDiv);

    const instLabel = document.createElement("div");
    instLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#06b6d4;border-bottom:1px solid #1e293b;";
    instLabel.textContent = "Instances";
    leftPanel.appendChild(instLabel);

    const instDiv = document.createElement("div");
    instDiv.style.cssText = "padding:8px 12px;font-size:10px;";
    leftPanel.appendChild(instDiv);

    main.appendChild(leftPanel);

    // 中央: パケット評価結果
    const centerPanel = document.createElement("div");
    centerPanel.style.cssText = "flex:1;display:flex;flex-direction:column;border-right:1px solid #1e293b;";

    const pktLabel = document.createElement("div");
    pktLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#f59e0b;border-bottom:1px solid #1e293b;";
    pktLabel.textContent = "Packet Evaluation Results";
    centerPanel.appendChild(pktLabel);

    const pktDiv = document.createElement("div");
    pktDiv.style.cssText = "flex:1;padding:8px 12px;font-size:10px;overflow-y:auto;";
    centerPanel.appendChild(pktDiv);

    main.appendChild(centerPanel);

    // 右: 選択パケットの詳細トレース
    const rightPanel = document.createElement("div");
    rightPanel.style.cssText = "width:360px;display:flex;flex-direction:column;";

    const traceLabel = document.createElement("div");
    traceLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#10b981;border-bottom:1px solid #1e293b;";
    traceLabel.textContent = "Evaluation Trace (click a packet)";
    rightPanel.appendChild(traceLabel);

    const traceDiv = document.createElement("div");
    traceDiv.style.cssText = "flex:1;padding:4px 8px;font-size:10px;overflow-y:auto;line-height:1.5;";
    rightPanel.appendChild(traceDiv);

    main.appendChild(rightPanel);
    container.appendChild(main);

    // ── 描画関数 ──

    const renderSgs = (groups: SecurityGroup[]) => {
      sgDiv.innerHTML = "";
      for (const sg of groups) {
        const box = document.createElement("div");
        box.style.cssText = "margin-bottom:8px;border:1px solid #334155;border-radius:4px;padding:6px 8px;";

        const nameEl = document.createElement("div");
        nameEl.style.cssText = "font-weight:600;color:#a78bfa;margin-bottom:4px;";
        nameEl.textContent = `${sg.name} (${sg.id})`;
        box.appendChild(nameEl);

        for (const dir of ["inbound", "outbound"] as const) {
          const rules = dir === "inbound" ? sg.inbound : sg.outbound;
          const dirLabel = document.createElement("div");
          dirLabel.style.cssText = `color:${dir === "inbound" ? "#3b82f6" : "#f59e0b"};font-size:9px;font-weight:600;margin-top:3px;`;
          dirLabel.textContent = `${dir} (${rules.length})`;
          box.appendChild(dirLabel);
          for (const r of rules) {
            const rLine = document.createElement("div");
            rLine.style.cssText = "color:#94a3b8;padding-left:8px;";
            rLine.textContent = `${r.protocol.toUpperCase()} ${r.fromPort}-${r.toPort} \u2190 ${r.source}`;
            box.appendChild(rLine);
          }
        }
        sgDiv.appendChild(box);
      }
    };

    const renderInstances = (instances: Instance[]) => {
      instDiv.innerHTML = "";
      for (const inst of instances) {
        const row = document.createElement("div");
        row.style.cssText = "margin-bottom:4px;display:flex;gap:6px;";
        row.innerHTML = `<span style="color:#06b6d4;font-weight:600;min-width:100px;">${inst.name}</span><span style="color:#64748b;">${inst.privateIp}</span><span style="color:#475569;">[${inst.sgIds.join(", ")}]</span>`;
        instDiv.appendChild(row);
      }
    };

    const renderResults = (results: EvalResult[]) => {
      pktDiv.innerHTML = "";
      for (let i = 0; i < results.length; i++) {
        const r = results[i]!;
        const row = document.createElement("div");
        const bgColor = r.allowed ? "#10b98115" : "#ef444415";
        const borderColor = r.allowed ? "#10b981" : "#ef4444";
        row.style.cssText = `padding:6px 8px;margin-bottom:4px;border:1px solid ${borderColor};border-radius:4px;background:${bgColor};cursor:pointer;transition:opacity 0.1s;`;
        row.addEventListener("mouseenter", () => { row.style.opacity = "0.8"; });
        row.addEventListener("mouseleave", () => { row.style.opacity = "1"; });

        const verdict = r.allowed ? "\u2714 ALLOW" : "\u2718 DENY";
        const verdictColor = r.allowed ? "#10b981" : "#ef4444";

        row.innerHTML =
          `<div style="display:flex;justify-content:space-between;align-items:center;">` +
          `<span style="font-weight:600;color:#e2e8f0;">${r.packet.label}</span>` +
          `<span style="font-weight:600;color:${verdictColor};font-size:11px;">${verdict}</span>` +
          `</div>` +
          `<div style="color:#64748b;font-size:9px;margin-top:2px;">` +
          `${r.packet.srcIp}:${r.packet.srcPort} \u2192 ${r.packet.dstIp}:${r.packet.dstPort} (${r.packet.protocol.toUpperCase()}) [${r.direction}]` +
          (r.matchedSg ? ` — ${r.matchedSg}` : "") +
          `</div>`;

        row.addEventListener("click", () => renderTrace(r.trace));
        pktDiv.appendChild(row);
      }
    };

    const renderTrace = (trace: TraceStep[]) => {
      traceDiv.innerHTML = "";
      for (const step of trace) {
        const line = document.createElement("div");
        line.style.cssText = "display:flex;gap:4px;align-items:flex-start;margin-bottom:2px;";

        const badge = document.createElement("span");
        const color = phaseColor(step.phase);
        badge.style.cssText = `min-width:62px;padding:0 4px;border-radius:2px;font-size:9px;font-weight:600;text-align:center;color:${color};background:${color}15;border:1px solid ${color}33;`;
        badge.textContent = step.phase;
        line.appendChild(badge);

        const icon = document.createElement("span");
        const iconColor = step.result === "allow" ? "#10b981" : step.result === "deny" ? "#ef4444" : "#64748b";
        icon.style.cssText = `color:${iconColor};min-width:12px;`;
        icon.textContent = resultIcon(step.result);
        line.appendChild(icon);

        const detail = document.createElement("span");
        detail.style.color = "#cbd5e1";
        detail.textContent = step.detail;
        line.appendChild(detail);

        traceDiv.appendChild(line);
      }
    };

    // ── ロジック ──

    const loadExample = (ex: Example) => {
      descSpan.textContent = ex.description;
      renderSgs(ex.groups);
      renderInstances(ex.instances);
      pktDiv.innerHTML = "";
      traceDiv.innerHTML = "";
    };

    const runAll = (ex: Example) => {
      const engine = new FirewallEngine(ex.groups, ex.instances);
      const results: EvalResult[] = [];
      for (const p of ex.packets) {
        results.push(engine.evaluate(p.packet, p.direction));
      }
      renderResults(results);
      if (results[0] !== undefined) renderTrace(results[0].trace);
    };

    // ── イベント ──

    exSelect.addEventListener("change", () => {
      const ex = EXAMPLES[Number(exSelect.value)];
      if (ex !== undefined) loadExample(ex);
    });

    runBtn.addEventListener("click", () => {
      const ex = EXAMPLES[Number(exSelect.value)];
      if (ex !== undefined) runAll(ex);
    });

    // 初期表示
    loadExample(EXAMPLES[0]!);
  }
}
