/**
 * dynamic-linker.ts — 動的リンカーのシミュレーション
 *
 * オブジェクトファイルと共有ライブラリを受け取り、
 * GOT/PLT を構築して遅延バインディングをシミュレートする。
 */

import type {
  ObjectFile,
  SharedLibrary,
  DynamicLinkResult,
  LinkStep,
} from "./types.js";

/** GOT のベースアドレス */
const GOT_BASE = 0x601000;
/** PLT のベースアドレス */
const PLT_BASE = 0x400800;
/** 共有ライブラリのロードアドレスベース */
const LIB_BASE = 0x7f0000;

/** 動的リンクを実行 */
export function dynamicLink(
  objects: ObjectFile[],
  libraries: SharedLibrary[],
): DynamicLinkResult {
  const steps: LinkStep[] = [];
  const errors: string[] = [];
  const got = new Map<string, { index: number; resolvedAddress: number | null }>();
  const plt = new Map<string, { index: number; gotEntry: number }>();
  const neededLibraries: string[] = [];

  // ── フェーズ1: 入力の確認 ──
  steps.push({
    phase: "入力収集",
    description: `${objects.length} オブジェクト + ${libraries.length} 共有ライブラリ`,
    detail: [
      "オブジェクトファイル:",
      ...objects.map((o) => `  ${o.name} (${o.relocations.length} リロケーション)`),
      "共有ライブラリ:",
      ...libraries.map((l) => `  ${l.name} (${l.exportedSymbols.length} エクスポート)`),
    ].join("\n"),
  });

  // ── フェーズ2: 共有ライブラリのシンボル収集 ──
  const libSymbols = new Map<string, { library: string; address: number }>();
  let libOffset = 0;

  for (const lib of libraries) {
    neededLibraries.push(lib.name);
    const loadAddr = LIB_BASE + libOffset;

    for (const sym of lib.exportedSymbols) {
      const addr = loadAddr + sym.offset;
      libSymbols.set(sym.name, { library: lib.name, address: addr });
    }

    const libSize = lib.sections.reduce((sum, s) => sum + s.size, 0);
    libOffset += Math.max(libSize, 0x1000); // 最低4KBアラインメント
  }

  steps.push({
    phase: "ライブラリ解析",
    description: `${libSymbols.size} 個のエクスポートシンボルを発見`,
    detail: [...libSymbols.entries()]
      .map(
        ([name, info]) =>
          `  ${name}: 0x${info.address.toString(16).padStart(6, "0")} (${info.library})`,
      )
      .join("\n"),
  });

  // ── フェーズ3: 外部参照を特定し GOT/PLT を構築 ──
  /** オブジェクトファイル内で定義済みのシンボル */
  const localSymbols = new Set<string>();
  for (const obj of objects) {
    for (const sym of obj.symbols) {
      if (sym.binding === "global") localSymbols.add(sym.name);
    }
  }

  /** 外部参照の収集 */
  const externalRefs = new Set<string>();
  for (const obj of objects) {
    for (const reloc of obj.relocations) {
      if (!localSymbols.has(reloc.symbol)) {
        externalRefs.add(reloc.symbol);
      }
    }
  }

  let gotIndex = 0;
  let pltIndex = 0;
  const gotDetails: string[] = [];
  const pltDetails: string[] = [];

  for (const ref of externalRefs) {
    const libSym = libSymbols.get(ref);

    // GOT エントリを作成（初期値は0 = 未解決）
    const gotAddr = GOT_BASE + gotIndex * 8;
    got.set(ref, {
      index: gotIndex,
      resolvedAddress: libSym ? libSym.address : null,
    });
    gotDetails.push(
      `  GOT[${gotIndex}] (0x${gotAddr.toString(16)}): ${ref} → ${libSym ? `0x${libSym.address.toString(16).padStart(6, "0")}` : "未解決"}`,
    );

    // 関数参照の場合は PLT エントリも作成
    const isFunction = libSym
      ? libraries.some((l) =>
          l.exportedSymbols.some(
            (s) => s.name === ref && s.kind === "function",
          ),
        )
      : true; // 不明な場合は関数と仮定

    if (isFunction) {
      const pltAddr = PLT_BASE + pltIndex * 16;
      plt.set(ref, { index: pltIndex, gotEntry: gotIndex });
      pltDetails.push(
        `  PLT[${pltIndex}] (0x${pltAddr.toString(16)}): ${ref} → GOT[${gotIndex}]`,
      );
      pltIndex++;
    }

    gotIndex++;

    if (!libSym) {
      errors.push(
        `未定義参照: シンボル '${ref}' がどの共有ライブラリにも見つかりません`,
      );
    }
  }

  steps.push({
    phase: "GOT 構築",
    description: `${got.size} エントリの GOT (Global Offset Table) を構築`,
    detail:
      gotDetails.length > 0
        ? [
            `  ベースアドレス: 0x${GOT_BASE.toString(16)}`,
            `  エントリサイズ: 8 バイト`,
            "",
            ...gotDetails,
          ].join("\n")
        : "  外部参照なし",
  });

  steps.push({
    phase: "PLT 構築",
    description: `${plt.size} エントリの PLT (Procedure Linkage Table) を構築`,
    detail:
      pltDetails.length > 0
        ? [
            `  ベースアドレス: 0x${PLT_BASE.toString(16)}`,
            `  エントリサイズ: 16 バイト`,
            "",
            ...pltDetails,
            "",
            "  PLT の仕組み:",
            "    1. 関数呼び出し → PLT エントリにジャンプ",
            "    2. PLT → GOT から実アドレスを間接参照",
            "    3. 初回は動的リンカー (ld.so) に制御が渡る",
            "    4. ld.so がシンボルを解決し GOT を更新",
            "    5. 2回目以降は GOT から直接ジャンプ（遅延バインディング）",
          ].join("\n")
        : "  関数の外部参照なし",
  });

  if (errors.length > 0) {
    return { success: false, steps, got, plt, neededLibraries, errors };
  }

  // ── フェーズ4: 遅延バインディングのシミュレーション ──
  const lazyDetails: string[] = [];
  for (const [name, pltEntry] of plt) {
    const gotEntry = got.get(name)!;
    const gotAddr = GOT_BASE + pltEntry.gotEntry * 8;
    lazyDetails.push(
      `  call ${name}:`,
      `    → JMP *0x${gotAddr.toString(16)}         ; PLT[${pltEntry.index}] → GOT[${pltEntry.gotEntry}]`,
      `    初回: GOT[${pltEntry.gotEntry}] = PLT+6 → _dl_runtime_resolve`,
      `    解決後: GOT[${pltEntry.gotEntry}] = 0x${(gotEntry.resolvedAddress ?? 0).toString(16).padStart(6, "0")}`,
      "",
    );
  }

  steps.push({
    phase: "遅延バインディング",
    description: "PLT/GOT による遅延バインディングの流れ",
    detail:
      lazyDetails.length > 0
        ? lazyDetails.join("\n")
        : "  外部関数呼び出しなし",
  });

  // ── フェーズ5: 最終結果 ──
  steps.push({
    phase: "リンク完了",
    description: `動的リンク成功 — ${neededLibraries.length} 共有ライブラリに依存`,
    detail: [
      `  必要なライブラリ: ${neededLibraries.join(", ")}`,
      `  GOT エントリ数: ${got.size}`,
      `  PLT エントリ数: ${plt.size}`,
      "",
      "  静的リンクとの違い:",
      "    ・ライブラリコードはバイナリに含まれない",
      "    ・実行時に ld.so がライブラリをロード",
      "    ・GOT/PLT を通じてシンボルを間接参照",
      "    ・ライブラリ更新時にリコンパイル不要",
      "    ・メモリ上でライブラリを複数プロセスで共有可能",
    ].join("\n"),
  });

  return { success: true, steps, got, plt, neededLibraries, errors };
}
