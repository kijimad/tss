/**
 * @module ui/app
 * TCP/HTTPシミュレーションのブラウザUI表示モジュール。
 * プリセット選択、シミュレーション実行、結果のレンダリング
 * （ソケット状態、統計、セグメント一覧、HTTP交換、イベントログ）を担当する。
 */

import { presets, runSimulation } from "../tcphttp/index.js";
import type { SimulationResult, TcpSegment } from "../tcphttp/index.js";

/** イベント種別ごとの表示色マッピング */
const EVENT_COLORS: Record<string, string> = {
  socket_create: "#7f8c8d", bind: "#7f8c8d", listen: "#7f8c8d",
  connect: "#3498db", accept: "#3498db",
  handshake_syn: "#e67e22", handshake_syn_ack: "#f39c12", handshake_ack: "#f1c40f",
  handshake_complete: "#27ae60",
  tcp_send: "#3498db", tcp_recv: "#2980b9", tcp_ack: "#1abc9c",
  state_change: "#9b59b6",
  data_send: "#e74c3c", data_recv: "#c0392b", data_ack: "#27ae60",
  window_update: "#16a085",
  fin_send: "#e67e22", fin_recv: "#d35400", fin_ack: "#f39c12",
  teardown_complete: "#7f8c8d",
  rst_send: "#e74c3c", rst_recv: "#c0392b",
  http_request_send: "#3498db", http_request_recv: "#2980b9",
  http_response_send: "#27ae60", http_response_recv: "#2ecc71",
  http_parse: "#8e44ad", keep_alive: "#16a085", close: "#555",
};

/** 通信方向ごとの表示色マッピング */
const DIR_COLORS: Record<string, string> = {
  "client→server": "#3498db",
  "server→client": "#e67e22",
  "local": "#7f8c8d",
};

/**
 * TCPセグメントのフラグを "SYN+ACK" のような文字列に変換する。
 * @param seg - TCPセグメント
 * @returns フラグ文字列（例: "SYN+ACK"）
 */
function flagStr(seg: TcpSegment): string {
  const parts: string[] = [];
  if (seg.flags.syn) parts.push("SYN");
  if (seg.flags.ack) parts.push("ACK");
  if (seg.flags.fin) parts.push("FIN");
  if (seg.flags.rst) parts.push("RST");
  if (seg.flags.psh) parts.push("PSH");
  return parts.join("+");
}

/**
 * TCP/HTTPシミュレーションのUIアプリケーションクラス。
 * ブラウザ上でプリセット選択とシミュレーション結果の可視化を行う。
 */
export class TcpHttpApp {
  /** UIのルートコンテナ要素 */
  private container!: HTMLElement;

  /**
   * アプリケーションを初期化し、指定されたDOM要素にUIを描画する。
   * @param el - UIを描画するルートDOM要素
   */
  init(el: HTMLElement | null): void {
    if (!el) return;
    this.container = el;
    this.render();
  }

