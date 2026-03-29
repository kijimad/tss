/**
 * transformer.ts -- ファイル変換パイプライン
 *
 * Vite のプラグインシステムに相当。ファイル種類ごとに変換する:
 *
 *   .ts  → TypeScript の型注釈を除去して JavaScript に
 *   .jsx/.tsx → JSX を createElement 呼び出しに変換
 *   .css → JavaScript でスタイルを注入するコードに変換
 *   .json → export default { ... } に変換
 *   .js  → そのまま (import パスの書き換えのみ)
 *
 * 加えて、全ファイルの import パスを解決する:
 *   import { useState } from 'react'
 *   → import { useState } from '/@modules/react'
 *
 *   import App from './App.tsx'
 *   → import App from '/src/App.tsx?t=123456'  (タイムスタンプ付き)
 */

// 変換結果
export interface TransformResult {
  code: string;
  originalCode: string;
  transforms: TransformStep[];
  contentType: string;
}

export interface TransformStep {
  name: string;       // "strip-types", "resolve-imports", "css-inject" 等
  description: string;
  before: string;
  after: string;
}

// ファイル拡張子 → 変換処理
export function transform(path: string, content: string, timestamp: number): TransformResult {
  const ext = extname(path);
  const steps: TransformStep[] = [];
  let code = content;
  const originalCode = content;

  switch (ext) {
    case ".ts":
    case ".tsx": {
      // 1. TypeScript 型除去
      const beforeStrip = code;
      code = stripTypeAnnotations(code);
      steps.push({ name: "strip-types", description: "TypeScript の型注釈を除去", before: beforeStrip, after: code });

      // 2. TSX の場合は JSX 変換
      if (ext === ".tsx") {
        const beforeJsx = code;
        code = transformJsx(code);
        steps.push({ name: "jsx-transform", description: "JSX を createElement に変換", before: beforeJsx, after: code });
      }

      // 3. import パス解決
      const beforeImport = code;
      code = resolveImports(code, path, timestamp);
      steps.push({ name: "resolve-imports", description: "import パスを解決", before: beforeImport, after: code });

      // 4. HMR クライアントコード注入
      const beforeHmr = code;
      code = injectHmr(code, path);
      steps.push({ name: "hmr-inject", description: "HMR クライアントコードを注入", before: beforeHmr, after: code });

      return { code, originalCode, transforms: steps, contentType: "application/javascript" };
    }

    case ".js":
    case ".jsx": {
      if (ext === ".jsx") {
        const beforeJsx = code;
        code = transformJsx(code);
        steps.push({ name: "jsx-transform", description: "JSX を createElement に変換", before: beforeJsx, after: code });
      }
      const beforeImport = code;
      code = resolveImports(code, path, timestamp);
      steps.push({ name: "resolve-imports", description: "import パスを解決", before: beforeImport, after: code });
      code = injectHmr(code, path);
      return { code, originalCode, transforms: steps, contentType: "application/javascript" };
    }

    case ".css": {
      // CSS → JS: スタイルタグを動的に注入するコードに変換
      const escaped = code.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$/g, "\\$");
      code = `// [vite] CSS transformed to JS\nconst css = \`${escaped}\`;\nconst style = document.createElement('style');\nstyle.textContent = css;\ndocument.head.appendChild(style);\nexport default css;`;
      steps.push({ name: "css-to-js", description: "CSS を JavaScript に変換 (style タグ注入)", before: originalCode, after: code });
      return { code, originalCode, transforms: steps, contentType: "application/javascript" };
    }

    case ".json": {
      code = `export default ${content};`;
      steps.push({ name: "json-to-esm", description: "JSON を ES module に変換", before: originalCode, after: code });
      return { code, originalCode, transforms: steps, contentType: "application/javascript" };
    }

    case ".svg": {
      code = `export default \`${content.replace(/`/g, "\\`")}\`;`;
      steps.push({ name: "svg-to-esm", description: "SVG を文字列として export", before: originalCode, after: code });
      return { code, originalCode, transforms: steps, contentType: "application/javascript" };
    }

    default:
      return { code, originalCode, transforms: [], contentType: guessMimeType(ext) };
  }
}

