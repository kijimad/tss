/** インメモリデータストア */

import type { Schema, Model, Field } from "../schema/types.js";

/** 行データの型 */
export type Row = Record<string, unknown>;

/** テーブルのインデックス定義 */
interface TableIndex {
  /** インデックス名 */
  name: string;
  /** 対象フィールド名リスト */
  fields: string[];
  /** ユニークインデックスかどうか */
  unique: boolean;
}

/** テーブル定義 */
interface Table {
  /** モデル名 */
  modelName: string;
  /** フィールド定義 */
  fields: Field[];
  /** 行データリスト */
  rows: Row[];
  /** インデックスリスト */
  indexes: TableIndex[];
  /** オートインクリメントカウンター */
  autoIncrementCounters: Map<string, number>;
}

/** ユニーク制約違反エラー */
export class UniqueConstraintError extends Error {
  constructor(public readonly field: string, public readonly value: unknown) {
    super(`ユニーク制約違反: フィールド "${field}" の値 "${String(value)}" は既に存在します`);
    this.name = "UniqueConstraintError";
  }
}

/** レコード未検出エラー */
export class RecordNotFoundError extends Error {
  constructor(public readonly model: string) {
    super(`レコードが見つかりません: モデル "${model}"`);
    this.name = "RecordNotFoundError";
  }
}

/** インメモリデータストア */
export class DataStore {
  /** テーブルマップ */
  private tables = new Map<string, Table>();

  /** スキーマからテーブルを初期化する */
  initFromSchema(schema: Schema): void {
    for (const model of schema.models) {
      this.createTable(model);
    }
  }

  /** モデルからテーブルを作成する */
  createTable(model: Model): void {
    const indexes: TableIndex[] = [];
    const autoIncrementCounters = new Map<string, number>();

    for (const field of model.fields) {
      /** @unique アトリビュートがあればユニークインデックスを追加 */
      const hasUnique = field.attributes.some((a) => a.name === "unique");
      const hasId = field.attributes.some((a) => a.name === "id");

      if (hasUnique || hasId) {
        indexes.push({
          name: `${model.name}_${field.name}_key`,
          fields: [field.name],
          unique: true,
        });
      }

      /** @default(autoincrement()) のフィールドにカウンターを設定 */
      const defaultAttr = field.attributes.find((a) => a.name === "default");
      if (defaultAttr?.args[0]?.value === "autoincrement()") {
        autoIncrementCounters.set(field.name, 0);
      }
    }

    this.tables.set(model.name, {
      modelName: model.name,
      fields: model.fields,
      rows: [],
      indexes,
      autoIncrementCounters,
    });
  }

  /** テーブルにカラムを追加する */
  addColumn(modelName: string, field: Field): void {
    const table = this.tables.get(modelName);
    if (!table) return;
    table.fields.push(field);
  }

  /** テーブルからカラムを削除する */
  dropColumn(modelName: string, fieldName: string): void {
    const table = this.tables.get(modelName);
    if (!table) return;
    table.fields = table.fields.filter((f) => f.name !== fieldName);
    /** 既存行から該当フィールドを削除 */
    for (const row of table.rows) {
      delete row[fieldName];
    }
  }

  /** テーブルにインデックスを追加する */
  addIndex(modelName: string, index: TableIndex): void {
    const table = this.tables.get(modelName);
    if (!table) return;
    table.indexes.push(index);
  }

  /** テーブルを削除する */
  dropTable(modelName: string): void {
    this.tables.delete(modelName);
  }

  /** テーブルが存在するかどうか */
  hasTable(modelName: string): boolean {
    return this.tables.has(modelName);
  }

  /** テーブルのフィールド一覧を返す */
  getFields(modelName: string): Field[] {
    return this.tables.get(modelName)?.fields ?? [];
  }

  /** デフォルト値を適用してレコードを挿入する */
  insert(modelName: string, data: Row): Row {
    const table = this.tables.get(modelName);
    if (!table) throw new Error(`テーブル "${modelName}" が存在しません`);

    const row: Row = { ...data };

    /** デフォルト値の適用 */
    for (const field of table.fields) {
      if (row[field.name] !== undefined) continue;

      const defaultAttr = field.attributes.find((a) => a.name === "default");
      if (!defaultAttr) continue;

      const defaultValue = defaultAttr.args[0]?.value;
      if (defaultValue === "autoincrement()") {
        const counter = (table.autoIncrementCounters.get(field.name) ?? 0) + 1;
        table.autoIncrementCounters.set(field.name, counter);
        row[field.name] = counter;
      } else if (defaultValue === "now()") {
        row[field.name] = new Date().toISOString();
      } else if (defaultValue !== undefined) {
        /** リテラル値のデフォルト */
        row[field.name] = parseLiteralValue(defaultValue);
      }
    }

    /** ユニーク制約のチェック */
    this.checkUniqueConstraints(table, row);

    table.rows.push(row);
    return row;
  }

  /** 全行を返す */
  findAll(modelName: string): Row[] {
    const table = this.tables.get(modelName);
    if (!table) throw new Error(`テーブル "${modelName}" が存在しません`);
    return [...table.rows];
  }

  /** 条件に一致するレコードを更新する */
  updateWhere(modelName: string, where: Row, data: Row): Row {
    const table = this.tables.get(modelName);
    if (!table) throw new Error(`テーブル "${modelName}" が存在しません`);

    const idx = table.rows.findIndex((row) => matchesWhere(row, where));
    if (idx === -1) throw new RecordNotFoundError(modelName);

    const existing = table.rows[idx]!;
    const updated = { ...existing, ...data };

    /** ユニーク制約のチェック（自身を除外） */
    this.checkUniqueConstraints(table, updated, idx);

    table.rows[idx] = updated;
    return updated;
  }

  /** 条件に一致するレコードを削除する */
  deleteWhere(modelName: string, where: Row): Row {
    const table = this.tables.get(modelName);
    if (!table) throw new Error(`テーブル "${modelName}" が存在しません`);

    const idx = table.rows.findIndex((row) => matchesWhere(row, where));
    if (idx === -1) throw new RecordNotFoundError(modelName);

    const deleted = table.rows.splice(idx, 1)[0]!;
    return deleted;
  }

  /** ユニーク制約をチェックする */
  private checkUniqueConstraints(table: Table, row: Row, excludeIdx?: number): void {
    for (const index of table.indexes) {
      if (!index.unique) continue;

      for (let i = 0; i < table.rows.length; i++) {
        if (i === excludeIdx) continue;
        const existing = table.rows[i]!;

        const allMatch = index.fields.every((f) => existing[f] === row[f]);
        if (allMatch && index.fields.some((f) => row[f] !== undefined)) {
          throw new UniqueConstraintError(index.fields.join(", "), index.fields.map((f) => row[f]).join(", "));
        }
      }
    }
  }
}

/** 単純なwhere条件でマッチするかチェック */
function matchesWhere(row: Row, where: Row): boolean {
  for (const [key, value] of Object.entries(where)) {
    if (row[key] !== value) return false;
  }
  return true;
}

/** リテラル値をパースする */
function parseLiteralValue(value: string): unknown {
  if (value === "true") return true;
  if (value === "false") return false;
  const num = Number(value);
  if (!isNaN(num) && value !== "") return num;
  return value.replace(/^"(.*)"$/, "$1");
}
