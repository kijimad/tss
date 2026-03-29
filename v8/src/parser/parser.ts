/**
 * parser.ts -- JavaScript パーサー (再帰下降)
 *
 * V8 パイプラインの第2段階: トークン列 → AST
 */
import { TT, type Token } from "../lexer/lexer.js";
import type { Program, Stmt, Expr } from "./ast.js";

export class Parser {
  private tokens: Token[];
  private pos = 0;
  constructor(tokens: Token[]) { this.tokens = tokens; }

  parse(): Program {
    const body: Stmt[] = [];
    while (!this.is(TT.Eof)) body.push(this.parseStmt());
    return { body };
  }

  private parseStmt(): Stmt {
    if (this.is(TT.Var) || this.is(TT.Let) || this.is(TT.Const)) return this.parseVarDecl();
    if (this.is(TT.Function)) return this.parseFuncDecl();
    if (this.is(TT.Return)) return this.parseReturn();
    if (this.is(TT.If)) return this.parseIf();
    if (this.is(TT.While)) return this.parseWhile();
    if (this.is(TT.For)) return this.parseFor();
    if (this.is(TT.LeftBrace)) return this.parseBlock();
    if (this.match(TT.Semicolon)) return { type: "empty" };
    const expr = this.parseExpr();
    this.match(TT.Semicolon);
    return { type: "expr_stmt", expr };
  }

  private parseVarDecl(): Stmt {
    const kind = this.advance().value;
    const name = this.expect(TT.Identifier).value;
    const init = this.match(TT.Eq) ? this.parseAssign() : undefined;
    this.match(TT.Semicolon);
    return { type: "var_decl", kind, name, init };
  }

  private parseFuncDecl(): Stmt {
    this.expect(TT.Function);
    const name = this.expect(TT.Identifier).value;
    const params = this.parseParamList();
    const body = this.parseBlockBody();
    return { type: "function_decl", name, params, body };
  }

  private parseReturn(): Stmt {
    this.expect(TT.Return);
    if (this.is(TT.Semicolon) || this.is(TT.RightBrace) || this.is(TT.Eof)) { this.match(TT.Semicolon); return { type: "return_stmt", value: undefined }; }
    const value = this.parseExpr();
    this.match(TT.Semicolon);
    return { type: "return_stmt", value };
  }

  private parseIf(): Stmt {
    this.expect(TT.If); this.expect(TT.LeftParen);
    const test = this.parseExpr(); this.expect(TT.RightParen);
    const consequent = this.parseStmt();
    const alternate = this.match(TT.Else) ? this.parseStmt() : undefined;
    return { type: "if_stmt", test, consequent, alternate };
  }

  private parseWhile(): Stmt {
    this.expect(TT.While); this.expect(TT.LeftParen);
    const test = this.parseExpr(); this.expect(TT.RightParen);
    return { type: "while_stmt", test, body: this.parseStmt() };
  }

  private parseFor(): Stmt {
    this.expect(TT.For); this.expect(TT.LeftParen);
    const init = this.is(TT.Semicolon) ? undefined : this.parseStmt();
    const test = this.is(TT.Semicolon) ? undefined : this.parseExpr();
    this.expect(TT.Semicolon);
    const update = this.is(TT.RightParen) ? undefined : this.parseExpr();
    this.expect(TT.RightParen);
    return { type: "for_stmt", init, test, update, body: this.parseStmt() };
  }

  private parseBlock(): Stmt { return { type: "block", body: this.parseBlockBody() }; }
  private parseBlockBody(): Stmt[] {
    this.expect(TT.LeftBrace);
    const body: Stmt[] = [];
    while (!this.is(TT.RightBrace) && !this.is(TT.Eof)) body.push(this.parseStmt());
    this.expect(TT.RightBrace);
    return body;
  }
  private parseParamList(): string[] {
    this.expect(TT.LeftParen);
    const params: string[] = [];
    while (!this.is(TT.RightParen) && !this.is(TT.Eof)) { params.push(this.expect(TT.Identifier).value); this.match(TT.Comma); }
    this.expect(TT.RightParen);
    return params;
  }

