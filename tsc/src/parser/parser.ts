/**
 * parser.ts — トークン列 → AST
 *
 * mdb の SQL パーサと同じ再帰下降方式。
 * TypeScript の型注釈を認識してスキップし、AST に記録する。
 * エミッターが型ノードを無視することで JavaScript が出力される。
 */
import { TT, type Token } from "../lexer/tokens.js";
import type {
  Program, Stmt, Expr, Param, TypeNode, VarDeclarator,
  ClassMember, ImportSpecifier, ExportSpecifier, EnumMember,
  ObjProperty, SwitchCase, CatchClause,
} from "./ast.js";

export class Parser {
  private tokens: Token[];
  private pos = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  parse(): Program {
    const body: Stmt[] = [];
    while (!this.is(TT.Eof)) {
      body.push(this.parseStmt());
    }
    return { body };
  }

  // === 文 ===

  private parseStmt(): Stmt {
    // export
    if (this.is(TT.Export)) return this.parseExport();
    // import
    if (this.is(TT.Import)) return this.parseImport();
    // type alias (TS)
    if (this.is(TT.Type) && this.peekNext()?.type === TT.Identifier) return this.parseTypeAlias(false);
    // interface (TS)
    if (this.is(TT.Interface)) return this.parseInterface(false);
    // enum (TS)
    if (this.is(TT.Enum)) return this.parseEnum(false);
    // declare (TS: 全体をスキップ)
    if (this.is(TT.Declare)) return this.parseDeclare();
    // const/let/var
    if (this.is(TT.Const) || this.is(TT.Let) || this.is(TT.Var)) return this.parseVarDecl();
    // function
    if (this.is(TT.Function) || (this.is(TT.Async) && this.peekNext()?.type === TT.Function)) return this.parseFunctionDecl(false);
    // class
    if (this.is(TT.Class)) return this.parseClassDecl(false);
    // if
    if (this.is(TT.If)) return this.parseIf();
    // for
    if (this.is(TT.For)) return this.parseFor();
    // while
    if (this.is(TT.While)) return this.parseWhile();
    // do-while
    if (this.is(TT.Do)) return this.parseDoWhile();
    // return
    if (this.is(TT.Return)) return this.parseReturn();
    // throw
    if (this.is(TT.Throw)) return this.parseThrow();
    // try
    if (this.is(TT.Try)) return this.parseTry();
    // switch
    if (this.is(TT.Switch)) return this.parseSwitch();
    // break/continue
    if (this.is(TT.Break)) { this.advance(); this.eat(TT.Semicolon); return { type: "break_stmt", label: undefined }; }
    if (this.is(TT.Continue)) { this.advance(); this.eat(TT.Semicolon); return { type: "continue_stmt", label: undefined }; }
    // block
    if (this.is(TT.LeftBrace)) return this.parseBlock();
    // empty statement
    if (this.is(TT.Semicolon)) { this.advance(); return { type: "empty_stmt" }; }

    // 式文
    const expr = this.parseExpr();
    this.eat(TT.Semicolon);
    return { type: "expr_stmt", expr };
  }

  // === 変数宣言 ===
  private parseVarDecl(): Stmt {
    const kind = this.advance().value;
    if (kind !== "const" && kind !== "let" && kind !== "var") {
      throw this.error("const/let/var が必要");
    }
    const declarations: VarDeclarator[] = [];
    declarations.push(this.parseVarDeclarator());
    while (this.match(TT.Comma)) {
      declarations.push(this.parseVarDeclarator());
    }
    this.eat(TT.Semicolon);
    return { type: "var_decl", kind, declarations };
  }

  private parseVarDeclarator(): VarDeclarator {
    const name = this.expect(TT.Identifier).value;
    // 型注釈（オプション）
    let typeAnnotation: TypeNode | undefined;
    if (this.match(TT.Colon)) {
      typeAnnotation = this.parseTypeNode();
    }
    // 初期値
    let init: Expr | undefined;
    if (this.match(TT.Eq)) {
      init = this.parseAssignment();
    }
    return { name, typeAnnotation, init };
  }

  // === 関数宣言 ===
  private parseFunctionDecl(exported: boolean): Stmt {
    const async_ = this.match(TT.Async);
    this.expect(TT.Function);
    const name = this.expect(TT.Identifier).value;
    // ジェネリクスをスキップ
    this.skipTypeParams();
    const params = this.parseParams();
    const returnType = this.match(TT.Colon) ? this.parseTypeNode() : undefined;
    const body = this.parseBlockBody();
    return { type: "function_decl", name, params, returnType, body, async: async_, exported };
  }

