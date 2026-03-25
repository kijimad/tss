/**
 * types.ts — データベースエンジン全体で共有される型定義
 *
 * 設計方針:
 * - 全ASTノードは discriminated union（`type` フィールドで判別）
 *   → switch/if で自動ナローイングでき、`as` によるキャストが不要
 * - SqlValue は SQL の値を TypeScript の型で表現したもの
 *   → NULL=null, INTEGER/REAL=number, TEXT=string, BLOB=Uint8Array
 */

// === SQL値型 ===
// SQLが扱える4つのデータ型 + NULL を TypeScript で表現する
export type SqlValue = string | number | Uint8Array | null;

// === ページ型 ===
// SQLite と同様に 4KB 固定長のページを採用。
// ディスク I/O の単位であり、B+Tree のノードの物理的な表現。
export const PAGE_SIZE = 4096;

// ページヘッダは 12 バイト固定:
//   [0..1]  pageType       (u16) — ページの種類
//   [2..3]  cellCount      (u16) — 格納されているセルの数
//   [4..7]  rightChild     (u32) — Interior:最右子ページ / Leaf:次のリーフページ
//   [8..9]  freeSpaceStart (u16) — 空き領域の開始位置（セルポインタ末尾）
//   [10..11] freeSpaceEnd  (u16) — 空き領域の終了位置（セルデータ先頭）
export const PAGE_HEADER_SIZE = 12;

export const PageType = {
  Interior: 0x01,  // 内部ノード（子ページへのポインタを持つ）
  Leaf: 0x02,      // リーフノード（実データを持つ）
  Meta: 0x03,      // メタデータページ（将来拡張用、現在は Leaf と同じ構造で代用）
} as const;
export type PageType = (typeof PageType)[keyof typeof PageType];

// === 値タグ ===
// 値をバイナリにシリアライズする際の先頭1バイトで型を識別する。
// タグの後にデータ本体が続く（NULLはタグのみ、INTEGER/REALは8バイトのf64）
export const ValueTag = {
  Null: 0x00,
  Integer: 0x01,   // タグ(1) + float64(8) = 9バイト
  Text: 0x02,      // タグ(1) + 長さ(u32, 4) + UTF-8バイト列
  Real: 0x03,      // タグ(1) + float64(8) = 9バイト
  Blob: 0x04,      // タグ(1) + 長さ(u32, 4) + バイト列
} as const;

// === カラム型 ===
// CREATE TABLE のカラム定義で使える型
export const ColumnType = {
  Integer: "INTEGER",
  Text: "TEXT",
  Real: "REAL",
  Blob: "BLOB",
} as const;
export type ColumnType = (typeof ColumnType)[keyof typeof ColumnType];

// === カラム定義 ===
// CREATE TABLE で定義される各カラムの情報
export interface ColumnDef {
  name: string;
  type: ColumnType;
  primaryKey?: boolean;      // このカラムが主キーか
  notNull?: boolean;         // NOT NULL 制約
  autoIncrement?: boolean;   // AUTOINCREMENT（主キーと組み合わせて使用）
}

// === テーブルスキーマ ===
// テーブルのメタデータ。データ本体は rootPage を起点とする B+Tree に格納される。
export interface TableSchema {
  name: string;
  columns: ColumnDef[];
  rootPage: number;          // テーブルデータを格納する B+Tree のルートページID
  autoIncrementSeq: number;  // 次に払い出す AUTOINCREMENT の値
}

// === インデックススキーマ ===
// セカンダリインデックスのメタデータ。
// インデックスの B+Tree は「インデックスキー → 主キー」のマッピング。
export interface IndexSchema {
  name: string;
  tableName: string;       // 対象テーブル名
  columns: string[];       // インデックス対象カラム（複合インデックス対応）
  rootPage: number;        // インデックス B+Tree のルートページID
  unique: boolean;         // UNIQUE制約
}

// === AST ノード定義 (discriminated union) ===
// パーサーが生成する抽象構文木。`type` フィールドで判別することで、
// TypeScript のナローイングが効き、`as` キャストを使わずに型安全にアクセスできる。

