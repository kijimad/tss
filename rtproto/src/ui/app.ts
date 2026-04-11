/* ルーティングプロトコル シミュレーター UI */

import { simulate } from "../rtproto/engine.js";
import { PRESETS } from "../rtproto/presets.js";
import type { SimulationResult, Router, Protocol } from "../rtproto/types.js";

// ─── カラーパレット ───
const COLORS = {
  bg: "#0f1117",
  card: "#1a1d27",
  cardBorder: "#2a2d3a",
  text: "#e2e8f0",
  textMuted: "#8892a8",
  accent: "#6366f1",   // インディゴ
  ospf: "#10b981",     // エメラルド
  rip: "#f59e0b",      // アンバー
  bgp: "#8b5cf6",      // バイオレット
  static: "#64748b",   // スレート
  link: "#334155",
  linkDown: "#ef4444",
  nodeStroke: "#475569",
  selected: "#fbbf24",
};

const PROTO_COLORS: Record<Protocol, string> = {
  ospf: COLORS.ospf,
  rip: COLORS.rip,
  bgp: COLORS.bgp,
  static: COLORS.static,
};

const PROTO_LABELS: Record<Protocol, string> = {
  ospf: "OSPF",
  rip: "RIP",
  bgp: "BGP",
  static: "Static",
};

let currentResult: SimulationResult | null = null;
let selectedRouter: Router | null = null;

function run(presetIndex: number): void {
  const preset = PRESETS[presetIndex]!;
  const { routers, links, ops } = preset.build();
  currentResult = simulate(routers, links, ops);
  selectedRouter = null;
  render();
}

function render(): void {
  const app = document.getElementById("app")!;
  if (!currentResult) {
    app.innerHTML = "<p>プリセットを選択してください</p>";
    return;
  }

  const r = currentResult;

  app.innerHTML = `
    <div class="header">
      <h1>Routing Protocol Simulator</h1>
      <div class="controls">
        <select id="preset-select">
          ${PRESETS.map((p, i) => `<option value="${i}">${p.name}</option>`).join("")}
        </select>
        <span class="desc" id="preset-desc">${PRESETS[0]?.description ?? ""}</span>
      </div>
    </div>
    <div class="main-grid">
      <div class="left-col">
        <div class="card topology-card">
          <h2>トポロジ</h2>
          <canvas id="topo-canvas" width="640" height="400"></canvas>
        </div>
        <div class="card stats-card">
          <h2>収束情報</h2>
          <div class="stats-grid" id="stats"></div>
        </div>
      </div>
      <div class="right-col">
        <div class="card rib-card">
          <h2 id="rib-title">RIB (ルーターをクリック)</h2>
          <div id="rib-content"></div>
        </div>
        <div class="card proto-card">
          <h2>プロトコル別経路</h2>
          <div id="proto-routes"></div>
        </div>
        <div class="card event-card">
          <h2>イベントログ</h2>
          <div class="event-log" id="events"></div>
        </div>
      </div>
    </div>
  `;

  // プリセット変更
  const sel = document.getElementById("preset-select") as HTMLSelectElement;
  sel.value = String(PRESETS.indexOf(PRESETS.find(p => {
    const b = p.build();
    return b.routers.length === r.routers.length;
  }) ?? PRESETS[0]!));
  sel.addEventListener("change", () => {
    run(Number(sel.value));
    const desc = document.getElementById("preset-desc");
    if (desc) desc.textContent = PRESETS[Number(sel.value)]?.description ?? "";
  });

  drawTopology(r);
  renderStats(r);
  renderEvents(r);

  if (selectedRouter) {
    renderRib(selectedRouter);
    renderProtoRoutes(selectedRouter);
  }
}

// ─── トポロジ描画 ───

