import type {
  Stmt, SelectStmt, InsertStmt, UpdateStmt, DeleteStmt,
  CreateTableStmt, CreateIndexStmt, DropTableStmt,
  QueryResult, SqlValue, Expr, FromClause, SelectColumn,
} from "../types.js";
import { PageType } from "../types.js";
import type { Pager } from "../storage/pager.js";
import type { SchemaManager } from "../catalog/schema-manager.js";
import { BTree } from "../btree/btree.js";
import { fullScan, indexScan, type Row } from "./scan.js";
import { evaluateExprAsync, isTruthy, type RowContext, type SubqueryRunner } from "./expression.js";
import { nestedLoopJoin } from "./join.js";
import { sortRows, groupRows, computeAggregate, buildRowContext } from "./sort.js";
import { planScan } from "./planner.js";

// SQL文を実行する
export class Executor {
  constructor(
    private pager: Pager,
    private schema: SchemaManager,
  ) {}

  async execute(stmt: Stmt): Promise<QueryResult> {
    switch (stmt.type) {
      case "select": return this.executeSelect(stmt);
      case "insert": return this.executeInsert(stmt);
      case "update": return this.executeUpdate(stmt);
      case "delete": return this.executeDelete(stmt);
      case "create_table": return this.executeCreateTable(stmt);
      case "create_index": return this.executeCreateIndex(stmt);
      case "drop_table": return this.executeDropTable(stmt);
    }
  }

  // サブクエリ実行用
  private createSubqueryRunner(): SubqueryRunner {
    return async (query: SelectStmt): Promise<QueryResult> => {
      return this.executeSelect(query);
    };
  }

  // === SELECT ===
  private async executeSelect(stmt: SelectStmt): Promise<QueryResult> {
    const subqueryRunner = this.createSubqueryRunner();

    // FROM句からの行取得
    let rows: Row[];
    if (stmt.from === undefined) {
      // FROMなし（例: SELECT 1 + 1）
      rows = [{ values: [], columns: [] }];
    } else {
      rows = await this.resolveFrom(stmt.from, subqueryRunner);
    }

    // WHERE
    if (stmt.where !== undefined) {
      rows = await this.filterRows(rows, stmt.where, subqueryRunner);
    }

    // GROUP BY + 集約
    const hasAggregates = this.hasAggregateFunction(stmt.columns);
    if (stmt.groupBy !== undefined || hasAggregates) {
      return this.executeGroupBy(stmt, rows, subqueryRunner);
    }

    // ORDER BY（SELECT射影前の全カラムで評価）
    if (stmt.orderBy !== undefined) {
      rows = sortRows(rows, stmt.orderBy);
    }

    // SELECT句の評価
    const { columns: resultColumns, rows: resultRows } = await this.evaluateSelectColumns(
      stmt.columns, rows, subqueryRunner,
    );

    // DISTINCT
    let finalRows = resultRows;
    if (stmt.distinct) {
      finalRows = this.applyDistinct(finalRows);
    }

    // LIMIT / OFFSET
    if (stmt.offset !== undefined) {
      const offset = await evaluateExprAsync(stmt.offset, new Map(), subqueryRunner);
      if (typeof offset === "number") {
        finalRows = finalRows.slice(offset);
      }
    }
    if (stmt.limit !== undefined) {
      const limit = await evaluateExprAsync(stmt.limit, new Map(), subqueryRunner);
      if (typeof limit === "number") {
        finalRows = finalRows.slice(0, limit);
      }
    }

    return { columns: resultColumns, rows: finalRows, rowsAffected: 0 };
  }

  // FROM句を解決
  private async resolveFrom(from: FromClause, subqueryRunner: SubqueryRunner): Promise<Row[]> {
    switch (from.type) {
      case "table": {
        const tableSchema = this.schema.getTableOrThrow(from.name);
        const indexes = this.schema.getIndexesForTable(from.name);
        const plan = planScan(tableSchema, indexes);

        let rows: Row[];
        if (plan.type === "index_scan") {
          rows = await indexScan(this.pager, tableSchema, plan.index.rootPage, plan.startKey, plan.endKey);
        } else {
          rows = await fullScan(this.pager, tableSchema);
        }

        // エイリアスがある場合、カラム名にプレフィックスを付ける
        const alias = from.alias ?? from.name;
        return rows.map(row => ({
          values: row.values,
          columns: row.columns.map(c => `${alias}.${c}`),
        }));
      }

      case "join": {
        const leftRows = await this.resolveFrom(from.left, subqueryRunner);
        const rightRows = await this.resolveFrom(from.right, subqueryRunner);
        const leftAlias = this.getFromAlias(from.left);
        const rightAlias = this.getFromAlias(from.right);
        return nestedLoopJoin(leftRows, rightRows, from.joinType, from.on, leftAlias, rightAlias, subqueryRunner);
      }

      case "subquery": {
        const result = await this.executeSelect(from.query);
        return result.rows.map(vals => ({
          values: vals,
          columns: result.columns.map(c => `${from.alias}.${c}`),
        }));
      }
    }
  }

