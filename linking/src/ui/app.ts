/**
 * app.ts — リンカーシミュレータの UI
 */

import { staticLink } from "../linker/static-linker.js";
import { dynamicLink } from "../linker/dynamic-linker.js";
import { PRESETS } from "../linker/presets.js";
import type { LinkStep, ObjectFile, SharedLibrary } from "../linker/types.js";

/** フェーズごとのアクセントカラー */
function phaseColor(phase: string): string {
  if (phase.includes("エラー")) return "#f87171";
  if (phase.includes("入力")) return "#60a5fa";
  if (phase.includes("シンボル")) return "#a78bfa";
  if (phase.includes("リロケーション")) return "#fbbf24";
  if (phase.includes("セクション")) return "#34d399";
  if (phase.includes("バイナリ")) return "#2dd4bf";
  if (phase.includes("ライブラリ")) return "#f472b6";
  if (phase.includes("GOT")) return "#fb923c";
  if (phase.includes("PLT")) return "#e879f9";
  if (phase.includes("遅延")) return "#38bdf8";
  if (phase.includes("リンク完了")) return "#4ade80";
  return "#94a3b8";
}

/** モード表示用のバッジ色 */
function modeColor(mode: "static" | "dynamic" | "both"): string {
  switch (mode) {
    case "static": return "#34d399";
    case "dynamic": return "#60a5fa";
    case "both": return "#fbbf24";
  }
}

function modeLabel(mode: "static" | "dynamic" | "both"): string {
  switch (mode) {
    case "static": return "静的リンク";
    case "dynamic": return "動的リンク";
    case "both": return "静的 vs 動的";
  }
}

/** ステップ一覧を描画 */
function renderSteps(
  container: HTMLElement,
  title: string,
  steps: LinkStep[],
  success: boolean,
  errors: string[],
  accentColor: string,
): void {
  const section = document.createElement("div");
  section.style.cssText = "margin-bottom:16px;";

  const header = document.createElement("div");
  header.style.cssText = `padding:6px 12px;font-size:13px;font-weight:700;color:${accentColor};border-bottom:1px solid ${accentColor}33;margin-bottom:8px;display:flex;align-items:center;gap:8px;`;
  header.textContent = title;

  const badge = document.createElement("span");
  badge.style.cssText = `font-size:10px;padding:1px 8px;border-radius:8px;font-weight:600;${success ? `background:#4ade8022;color:#4ade80;border:1px solid #4ade8044` : `background:#f8717122;color:#f87171;border:1px solid #f8717144`}`;
  badge.textContent = success ? "成功" : "失敗";
  header.appendChild(badge);
  section.appendChild(header);

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

    section.appendChild(card);
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
    section.appendChild(errBox);
  }

  container.appendChild(section);
}

