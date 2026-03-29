/**
 * ast.ts -- Go AST
 *
 * Go 固有: 複数戻り値、goroutine、チャネル、:= 短縮宣言、
 *          for-range、defer、型宣言
 */
export type Expr =
  | { type: "number"; value: number }
  | { type: "string"; value: string }
  | { type: "bool"; value: boolean }
  | { type: "nil" }
  | { type: "ident"; name: string }
  | { type: "binary"; op: string; left: Expr; right: Expr }
  | { type: "unary"; op: string; operand: Expr }
  | { type: "call"; callee: Expr; args: Expr[] }
  | { type: "index"; object: Expr; index: Expr }
  | { type: "selector"; object: Expr; field: string }
  | { type: "composite_lit"; typeName: string; fields: { key: string | undefined; value: Expr }[] }
  | { type: "slice_lit"; elements: Expr[] }
  | { type: "map_lit"; entries: { key: Expr; value: Expr }[] }
  | { type: "chan_recv"; channel: Expr }          // <-ch
  | { type: "make_expr"; kind: string; args: Expr[] }  // make(chan int), make([]int, 5)
  | { type: "len_expr"; arg: Expr }
  | { type: "append_expr"; slice: Expr; elements: Expr[] }
  | { type: "func_lit"; params: Param[]; results: string[]; body: Stmt[] };

export interface Param { name: string; typeName: string; }

export type Stmt =
  | { type: "expr_stmt"; expr: Expr }
  | { type: "var_decl"; name: string; typeName: string | undefined; init: Expr | undefined }
  | { type: "short_decl"; name: string; init: Expr }        // :=
  | { type: "assign"; target: Expr; op: string; value: Expr }
  | { type: "func_decl"; name: string; params: Param[]; results: string[]; body: Stmt[] }
  | { type: "return_stmt"; values: Expr[] }
  | { type: "if_stmt"; init: Stmt | undefined; cond: Expr; body: Stmt[]; elseBody: Stmt[] | undefined }
  | { type: "for_stmt"; init: Stmt | undefined; cond: Expr | undefined; post: Stmt | undefined; body: Stmt[] }
  | { type: "for_range"; key: string; value: string | undefined; iterable: Expr; body: Stmt[] }
  | { type: "switch_stmt"; tag: Expr | undefined; cases: { exprs: Expr[]; body: Stmt[] }[] }
  | { type: "go_stmt"; call: Expr }                  // go func()
  | { type: "chan_send"; channel: Expr; value: Expr } // ch <- value
  | { type: "defer_stmt"; call: Expr }
  | { type: "block"; body: Stmt[] }
  | { type: "break_stmt" }
  | { type: "continue_stmt" }
  | { type: "inc_dec"; target: Expr; op: string }     // i++, i--
  | { type: "package_decl"; name: string }
  | { type: "import_decl"; path: string }
  | { type: "empty" };

export interface Program { package: string; imports: string[]; body: Stmt[]; }