  /** UIの初期HTMLとCSSを生成し、プリセット選択イベントをバインドする */
  private render(): void {
    this.container.innerHTML = `
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: "SF Mono", "Cascadia Code", "Consolas", monospace; background: #0a0a0f; color: #c8ccd0; }
        .app { max-width: 1440px; margin: 0 auto; padding: 20px; }
        h1 { font-size: 20px; color: #e2e5e8; margin-bottom: 16px; }
        .controls { display: flex; gap: 12px; align-items: center; margin-bottom: 16px; }
        select { background: #1a1a2e; color: #c8ccd0; border: 1px solid #333; padding: 8px 12px;
                 border-radius: 4px; font-family: inherit; font-size: 13px; min-width: 420px; }
        .desc { color: #888; font-size: 12px; margin-bottom: 16px; line-height: 1.5; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        .panel { background: #12121c; border: 1px solid #1e1e30; border-radius: 6px; padding: 14px; }
        .panel h2 { font-size: 13px; color: #7f8fa6; margin-bottom: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
        .full { grid-column: 1 / -1; }
        table { width: 100%; border-collapse: collapse; font-size: 11px; }
        th { text-align: left; color: #7f8fa6; padding: 4px 6px; border-bottom: 1px solid #1e1e30; }
        td { padding: 4px 6px; border-bottom: 1px solid #111; }
        .event-row { padding: 5px 0; border-bottom: 1px solid #111; font-size: 12px; }
        .event-type { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 10px;
                      color: #fff; margin-right: 6px; min-width: 130px; text-align: center; }
        .events-scroll { max-height: 500px; overflow-y: auto; }
        .stat-val { color: #f39c12; font-weight: bold; }
        .dir-badge { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 9px;
                     color: #fff; margin-right: 4px; min-width: 90px; text-align: center; }
        .seg-row { display: flex; align-items: center; gap: 6px; padding: 4px 0; border-bottom: 1px solid #111; font-size: 11px; }
        .seg-flags { display: inline-block; padding: 2px 8px; border-radius: 3px; font-size: 10px;
                     color: #fff; font-weight: bold; min-width: 80px; text-align: center; }
        .seg-num { color: #f39c12; }
        .seg-payload { color: #555; font-size: 10px; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .http-box { background: #0d0d18; border: 1px solid #1e1e30; border-radius: 4px; padding: 10px; margin-bottom: 8px; font-size: 11px; }
        .http-method { color: #3498db; font-weight: bold; }
        .http-status { font-weight: bold; }
        .http-header { color: #888; }
        .http-body { color: #e74c3c; font-size: 10px; margin-top: 4px; word-break: break-all; }
        .state-badge { display: inline-block; padding: 2px 8px; border-radius: 3px; font-size: 10px;
                       color: #fff; font-weight: bold; }
        .socket-info { margin-bottom: 10px; }
        .socket-label { color: #7f8fa6; font-size: 10px; text-transform: uppercase; margin-bottom: 4px; }
        .socket-field { display: flex; justify-content: space-between; padding: 2px 0; font-size: 11px; }
        .socket-field .label { color: #888; }
        .socket-field .val { color: #f39c12; }
      </style>
      <div class="app">
        <h1>TCP Socket + HTTP Simulator</h1>
        <div class="controls">
          <select id="preset-select">
            ${presets.map((p, i) => `<option value="${i}">${p.name}</option>`).join("")}
          </select>
        </div>
        <div class="desc" id="desc"></div>
        <div class="grid">
          <div class="panel" id="socket-panel"></div>
          <div class="panel" id="stats-panel"></div>
          <div class="panel full" id="segments-panel"></div>
          <div class="panel full" id="http-panel"></div>
          <div class="panel full" id="events-panel"></div>
        </div>
      </div>
    `;
    const select = this.container.querySelector("#preset-select") as HTMLSelectElement;
    select.addEventListener("change", () => this.runPreset(Number(select.value)));
    this.runPreset(0);
  }

  /**
   * 指定されたプリセットでシミュレーションを実行し、全パネルを更新する。
   * @param index - プリセット配列のインデックス
   */
  private runPreset(index: number): void {
    const preset = presets[index]!;
    const result = runSimulation(preset.clientAddr, preset.serverAddr, preset.ops);
    this.container.querySelector("#desc")!.textContent = preset.description;
    this.renderSockets(result);
    this.renderStats(result);
    this.renderSegments(result);
    this.renderHttp(result);
    this.renderEvents(result);
  }

  /**
   * TCPソケット状態に対応する表示色を返す。
   * @param state - TCP状態文字列
   * @returns CSSカラーコード
   */
  private stateColor(state: string): string {
    const colors: Record<string, string> = {
      CLOSED: "#555", LISTEN: "#7f8c8d", SYN_SENT: "#e67e22", SYN_RECEIVED: "#f39c12",
      ESTABLISHED: "#27ae60", FIN_WAIT_1: "#e67e22", FIN_WAIT_2: "#d35400",
      CLOSE_WAIT: "#e74c3c", CLOSING: "#c0392b", LAST_ACK: "#8e44ad", TIME_WAIT: "#9b59b6",
    };
    return colors[state] ?? "#555";
  }

