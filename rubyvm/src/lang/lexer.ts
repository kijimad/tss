// Rubyレキサー: ソースコードをトークン列に変換する

/** トークンの種類 */
export enum TokenType {
  // キーワード
  DEF = 'DEF',
  END = 'END',
  CLASS = 'CLASS',
  IF = 'IF',
  ELSIF = 'ELSIF',
  ELSE = 'ELSE',
  WHILE = 'WHILE',
  DO = 'DO',
  PUTS = 'PUTS',
  REQUIRE = 'REQUIRE',
  RETURN = 'RETURN',
  NIL = 'NIL',
  TRUE = 'TRUE',
  FALSE = 'FALSE',
  SELF = 'SELF',
  YIELD = 'YIELD',

  // リテラル・識別子
  NUMBER = 'NUMBER',
  STRING = 'STRING',
  SYMBOL = 'SYMBOL',
  IDENT = 'IDENT',

  // 文字列補間部品
  STRING_BEGIN = 'STRING_BEGIN',
  STRING_END = 'STRING_END',
  INTERP_BEGIN = 'INTERP_BEGIN',
  INTERP_END = 'INTERP_END',

  // 演算子・区切り文字
  PLUS = 'PLUS',
  MINUS = 'MINUS',
  STAR = 'STAR',
  SLASH = 'SLASH',
  PERCENT = 'PERCENT',
  EQ = 'EQ',
  EQEQ = 'EQEQ',
  NEQ = 'NEQ',
  LT = 'LT',
  GT = 'GT',
  LTEQ = 'LTEQ',
  GTEQ = 'GTEQ',
  AND = 'AND',
  OR = 'OR',
  NOT = 'NOT',
  DOT = 'DOT',
  COMMA = 'COMMA',
  COLON = 'COLON',
  SEMICOLON = 'SEMICOLON',
  LPAREN = 'LPAREN',
  RPAREN = 'RPAREN',
  LBRACKET = 'LBRACKET',
  RBRACKET = 'RBRACKET',
  LBRACE = 'LBRACE',
  RBRACE = 'RBRACE',
  PIPE = 'PIPE',
  ARROW = 'ARROW',
  HASHROCKET = 'HASHROCKET',

  // 改行（Rubyでは文の区切りとして意味を持つ）
  NEWLINE = 'NEWLINE',

  // 終端
  EOF = 'EOF',
}

/** キーワードマッピング */
const KEYWORDS: Record<string, TokenType> = {
  def: TokenType.DEF,
  end: TokenType.END,
  class: TokenType.CLASS,
  if: TokenType.IF,
  elsif: TokenType.ELSIF,
  else: TokenType.ELSE,
  while: TokenType.WHILE,
  do: TokenType.DO,
  puts: TokenType.PUTS,
  require: TokenType.REQUIRE,
  return: TokenType.RETURN,
  nil: TokenType.NIL,
  true: TokenType.TRUE,
  false: TokenType.FALSE,
  self: TokenType.SELF,
  yield: TokenType.YIELD,
};

/** トークン */
export interface Token {
  type: TokenType;
  value: string;
  line: number;
  column: number;
}

/** レキサー：Rubyソースコードをトークンに分割する */
export class Lexer {
  private source: string;
  private pos: number = 0;
  private line: number = 1;
  private column: number = 1;
  private tokens: Token[] = [];

  constructor(source: string) {
    this.source = source;
  }