  // === クラス宣言 ===
  private parseClassDecl(exported: boolean): Stmt {
    this.expect(TT.Class);
    const name = this.expect(TT.Identifier).value;
    this.skipTypeParams();
    let superClass: Expr | undefined;
    if (this.match(TT.Extends)) {
      superClass = this.parsePrimary();
    }
    // implements をスキップ (TS)
    if (this.match(TT.Implements)) {
      this.parseTypeNode();
      while (this.match(TT.Comma)) this.parseTypeNode();
    }
    const members = this.parseClassBody();
    return { type: "class_decl", name, superClass, members, exported };
  }

  private parseClassBody(): ClassMember[] {
    this.expect(TT.LeftBrace);
    const members: ClassMember[] = [];
    while (!this.is(TT.RightBrace) && !this.is(TT.Eof)) {
      members.push(this.parseClassMember());
    }
    this.expect(TT.RightBrace);
    return members;
  }

  private parseClassMember(): ClassMember {
    let static_ = false;
    let accessibility: string | undefined;
    let readonly_ = false;
    let abstract_ = false;
    let async_ = false;

    // 修飾子を読む
    while (true) {
      if (this.is(TT.Public) || this.is(TT.Private) || this.is(TT.Protected)) {
        accessibility = this.advance().value;
      } else if (this.is(TT.Readonly)) {
        readonly_ = true;
        this.advance();
      } else if (this.is(TT.Abstract)) {
        abstract_ = true;
        this.advance();
      } else if (this.isValue("static")) {
        static_ = true;
        this.advance();
      } else if (this.is(TT.Async)) {
        async_ = true;
        this.advance();
      } else {
        break;
      }
    }

    // constructor
    if (this.isValue("constructor")) {
      this.advance();
      const params = this.parseParams();
      const body = this.is(TT.LeftBrace) ? this.parseBlockBody() : undefined;
      return {
        type: "constructor", name: "constructor", params, returnType: undefined,
        body, value: undefined, static: false, accessibility, readonly: false,
        abstract: abstract_, async: false, computed: false,
      };
    }

    // プロパティ名
    const name = this.advance().value;
    // メソッド or プロパティ
    if (this.is(TT.LeftParen) || this.is(TT.Lt)) {
      // メソッド
      this.skipTypeParams();
      const params = this.parseParams();
      const returnType = this.match(TT.Colon) ? this.parseTypeNode() : undefined;
      const body = this.is(TT.LeftBrace) ? this.parseBlockBody() : undefined;
      if (body === undefined) this.eat(TT.Semicolon);
      return {
        type: "method", name, params, returnType, body, value: undefined,
        static: static_, accessibility, readonly: readonly_, abstract: abstract_,
        async: async_, computed: false,
      };
    }

    // プロパティ
    this.match(TT.Question); // optional
    const typeAnnotation = this.match(TT.Colon) ? this.parseTypeNode() : undefined;
    const value = this.match(TT.Eq) ? this.parseAssignment() : undefined;
    this.eat(TT.Semicolon);
    return {
      type: "property", name, params: [], returnType: typeAnnotation, body: undefined,
      value, static: static_, accessibility, readonly: readonly_, abstract: abstract_,
      async: false, computed: false,
    };
  }

  // === import / export ===
  private parseImport(): Stmt {
    this.expect(TT.Import);
    // import type は完全にスキップ (TS)
    if (this.is(TT.Type)) {
      this.advance();
      // 残りを読み飛ばす
      while (!this.is(TT.Semicolon) && !this.is(TT.Eof)) this.advance();
      this.eat(TT.Semicolon);
      return { type: "empty_stmt" };
    }

    const specifiers: ImportSpecifier[] = [];

    if (this.is(TT.LeftBrace)) {
      // import { a, b } from '...'
      this.advance();
      while (!this.is(TT.RightBrace) && !this.is(TT.Eof)) {
        // type 修飾子をスキップ
        if (this.is(TT.Type)) { this.advance(); }
        const imported = this.advance().value;
        let local = imported;
        if (this.match(TT.As)) { local = this.advance().value; }
        specifiers.push({ type: "named", imported, local });
        this.match(TT.Comma);
      }
      this.expect(TT.RightBrace);
    } else if (this.is(TT.Star)) {
      // import * as ns from '...'
      this.advance();
      this.expect(TT.As);
      const local = this.expect(TT.Identifier).value;
      specifiers.push({ type: "namespace", imported: "*", local });
    } else if (this.is(TT.Identifier)) {
      // import defaultExport from '...'
      const local = this.advance().value;
      specifiers.push({ type: "default", imported: "default", local });
      if (this.match(TT.Comma)) {
        // import default, { named } from '...'
        if (this.is(TT.LeftBrace)) {
          this.advance();
          while (!this.is(TT.RightBrace) && !this.is(TT.Eof)) {
            const imported = this.advance().value;
            let localN = imported;
            if (this.match(TT.As)) { localN = this.advance().value; }
            specifiers.push({ type: "named", imported, local: localN });
            this.match(TT.Comma);
          }
          this.expect(TT.RightBrace);
        }
      }
    } else if (this.is(TT.String)) {
      // import '...' (副作用のみ)
      const source = this.advance().value;
      this.eat(TT.Semicolon);
      return { type: "import_decl", specifiers: [], source };
    }

    this.expect(TT.From);
    const source = this.advance().value; // 文字列リテラル
    this.eat(TT.Semicolon);
    return { type: "import_decl", specifiers, source };
  }