// 式（WHERE句、SELECT句、ORDER BY 等で使われる）
export type Expr =
  | { type: "literal"; value: SqlValue }                                        // リテラル値: 42, 'hello', NULL
  | { type: "column_ref"; table?: string; column: string }                      // カラム参照: name, users.name
  | { type: "binary_op"; op: BinaryOp; left: Expr; right: Expr }               // 二項演算: a + b, x = 1, a AND b
  | { type: "unary_op"; op: UnaryOp; operand: Expr }                           // 単項演算: NOT x, -y
  | { type: "function_call"; name: string; args: Expr[]; distinct?: boolean }   // 関数呼び出し: COUNT(*), SUM(DISTINCT x)
  | { type: "between"; expr: Expr; low: Expr; high: Expr; not?: boolean }       // BETWEEN: x BETWEEN 1 AND 10
  | { type: "in_list"; expr: Expr; values: Expr[]; not?: boolean }              // IN リスト: x IN (1, 2, 3)
  | { type: "in_subquery"; expr: Expr; query: SelectStmt; not?: boolean }       // IN サブクエリ: x IN (SELECT ...)
  | { type: "is_null"; expr: Expr; not?: boolean }                              // IS NULL / IS NOT NULL
  | { type: "like"; expr: Expr; pattern: Expr; not?: boolean }                  // LIKE: name LIKE '%test%'
  | { type: "subquery"; query: SelectStmt }                                     // スカラーサブクエリ: (SELECT ...)
  | { type: "wildcard"; table?: string }                                        // ワイルドカード: *, table.*
  | { type: "exists"; query: SelectStmt; not?: boolean };                       // EXISTS (SELECT ...)

// 二項演算子（優先順位は parser で制御）
export type BinaryOp =
  | "=" | "!=" | "<" | ">" | "<=" | ">="   // 比較
  | "+" | "-" | "*" | "/" | "%"             // 算術
  | "AND" | "OR" | "||";                   // 論理・文字列連結

export type UnaryOp = "NOT" | "-";

// SELECT句の各カラム（式 + オプショナルなエイリアス）
export interface SelectColumn {
  expr: Expr;
  alias?: string;   // AS で指定されたエイリアス名
}

// FROM句（テーブル参照・JOIN・サブクエリを再帰的に表現）
export type FromClause =
  | { type: "table"; name: string; alias?: string }
  | { type: "join"; left: FromClause; right: FromClause; joinType: JoinType; on: Expr }
  | { type: "subquery"; query: SelectStmt; alias: string };

export type JoinType = "INNER" | "LEFT";

// ORDER BY の各要素
export interface OrderByItem {
  expr: Expr;
  direction: "ASC" | "DESC";
}

// === SQL文の AST ===
// 各文は `type` フィールドで判別される discriminated union

export interface SelectStmt {
  type: "select";
  columns: SelectColumn[];
  from?: FromClause;       // FROM なしの場合: SELECT 1+1
  where?: Expr;
  groupBy?: Expr[];
  having?: Expr;
  orderBy?: OrderByItem[];
  limit?: Expr;
  offset?: Expr;
  distinct?: boolean;
}

export interface InsertStmt {
  type: "insert";
  table: string;
  columns?: string[];      // カラム指定がない場合はテーブル定義順
  values: Expr[][];        // 複数行の VALUES をサポート
}

export interface UpdateStmt {
  type: "update";
  table: string;
  set: { column: string; value: Expr }[];
  where?: Expr;
}

export interface DeleteStmt {
  type: "delete";
  table: string;
  where?: Expr;
}

export interface CreateTableStmt {
  type: "create_table";
  name: string;
  columns: ColumnDef[];
  ifNotExists?: boolean;
}

export interface CreateIndexStmt {
  type: "create_index";
  name: string;
  table: string;
  columns: string[];
  unique?: boolean;
  ifNotExists?: boolean;
}

export interface DropTableStmt {
  type: "drop_table";
  name: string;
  ifExists?: boolean;
}

// 全SQL文を包含する union 型
export type Stmt =
  | SelectStmt
  | InsertStmt
  | UpdateStmt
  | DeleteStmt
  | CreateTableStmt
  | CreateIndexStmt
  | DropTableStmt;

// === 実行結果 ===
export interface QueryResult {
  columns: string[];       // 結果カラム名（SELECT のみ）
  rows: SqlValue[][];      // 結果行（SELECT のみ）
  rowsAffected: number;    // 影響行数（INSERT/UPDATE/DELETE）
}

// === ストレージインターフェース ===
// ページの永続化先を抽象化する。
// IndexedDB 実装（ブラウザ永続化用）とインメモリ実装（テスト用）を差し替え可能。
export interface PageStore {
  readPage(pageId: number): Promise<ArrayBuffer | undefined>;
  writePage(pageId: number, data: ArrayBuffer): Promise<void>;
  getMaxPageId(): Promise<number>;
  close(): Promise<void>;
}

// === B+Tree用型 ===
// B+Tree のリーフノードに格納されるセルデータ
export interface CellData {
  key: SqlValue[];     // 検索・ソートに使うキー（主キーやインデックスキー）
  value: SqlValue[];   // 実データ（テーブルの全カラム値、またはインデックスの主キー参照）
}
