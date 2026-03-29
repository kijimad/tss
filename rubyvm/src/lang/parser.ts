// Rubyパーサー: トークン列をAST（抽象構文木）に変換する

import { Token, TokenType } from './lexer.js';

/** ASTノードの種類 */
export type ASTNode =
  | ProgramNode
  | ClassDefNode
  | MethodDefNode
  | IfNode
  | WhileNode
  | BlockNode
  | AssignNode
  | MethodCallNode
  | BinaryOpNode
  | UnaryOpNode
  | NumberLitNode
  | StringLitNode
  | StringInterpNode
  | SymbolLitNode
  | ArrayLitNode
  | HashLitNode
  | IdentNode
  | SelfNode
  | NilLitNode
  | BoolLitNode
  | ReturnNode
  | YieldNode;

/** プログラム全体 */
export interface ProgramNode {
  kind: 'program';
  body: ASTNode[];
}

/** クラス定義 */
export interface ClassDefNode {
  kind: 'class_def';
  name: string;
  superclass: string | null;
  body: ASTNode[];
}

/** メソッド定義 */
export interface MethodDefNode {
  kind: 'method_def';
  name: string;
  params: string[];
  body: ASTNode[];
}

/** if/elsif/else */
export interface IfNode {
  kind: 'if';
  condition: ASTNode;
  then: ASTNode[];
  elsifClauses: { condition: ASTNode; body: ASTNode[] }[];
  elseBody: ASTNode[] | null;
}

/** while */
export interface WhileNode {
  kind: 'while';
  condition: ASTNode;
  body: ASTNode[];
}

/** ブロック（do..end または {..}） */
export interface BlockNode {
  kind: 'block';
  params: string[];
  body: ASTNode[];
}

/** 代入 */
export interface AssignNode {
  kind: 'assign';
  name: string;
  value: ASTNode;
}

/** メソッド呼び出し */
export interface MethodCallNode {
  kind: 'method_call';
  receiver: ASTNode | null;
  name: string;
  args: ASTNode[];
  block: BlockNode | null;
}

/** 二項演算 */
export interface BinaryOpNode {
  kind: 'binary_op';
  op: string;
  left: ASTNode;
  right: ASTNode;
}

/** 単項演算 */
export interface UnaryOpNode {
  kind: 'unary_op';
  op: string;
  operand: ASTNode;
}

/** 数値リテラル */
export interface NumberLitNode {
  kind: 'number';
  value: number;
}

/** 文字列リテラル */
export interface StringLitNode {
  kind: 'string';
  value: string;
}

/** 文字列補間 */
export interface StringInterpNode {
  kind: 'string_interp';
  parts: ASTNode[];
}

/** シンボルリテラル */
export interface SymbolLitNode {
  kind: 'symbol';
  name: string;
}

/** 配列リテラル */
export interface ArrayLitNode {
  kind: 'array';
  elements: ASTNode[];
}

/** ハッシュリテラル */
export interface HashLitNode {
  kind: 'hash';
  pairs: { key: ASTNode; value: ASTNode }[];
}

/** 識別子 */
export interface IdentNode {
  kind: 'ident';
  name: string;
}

/** self */
export interface SelfNode {
  kind: 'self';
}

/** nil */
export interface NilLitNode {
  kind: 'nil';
}

/** true/false */
export interface BoolLitNode {
  kind: 'bool';
  value: boolean;
}

/** return文 */
export interface ReturnNode {
  kind: 'return';
  value: ASTNode | null;
}

/** yield文 */
export interface YieldNode {
  kind: 'yield';
  args: ASTNode[];
}

/** パーサー: トークン列をASTに変換する */
export class Parser {
  private tokens: Token[];
  private pos: number = 0;

  constructor(tokens: Token[]) {
    // 改行・EOFは意味があるのでフィルタしない
    this.tokens = tokens;
  }

  /** プログラム全体をパースする */
  parse(): ProgramNode {
    this.skipNewlines();
    const body: ASTNode[] = [];
    while (!this.isAtEnd()) {
      body.push(this.parseStatement());
      this.skipNewlines();
    }
    return { kind: 'program', body };
  }