  private parseExport(): Stmt {
    this.expect(TT.Export);

    // export default
    if (this.match(TT.Default)) {
      if (this.is(TT.Function) || (this.is(TT.Async) && this.peekNext()?.type === TT.Function)) {
        return { type: "export_default", declaration: this.parseFunctionDecl(true) };
      }
      if (this.is(TT.Class)) {
        return { type: "export_default", declaration: this.parseClassDecl(true) };
      }
      const expr = this.parseExpr();
      this.eat(TT.Semicolon);
      return { type: "export_default", declaration: expr };
    }

    // export type (TS: 完全にスキップ)
    if (this.is(TT.Type) && this.peekNext()?.type === TT.Identifier) {
      return this.parseTypeAlias(true);
    }
    if (this.is(TT.Interface)) return this.parseInterface(true);
    if (this.is(TT.Enum)) return this.parseEnum(true);

    // export function/class/const/let/var
    if (this.is(TT.Function) || (this.is(TT.Async) && this.peekNext()?.type === TT.Function)) {
      return { type: "export_named", declaration: this.parseFunctionDecl(true), specifiers: [] };
    }
    if (this.is(TT.Class)) {
      return { type: "export_named", declaration: this.parseClassDecl(true), specifiers: [] };
    }
    if (this.is(TT.Const) || this.is(TT.Let) || this.is(TT.Var)) {
      return { type: "export_named", declaration: this.parseVarDecl(), specifiers: [] };
    }

    // export { a, b }
    this.expect(TT.LeftBrace);
    const specifiers: ExportSpecifier[] = [];
    while (!this.is(TT.RightBrace) && !this.is(TT.Eof)) {
      const local = this.advance().value;
      let exported = local;
      if (this.match(TT.As)) { exported = this.advance().value; }
      specifiers.push({ local, exported });
      this.match(TT.Comma);
    }
    this.expect(TT.RightBrace);
    this.eat(TT.Semicolon);
    return { type: "export_named", declaration: undefined, specifiers };
  }

  // === TypeScript 固有 ===

  private parseTypeAlias(exported: boolean): Stmt {
    this.expect(TT.Type);
    const name = this.expect(TT.Identifier).value;
    this.skipTypeParams();
    this.expect(TT.Eq);
    const typeNode = this.parseTypeNode();
    this.eat(TT.Semicolon);
    return { type: "type_alias", name, typeNode, exported };
  }

  private parseInterface(exported: boolean): Stmt {
    this.expect(TT.Interface);
    const name = this.expect(TT.Identifier).value;
    this.skipTypeParams();
    if (this.match(TT.Extends)) {
      this.parseTypeNode();
      while (this.match(TT.Comma)) this.parseTypeNode();
    }
    // body をスキップ
    this.skipBlock();
    return { type: "interface_decl", name, members: [], exported };
  }

  private parseEnum(exported: boolean): Stmt {
    this.expect(TT.Enum);
    const name = this.expect(TT.Identifier).value;
    this.expect(TT.LeftBrace);
    const members: EnumMember[] = [];
    while (!this.is(TT.RightBrace) && !this.is(TT.Eof)) {
      const memberName = this.advance().value;
      let value: Expr | undefined;
      if (this.match(TT.Eq)) {
        value = this.parseAssignment();
      }
      this.match(TT.Comma);
      members.push({ name: memberName, value });
    }
    this.expect(TT.RightBrace);
    return { type: "enum_decl", name, members, exported };
  }

  private parseDeclare(): Stmt {
    this.advance(); // declare
    // 残りの宣言をスキップ
    if (this.is(TT.LeftBrace)) {
      this.skipBlock();
    } else {
      while (!this.is(TT.Semicolon) && !this.is(TT.Eof)) {
        if (this.is(TT.LeftBrace)) { this.skipBlock(); return { type: "empty_stmt" }; }
        this.advance();
      }
      this.eat(TT.Semicolon);
    }
    return { type: "empty_stmt" };
  }

