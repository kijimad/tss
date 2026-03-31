import { describe, it, expect } from "vitest";
import { EXAMPLES } from "../ui/app.js";
import { transpile, ALL_TARGETS } from "../transpiler/index.js";

describe("EXAMPLES 配列", () => {
  it("8 つのサンプルが定義されている", () => {
    expect(EXAMPLES).toHaveLength(8);
  });

  it("各サンプルに name, boundary, code がある", () => {
    for (const ex of EXAMPLES) {
      expect(ex.name.length).toBeGreaterThan(0);
      expect(ex.boundary.length).toBeGreaterThan(0);
      expect(ex.code.length).toBeGreaterThan(0);
    }
  });

  it("サンプル名が重複していない", () => {
    const names = EXAMPLES.map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("全サンプル × 全ターゲットの組み合わせ", () => {
  for (const ex of EXAMPLES) {
    for (const t of ALL_TARGETS) {
      it(`${ex.name} → ${t.label} が正常に変換される`, () => {
        const result = transpile(ex.code, t.value);
        expect(result.code.length).toBeGreaterThan(0);
        expect(result.appliedPasses.length).toBeGreaterThan(0);
      });
    }
  }
});

describe("各サンプルで es5 と esnext の出力が異なる", () => {
  for (const ex of EXAMPLES) {
    it(`${ex.name}: es5 ≠ esnext`, () => {
      const es5 = transpile(ex.code, "es5").code;
      const esnext = transpile(ex.code, "esnext").code;
      expect(es5).not.toBe(esnext);
    });
  }
});
