import { describe, it, expect } from "vitest";
import { EXAMPLES } from "../ui/app.js";
import { analyze } from "../analyzer/resolver.js";

describe("EXAMPLES 配列", () => {
  it("8 つのサンプルが定義されている", () => {
    expect(EXAMPLES).toHaveLength(8);
  });

  it("各サンプルに name, code, definitions, target がある", () => {
    for (const ex of EXAMPLES) {
      expect(ex.name.length).toBeGreaterThan(0);
      expect(ex.code.length).toBeGreaterThan(0);
      expect(ex.definitions.length).toBeGreaterThan(0);
      expect(ex.target.length).toBeGreaterThan(0);
    }
  });

  it("サンプル名が重複していない", () => {
    const names = EXAMPLES.map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("各サンプルの target が definitions 内に存在する", () => {
    for (const ex of EXAMPLES) {
      const defNames = ex.definitions.map((d) => d.name);
      expect(defNames).toContain(ex.target);
    }
  });
});

describe("各サンプルの解析", () => {
  for (const ex of EXAMPLES) {
    it(`${ex.name}: 正常に解析される`, () => {
      const result = analyze(ex.definitions, ex.target);
      expect(result.steps.length).toBeGreaterThanOrEqual(2);
      expect(result.target).toBe(ex.target);
    });

    it(`${ex.name}: 最終型が never でない`, () => {
      const result = analyze(ex.definitions, ex.target);
      const final = result.steps[result.steps.length - 1]!;
      expect(final.type.kind).not.toBe("never");
    });
  }
});