  // 型注釈をパース（スキップ用に AST に記録するが、エミット時に無視）
  private parseTypeNode(): TypeNode {
    let left = this.parsePrimaryType();
    // union: A | B
    if (this.is(TT.Pipe)) {
      const types = [left];
      while (this.match(TT.Pipe)) types.push(this.parsePrimaryType());
      left = { type: "union_type", types };
    }
    // intersection: A & B
    if (this.is(TT.Amp)) {
      const types = [left];
      while (this.match(TT.Amp)) types.push(this.parsePrimaryType());
      left = { type: "intersection_type", types };
    }
    // array: T[]
    while (this.is(TT.LeftBracket) && this.peekNext()?.type === TT.RightBracket) {
      this.advance(); this.advance();
      left = { type: "array_type", elementType: left };
    }
    return left;
  }

  private parsePrimaryType(): TypeNode {
    // 括弧
    if (this.match(TT.LeftParen)) {
      const inner = this.parseTypeNode();
      this.expect(TT.RightParen);
      // arrow function type: (a: T) => R
      if (this.match(TT.Arrow)) {
        const returnType = this.parseTypeNode();
        return { type: "function_type", params: [inner], returnType };
      }
      return inner;
    }
    // typeof
    if (this.match(TT.Typeof)) {
      const name = this.advance().value;
      return { type: "type_ref", name: `typeof ${name}`, typeArgs: [] };
    }
    // リテラル型
    if (this.is(TT.String) || this.is(TT.Number) || this.is(TT.True) || this.is(TT.False) || this.is(TT.Null)) {
      return { type: "literal_type", value: this.advance().value };
    }
    // タプル型 [A, B]
    if (this.match(TT.LeftBracket)) {
      const elements: TypeNode[] = [];
      while (!this.is(TT.RightBracket) && !this.is(TT.Eof)) {
        elements.push(this.parseTypeNode());
        this.match(TT.Comma);
      }
      this.expect(TT.RightBracket);
      return { type: "tuple_type", elements };
    }
    // オブジェクト型 { ... }
    if (this.is(TT.LeftBrace)) {
      this.skipBlock();
      return { type: "object_type", members: [] };
    }
    // void
    if (this.match(TT.Void)) {
      return { type: "type_ref", name: "void", typeArgs: [] };
    }
    // 名前付き型: string, number, MyType, Array<T>
    const name = this.advance().value;
    let typeArgs: TypeNode[] = [];
    if (this.is(TT.Lt)) {
      typeArgs = this.parseTypeArgs();
    }
    // qualified: A.B
    if (this.match(TT.Dot)) {
      const right = this.advance().value;
      return { type: "type_ref", name: `${name}.${right}`, typeArgs };
    }
    return { type: "type_ref", name, typeArgs };
  }

  private skipTypeParams(): void {
    if (!this.is(TT.Lt)) return;
    let depth = 0;
    while (!this.is(TT.Eof)) {
      if (this.is(TT.Lt)) depth++;
      if (this.is(TT.Gt)) { depth--; this.advance(); if (depth === 0) return; continue; }
      this.advance();
    }
  }

  private parseTypeArgs(): TypeNode[] {
    const args: TypeNode[] = [];
    if (!this.match(TT.Lt)) return args;
    while (!this.is(TT.Gt) && !this.is(TT.Eof)) {
      args.push(this.parseTypeNode());
      this.match(TT.Comma);
    }
    this.expect(TT.Gt);
    return args;
  }

  // === 制御構造 ===

  private parseIf(): Stmt {
    this.expect(TT.If);
    this.expect(TT.LeftParen);
    const condition = this.parseExpr();
    this.expect(TT.RightParen);
    const consequent = this.parseStmt();
    let alternate: Stmt | undefined;
    if (this.match(TT.Else)) alternate = this.parseStmt();
    return { type: "if_stmt", condition, consequent, alternate };
  }

  private parseFor(): Stmt {
    this.expect(TT.For);
    this.expect(TT.LeftParen);

    // for..of / for..in
    if (this.is(TT.Const) || this.is(TT.Let) || this.is(TT.Var)) {
      const kind = this.peek().value;
      if (kind !== "const" && kind !== "let" && kind !== "var") throw this.error("const/let/var が必要");
      const savedPos = this.pos;
      this.advance(); // const/let/var
      const name = this.expect(TT.Identifier).value;
      if (this.match(TT.Of)) {
        const iterable = this.parseExpr();
        this.expect(TT.RightParen);
        const body = this.parseStmt();
        return { type: "for_of_stmt", kind, name, iterable, body };
      }
      if (this.match(TT.In)) {
        const object = this.parseExpr();
        this.expect(TT.RightParen);
        const body = this.parseStmt();
        return { type: "for_in_stmt", kind, name, object, body };
      }
      // 通常の for — 巻き戻し
      this.pos = savedPos;
    }

    // 通常の for
    const init = this.is(TT.Semicolon) ? undefined : this.parseStmt();
    // init が var_decl なら既に ; を消費済み、そうでなければ消費する
    const condition = this.is(TT.Semicolon) ? undefined : this.parseExpr();
    this.expect(TT.Semicolon);
    const update = this.is(TT.RightParen) ? undefined : this.parseExpr();
    this.expect(TT.RightParen);
    const body = this.parseStmt();
    return { type: "for_stmt", init, condition, update, body };
  }