  /** 全トークンを生成して返す */
  tokenize(): Token[] {
    this.tokens = [];
    this.pos = 0;
    this.line = 1;
    this.column = 1;

    while (this.pos < this.source.length) {
      this.skipWhitespaceAndComments();
      if (this.pos >= this.source.length) break;

      const ch = this.current();

      // 改行
      if (ch === '\n') {
        this.addToken(TokenType.NEWLINE, '\n');
        this.advance();
        this.line++;
        this.column = 1;
        // 連続改行をスキップ
        while (this.pos < this.source.length && this.current() === '\n') {
          this.advance();
          this.line++;
          this.column = 1;
        }
        continue;
      }

      // 数値リテラル
      if (this.isDigit(ch)) {
        this.readNumber();
        continue;
      }

      // 文字列リテラル（ダブルクォート：補間あり）
      if (ch === '"') {
        this.readInterpolatedString();
        continue;
      }

      // 文字列リテラル（シングルクォート：補間なし）
      if (ch === "'") {
        this.readSimpleString();
        continue;
      }

      // シンボル
      if (ch === ':' && this.pos + 1 < this.source.length && this.isAlpha(this.peek(1))) {
        this.readSymbol();
        continue;
      }

      // 識別子・キーワード
      if (this.isAlpha(ch) || ch === '_') {
        this.readIdentifier();
        continue;
      }

      // 演算子・区切り文字
      this.readOperator();
    }

    this.addToken(TokenType.EOF, '');
    return this.tokens;
  }

  /** 現在の文字を返す */
  private current(): string {
    return this.source[this.pos] ?? '';
  }

  /** 指定オフセット先の文字を返す */
  private peek(offset: number): string {
    return this.source[this.pos + offset] ?? '';
  }

  /** 位置を1つ進める */
  private advance(): string {
    const ch = this.current();
    this.pos++;
    this.column++;
    return ch;
  }

  /** トークンを追加する */
  private addToken(type: TokenType, value: string): void {
    this.tokens.push({ type, value, line: this.line, column: this.column });
  }

  /** 空白とコメントをスキップする */
  private skipWhitespaceAndComments(): void {
    while (this.pos < this.source.length) {
      const ch = this.current();
      // 空白（改行以外）をスキップ
      if (ch === ' ' || ch === '\t' || ch === '\r') {
        this.advance();
        continue;
      }
      // コメント (#から行末まで)
      if (ch === '#') {
        while (this.pos < this.source.length && this.current() !== '\n') {
          this.advance();
        }
        continue;
      }
      break;
    }
  }

  /** 数値を読み取る */
  private readNumber(): void {
    const startCol = this.column;
    let num = '';
    while (this.pos < this.source.length && this.isDigit(this.current())) {
      num += this.advance();
    }
    // 小数点
    if (this.current() === '.' && this.isDigit(this.peek(1))) {
      num += this.advance(); // '.'
      while (this.pos < this.source.length && this.isDigit(this.current())) {
        num += this.advance();
      }
    }
    this.tokens.push({ type: TokenType.NUMBER, value: num, line: this.line, column: startCol });
  }

