import type { SqlValue, OrderByItem, Expr } from "../types.js";
import type { Row } from "./scan.js";
import { evaluateExpr, type RowContext } from "./expression.js";
import { compareSqlValues } from "../btree/node.js";

// ORDER BY でソート
export function sortRows(rows: Row[], orderBy: OrderByItem[]): Row[] {
  const sorted = [...rows];
  sorted.sort((a, b) => {
    for (const item of orderBy) {
      const ctxA = buildRowContext(a);
      const ctxB = buildRowContext(b);
      const valA = evaluateExpr(item.expr, ctxA);
      const valB = evaluateExpr(item.expr, ctxB);
      let cmp = compareSqlValues(valA, valB);
      if (item.direction === "DESC") cmp = -cmp;
      if (cmp !== 0) return cmp;
    }
    return 0;
  });
  return sorted;
}

// GROUP BY でグループ化
export function groupRows(rows: Row[], groupExprs: Expr[]): Map<string, Row[]> {
  const groups = new Map<string, Row[]>();

  for (const row of rows) {
    const ctx = buildRowContext(row);
    const keyParts: string[] = [];
    for (const expr of groupExprs) {
      const val = evaluateExpr(expr, ctx);
      keyParts.push(serializeValue(val));
    }
    const groupKey = keyParts.join("\0");

    const existing = groups.get(groupKey);
    if (existing !== undefined) {
      existing.push(row);
    } else {
      groups.set(groupKey, [row]);
    }
  }

  return groups;
}

// 集約関数を適用
export function computeAggregate(
  name: string,
  rows: Row[],
  argExpr: Expr,
  distinct?: boolean,
): SqlValue {
  const upperName = name.toUpperCase();

  if (upperName === "COUNT" && argExpr.type === "wildcard") {
    return rows.length;
  }

  // 引数値を収集
  let values: SqlValue[] = [];
  for (const row of rows) {
    const ctx = buildRowContext(row);
    const val = evaluateExpr(argExpr, ctx);
    if (val !== null) values.push(val);
  }

  // DISTINCT処理
  if (distinct) {
    const seen = new Set<string>();
    values = values.filter(v => {
      const key = serializeValue(v);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  switch (upperName) {
    case "COUNT":
      return values.length;

    case "SUM": {
      if (values.length === 0) return null;
      let sum = 0;
      for (const v of values) {
        if (typeof v === "number") sum += v;
      }
      return sum;
    }

    case "AVG": {
      if (values.length === 0) return null;
      let sum = 0;
      let count = 0;
      for (const v of values) {
        if (typeof v === "number") {
          sum += v;
          count++;
        }
      }
      return count > 0 ? sum / count : null;
    }

    case "MIN": {
      if (values.length === 0) return null;
      let min = values[0] ?? null;
      for (let i = 1; i < values.length; i++) {
        const v = values[i] ?? null;
        if (compareSqlValues(v, min) < 0) min = v;
      }
      return min;
    }

    case "MAX": {
      if (values.length === 0) return null;
      let max = values[0] ?? null;
      for (let i = 1; i < values.length; i++) {
        const v = values[i] ?? null;
        if (compareSqlValues(v, max) > 0) max = v;
      }
      return max;
    }

    default:
      throw new Error(`未知の集約関数: ${name}`);
  }
}

// RowContextを構築
export function buildRowContext(row: Row): RowContext {
  const ctx: RowContext = new Map();
  for (let i = 0; i < row.columns.length; i++) {
    const col = row.columns[i];
    const val = row.values[i] ?? null;
    if (col !== undefined) ctx.set(col, val);
  }
  return ctx;
}

function serializeValue(val: SqlValue): string {
  if (val === null) return "NULL";
  if (typeof val === "number") return `N:${String(val)}`;
  if (typeof val === "string") return `S:${val}`;
  if (val instanceof Uint8Array) return `B:${Array.from(val).join(",")}`;
  return "NULL";
}
