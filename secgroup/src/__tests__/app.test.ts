import { describe, it, expect } from "vitest";
import { EXAMPLES } from "../ui/app.js";
import { FirewallEngine } from "../engine/firewall.js";

describe("EXAMPLES 配列", () => {
  it("6 つのサンプルが定義されている", () => {
    expect(EXAMPLES).toHaveLength(EXAMPLES.length);
    expect(EXAMPLES.length).toBeGreaterThanOrEqual(5);
  });

  it("各サンプルに必要なフィールドがある", () => {
    for (const ex of EXAMPLES) {
      expect(ex.name.length).toBeGreaterThan(0);
      expect(ex.groups.length).toBeGreaterThan(0);
      expect(ex.instances.length).toBeGreaterThan(0);
      expect(ex.packets.length).toBeGreaterThan(0);
    }
  });

  it("サンプル名が重複していない", () => {
    const names = EXAMPLES.map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("各サンプルの全パケット評価", () => {
  for (const ex of EXAMPLES) {
    it(`${ex.name}: 全パケットが評価可能`, () => {
      const engine = new FirewallEngine(ex.groups, ex.instances);
      for (const p of ex.packets) {
        const result = engine.evaluate(p.packet, p.direction);
        expect(typeof result.allowed).toBe("boolean");
        expect(result.trace.length).toBeGreaterThan(0);
      }
    });
  }

  it("Web サーバー: HTTP は許可、SSH は拒否", () => {
    const ex = EXAMPLES[0]!;
    const engine = new FirewallEngine(ex.groups, ex.instances);
    const results = ex.packets.map((p) => engine.evaluate(p.packet, p.direction));
    // HTTP (port 80) → 許可
    expect(results[0]!.allowed).toBe(true);
    // SSH (port 22) → 拒否
    expect(results[2]!.allowed).toBe(false);
  });

  it("デフォルト全拒否: 全パケットが拒否される", () => {
    const ex = EXAMPLES[3]!;
    const engine = new FirewallEngine(ex.groups, ex.instances);
    for (const p of ex.packets) {
      expect(engine.evaluate(p.packet, p.direction).allowed).toBe(false);
    }
  });
});
