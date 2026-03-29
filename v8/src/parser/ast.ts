/**
 * ast.ts -- JavaScript AST ノード
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

export interface Program { body: Stmt[]; }
