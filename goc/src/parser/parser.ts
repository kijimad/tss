/**
 * parser.ts -- Go パーサー
 */
import { TT, type Token } from "../lexer/lexer.js";
import type { Program, Stmt, Expr, Param } from "./ast.js";

export class Parser {
  private tokens: Token[]; private pos = 0;
  constructor(tokens: Token[]) { this.tokens = tokens; }

  parse(): Program {
    let pkg = "main"; const imports: string[] = []; const body: Stmt[] = [];
    if (this.is(TT.Package)) { this.advance(); pkg = this.advance().value; this.eat(TT.Semicolon); }
    while (this.is(TT.Import)) { this.advance(); const p = this.expect(TT.String).value; imports.push(p); this.eat(TT.Semicolon); }
    while (!this.is(TT.Eof)) body.push(this.parseStmt());
    return { package: pkg, imports, body };
  }

  private parseStmt(): Stmt {
    if (this.is(TT.Func)) return this.parseFuncDecl();
    if (this.is(TT.Var)) return this.parseVarDecl();
    if (this.is(TT.Const)) return this.parseVarDecl();
    if (this.is(TT.Return)) return this.parseReturn();
    if (this.is(TT.If)) return this.parseIf();
    if (this.is(TT.For)) return this.parseFor();
    if (this.is(TT.Switch)) return this.parseSwitch();
    if (this.is(TT.Go)) { this.advance(); const call = this.parseExpr(); this.eat(TT.Semicolon); return { type: "go_stmt", call }; }
    if (this.is(TT.Defer)) { this.advance(); const call = this.parseExpr(); this.eat(TT.Semicolon); return { type: "defer_stmt", call }; }
    if (this.is(TT.Break)) { this.advance(); this.eat(TT.Semicolon); return { type: "break_stmt" }; }
    if (this.is(TT.Continue)) { this.advance(); this.eat(TT.Semicolon); return { type: "continue_stmt" }; }
    if (this.is(TT.LeftBrace)) return { type: "block", body: this.parseBlock() };
    if (this.match(TT.Semicolon)) return { type: "empty" };

    const expr = this.parseExpr();
    // := 短縮宣言
    if (this.match(TT.ColonEq)) {
      const init = this.parseExpr(); this.eat(TT.Semicolon);
      if (expr.type === "ident") return { type: "short_decl", name: expr.name, init };
    }
    // 代入
    if (this.is(TT.Eq) || this.is(TT.PlusEq) || this.is(TT.MinusEq) || this.is(TT.StarEq)) {
      const op = this.advance().value; const value = this.parseExpr(); this.eat(TT.Semicolon);
      return { type: "assign", target: expr, op, value };
    }
    // チャネル送信: ch <- value
    if (this.match(TT.Arrow)) { const value = this.parseExpr(); this.eat(TT.Semicolon); return { type: "chan_send", channel: expr, value }; }
    // i++, i--
    if (this.is(TT.PlusPlus) || this.is(TT.MinusMinus)) { const op = this.advance().value; this.eat(TT.Semicolon); return { type: "inc_dec", target: expr, op }; }

    this.eat(TT.Semicolon);
    return { type: "expr_stmt", expr };
  }

  private parseFuncDecl(): Stmt {
    this.expect(TT.Func);
    const name = this.expect(TT.Identifier).value;
    const params = this.parseParams();
    const results = this.parseResultTypes();
    const body = this.parseBlock();
    return { type: "func_decl", name, params, results, body };
  }

  private parseParams(): Param[] {
    this.expect(TT.LeftParen); const params: Param[] = [];
    while (!this.is(TT.RightParen) && !this.is(TT.Eof)) {
      const name = this.expect(TT.Identifier).value;
      const typeName = this.is(TT.Identifier) || this.is(TT.LeftBracket) || this.is(TT.Map) || this.is(TT.Chan) || this.is(TT.Star) || this.is(TT.Interface)
        ? this.parseTypeName() : "";
      params.push({ name, typeName }); this.match(TT.Comma);
    }
    this.expect(TT.RightParen); return params;
  }

