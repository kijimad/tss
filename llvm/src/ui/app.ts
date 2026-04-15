/**
 * @module app
 * LLVM シミュレーターのブラウザ UI モジュール。
 * プリセット選択、シミュレーション実行、結果の描画を担当する。
 * 統計パネル、最適化パス結果、レジスタ割り当て可視化、
 * x86-64 アセンブリ表示、イベントログを含む。
 */

import { runSimulation } from "../llvm/engine.js";
import { presets } from "../llvm/presets.js";
import type { SimulationResult, PassResult, LiveInterval, MachineInsn } from "../llvm/types.js";

/**
 * HTML 特殊文字をエスケープして XSS を防止する。
 * @param s - エスケープ対象の文字列
 * @returns エスケープ済み文字列
 */
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * イベント種別に応じた表示色を返す。
 * イベントログの視覚的な区別に使用される。
 * @param type - イベント種別文字列
 * @returns CSS カラーコード
 */
function eventColor(type: string): string {
  const c: Record<string, string> = {
    ir: "#60a5fa", pass: "#a78bfa", fold: "#4ade80", eliminate: "#f43f5e",
    replace: "#fbbf24", phi: "#e879f9", dom: "#38bdf8", ssa: "#22d3ee",
    regalloc: "#fb923c", spill: "#ef4444", codegen: "#84cc16",
    exec: "#4ade80", cfg: "#818cf8", info: "#64748b", error: "#ef4444",
  };
  return c[type] ?? "#94a3b8";
}

/**
 * 統計パネルの HTML を生成する。
 * IR 命令数、除去数、最適化数、パス数、phi ノード数、
 * レジスタ使用数、スピル数、マシン命令数を表示する。
 * @param result - シミュレーション結果
 * @returns 統計パネルの HTML 文字列
 */
function renderStats(result: SimulationResult): string {
  const s = result.stats;
  return `
    <div class="panel">
      <h3>統計</h3>
      <div class="stats-grid">
        <div class="stat"><span class="stat-val">${s.totalInsns}</span><span class="stat-label">IR命令</span></div>
        <div class="stat"><span class="stat-val">${s.eliminatedInsns}</span><span class="stat-label">除去</span></div>
        <div class="stat"><span class="stat-val">${s.optimizedInsns}</span><span class="stat-label">最適化</span></div>
        <div class="stat"><span class="stat-val">${s.passesRun}</span><span class="stat-label">パス</span></div>
        <div class="stat"><span class="stat-val">${s.phiNodes}</span><span class="stat-label">phi</span></div>
        <div class="stat"><span class="stat-val">${s.registersUsed}</span><span class="stat-label">レジスタ</span></div>
        <div class="stat"><span class="stat-val">${s.spillCount}</span><span class="stat-label">スピル</span></div>
        <div class="stat"><span class="stat-val">${s.machineInsns}</span><span class="stat-label">機械命令</span></div>
      </div>
    </div>`;
}

/**
 * 最適化パス結果パネルの HTML を生成する。
 * 各パスの名前、変更数、説明、個々の変更内容を表示する。
 * @param result - シミュレーション結果
 * @returns パス結果パネルの HTML 文字列
 */
function renderPassResults(result: SimulationResult): string {
  if (result.passResults.length === 0) return "";
  return `
    <div class="panel">
      <h3>最適化パス結果 (${result.passResults.length})</h3>
      <div class="passes">
        ${result.passResults.map((pr: PassResult) => `
          <div class="pass-card">
            <div class="pass-header">
              <span class="pass-name">${pr.pass}</span>
              <span class="pass-changes">${pr.changes.length} 変更</span>
            </div>
            <div class="pass-desc">${escapeHtml(pr.description)}</div>
            ${pr.changes.length > 0 ? `
              <div class="pass-changes-list">
                ${pr.changes.map((c) => `
                  <div class="change change-${c.type}">
                    <span class="change-type">${c.type}</span>
                    <span class="change-desc">${escapeHtml(c.description)}</span>
                  </div>`).join("")}
              </div>` : ""}
          </div>`).join("")}
      </div>
    </div>`;
}

/**
 * レジスタ割り当て結果パネルの HTML を生成する。
 * 物理レジスタ一覧、生存区間のバーチャート、スピル情報を
 * 色分けして可視化する。
 * @param result - シミュレーション結果
 * @returns レジスタ割り当てパネルの HTML 文字列
 */
function renderRegAlloc(result: SimulationResult): string {
  if (!result.regAlloc) return "";
  const ra = result.regAlloc;
  return `
    <div class="panel">
      <h3>レジスタ割り当て</h3>
      <div class="regalloc-info">
        <div class="phys-regs">物理レジスタ: ${ra.physRegs.map((r) => `<span class="preg">${r}</span>`).join(" ")}</div>
        <div class="intervals">
          <h4>生存区間</h4>
          <div class="interval-chart">
            ${ra.intervals.map((iv: LiveInterval) => `
              <div class="interval">
                <span class="iv-name">${iv.vreg}</span>
                <div class="iv-bar-container">
                  <div class="iv-bar ${iv.spilled ? "spilled" : ""}"
                       style="left:${iv.start * 10}px;width:${(iv.end - iv.start + 1) * 10}px;background:${iv.physReg ? colorForReg(iv.physReg, ra.physRegs) : "#ef4444"}">
                    ${iv.physReg ?? "spill"}
                  </div>
                </div>
              </div>`).join("")}
          </div>
        </div>
        ${ra.spills.length > 0 ? `<div class="spill-info">スピル: ${ra.spills.join(", ")}</div>` : ""}
      </div>
    </div>`;
}

