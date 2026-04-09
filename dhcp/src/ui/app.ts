import {
  DhcpSimulator, createPool, createClient,
} from "../engine/dhcp.js";
import type {
  SimConfig, SimResult, SimEvent, Lease, AddressPool,
} from "../engine/dhcp.js";

// ── プリセット実験 ──

export interface Experiment {
  name: string;
  description: string;
  config: SimConfig;
}

const defaultPool = createPool();

export const EXPERIMENTS: Experiment[] = [
  {
    name: "基本 DORA (1 クライアント)",
    description: "単一クライアントの DHCPDISCOVER → OFFER → REQUEST → ACK の基本フロー。DHCP の最も基本的な動作。",
    config: {
      pool: defaultPool,
      clients: [createClient("laptop-01", "aa:bb:cc:00:00:01")],
      networkLatency: 5,
      maxTime: 100,
      simulateRenewal: false,
      releaseClients: [],
      declineClients: [],
      rogueServer: false,
    },
  },
  {
    name: "複数クライアント同時接続",
    description: "5台のクライアントが順次 DHCP リクエストを送信。プールから順に IP が割り当てられる。",
    config: {
      pool: defaultPool,
      clients: [
        createClient("desktop-01", "aa:bb:cc:00:01:01"),
        createClient("laptop-02", "aa:bb:cc:00:01:02"),
        createClient("phone-03", "aa:bb:cc:00:01:03"),
        createClient("tablet-04", "aa:bb:cc:00:01:04"),
        createClient("iot-05", "aa:bb:cc:00:01:05"),
      ],
      networkLatency: 5,
      maxTime: 500,
      simulateRenewal: false,
      releaseClients: [],
      declineClients: [],
      rogueServer: false,
    },
  },
  {
    name: "IP アドレス予約",
    description: "MAC アドレスに基づく IP 予約。サーバーやプリンタに固定 IP を割り当てる運用を再現。",
    config: {
      pool: createPool({
        reservations: new Map([
          ["aa:bb:cc:00:02:01", "192.168.1.10"],
          ["aa:bb:cc:00:02:02", "192.168.1.20"],
        ]),
      }),
      clients: [
        createClient("server-01", "aa:bb:cc:00:02:01"),
        createClient("printer-01", "aa:bb:cc:00:02:02"),
        createClient("guest-pc", "aa:bb:cc:00:02:03"),
      ],
      networkLatency: 5,
      maxTime: 300,
      simulateRenewal: false,
      releaseClients: [],
      declineClients: [],
      rogueServer: false,
    },
  },
  {
    name: "リース更新 (T1 RENEW)",
    description: "リース取得後に T1 タイマー (リース期間の 50%) が満了し、unicast でリース更新 REQUEST を送信する。",
    config: {
      pool: createPool({ defaultLease: 200, maxLease: 400 }),
      clients: [
        createClient("workstation", "aa:bb:cc:00:03:01"),
        createClient("laptop", "aa:bb:cc:00:03:02"),
      ],
      networkLatency: 3,
      maxTime: 300,
      simulateRenewal: true,
      releaseClients: [],
      declineClients: [],
      rogueServer: false,
    },
  },
  {
    name: "リース解放 (RELEASE)",
    description: "クライアントがシャットダウン時に DHCPRELEASE を送信。IP がプールに即座に返却される。",
    config: {
      pool: defaultPool,
      clients: [
        createClient("temp-vm-01", "aa:bb:cc:00:04:01"),
        createClient("temp-vm-02", "aa:bb:cc:00:04:02"),
        createClient("permanent", "aa:bb:cc:00:04:03"),
      ],
      networkLatency: 5,
      maxTime: 500,
      simulateRenewal: false,
      releaseClients: ["aa:bb:cc:00:04:01", "aa:bb:cc:00:04:02"],
      declineClients: [],
      rogueServer: false,
    },
  },
  {
    name: "IP 競合 & DECLINE",
    description: "クライアントが ARP probe で IP 競合を検出し DHCPDECLINE を送信。サーバーは別の IP を再割り当てする。",
    config: {
      pool: defaultPool,
      clients: [
        createClient("conflict-host", "aa:bb:cc:00:05:01"),
        createClient("normal-host", "aa:bb:cc:00:05:02"),
      ],
      networkLatency: 5,
      maxTime: 500,
      simulateRenewal: false,
      releaseClients: [],
      declineClients: ["aa:bb:cc:00:05:01"],
      rogueServer: false,
    },
  },
  {
    name: "アドレスプール枯渇",
    description: "極小プール (3 IP) に 5 クライアントが接続。プール枯渇で DHCPNAK が返される。",
    config: {
      pool: createPool({ rangeStart: "192.168.1.100", rangeEnd: "192.168.1.102" }),
      clients: [
        createClient("host-01", "aa:bb:cc:00:06:01"),
        createClient("host-02", "aa:bb:cc:00:06:02"),
        createClient("host-03", "aa:bb:cc:00:06:03"),
        createClient("host-04", "aa:bb:cc:00:06:04"),
        createClient("host-05", "aa:bb:cc:00:06:05"),
      ],
      networkLatency: 5,
      maxTime: 500,
      simulateRenewal: false,
      releaseClients: [],
      declineClients: [],
      rogueServer: false,
    },
  },
  {
    name: "リレーエージェント経由",
    description: "異なるサブネットのクライアントがリレーエージェント経由で DHCP サーバーにアクセスする。giaddr フィールドが設定される。",
    config: {
      pool: createPool({ subnet: "10.0.0.0", mask: "255.255.0.0", rangeStart: "10.0.1.100", rangeEnd: "10.0.1.200", gateway: "10.0.0.1", domainName: "corp.internal" }),
      clients: [
        createClient("remote-01", "aa:bb:cc:00:07:01"),
        createClient("remote-02", "aa:bb:cc:00:07:02"),
      ],
      relay: { ip: "10.0.0.254", serverIp: "10.0.0.1", latency: 10 },
      networkLatency: 5,
      maxTime: 500,
      simulateRenewal: false,
      releaseClients: [],
      declineClients: [],
      rogueServer: false,
    },
  },
  {
    name: "不正 DHCP サーバー (Rogue)",
    description: "不正サーバーが正規サーバーより先に OFFER を返す MITM シナリオ。DHCP Snooping の必要性を理解する。",
    config: {
      pool: defaultPool,
      clients: [
        createClient("victim-01", "aa:bb:cc:00:08:01"),
        createClient("victim-02", "aa:bb:cc:00:08:02"),
      ],
      networkLatency: 5,
      maxTime: 300,
      simulateRenewal: false,
      releaseClients: [],
      declineClients: [],
      rogueServer: true,
    },
  },
];

