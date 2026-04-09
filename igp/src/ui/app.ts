import { simulateOspf, simulateRip, simulateLinkFailure } from "../engine/igp.js";
import type { Topology, Router, OspfResult, RipResult, IgpTrace } from "../engine/igp.js";

export interface Example {
  name: string;
  description: string;
  topology: Topology;
  /** リンク障害シミュレーション (指定時) */
  failLink?: { from: string; to: string };
}

// ── トポロジ定義 ──

const triangle: Topology = {
  routers: [
    { id: "R1", name: "R1", x: 200, y: 40 },
    { id: "R2", name: "R2", x: 80, y: 180 },
    { id: "R3", name: "R3", x: 320, y: 180 },
  ],
  links: [
    { from: "R1", to: "R2", cost: 10, bandwidth: "100Mbps", up: true },
    { from: "R1", to: "R3", cost: 5, bandwidth: "1Gbps", up: true },
    { from: "R2", to: "R3", cost: 3, bandwidth: "1Gbps", up: true },
  ],
};

const diamond: Topology = {
  routers: [
    { id: "R1", name: "R1 (東京)", x: 200, y: 30 },
    { id: "R2", name: "R2 (大阪)", x: 60, y: 120 },
    { id: "R3", name: "R3 (名古屋)", x: 340, y: 120 },
    { id: "R4", name: "R4 (福岡)", x: 200, y: 210 },
  ],
  links: [
    { from: "R1", to: "R2", cost: 10, bandwidth: "1Gbps", up: true },
    { from: "R1", to: "R3", cost: 5, bandwidth: "10Gbps", up: true },
    { from: "R2", to: "R4", cost: 8, bandwidth: "1Gbps", up: true },
    { from: "R3", to: "R4", cost: 3, bandwidth: "10Gbps", up: true },
    { from: "R2", to: "R3", cost: 15, bandwidth: "100Mbps", up: true },
  ],
};

const mesh: Topology = {
  routers: [
    { id: "R1", name: "R1", x: 60, y: 40 },
    { id: "R2", name: "R2", x: 340, y: 40 },
    { id: "R3", name: "R3", x: 60, y: 200 },
    { id: "R4", name: "R4", x: 340, y: 200 },
    { id: "R5", name: "R5", x: 200, y: 120 },
  ],
  links: [
    { from: "R1", to: "R2", cost: 4, bandwidth: "10Gbps", up: true },
    { from: "R1", to: "R3", cost: 2, bandwidth: "10Gbps", up: true },
    { from: "R1", to: "R5", cost: 7, bandwidth: "1Gbps", up: true },
    { from: "R2", to: "R4", cost: 3, bandwidth: "10Gbps", up: true },
    { from: "R2", to: "R5", cost: 5, bandwidth: "1Gbps", up: true },
    { from: "R3", to: "R4", cost: 6, bandwidth: "1Gbps", up: true },
    { from: "R3", to: "R5", cost: 1, bandwidth: "10Gbps", up: true },
    { from: "R4", to: "R5", cost: 8, bandwidth: "100Mbps", up: true },
  ],
};

const linear: Topology = {
  routers: [
    { id: "R1", name: "R1", x: 40, y: 120 },
    { id: "R2", name: "R2", x: 140, y: 120 },
    { id: "R3", name: "R3", x: 240, y: 120 },
    { id: "R4", name: "R4", x: 340, y: 120 },
  ],
  links: [
    { from: "R1", to: "R2", cost: 1, bandwidth: "1Gbps", up: true },
    { from: "R2", to: "R3", cost: 1, bandwidth: "1Gbps", up: true },
    { from: "R3", to: "R4", cost: 1, bandwidth: "1Gbps", up: true },
  ],
};

