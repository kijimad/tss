/**
 * ast.ts — TypeScript の AST ノード定義
 *
 * discriminated union で全ノードを表現する。
 * TypeScript 固有のノード（型注釈、interface、type alias 等）も含む。
 * エミッターはこれらの TS 固有ノードをスキップして JS を生成する。
 */

// === 式 (Expression) ===
export type Expr =
  | { type: "number_literal"; value: string }
  | { type: "string_literal"; value: string; quote: string }
  | { type: "template_literal"; value: string }
  | { type: "boolean_literal"; value: boolean }
  | { type: "null_literal" }
  | { type: "undefined_literal" }
  | { type: "identifier"; name: string }
  | { type: "this" }
  | { type: "binary"; op: string; left: Expr; right: Expr }
  | { type: "unary_prefix"; op: string; operand: Expr }
  | { type: "unary_postfix"; op: string; operand: Expr }
  | { type: "assignment"; op: string; left: Expr; right: Expr }
  | { type: "conditional"; condition: Expr; consequent: Expr; alternate: Expr }
  | { type: "call"; callee: Expr; args: Expr[]; typeArgs: TypeNode[] }
  | { type: "new_expr"; callee: Expr; args: Expr[] }
  | { type: "member"; object: Expr; property: string; computed: false }
  | { type: "computed_member"; object: Expr; property: Expr }
  | { type: "optional_member"; object: Expr; property: string }
  | { type: "array_literal"; elements: Expr[] }
  | { type: "object_literal"; properties: ObjProperty[] }
  | { type: "arrow_function"; params: Param[]; returnType: TypeNode | undefined; body: Stmt | Expr; async: boolean }
  | { type: "function_expr"; name: string | undefined; params: Param[]; returnType: TypeNode | undefined; body: Stmt[]; async: boolean }
  | { type: "spread"; expr: Expr }
  | { type: "typeof_expr"; operand: Expr }
  | { type: "as_expr"; expr: Expr; typeNode: TypeNode }  // TS: x as Type → x
  | { type: "non_null"; expr: Expr }                     // TS: x! → x
  | { type: "await_expr"; expr: Expr }
  | { type: "paren"; expr: Expr };

export interface ObjProperty {
  key: string | Expr;
  value: Expr | undefined;  // undefined = shorthand { x }
  computed: boolean;
  spread: boolean;
  method: boolean;
}

// === 文 (Statement) ===
export type Stmt =
  | { type: "var_decl"; kind: "const" | "let" | "var"; declarations: VarDeclarator[] }
  | { type: "expr_stmt"; expr: Expr }
  | { type: "return_stmt"; value: Expr | undefined }
  | { type: "if_stmt"; condition: Expr; consequent: Stmt; alternate: Stmt | undefined }
  | { type: "block"; body: Stmt[] }
  | { type: "for_stmt"; init: Stmt | undefined; condition: Expr | undefined; update: Expr | undefined; body: Stmt }
  | { type: "for_of_stmt"; kind: "const" | "let" | "var"; name: string; iterable: Expr; body: Stmt }
  | { type: "for_in_stmt"; kind: "const" | "let" | "var"; name: string; object: Expr; body: Stmt }
  | { type: "while_stmt"; condition: Expr; body: Stmt }
  | { type: "do_while_stmt"; condition: Expr; body: Stmt }
  | { type: "break_stmt"; label: string | undefined }
  | { type: "continue_stmt"; label: string | undefined }
  | { type: "throw_stmt"; expr: Expr }
  | { type: "try_stmt"; block: Stmt; catchClause: CatchClause | undefined; finallyBlock: Stmt | undefined }
  | { type: "switch_stmt"; discriminant: Expr; cases: SwitchCase[] }
  | { type: "function_decl"; name: string; params: Param[]; returnType: TypeNode | undefined; body: Stmt[]; async: boolean; exported: boolean }
  | { type: "class_decl"; name: string; superClass: Expr | undefined; members: ClassMember[]; exported: boolean }
  | { type: "import_decl"; specifiers: ImportSpecifier[]; source: string }
  | { type: "export_named"; declaration: Stmt | undefined; specifiers: ExportSpecifier[] }
  | { type: "export_default"; declaration: Stmt | Expr }
  // TypeScript 固有（トランスパイル時に除去）
  | { type: "type_alias"; name: string; typeNode: TypeNode; exported: boolean }
  | { type: "interface_decl"; name: string; members: TypeNode[]; exported: boolean }
  | { type: "enum_decl"; name: string; members: EnumMember[]; exported: boolean }
  | { type: "empty_stmt" };

export interface VarDeclarator {
  name: string | BindingPattern;
  typeAnnotation: TypeNode | undefined;
  init: Expr | undefined;
}

export interface BindingPattern {
  type: "object_pattern" | "array_pattern";
  elements: (string | BindingPattern | undefined)[];
}

export interface Param {
  name: string;
  typeAnnotation: TypeNode | undefined;
  optional: boolean;
  defaultValue: Expr | undefined;
  rest: boolean;
  accessibility: string | undefined; // TS: public/private/protected (コンストラクタ引数)
}

export interface CatchClause {
  param: string | undefined;
  body: Stmt;
}

export interface SwitchCase {
  test: Expr | undefined;   // undefined = default
  body: Stmt[];
}

export interface ClassMember {
  type: "method" | "property" | "constructor";
  name: string | undefined;
  params: Param[];
  returnType: TypeNode | undefined;
  body: Stmt[] | undefined;
  value: Expr | undefined;
  static: boolean;
  accessibility: string | undefined; // public/private/protected
  readonly: boolean;
  abstract: boolean;
  async: boolean;
  computed: boolean;
}

export interface ImportSpecifier {
  type: "default" | "named" | "namespace";
  imported: string;
  local: string;
}

export interface ExportSpecifier {
  local: string;
  exported: string;
}

export interface EnumMember {
  name: string;
  value: Expr | undefined;
}

// === 型ノード（TS固有、トランスパイル時に除去） ===
export type TypeNode =
  | { type: "type_ref"; name: string; typeArgs: TypeNode[] }
  | { type: "array_type"; elementType: TypeNode }
  | { type: "union_type"; types: TypeNode[] }
  | { type: "intersection_type"; types: TypeNode[] }
  | { type: "function_type"; params: TypeNode[]; returnType: TypeNode }
  | { type: "literal_type"; value: string }
  | { type: "tuple_type"; elements: TypeNode[] }
  | { type: "object_type"; members: TypeNode[] }
  | { type: "generic"; name: string; constraint: TypeNode | undefined };

// === プログラム全体 ===
export interface Program {
  body: Stmt[];
}
