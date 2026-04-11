import type { Token, TokenKind } from "./types.js";

/** キーワードマップ */
const KEYWORDS: Record<string, TokenKind> = {
  int: "int",
  return: "return",
  if: "if",
  else: "else",
  while: "while",
  for: "for",
};

/** ソースコードをトークン列に分解する */
export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;
  let line = 1;
  let col = 1;

  const peek = (): string => source[pos] ?? "\0";
  const peekNext = (): string => source[pos + 1] ?? "\0";
  const advance = (): string => {
    const ch = source[pos] ?? "\0";
    pos++;
    if (ch === "\n") { line++; col = 1; } else { col++; }
    return ch;
  };

  while (pos < source.length) {
    // 空白スキップ
    if (/\s/.test(peek())) { advance(); continue; }

    // 行コメント
    if (peek() === "/" && peekNext() === "/") {
      while (pos < source.length && peek() !== "\n") advance();
      continue;
    }

    const startLine = line;
    const startCol = col;

    // 数値リテラル
    if (/\d/.test(peek())) {
      let num = "";
      while (pos < source.length && /\d/.test(peek())) num += advance();
      tokens.push({ kind: "number", value: num, line: startLine, col: startCol });
      continue;
    }

    // 識別子・キーワード
    if (/[a-zA-Z_]/.test(peek())) {
      let ident = "";
      while (pos < source.length && /[a-zA-Z_0-9]/.test(peek())) ident += advance();
      const kind = KEYWORDS[ident] ?? "ident";
      tokens.push({ kind, value: ident, line: startLine, col: startCol });
      continue;
    }

    // 文字列リテラル
    if (peek() === '"') {
      advance(); // 開始の "
      let str = "";
      while (pos < source.length && peek() !== '"') {
        if (peek() === "\\") {
          advance();
          const esc = advance();
          if (esc === "n") str += "\n";
          else if (esc === "t") str += "\t";
          else if (esc === "\\") str += "\\";
          else if (esc === '"') str += '"';
          else str += esc;
        } else {
          str += advance();
        }
      }
      if (pos < source.length) advance(); // 終了の "
      tokens.push({ kind: "string", value: str, line: startLine, col: startCol });
      continue;
    }

    // 2文字演算子
    const two = peek() + peekNext();
    const twoKind = TWO_CHAR_OPS[two];
    if (twoKind) {
      advance(); advance();
      tokens.push({ kind: twoKind, value: two, line: startLine, col: startCol });
      continue;
    }

    // 1文字演算子
    const ch = advance();
    const oneKind = ONE_CHAR_OPS[ch];
    if (oneKind) {
      tokens.push({ kind: oneKind, value: ch, line: startLine, col: startCol });
      continue;
    }

    // 不明な文字はスキップ
  }

  tokens.push({ kind: "eof", value: "", line, col });
  return tokens;
}

const TWO_CHAR_OPS: Record<string, TokenKind> = {
  "==": "eq", "!=": "neq", "<=": "le", ">=": "ge",
  "&&": "and", "||": "or",
};

const ONE_CHAR_OPS: Record<string, TokenKind> = {
  "+": "plus", "-": "minus", "*": "star", "/": "slash", "%": "percent",
  "=": "assign", "<": "lt", ">": "gt", "!": "not",
  "(": "lparen", ")": "rparen", "{": "lbrace", "}": "rbrace",
  "[": "lbracket", "]": "rbracket",
  ";": "semicolon", ",": "comma", "&": "ampersand",
};
