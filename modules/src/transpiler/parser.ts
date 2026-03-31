/**
 * parser.ts — TypeScript ソースからインポート/エクスポート/本体を解析する
 */

/** モジュールシステムの種類 */
export type ModuleSystem = "commonjs" | "esm" | "amd" | "umd" | "system";

/** インポート指定子 */
export interface ImportSpecifier {
  kind: "named" | "default" | "namespace";
  imported: string;
  local: string;
}

/** インポート宣言 */
export interface ImportDecl {
  specifiers: ImportSpecifier[];
  source: string;
  typeOnly: boolean;
}

/** エクスポート宣言 */
export interface ExportDecl {
  kind: "named" | "default" | "reexport" | "reexport-all" | "declaration";
  /** named: { exported, local }[] */
  names?: { exported: string; local: string }[];
  /** 再エクスポート元 */
  source?: string;
  /** 宣言のキーワード (const, let, var, function, class) */
  declKind?: string;
  /** 宣言名 */
  declName?: string;
  /** 宣言の初期値/本体 */
  declBody?: string;
  /** default エクスポートの式 */
  defaultExpr?: string;
  /** 型のみか */
  typeOnly: boolean;
}

/** 解析結果 */
export interface ParsedModule {
  imports: ImportDecl[];
  exports: ExportDecl[];
  /** インポート/エクスポート以外のコード行 */
  bodyLines: string[];
}

/** 文字列リテラルの引用符を除去する */
function unquote(s: string): string {
  return s.replace(/^['"]|['"]$/g, "");
}

/** 型アノテーションを簡易的に除去する */
export function stripTypes(line: string): string {
  // interface / type 宣言は丸ごと除去
  if (/^\s*(export\s+)?(interface|type)\s+/.test(line)) return "";

  let result = line;
  // ジェネリクスの型パラメータ <T>, <T extends X> を除去
  result = result.replace(/<[^>()]*>/g, "");
  // 変数の型アノテーション: const x: string = → const x =（引数より先に処理）
  result = result.replace(/(const|let|var)\s+(\w+)\s*:\s*[\w[\]|&<>{}()\s,?.*]+\s*=/g, "$1 $2 =");
  // 関数引数の型アノテーション: (a: string, b: number) → (a, b)
  result = result.replace(/(\w)\s*:\s*[\w[\]|&<>{}()\s,?.*]+(?=[,)=])/g, "$1");
  // 戻り値の型: ): string { → ) {
  result = result.replace(/\)\s*:\s*[\w[\]|&<>{}()\s,?.*]+\s*\{/g, ") {");
  result = result.replace(/\)\s*:\s*[\w[\]|&<>{}()\s,?.*]+\s*=>/g, ") =>");
  // as キャスト除去
  result = result.replace(/\s+as\s+\w+/g, "");
  return result;
}

/** TypeScript ソースを解析する */
export function parse(source: string): ParsedModule {
  const imports: ImportDecl[] = [];
  const exports: ExportDecl[] = [];
  const bodyLines: string[] = [];

  // 複数行を結合するため前処理
  const lines = source.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    const trimmed = line.trim();

    // 空行やコメントはそのまま本体に
    if (trimmed === "" || trimmed.startsWith("//") || trimmed.startsWith("/*")) {
      bodyLines.push(line);
      i++;
      continue;
    }

    // import 文の解析
    const importResult = tryParseImport(trimmed);
    if (importResult !== undefined) {
      imports.push(importResult);
      i++;
      continue;
    }

    // export 文の解析
    const exportResult = tryParseExport(trimmed);
    if (exportResult !== undefined) {
      exports.push(exportResult);
      i++;
      continue;
    }

    // interface / type 宣言（複数行対応）
    if (/^\s*(export\s+)?(interface|type)\s+/.test(trimmed)) {
      // 閉じ括弧まで読み飛ばす
      if (trimmed.includes("{") && !trimmed.includes("}")) {
        i++;
        while (i < lines.length && !lines[i]!.includes("}")) i++;
      }
      i++;
      continue;
    }

    // それ以外は本体コード
    const stripped = stripTypes(line);
    if (stripped !== "") bodyLines.push(stripped);
    i++;
  }

  return { imports, exports, bodyLines };
}

