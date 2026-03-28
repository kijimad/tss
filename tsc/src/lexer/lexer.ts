/**
 * lexer.ts — TypeScript ソースコードをトークン列に分割する
 *
 * SQL のトークナイザと同じ原理だが、扱う記号とキーワードが多い。
 * 文字列リテラル、正規表現、コメントを処理する。
 */
import { TT, KEYWORDS, type Token } from "./tokens.js";

export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;
  let line = 1;
  let col = 1;

  while (pos < source.length) {
    const ch = source[pos] ?? "";

    // 改行
    if (ch === "\n") {
      pos++;
      line++;
      col = 1;
      continue;
    }

    // 空白（改行以外）
    if (ch === " " || ch === "\t" || ch === "\r") {
      pos++;
      col++;
      continue;
    }

    // 行コメント //
    if (ch === "/" && source[pos + 1] === "/") {
      while (pos < source.length && source[pos] !== "\n") pos++;
      continue;
    }

    // ブロックコメント /* */
    if (ch === "/" && source[pos + 1] === "*") {
      pos += 2; col += 2;
      while (pos < source.length) {
        if (source[pos] === "*" && source[pos + 1] === "/") {
          pos += 2; col += 2;
          break;
        }
        if (source[pos] === "\n") { line++; col = 1; } else { col++; }
        pos++;
      }
      continue;
    }

    const startCol = col;

    // 文字列リテラル ' or "
    if (ch === "'" || ch === '"') {
      const str = readString(source, pos, ch);
      tokens.push({ type: TT.String, value: str.value, line, col: startCol });
      pos = str.end;
      col += str.value.length + 2;
      continue;
    }

    // テンプレートリテラル `
    if (ch === "`") {
      const tpl = readTemplateString(source, pos);
      tokens.push({ type: TT.Template, value: tpl.value, line, col: startCol });
      pos = tpl.end;
      col = startCol + (tpl.end - (pos - tpl.value.length - 2)); // 概算
      continue;
    }

    // 数値リテラル
    if (isDigit(ch) || (ch === "." && isDigit(source[pos + 1] ?? ""))) {
      const num = readNumber(source, pos);
      tokens.push({ type: TT.Number, value: num.value, line, col: startCol });
      col += num.value.length;
      pos = num.end;
      continue;
    }

    // 識別子 / キーワード
    if (isIdentStart(ch)) {
      const start = pos;
      while (pos < source.length && isIdentPart(source[pos] ?? "")) { pos++; col++; }
      const word = source.slice(start, pos);
      const keyword = KEYWORDS.get(word);
      tokens.push({ type: keyword ?? TT.Identifier, value: word, line, col: startCol });
      continue;
    }

    // 3文字記号
    const three = source.slice(pos, pos + 3);
    const threeMap: Record<string, TT | undefined> = {
      "===": TT.EqEqEq, "!==": TT.BangEqEq,
      "...": TT.DotDotDot, "**=": TT.StarStarEq,
      ">>>": TT.GtGtGt, "&&=": TT.AmpAmpEq,
      "||=": TT.PipePipeEq, "??=": TT.QuestionQuestionEq,
    };
    const threeType = threeMap[three];
    if (threeType !== undefined) {
      tokens.push({ type: threeType, value: three, line, col: startCol });
      pos += 3; col += 3; continue;
    }

    // 2文字記号
    const two = source.slice(pos, pos + 2);
    const twoMap: Record<string, TT | undefined> = {
      "=>": TT.Arrow, "==": TT.EqEq, "!=": TT.BangEq,
      "<=": TT.LtEq, ">=": TT.GtEq,
      "&&": TT.AmpAmp, "||": TT.PipePipe, "??": TT.QuestionQuestion,
      "**": TT.StarStar, "++": TT.PlusPlus, "--": TT.MinusMinus,
      "<<": TT.LtLt, ">>": TT.GtGt,
      "+=": TT.PlusEq, "-=": TT.MinusEq, "*=": TT.StarEq,
      "/=": TT.SlashEq, "%=": TT.PercentEq,
      "&=": TT.AmpEq, "|=": TT.PipeEq, "^=": TT.CaretEq,
      "?.": TT.QuestionDot,
    };
    const twoType = twoMap[two];
    if (twoType !== undefined) {
      tokens.push({ type: twoType, value: two, line, col: startCol });
      pos += 2; col += 2; continue;
    }

    // 1文字記号
    const oneMap: Record<string, TT | undefined> = {
      "(": TT.LeftParen, ")": TT.RightParen,
      "{": TT.LeftBrace, "}": TT.RightBrace,
      "[": TT.LeftBracket, "]": TT.RightBracket,
      ";": TT.Semicolon, ",": TT.Comma, ".": TT.Dot,
      ":": TT.Colon, "?": TT.Question,
      "=": TT.Eq, "<": TT.Lt, ">": TT.Gt,
      "+": TT.Plus, "-": TT.Minus, "*": TT.Star,
      "/": TT.Slash, "%": TT.Percent,
      "&": TT.Amp, "|": TT.Pipe, "^": TT.Caret,
      "~": TT.Tilde, "!": TT.Bang,
      "@": TT.At,
    };
    const oneType = oneMap[ch];
    if (oneType !== undefined) {
      tokens.push({ type: oneType, value: ch, line, col: startCol });
      pos++; col++; continue;
    }

    // 不明な文字はスキップ
    pos++; col++;
  }

  tokens.push({ type: TT.Eof, value: "", line, col });
  return tokens;
}