  /** 文をパースする */
  private parseStatement(): ASTNode {
    const tok = this.current();

    switch (tok.type) {
      case TokenType.CLASS:
        return this.parseClassDef();
      case TokenType.DEF:
        return this.parseMethodDef();
      case TokenType.IF:
        return this.parseIf();
      case TokenType.WHILE:
        return this.parseWhile();
      case TokenType.RETURN:
        return this.parseReturn();
      case TokenType.YIELD:
        return this.parseYield();
      default:
        return this.parseExpression();
    }
  }

  /** クラス定義をパースする */
  private parseClassDef(): ClassDefNode {
    this.expect(TokenType.CLASS);
    const name = this.expect(TokenType.IDENT).value;
    let superclass: string | null = null;

    // 継承 (< SuperClass)
    if (this.check(TokenType.LT)) {
      this.advance();
      superclass = this.expect(TokenType.IDENT).value;
    }

    this.skipNewlines();
    const body: ASTNode[] = [];
    while (!this.check(TokenType.END) && !this.isAtEnd()) {
      body.push(this.parseStatement());
      this.skipNewlines();
    }
    this.expect(TokenType.END);
    this.skipTerminator();
    return { kind: 'class_def', name, superclass, body };
  }

  /** メソッド定義をパースする */
  private parseMethodDef(): MethodDefNode {
    this.expect(TokenType.DEF);
    const name = this.expect(TokenType.IDENT).value;
    const params: string[] = [];

    // 引数リスト
    if (this.check(TokenType.LPAREN)) {
      this.advance();
      if (!this.check(TokenType.RPAREN)) {
        params.push(this.expect(TokenType.IDENT).value);
        while (this.check(TokenType.COMMA)) {
          this.advance();
          params.push(this.expect(TokenType.IDENT).value);
        }
      }
      this.expect(TokenType.RPAREN);
    }

    this.skipNewlines();
    const body: ASTNode[] = [];
    while (!this.check(TokenType.END) && !this.isAtEnd()) {
      body.push(this.parseStatement());
      this.skipNewlines();
    }
    this.expect(TokenType.END);
    this.skipTerminator();
    return { kind: 'method_def', name, params, body };
  }

  /** if/elsif/elseをパースする */
  private parseIf(): IfNode {
    this.expect(TokenType.IF);
    const condition = this.parseExpression();
    this.skipNewlines();

    const then: ASTNode[] = [];
    while (!this.check(TokenType.ELSIF) && !this.check(TokenType.ELSE) && !this.check(TokenType.END) && !this.isAtEnd()) {
      then.push(this.parseStatement());
      this.skipNewlines();
    }

    const elsifClauses: { condition: ASTNode; body: ASTNode[] }[] = [];
    while (this.check(TokenType.ELSIF)) {
      this.advance();
      const elsifCond = this.parseExpression();
      this.skipNewlines();
      const elsifBody: ASTNode[] = [];
      while (!this.check(TokenType.ELSIF) && !this.check(TokenType.ELSE) && !this.check(TokenType.END) && !this.isAtEnd()) {
        elsifBody.push(this.parseStatement());
        this.skipNewlines();
      }
      elsifClauses.push({ condition: elsifCond, body: elsifBody });
    }

    let elseBody: ASTNode[] | null = null;
    if (this.check(TokenType.ELSE)) {
      this.advance();
      this.skipNewlines();
      elseBody = [];
      while (!this.check(TokenType.END) && !this.isAtEnd()) {
        elseBody.push(this.parseStatement());
        this.skipNewlines();
      }
    }

    this.expect(TokenType.END);
    this.skipTerminator();
    return { kind: 'if', condition, then, elsifClauses, elseBody };
  }

  /** whileをパースする */
  private parseWhile(): WhileNode {
    this.expect(TokenType.WHILE);
    const condition = this.parseExpression();
    this.skipNewlines();

    const body: ASTNode[] = [];
    while (!this.check(TokenType.END) && !this.isAtEnd()) {
      body.push(this.parseStatement());
      this.skipNewlines();
    }
    this.expect(TokenType.END);
    this.skipTerminator();
    return { kind: 'while', condition, body };
  }

  /** return文をパースする */
  private parseReturn(): ReturnNode {
    this.expect(TokenType.RETURN);
    let value: ASTNode | null = null;
    if (!this.check(TokenType.NEWLINE) && !this.check(TokenType.EOF) && !this.check(TokenType.END)) {
      value = this.parseExpression();
    }
    this.skipTerminator();
    return { kind: 'return', value };
  }

