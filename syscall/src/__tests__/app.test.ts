import { describe, it, expect } from "vitest";
import { EXAMPLES } from "../ui/app.js";
import { Kernel } from "../kernel/kernel.js";

describe("EXAMPLES 配列", () => {
  it("6 つのサンプルが定義されている", () => {
    expect(EXAMPLES).toHaveLength(6);
  });

  it("各サンプルに name, description, calls がある", () => {
    for (const ex of EXAMPLES) {
      expect(ex.name.length).toBeGreaterThan(0);
      expect(ex.description.length).toBeGreaterThan(0);
      expect(ex.calls.length).toBeGreaterThan(0);
    }
  });

  it("サンプル名が重複していない", () => {
    const names = EXAMPLES.map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("各 call に name, args, code がある", () => {
    for (const ex of EXAMPLES) {
      for (const c of ex.calls) {
        expect(c.name.length).toBeGreaterThan(0);
        expect(Array.isArray(c.args)).toBe(true);
        expect(c.code.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("各サンプルの全 syscall が実行可能", () => {
  for (const ex of EXAMPLES) {
    it(`${ex.name}: 全呼び出しがエラーなく実行される`, () => {
      const k = new Kernel();
      for (const c of ex.calls) {
        const res = k.execute(c);
        // ENOSYS（未知のシステムコール）でないこと
        expect(res.errname).not.toBe("ENOSYS");
        // トレースが生成されること
        expect(res.trace.length).toBeGreaterThan(0);
        // user → ... → return の流れがあること
        expect(res.trace[0]!.mode).toBe("user");
      }
    });
  }
});
