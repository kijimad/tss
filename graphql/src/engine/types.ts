/* ===== GraphQL シミュレーター 型定義 ===== */

/* ---------- トークン ---------- */

export type TokenKind =
  | 'Name' | 'Int' | 'Float' | 'String' | 'Boolean'
  | 'BraceL' | 'BraceR' | 'ParenL' | 'ParenR'
  | 'BracketL' | 'BracketR'
  | 'Colon' | 'Bang' | 'Dollar' | 'At' | 'Spread' | 'Eq' | 'Pipe'
  | 'EOF';

export interface Token {
  kind: TokenKind;
  value: string;
  line: number;
  col: number;
}

/* ---------- AST ---------- */

export type ASTNode =
  | DocumentNode
  | OperationNode
  | FieldNode
  | ArgumentNode
  | FragmentDefNode
  | FragmentSpreadNode
  | InlineFragmentNode
  | VariableDefNode
  | DirectiveNode;

export interface DocumentNode {
  kind: 'Document';
  definitions: (OperationNode | FragmentDefNode)[];
}

export interface OperationNode {
  kind: 'Operation';
  operation: 'query' | 'mutation' | 'subscription';
  name?: string;
  variableDefs: VariableDefNode[];
  directives: DirectiveNode[];
  selectionSet: SelectionNode[];
}

export type SelectionNode = FieldNode | FragmentSpreadNode | InlineFragmentNode;

export interface FieldNode {
  kind: 'Field';
  alias?: string;
  name: string;
  arguments: ArgumentNode[];
  directives: DirectiveNode[];
  selectionSet: SelectionNode[];
}

export interface ArgumentNode {
  kind: 'Argument';
  name: string;
  value: GQLValue;
}

export interface FragmentDefNode {
  kind: 'FragmentDef';
  name: string;
  typeCondition: string;
  selectionSet: SelectionNode[];
}

export interface FragmentSpreadNode {
  kind: 'FragmentSpread';
  name: string;
  directives: DirectiveNode[];
}

export interface InlineFragmentNode {
  kind: 'InlineFragment';
  typeCondition?: string;
  selectionSet: SelectionNode[];
}

export interface VariableDefNode {
  kind: 'VariableDef';
  name: string;
  typeName: string;
  nullable: boolean;
  defaultValue?: GQLValue;
}

export interface DirectiveNode {
  kind: 'Directive';
  name: string;
  arguments: ArgumentNode[];
}

/* ---------- 値 ---------- */

export type GQLValue =
  | { kind: 'IntValue'; value: number }
  | { kind: 'FloatValue'; value: number }
  | { kind: 'StringValue'; value: string }
  | { kind: 'BooleanValue'; value: boolean }
  | { kind: 'NullValue' }
  | { kind: 'EnumValue'; value: string }
  | { kind: 'ListValue'; values: GQLValue[] }
  | { kind: 'ObjectValue'; fields: { name: string; value: GQLValue }[] }
  | { kind: 'Variable'; name: string };

/* ---------- スキーマ ---------- */

export type GQLTypeDef =
  | ObjectTypeDef
  | ScalarTypeDef
  | EnumTypeDef
  | InterfaceTypeDef
  | UnionTypeDef
  | InputObjectTypeDef;

export interface ObjectTypeDef {
  kind: 'ObjectType';
  name: string;
  interfaces: string[];
  fields: FieldDef[];
}

export interface ScalarTypeDef {
  kind: 'ScalarType';
  name: string;
}

export interface EnumTypeDef {
  kind: 'EnumType';
  name: string;
  values: string[];
}

export interface InterfaceTypeDef {
  kind: 'InterfaceType';
  name: string;
  fields: FieldDef[];
}

export interface UnionTypeDef {
  kind: 'UnionType';
  name: string;
  types: string[];
}

export interface InputObjectTypeDef {
  kind: 'InputObjectType';
  name: string;
  fields: InputFieldDef[];
}

export interface FieldDef {
  name: string;
  type: TypeRef;
  args: InputFieldDef[];
}

export interface InputFieldDef {
  name: string;
  type: TypeRef;
  defaultValue?: GQLValue;
}

/** 型参照 (NonNull, List, Named の再帰構造) */
export type TypeRef =
  | { kind: 'Named'; name: string }
  | { kind: 'NonNull'; inner: TypeRef }
  | { kind: 'List'; inner: TypeRef };

/* ---------- スキーマ全体 ---------- */

export interface GQLSchema {
  types: Map<string, GQLTypeDef>;
  queryType: string;
  mutationType?: string;
}

/* ---------- リゾルバ ---------- */

/** フィールドリゾルバ: (parent, args, context) => 値 */
export type ResolverFn = (
  parent: Record<string, unknown>,
  args: Record<string, unknown>,
  context: ResolverContext,
) => unknown;

export interface ResolverContext {
  /** データストア（シミュレーション用） */
  store: Record<string, unknown[]>;
  /** 変数値 */
  variables: Record<string, unknown>;
}

/** 型ごとのリゾルバマップ */
export type ResolverMap = Record<string, Record<string, ResolverFn>>;

/* ---------- 実行トレース ---------- */

export type EventType =
  | 'lex'         // 字句解析
  | 'parse'       // 構文解析
  | 'validate'    // バリデーション
  | 'execute'     // 実行開始
  | 'resolve'     // フィールド解決
  | 'resolve_list'// リスト展開
  | 'coerce'      // 型強制
  | 'directive'   // ディレクティブ処理
  | 'fragment'    // フラグメント展開
  | 'variable'    // 変数解決
  | 'error'       // エラー
  | 'n_plus_one'  // N+1問題検出
  | 'introspect'; // イントロスペクション

export type Severity = 'info' | 'detail' | 'warn' | 'error';

export interface GQLEvent {
  type: EventType;
  severity: Severity;
  message: string;
  /** リゾルバパス (例: "Query.user.posts") */
  path?: string;
  /** 深度 */
  depth?: number;
}

/** 実行ステップのスナップショット */
export interface StepSnapshot {
  step: number;
  phase: 'lex' | 'parse' | 'validate' | 'execute';
  events: GQLEvent[];
  /** 現時点の部分結果 (execute フェーズのみ) */
  partialResult?: unknown;
  message: string;
}

/** シミュレーション結果 */
export interface GQLSimResult {
  steps: StepSnapshot[];
  /** トークン列 */
  tokens: Token[];
  /** AST */
  ast: DocumentNode | null;
  /** バリデーションエラー */
  validationErrors: string[];
  /** 実行結果 */
  data: unknown;
  errors: string[];
  /** 統計 */
  stats: {
    tokenCount: number;
    fieldResolves: number;
    maxDepth: number;
    fragments: number;
    directives: number;
    variables: number;
    n1Queries: number;
  };
}

/** プリセット */
export interface GQLPreset {
  name: string;
  description: string;
  build: () => GQLSimResult;
}
