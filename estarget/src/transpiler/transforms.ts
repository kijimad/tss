/**
 * transforms.ts — ES ターゲットごとのダウンレベル変換
 *
 * 各関数は「そのバージョンで導入された構文」を
 * 古い形式に変換する。行単位の正規表現ベースで
 * 教育目的のサンプルコードに対して正確に動作する。
 */

// ────────────────────────────────────────
// 共通ユーティリティ
// ────────────────────────────────────────

/** 型アノテーションを除去する */
export function stripTypes(source: string): string {
  const lines = source.split("\n");
  const result: string[] = [];
  let skipBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // 複数行の interface/type ブロックをスキップ
    if (skipBlock) {
      if (trimmed === "}") skipBlock = false;
      continue;
    }
    if (/^(export\s+)?(interface|type)\s+\w+/.test(trimmed)) {
      if (trimmed.includes("{") && !trimmed.includes("}")) {
        skipBlock = true;
      }
      continue;
    }

    let r = line;
    // ジェネリクス型パラメータ
    r = r.replace(/<[^>()]*>/g, "");
    // 変数の型: const x: string =  → const x =
    r = r.replace(/((?:const|let|var)\s+\w+)\s*:\s*[\w[\]|&<>{}\s,?.*"']+\s*=/g, "$1 =");
    // 引数の型: (a: string, b: number) → (a, b)
    r = r.replace(/(\w+)\s*:\s*[\w[\]|&<>{}\s?.*"']+(?=[,)])/g, "$1");
    // 戻り値の型: ): string { → ) {
    r = r.replace(/\)\s*:\s*[\w[\]|&<>{}\s,?.*"']+\s*\{/g, ") {");
    r = r.replace(/\)\s*:\s*[\w[\]|&<>{}\s,?.*"']+\s*=>/g, ") =>");
    r = r.replace(/\)\s*:\s*[\w[\]|&<>{}\s,?.*"']+\s*$/g, ")");
    // as キャスト
    r = r.replace(/\s+as\s+\w+/g, "");
    result.push(r);
  }
  return result.join("\n");
}

// ────────────────────────────────────────
// ES2015 (ES6) 機能のダウンレベル
// target < es2015 の場合に適用
// ────────────────────────────────────────

/** let / const → var */
export function downlevelLetConst(source: string): string {
  return source.replace(/\b(let|const)\s+/g, "var ");
}

/** アロー関数 → function 式 */
export function downlevelArrowFunctions(source: string): string {
  let result = source;
  // (args) => expr  (1行)
  result = result.replace(
    /\(([^)]*)\)\s*=>\s*(?!\{)(.+)/g,
    "function($1) { return $2; }",
  );
  // (args) => {
  result = result.replace(/\(([^)]*)\)\s*=>\s*\{/g, "function($1) {");
  // single arg: x => expr
  result = result.replace(
    /(?<![.\w])(\w+)\s*=>\s*(?!\{)(.+)/g,
    "function($1) { return $2; }",
  );
  // single arg: x => {
  result = result.replace(/(?<![.\w])(\w+)\s*=>\s*\{/g, "function($1) {");
  return result;
}

/** テンプレートリテラル → 文字列結合 */
export function downlevelTemplateLiterals(source: string): string {
  return source.replace(/`([^`]*)`/g, (_match, content: string) => {
    // ${expr} を分割して結合に変換
    const parts: string[] = [];
    let last = 0;
    const exprRegex = /\$\{([^}]+)\}/g;
    let m: RegExpExecArray | null;
    while ((m = exprRegex.exec(content)) !== null) {
      const before = content.slice(last, m.index);
      if (before) parts.push(`"${before}"`);
      parts.push(`(${m[1]})`);
      last = m.index + m[0].length;
    }
    const after = content.slice(last);
    if (after) parts.push(`"${after}"`);
    if (parts.length === 0) return '""';
    return parts.join(" + ");
  });
}

/** デフォルト引数 → 関数内チェック */
export function downlevelDefaultParams(source: string): string {
  return source.replace(
    /function\s*(\w*)\s*\(([^)]*)\)\s*\{/g,
    (_match, name: string, params: string) => {
      const paramList: string[] = [];
      const defaults: string[] = [];
      for (const p of params.split(",")) {
        const trimmed = p.trim();
        if (!trimmed) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx !== -1) {
          const paramName = trimmed.slice(0, eqIdx).trim();
          const defaultVal = trimmed.slice(eqIdx + 1).trim();
          paramList.push(paramName);
          defaults.push(
            `    if (${paramName} === void 0) { ${paramName} = ${defaultVal}; }`,
          );
        } else {
          paramList.push(trimmed);
        }
      }
      const header = `function ${name}(${paramList.join(", ")}) {`;
      if (defaults.length === 0) return header;
      return header + "\n" + defaults.join("\n");
    },
  );
}

/** class → function + prototype */
export function downlevelClasses(source: string): string {
  const lines = source.split("\n");
  const result: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    const classMatch = line.match(/^(\s*)(?:var\s+)?(\w+)\s*=\s*\/\*\*\s*@class\s*\*\/|^(\s*)class\s+(\w+)(?:\s+extends\s+(\w+))?\s*\{/);

    if (classMatch === null) {
      result.push(line);
      i++;
      continue;
    }

    const indent = classMatch[3] ?? classMatch[1] ?? "";
    const className = classMatch[4] ?? classMatch[2] ?? "Anonymous";
    const superClass = classMatch[5];
    const methods: { name: string; params: string; bodyLines: string[] }[] = [];
    const constructorParams: string[] = [];
    const constructorBody: string[] = [];
    i++;
    // クラス本体を解析
    while (i < lines.length) {
      const mLine = lines[i]!;
      const trimmed = mLine.trim();
      if (trimmed === "}") { i++; break; }

      // constructor
      const ctorMatch = trimmed.match(/^constructor\s*\(([^)]*)\)\s*\{/);
      if (ctorMatch !== null) {
        if (ctorMatch[1]) constructorParams.push(ctorMatch[1]);
        i++;
        while (i < lines.length && lines[i]!.trim() !== "}") {
          constructorBody.push(lines[i]!.trim());
          i++;
        }
        i++; // skip }
        continue;
      }

      // メソッド
      const methodMatch = trimmed.match(/^(\w+)\s*\(([^)]*)\)\s*\{/);
      if (methodMatch !== null) {
        const bodyLines: string[] = [];
        i++;
        while (i < lines.length && lines[i]!.trim() !== "}") {
          bodyLines.push(lines[i]!.trim());
          i++;
        }
        i++; // skip }
        methods.push({ name: methodMatch[1]!, params: methodMatch[2] ?? "", bodyLines });
        continue;
      }

      i++;
    }

    // function 形式で出力
    const ctorParams = constructorParams.join(", ");
    result.push(`${indent}function ${className}(${ctorParams}) {`);
    if (superClass !== undefined) {
      result.push(`${indent}    ${superClass}.call(this${ctorParams ? ", " + ctorParams : ""});`);
    }
    for (const bl of constructorBody) {
      const transformed = bl.replace(/\bthis\./g, "this.");
      result.push(`${indent}    ${transformed}`);
    }
    result.push(`${indent}}`);

    if (superClass !== undefined) {
      result.push(`${indent}${className}.prototype = Object.create(${superClass}.prototype);`);
      result.push(`${indent}${className}.prototype.constructor = ${className};`);
    }

    for (const method of methods) {
      result.push(`${indent}${className}.prototype.${method.name} = function(${method.params}) {`);
      for (const bl of method.bodyLines) {
        result.push(`${indent}    ${bl}`);
      }
      result.push(`${indent}};`);
    }
  }

  return result.join("\n");
}

/** for...of → インデックスベースの for ループ */
export function downlevelForOf(source: string): string {
  return source.replace(
    /for\s*\(\s*(?:var|let|const)\s+(\w+)\s+of\s+(\w+)\s*\)\s*\{/g,
    (_m, item: string, arr: string) =>
      `for (var _i = 0; _i < ${arr}.length; _i++) {\n    var ${item} = ${arr}[_i];`,
  );
}

/** 省略プロパティ { x, y } → { x: x, y: y } */
export function downlevelShorthandProperties(source: string): string {
  return source.replace(
    /\{\s*((?:\w+\s*,\s*)*\w+)\s*\}/g,
    (_match, inner: string) => {
      // オブジェクトリテラルのみを対象（分割代入ではない）
      // = の右辺にある場合のみ
      const parts = inner.split(",").map((s) => s.trim());
      if (parts.every((p) => /^\w+$/.test(p))) {
        return "{ " + parts.map((p) => `${p}: ${p}`).join(", ") + " }";
      }
      return _match;
    },
  );
}

// ────────────────────────────────────────
// ES2016 機能のダウンレベル
// target < es2016 の場合に適用
// ────────────────────────────────────────

/** べき乗演算子 ** → Math.pow() */
export function downlevelExponentiation(source: string): string {
  // a ** b → Math.pow(a, b)
  return source.replace(/(\w+(?:\.\w+)*)\s*\*\*\s*(\w+(?:\.\w+)*)/g, "Math.pow($1, $2)");
}

// ────────────────────────────────────────
// ES2017 機能のダウンレベル
// target < es2017 の場合に適用
// ────────────────────────────────────────

/** async/await → Promise ベースに変換（簡易） */
export function downlevelAsyncAwait(source: string): string {
  let result = source;

  // async function name(...) { → function name(...) { return __awaiter(this, function*() {
  result = result.replace(
    /async\s+function\s+(\w+)\s*\(([^)]*)\)\s*\{/g,
    "function $1($2) {\n    return __awaiter(this, function*() {",
  );

  // async method(params) { → method(params) { return __awaiter(this, function*() {
  result = result.replace(
    /async\s+(\w+)\s*\(([^)]*)\)\s*\{/g,
    "$1($2) {\n    return __awaiter(this, function*() {",
  );

  // async (...) => { → function(...) { return __awaiter(this, function*() {
  result = result.replace(
    /async\s+\(([^)]*)\)\s*=>\s*\{/g,
    "function($1) {\n    return __awaiter(this, function*() {",
  );

  // await expr → yield expr
  result = result.replace(/\bawait\s+/g, "yield ");

  // async メソッド内の閉じ括弧を追加するため、最後に注釈を追加
  if (result !== source) {
    result =
      "// __awaiter ヘルパー (tslib から提供)\n" +
      "var __awaiter = function(thisArg, body) {\n" +
      "    return new Promise(function(resolve, reject) {\n" +
      '        var gen = body.call(thisArg);\n' +
      "        function step(result) {\n" +
      "            if (result.done) return resolve(result.value);\n" +
      "            Promise.resolve(result.value).then(\n" +
      '                function(v) { step(gen.next(v)); },\n' +
      '                function(e) { step(gen["throw"](e)); }\n' +
      "            );\n" +
      "        }\n" +
      "        step(gen.next());\n" +
      "    });\n" +
      "};\n\n" +
      result;
  }

  return result;
}

// ────────────────────────────────────────
// ES2018 機能のダウンレベル
// target < es2018 の場合に適用
// ────────────────────────────────────────

/** オブジェクトスプレッド { ...obj } → Object.assign({}, obj) */
export function downlevelObjectSpread(source: string): string {
  return source.replace(
    /\{\s*\.\.\.(\w+)(?:\s*,\s*([^}]+))?\s*\}/g,
    (_m, obj: string, rest?: string) => {
      if (rest !== undefined && rest.trim()) {
        return `Object.assign({}, ${obj}, { ${rest.trim()} })`;
      }
      return `Object.assign({}, ${obj})`;
    },
  );
}

// ────────────────────────────────────────
// ES2019 機能のダウンレベル
// target < es2019 の場合に適用
// ────────────────────────────────────────

/** optional catch binding: catch { → catch (_e) { */
export function downlevelOptionalCatch(source: string): string {
  return source.replace(/\bcatch\s*\{/g, "catch (_e) {");
}

// ────────────────────────────────────────
// ES2020 機能のダウンレベル
// target < es2020 の場合に適用
// ────────────────────────────────────────

/** optional chaining ?. → 手動チェック */
export function downlevelOptionalChaining(source: string): string {
  // a?.b → (a !== null && a !== void 0 ? a.b : void 0)
  let result = source;
  // メソッド呼び出し: a?.method() → (a !== null && ... ? a.method() : void 0)
  result = result.replace(
    /(\w+)\?\.\s*(\w+)\s*\(/g,
    "($1 !== null && $1 !== void 0 ? $1.$2( ",
  );
  // プロパティ: a?.b
  result = result.replace(
    /(\w+)\?\.\s*(\w+)/g,
    "($1 !== null && $1 !== void 0 ? $1.$2 : void 0)",
  );
  // 閉じ括弧の補正（メソッド呼び出し）
  result = result.replace(
    /\? (\w+)\.\s*(\w+)\(\s*([^)]*)\s*\)/g,
    "? $1.$2($3) : void 0)",
  );
  return result;
}

/** nullish coalescing ?? → 手動チェック */
export function downlevelNullishCoalescing(source: string): string {
  return source.replace(
    /(\w+(?:\.\w+|\([^)]*\))*)\s*\?\?\s*([^;,\n]+)/g,
    "($1 !== null && $1 !== void 0 ? $1 : $2)",
  );
}

// ────────────────────────────────────────
// ES2021 機能のダウンレベル
// target < es2021 の場合に適用
// ────────────────────────────────────────

/** 論理代入演算子 → 展開形 */
export function downlevelLogicalAssignment(source: string): string {
  let result = source;
  // a ??= b → a = a ?? b (→ さらに ?? もダウンレベルされる)
  result = result.replace(/(\w+)\s*\?\?=\s*(.+?)(?=[;,\n])/g, "$1 = $1 ?? $2");
  // a ||= b → a = a || b
  result = result.replace(/(\w+)\s*\|\|=\s*(.+?)(?=[;,\n])/g, "$1 = $1 || $2");
  // a &&= b → a = a && b
  result = result.replace(/(\w+)\s*&&=\s*(.+?)(?=[;,\n])/g, "$1 = $1 && $2");
  return result;
}

// ────────────────────────────────────────
// ES2022 機能のダウンレベル
// target < es2022 の場合に適用
// ────────────────────────────────────────

/** クラスフィールド → コンストラクタ内代入 */
export function downlevelClassFields(source: string): string {
  const lines = source.split("\n");
  const result: string[] = [];
  let inClass = false;
  let className = "";
  let braceDepth = 0;
  const fieldInits: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // クラス開始
    const classStart = trimmed.match(/^class\s+(\w+)/);
    if (classStart !== null && !inClass) {
      inClass = true;
      className = classStart[1]!;
      braceDepth = 0;
      fieldInits.length = 0;
      result.push(line);
      if (trimmed.includes("{")) braceDepth++;
      continue;
    }

    if (inClass) {
      for (const ch of trimmed) {
        if (ch === "{") braceDepth++;
        if (ch === "}") braceDepth--;
      }

      // クラスフィールド: name = value;
      const fieldMatch = trimmed.match(/^(\w+)\s*=\s*(.+?)\s*;?\s*$/);
      if (fieldMatch !== null && braceDepth === 1 && !trimmed.startsWith("constructor") && !trimmed.includes("(")) {
        fieldInits.push(`this.${fieldMatch[1]} = ${fieldMatch[2]};`);
        continue;
      }

      // #private フィールド
      const privateField = trimmed.match(/^#(\w+)\s*=\s*(.+?)\s*;?\s*$/);
      if (privateField !== null && braceDepth === 1) {
        fieldInits.push(`this._${privateField[1]} = ${privateField[2]};`);
        continue;
      }

      // constructor が見つかったらフィールド初期化を挿入
      if (trimmed.startsWith("constructor") && fieldInits.length > 0) {
        result.push(line);
        for (const fi of fieldInits) {
          result.push(`        ${fi}`);
        }
        fieldInits.length = 0;
        continue;
      }

      // クラス終了
      if (braceDepth === 0) {
        // constructor がなかった場合、閉じ括弧の前に constructor を追加
        if (fieldInits.length > 0) {
          result.push(`    constructor() {`);
          for (const fi of fieldInits) {
            result.push(`        ${fi}`);
          }
          result.push(`    }`);
          fieldInits.length = 0;
        }
        inClass = false;
        void className;
      }
    }

    // #method → _method, #field → _field
    let emitted = line;
    emitted = emitted.replace(/this\.#(\w+)/g, "this._$1");
    emitted = emitted.replace(/#(\w+)/g, "_$1");
    result.push(emitted);
  }

  return result.join("\n");
}
