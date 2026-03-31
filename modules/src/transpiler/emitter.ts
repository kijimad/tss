/**
 * emitter.ts — ParsedModule を各モジュールシステム形式の JS に変換する
 */

import type { ParsedModule, ImportDecl, ExportDecl, ModuleSystem } from "./parser.js";

/** トランスパイル結果 */
export interface EmitResult {
  code: string;
  /** 各モジュールシステムの特徴の説明 */
  description: string;
}

/** モジュールソース名から変数名を生成する */
function toVarName(source: string): string {
  const base = source.replace(/^[.\/]+/, "").replace(/[^a-zA-Z0-9]/g, "_");
  return `${base}_1`;
}

/** 型のみのインポート/エクスポートを除外する */
function filterNonType<T extends { typeOnly: boolean }>(items: T[]): T[] {
  return items.filter((item) => !item.typeOnly);
}

/** インポートで使われるモジュールソースの一覧（重複なし） */
function collectSources(imports: ImportDecl[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const imp of filterNonType(imports)) {
    if (!seen.has(imp.source)) {
      seen.add(imp.source);
      result.push(imp.source);
    }
  }
  return result;
}

/** エクスポート宣言からコード行を生成する（CommonJS 系共通） */
function emitExportDecl(exp: ExportDecl): string[] {
  const lines: string[] = [];
  switch (exp.kind) {
    case "declaration":
      if (exp.declKind === "function") {
        lines.push(`function ${exp.declName}${exp.declBody}`);
        lines.push(`exports.${exp.declName} = ${exp.declName};`);
      } else if (exp.declKind === "class") {
        lines.push(`class ${exp.declName}${exp.declBody}`);
        lines.push(`exports.${exp.declName} = ${exp.declName};`);
      } else {
        lines.push(`const ${exp.declName} = ${exp.declBody};`);
        lines.push(`exports.${exp.declName} = ${exp.declName};`);
      }
      break;
    case "default":
      if (exp.declName !== undefined) {
        lines.push(`${exp.defaultExpr}`);
        lines.push(`exports["default"] = ${exp.declName};`);
      } else {
        lines.push(`exports["default"] = ${exp.defaultExpr};`);
      }
      break;
    case "named":
      if (exp.names !== undefined) {
        for (const n of exp.names) {
          lines.push(`exports.${n.exported} = ${n.local};`);
        }
      }
      break;
    case "reexport": {
      const src = exp.source!;
      const varName = toVarName(src);
      lines.push(`const ${varName} = require("${src}");`);
      if (exp.names !== undefined) {
        for (const n of exp.names) {
          if (n.local === "*") {
            lines.push(`exports.${n.exported} = ${varName};`);
          } else {
            lines.push(`exports.${n.exported} = ${varName}.${n.local};`);
          }
        }
      }
      break;
    }
    case "reexport-all": {
      const src = exp.source!;
      const varName = toVarName(src);
      lines.push(`const ${varName} = require("${src}");`);
      lines.push(
        `Object.keys(${varName}).forEach(function(k) { if (k !== "default") exports[k] = ${varName}[k]; });`,
      );
      break;
    }
  }
  return lines;
}

// ── CommonJS ──

function emitCommonJS(parsed: ParsedModule): string {
  const lines: string[] = [];
  lines.push('"use strict";');
  lines.push('Object.defineProperty(exports, "__esModule", { value: true });');
  lines.push("");

  // インポート
  for (const imp of filterNonType(parsed.imports)) {
    const varName = toVarName(imp.source);
    if (imp.specifiers.length === 0) {
      lines.push(`require("${imp.source}");`);
    } else {
      lines.push(`const ${varName} = require("${imp.source}");`);
    }
  }

  if (filterNonType(parsed.imports).length > 0) lines.push("");

  // 本体コード
  for (const line of parsed.bodyLines) {
    lines.push(line);
  }
  if (parsed.bodyLines.length > 0 && filterNonType(parsed.exports).length > 0) lines.push("");

  // エクスポート
  for (const exp of filterNonType(parsed.exports)) {
    lines.push(...emitExportDecl(exp));
  }

  return lines.join("\n");
}

// ── ESM ──