  private getFromAlias(from: FromClause): string | undefined {
    switch (from.type) {
      case "table": return from.alias ?? from.name;
      case "subquery": return from.alias;
      case "join": return undefined;
    }
  }

  // WHERE フィルタ
  private async filterRows(rows: Row[], where: Expr, subqueryRunner: SubqueryRunner): Promise<Row[]> {
    const result: Row[] = [];
    for (const row of rows) {
      const ctx = buildRowContext(row);
      const val = await evaluateExprAsync(where, ctx, subqueryRunner);
      if (isTruthy(val)) {
        result.push(row);
      }
    }
    return result;
  }

  // SELECT句を評価
  private async evaluateSelectColumns(
    selectCols: SelectColumn[],
    rows: Row[],
    subqueryRunner: SubqueryRunner,
  ): Promise<{ columns: string[]; rows: SqlValue[][] }> {
    // カラム名を解決
    const resolvedColumns: { name: string; expr: Expr }[] = [];
    for (const col of selectCols) {
      if (col.expr.type === "wildcard") {
        if (col.expr.table !== undefined) {
          // table.* - 特定テーブルの全カラム
          const prefix = col.expr.table + ".";
          if (rows.length > 0) {
            const firstRow = rows[0];
            if (firstRow !== undefined) {
              for (const c of firstRow.columns) {
                if (c.startsWith(prefix)) {
                  resolvedColumns.push({ name: c, expr: { type: "column_ref", column: c } });
                }
              }
            }
          }
        } else {
          // * - 全カラム
          if (rows.length > 0) {
            const firstRow = rows[0];
            if (firstRow !== undefined) {
              for (const c of firstRow.columns) {
                resolvedColumns.push({ name: c, expr: { type: "column_ref", column: c } });
              }
            }
          }
        }
      } else {
        const name = col.alias ?? this.exprToName(col.expr);
        resolvedColumns.push({ name, expr: col.expr });
      }
    }

    const columnNames = resolvedColumns.map(c => c.name);
    const resultRows: SqlValue[][] = [];

    for (const row of rows) {
      const ctx = buildRowContext(row);
      const vals: SqlValue[] = [];
      for (const col of resolvedColumns) {
        const val = await evaluateExprAsync(col.expr, ctx, subqueryRunner);
        vals.push(val);
      }
      resultRows.push(vals);
    }

    return { columns: columnNames, rows: resultRows };
  }