  /** 補間つき文字列（ダブルクォート）を読み取る */
  private readInterpolatedString(): void {
    const startCol = this.column;
    this.advance(); // '"'を消費

    // 補間がない場合は単純な文字列として返す
    let str = '';
    let hasInterpolation = false;

    // まず補間があるか事前にチェック
    const savedPos = this.pos;
    const savedCol = this.column;
    while (savedPos + (this.pos - savedPos) < this.source.length) {
      const scanCh = this.source[this.pos] ?? '';
      if (scanCh === '\\') {
        this.pos += 2;
        this.column += 2;
        continue;
      }
      if (scanCh === '#' && (this.source[this.pos + 1] ?? '') === '{') {
        hasInterpolation = true;
        break;
      }
      if (scanCh === '"') break;
      this.pos++;
      this.column++;
    }

    // 位置を戻す
    this.pos = savedPos;
    this.column = savedCol;

    if (!hasInterpolation) {
      // 補間なし：通常の文字列として読み取る
      while (this.pos < this.source.length && this.current() !== '"') {
        if (this.current() === '\\') {
          this.advance();
          str += this.readEscapeChar();
        } else {
          str += this.advance();
        }
      }
      if (this.current() === '"') this.advance(); // 閉じ引用符
      this.tokens.push({ type: TokenType.STRING, value: str, line: this.line, column: startCol });
    } else {
      // 補間あり：STRING_BEGIN, 内容, INTERP_BEGIN/END, STRING_END
      this.tokens.push({ type: TokenType.STRING_BEGIN, value: '"', line: this.line, column: startCol });

      while (this.pos < this.source.length && this.current() !== '"') {
        if (this.current() === '#' && this.peek(1) === '{') {
          // 補間前の文字列部分を出力
          if (str.length > 0) {
            this.tokens.push({ type: TokenType.STRING, value: str, line: this.line, column: this.column });
            str = '';
          }
          this.advance(); // '#'
          this.advance(); // '{'
          this.tokens.push({ type: TokenType.INTERP_BEGIN, value: '#{', line: this.line, column: this.column });

          // 補間内部をトークン化（'}'まで）
          let braceDepth = 1;
          while (this.pos < this.source.length && braceDepth > 0) {
            this.skipWhitespaceAndComments();
            if (this.current() === '}') {
              braceDepth--;
              if (braceDepth === 0) {
                this.tokens.push({ type: TokenType.INTERP_END, value: '}', line: this.line, column: this.column });
                this.advance();
                break;
              }
            }
            if (this.current() === '{') braceDepth++;

            // 補間内部のトークンを読み取る
            if (braceDepth > 0) {
              const ch = this.current();
              if (this.isDigit(ch)) {
                this.readNumber();
              } else if (this.isAlpha(ch) || ch === '_') {
                this.readIdentifier();
              } else {
                this.readOperator();
              }
            }
          }
        } else if (this.current() === '\\') {
          this.advance();
          str += this.readEscapeChar();
        } else {
          str += this.advance();
        }
      }

      // 残りの文字列部分
      if (str.length > 0) {
        this.tokens.push({ type: TokenType.STRING, value: str, line: this.line, column: this.column });
      }

      if (this.current() === '"') this.advance();
      this.tokens.push({ type: TokenType.STRING_END, value: '"', line: this.line, column: this.column });
    }
  }

  /** エスケープ文字を処理する */
  private readEscapeChar(): string {
    const ch = this.advance();
    switch (ch) {
      case 'n': return '\n';
      case 't': return '\t';
      case '\\': return '\\';
      case '"': return '"';
      case "'": return "'";
      default: return ch;
    }
  }

  /** 単純文字列（シングルクォート）を読み取る */
  private readSimpleString(): void {
    const startCol = this.column;
    this.advance(); // "'"を消費
    let str = '';
    while (this.pos < this.source.length && this.current() !== "'") {
      if (this.current() === '\\' && (this.peek(1) === "'" || this.peek(1) === '\\')) {
        this.advance();
        str += this.advance();
      } else {
        str += this.advance();
      }
    }
    if (this.current() === "'") this.advance();
    this.tokens.push({ type: TokenType.STRING, value: str, line: this.line, column: startCol });
  }

  /** シンボルを読み取る */
  private readSymbol(): void {
    const startCol = this.column;
    this.advance(); // ':'を消費
    let name = '';
    while (this.pos < this.source.length && (this.isAlphaNumeric(this.current()) || this.current() === '_')) {
      name += this.advance();
    }
    this.tokens.push({ type: TokenType.SYMBOL, value: name, line: this.line, column: startCol });
  }

  /** 識別子またはキーワードを読み取る */
  private readIdentifier(): void {
    const startCol = this.column;
    let name = '';
    while (this.pos < this.source.length && (this.isAlphaNumeric(this.current()) || this.current() === '_' || this.current() === '?' || this.current() === '!')) {
      name += this.advance();
    }
    const keywordType = KEYWORDS[name];
    const type = keywordType ?? TokenType.IDENT;
    this.tokens.push({ type, value: name, line: this.line, column: startCol });
  }