// ── イベントの色 ──

function eventColor(type: SimEvent["type"]): string {
  switch (type) {
    case "packet": return "#3b82f6";
    case "lease":  return "#22c55e";
    case "pool":   return "#f59e0b";
    case "error":  return "#ef4444";
    case "relay":  return "#a78bfa";
    case "timer":  return "#06b6d4";
  }
}

function dirIcon(dir: SimEvent["direction"]): string {
  switch (dir) {
    case "broadcast":     return "◉";
    case "client→server": return "→";
    case "server→client": return "←";
    case "relay":         return "⇄";
    case "internal":      return "●";
  }
}

function dirColor(dir: SimEvent["direction"]): string {
  switch (dir) {
    case "broadcast":     return "#f59e0b";
    case "client→server": return "#22c55e";
    case "server→client": return "#06b6d4";
    case "relay":         return "#a78bfa";
    case "internal":      return "#64748b";
  }
}

/** DHCP メッセージタイプの色 */
function msgColor(msgType: string): string {
  switch (msgType) {
    case "DHCPDISCOVER": return "#f59e0b";
    case "DHCPOFFER":    return "#3b82f6";
    case "DHCPREQUEST":  return "#22c55e";
    case "DHCPACK":      return "#06b6d4";
    case "DHCPNAK":      return "#ef4444";
    case "DHCPDECLINE":  return "#f97316";
    case "DHCPRELEASE":  return "#a78bfa";
    default:             return "#94a3b8";
  }
}

