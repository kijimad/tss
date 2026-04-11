/**
 * types.ts — リンカーシミュレータの型定義
 */

/** シンボルの種類 */
export type SymbolKind = "function" | "variable";

/** シンボルのバインディング（公開範囲） */
export type SymbolBinding = "global" | "local";

/** シンボル定義 */
export interface SymbolDef {
  name: string;
  kind: SymbolKind;
  binding: SymbolBinding;
  /** シンボルが定義されているセクション */
  section: string;
  /** セクション内のオフセット */
  offset: number;
  /** サイズ（バイト） */
  size: number;
}

/** 未解決の参照（リロケーション） */
export interface Relocation {
  /** 参照先シンボル名 */
  symbol: string;
  /** リロケーションが存在するセクション */
  section: string;
  /** セクション内のオフセット */
  offset: number;
  /** リロケーション種別 */
  type: "absolute" | "relative";
}

/** セクション */
export interface Section {
  name: string;
  data: string[];
  size: number;
}

/** オブジェクトファイル (.o) */
export interface ObjectFile {
  name: string;
  sections: Section[];
  symbols: SymbolDef[];
  relocations: Relocation[];
}

/** 共有ライブラリ (.so / .dll) */
export interface SharedLibrary {
  name: string;
  /** エクスポートされるシンボル */
  exportedSymbols: SymbolDef[];
  sections: Section[];
}

/** リンク結果の1ステップ */
export interface LinkStep {
  phase: string;
  description: string;
  detail: string;
}

/** 静的リンク結果 */
export interface StaticLinkResult {
  success: boolean;
  steps: LinkStep[];
  /** 結合されたセクション */
  mergedSections: Section[];
  /** 解決済みシンボルテーブル */
  symbolTable: Map<string, { address: number; source: string }>;
  /** エラーメッセージ（失敗時） */
  errors: string[];
}

/** 動的リンク結果 */
export interface DynamicLinkResult {
  success: boolean;
  steps: LinkStep[];
  /** GOT (Global Offset Table) */
  got: Map<string, { index: number; resolvedAddress: number | null }>;
  /** PLT (Procedure Linkage Table) */
  plt: Map<string, { index: number; gotEntry: number }>;
  /** 実行時に必要な共有ライブラリ */
  neededLibraries: string[];
  errors: string[];
}
