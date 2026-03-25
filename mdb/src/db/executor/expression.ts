import type { Expr, SqlValue } from "../types.js";
import { compareSqlValues } from "../btree/node.js";

// 行コンテキスト: カラム名 → 値のマッピング
export type RowContext = Map<string, SqlValue>;

// 式を評価する
export function evaluateExpr(expr: Expr, ctx: RowContext, subqueryRunner?: SubqueryRunner): SqlValue {
  switch (expr.type) {
    case "literal":
      return expr.value;

    case "column_ref": {
      // テーブル修飾付きの場合
      if (expr.table !== undefined) {
        const key = `${expr.table}.${expr.column}`;
        const val = ctx.get(key);
        if (val !== undefined) return val;
      }
      // テーブル修飾なし
      const val = ctx.get(expr.column);
      if (val !== undefined) return val;
      // テーブル修飾付きで格納されている場合を検索
      for (const [key, value] of ctx) {
        const parts = key.split(".");
        if (parts.length === 2 && parts[1] === expr.column) {
          return value;
        }
      }
      return null;
    }

    case "binary_op":
      return evaluateBinaryOp(expr.op, expr.left, expr.right, ctx, subqueryRunner);

    case "unary_op": {
      const operand = evaluateExpr(expr.operand, ctx, subqueryRunner);
      if (expr.op === "NOT") {
        if (operand === null) return null;
        return operand ? 0 : 1;
      }
      if (expr.op === "-") {
        if (operand === null) return null;
        if (typeof operand === "number") return -operand;
        return null;
      }
      return null;
    }

    case "is_null": {
      const val = evaluateExpr(expr.expr, ctx, subqueryRunner);
      const result = val === null;
      return (expr.not ? !result : result) ? 1 : 0;
    }

    case "between": {
      const val = evaluateExpr(expr.expr, ctx, subqueryRunner);
      const low = evaluateExpr(expr.low, ctx, subqueryRunner);
      const high = evaluateExpr(expr.high, ctx, subqueryRunner);
      if (val === null || low === null || high === null) return null;
      const result = compareSqlValues(val, low) >= 0 && compareSqlValues(val, high) <= 0;
      return (expr.not ? !result : result) ? 1 : 0;
    }

    case "in_list": {
      const val = evaluateExpr(expr.expr, ctx, subqueryRunner);
      if (val === null) return null;
      let found = false;
      for (const item of expr.values) {
        const itemVal = evaluateExpr(item, ctx, subqueryRunner);
        if (itemVal !== null && compareSqlValues(val, itemVal) === 0) {
          found = true;
          break;
        }
      }
      return (expr.not ? !found : found) ? 1 : 0;
    }

    case "like": {
      const val = evaluateExpr(expr.expr, ctx, subqueryRunner);
      const pattern = evaluateExpr(expr.pattern, ctx, subqueryRunner);
      if (val === null || pattern === null) return null;
      if (typeof val !== "string" || typeof pattern !== "string") return null;
      const result = matchLike(val, pattern);
      return (expr.not ? !result : result) ? 1 : 0;
    }

    case "function_call":
      // 集約関数は別の場所で処理される
      // ここではスカラー関数のみ
      return evaluateScalarFunction(expr.name, expr.args, ctx, subqueryRunner);

    case "subquery":
    case "in_subquery":
    case "exists":
      if (subqueryRunner === undefined) {
        throw new Error("サブクエリの実行にはsubqueryRunnerが必要です");
      }
      throw new Error("同期的なサブクエリ評価はサポートされていません");

    case "wildcard":
      return null;
  }
}

// 非同期版の式評価（サブクエリ対応）
export async function evaluateExprAsync(expr: Expr, ctx: RowContext, subqueryRunner?: SubqueryRunner): Promise<SqlValue> {
  switch (expr.type) {
    case "subquery": {
      if (subqueryRunner === undefined) throw new Error("サブクエリの実行にはsubqueryRunnerが必要です");
      const result = await subqueryRunner(expr.query);
      // スカラーサブクエリ: 最初の行の最初のカラムを返す
      if (result.rows.length === 0) return null;
      const firstRow = result.rows[0];
      if (firstRow === undefined || firstRow.length === 0) return null;
      return firstRow[0] ?? null;
    }

    case "in_subquery": {
      if (subqueryRunner === undefined) throw new Error("サブクエリの実行にはsubqueryRunnerが必要です");
      const val = await evaluateExprAsync(expr.expr, ctx, subqueryRunner);
      if (val === null) return null;
      const result = await subqueryRunner(expr.query);
      let found = false;
      for (const row of result.rows) {
        const rowVal = row[0];
        if (rowVal !== undefined && rowVal !== null && compareSqlValues(val, rowVal) === 0) {
          found = true;
          break;
        }
      }
      return (expr.not ? !found : found) ? 1 : 0;
    }

    case "exists": {
      if (subqueryRunner === undefined) throw new Error("サブクエリの実行にはsubqueryRunnerが必要です");
      const result = await subqueryRunner(expr.query);
      const exists = result.rows.length > 0;
      return (expr.not ? !exists : exists) ? 1 : 0;
    }

    case "binary_op": {
      const left = await evaluateExprAsync(expr.left, ctx, subqueryRunner);
      const right = await evaluateExprAsync(expr.right, ctx, subqueryRunner);
      return evaluateBinaryOpValues(expr.op, left, right);
    }

    case "unary_op": {
      const operand = await evaluateExprAsync(expr.operand, ctx, subqueryRunner);
      if (expr.op === "NOT") {
        if (operand === null) return null;
        return operand ? 0 : 1;
      }
      if (expr.op === "-") {
        if (operand === null) return null;
        if (typeof operand === "number") return -operand;
        return null;
      }
      return null;
    }

    default:
      return evaluateExpr(expr, ctx, subqueryRunner);
  }
}

