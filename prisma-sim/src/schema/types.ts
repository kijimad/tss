/** Prisma スキーマの AST 型定義 */

/** フィールドのスカラー型 */
export type ScalarType = "String" | "Int" | "Float" | "Boolean" | "DateTime";

/** フィールド型（スカラーまたはリレーション参照） */
export interface FieldType {
  /** 型名 */
  name: string;
  /** スカラー型かどうか */
  isScalar: boolean;
  /** リスト型かどうか（例: Post[]） */
  isList: boolean;
  /** オプショナルかどうか（例: String?） */
  isOptional: boolean;
}

/** アトリビュートの引数 */
export interface AttributeArg {
  /** 引数名（名前付きの場合） */
  name?: string;
  /** 引数値 */
  value: string;
}

/** フィールドに付与するアトリビュート（@id, @unique, @default, @relation） */
export interface Attribute {
  /** アトリビュート名（"id", "unique", "default", "relation"） */
  name: string;
  /** アトリビュートの引数リスト */
  args: AttributeArg[];
}

/** リレーション定義 */
export interface Relation {
  /** リレーション名 */
  name?: string;
  /** 参照先モデル名 */
  model: string;
  /** ローカルフィールド名リスト */
  fields?: string[];
  /** 参照先フィールド名リスト */
  references?: string[];
}

/** モデルのフィールド定義 */
export interface Field {
  /** フィールド名 */
  name: string;
  /** フィールド型 */
  type: FieldType;
  /** アトリビュートリスト */
  attributes: Attribute[];
  /** リレーション情報（存在する場合） */
  relation?: Relation;
}

/** モデル定義 */
export interface Model {
  /** モデル名 */
  name: string;
  /** フィールドリスト */
  fields: Field[];
}

/** パース済みスキーマ */
export interface Schema {
  /** モデルリスト */
  models: Model[];
}
