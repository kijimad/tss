import { runSimulation } from "../yarv/engine.js";
import { presets } from "../yarv/presets.js";
import type { SimulationResult, ControlFrame, RubyValue } from "../yarv/types.js";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** イベントタイプ別の色 */
function eventColor(type: string): string {
  const c: Record<string, string> = {
    insn: "#60a5fa", opt_insn: "#4ade80", stack: "#94a3b8",
    frame_push: "#a78bfa", frame_pop: "#818cf8",
    method_dispatch: "#e879f9", cache_hit: "#4ade80", cache_miss: "#f43f5e",
    local_access: "#38bdf8", ivar_access: "#22d3ee",
    catch: "#fbbf24", throw: "#f97316",
    block: "#fb923c", gc_mark: "#84cc16", gc_sweep: "#ef4444", gc_alloc: "#6ee7b7",
    fiber: "#f472b6", define: "#94a3b8", output: "#fbbf24",
    trace: "#64748b", info: "#64748b", error: "#ef4444",
  };
  return c[type] ?? "#94a3b8";
}

function rubyToS(v: RubyValue): string {
  if (v.type === "nil") return "nil";
  if (v.type === "true") return "true";
  if (v.type === "false") return "false";
  if (v.type === "fixnum" || v.type === "float") return String(v.value);
  if (v.type === "string") return `"${v.value}"`;
  if (v.type === "symbol") return `:${v.value}`;
  if (v.type === "array") return `[${(v.value as RubyValue[]).map(rubyToS).join(", ")}]`;
  return `#<${v.klass}:0x${v.objectId.toString(16).padStart(8, "0")}>`;
}

/** 統計パネル */
function renderStats(result: SimulationResult): string {
  const s = result.stats;
  return `
    <div class="panel">
      <h3>統計</h3>
      <div class="stats-grid">
        <div class="stat"><span class="stat-val">${s.totalInsns}</span><span class="stat-label">命令実行</span></div>
        <div class="stat"><span class="stat-val">${s.optInsns}</span><span class="stat-label">opt命令</span></div>
        <div class="stat"><span class="stat-val">${s.cacheHits}</span><span class="stat-label">cache hit</span></div>
        <div class="stat"><span class="stat-val">${s.cacheMisses}</span><span class="stat-label">cache miss</span></div>
        <div class="stat"><span class="stat-val">${s.framePushes}</span><span class="stat-label">frame push</span></div>
        <div class="stat"><span class="stat-val">${s.methodCalls}</span><span class="stat-label">method call</span></div>
        <div class="stat"><span class="stat-val">${s.blockCalls}</span><span class="stat-label">block call</span></div>
        <div class="stat"><span class="stat-val">${s.objectsAllocated}</span><span class="stat-label">alloc</span></div>
        <div class="stat"><span class="stat-val">${s.gcRuns}</span><span class="stat-label">GC</span></div>
      </div>
    </div>`;
}

/** 制御フレームスタック */
function renderCFP(result: SimulationResult): string {
  const cfps = result.vm.cfpStack;
  if (cfps.length === 0) return "";

  return `
    <div class="panel">
      <h3>制御フレームスタック (CFP) [${cfps.length}]</h3>
      <div class="cfp-stack">
        ${cfps.slice().reverse().map((cfp: ControlFrame, i: number) => `
          <div class="cfp-frame ${i === 0 ? "active" : ""}">
            <span class="cfp-type cfp-${cfp.type.toLowerCase()}">${cfp.type}</span>
            <span class="cfp-iseq">${escapeHtml(cfp.iseqLabel)}</span>
            <span class="cfp-detail">PC=${cfp.pc} SP=${cfp.sp} EP=${cfp.ep}</span>
            ${cfp.methodName ? `<span class="cfp-method">#${cfp.methodName}</span>` : ""}
          </div>`).join("")}
      </div>
    </div>`;
}

/** 値スタック */
function renderStack(result: SimulationResult): string {
  const stack = result.vm.stack;
  return `
    <div class="panel">
      <h3>値スタック [${stack.length}]</h3>
      <div class="val-stack">
        ${stack.length === 0 ? '<div class="empty">(空)</div>' :
          stack.slice().reverse().map((v: RubyValue, i: number) => `
            <div class="stack-entry">
              <span class="stack-idx">${stack.length - 1 - i}</span>
              <span class="stack-type type-${v.type}">${v.type}</span>
              <span class="stack-val">${escapeHtml(rubyToS(v))}</span>
              ${v.frozen ? '<span class="stack-frozen">F</span>' : ""}
            </div>`).join("")}
      </div>
    </div>`;
}

