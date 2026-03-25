import type { SqlValue, JoinType } from "../types.js";
import type { Row } from "./scan.js";
import type { RowContext } from "./expression.js";
import { evaluateExprAsync, isTruthy } from "./expression.js";
import type { Expr } from "../types.js";
import type { SubqueryRunner } from "./expression.js";

// Nested Loop Join
export async function nestedLoopJoin(
  left: Row[],
  right: Row[],
  joinType: JoinType,
  onExpr: Expr,
  _leftAlias: string | undefined,
  _rightAlias: string | undefined,
  subqueryRunner?: SubqueryRunner,
): Promise<Row[]> {
  const result: Row[] = [];

  for (const leftRow of left) {
    let matched = false;

    for (const rightRow of right) {
      // コンテキスト構築（カラム名は既にプレフィックス付き）
      const ctx: RowContext = new Map();
      for (let i = 0; i < leftRow.columns.length; i++) {
        const col = leftRow.columns[i];
        const val = leftRow.values[i] ?? null;
        if (col !== undefined) {
          ctx.set(col, val);
        }
      }
      for (let i = 0; i < rightRow.columns.length; i++) {
        const col = rightRow.columns[i];
        const val = rightRow.values[i] ?? null;
        if (col !== undefined) {
          ctx.set(col, val);
        }
      }

      const onValue = await evaluateExprAsync(onExpr, ctx, subqueryRunner);
      if (isTruthy(onValue)) {
        matched = true;
        // 結合された行（カラム名は既にプレフィックス付き）
        const combinedValues = [...leftRow.values, ...rightRow.values];
        const combinedColumns = [...leftRow.columns, ...rightRow.columns];
        result.push({ values: combinedValues, columns: combinedColumns });
      }
    }

    // LEFT JOIN で一致しなかった場合、右側をNULLで埋める
    if (!matched && joinType === "LEFT") {
      const nullValues = rightRow_nulls(right);
      const combinedValues = [...leftRow.values, ...nullValues];
      const combinedColumns = [
        ...leftRow.columns,
        ...(right.length > 0 ? (right[0]?.columns ?? []) : []),
      ];
      result.push({ values: combinedValues, columns: combinedColumns });
    }
  }

  return result;
}

function rightRow_nulls(right: Row[]): SqlValue[] {
  if (right.length === 0) return [];
  const firstRow = right[0];
  if (firstRow === undefined) return [];
  return firstRow.columns.map(() => null);
}