  private parseResultTypes(): string[] {
    if (this.is(TT.LeftBrace)) return [];
    if (this.is(TT.LeftParen)) {
      this.advance(); const types: string[] = [];
      while (!this.is(TT.RightParen) && !this.is(TT.Eof)) { types.push(this.parseTypeName()); this.match(TT.Comma); }
      this.expect(TT.RightParen); return types;
    }
    if (this.is(TT.Identifier) || this.is(TT.LeftBracket) || this.is(TT.Map) || this.is(TT.Chan)) return [this.parseTypeName()];
    return [];
  }

  private parseTypeName(): string {
    if (this.match(TT.Star)) return "*" + this.parseTypeName();
    if (this.match(TT.LeftBracket)) { this.expect(TT.RightBracket); return "[]" + this.parseTypeName(); }
    if (this.match(TT.Map)) { this.expect(TT.LeftBracket); const k = this.parseTypeName(); this.expect(TT.RightBracket); return `map[${k}]${this.parseTypeName()}`; }
    if (this.match(TT.Chan)) return "chan " + this.parseTypeName();
    if (this.match(TT.Interface)) { this.expect(TT.LeftBrace); this.expect(TT.RightBrace); return "interface{}"; }
    return this.advance().value;
  }

  private parseBlock(): Stmt[] {
    this.expect(TT.LeftBrace); const body: Stmt[] = [];
    while (!this.is(TT.RightBrace) && !this.is(TT.Eof)) body.push(this.parseStmt());
    this.expect(TT.RightBrace); return body;
  }

  private parseVarDecl(): Stmt {
    this.advance(); // var or const
    const name = this.expect(TT.Identifier).value;
    const typeName = (!this.is(TT.Eq) && !this.is(TT.Semicolon)) ? this.parseTypeName() : undefined;
    const init = this.match(TT.Eq) ? this.parseExpr() : undefined;
    this.eat(TT.Semicolon);
    return { type: "var_decl", name, typeName, init };
  }

  private parseReturn(): Stmt {
    this.expect(TT.Return); const values: Expr[] = [];
    if (!this.is(TT.Semicolon) && !this.is(TT.RightBrace) && !this.is(TT.Eof)) {
      values.push(this.parseExpr());
      while (this.match(TT.Comma)) values.push(this.parseExpr());
    }
    this.eat(TT.Semicolon);
    return { type: "return_stmt", values };
  }

  private parseIf(): Stmt {
    this.expect(TT.If);
    let init: Stmt | undefined;
    const expr = this.parseExpr();
    // Go の if は init statement を持てる: if x := f(); x > 0 { }
    if (this.match(TT.ColonEq)) {
      const initVal = this.parseExpr(); this.eat(TT.Semicolon);
      init = { type: "short_decl", name: expr.type === "ident" ? expr.name : "_", init: initVal };
      const cond = this.parseExpr();
      const body = this.parseBlock();
      const elseBody = this.match(TT.Else) ? (this.is(TT.If) ? [this.parseIf()] : this.parseBlock()) : undefined;
      return { type: "if_stmt", init, cond, body, elseBody };
    }
    const body = this.parseBlock();
    const elseBody = this.match(TT.Else) ? (this.is(TT.If) ? [this.parseIf()] : this.parseBlock()) : undefined;
    return { type: "if_stmt", init: undefined, cond: expr, body, elseBody };
  }

