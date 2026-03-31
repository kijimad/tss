import { describe, it, expect } from "vitest";
import {
  transpile,
  stripTypes,
  downlevelLetConst,
  downlevelArrowFunctions,
  downlevelTemplateLiterals,
  downlevelExponentiation,
  downlevelOptionalChaining,
  downlevelNullishCoalescing,
  downlevelLogicalAssignment,
  downlevelClassFields,
  downlevelClasses,
  downlevelForOf,
  downlevelObjectSpread,
  downlevelOptionalCatch,
  targetBelow,
} from "../transpiler/index.js";
// ── targetBelow テスト ──

describe("targetBelow", () => {
  it("es5 < es2015 → true", () => {
    expect(targetBelow("es5", "es2015")).toBe(true);
  });
  it("es2015 < es2015 → false", () => {
    expect(targetBelow("es2015", "es2015")).toBe(false);
  });
  it("esnext < es2022 → false", () => {
    expect(targetBelow("esnext", "es2022")).toBe(false);
  });
  it("es3 < esnext → true", () => {
    expect(targetBelow("es3", "esnext")).toBe(true);
  });
});

// ── 型除去テスト ──

describe("stripTypes", () => {
  it("型アノテーションを除去する", () => {
    const result = stripTypes("const x: string = 'hello';");
    expect(result).toContain("const x =");
    expect(result).not.toContain("string");
  });

  it("interface 宣言を除去する", () => {
    const result = stripTypes("interface Foo {\n  x: number;\n}");
    expect(result.trim()).toBe("");
  });

  it("type 宣言を除去する", () => {
    const result = stripTypes("type Foo = string;");
    expect(result.trim()).toBe("");
  });
});

// ── ES2015 ダウンレベルテスト ──

describe("downlevelLetConst", () => {
  it("let → var", () => {
    expect(downlevelLetConst("let x = 1;")).toBe("var x = 1;");
  });
  it("const → var", () => {
    expect(downlevelLetConst("const y = 2;")).toBe("var y = 2;");
  });
});

describe("downlevelArrowFunctions", () => {
  it("(x) => expr → function(x) { return expr; }", () => {
    const result = downlevelArrowFunctions("(x) => x * 2");
    expect(result).toContain("function(x)");
    expect(result).toContain("return x * 2;");
  });
  it("(a, b) => { → function(a, b) {", () => {
    const result = downlevelArrowFunctions("(a, b) => {");
    expect(result).toContain("function(a, b) {");
  });
});

describe("downlevelTemplateLiterals", () => {
  it("テンプレートリテラルを文字列結合に変換する", () => {
    const result = downlevelTemplateLiterals("`Hello, ${name}!`");
    expect(result).toContain('"Hello, "');
    expect(result).toContain("(name)");
    expect(result).toContain('"!"');
    expect(result).toContain(" + ");
  });
  it("式なしのテンプレートは通常文字列になる", () => {
    const result = downlevelTemplateLiterals("`hello`");
    expect(result).toBe('"hello"');
  });
});

describe("downlevelClasses", () => {
  it("class → function + prototype", () => {
    const result = downlevelClasses("class Foo {\n  bar() {\n    return 1;\n  }\n}");
    expect(result).toContain("function Foo()");
    expect(result).toContain("Foo.prototype.bar");
  });

  it("extends → Object.create + .call", () => {
    const result = downlevelClasses(
      "class Dog extends Animal {\n  constructor(name) {\n    super(name);\n  }\n}",
    );
    expect(result).toContain("Animal.call(this");
    expect(result).toContain("Object.create(Animal.prototype)");
  });
});

describe("downlevelForOf", () => {
  it("for...of → index ベースの for", () => {
    const result = downlevelForOf("for (const item of items) {");
    expect(result).toContain("for (var _i = 0");
    expect(result).toContain("items[_i]");
  });
});

// ── ES2016 ダウンレベルテスト ──

describe("downlevelExponentiation", () => {
  it("** → Math.pow()", () => {
    expect(downlevelExponentiation("x ** y")).toBe("Math.pow(x, y)");
  });
  it("base ** 2 → Math.pow(base, 2)", () => {
    expect(downlevelExponentiation("base ** 2")).toBe("Math.pow(base, 2)");
  });
});

// ── ES2018 ダウンレベルテスト ──

describe("downlevelObjectSpread", () => {
  it("{ ...obj } → Object.assign({}, obj)", () => {
    expect(downlevelObjectSpread("{ ...config }")).toBe("Object.assign({}, config)");
  });
});

// ── ES2019 ダウンレベルテスト ──

describe("downlevelOptionalCatch", () => {
  it("catch { → catch (_e) {", () => {
    expect(downlevelOptionalCatch("catch {")).toBe("catch (_e) {");
  });
});

// ── ES2020 ダウンレベルテスト ──

describe("downlevelOptionalChaining", () => {
  it("a?.b → null チェック", () => {
    const result = downlevelOptionalChaining("a?.b");
    expect(result).toContain("!== null");
    expect(result).toContain("void 0");
  });
});