  /** クライアント・サーバー双方のソケット状態パネルを描画する */
  private renderSockets(result: SimulationResult): void {
    const el = this.container.querySelector("#socket-panel")!;
    let html = `<h2>Socket State</h2>`;

    for (const [label, sock] of [["CLIENT", result.clientSocket], ["SERVER", result.serverSocket]] as const) {
      const sc = this.stateColor(sock.state);
      html += `<div class="socket-info">
        <div class="socket-label">${label}
          <span class="state-badge" style="background:${sc};margin-left:6px;">${sock.state}</span>
        </div>
        <div class="socket-field"><span class="label">Address</span><span class="val">${sock.localAddr.ip}:${sock.localAddr.port}</span></div>
        <div class="socket-field"><span class="label">SendNext (SND.NXT)</span><span class="val">${sock.sendNext}</span></div>
        <div class="socket-field"><span class="label">SendUnack (SND.UNA)</span><span class="val">${sock.sendUnack}</span></div>
        <div class="socket-field"><span class="label">RecvNext (RCV.NXT)</span><span class="val">${sock.recvNext}</span></div>
        <div class="socket-field"><span class="label">Window</span><span class="val">send=${sock.sendWindow} recv=${sock.recvWindow}</span></div>
        <div class="socket-field"><span class="label">Send Buffer</span><span class="val">${sock.sendBuffer.length > 0 ? sock.sendBuffer.join(", ") : "(empty)"}</span></div>
        <div class="socket-field"><span class="label">Recv Buffer</span><span class="val">${sock.recvBuffer.length > 0 ? sock.recvBuffer.join(", ") : "(empty)"}</span></div>
      </div>`;
    }
    el.innerHTML = html;
  }

  /** 統計情報パネル（セグメント数、HTTP交換数など）を描画する */
  private renderStats(result: SimulationResult): void {
    const el = this.container.querySelector("#stats-panel")!;
    const s = result.stats;
    el.innerHTML = `<h2>Statistics</h2>
      <table>
        <tr><td>総セグメント数</td><td class="stat-val">${s.totalSegments}</td></tr>
        <tr><td>データセグメント</td><td class="stat-val">${s.dataSegments}</td></tr>
        <tr><td>ACKセグメント</td><td class="stat-val">${s.ackSegments}</td></tr>
        <tr><td>ハンドシェイク</td><td class="stat-val">${s.handshakeSegments}</td></tr>
        <tr><td>切断</td><td class="stat-val">${s.teardownSegments}</td></tr>
        <tr><td>再送</td><td class="stat-val">${s.retransmissions}</td></tr>
        <tr><td>HTTP交換</td><td class="stat-val">${result.httpExchanges.length}</td></tr>
      </table>
      <div style="margin-top:14px;">
        <div class="socket-label">SEQUENCE NUMBER TIMELINE</div>
        ${this.renderTimeline(result)}
      </div>`;
  }

  /**
   * シーケンス番号のタイムラインをHTML文字列として生成する。
   * クライアント側セグメントは左寄せ、サーバー側は右寄せで表示。
   * @param result - シミュレーション結果
   * @returns タイムラインのHTML文字列
   */
  private renderTimeline(result: SimulationResult): string {
    if (result.segments.length === 0) return `<div style="color:#555;font-size:11px;">セグメントなし</div>`;
    let html = `<div style="margin-top:6px;">`;
    for (let i = 0; i < result.segments.length; i++) {
      const seg = result.segments[i]!;
      const f = flagStr(seg);
      const isClient = seg.srcPort < 1024 ? false : true;
      const color = isClient ? "#3498db" : "#e67e22";
      const align = isClient ? "flex-start" : "flex-end";
      html += `<div style="display:flex;justify-content:${align};margin:2px 0;">
        <div style="background:${color}22;border-left:2px solid ${color};padding:2px 8px;font-size:10px;border-radius:0 3px 3px 0;">
          <span style="color:${color};font-weight:bold;">${f}</span>
          <span style="color:#888;margin-left:4px;">seq=${seg.seq} ack=${seg.ack}</span>
          ${seg.payloadSize > 0 ? `<span style="color:#555;margin-left:4px;">len=${seg.payloadSize}</span>` : ""}
        </div>
      </div>`;
    }
    html += `</div>`;
    return html;
  }

