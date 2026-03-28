/**
 * app.ts -- ルーティングシミュレータUI
 *
 * Canvas上にルータとリンクを描画し、パケットの転送をアニメーションで表示する。
 * AS(自律システム)ごとに色分けし、パケットがホップしていく様子を見せる。
 */
import { buildInternetTopology } from "../net/topology.js";
import { simulatePacket } from "../net/simulator.js";
import type { NetworkGraph } from "../net/graph.js";
import type { Router, HopEvent } from "../net/types.js";

// ASごとの色
const AS_COLORS: Record<string, { bg: string; border: string; text: string } | undefined> = {
  AS100: { bg: "#1e3a5f", border: "#3b82f6", text: "#93c5fd" },
  AS200: { bg: "#1a3f2e", border: "#10b981", text: "#6ee7b7" },
  AS300: { bg: "#4a1942", border: "#a855f7", text: "#c4b5fd" },
};

export class RoutingApp {
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private logDiv!: HTMLElement;
  private routeTableDiv!: HTMLElement;
  private graph!: NetworkGraph;
  private animating = false;
  private speedMs = 500;

  init(container: HTMLElement): void {
    container.style.cssText = "display:flex;flex-direction:column;height:100vh;font-family:system-ui;background:#0a0a1a;color:#e2e8f0;";

    // ヘッダ
    const header = document.createElement("div");
    header.style.cssText = "padding:10px 20px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #1e293b;flex-wrap:wrap;";

    const title = document.createElement("h1");
    title.textContent = "Internet Routing Simulator";
    title.style.cssText = "margin:0;font-size:16px;color:#f8fafc;";
    header.appendChild(title);

    const srcSelect = document.createElement("select");
    srcSelect.style.cssText = "padding:4px 8px;background:#1e293b;border:1px solid #334155;border-radius:4px;color:#f8fafc;font-size:13px;";
    header.appendChild(this.label("From:"));
    header.appendChild(srcSelect);

    const dstSelect = document.createElement("select");
    dstSelect.style.cssText = srcSelect.style.cssText;
    header.appendChild(this.label("To:"));
    header.appendChild(dstSelect);

    const sendBtn = document.createElement("button");
    sendBtn.textContent = "Send Packet";
    sendBtn.style.cssText = "padding:5px 16px;background:#2563eb;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;";
    header.appendChild(sendBtn);

    const speedLabel = this.label("Speed:");
    const speedSlider = document.createElement("input");
    speedSlider.type = "range";
    speedSlider.min = "100";
    speedSlider.max = "1500";
    speedSlider.value = "500";
    speedSlider.addEventListener("input", () => { this.speedMs = Number(speedSlider.value); });
    speedLabel.appendChild(speedSlider);
    header.appendChild(speedLabel);

    container.appendChild(header);

    // メインエリア
    const main = document.createElement("div");
    main.style.cssText = "flex:1;display:flex;overflow:hidden;";

    // Canvas
    const canvasWrap = document.createElement("div");
    canvasWrap.style.cssText = "flex:1;position:relative;";
    this.canvas = document.createElement("canvas");
    const dpr = window.devicePixelRatio || 1;
    const cw = 780;
    const ch = 540;
    this.canvas.width = cw * dpr;
    this.canvas.height = ch * dpr;
    this.canvas.style.cssText = `width:${String(cw)}px;height:${String(ch)}px;`;
    canvasWrap.appendChild(this.canvas);
    const ctxOrNull = this.canvas.getContext("2d");
    if (ctxOrNull === null) throw new Error("Canvas 2D 取得失敗");
    this.ctx = ctxOrNull;
    this.ctx.scale(dpr, dpr);
    main.appendChild(canvasWrap);

    // 右パネル
    const sidebar = document.createElement("div");
    sidebar.style.cssText = "width:320px;display:flex;flex-direction:column;border-left:1px solid #1e293b;overflow:hidden;";

    const routeTitle = document.createElement("div");
    routeTitle.style.cssText = "padding:8px 12px;font-size:12px;font-weight:600;color:#94a3b8;border-bottom:1px solid #1e293b;";
    routeTitle.textContent = "Routing Table / Hop Log";
    sidebar.appendChild(routeTitle);

    this.routeTableDiv = document.createElement("div");
    this.routeTableDiv.style.cssText = "padding:8px 12px;font-size:11px;max-height:200px;overflow-y:auto;border-bottom:1px solid #1e293b;";
    sidebar.appendChild(this.routeTableDiv);

    this.logDiv = document.createElement("div");
    this.logDiv.style.cssText = "flex:1;overflow-y:auto;font-size:11px;";
    sidebar.appendChild(this.logDiv);

    main.appendChild(sidebar);
    container.appendChild(main);

    // トポロジ構築
    this.graph = buildInternetTopology();

    // セレクトボックスにルータを追加
    for (const [id, r] of this.graph.routers) {
      for (const sel of [srcSelect, dstSelect]) {
        const opt = document.createElement("option");
        opt.value = id;
        opt.textContent = `${id} (${r.ip}) [${r.as}]`;
        sel.appendChild(opt);
      }
    }
    srcSelect.value = "R1";
    dstSelect.value = "R10";

    // ルータクリックでルーティングテーブル表示
    this.canvas.addEventListener("click", (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      for (const [, r] of this.graph.routers) {
        if (Math.hypot(r.x - x, r.y - y) < 20) {
          this.showRouteTable(r);
          break;
        }
      }
    });

    this.drawScene();

    sendBtn.addEventListener("click", () => {
      this.run(srcSelect.value, dstSelect.value);
    });
  }

