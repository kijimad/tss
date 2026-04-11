/**
 * static-linker.ts — 静的リンカーのシミュレーション
 *
 * オブジェクトファイル群を結合し、シンボル解決・リロケーション適用を行って
 * 単一の実行可能バイナリを生成する。
 */

import type {
  ObjectFile,
  StaticLinkResult,
  LinkStep,
  Section,
} from "./types.js";

/** ベースアドレス（テキストセグメント） */
const TEXT_BASE = 0x400000;
/** データセグメントのベースアドレス */
const DATA_BASE = 0x600000;

/** 静的リンクを実行 */
export function staticLink(objects: ObjectFile[]): StaticLinkResult {
  const steps: LinkStep[] = [];
  const errors: string[] = [];
  const symbolTable = new Map<string, { address: number; source: string }>();

  // ── フェーズ1: 入力ファイルの列挙 ──
  steps.push({
    phase: "入力収集",
    description: `${objects.length} 個のオブジェクトファイルを読み込み`,
    detail: objects.map((o) => `  ${o.name}: ${o.sections.length} セクション, ${o.symbols.length} シンボル, ${o.relocations.length} リロケーション`).join("\n"),
  });

  // ── フェーズ2: シンボル収集と重複チェック ──
  const allSymbols: { name: string; source: string; address: number }[] = [];
  let textOffset = 0;
  let dataOffset = 0;

  /** 各オブジェクトファイルのセクション配置オフセット */
  const sectionOffsets = new Map<string, { text: number; data: number }>();

  for (const obj of objects) {
    const objTextSize =
      obj.sections.find((s) => s.name === ".text")?.size ?? 0;
    const objDataSize =
      obj.sections.find((s) => s.name === ".data")?.size ?? 0;

    sectionOffsets.set(obj.name, { text: textOffset, data: dataOffset });

    for (const sym of obj.symbols) {
      if (sym.binding === "local") continue;

      const addr =
        sym.section === ".text"
          ? TEXT_BASE + textOffset + sym.offset
          : DATA_BASE + dataOffset + sym.offset;

      // 重複グローバルシンボルのチェック
      if (symbolTable.has(sym.name)) {
        const existing = symbolTable.get(sym.name)!;
        errors.push(
          `多重定義: シンボル '${sym.name}' が ${existing.source} と ${obj.name} の両方で定義されています`,
        );
      } else {
        symbolTable.set(sym.name, { address: addr, source: obj.name });
        allSymbols.push({ name: sym.name, source: obj.name, address: addr });
      }
    }

    textOffset += objTextSize;
    dataOffset += objDataSize;
  }

  steps.push({
    phase: "シンボル収集",
    description: `${symbolTable.size} 個のグローバルシンボルを収集`,
    detail: allSymbols
      .map(
        (s) =>
          `  ${s.name}: 0x${s.address.toString(16).padStart(6, "0")} (${s.source})`,
      )
      .join("\n"),
  });

  if (errors.length > 0) {
    steps.push({
      phase: "エラー",
      description: "多重定義エラーが検出されました",
      detail: errors.join("\n"),
    });
    return {
      success: false,
      steps,
      mergedSections: [],
      symbolTable,
      errors,
    };
  }

  // ── フェーズ3: リロケーション解決 ──
  const relocationDetails: string[] = [];
  let unresolvedCount = 0;

  for (const obj of objects) {
    const offsets = sectionOffsets.get(obj.name)!;

    for (const reloc of obj.relocations) {
      const resolved = symbolTable.get(reloc.symbol);
      if (!resolved) {
        errors.push(
          `未定義参照: ${obj.name} が参照するシンボル '${reloc.symbol}' が見つかりません`,
        );
        unresolvedCount++;
      } else {
        const relocAddr =
          reloc.section === ".text"
            ? TEXT_BASE + offsets.text + reloc.offset
            : DATA_BASE + offsets.data + reloc.offset;

        if (reloc.type === "relative") {
          const relative = resolved.address - relocAddr - 4;
          relocationDetails.push(
            `  ${obj.name}:${reloc.section}+0x${reloc.offset.toString(16)} → ${reloc.symbol} (相対: ${relative >= 0 ? "+" : ""}${relative})`,
          );
        } else {
          relocationDetails.push(
            `  ${obj.name}:${reloc.section}+0x${reloc.offset.toString(16)} → ${reloc.symbol} (絶対: 0x${resolved.address.toString(16).padStart(6, "0")})`,
          );
        }
      }
    }
  }

  const totalRelocs = objects.reduce(
    (sum, o) => sum + o.relocations.length,
    0,
  );
  steps.push({
    phase: "リロケーション",
    description: `${totalRelocs} 件のリロケーションを処理 (${unresolvedCount} 件未解決)`,
    detail:
      relocationDetails.length > 0
        ? relocationDetails.join("\n")
        : "  リロケーションなし",
  });

  if (errors.length > 0) {
    return {
      success: false,
      steps,
      mergedSections: [],
      symbolTable,
      errors,
    };
  }

  // ── フェーズ4: セクション結合 ──
  const mergedText: string[] = [];
  const mergedData: string[] = [];

  for (const obj of objects) {
    for (const sec of obj.sections) {
      if (sec.name === ".text") {
        mergedText.push(`; --- ${obj.name} .text ---`);
        mergedText.push(...sec.data);
      } else if (sec.name === ".data") {
        mergedData.push(`; --- ${obj.name} .data ---`);
        mergedData.push(...sec.data);
      }
    }
  }

  const mergedSections: Section[] = [];
  if (mergedText.length > 0) {
    mergedSections.push({
      name: ".text",
      data: mergedText,
      size: textOffset,
    });
  }
  if (mergedData.length > 0) {
    mergedSections.push({
      name: ".data",
      data: mergedData,
      size: dataOffset,
    });
  }

  steps.push({
    phase: "セクション結合",
    description: `${mergedSections.length} セクションに結合`,
    detail: mergedSections
      .map(
        (s) =>
          `  ${s.name}: ${s.size} バイト (base=0x${(s.name === ".text" ? TEXT_BASE : DATA_BASE).toString(16)})`,
      )
      .join("\n"),
  });

  // ── フェーズ5: 最終バイナリ生成 ──
  const totalSize = textOffset + dataOffset;
  steps.push({
    phase: "バイナリ生成",
    description: `実行可能ファイルを生成 (合計 ${totalSize} バイト)`,
    detail: [
      `  エントリポイント: 0x${TEXT_BASE.toString(16)}`,
      `  .text: 0x${TEXT_BASE.toString(16)} - 0x${(TEXT_BASE + textOffset).toString(16)}`,
      `  .data: 0x${DATA_BASE.toString(16)} - 0x${(DATA_BASE + dataOffset).toString(16)}`,
      `  シンボル数: ${symbolTable.size}`,
      `  全コードがバイナリに埋め込まれる（外部依存なし）`,
    ].join("\n"),
  });

  return { success: true, steps, mergedSections, symbolTable, errors };
}
