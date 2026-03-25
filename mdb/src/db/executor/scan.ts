import type { SqlValue, TableSchema } from "../types.js";
import { BTree } from "../btree/btree.js";
import type { Pager } from "../storage/pager.js";

// 行型: カラム名の順序に沿ったSqlValue配列
export interface Row {
  values: SqlValue[];
  columns: string[];
}

// テーブルのフルスキャン
export async function fullScan(pager: Pager, schema: TableSchema): Promise<Row[]> {
  const tree = new BTree(pager, schema.rootPage);
  const rows: Row[] = [];
  const columns = schema.columns.map(c => c.name);

  for await (const cell of tree.fullScan()) {
    // key[0] = rowid, value = 各カラムの値（rowidを含む全カラム）
    rows.push({ values: cell.value, columns });
  }

  return rows;
}

// インデックススキャンで主キーを取得し、テーブルから行を取得
export async function indexScan(
  pager: Pager,
  tableSchema: TableSchema,
  indexRootPage: number,
  startKey?: SqlValue[],
  endKey?: SqlValue[],
): Promise<Row[]> {
  const indexTree = new BTree(pager, indexRootPage);
  const tableTree = new BTree(pager, tableSchema.rootPage);
  const rows: Row[] = [];
  const columns = tableSchema.columns.map(c => c.name);

  for await (const cell of indexTree.rangeScan(startKey, endKey)) {
    // indexのvalue[0] = 主キー (rowid)
    const pk = cell.value[0];
    if (pk === undefined) continue;
    const rowData = await tableTree.search([pk]);
    if (rowData !== undefined) {
      rows.push({ values: rowData, columns });
    }
  }

  return rows;
}

// 等価インデックスルックアップ
export async function indexLookup(
  pager: Pager,
  tableSchema: TableSchema,
  indexRootPage: number,
  key: SqlValue[],
): Promise<Row[]> {
  return indexScan(pager, tableSchema, indexRootPage, key, key);
}
