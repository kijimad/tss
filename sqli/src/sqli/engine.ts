/**
 * @module engine
 * @description SQLインジェクション シミュレーターのコアエンジン。
 * SQL文の簡易パース、実行エミュレーション、防御機構（WAF・エスケープ・バリデーション等）、
 * および攻撃シミュレーションのロジックを提供する。
 * 実際のデータベースは使用せず、インメモリのデータ構造上でSQLの挙動を再現する。
 */

import type {
  Database, Row, ColumnDef,
  ParsedSql, QueryResult,
  Defense, SimStep, SimEvent, SimOp,
  AttackResult, SimulationResult, EventType,
} from "./types.js";

// ─── デフォルトデータベース ───

/**
 * テスト用のデフォルトデータベースを構築する。
 * users, products, secrets の3テーブルを含み、
 * SQLインジェクション攻撃のシミュレーションに使用する。
 * @returns {Database} サンプルデータが格納されたデータベースオブジェクト
 */
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

/**
 * SQL文を簡易的にパースし、構造化されたオブジェクトに変換する。
 * SELECT, INSERT, UPDATE, DELETE, DROP の各文タイプを識別し、
 * スタックドクエリ（セミコロン区切りの複数SQL）やUNION句も検出する。
 * @param {string} raw - パース対象の生SQL文字列
 * @returns {ParsedSql} パース結果（文タイプ、テーブル名、WHERE条件等）
 */
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

/**
 * SELECT文を詳細にパースする。
 * UNION句の有無、カラムリスト、FROM句、WHERE条件を抽出する。
 * @param {string} mainSql - メインのSELECT文
 * @param {string} raw - 元の生SQL文字列
 * @param {string[]} stacked - スタックドクエリのリスト
 * @returns {ParsedSql} SELECT文のパース結果
 */
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

/**
 * SQLコメントを除去する（ -- 以降を削除）。
 * 文字列リテラル内のハイフンは無視し、リテラル外のコメントのみ削除する。
 * @param {string} sql - コメント除去対象のSQL文字列
 * @returns {string} コメントが除去されたSQL文字列
 */
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

/**
 * セミコロンでSQL文を分割する（スタックドクエリの検出）。
 * 文字列リテラル内のセミコロンは無視し、トップレベルのセミコロンでのみ分割する。
 * @param {string} sql - 分割対象のSQL文字列
 * @returns {string[]} 分割されたSQL文の配列
 */
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

/**
 * SQL文をパースしてエミュレーション実行する。
 * メインクエリに加え、スタックドクエリがあればそれらも順次実行する。
 * @param {Database} db - 実行対象のデータベース
 * @param {string} sql - 実行するSQL文字列
 * @returns {QueryResult} クエリの実行結果（成功/失敗、結果行、影響行数等）
 */
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

/**
 * パース済みの単一SQL文を実行する。
 * SELECT/INSERT/UPDATE/DELETE/DROPの各文タイプに応じたハンドラに処理を委譲する。
 * @param {Database} db - 実行対象のデータベース
 * @param {ParsedSql} parsed - パース済みのSQL構造体
 * @returns {QueryResult} 実行結果
 */
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

/**
 * SELECT文を実行し、テーブルから行を取得する。
 * WHERE条件によるフィルタリング、カラム選択、UNION処理を行う。
 * @param {Database} db - 実行対象のデータベース
 * @param {ParsedSql} parsed - パース済みのSELECT文
 * @returns {QueryResult} 取得した行データを含む実行結果
 */
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

/**
 * UNION SELECT部分を実行し、結合結果の行を返す。
 * FROM句がある場合はテーブルから取得し、ない場合はリテラル値として解釈する。
 * @param {Database} db - 実行対象のデータベース
 * @param {string} sql - UNION句を含む元のSQL文字列
 * @returns {Row[]} UNION SELECTで取得した行の配列
 */
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

/**
 * SQL値のクリーニングを行う。
 * 引用符を除去し、数値に変換可能な場合はnumber型として返す。
 * @param {string} v - クリーニング対象の値文字列
 * @returns {string | number} クリーニングされた値
 */
