/* SQLインジェクション シミュレーター 型定義 */

// ─── データベース ───

/** カラム型 */
export type ColumnType = "integer" | "text" | "boolean";

/** カラム定義 */
export interface ColumnDef {
  name: string;
  type: ColumnType;
  primaryKey?: boolean;
}

/** テーブル定義 */
export interface TableDef {
  name: string;
  columns: ColumnDef[];
}

/** 行データ */
export type Row = Record<string, string | number | boolean | null>;

/** テーブルデータ */
export interface TableData {
  def: TableDef;
  rows: Row[];
}

/** データベース */
export interface Database {
  tables: Record<string, TableData>;
}

// ─── SQL ───

/** SQL文の種別 */
export type SqlStatementType = "SELECT" | "INSERT" | "UPDATE" | "DELETE" | "DROP" | "UNION" | "UNKNOWN";

/** パースされたSQL */
export interface ParsedSql {
  type: SqlStatementType;
  raw: string;
  /** テーブル名 */
  table?: string;
  /** WHERE条件（生の文字列） */
  where?: string;
  /** SELECT対象カラム */
  columns?: string[];
  /** UNION SELECT がある場合 */
  hasUnion?: boolean;
  /** スタックドクエリ（;で区切られた追加SQL） */
  stacked?: string[];
  /** 構文エラー */
  error?: string;
}

/** クエリ実行結果 */
export interface QueryResult {
  /** 成功したか */
  success: boolean;
  /** 結果行 */
  rows: Row[];
  /** 影響を受けた行数 */
  affectedRows: number;
  /** エラーメッセージ */
  error?: string;
  /** 実行されたSQL文（デバッグ用） */
  executedSql: string;
}

// ─── SQLインジェクション ───

/** インジェクション種別 */
export type InjectionType =
  | "classic"        // クラシック（WHERE条件操作）
  | "union_based"    // UNION SELECT による情報漏洩
  | "blind_boolean"  // ブラインド（真偽値ベース）
  | "blind_time"     // ブラインド（時間ベース）
  | "error_based"    // エラーベース（エラーメッセージから情報取得）
  | "stacked"        // スタックドクエリ（;で複数SQL実行）
  | "second_order";  // セカンドオーダー（保存後に発動）

/** 入力パラメータの構築方法 */
export type InputMethod =
  | "url_param"       // URLパラメータ (?id=1)
  | "form_post"       // POSTフォーム
  | "cookie"          // Cookie値
  | "http_header";    // HTTPヘッダ

// ─── 防御 ───

/** 防御設定 */
export interface Defense {
  /** パラメータ化クエリ（プリペアドステートメント） */
  parameterized: boolean;
  /** 入力値エスケープ */
  escaping: boolean;
  /** 入力バリデーション（型チェック） */
  inputValidation: boolean;
  /** WAF（Webアプリケーションファイアウォール） */
  waf: boolean;
  /** ホワイトリスト方式 */
  whitelist: boolean;
  /** エラーメッセージを非表示にする */
  hideErrors: boolean;
  /** 最小権限の原則（DROP/DELETE不可） */
  leastPrivilege: boolean;
}

// ─── シミュレーション ───

/** シミュレーションステップ */
export interface SimStep {
  phase: string;
  actor: string;
  message: string;
  detail?: string;
  success: boolean;
}

/** 攻撃結果 */
export interface AttackResult {
  injectionType: InjectionType;
  inputMethod: InputMethod;
  /** 元のクエリテンプレート */
  queryTemplate: string;
  /** ユーザー入力（攻撃ペイロード） */
  userInput: string;
  /** 構築されたSQL */
  constructedSql: string;
  /** パラメータ化時のSQL */
  parameterizedSql?: string;
  /** クエリ実行結果 */
  queryResult: QueryResult;
  /** 攻撃成功したか */
  injectionSucceeded: boolean;
  /** データ漏洩したか */
  dataLeaked: boolean;
  /** データ改ざん/破壊されたか */
  dataModified: boolean;
  /** 認証バイパスしたか */
  authBypassed: boolean;
  /** 防御によりブロックされた理由 */
  blocked: string[];
  /** シミュレーションステップ */
  steps: SimStep[];
  /** 防御勧告 */
  mitigations: string[];
}

/** シミュレーション操作 */
export interface SimOp {
  type: "attack";
  injectionType: InjectionType;
  inputMethod: InputMethod;
  /** クエリテンプレート（${input} がユーザー入力に置換される） */
  queryTemplate: string;
  /** 攻撃ペイロード */
  payload: string;
  /** 防御設定 */
  defense: Defense;
  /** 正常な入力値（比較用） */
  legitimateInput?: string;
}

/** イベント種別 */
export type EventType =
  | "input" | "parse" | "execute" | "defense" | "block"
  | "leak" | "modify" | "bypass" | "info" | "warn" | "error";

/** シミュレーションイベント */
export interface SimEvent {
  type: EventType;
  actor: string;
  message: string;
  detail?: string;
}

/** シミュレーション結果 */
export interface SimulationResult {
  results: AttackResult[];
  events: SimEvent[];
}

/** プリセット */
export interface Preset {
  name: string;
  description: string;
  build: () => SimOp[];
}
