/** マイグレーションシステム: スキーマ差分の検出とマイグレーションステップの生成 */

import type { Schema, Field } from "../schema/types.js";
import type { DataStore } from "./store.js";

/** マイグレーションステップの種別 */
export type MigrationStepType = "CreateTable" | "DropTable" | "AddColumn" | "DropColumn" | "CreateIndex";

/** テーブル作成ステップ */
export interface CreateTableStep {
  type: "CreateTable";
  /** テーブル名 */
  tableName: string;
  /** フィールド一覧 */
  fields: Field[];
}

/** テーブル削除ステップ */
export interface DropTableStep {
  type: "DropTable";
  /** テーブル名 */
  tableName: string;
}

/** カラム追加ステップ */
export interface AddColumnStep {
  type: "AddColumn";
  /** テーブル名 */
  tableName: string;
  /** 追加するフィールド */
  field: Field;
}

/** カラム削除ステップ */
export interface DropColumnStep {
  type: "DropColumn";
  /** テーブル名 */
  tableName: string;
  /** 削除するフィールド名 */
  fieldName: string;
}

/** インデックス作成ステップ */
export interface CreateIndexStep {
  type: "CreateIndex";
  /** テーブル名 */
  tableName: string;
  /** インデックス名 */
  indexName: string;
  /** 対象フィールド名リスト */
  fields: string[];
  /** ユニークインデックスかどうか */
  unique: boolean;
}

/** マイグレーションステップの統合型 */
export type MigrationStep =
  | CreateTableStep
  | DropTableStep
  | AddColumnStep
  | DropColumnStep
  | CreateIndexStep;

/** マイグレーション定義 */
export interface Migration {
  /** マイグレーション名 */
  name: string;
  /** タイムスタンプ */
  timestamp: string;
  /** ステップリスト */
  steps: MigrationStep[];
}

/** 2つのスキーマを比較してマイグレーションステップを生成する */
export function diffSchemas(from: Schema, to: Schema): MigrationStep[] {
  const steps: MigrationStep[] = [];

  const fromModels = new Map(from.models.map((m) => [m.name, m]));
  const toModels = new Map(to.models.map((m) => [m.name, m]));

  /** 削除されたモデルの検出 */
  for (const [name] of fromModels) {
    if (!toModels.has(name)) {
      steps.push({ type: "DropTable", tableName: name });
    }
  }

  /** 追加されたモデルの検出 */
  for (const [name, model] of toModels) {
    if (!fromModels.has(name)) {
      steps.push({
        type: "CreateTable",
        tableName: name,
        fields: model.fields,
      });

      /** 新規テーブルのインデックスを追加 */
      for (const field of model.fields) {
        const hasUnique = field.attributes.some((a) => a.name === "unique");
        const hasId = field.attributes.some((a) => a.name === "id");
        if (hasUnique || hasId) {
          steps.push({
            type: "CreateIndex",
            tableName: name,
            indexName: `${name}_${field.name}_key`,
            fields: [field.name],
            unique: true,
          });
        }
      }
      continue;
    }

    /** 既存モデルのフィールド差分を検出 */
    const fromModel = fromModels.get(name)!;
    const fromFields = new Map(fromModel.fields.map((f) => [f.name, f]));
    const toFields = new Map(model.fields.map((f) => [f.name, f]));

    /** 削除されたフィールドの検出 */
    for (const [fieldName] of fromFields) {
      if (!toFields.has(fieldName)) {
        steps.push({ type: "DropColumn", tableName: name, fieldName });
      }
    }

    /** 追加されたフィールドの検出 */
    for (const [fieldName, field] of toFields) {
      if (!fromFields.has(fieldName)) {
        steps.push({ type: "AddColumn", tableName: name, field });

        /** 新規フィールドのインデックスを追加 */
        const hasUnique = field.attributes.some((a) => a.name === "unique");
        if (hasUnique) {
          steps.push({
            type: "CreateIndex",
            tableName: name,
            indexName: `${name}_${fieldName}_key`,
            fields: [fieldName],
            unique: true,
          });
        }
      }
    }
  }

  return steps;
}

/** マイグレーションステップをデータストアに適用する */
export function applyMigration(store: DataStore, steps: MigrationStep[]): void {
  for (const step of steps) {
    switch (step.type) {
      case "CreateTable":
        if (!store.hasTable(step.tableName)) {
          store.createTable({
            name: step.tableName,
            fields: step.fields,
          });
        }
        break;

      case "DropTable":
        store.dropTable(step.tableName);
        break;

      case "AddColumn":
        store.addColumn(step.tableName, step.field);
        break;

      case "DropColumn":
        store.dropColumn(step.tableName, step.fieldName);
        break;

      case "CreateIndex":
        store.addIndex(step.tableName, {
          name: step.indexName,
          fields: step.fields,
          unique: step.unique,
        });
        break;
    }
  }
}

/** マイグレーションを作成する */
export function createMigration(
  name: string,
  from: Schema,
  to: Schema,
): Migration {
  return {
    name,
    timestamp: new Date().toISOString(),
    steps: diffSchemas(from, to),
  };
}
