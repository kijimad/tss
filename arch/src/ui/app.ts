/**
 * app.ts — コンピュータ・アーキテクチャシミュレータの UI
 */

import { execute, REG_NAMES } from "../cpu/cpu.js";
import { PRESETS } from "../cpu/presets.js";
import type { CycleTrace, Flags } from "../cpu/types.js";

/** パイプラインステージの色 */
const STAGE_COLORS: Record<string, string> = {
  fetch: "#60a5fa",
  decode: "#a78bfa",
  execute: "#fbbf24",
  memory: "#34d399",
  writeback: "#f472b6",
};

/** フラグを文字列化 */
function flagsStr(f: Flags): string {
  return `ZF=${f.ZF ? 1 : 0} SF=${f.SF ? 1 : 0} CF=${f.CF ? 1 : 0} OF=${f.OF ? 1 : 0}`;
}

/** レジスタパネルを描画 */
function renderRegisters(
  container: HTMLElement,
  regs: number[],
  flags: Flags,
  sp: number,
  pc: number,
  cycle: number,
): void {
  container.innerHTML = "";

  const grid = document.createElement("div");
  grid.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:2px;margin-bottom:8px;";

  for (let i = 0; i < 8; i++) {
    const cell = document.createElement("div");
    cell.style.cssText = "padding:2px 6px;background:#1e293b;border-radius:2px;display:flex;justify-content:space-between;";
    cell.innerHTML =
      `<span style="color:#7dd3fc;font-weight:600;">${REG_NAMES[i]}</span>` +
      `<span style="color:#e2e8f0;">${regs[i]} <span style="color:#475569;font-size:9px;">0x${(regs[i] ?? 0).toString(16).padStart(4, "0")}</span></span>`;
    grid.appendChild(cell);
  }
  container.appendChild(grid);

  // 特殊レジスタ
  const specials = document.createElement("div");
  specials.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:2px;margin-bottom:8px;";
  for (const [name, val, color] of [["PC", pc, "#fbbf24"], ["SP", sp, "#34d399"], ["Cycle", cycle, "#94a3b8"]] as const) {
    const cell = document.createElement("div");
    cell.style.cssText = "padding:2px 6px;background:#1e293b;border-radius:2px;display:flex;justify-content:space-between;";
    cell.innerHTML = `<span style="color:${color};font-weight:600;">${name}</span><span style="color:#e2e8f0;">0x${val.toString(16).padStart(2, "0")} (${val})</span>`;
    specials.appendChild(cell);
  }
  container.appendChild(specials);

  // フラグ
  const flagsDiv = document.createElement("div");
  flagsDiv.style.cssText = "padding:3px 6px;background:#1e293b;border-radius:2px;display:flex;gap:8px;flex-wrap:wrap;";
  for (const [name, val] of [["ZF", flags.ZF], ["SF", flags.SF], ["CF", flags.CF], ["OF", flags.OF]] as const) {
    const span = document.createElement("span");
    span.style.cssText = `font-weight:600;color:${val ? "#fbbf24" : "#475569"};`;
    span.textContent = `${name}=${val ? "1" : "0"}`;
    flagsDiv.appendChild(span);
  }
  container.appendChild(flagsDiv);
}

/** パイプライントレースを描画 */
function renderTraces(container: HTMLElement, traces: CycleTrace[]): void {
  container.innerHTML = "";

  for (const trace of traces) {
    const card = document.createElement("div");
    card.style.cssText = "margin-bottom:4px;padding:6px 8px;background:#1e293b;border-radius:4px;border-left:3px solid #fbbf24;";

    // ヘッダ行
    const header = document.createElement("div");
    header.style.cssText = "display:flex;align-items:center;gap:6px;margin-bottom:3px;";
    header.innerHTML =
      `<span style="color:#64748b;font-size:10px;min-width:36px;">C${trace.cycle}</span>` +
      `<span style="color:#fbbf24;font-size:10px;min-width:36px;">PC=${trace.pc}</span>` +
      `<span style="color:#e2e8f0;font-weight:600;font-size:11px;">${trace.instruction.asm}</span>`;
    card.appendChild(header);

    // 5段パイプライン
    const stages: [string, string, string][] = [
      ["Fetch", trace.fetch, STAGE_COLORS["fetch"]!],
      ["Decode", trace.decode, STAGE_COLORS["decode"]!],
      ["Execute", trace.execute, STAGE_COLORS["execute"]!],
      ["Memory", trace.memAccess, STAGE_COLORS["memory"]!],
      ["WriteBack", trace.writeback, STAGE_COLORS["writeback"]!],
    ];

    for (const [label, detail, color] of stages) {
      if (detail === "なし" && (label === "Memory" || label === "WriteBack")) continue;
      const row = document.createElement("div");
      row.style.cssText = "display:flex;gap:4px;font-size:9px;line-height:1.4;margin-left:8px;";
      row.innerHTML =
        `<span style="color:${color};font-weight:600;min-width:64px;">${label}</span>` +
        `<span style="color:#94a3b8;">${detail}</span>`;
      card.appendChild(row);
    }

    // レジスタ変化（コンパクト）
    const regLine = document.createElement("div");
    regLine.style.cssText = "font-size:8px;color:#475569;margin-top:2px;margin-left:8px;";
    const regParts = trace.registersAfter
      .map((v, i) => `${REG_NAMES[i]}=${v}`)
      .join(" ");
    regLine.textContent = `[${regParts}] ${flagsStr(trace.flagsAfter)} SP=0x${trace.spAfter.toString(16)}`;
    card.appendChild(regLine);

    container.appendChild(card);
  }
}

