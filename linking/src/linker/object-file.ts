/**
 * object-file.ts — オブジェクトファイルの生成ヘルパー
 */

import type {
  ObjectFile,
  SharedLibrary,
  Section,
  SymbolDef,
  Relocation,
} from "./types.js";

/** オブジェクトファイルを構築するビルダー */
export class ObjectFileBuilder {
  private sections: Section[] = [];
  private symbols: SymbolDef[] = [];
  private relocations: Relocation[] = [];
  private textLines: string[] = [];
  private dataLines: string[] = [];
  private textOffset = 0;
  private dataOffset = 0;

  constructor(private name: string) {}

  /** 関数定義を追加 */
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

  /** グローバル変数を追加 */
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

  /** 外部シンボルへの参照（リロケーション）を追加 */
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

  /** オブジェクトファイルをビルド */
  build(): ObjectFile {
    this.sections = [];
    if (this.textLines.length > 0) {
      this.sections.push({
        name: ".text",
        data: [...this.textLines],
        size: this.textOffset,
      });
    }
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

/** 共有ライブラリを構築する */
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

  const sections: Section[] = [];
  if (textLines.length > 0) {
    sections.push({ name: ".text", data: textLines, size: textOffset });
  }
  if (dataLines.length > 0) {
    sections.push({ name: ".data", data: dataLines, size: dataOffset });
  }

  return { name, exportedSymbols, sections };
}
