/** クエリエンジン: Prisma 風のクエリ API を提供 */

import type { Schema } from "../schema/types.js";
import { DataStore, RecordNotFoundError, type Row } from "./store.js";

/** Where フィルター条件 */
export interface WhereFilter {
  [field: string]: unknown | WhereCondition;
}

/** 詳細なフィルター条件 */
export interface WhereCondition {
  equals?: unknown;
  not?: unknown;
  contains?: string;
  startsWith?: string;
  gt?: number;
  gte?: number;
  lt?: number;
  lte?: number;
  in?: unknown[];
}

/** ソート順序 */
export type OrderByDirection = "asc" | "desc";
export type OrderBy = Record<string, OrderByDirection>;

/** findMany のオプション */
export interface FindManyArgs {
  where?: WhereFilter;
  orderBy?: OrderBy;
  include?: Record<string, boolean | FindManyArgs>;
  select?: Record<string, boolean>;
  take?: number;
  skip?: number;
}

/** findUnique のオプション */
export interface FindUniqueArgs {
  where: WhereFilter;
  include?: Record<string, boolean | FindManyArgs>;
  select?: Record<string, boolean>;
}

/** create のオプション */
export interface CreateArgs {
  data: Row;
  include?: Record<string, boolean | FindManyArgs>;
}

/** update のオプション */
export interface UpdateArgs {
  where: WhereFilter;
  data: Row;
}

/** delete のオプション */
export interface DeleteArgs {
  where: WhereFilter;
}

/** Where 条件かどうかを判定する */
function isWhereCondition(value: unknown): value is WhereCondition {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  const conditionKeys = new Set(["equals", "not", "contains", "startsWith", "gt", "gte", "lt", "lte", "in"]);
  return keys.some((k) => conditionKeys.has(k));
}

/** 単一の行が where 条件にマッチするかチェック */
function matchesWhereFilter(row: Row, where: WhereFilter): boolean {
  for (const [field, condition] of Object.entries(where)) {
    const value = row[field];

    if (isWhereCondition(condition)) {
      if (!matchesCondition(value, condition)) return false;
    } else {
      /** 値の直接比較 */
      if (value !== condition) return false;
    }
  }
  return true;
}

/** 詳細フィルター条件にマッチするかチェック */
function matchesCondition(value: unknown, condition: WhereCondition): boolean {
  if (condition.equals !== undefined && value !== condition.equals) return false;
  if (condition.not !== undefined && value === condition.not) return false;

  if (condition.contains !== undefined) {
    if (typeof value !== "string" || !value.includes(condition.contains)) return false;
  }

  if (condition.startsWith !== undefined) {
    if (typeof value !== "string" || !value.startsWith(condition.startsWith)) return false;
  }

  if (condition.gt !== undefined) {
    if (typeof value !== "number" || value <= condition.gt) return false;
  }

  if (condition.gte !== undefined) {
    if (typeof value !== "number" || value < condition.gte) return false;
  }

  if (condition.lt !== undefined) {
    if (typeof value !== "number" || value >= condition.lt) return false;
  }

  if (condition.lte !== undefined) {
    if (typeof value !== "number" || value > condition.lte) return false;
  }

  if (condition.in !== undefined) {
    if (!condition.in.includes(value)) return false;
  }

  return true;
}

/** 行をソートする */
function sortRows(rows: Row[], orderBy: OrderBy): Row[] {
  const entries = Object.entries(orderBy);
  return [...rows].sort((a, b) => {
    for (const [field, direction] of entries) {
      const aVal = a[field];
      const bVal = b[field];

      let cmp = 0;
      if (typeof aVal === "string" && typeof bVal === "string") {
        cmp = aVal.localeCompare(bVal);
      } else if (typeof aVal === "number" && typeof bVal === "number") {
        cmp = aVal - bVal;
      } else if (aVal == null && bVal != null) {
        cmp = -1;
      } else if (aVal != null && bVal == null) {
        cmp = 1;
      }

      if (cmp !== 0) return direction === "desc" ? -cmp : cmp;
    }
    return 0;
  });
}

/** select を適用して必要なフィールドのみ返す */
function applySelect(row: Row, select: Record<string, boolean>): Row {
  const result: Row = {};
  for (const [key, included] of Object.entries(select)) {
    if (included) {
      result[key] = row[key];
    }
  }
  return result;
}

/** クエリエンジン */
export class QueryEngine {
  private store: DataStore;
  private schema: Schema;

