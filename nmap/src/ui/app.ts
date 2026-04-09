import {
  NmapScanner, createHost, tcp, udp,
  KNOWN_SERVICES, OS_LINUX, OS_WINDOWS, OS_FREEBSD, OS_CISCO,
} from "../engine/nmap.js";
import type {
  ScanConfig, ScanResult, ScanEvent, HostResult, Host, FirewallRule,
} from "../engine/nmap.js";

// ── プリセット実験 ──

export interface Experiment {
  name: string;
  description: string;
  network: Host[];
  config: ScanConfig;
}

// 共通ネットワーク
const webServer = createHost("192.168.1.10", "web.example.com", [
  tcp(22, "open", KNOWN_SERVICES.ssh!),
  tcp(80, "open", KNOWN_SERVICES.http!),
  tcp(443, "open", KNOWN_SERVICES.https!),
  tcp(8080, "open", KNOWN_SERVICES.httpAlt!),
], OS_LINUX);

const dbServer = createHost("192.168.1.20", "db.example.com", [
  tcp(22, "open", KNOWN_SERVICES.ssh!),
  tcp(3306, "open", KNOWN_SERVICES.mysql!),
  tcp(5432, "open", KNOWN_SERVICES.pg!),
], OS_LINUX, { icmpRespond: false });

const windowsServer = createHost("192.168.1.30", "dc01.corp.local", [
  tcp(80, "open", { name: "http", product: "Microsoft IIS", version: "10.0" }),
  tcp(135, "open", { name: "msrpc", product: "Microsoft Windows RPC" }),
  tcp(139, "open", KNOWN_SERVICES.smb!),
  tcp(445, "open", KNOWN_SERVICES.smb!),
  tcp(3389, "open", KNOWN_SERVICES.rdp!),
], OS_WINDOWS);

const mailServer = createHost("192.168.1.40", "mail.example.com", [
  tcp(22, "open", KNOWN_SERVICES.ssh!),
  tcp(25, "open", KNOWN_SERVICES.smtp!),
  tcp(110, "open", KNOWN_SERVICES.pop3!),
  tcp(143, "open", KNOWN_SERVICES.imap!),
  tcp(993, "open", { name: "imaps", product: "Dovecot imapd" }),
  tcp(995, "open", { name: "pop3s", product: "Dovecot pop3d" }),
], OS_LINUX);

const firewalled = createHost("192.168.1.50", "secure.example.com", [
  tcp(22, "open", KNOWN_SERVICES.ssh!),
  tcp(80, "open", KNOWN_SERVICES.http!),
  tcp(443, "open", KNOWN_SERVICES.https!),
  tcp(3306, "open", KNOWN_SERVICES.mysql!),
], OS_LINUX, {
  firewall: [
    { port: 22, protocol: "tcp", action: "allow" },
    { port: 80, protocol: "tcp", action: "allow" },
    { port: 443, protocol: "tcp", action: "allow" },
    { port: 3306, protocol: "tcp", action: "drop" },
    { port: 0, protocol: "tcp", action: "drop" },
  ] satisfies FirewallRule[],
});

const router = createHost("192.168.1.1", "gw.example.com", [
  tcp(22, "open", { name: "ssh", product: "Cisco SSH", version: "2.0" }),
  tcp(23, "open", KNOWN_SERVICES.telnet!),
  tcp(80, "open", { name: "http", product: "Cisco HTTP config" }),
  udp(53, "open", KNOWN_SERVICES.dnsUdp!),
  udp(161, "open", KNOWN_SERVICES.snmp!),
], OS_CISCO, { hops: 0 });

const downHost = createHost("192.168.1.99", "offline.example.com", [], OS_LINUX, { up: false });

const dnsServer = createHost("192.168.1.5", "ns1.example.com", [
  tcp(22, "open", KNOWN_SERVICES.ssh!),
  tcp(53, "open", KNOWN_SERVICES.dns!),
  udp(53, "open", KNOWN_SERVICES.dnsUdp!),
  udp(123, "open", KNOWN_SERVICES.ntp!),
], OS_FREEBSD);

const defaultPorts = [21, 22, 23, 25, 53, 80, 110, 135, 139, 143, 443, 445, 993, 995, 3306, 3389, 5432, 8080];