  private label(text: string): HTMLElement {
    const el = document.createElement("span");
    el.style.cssText = "font-size:12px;color:#94a3b8;display:flex;align-items:center;gap:4px;";
    el.textContent = text;
    return el;
  }

  private async run(srcId: string, dstId: string): Promise<void> {
    if (this.animating) return;
    this.animating = true;
    this.logDiv.innerHTML = "";

    const result = simulatePacket(this.graph, srcId, dstId);
    this.addLog(`Packet: ${result.packet.srcIp} -> ${result.packet.dstIp} (${srcId} -> ${dstId})`, "#f8fafc");

    // 各ホップをアニメーション
    for (const hop of result.hops) {
      this.addLog(
        `  ${hop.fromRouter} -> ${hop.toRouter}  TTL=${String(hop.ttl)}  via ${hop.linkId}  (route: ${hop.routeEntry?.path.join("->") ?? "?"})`,
        this.getRouterColor(hop.fromRouter),
      );
      await this.animateHop(hop);
    }

    if (result.delivered) {
      this.addLog(`Delivered! (${String(result.hops.length)} hops)`, "#10b981");
    } else {
      this.addLog(`Failed: ${result.reason}`, "#ef4444");
    }

    this.animating = false;
    this.drawScene();
  }

  private async animateHop(hop: HopEvent): Promise<void> {
    const from = this.graph.getRouter(hop.fromRouter);
    const to = this.graph.getRouter(hop.toRouter);
    if (from === undefined || to === undefined) return;

    const duration = this.speedMs;
    const start = performance.now();

    return new Promise(resolve => {
      const frame = () => {
        const elapsed = performance.now() - start;
        const t = Math.min(1, elapsed / duration);
        const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

        this.drawScene(hop.fromRouter, hop.toRouter);

        // パケット玉
        const x = from.x + (to.x - from.x) * eased;
        const y = from.y + (to.y - from.y) * eased;
        const ctx = this.ctx;

        // 軌跡
        ctx.strokeStyle = "#f59e0b";
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.4;
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.globalAlpha = 1;

        ctx.fillStyle = "#f59e0b";
        ctx.shadowColor = "#f59e0b";
        ctx.shadowBlur = 15;
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        // TTL表示
        ctx.font = "bold 10px monospace";
        ctx.fillStyle = "#fbbf24";
        ctx.textAlign = "center";
        ctx.fillText(`TTL=${String(hop.ttl)}`, x, y - 12);

        if (t < 1) {
          requestAnimationFrame(frame);
        } else {
          resolve();
        }
      };
      requestAnimationFrame(frame);
    });
  }

  private drawScene(highlightFrom?: string, highlightTo?: string): void {
    const ctx = this.ctx;
    const w = 780;
    const h = 540;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#0a0a1a";
    ctx.fillRect(0, 0, w, h);

    // AS の背景を描画
    this.drawAsBackground();

    // リンク
    for (const link of this.graph.links) {
      const from = this.graph.getRouter(link.from);
      const to = this.graph.getRouter(link.to);
      if (from === undefined || to === undefined) continue;

      const isHighlighted = (highlightFrom === link.from && highlightTo === link.to) ||
                            (highlightFrom === link.to && highlightTo === link.from);
      const isIx = link.id.startsWith("IX");

      ctx.strokeStyle = isHighlighted ? "#f59e0b" : (isIx ? "#475569" : "#334155");
      ctx.lineWidth = isHighlighted ? 3 : (isIx ? 2 : 1.5);
      if (isIx) ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
      ctx.setLineDash([]);

      // コスト表示
      const mx = (from.x + to.x) / 2;
      const my = (from.y + to.y) / 2;
      ctx.font = "9px monospace";
      ctx.fillStyle = "#64748b";
      ctx.textAlign = "center";
      ctx.fillText(`${String(link.cost)}ms`, mx, my - 6);
      if (isIx) {
        ctx.fillStyle = "#94a3b8";
        ctx.fillText(link.id, mx, my + 8);
      }
    }

    // ルータ
    for (const [, router] of this.graph.routers) {
      this.drawRouter(router, highlightFrom === router.id || highlightTo === router.id);
    }
  }

