/**
 * index.ts — リンカーシミュレータの公開API
 *
 * リンカーシミュレータの全モジュールをここで再エクスポートする。
 * 外部から利用する場合は、このモジュールを通じてアクセスする。
 *
 * 主要なエクスポート:
 * - 型定義: ObjectFile, SharedLibrary, SymbolDef, Relocation, Section 等
 * - ビルダー: ObjectFileBuilder（.o 生成）, buildSharedLibrary（.so 生成）
 * - リンカー: staticLink（静的リンク実行）, dynamicLink（動的リンク実行）
 */

/** 型定義の再エクスポート */
export type {
  ObjectFile,
  SharedLibrary,
  SymbolDef,
  Relocation,
  Section,
  SymbolKind,
  SymbolBinding,
  LinkStep,
  StaticLinkResult,
  DynamicLinkResult,
} from "./types.js";

/** オブジェクトファイル・共有ライブラリの構築ユーティリティ */
export { ObjectFileBuilder, buildSharedLibrary } from "./object-file.js";
/** 静的リンカー */
export { staticLink } from "./static-linker.js";
/** 動的リンカー */
export { dynamicLink } from "./dynamic-linker.js";
