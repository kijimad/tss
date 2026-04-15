/**
 * ast.ts -- JavaScript AST ノード定義
 *
 * このモジュールはJavaScriptの抽象構文木（AST）を表現する型を定義する。
 * パーサーが生成し、バイトコードコンパイラが消費するデータ構造。
 * 式（Expr）と文（Stmt）の2つの主要な型で構成される。
 */

/**
 * 式ノードのユニオン型
 *
 * リテラル、識別子、二項演算、単項演算、代入、関数呼び出し、
 * メンバアクセス、配列、オブジェクト、アロー関数などを表現する。
 */
export type Expr =
  | { type: "number"; value: number }
  | { type: "string"; value: string }
  | { type: "boolean"; value: boolean }
  | { type: "null" }
  | { type: "undefined" }
  | { type: "identifier"; name: string }
  | { type: "this" }
  | { type: "binary"; op: string; left: Expr; right: Expr }
  | { type: "unary"; op: string; operand: Expr; prefix: boolean }
  | { type: "assign"; op: string; left: Expr; right: Expr }
  | { type: "call"; callee: Expr; args: Expr[] }
  | { type: "member"; object: Expr; property: string }
  | { type: "computed"; object: Expr; property: Expr }
  | { type: "array"; elements: Expr[] }
  | { type: "object"; properties: { key: string; value: Expr }[] }
  | { type: "arrow"; params: string[]; body: Stmt | Expr }
  | { type: "function_expr"; name: string | undefined; params: string[]; body: Stmt[] }
  | { type: "new_expr"; callee: Expr; args: Expr[] }
  | { type: "conditional"; test: Expr; consequent: Expr; alternate: Expr };

/**
 * 文ノードのユニオン型
 *
 * 式文、変数宣言、関数宣言、return文、if文、while文、
 * for文、ブロック文、空文を表現する。
 */
export type Stmt =
  | { type: "expr_stmt"; expr: Expr }
  | { type: "var_decl"; kind: string; name: string; init: Expr | undefined }
  | { type: "function_decl"; name: string; params: string[]; body: Stmt[] }
  | { type: "return_stmt"; value: Expr | undefined }
  | { type: "if_stmt"; test: Expr; consequent: Stmt; alternate: Stmt | undefined }
  | { type: "while_stmt"; test: Expr; body: Stmt }
  | { type: "for_stmt"; init: Stmt | undefined; test: Expr | undefined; update: Expr | undefined; body: Stmt }
  | { type: "block"; body: Stmt[] }
  | { type: "empty" };

/** プログラム全体を表すインタフェース。トップレベルの文の配列を保持する */
export interface Program { body: Stmt[]; }