  constructor(schema: Schema) {
    this.schema = schema;
    this.store = new DataStore();
    this.store.initFromSchema(schema);
  }

  /** 内部データストアを取得する */
  getStore(): DataStore {
    return this.store;
  }

  /** findMany: 複数レコードを検索 */
  findMany(modelName: string, args?: FindManyArgs): Row[] {
    let rows = this.store.findAll(modelName);

    /** where フィルターの適用 */
    if (args?.where) {
      const where = args.where;
      rows = rows.filter((row) => matchesWhereFilter(row, where));
    }

    /** orderBy の適用 */
    if (args?.orderBy) {
      rows = sortRows(rows, args.orderBy);
    }

    /** skip の適用 */
    if (args?.skip !== undefined) {
      rows = rows.slice(args.skip);
    }

    /** take の適用 */
    if (args?.take !== undefined) {
      rows = rows.slice(0, args.take);
    }

    /** include（リレーション）の適用 */
    if (args?.include) {
      rows = rows.map((row) => this.applyInclude(modelName, row, args.include!));
    }

    /** select の適用 */
    if (args?.select) {
      rows = rows.map((row) => applySelect(row, args.select!));
    }

    return rows;
  }

  /** findUnique: ユニーク条件で1件検索 */
  findUnique(modelName: string, args: FindUniqueArgs): Row | null {
    const rows = this.store.findAll(modelName);
    const found = rows.find((row) => matchesWhereFilter(row, args.where)) ?? null;

    if (!found) return null;

    let result = { ...found };

    /** include の適用 */
    if (args.include) {
      result = this.applyInclude(modelName, result, args.include);
    }

    /** select の適用 */
    if (args.select) {
      result = applySelect(result, args.select);
    }

    return result;
  }

  /** create: レコードを作成 */
  create(modelName: string, args: CreateArgs): Row {
    let row = this.store.insert(modelName, args.data);

    /** include の適用 */
    if (args.include) {
      row = this.applyInclude(modelName, row, args.include);
    }

    return row;
  }

  /** update: レコードを更新 */
  update(modelName: string, args: UpdateArgs): Row {
    return this.store.updateWhere(modelName, args.where as Row, args.data);
  }

  /** delete: レコードを削除 */
  delete(modelName: string, args: DeleteArgs): Row {
    return this.store.deleteWhere(modelName, args.where as Row);
  }

  /** リレーションを解決して結果に含める */
  private applyInclude(
    modelName: string,
    row: Row,
    include: Record<string, boolean | FindManyArgs>,
  ): Row {
    const result: Row = { ...row };
    const model = this.schema.models.find((m) => m.name === modelName);
    if (!model) return result;

    for (const [fieldName, includeArgs] of Object.entries(include)) {
      if (!includeArgs) continue;

      const field = model.fields.find((f) => f.name === fieldName);
      if (!field?.relation) continue;

      const relatedModel = field.relation.model;

      if (field.type.isList) {
        /** 1:N リレーション: 関連レコードを全件取得 */
        const relatedModelDef = this.schema.models.find((m) => m.name === relatedModel);
        const backRef = relatedModelDef?.fields.find(
          (f) => f.relation?.model === modelName && f.relation?.fields?.length,
        );
        const foreignKey = backRef?.relation?.fields?.[0];
        const localKey = backRef?.relation?.references?.[0] ?? "id";

        if (foreignKey) {
          const findArgs: FindManyArgs = typeof includeArgs === "object" ? includeArgs : {};
          const allRelated = this.store.findAll(relatedModel);
          let related = allRelated.filter((r) => r[foreignKey] === row[localKey]);

          /** ネストされた where/orderBy の適用 */
          if (findArgs.where) {
            const where = findArgs.where;
            related = related.filter((r) => matchesWhereFilter(r, where));
          }
          if (findArgs.orderBy) {
            related = sortRows(related, findArgs.orderBy);
          }

          result[fieldName] = related;
        } else {
          result[fieldName] = [];
        }
      } else {
        /** 1:1 リレーション: 関連レコードを1件取得 */
        const foreignKey = field.relation.fields?.[0];
        const refKey = field.relation.references?.[0] ?? "id";

        if (foreignKey) {
          const fkValue = row[foreignKey];
          const allRelated = this.store.findAll(relatedModel);
          result[fieldName] = allRelated.find((r) => r[refKey] === fkValue) ?? null;
        } else {
          result[fieldName] = null;
        }
      }
    }

    return result;
  }
}

export { RecordNotFoundError } from "./store.js";
export { UniqueConstraintError } from "./store.js";
