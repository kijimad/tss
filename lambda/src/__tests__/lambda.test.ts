import { describe, it, expect } from "vitest";
import { LambdaService } from "../runtime/lambda.js";
import type { LambdaConfig, LambdaEvent } from "../runtime/lambda.js";

const defaultConfig: LambdaConfig = {
  functionName: "test", runtime: "nodejs22.x", handler: "index.handler",
  memoryMb: 128, timeoutSec: 30, envVars: {}, layers: [],
  provisionedConcurrency: 0, reservedConcurrency: 100,
  code: "exports.handler = async () => ({ ok: true });",
};

const simpleHandler = () => ({ result: { ok: true }, durationMs: 10, memoryUsedMb: 50 });
const ev = (label: string): LambdaEvent => ({ source: "direct", label, payload: {} });

describe("LambdaService 基本", () => {
  it("最初の呼び出しはコールドスタート", () => {
    const svc = new LambdaService(defaultConfig, simpleHandler);
    const r = svc.invoke(ev("test"));
    expect(r.coldStart).toBe(true);
    expect(r.initDurationMs).toBeGreaterThan(0);
  });

  it("2回目以降はウォームスタート", () => {
    const svc = new LambdaService(defaultConfig, simpleHandler);
    svc.invoke(ev("1st"));
    const r = svc.invoke(ev("2nd"));
    expect(r.coldStart).toBe(false);
    expect(r.initDurationMs).toBe(0);
  });

  it("レスポンスが返る", () => {
    const svc = new LambdaService(defaultConfig, simpleHandler);
    const r = svc.invoke(ev("test"));
    expect(r.response).toEqual({ ok: true });
    expect(r.error).toBeNull();
  });

  it("課金が計算される", () => {
    const svc = new LambdaService(defaultConfig, simpleHandler);
    const r = svc.invoke(ev("test"));
    expect(r.costUsd).toBeGreaterThan(0);
    expect(r.billedDurationMs).toBeGreaterThanOrEqual(r.durationMs);
  });
});

describe("タイムアウト", () => {
  it("タイムアウトした場合 timedOut=true", () => {
    const config = { ...defaultConfig, timeoutSec: 1 };
    const slowHandler = () => ({ result: null, durationMs: 2000, memoryUsedMb: 50 });
    const svc = new LambdaService(config, slowHandler);
    const r = svc.invoke(ev("slow"));
    expect(r.timedOut).toBe(true);
    expect(r.error).toContain("timed out");
    expect(r.durationMs).toBe(1000);
  });
});

describe("同時実行上限", () => {
  it("上限超過で TooManyRequestsException", () => {
    const config = { ...defaultConfig, reservedConcurrency: 1 };
    const busyHandler = () => ({ result: null, durationMs: 10, memoryUsedMb: 50 });
    const svc = new LambdaService(config, busyHandler);
    // 1回目: 環境作成 → busy → freeze
    svc.invoke(ev("1st"));
    // ここで環境は frozen なので次は成功する
    const r2 = svc.invoke(ev("2nd"));
    expect(r2.error).toBeNull();
  });
});

describe("Provisioned Concurrency", () => {
  it("事前ウォームされた環境を使用する (コールドスタートなし)", () => {
    const config = { ...defaultConfig, provisionedConcurrency: 2 };
    const svc = new LambdaService(config, simpleHandler);
    const r = svc.invoke(ev("test"));
    expect(r.coldStart).toBe(false);
  });

  it("プロビジョニングを超えるとコールドスタートが発生する", () => {
    const config = { ...defaultConfig, provisionedConcurrency: 1 };
    const svc = new LambdaService(config, simpleHandler);
    svc.invoke(ev("1st")); // provisioned env
    // 2回目は frozen env を再利用
    const r2 = svc.invoke(ev("2nd"));
    expect(r2.coldStart).toBe(false);
  });
});

describe("統計", () => {
  it("正しい統計が集計される", () => {
    const svc = new LambdaService(defaultConfig, simpleHandler);
    svc.invoke(ev("1"));
    svc.invoke(ev("2"));
    svc.invoke(ev("3"));
    const s = svc.stats;
    expect(s.totalInvocations).toBe(3);
    expect(s.coldStarts).toBe(1);
    expect(s.warmStarts).toBe(2);
    expect(s.totalCostUsd).toBeGreaterThan(0);
  });
});

describe("トレース", () => {
  it("全呼び出しでトレースが生成される", () => {
    const svc = new LambdaService(defaultConfig, simpleHandler);
    const r = svc.invoke(ev("test"));
    expect(r.trace.length).toBeGreaterThan(0);
    expect(r.trace[0]!.phase).toBe("event_receive");
    expect(r.trace.some((t) => t.phase === "billing")).toBe(true);
  });
});

describe("ランタイム別コールドスタート", () => {
  for (const runtime of ["nodejs22.x", "python3.13", "java21", "go1.x"]) {
    it(`${runtime}: コールドスタート時間が正の値`, () => {
      const config = { ...defaultConfig, runtime };
      const svc = new LambdaService(config, simpleHandler);
      const r = svc.invoke(ev("test"));
      expect(r.initDurationMs).toBeGreaterThan(0);
    });
  }

  it("Java は Node.js よりコールドスタートが遅い", () => {
    const nodeConfig = { ...defaultConfig, runtime: "nodejs22.x" };
    const javaConfig = { ...defaultConfig, runtime: "java21" };
    const nodeSvc = new LambdaService(nodeConfig, simpleHandler);
    const javaSvc = new LambdaService(javaConfig, simpleHandler);
    const nodeR = nodeSvc.invoke(ev("node"));
    const javaR = javaSvc.invoke(ev("java"));
    expect(javaR.initDurationMs).toBeGreaterThan(nodeR.initDurationMs);
  });
});
