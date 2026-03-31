import { describe, it, expect } from "vitest";
import { parse, transpile, stripTypes } from "../transpiler/index.js";
import type { ModuleSystem } from "../transpiler/index.js";

// ── パーサーテスト ──

describe("parse", () => {
  it("名前付きインポートを解析できる", () => {
    const result = parse(`import { foo, bar } from './mod';`);
    expect(result.imports).toHaveLength(1);
    expect(result.imports[0]!.source).toBe("./mod");
    expect(result.imports[0]!.specifiers).toHaveLength(2);
    expect(result.imports[0]!.specifiers[0]!.kind).toBe("named");
    expect(result.imports[0]!.specifiers[0]!.imported).toBe("foo");
  });

  it("as 付き名前付きインポートを解析できる", () => {
    const result = parse(`import { foo as bar } from './mod';`);
    expect(result.imports[0]!.specifiers[0]!.imported).toBe("foo");
    expect(result.imports[0]!.specifiers[0]!.local).toBe("bar");
  });

  it("デフォルトインポートを解析できる", () => {
    const result = parse(`import Foo from './foo';`);
    expect(result.imports[0]!.specifiers[0]!.kind).toBe("default");
    expect(result.imports[0]!.specifiers[0]!.local).toBe("Foo");
  });

  it("名前空間インポートを解析できる", () => {
    const result = parse(`import * as path from 'path';`);
    expect(result.imports[0]!.specifiers[0]!.kind).toBe("namespace");
    expect(result.imports[0]!.specifiers[0]!.local).toBe("path");
  });

  it("副作用インポートを解析できる", () => {
    const result = parse(`import './polyfill';`);
    expect(result.imports[0]!.specifiers).toHaveLength(0);
    expect(result.imports[0]!.source).toBe("./polyfill");
  });

  it("型のみのインポートを typeOnly: true にする", () => {
    const result = parse(`import type { Foo } from './types';`);
    expect(result.imports[0]!.typeOnly).toBe(true);
  });

  it("export const を解析できる", () => {
    const result = parse(`export const VERSION = '1.0';`);
    expect(result.exports).toHaveLength(1);
    expect(result.exports[0]!.kind).toBe("declaration");
    expect(result.exports[0]!.declName).toBe("VERSION");
  });

  it("export function を解析できる", () => {
    const result = parse(`export function greet(name) { return name; }`);
    expect(result.exports[0]!.kind).toBe("declaration");
    expect(result.exports[0]!.declKind).toBe("function");
    expect(result.exports[0]!.declName).toBe("greet");
  });

  it("export default を解析できる", () => {
    const result = parse(`export default function main() {}`);
    expect(result.exports[0]!.kind).toBe("default");
    expect(result.exports[0]!.declName).toBe("main");
  });

  it("再エクスポートを解析できる", () => {
    const result = parse(`export { foo, bar } from './utils';`);
    expect(result.exports[0]!.kind).toBe("reexport");
    expect(result.exports[0]!.source).toBe("./utils");
  });

  it("export * from を解析できる", () => {
    const result = parse(`export * from './utils';`);
    expect(result.exports[0]!.kind).toBe("reexport-all");
  });

  it("本体コードを保持する", () => {
    const result = parse(`const x = 1;\nconsole.log(x);`);
    expect(result.bodyLines).toHaveLength(2);
    expect(result.bodyLines[0]).toContain("const x = 1");
  });

  it("interface 宣言を除外する", () => {
    const result = parse(`interface Foo { x: number }`);
    expect(result.bodyLines.join("")).not.toContain("interface");
    expect(result.exports).toHaveLength(0);
  });

  it("export type を typeOnly: true にする", () => {
    const result = parse(`export type Foo = string;`);
    expect(result.exports[0]!.typeOnly).toBe(true);
  });
});

describe("stripTypes", () => {
  it("変数の型アノテーションを除去する", () => {
    expect(stripTypes("const x: string = 'hello';")).toContain('const x = ');
  });

  it("interface 宣言を空にする", () => {
    expect(stripTypes("interface Foo { x: number }")).toBe("");
  });

  it("type 宣言を空にする", () => {
    expect(stripTypes("type Foo = string;")).toBe("");
  });
});