  private drawAsBackground(): void {
    const ctx = this.ctx;
    // ASごとにルータの位置から領域を推定して背景を描く
    const asGroups = new Map<string, Router[]>();
    for (const [, r] of this.graph.routers) {
      const group = asGroups.get(r.as);
      if (group !== undefined) { group.push(r); } else { asGroups.set(r.as, [r]); }
    }

    for (const [asName, routers] of asGroups) {
      const colors = AS_COLORS[asName];
      if (colors === undefined) continue;

      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const r of routers) {
        if (r.x < minX) minX = r.x;
        if (r.y < minY) minY = r.y;
        if (r.x > maxX) maxX = r.x;
        if (r.y > maxY) maxY = r.y;
      }
      const pad = 40;

      ctx.fillStyle = colors.bg;
      ctx.globalAlpha = 0.4;
      ctx.beginPath();
      ctx.roundRect(minX - pad, minY - pad, maxX - minX + pad * 2, maxY - minY + pad * 2, 12);
      ctx.fill();
      ctx.globalAlpha = 1;

      ctx.strokeStyle = colors.border;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.3;
      ctx.beginPath();
      ctx.roundRect(minX - pad, minY - pad, maxX - minX + pad * 2, maxY - minY + pad * 2, 12);
      ctx.stroke();
      ctx.globalAlpha = 1;

      // ASラベル
      ctx.font = "bold 11px system-ui";
      ctx.fillStyle = colors.text;
      ctx.globalAlpha = 0.6;
      ctx.textAlign = "left";
      ctx.fillText(asName, minX - pad + 8, minY - pad + 16);
      ctx.globalAlpha = 1;
    }
  }

  private drawRouter(router: Router, highlighted: boolean): void {
    const ctx = this.ctx;
    const colors = AS_COLORS[router.as];
    const borderColor = highlighted ? "#f59e0b" : (colors?.border ?? "#475569");
    const bgColor = colors?.bg ?? "#1e293b";

    ctx.fillStyle = bgColor;
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = highlighted ? 3 : 2;
    ctx.beginPath();
    ctx.arc(router.x, router.y, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // ルータID
    ctx.font = "bold 11px monospace";
    ctx.fillStyle = "#f8fafc";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(router.id, router.x, router.y);

    // IP
    ctx.font = "9px monospace";
    ctx.fillStyle = colors?.text ?? "#94a3b8";
    ctx.textBaseline = "top";
    ctx.fillText(router.ip, router.x, router.y + 22);
  }

  private showRouteTable(router: Router): void {
    this.routeTableDiv.innerHTML = "";
    const title = document.createElement("div");
    title.style.cssText = "font-weight:bold;color:#f8fafc;margin-bottom:4px;";
    title.textContent = `${router.id} (${router.ip}) [${router.as}]`;
    this.routeTableDiv.appendChild(title);

    const table = document.createElement("table");
    table.style.cssText = "width:100%;border-collapse:collapse;font-family:monospace;";

    // ヘッダ
    const thead = document.createElement("tr");
    for (const h of ["Dest", "NextHop", "Cost", "Path"]) {
      const th = document.createElement("th");
      th.style.cssText = "text-align:left;padding:2px 4px;color:#94a3b8;border-bottom:1px solid #334155;font-size:10px;";
      th.textContent = h;
      thead.appendChild(th);
    }
    table.appendChild(thead);

    for (const route of router.routingTable) {
      const tr = document.createElement("tr");
      const cells = [route.destination, route.nextHop, String(route.cost), route.path.join("->")];
      for (const text of cells) {
        const td = document.createElement("td");
        td.style.cssText = "padding:2px 4px;color:#e2e8f0;border-bottom:1px solid #1e293b;font-size:10px;";
        td.textContent = text;
        tr.appendChild(td);
      }
      table.appendChild(tr);
    }
    this.routeTableDiv.appendChild(table);
  }

  private addLog(text: string, color: string): void {
    const row = document.createElement("div");
    row.style.cssText = `padding:3px 12px;color:${color};font-family:monospace;border-bottom:1px solid #1e293b11;`;
    row.textContent = text;
    this.logDiv.appendChild(row);
    this.logDiv.scrollTop = this.logDiv.scrollHeight;
  }

  private getRouterColor(id: string): string {
    const router = this.graph.getRouter(id);
    if (router === undefined) return "#94a3b8";
    return AS_COLORS[router.as]?.text ?? "#94a3b8";
  }
}