  private parseFor(): Stmt {
    this.expect(TT.For);
    // for range
    if (this.is(TT.Identifier)) {
      const saved = this.pos;
      const first = this.advance().value;
      if (this.match(TT.Comma)) {
        const second = this.expect(TT.Identifier).value;
        if (this.match(TT.ColonEq)) { this.expect(TT.Range); const iter = this.parseExpr(); return { type: "for_range", key: first, value: second, iterable: iter, body: this.parseBlock() }; }
        this.pos = saved;
      } else if (this.match(TT.ColonEq)) {
        if (this.match(TT.Range)) { const iter = this.parseExpr(); return { type: "for_range", key: first, value: undefined, iterable: iter, body: this.parseBlock() }; }
        this.pos = saved;
      } else { this.pos = saved; }
    }
    // for { } (無限ループ)
    if (this.is(TT.LeftBrace)) return { type: "for_stmt", init: undefined, cond: undefined, post: undefined, body: this.parseBlock() };
    // for cond { }
    const first = this.parseStmt();
    if (this.is(TT.LeftBrace)) {
      // for cond { }
      if (first.type === "expr_stmt") return { type: "for_stmt", init: undefined, cond: first.expr, post: undefined, body: this.parseBlock() };
    }
    // for init; cond; post { }
    const cond = this.is(TT.Semicolon) ? undefined : this.parseExpr(); this.eat(TT.Semicolon);
    const post = this.is(TT.LeftBrace) ? undefined : this.parseStmt();
    return { type: "for_stmt", init: first, cond, post, body: this.parseBlock() };
  }

  private parseSwitch(): Stmt {
    this.expect(TT.Switch);
    const tag = this.is(TT.LeftBrace) ? undefined : this.parseExpr(); this.eat(TT.Semicolon);
    this.expect(TT.LeftBrace);
    const cases: { exprs: Expr[]; body: Stmt[] }[] = [];
    while (!this.is(TT.RightBrace) && !this.is(TT.Eof)) {
      if (this.match(TT.Case)) {
        const exprs = [this.parseExpr()]; while (this.match(TT.Comma)) exprs.push(this.parseExpr());
        this.expect(TT.Colon);
        const body: Stmt[] = [];
        while (!this.is(TT.Case) && !this.is(TT.Default) && !this.is(TT.RightBrace)) body.push(this.parseStmt());
        cases.push({ exprs, body });
      } else if (this.match(TT.Default)) {
        this.expect(TT.Colon);
        const body: Stmt[] = [];
        while (!this.is(TT.Case) && !this.is(TT.Default) && !this.is(TT.RightBrace)) body.push(this.parseStmt());
        cases.push({ exprs: [], body });
      }
    }
    this.expect(TT.RightBrace);
    return { type: "switch_stmt", tag, cases };
  }

