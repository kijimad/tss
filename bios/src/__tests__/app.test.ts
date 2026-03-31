import { describe, it, expect } from "vitest";
import { EXAMPLES, type Example } from "../ui/app.js";

describe("EXAMPLES プリセット配列", () => {
  it("4 つのプリセット例が定義されている", () => {
    expect(EXAMPLES).toHaveLength(4);
  });

  it("各プリセットに必要なプロパティがある", () => {
    for (const ex of EXAMPLES) {
      expect(ex).toHaveProperty("name");
      expect(ex).toHaveProperty("mode");
      expect(ex).toHaveProperty("speed");
    }
  });

  it("mode は 'normal' または 'faulty' のみ", () => {
    for (const ex of EXAMPLES) {
      expect(["normal", "faulty"]).toContain(ex.mode);
    }
  });

  it("speed は正の数値", () => {
    for (const ex of EXAMPLES) {
      expect(ex.speed).toBeGreaterThan(0);
    }
  });

  it("正常起動と故障RAM の両方のモードが含まれる", () => {
    const modes = EXAMPLES.map((ex) => ex.mode);
    expect(modes).toContain("normal");
    expect(modes).toContain("faulty");
  });

  it("低速プリセットは高速プリセットより speed 値が大きい", () => {
    const normalSlow = EXAMPLES.find(
      (ex) => ex.mode === "normal" && ex.name.includes("低速"),
    );
    const normalFast = EXAMPLES.find(
      (ex) => ex.mode === "normal" && ex.name.includes("高速"),
    );
    expect(normalSlow).toBeDefined();
    expect(normalFast).toBeDefined();
    // speed はディレイ（ms）なので、低速の方が値が大きい
    expect(normalSlow!.speed).toBeGreaterThan(normalFast!.speed);
  });

  it("名前が一意である", () => {
    const names = EXAMPLES.map((ex) => ex.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
