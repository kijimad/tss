import { describe, it, expect } from "vitest";
import { EXAMPLES, MODULE_SYSTEMS } from "../ui/app.js";
import { transpile } from "../transpiler/index.js";

describe("EXAMPLES 配列", () => {
  it("6 つのサンプルが定義されている", () => {
    expect(EXAMPLES).toHaveLength(6);
  });

  it("各サンプルに name と code がある", () => {
    for (const ex of EXAMPLES) {
      expect(ex.name.length).toBeGreaterThan(0);
      expect(ex.code.length).toBeGreaterThan(0);
    }
  });

  it("サンプル名が重複していない", () => {
    const names = EXAMPLES.map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("MODULE_SYSTEMS 配列", () => {
  it("5 つのモジュールシステムが定義されている", () => {
    expect(MODULE_SYSTEMS).toHaveLength(5);
  });

  it("commonjs, esm, amd, umd, system を含む", () => {
    const values = MODULE_SYSTEMS.map((s) => s.value);
    expect(values).toContain("commonjs");
    expect(values).toContain("esm");
    expect(values).toContain("amd");
    expect(values).toContain("umd");
    expect(values).toContain("system");
  });
});

describe("全サンプル × 全モジュールシステムの組み合わせ", () => {
  for (const ex of EXAMPLES) {
    for (const sys of MODULE_SYSTEMS) {
      it(`${ex.name} → ${sys.label} が正常に変換される`, () => {
        const result = transpile(ex.code, sys.value);
        expect(result.code.length).toBeGreaterThan(0);
        expect(result.description.length).toBeGreaterThan(0);
      });
    }
  }
});

describe("サンプルごとの出力差異確認", () => {
  for (const ex of EXAMPLES) {
    it(`${ex.name}: 各モジュールシステムで異なる出力を生成する`, () => {
      const outputs = MODULE_SYSTEMS.map((sys) => transpile(ex.code, sys.value).code);
      const unique = new Set(outputs);
      expect(unique.size).toBe(5);
    });
  }
});
