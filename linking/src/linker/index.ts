/**
 * index.ts — リンカーシミュレータの公開API
 */

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

export { ObjectFileBuilder, buildSharedLibrary } from "./object-file.js";
export { staticLink } from "./static-linker.js";
export { dynamicLink } from "./dynamic-linker.js";