// サブクエリ実行関数の型
export type SubqueryRunner = (query: import("../types.js").SelectStmt) => Promise<import("../types.js").QueryResult>;

function evaluateBinaryOp(
  op: import("../types.js").BinaryOp,
  leftExpr: Expr,
  rightExpr: Expr,
  ctx: RowContext,
  subqueryRunner?: SubqueryRunner,
): SqlValue {
  const left = evaluateExpr(leftExpr, ctx, subqueryRunner);
  const right = evaluateExpr(rightExpr, ctx, subqueryRunner);
  return evaluateBinaryOpValues(op, left, right);
}

function evaluateBinaryOpValues(op: import("../types.js").BinaryOp, left: SqlValue, right: SqlValue): SqlValue {
  // NULL伝播（AND/ORは特別扱い）
  if (op === "AND") {
    if (left === 0 || right === 0) return 0;
    if (left === null || right === null) return null;
    return (left && right) ? 1 : 0;
  }
  if (op === "OR") {
    if ((left !== null && left !== 0) || (right !== null && right !== 0)) return 1;
    if (left === null || right === null) return null;
    return 0;
  }

  if (left === null || right === null) return null;

  switch (op) {
    case "=": return compareSqlValues(left, right) === 0 ? 1 : 0;
    case "!=": return compareSqlValues(left, right) !== 0 ? 1 : 0;
    case "<": return compareSqlValues(left, right) < 0 ? 1 : 0;
    case ">": return compareSqlValues(left, right) > 0 ? 1 : 0;
    case "<=": return compareSqlValues(left, right) <= 0 ? 1 : 0;
    case ">=": return compareSqlValues(left, right) >= 0 ? 1 : 0;
    case "+": {
      if (typeof left === "number" && typeof right === "number") return left + right;
      return null;
    }
    case "-": {
      if (typeof left === "number" && typeof right === "number") return left - right;
      return null;
    }
    case "*": {
      if (typeof left === "number" && typeof right === "number") return left * right;
      return null;
    }
    case "/": {
      if (typeof left === "number" && typeof right === "number") {
        if (right === 0) return null;
        return left / right;
      }
      return null;
    }
    case "%": {
      if (typeof left === "number" && typeof right === "number") {
        if (right === 0) return null;
        return left % right;
      }
      return null;
    }
    case "||": {
      return String(left) + String(right);
    }
  }
}

function evaluateScalarFunction(name: string, args: Expr[], ctx: RowContext, subqueryRunner?: SubqueryRunner): SqlValue {
  const upperName = name.toUpperCase();

  switch (upperName) {
    case "ABS": {
      const val = evaluateExpr(args[0]!, ctx, subqueryRunner);
      if (val === null || typeof val !== "number") return null;
      return Math.abs(val);
    }
    case "UPPER": {
      const val = evaluateExpr(args[0]!, ctx, subqueryRunner);
      if (val === null || typeof val !== "string") return null;
      return val.toUpperCase();
    }
    case "LOWER": {
      const val = evaluateExpr(args[0]!, ctx, subqueryRunner);
      if (val === null || typeof val !== "string") return null;
      return val.toLowerCase();
    }
    case "LENGTH": {
      const val = evaluateExpr(args[0]!, ctx, subqueryRunner);
      if (val === null) return null;
      if (typeof val === "string") return val.length;
      if (val instanceof Uint8Array) return val.length;
      return null;
    }
    case "TYPEOF": {
      const val = evaluateExpr(args[0]!, ctx, subqueryRunner);
      if (val === null) return "null";
      if (typeof val === "number") return Number.isInteger(val) ? "integer" : "real";
      if (typeof val === "string") return "text";
      if (val instanceof Uint8Array) return "blob";
      return "null";
    }
    case "COALESCE": {
      for (const arg of args) {
        const val = evaluateExpr(arg, ctx, subqueryRunner);
        if (val !== null) return val;
      }
      return null;
    }
    default:
      throw new Error(`未知の関数: ${name}`);
  }
}

// LIKE パターンマッチング
function matchLike(str: string, pattern: string): boolean {
  // SQL LIKE → 正規表現に変換
  let regex = "^";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "%") {
      regex += ".*";
    } else if (ch === "_") {
      regex += ".";
    } else if ("/.*+?|()[]{}\\^$".includes(ch ?? "")) {
      regex += "\\" + ch;
    } else {
      regex += ch;
    }
  }
  regex += "$";
  return new RegExp(regex, "i").test(str);
}

// 値がtruthyかどうか（SQLの真偽判定）
export function isTruthy(value: SqlValue): boolean {
  if (value === null) return false;
  if (value === 0) return false;
  if (value === "") return false;
  return true;
}