  /** yield文をパースする */
  private parseYield(): YieldNode {
    this.expect(TokenType.YIELD);
    const args: ASTNode[] = [];

    // 引数がある場合
    if (!this.check(TokenType.NEWLINE) && !this.check(TokenType.EOF) && !this.check(TokenType.END)) {
      if (this.check(TokenType.LPAREN)) {
        this.advance();
        if (!this.check(TokenType.RPAREN)) {
          args.push(this.parseExpression());
          while (this.check(TokenType.COMMA)) {
            this.advance();
            args.push(this.parseExpression());
          }
        }
        this.expect(TokenType.RPAREN);
      } else {
        args.push(this.parseExpression());
        while (this.check(TokenType.COMMA)) {
          this.advance();
          args.push(this.parseExpression());
        }
      }
    }

    this.skipTerminator();
    return { kind: 'yield', args };
  }

  /** 式をパースする（代入も含む） */
  private parseExpression(): ASTNode {
    return this.parseAssignOrOr();
  }

  /** 代入またはOR演算 */
  private parseAssignOrOr(): ASTNode {
    const left = this.parseOr();

    // 代入
    if (this.check(TokenType.EQ) && left.kind === 'ident') {
      this.advance();
      const value = this.parseExpression();
      return { kind: 'assign', name: left.name, value };
    }

    return left;
  }

  /** 論理OR */
  private parseOr(): ASTNode {
    let left = this.parseAnd();
    while (this.check(TokenType.OR)) {
      this.advance();
      const right = this.parseAnd();
      left = { kind: 'binary_op', op: '||', left, right };
    }
    return left;
  }

  /** 論理AND */
  private parseAnd(): ASTNode {
    let left = this.parseEquality();
    while (this.check(TokenType.AND)) {
      this.advance();
      const right = this.parseEquality();
      left = { kind: 'binary_op', op: '&&', left, right };
    }
    return left;
  }

  /** 等値比較 */
  private parseEquality(): ASTNode {
    let left = this.parseComparison();
    while (this.check(TokenType.EQEQ) || this.check(TokenType.NEQ)) {
      const op = this.advance().value;
      const right = this.parseComparison();
      left = { kind: 'binary_op', op, left, right };
    }
    return left;
  }

  /** 大小比較 */
  private parseComparison(): ASTNode {
    let left = this.parseAddSub();
    while (this.check(TokenType.LT) || this.check(TokenType.GT) || this.check(TokenType.LTEQ) || this.check(TokenType.GTEQ)) {
      const op = this.advance().value;
      const right = this.parseAddSub();
      left = { kind: 'binary_op', op, left, right };
    }
    return left;
  }

  /** 加減算 */
  private parseAddSub(): ASTNode {
    let left = this.parseMulDiv();
    while (this.check(TokenType.PLUS) || this.check(TokenType.MINUS)) {
      const op = this.advance().value;
      const right = this.parseMulDiv();
      left = { kind: 'binary_op', op, left, right };
    }
    return left;
  }

  /** 乗除算 */
  private parseMulDiv(): ASTNode {
    let left = this.parseUnary();
    while (this.check(TokenType.STAR) || this.check(TokenType.SLASH) || this.check(TokenType.PERCENT)) {
      const op = this.advance().value;
      const right = this.parseUnary();
      left = { kind: 'binary_op', op, left, right };
    }
    return left;
  }

  /** 単項演算 */
  private parseUnary(): ASTNode {
    if (this.check(TokenType.MINUS)) {
      this.advance();
      const operand = this.parseUnary();
      return { kind: 'unary_op', op: '-', operand };
    }
    if (this.check(TokenType.NOT)) {
      this.advance();
      const operand = this.parseUnary();
      return { kind: 'unary_op', op: '!', operand };
    }
    return this.parsePostfix();
  }

  /** 後置演算（メソッド呼び出しチェーン、添字アクセス） */
  private parsePostfix(): ASTNode {
    let node = this.parsePrimary();

    while (true) {
      if (this.check(TokenType.DOT)) {
        this.advance();
        const methodName = this.expect(TokenType.IDENT).value;
        const args = this.parseCallArgs();
        const block = this.tryParseBlock();
        node = { kind: 'method_call', receiver: node, name: methodName, args, block };
      } else if (this.check(TokenType.LBRACKET)) {
        // 添字アクセス arr[i]
        this.advance();
        const index = this.parseExpression();
        this.expect(TokenType.RBRACKET);
        node = { kind: 'method_call', receiver: node, name: '[]', args: [index], block: null };
      } else {
        break;
      }
    }

    return node;
  }

