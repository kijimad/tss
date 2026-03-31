/**
 * index.ts — トランスパイラーの公開API
 */

export { parse, stripTypes } from "./parser.js";
export type { ModuleSystem, ParsedModule, ImportDecl, ExportDecl, ImportSpecifier } from "./parser.js";
export { emit } from "./emitter.js";
export type { EmitResult } from "./emitter.js";

import { parse } from "./parser.js";
import { emit } from "./emitter.js";
import type { ModuleSystem } from "./parser.js";
import type { EmitResult } from "./emitter.js";

/** TypeScript ソースを指定のモジュールシステム形式に変換する */
export function transpile(source: string, target: ModuleSystem): EmitResult {
  const parsed = parse(source);
  return emit(parsed, target);
}