// クライアントごとの色
const CLIENT_COLORS = ["#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#a78bfa", "#ec4899", "#06b6d4", "#f97316"];

// ── UI ──

export class DhcpApp {
  init(container: HTMLElement): void {
    container.style.cssText = "display:flex;flex-direction:column;height:100vh;font-family:'Fira Code','Cascadia Code',monospace;background:#0f172a;color:#e2e8f0;";

    // ── ヘッダ ──
    const header = document.createElement("div");
    header.style.cssText = "padding:8px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #1e293b;flex-wrap:wrap;";

    const title = document.createElement("h1");
    title.textContent = "DHCP Simulator";
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
    runBtn.textContent = "\u25B6 Run";
    runBtn.style.cssText = "padding:4px 16px;background:#e2e8f0;color:#0f172a;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;";
    header.appendChild(runBtn);

    const descSpan = document.createElement("span");
    descSpan.style.cssText = "font-size:10px;color:#64748b;margin-left:auto;max-width:500px;";
    header.appendChild(descSpan);
    container.appendChild(header);

    // ── メイン ──
    const main = document.createElement("div");
    main.style.cssText = "flex:1;display:flex;overflow:hidden;";

    // 左パネル: 設定 + プール + リース
    const leftPanel = document.createElement("div");
    leftPanel.style.cssText = "width:360px;display:flex;flex-direction:column;border-right:1px solid #1e293b;overflow-y:auto;font-size:10px;";

    const cfgLabel = document.createElement("div");
    cfgLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#f59e0b;border-bottom:1px solid #1e293b;";
    cfgLabel.textContent = "Pool Config";
    leftPanel.appendChild(cfgLabel);
    const cfgDiv = document.createElement("div");
    cfgDiv.style.cssText = "padding:8px 12px;border-bottom:1px solid #1e293b;";
    leftPanel.appendChild(cfgDiv);

    const poolLabel = document.createElement("div");
    poolLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#22c55e;border-bottom:1px solid #1e293b;";
    poolLabel.textContent = "Pool Usage";
    leftPanel.appendChild(poolLabel);
    const poolDiv = document.createElement("div");
    poolDiv.style.cssText = "padding:8px 12px;border-bottom:1px solid #1e293b;";
    leftPanel.appendChild(poolDiv);

    const leaseLabel = document.createElement("div");
    leaseLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#06b6d4;border-bottom:1px solid #1e293b;";
    leaseLabel.textContent = "Lease Table";
    leftPanel.appendChild(leaseLabel);
    const leaseDiv = document.createElement("div");
    leaseDiv.style.cssText = "flex:1;padding:4px 8px;overflow-y:auto;";
    leftPanel.appendChild(leaseDiv);

    main.appendChild(leftPanel);

    // 右パネル: シーケンス図 + イベントログ
    const rightPanel = document.createElement("div");
    rightPanel.style.cssText = "flex:1;display:flex;flex-direction:column;overflow:hidden;";

    const seqLabel = document.createElement("div");
    seqLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#a78bfa;border-bottom:1px solid #1e293b;";
    seqLabel.textContent = "DORA Sequence";
    rightPanel.appendChild(seqLabel);
    const seqCanvas = document.createElement("canvas");
    seqCanvas.style.cssText = "height:280px;width:100%;background:#000;border-bottom:1px solid #1e293b;";
    rightPanel.appendChild(seqCanvas);

    const evLabel = document.createElement("div");
    evLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#3b82f6;border-bottom:1px solid #1e293b;";
    evLabel.textContent = "Event Log";
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

    const renderConfig = (exp: Experiment) => {
      cfgDiv.innerHTML = "";
      const p = exp.config.pool;
      addRow(cfgDiv, "サブネット", `${p.subnet} / ${p.mask}`, "#e2e8f0");
      addRow(cfgDiv, "割り当て範囲", `${p.rangeStart} — ${p.rangeEnd}`, "#3b82f6");
      addRow(cfgDiv, "ゲートウェイ", p.gateway, "#f59e0b");
      addRow(cfgDiv, "DNS", p.dnsServers.join(", "), "#06b6d4");
      addRow(cfgDiv, "ドメイン", p.domainName, "#64748b");
      addRow(cfgDiv, "リース期間", `${p.defaultLease}ms`, "#a78bfa");
      addRow(cfgDiv, "クライアント数", String(exp.config.clients.length), "#22c55e");
      if (exp.config.relay) addRow(cfgDiv, "リレー", `${exp.config.relay.ip} → ${exp.config.relay.serverIp}`, "#a78bfa");
      if (p.reservations.size > 0) {
        for (const [mac, ip] of p.reservations) {
          addRow(cfgDiv, "  予約", `${mac} → ${ip}`, "#ec4899");
        }
      }
    };

    const renderPool = (result: SimResult) => {
      poolDiv.innerHTML = "";
      const u = result.poolUsage;
      addRow(poolDiv, "合計", String(u.total), "#e2e8f0");
      addRow(poolDiv, "使用中", String(u.used), "#ef4444");
      addRow(poolDiv, "空き", String(u.available), "#22c55e");
      if (u.reserved > 0) addRow(poolDiv, "予約", String(u.reserved), "#ec4899");
      // 使用率バー
      const pct = u.total > 0 ? (u.used / u.total) * 100 : 0;
      const bar = document.createElement("div");
      bar.style.cssText = "margin-top:6px;height:10px;background:#1e293b;border-radius:3px;overflow:hidden;";
      const fill = document.createElement("div");
      fill.style.cssText = `height:100%;width:${pct}%;background:${pct > 80 ? "#ef4444" : pct > 50 ? "#f59e0b" : "#22c55e"};border-radius:3px;transition:width .3s;`;
      bar.appendChild(fill);
      poolDiv.appendChild(bar);
      const pctLabel = document.createElement("div");
      pctLabel.style.cssText = "font-size:9px;color:#64748b;margin-top:2px;text-align:right;";
      pctLabel.textContent = `${pct.toFixed(0)}% 使用`;
      poolDiv.appendChild(pctLabel);
    };

    const leaseStateColor = (state: Lease["state"]): string => {
      switch (state) {
        case "offered":   return "#f59e0b";
        case "bound":     return "#22c55e";
        case "renewing":  return "#3b82f6";
        case "rebinding": return "#a78bfa";
        case "expired":   return "#64748b";
        case "released":  return "#ef4444";
      }
    };

    const renderLeases = (leases: Lease[]) => {
      leaseDiv.innerHTML = "";
      if (leases.length === 0) {
        leaseDiv.innerHTML = '<span style="color:#475569;">リースなし</span>';
        return;
      }
      const table = document.createElement("table");
      table.style.cssText = "width:100%;font-size:9px;border-collapse:collapse;";
      const thead = document.createElement("tr");
      thead.innerHTML = ["IP", "Hostname", "MAC", "State"].map((h) => `<th style="text-align:left;padding:2px 4px;border-bottom:1px solid #1e293b;color:#64748b;">${h}</th>`).join("");
      table.appendChild(thead);
      for (const lease of leases) {
        const tr = document.createElement("tr");
        const sc = leaseStateColor(lease.state);
        tr.innerHTML =
          `<td style="padding:2px 4px;color:#e2e8f0;">${lease.ip}</td>` +
          `<td style="padding:2px 4px;color:#94a3b8;">${lease.hostname}</td>` +
          `<td style="padding:2px 4px;color:#64748b;font-size:8px;">${lease.mac}</td>` +
          `<td style="padding:2px 4px;color:${sc};font-weight:600;">${lease.state}</td>`;
        table.appendChild(tr);
      }
      leaseDiv.appendChild(table);
    };

    const renderSequence = (result: SimResult, config: SimConfig) => {
      const dpr = devicePixelRatio;
      const cw = seqCanvas.clientWidth;
      const ch = seqCanvas.clientHeight;
      seqCanvas.width = cw * dpr;
      seqCanvas.height = ch * dpr;
      const ctx = seqCanvas.getContext("2d")!;
      ctx.scale(dpr, dpr);
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, cw, ch);

      // カラム: クライアントたち + (リレー) + サーバー
      const columns: { label: string; x: number; color: string }[] = [];
      const hasRelay = !!config.relay;
      const clientCount = config.clients.length;
      const totalCols = clientCount + (hasRelay ? 1 : 0) + 1;
      const colWidth = (cw - 40) / totalCols;

      for (let i = 0; i < clientCount; i++) {
        const c = config.clients[i]!;
        columns.push({ label: c.hostname, x: 20 + (i + 0.5) * colWidth, color: CLIENT_COLORS[i % CLIENT_COLORS.length]! });
      }
      if (hasRelay) {
        columns.push({ label: "Relay", x: 20 + (clientCount + 0.5) * colWidth, color: "#a78bfa" });
      }
      columns.push({ label: "Server", x: 20 + (totalCols - 0.5) * colWidth, color: "#06b6d4" });

      const serverCol = columns[columns.length - 1]!;
      const relayCol = hasRelay ? columns[columns.length - 2]! : undefined;

      // ヘッダ
      ctx.font = "bold 10px monospace";
      ctx.textAlign = "center";
      for (const col of columns) {
        ctx.fillStyle = col.color;
        ctx.fillText(col.label, col.x, 14, colWidth - 4);
      }

      // 生命線
      const topY = 24;
      ctx.strokeStyle = "#1e293b";
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      for (const col of columns) {
        ctx.beginPath();
        ctx.moveTo(col.x, topY);
        ctx.lineTo(col.x, ch - 5);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      // パケットイベントのみ矢印描画
      const packetEvents = result.events.filter((e) => e.type === "packet" || e.type === "relay" || e.type === "error");
      if (packetEvents.length === 0) return;
      const maxTime = result.totalTime || 1;
      const availH = ch - topY - 10;

      // MAC → カラムインデックス
      const macToCol = new Map<string, typeof columns[0]>();
      for (let i = 0; i < config.clients.length; i++) {
        macToCol.set(config.clients[i]!.mac, columns[i]!);
      }

      for (const ev of packetEvents) {
        const y = topY + (ev.time / maxTime) * availH;
        if (y > ch - 5) continue;

        const clientCol = ev.clientMac ? macToCol.get(ev.clientMac) : columns[0];
        if (!clientCol) continue;

        let fromX: number;
        let toX: number;
        let color: string;

        if (ev.type === "relay") {
          fromX = clientCol.x;
          toX = relayCol?.x ?? serverCol.x;
          color = "#a78bfa";
        } else if (ev.direction === "broadcast" || ev.direction === "client→server") {
          fromX = clientCol.x;
          toX = hasRelay && ev.direction === "broadcast" ? (relayCol?.x ?? serverCol.x) : serverCol.x;
          color = ev.packet ? msgColor(ev.packet.messageType) : "#94a3b8";
        } else if (ev.direction === "server→client") {
          fromX = serverCol.x;
          toX = clientCol.x;
          color = ev.packet ? msgColor(ev.packet.messageType) : "#94a3b8";
        } else {
          continue;
        }

        if (ev.type === "error" && !ev.packet) {
          color = "#ef4444";
        }

        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(fromX, y);
        ctx.lineTo(toX, y);
        ctx.stroke();

        // 矢頭
        const angle = toX > fromX ? 0 : Math.PI;
        ctx.beginPath();
        ctx.moveTo(toX, y);
        ctx.lineTo(toX - 6 * Math.cos(angle - 0.4), y - 6 * Math.sin(angle - 0.4));
        ctx.moveTo(toX, y);
        ctx.lineTo(toX - 6 * Math.cos(angle + 0.4), y + 6 * Math.sin(angle + 0.4));
        ctx.stroke();

        // ラベル
        ctx.fillStyle = color;
        ctx.font = "8px monospace";
        ctx.textAlign = "center";
        const label = ev.packet?.messageType ?? (ev.type === "relay" ? "RELAY" : "ERR");
        ctx.fillText(label, (fromX + toX) / 2, y - 4);
      }
    };

    const renderEvents = (events: SimEvent[]) => {
      evDiv.innerHTML = "";
      for (const ev of events) {
        const el = document.createElement("div");
        el.style.cssText = "display:flex;gap:4px;align-items:flex-start;margin-bottom:1px;";
        const ec = eventColor(ev.type);
        const dc = dirColor(ev.direction);
        el.innerHTML =
          `<span style="min-width:36px;color:#475569;text-align:right;">${ev.time.toFixed(0)}</span>` +
          `<span style="color:${dc};min-width:12px;text-align:center;">${dirIcon(ev.direction)}</span>` +
          `<span style="min-width:48px;padding:0 3px;border-radius:2px;font-size:8px;font-weight:600;text-align:center;color:${ec};background:${ec}15;border:1px solid ${ec}33;">${ev.type}</span>` +
          `<span style="color:#cbd5e1;">${ev.detail}</span>`;
        evDiv.appendChild(el);

        // パケット詳細 (オプション)
        if (ev.packet) {
          const optStr = ev.packet.options.map((o) => `${o.name}=${o.value}`).join(", ");
          if (optStr) {
            const detail = document.createElement("div");
            detail.style.cssText = "margin:1px 0 3px 100px;padding:2px 6px;background:#0a0a1e;border:1px solid #1e293b;border-radius:2px;font-size:8px;color:#475569;white-space:nowrap;overflow-x:auto;";
            detail.textContent = `Options: ${optStr}`;
            evDiv.appendChild(detail);
          }
        }
      }
    };

    // ── ロジック ──

    const loadExperiment = (exp: Experiment) => {
      descSpan.textContent = exp.description;
      renderConfig(exp);
      poolDiv.innerHTML = '<span style="color:#475569;">▶ Run をクリックしてシミュレーション</span>';
      leaseDiv.innerHTML = "";
      evDiv.innerHTML = "";
    };

    const runSimulation = (exp: Experiment) => {
      // ディープコピー
      const clients = exp.config.clients.map((c) => ({ ...c }));
      const pool: AddressPool = { ...exp.config.pool, reservations: new Map(exp.config.pool.reservations) };
      const simConfig: SimConfig = { ...exp.config, pool, clients };
      const sim = new DhcpSimulator();
      const result = sim.simulate(simConfig);

      renderConfig(exp);
      renderPool(result);
      renderLeases(result.leases);
      renderSequence(result, simConfig);
      renderEvents(result.events);
    };

    exSelect.addEventListener("change", () => {
      const exp = EXPERIMENTS[Number(exSelect.value)];
      if (exp) loadExperiment(exp);
    });
    runBtn.addEventListener("click", () => {
      const exp = EXPERIMENTS[Number(exSelect.value)];
      if (exp) runSimulation(exp);
    });
    loadExperiment(EXPERIMENTS[0]!);
  }
}