  /** 一次式をパースする */
  private parsePrimary(): ASTNode {
    const tok = this.current();

    switch (tok.type) {
      case TokenType.NUMBER:
        this.advance();
        return { kind: 'number', value: parseFloat(tok.value) };

      case TokenType.STRING:
        this.advance();
        return { kind: 'string', value: tok.value };

      case TokenType.STRING_BEGIN:
        return this.parseStringInterp();

      case TokenType.SYMBOL:
        this.advance();
        return { kind: 'symbol', name: tok.value };

      case TokenType.NIL:
        this.advance();
        return { kind: 'nil' };

      case TokenType.TRUE:
        this.advance();
        return { kind: 'bool', value: true };

      case TokenType.FALSE:
        this.advance();
        return { kind: 'bool', value: false };

      case TokenType.SELF:
        this.advance();
        return { kind: 'self' };

      case TokenType.LBRACKET:
        return this.parseArrayLiteral();

      case TokenType.LBRACE:
        return this.parseHashLiteral();

      case TokenType.LPAREN:
        this.advance();
        const expr = this.parseExpression();
        this.expect(TokenType.RPAREN);
        return expr;

      case TokenType.PUTS: {
        this.advance();
        const args = this.parseArgsWithoutParens();
        const block = this.tryParseBlock();
        return { kind: 'method_call', receiver: null, name: 'puts', args, block };
      }

      case TokenType.IDENT: {
        const name = tok.value;
        this.advance();

        // 関数呼び出しかチェック
        if (this.check(TokenType.LPAREN)) {
          const args = this.parseCallArgs();
          const block = this.tryParseBlock();
          return { kind: 'method_call', receiver: null, name, args, block };
        }

        // ブロック付きメソッド呼び出し（引数なし）
        if (this.check(TokenType.DO) || this.check(TokenType.LBRACE)) {
          const block = this.tryParseBlock();
          if (block) {
            return { kind: 'method_call', receiver: null, name, args: [], block };
          }
        }

        return { kind: 'ident', name };
      }

      default:
        // 不明なトークンの場合はnilとして扱う
        this.advance();
        return { kind: 'nil' };
    }
  }

  /** 文字列補間をパースする */
  private parseStringInterp(): StringInterpNode {
    this.expect(TokenType.STRING_BEGIN);
    const parts: ASTNode[] = [];

    while (!this.check(TokenType.STRING_END) && !this.isAtEnd()) {
      if (this.check(TokenType.STRING)) {
        parts.push({ kind: 'string', value: this.advance().value });
      } else if (this.check(TokenType.INTERP_BEGIN)) {
        this.advance();
        parts.push(this.parseExpression());
        this.expect(TokenType.INTERP_END);
      } else {
        break;
      }
    }

    this.expect(TokenType.STRING_END);
    return { kind: 'string_interp', parts };
  }

  /** 配列リテラルをパースする */
  private parseArrayLiteral(): ArrayLitNode {
    this.expect(TokenType.LBRACKET);
    const elements: ASTNode[] = [];

    if (!this.check(TokenType.RBRACKET)) {
      elements.push(this.parseExpression());
      while (this.check(TokenType.COMMA)) {
        this.advance();
        if (this.check(TokenType.RBRACKET)) break; // 末尾カンマ対応
        elements.push(this.parseExpression());
      }
    }

    this.expect(TokenType.RBRACKET);
    return { kind: 'array', elements };
  }

  /** ハッシュリテラルをパースする */
  private parseHashLiteral(): HashLitNode {
    this.expect(TokenType.LBRACE);
    const pairs: { key: ASTNode; value: ASTNode }[] = [];

    if (!this.check(TokenType.RBRACE)) {
      pairs.push(this.parseHashPair());
      while (this.check(TokenType.COMMA)) {
        this.advance();
        if (this.check(TokenType.RBRACE)) break;
        pairs.push(this.parseHashPair());
      }
    }

    this.expect(TokenType.RBRACE);
    return { kind: 'hash', pairs };
  }

