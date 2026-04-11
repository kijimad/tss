/**
 * app.ts — アセンブラシミュレータの UI
 */

import { assemble } from "../assembler/assembler.js";
import { PRESETS } from "../assembler/presets.js";
import type { AssembleStep, EncodedInstruction } from "../assembler/types.js";

/** フェーズごとのアクセントカラー */
function phaseColor(phase: string): string {
  if (phase.includes("パース")) return "#60a5fa";
  if (phase.includes("パス1")) return "#a78bfa";
  if (phase.includes("パス2")) return "#34d399";
  if (phase.includes("ヘックス")) return "#fbbf24";
  if (phase.includes("エラー")) return "#f87171";
  return "#94a3b8";
}

/** ステップ一覧を描画 */
function renderSteps(
  container: HTMLElement,
  steps: AssembleStep[],
  success: boolean,
  errors: string[],
): void {
  for (const step of steps) {
    const card = document.createElement("div");
    const color = phaseColor(step.phase);
    card.style.cssText = `margin:0 8px 6px;padding:8px 12px;background:#1e293b;border-left:3px solid ${color};border-radius:0 4px 4px 0;`;

    const phaseLabel = document.createElement("div");
    phaseLabel.style.cssText = `font-size:11px;font-weight:700;color:${color};margin-bottom:2px;display:flex;align-items:center;gap:6px;`;
    phaseLabel.textContent = step.phase;

    const desc = document.createElement("span");
    desc.style.cssText = "font-weight:400;color:#cbd5e1;font-size:11px;";
    desc.textContent = ` — ${step.description}`;
    phaseLabel.appendChild(desc);
    card.appendChild(phaseLabel);

    if (step.detail) {
      const detail = document.createElement("pre");
      detail.style.cssText =
        "margin:4px 0 0;padding:0;font-family:inherit;font-size:10px;color:#94a3b8;white-space:pre-wrap;line-height:1.5;";
      detail.textContent = step.detail;
      card.appendChild(detail);
    }

    container.appendChild(card);
  }

  if (errors.length > 0) {
    const errBox = document.createElement("div");
    errBox.style.cssText =
      "margin:0 8px;padding:8px 12px;background:#f8717115;border:1px solid #f8717133;border-radius:4px;";
    for (const err of errors) {
      const errLine = document.createElement("div");
      errLine.style.cssText = "font-size:11px;color:#f87171;line-height:1.5;";
      errLine.textContent = `✗ ${err}`;
      errBox.appendChild(errLine);
    }
    container.appendChild(errBox);
  }

  // 成功/失敗バッジ
  const badge = document.createElement("div");
  badge.style.cssText = `margin:8px;padding:4px 12px;border-radius:4px;font-size:11px;font-weight:600;text-align:center;${success ? "background:#4ade8022;color:#4ade80;border:1px solid #4ade8044" : "background:#f8717122;color:#f87171;border:1px solid #f8717144"}`;
  badge.textContent = success ? "アセンブル成功" : "アセンブル失敗";
  container.appendChild(badge);
}

/** エンコード結果テーブルを描画 */
function renderEncodingTable(
  container: HTMLElement,
  encoded: EncodedInstruction[],
): void {
  const table = document.createElement("div");
  table.style.cssText = "margin:0 8px 8px;";

  const header = document.createElement("div");
  header.style.cssText =
    "display:grid;grid-template-columns:70px 160px 1fr 1fr;gap:4px;padding:4px 8px;font-size:10px;font-weight:700;color:#64748b;border-bottom:1px solid #1e293b;";
  header.innerHTML =
    "<span>Offset</span><span>Machine Code</span><span>Source</span><span>Encoding</span>";
  table.appendChild(header);

  for (const enc of encoded) {
    if (enc.bytes.length === 0 && !enc.instruction.label) continue;

    const row = document.createElement("div");
    row.style.cssText =
      "display:grid;grid-template-columns:70px 160px 1fr 1fr;gap:4px;padding:3px 8px;font-size:10px;border-bottom:1px solid #1e293b11;line-height:1.5;";

    // ラベル行の場合は別スタイル
    if (enc.bytes.length === 0 && enc.instruction.label) {
      row.style.cssText =
        "grid-column:1/-1;padding:3px 8px;font-size:10px;color:#a78bfa;font-weight:600;border-bottom:1px solid #1e293b11;";
      row.textContent = `${enc.instruction.label}:`;
      table.appendChild(row);
      continue;
    }

    const offsetEl = document.createElement("span");
    offsetEl.style.cssText = "color:#64748b;";
    offsetEl.textContent = `0x${enc.offset.toString(16).padStart(4, "0")}`;
    row.appendChild(offsetEl);

    const hexEl = document.createElement("span");
    hexEl.style.cssText = "color:#fbbf24;font-weight:600;letter-spacing:0.5px;";
    hexEl.textContent = enc.hex;
    row.appendChild(hexEl);

    const srcEl = document.createElement("span");
    srcEl.style.cssText = "color:#e2e8f0;";
    const srcText = enc.instruction.source.trim();
    // ラベル部分を除く
    const colonIdx = srcText.indexOf(":");
    if (enc.instruction.label && colonIdx !== -1) {
      srcEl.textContent = srcText.slice(colonIdx + 1).trim();
    } else {
      srcEl.textContent = srcText;
    }
    row.appendChild(srcEl);

    const encEl = document.createElement("span");
    encEl.style.cssText = "color:#94a3b8;font-size:9px;";
    encEl.textContent = enc.encoding;
    row.appendChild(encEl);

    table.appendChild(row);
  }

  container.appendChild(table);
}

