/* SQLインジェクション シミュレーター エンジン */

import type {
  Database, Row, ColumnDef,
  ParsedSql, QueryResult,
  Defense, SimStep, SimEvent, SimOp,
  AttackResult, SimulationResult, EventType,
} from "./types.js";

// ─── デフォルトデータベース ───

/** テスト用データベースを構築 */
export function createDefaultDb(): Database {
  return {
    tables: {
      users: {
        def: {
          name: "users",
          columns: [
            { name: "id", type: "integer", primaryKey: true },
            { name: "username", type: "text" },
            { name: "password", type: "text" },
            { name: "email", type: "text" },
            { name: "role", type: "text" },
            { name: "is_admin", type: "boolean" },
          ],
        },
        rows: [
          { id: 1, username: "admin", password: "s3cur3P@ss!", email: "admin@example.com", role: "admin", is_admin: true },
          { id: 2, username: "alice", password: "alice2024", email: "alice@example.com", role: "user", is_admin: false },
          { id: 3, username: "bob", password: "b0bPass#1", email: "bob@example.com", role: "user", is_admin: false },
          { id: 4, username: "charlie", password: "Ch@rlie99", email: "charlie@example.com", role: "moderator", is_admin: false },
        ],
      },
      products: {
        def: {
          name: "products",
          columns: [
            { name: "id", type: "integer", primaryKey: true },
            { name: "name", type: "text" },
            { name: "price", type: "integer" },
            { name: "category", type: "text" },
            { name: "stock", type: "integer" },
          ],
        },
        rows: [
          { id: 1, name: "ノートPC", price: 89800, category: "electronics", stock: 15 },
          { id: 2, name: "マウス", price: 3200, category: "electronics", stock: 50 },
          { id: 3, name: "キーボード", price: 12500, category: "electronics", stock: 30 },
          { id: 4, name: "モニター", price: 45000, category: "electronics", stock: 8 },
          { id: 5, name: "USBケーブル", price: 800, category: "accessories", stock: 100 },
        ],
      },
      secrets: {
        def: {
          name: "secrets",
          columns: [
            { name: "id", type: "integer", primaryKey: true },
            { name: "key_name", type: "text" },
            { name: "key_value", type: "text" },
          ],
        },
        rows: [
          { id: 1, key_name: "api_key", key_value: "sk-XXXX-SECRET-API-KEY-1234" },
          { id: 2, key_name: "db_password", key_value: "super_secret_db_pass!" },
          { id: 3, key_name: "jwt_secret", key_value: "my-jwt-signing-secret-256" },
        ],
      },
    },
  };
}

// ─── SQL パーサー（簡易） ───

/** SQL文を簡易パースする */
export function parseSql(raw: string): ParsedSql {
  const trimmed = raw.trim();

  // SQLコメントの除去（-- 以降を削除、文字列リテラル外のみ）
  const uncommented = stripComments(trimmed);

  // スタックドクエリの分割
  const statements = splitStatements(uncommented);
  const mainSql = statements[0];
  const stacked = statements.slice(1).filter(s => s.length > 0);

  const upper = mainSql.toUpperCase().trim();

  // DROP検出
  if (upper.startsWith("DROP")) {
    const tableMatch = mainSql.match(/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(\w+)/i);
    return { type: "DROP", raw: trimmed, table: tableMatch?.[1], stacked };
  }

  // DELETE検出
  if (upper.startsWith("DELETE")) {
    const tableMatch = mainSql.match(/DELETE\s+FROM\s+(\w+)/i);
    const whereMatch = mainSql.match(/WHERE\s+(.+)$/i);
    return { type: "DELETE", raw: trimmed, table: tableMatch?.[1], where: whereMatch?.[1], stacked };
  }

  // UPDATE検出
  if (upper.startsWith("UPDATE")) {
    const tableMatch = mainSql.match(/UPDATE\s+(\w+)/i);
    const whereMatch = mainSql.match(/WHERE\s+(.+)$/i);
    return { type: "UPDATE", raw: trimmed, table: tableMatch?.[1], where: whereMatch?.[1], stacked };
  }

  // INSERT検出
  if (upper.startsWith("INSERT")) {
    const tableMatch = mainSql.match(/INSERT\s+INTO\s+(\w+)/i);
    return { type: "INSERT", raw: trimmed, table: tableMatch?.[1], stacked };
  }

  // SELECT検出
  if (upper.startsWith("SELECT")) {
    return parseSelect(mainSql, trimmed, stacked);
  }

  return { type: "UNKNOWN", raw: trimmed, stacked };
}

