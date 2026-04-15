/**
 * object-file.ts — オブジェクトファイルの生成ヘルパー
 *
 * コンパイラが生成するオブジェクトファイル (.o) と
 * 共有ライブラリ (.so) をプログラム的に構築するためのユーティリティ。
 *
 * 実際のコンパイルパイプライン:
 *   ソースコード → プリプロセッサ → コンパイラ → アセンブラ → オブジェクトファイル (.o)
 *
 * 本モジュールは最後の段階（オブジェクトファイル生成）をエミュレートし、
 * シンボルテーブル・リロケーション情報・セクションデータを構築する。
 */

import type {
  ObjectFile,
  SharedLibrary,
  Section,
  SymbolDef,
  Relocation,
} from "./types.js";

/**
 * オブジェクトファイルを構築するビルダー
 *
 * ビルダーパターンを使い、関数・変数・リロケーションを逐次追加して
 * 最終的に ObjectFile を生成する。
 *
 * 使用例:
 *   const obj = new ObjectFileBuilder("main.o")
 *     .addFunction("main", ["push rbp", "call add", "ret"])
 *     .addRelocation("add")      // "add" は外部シンボル → リロケーションが必要
 *     .build();
 */
export class ObjectFileBuilder {
  /** ビルド済みセクションの配列 */
  private sections: Section[] = [];
  /** 定義済みシンボル一覧 */
  private symbols: SymbolDef[] = [];
  /** 未解決参照（リロケーション）一覧 */
  private relocations: Relocation[] = [];
  /** .text セクションのアセンブリ命令行 */
  private textLines: string[] = [];
  /** .data セクションのデータ行 */
  private dataLines: string[] = [];
  /** .text セクションの現在の書き込みオフセット（バイト単位） */
  private textOffset = 0;
  /** .data セクションの現在の書き込みオフセット（バイト単位） */
  private dataOffset = 0;

  /**
   * @param name - オブジェクトファイル名（例: "main.o"）
   */
  constructor(private name: string) {}

  /**
   * 関数定義を .text セクションに追加する
   *
   * 各命令は4バイトと仮定してサイズを計算する。
   * 実際のx86-64では命令長は可変（1〜15バイト）だが、
   * シミュレーションの簡略化のため固定長とする。
   *
   * @param name    - 関数名（シンボル名）
   * @param body    - 関数本体のアセンブリ命令リスト
   * @param binding - "global"（外部公開）または "local"（ファイル内限定）
   */
  addFunction(
    name: string,
    body: string[],
    binding: "global" | "local" = "global",
  ): this {
    const offset = this.textOffset;
    const size = body.length * 4; // 命令1つ=4バイト想定
    this.symbols.push({
      name,
      kind: "function",
      binding,
      section: ".text",
      offset,
      size,
    });
    for (const line of body) {
      this.textLines.push(`  ${line}`);
    }
    this.textOffset += size;
    return this;
  }

  /**
   * グローバル変数を .data セクションに追加する
   *
   * 各変数は8バイト（64ビットワード）と仮定する。
   * 実際にはデータ型に応じてサイズが異なるが、
   * シミュレーションの簡略化のため固定サイズとする。
   *
   * @param name    - 変数名（シンボル名）
   * @param value   - 変数の初期値を表す文字列
   * @param binding - "global"（外部公開）または "local"（ファイル内限定）
   */
  addVariable(
    name: string,
    value: string,
    binding: "global" | "local" = "global",
  ): this {
    const offset = this.dataOffset;
    const size = 8;
    this.symbols.push({
      name,
      kind: "variable",
      binding,
      section: ".data",
      offset,
      size,
    });
    this.dataLines.push(`  ${name}: ${value}`);
    this.dataOffset += size;
    return this;
  }