export const EXAMPLES: Example[] = [
  {
    name: "三角形トポロジ (OSPF vs RIP)",
    description: "3 ルータの三角形。OSPF はコスト最小経路、RIP はホップ数最小経路を選択。コストの違いで経路が変わる。",
    topology: triangle,
  },
  {
    name: "菱形トポロジ (経路選択)",
    description: "東京→福岡の経路: OSPF は名古屋経由 (cost=8)、大阪経由 (cost=18) を正しく比較。RIP はホップ数が同じなら先に見つかった方。",
    topology: diamond,
  },
  {
    name: "メッシュトポロジ (5ルータ)",
    description: "8 本のリンクを持つメッシュ。OSPF のダイクストラ法が複雑なトポロジで最短経路を計算する様子。",
    topology: mesh,
  },
  {
    name: "直列トポロジ (RIP の収束遅延)",
    description: "4 ルータ直列。RIP は各反復で 1 ホップずつしか情報が伝搬しないため、OSPF より収束が遅い。",
    topology: linear,
  },
  {
    name: "リンク障害 (菱形: R1↔R2 ダウン)",
    description: "R1↔R2 リンクがダウン。OSPF は即座に迂回路を計算。経路テーブルの変化を比較。",
    topology: diamond,
    failLink: { from: "R1", to: "R2" },
  },
  {
    name: "リンク障害 (メッシュ: R1↔R2 ダウン)",
    description: "冗長パスが豊富なメッシュでの障害。代替経路が自動的に選択される。",
    topology: mesh,
    failLink: { from: "R1", to: "R2" },
  },
];

// ── 色 ──

function phaseColor(p: IgpTrace["phase"]): string {
  switch (p) {
    case "init":         return "#94a3b8";
    case "hello":        return "#60a5fa";
    case "lsa_flood":    return "#f59e0b";
    case "spf_calc":     return "#22c55e";
    case "route_update": return "#3b82f6";
    case "dv_send":      return "#a78bfa";
    case "dv_recv":      return "#06b6d4";
    case "converged":    return "#10b981";
    case "link_down":    return "#ef4444";
    case "link_up":      return "#22c55e";
    case "poison":       return "#dc2626";
  }
}

// ── UI ──