/** SELECT文をパース */
function parseSelect(mainSql: string, raw: string, stacked: string[]): ParsedSql {
  const hasUnion = /\bUNION\b/i.test(mainSql);

  // UNION前のメインSELECTを解析
  const selectPart = hasUnion ? mainSql.split(/\bUNION\b/i)[0].trim() : mainSql;

  const colMatch = selectPart.match(/SELECT\s+(.+?)\s+FROM/i);
  const tableMatch = selectPart.match(/FROM\s+(\w+)/i);
  const whereMatch = selectPart.match(/WHERE\s+(.+?)(?:\s+ORDER|\s+LIMIT|\s+GROUP|\s*$)/i);

  const columns = colMatch
    ? colMatch[1].split(",").map(c => c.trim())
    : ["*"];

  return {
    type: hasUnion ? "UNION" : "SELECT",
    raw, table: tableMatch?.[1],
    columns, where: whereMatch?.[1],
    hasUnion, stacked,
  };
}

/** SQLコメントを除去（-- 以降、文字列リテラル外のみ） */
function stripComments(sql: string): string {
  let result = "";
  let inString = false;
  let quote = "";
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (inString) {
      result += ch;
      if (ch === quote && sql[i - 1] !== "\\") inString = false;
    } else if (ch === "'" || ch === '"') {
      inString = true;
      quote = ch;
      result += ch;
    } else if (ch === "-" && sql[i + 1] === "-") {
      // コメント開始 → 行末まで読み飛ばす
      const newline = sql.indexOf("\n", i);
      if (newline === -1) break;
      i = newline - 1;
    } else {
      result += ch;
    }
  }
  return result.trim();
}