/** オブジェクトファイルの情報を表示 */
function renderObjectInfo(
  container: HTMLElement,
  objects: ObjectFile[],
  libraries: SharedLibrary[],
): void {
  const section = document.createElement("div");
  section.style.cssText =
    "margin-bottom:12px;padding:8px 12px;background:#0f172a;border:1px solid #1e293b;border-radius:4px;";

  const title = document.createElement("div");
  title.style.cssText =
    "font-size:11px;font-weight:700;color:#64748b;margin-bottom:6px;letter-spacing:0.5px;";
  title.textContent = "入力ファイル";
  section.appendChild(title);

  for (const obj of objects) {
    const item = document.createElement("div");
    item.style.cssText = "margin-bottom:6px;";

    const nameEl = document.createElement("span");
    nameEl.style.cssText =
      "font-size:12px;font-weight:600;color:#7dd3fc;margin-right:8px;";
    nameEl.textContent = obj.name;
    item.appendChild(nameEl);

    const meta = document.createElement("span");
    meta.style.cssText = "font-size:10px;color:#64748b;";
    meta.textContent = `${obj.symbols.length} シンボル, ${obj.relocations.length} リロケーション`;
    item.appendChild(meta);

    // シンボル一覧
    const symList = document.createElement("div");
    symList.style.cssText = "margin-left:12px;margin-top:2px;";
    for (const sym of obj.symbols) {
      const symEl = document.createElement("div");
      symEl.style.cssText = "font-size:10px;color:#94a3b8;line-height:1.4;";
      const kindTag = sym.kind === "function" ? "fn" : "var";
      const bindTag = sym.binding === "global" ? "G" : "L";
      symEl.textContent = `[${bindTag}] ${kindTag} ${sym.name} (${sym.section}+0x${sym.offset.toString(16)}, ${sym.size}B)`;
      symList.appendChild(symEl);
    }
    for (const reloc of obj.relocations) {
      const relEl = document.createElement("div");
      relEl.style.cssText = "font-size:10px;color:#fbbf24;line-height:1.4;";
      relEl.textContent = `→ REF ${reloc.symbol} (${reloc.section}+0x${reloc.offset.toString(16)}, ${reloc.type})`;
      symList.appendChild(relEl);
    }
    item.appendChild(symList);
    section.appendChild(item);
  }

  for (const lib of libraries) {
    const item = document.createElement("div");
    item.style.cssText = "margin-bottom:6px;";

    const nameEl = document.createElement("span");
    nameEl.style.cssText =
      "font-size:12px;font-weight:600;color:#f472b6;margin-right:8px;";
    nameEl.textContent = lib.name;
    item.appendChild(nameEl);

    const meta = document.createElement("span");
    meta.style.cssText = "font-size:10px;color:#64748b;";
    meta.textContent = `${lib.exportedSymbols.length} エクスポート (共有ライブラリ)`;
    item.appendChild(meta);

    const symList = document.createElement("div");
    symList.style.cssText = "margin-left:12px;margin-top:2px;";
    for (const sym of lib.exportedSymbols) {
      const symEl = document.createElement("div");
      symEl.style.cssText = "font-size:10px;color:#94a3b8;line-height:1.4;";
      const kindTag = sym.kind === "function" ? "fn" : "var";
      symEl.textContent = `[E] ${kindTag} ${sym.name}`;
      symList.appendChild(symEl);
    }
    item.appendChild(symList);
    section.appendChild(item);
  }

  container.appendChild(section);
}