/** import 文を解析する（1行） */
function tryParseImport(line: string): ImportDecl | undefined {
  // import type { ... } from '...'（型のみ → 全モジュールで除去）
  const typeImport = line.match(
    /^import\s+type\s+\{([^}]*)\}\s+from\s+(['"][^'"]+['"])\s*;?\s*$/,
  );
  if (typeImport !== null) {
    return { specifiers: [], source: unquote(typeImport[2]!), typeOnly: true };
  }

  // import { a, b as c } from 'mod'
  const namedImport = line.match(/^import\s+\{([^}]*)\}\s+from\s+(['"][^'"]+['"])\s*;?\s*$/);
  if (namedImport !== null) {
    const specs = parseNamedSpecifiers(namedImport[1]!);
    return { specifiers: specs, source: unquote(namedImport[2]!), typeOnly: false };
  }

  // import * as ns from 'mod'
  const nsImport = line.match(/^import\s+\*\s+as\s+(\w+)\s+from\s+(['"][^'"]+['"])\s*;?\s*$/);
  if (nsImport !== null) {
    return {
      specifiers: [{ kind: "namespace", imported: "*", local: nsImport[1]! }],
      source: unquote(nsImport[2]!),
      typeOnly: false,
    };
  }

  // import def from 'mod'
  const defImport = line.match(/^import\s+(\w+)\s+from\s+(['"][^'"]+['"])\s*;?\s*$/);
  if (defImport !== null) {
    return {
      specifiers: [{ kind: "default", imported: "default", local: defImport[1]! }],
      source: unquote(defImport[2]!),
      typeOnly: false,
    };
  }

  // import def, { a, b } from 'mod'
  const mixedImport = line.match(
    /^import\s+(\w+)\s*,\s*\{([^}]*)\}\s+from\s+(['"][^'"]+['"])\s*;?\s*$/,
  );
  if (mixedImport !== null) {
    const specs: ImportSpecifier[] = [
      { kind: "default", imported: "default", local: mixedImport[1]! },
      ...parseNamedSpecifiers(mixedImport[2]!),
    ];
    return { specifiers: specs, source: unquote(mixedImport[3]!), typeOnly: false };
  }

  // import 'mod' (副作用インポート)
  const sideEffect = line.match(/^import\s+(['"][^'"]+['"])\s*;?\s*$/);
  if (sideEffect !== null) {
    return { specifiers: [], source: unquote(sideEffect[1]!), typeOnly: false };
  }

  return undefined;
}

/** 名前付き指定子リストをパースする */
function parseNamedSpecifiers(raw: string): ImportSpecifier[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "")
    .filter((s) => !s.startsWith("type "))
    .map((s) => {
      const asMatch = s.match(/^(\w+)\s+as\s+(\w+)$/);
      if (asMatch !== null) {
        return { kind: "named" as const, imported: asMatch[1]!, local: asMatch[2]! };
      }
      return { kind: "named" as const, imported: s, local: s };
    });
}