  // 式パーサー
  private parseExpr(): Expr { return this.parseOr(); }
  private parseOr(): Expr { let l = this.parseAnd(); while (this.match(TT.PipePipe)) l = { type: "binary", op: "||", left: l, right: this.parseAnd() }; return l; }
  private parseAnd(): Expr { let l = this.parseEq(); while (this.match(TT.AmpAmp)) l = { type: "binary", op: "&&", left: l, right: this.parseEq() }; return l; }
  private parseEq(): Expr { let l = this.parseCmp(); while (this.is(TT.EqEq) || this.is(TT.BangEq)) { const op = this.advance().value; l = { type: "binary", op, left: l, right: this.parseCmp() }; } return l; }
  private parseCmp(): Expr { let l = this.parseAdd(); while (this.is(TT.Lt) || this.is(TT.Gt) || this.is(TT.LtEq) || this.is(TT.GtEq)) { const op = this.advance().value; l = { type: "binary", op, left: l, right: this.parseAdd() }; } return l; }
  private parseAdd(): Expr { let l = this.parseMul(); while (this.is(TT.Plus) || this.is(TT.Minus)) { const op = this.advance().value; l = { type: "binary", op, left: l, right: this.parseMul() }; } return l; }
  private parseMul(): Expr { let l = this.parseUnary(); while (this.is(TT.Star) || this.is(TT.Slash) || this.is(TT.Percent)) { const op = this.advance().value; l = { type: "binary", op, left: l, right: this.parseUnary() }; } return l; }
  private parseUnary(): Expr {
    if (this.is(TT.Minus) || this.is(TT.Bang)) { const op = this.advance().value; return { type: "unary", op, operand: this.parseUnary() }; }
    if (this.match(TT.Arrow)) { return { type: "chan_recv", channel: this.parsePostfix() }; }
    return this.parsePostfix();
  }
  private parsePostfix(): Expr {
    let e = this.parsePrimary();
    while (true) {
      if (this.match(TT.Dot)) { e = { type: "selector", object: e, field: this.advance().value }; }
      else if (this.is(TT.LeftBracket)) { this.advance(); const idx = this.parseExpr(); this.expect(TT.RightBracket); e = { type: "index", object: e, index: idx }; }
      else if (this.is(TT.LeftParen)) { e = { type: "call", callee: e, args: this.parseArgList() }; }
      else break;
    }
    return e;
  }
  private parseArgList(): Expr[] {
    this.expect(TT.LeftParen); const args: Expr[] = [];
    while (!this.is(TT.RightParen) && !this.is(TT.Eof)) { args.push(this.parseExpr()); this.match(TT.Comma); }
    this.expect(TT.RightParen); return args;
  }
  private parsePrimary(): Expr {
    if (this.is(TT.Number)) return { type: "number", value: Number(this.advance().value) };
    if (this.is(TT.String)) return { type: "string", value: this.advance().value };
    if (this.match(TT.True)) return { type: "bool", value: true };
    if (this.match(TT.False)) return { type: "bool", value: false };
    if (this.match(TT.Nil)) return { type: "nil" };
    // make(...)
    if (this.is(TT.Make)) { this.advance(); this.expect(TT.LeftParen); const kind = this.parseTypeName(); const args: Expr[] = []; while (this.match(TT.Comma)) args.push(this.parseExpr()); this.expect(TT.RightParen); return { type: "make_expr", kind, args }; }
    // len(...)
    if (this.is(TT.Len)) { this.advance(); this.expect(TT.LeftParen); const arg = this.parseExpr(); this.expect(TT.RightParen); return { type: "len_expr", arg }; }
    // append(...)
    if (this.is(TT.Append)) { this.advance(); this.expect(TT.LeftParen); const sl = this.parseExpr(); const els: Expr[] = []; while (this.match(TT.Comma)) els.push(this.parseExpr()); this.expect(TT.RightParen); return { type: "append_expr", slice: sl, elements: els }; }
    // println(...)
    if (this.is(TT.Print)) { const name = this.advance().value; return { type: "ident", name }; }
    // func literal
    if (this.is(TT.Func)) { this.advance(); const params = this.parseParams(); const results = this.parseResultTypes(); const body = this.parseBlock(); return { type: "func_lit", params, results, body }; }
    // []Type{...} slice literal
    if (this.is(TT.LeftBracket) && this.peekAt(1)?.type === TT.RightBracket) {
      this.advance(); this.advance(); this.parseTypeName();
      this.expect(TT.LeftBrace); const els: Expr[] = [];
      while (!this.is(TT.RightBrace) && !this.is(TT.Eof)) { els.push(this.parseExpr()); this.match(TT.Comma); this.eat(TT.Semicolon); }
      this.expect(TT.RightBrace); return { type: "slice_lit", elements: els };
    }
    if (this.is(TT.LeftParen)) { this.advance(); const e = this.parseExpr(); this.expect(TT.RightParen); return e; }
    if (this.is(TT.Identifier)) return { type: "ident", name: this.advance().value };
    throw new Error(`Parse error: unexpected '${this.peek().value || this.peek().type}' at line ${String(this.peek().line)}`);
  }

  private peek(): Token { return this.tokens[this.pos] ?? { type: TT.Eof, value: "", line: 0 }; }
  private peekAt(offset: number): Token | undefined { return this.tokens[this.pos + offset]; }
  private advance(): Token { const t = this.peek(); this.pos++; return t; }
  private is(t: TT): boolean { return this.peek().type === t; }
  private match(t: TT): boolean { if (this.is(t)) { this.advance(); return true; } return false; }
  private expect(t: TT): Token { if (!this.is(t)) throw new Error(`Expected '${t}' got '${this.peek().value || this.peek().type}' at line ${String(this.peek().line)}`); return this.advance(); }
  private eat(t: TT): void { this.match(t); }
}