/** ISeq 一覧 */
function renderISeqs(result: SimulationResult): string {
  const iseqs = Array.from(result.vm.iseqs.entries());
  if (iseqs.length === 0) return "";

  return `
    <div class="panel">
      <h3>ISeq (命令列) [${iseqs.length}]</h3>
      <div class="iseqs">
        ${iseqs.map(([label, iseq]) => `
          <div class="iseq-card">
            <div class="iseq-header">
              <span class="iseq-label">${escapeHtml(label)}</span>
              <span class="iseq-type">${iseq.type}</span>
              <span class="iseq-count">${iseq.insns.length} insns</span>
            </div>
            ${iseq.localTable.length > 0 ? `
              <div class="iseq-locals">locals: ${iseq.localTable.map((l) => `${l.name}(${l.kind})`).join(", ")}</div>` : ""}
            ${iseq.catchTable.length > 0 ? `
              <div class="iseq-catch">catch: ${iseq.catchTable.map((c) => `${c.type}[${c.start}..${c.end}]→${c.cont}`).join(", ")}</div>` : ""}
            <div class="iseq-disasm">
              ${iseq.insns.map((insn) => {
                const operandStr = insn.operands.map((o) => {
                  if (typeof o === "object" && o !== null && "mid" in o) return `<${(o as { mid: string }).mid}>`;
                  return JSON.stringify(o);
                }).join(", ");
                return `<div class="disasm-line"><span class="disasm-pos">${String(insn.pos).padStart(4, "0")}</span> <span class="disasm-op">${insn.op}</span>${operandStr ? ` <span class="disasm-operand">${escapeHtml(operandStr)}</span>` : ""}</div>`;
              }).join("")}
            </div>
          </div>`).join("")}
      </div>
    </div>`;
}