/** export 文を解析する（1行） */
function tryParseExport(line: string): ExportDecl | undefined {
  // export type { ... }（型のみ）
  if (/^export\s+type\s+\{/.test(line)) {
    return { kind: "named", typeOnly: true };
  }

  // export type / export interface（型宣言）
  if (/^export\s+(type|interface)\s+/.test(line)) {
    return { kind: "declaration", typeOnly: true };
  }

  // export * from 'mod'
  const reexportAll = line.match(/^export\s+\*\s+from\s+(['"][^'"]+['"])\s*;?\s*$/);
  if (reexportAll !== null) {
    return { kind: "reexport-all", source: unquote(reexportAll[1]!), typeOnly: false };
  }

  // export * as ns from 'mod'
  const reexportNs = line.match(
    /^export\s+\*\s+as\s+(\w+)\s+from\s+(['"][^'"]+['"])\s*;?\s*$/,
  );
  if (reexportNs !== null) {
    return {
      kind: "reexport",
      names: [{ exported: reexportNs[1]!, local: "*" }],
      source: unquote(reexportNs[2]!),
      typeOnly: false,
    };
  }

  // export { a, b } from 'mod' (再エクスポート)
  const reexport = line.match(/^export\s+\{([^}]*)\}\s+from\s+(['"][^'"]+['"])\s*;?\s*$/);
  if (reexport !== null) {
    const names = parseExportNames(reexport[1]!);
    return { kind: "reexport", names, source: unquote(reexport[2]!), typeOnly: false };
  }

  // export { a, b }
  const namedExport = line.match(/^export\s+\{([^}]*)\}\s*;?\s*$/);
  if (namedExport !== null) {
    const names = parseExportNames(namedExport[1]!);
    return { kind: "named", names, typeOnly: false };
  }

  // export default function name(...) { ... }
  const defFunc = line.match(/^export\s+default\s+function\s+(\w+)\s*\(([^)]*)\)\s*\{?(.*)/);
  if (defFunc !== null) {
    const body = defFunc[3]?.trim() === "}" ? " {}" : ` {${defFunc[3] ?? ""}}`;
    return {
      kind: "default",
      defaultExpr: `function ${defFunc[1]!}(${stripTypesInParams(defFunc[2]!)})${body}`,
      declName: defFunc[1],
      typeOnly: false,
    };
  }

  // export default class name { ... }
  const defClass = line.match(/^export\s+default\s+class\s+(\w+)\s*\{?(.*)/);
  if (defClass !== null) {
    return {
      kind: "default",
      defaultExpr: `class ${defClass[1]!} {${defClass[2] ?? ""}}`,
      declName: defClass[1],
      typeOnly: false,
    };
  }

  // export default expression
  const defExpr = line.match(/^export\s+default\s+(.+?)\s*;?\s*$/);
  if (defExpr !== null) {
    return { kind: "default", defaultExpr: defExpr[1]!, typeOnly: false };
  }

  // export const/let/var name = ...
  const varExport = line.match(
    /^export\s+(const|let|var)\s+(\w+)\s*(?::\s*[\w[\]|&<>{}()\s,?.*]+)?\s*=\s*(.+?)\s*;?\s*$/,
  );
  if (varExport !== null) {
    return {
      kind: "declaration",
      declKind: varExport[1]!,
      declName: varExport[2]!,
      declBody: varExport[3]!,
      typeOnly: false,
    };
  }

  // export function name(...)
  const funcExport = line.match(/^export\s+function\s+(\w+)\s*\(([^)]*)\)\s*\{?(.*)/);
  if (funcExport !== null) {
    const body = funcExport[3]?.trim() === "}" ? " {}" : ` {${funcExport[3] ?? ""}}`;
    return {
      kind: "declaration",
      declKind: "function",
      declName: funcExport[1]!,
      declBody: `(${stripTypesInParams(funcExport[2]!)})${body}`,
      typeOnly: false,
    };
  }

  // export class Name
  const classExport = line.match(/^export\s+class\s+(\w+)\s*\{?(.*)/);
  if (classExport !== null) {
    return {
      kind: "declaration",
      declKind: "class",
      declName: classExport[1]!,
      declBody: ` {${classExport[2] ?? ""}}`,
      typeOnly: false,
    };
  }

  return undefined;
}

/** エクスポート名リストをパースする */
function parseExportNames(raw: string): { exported: string; local: string }[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "")
    .map((s) => {
      const asMatch = s.match(/^(\w+)\s+as\s+(\w+)$/);
      if (asMatch !== null) return { local: asMatch[1]!, exported: asMatch[2]! };
      return { local: s, exported: s };
    });
}

/** 引数リストから型アノテーションを除去する */
function stripTypesInParams(params: string): string {
  return params
    .split(",")
    .map((p) => p.trim().replace(/\s*:\s*[\w[\]|&<>{}()\s,?.*]+$/, ""))
    .join(", ");
}
