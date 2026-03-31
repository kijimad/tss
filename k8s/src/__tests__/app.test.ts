import { describe, it, expect } from "vitest";
import { EXAMPLES } from "../ui/app.js";
import { Cluster } from "../cluster/cluster.js";

describe("EXAMPLES", () => {
  it("7 つのサンプルが定義されている", () => {
    expect(EXAMPLES).toHaveLength(7);
  });

  it("各サンプルに必要なフィールドがある", () => {
    for (const ex of EXAMPLES) {
      expect(ex.name.length).toBeGreaterThan(0);
      expect(ex.nodes.length).toBeGreaterThan(0);
      expect(ex.steps.length).toBeGreaterThan(0);
    }
  });

  it("サンプル名が重複していない", () => {
    const names = EXAMPLES.map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("各サンプルの実行", () => {
  for (const ex of EXAMPLES) {
    it(`${ex.name}: 全ステップが実行可能`, () => {
      const c = new Cluster(ex.nodes);
      for (const step of ex.steps) {
        for (const cmd of step.commands) c.kubectl(cmd);
        c.advance(step.advanceTicks);
      }
      const snap = c.snapshot();
      expect(snap.nodes.length).toBe(ex.nodes.length);
      expect(c.eventLog.length).toBeGreaterThan(0);
    });
  }
});