// ── 各モジュールシステムへの変換テスト ──

const BASIC_SOURCE = `import { readFile } from 'fs';
export const VERSION = '1.0';
export function load() { return readFile('x'); }`;

describe("transpile → CommonJS", () => {
  const result = transpile(BASIC_SOURCE, "commonjs");

  it("require() を使用する", () => {
    expect(result.code).toContain('require("fs")');
  });

  it("exports に代入する", () => {
    expect(result.code).toContain("exports.VERSION");
    expect(result.code).toContain("exports.load");
  });

  it("__esModule フラグを設定する", () => {
    expect(result.code).toContain("__esModule");
  });

  it("import / export キーワードを含まない", () => {
    expect(result.code).not.toMatch(/^import /m);
    expect(result.code).not.toMatch(/^export /m);
  });
});

describe("transpile → ESM", () => {
  const result = transpile(BASIC_SOURCE, "esm");

  it("import 文をそのまま出力する", () => {
    expect(result.code).toContain("import { readFile } from 'fs';");
  });

  it("export 文をそのまま出力する", () => {
    expect(result.code).toContain("export const VERSION");
    expect(result.code).toContain("export function load");
  });

  it("require を使用しない", () => {
    expect(result.code).not.toContain("require(");
  });
});

describe("transpile → AMD", () => {
  const result = transpile(BASIC_SOURCE, "amd");

  it("define() で囲む", () => {
    expect(result.code).toMatch(/^define\(/);
  });

  it("依存配列に 'fs' を含む", () => {
    expect(result.code).toContain('"fs"');
  });

  it("exports に代入する", () => {
    expect(result.code).toContain("exports.VERSION");
  });
});

describe("transpile → UMD", () => {
  const result = transpile(BASIC_SOURCE, "umd");

  it("CommonJS と AMD の両方の分岐がある", () => {
    expect(result.code).toContain("module.exports");
    expect(result.code).toContain("define.amd");
  });

  it("即時関数で囲む", () => {
    expect(result.code).toMatch(/^\(function\(root, factory\)/);
  });
});

describe("transpile → SystemJS", () => {
  const result = transpile(BASIC_SOURCE, "system");

  it("System.register() で囲む", () => {
    expect(result.code).toMatch(/^System\.register/);
  });

  it("setters と execute がある", () => {
    expect(result.code).toContain("setters:");
    expect(result.code).toContain("execute:");
  });

  it("exports_1() でエクスポートする", () => {
    expect(result.code).toContain('exports_1("VERSION"');
    expect(result.code).toContain('exports_1("load"');
  });
});

// ── 型のみの除外テスト ──

describe("型のみのインポート/エクスポートの除外", () => {
  const source = `import type { Foo } from './types';
import { bar } from './mod';
export type MyType = string;
export const x = 1;`;

  for (const sys of ["commonjs", "esm", "amd", "umd", "system"] as ModuleSystem[]) {
    it(`${sys}: import type が出力に含まれない`, () => {
      const result = transpile(source, sys);
      expect(result.code).not.toContain("types");
      expect(result.code).not.toContain("Foo");
    });

    it(`${sys}: export type が出力に含まれない`, () => {
      const result = transpile(source, sys);
      expect(result.code).not.toContain("MyType");
    });

    it(`${sys}: 通常のインポート/エクスポートは含まれる`, () => {
      const result = transpile(source, sys);
      expect(result.code).toContain("mod");
    });
  }
});

// ── 全モジュールシステムで出力が異なることのテスト ──

describe("各モジュールシステムで異なる出力が生成される", () => {
  const source = `import { foo } from './bar';
export const x = 1;`;

  const results = (["commonjs", "esm", "amd", "umd", "system"] as ModuleSystem[]).map((sys) => ({
    sys,
    code: transpile(source, sys).code,
  }));

  it("5 種類すべて異なる出力", () => {
    const unique = new Set(results.map((r) => r.code));
    expect(unique.size).toBe(5);
  });
});