describe("downlevelNullishCoalescing", () => {
  it("a ?? b → null チェック", () => {
    const result = downlevelNullishCoalescing("a ?? b");
    expect(result).toContain("!== null");
    expect(result).toContain("!== void 0");
  });
});

// ── ES2021 ダウンレベルテスト ──

describe("downlevelLogicalAssignment", () => {
  it("a ??= b → a = a ?? b", () => {
    expect(downlevelLogicalAssignment("a ??= b;")).toBe("a = a ?? b;");
  });
  it("a ||= b → a = a || b", () => {
    expect(downlevelLogicalAssignment("a ||= b;")).toBe("a = a || b;");
  });
  it("a &&= b → a = a && b", () => {
    expect(downlevelLogicalAssignment("a &&= b;")).toBe("a = a && b;");
  });
});

// ── ES2022 ダウンレベルテスト ──

describe("downlevelClassFields", () => {
  it("クラスフィールドを constructor 内に移動する", () => {
    const source = "class Foo {\n  count = 0;\n  constructor() {\n  }\n}";
    const result = downlevelClassFields(source);
    expect(result).not.toMatch(/^\s*count = 0/m);
    expect(result).toContain("this.count = 0");
  });

  it("#private → _private に変換する", () => {
    const result = downlevelClassFields("this.#secret");
    expect(result).toContain("this._secret");
  });
});

// ── 統合テスト ──

describe("transpile 統合", () => {
  const source = `const x: number = 1;
const fn = (a: number) => a ** 2;
console.log(\`result: \${fn(x)}\`);`;

  it("esnext: ほぼ変換なし（型除去のみ）", () => {
    const result = transpile(source, "esnext");
    expect(result.code).toContain("const");
    expect(result.code).toContain("=>");
    expect(result.code).toContain("**");
    expect(result.code).toContain("`");
    expect(result.code).not.toContain("number");
    expect(result.appliedPasses).toEqual(["型アノテーション除去"]);
  });

  it("es2015: ** → Math.pow に変換", () => {
    const result = transpile(source, "es2015");
    expect(result.code).toContain("Math.pow");
    expect(result.code).toContain("const");
    expect(result.code).toContain("=>");
  });

  it("es5: let/const, arrow, template, ** すべてダウンレベル", () => {
    const result = transpile(source, "es5");
    expect(result.code).toContain("var");
    expect(result.code).toContain("function");
    expect(result.code).toContain("Math.pow");
    expect(result.code).toContain(" + ");
    expect(result.code).not.toContain("const");
    expect(result.code).not.toContain("=>");
    expect(result.code).not.toContain("`");
    expect(result.code).not.toContain("**");
  });
});

// ── 全ターゲットで異なる出力が生成されることのテスト ──

describe("ターゲットごとの出力差異", () => {
  // 全機能を含むソース
  const comprehensive = `class Foo {
  count = 0;
  async run(x: number) {
    const result = x ** 2;
    const name = data?.user?.name ?? "anon";
    let config = {};
    config.x ??= 1;
    return \`result: \${result}\`;
  }
}`;

  it("es3/es5 は他のターゲットと異なる出力", () => {
    const es5 = transpile(comprehensive, "es5").code;
    const es2022 = transpile(comprehensive, "es2022").code;
    expect(es5).not.toBe(es2022);
  });

  it("es2015 と es2016 は ** の扱いが異なる", () => {
    const es2015 = transpile(comprehensive, "es2015").code;
    const es2016 = transpile(comprehensive, "es2016").code;
    expect(es2015).toContain("Math.pow");
    expect(es2016).not.toContain("Math.pow");
  });

  it("es2016 と es2017 は async/await の扱いが異なる", () => {
    const es2016 = transpile(comprehensive, "es2016").code;
    const es2017 = transpile(comprehensive, "es2017").code;
    expect(es2016).toContain("__awaiter");
    expect(es2017).not.toContain("__awaiter");
  });

  it("es2019 と es2020 は ?. と ?? の扱いが異なる", () => {
    const es2019 = transpile(comprehensive, "es2019").code;
    const es2020 = transpile(comprehensive, "es2020").code;
    expect(es2019).toContain("void 0");
    expect(es2020).toContain("?.");
  });

  it("es2020 と es2021 は ??= の扱いが異なる", () => {
    const es2020 = transpile(comprehensive, "es2020").code;
    const es2021 = transpile(comprehensive, "es2021").code;
    expect(es2020).not.toContain("??=");
    expect(es2021).toContain("??=");
  });

  it("es2021 と es2022 はクラスフィールドの扱いが異なる", () => {
    const es2021 = transpile(comprehensive, "es2021").code;
    const es2022 = transpile(comprehensive, "es2022").code;
    expect(es2021).toContain("this.count = 0");
    expect(es2022).toContain("count = 0");
  });
});