/** GC ヒープ */
function renderHeap(result: SimulationResult): string {
  const gc = result.vm.gc;
  const totalSlots = gc.heapPages.reduce((s, p) => s + p.slots.length, 0);
  const usedSlots = totalSlots - gc.heapPages.reduce((s, p) => s + p.freeCount, 0);

  return `
    <div class="panel">
      <h3>GC ヒープ</h3>
      <div class="gc-stats">
        <span>割り当て: <strong>${gc.totalAllocated}</strong></span>
        <span>解放: <strong>${gc.totalFreed}</strong></span>
        <span>GC回数: <strong>${gc.gcCount}</strong></span>
        <span>使用: <strong>${usedSlots}/${totalSlots}</strong> スロット</span>
      </div>
      <div class="heap-pages">
        ${gc.heapPages.map((page) => `
          <div class="heap-page">
            <span class="page-id">Page ${page.id}</span>
            <div class="page-slots">
              ${page.slots.map((slot) => `<div class="slot ${slot.objectId !== null ? (slot.marked ? "marked" : "used") : "free"}" title="${slot.objectId !== null ? `obj#${slot.objectId}` : "free"}"></div>`).join("")}
            </div>
          </div>`).join("")}
      </div>
    </div>`;
}

/** 出力 */
function renderOutput(result: SimulationResult): string {
  if (result.vm.output.length === 0) return "";
  return `
    <div class="panel">
      <h3>出力</h3>
      <pre class="output">${result.vm.output.map(escapeHtml).join("\n")}</pre>
    </div>`;
}

/** イベントログ */
function renderEvents(result: SimulationResult): string {
  return `
    <div class="panel">
      <h3>イベントログ (${result.events.length})</h3>
      <div class="event-list">
        ${result.events.map((e) => `
          <div class="event">
            <span class="event-step">${e.step}</span>
            <span class="event-type" style="background:${eventColor(e.type)}">${e.type}</span>
            <span class="event-desc">${escapeHtml(e.description)}</span>
            ${e.stackSnapshot && e.stackSnapshot.length > 0 ? `<div class="event-stack">stack: [${e.stackSnapshot.map(escapeHtml).join(", ")}]</div>` : ""}
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
        ${renderOutput(result)}
        ${renderCFP(result)}
        ${renderStack(result)}
        ${renderHeap(result)}
      </div>
      <div class="col-right">
        ${renderISeqs(result)}
        ${renderEvents(result)}
      </div>
    </div>`;
}

function main(): void {
  document.title = "YARV シミュレーター";
  document.body.innerHTML = `
    <div id="header">
      <h1>Ruby YARV シミュレーター</h1>
      <p>スタック型VM — 制御フレーム, スペシャル命令, インラインキャッシュ, GC, catch table</p>
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

    .stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
    .stat { text-align: center; padding: 6px; background: rgba(96,165,250,0.08); border-radius: 6px; }
    .stat-val { display: block; font-size: 18px; font-weight: bold; color: #60a5fa; }
    .stat-label { display: block; font-size: 10px; color: var(--muted); }

    .output { background: #0f172a; border: 1px solid var(--border); border-radius: 4px; padding: 10px; font-size: 13px; color: #4ade80; white-space: pre-wrap; }

    .cfp-stack { display: flex; flex-direction: column; gap: 4px; }
    .cfp-frame { display: flex; gap: 8px; align-items: center; padding: 6px 10px; border-radius: 4px; background: rgba(255,255,255,0.02); }
    .cfp-frame.active { background: rgba(96,165,250,0.1); border: 1px solid rgba(96,165,250,0.3); }
    .cfp-type { display: inline-block; padding: 2px 8px; border-radius: 3px; font-size: 10px; font-weight: bold; min-width: 60px; text-align: center; }
    .cfp-method { background: rgba(167,139,250,0.2); color: #a78bfa; }
    .cfp-top { background: #4ade80; color: #0f172a; }
    .cfp-block { background: #fb923c; color: #0f172a; }
    .cfp-class { background: #22d3ee; color: #0f172a; }
    .cfp-cfunc { background: #f472b6; color: #0f172a; }
    .cfp-iseq { color: var(--text); flex: 1; }
    .cfp-detail { color: var(--muted); font-size: 11px; }

    .val-stack { display: flex; flex-direction: column; gap: 2px; }
    .stack-entry { display: flex; gap: 8px; align-items: center; padding: 3px 8px; border-radius: 3px; background: rgba(255,255,255,0.02); }
    .stack-idx { color: var(--muted); font-size: 10px; width: 20px; text-align: right; }
    .stack-type { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 10px; font-weight: bold; min-width: 50px; text-align: center; color: #0f172a; }
    .type-fixnum { background: #60a5fa; }
    .type-string { background: #4ade80; }
    .type-symbol { background: #e879f9; }
    .type-nil { background: #64748b; }
    .type-true { background: #22d3ee; }
    .type-false { background: #f43f5e; }
    .type-array { background: #fbbf24; }
    .type-hash { background: #fb923c; }
    .type-object, .type-class, .type-proc, .type-fiber { background: #a78bfa; }
    .stack-val { color: var(--text); font-size: 12px; }
    .stack-frozen { color: #60a5fa; font-size: 9px; }
    .empty { color: var(--muted); font-style: italic; }

    .iseqs { display: flex; flex-direction: column; gap: 10px; }
    .iseq-card { border: 1px solid var(--border); border-radius: 6px; padding: 10px; }
    .iseq-header { display: flex; gap: 10px; align-items: center; margin-bottom: 6px; }
    .iseq-label { color: #fbbf24; font-weight: bold; }
    .iseq-type { color: var(--muted); font-size: 11px; background: rgba(148,163,184,0.1); padding: 1px 6px; border-radius: 3px; }
    .iseq-count { color: var(--muted); font-size: 11px; }
    .iseq-locals { font-size: 11px; color: #38bdf8; margin-bottom: 4px; }
    .iseq-catch { font-size: 11px; color: #f97316; margin-bottom: 4px; }
    .iseq-disasm { font-size: 11px; max-height: 200px; overflow-y: auto; }
    .disasm-line { padding: 1px 0; }
    .disasm-pos { color: var(--muted); }
    .disasm-op { color: #60a5fa; font-weight: bold; margin: 0 4px; }
    .disasm-operand { color: #4ade80; }

    .gc-stats { display: flex; gap: 16px; margin-bottom: 10px; font-size: 12px; color: var(--muted); }
    .gc-stats strong { color: var(--text); }
    .heap-pages { display: flex; flex-direction: column; gap: 8px; }
    .heap-page { display: flex; align-items: center; gap: 8px; }
    .page-id { color: var(--muted); font-size: 11px; min-width: 50px; }
    .page-slots { display: flex; flex-wrap: wrap; gap: 2px; }
    .slot { width: 14px; height: 14px; border-radius: 2px; }
    .slot.free { background: rgba(255,255,255,0.05); }
    .slot.used { background: #60a5fa; }
    .slot.marked { background: #4ade80; }

    .event-list { max-height: calc(100vh - 160px); overflow-y: auto; display: flex; flex-direction: column; gap: 4px; }
    .event { padding: 6px 8px; border-radius: 4px; background: rgba(255,255,255,0.02); }
    .event:hover { background: rgba(255,255,255,0.05); }
    .event-step { display: inline-block; width: 24px; color: var(--muted); font-size: 11px; text-align: right; margin-right: 6px; }
    .event-type { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 10px; color: #0f172a; font-weight: bold; margin-right: 6px; min-width: 80px; text-align: center; }
    .event-desc { font-size: 12px; }
    .event-stack { margin-top: 2px; margin-left: 110px; font-size: 10px; color: #818cf8; }
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
