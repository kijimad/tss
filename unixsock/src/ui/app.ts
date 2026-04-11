import { presets, runSimulation } from "../unixsock/index.js";
import type { SimulationResult, UnixSocket } from "../unixsock/index.js";

const EVENT_COLORS: Record<string, string> = {
  process_create: "#7f8c8d", socket_create: "#3498db", socketpair_create: "#2980b9",
  bind: "#9b59b6", listen: "#8e44ad", connect: "#e67e22", accept: "#27ae60",
  send: "#3498db", recv: "#2ecc71", sendmsg: "#1abc9c", recvmsg: "#16a085",
  sendto: "#e67e22", close: "#555", unlink: "#7f8c8d",
  fd_pass: "#f39c12", credential_pass: "#e74c3c",
  getpeername: "#888", getsockname: "#888", shutdown: "#d35400",
  error: "#e74c3c", inode_create: "#9b59b6", buffer_update: "#555",
};

const STATE_COLORS: Record<string, string> = {
  UNBOUND: "#555", BOUND: "#9b59b6", LISTENING: "#f39c12",
  CONNECTING: "#e67e22", CONNECTED: "#27ae60", CLOSED: "#e74c3c",
};

function addrStr(sock: UnixSocket): string {
  if (!sock.addr) return "(unbound)";
  if (sock.addr.type === "abstract") return `@${sock.addr.path}`;
  if (sock.addr.type === "unnamed") return "(unnamed)";
  return sock.addr.path;
}

export class UnixSockApp {
  private container!: HTMLElement;

  init(el: HTMLElement | null): void {
    if (!el) return;
    this.container = el;
    this.render();
  }

  private render(): void {
    this.container.innerHTML = `
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: "SF Mono", "Cascadia Code", "Consolas", monospace; background: #0a0a0f; color: #c8ccd0; }
        .app { max-width: 1440px; margin: 0 auto; padding: 20px; }
        h1 { font-size: 20px; color: #e2e5e8; margin-bottom: 16px; }
        .controls { display: flex; gap: 12px; align-items: center; margin-bottom: 16px; }
        select { background: #1a1a2e; color: #c8ccd0; border: 1px solid #333; padding: 8px 12px;
                 border-radius: 4px; font-family: inherit; font-size: 13px; min-width: 460px; }
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
                      color: #fff; margin-right: 6px; min-width: 120px; text-align: center; }
        .events-scroll { max-height: 500px; overflow-y: auto; }
        .stat-val { color: #f39c12; font-weight: bold; }
        .badge { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 9px; color: #fff; }
        .state-badge { font-weight: bold; font-size: 10px; }
        .fd-badge { background: #3498db; }
        .pid-badge { background: #e67e22; }
        .type-badge { background: #9b59b6; }
        .proc-box { background: #0d0d18; border: 1px solid #1e1e30; border-radius: 4px; padding: 8px; margin-bottom: 6px; }
        .sock-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
      </style>
      <div class="app">
        <h1>UNIX Domain Socket Simulator</h1>
        <div class="controls">
          <select id="preset-select">
            ${presets.map((p, i) => `<option value="${i}">${p.name}</option>`).join("")}
          </select>
        </div>
        <div class="desc" id="desc"></div>
        <div class="grid">
          <div class="panel" id="proc-panel"></div>
          <div class="panel" id="stats-panel"></div>
          <div class="panel full" id="sockets-panel"></div>
          <div class="panel full" id="events-panel"></div>
        </div>
      </div>
    `;
    const select = this.container.querySelector("#preset-select") as HTMLSelectElement;
    select.addEventListener("change", () => this.runPreset(Number(select.value)));
    this.runPreset(0);
  }

  private runPreset(index: number): void {
    const preset = presets[index]!;
    const result = runSimulation(preset.ops);
    this.container.querySelector("#desc")!.textContent = preset.description;
    this.renderProcesses(result);
    this.renderStats(result);
    this.renderSockets(result);
    this.renderEvents(result);
  }

  private renderProcesses(result: SimulationResult): void {
    const el = this.container.querySelector("#proc-panel")!;
    let html = `<h2>Processes</h2>`;
    for (const proc of result.processes) {
      const procSocks = result.sockets.filter((s) => s.pid === proc.pid);
      html += `<div class="proc-box">
        <div style="margin-bottom:4px;">
          <span class="badge pid-badge">PID ${proc.pid}</span>
          <span style="color:#e2e5e8;font-size:12px;margin-left:4px;">${proc.name}</span>
          <span style="color:#555;font-size:10px;margin-left:4px;">uid=${proc.uid} gid=${proc.gid}</span>
        </div>
        <div style="font-size:10px;color:#888;">
          fds: [${proc.fds.map((f) => `<span class="badge fd-badge">${f}</span>`).join(" ")}]
        </div>`;
      if (procSocks.length > 0) {
        html += `<div style="margin-top:4px;">`;
        for (const sock of procSocks) {
          const sc = STATE_COLORS[sock.state] ?? "#555";
          html += `<div class="sock-row" style="margin-top:2px;">
            <span class="badge fd-badge">fd=${sock.fd}</span>
            <span class="badge type-badge">${sock.socketType}</span>
            <span class="badge state-badge" style="background:${sc}">${sock.state}</span>
            <span style="color:#888;font-size:10px;">${addrStr(sock)}</span>
            ${sock.peerFd !== undefined ? `<span style="color:#555;font-size:10px;">↔ fd=${sock.peerFd}</span>` : ""}
          </div>`;
        }
        html += `</div>`;
      }
      html += `</div>`;
    }

    // ソケットファイル
    if (result.socketFiles.length > 0) {
      html += `<div style="margin-top:10px;"><div style="color:#7f8fa6;font-size:10px;text-transform:uppercase;margin-bottom:4px;">Socket Files</div>`;
      for (const f of result.socketFiles) {
        html += `<div style="font-size:11px;color:#9b59b6;">srwxr-xr-x  ${f}</div>`;
      }
      html += `</div>`;
    }
    el.innerHTML = html;
  }

