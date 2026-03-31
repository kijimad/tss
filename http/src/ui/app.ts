/**
 * app.ts — TCP/IP + HTTP 通信ビジュアライザ
 *
 * Canvas でネットワーク図を描画し、レイヤーごとに段を分けて
 * パケットの処理過程を可視化する。
 *
 *   ┌─ L7 HTTP ──────────────────────────────────┐
 *   │  GET /path HTTP/1.1                         │
 *   ├─ L4 TCP ───────────────────────────────────┤
 *   │  :49152 → :80 [SYN] seq=1000               │
 *   ├─ L3 IP ────────────────────────────────────┤
 *   │  192.168.1.10 → 93.184.216.34  TTL=64      │
 *   ├─ L2 Ethernet ──────────────────────────────┤
 *   │  AA:00:01 → AA:00:02  [IPv4]               │
 *   └────────────────────────────────────────────┘
 */
import { NetworkNode } from "../devices/node.js";
import { Link } from "../devices/link.js";
import type { StackEvent } from "../stack/types.js";

// レイヤー定義
interface LayerDef {
  name: string;
  color: string;
  bgColor: string;
  types: string[];
}

// プリセット例の定義
interface Example {
  name: string;
  url: string;
  speed: number;
}

const EXAMPLES: Example[] = [
  { name: "GET リクエスト",     url: "http://93.184.216.34/index.html", speed: 300 },
  { name: "API エンドポイント", url: "http://93.184.216.34/api/users",  speed: 300 },
  { name: "404 Not Found",      url: "http://93.184.216.34/not-found",  speed: 300 },
  { name: "大きなレスポンス",   url: "http://93.184.216.34/large-file", speed: 500 },
];

const LAYERS: LayerDef[] = [
  { name: "L7 HTTP",     color: "#ec4899", bgColor: "#4a0930", types: ["http_request", "http_response"] },
  { name: "L4 TCP",      color: "#10b981", bgColor: "#022c22", types: ["tcp_send", "tcp_recv", "tcp_state_change"] },
  { name: "L3 IP",       color: "#3b82f6", bgColor: "#172554", types: ["ip_send", "ip_recv", "ip_forward", "ip_nat", "route_lookup"] },
  { name: "L2 Ethernet", color: "#a855f7", bgColor: "#2e1065", types: ["ethernet_send", "ethernet_recv", "arp_request", "arp_reply"] },
];

interface DeviceView {
  node: NetworkNode;
  label: string;
  icon: string;
  x: number;
  y: number;
}

export class NetApp {
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private layerLogDiv!: HTMLElement;

  private devices: DeviceView[] = [];
  private allEvents: { device: string; event: StackEvent }[] = [];
  private animating = false;
  private speedMs = 300;
  private stepMode = false;
  // ステップ実行時に次のクリックを待つための resolve 関数
  private stepResolve: (() => void) | null = null;
  private stepCounter!: HTMLElement;

  private pc!: NetworkNode;
  private router!: NetworkNode;
  private server!: NetworkNode;

  // 現在ハイライト中のレイヤー
  private activeLayer = "";
  // 現在のフェーズ名
  private currentPhase = "";
  // 全レイヤー通しの連番
  private eventSeqNo = 0;