function cleanValue(v: string): string | number {
  const stripped = v.replace(/['"`]/g, "").trim();
  const num = Number(stripped);
  if (!isNaN(num) && stripped.length > 0) return num;
  return stripped;
}

/**
 * WHERE条件を評価し、条件に合致する行のみをフィルタリングする。
 * OR条件およびAND条件の組み合わせに対応する簡易的な評価器。
 * @param {Row[]} rows - フィルタ対象の行データ配列
 * @param {string} where - WHERE句の条件文字列
 * @param {ColumnDef[]} _columns - カラム定義（将来の型チェック拡張用）
 * @returns {Row[]} 条件に合致する行の配列
 */
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

/**
 * 論理演算子（AND/OR）で式を分割する。
 * 正規表現を使い、単語境界でマッチする演算子のみを分割対象とする。
 * @param {string} expr - 分割対象の条件式
 * @param {string} op - 分割に使用する演算子（"AND" または "OR"）
 * @returns {string[]} 演算子で分割された部分式の配列
 */
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

/**
 * 単一のWHERE条件を評価する。
 * 等号比較、不等号比較、LIKE条件、数値比較（>, <, >=, <=）に対応。
 * 常にtrueとなるトートロジー（1=1等）も検出する。
 * @param {Row} row - 評価対象の行データ
 * @param {string} condition - 評価する条件式文字列
 * @returns {boolean} 条件に合致すればtrue
 */
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

/**
 * UPDATE文を実行する。
 * 実際のデータ更新は行わず、影響行数のシミュレーションのみを行う。
 * @param {Database} db - 実行対象のデータベース
 * @param {ParsedSql} parsed - パース済みのUPDATE文
 * @returns {QueryResult} 影響行数を含む実行結果
 */
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

/**
 * DELETE文を実行する。
 * 実際のデータ削除は行わず、影響行数のシミュレーションのみを行う。
 * @param {Database} db - 実行対象のデータベース
 * @param {ParsedSql} parsed - パース済みのDELETE文
 * @returns {QueryResult} 影響行数を含む実行結果
 */
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

/**
 * DROP TABLE文を実行する。
 * 指定テーブルが存在するかチェックし、結果を返す（実際の削除は行わない）。
 * @param {Database} db - 実行対象のデータベース
 * @param {ParsedSql} parsed - パース済みのDROP文
 * @returns {QueryResult} テーブル存在チェック結果を含む実行結果
 */
function executeDrop(db: Database, parsed: ParsedSql): QueryResult {
  if (parsed.table && db.tables[parsed.table]) {
    return { success: true, rows: [], affectedRows: 0, executedSql: parsed.raw };
  }
  return { success: false, rows: [], affectedRows: 0, error: `テーブル '${parsed.table}' が存在しません`, executedSql: parsed.raw };
}

// ─── 防御機構 ───

/**
 * SQL入力値のエスケープ処理を行う。
 * シングルクォート、バックスラッシュ、ダブルクォートをエスケープする。
 * @param {string} input - エスケープ対象の入力文字列
 * @returns {string} エスケープ済み文字列
 */
export function escapeSqlInput(input: string): string {
  return input.replace(/'/g, "''").replace(/\\/g, "\\\\").replace(/"/g, '""');
}

/**
 * WAF（Webアプリケーションファイアウォール）のパターンチェックを行う。
 * UNION SELECT、OR条件、SQLコメント、スタックドクエリ、DROP TABLE等の
 * 危険なパターンを検出し、ブロック判定を返す。
 * @param {string} input - チェック対象の入力文字列
 * @returns {{ blocked: boolean; reason?: string }} ブロック判定とその理由
 */
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

/**
 * 入力値の型バリデーションを行う。
 * 整数型の場合は数字のみであることを検証し、
 * テキスト型の場合はSQLで特殊な意味を持つ文字（; ' " \）が含まれていないことを検証する。
 * @param {string} input - バリデーション対象の入力文字列
 * @param {"integer" | "text"} expectedType - 期待される入力値の型
 * @returns {{ valid: boolean; reason?: string }} バリデーション結果と拒否理由
 */
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

/**
 * ホワイトリスト方式の入力チェックを行う。
 * 許可された正規表現パターンに一致しない入力を拒否する。
 * @param {string} input - チェック対象の入力文字列
 * @param {RegExp} allowed - 許可する入力パターンの正規表現
 * @returns {{ valid: boolean; reason?: string }} チェック結果と拒否理由
 */
export function whitelistCheck(input: string, allowed: RegExp): { valid: boolean; reason?: string } {
  if (!allowed.test(input)) {
    return { valid: false, reason: `入力 '${input}' はホワイトリストに一致しません` };
  }
  return { valid: true };
}

// ─── 攻撃シミュレーション ───

/**
 * 単一の攻撃操作をシミュレートする。
 * 入力受付 → 防御チェック（WAF/バリデーション/ホワイトリスト/エスケープ） →
 * SQL構築 → 権限チェック → SQL実行 → 攻撃結果分析 の各フェーズを順に実行し、
 * 各ステップの詳細ログと最終的な攻撃成否を返す。
 * @param {SimOp} op - シミュレーション操作の定義（攻撃ペイロード、防御設定等）
 * @returns {AttackResult} 攻撃シミュレーションの詳細結果
 */
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

/**
 * パラメータ化クエリを構築する。
 * ペイロードを安全な文字列リテラルとして埋め込み、インジェクションを防止する。
 * @param {string} template - クエリテンプレート（${input}をプレースホルダとして含む）
 * @param {string} value - バインドするパラメータ値
 * @returns {string} パラメータが安全に埋め込まれたSQL文字列
 */
function buildParameterizedQuery(template: string, value: string): string {
  // ペイロード全体を1つの文字列リテラルとして埋め込む
  const safe = value.replace(/'/g, "''");
  return template.replace("${input}", safe);
}

/**
 * インジェクション攻撃の成否を分析する。
 * 正常クエリとの構造差分、OR条件の挿入、時間ベース攻撃関数の有無を検出する。
 * @param {SimOp} op - シミュレーション操作の定義
 * @param {string} sql - 構築されたSQL文
 * @param {QueryResult} result - クエリ実行結果
 * @param {SimStep[]} steps - 分析結果を追記するステップ配列
 * @returns {boolean} インジェクションが成功した場合true
 */
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

/**
 * データ漏洩の発生を分析する。
 * パスワード、APIキー等の機密フィールドが結果に含まれるか、
 * UNION攻撃やWHERE条件操作で意図しないデータが取得されたかを判定する。
 * @param {SimOp} op - シミュレーション操作の定義
 * @param {QueryResult} result - クエリ実行結果
 * @param {SimStep[]} steps - 分析結果を追記するステップ配列
 * @returns {boolean} データ漏洩が発生した場合true
 */
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

/**
 * データ改ざん・破壊の発生を分析する。
 * DROP/DELETE/UPDATE文が実行されたか、スタックドクエリで破壊的操作が行われたかを判定する。
 * @param {SimOp} _op - シミュレーション操作の定義（未使用）
 * @param {ParsedSql} parsed - パース済みのSQL構造体
 * @param {QueryResult} result - クエリ実行結果
 * @param {SimStep[]} steps - 分析結果を追記するステップ配列
 * @returns {boolean} データ改ざん・破壊が発生した場合true
 */
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

/**
 * 認証バイパスの発生を分析する。
 * ログインクエリ（passwordフィールドを含む）でOR条件やコメントによる
 * 認証条件の無効化が行われたかを判定する。
 * @param {SimOp} op - シミュレーション操作の定義
 * @param {QueryResult} result - クエリ実行結果
 * @param {SimStep[]} steps - 分析結果を追記するステップ配列
 * @returns {boolean} 認証バイパスが発生した場合true
 */
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

/**
 * 攻撃結果オブジェクトを構築する。
 * 主に防御によりブロックされた場合の結果生成に使用する。
 * @returns {AttackResult} 構築された攻撃結果
 */
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

/**
 * 攻撃結果に基づいて防御勧告（改善提案）を生成する。
 * 有効化されていない防御機構に対して、導入を推奨するメッセージを追加する。
 */
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

/**
 * 入力方法の識別子を日本語ラベルに変換する。
 * @param {string} m - 入力方法の識別子（url_param, form_post等）
 * @returns {string} 日本語の入力方法ラベル
 */
export function inputMethodLabel(m: string): string {
  const labels: Record<string, string> = {
    url_param: "URLパラメータ",
    form_post: "POSTフォーム",
    cookie: "Cookie",
    http_header: "HTTPヘッダ",
  };
  return labels[m] ?? m;
}

/**
 * インジェクション種別の識別子を日本語ラベルに変換する。
 * @param {string} t - インジェクション種別の識別子（classic, union_based等）
 * @returns {string} 日本語のインジェクション種別ラベル
 */
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

/**
 * 全防御機構を無効にした防御設定を返す。
 * 攻撃が成功するケースのデモに使用する。
 * @returns {Defense} 全防御無効の設定オブジェクト
 */
export function noDefense(): Defense {
  return {
    parameterized: false, escaping: false, inputValidation: false,
    waf: false, whitelist: false, hideErrors: false, leastPrivilege: false,
  };
}

/**
 * パラメータ化クエリのみを有効にした防御設定を返す。
 * 最も効果的な単一防御策のデモに使用する。
 * @returns {Defense} パラメータ化クエリのみ有効の設定オブジェクト
 */
export function parameterizedOnly(): Defense {
  return { ...noDefense(), parameterized: true };
}

/**
 * エスケープ処理のみを有効にした防御設定を返す。
 * エスケープの効果と限界を示すデモに使用する。
 * @returns {Defense} エスケープのみ有効の設定オブジェクト
 */
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