  private parseWhile(): Stmt {
    this.expect(TT.While);
    this.expect(TT.LeftParen);
    const condition = this.parseExpr();
    this.expect(TT.RightParen);
    return { type: "while_stmt", condition, body: this.parseStmt() };
  }

  private parseDoWhile(): Stmt {
    this.expect(TT.Do);
    const body = this.parseStmt();
    this.expect(TT.While);
    this.expect(TT.LeftParen);
    const condition = this.parseExpr();
    this.expect(TT.RightParen);
    this.eat(TT.Semicolon);
    return { type: "do_while_stmt", condition, body };
  }

  private parseReturn(): Stmt {
    this.expect(TT.Return);
    if (this.is(TT.Semicolon) || this.is(TT.RightBrace)) {
      this.eat(TT.Semicolon);
      return { type: "return_stmt", value: undefined };
    }
    const value = this.parseExpr();
    this.eat(TT.Semicolon);
    return { type: "return_stmt", value };
  }

  private parseThrow(): Stmt {
    this.expect(TT.Throw);
    const expr = this.parseExpr();
    this.eat(TT.Semicolon);
    return { type: "throw_stmt", expr };
  }

  private parseTry(): Stmt {
    this.expect(TT.Try);
    const block = this.parseBlock();
    let catchClause: CatchClause | undefined;
    if (this.match(TT.Catch)) {
      let param: string | undefined;
      if (this.match(TT.LeftParen)) {
        param = this.expect(TT.Identifier).value;
        // 型注釈をスキップ
        if (this.match(TT.Colon)) this.parseTypeNode();
        this.expect(TT.RightParen);
      }
      catchClause = { param, body: this.parseBlock() };
    }
    let finallyBlock: Stmt | undefined;
    if (this.match(TT.Finally)) {
      finallyBlock = this.parseBlock();
    }
    return { type: "try_stmt", block, catchClause, finallyBlock };
  }

  private parseSwitch(): Stmt {
    this.expect(TT.Switch);
    this.expect(TT.LeftParen);
    const discriminant = this.parseExpr();
    this.expect(TT.RightParen);
    this.expect(TT.LeftBrace);
    const cases: SwitchCase[] = [];
    while (!this.is(TT.RightBrace) && !this.is(TT.Eof)) {
      let test: Expr | undefined;
      if (this.match(TT.Case)) {
        test = this.parseExpr();
      } else {
        this.expect(TT.Default);
      }
      this.expect(TT.Colon);
      const body: Stmt[] = [];
      while (!this.is(TT.Case) && !this.is(TT.Default) && !this.is(TT.RightBrace) && !this.is(TT.Eof)) {
        body.push(this.parseStmt());
      }
      cases.push({ test, body });
    }
    this.expect(TT.RightBrace);
    return { type: "switch_stmt", discriminant, cases };
  }

  private parseBlock(): Stmt {
    this.expect(TT.LeftBrace);
    const body: Stmt[] = [];
    while (!this.is(TT.RightBrace) && !this.is(TT.Eof)) {
      body.push(this.parseStmt());
    }
    this.expect(TT.RightBrace);
    return { type: "block", body };
  }

  private parseBlockBody(): Stmt[] {
    this.expect(TT.LeftBrace);
    const body: Stmt[] = [];
    while (!this.is(TT.RightBrace) && !this.is(TT.Eof)) {
      body.push(this.parseStmt());
    }
    this.expect(TT.RightBrace);
    return body;
  }

  // パラメータリスト
  private parseParams(): Param[] {
    this.expect(TT.LeftParen);
    const params: Param[] = [];
    while (!this.is(TT.RightParen) && !this.is(TT.Eof)) {
      // アクセス修飾子 (TS: コンストラクタ引数の省略記法)
      let accessibility: string | undefined;
      let readonly_ = false;
      if (this.is(TT.Public) || this.is(TT.Private) || this.is(TT.Protected)) {
        accessibility = this.advance().value;
      }
      if (this.is(TT.Readonly)) { readonly_ = true; this.advance(); }

      const rest = this.match(TT.DotDotDot);
      const name = this.expect(TT.Identifier).value;
      const optional = this.match(TT.Question);
      const typeAnnotation = this.match(TT.Colon) ? this.parseTypeNode() : undefined;
      const defaultValue = this.match(TT.Eq) ? this.parseAssignment() : undefined;
      params.push({ name, typeAnnotation, optional, defaultValue, rest, accessibility });
      this.match(TT.Comma);
    }
    this.expect(TT.RightParen);
    return params;
  }

