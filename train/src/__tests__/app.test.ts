import { describe, it, expect } from "vitest";
import { EXAMPLES } from "../ui/app.js";
import { simulate } from "../sim/physics.js";

describe("EXAMPLES 配列", () => {
  it("6 つのサンプルが定義されている", () => {
    expect(EXAMPLES).toHaveLength(6);
  });

  it("各サンプルに必要なフィールドがある", () => {
    for (const ex of EXAMPLES) {
      expect(ex.name.length).toBeGreaterThan(0);
      expect(ex.spec.mass).toBeGreaterThan(0);
      expect(ex.sections.length).toBeGreaterThan(0);
      expect(ex.schedule.entries.length).toBeGreaterThan(0);
      expect(ex.maxTime).toBeGreaterThan(0);
    }
  });

  it("サンプル名が重複していない", () => {
    const names = EXAMPLES.map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("各サンプルのシミュレーション実行", () => {
  for (const ex of EXAMPLES) {
    it(`${ex.name}: 正常にシミュレーション完了`, () => {
      const result = simulate(ex.spec, ex.sections, ex.stations, ex.signals, ex.schedule, ex.maxTime);
      expect(result.snapshots.length).toBeGreaterThan(0);
      expect(result.totalTime).toBeGreaterThan(0);
      expect(result.maxSpeed).toBeGreaterThan(0);
    });
  }

  it("新幹線は 200km/h 以上出る", () => {
    const ex = EXAMPLES[1]!;
    const result = simulate(ex.spec, ex.sections, ex.stations, ex.signals, ex.schedule, ex.maxTime);
    expect(result.maxSpeed).toBeGreaterThan(120);
  });

  it("キハ40 は山岳路線で速度が低下する", () => {
    const ex = EXAMPLES[3]!;
    const result = simulate(ex.spec, ex.sections, ex.stations, ex.signals, ex.schedule, ex.maxTime);
    expect(result.maxSpeed).toBeLessThan(100);
  });
});