export const EXPERIMENTS: Experiment[] = [
  {
    name: "SYN スキャン (-sS) — Web サーバー",
    description: "最も一般的な SYN ステルススキャン。3-way HS を完了せず SYN→SYN/ACK で open 判定。ログに残りにくい。",
    network: [webServer],
    config: {
      scanType: "syn", targets: ["192.168.1.10"], ports: defaultPorts,
      serviceDetection: true, osDetection: true, timing: 4,
      sourceIp: "192.168.1.100", latencyMs: 5,
    },
  },
  {
    name: "TCP Connect (-sT) — Windows サーバー",
    description: "完全な TCP 接続を行うスキャン。root 権限不要だがログに記録される。RDP/SMB の検出を観察。",
    network: [windowsServer],
    config: {
      scanType: "connect", targets: ["192.168.1.30"], ports: defaultPorts,
      serviceDetection: true, osDetection: true, timing: 3,
      sourceIp: "192.168.1.100", latencyMs: 8,
    },
  },
  {
    name: "UDP スキャン (-sU) — DNS/NTP サーバー",
    description: "UDP ポートをスキャン。応答なし=open|filtered、ICMP unreachable=closed。TCP より時間がかかる。",
    network: [dnsServer, router],
    config: {
      scanType: "udp", targets: ["192.168.1.5", "192.168.1.1"], ports: [53, 67, 68, 123, 161, 162, 500, 514],
      serviceDetection: true, osDetection: false, timing: 4,
      sourceIp: "192.168.1.100", latencyMs: 10,
    },
  },
  {
    name: "ファイアウォール越しスキャン",
    description: "iptables でフィルタされたホスト。許可ポートは open、DROP ルールは filtered (応答なし)。",
    network: [firewalled],
    config: {
      scanType: "syn", targets: ["192.168.1.50"], ports: [22, 80, 443, 3306, 5432, 8080, 8443],
      serviceDetection: true, osDetection: true, timing: 4,
      sourceIp: "192.168.1.100", latencyMs: 5,
    },
  },
  {
    name: "Xmas スキャン (-sX) — ステルス",
    description: "FIN+PSH+URG フラグ送信。RFC 793 に基づき open ポートは無応答、closed は RST。IDS 回避目的。",
    network: [webServer, mailServer],
    config: {
      scanType: "xmas", targets: ["192.168.1.10", "192.168.1.40"], ports: [22, 25, 80, 110, 143, 443, 993],
      serviceDetection: false, osDetection: false, timing: 2,
      sourceIp: "192.168.1.100", latencyMs: 5,
    },
  },
  {
    name: "FIN スキャン (-sF) — ステルス",
    description: "FIN フラグのみ送信。Xmas と同じロジック。一部の IDS をすり抜ける。Windows には無効。",
    network: [webServer, windowsServer],
    config: {
      scanType: "fin", targets: ["192.168.1.10", "192.168.1.30"],
      ports: [22, 80, 135, 443, 445, 3389],
      serviceDetection: false, osDetection: false, timing: 3,
      sourceIp: "192.168.1.100", latencyMs: 5,
    },
  },
  {
    name: "Ping スイープ (-sn) — ホスト検出",
    description: "ポートスキャンなしのホスト検出。ICMP Echo + TCP SYN probe でネットワーク上の稼働ホストを列挙。",
    network: [router, dnsServer, webServer, dbServer, windowsServer, mailServer, firewalled, downHost],
    config: {
      scanType: "ping",
      targets: ["192.168.1.1", "192.168.1.5", "192.168.1.10", "192.168.1.20", "192.168.1.30", "192.168.1.40", "192.168.1.50", "192.168.1.99"],
      ports: [], serviceDetection: false, osDetection: false, timing: 4,
      sourceIp: "192.168.1.100", latencyMs: 3,
    },
  },
  {
    name: "サブネット全体スキャン",
    description: "複数ホストに対する SYN スキャン + サービス検出 + OS 検出のフルスキャン。実戦的なペネトレーションテスト第一歩。",
    network: [router, dnsServer, webServer, dbServer, windowsServer, mailServer, firewalled, downHost],
    config: {
      scanType: "syn",
      targets: ["192.168.1.1", "192.168.1.5", "192.168.1.10", "192.168.1.20", "192.168.1.30", "192.168.1.40", "192.168.1.50", "192.168.1.99"],
      ports: [22, 23, 25, 53, 80, 110, 135, 139, 143, 161, 443, 445, 993, 3306, 3389, 5432, 8080],
      serviceDetection: true, osDetection: true, timing: 4,
      sourceIp: "192.168.1.100", latencyMs: 5,
    },
  },
  {
    name: "NULL スキャン (-sN)",
    description: "フラグなしの TCP パケットを送信。RFC 793 準拠の OS でのみ有効。Windows では全ポートが closed に見える。",
    network: [webServer],
    config: {
      scanType: "null", targets: ["192.168.1.10"], ports: [22, 80, 443, 3306, 8080],
      serviceDetection: false, osDetection: false, timing: 3,
      sourceIp: "192.168.1.100", latencyMs: 5,
    },
  },
];