export class AsmApp {
  init(container: HTMLElement): void {
    container.style.cssText =
      "display:flex;flex-direction:column;height:100vh;font-family:'Fira Code','Cascadia Code',monospace;background:#0f172a;color:#e2e8f0;";

    // ── ヘッダ ──
    const header = document.createElement("div");
    header.style.cssText =
      "padding:8px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #1e293b;flex-wrap:wrap;";

    const titleEl = document.createElement("h1");
    titleEl.textContent = "Assembler Simulator";
    titleEl.style.cssText = "margin:0;font-size:15px;color:#fbbf24;";
    header.appendChild(titleEl);

    const subtitle = document.createElement("span");
    subtitle.style.cssText = "font-size:10px;color:#64748b;";
    subtitle.textContent = "x86-64 — 2パスアセンブル";
    header.appendChild(subtitle);

    // プリセット選択
    const presetSelect = document.createElement("select");
    presetSelect.style.cssText =
      "padding:4px 8px;background:#1e293b;border:1px solid #334155;border-radius:4px;color:#f8fafc;font-size:12px;max-width:320px;";
    for (let i = 0; i < PRESETS.length; i++) {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = PRESETS[i]!.name;
      presetSelect.appendChild(opt);
    }
    header.appendChild(presetSelect);

    // アセンブルボタン
    const asmBtn = document.createElement("button");
    asmBtn.textContent = "Assemble";
    asmBtn.style.cssText =
      "padding:4px 16px;background:#fbbf24;color:#0f172a;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;";
    header.appendChild(asmBtn);

    container.appendChild(header);

    // ── メイン ──
    const main = document.createElement("div");
    main.style.cssText = "flex:1;display:flex;overflow:hidden;";

    // 左パネル: ソースエディタ
    const leftPanel = document.createElement("div");
    leftPanel.style.cssText =
      "flex:1;display:flex;flex-direction:column;border-right:1px solid #1e293b;";

    const leftLabel = document.createElement("div");
    leftLabel.style.cssText =
      "padding:6px 12px;font-size:11px;font-weight:600;color:#fbbf24;border-bottom:1px solid #1e293b;display:flex;align-items:center;gap:8px;";
    leftLabel.textContent = "Assembly Source (x86-64)";
    leftPanel.appendChild(leftLabel);

    const textarea = document.createElement("textarea");
    textarea.style.cssText =
      "flex:1;padding:12px;font-family:inherit;font-size:12px;background:#0f172a;color:#e2e8f0;border:none;outline:none;resize:none;tab-size:2;line-height:1.6;";
    textarea.spellcheck = false;
    textarea.value = PRESETS[0]!.code;
    leftPanel.appendChild(textarea);

    // 説明
    const descDiv = document.createElement("div");
    descDiv.style.cssText =
      "padding:8px 12px;font-size:11px;color:#94a3b8;border-top:1px solid #1e293b;line-height:1.5;min-height:40px;";
    descDiv.textContent = PRESETS[0]!.description;
    leftPanel.appendChild(descDiv);

    main.appendChild(leftPanel);

    // 右パネル: 結果（上: エンコーディングテーブル、下: ステップ）
    const rightPanel = document.createElement("div");
    rightPanel.style.cssText =
      "flex:1.2;display:flex;flex-direction:column;overflow:hidden;";

    // エンコーディングテーブル領域
    const encLabel = document.createElement("div");
    encLabel.style.cssText =
      "padding:6px 12px;font-size:11px;font-weight:600;color:#34d399;border-bottom:1px solid #1e293b;";
    encLabel.textContent = "Encoding Table";
    rightPanel.appendChild(encLabel);

    const encArea = document.createElement("div");
    encArea.style.cssText = "flex:1;overflow-y:auto;padding:4px 0;";
    rightPanel.appendChild(encArea);

    // ステップ領域
    const stepLabel = document.createElement("div");
    stepLabel.style.cssText =
      "padding:6px 12px;font-size:11px;font-weight:600;color:#60a5fa;border-top:1px solid #1e293b;border-bottom:1px solid #1e293b;";
    stepLabel.textContent = "Assemble Steps";
    rightPanel.appendChild(stepLabel);

    const stepArea = document.createElement("div");
    stepArea.style.cssText = "flex:1;overflow-y:auto;padding:4px 0;";
    rightPanel.appendChild(stepArea);

    main.appendChild(rightPanel);
    container.appendChild(main);

    // ── ロジック ──
    const doAssemble = () => {
      const result = assemble(textarea.value);

      encArea.innerHTML = "";
      stepArea.innerHTML = "";

      renderEncodingTable(encArea, result.encoded);
      renderSteps(stepArea, result.steps, result.success, result.errors);
    };

    // ── イベント ──
    presetSelect.addEventListener("change", () => {
      const preset = PRESETS[Number(presetSelect.value)]!;
      textarea.value = preset.code;
      descDiv.textContent = preset.description;
      doAssemble();
    });

    asmBtn.addEventListener("click", doAssemble);

    // Ctrl+Enter でもアセンブル
    textarea.addEventListener("keydown", (e) => {
      if (e.ctrlKey && e.key === "Enter") {
        e.preventDefault();
        doAssemble();
      }
    });

    // 初期実行
    doAssemble();
  }
}
