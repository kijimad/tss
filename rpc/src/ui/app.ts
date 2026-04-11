/* RPC シミュレーター UI */

import { simulate } from "../rpc/engine.js";
import { PRESETS } from "../rpc/presets.js";
import type { SimulationResult, RpcCallResult, SimEvent } from "../rpc/types.js";

const C = {
  bg: "#0b0d12",
  card: "#131720",
  border: "#1f2636",
  text: "#cdd4e0",
  muted: "#5a6478",
  accent: "#3b82f6",
  pass: "#22c55e",
  fail: "#ef4444",
  warn: "#f59e0b",
  jsonRpc: "#3b82f6",
  xmlRpc: "#f59e0b",
  grpc: "#22c55e",
  trpc: "#a855f7",
};

const PROTO_COLORS: Record<string, string> = {
  json_rpc: C.jsonRpc,
  xml_rpc: C.xmlRpc,
  grpc: C.grpc,
  trpc: C.trpc,
};

const PROTO_LABELS: Record<string, string> = {
  json_rpc: "JSON-RPC",
  xml_rpc: "XML-RPC",
  grpc: "gRPC",
  trpc: "tRPC",
};

const FORMAT_LABELS: Record<string, string> = {
  json: "JSON",
  xml: "XML",
  protobuf: "Protobuf",
};

let currentResult: SimulationResult | null = null;
let selectedIdx = 0;

function run(idx: number): void {
  selectedIdx = idx;
  const preset = PRESETS[idx]!;
  const ops = preset.build();
  currentResult = simulate(ops);
  render();
}

function render(): void {
  const app = document.getElementById("app")!;
  if (!currentResult) return;
  const r = currentResult;

  const successCount = r.callResults.filter(c => c.success).length;
  const errorCount = r.callResults.filter(c => !c.success).length;

  app.innerHTML = `
    <div class="hdr">
      <h1>RPC Simulator</h1>
      <div class="ctrl">
        <select id="sel">${PRESETS.map((p, i) =>
          `<option value="${i}" ${i === selectedIdx ? "selected" : ""}>${p.name}</option>`
        ).join("")}</select>
        <span class="desc" id="desc">${PRESETS[selectedIdx]?.description ?? ""}</span>
      </div>
    </div>

    <div class="stats">
      <div class="stat">
        <span class="stat-val">${r.callResults.length}</span>
        <span class="stat-lbl">呼び出し</span>
      </div>
      <div class="stat">
        <span class="stat-val" style="color:${C.pass}">${successCount}</span>
        <span class="stat-lbl">成功</span>
      </div>
      <div class="stat">
        <span class="stat-val" style="color:${C.fail}">${errorCount}</span>
        <span class="stat-lbl">エラー</span>
      </div>
      <div class="stat">
        <span class="stat-val">${r.totalDuration.toFixed(1)}ms</span>
        <span class="stat-lbl">合計時間</span>
      </div>
      <div class="stat">
        <span class="stat-val">${r.totalBytes}</span>
        <span class="stat-lbl">合計Bytes</span>
      </div>
    </div>

    <div class="results">
      ${r.callResults.map((cr, i) => renderCallResult(cr, i)).join("")}
    </div>

    <div class="events-section">
      <h2>イベントログ</h2>
      <div class="events">
        ${r.events.map(e => renderEvent(e)).join("")}
      </div>
    </div>
  `;

  const sel = document.getElementById("sel") as HTMLSelectElement;
  sel.addEventListener("change", () => {
    run(Number(sel.value));
  });
}