export class IgpApp {
  init(container: HTMLElement): void {
    container.style.cssText = "display:flex;flex-direction:column;height:100vh;font-family:'Fira Code','Cascadia Code',monospace;background:#0f172a;color:#e2e8f0;";

    const header = document.createElement("div");
    header.style.cssText = "padding:8px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #1e293b;flex-wrap:wrap;";
    const title = document.createElement("h1");
    title.textContent = "IGP Routing Simulator";
    title.style.cssText = "margin:0;font-size:15px;color:#22c55e;";
    header.appendChild(title);

    const exSelect = document.createElement("select");
    exSelect.style.cssText = "padding:4px 8px;background:#1e293b;border:1px solid #334155;border-radius:4px;color:#f8fafc;font-size:12px;";
    for (let i = 0; i < EXAMPLES.length; i++) { const o = document.createElement("option"); o.value = String(i); o.textContent = EXAMPLES[i]!.name; exSelect.appendChild(o); }
    header.appendChild(exSelect);

    const runBtn = document.createElement("button");
    runBtn.textContent = "\u25B6 Simulate";
    runBtn.style.cssText = "padding:4px 16px;background:#22c55e;color:#0f172a;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;";
    header.appendChild(runBtn);

    const descSpan = document.createElement("span");
    descSpan.style.cssText = "font-size:10px;color:#64748b;margin-left:auto;max-width:400px;";
    header.appendChild(descSpan);
    container.appendChild(header);

    const main = document.createElement("div");
    main.style.cssText = "flex:1;display:flex;overflow:hidden;";

    // 左: トポロジ図 (Canvas)
    const leftPanel = document.createElement("div");
    leftPanel.style.cssText = "width:420px;display:flex;flex-direction:column;border-right:1px solid #1e293b;";
    const topoLabel = document.createElement("div");
    topoLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#f59e0b;border-bottom:1px solid #1e293b;";
    topoLabel.textContent = "Network Topology";
    leftPanel.appendChild(topoLabel);
    const canvas = document.createElement("canvas");
    canvas.style.cssText = "width:100%;height:260px;background:#0a0f1e;border-bottom:1px solid #1e293b;";
    leftPanel.appendChild(canvas);

    // OSPF vs RIP 比較テーブル
    const cmpLabel = document.createElement("div");
    cmpLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#e2e8f0;border-bottom:1px solid #1e293b;display:flex;gap:16px;";
    cmpLabel.innerHTML = '<span style="color:#3b82f6;">OSPF (リンクステート)</span> vs <span style="color:#a78bfa;">RIP (距離ベクトル)</span>';
    leftPanel.appendChild(cmpLabel);

    const tableDiv = document.createElement("div");
    tableDiv.style.cssText = "flex:1;padding:8px 12px;font-size:9px;overflow-y:auto;";
    leftPanel.appendChild(tableDiv);
    main.appendChild(leftPanel);

    // 右: トレースログ
    const rightPanel = document.createElement("div");
    rightPanel.style.cssText = "flex:1;display:flex;flex-direction:column;";

    // OSPF トレース
    const ospfLabel = document.createElement("div");
    ospfLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#3b82f6;border-bottom:1px solid #1e293b;";
    ospfLabel.textContent = "OSPF Trace (Link-State / Dijkstra)";
    rightPanel.appendChild(ospfLabel);
    const ospfDiv = document.createElement("div");
    ospfDiv.style.cssText = "flex:1;padding:4px 8px;font-size:9px;overflow-y:auto;line-height:1.5;border-bottom:1px solid #1e293b;";
    rightPanel.appendChild(ospfDiv);

    // RIP トレース
    const ripLabel = document.createElement("div");
    ripLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#a78bfa;border-bottom:1px solid #1e293b;";
    ripLabel.textContent = "RIP Trace (Distance-Vector / Bellman-Ford)";
    rightPanel.appendChild(ripLabel);
    const ripDiv = document.createElement("div");
    ripDiv.style.cssText = "flex:1;padding:4px 8px;font-size:9px;overflow-y:auto;line-height:1.5;";
    rightPanel.appendChild(ripDiv);

    main.appendChild(rightPanel);
    container.appendChild(main);

    // ── Canvas 描画 ──

    const drawTopology = (topo: Topology, failLink?: { from: string; to: string }) => {
      const dpr = devicePixelRatio;
      const cw = canvas.clientWidth;
      const ch = canvas.clientHeight;
      canvas.width = cw * dpr;
      canvas.height = ch * dpr;
      const ctx = canvas.getContext("2d")!;
      ctx.scale(dpr, dpr);
      ctx.fillStyle = "#0a0f1e";
      ctx.fillRect(0, 0, cw, ch);

      // リンク描画
      for (const link of topo.links) {
        const from = topo.routers.find((r) => r.id === link.from)!;
        const to = topo.routers.find((r) => r.id === link.to)!;
        const isFailed = failLink && ((link.from === failLink.from && link.to === failLink.to) || (link.from === failLink.to && link.to === failLink.from));

        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        if (isFailed) {
          ctx.strokeStyle = "#ef4444";
          ctx.setLineDash([5, 5]);
          ctx.lineWidth = 2;
        } else {
          ctx.strokeStyle = link.up ? "#334155" : "#1e293b";
          ctx.setLineDash([]);
          ctx.lineWidth = 1.5;
        }
        ctx.stroke();
        ctx.setLineDash([]);

        // コストラベル
        const mx = (from.x + to.x) / 2;
        const my = (from.y + to.y) / 2;
        ctx.fillStyle = isFailed ? "#ef4444" : "#64748b";
        ctx.font = "10px monospace";
        ctx.textAlign = "center";
        ctx.fillText(isFailed ? `${link.cost} \u2718` : String(link.cost), mx, my - 4);
        ctx.fillStyle = "#475569";
        ctx.font = "8px monospace";
        ctx.fillText(link.bandwidth, mx, my + 8);
      }

      // ルータ描画
      for (const router of topo.routers) {
        ctx.beginPath();
        ctx.arc(router.x, router.y, 18, 0, Math.PI * 2);
        ctx.fillStyle = "#1e293b";
        ctx.fill();
        ctx.strokeStyle = "#22c55e";
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.fillStyle = "#e2e8f0";
        ctx.font = "bold 11px monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(router.id, router.x, router.y);

        if (router.name !== router.id) {
          ctx.fillStyle = "#64748b";
          ctx.font = "8px monospace";
          ctx.fillText(router.name.replace(router.id + " ", ""), router.x, router.y + 28);
        }
      }
    };

    // ── テーブル描画 ──

    const renderComparison = (ospf: OspfResult, rip: RipResult, routers: Router[]) => {
      tableDiv.innerHTML = "";

      for (const router of routers) {
        const section = document.createElement("div");
        section.style.cssText = "margin-bottom:8px;";

        const hdr = document.createElement("div");
        hdr.style.cssText = "color:#22c55e;font-weight:600;margin-bottom:2px;font-size:10px;";
        hdr.textContent = `\u{1F5A5} ${router.name} (${router.id})`;
        section.appendChild(hdr);

        const tbl = document.createElement("table");
        tbl.style.cssText = "width:100%;border-collapse:collapse;font-size:9px;";

        const thead = document.createElement("tr");
        thead.innerHTML = '<th style="text-align:left;color:#64748b;padding:1px 4px;">Dest</th>' +
          '<th style="text-align:left;color:#3b82f6;padding:1px 4px;">OSPF NH</th><th style="color:#3b82f6;padding:1px 4px;">Cost</th>' +
          '<th style="text-align:left;color:#a78bfa;padding:1px 4px;">RIP NH</th><th style="color:#a78bfa;padding:1px 4px;">Hops</th>';
        tbl.appendChild(thead);

        const ospfTable = ospf.states.get(router.id)?.routingTable ?? [];
        const ripTable = rip.states.get(router.id)?.routingTable ?? [];
        const allDests = new Set([...ospfTable.map((r) => r.destination), ...ripTable.map((r) => r.destination)]);

        for (const dest of allDests) {
          const or = ospfTable.find((r) => r.destination === dest);
          const rr = ripTable.find((r) => r.destination === dest);
          const diff = or && rr && or.nextHop !== rr.nextHop;
          const row = document.createElement("tr");
          row.style.cssText = diff ? "background:#f59e0b15;" : "";
          row.innerHTML =
            `<td style="padding:1px 4px;color:#e2e8f0;">${dest}</td>` +
            `<td style="padding:1px 4px;color:#60a5fa;">${or?.nextHop ?? "-"}</td>` +
            `<td style="padding:1px 4px;color:#60a5fa;text-align:center;">${or?.metric ?? "-"}</td>` +
            `<td style="padding:1px 4px;color:#c4b5fd;">${rr?.nextHop ?? "-"}</td>` +
            `<td style="padding:1px 4px;color:#c4b5fd;text-align:center;">${rr?.metric ?? "-"}</td>`;
          tbl.appendChild(row);
        }
        section.appendChild(tbl);
        tableDiv.appendChild(section);
      }

      // 収束速度比較
      const summary = document.createElement("div");
      summary.style.cssText = "margin-top:8px;padding:6px;border:1px solid #334155;border-radius:4px;";
      summary.innerHTML =
        `<div style="color:#e2e8f0;font-weight:600;margin-bottom:4px;">収束速度比較</div>` +
        `<div style="color:#3b82f6;">OSPF: ${ospf.convergedAt} tick で収束</div>` +
        `<div style="color:#a78bfa;">RIP: ${rip.convergedAt} tick で収束</div>`;
      tableDiv.appendChild(summary);
    };

    // ── トレース描画 ──

    const renderTrace = (trace: IgpTrace[], div: HTMLElement) => {
      div.innerHTML = "";
      for (const step of trace) {
        const el = document.createElement("div");
        el.style.cssText = "display:flex;gap:4px;align-items:flex-start;margin-bottom:1px;";
        const color = phaseColor(step.phase);
        el.innerHTML =
          `<span style="color:#475569;min-width:18px;">t${step.tick}</span>` +
          `<span style="min-width:62px;padding:0 3px;border-radius:2px;font-size:8px;font-weight:600;text-align:center;color:${color};background:${color}15;border:1px solid ${color}33;">${step.phase}</span>` +
          `<span style="color:#f59e0b;min-width:20px;">${step.router}</span>` +
          `<span style="color:#cbd5e1;">${step.detail}</span>`;
        div.appendChild(el);
      }
    };

    // ── ロジック ──

    const loadExample = (ex: Example) => {
      descSpan.textContent = ex.description;
      drawTopology(ex.topology, ex.failLink);
      tableDiv.innerHTML = "";
      ospfDiv.innerHTML = "";
      ripDiv.innerHTML = "";
    };

    const runSim = (ex: Example) => {
      if (ex.failLink !== undefined) {
        const result = simulateLinkFailure(ex.topology, ex.failLink.from, ex.failLink.to);
        drawTopology(ex.topology, ex.failLink);
        renderComparison(result.ospf, result.rip, ex.topology.routers);
        renderTrace(result.ospf.trace, ospfDiv);
        renderTrace(result.rip.trace, ripDiv);
      } else {
        const ospf = simulateOspf(ex.topology);
        const rip = simulateRip(ex.topology);
        drawTopology(ex.topology);
        renderComparison(ospf, rip, ex.topology.routers);
        renderTrace(ospf.trace, ospfDiv);
        renderTrace(rip.trace, ripDiv);
      }
    };

    exSelect.addEventListener("change", () => { const ex = EXAMPLES[Number(exSelect.value)]; if (ex) loadExample(ex); });
    runBtn.addEventListener("click", () => { const ex = EXAMPLES[Number(exSelect.value)]; if (ex) runSim(ex); });
    loadExample(EXAMPLES[0]!);
  }
}