function colorForReg(reg: string, allRegs: string[]): string {
  const colors = ["#60a5fa", "#4ade80", "#fbbf24", "#e879f9", "#fb923c", "#22d3ee"];
  const idx = allRegs.indexOf(reg);
  return colors[idx % colors.length] ?? "#94a3b8";
}

function renderMachineCode(result: SimulationResult): string {
  if (result.machineCode.length === 0) return "";
  return `
    <div class="panel">
      <h3>x86-64 アセンブリ (${result.machineCode.length})</h3>
      <pre class="asm">${result.machineCode.map((mi: MachineInsn) => {
        const line = mi.operands.length > 0 ? `  ${mi.op.padEnd(8)} ${mi.operands.join(", ")}` : `${mi.op}`;
        return mi.comment ? `${line.padEnd(40)} ; ${escapeHtml(mi.comment)}` : line;
      }).map(escapeHtml).join("\n")}</pre>
    </div>`;
}

function renderExecResult(result: SimulationResult): string {
  if (!result.execResult) return "";
  return `
    <div class="panel">
      <h3>実行結果</h3>
      <div class="exec-result">
        <span class="exec-val">${result.execResult.retValue}</span>
        <span class="exec-label">戻り値</span>
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
        ${renderExecResult(result)}
        ${renderPassResults(result)}
        ${renderRegAlloc(result)}
        ${renderMachineCode(result)}
      </div>
      <div class="col-right">
        ${renderEvents(result)}
      </div>
    </div>`;
}

function main(): void {
  document.title = "LLVM シミュレーター";
  document.body.innerHTML = `
    <div id="header">
      <h1>LLVM シミュレーター</h1>
      <p>SSA / IR → 最適化パス → レジスタ割り当て → コード生成 — 定数畳み込み, DCE, mem2reg, phi ノード</p>
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

    .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
    .stat { text-align: center; padding: 6px; background: rgba(96,165,250,0.08); border-radius: 6px; }
    .stat-val { display: block; font-size: 18px; font-weight: bold; color: #60a5fa; }
    .stat-label { display: block; font-size: 10px; color: var(--muted); }

    .exec-result { text-align: center; padding: 16px; }
    .exec-val { display: block; font-size: 32px; font-weight: bold; color: #4ade80; }
    .exec-label { display: block; font-size: 12px; color: var(--muted); }

    .passes { display: flex; flex-direction: column; gap: 10px; }
    .pass-card { border: 1px solid var(--border); border-radius: 6px; padding: 10px; }
    .pass-header { display: flex; gap: 12px; align-items: center; margin-bottom: 6px; }
    .pass-name { color: #a78bfa; font-weight: bold; }
    .pass-changes { color: var(--muted); font-size: 11px; }
    .pass-desc { font-size: 12px; color: var(--muted); margin-bottom: 6px; }
    .pass-changes-list { display: flex; flex-direction: column; gap: 3px; }
    .change { padding: 4px 8px; border-radius: 3px; font-size: 11px; display: flex; gap: 8px; align-items: center; }
    .change-fold { background: rgba(74,222,128,0.08); }
    .change-eliminate { background: rgba(239,68,68,0.08); }
    .change-replace { background: rgba(251,191,36,0.08); }
    .change-insert { background: rgba(96,165,250,0.08); }
    .change-type { padding: 1px 6px; border-radius: 3px; font-size: 9px; font-weight: bold; }
    .change-fold .change-type { background: #4ade80; color: #0f172a; }
    .change-eliminate .change-type { background: #ef4444; color: #0f172a; }
    .change-replace .change-type { background: #fbbf24; color: #0f172a; }
    .change-insert .change-type { background: #60a5fa; color: #0f172a; }

    .phys-regs { margin-bottom: 10px; font-size: 12px; }
    .preg { display: inline-block; padding: 2px 8px; background: rgba(96,165,250,0.15); border-radius: 3px; margin: 0 2px; }
    .intervals h4 { font-size: 12px; color: var(--muted); margin-bottom: 6px; }
    .interval-chart { display: flex; flex-direction: column; gap: 4px; }
    .interval { display: flex; align-items: center; gap: 8px; }
    .iv-name { width: 60px; font-size: 11px; color: var(--text); text-align: right; }
    .iv-bar-container { flex: 1; height: 18px; background: rgba(255,255,255,0.03); border-radius: 3px; position: relative; overflow: hidden; }
    .iv-bar { position: absolute; height: 100%; border-radius: 3px; font-size: 9px; color: #0f172a; font-weight: bold; display: flex; align-items: center; justify-content: center; min-width: 30px; }
    .iv-bar.spilled { background: #ef4444 !important; }
    .spill-info { margin-top: 8px; font-size: 11px; color: #ef4444; }

    .asm { background: #0f172a; border: 1px solid var(--border); border-radius: 4px; padding: 10px; font-size: 12px; color: #84cc16; white-space: pre; overflow-x: auto; max-height: 400px; overflow-y: auto; }

    .event-list { max-height: calc(100vh - 160px); overflow-y: auto; display: flex; flex-direction: column; gap: 4px; }
    .event { padding: 6px 8px; border-radius: 4px; background: rgba(255,255,255,0.02); }
    .event:hover { background: rgba(255,255,255,0.05); }
    .event-step { display: inline-block; width: 24px; color: var(--muted); font-size: 11px; text-align: right; margin-right: 6px; }
    .event-type { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 10px; color: #0f172a; font-weight: bold; margin-right: 6px; min-width: 70px; text-align: center; }
    .event-desc { font-size: 12px; }
    .event-detail { margin-top: 3px; margin-left: 100px; font-size: 11px; color: var(--muted); white-space: pre-wrap; }
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
