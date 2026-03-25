import { describe, it, expect } from "vitest";
import { tokenize } from "../sql/tokenizer.js";
import { TokenKind } from "../sql/token-types.js";

describe("tokenizer", () => {
  it("キーワードを正しくトークン化する", () => {
    const tokens = tokenize("SELECT * FROM users");
    expect(tokens[0]?.kind).toBe(TokenKind.Select);
    expect(tokens[1]?.kind).toBe(TokenKind.Star);
    expect(tokens[2]?.kind).toBe(TokenKind.From);
    expect(tokens[3]?.kind).toBe(TokenKind.Identifier);
    expect(tokens[3]?.value).toBe("users");
    expect(tokens[4]?.kind).toBe(TokenKind.Eof);
  });

  it("数値リテラルをトークン化する", () => {
    const tokens = tokenize("42 3.14");
    expect(tokens[0]?.kind).toBe(TokenKind.Number);
    expect(tokens[0]?.value).toBe("42");
    expect(tokens[1]?.kind).toBe(TokenKind.Number);
    expect(tokens[1]?.value).toBe("3.14");
  });

  it("文字列リテラルをトークン化する", () => {
    const tokens = tokenize("'hello' 'it''s'");
    expect(tokens[0]?.kind).toBe(TokenKind.String);
    expect(tokens[0]?.value).toBe("hello");
    expect(tokens[1]?.kind).toBe(TokenKind.String);
    expect(tokens[1]?.value).toBe("it's");
  });

  it("比較演算子をトークン化する", () => {
    const tokens = tokenize("= != < > <= >= <>");
    expect(tokens[0]?.kind).toBe(TokenKind.Eq);
    expect(tokens[1]?.kind).toBe(TokenKind.Neq);
    expect(tokens[2]?.kind).toBe(TokenKind.Lt);
    expect(tokens[3]?.kind).toBe(TokenKind.Gt);
    expect(tokens[4]?.kind).toBe(TokenKind.Lte);
    expect(tokens[5]?.kind).toBe(TokenKind.Gte);
    expect(tokens[6]?.kind).toBe(TokenKind.Neq);
  });

  it("文字列連結演算子をトークン化する", () => {
    const tokens = tokenize("'a' || 'b'");
    expect(tokens[1]?.kind).toBe(TokenKind.Concat);
  });

  it("コメントをスキップする", () => {
    const tokens = tokenize("SELECT -- コメント\n* FROM t");
    expect(tokens[0]?.kind).toBe(TokenKind.Select);
    expect(tokens[1]?.kind).toBe(TokenKind.Star);
    expect(tokens[2]?.kind).toBe(TokenKind.From);
  });

  it("不正な文字でエラーを投げる", () => {
    expect(() => tokenize("SELECT @")).toThrow("予期しない文字");
  });

  it("CREATE TABLE文をトークン化する", () => {
    const tokens = tokenize("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL)");
    expect(tokens[0]?.kind).toBe(TokenKind.Create);
    expect(tokens[1]?.kind).toBe(TokenKind.Table);
    expect(tokens[2]?.kind).toBe(TokenKind.Identifier);
    expect(tokens[3]?.kind).toBe(TokenKind.LeftParen);
  });
});