function renderCallResult(cr: RpcCallResult, idx: number): string {
  const pc = PROTO_COLORS[cr.call.protocol] ?? C.accent;
  const pl = PROTO_LABELS[cr.call.protocol] ?? cr.call.protocol;
  const statusColor = cr.success ? C.pass : C.fail;
  const statusLabel = cr.success ? "成功" : "エラー";

  return `
    <div class="call-card" style="border-left:3px solid ${pc}">
      <div class="call-hdr">
        <div class="call-title">
          <span class="call-num">#${idx + 1}</span>
          <span class="proto-badge" style="background:${pc}18;color:${pc};border:1px solid ${pc}33">${pl}</span>
          <span class="call-method">${cr.call.service}.${cr.call.method}</span>
          ${cr.call.callType && cr.call.callType !== "unary" ? `<span class="stream-badge">${cr.call.callType}</span>` : ""}
          ${cr.call.batch ? '<span class="batch-badge">BATCH</span>' : ""}
          <span class="status-badge" style="background:${statusColor}18;color:${statusColor};border:1px solid ${statusColor}33">${statusLabel}</span>
        </div>
        <div class="call-meta">
          <span>Transport: <b>${cr.call.transport}</b></span>
          <span>Duration: <b>${cr.duration.toFixed(2)}ms</b></span>
        </div>
      </div>

      <div class="wire-section">
        <div class="wire-box">
          <div class="wire-title">リクエスト</div>
          <div class="wire-meta">
            <span class="fmt-badge">${FORMAT_LABELS[cr.requestWire.format] ?? cr.requestWire.format}</span>
            <span>${cr.requestWire.sizeBytes} bytes</span>
            <span>${cr.requestWire.parseTimeMs.toFixed(3)}ms</span>
          </div>
          <pre class="wire-raw">${escapeHtml(cr.requestWire.raw.slice(0, 400))}${cr.requestWire.raw.length > 400 ? "…" : ""}</pre>
        </div>
        <div class="wire-box">
          <div class="wire-title">レスポンス</div>
          <div class="wire-meta">
            <span class="fmt-badge">${FORMAT_LABELS[cr.responseWire.format] ?? cr.responseWire.format}</span>
            <span>${cr.responseWire.sizeBytes} bytes</span>
            <span>${cr.responseWire.parseTimeMs.toFixed(3)}ms</span>
          </div>
          <pre class="wire-raw">${escapeHtml(cr.responseWire.raw.slice(0, 400))}${cr.responseWire.raw.length > 400 ? "…" : ""}</pre>
        </div>
      </div>

      ${cr.result !== undefined ? `
        <div class="result-box">
          <span class="result-label">結果:</span>
          <span class="result-val">${escapeHtml(JSON.stringify(cr.result, null, 2))}</span>
        </div>
      ` : ""}

      ${cr.error ? `
        <div class="error-box">
          <span class="error-label">エラー:</span>
          <span class="error-code">${cr.error.code}</span>
          <span class="error-msg">${escapeHtml(cr.error.message)}</span>
        </div>
      ` : ""}

      ${cr.streamMessages && cr.streamMessages.length > 0 ? `
        <div class="stream-section">
          <div class="stream-title">ストリームメッセージ (${cr.streamMessages.length}件)</div>
          ${cr.streamMessages.map(sm => `
            <div class="stream-msg">
              <span class="stream-dir ${sm.direction === "send" ? "stream-send" : "stream-recv"}">${sm.direction === "send" ? "→送信" : "←受信"}</span>
              <span class="stream-idx">#${sm.index}</span>
              <span class="stream-data">${escapeHtml(JSON.stringify(sm.data).slice(0, 100))}</span>
            </div>
          `).join("")}
        </div>
      ` : ""}
    </div>
  `;
}