  // === 式 ===

  private parseExpr(): Expr {
    return this.parseAssignment();
  }

  private parseAssignment(): Expr {
    const left = this.parseConditional();
    if (this.isAssignOp()) {
      const op = this.advance().value;
      const right = this.parseAssignment();
      return { type: "assignment", op, left, right };
    }
    return left;
  }

  private isAssignOp(): boolean {
    const t = this.peek().type;
    return t === TT.Eq || t === TT.PlusEq || t === TT.MinusEq ||
      t === TT.StarEq || t === TT.SlashEq || t === TT.PercentEq ||
      t === TT.AmpEq || t === TT.PipeEq || t === TT.CaretEq ||
      t === TT.StarStarEq || t === TT.AmpAmpEq || t === TT.PipePipeEq ||
      t === TT.QuestionQuestionEq;
  }

  private parseConditional(): Expr {
    let expr = this.parseNullish();
    if (this.match(TT.Question)) {
      const consequent = this.parseAssignment();
      this.expect(TT.Colon);
      const alternate = this.parseAssignment();
      expr = { type: "conditional", condition: expr, consequent, alternate };
    }
    return expr;
  }

  private parseNullish(): Expr {
    let left = this.parseLogicalOr();
    while (this.match(TT.QuestionQuestion)) {
      left = { type: "binary", op: "??", left, right: this.parseLogicalOr() };
    }
    return left;
  }

  private parseLogicalOr(): Expr {
    let left = this.parseLogicalAnd();
    while (this.match(TT.PipePipe)) {
      left = { type: "binary", op: "||", left, right: this.parseLogicalAnd() };
    }
    return left;
  }

  private parseLogicalAnd(): Expr {
    let left = this.parseBitwiseOr();
    while (this.match(TT.AmpAmp)) {
      left = { type: "binary", op: "&&", left, right: this.parseBitwiseOr() };
    }
    return left;
  }

  private parseBitwiseOr(): Expr {
    let left = this.parseBitwiseXor();
    while (this.match(TT.Pipe)) {
      left = { type: "binary", op: "|", left, right: this.parseBitwiseXor() };
    }
    return left;
  }

  private parseBitwiseXor(): Expr {
    let left = this.parseBitwiseAnd();
    while (this.match(TT.Caret)) {
      left = { type: "binary", op: "^", left, right: this.parseBitwiseAnd() };
    }
    return left;
  }

  private parseBitwiseAnd(): Expr {
    let left = this.parseEquality();
    while (this.match(TT.Amp)) {
      left = { type: "binary", op: "&", left, right: this.parseEquality() };
    }
    return left;
  }

  private parseEquality(): Expr {
    let left = this.parseRelational();
    while (this.is(TT.EqEq) || this.is(TT.BangEq) || this.is(TT.EqEqEq) || this.is(TT.BangEqEq)) {
      const op = this.advance().value;
      left = { type: "binary", op, left, right: this.parseRelational() };
    }
    return left;
  }

  private parseRelational(): Expr {
    let left = this.parseShift();
    while (this.is(TT.Lt) || this.is(TT.Gt) || this.is(TT.LtEq) || this.is(TT.GtEq) ||
           this.is(TT.Instanceof) || this.is(TT.In)) {
      const op = this.advance().value;
      left = { type: "binary", op, left, right: this.parseShift() };
    }
    // TS: as Type → 型を除去
    if (this.match(TT.As)) {
      const typeNode = this.parseTypeNode();
      left = { type: "as_expr", expr: left, typeNode };
    }
    return left;
  }

  private parseShift(): Expr {
    let left = this.parseAdditive();
    while (this.is(TT.LtLt) || this.is(TT.GtGt) || this.is(TT.GtGtGt)) {
      const op = this.advance().value;
      left = { type: "binary", op, left, right: this.parseAdditive() };
    }
    return left;
  }

  private parseAdditive(): Expr {
    let left = this.parseMultiplicative();
    while (this.is(TT.Plus) || this.is(TT.Minus)) {
      const op = this.advance().value;
      left = { type: "binary", op, left, right: this.parseMultiplicative() };
    }
    return left;
  }

  private parseMultiplicative(): Expr {
    let left = this.parseExponential();
    while (this.is(TT.Star) || this.is(TT.Slash) || this.is(TT.Percent)) {
      const op = this.advance().value;
      left = { type: "binary", op, left, right: this.parseExponential() };
    }
    return left;
  }