function emitESM(parsed: ParsedModule): string {
  const lines: string[] = [];

  // インポート（型のみ以外はそのまま出力）
  for (const imp of filterNonType(parsed.imports)) {
    if (imp.specifiers.length === 0) {
      lines.push(`import '${imp.source}';`);
    } else {
      const parts: string[] = [];
      const defSpec = imp.specifiers.find((s) => s.kind === "default");
      const nsSpec = imp.specifiers.find((s) => s.kind === "namespace");
      const named = imp.specifiers.filter((s) => s.kind === "named");
      if (defSpec !== undefined) parts.push(defSpec.local);
      if (nsSpec !== undefined) parts.push(`* as ${nsSpec.local}`);
      if (named.length > 0) {
        const namedParts = named.map((s) =>
          s.imported === s.local ? s.local : `${s.imported} as ${s.local}`,
        );
        parts.push(`{ ${namedParts.join(", ")} }`);
      }
      lines.push(`import ${parts.join(", ")} from '${imp.source}';`);
    }
  }

  if (filterNonType(parsed.imports).length > 0) lines.push("");

  // 本体
  for (const line of parsed.bodyLines) {
    lines.push(line);
  }
  if (parsed.bodyLines.length > 0 && filterNonType(parsed.exports).length > 0) lines.push("");

  // エクスポート（ES モジュール構文そのまま）
  for (const exp of filterNonType(parsed.exports)) {
    switch (exp.kind) {
      case "declaration":
        if (exp.declKind === "function") {
          lines.push(`export function ${exp.declName}${exp.declBody}`);
        } else if (exp.declKind === "class") {
          lines.push(`export class ${exp.declName}${exp.declBody}`);
        } else {
          lines.push(`export const ${exp.declName} = ${exp.declBody};`);
        }
        break;
      case "default":
        lines.push(`export default ${exp.defaultExpr};`);
        break;
      case "named":
        if (exp.names !== undefined) {
          const parts = exp.names.map((n) =>
            n.local === n.exported ? n.local : `${n.local} as ${n.exported}`,
          );
          lines.push(`export { ${parts.join(", ")} };`);
        }
        break;
      case "reexport":
        if (exp.names !== undefined) {
          const parts = exp.names.map((n) =>
            n.local === "*" ? `* as ${n.exported}` : n.local === n.exported ? n.local : `${n.local} as ${n.exported}`,
          );
          lines.push(`export { ${parts.join(", ")} } from '${exp.source}';`);
        }
        break;
      case "reexport-all":
        lines.push(`export * from '${exp.source}';`);
        break;
    }
  }

  return lines.join("\n");
}

// ── AMD ──

function emitAMD(parsed: ParsedModule): string {
  const sources = collectSources(parsed.imports);
  const depList = ['"require"', '"exports"', ...sources.map((s) => `"${s}"`)];

  // 再エクスポート元もdependencyに追加
  for (const exp of filterNonType(parsed.exports)) {
    if ((exp.kind === "reexport" || exp.kind === "reexport-all") && exp.source !== undefined) {
      const q = `"${exp.source}"`;
      if (!depList.includes(q)) depList.push(q);
    }
  }

  const paramList = ["require", "exports"];
  for (const imp of filterNonType(parsed.imports)) {
    paramList.push(toVarName(imp.source));
  }
  for (const exp of filterNonType(parsed.exports)) {
    if ((exp.kind === "reexport" || exp.kind === "reexport-all") && exp.source !== undefined) {
      const v = toVarName(exp.source);
      if (!paramList.includes(v)) paramList.push(v);
    }
  }

  const inner: string[] = [];
  inner.push('    "use strict";');
  inner.push('    Object.defineProperty(exports, "__esModule", { value: true });');

  // 本体
  for (const line of parsed.bodyLines) {
    if (line.trim() !== "") inner.push(`    ${line}`);
    else inner.push("");
  }

  // エクスポート
  for (const exp of filterNonType(parsed.exports)) {
    for (const l of emitExportDecl(exp)) {
      inner.push(`    ${l}`);
    }
  }

  const lines: string[] = [];
  lines.push(`define([${depList.join(", ")}], function(${paramList.join(", ")}) {`);
  lines.push(...inner);
  lines.push("});");
  return lines.join("\n");
}

// ── UMD ──

function emitUMD(parsed: ParsedModule): string {
  const sources = collectSources(parsed.imports);
  for (const exp of filterNonType(parsed.exports)) {
    if ((exp.kind === "reexport" || exp.kind === "reexport-all") && exp.source !== undefined) {
      if (!sources.includes(exp.source)) sources.push(exp.source);
    }
  }
  const depList = ['"require"', '"exports"', ...sources.map((s) => `"${s}"`)];

  const paramList = ["require", "exports"];
  for (const imp of filterNonType(parsed.imports)) {
    paramList.push(toVarName(imp.source));
  }
  for (const exp of filterNonType(parsed.exports)) {
    if ((exp.kind === "reexport" || exp.kind === "reexport-all") && exp.source !== undefined) {
      const v = toVarName(exp.source);
      if (!paramList.includes(v)) paramList.push(v);
    }
  }

  const inner: string[] = [];
  inner.push('    "use strict";');
  inner.push('    Object.defineProperty(exports, "__esModule", { value: true });');

  for (const line of parsed.bodyLines) {
    if (line.trim() !== "") inner.push(`    ${line}`);
    else inner.push("");
  }

  for (const exp of filterNonType(parsed.exports)) {
    for (const l of emitExportDecl(exp)) {
      inner.push(`    ${l}`);
    }
  }

  const cjsReqs = sources.map((s) => `require("${s}")`).join(", ");

  const lines: string[] = [];
  lines.push("(function(root, factory) {");
  lines.push('    if (typeof module === "object" && module.exports) {');
  if (sources.length > 0) {
    lines.push(`        module.exports = factory(require, exports, ${cjsReqs});`);
  } else {
    lines.push("        module.exports = factory(require, exports);");
  }
  lines.push('    } else if (typeof define === "function" && define.amd) {');
  lines.push(`        define([${depList.join(", ")}], factory);`);
  lines.push("    }");
  lines.push(`})(this, function(${paramList.join(", ")}) {`);
  lines.push(...inner);
  lines.push("});");
  return lines.join("\n");
}

