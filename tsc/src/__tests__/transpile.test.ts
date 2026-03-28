import { describe, it, expect } from "vitest";
import { transpile } from "../transpile.js";
import { tokenize } from "../lexer/lexer.js";
import { TT } from "../lexer/tokens.js";

describe("レキサー", () => {
  it("基本的なトークンを生成する", () => {
    const tokens = tokenize("const x = 42;");
    expect(tokens[0]?.type).toBe(TT.Const);
    expect(tokens[1]?.type).toBe(TT.Identifier);
    expect(tokens[1]?.value).toBe("x");
    expect(tokens[2]?.type).toBe(TT.Eq);
    expect(tokens[3]?.type).toBe(TT.Number);
    expect(tokens[3]?.value).toBe("42");
    expect(tokens[4]?.type).toBe(TT.Semicolon);
  });

  it("文字列リテラルをトークン化する", () => {
    const tokens = tokenize(`const s = 'hello';`);
    expect(tokens[3]?.type).toBe(TT.String);
    expect(tokens[3]?.value).toBe("hello");
  });

  it("TypeScript キーワードを認識する", () => {
    const tokens = tokenize("interface Foo {}");
    expect(tokens[0]?.type).toBe(TT.Interface);
  });

  it("アロー演算子を認識する", () => {
    const tokens = tokenize("() => 1");
    expect(tokens[2]?.type).toBe(TT.Arrow);
  });

  it("コメントをスキップする", () => {
    const tokens = tokenize("const a = 1; // comment\nconst b = 2;");
    const ids = tokens.filter(t => t.type === TT.Identifier);
    expect(ids.map(t => t.value)).toEqual(["a", "b"]);
  });

  it("ブロックコメントをスキップする", () => {
    const tokens = tokenize("const /* skip */ a = 1;");
    expect(tokens[1]?.type).toBe(TT.Identifier);
    expect(tokens[1]?.value).toBe("a");
  });
});

describe("トランスパイル", () => {
  describe("型注釈の除去", () => {
    it("変数の型注釈を除去する", () => {
      const result = transpile("const x: number = 42;");
      expect(result.trim()).toBe("const x = 42;");
    });

    it("関数の引数と戻り値の型を除去する", () => {
      const result = transpile("function add(a: number, b: number): number { return a + b; }");
      expect(result).toContain("function add(a, b)");
      expect(result).not.toContain(": number");
    });

    it("アロー関数の型を除去する", () => {
      const result = transpile("const f = (x: string): string => x;");
      expect(result).toContain("x => x");
      expect(result).not.toContain(": string");
    });
  });

  describe("TypeScript 固有構文の除去", () => {
    it("interface を除去する", () => {
      const result = transpile("interface Foo { bar: string; } const x = 1;");
      expect(result).not.toContain("interface");
      expect(result).toContain("const x = 1;");
    });

    it("type alias を除去する", () => {
      const result = transpile("type ID = number; const id = 1;");
      expect(result).not.toContain("type ID");
      expect(result).toContain("const id = 1;");
    });

    it("as 式を除去する", () => {
      const result = transpile("const x = value as string;");
      expect(result).toContain("const x = value;");
      expect(result).not.toContain("as string");
    });

    it("import type を除去する", () => {
      const result = transpile("import type { Foo } from './foo';");
      expect(result.trim()).toBe("");
    });
  });

  describe("enum の変換", () => {
    it("enum をオブジェクトに変換する", () => {
      const result = transpile("enum Color { Red, Green, Blue }");
      expect(result).toContain("const Color");
      expect(result).toContain("Red: 0");
      expect(result).toContain("Green: 1");
      expect(result).toContain("Blue: 2");
    });

    it("値付き enum を変換する", () => {
      const result = transpile('enum Status { OK = 200, NotFound = 404 }');
      expect(result).toContain("OK: 200");
      expect(result).toContain("NotFound: 404");
    });
  });

  describe("クラス", () => {
    it("アクセス修飾子を除去する", () => {
      const result = transpile("class Foo { private x = 1; public y = 2; }");
      expect(result).not.toContain("private");
      expect(result).not.toContain("public");
      expect(result).toContain("x = 1;");
      expect(result).toContain("y = 2;");
    });

    it("コンストラクタ引数のプロパティ初期化を展開する", () => {
      const result = transpile("class Foo { constructor(public name: string) {} }");
      expect(result).toContain("this.name = name;");
      expect(result).not.toContain("public");
    });

    it("implements を除去する", () => {
      const result = transpile("class Foo implements Bar { x = 1; }");
      expect(result).not.toContain("implements");
      expect(result).toContain("class Foo");
    });
  });

  describe("JavaScript 構文の保持", () => {
    it("if/else を保持する", () => {
      const result = transpile("if (x > 0) { console.log(x); } else { console.log(0); }");
      expect(result).toContain("if (x > 0)");
      expect(result).toContain("else");
    });

    it("for ループを保持する", () => {
      const result = transpile("for (let i = 0; i < 10; i++) { console.log(i); }");
      expect(result).toContain("for (let i = 0; i < 10; i++)");
    });

    it("import/export を保持する", () => {
      const result = transpile("import { foo } from './bar';");
      expect(result).toContain("import { foo } from './bar';");
    });

    it("テンプレートリテラルを保持する", () => {
      const result = transpile("const s = `hello ${name}`;");
      expect(result).toContain("`hello ${name}`");
    });

    it("スプレッド構文を保持する", () => {
      const result = transpile("const arr = [...items, 1];");
      expect(result).toContain("...items");
    });

    it("オプショナルチェーンを保持する", () => {
      const result = transpile("const x = obj?.prop;");
      expect(result).toContain("obj?.prop");
    });
  });
});