/** メモリダンプを描画 */
function renderMemory(container: HTMLElement, memory: number[]): void {
  container.innerHTML = "";

  // 非ゼロ領域のみ表示
  const nonZero: { addr: number; val: number }[] = [];
  for (let i = 0; i < memory.length; i++) {
    if (memory[i] !== 0) nonZero.push({ addr: i, val: memory[i]! });
  }

  if (nonZero.length === 0) {
    container.innerHTML = '<div style="color:#475569;font-size:10px;">全メモリ = 0</div>';
    return;
  }

  const table = document.createElement("div");
  table.style.cssText = "display:grid;grid-template-columns:60px 60px 80px;gap:1px;";

  // ヘッダ
  table.innerHTML =
    '<span style="color:#64748b;font-weight:600;font-size:9px;">Addr</span>' +
    '<span style="color:#64748b;font-weight:600;font-size:9px;">Dec</span>' +
    '<span style="color:#64748b;font-weight:600;font-size:9px;">Hex</span>';

  for (const { addr, val } of nonZero) {
    table.innerHTML +=
      `<span style="color:#7dd3fc;font-size:9px;">0x${addr.toString(16).padStart(2, "0")}</span>` +
      `<span style="color:#e2e8f0;font-size:9px;">${val}</span>` +
      `<span style="color:#475569;font-size:9px;">0x${val.toString(16).padStart(4, "0")}</span>`;
  }
  container.appendChild(table);
}