/** セミコロンで文を分割（文字列リテラル内は無視） */
function splitStatements(sql: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inString = false;
  let quote = "";

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (inString) {
      current += ch;
      if (ch === quote && sql[i - 1] !== "\\") inString = false;
    } else if (ch === "'" || ch === '"') {
      inString = true;
      quote = ch;
      current += ch;
    } else if (ch === ";") {
      parts.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

// ─── SQL 実行エンジン（簡易） ───

/** SQLを実行する */
export function executeSql(db: Database, sql: string): QueryResult {
  const parsed = parseSql(sql);

  // メインクエリ実行
  let result = executeStatement(db, parsed);

  // スタックドクエリ実行
  if (parsed.stacked && parsed.stacked.length > 0) {
    for (const stacked of parsed.stacked) {
      const stackedParsed = parseSql(stacked);
      const stackedResult = executeStatement(db, stackedParsed);
      if (!stackedResult.success) {
        result = {
          ...result,
          error: (result.error ? result.error + "; " : "") + (stackedResult.error ?? ""),
        };
      } else {
        result.affectedRows += stackedResult.affectedRows;
      }
    }
  }

  return { ...result, executedSql: sql };
}

/** 単一SQL文を実行 */
function executeStatement(db: Database, parsed: ParsedSql): QueryResult {
  try {
    switch (parsed.type) {
      case "SELECT":
      case "UNION":
        return executeSelect(db, parsed);
      case "INSERT":
        return { success: true, rows: [], affectedRows: 1, executedSql: parsed.raw };
      case "UPDATE":
        return executeUpdate(db, parsed);
      case "DELETE":
        return executeDelete(db, parsed);
      case "DROP":
        return executeDrop(db, parsed);
      default:
        return { success: false, rows: [], affectedRows: 0, error: `不明なSQL: ${parsed.raw}`, executedSql: parsed.raw };
    }
  } catch (e) {
    return {
      success: false, rows: [], affectedRows: 0,
      error: e instanceof Error ? e.message : String(e),
      executedSql: parsed.raw,
    };
  }
}

/** SELECT文実行 */
function executeSelect(db: Database, parsed: ParsedSql): QueryResult {
  const table = parsed.table ? db.tables[parsed.table] : undefined;
  if (!table && parsed.table) {
    return { success: false, rows: [], affectedRows: 0, error: `テーブル '${parsed.table}' が存在しません`, executedSql: parsed.raw };
  }

  let rows = table ? [...table.rows] : [];

  // WHERE条件の評価
  if (parsed.where && table) {
    rows = evaluateWhere(rows, parsed.where, table.def.columns);
  }

  // カラム選択
  if (parsed.columns && !parsed.columns.includes("*") && table) {
    rows = rows.map(r => {
      const filtered: Row = {};
      for (const col of parsed.columns!) {
        const colName = col.replace(/^\w+\./, "").trim();
        if (colName in r) filtered[colName] = r[colName];
      }
      return Object.keys(filtered).length > 0 ? filtered : r;
    });
  }

  // UNION処理
  if (parsed.hasUnion) {
    const unionRows = executeUnion(db, parsed.raw);
    rows = [...rows, ...unionRows];
  }

  return { success: true, rows, affectedRows: 0, executedSql: parsed.raw };
}

/** UNION SELECT部分の実行 */
function executeUnion(db: Database, sql: string): Row[] {
  const unionParts = sql.split(/\bUNION\s+(?:ALL\s+)?SELECT\b/i);
  if (unionParts.length <= 1) return [];

  const results: Row[] = [];
  for (let i = 1; i < unionParts.length; i++) {
    const part = unionParts[i].trim();
    // FROM句があるかチェック
    const fromMatch = part.match(/FROM\s+(\w+)/i);
    if (fromMatch) {
      const tableName = fromMatch[1];
      const table = db.tables[tableName];
      if (table) {
        results.push(...table.rows);
      }
    } else {
      // SELECT 1,2,3 のようなリテラル値
      const values = part.split(/\s*,\s*/).map(v => v.replace(/--.*$/, "").trim());
      const row: Row = {};
      values.forEach((v, idx) => {
        row[`col${idx + 1}`] = cleanValue(v);
      });
      if (Object.keys(row).length > 0) results.push(row);
    }
  }
  return results;
}

/** 値のクリーニング */
function cleanValue(v: string): string | number {
  const stripped = v.replace(/['"`]/g, "").trim();
  const num = Number(stripped);
  if (!isNaN(num) && stripped.length > 0) return num;
  return stripped;
}

/** WHERE条件の評価（簡易） */
function evaluateWhere(rows: Row[], where: string, _columns: ColumnDef[]): Row[] {
  // OR条件の分割
  const orParts = splitByOperator(where, "OR");

  return rows.filter(row => {
    return orParts.some(orPart => {
      // AND条件の分割
      const andParts = splitByOperator(orPart, "AND");
      return andParts.every(condition => evaluateCondition(row, condition.trim()));
    });
  });
}

/** 論理演算子で分割（括弧を考慮） */
function splitByOperator(expr: string, op: string): string[] {
  const regex = new RegExp(`\\b${op}\\b`, "gi");
  const parts: string[] = [];
  let lastIdx = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(expr)) !== null) {
    parts.push(expr.slice(lastIdx, match.index).trim());
    lastIdx = match.index + match[0].length;
  }
  parts.push(expr.slice(lastIdx).trim());
  return parts.filter(p => p.length > 0);
}

/** 単一条件の評価 */
function evaluateCondition(row: Row, condition: string): boolean {
  // 常にtrue: 1=1, '1'='1', ''='' 等
  if (/^['"]?(\w*)['"]?\s*=\s*['"]?\1['"]?$/.test(condition.trim())) return true;
  // 常にtrue: 1>0 等
  if (/^\d+\s*>\s*0$/.test(condition.trim())) return true;

  // LIKE条件
  const likeMatch = condition.match(/^(\w+)\s+LIKE\s+['"](.+)['"]$/i);
  if (likeMatch) {
    const [, col, pattern] = likeMatch;
    const val = String(row[col] ?? "");
    const regex = new RegExp("^" + pattern.replace(/%/g, ".*").replace(/_/g, ".") + "$", "i");
    return regex.test(val);
  }

  // 等号比較
  const eqMatch = condition.match(/^(\w+)\s*=\s*['"]?(.+?)['"]?\s*$/);
  if (eqMatch) {
    const [, col, val] = eqMatch;
    const rowVal = row[col];
    if (rowVal === undefined) return false;
    if (typeof rowVal === "number") return rowVal === Number(val);
    if (typeof rowVal === "boolean") return rowVal === (val === "true" || val === "1");
    return String(rowVal) === val;
  }

  // 不等号
  const neqMatch = condition.match(/^(\w+)\s*!=\s*['"]?(.+?)['"]?\s*$/);
  if (neqMatch) {
    const [, col, val] = neqMatch;
    return String(row[col] ?? "") !== val;
  }

  // 数値比較 (>, <, >=, <=)
  const cmpMatch = condition.match(/^(\w+)\s*(>=|<=|>|<)\s*(\d+)\s*$/);
  if (cmpMatch) {
    const [, col, op, numStr] = cmpMatch;
    const rowVal = Number(row[col] ?? 0);
    const num = Number(numStr);
    switch (op) {
      case ">": return rowVal > num;
      case "<": return rowVal < num;
      case ">=": return rowVal >= num;
      case "<=": return rowVal <= num;
    }
  }

  // パース不能だが何かしらの入力 → trueとして扱う（注入攻撃で常にtrue条件を挿入するケース）
  return false;
}

/** UPDATE文実行 */
function executeUpdate(db: Database, parsed: ParsedSql): QueryResult {
  const table = parsed.table ? db.tables[parsed.table] : undefined;
  if (!table) {
    return { success: false, rows: [], affectedRows: 0, error: `テーブル '${parsed.table}' が存在しません`, executedSql: parsed.raw };
  }
  // 実際の更新はシミュレーション上は行わず、影響行数のみ返す
  const setMatch = parsed.raw.match(/SET\s+(.+?)(?:\s+WHERE|$)/i);
  const affected = parsed.where
    ? evaluateWhere(table.rows, parsed.where, table.def.columns).length
    : table.rows.length;
  return {
    success: true, rows: [], affectedRows: affected, executedSql: parsed.raw,
    error: setMatch ? undefined : "SET句なし",
  };
}

/** DELETE文実行 */
function executeDelete(db: Database, parsed: ParsedSql): QueryResult {
  const table = parsed.table ? db.tables[parsed.table] : undefined;
  if (!table) {
    return { success: false, rows: [], affectedRows: 0, error: `テーブル '${parsed.table}' が存在しません`, executedSql: parsed.raw };
  }
  const affected = parsed.where
    ? evaluateWhere(table.rows, parsed.where, table.def.columns).length
    : table.rows.length;
  return { success: true, rows: [], affectedRows: affected, executedSql: parsed.raw };
}

/** DROP文実行 */
function executeDrop(db: Database, parsed: ParsedSql): QueryResult {
  if (parsed.table && db.tables[parsed.table]) {
    return { success: true, rows: [], affectedRows: 0, executedSql: parsed.raw };
  }
  return { success: false, rows: [], affectedRows: 0, error: `テーブル '${parsed.table}' が存在しません`, executedSql: parsed.raw };
}

// ─── 防御機構 ───

/** エスケープ処理 */
export function escapeSqlInput(input: string): string {
  return input.replace(/'/g, "''").replace(/\\/g, "\\\\").replace(/"/g, '""');
}

/** WAF パターンチェック */
export function wafCheck(input: string): { blocked: boolean; reason?: string } {
  const patterns: [RegExp, string][] = [
    [/\bUNION\b.*\bSELECT\b/i, "UNION SELECT パターン検出"],
    [/\bOR\b\s+\d+\s*=\s*\d+/i, "OR 数値比較パターン検出 (OR 1=1)"],
    [/'\s*OR\s+'/i, "文字列OR条件パターン検出"],
    [/--\s*$/m, "SQLコメント検出 (--)"],
    [/\/\*.*\*\//s, "SQLブロックコメント検出"],
    [/;\s*(DROP|DELETE|UPDATE|INSERT)/i, "スタックドクエリ検出"],
    [/\bDROP\b\s+\bTABLE\b/i, "DROP TABLE 検出"],
    [/\bSLEEP\s*\(/i, "SLEEP関数検出"],
    [/\bBENCHMARK\s*\(/i, "BENCHMARK関数検出"],
    [/\bWAITFOR\b/i, "WAITFOR検出"],
    [/\bEXEC\b|\bEXECUTE\b/i, "EXEC/EXECUTE 検出"],
  ];

  for (const [pat, reason] of patterns) {
    if (pat.test(input)) {
      return { blocked: true, reason };
    }
  }
  return { blocked: false };
}

/** 入力バリデーション（型チェック） */
export function validateInput(input: string, expectedType: "integer" | "text"): { valid: boolean; reason?: string } {
  if (expectedType === "integer") {
    if (!/^\d+$/.test(input.trim())) {
      return { valid: false, reason: `整数値が期待されますが '${input}' が入力されました` };
    }
  }
  // テキストの場合は特殊文字チェック
  if (expectedType === "text") {
    if (/[;'"\\]/.test(input)) {
      return { valid: false, reason: `特殊文字が含まれています: ${input}` };
    }
  }
  return { valid: true };
}

/** ホワイトリストチェック */
export function whitelistCheck(input: string, allowed: RegExp): { valid: boolean; reason?: string } {
  if (!allowed.test(input)) {
    return { valid: false, reason: `入力 '${input}' はホワイトリストに一致しません` };
  }
  return { valid: true };
}

// ─── 攻撃シミュレーション ───

/** 攻撃をシミュレート */
export function simulateAttack(op: SimOp): AttackResult {
  const steps: SimStep[] = [];
  const blocked: string[] = [];
  const mitigations: string[] = [];
  const db = createDefaultDb();

  let injectionSucceeded = false;
  let dataLeaked = false;
  let dataModified = false;
  let authBypassed = false;

  // ステップ1: ユーザー入力受付
  steps.push({
    phase: "入力受付", actor: "Webアプリ",
    message: `${inputMethodLabel(op.inputMethod)}経由で入力を受信`,
    detail: `入力値: ${op.payload}`,
    success: true,
  });

  let processedInput = op.payload;

  // ステップ2: 防御チェック

  // WAF
  if (op.defense.waf) {
    const wafResult = wafCheck(processedInput);
    if (wafResult.blocked) {
      blocked.push(`WAF: ${wafResult.reason}`);
      steps.push({
        phase: "WAF", actor: "WAF",
        message: `攻撃パターンを検出しブロック: ${wafResult.reason}`,
        success: false,
      });
      return buildResult(op, "", steps, blocked, mitigations, db, false, false, false, false);
    }
    steps.push({
      phase: "WAF", actor: "WAF",
      message: "WAFチェック通過",
      success: true,
    });
  }

  // 入力バリデーション
  if (op.defense.inputValidation) {
    const expectedType = op.queryTemplate.includes("= ${input}") ? "integer" as const : "text" as const;
    const valResult = validateInput(processedInput, expectedType);
    if (!valResult.valid) {
      blocked.push(`入力バリデーション: ${valResult.reason}`);
      steps.push({
        phase: "バリデーション", actor: "Webアプリ",
        message: `入力値を拒否: ${valResult.reason}`,
        success: false,
      });
      return buildResult(op, "", steps, blocked, mitigations, db, false, false, false, false);
    }
    steps.push({
      phase: "バリデーション", actor: "Webアプリ",
      message: "入力バリデーション通過",
      success: true,
    });
  }

  // ホワイトリスト
  if (op.defense.whitelist) {
    const wlResult = whitelistCheck(processedInput, /^[\w@.\-\s]+$/);
    if (!wlResult.valid) {
      blocked.push(`ホワイトリスト: ${wlResult.reason}`);
      steps.push({
        phase: "ホワイトリスト", actor: "Webアプリ",
        message: `ホワイトリストにより拒否: ${wlResult.reason}`,
        success: false,
      });
      return buildResult(op, "", steps, blocked, mitigations, db, false, false, false, false);
    }
  }

  // エスケープ
  if (op.defense.escaping) {
    const escaped = escapeSqlInput(processedInput);
    steps.push({
      phase: "エスケープ", actor: "Webアプリ",
      message: `入力値をエスケープ: '${processedInput}' → '${escaped}'`,
      success: true,
    });
    processedInput = escaped;
  }

  // ステップ3: SQL構築
  let constructedSql: string;
  let parameterizedSql: string | undefined;

  if (op.defense.parameterized) {
    // パラメータ化クエリ
    parameterizedSql = op.queryTemplate.replace("${input}", "?");
    // パラメータ化クエリではペイロードはリテラル値として扱われる
    const safeInput = processedInput.replace(/'/g, "''");
    constructedSql = op.queryTemplate.replace("${input}", safeInput);

    // パラメータ化されている場合、攻撃ペイロードはただの文字列値になる
    steps.push({
      phase: "SQL構築", actor: "Webアプリ",
      message: "パラメータ化クエリを使用",
      detail: `プリペアド: ${parameterizedSql}\nパラメータ: [${JSON.stringify(op.payload)}]`,
      success: true,
    });

    // パラメータ化されたクエリの実行（ペイロードを安全なリテラルとして埋め込み）
    const safeSql = buildParameterizedQuery(op.queryTemplate, op.payload);
    const result = executeSql(db, safeSql);

    steps.push({
      phase: "クエリ実行", actor: "データベース",
      message: result.success ? `実行成功（${result.rows.length}行）` : `エラー: ${result.error}`,
      detail: safeSql,
      success: result.success,
    });

    // パラメータ化クエリではインジェクションは常に失敗
    generateMitigations(op, false, false, false, blocked, mitigations);
    return {
      injectionType: op.injectionType, inputMethod: op.inputMethod,
      queryTemplate: op.queryTemplate, userInput: op.payload,
      constructedSql: safeSql, parameterizedSql,
      queryResult: result,
      injectionSucceeded: false, dataLeaked: false, dataModified: false, authBypassed: false,
      blocked: ["パラメータ化クエリにより攻撃ペイロードは文字列リテラルとして処理"],
      steps, mitigations,
    };
  } else {
    // 文字列連結によるSQL構築（脆弱）
    constructedSql = op.queryTemplate.replace("${input}", processedInput);
    steps.push({
      phase: "SQL構築", actor: "Webアプリ",
      message: "文字列連結でSQLを構築（脆弱）",
      detail: constructedSql,
      success: true,
    });
  }

  // ステップ4: 最小権限チェック
  const parsed = parseSql(constructedSql);
  if (op.defense.leastPrivilege) {
    if (parsed.type === "DROP" || parsed.type === "DELETE" ||
      (parsed.stacked && parsed.stacked.some(s => /^\s*(DROP|DELETE)/i.test(s)))) {
      blocked.push("最小権限: 破壊的操作は許可されていません");
      steps.push({
        phase: "権限チェック", actor: "データベース",
        message: "破壊的操作を拒否（最小権限の原則）",
        success: false,
      });
      return buildResult(op, constructedSql, steps, blocked, mitigations, db, false, false, false, false, parameterizedSql);
    }
  }

  // ステップ5: SQL実行
  const result = executeSql(db, constructedSql);

  // エラーメッセージの制御
  if (!result.success && op.defense.hideErrors) {
    result.error = "クエリの実行に失敗しました";
    steps.push({
      phase: "エラー処理", actor: "Webアプリ",
      message: "詳細なエラーメッセージを非表示",
      success: true,
    });
  }

  steps.push({
    phase: "クエリ実行", actor: "データベース",
    message: result.success ? `実行成功（${result.rows.length}行, 影響${result.affectedRows}行）` : `エラー: ${result.error}`,
    detail: constructedSql,
    success: result.success,
  });

  // ステップ6: 攻撃結果の分析
  injectionSucceeded = analyzeInjection(op, constructedSql, result, steps);
  dataLeaked = analyzeDataLeak(op, result, steps);
  dataModified = analyzeDataModification(op, parsed, result, steps);
  authBypassed = analyzeAuthBypass(op, result, steps);

  generateMitigations(op, injectionSucceeded, dataLeaked, dataModified, blocked, mitigations);

  return {
    injectionType: op.injectionType, inputMethod: op.inputMethod,
    queryTemplate: op.queryTemplate, userInput: op.payload,
    constructedSql, parameterizedSql,
    queryResult: result,
    injectionSucceeded, dataLeaked, dataModified, authBypassed,
    blocked, steps, mitigations,
  };
}

/** パラメータ化クエリを構築（ペイロードを安全なリテラルとして扱う） */
function buildParameterizedQuery(template: string, value: string): string {
  // ペイロード全体を1つの文字列リテラルとして埋め込む
  const safe = value.replace(/'/g, "''");
  return template.replace("${input}", safe);
}

/** インジェクション成功の分析 */
function analyzeInjection(op: SimOp, sql: string, result: QueryResult, steps: SimStep[]): boolean {
  const template = op.queryTemplate;
  const legitimate = op.legitimateInput ?? "";

  // 正常クエリと比較して構造が変わっているか
  const normalSql = template.replace("${input}", legitimate);
  const structuralChange = parseSql(sql).type !== parseSql(normalSql).type || parseSql(sql).hasUnion;

  // WHERE条件の操作
  const hasOrInjection = /\bOR\b\s+\d+\s*=\s*\d+|\bOR\b\s+'[^']*'\s*=\s*'[^']*'/i.test(sql);

  if (structuralChange || hasOrInjection || (result.success && result.rows.length > 0 && op.injectionType !== "blind_time")) {
    steps.push({
      phase: "攻撃分析", actor: "シミュレーター",
      message: "SQLインジェクション成功",
      detail: structuralChange ? "SQL構造が変更された" : hasOrInjection ? "WHERE条件が操作された" : "意図しないデータが返された",
      success: true,
    });
    return true;
  }

  // ブラインドSQLi（時間ベース）
  if (op.injectionType === "blind_time") {
    if (/SLEEP|WAITFOR|BENCHMARK/i.test(sql)) {
      steps.push({
        phase: "攻撃分析", actor: "シミュレーター",
        message: "時間ベースブラインドSQLi: 遅延関数が注入された",
        success: true,
      });
      return true;
    }
  }

  return false;
}

/** データ漏洩の分析 */
function analyzeDataLeak(op: SimOp, result: QueryResult, steps: SimStep[]): boolean {
  if (!result.success || result.rows.length === 0) return false;

  // パスワードやシークレットが含まれているか
  const sensitiveFields = ["password", "key_value", "email", "api_key", "jwt_secret", "db_password"];
  const hasLeakedData = result.rows.some(row =>
    Object.keys(row).some(k => sensitiveFields.includes(k))
  );

  // UNION攻撃で別テーブルのデータが含まれているか
  if (op.injectionType === "union_based" && result.rows.length > 0) {
    steps.push({
      phase: "データ漏洩", actor: "シミュレーター",
      message: `UNION SELECTにより${result.rows.length}行のデータが漏洩`,
      success: true,
    });
    return true;
  }

  if (hasLeakedData) {
    steps.push({
      phase: "データ漏洩", actor: "シミュレーター",
      message: "機密データ（パスワード/API鍵等）が漏洩",
      success: true,
    });
    return true;
  }

  // 認証バイパスで全ユーザー情報を取得
  if (op.injectionType === "classic" && result.rows.length > 1) {
    steps.push({
      phase: "データ漏洩", actor: "シミュレーター",
      message: `条件操作により${result.rows.length}行のデータが漏洩`,
      success: true,
    });
    return true;
  }

  return false;
}

/** データ改ざんの分析 */
function analyzeDataModification(_op: SimOp, parsed: ParsedSql, result: QueryResult, steps: SimStep[]): boolean {
  const destructive = parsed.type === "DROP" || parsed.type === "DELETE" || parsed.type === "UPDATE";
  const stackedDestructive = parsed.stacked?.some(s => /^\s*(DROP|DELETE|UPDATE)/i.test(s));

  if ((destructive || stackedDestructive) && result.success) {
    steps.push({
      phase: "データ破壊", actor: "シミュレーター",
      message: destructive
        ? `${parsed.type}文が実行されデータが改ざん/破壊された`
        : "スタックドクエリでデータが改ざん/破壊された",
      success: true,
    });
    return true;
  }
  return false;
}

/** 認証バイパスの分析 */
function analyzeAuthBypass(op: SimOp, result: QueryResult, steps: SimStep[]): boolean {
  if (op.queryTemplate.toLowerCase().includes("password") && result.success && result.rows.length > 0) {
    // ログインクエリで結果が返された = 認証バイパス
    if (/OR\s+['"]?\w*['"]?\s*=\s*['"]?\w*['"]?/i.test(op.payload) || op.payload.includes("--")) {
      steps.push({
        phase: "認証バイパス", actor: "シミュレーター",
        message: "SQL条件操作により認証がバイパスされた",
        success: true,
      });
      return true;
    }
  }
  return false;
}

/** 結果を構築 */
function buildResult(
  op: SimOp, constructedSql: string, steps: SimStep[],
  blocked: string[], mitigations: string[], _db: Database,
  injectionSucceeded: boolean, dataLeaked: boolean, dataModified: boolean, authBypassed: boolean,
  parameterizedSql?: string,
): AttackResult {
  generateMitigations(op, injectionSucceeded, dataLeaked, dataModified, blocked, mitigations);

  // ブロックされた場合は空の結果を返す
  const queryResult: QueryResult = {
    success: false, rows: [], affectedRows: 0,
    executedSql: constructedSql, error: "防御によりブロック",
  };

  return {
    injectionType: op.injectionType, inputMethod: op.inputMethod,
    queryTemplate: op.queryTemplate, userInput: op.payload,
    constructedSql, parameterizedSql, queryResult,
    injectionSucceeded, dataLeaked, dataModified, authBypassed,
    blocked, steps, mitigations,
  };
}

/** 防御勧告を生成 */
function generateMitigations(
  op: SimOp, injectionSucceeded: boolean, dataLeaked: boolean, dataModified: boolean,
  blocked: string[], mitigations: string[],
): void {
  if (blocked.length > 0 && !injectionSucceeded && !dataLeaked && !dataModified) {
    mitigations.push("✓ 防御が適切に機能しています");
    return;
  }

  if (!op.defense.parameterized) {
    mitigations.push("パラメータ化クエリ（プリペアドステートメント）を使用してください ← 最重要");
  }
  if (!op.defense.inputValidation) {
    mitigations.push("入力値の型バリデーションを実施してください");
  }
  if (!op.defense.waf) {
    mitigations.push("WAF（Webアプリケーションファイアウォール）の導入を検討してください");
  }
  if (!op.defense.escaping) {
    mitigations.push("入力値のエスケープ処理を行ってください（補助的対策）");
  }
  if (!op.defense.hideErrors) {
    mitigations.push("エラーメッセージを隠蔽してください（エラーベース攻撃対策）");
  }
  if (!op.defense.leastPrivilege) {
    mitigations.push("最小権限の原則を適用してください（DROP/DELETE権限の除去）");
  }
  if (!op.defense.whitelist) {
    mitigations.push("ホワイトリスト方式の入力制限を検討してください");
  }
}

/** 入力方法のラベル */
export function inputMethodLabel(m: string): string {
  const labels: Record<string, string> = {
    url_param: "URLパラメータ",
    form_post: "POSTフォーム",
    cookie: "Cookie",
    http_header: "HTTPヘッダ",
  };
  return labels[m] ?? m;
}

/** インジェクション種別のラベル */
export function injectionTypeLabel(t: string): string {
  const labels: Record<string, string> = {
    classic: "クラシック",
    union_based: "UNION型",
    blind_boolean: "ブラインド（真偽値）",
    blind_time: "ブラインド（時間）",
    error_based: "エラーベース",
    stacked: "スタックドクエリ",
    second_order: "セカンドオーダー",
  };
  return labels[t] ?? t;
}

// ─── 防御プリセット ───

/** 防御なし */
export function noDefense(): Defense {
  return {
    parameterized: false, escaping: false, inputValidation: false,
    waf: false, whitelist: false, hideErrors: false, leastPrivilege: false,
  };
}

/** パラメータ化クエリのみ */
export function parameterizedOnly(): Defense {
  return { ...noDefense(), parameterized: true };
}

/** エスケープのみ */
export function escapingOnly(): Defense {
  return { ...noDefense(), escaping: true };
}

/** WAF のみ */
export function wafOnly(): Defense {
  return { ...noDefense(), waf: true };
}

/** フル防御 */
export function fullDefense(): Defense {
  return {
    parameterized: true, escaping: true, inputValidation: true,
    waf: true, whitelist: true, hideErrors: true, leastPrivilege: true,
  };
}

// ─── シミュレーション ───

/** 複数攻撃を実行 */
export function simulate(ops: SimOp[]): SimulationResult {
  const results: AttackResult[] = [];
  const events: SimEvent[] = [];

  for (const op of ops) {
    const result = simulateAttack(op);
    results.push(result);
    events.push(...result.steps.map(s => ({
      type: "info" as EventType,
      actor: s.actor,
      message: `[${s.phase}] ${s.message}`,
      detail: s.detail,
    })));
  }

  return { results, events };
}