// === ヘルパー ===

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

function isIdentStart(ch: string): boolean {
  return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_" || ch === "$";
}

function isIdentPart(ch: string): boolean {
  return isIdentStart(ch) || isDigit(ch);
}

function readString(source: string, start: number, quote: string): { value: string; end: number } {
  let pos = start + 1;
  let value = "";
  while (pos < source.length) {
    const ch = source[pos] ?? "";
    if (ch === quote) { pos++; break; }
    if (ch === "\\") {
      value += ch + (source[pos + 1] ?? "");
      pos += 2;
    } else {
      value += ch;
      pos++;
    }
  }
  return { value, end: pos };
}

function readTemplateString(source: string, start: number): { value: string; end: number } {
  let pos = start + 1;
  let value = "";
  while (pos < source.length) {
    const ch = source[pos] ?? "";
    if (ch === "`") { pos++; break; }
    if (ch === "\\") {
      value += ch + (source[pos + 1] ?? "");
      pos += 2;
    } else {
      value += ch;
      pos++;
    }
  }
  return { value, end: pos };
}

function readNumber(source: string, start: number): { value: string; end: number } {
  let pos = start;
  // 0x, 0b, 0o プレフィックス
  if (source[pos] === "0" && pos + 1 < source.length) {
    const next = source[pos + 1] ?? "";
    if (next === "x" || next === "X" || next === "b" || next === "B" || next === "o" || next === "O") {
      pos += 2;
      while (pos < source.length && isHexDigit(source[pos] ?? "")) pos++;
      return { value: source.slice(start, pos), end: pos };
    }
  }
  while (pos < source.length && isDigit(source[pos] ?? "")) pos++;
  if (pos < source.length && source[pos] === ".") {
    pos++;
    while (pos < source.length && isDigit(source[pos] ?? "")) pos++;
  }
  // exponent
  if (pos < source.length && (source[pos] === "e" || source[pos] === "E")) {
    pos++;
    if (pos < source.length && (source[pos] === "+" || source[pos] === "-")) pos++;
    while (pos < source.length && isDigit(source[pos] ?? "")) pos++;
  }
  // BigInt suffix
  if (pos < source.length && source[pos] === "n") pos++;
  return { value: source.slice(start, pos), end: pos };
}

function isHexDigit(ch: string): boolean {
  return isDigit(ch) || (ch >= "a" && ch <= "f") || (ch >= "A" && ch <= "F") || ch === "_";
}