export class LinkingApp {
  init(container: HTMLElement): void {
    container.style.cssText =
      "display:flex;flex-direction:column;height:100vh;font-family:'Fira Code','Cascadia Code',monospace;background:#0f172a;color:#e2e8f0;";

    // ── ヘッダ ──
    const header = document.createElement("div");
    header.style.cssText =
      "padding:8px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #1e293b;flex-wrap:wrap;";

    const titleEl = document.createElement("h1");
    titleEl.textContent = "Linker Simulator";
    titleEl.style.cssText = "margin:0;font-size:15px;color:#34d399;";
    header.appendChild(titleEl);

    const subtitle = document.createElement("span");
    subtitle.style.cssText = "font-size:10px;color:#64748b;";
    subtitle.textContent = "静的リンク / 動的リンク";
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

    // リンク実行ボタン
    const runBtn = document.createElement("button");
    runBtn.textContent = "Link";
    runBtn.style.cssText =
      "padding:4px 16px;background:#34d399;color:#0f172a;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;";
    header.appendChild(runBtn);

    container.appendChild(header);

    // ── メイン ──
    const main = document.createElement("div");
    main.style.cssText = "flex:1;display:flex;overflow:hidden;";

    // 左パネル: 入力情報
    const leftPanel = document.createElement("div");
    leftPanel.style.cssText =
      "width:340px;min-width:280px;display:flex;flex-direction:column;border-right:1px solid #1e293b;overflow-y:auto;";

    const leftLabel = document.createElement("div");
    leftLabel.style.cssText =
      "padding:6px 12px;font-size:11px;font-weight:600;color:#64748b;border-bottom:1px solid #1e293b;letter-spacing:0.5px;display:flex;align-items:center;gap:8px;";
    leftLabel.textContent = "入力";
    leftPanel.appendChild(leftLabel);

    const leftContent = document.createElement("div");
    leftContent.style.cssText = "flex:1;padding:8px;overflow-y:auto;";
    leftPanel.appendChild(leftContent);

    // 説明エリア
    const descDiv = document.createElement("div");
    descDiv.style.cssText =
      "padding:8px 12px;font-size:11px;color:#94a3b8;border-top:1px solid #1e293b;line-height:1.5;";
    leftPanel.appendChild(descDiv);

    main.appendChild(leftPanel);

    // 右パネル: リンク結果
    const rightPanel = document.createElement("div");
    rightPanel.style.cssText =
      "flex:1;display:flex;flex-direction:column;overflow-y:auto;";

    const rightLabel = document.createElement("div");
    rightLabel.style.cssText =
      "padding:6px 12px;font-size:11px;font-weight:600;color:#64748b;border-bottom:1px solid #1e293b;letter-spacing:0.5px;display:flex;align-items:center;gap:8px;";
    rightLabel.textContent = "リンク結果";
    rightPanel.appendChild(rightLabel);

    const rightContent = document.createElement("div");
    rightContent.style.cssText = "flex:1;padding:8px;overflow-y:auto;";
    rightPanel.appendChild(rightContent);

    main.appendChild(rightPanel);
    container.appendChild(main);

    // モードバッジの参照
    const modeBadge = document.createElement("span");
    modeBadge.style.cssText =
      "padding:1px 8px;border-radius:8px;font-size:10px;font-weight:600;";
    leftLabel.appendChild(modeBadge);

    // ── ロジック ──
    const doLink = () => {
      const preset = PRESETS[Number(presetSelect.value)]!;
      const color = modeColor(preset.mode);

      // モードバッジ更新
      modeBadge.textContent = modeLabel(preset.mode);
      modeBadge.style.cssText = `padding:1px 8px;border-radius:8px;font-size:10px;font-weight:600;background:${color}22;color:${color};border:1px solid ${color}44;`;

      // 左パネル更新
      leftContent.innerHTML = "";
      renderObjectInfo(leftContent, preset.objects, preset.libraries);
      descDiv.textContent = preset.description;

      // 右パネル更新
      rightContent.innerHTML = "";

      if (preset.mode === "static" || preset.mode === "both") {
        // 静的リンク: ライブラリのシンボルもオブジェクトファイルとして扱う
        const allObjects = [...preset.objects];
        if (preset.mode === "both") {
          // ライブラリをオブジェクトファイルに変換（静的リンクの場合）
          for (const lib of preset.libraries) {
            allObjects.push({
              name: `${lib.name} (静的アーカイブとして)`,
              sections: lib.sections,
              symbols: lib.exportedSymbols,
              relocations: [],
            });
          }
        }
        const staticResult = staticLink(allObjects);
        renderSteps(
          rightContent,
          preset.mode === "both" ? "静的リンク (ld -static)" : "静的リンク",
          staticResult.steps,
          staticResult.success,
          staticResult.errors,
          "#34d399",
        );
      }

      if (preset.mode === "dynamic" || preset.mode === "both") {
        const dynamicResult = dynamicLink(preset.objects, preset.libraries);
        renderSteps(
          rightContent,
          preset.mode === "both" ? "動的リンク (ld -dynamic)" : "動的リンク",
          dynamicResult.steps,
          dynamicResult.success,
          dynamicResult.errors,
          "#60a5fa",
        );
      }
    };

    // ── イベント ──
    presetSelect.addEventListener("change", doLink);
    runBtn.addEventListener("click", doLink);

    // 初期実行
    doLink();
  }
}