// ── 色定義 ──

function eventTypeColor(type: ScanEvent["type"]): string {
  switch (type) {
    case "probe_sent":      return "#64748b";
    case "probe_recv":      return "#94a3b8";
    case "host_discovery":  return "#f59e0b";
    case "port_result":     return "#3b82f6";
    case "service_detect":  return "#22c55e";
    case "os_detect":       return "#a78bfa";
    case "info":            return "#06b6d4";
    case "warning":         return "#ef4444";
  }
}

function portStateColor(state: string): string {
  switch (state) {
    case "open":           return "#22c55e";
    case "closed":         return "#64748b";
    case "filtered":       return "#f59e0b";
    case "open|filtered":  return "#3b82f6";
    default:               return "#94a3b8";
  }
}

// ── UI ──

export class NmapApp {
  init(container: HTMLElement): void {
    container.style.cssText = "display:flex;flex-direction:column;height:100vh;font-family:'Fira Code','Cascadia Code',monospace;background:#0f172a;color:#e2e8f0;";

    // ── ヘッダ ──
    const header = document.createElement("div");
    header.style.cssText = "padding:8px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #1e293b;flex-wrap:wrap;";

    const title = document.createElement("h1");
    title.textContent = "Nmap Simulator";
    title.style.cssText = "margin:0;font-size:15px;color:#e2e8f0;white-space:nowrap;";
    header.appendChild(title);

    const exSelect = document.createElement("select");
    exSelect.style.cssText = "padding:4px 8px;background:#1e293b;border:1px solid #334155;border-radius:4px;color:#f8fafc;font-size:12px;";
    for (let i = 0; i < EXPERIMENTS.length; i++) {
      const o = document.createElement("option");
      o.value = String(i);
      o.textContent = EXPERIMENTS[i]!.name;
      exSelect.appendChild(o);
    }
    header.appendChild(exSelect);

    const runBtn = document.createElement("button");
    runBtn.textContent = "\u25B6 Scan";
    runBtn.style.cssText = "padding:4px 16px;background:#e2e8f0;color:#0f172a;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;";
    header.appendChild(runBtn);

    const descSpan = document.createElement("span");
    descSpan.style.cssText = "font-size:10px;color:#64748b;margin-left:auto;max-width:500px;";
    header.appendChild(descSpan);
    container.appendChild(header);

    // ── メイン ──
    const main = document.createElement("div");
    main.style.cssText = "flex:1;display:flex;overflow:hidden;";

    // 左パネル: 設定 + サマリ + ホスト結果
    const leftPanel = document.createElement("div");
    leftPanel.style.cssText = "width:380px;display:flex;flex-direction:column;border-right:1px solid #1e293b;overflow-y:auto;font-size:10px;";

    const cfgLabel = document.createElement("div");
    cfgLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#f59e0b;border-bottom:1px solid #1e293b;";
    cfgLabel.textContent = "Scan Config";
    leftPanel.appendChild(cfgLabel);
    const cfgDiv = document.createElement("div");
    cfgDiv.style.cssText = "padding:8px 12px;border-bottom:1px solid #1e293b;";
    leftPanel.appendChild(cfgDiv);

    const sumLabel = document.createElement("div");
    sumLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#22c55e;border-bottom:1px solid #1e293b;";
    sumLabel.textContent = "Summary";
    leftPanel.appendChild(sumLabel);
    const sumDiv = document.createElement("div");
    sumDiv.style.cssText = "padding:8px 12px;border-bottom:1px solid #1e293b;";
    leftPanel.appendChild(sumDiv);

    const hostLabel = document.createElement("div");
    hostLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#06b6d4;border-bottom:1px solid #1e293b;";
    hostLabel.textContent = "Host Results";
    leftPanel.appendChild(hostLabel);
    const hostDiv = document.createElement("div");
    hostDiv.style.cssText = "flex:1;padding:4px 8px;overflow-y:auto;";
    leftPanel.appendChild(hostDiv);

    main.appendChild(leftPanel);

    // 右パネル: Nmap 出力 + イベントログ
    const rightPanel = document.createElement("div");
    rightPanel.style.cssText = "flex:1;display:flex;flex-direction:column;overflow:hidden;";

    const outLabel = document.createElement("div");
    outLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#a78bfa;border-bottom:1px solid #1e293b;";
    outLabel.textContent = "Nmap Output";
    rightPanel.appendChild(outLabel);
    const outPre = document.createElement("pre");
    outPre.style.cssText = "height:240px;padding:8px 12px;background:#000;font-size:10px;color:#22c55e;overflow:auto;border-bottom:1px solid #1e293b;white-space:pre-wrap;margin:0;";
    rightPanel.appendChild(outPre);

    const evLabel = document.createElement("div");
    evLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#3b82f6;border-bottom:1px solid #1e293b;";
    evLabel.textContent = "Probe Trace";
    rightPanel.appendChild(evLabel);
    const evDiv = document.createElement("div");
    evDiv.style.cssText = "flex:1;padding:4px 8px;font-size:9px;overflow-y:auto;line-height:1.7;";
    rightPanel.appendChild(evDiv);

    main.appendChild(rightPanel);
    container.appendChild(main);

    // ── 描画ロジック ──

    const addRow = (parent: HTMLElement, l: string, v: string, c: string) => {
      const row = document.createElement("div");
      row.style.marginBottom = "2px";
      row.innerHTML = `<span style="color:${c};font-weight:600;">${l}:</span> <span style="color:#94a3b8;">${v}</span>`;
      parent.appendChild(row);
    };

    const scanTypeLabels: Record<string, string> = {
      syn: "SYN Stealth (-sS)", connect: "TCP Connect (-sT)", udp: "UDP (-sU)",
      fin: "FIN (-sF)", xmas: "Xmas (-sX)", null: "NULL (-sN)", ping: "Ping (-sn)",
    };

    const renderConfig = (exp: Experiment) => {
      cfgDiv.innerHTML = "";
      addRow(cfgDiv, "スキャンタイプ", scanTypeLabels[exp.config.scanType] ?? exp.config.scanType, "#a78bfa");
      addRow(cfgDiv, "ターゲット", exp.config.targets.join(", "), "#e2e8f0");
      addRow(cfgDiv, "ポート", exp.config.ports.length > 0 ? `${exp.config.ports.length} ports` : "default", "#3b82f6");
      addRow(cfgDiv, "サービス検出", exp.config.serviceDetection ? "-sV" : "なし", "#22c55e");
      addRow(cfgDiv, "OS 検出", exp.config.osDetection ? "-O" : "なし", "#f59e0b");
      addRow(cfgDiv, "タイミング", `T${exp.config.timing}`, "#64748b");
      addRow(cfgDiv, "送信元", exp.config.sourceIp, "#64748b");
      addRow(cfgDiv, "ネットワーク", `${exp.network.length} hosts (${exp.network.filter((h) => h.up).length} up)`, "#06b6d4");
    };

    const renderSummary = (result: ScanResult) => {
      sumDiv.innerHTML = "";
      const s = result.summary;
      addRow(sumDiv, "ホスト", `${s.hostsUp} up / ${s.hostsDown} down (${s.hostsTotal} total)`, "#e2e8f0");
      addRow(sumDiv, "Open", String(s.openPorts), "#22c55e");
      addRow(sumDiv, "Closed", String(s.closedPorts), "#64748b");
      addRow(sumDiv, "Filtered", String(s.filteredPorts), "#f59e0b");
      addRow(sumDiv, "所要時間", `${s.totalTime.toFixed(0)}ms`, "#06b6d4");
    };

    const renderHosts = (hosts: HostResult[]) => {
      hostDiv.innerHTML = "";
      for (const h of hosts) {
        const section = document.createElement("div");
        section.style.cssText = "margin-bottom:8px;padding:6px 8px;background:#0a0a1e;border:1px solid #1e293b;border-radius:4px;";

        const header = document.createElement("div");
        header.style.cssText = "margin-bottom:4px;";
        header.innerHTML = `<span style="color:${h.up ? "#22c55e" : "#ef4444"};font-weight:600;">${h.up ? "●" : "○"}</span> <span style="color:#e2e8f0;font-weight:600;">${h.hostname || h.ip}</span> <span style="color:#64748b;">(${h.ip})</span>`;
        section.appendChild(header);

        if (!h.up) {
          section.innerHTML += '<div style="color:#64748b;font-size:9px;">Host is down</div>';
          hostDiv.appendChild(section);
          continue;
        }

        if (h.mac) {
          const macEl = document.createElement("div");
          macEl.style.cssText = "font-size:8px;color:#475569;margin-bottom:3px;";
          macEl.textContent = `MAC: ${h.mac} | Hops: ${h.hops} | Discovered: ${h.upReason}`;
          section.appendChild(macEl);
        }

        if (h.ports.length > 0) {
          const table = document.createElement("table");
          table.style.cssText = "width:100%;font-size:9px;border-collapse:collapse;margin-top:3px;";
          const thead = document.createElement("tr");
          thead.innerHTML = ["Port", "State", "Service"].map((t) => `<th style="text-align:left;padding:1px 4px;color:#475569;border-bottom:1px solid #1e293b;">${t}</th>`).join("");
          table.appendChild(thead);

          for (const p of h.ports) {
            if (p.state === "closed") continue;
            const tr = document.createElement("tr");
            const sc = portStateColor(p.state);
            const svcName = p.service.product ? `${p.service.name} ${p.service.product} ${p.service.version ?? ""}`.trim() : p.service.name;
            tr.innerHTML =
              `<td style="padding:1px 4px;color:#e2e8f0;">${p.port}/${p.protocol}</td>` +
              `<td style="padding:1px 4px;color:${sc};font-weight:600;">${p.state}</td>` +
              `<td style="padding:1px 4px;color:#94a3b8;">${svcName}</td>`;
            table.appendChild(tr);
          }
          section.appendChild(table);

          const closedCount = h.ports.filter((p) => p.state === "closed").length;
          if (closedCount > 0) {
            const closedEl = document.createElement("div");
            closedEl.style.cssText = "font-size:8px;color:#475569;margin-top:2px;";
            closedEl.textContent = `Not shown: ${closedCount} closed ports`;
            section.appendChild(closedEl);
          }
        }

        if (h.os) {
          const osEl = document.createElement("div");
          osEl.style.cssText = "font-size:9px;color:#a78bfa;margin-top:3px;";
          osEl.textContent = `OS: ${h.os.name} (${h.os.accuracy}%)`;
          section.appendChild(osEl);
        }

        hostDiv.appendChild(section);
      }
    };

    const renderEvents = (events: ScanEvent[]) => {
      evDiv.innerHTML = "";
      for (const ev of events) {
        const el = document.createElement("div");
        el.style.cssText = "display:flex;gap:4px;align-items:flex-start;margin-bottom:1px;";
        const ec = eventTypeColor(ev.type);
        el.innerHTML =
          `<span style="min-width:36px;color:#475569;text-align:right;">${ev.time.toFixed(0)}</span>` +
          `<span style="min-width:80px;padding:0 3px;border-radius:2px;font-size:8px;font-weight:600;text-align:center;color:${ec};background:${ec}15;border:1px solid ${ec}33;">${ev.type}</span>` +
          `<span style="color:#cbd5e1;">${ev.detail}</span>`;
        evDiv.appendChild(el);
      }
    };

    // ── ロジック ──

    const loadExperiment = (exp: Experiment) => {
      descSpan.textContent = exp.description;
      renderConfig(exp);
      sumDiv.innerHTML = '<span style="color:#475569;">▶ Scan をクリックしてスキャン開始</span>';
      hostDiv.innerHTML = "";
      outPre.textContent = "";
      evDiv.innerHTML = "";
    };

    const runScan = (exp: Experiment) => {
      const scanner = new NmapScanner(exp.network);
      const result = scanner.scan(exp.config);
      renderConfig(exp);
      renderSummary(result);
      renderHosts(result.hosts);
      outPre.textContent = result.nmapOutput;
      renderEvents(result.events);
    };

    exSelect.addEventListener("change", () => {
      const exp = EXPERIMENTS[Number(exSelect.value)];
      if (exp) loadExperiment(exp);
    });
    runBtn.addEventListener("click", () => {
      const exp = EXPERIMENTS[Number(exSelect.value)];
      if (exp) runScan(exp);
    });
    loadExperiment(EXPERIMENTS[0]!);
  }
}