export class ArchApp {
  init(container: HTMLElement): void {
    container.style.cssText =
      "display:flex;flex-direction:column;height:100vh;font-family:'Fira Code','Cascadia Code',monospace;background:#0f172a;color:#e2e8f0;";

    // ── ヘッダ ──
    const header = document.createElement("div");
    header.style.cssText =
      "padding:8px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #1e293b;flex-wrap:wrap;";

    const titleEl = document.createElement("h1");
    titleEl.textContent = "Computer Architecture Simulator";
    titleEl.style.cssText = "margin:0;font-size:15px;color:#fbbf24;";
    header.appendChild(titleEl);

    const subtitle = document.createElement("span");
    subtitle.style.cssText = "font-size:10px;color:#64748b;";
    subtitle.textContent = "16-bit von Neumann CPU";
    header.appendChild(subtitle);

    // プリセット選択
    const presetSelect = document.createElement("select");
    presetSelect.style.cssText =
      "padding:4px 8px;background:#1e293b;border:1px solid #334155;border-radius:4px;color:#f8fafc;font-size:12px;max-width:340px;";
    for (let i = 0; i < PRESETS.length; i++) {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = PRESETS[i]!.name;
      presetSelect.appendChild(opt);
    }
    header.appendChild(presetSelect);

    // 実行ボタン
    const runBtn = document.createElement("button");
    runBtn.textContent = "Execute";
    runBtn.style.cssText =
      "padding:4px 16px;background:#fbbf24;color:#0f172a;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;";
    header.appendChild(runBtn);

    container.appendChild(header);

    // ── 説明 ──
    const descDiv = document.createElement("div");
    descDiv.style.cssText =
      "padding:6px 16px;font-size:11px;color:#94a3b8;border-bottom:1px solid #1e293b;line-height:1.4;";
    container.appendChild(descDiv);

    // ── メイン ──
    const main = document.createElement("div");
    main.style.cssText = "flex:1;display:flex;overflow:hidden;";

    // 左: レジスタ + メモリ
    const leftPanel = document.createElement("div");
    leftPanel.style.cssText =
      "width:280px;min-width:240px;display:flex;flex-direction:column;border-right:1px solid #1e293b;overflow-y:auto;";

    const regLabel = document.createElement("div");
    regLabel.style.cssText =
      "padding:4px 8px;font-size:10px;font-weight:600;color:#7dd3fc;border-bottom:1px solid #1e293b;";
    regLabel.textContent = "Registers / Flags";
    leftPanel.appendChild(regLabel);

    const regDiv = document.createElement("div");
    regDiv.style.cssText = "padding:6px 8px;font-size:10px;";
    leftPanel.appendChild(regDiv);

    const memLabel = document.createElement("div");
    memLabel.style.cssText =
      "padding:4px 8px;font-size:10px;font-weight:600;color:#34d399;border-top:1px solid #1e293b;border-bottom:1px solid #1e293b;";
    memLabel.textContent = "Memory (non-zero)";
    leftPanel.appendChild(memLabel);

    const memDiv = document.createElement("div");
    memDiv.style.cssText = "padding:6px 8px;font-size:10px;flex:1;overflow-y:auto;";
    leftPanel.appendChild(memDiv);

    // I/O
    const ioLabel = document.createElement("div");
    ioLabel.style.cssText =
      "padding:4px 8px;font-size:10px;font-weight:600;color:#f472b6;border-top:1px solid #1e293b;border-bottom:1px solid #1e293b;";
    ioLabel.textContent = "I/O Ports";
    leftPanel.appendChild(ioLabel);

    const ioDiv = document.createElement("div");
    ioDiv.style.cssText = "padding:6px 8px;font-size:10px;";
    leftPanel.appendChild(ioDiv);

    main.appendChild(leftPanel);

    // 中央: プログラム一覧
    const midPanel = document.createElement("div");
    midPanel.style.cssText =
      "width:220px;display:flex;flex-direction:column;border-right:1px solid #1e293b;overflow-y:auto;";

    const progLabel = document.createElement("div");
    progLabel.style.cssText =
      "padding:4px 8px;font-size:10px;font-weight:600;color:#fbbf24;border-bottom:1px solid #1e293b;";
    progLabel.textContent = "Program";
    midPanel.appendChild(progLabel);

    const progDiv = document.createElement("div");
    progDiv.style.cssText = "padding:4px 0;font-size:10px;flex:1;overflow-y:auto;";
    midPanel.appendChild(progDiv);

    main.appendChild(midPanel);

    // 右: 実行トレース
    const rightPanel = document.createElement("div");
    rightPanel.style.cssText = "flex:1;display:flex;flex-direction:column;overflow:hidden;";

    const traceLabel = document.createElement("div");
    traceLabel.style.cssText =
      "padding:4px 8px;font-size:10px;font-weight:600;color:#fbbf24;border-bottom:1px solid #1e293b;display:flex;align-items:center;gap:8px;";
    traceLabel.textContent = "Execution Trace (5-stage pipeline)";

    const cycleBadge = document.createElement("span");
    cycleBadge.style.cssText = "font-size:9px;color:#64748b;font-weight:400;";
    traceLabel.appendChild(cycleBadge);

    const statusBadge = document.createElement("span");
    statusBadge.style.cssText = "font-size:9px;padding:1px 6px;border-radius:8px;";
    traceLabel.appendChild(statusBadge);

    rightPanel.appendChild(traceLabel);

    const traceDiv = document.createElement("div");
    traceDiv.style.cssText = "flex:1;padding:4px 8px;overflow-y:auto;";
    rightPanel.appendChild(traceDiv);

    main.appendChild(rightPanel);
    container.appendChild(main);

    // ── ロジック ──
    const doExecute = () => {
      const preset = PRESETS[Number(presetSelect.value)]!;
      descDiv.textContent = preset.description;

      // プログラム一覧を表示
      progDiv.innerHTML = "";
      for (let i = 0; i < preset.program.length; i++) {
        const row = document.createElement("div");
        row.style.cssText = "padding:1px 8px;display:flex;gap:6px;";
        row.innerHTML =
          `<span style="color:#475569;min-width:28px;">0x${i.toString(16).padStart(2, "0")}</span>` +
          `<span style="color:#e2e8f0;">${preset.program[i]!.asm}</span>`;
        progDiv.appendChild(row);
      }

      // 実行
      const result = execute(preset.program, preset.initialMemory);

      // レジスタ
      renderRegisters(
        regDiv,
        result.finalState.registers,
        result.finalState.flags,
        result.finalState.sp,
        result.finalState.pc,
        result.finalState.cycle,
      );

      // メモリ
      renderMemory(memDiv, result.finalState.memory);

      // I/O
      ioDiv.innerHTML = "";
      const ioGrid = document.createElement("div");
      ioGrid.style.cssText = "display:grid;grid-template-columns:40px 1fr;gap:1px;";
      for (let i = 0; i < 8; i++) {
        const v = result.finalState.io[i]!;
        ioGrid.innerHTML +=
          `<span style="color:#f472b6;">P${i}</span>` +
          `<span style="color:${v ? "#e2e8f0" : "#475569"};">${v}${v >= 0x20 && v < 0x7f ? ` '${String.fromCharCode(v)}'` : ""}</span>`;
      }
      ioDiv.appendChild(ioGrid);

      // ステータス
      cycleBadge.textContent = `${result.traces.length} cycles`;
      if (result.success) {
        statusBadge.textContent = "HLT";
        statusBadge.style.cssText = "font-size:9px;padding:1px 6px;border-radius:8px;background:#4ade8022;color:#4ade80;border:1px solid #4ade8044;";
      } else {
        statusBadge.textContent = result.errors[0] ?? "ERROR";
        statusBadge.style.cssText = "font-size:9px;padding:1px 6px;border-radius:8px;background:#f8717122;color:#f87171;border:1px solid #f8717144;";
      }

      // トレース
      renderTraces(traceDiv, result.traces);
    };

    // ── イベント ──
    presetSelect.addEventListener("change", doExecute);
    runBtn.addEventListener("click", doExecute);

    // 初期実行
    doExecute();
  }
}