  /** TCPセグメント一覧テーブルを描画する */
  private renderSegments(result: SimulationResult): void {
    const el = this.container.querySelector("#segments-panel")!;
    if (result.segments.length === 0) {
      el.innerHTML = `<h2>TCP Segments</h2><div style="color:#555;font-size:11px;">セグメントなし</div>`;
      return;
    }
    let html = `<h2>TCP Segments (${result.segments.length})</h2>`;
    html += `<table><tr><th>#</th><th>Src</th><th>Dst</th><th>Flags</th><th>Seq</th><th>Ack</th><th>Win</th><th>Len</th><th>Payload</th></tr>`;
    for (let i = 0; i < result.segments.length; i++) {
      const seg = result.segments[i]!;
      const f = flagStr(seg);
      const fColor = seg.flags.syn ? "#e67e22" : seg.flags.fin ? "#9b59b6" : seg.flags.rst ? "#e74c3c" : seg.flags.psh ? "#3498db" : "#27ae60";
      html += `<tr>
        <td style="color:#555">${i + 1}</td>
        <td>${seg.srcPort}</td>
        <td>${seg.dstPort}</td>
        <td><span class="seg-flags" style="background:${fColor}">${f}</span></td>
        <td class="seg-num">${seg.seq}</td>
        <td class="seg-num">${seg.ack}</td>
        <td>${seg.window}</td>
        <td>${seg.payloadSize}</td>
        <td class="seg-payload">${seg.payload ? seg.payload.slice(0, 40) : ""}</td>
      </tr>`;
    }
    html += `</table>`;
    el.innerHTML = html;
  }

  /** HTTP交換（リクエスト/レスポンス）パネルを描画する */
  private renderHttp(result: SimulationResult): void {
    const el = this.container.querySelector("#http-panel")!;
    if (result.httpExchanges.length === 0) {
      el.innerHTML = `<h2>HTTP Exchanges</h2><div style="color:#555;font-size:11px;">HTTP交換なし</div>`;
      return;
    }
    let html = `<h2>HTTP Exchanges (${result.httpExchanges.length})</h2>`;
    for (const ex of result.httpExchanges) {
      html += `<div class="http-box">`;
      if (ex.request) {
        const req = ex.request;
        html += `<div><span class="http-method">${req.method}</span> ${req.path} HTTP/${req.version}</div>`;
        html += `<div class="http-header">${Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`).join(" | ")}</div>`;
        if (req.body) html += `<div class="http-body">Body: ${req.body}</div>`;
      }
      if (ex.response) {
        const res = ex.response;
        const statusColor = res.statusCode < 300 ? "#27ae60" : res.statusCode < 400 ? "#f39c12" : "#e74c3c";
        html += `<div style="margin-top:6px;border-top:1px solid #1e1e30;padding-top:6px;">
          <span class="http-status" style="color:${statusColor}">HTTP/${res.version} ${res.statusCode} ${res.statusText}</span>
        </div>`;
        html += `<div class="http-header">${Object.entries(res.headers).map(([k, v]) => `${k}: ${v}`).join(" | ")}</div>`;
        if (res.body) html += `<div class="http-body">Body: ${res.body}</div>`;
      }
      html += `</div>`;
    }
    el.innerHTML = html;
  }

  /** シミュレーションイベントログパネルを描画する */
  private renderEvents(result: SimulationResult): void {
    const el = this.container.querySelector("#events-panel")!;
    let html = `<h2>Events (${result.events.length})</h2><div class="events-scroll">`;
    for (const ev of result.events) {
      const color = EVENT_COLORS[ev.type] ?? "#555";
      const dirColor = ev.direction ? DIR_COLORS[ev.direction] ?? "#555" : "#555";
      html += `<div class="event-row">
        <span style="color:#444;font-size:10px;">[${ev.step}]</span>
        ${ev.direction ? `<span class="dir-badge" style="background:${dirColor}">${ev.direction}</span>` : ""}
        <span class="event-type" style="background:${color}">${ev.type}</span>
        <span style="color:#888;">${ev.description}</span>
      </div>`;
    }
    html += `</div>`;
    el.innerHTML = html;
  }
}