// TypeScript の型注釈を簡易的に除去
function stripTypeAnnotations(code: string): string {
  let result = code;
  // : Type を除去 (変数宣言、引数)
  result = result.replace(/:\s*(string|number|boolean|void|any|unknown|never|null|undefined)(\[\])?/g, "");
  // : 複雑な型 (型名の後にジェネリクスや . が続く場合)
  result = result.replace(/:\s*[A-Z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)*(<[^>]*>)?(\[\])?/g, "");
  // interface ... { } 宣言を除去
  result = result.replace(/^interface\s+\w+\s*\{[^}]*\}/gm, "");
  // type ... = ... 宣言を除去
  result = result.replace(/^type\s+\w+\s*=\s*[^;]+;?/gm, "");
  // as Type を除去
  result = result.replace(/\s+as\s+\w+(\[\])?/g, "");
  // import type を除去
  result = result.replace(/^import\s+type\s+.*$/gm, "");
  // 空行の整理
  result = result.replace(/\n{3,}/g, "\n\n");
  return result;
}

// JSX を createElement 呼び出しに変換 (簡易)
function transformJsx(code: string): string {
  let result = code;
  // 自己閉じタグ: <Component prop="val" /> → createElement(Component, {prop: "val"})
  result = result.replace(/<(\w+)([^>]*?)\/>/g, (_match, tag, attrs) => {
    const props = parseJsxAttrs(attrs);
    return `createElement(${String(tag)}, ${props})`;
  });
  // 開始 + 閉じタグ: <div>text</div> → createElement("div", null, "text")
  result = result.replace(/<(\w+)([^>]*)>([\s\S]*?)<\/\1>/g, (_match, tag, attrs, children) => {
    const props = parseJsxAttrs(attrs);
    const isNative = (tag as string)[0] === (tag as string)[0]?.toLowerCase();
    const tagStr = isNative ? `"${String(tag)}"` : String(tag);
    const childStr = (children as string).trim();
    if (childStr.length === 0) return `createElement(${tagStr}, ${props})`;
    return `createElement(${tagStr}, ${props}, ${JSON.stringify(childStr)})`;
  });
  return result;
}

function parseJsxAttrs(attrs: string): string {
  const trimmed = (attrs ?? "").trim();
  if (trimmed.length === 0) return "null";
  // 簡易: key="value" → {key: "value"}
  const pairs: string[] = [];
  const regex = /(\w+)=["']([^"']*)["']/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(trimmed)) !== null) {
    pairs.push(`${m[1]}: "${m[2]}"`);
  }
  // key={expr}
  const exprRegex = /(\w+)=\{([^}]+)\}/g;
  while ((m = exprRegex.exec(trimmed)) !== null) {
    pairs.push(`${m[1]}: ${m[2]}`);
  }
  return pairs.length > 0 ? `{${pairs.join(", ")}}` : "null";
}

// import パスを解決
function resolveImports(code: string, filePath: string, timestamp: number): string {
  return code.replace(
    /from\s+['"]([^'"]+)['"]/g,
    (_match, specifier) => {
      const spec = specifier as string;
      if (spec.startsWith("./") || spec.startsWith("../") || spec.startsWith("/")) {
        // 相対パス → 絶対パスに変換 + タイムスタンプ
        const resolved = resolvePath(filePath, spec);
        return `from "${resolved}?t=${String(timestamp)}"`;
      }
      // bare import (node_modules) → /@modules/ プレフィックス
      return `from "/@modules/${spec}"`;
    },
  );
}

// HMR クライアントコード注入
function injectHmr(code: string, path: string): string {
  return `// [vite] HMR enabled for ${path}\n` +
    `if (import.meta.hot) {\n  import.meta.hot.accept();\n}\n\n` +
    code;
}

function resolvePath(from: string, specifier: string): string {
  if (specifier.startsWith("/")) return specifier;
  const fromDir = from.split("/").slice(0, -1).join("/");
  const parts = (fromDir + "/" + specifier).split("/").filter(p => p.length > 0);
  const resolved: string[] = [];
  for (const p of parts) {
    if (p === "..") resolved.pop();
    else if (p !== ".") resolved.push(p);
  }
  return "/" + resolved.join("/");
}

function extname(path: string): string {
  const base = path.split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot) : "";
}

function guessMimeType(ext: string): string {
  const map: Record<string, string> = {
    ".html": "text/html", ".css": "text/css", ".js": "application/javascript",
    ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml",
  };
  return map[ext] ?? "text/plain";
}