  /**
   * 外部シンボルへの参照（リロケーション）を追加する
   *
   * コンパイラが「このシンボルのアドレスはまだ不明」と記録する処理に相当する。
   * リンカーがシンボル解決後、リロケーションエントリの位置に実アドレスをパッチする。
   *
   * リロケーションのオフセットは、追加時点での対象セクションの書き込み位置となる。
   * そのため、addFunction / addVariable の後に呼ぶ必要がある。
   *
   * @param symbol  - 参照先の外部シンボル名
   * @param section - リロケーションが存在するセクション（デフォルト: ".text"）
   * @param type    - "relative"（PC相対）または "absolute"（絶対アドレス）
   */
  addRelocation(
    symbol: string,
    section: string = ".text",
    type: "absolute" | "relative" = "relative",
  ): this {
    this.relocations.push({
      symbol,
      section,
      offset: section === ".text" ? this.textOffset : this.dataOffset,
      type,
    });
    return this;
  }

  /**
   * 蓄積された定義からオブジェクトファイルを生成する
   *
   * .text と .data の内容をセクションとしてまとめ、
   * シンボルテーブルとリロケーションテーブルを含む ObjectFile を返す。
   * 空のセクションは出力に含めない。
   */
  build(): ObjectFile {
    this.sections = [];
    // .text セクションの構築（コード部分）
    if (this.textLines.length > 0) {
      this.sections.push({
        name: ".text",
        data: [...this.textLines],
        size: this.textOffset,
      });
    }
    // .data セクションの構築（初期化済みデータ部分）
    if (this.dataLines.length > 0) {
      this.sections.push({
        name: ".data",
        data: [...this.dataLines],
        size: this.dataOffset,
      });
    }
    return {
      name: this.name,
      sections: this.sections,
      symbols: [...this.symbols],
      relocations: [...this.relocations],
    };
  }
}

/**
 * 共有ライブラリ (.so) を構築する
 *
 * 共有ライブラリは動的リンクで使用され、以下の特徴を持つ:
 * - PIC（Position-Independent Code）で生成される
 *   → GOT/PLT を介してアドレスを間接参照し、任意のアドレスにロード可能
 * - エクスポートシンボルのみが外部に公開される
 *   → シンボル可視性（visibility）で公開範囲を制御
 * - 実行時に動的リンカー（ld.so）がメモリにマップする
 *
 * 静的ライブラリ (.a) との違い:
 * - .a は単なる .o ファイルのアーカイブ（ar コマンドで作成）
 * - .a はリンク時にコードがバイナリに埋め込まれる
 * - .so は実行時にロードされ、メモリ上で共有される
 *
 * @param name      - ライブラリ名（例: "libmath.so"）
 * @param functions - エクスポートする関数の一覧
 * @param variables - エクスポートする変数の一覧（省略可）
 */
export function buildSharedLibrary(
  name: string,
  functions: { name: string; body: string[] }[],
  variables: { name: string; value: string }[] = [],
): SharedLibrary {
  const exportedSymbols: SymbolDef[] = [];
  const textLines: string[] = [];
  const dataLines: string[] = [];
  let textOffset = 0;
  let dataOffset = 0;

  // 各関数をエクスポートシンボルとして登録し、.text セクションに追加
  for (const fn of functions) {
    exportedSymbols.push({
      name: fn.name,
      kind: "function",
      binding: "global",
      section: ".text",
      offset: textOffset,
      size: fn.body.length * 4,
    });
    for (const line of fn.body) {
      textLines.push(`  ${line}`);
    }
    textOffset += fn.body.length * 4;
  }

  // 各変数をエクスポートシンボルとして登録し、.data セクションに追加
  for (const v of variables) {
    exportedSymbols.push({
      name: v.name,
      kind: "variable",
      binding: "global",
      section: ".data",
      offset: dataOffset,
      size: 8,
    });
    dataLines.push(`  ${v.name}: ${v.value}`);
    dataOffset += 8;
  }

  // 空でないセクションのみを含める
  const sections: Section[] = [];
  if (textLines.length > 0) {
    sections.push({ name: ".text", data: textLines, size: textOffset });
  }
  if (dataLines.length > 0) {
    sections.push({ name: ".data", data: dataLines, size: dataOffset });
  }

  return { name, exportedSymbols, sections };
}
