import type { Expr, IndexSchema, TableSchema } from "../types.js";

// クエリプラン
export type ScanPlan =
  | { type: "full_scan"; table: TableSchema }
  | { type: "index_scan"; table: TableSchema; index: IndexSchema; startKey: import("../types.js").SqlValue[]; endKey: import("../types.js").SqlValue[] };

// WHERE条件からインデックスが使えるか判定
export function planScan(
  table: TableSchema,
  indexes: IndexSchema[],
  where?: Expr,
): ScanPlan {
  if (where === undefined || indexes.length === 0) {
    return { type: "full_scan", table };
  }

  // 単純な等価条件 (column = literal) のインデックスマッチング
  for (const idx of indexes) {
    const firstCol = idx.columns[0];
    if (firstCol === undefined) continue;

    const matchedValue = extractEqualityValue(where, firstCol);
    if (matchedValue !== undefined) {
      return {
        type: "index_scan",
        table,
        index: idx,
        startKey: [matchedValue],
        endKey: [matchedValue],
      };
    }
  }

  return { type: "full_scan", table };
}

// WHERE条件から column = literal の値を抽出
function extractEqualityValue(expr: Expr, columnName: string): import("../types.js").SqlValue | undefined {
  if (expr.type === "binary_op" && expr.op === "=") {
    // column = literal
    if (expr.left.type === "column_ref" && expr.left.column === columnName && expr.right.type === "literal") {
      return expr.right.value;
    }
    // literal = column
    if (expr.right.type === "column_ref" && expr.right.column === columnName && expr.left.type === "literal") {
      return expr.left.value;
    }
  }

  // AND条件の中を探す
  if (expr.type === "binary_op" && expr.op === "AND") {
    const left = extractEqualityValue(expr.left, columnName);
    if (left !== undefined) return left;
    return extractEqualityValue(expr.right, columnName);
  }

  return undefined;
}
