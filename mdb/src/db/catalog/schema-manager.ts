import { type TableSchema, type IndexSchema, type SqlValue } from "../types.js";
import type { Pager } from "../storage/pager.js";
import { BTree } from "../btree/btree.js";

// メタデータのキー
const META_TABLE_PREFIX = "t:";
const META_INDEX_PREFIX = "i:";
const META_AUTOINC_PREFIX = "a:";

// テーブルとインデックスのメタデータを管理
export class SchemaManager {
  private tables = new Map<string, TableSchema>();
  private indexes = new Map<string, IndexSchema>();
  private metaTree: BTree;

  constructor(pager: Pager, metaRootPageId: number) {
    this.metaTree = new BTree(pager, metaRootPageId);
  }

  // メタページからスキーマ情報を読み込む
  async load(): Promise<void> {
    this.tables.clear();
    this.indexes.clear();

    for await (const cell of this.metaTree.fullScan()) {
      const keyStr = cell.key[0];
      if (typeof keyStr !== "string") continue;

      if (keyStr.startsWith(META_TABLE_PREFIX)) {
        const schema = this.deserializeTableSchema(cell.value);
        this.tables.set(schema.name, schema);
      } else if (keyStr.startsWith(META_INDEX_PREFIX)) {
        const schema = this.deserializeIndexSchema(cell.value);
        this.indexes.set(schema.name, schema);
      }
    }

    // autoincrement情報を読み込む
    for (const [, table] of this.tables) {
      const autoinc = await this.metaTree.search([META_AUTOINC_PREFIX + table.name]);
      if (autoinc !== undefined && autoinc[0] !== undefined && typeof autoinc[0] === "number") {
        table.autoIncrementSeq = autoinc[0];
      }
    }
  }

  async createTable(schema: TableSchema): Promise<void> {
    if (this.tables.has(schema.name)) {
      throw new Error(`テーブル '${schema.name}' は既に存在します`);
    }
    this.tables.set(schema.name, schema);
    await this.saveTableSchema(schema);
  }

  async dropTable(name: string): Promise<void> {
    if (!this.tables.has(name)) {
      throw new Error(`テーブル '${name}' が見つかりません`);
    }
    this.tables.delete(name);
    await this.metaTree.delete([META_TABLE_PREFIX + name]);
    await this.metaTree.delete([META_AUTOINC_PREFIX + name]);

    // 関連インデックスも削除
    const toDelete: string[] = [];
    for (const [indexName, idx] of this.indexes) {
      if (idx.tableName === name) {
        toDelete.push(indexName);
      }
    }
    for (const indexName of toDelete) {
      this.indexes.delete(indexName);
      await this.metaTree.delete([META_INDEX_PREFIX + indexName]);
    }
  }

  async createIndex(schema: IndexSchema): Promise<void> {
    if (this.indexes.has(schema.name)) {
      throw new Error(`インデックス '${schema.name}' は既に存在します`);
    }
    this.indexes.set(schema.name, schema);
    await this.saveIndexSchema(schema);
  }

  getTable(name: string): TableSchema | undefined {
    return this.tables.get(name);
  }

  getTableOrThrow(name: string): TableSchema {
    const table = this.tables.get(name);
    if (table === undefined) {
      throw new Error(`テーブル '${name}' が見つかりません`);
    }
    return table;
  }

  getIndex(name: string): IndexSchema | undefined {
    return this.indexes.get(name);
  }

  getIndexesForTable(tableName: string): IndexSchema[] {
    const result: IndexSchema[] = [];
    for (const [, idx] of this.indexes) {
      if (idx.tableName === tableName) {
        result.push(idx);
      }
    }
    return result;
  }

  getAllTables(): TableSchema[] {
    return [...this.tables.values()];
  }

  getAllIndexes(): IndexSchema[] {
    return [...this.indexes.values()];
  }

  async updateAutoIncrement(tableName: string, seq: number): Promise<void> {
    const table = this.tables.get(tableName);
    if (table !== undefined) {
      table.autoIncrementSeq = seq;
    }
    await this.metaTree.insert([META_AUTOINC_PREFIX + tableName], [seq]);
  }

  getMetaRootPageId(): number {
    return this.metaTree.getRootPageId();
  }

  // === シリアライズ ===

  private async saveTableSchema(schema: TableSchema): Promise<void> {
    const value: SqlValue[] = [
      schema.name,
      schema.rootPage,
      schema.autoIncrementSeq,
      JSON.stringify(schema.columns),
    ];
    await this.metaTree.insert([META_TABLE_PREFIX + schema.name], value);
  }

  private async saveIndexSchema(schema: IndexSchema): Promise<void> {
    const value: SqlValue[] = [
      schema.name,
      schema.tableName,
      schema.rootPage,
      schema.unique ? 1 : 0,
      JSON.stringify(schema.columns),
    ];
    await this.metaTree.insert([META_INDEX_PREFIX + schema.name], value);
  }

  private deserializeTableSchema(values: SqlValue[]): TableSchema {
    const name = values[0];
    const rootPage = values[1];
    const autoIncrementSeq = values[2];
    const columnsJson = values[3];

    if (typeof name !== "string" || typeof rootPage !== "number" || typeof columnsJson !== "string") {
      throw new Error("不正なテーブルスキーマデータ");
    }

    return {
      name,
      rootPage,
      autoIncrementSeq: typeof autoIncrementSeq === "number" ? autoIncrementSeq : 0,
      columns: JSON.parse(columnsJson),
    };
  }

  private deserializeIndexSchema(values: SqlValue[]): IndexSchema {
    const name = values[0];
    const tableName = values[1];
    const rootPage = values[2];
    const unique = values[3];
    const columnsJson = values[4];

    if (typeof name !== "string" || typeof tableName !== "string" ||
        typeof rootPage !== "number" || typeof columnsJson !== "string") {
      throw new Error("不正なインデックススキーマデータ");
    }

    return {
      name,
      tableName,
      rootPage,
      unique: unique === 1,
      columns: JSON.parse(columnsJson),
    };
  }
}