  private parseExponential(): Expr {
    const left = this.parseUnary();
    if (this.match(TT.StarStar)) {
      return { type: "binary", op: "**", left, right: this.parseExponential() };
    }
    return left;
  }

  private parseUnary(): Expr {
    if (this.is(TT.Bang) || this.is(TT.Minus) || this.is(TT.Plus) || this.is(TT.Tilde) ||
        this.is(TT.Typeof) || this.is(TT.Void) || this.is(TT.Delete)) {
      const op = this.advance().value;
      if (op === "typeof") return { type: "typeof_expr", operand: this.parseUnary() };
      return { type: "unary_prefix", op, operand: this.parseUnary() };
    }
    if (this.is(TT.PlusPlus) || this.is(TT.MinusMinus)) {
      const op = this.advance().value;
      return { type: "unary_prefix", op, operand: this.parseUnary() };
    }
    if (this.match(TT.Await)) {
      return { type: "await_expr", expr: this.parseUnary() };
    }
    return this.parsePostfix();
  }

  private parsePostfix(): Expr {
    let expr = this.parseCallOrMember();
    if (this.is(TT.PlusPlus) || this.is(TT.MinusMinus)) {
      const op = this.advance().value;
      expr = { type: "unary_postfix", op, operand: expr };
    }
    // TS: non-null assertion x!
    if (this.match(TT.Bang)) {
      expr = { type: "non_null", expr };
    }
    return expr;
  }

  private parseCallOrMember(): Expr {
    let expr = this.parsePrimary();

    while (true) {
      if (this.match(TT.Dot)) {
        const prop = this.advance().value;
        expr = { type: "member", object: expr, property: prop, computed: false };
      } else if (this.match(TT.QuestionDot)) {
        const prop = this.advance().value;
        expr = { type: "optional_member", object: expr, property: prop };
      } else if (this.is(TT.LeftBracket)) {
        this.advance();
        const prop = this.parseExpr();
        this.expect(TT.RightBracket);
        expr = { type: "computed_member", object: expr, property: prop };
      } else if (this.is(TT.LeftParen) || this.is(TT.Lt)) {
        // 関数呼び出し（型引数付き含む）
        let typeArgs: TypeNode[] = [];
        if (this.is(TT.Lt)) {
          const savedPos = this.pos;
          try {
            typeArgs = this.parseTypeArgs();
          } catch {
            this.pos = savedPos;
            break;
          }
          if (!this.is(TT.LeftParen)) { this.pos = savedPos; break; }
        }
        this.expect(TT.LeftParen);
        const args: Expr[] = [];
        while (!this.is(TT.RightParen) && !this.is(TT.Eof)) {
          if (this.match(TT.DotDotDot)) {
            args.push({ type: "spread", expr: this.parseAssignment() });
          } else {
            args.push(this.parseAssignment());
          }
          this.match(TT.Comma);
        }
        this.expect(TT.RightParen);
        expr = { type: "call", callee: expr, args, typeArgs };
      } else {
        break;
      }
    }

    return expr;
  }

  private parsePrimary(): Expr {
    // 数値
    if (this.is(TT.Number)) return { type: "number_literal", value: this.advance().value };
    // 文字列
    if (this.is(TT.String)) {
      const token = this.advance();
      return { type: "string_literal", value: token.value, quote: "'" };
    }
    // テンプレートリテラル
    if (this.is(TT.Template)) return { type: "template_literal", value: this.advance().value };
    // true/false
    if (this.is(TT.True)) { this.advance(); return { type: "boolean_literal", value: true }; }
    if (this.is(TT.False)) { this.advance(); return { type: "boolean_literal", value: false }; }
    // null/undefined
    if (this.is(TT.Null)) { this.advance(); return { type: "null_literal" }; }
    if (this.is(TT.Undefined)) { this.advance(); return { type: "undefined_literal" }; }
    // this
    if (this.is(TT.This)) { this.advance(); return { type: "this" }; }
    // new
    if (this.match(TT.New)) {
      const callee = this.parsePrimary();
      let args: Expr[] = [];
      if (this.match(TT.LeftParen)) {
        while (!this.is(TT.RightParen) && !this.is(TT.Eof)) {
          args.push(this.parseAssignment());
          this.match(TT.Comma);
        }
        this.expect(TT.RightParen);
      }
      return { type: "new_expr", callee, args };
    }
    // 配列リテラル
    if (this.match(TT.LeftBracket)) {
      const elements: Expr[] = [];
      while (!this.is(TT.RightBracket) && !this.is(TT.Eof)) {
        if (this.match(TT.DotDotDot)) {
          elements.push({ type: "spread", expr: this.parseAssignment() });
        } else {
          elements.push(this.parseAssignment());
        }
        this.match(TT.Comma);
      }
      this.expect(TT.RightBracket);
      return { type: "array_literal", elements };
    }
    // オブジェクトリテラル
    if (this.is(TT.LeftBrace)) return this.parseObjectLiteral();
    // 括弧 or アロー関数
    if (this.is(TT.LeftParen)) return this.parseParenOrArrow();
    // 識別子
    if (this.is(TT.Identifier)) {
      const name = this.advance().value;
      // アロー関数: x =>
      if (this.is(TT.Arrow)) {
        this.advance();
        const body = this.is(TT.LeftBrace) ? this.parseBlock() : this.parseAssignment();
        return { type: "arrow_function", params: [{ name, typeAnnotation: undefined, optional: false, defaultValue: undefined, rest: false, accessibility: undefined }], returnType: undefined, body, async: false };
      }
      return { type: "identifier", name };
    }
    // async アロー関数
    if (this.is(TT.Async) && this.peekNext()?.type === TT.LeftParen) {
      this.advance();
      return this.parseArrowFunction(true);
    }

    throw this.error(`式が必要: ${this.peek().value || this.peek().type}`);
  }

