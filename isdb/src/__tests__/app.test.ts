import { describe, it, expect } from "vitest";
import { EXAMPLES } from "../ui/app.js";
import { createTokyoChannels, simulateReception } from "../broadcast/isdb.js";

const channels = createTokyoChannels();

describe("EXAMPLES 配列", () => {
  it("6 つのサンプルが定義されている", () => {
    expect(EXAMPLES).toHaveLength(6);
  });

  it("各サンプルに必要なフィールドがある", () => {
    for (const ex of EXAMPLES) {
      expect(ex.name.length).toBeGreaterThan(0);
      expect(ex.description.length).toBeGreaterThan(0);
      expect(ex.physCh).toBeGreaterThanOrEqual(13);
      expect(ex.noiseLevel).toBeGreaterThanOrEqual(0);
    }
  });

  it("サンプル名が重複していない", () => {
    const names = EXAMPLES.map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("各サンプルの physCh がチャンネル一覧に存在する", () => {
    for (const ex of EXAMPLES) {
      expect(channels.find((c) => c.physCh === ex.physCh)).toBeDefined();
    }
  });
});

describe("各サンプルの受信シミュレーション", () => {
  for (const ex of EXAMPLES) {
    it(`${ex.name}: シミュレーションが実行可能`, () => {
      const ch = channels.find((c) => c.physCh === ex.physCh)!;
      const result = simulateReception(ch, ex.noiseLevel);
      expect(result.steps.length).toBeGreaterThan(0);
      expect(typeof result.locked).toBe("boolean");
      expect(typeof result.signalLevel).toBe("number");
    });
  }

  it("良好受信サンプルは locked=true", () => {
    const ex = EXAMPLES[0]!;
    const ch = channels.find((c) => c.physCh === ex.physCh)!;
    const result = simulateReception(ch, ex.noiseLevel);
    expect(result.locked).toBe(true);
  });

  it("受信不可サンプルは locked=false", () => {
    const ex = EXAMPLES[4]!;
    const ch = channels.find((c) => c.physCh === ex.physCh)!;
    const result = simulateReception(ch, ex.noiseLevel);
    expect(result.locked).toBe(false);
  });
});