  private renderStats(result: SimulationResult): void {
    const el = this.container.querySelector("#stats-panel")!;
    const s = result.stats;
    el.innerHTML = `<h2>Statistics</h2>
      <table>
        <tr><td>システムコール数</td><td class="stat-val">${s.totalSyscalls}</td></tr>
        <tr><td>ソケット作成</td><td class="stat-val">${s.socketCreated}</td></tr>
        <tr><td>送信バイト</td><td class="stat-val">${s.bytesSent}B</td></tr>
        <tr><td>受信バイト</td><td class="stat-val">${s.bytesReceived}B</td></tr>
        <tr><td>fd受け渡し</td><td class="stat-val" style="color:${s.fdsPassed > 0 ? "#f39c12" : "#888"}">${s.fdsPassed}</td></tr>
        <tr><td>エラー</td><td class="stat-val" style="color:${s.errors > 0 ? "#e74c3c" : "#27ae60"}">${s.errors}</td></tr>
      </table>
      <div style="margin-top:14px;">
        <div style="color:#7f8fa6;font-size:10px;text-transform:uppercase;margin-bottom:6px;">Socket Types</div>
        <div style="font-size:10px;color:#888;line-height:1.8;">
          <div><span style="color:#3498db;">SOCK_STREAM</span> — 接続型、バイトストリーム</div>
          <div><span style="color:#e67e22;">SOCK_DGRAM</span> — コネクションレス、メッセージ境界</div>
          <div><span style="color:#27ae60;">SOCK_SEQPACKET</span> — 接続型+メッセージ境界</div>
        </div>
        <div style="color:#7f8fa6;font-size:10px;text-transform:uppercase;margin-top:10px;margin-bottom:6px;">Address Types</div>
        <div style="font-size:10px;color:#888;line-height:1.8;">
          <div><span style="color:#9b59b6;">pathname</span> — ファイルシステムパス</div>
          <div><span style="color:#1abc9c;">abstract</span> — 抽象名前空間 (@prefix)</div>
          <div><span style="color:#7f8c8d;">unnamed</span> — socketpair用</div>
        </div>
      </div>`;
  }

  private renderSockets(result: SimulationResult): void {
    const el = this.container.querySelector("#sockets-panel")!;
    let html = `<h2>Sockets (${result.sockets.length})</h2>`;
    html += `<table><tr><th>fd</th><th>Type</th><th>State</th><th>Address</th><th>Peer</th><th>PID</th><th>Buf</th><th>Ref</th></tr>`;
    for (const s of result.sockets) {
      const sc = STATE_COLORS[s.state] ?? "#555";
      html += `<tr>
        <td><span class="badge fd-badge">${s.fd}</span></td>
        <td><span class="badge type-badge">${s.socketType.replace("SOCK_", "")}</span></td>
        <td><span class="badge state-badge" style="background:${sc}">${s.state}</span></td>
        <td style="color:#888;">${addrStr(s)}</td>
        <td style="color:#555;">${s.peerFd !== undefined ? `fd=${s.peerFd}` : "-"}</td>
        <td>${s.pid}</td>
        <td>${s.recvBuffer.length > 0 ? `${s.recvBuffer.length}msg` : "-"}</td>
        <td>${s.refCount}</td>
      </tr>`;
    }
    html += `</table>`;
    el.innerHTML = html;
  }

  private renderEvents(result: SimulationResult): void {
    const el = this.container.querySelector("#events-panel")!;
    let html = `<h2>Events (${result.events.length})</h2><div class="events-scroll">`;
    for (const ev of result.events) {
      const color = EVENT_COLORS[ev.type] ?? "#555";
      let meta = "";
      if (ev.pid !== undefined) meta += `<span class="badge pid-badge" style="margin-right:4px;">PID ${ev.pid}</span>`;
      if (ev.fd !== undefined) meta += `<span class="badge fd-badge" style="margin-right:4px;">fd=${ev.fd}</span>`;
      html += `<div class="event-row">
        <span style="color:#444;font-size:10px;">[${ev.step}]</span>
        <span class="event-type" style="background:${color}">${ev.type}</span>
        ${meta}
        <span style="color:#888;">${ev.description}</span>
      </div>`;
    }
    html += `</div>`;
    el.innerHTML = html;
  }
}