  /** ハッシュのキー・値ペアをパースする */
  private parseHashPair(): { key: ASTNode; value: ASTNode } {
    const key = this.parseExpression();
    this.expect(TokenType.HASHROCKET);
    const value = this.parseExpression();
    return { key, value };
  }

  /** 括弧付き引数リストをパースする */
  private parseCallArgs(): ASTNode[] {
    const args: ASTNode[] = [];
    if (this.check(TokenType.LPAREN)) {
      this.advance();
      if (!this.check(TokenType.RPAREN)) {
        args.push(this.parseExpression());
        while (this.check(TokenType.COMMA)) {
          this.advance();
          args.push(this.parseExpression());
        }
      }
      this.expect(TokenType.RPAREN);
    }
    return args;
  }

  /** 括弧なし引数リスト（putsなど） */
  private parseArgsWithoutParens(): ASTNode[] {
    const args: ASTNode[] = [];
    if (this.check(TokenType.LPAREN)) {
      return this.parseCallArgs();
    }

    // 改行・EOF・endの前まで引数として扱う
    if (!this.check(TokenType.NEWLINE) && !this.check(TokenType.EOF) && !this.check(TokenType.END) && !this.check(TokenType.DO)) {
      args.push(this.parseExpression());
      while (this.check(TokenType.COMMA)) {
        this.advance();
        args.push(this.parseExpression());
      }
    }
    return args;
  }

  /** ブロック（do..end または {..}）のパースを試みる */
  private tryParseBlock(): BlockNode | null {
    if (this.check(TokenType.DO)) {
      this.advance();
      const params = this.parseBlockParams();
      this.skipNewlines();
      const body: ASTNode[] = [];
      while (!this.check(TokenType.END) && !this.isAtEnd()) {
        body.push(this.parseStatement());
        this.skipNewlines();
      }
      this.expect(TokenType.END);
      return { kind: 'block', params, body };
    }

    if (this.check(TokenType.LBRACE)) {
      this.advance();
      const params = this.parseBlockParams();
      this.skipNewlines();
      const body: ASTNode[] = [];
      while (!this.check(TokenType.RBRACE) && !this.isAtEnd()) {
        body.push(this.parseStatement());
        this.skipNewlines();
      }
      this.expect(TokenType.RBRACE);
      return { kind: 'block', params, body };
    }

    return null;
  }

  /** ブロック引数 |x, y| をパースする */
  private parseBlockParams(): string[] {
    const params: string[] = [];
    if (this.check(TokenType.PIPE)) {
      this.advance();
      if (!this.check(TokenType.PIPE)) {
        params.push(this.expect(TokenType.IDENT).value);
        while (this.check(TokenType.COMMA)) {
          this.advance();
          params.push(this.expect(TokenType.IDENT).value);
        }
      }
      this.expect(TokenType.PIPE);
    }
    return params;
  }

  // === ヘルパーメソッド ===

  /** 現在のトークンを返す */
  private current(): Token {
    return this.tokens[this.pos] ?? { type: TokenType.EOF, value: '', line: 0, column: 0 };
  }

  /** 指定タイプかチェックする */
  private check(type: TokenType): boolean {
    return this.current().type === type;
  }

  /** 終端かどうか */
  private isAtEnd(): boolean {
    return this.current().type === TokenType.EOF;
  }

  /** トークンを1つ進めて返す */
  private advance(): Token {
    const tok = this.current();
    this.pos++;
    return tok;
  }

  /** 期待するトークンタイプを消費する */
  private expect(type: TokenType): Token {
    const tok = this.current();
    if (tok.type !== type) {
      throw new Error(`パースエラー: ${type} が期待されましたが ${tok.type}("${tok.value}") でした (行 ${tok.line})`);
    }
    return this.advance();
  }

  /** 改行を読み飛ばす */
  private skipNewlines(): void {
    while (this.check(TokenType.NEWLINE) || this.check(TokenType.SEMICOLON)) {
      this.advance();
    }
  }

  /** 文の終端子（改行・セミコロン）をスキップする */
  private skipTerminator(): void {
    while (this.check(TokenType.NEWLINE) || this.check(TokenType.SEMICOLON)) {
      this.advance();
    }
  }
}
