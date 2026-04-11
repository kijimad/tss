import { runSimulation } from "../debugger/engine.js";
import { presets } from "../debugger/presets.js";
import type { SimulationResult, MemoryCell } from "../debugger/types.js";

function hex(n: number): string {
  return `0x${n.toString(16).padStart(8, "0")}`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** イベントタイプ別の色 */
function eventColor(type: string): string {
  const c: Record<string, string> = {
    ptrace: "#a78bfa", breakpoint: "#f43f5e", watchpoint: "#22d3ee",
    step: "#4ade80", continue: "#60a5fa", signal: "#fb923c",
    syscall: "#e879f9", memory: "#fbbf24", register: "#38bdf8",
    stack: "#f472b6", variable: "#84cc16", disasm: "#94a3b8",
    process: "#6ee7b7", error: "#ef4444", info: "#64748b",
  };
  return c[type] ?? "#94a3b8";
}

function renderSource(result: SimulationResult): string {
  const src = result.debuggee.source;
  if (src.length === 0) return "";
  const bpLines = new Set(result.breakpoints.filter((b) => b.enabled && b.line).map((b) => b.line!));

  return `
    <div class="panel source-panel">
      <h3>ソースコード</h3>
      <div class="source-code">
        ${src.map((s) => {
          const isCurrent = s.lineNo === result.debuggee.currentLine;
          const hasBp = bpLines.has(s.lineNo);
          return `<div class="src-line ${isCurrent ? "current" : ""} ${hasBp ? "has-bp" : ""}">
            <span class="src-bp">${hasBp ? "●" : " "}</span>
            <span class="src-marker">${isCurrent ? "→" : " "}</span>
            <span class="src-no">${s.lineNo}</span>
            <span class="src-text">${escapeHtml(s.text)}</span>
            <span class="src-addr">${hex(s.addr)}</span>
          </div>`;
        }).join("")}
      </div>
    </div>`;
}

function renderRegisters(result: SimulationResult): string {
  const r = result.registers;
  const regs: [string, number][] = [
    ["rax", r.rax], ["rbx", r.rbx], ["rcx", r.rcx], ["rdx", r.rdx],
    ["rsi", r.rsi], ["rdi", r.rdi], ["rbp", r.rbp], ["rsp", r.rsp],
    ["r8", r.r8], ["r9", r.r9], ["r10", r.r10], ["r11", r.r11],
    ["r12", r.r12], ["r13", r.r13], ["r14", r.r14], ["r15", r.r15],
    ["rip", r.rip], ["rflags", r.rflags],
  ];
  return `
    <div class="panel">
      <h3>レジスタ</h3>
      <div class="reg-grid">
        ${regs.map(([name, val]) => `
          <div class="reg${name === "rip" ? " reg-rip" : ""}">
            <span class="reg-name">${name}</span>
            <span class="reg-val">${hex(val)}</span>
          </div>`).join("")}
      </div>
    </div>`;
}

function renderBreakpoints(result: SimulationResult): string {
  if (result.breakpoints.length === 0 && result.watchpoints.length === 0) return "";
  return `
    <div class="panel">
      <h3>ブレークポイント / ウォッチポイント</h3>
      ${result.breakpoints.length > 0 ? `
        <table>
          <thead><tr><th>#</th><th>行</th><th>アドレス</th><th>ヒット</th><th>条件</th><th>状態</th></tr></thead>
          <tbody>${result.breakpoints.map((bp) => `
            <tr class="${!bp.enabled ? "disabled" : ""}">
              <td>${bp.id}</td>
              <td>${bp.line ?? "-"}</td>
              <td><code>${hex(bp.addr)}</code></td>
              <td>${bp.hitCount}</td>
              <td>${bp.condition ? `<code>${escapeHtml(bp.condition)}</code>` : "-"}</td>
              <td>${bp.enabled ? '<span class="on">有効</span>' : '<span class="off">無効</span>'}</td>
            </tr>`).join("")}
          </tbody>
        </table>` : ""}
      ${result.watchpoints.length > 0 ? `
        <table>
          <thead><tr><th>#</th><th>式</th><th>種類</th><th>アドレス</th><th>旧値</th><th>現在値</th><th>ヒット</th></tr></thead>
          <tbody>${result.watchpoints.map((wp) => `
            <tr class="${!wp.enabled ? "disabled" : ""}">
              <td>${wp.id}</td>
              <td><code>${escapeHtml(wp.expr)}</code></td>
              <td>${wp.type}</td>
              <td><code>${hex(wp.addr)}</code></td>
              <td>${wp.oldValue}</td>
              <td>${wp.currentValue}</td>
              <td>${wp.hitCount}</td>
            </tr>`).join("")}
          </tbody>
        </table>` : ""}
    </div>`;
}

function renderCallStack(result: SimulationResult): string {
  if (result.callStack.length === 0) return "";
  return `
    <div class="panel">
      <h3>コールスタック</h3>
      <div class="callstack">
        ${result.callStack.map((f) => `
          <div class="frame">
            <span class="frame-level">#${f.level}</span>
            <span class="frame-func">${escapeHtml(f.funcName)}()</span>
            <span class="frame-loc">${escapeHtml(f.file)}:${f.line}</span>
            <span class="frame-addr">${hex(f.addr)}</span>
            ${f.locals.length > 0 ? `<div class="frame-vars">${f.locals.map((l) => `<span class="var">${escapeHtml(l.name)}=${escapeHtml(l.value)}</span>`).join("")}</div>` : ""}
          </div>`).join("")}
      </div>
    </div>`;
}

function renderVariables(result: SimulationResult): string {
  if (result.variables.length === 0) return "";
  return `
    <div class="panel">
      <h3>変数</h3>
      <table>
        <thead><tr><th>名前</th><th>型</th><th>値</th><th>アドレス</th></tr></thead>
        <tbody>${result.variables.map((v) => `
          <tr>
            <td><code>${escapeHtml(v.name)}</code></td>
            <td>${escapeHtml(v.type)}</td>
            <td><strong>${escapeHtml(v.value)}</strong></td>
            <td><code>${hex(v.addr)}</code></td>
          </tr>
          ${v.members ? v.members.map((m) => `
            <tr class="member-row">
              <td>&nbsp;&nbsp;.${escapeHtml(m.name)}</td>
              <td>${escapeHtml(m.type)}</td>
              <td>${escapeHtml(m.value)}</td>
              <td><code>${hex(m.addr)}</code></td>
            </tr>`).join("") : ""}`).join("")}
        </tbody>
      </table>
    </div>`;
}

function renderMemoryDump(result: SimulationResult): string {
  if (result.memoryDump.length === 0) return "";
  // 16バイトずつグループ化
  const rows: MemoryCell[][] = [];
  for (let i = 0; i < result.memoryDump.length; i += 16) {
    rows.push(result.memoryDump.slice(i, i + 16));
  }
  return `
    <div class="panel">
      <h3>メモリダンプ</h3>
      <div class="hexdump">
        ${rows.map((row) => {
          const addr = row[0]!.addr;
          const hexPart = row.map((c) => c.value.toString(16).padStart(2, "0")).join(" ");
          const asciiPart = row.map((c) => c.ascii).join("");
          return `<div class="hex-row"><span class="hex-addr">${hex(addr)}</span> <span class="hex-bytes">${hexPart}</span> <span class="hex-ascii">${asciiPart}</span></div>`;
        }).join("")}
      </div>
    </div>`;
}

function renderDisassembly(result: SimulationResult): string {
  if (result.disassembly.length === 0) return "";
  return `
    <div class="panel">
      <h3>逆アセンブル</h3>
      <div class="disasm-list">
        ${result.disassembly.map((d) => `
          <div class="disasm-line ${d.isCurrentInstr ? "current-instr" : ""}">
            <span class="disasm-marker">${d.isCurrentInstr ? "→" : " "}</span>
            <span class="disasm-addr">${hex(d.addr)}</span>
            <span class="disasm-bytes">${d.bytes}</span>
            <span class="disasm-mnem">${escapeHtml(d.mnemonic)}</span>
            <span class="disasm-ops">${escapeHtml(d.operands)}</span>
          </div>`).join("")}
      </div>
    </div>`;
}

function renderStats(result: SimulationResult): string {
  const s = result.stats;
  const state = result.debuggee.state;
  const stateColor = state === "running" ? "#4ade80" : state === "stopped" ? "#fbbf24" : state === "exited" ? "#94a3b8" : "#ef4444";
  return `
    <div class="panel">
      <h3>プロセス情報</h3>
      <div class="proc-info">
        <span class="proc-pid">PID ${result.debuggee.pid}</span>
        <span class="proc-state" style="color:${stateColor}">${state}${result.debuggee.exitCode !== undefined ? ` (code ${result.debuggee.exitCode})` : ""}</span>
        ${result.debuggee.signal ? `<span class="proc-sig">${result.debuggee.signal.name}</span>` : ""}
      </div>
      <div class="stats-grid">
        <div class="stat"><span class="stat-val">${s.totalSteps}</span><span class="stat-label">イベント</span></div>
        <div class="stat"><span class="stat-val">${s.breakpointsHit}</span><span class="stat-label">BP ヒット</span></div>
        <div class="stat"><span class="stat-val">${s.watchpointsHit}</span><span class="stat-label">WP ヒット</span></div>
        <div class="stat"><span class="stat-val">${s.ptraceCalls}</span><span class="stat-label">ptrace</span></div>
        <div class="stat"><span class="stat-val">${s.signalsDelivered}</span><span class="stat-label">シグナル</span></div>
        <div class="stat"><span class="stat-val">${s.instructionsExecuted}</span><span class="stat-label">命令実行</span></div>
      </div>
    </div>`;
}

function renderEvents(result: SimulationResult): string {
  return `
    <div class="panel">
      <h3>イベントログ (${result.events.length})</h3>
      <div class="event-list">
        ${result.events.map((e) => `
          <div class="event">
            <span class="event-step">${e.step}</span>
            ${e.ptraceOp ? `<span class="event-ptrace">${e.ptraceOp}</span>` : ""}
            <span class="event-type" style="background:${eventColor(e.type)}">${e.type}</span>
            <span class="event-desc">${escapeHtml(e.description)}</span>
            ${e.detail ? `<div class="event-detail">${escapeHtml(e.detail)}</div>` : ""}
          </div>`).join("")}
      </div>
    </div>`;
}

function render(result: SimulationResult): void {
  const app = document.getElementById("app")!;
  app.innerHTML = `
    <div class="grid">
      <div class="col-left">
        ${renderStats(result)}
        ${renderSource(result)}
        ${renderDisassembly(result)}
        ${renderRegisters(result)}
        ${renderBreakpoints(result)}
        ${renderCallStack(result)}
        ${renderVariables(result)}
        ${renderMemoryDump(result)}
      </div>
      <div class="col-right">
        ${renderEvents(result)}
      </div>
    </div>`;
}

function main(): void {
  document.title = "デバッガ シミュレーター";
  document.body.innerHTML = `
    <div id="header">
      <h1>デバッガ シミュレーター</h1>
      <p>ptrace — INT3 ブレークポイント — ステップ実行 — ウォッチポイント — コールスタック</p>
      <select id="preset"></select>
    </div>
    <div id="app"></div>`;

  const style = document.createElement("style");
  style.textContent = `
    :root { --bg: #0f172a; --surface: #1e293b; --border: #334155; --text: #e2e8f0; --muted: #94a3b8; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: var(--bg); color: var(--text); font-family: "JetBrains Mono", "Fira Code", monospace; font-size: 13px; }
    #header { padding: 16px 24px; border-bottom: 1px solid var(--border); }
    #header h1 { font-size: 18px; margin-bottom: 4px; }
    #header p { color: var(--muted); font-size: 12px; margin-bottom: 10px; }
    select { background: var(--surface); color: var(--text); border: 1px solid var(--border); padding: 6px 12px; border-radius: 4px; font-size: 13px; font-family: inherit; width: 100%; max-width: 600px; }
    #app { padding: 16px 24px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    @media (max-width: 1200px) { .grid { grid-template-columns: 1fr; } }
    .col-left, .col-right { display: flex; flex-direction: column; gap: 16px; }
    .panel { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 14px; }
    .panel h3 { font-size: 14px; margin-bottom: 10px; color: #60a5fa; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { padding: 4px 8px; text-align: left; border-bottom: 1px solid var(--border); }
    th { color: var(--muted); font-weight: normal; }
    code { color: #fbbf24; font-size: 12px; }
    tr.disabled td { opacity: 0.4; }
    .on { color: #4ade80; } .off { color: #ef4444; }
    .member-row td { color: var(--muted); font-size: 11px; }

    /* ソースコード */
    .source-code { font-size: 13px; }
    .src-line { display: flex; gap: 4px; padding: 2px 4px; border-radius: 2px; }
    .src-line.current { background: rgba(250,204,21,0.12); }
    .src-line.has-bp .src-bp { color: #f43f5e; }
    .src-bp { width: 12px; color: transparent; }
    .src-marker { width: 12px; color: #4ade80; font-weight: bold; }
    .src-no { width: 28px; color: var(--muted); text-align: right; }
    .src-text { flex: 1; }
    .src-addr { color: #334155; font-size: 11px; }

    /* レジスタ */
    .reg-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; }
    .reg { display: flex; justify-content: space-between; padding: 3px 8px; background: rgba(255,255,255,0.02); border-radius: 3px; font-size: 12px; }
    .reg-rip { background: rgba(250,204,21,0.1); }
    .reg-name { color: #60a5fa; font-weight: bold; }
    .reg-val { color: #fbbf24; }

    /* コールスタック */
    .frame { padding: 6px 8px; border-left: 3px solid #60a5fa; margin-bottom: 4px; background: rgba(96,165,250,0.05); border-radius: 0 4px 4px 0; }
    .frame-level { color: var(--muted); margin-right: 8px; }
    .frame-func { color: #4ade80; font-weight: bold; margin-right: 8px; }
    .frame-loc { color: var(--muted); font-size: 11px; margin-right: 8px; }
    .frame-addr { color: #fbbf24; font-size: 11px; }
    .frame-vars { margin-top: 4px; display: flex; flex-wrap: wrap; gap: 4px; }
    .var { background: rgba(132,204,22,0.1); padding: 1px 6px; border-radius: 3px; font-size: 11px; color: #84cc16; }

    /* 逆アセンブル */
    .disasm-line { display: flex; gap: 8px; padding: 2px 4px; font-size: 12px; }
    .disasm-line.current-instr { background: rgba(250,204,21,0.12); }
    .disasm-marker { width: 12px; color: #4ade80; font-weight: bold; }
    .disasm-addr { color: #fbbf24; width: 100px; }
    .disasm-bytes { color: var(--muted); width: 180px; }
    .disasm-mnem { color: #60a5fa; font-weight: bold; width: 60px; }
    .disasm-ops { color: var(--text); }

    /* メモリダンプ */
    .hexdump { font-size: 12px; }
    .hex-row { display: flex; gap: 12px; padding: 1px 0; }
    .hex-addr { color: #fbbf24; width: 100px; }
    .hex-bytes { color: var(--text); flex: 1; }
    .hex-ascii { color: #4ade80; }

    /* プロセス情報 */
    .proc-info { display: flex; gap: 16px; align-items: center; margin-bottom: 10px; font-size: 14px; }
    .proc-pid { font-weight: bold; }
    .proc-sig { color: #fb923c; }
    .stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
    .stat { text-align: center; padding: 6px; background: rgba(96,165,250,0.08); border-radius: 6px; }
    .stat-val { display: block; font-size: 18px; font-weight: bold; color: #60a5fa; }
    .stat-label { display: block; font-size: 10px; color: var(--muted); }

    /* イベントログ */
    .event-list { max-height: calc(100vh - 160px); overflow-y: auto; display: flex; flex-direction: column; gap: 4px; }
    .event { padding: 6px 8px; border-radius: 4px; background: rgba(255,255,255,0.02); }
    .event:hover { background: rgba(255,255,255,0.05); }
    .event-step { display: inline-block; width: 24px; color: var(--muted); font-size: 11px; text-align: right; margin-right: 6px; }
    .event-ptrace { display: inline-block; padding: 1px 4px; border-radius: 3px; font-size: 9px; color: #a78bfa; border: 1px solid rgba(167,139,250,0.3); margin-right: 4px; }
    .event-type { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 10px; color: #0f172a; font-weight: bold; margin-right: 6px; min-width: 70px; text-align: center; }
    .event-desc { font-size: 12px; }
    .event-detail { margin-top: 3px; margin-left: 110px; font-size: 11px; color: var(--muted); white-space: pre-wrap; }
  `;
  document.head.appendChild(style);

  const select = document.getElementById("preset") as HTMLSelectElement;
  for (const p of presets) {
    const opt = document.createElement("option");
    opt.textContent = `${p.name} — ${p.description}`;
    select.appendChild(opt);
  }

  function run(): void {
    const preset = presets[select.selectedIndex]!;
    const result = runSimulation(preset.ops);
    render(result);
  }

  select.addEventListener("change", run);
  run();
}

main();