function drawTopology(r: SimulationResult): void {
  const canvas = document.getElementById("topo-canvas") as HTMLCanvasElement;
  if (!canvas) return;
  const ctx = canvas.getContext("2d")!;
  const W = canvas.width;
  const H = canvas.height;

  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, W, H);

  // ASごとのグループ背景
  const asGroups = new Map<number, Router[]>();
  for (const rt of r.routers) {
    const list = asGroups.get(rt.asNumber) ?? [];
    list.push(rt);
    asGroups.set(rt.asNumber, list);
  }

  const asColors = ["#1e293b", "#1a2332", "#231a2e", "#1a2e1a", "#2e2a1a"];
  let asIdx = 0;
  for (const [asNum, members] of asGroups) {
    if (members.length < 2) { asIdx++; continue; }
    const minX = Math.min(...members.map(m => m.x)) - 40;
    const minY = Math.min(...members.map(m => m.y)) - 40;
    const maxX = Math.max(...members.map(m => m.x)) + 40;
    const maxY = Math.max(...members.map(m => m.y)) + 40;

    ctx.fillStyle = asColors[asIdx % asColors.length]!;
    ctx.strokeStyle = "#334155";
    ctx.lineWidth = 1;
    roundRect(ctx, minX, minY, maxX - minX, maxY - minY, 8);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = COLORS.textMuted;
    ctx.font = "11px monospace";
    ctx.fillText(`AS${asNum}`, minX + 6, minY + 14);
    asIdx++;
  }

  // リンク描画
  for (const link of r.links) {
    const fromR = r.routers.find(rt => rt.id === link.from);
    const toR = r.routers.find(rt => rt.id === link.to);
    if (!fromR || !toR) continue;

    ctx.beginPath();
    ctx.moveTo(fromR.x, fromR.y);
    ctx.lineTo(toR.x, toR.y);
    ctx.strokeStyle = link.status === "down" ? COLORS.linkDown : COLORS.link;
    ctx.lineWidth = link.status === "down" ? 1 : 2;
    if (link.status === "down") ctx.setLineDash([4, 4]);
    else ctx.setLineDash([]);
    ctx.stroke();
    ctx.setLineDash([]);

    // コスト表示
    const mx = (fromR.x + toR.x) / 2;
    const my = (fromR.y + toR.y) / 2;
    ctx.fillStyle = link.status === "down" ? COLORS.linkDown : COLORS.textMuted;
    ctx.font = "10px monospace";
    ctx.textAlign = "center";
    ctx.fillText(String(link.cost), mx, my - 6);
  }

  // ルーター描画
  for (const rt of r.routers) {
    const isSelected = selectedRouter?.id === rt.id;
    const radius = 20;

    // プロトコルカラーで色分け
    const proto = rt.enabledProtocols[0] ?? "static";
    const color = PROTO_COLORS[proto];

    ctx.beginPath();
    ctx.arc(rt.x, rt.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = isSelected ? COLORS.selected + "33" : color + "22";
    ctx.fill();
    ctx.strokeStyle = isSelected ? COLORS.selected : color;
    ctx.lineWidth = isSelected ? 3 : 2;
    ctx.stroke();

    // ルーター名
    ctx.fillStyle = COLORS.text;
    ctx.font = "bold 12px monospace";
    ctx.textAlign = "center";
    ctx.fillText(rt.name, rt.x, rt.y + 4);

    // プロトコルバッジ
    const badges = rt.enabledProtocols.map(p => PROTO_LABELS[p]);
    ctx.font = "8px monospace";
    ctx.fillStyle = COLORS.textMuted;
    ctx.fillText(badges.join("+"), rt.x, rt.y + radius + 12);
  }

  // クリックイベント
  canvas.onclick = (e) => {
    const rect = canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;

    for (const rt of r.routers) {
      const dx = cx - rt.x;
      const dy = cy - rt.y;
      if (dx * dx + dy * dy < 25 * 25) {
        selectedRouter = rt;
        renderRib(rt);
        renderProtoRoutes(rt);
        drawTopology(r);
        return;
      }
    }
  };
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// ─── 統計情報 ───

function renderStats(r: SimulationResult): void {
  const el = document.getElementById("stats");
  if (!el) return;

  const protos = new Set<Protocol>();
  for (const rt of r.routers) {
    for (const p of rt.enabledProtocols) protos.add(p);
  }

  const items: Array<{ label: string; value: string; color: string }> = [
    { label: "ルーター数", value: String(r.routers.length), color: COLORS.text },
    { label: "リンク数", value: String(r.links.length), color: COLORS.text },
    { label: "総tick", value: String(r.ticks), color: COLORS.accent },
    { label: "イベント数", value: String(r.events.length), color: COLORS.accent },
  ];

  for (const p of protos) {
    const convTick = r.convergence[p];
    items.push({
      label: `${PROTO_LABELS[p]}収束`,
      value: convTick !== undefined ? `tick ${convTick}` : "N/A",
      color: PROTO_COLORS[p],
    });
  }

  el.innerHTML = items.map(it => `
    <div class="stat-item">
      <span class="stat-label">${it.label}</span>
      <span class="stat-value" style="color:${it.color}">${it.value}</span>
    </div>
  `).join("");
}

// ─── RIBテーブル ───

function renderRib(router: Router): void {
  const titleEl = document.getElementById("rib-title");
  const contentEl = document.getElementById("rib-content");
  if (!titleEl || !contentEl) return;

  titleEl.textContent = `RIB: ${router.name} (AS${router.asNumber})`;

  if (router.rib.length === 0) {
    contentEl.innerHTML = "<p class='muted'>経路なし</p>";
    return;
  }

  contentEl.innerHTML = `
    <table class="rib-table">
      <thead>
        <tr>
          <th>宛先</th>
          <th>次ホップ</th>
          <th>メトリック</th>
          <th>AD</th>
          <th>プロトコル</th>
          <th>パス</th>
        </tr>
      </thead>
      <tbody>
        ${router.rib.map(r => `
          <tr>
            <td>${r.destination}</td>
            <td>${r.nextHop}</td>
            <td>${r.metric}</td>
            <td>${r.ad}</td>
            <td><span class="proto-badge" style="background:${PROTO_COLORS[r.protocol]}22;color:${PROTO_COLORS[r.protocol]};border:1px solid ${PROTO_COLORS[r.protocol]}44">${PROTO_LABELS[r.protocol]}</span></td>
            <td class="path-cell">${r.path.join(" → ")}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

// ─── プロトコル別経路 ───

function renderProtoRoutes(router: Router): void {
  const el = document.getElementById("proto-routes");
  if (!el) return;

  const sections: string[] = [];

  for (const proto of router.enabledProtocols) {
    const routes = router.protocolRoutes.get(proto) ?? [];
    const color = PROTO_COLORS[proto];

    let details = "";
    if (proto === "bgp") {
      details = renderBgpDetails(router);
    } else if (proto === "ospf") {
      details = renderOspfDetails(router);
    } else if (proto === "rip") {
      details = renderRipDetails(router);
    }

    sections.push(`
      <div class="proto-section" style="border-left: 3px solid ${color}">
        <h3 style="color:${color}">${PROTO_LABELS[proto]} (${routes.length}経路, AD=${proto === "bgp" ? "20/200" : String(routes[0]?.ad ?? "-")})</h3>
        ${details}
        ${routes.length > 0 ? `
          <div class="route-list">
            ${routes.map(r => `
              <div class="route-item">
                <span class="dest">${r.destination}</span>
                <span class="arrow">→</span>
                <span class="nh">${r.nextHop}</span>
                <span class="metric">metric=${r.metric}</span>
                ${r.bgpAttrs ? `<span class="bgp-info">LP=${r.bgpAttrs.localPref} ASPath=[${r.bgpAttrs.asPath.join(",")}]</span>` : ""}
              </div>
            `).join("")}
          </div>
        ` : "<p class='muted'>経路なし</p>"}
      </div>
    `);
  }

  el.innerHTML = sections.join("");
}

function renderBgpDetails(router: Router): string {
  const state = router.bgpState;
  return `
    <div class="detail-block">
      <div class="detail-label">ピア:</div>
      ${state.peers.map(p => `
        <div class="detail-item">
          ${p.peerId} (${p.type}, AS${p.peerAs}, ${p.state})
          <span class="detail-count">受信=${p.receivedRoutes.length}</span>
        </div>
      `).join("")}
      <div class="detail-label">Adj-RIB-In: ${state.adjRibIn.length}経路 / Loc-RIB: ${state.locRib.length}経路</div>
    </div>
  `;
}

function renderOspfDetails(router: Router): string {
  const state = router.ospfState;
  return `
    <div class="detail-block">
      <div class="detail-label">エリア: ${router.ospfArea}${router.isABR ? " (ABR)" : ""}</div>
      <div class="detail-label">LSDB: ${state.lsdb.length} LSA</div>
      <div class="detail-label">隣接: ${state.neighborTable.map(n => `${n.routerId}(${n.state})`).join(", ")}</div>
    </div>
  `;
}

function renderRipDetails(router: Router): string {
  const dv = router.ripState.distanceVector;
  return `
    <div class="detail-block">
      <div class="detail-label">距離ベクトル:</div>
      ${[...dv.entries()].map(([dest, entry]) => `
        <div class="detail-item">${dest}: metric=${entry.metric} via ${entry.nextHop}</div>
      `).join("")}
      <div class="detail-label">SplitHorizon: ${router.ripState.splitHorizon ? "有効" : "無効"}</div>
    </div>
  `;
}

// ─── イベントログ ───

function renderEvents(r: SimulationResult): void {
  const el = document.getElementById("events");
  if (!el) return;

  el.innerHTML = r.events.map(e => {
    const color = e.protocol ? PROTO_COLORS[e.protocol] : COLORS.textMuted;
    const badge = e.protocol ? PROTO_LABELS[e.protocol] : e.type;
    return `
      <div class="event-item">
        <span class="event-tick">t${e.tick}</span>
        <span class="event-badge" style="background:${color}22;color:${color};border:1px solid ${color}44">${badge}</span>
        <span class="event-msg">${e.message}</span>
      </div>
    `;
  }).join("");
}

// ─── 初期化 ───

function init(): void {
  document.body.style.margin = "0";
  document.body.style.background = COLORS.bg;
  document.body.style.color = COLORS.text;
  document.body.style.fontFamily = "'JetBrains Mono', 'Fira Code', monospace";

  const style = document.createElement("style");
  style.textContent = `
    * { box-sizing: border-box; }
    #app { max-width: 1200px; margin: 0 auto; padding: 16px; }
    .header { margin-bottom: 16px; }
    .header h1 { font-size: 20px; margin: 0 0 8px; color: ${COLORS.accent}; }
    .controls { display: flex; align-items: center; gap: 12px; }
    .controls select {
      background: ${COLORS.card}; color: ${COLORS.text}; border: 1px solid ${COLORS.cardBorder};
      padding: 6px 10px; border-radius: 4px; font-family: inherit; font-size: 13px;
    }
    .desc { color: ${COLORS.textMuted}; font-size: 12px; }
    .main-grid { display: grid; grid-template-columns: 660px 1fr; gap: 12px; }
    .left-col, .right-col { display: flex; flex-direction: column; gap: 12px; }
    .card {
      background: ${COLORS.card}; border: 1px solid ${COLORS.cardBorder};
      border-radius: 6px; padding: 12px;
    }
    .card h2 { margin: 0 0 8px; font-size: 14px; color: ${COLORS.textMuted}; }
    .card h3 { margin: 4px 0; font-size: 12px; }
    canvas { display: block; border-radius: 4px; cursor: pointer; }

    .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
    .stat-item { display: flex; flex-direction: column; }
    .stat-label { font-size: 10px; color: ${COLORS.textMuted}; }
    .stat-value { font-size: 16px; font-weight: bold; }

    .rib-table { width: 100%; border-collapse: collapse; font-size: 11px; }
    .rib-table th { text-align: left; padding: 4px 6px; border-bottom: 1px solid ${COLORS.cardBorder}; color: ${COLORS.textMuted}; font-size: 10px; }
    .rib-table td { padding: 4px 6px; border-bottom: 1px solid ${COLORS.cardBorder}11; }
    .path-cell { font-size: 10px; color: ${COLORS.textMuted}; }
    .proto-badge { padding: 1px 6px; border-radius: 3px; font-size: 10px; }

    .proto-section { padding: 6px 10px; margin-bottom: 8px; }
    .route-list { display: flex; flex-direction: column; gap: 2px; }
    .route-item { display: flex; gap: 6px; font-size: 11px; align-items: center; }
    .dest { font-weight: bold; }
    .arrow { color: ${COLORS.textMuted}; }
    .nh { color: ${COLORS.accent}; }
    .metric { color: ${COLORS.textMuted}; font-size: 10px; }
    .bgp-info { color: ${COLORS.bgp}; font-size: 10px; }

    .detail-block { margin: 4px 0 8px; padding: 4px 0; font-size: 11px; }
    .detail-label { color: ${COLORS.textMuted}; font-size: 10px; margin-top: 2px; }
    .detail-item { padding-left: 8px; font-size: 10px; }
    .detail-count { color: ${COLORS.textMuted}; margin-left: 4px; }
    .muted { color: ${COLORS.textMuted}; font-size: 11px; }

    .event-log { max-height: 300px; overflow-y: auto; }
    .event-item { display: flex; gap: 6px; padding: 2px 0; align-items: center; font-size: 11px; }
    .event-tick { color: ${COLORS.textMuted}; font-size: 10px; min-width: 28px; }
    .event-badge { padding: 1px 5px; border-radius: 3px; font-size: 9px; white-space: nowrap; }
    .event-msg { color: ${COLORS.text}; }

    @media (max-width: 1100px) {
      .main-grid { grid-template-columns: 1fr; }
    }
  `;
  document.head.appendChild(style);

  const app = document.createElement("div");
  app.id = "app";
  document.body.appendChild(app);

  run(0);
}

init();