  // 式パーサー
  private parseExpr(): Expr { return this.parseAssign(); }
  private parseAssign(): Expr {
    const left = this.parseConditional();
    if (this.is(TT.Eq) || this.is(TT.PlusEq) || this.is(TT.MinusEq) || this.is(TT.StarEq)) {
      const op = this.advance().value; return { type: "assign", op, left, right: this.parseAssign() };
    }
    return left;
  }
  private parseConditional(): Expr { return this.parseOr(); }
  private parseOr(): Expr { let l = this.parseAnd(); while (this.match(TT.PipePipe)) { l = { type: "binary", op: "||", left: l, right: this.parseAnd() }; } return l; }
  private parseAnd(): Expr { let l = this.parseEquality(); while (this.match(TT.AmpAmp)) { l = { type: "binary", op: "&&", left: l, right: this.parseEquality() }; } return l; }
  private parseEquality(): Expr {
    let l = this.parseComparison();
    while (this.is(TT.EqEq) || this.is(TT.BangEq) || this.is(TT.EqEqEq) || this.is(TT.BangEqEq)) { const op = this.advance().value; l = { type: "binary", op, left: l, right: this.parseComparison() }; }
    return l;
  }
  private parseComparison(): Expr {
    let l = this.parseAddSub();
    while (this.is(TT.Lt) || this.is(TT.Gt) || this.is(TT.LtEq) || this.is(TT.GtEq)) { const op = this.advance().value; l = { type: "binary", op, left: l, right: this.parseAddSub() }; }
    return l;
  }
  private parseAddSub(): Expr { let l = this.parseMulDiv(); while (this.is(TT.Plus) || this.is(TT.Minus)) { const op = this.advance().value; l = { type: "binary", op, left: l, right: this.parseMulDiv() }; } return l; }
  private parseMulDiv(): Expr { let l = this.parseUnary(); while (this.is(TT.Star) || this.is(TT.Slash) || this.is(TT.Percent)) { const op = this.advance().value; l = { type: "binary", op, left: l, right: this.parseUnary() }; } return l; }
  private parseUnary(): Expr {
    if (this.is(TT.Minus) || this.is(TT.Bang) || this.is(TT.PlusPlus) || this.is(TT.MinusMinus)) { const op = this.advance().value; return { type: "unary", op, operand: this.parseUnary(), prefix: true }; }
    return this.parsePostfix();
  }
  private parsePostfix(): Expr {
    let e = this.parseCallMember();
    if (this.is(TT.PlusPlus) || this.is(TT.MinusMinus)) { const op = this.advance().value; e = { type: "unary", op, operand: e, prefix: false }; }
    return e;
  }
  private parseCallMember(): Expr {
    let e = this.parsePrimary();
    while (true) {
      if (this.match(TT.Dot)) { e = { type: "member", object: e, property: this.advance().value }; }
      else if (this.is(TT.LeftBracket)) { this.advance(); const p = this.parseExpr(); this.expect(TT.RightBracket); e = { type: "computed", object: e, property: p }; }
      else if (this.is(TT.LeftParen)) { e = { type: "call", callee: e, args: this.parseArgList() }; }
      else break;
    }
    return e;
  }
  private parseArgList(): Expr[] {
    this.expect(TT.LeftParen);
    const args: Expr[] = [];
    while (!this.is(TT.RightParen) && !this.is(TT.Eof)) { args.push(this.parseAssign()); this.match(TT.Comma); }
    this.expect(TT.RightParen);
    return args;
  }
  private parsePrimary(): Expr {
    if (this.is(TT.Number)) return { type: "number", value: Number(this.advance().value) };
    if (this.is(TT.String)) return { type: "string", value: this.advance().value };
    if (this.match(TT.True)) return { type: "boolean", value: true };
    if (this.match(TT.False)) return { type: "boolean", value: false };
    if (this.match(TT.Null)) return { type: "null" };
    if (this.match(TT.Undefined)) return { type: "undefined" };
    if (this.match(TT.This)) return { type: "this" };
    if (this.is(TT.New)) { this.advance(); const callee = this.parsePrimary(); const args = this.is(TT.LeftParen) ? this.parseArgList() : []; return { type: "new_expr", callee, args }; }
    if (this.is(TT.Function)) { this.advance(); const name = this.is(TT.Identifier) ? this.advance().value : undefined; const params = this.parseParamList(); const body = this.parseBlockBody(); return { type: "function_expr", name, params, body }; }
    if (this.is(TT.LeftParen)) {
      this.advance(); const e = this.parseExpr(); this.expect(TT.RightParen);
      // Arrow function: (x, y) => ...
      if (this.match(TT.Arrow)) {
        const params = e.type === "identifier" ? [e.name] : [];
        const body = this.is(TT.LeftBrace) ? this.parseBlock() : this.parseAssign();
        return { type: "arrow", params, body };
      }
      return e;
    }
    if (this.is(TT.LeftBracket)) { this.advance(); const el: Expr[] = []; while (!this.is(TT.RightBracket) && !this.is(TT.Eof)) { el.push(this.parseAssign()); this.match(TT.Comma); } this.expect(TT.RightBracket); return { type: "array", elements: el }; }
    if (this.is(TT.LeftBrace)) { this.advance(); const props: { key: string; value: Expr }[] = []; while (!this.is(TT.RightBrace) && !this.is(TT.Eof)) { const key = this.advance().value; this.expect(TT.Colon); props.push({ key, value: this.parseAssign() }); this.match(TT.Comma); } this.expect(TT.RightBrace); return { type: "object", properties: props }; }
    if (this.is(TT.Identifier)) {
      const name = this.advance().value;
      if (this.match(TT.Arrow)) { const body = this.is(TT.LeftBrace) ? this.parseBlock() : this.parseAssign(); return { type: "arrow", params: [name], body }; }
      return { type: "identifier", name };
    }
    throw new Error(`Parse error at line ${String(this.peek().line)}: unexpected '${this.peek().value || this.peek().type}'`);
  }

  private peek(): Token { return this.tokens[this.pos] ?? { type: TT.Eof, value: "", line: 0 }; }
  private advance(): Token { const t = this.peek(); this.pos++; return t; }
  private is(type: TT): boolean { return this.peek().type === type; }
  private match(type: TT): boolean { if (this.is(type)) { this.advance(); return true; } return false; }
  private expect(type: TT): Token { if (!this.is(type)) throw new Error(`Expected '${type}' but got '${this.peek().value || this.peek().type}' at line ${String(this.peek().line)}`); return this.advance(); }
}