  // GROUP BY + 集約
  private async executeGroupBy(
    stmt: SelectStmt,
    rows: Row[],
    subqueryRunner: SubqueryRunner,
  ): Promise<QueryResult> {
    let groups: Map<string, Row[]>;
    if (stmt.groupBy !== undefined) {
      groups = groupRows(rows, stmt.groupBy);
    } else {
      // 集約関数のみ（GROUP BYなし）→ 全行を1グループ
      groups = new Map([["", rows]]);
    }

    const resultColumns: string[] = [];
    const resultRows: SqlValue[][] = [];

    // カラム名を事前に解決
    for (const col of stmt.columns) {
      if (col.expr.type === "wildcard") {
        throw new Error("GROUP BY では * は使用できません");
      }
      resultColumns.push(col.alias ?? this.exprToName(col.expr));
    }

    for (const [, groupRows_] of groups) {
      const vals: SqlValue[] = [];
      // グループの代表行（非集約カラム用）
      const representativeRow = groupRows_[0];
      if (representativeRow === undefined) continue;
      const ctx = buildRowContext(representativeRow);

      for (const col of stmt.columns) {
        if (col.expr.type === "function_call" && this.isAggregateFunction(col.expr.name)) {
          const argExpr = col.expr.args[0] ?? { type: "wildcard" as const };
          vals.push(computeAggregate(col.expr.name, groupRows_, argExpr, col.expr.distinct));
        } else {
          const val = await evaluateExprAsync(col.expr, ctx, subqueryRunner);
          vals.push(val);
        }
      }
      resultRows.push(vals);
    }

    // HAVING
    let finalRows = resultRows;
    if (stmt.having !== undefined) {
      finalRows = [];
      for (let i = 0; i < resultRows.length; i++) {
        const row = resultRows[i];
        if (row === undefined) continue;
        const ctx: RowContext = new Map();
        for (let j = 0; j < resultColumns.length; j++) {
          const colName = resultColumns[j];
          if (colName !== undefined) {
            ctx.set(colName, row[j] ?? null);
          }
        }

        // HAVING式の中にも集約関数がある可能性
        const havingVal = await this.evaluateHavingExpr(
          stmt.having, ctx, [...groups.values()][i] ?? [], subqueryRunner,
        );
        if (isTruthy(havingVal)) {
          finalRows.push(row);
        }
      }
    }

    // ORDER BY
    if (stmt.orderBy !== undefined) {
      const orderRows = finalRows.map(vals => ({
        values: vals,
        columns: resultColumns,
      }));
      const sorted = sortRows(orderRows, stmt.orderBy);
      finalRows = sorted.map(r => r.values);
    }

    // LIMIT / OFFSET
    if (stmt.offset !== undefined) {
      const offset = await evaluateExprAsync(stmt.offset, new Map(), subqueryRunner);
      if (typeof offset === "number") finalRows = finalRows.slice(offset);
    }
    if (stmt.limit !== undefined) {
      const limit = await evaluateExprAsync(stmt.limit, new Map(), subqueryRunner);
      if (typeof limit === "number") finalRows = finalRows.slice(0, limit);
    }

    return { columns: resultColumns, rows: finalRows, rowsAffected: 0 };
  }

  private async evaluateHavingExpr(
    expr: Expr,
    ctx: RowContext,
    groupRows_: Row[],
    subqueryRunner: SubqueryRunner,
  ): Promise<SqlValue> {
    if (expr.type === "function_call" && this.isAggregateFunction(expr.name)) {
      const argExpr = expr.args[0] ?? { type: "wildcard" as const };
      return computeAggregate(expr.name, groupRows_, argExpr, expr.distinct);
    }
    if (expr.type === "binary_op") {
      const left = await this.evaluateHavingExpr(expr.left, ctx, groupRows_, subqueryRunner);
      const right = await this.evaluateHavingExpr(expr.right, ctx, groupRows_, subqueryRunner);
      // 左右の値が得られたので比較
      const leftExpr: Expr = { type: "literal", value: left };
      const rightExpr: Expr = { type: "literal", value: right };
      const tempCtx: RowContext = new Map();
      return evaluateExprAsync(
        { type: "binary_op", op: expr.op, left: leftExpr, right: rightExpr },
        tempCtx,
        subqueryRunner,
      );
    }
    return evaluateExprAsync(expr, ctx, subqueryRunner);
  }