function renderEvent(e: SimEvent): string {
  const pc = PROTO_COLORS[e.protocol] ?? C.muted;
  const typeColor =
    e.type === "error" ? C.fail
    : e.type === "respond" || e.type === "receive" ? C.pass
    : e.type === "stream_msg" ? C.warn
    : e.type === "batch" || e.type === "notification" ? C.trpc
    : C.muted;

  return `
    <div class="ev-item">
      <span class="ev-time">${e.time.toFixed(1)}ms</span>
      <span class="ev-proto" style="color:${pc}">${PROTO_LABELS[e.protocol] ?? e.protocol}</span>
      <span class="ev-type" style="color:${typeColor}">${e.type}</span>
      <span class="ev-msg">${escapeHtml(e.message)}</span>
      ${e.detail ? `<span class="ev-detail">${escapeHtml(e.detail.slice(0, 80))}</span>` : ""}
    </div>
  `;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function init(): void {
  document.body.style.margin = "0";
  document.body.style.background = C.bg;
  document.body.style.color = C.text;
  document.body.style.fontFamily = "'JetBrains Mono', 'Fira Code', monospace";

  const s = document.createElement("style");
  s.textContent = `
    * { box-sizing: border-box; }
    #app { max-width: 1000px; margin: 0 auto; padding: 16px; }
    .hdr { margin-bottom: 16px; }
    .hdr h1 { font-size: 20px; margin: 0 0 8px; color: ${C.accent}; }
    .ctrl { display: flex; align-items: center; gap: 10px; }
    .ctrl select {
      background: ${C.card}; color: ${C.text}; border: 1px solid ${C.border};
      padding: 6px 10px; border-radius: 4px; font-family: inherit; font-size: 12px;
    }
    .desc { color: ${C.muted}; font-size: 11px; }

    .stats {
      display: flex; gap: 12px; margin-bottom: 16px; flex-wrap: wrap;
    }
    .stat {
      background: ${C.card}; border: 1px solid ${C.border}; border-radius: 6px;
      padding: 10px 16px; display: flex; flex-direction: column; align-items: center; min-width: 80px;
    }
    .stat-val { font-size: 18px; font-weight: bold; color: ${C.text}; }
    .stat-lbl { font-size: 10px; color: ${C.muted}; margin-top: 2px; }

    .results { display: flex; flex-direction: column; gap: 14px; }

    .call-card {
      background: ${C.card}; border: 1px solid ${C.border};
      border-radius: 6px; padding: 14px;
    }
    .call-hdr { margin-bottom: 10px; }
    .call-title { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .call-num { color: ${C.muted}; font-size: 11px; }
    .proto-badge { padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; }
    .call-method { font-size: 14px; font-weight: bold; }
    .stream-badge { background: ${C.warn}18; color: ${C.warn}; padding: 2px 6px; border-radius: 3px; font-size: 10px; }
    .batch-badge { background: ${C.trpc}18; color: ${C.trpc}; padding: 2px 6px; border-radius: 3px; font-size: 10px; }
    .status-badge { padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; }
    .call-meta { display: flex; gap: 16px; font-size: 11px; color: ${C.muted}; margin-top: 4px; }
    .call-meta b { color: ${C.text}; }

    .wire-section { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 8px; }
    .wire-box { background: ${C.bg}; border-radius: 4px; padding: 8px; }
    .wire-title { font-size: 10px; color: ${C.muted}; margin-bottom: 4px; }
    .wire-meta { display: flex; gap: 8px; font-size: 10px; color: ${C.muted}; margin-bottom: 4px; align-items: center; }
    .fmt-badge { background: ${C.accent}18; color: ${C.accent}; padding: 1px 5px; border-radius: 3px; font-size: 9px; }
    .wire-raw {
      font-size: 10px; color: ${C.text}; background: transparent;
      margin: 0; padding: 0; white-space: pre-wrap; word-break: break-all;
      max-height: 120px; overflow-y: auto; line-height: 1.4;
    }

    .result-box {
      background: ${C.pass}08; border: 1px solid ${C.pass}22; border-radius: 4px;
      padding: 6px 8px; font-size: 11px; margin-bottom: 6px;
    }
    .result-label { color: ${C.pass}; margin-right: 6px; font-weight: bold; }
    .result-val { color: ${C.text}; white-space: pre-wrap; }

    .error-box {
      background: ${C.fail}08; border: 1px solid ${C.fail}22; border-radius: 4px;
      padding: 6px 8px; font-size: 11px; display: flex; gap: 6px; align-items: center;
    }
    .error-label { color: ${C.fail}; font-weight: bold; }
    .error-code { background: ${C.fail}18; color: ${C.fail}; padding: 1px 5px; border-radius: 3px; font-size: 10px; }
    .error-msg { color: ${C.text}; }

    .stream-section {
      background: ${C.bg}; border-radius: 4px; padding: 8px; margin-top: 6px;
    }
    .stream-title { font-size: 10px; color: ${C.muted}; margin-bottom: 4px; }
    .stream-msg { display: flex; gap: 6px; font-size: 10px; padding: 2px 0; align-items: center; }
    .stream-dir { padding: 1px 5px; border-radius: 3px; font-size: 9px; font-weight: bold; }
    .stream-send { background: ${C.accent}18; color: ${C.accent}; }
    .stream-recv { background: ${C.pass}18; color: ${C.pass}; }
    .stream-idx { color: ${C.muted}; }
    .stream-data { color: ${C.text}; }

    .events-section { margin-top: 20px; }
    .events-section h2 { font-size: 14px; color: ${C.accent}; margin: 0 0 8px; }
    .events {
      background: ${C.card}; border: 1px solid ${C.border}; border-radius: 6px;
      padding: 10px; max-height: 300px; overflow-y: auto;
    }
    .ev-item { display: flex; gap: 6px; font-size: 10px; padding: 2px 0; align-items: baseline; }
    .ev-time { min-width: 50px; color: ${C.muted}; text-align: right; }
    .ev-proto { min-width: 60px; font-size: 9px; }
    .ev-type { min-width: 80px; font-size: 9px; }
    .ev-msg { color: ${C.text}; }
    .ev-detail { color: ${C.muted}; font-size: 9px; max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  `;
  document.head.appendChild(s);

  const app = document.createElement("div");
  app.id = "app";
  document.body.appendChild(app);

  run(0);
}

init();
