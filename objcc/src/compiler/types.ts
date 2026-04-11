/** トークンの種類 */
export type TokenKind =
  | "int" | "return" | "if" | "else" | "while" | "for"
  | "ident" | "number" | "string"
  | "plus" | "minus" | "star" | "slash" | "percent"
  | "assign" | "eq" | "neq" | "lt" | "le" | "gt" | "ge"
  | "and" | "or" | "not"
  | "lparen" | "rparen" | "lbrace" | "rbrace" | "lbracket" | "rbracket"
  | "semicolon" | "comma"
  | "ampersand"
  | "eof";

/** トークン */
export interface Token {
  kind: TokenKind;
  value: string;
  line: number;
  col: number;
}

/** AST ノードの種類 */
export type NodeKind =
  | "program" | "func_decl" | "param"
  | "var_decl" | "assign_stmt" | "return_stmt"
  | "if_stmt" | "while_stmt" | "for_stmt"
  | "block" | "expr_stmt"
  | "binary_expr" | "unary_expr" | "call_expr"
  | "ident_expr" | "number_lit" | "string_lit"
  | "addr_of" | "deref";

/** ASTノード */
export interface AstNode {
  kind: NodeKind;
  /** 変数・関数名 */
  name?: string;
  /** 型名 */
  typeName?: string;
  /** 数値リテラル値 */
  value?: number;
  /** 文字列リテラル値 */
  strValue?: string;
  /** 演算子 */
  op?: string;
  /** 子ノード */
  children: AstNode[];
  /** ソース位置 */
  line: number;
}

/** シンボルの種類 */
export type SymbolType = "function" | "global_var" | "local_var" | "param" | "string_lit";

/** シンボルのバインド */
export type SymbolBind = "global" | "local";

/** シンボルテーブルエントリ */
export interface SymbolEntry {
  name: string;
  type: SymbolType;
  bind: SymbolBind;
  section: string;
  offset: number;
  size: number;
}

/** リロケーションの種類 */
export type RelocationType = "R_ABS32" | "R_REL32" | "R_DATA_ADDR";

/** リロケーションエントリ */
export interface RelocationEntry {
  /** リロケーション先のセクション */
  section: string;
  /** セクション内オフセット */
  offset: number;
  /** リロケーション種別 */
  type: RelocationType;
  /** 参照先シンボル名 */
  symbol: string;
  /** 加算値 */
  addend: number;
}

/** セクション */
export interface Section {
  name: string;
  data: number[];
  alignment: number;
  flags: string[];
}

/** オブジェクトファイル */
export interface ObjectFile {
  /** ファイル名 */
  filename: string;
  /** セクション一覧 */
  sections: Section[];
  /** シンボルテーブル */
  symbols: SymbolEntry[];
  /** リロケーションテーブル */
  relocations: RelocationEntry[];
}

/** コンパイルステップ（可視化用） */
export interface CompileStep {
  phase: "lex" | "parse" | "codegen" | "object";
  description: string;
  detail?: string;
}

/** コンパイル結果 */
export interface CompileResult {
  success: boolean;
  errors: string[];
  /** トークン列 */
  tokens: Token[];
  /** AST */
  ast: AstNode | null;
  /** 生成されたオブジェクトファイル */
  objectFile: ObjectFile | null;
  /** コンパイル過程 */
  steps: CompileStep[];
}
