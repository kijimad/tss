import { describe, it, expect } from "vitest";
import { EXAMPLES } from "../ui/app.js";
import { LambdaService } from "../runtime/lambda.js";

describe("EXAMPLES", () => {
  it("7 つのサンプルが定義されている", () => {
    expect(EXAMPLES).toHaveLength(7);
  });

  it("各サンプルに必要なフィールドがある", () => {
    for (const ex of EXAMPLES) {
      expect(ex.name.length).toBeGreaterThan(0);
      expect(ex.config.functionName.length).toBeGreaterThan(0);
      expect(ex.events.length).toBeGreaterThan(0);
    }
  });

  it("サンプル名が重複していない", () => {
    const names = EXAMPLES.map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("各サンプルの実行", () => {
  for (const ex of EXAMPLES) {
    it(`${ex.name}: 全イベントが実行可能`, () => {
      const svc = new LambdaService(ex.config, ex.handler);
      for (const ev of ex.events) {
        const r = svc.invoke(ev);
        expect(r.trace.length).toBeGreaterThan(0);
        expect(r.billedDurationMs).toBeGreaterThanOrEqual(0);
      }
    });
  }

  it("Hello World: 初回はコールドスタート、2回目はウォーム", () => {
    const ex = EXAMPLES[0]!;
    const svc = new LambdaService(ex.config, ex.handler);
    const r1 = svc.invoke(ex.events[0]!);
    const r2 = svc.invoke(ex.events[1]!);
    expect(r1.coldStart).toBe(true);
    expect(r2.coldStart).toBe(false);
  });

  it("タイムアウト: 遅延リクエストがタイムアウトする", () => {
    const ex = EXAMPLES[4]!;
    const svc = new LambdaService(ex.config, ex.handler);
    svc.invoke(ex.events[0]!);
    const r2 = svc.invoke(ex.events[1]!);
    expect(r2.timedOut).toBe(true);
  });

  it("Provisioned: コールドスタートが発生しない", () => {
    const ex = EXAMPLES[6]!;
    const svc = new LambdaService(ex.config, ex.handler);
    const r1 = svc.invoke(ex.events[0]!);
    expect(r1.coldStart).toBe(false);
  });
});