  // DISTINCT
  private applyDistinct(rows: SqlValue[][]): SqlValue[][] {
    const seen = new Set<string>();
    return rows.filter(row => {
      const key = row.map(v => {
        if (v === null) return "NULL";
        if (typeof v === "number") return `N:${String(v)}`;
        if (typeof v === "string") return `S:${v}`;
        return `B:${Array.from(v).join(",")}`;
      }).join("\0");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // 集約関数の判定
  private isAggregateFunction(name: string): boolean {
    const aggs = ["COUNT", "SUM", "AVG", "MIN", "MAX"];
    return aggs.includes(name.toUpperCase());
  }

  private hasAggregateFunction(columns: SelectColumn[]): boolean {
    return columns.some(col => this.exprHasAggregate(col.expr));
  }

  private exprHasAggregate(expr: Expr): boolean {
    if (expr.type === "function_call" && this.isAggregateFunction(expr.name)) return true;
    if (expr.type === "binary_op") {
      return this.exprHasAggregate(expr.left) || this.exprHasAggregate(expr.right);
    }
    if (expr.type === "unary_op") return this.exprHasAggregate(expr.operand);
    return false;
  }

  // 式からカラム名を推測
  private exprToName(expr: Expr): string {
    switch (expr.type) {
      case "column_ref":
        return expr.table !== undefined ? `${expr.table}.${expr.column}` : expr.column;
      case "function_call":
        return `${expr.name}(${expr.args.map(a => this.exprToName(a)).join(", ")})`;
      case "literal":
        return String(expr.value ?? "NULL");
      case "wildcard":
        return expr.table !== undefined ? `${expr.table}.*` : "*";
      default:
        return "?";
    }
  }

  // === INSERT ===
  private async executeInsert(stmt: InsertStmt): Promise<QueryResult> {
    const tableSchema = this.schema.getTableOrThrow(stmt.table);
    const tree = new BTree(this.pager, tableSchema.rootPage);
    const subqueryRunner = this.createSubqueryRunner();
    const indexes = this.schema.getIndexesForTable(stmt.table);

    let rowsAffected = 0;

    for (const valueExprs of stmt.values) {
      // カラム順序を決定
      const colOrder = stmt.columns ?? tableSchema.columns.map(c => c.name);

      // 値を評価
      const rowValues = new Map<string, SqlValue>();
      for (let i = 0; i < colOrder.length; i++) {
        const colName = colOrder[i];
        const valueExpr = valueExprs[i];
        if (colName !== undefined && valueExpr !== undefined) {
          const val = await evaluateExprAsync(valueExpr, new Map(), subqueryRunner);
          rowValues.set(colName, val);
        }
      }

      // AUTOINCREMENT処理
      const pkCol = tableSchema.columns.find(c => c.primaryKey);
      let pkValue: SqlValue | undefined;
      if (pkCol !== undefined) {
        pkValue = rowValues.get(pkCol.name) ?? null;
        if ((pkValue === null || pkValue === undefined) && pkCol.autoIncrement) {
          const nextId = tableSchema.autoIncrementSeq + 1;
          pkValue = nextId;
          rowValues.set(pkCol.name, nextId);
          await this.schema.updateAutoIncrement(stmt.table, nextId);
        }
      }

      // 全カラムの値を順序通りに構築
      const allValues: SqlValue[] = tableSchema.columns.map(c => rowValues.get(c.name) ?? null);

      // 主キーを決定
      const key: SqlValue[] = pkCol !== undefined ? [rowValues.get(pkCol.name) ?? null] : [rowsAffected];

      // B+Treeに挿入
      await tree.insert(key, allValues);

      // セカンダリインデックスにも挿入
      for (const idx of indexes) {
        const indexTree = new BTree(this.pager, idx.rootPage);
        const indexKey = idx.columns.map(c => rowValues.get(c) ?? null);
        const indexValue = key; // 主キーを値として格納
        await indexTree.insert(indexKey, indexValue);
      }

      rowsAffected++;
    }

    // ルートページが変わった場合の処理
    this.updateRootPage(stmt.table, tree.getRootPageId());

    return { columns: [], rows: [], rowsAffected };
  }

  // === UPDATE ===
  private async executeUpdate(stmt: UpdateStmt): Promise<QueryResult> {
    const tableSchema = this.schema.getTableOrThrow(stmt.table);
    const tree = new BTree(this.pager, tableSchema.rootPage);
    const subqueryRunner = this.createSubqueryRunner();
    const pkCol = tableSchema.columns.find(c => c.primaryKey);

    // 全行スキャン
    const rows = await fullScan(this.pager, tableSchema);
    let rowsAffected = 0;

    for (const row of rows) {
      // WHERE評価
      if (stmt.where !== undefined) {
        const ctx = buildRowContext(row);
        const val = await evaluateExprAsync(stmt.where, ctx, subqueryRunner);
        if (!isTruthy(val)) continue;
      }

      // 元のキーを取得
      const pkIndex = pkCol !== undefined
        ? tableSchema.columns.findIndex(c => c.name === pkCol.name)
        : 0;
      const oldKey: SqlValue[] = [row.values[pkIndex] ?? null];

      // SET句を適用
      const newValues = [...row.values];
      const ctx = buildRowContext(row);
      for (const setItem of stmt.set) {
        const colIndex = tableSchema.columns.findIndex(c => c.name === setItem.column);
        if (colIndex >= 0) {
          const val = await evaluateExprAsync(setItem.value, ctx, subqueryRunner);
          newValues[colIndex] = val;
        }
      }

      // 削除して再挿入
      await tree.delete(oldKey);
      const newKey = pkCol !== undefined
        ? [newValues[pkIndex] ?? null]
        : oldKey;
      await tree.insert(newKey, newValues);
      rowsAffected++;
    }

    this.updateRootPage(stmt.table, tree.getRootPageId());
    return { columns: [], rows: [], rowsAffected };
  }

  // === DELETE ===
  private async executeDelete(stmt: DeleteStmt): Promise<QueryResult> {
    const tableSchema = this.schema.getTableOrThrow(stmt.table);
    const tree = new BTree(this.pager, tableSchema.rootPage);
    const subqueryRunner = this.createSubqueryRunner();
    const pkCol = tableSchema.columns.find(c => c.primaryKey);

    const rows = await fullScan(this.pager, tableSchema);
    let rowsAffected = 0;

    for (const row of rows) {
      if (stmt.where !== undefined) {
        const ctx = buildRowContext(row);
        const val = await evaluateExprAsync(stmt.where, ctx, subqueryRunner);
        if (!isTruthy(val)) continue;
      }

      const pkIndex = pkCol !== undefined
        ? tableSchema.columns.findIndex(c => c.name === pkCol.name)
        : 0;
      const key: SqlValue[] = [row.values[pkIndex] ?? null];
      await tree.delete(key);
      rowsAffected++;
    }

    this.updateRootPage(stmt.table, tree.getRootPageId());
    return { columns: [], rows: [], rowsAffected };
  }

  // === CREATE TABLE ===
  private async executeCreateTable(stmt: CreateTableStmt): Promise<QueryResult> {
    if (stmt.ifNotExists && this.schema.getTable(stmt.name) !== undefined) {
      return { columns: [], rows: [], rowsAffected: 0 };
    }

    const { pageId } = await this.pager.allocatePage(PageType.Leaf);
    await this.schema.createTable({
      name: stmt.name,
      columns: stmt.columns,
      rootPage: pageId,
      autoIncrementSeq: 0,
    });

    return { columns: [], rows: [], rowsAffected: 0 };
  }

  // === CREATE INDEX ===
  private async executeCreateIndex(stmt: CreateIndexStmt): Promise<QueryResult> {
    if (stmt.ifNotExists && this.schema.getIndex(stmt.name) !== undefined) {
      return { columns: [], rows: [], rowsAffected: 0 };
    }

    const tableSchema = this.schema.getTableOrThrow(stmt.table);
    const { pageId } = await this.pager.allocatePage(PageType.Leaf);

    await this.schema.createIndex({
      name: stmt.name,
      tableName: stmt.table,
      columns: stmt.columns,
      rootPage: pageId,
      unique: stmt.unique ?? false,
    });

    // 既存データからインデックスを構築
    const indexTree = new BTree(this.pager, pageId);
    const tableTree = new BTree(this.pager, tableSchema.rootPage);
    const pkCol = tableSchema.columns.find(c => c.primaryKey);
    const pkIndex = pkCol !== undefined
      ? tableSchema.columns.findIndex(c => c.name === pkCol.name)
      : 0;

    for await (const cell of tableTree.fullScan()) {
      const row = cell.value;
      const indexKey = stmt.columns.map(colName => {
        const colIndex = tableSchema.columns.findIndex(c => c.name === colName);
        return colIndex >= 0 ? (row[colIndex] ?? null) : null;
      });
      const pk: SqlValue[] = [row[pkIndex] ?? null];
      await indexTree.insert(indexKey, pk);
    }

    return { columns: [], rows: [], rowsAffected: 0 };
  }

  // === DROP TABLE ===
  private async executeDropTable(stmt: DropTableStmt): Promise<QueryResult> {
    if (stmt.ifExists && this.schema.getTable(stmt.name) === undefined) {
      return { columns: [], rows: [], rowsAffected: 0 };
    }
    await this.schema.dropTable(stmt.name);
    return { columns: [], rows: [], rowsAffected: 0 };
  }

  // ルートページID更新
  private updateRootPage(tableName: string, newRootPageId: number): void {
    const table = this.schema.getTable(tableName);
    if (table !== undefined && table.rootPage !== newRootPageId) {
      table.rootPage = newRootPageId;
    }
  }
}
