/**
 * static-linker.ts — 静的リンカーのシミュレーション
 *
 * 静的リンカー（ld -static）の動作をエミュレートする。
 * オブジェクトファイル群を結合し、シンボル解決・リロケーション適用を行って
 * 単一の実行可能バイナリを生成する。
 *
 * 静的リンクの処理フロー:
 * 1. 入力ファイルの列挙 — リンカーに渡されたすべての .o ファイルを確認
 * 2. シンボル収集       — 各ファイルのグローバルシンボルを集約し、重複を検出
 * 3. リロケーション解決 — 未解決参照にアドレスを割り当て（パッチ）
 * 4. セクション結合     — 全ファイルの同名セクションを1つに結合
 * 5. バイナリ生成       — ELFヘッダ・プログラムヘッダ付きの実行可能ファイルを出力
 *
 * 静的リンクの特徴:
 * - すべてのコードが単一バイナリに含まれる（自己完結型）
 * - 実行時に共有ライブラリが不要
 * - バイナリサイズが大きくなりやすい
 * - ライブラリ更新時はリコンパイルが必要
 *
 * リンク順序の重要性:
 *   実際の静的リンカーでは、コマンドラインでの .o / .a の指定順序が重要。
 *   リンカーは左から右に処理し、その時点で未解決のシンボルだけを解決する。
 *   例: gcc main.o -lmath は OK だが、gcc -lmath main.o は失敗することがある。
 */

import type {
  ObjectFile,
  StaticLinkResult,
  LinkStep,
  Section,
} from "./types.js";

/**
 * テキストセグメントのベースアドレス
 * Linux x86-64 の典型的な実行可能ファイルのデフォルトベースアドレス。
 * .text セクション（機械語命令）がこのアドレスから配置される。
 */
const TEXT_BASE = 0x400000;

/**
 * データセグメントのベースアドレス
 * .data セクション（初期化済みグローバル変数）がこのアドレスから配置される。
 * テキストセグメントと十分な間隔を空けて配置する。
 */
const DATA_BASE = 0x600000;

/**
 * 静的リンクを実行する
 *
 * 複数のオブジェクトファイルを入力として受け取り、
 * シンボル解決 → リロケーション適用 → セクション結合 の順に処理して
 * 最終的な実行可能バイナリの情報を生成する。
 *
 * エラーが発生するケース:
 * - 多重定義: 同じ名前のグローバルシンボルが複数ファイルで定義されている
 * - 未定義参照: リロケーションが参照するシンボルがどこにも定義されていない
 *
 * @param objects - リンク対象のオブジェクトファイル一覧
 * @returns リンク結果（成功/失敗、処理ステップ、結合セクション、シンボルテーブル）
 */
