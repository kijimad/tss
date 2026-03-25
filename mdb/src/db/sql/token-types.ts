/**
 * token-types.ts — トークン種別定義
 *
 * トークナイザが SQL 文字列を分割した結果の各要素の種類を定義する。
 * `const object + typeof` パターンで enum 的な型安全性を実現。
 */

export const TokenKind = {
  // === SQLキーワード ===
  // 予約語として認識される文字列。大文字小文字を無視してマッチする。
  Select: "SELECT",
  From: "FROM",
  Where: "WHERE",
  Insert: "INSERT",
  Into: "INTO",
  Values: "VALUES",
  Update: "UPDATE",
  Set: "SET",
  Delete: "DELETE",
  Create: "CREATE",
  Table: "TABLE",
  Index: "INDEX",
  Drop: "DROP",
  If: "IF",
  Not: "NOT",
  Exists: "EXISTS",
  And: "AND",
  Or: "OR",
  Is: "IS",
  Null: "NULL",
  Like: "LIKE",
  Between: "BETWEEN",
  In: "IN",
  As: "AS",
  On: "ON",
  Join: "JOIN",
  Inner: "INNER",
  Left: "LEFT",
  Order: "ORDER",
  By: "BY",
  Asc: "ASC",
  Desc: "DESC",
  Group: "GROUP",
  Having: "HAVING",
  Limit: "LIMIT",
  Offset: "OFFSET",
  Distinct: "DISTINCT",
  Primary: "PRIMARY",
  Key: "KEY",
  Unique: "UNIQUE",
  Integer: "INTEGER",
  Text: "TEXT",
  Real: "REAL",
  Blob: "BLOB",
  Autoincrement: "AUTOINCREMENT",

  // === リテラル ===
  Number: "NUMBER",         // 数値リテラル: 42, 3.14
  String: "STRING",         // 文字列リテラル: 'hello'（シングルクォート）
  Identifier: "IDENTIFIER", // 識別子（テーブル名、カラム名など）

  // === 記号 ===
  LeftParen: "(",
  RightParen: ")",
  Comma: ",",
  Semicolon: ";",
  Dot: ".",
  Star: "*",
  Plus: "+",
  Minus: "-",
  Slash: "/",
  Percent: "%",
  Eq: "=",
  Neq: "!=",
  Lt: "<",
  Gt: ">",
  Lte: "<=",
  Gte: ">=",
  Concat: "||",  // SQL の文字列連結演算子

  // === 制御 ===
  Eof: "EOF",  // 入力終端を表す番兵トークン
} as const;

export type TokenKind = (typeof TokenKind)[keyof typeof TokenKind];

// トークン1つを表す構造体
export interface Token {
  kind: TokenKind;   // トークンの種別
  value: string;     // 元の文字列（キーワードは元の大小文字を保持）
  position: number;  // SQL文字列中の開始位置（エラーメッセージ用）
}

// キーワードマップ: 大文字化した文字列 → TokenKind
// トークナイザが識別子を読んだ後、このマップで予約語かどうか判定する
export const KEYWORDS: ReadonlyMap<string, TokenKind> = new Map([
  ["SELECT", TokenKind.Select],
  ["FROM", TokenKind.From],
  ["WHERE", TokenKind.Where],
  ["INSERT", TokenKind.Insert],
  ["INTO", TokenKind.Into],
  ["VALUES", TokenKind.Values],
  ["UPDATE", TokenKind.Update],
  ["SET", TokenKind.Set],
  ["DELETE", TokenKind.Delete],
  ["CREATE", TokenKind.Create],
  ["TABLE", TokenKind.Table],
  ["INDEX", TokenKind.Index],
  ["DROP", TokenKind.Drop],
  ["IF", TokenKind.If],
  ["NOT", TokenKind.Not],
  ["EXISTS", TokenKind.Exists],
  ["AND", TokenKind.And],
  ["OR", TokenKind.Or],
  ["IS", TokenKind.Is],
  ["NULL", TokenKind.Null],
  ["LIKE", TokenKind.Like],
  ["BETWEEN", TokenKind.Between],
  ["IN", TokenKind.In],
  ["AS", TokenKind.As],
  ["ON", TokenKind.On],
  ["JOIN", TokenKind.Join],
  ["INNER", TokenKind.Inner],
  ["LEFT", TokenKind.Left],
  ["ORDER", TokenKind.Order],
  ["BY", TokenKind.By],
  ["ASC", TokenKind.Asc],
  ["DESC", TokenKind.Desc],
  ["GROUP", TokenKind.Group],
  ["HAVING", TokenKind.Having],
  ["LIMIT", TokenKind.Limit],
  ["OFFSET", TokenKind.Offset],
  ["DISTINCT", TokenKind.Distinct],
  ["PRIMARY", TokenKind.Primary],
  ["KEY", TokenKind.Key],
  ["UNIQUE", TokenKind.Unique],
  ["INTEGER", TokenKind.Integer],
  ["TEXT", TokenKind.Text],
  ["REAL", TokenKind.Real],
  ["BLOB", TokenKind.Blob],
  ["AUTOINCREMENT", TokenKind.Autoincrement],
]);