  private parseObjectLiteral(): Expr {
    this.expect(TT.LeftBrace);
    const properties: ObjProperty[] = [];
    while (!this.is(TT.RightBrace) && !this.is(TT.Eof)) {
      // スプレッド: ...expr
      if (this.match(TT.DotDotDot)) {
        properties.push({ key: "", value: this.parseAssignment(), computed: false, spread: true, method: false });
        this.match(TT.Comma);
        continue;
      }
      // computed: [expr]: value
      const computed = this.is(TT.LeftBracket);
      let key: string | Expr;
      if (computed) {
        this.advance();
        key = this.parseExpr();
        this.expect(TT.RightBracket);
      } else {
        key = this.advance().value;
      }
      // method: key(params) { ... }
      if (this.is(TT.LeftParen)) {
        const params = this.parseParams();
        const body = this.parseBlockBody();
        const methodExpr: Expr = { type: "function_expr", name: undefined, params, returnType: undefined, body, async: false };
        properties.push({ key, value: methodExpr, computed, spread: false, method: true });
        this.match(TT.Comma);
        continue;
      }
      if (this.match(TT.Colon)) {
        properties.push({ key, value: this.parseAssignment(), computed, spread: false, method: false });
      } else {
        // shorthand: { x }
        properties.push({ key, value: undefined, computed: false, spread: false, method: false });
      }
      this.match(TT.Comma);
    }
    this.expect(TT.RightBrace);
    return { type: "object_literal", properties };
  }

  private parseParenOrArrow(): Expr {
    // (expr) or (params) => body のどちらか判定
    const savedPos = this.pos;
    try {
      return this.parseArrowFunction(false);
    } catch {
      this.pos = savedPos;
      // 通常の括弧
      this.expect(TT.LeftParen);
      const expr = this.parseExpr();
      this.expect(TT.RightParen);
      return { type: "paren", expr };
    }
  }

  private parseArrowFunction(async_: boolean): Expr {
    const params = this.parseParams();
    const returnType = this.match(TT.Colon) ? this.parseTypeNode() : undefined;
    this.expect(TT.Arrow);
    const body = this.is(TT.LeftBrace) ? this.parseBlock() : this.parseAssignment();
    return { type: "arrow_function", params, returnType, body, async: async_ };
  }

  // === ユーティリティ ===

  private peek(): Token {
    return this.tokens[this.pos] ?? { type: TT.Eof, value: "", line: 0, col: 0 };
  }

  private peekNext(): Token | undefined {
    return this.tokens[this.pos + 1];
  }

  private advance(): Token {
    const t = this.peek();
    this.pos++;
    return t;
  }

  private is(type: TT): boolean {
    return this.peek().type === type;
  }

  private isValue(value: string): boolean {
    return this.peek().value === value;
  }

  private match(type: TT): boolean {
    if (this.is(type)) { this.advance(); return true; }
    return false;
  }

  private expect(type: TT): Token {
    if (!this.is(type)) throw this.error(`'${type}' が必要ですが '${this.peek().value || this.peek().type}' が見つかりました`);
    return this.advance();
  }

  private eat(type: TT): void {
    this.match(type);
  }

  private skipBlock(): void {
    this.expect(TT.LeftBrace);
    let depth = 1;
    while (depth > 0 && !this.is(TT.Eof)) {
      if (this.is(TT.LeftBrace)) depth++;
      if (this.is(TT.RightBrace)) depth--;
      if (depth > 0) this.advance();
    }
    this.expect(TT.RightBrace);
  }

  private error(msg: string): Error {
    const t = this.peek();
    return new Error(`パースエラー (${String(t.line)}:${String(t.col)}): ${msg}`);
  }
}
