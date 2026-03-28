import { describe, it, expect } from "vitest";
import { tokenize } from "../lexer/lexer.js";
import { Parser } from "../parser/parser.js";
import { TypeChecker } from "../checker/checker.js";

function check(source: string): string[] {
  const tokens = tokenize(source);
  const ast = new Parser(tokens).parse();
  const checker = new TypeChecker();
  const errors = checker.check(ast);
  return errors.map(e => e.message);
}

describe("型チェッカー", () => {
  describe("型注釈と初期値の不一致", () => {
    it("number に string を代入するとエラー", () => {
      const errors = check('const x: number = "hello";');
      expect(errors.length).toBe(1);
      expect(errors[0]).toContain("string");
      expect(errors[0]).toContain("number");
    });

    it("string に number を代入するとエラー", () => {
      const errors = check("const x: string = 42;");
      expect(errors.length).toBe(1);
      expect(errors[0]).toContain("number");
      expect(errors[0]).toContain("string");
    });

    it("正しい型注釈はエラーなし", () => {
      const errors = check("const x: number = 42;");
      expect(errors).toHaveLength(0);
    });

    it("boolean の不一致を検出する", () => {
      const errors = check("const x: boolean = 42;");
      expect(errors.length).toBe(1);
    });
  });

  describe("型推論", () => {
    it("注釈なしで number を推論する", () => {
      const errors = check("const x = 42; const y: string = x;");
      expect(errors.length).toBe(1);
      expect(errors[0]).toContain("number");
    });

    it("注釈なしで string を推論する", () => {
      const errors = check('const x = "hi"; const y: number = x;');
      expect(errors.length).toBe(1);
      expect(errors[0]).toContain("string");
    });

    it("注釈なしの正しい代入はエラーなし", () => {
      const errors = check("const x = 42; const y: number = x;");
      expect(errors).toHaveLength(0);
    });
  });

  describe("未定義変数", () => {
    it("未定義の変数を参照するとエラー", () => {
      const errors = check("const x = y;");
      expect(errors.length).toBe(1);
      expect(errors[0]).toContain("y");
      expect(errors[0]).toContain("定義されていません");
    });

    it("定義済みの変数はエラーなし", () => {
      const errors = check("const x = 1; const y = x;");
      expect(errors).toHaveLength(0);
    });
  });

  describe("関数の型チェック", () => {
    it("引数の型不一致を検出する", () => {
      const errors = check(`
        function add(a: number, b: number): number { return a + b; }
        add("hello", 1);
      `);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain("string");
    });

    it("引数の数が足りないとエラー", () => {
      const errors = check(`
        function add(a: number, b: number): number { return a + b; }
        add(1);
      `);
      expect(errors.length).toBe(1);
      expect(errors[0]).toContain("引数が足りません");
    });

    it("戻り値の型不一致を検出する", () => {
      const errors = check(`
        function getName(): string { return 42; }
      `);
      expect(errors.length).toBe(1);
      expect(errors[0]).toContain("number");
      expect(errors[0]).toContain("string");
    });

    it("正しい関数呼び出しはエラーなし", () => {
      const errors = check(`
        function add(a: number, b: number): number { return a + b; }
        const result = add(1, 2);
      `);
      expect(errors).toHaveLength(0);
    });
  });

  describe("二項演算の型チェック", () => {
    it("string を算術演算に使うとエラー", () => {
      const errors = check('const x = "hello" - 1;');
      expect(errors.length).toBe(1);
      expect(errors[0]).toContain("string");
      expect(errors[0]).toContain("number");
    });

    it("number 同士の演算はエラーなし", () => {
      const errors = check("const x = 10 - 3;");
      expect(errors).toHaveLength(0);
    });

    it("string + number はエラーなし (文字列連結)", () => {
      const errors = check('const x = "age: " + 25;');
      expect(errors).toHaveLength(0);
    });
  });

  describe("スコープ", () => {
    it("ブロックスコープの変数は外からアクセスできない", () => {
      const errors = check(`
        if (true) { const inner = 1; }
        const x = inner;
      `);
      expect(errors.length).toBe(1);
      expect(errors[0]).toContain("inner");
    });

    it("外側のスコープの変数にはアクセスできる", () => {
      const errors = check(`
        const outer = 42;
        if (true) { const x: number = outer; }
      `);
      expect(errors).toHaveLength(0);
    });
  });

  describe("TypeScript 固有構文", () => {
    it("interface はエラーなし", () => {
      const errors = check("interface Foo { x: number; }");
      expect(errors).toHaveLength(0);
    });

    it("type alias はエラーなし", () => {
      const errors = check("type ID = number;");
      expect(errors).toHaveLength(0);
    });

    it("enum はエラーなし", () => {
      const errors = check("enum Color { Red, Green, Blue }");
      expect(errors).toHaveLength(0);
    });

    it("as 式はエラーなし", () => {
      const errors = check("const x = 42 as number;");
      expect(errors).toHaveLength(0);
    });
  });

  describe("組み込み関数", () => {
    it("console.log はエラーなし", () => {
      const errors = check('console.log("hello");');
      expect(errors).toHaveLength(0);
    });

    it("Math.floor はエラーなし", () => {
      const errors = check("const x = Math.floor(3.14);");
      expect(errors).toHaveLength(0);
    });
  });
});