export function staticLink(objects: ObjectFile[]): StaticLinkResult {
  const steps: LinkStep[] = [];
  const errors: string[] = [];
  /** 解決済みグローバルシンボルテーブル（シンボル名 → アドレス + 定義元） */
  const symbolTable = new Map<string, { address: number; source: string }>();

  // ── フェーズ1: 入力ファイルの列挙 ──
  // リンカーに渡されたすべてのオブジェクトファイルを確認し、
  // 各ファイルのセクション数・シンボル数・リロケーション数を報告する
  steps.push({
    phase: "入力収集",
    description: `${objects.length} 個のオブジェクトファイルを読み込み`,
    detail: objects.map((o) => `  ${o.name}: ${o.sections.length} セクション, ${o.symbols.length} シンボル, ${o.relocations.length} リロケーション`).join("\n"),
  });

  // ── フェーズ2: シンボル収集と重複チェック ──
  // 各オブジェクトファイルのグローバルシンボルを走査し、
  // 最終バイナリ内でのアドレスを計算してシンボルテーブルに登録する。
  // ローカルシンボル（static 修飾）はファイル内限定のため、グローバルテーブルには追加しない。

  /** UI表示用のシンボル一覧 */
  const allSymbols: { name: string; source: string; address: number }[] = [];
  /** .text セクションの累積オフセット（各 .o の .text を連続配置するため） */
  let textOffset = 0;
  /** .data セクションの累積オフセット（各 .o の .data を連続配置するため） */
  let dataOffset = 0;

  /**
   * 各オブジェクトファイルのセクション配置オフセットを記録する。
   * フェーズ3のリロケーション解決時に、各リロケーションの最終アドレスを
   * 計算するために使用する。
   */
  const sectionOffsets = new Map<string, { text: number; data: number }>();

  for (const obj of objects) {
    // このオブジェクトの .text / .data セクションサイズを取得
    const objTextSize =
      obj.sections.find((s) => s.name === ".text")?.size ?? 0;
    const objDataSize =
      obj.sections.find((s) => s.name === ".data")?.size ?? 0;

    // このファイルのセクションが最終バイナリ内のどのオフセットに配置されるかを記録
    sectionOffsets.set(obj.name, { text: textOffset, data: dataOffset });

    for (const sym of obj.symbols) {
      // ローカルシンボルは他ファイルから参照不可のためスキップ
      if (sym.binding === "local") continue;

      // シンボルの最終仮想アドレスを計算
      // = セグメントベース + ファイルのオフセット + セクション内オフセット
      const addr =
        sym.section === ".text"
          ? TEXT_BASE + textOffset + sym.offset
          : DATA_BASE + dataOffset + sym.offset;

      // 重複グローバルシンボルのチェック
      // C言語では「一つ定義規則（One Definition Rule）」により、
      // 同名のグローバルシンボルは1つだけ許される
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

    // 次のファイルのセクションは、このファイルの直後に配置される
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

  // 多重定義エラーがあれば早期リターン
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
  // 各オブジェクトファイルのリロケーションエントリを処理し、
  // 参照先シンボルの最終アドレスを用いてパッチ内容を計算する。
  //
  // リロケーションの種類:
  // - 相対（PC相対）: call/jmp 命令用。命令位置からの差分を計算
  //   計算式: target_address - relocation_address - 4  （-4は命令サイズ分）
  // - 絶対: データ参照用。ターゲットの絶対アドレスを埋め込む

  const relocationDetails: string[] = [];
  let unresolvedCount = 0;

  for (const obj of objects) {
    const offsets = sectionOffsets.get(obj.name)!;

    for (const reloc of obj.relocations) {
      const resolved = symbolTable.get(reloc.symbol);
      if (!resolved) {
        // 未定義参照エラー: 参照先シンボルがどこにも定義されていない
        // 実際のリンカーでは "undefined reference to 'xxx'" と表示される
        errors.push(
          `未定義参照: ${obj.name} が参照するシンボル '${reloc.symbol}' が見つかりません`,
        );
        unresolvedCount++;
      } else {
        // リロケーション箇所の最終アドレスを計算
        const relocAddr =
          reloc.section === ".text"
            ? TEXT_BASE + offsets.text + reloc.offset
            : DATA_BASE + offsets.data + reloc.offset;

        if (reloc.type === "relative") {
          // PC相対リロケーション: ターゲットとの差分を計算
          // x86-64 の call 命令は「次の命令アドレスからの相対値」を使うため -4 する
          const relative = resolved.address - relocAddr - 4;
          relocationDetails.push(
            `  ${obj.name}:${reloc.section}+0x${reloc.offset.toString(16)} → ${reloc.symbol} (相対: ${relative >= 0 ? "+" : ""}${relative})`,
          );
        } else {
          // 絶対リロケーション: ターゲットの絶対アドレスをそのまま埋め込む
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

  // 未定義参照エラーがあれば早期リターン
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
  // 全オブジェクトファイルの同名セクションを1つに結合する。
  // 各ファイルの .text を順番に連結し、.data も同様に連結する。
  // リンカースクリプト（linker script）によってセクション配置をカスタマイズ可能
  // だが、本シミュレータではデフォルト配置を使用する。

  /** 結合後の .text セクション内容 */
  const mergedText: string[] = [];
  /** 結合後の .data セクション内容 */
  const mergedData: string[] = [];

  for (const obj of objects) {
    for (const sec of obj.sections) {
      if (sec.name === ".text") {
        // 各ファイルの境界にコメント行を挿入（デバッグ・可視化用）
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
  // ELFヘッダ、プログラムヘッダテーブル、結合済みセクションを含む
  // 実行可能ファイルを出力する。エントリポイントは .text セクションの先頭。
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
