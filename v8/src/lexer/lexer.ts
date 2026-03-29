/**
 * lexer.ts -- JavaScript レキサー
 *
 * V8 パイプラインの第1段階: ソースコード → トークン列
 */

export const TT = {
  Number: "Number", String: "String", Identifier: "Identifier",
  True: "true", False: "false", Null: "null", Undefined: "undefined",
  Var: "var", Let: "let", Const: "const", Function: "function", Return: "return",
  If: "if", Else: "else", While: "while", For: "for",
  New: "new", This: "this",
  LeftParen: "(", RightParen: ")", LeftBrace: "{", RightBrace: "}",
  LeftBracket: "[", RightBracket: "]",
  Semicolon: ";", Comma: ",", Dot: ".", Colon: ":",
  Eq: "=", EqEq: "==", EqEqEq: "===", BangEq: "!=", BangEqEq: "!==",
  Lt: "<", Gt: ">", LtEq: "<=", GtEq: ">=",
  Plus: "+", Minus: "-", Star: "*", Slash: "/", Percent: "%",
  PlusPlus: "++", MinusMinus: "--",
  PlusEq: "+=", MinusEq: "-=", StarEq: "*=",
  AmpAmp: "&&", PipePipe: "||", Bang: "!",
  Arrow: "=>",
  Eof: "EOF",
} as const;
export type TT = (typeof TT)[keyof typeof TT];

export interface Token { type: TT; value: string; line: number; }

const KEYWORDS: Record<string, TT | undefined> = {
  var: TT.Var, let: TT.Let, const: TT.Const, function: TT.Function, return: TT.Return,
  if: TT.If, else: TT.Else, while: TT.While, for: TT.For,
  new: TT.New, this: TT.This,
  true: TT.True, false: TT.False, null: TT.Null, undefined: TT.Undefined,
};

export function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;
  let line = 1;
  while (pos < src.length) {
    const ch = src[pos] ?? "";
    if (ch === "\n") { line++; pos++; continue; }
    if (ch === " " || ch === "\t" || ch === "\r") { pos++; continue; }
    if (ch === "/" && src[pos + 1] === "/") { while (pos < src.length && src[pos] !== "\n") pos++; continue; }
    if (ch === "/" && src[pos + 1] === "*") { pos += 2; while (pos < src.length && !(src[pos] === "*" && src[pos + 1] === "/")) { if (src[pos] === "\n") line++; pos++; } pos += 2; continue; }

    // 文字列
    if (ch === '"' || ch === "'") {
      let val = ""; pos++;
      while (pos < src.length && src[pos] !== ch) { if (src[pos] === "\\") { val += src[pos]; pos++; } val += src[pos] ?? ""; pos++; }
      pos++;
      tokens.push({ type: TT.String, value: val, line }); continue;
    }
    // 数値
    if (ch >= "0" && ch <= "9") {
      const s = pos;
      while (pos < src.length && ((src[pos] ?? "") >= "0" && (src[pos] ?? "") <= "9" || src[pos] === ".")) pos++;
      tokens.push({ type: TT.Number, value: src.slice(s, pos), line }); continue;
    }
    // 識別子/キーワード
    if ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_" || ch === "$") {
      const s = pos;
      while (pos < src.length && /[a-zA-Z0-9_$]/.test(src[pos] ?? "")) pos++;
      const word = src.slice(s, pos);
      tokens.push({ type: KEYWORDS[word] ?? TT.Identifier, value: word, line }); continue;
    }
    // 3文字
    const t3 = src.slice(pos, pos + 3);
    if (t3 === "===" || t3 === "!==") { tokens.push({ type: t3 === "===" ? TT.EqEqEq : TT.BangEqEq, value: t3, line }); pos += 3; continue; }
    // 2文字
    const t2 = src.slice(pos, pos + 2);
    const m2: Record<string, TT | undefined> = { "==": TT.EqEq, "!=": TT.BangEq, "<=": TT.LtEq, ">=": TT.GtEq, "&&": TT.AmpAmp, "||": TT.PipePipe, "=>": TT.Arrow, "++": TT.PlusPlus, "--": TT.MinusMinus, "+=": TT.PlusEq, "-=": TT.MinusEq, "*=": TT.StarEq };
    const tt2 = m2[t2];
    if (tt2 !== undefined) { tokens.push({ type: tt2, value: t2, line }); pos += 2; continue; }
    // 1文字
    const m1: Record<string, TT | undefined> = { "(": TT.LeftParen, ")": TT.RightParen, "{": TT.LeftBrace, "}": TT.RightBrace, "[": TT.LeftBracket, "]": TT.RightBracket, ";": TT.Semicolon, ",": TT.Comma, ".": TT.Dot, ":": TT.Colon, "=": TT.Eq, "<": TT.Lt, ">": TT.Gt, "+": TT.Plus, "-": TT.Minus, "*": TT.Star, "/": TT.Slash, "%": TT.Percent, "!": TT.Bang };
    const tt1 = m1[ch];
    if (tt1 !== undefined) { tokens.push({ type: tt1, value: ch, line }); pos++; continue; }
    pos++;
  }
  tokens.push({ type: TT.Eof, value: "", line });
  return tokens;
}
