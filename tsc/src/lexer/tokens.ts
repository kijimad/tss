/**
 * tokens.ts — TypeScript のトークン種別定義
 *
 * トランスパイラの最初のステップ:
 *   ソースコード文字列 → トークン列
 *
 * TypeScript 固有のトークン（型注釈関連）も含む。
 * トランスパイル時にこれらを除去して JavaScript に変換する。
 */

export const TT = {
  // リテラル
  Number: "Number",
  String: "String",
  Template: "Template",       // テンプレートリテラル `...`
  RegExp: "RegExp",
  True: "true",
  False: "false",
  Null: "null",
  Undefined: "undefined",

  // 識別子
  Identifier: "Identifier",

  // キーワード
  Const: "const",
  Let: "let",
  Var: "var",
  Function: "function",
  Return: "return",
  If: "if",
  Else: "else",
  For: "for",
  While: "while",
  Do: "do",
  Break: "break",
  Continue: "continue",
  Switch: "switch",
  Case: "case",
  Default: "default",
  New: "new",
  This: "this",
  Class: "class",
  Extends: "extends",
  Super: "super",
  Import: "import",
  Export: "export",
  From: "from",
  As: "as",
  Typeof: "typeof",
  Instanceof: "instanceof",
  In: "in",
  Of: "of",
  Throw: "throw",
  Try: "try",
  Catch: "catch",
  Finally: "finally",
  Async: "async",
  Await: "await",
  Yield: "yield",
  Delete: "delete",
  Void: "void",

  // TypeScript 固有キーワード（トランスパイル時に除去）
  Type: "type",               // type alias
  Interface: "interface",
  Enum: "enum",
  Implements: "implements",
  Declare: "declare",
  Readonly: "readonly",
  Public: "public",
  Private: "private",
  Protected: "protected",
  Abstract: "abstract",
  Namespace: "namespace",
  Module: "module",
  Is: "is",                   // 型ガード

  // 記号
  LeftParen: "(",
  RightParen: ")",
  LeftBrace: "{",
  RightBrace: "}",
  LeftBracket: "[",
  RightBracket: "]",
  Semicolon: ";",
  Comma: ",",
  Dot: ".",
  DotDotDot: "...",           // スプレッド/レスト
  Colon: ":",
  Question: "?",
  QuestionDot: "?.",          // オプショナルチェーン
  Arrow: "=>",
  At: "@",                    // デコレータ

  // 代入
  Eq: "=",
  PlusEq: "+=",
  MinusEq: "-=",
  StarEq: "*=",
  SlashEq: "/=",
  PercentEq: "%=",
  AmpEq: "&=",
  PipeEq: "|=",
  CaretEq: "^=",
  StarStarEq: "**=",
  AmpAmpEq: "&&=",
  PipePipeEq: "||=",
  QuestionQuestionEq: "??=",

  // 比較
  EqEq: "==",
  EqEqEq: "===",
  BangEq: "!=",
  BangEqEq: "!==",
  Lt: "<",
  Gt: ">",
  LtEq: "<=",
  GtEq: ">=",

  // 算術
  Plus: "+",
  Minus: "-",
  Star: "*",
  Slash: "/",
  Percent: "%",
  StarStar: "**",
  PlusPlus: "++",
  MinusMinus: "--",

  // 論理・ビット
  Amp: "&",
  Pipe: "|",
  Caret: "^",
  Tilde: "~",
  Bang: "!",
  AmpAmp: "&&",
  PipePipe: "||",
  QuestionQuestion: "??",     // Nullish coalescing
  LtLt: "<<",
  GtGt: ">>",
  GtGtGt: ">>>",

  // その他
  Eof: "EOF",
  Newline: "Newline",
} as const;
export type TT = (typeof TT)[keyof typeof TT];

export interface Token {
  type: TT;
  value: string;     // トークンの元テキスト
  line: number;
  col: number;
}

// TypeScript キーワードのマップ
export const KEYWORDS: ReadonlyMap<string, TT> = new Map([
  ["const", TT.Const], ["let", TT.Let], ["var", TT.Var],
  ["function", TT.Function], ["return", TT.Return],
  ["if", TT.If], ["else", TT.Else],
  ["for", TT.For], ["while", TT.While], ["do", TT.Do],
  ["break", TT.Break], ["continue", TT.Continue],
  ["switch", TT.Switch], ["case", TT.Case], ["default", TT.Default],
  ["new", TT.New], ["this", TT.This],
  ["class", TT.Class], ["extends", TT.Extends], ["super", TT.Super],
  ["import", TT.Import], ["export", TT.Export], ["from", TT.From],
  ["as", TT.As], ["typeof", TT.Typeof], ["instanceof", TT.Instanceof],
  ["in", TT.In], ["of", TT.Of],
  ["throw", TT.Throw], ["try", TT.Try], ["catch", TT.Catch], ["finally", TT.Finally],
  ["async", TT.Async], ["await", TT.Await], ["yield", TT.Yield],
  ["delete", TT.Delete], ["void", TT.Void],
  ["true", TT.True], ["false", TT.False],
  ["null", TT.Null], ["undefined", TT.Undefined],
  // TypeScript 固有
  ["type", TT.Type], ["interface", TT.Interface], ["enum", TT.Enum],
  ["implements", TT.Implements], ["declare", TT.Declare],
  ["readonly", TT.Readonly],
  ["public", TT.Public], ["private", TT.Private], ["protected", TT.Protected],
  ["abstract", TT.Abstract], ["namespace", TT.Namespace], ["module", TT.Module],
  ["is", TT.Is],
]);