// ── SystemJS ──

function emitSystem(parsed: ParsedModule): string {
  const sources = collectSources(parsed.imports);
  for (const exp of filterNonType(parsed.exports)) {
    if ((exp.kind === "reexport" || exp.kind === "reexport-all") && exp.source !== undefined) {
      if (!sources.includes(exp.source)) sources.push(exp.source);
    }
  }

  const depList = sources.map((s) => `"${s}"`).join(", ");

  // setter 関数
  const setters: string[] = [];
  for (const src of sources) {
    const varName = toVarName(src);
    setters.push(`        function(${varName}_setter) { ${varName} = ${varName}_setter; }`);
  }

  // var 宣言（インポート変数）
  const vars: string[] = [];
  for (const src of sources) {
    vars.push(toVarName(src));
  }
  // エクスポート宣言の変数
  for (const exp of filterNonType(parsed.exports)) {
    if (exp.kind === "declaration" && exp.declName !== undefined && exp.declKind !== "function" && exp.declKind !== "class") {
      vars.push(exp.declName);
    }
  }

  const execLines: string[] = [];
  // 本体
  for (const line of parsed.bodyLines) {
    if (line.trim() !== "") execLines.push(`            ${line}`);
    else execLines.push("");
  }
  // エクスポート
  for (const exp of filterNonType(parsed.exports)) {
    switch (exp.kind) {
      case "declaration":
        if (exp.declKind === "function") {
          execLines.push(`            function ${exp.declName}${exp.declBody}`);
          execLines.push(`            exports_1("${exp.declName}", ${exp.declName});`);
        } else if (exp.declKind === "class") {
          execLines.push(`            class ${exp.declName}${exp.declBody}`);
          execLines.push(`            exports_1("${exp.declName}", ${exp.declName});`);
        } else {
          execLines.push(
            `            exports_1("${exp.declName}", ${exp.declName} = ${exp.declBody});`,
          );
        }
        break;
      case "default":
        execLines.push(`            exports_1("default", ${exp.defaultExpr});`);
        break;
      case "named":
        if (exp.names !== undefined) {
          for (const n of exp.names) {
            execLines.push(`            exports_1("${n.exported}", ${n.local});`);
          }
        }
        break;
      case "reexport":
        if (exp.names !== undefined) {
          const varName = toVarName(exp.source!);
          for (const n of exp.names) {
            if (n.local === "*") {
              execLines.push(`            exports_1("${n.exported}", ${varName});`);
            } else {
              execLines.push(`            exports_1("${n.exported}", ${varName}.${n.local});`);
            }
          }
        }
        break;
      case "reexport-all": {
        const varName = toVarName(exp.source!);
        execLines.push(
          `            Object.keys(${varName}).forEach(function(k) { if (k !== "default") exports_1(k, ${varName}[k]); });`,
        );
        break;
      }
    }
  }

  const lines: string[] = [];
  lines.push(`System.register([${depList}], function(exports_1, context_1) {`);
  lines.push('    "use strict";');
  if (vars.length > 0) lines.push(`    var ${vars.join(", ")};`);
  lines.push("    return {");
  lines.push("        setters: [");
  lines.push(setters.join(",\n"));
  lines.push("        ],");
  lines.push("        execute: function() {");
  lines.push(...execLines);
  lines.push("        }");
  lines.push("    };");
  lines.push("});");
  return lines.join("\n");
}

// ── モジュールシステムの説明 ──

const DESCRIPTIONS: Record<ModuleSystem, string> = {
  commonjs:
    "CommonJS (Node.js 標準) — require() / module.exports で同期的にモジュールを読み込む。Node.js のデフォルトモジュールシステム。",
  esm: "ES Modules (ESM) — import / export 構文。静的解析が可能で Tree Shaking に対応。ブラウザ・Node.js 両方で使用可能。",
  amd: "AMD (Asynchronous Module Definition) — define() でモジュールを定義し、依存関係を非同期に読み込む。RequireJS で使用。",
  umd: "UMD (Universal Module Definition) — CommonJS と AMD の両方に対応するラッパー。ライブラリの配布に使用される。",
  system:
    "SystemJS — System.register() でモジュールを登録。ライブバインディングをサポートし、ES Modules のポリフィルとして動作。",
};

/** ParsedModule を指定のモジュールシステムに変換する */
export function emit(parsed: ParsedModule, target: ModuleSystem): EmitResult {
  let code: string;
  switch (target) {
    case "commonjs":
      code = emitCommonJS(parsed);
      break;
    case "esm":
      code = emitESM(parsed);
      break;
    case "amd":
      code = emitAMD(parsed);
      break;
    case "umd":
      code = emitUMD(parsed);
      break;
    case "system":
      code = emitSystem(parsed);
      break;
  }
  return { code, description: DESCRIPTIONS[target] };
}
