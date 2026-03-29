/**
 * lexer.ts -- Go レキサー
 *
 * Go 固有: := (短縮宣言), <- (チャネル送受信), ... (可変長引数),
 *          自動セミコロン挿入（行末の特定トークン後に ; を挿入）
 */
export const TT = {
  Number: "Number", String: "String", Identifier: "Identifier",
  True: "true", False: "false", Nil: "nil",
  // キーワード
  Package: "package", Import: "import", Func: "func", Return: "return",
  Var: "var", Const: "const", Type: "type", Struct: "struct",
  If: "if", Else: "else", For: "for", Range: "range",
  Switch: "switch", Case: "case", Default: "default",
  Go: "go", Chan: "chan", Select: "select",
  Make: "make", Len: "len", Append: "append", Print: "println",
  Defer: "defer", Break: "break", Continue: "continue",
  Map: "map", Interface: "interface",
  // 記号
  LeftParen: "(", RightParen: ")", LeftBrace: "{", RightBrace: "}",
  LeftBracket: "[", RightBracket: "]",
  Semicolon: ";", Comma: ",", Dot: ".", Colon: ":", ColonEq: ":=",
  Eq: "=", EqEq: "==", BangEq: "!=", Lt: "<", Gt: ">", LtEq: "<=", GtEq: ">=",
  Plus: "+", Minus: "-", Star: "*", Slash: "/", Percent: "%", Amp: "&",
  PlusEq: "+=", MinusEq: "-=", StarEq: "*=",
  PlusPlus: "++", MinusMinus: "--",
  AmpAmp: "&&", PipePipe: "||", Bang: "!",
  Arrow: "<-", DotDotDot: "...",
  Eof: "EOF",
} as const;
export type TT = (typeof TT)[keyof typeof TT];
export interface Token { type: TT; value: string; line: number; }

const KW: Record<string, TT | undefined> = {
  package: TT.Package, import: TT.Import, func: TT.Func, return: TT.Return,
  var: TT.Var, const: TT.Const, type: TT.Type, struct: TT.Struct,
  if: TT.If, else: TT.Else, for: TT.For, range: TT.Range,
  switch: TT.Switch, case: TT.Case, default: TT.Default,
  go: TT.Go, chan: TT.Chan, select: TT.Select,
  make: TT.Make, len: TT.Len, append: TT.Append, println: TT.Print,
  defer: TT.Defer, break: TT.Break, continue: TT.Continue,
  true: TT.True, false: TT.False, nil: TT.Nil,
  map: TT.Map, interface: TT.Interface,
};

// Go の自動セミコロン挿入: 行末がこれらのトークンなら ; を挿入
const AUTO_SEMI = new Set<TT>([
  TT.Identifier, TT.Number, TT.String, TT.True, TT.False, TT.Nil,
  TT.Return, TT.Break, TT.Continue,
  TT.RightParen, TT.RightBrace, TT.RightBracket,
  TT.PlusPlus, TT.MinusMinus,
]);

export function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0; let line = 1;
  const push = (type: TT, value: string) => tokens.push({ type, value, line });

  while (pos < src.length) {
    const ch = src[pos] ?? "";
    if (ch === "\n") {
      // 自動セミコロン挿入
      const last = tokens[tokens.length - 1];
      if (last !== undefined && AUTO_SEMI.has(last.type)) push(TT.Semicolon, ";");
      line++; pos++; continue;
    }
    if (ch === " " || ch === "\t" || ch === "\r") { pos++; continue; }
    if (ch === "/" && src[pos + 1] === "/") { while (pos < src.length && src[pos] !== "\n") pos++; continue; }

    if (ch === '"') { let v = ""; pos++; while (pos < src.length && src[pos] !== '"') { if (src[pos] === "\\") { v += src[pos]; pos++; } v += src[pos] ?? ""; pos++; } pos++; push(TT.String, v); continue; }
    if (ch === '`') { let v = ""; pos++; while (pos < src.length && src[pos] !== '`') { v += src[pos] ?? ""; pos++; } pos++; push(TT.String, v); continue; }
    if (ch >= "0" && ch <= "9") { const s = pos; while (pos < src.length && ((src[pos] ?? "") >= "0" && (src[pos] ?? "") <= "9" || src[pos] === ".")) pos++; push(TT.Number, src.slice(s, pos)); continue; }
    if (/[a-zA-Z_]/.test(ch)) { const s = pos; while (pos < src.length && /[a-zA-Z0-9_]/.test(src[pos] ?? "")) pos++; const w = src.slice(s, pos); push(KW[w] ?? TT.Identifier, w); continue; }

    const t3 = src.slice(pos, pos + 3);
    if (t3 === "...") { push(TT.DotDotDot, t3); pos += 3; continue; }
    const t2 = src.slice(pos, pos + 2);
    const m2: Record<string, TT | undefined> = { ":=": TT.ColonEq, "==": TT.EqEq, "!=": TT.BangEq, "<=": TT.LtEq, ">=": TT.GtEq, "&&": TT.AmpAmp, "||": TT.PipePipe, "<-": TT.Arrow, "++": TT.PlusPlus, "--": TT.MinusMinus, "+=": TT.PlusEq, "-=": TT.MinusEq, "*=": TT.StarEq };
    const tt2 = m2[t2]; if (tt2 !== undefined) { push(tt2, t2); pos += 2; continue; }
    const m1: Record<string, TT | undefined> = { "(": TT.LeftParen, ")": TT.RightParen, "{": TT.LeftBrace, "}": TT.RightBrace, "[": TT.LeftBracket, "]": TT.RightBracket, ";": TT.Semicolon, ",": TT.Comma, ".": TT.Dot, ":": TT.Colon, "=": TT.Eq, "<": TT.Lt, ">": TT.Gt, "+": TT.Plus, "-": TT.Minus, "*": TT.Star, "/": TT.Slash, "%": TT.Percent, "&": TT.Amp, "!": TT.Bang };
    const tt1 = m1[ch]; if (tt1 !== undefined) { push(tt1, ch); pos++; continue; }
    pos++;
  }
  // 末尾にもセミコロン挿入
  const last = tokens[tokens.length - 1];
  if (last !== undefined && AUTO_SEMI.has(last.type)) push(TT.Semicolon, ";");
  push(TT.Eof, "");
  return tokens;
}
