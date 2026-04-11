import type { Token, TokenKind, AstNode } from "./types.js";

/** 再帰下降パーサ: トークン列 → AST */
export function parse(tokens: Token[]): { ast: AstNode; errors: string[] } {
  let pos = 0;
  const errors: string[] = [];

  const peek = (): Token => tokens[pos] ?? { kind: "eof" as const, value: "", line: 0, col: 0 };
  const advance = (): Token => {
    const tok = peek();
    if (tok.kind !== "eof") pos++;
    return tok;
  };
  const expect = (kind: TokenKind): Token => {
    const tok = peek();
    if (tok.kind !== kind) {
      errors.push(`${tok.line}:${tok.col} '${kind}' が期待されましたが '${tok.value || tok.kind}' が見つかりました`);
    }
    return advance();
  };
  const match = (kind: TokenKind): boolean => {
    if (peek().kind === kind) { advance(); return true; }
    return false;
  };

  // program = func_decl*
  const parseProgram = (): AstNode => {
    const funcs: AstNode[] = [];
    while (peek().kind !== "eof") {
      funcs.push(parseFuncDecl());
    }
    return { kind: "program", children: funcs, line: 1 };
  };

  // func_decl = "int" ident "(" params ")" block
  const parseFuncDecl = (): AstNode => {
    const line = peek().line;
    const retType = expect("int").value || "int";
    const name = expect("ident").value;
    expect("lparen");
    const params: AstNode[] = [];
    if (peek().kind !== "rparen") {
      do {
        const pLine = peek().line;
        const pType = expect("int").value || "int";
        const pName = expect("ident").value;
        params.push({ kind: "param", name: pName, typeName: pType, children: [], line: pLine });
      } while (match("comma"));
    }
    expect("rparen");
    const body = parseBlock();
    return { kind: "func_decl", name, typeName: retType, children: [{ kind: "block", children: params, line }, body], line };
  };

  // block = "{" stmt* "}"
  const parseBlock = (): AstNode => {
    const line = peek().line;
    expect("lbrace");
    const stmts: AstNode[] = [];
    while (peek().kind !== "rbrace" && peek().kind !== "eof") {
      stmts.push(parseStmt());
    }
    expect("rbrace");
    return { kind: "block", children: stmts, line };
  };

  // stmt = var_decl | return_stmt | if_stmt | while_stmt | for_stmt | expr_stmt | block
  const parseStmt = (): AstNode => {
    const kind = peek().kind;
    if (kind === "int") return parseVarDecl();
    if (kind === "return") return parseReturn();
    if (kind === "if") return parseIf();
    if (kind === "while") return parseWhile();
    if (kind === "for") return parseFor();
    if (kind === "lbrace") return parseBlock();
    return parseExprStmt();
  };

  // var_decl = "int" ident ("=" expr)? ";"
  const parseVarDecl = (): AstNode => {
    const line = peek().line;
    expect("int");
    const name = expect("ident").value;
    const children: AstNode[] = [];
    if (match("assign")) {
      children.push(parseExpr());
    }
    expect("semicolon");
    return { kind: "var_decl", name, typeName: "int", children, line };
  };

  const parseReturn = (): AstNode => {
    const line = peek().line;
    advance(); // 'return'
    const expr = parseExpr();
    expect("semicolon");
    return { kind: "return_stmt", children: [expr], line };
  };

  const parseIf = (): AstNode => {
    const line = peek().line;
    advance(); // 'if'
    expect("lparen");
    const cond = parseExpr();
    expect("rparen");
    const then = parseStmt();
    const children: AstNode[] = [cond, then];
    if (match("else")) {
      children.push(parseStmt());
    }
    return { kind: "if_stmt", children, line };
  };

  const parseWhile = (): AstNode => {
    const line = peek().line;
    advance(); // 'while'
    expect("lparen");
    const cond = parseExpr();
    expect("rparen");
    const body = parseStmt();
    return { kind: "while_stmt", children: [cond, body], line };
  };

  const parseFor = (): AstNode => {
    const line = peek().line;
    advance(); // 'for'
    expect("lparen");
    const init = peek().kind === "int" ? parseVarDecl() : parseExprStmt();
    const cond = parseExpr();
    expect("semicolon");
    const update = parseExpr();
    expect("rparen");
    const body = parseStmt();
    return { kind: "for_stmt", children: [init, cond, update, body], line };
  };

  const parseExprStmt = (): AstNode => {
    const line = peek().line;
    const expr = parseExpr();
    expect("semicolon");
    return { kind: "expr_stmt", children: [expr], line };
  };

  // expr = assign_expr
  const parseExpr = (): AstNode => parseAssign();

  // assign = or ("=" assign)?
  const parseAssign = (): AstNode => {
    const left = parseOr();
    if (peek().kind === "assign") {
      advance();
      const right = parseAssign();
      return { kind: "assign_stmt", children: [left, right], line: left.line };
    }
    return left;
  };

  // or = and ("||" and)*
  const parseOr = (): AstNode => {
    let left = parseAnd();
    while (match("or")) {
      const right = parseAnd();
      left = { kind: "binary_expr", op: "||", children: [left, right], line: left.line };
    }
    return left;
  };

  // and = equality ("&&" equality)*
  const parseAnd = (): AstNode => {
    let left = parseEquality();
    while (match("and")) {
      const right = parseEquality();
      left = { kind: "binary_expr", op: "&&", children: [left, right], line: left.line };
    }
    return left;
  };

  // equality = relational (("==" | "!=") relational)*
  const parseEquality = (): AstNode => {
    let left = parseRelational();
    while (peek().kind === "eq" || peek().kind === "neq") {
      const op = advance().value;
      const right = parseRelational();
      left = { kind: "binary_expr", op, children: [left, right], line: left.line };
    }
    return left;
  };

  // relational = additive (("<" | "<=" | ">" | ">=") additive)*
  const parseRelational = (): AstNode => {
    let left = parseAdditive();
    while (["lt", "le", "gt", "ge"].includes(peek().kind)) {
      const op = advance().value;
      const right = parseAdditive();
      left = { kind: "binary_expr", op, children: [left, right], line: left.line };
    }
    return left;
  };

  // additive = multiplicative (("+" | "-") multiplicative)*
  const parseAdditive = (): AstNode => {
    let left = parseMultiplicative();
    while (peek().kind === "plus" || peek().kind === "minus") {
      const op = advance().value;
      const right = parseMultiplicative();
      left = { kind: "binary_expr", op, children: [left, right], line: left.line };
    }
    return left;
  };

  // multiplicative = unary (("*" | "/" | "%") unary)*
  const parseMultiplicative = (): AstNode => {
    let left = parseUnary();
    while (peek().kind === "star" || peek().kind === "slash" || peek().kind === "percent") {
      const op = advance().value;
      const right = parseUnary();
      left = { kind: "binary_expr", op, children: [left, right], line: left.line };
    }
    return left;
  };

  // unary = ("-" | "!" | "&" | "*") unary | primary
  const parseUnary = (): AstNode => {
    if (peek().kind === "minus" || peek().kind === "not") {
      const line = peek().line;
      const op = advance().value;
      const operand = parseUnary();
      return { kind: "unary_expr", op, children: [operand], line };
    }
    if (peek().kind === "ampersand") {
      const line = peek().line;
      advance();
      const operand = parseUnary();
      return { kind: "addr_of", children: [operand], line };
    }
    if (peek().kind === "star") {
      const line = peek().line;
      advance();
      const operand = parseUnary();
      return { kind: "deref", children: [operand], line };
    }
    return parsePrimary();
  };

  // primary = number | string | ident ("(" args ")")? | "(" expr ")"
  const parsePrimary = (): AstNode => {
    const tok = peek();

    if (tok.kind === "number") {
      advance();
      return { kind: "number_lit", value: parseInt(tok.value, 10), children: [], line: tok.line };
    }

    if (tok.kind === "string") {
      advance();
      return { kind: "string_lit", strValue: tok.value, children: [], line: tok.line };
    }

    if (tok.kind === "ident") {
      advance();
      // 関数呼び出し
      if (peek().kind === "lparen") {
        advance();
        const args: AstNode[] = [];
        if (peek().kind !== "rparen") {
          do { args.push(parseExpr()); } while (match("comma"));
        }
        expect("rparen");
        return { kind: "call_expr", name: tok.value, children: args, line: tok.line };
      }
      return { kind: "ident_expr", name: tok.value, children: [], line: tok.line };
    }

    if (tok.kind === "lparen") {
      advance();
      const expr = parseExpr();
      expect("rparen");
      return expr;
    }

    errors.push(`${tok.line}:${tok.col} 予期しないトークン: '${tok.value || tok.kind}'`);
    advance();
    return { kind: "number_lit", value: 0, children: [], line: tok.line };
  };

  const ast = parseProgram();
  return { ast, errors };
}