  init(container: HTMLElement): void {
    container.style.cssText = "display:flex;flex-direction:column;height:100vh;font-family:system-ui,-apple-system,sans-serif;background:#0f172a;color:#e2e8f0;";

    // ヘッダ
    const header = document.createElement("div");
    header.style.cssText = "padding:10px 20px;display:flex;align-items:center;gap:12px;border-bottom:1px solid #1e293b;flex-wrap:wrap;";

    const title = document.createElement("h1");
    title.textContent = "TCP/IP + HTTP 通信シミュレータ";
    title.style.cssText = "margin:0;font-size:16px;color:#f8fafc;";
    header.appendChild(title);

    // プリセット例の選択ドロップダウン
    const exampleSelect = document.createElement("select");
    exampleSelect.style.cssText = "padding:5px 10px;background:#1e293b;border:1px solid #334155;border-radius:6px;color:#f8fafc;font-size:13px;cursor:pointer;";
    // デフォルト選択肢
    const defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.textContent = "-- 例を選択 --";
    exampleSelect.appendChild(defaultOption);
    // 各プリセット例をオプションとして追加
    for (const example of EXAMPLES) {
      const option = document.createElement("option");
      option.value = example.name;
      option.textContent = example.name;
      exampleSelect.appendChild(option);
    }
    header.appendChild(exampleSelect);

    const input = document.createElement("input");
    input.type = "text";
    input.value = "http://93.184.216.34/";
    input.style.cssText = "flex:1;max-width:300px;padding:5px 10px;background:#1e293b;border:1px solid #334155;border-radius:6px;color:#f8fafc;font-size:13px;";
    header.appendChild(input);

    const goBtn = document.createElement("button");
    goBtn.textContent = "▶ 自動再生";
    goBtn.style.cssText = "padding:5px 16px;background:#2563eb;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;";
    header.appendChild(goBtn);

    const stepStartBtn = document.createElement("button");
    stepStartBtn.textContent = "⏭ ステップ実行";
    stepStartBtn.style.cssText = "padding:5px 16px;background:#7c3aed;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;";
    header.appendChild(stepStartBtn);

    const nextBtn = document.createElement("button");
    nextBtn.textContent = "次へ →";
    nextBtn.style.cssText = "padding:5px 16px;background:#059669;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;display:none;";
    header.appendChild(nextBtn);

    this.stepCounter = document.createElement("span");
    this.stepCounter.style.cssText = "font-size:12px;color:#94a3b8;font-family:monospace;display:none;";
    header.appendChild(this.stepCounter);

    const speedLabel = document.createElement("label");
    speedLabel.style.cssText = "font-size:11px;color:#94a3b8;display:flex;align-items:center;gap:4px;";
    speedLabel.textContent = "速度:";
    const speedSlider = document.createElement("input");
    speedSlider.type = "range";
    speedSlider.min = "50";
    speedSlider.max = "1000";
    speedSlider.value = "300";
    speedSlider.addEventListener("input", () => { this.speedMs = Number(speedSlider.value); });
    speedLabel.appendChild(speedSlider);
    header.appendChild(speedLabel);

    container.appendChild(header);

    // メインエリア: Canvas（上） + レイヤー別ログ（下）
    const main = document.createElement("div");
    main.style.cssText = "flex:1;display:flex;flex-direction:column;overflow:hidden;";

    // Canvas
    this.canvas = document.createElement("canvas");
    const cssWidth = 800;
    const cssHeight = 200;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = cssWidth * dpr;
    this.canvas.height = cssHeight * dpr;
    this.canvas.style.cssText = `width:${String(cssWidth)}px;height:${String(cssHeight)}px;flex-shrink:0;`;
    main.appendChild(this.canvas);

    const ctxOrNull = this.canvas.getContext("2d");
    if (ctxOrNull === null) throw new Error("Canvas context 取得失敗");
    this.ctx = ctxOrNull;
    this.ctx.scale(dpr, dpr);

    // レイヤー別ログエリア
    this.layerLogDiv = document.createElement("div");
    this.layerLogDiv.style.cssText = "flex:1;display:flex;flex-direction:column;overflow:hidden;border-top:1px solid #1e293b;";
    this.buildLayerPanels();
    main.appendChild(this.layerLogDiv);

    container.appendChild(main);

    this.buildNetwork();
    this.drawScene();

    // 自動再生
    goBtn.addEventListener("click", () => {
      const url = input.value.trim();
      if (url) {
        this.stepMode = false;
        nextBtn.style.display = "none";
        this.stepCounter.style.display = "none";
        this.run(url);
      }
    });

    // ステップ実行開始
    stepStartBtn.addEventListener("click", () => {
      const url = input.value.trim();
      if (url) {
        this.stepMode = true;
        nextBtn.style.display = "";
        this.stepCounter.style.display = "";
        this.run(url);
      }
    });

    // 次のステップへ進む
    nextBtn.addEventListener("click", () => {
      if (this.stepResolve !== null) {
        this.stepResolve();
        this.stepResolve = null;
      }
    });

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const url = input.value.trim();
        if (url) {
          this.stepMode = false;
          nextBtn.style.display = "none";
          this.stepCounter.style.display = "none";
          this.run(url);
        }
      }
    });

    // プリセット例の選択時に URL と速度スライダーを更新
    exampleSelect.addEventListener("change", () => {
      const selected = EXAMPLES.find(ex => ex.name === exampleSelect.value);
      if (selected === undefined) return;
      input.value = selected.url;
      speedSlider.value = String(selected.speed);
      this.speedMs = selected.speed;
    });
  }

  // レイヤー別パネルを構築
  private buildLayerPanels(): void {
    this.layerLogDiv.innerHTML = "";
    for (const layer of LAYERS) {
      const panel = document.createElement("div");
      panel.dataset["layer"] = layer.name;
      panel.style.cssText = `
        border-bottom:1px solid #1e293b;
        background:${layer.bgColor};
        transition:background 0.3s;
        overflow:hidden;
        display:flex;
        flex-direction:column;
        min-height:0;
        flex:1;
      `;

      // レイヤーヘッダ
      const header = document.createElement("div");
      header.style.cssText = `
        padding:4px 12px;
        font-size:11px;
        font-weight:700;
        color:${layer.color};
        border-bottom:1px solid ${layer.color}33;
        display:flex;
        align-items:center;
        gap:8px;
        flex-shrink:0;
      `;
      // 色付きドット
      const dot = document.createElement("span");
      dot.style.cssText = `width:8px;height:8px;border-radius:50%;background:${layer.color};display:inline-block;`;
      header.appendChild(dot);
      header.appendChild(document.createTextNode(layer.name));
      panel.appendChild(header);

      // ログ行コンテナ
      const logContainer = document.createElement("div");
      logContainer.dataset["logContainer"] = layer.name;
      logContainer.style.cssText = "flex:1;overflow-y:auto;font-size:11px;font-family:monospace;padding:2px 0;";
      panel.appendChild(logContainer);

      this.layerLogDiv.appendChild(panel);
    }
  }

  private clearLayerLogs(): void {
    this.eventSeqNo = 0;
    for (const layer of LAYERS) {
      const container = this.layerLogDiv.querySelector(`[data-log-container="${layer.name}"]`);
      if (container !== null) {
        container.innerHTML = "";
      }
    }
  }

  private buildNetwork(): void {
    const lanLink = new Link("lan");
    const wanLink = new Link("wan");

    this.pc = new NetworkNode("PC");
    this.pc.addNic("eth0", "AA:00:00:00:00:01", "192.168.1.10", "255.255.255.0");
    this.pc.connectLink("eth0", lanLink);
    this.pc.addRoute("192.168.1.0", "255.255.255.0", "0.0.0.0", "eth0");
    this.pc.addDefaultRoute("192.168.1.1", "eth0");
    // ARP エントリなし → 通信時に ARP で解決される

    this.router = new NetworkNode("Router");
    this.router.addNic("lan0", "AA:00:00:00:00:02", "192.168.1.1", "255.255.255.0");
    this.router.addNic("wan0", "BB:00:00:00:00:01", "203.0.113.1", "255.255.255.0");
    this.router.connectLink("lan0", lanLink);
    this.router.connectLink("wan0", wanLink);
    this.router.addRoute("192.168.1.0", "255.255.255.0", "0.0.0.0", "lan0");
    this.router.addRoute("0.0.0.0", "0.0.0.0", "0.0.0.0", "wan0");
    this.router.ipForwardingEnabled = true;
    this.router.natEnabled = true;
    // ARP エントリなし → 通信時に ARP で解決される

    this.server = new NetworkNode("Server");
    this.server.addNic("eth0", "CC:00:00:00:00:01", "93.184.216.34", "255.255.255.0");
    this.server.connectLink("eth0", wanLink);
    this.server.addRoute("0.0.0.0", "0.0.0.0", "0.0.0.0", "eth0");
    // ARP エントリなし → 通信時に ARP で解決される
    this.server.listen(80, (req) => ({
      version: "HTTP/1.1",
      statusCode: 200,
      statusText: "OK",
      headers: new Map([["Content-Type", "text/html"], ["Server", "HttpSim/1.0"]]),
      body: `<html><body><h1>Hello!</h1><p>Path: ${req.path}</p></body></html>`,
    }));

    this.devices = [
      { node: this.pc, label: "PC\n192.168.1.10\nMAC: AA:...:01", icon: "💻", x: 100, y: 100 },
      { node: this.router, label: "ルータ\nLAN: 192.168.1.1\nWAN: 203.0.113.1", icon: "📡", x: 400, y: 100 },
      { node: this.server, label: "サーバ\n93.184.216.34\nMAC: CC:...:01", icon: "🖥️", x: 700, y: 100 },
    ];
  }

  private async run(url: string): Promise<void> {
    if (this.animating) return;
    this.animating = true;
    this.clearLayerLogs();
    this.allEvents = [];

    this.pc.resetEvents();
    this.router.resetEvents();
    this.server.resetEvents();

    this.pc.onEvent = (e) => this.allEvents.push({ device: "PC", event: e });
    this.router.onEvent = (e) => this.allEvents.push({ device: "Router", event: e });
    this.server.onEvent = (e) => this.allEvents.push({ device: "Server", event: e });

    const withoutProto = url.replace(/^https?:\/\//, "");
    const slashIdx = withoutProto.indexOf("/");
    const host = slashIdx >= 0 ? withoutProto.slice(0, slashIdx) : withoutProto;
    const path = slashIdx >= 0 ? withoutProto.slice(slashIdx) : "/";

    this.pc.sendHttpRequest(host, 80, {
      method: "GET", path, version: "HTTP/1.1",
      headers: new Map([["Host", host], ["User-Agent", "HttpSim/1.0"], ["Connection", "close"]]),
      body: "",
    });

    // イベントを Ethernet 送信単位の「ステップ」に分割
    // 1ステップ = 内部イベント群 + Ethernet送信アニメーション
    const steps = this.groupIntoSteps(this.allEvents);

    for (let s = 0; s < steps.length; s++) {
      const step = steps[s];
      if (step === undefined) continue;

      // ステップモード: 次へボタンのクリックを待つ
      if (this.stepMode && s > 0) {
        this.stepCounter.textContent = `Step ${String(s)} / ${String(steps.length - 1)}`;
        this.drawScene();
        await new Promise<void>(resolve => {
          this.stepResolve = resolve;
        });
      }

      // ステップ内の全イベントを処理
      for (const item of step.events) {
        const layer = this.findLayer(item.event.type);
        this.activeLayer = layer?.name ?? "";
        this.currentPhase = this.detectPhase(item.event);
        this.addLayerLogEntry(item.device, item.event, layer);
      }

      // アニメーション（Ethernet送信があれば）
      if (step.animation !== undefined) {
        const { from, to, layer } = step.animation;
        await this.animatePacket(from, to, layer);
      }

      // ステップカウンタ更新
      if (this.stepMode) {
        this.stepCounter.textContent = `Step ${String(s + 1)} / ${String(steps.length)}`;
      }
    }

    this.activeLayer = "";
    this.currentPhase = "";
    this.animating = false;
    this.stepCounter.textContent = "完了";
    this.drawScene();
  }

  // イベント列を「ステップ」に分割する
  // Ethernet送信を区切りとして、その前の内部イベントをまとめる
  private groupIntoSteps(
    events: { device: string; event: StackEvent }[],
  ): { events: { device: string; event: StackEvent }[]; animation: { from: DeviceView; to: DeviceView; layer: LayerDef | undefined } | undefined }[] {
    const steps: { events: { device: string; event: StackEvent }[]; animation: { from: DeviceView; to: DeviceView; layer: LayerDef | undefined } | undefined }[] = [];
    let currentEvents: { device: string; event: StackEvent }[] = [];

    for (let i = 0; i < events.length; i++) {
      const item = events[i];
      if (item === undefined) continue;

      currentEvents.push(item);

      if (item.event.type === "ethernet_send") {
        // 対応する受信イベントを探す
        const recvEvent = events.slice(i + 1).find(
          e => e !== undefined && e.event.type === "ethernet_recv" && e.device !== item.device,
        );
        const fromDev = this.devices.find(d => d.node.name === item.device);
        const toDev = recvEvent !== undefined
          ? this.devices.find(d => d.node.name === recvEvent.device)
          : undefined;

        const layer = this.findLayer(item.event.type);
        const animation = (fromDev !== undefined && toDev !== undefined)
          ? { from: fromDev, to: toDev, layer }
          : undefined;

        steps.push({ events: currentEvents, animation });
        currentEvents = [];
      }
    }

    // 残りのイベント（Ethernet送信を伴わないもの）
    if (currentEvents.length > 0) {
      steps.push({ events: currentEvents, animation: undefined });
    }

    return steps;
  }

  private findLayer(eventType: string): LayerDef | undefined {
    return LAYERS.find(l => l.types.includes(eventType));
  }

  // 現在の通信フェーズを判定（Canvas上に表示）
  private detectPhase(event: StackEvent): string {
    switch (event.type) {
      case "tcp_state_change":
        if (event.to === "SYN_SENT") return "TCP 3ウェイハンドシェイク";
        if (event.to === "ESTABLISHED") return "TCP 接続確立";
        if (event.to === "FIN_WAIT_1" || event.to === "CLOSE_WAIT") return "TCP 接続終了";
        if (event.to === "CLOSED") return "完了";
        return this.currentPhase;
      case "http_request": return "HTTP リクエスト送信";
      case "http_response": return "HTTP レスポンス受信";
      default: return this.currentPhase;
    }
  }

  private async animatePacket(from: DeviceView, to: DeviceView, layer: LayerDef | undefined): Promise<void> {
    const startTime = performance.now();
    const duration = this.speedMs;
    const color = layer?.color ?? "#6b7280";

    return new Promise(resolve => {
      const frame = () => {
        const elapsed = performance.now() - startTime;
        const t = Math.min(1, elapsed / duration);
        const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

        this.drawScene();

        // パケット描画
        const x = from.x + (to.x - from.x) * eased;
        const y = from.y + (to.y - from.y) * eased - Math.sin(eased * Math.PI) * 30;
        const ctx = this.ctx;

        // 光跡
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.3;
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.quadraticCurveTo((from.x + to.x) / 2, from.y - 30, x, y);
        ctx.stroke();
        ctx.globalAlpha = 1;

        // パケット玉
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = 15;
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        if (t < 1) {
          requestAnimationFrame(frame);
        } else {
          resolve();
        }
      };
      requestAnimationFrame(frame);
    });
  }

  private drawScene(): void {
    const ctx = this.ctx;
    const w = 800;
    const h = 200;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, w, h);

    // 接続線
    ctx.strokeStyle = "#334155";
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 3]);
    for (let i = 0; i < this.devices.length - 1; i++) {
      const a = this.devices[i];
      const b = this.devices[i + 1];
      if (a === undefined || b === undefined) continue;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();

      ctx.font = "9px monospace";
      ctx.fillStyle = "#475569";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(i === 0 ? "LAN" : "WAN", (a.x + b.x) / 2, a.y + 8);
    }
    ctx.setLineDash([]);

    // 機器
    for (const dev of this.devices) {
      ctx.fillStyle = "#1e293b";
      ctx.strokeStyle = "#475569";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(dev.x, dev.y, 26, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.font = "22px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(dev.icon, dev.x, dev.y);

      ctx.font = "9px system-ui";
      ctx.fillStyle = "#94a3b8";
      ctx.textBaseline = "top";
      const lines = dev.label.split("\n");
      for (let j = 0; j < lines.length; j++) {
        const line = lines[j];
        if (line !== undefined) {
          ctx.fillText(line, dev.x, dev.y + 32 + j * 12);
        }
      }
    }

    // フェーズ表示
    if (this.currentPhase) {
      const layerDef = LAYERS.find(l => l.name === this.activeLayer);
      ctx.font = "bold 13px system-ui";
      ctx.fillStyle = layerDef?.color ?? "#f8fafc";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(this.currentPhase, w / 2, 10);
    }

    // アクティブレイヤー インジケータ
    if (this.activeLayer) {
      const layerDef = LAYERS.find(l => l.name === this.activeLayer);
      if (layerDef !== undefined) {
        ctx.fillStyle = layerDef.color;
        ctx.globalAlpha = 0.15;
        ctx.fillRect(0, h - 4, w, 4);
        ctx.globalAlpha = 1;
      }
    }
  }

  // レイヤー別ログにエントリ追加
  private addLayerLogEntry(device: string, event: StackEvent, layer: LayerDef | undefined): void {
    if (layer === undefined) return;

    const container = this.layerLogDiv.querySelector(`[data-log-container="${layer.name}"]`);
    if (container === null) return;

    this.eventSeqNo++;
    const seqNo = this.eventSeqNo;

    const row = document.createElement("div");
    row.style.cssText = `padding:2px 12px;display:flex;gap:6px;align-items:baseline;border-bottom:1px solid ${layer.color}11;`;

    // 連番
    const seqSpan = document.createElement("span");
    seqSpan.style.cssText = `font-size:9px;color:${layer.color};min-width:22px;text-align:right;opacity:0.7;`;
    seqSpan.textContent = String(seqNo);
    row.appendChild(seqSpan);

    const devSpan = document.createElement("span");
    devSpan.style.cssText = "font-size:9px;color:#64748b;min-width:42px;";
    devSpan.textContent = device;
    row.appendChild(devSpan);

    const typeSpan = document.createElement("span");
    typeSpan.style.cssText = `font-size:9px;font-weight:700;color:${layer.color};min-width:60px;`;
    typeSpan.textContent = this.eventTypeLabel(event);
    row.appendChild(typeSpan);

    const detailSpan = document.createElement("span");
    detailSpan.style.cssText = "color:#94a3b8;word-break:break-all;";
    detailSpan.textContent = this.eventDetail(event);
    row.appendChild(detailSpan);

    container.appendChild(row);
    container.scrollTop = container.scrollHeight;

    // アクティブレイヤーのパネルをハイライト
    for (const panel of this.layerLogDiv.children) {
      const el = panel as HTMLElement;
      if (el.dataset["layer"] === layer.name) {
        el.style.boxShadow = `inset 2px 0 0 ${layer.color}`;
      } else {
        el.style.boxShadow = "none";
      }
    }
  }

  private eventTypeLabel(event: StackEvent): string {
    switch (event.type) {
      case "ethernet_send": return "送信";
      case "ethernet_recv": return "受信";
      case "arp_request": return "ARP要求";
      case "arp_reply": return "ARP応答";
      case "ip_send": return "送信";
      case "ip_recv": return "受信";
      case "ip_forward": return "転送";
      case "ip_nat": return "NAT";
      case "tcp_send": return "送信";
      case "tcp_recv": return "受信";
      case "tcp_state_change": return "状態遷移";
      case "http_request": return "リクエスト";
      case "http_response": return "レスポンス";
      case "route_lookup": return "経路探索";
    }
  }

  private eventDetail(event: StackEvent): string {
    switch (event.type) {
      case "ethernet_send":
      case "ethernet_recv":
        return `${event.srcMac} → ${event.dstMac} [${event.etherType === 0x0800 ? "IPv4" : "ARP"}] ${String(event.size)}B`;
      case "arp_request":
        return `Who has ${event.targetIp}? Tell ${event.srcIp} (${event.srcMac})`;
      case "arp_reply":
        return `${event.srcIp} is at ${event.srcMac}`;
      case "ip_send":
      case "ip_recv":
        return `${event.srcIp} → ${event.dstIp} TTL=${String(event.type === "ip_send" ? (event as { ttl: number }).ttl : "")} ${String(event.size)}B`;
      case "ip_forward":
        return `${event.srcIp} → ${event.dstIp}  [${event.fromIface} → ${event.toIface}]`;
      case "ip_nat":
        return `src: ${event.originalSrc} → ${event.translatedSrc}  (dst: ${event.dstIp})`;
      case "tcp_send":
      case "tcp_recv":
        return `:${String(event.srcPort)} → :${String(event.dstPort)}  [${event.flags}]  seq=${String(event.seq)} ack=${String(event.ack)}  ${event.size > 0 ? String(event.size) + "B data" : ""}`;
      case "tcp_state_change":
        return `${event.from} → ${event.to}`;
      case "http_request":
        return `${event.method} ${event.path}  Host: ${event.host}`;
      case "http_response":
        return `${String(event.statusCode)} ${event.statusText}  (${String(event.bodySize)}B)`;
      case "route_lookup":
        return `dst=${event.dstIp} → gw=${event.nextHop} via ${event.iface}`;
    }
  }
}