  /** 演算子・区切り文字を読み取る */
  private readOperator(): void {
    const startCol = this.column;
    const ch = this.advance();

    switch (ch) {
      case '+': this.tokens.push({ type: TokenType.PLUS, value: '+', line: this.line, column: startCol }); break;
      case '-': this.tokens.push({ type: TokenType.MINUS, value: '-', line: this.line, column: startCol }); break;
      case '*': this.tokens.push({ type: TokenType.STAR, value: '*', line: this.line, column: startCol }); break;
      case '/': this.tokens.push({ type: TokenType.SLASH, value: '/', line: this.line, column: startCol }); break;
      case '%': this.tokens.push({ type: TokenType.PERCENT, value: '%', line: this.line, column: startCol }); break;
      case '=':
        if (this.current() === '=') {
          this.advance();
          this.tokens.push({ type: TokenType.EQEQ, value: '==', line: this.line, column: startCol });
        } else if (this.current() === '>') {
          this.advance();
          this.tokens.push({ type: TokenType.HASHROCKET, value: '=>', line: this.line, column: startCol });
        } else {
          this.tokens.push({ type: TokenType.EQ, value: '=', line: this.line, column: startCol });
        }
        break;
      case '!':
        if (this.current() === '=') {
          this.advance();
          this.tokens.push({ type: TokenType.NEQ, value: '!=', line: this.line, column: startCol });
        } else {
          this.tokens.push({ type: TokenType.NOT, value: '!', line: this.line, column: startCol });
        }
        break;
      case '<':
        if (this.current() === '=') {
          this.advance();
          this.tokens.push({ type: TokenType.LTEQ, value: '<=', line: this.line, column: startCol });
        } else {
          this.tokens.push({ type: TokenType.LT, value: '<', line: this.line, column: startCol });
        }
        break;
      case '>':
        if (this.current() === '=') {
          this.advance();
          this.tokens.push({ type: TokenType.GTEQ, value: '>=', line: this.line, column: startCol });
        } else {
          this.tokens.push({ type: TokenType.GT, value: '>', line: this.line, column: startCol });
        }
        break;
      case '&':
        if (this.current() === '&') {
          this.advance();
          this.tokens.push({ type: TokenType.AND, value: '&&', line: this.line, column: startCol });
        }
        break;
      case '|':
        if (this.current() === '|') {
          this.advance();
          this.tokens.push({ type: TokenType.OR, value: '||', line: this.line, column: startCol });
        } else {
          this.tokens.push({ type: TokenType.PIPE, value: '|', line: this.line, column: startCol });
        }
        break;
      case '.': this.tokens.push({ type: TokenType.DOT, value: '.', line: this.line, column: startCol }); break;
      case ',': this.tokens.push({ type: TokenType.COMMA, value: ',', line: this.line, column: startCol }); break;
      case ':': this.tokens.push({ type: TokenType.COLON, value: ':', line: this.line, column: startCol }); break;
      case ';': this.tokens.push({ type: TokenType.SEMICOLON, value: ';', line: this.line, column: startCol }); break;
      case '(': this.tokens.push({ type: TokenType.LPAREN, value: '(', line: this.line, column: startCol }); break;
      case ')': this.tokens.push({ type: TokenType.RPAREN, value: ')', line: this.line, column: startCol }); break;
      case '[': this.tokens.push({ type: TokenType.LBRACKET, value: '[', line: this.line, column: startCol }); break;
      case ']': this.tokens.push({ type: TokenType.RBRACKET, value: ']', line: this.line, column: startCol }); break;
      case '{': this.tokens.push({ type: TokenType.LBRACE, value: '{', line: this.line, column: startCol }); break;
      case '}': this.tokens.push({ type: TokenType.RBRACE, value: '}', line: this.line, column: startCol }); break;
      default:
        // 不明な文字はスキップ
        break;
    }
  }

  /** 数字かどうか */
  private isDigit(ch: string): boolean {
    return ch >= '0' && ch <= '9';
  }

  /** アルファベットかどうか */
  private isAlpha(ch: string): boolean {
    return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_';
  }

  /** 英数字かどうか */
  private isAlphaNumeric(ch: string): boolean {
    return this.isAlpha(ch) || this.isDigit(ch);
  }
}
