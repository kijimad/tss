import { describe, it, expect } from "vitest";
import { expect as simExpect } from "../matchers/expect.js";
import { TestRunner } from "../runner/runner.js";
import { EXAMPLES } from "../ui/app.js";

describe("マッチャー (expect)", () => {
  it("toBe: 同値", () => {
    expect(simExpect(42).toBe(42).pass).toBe(true);
    expect(simExpect(42).toBe(43).pass).toBe(false);
  });

  it("toBe: 文字列", () => {
    expect(simExpect("hello").toBe("hello").pass).toBe(true);
    expect(simExpect("hello").toBe("world").pass).toBe(false);
  });

  it("toEqual: オブジェクト深い比較", () => {
    expect(simExpect({ a: 1, b: [2, 3] }).toEqual({ a: 1, b: [2, 3] }).pass).toBe(true);
    expect(simExpect({ a: 1 }).toEqual({ a: 2 }).pass).toBe(false);
  });

  it("not: 否定", () => {
    expect(simExpect(1).not.toBe(2).pass).toBe(true);
    expect(simExpect(1).not.toBe(1).pass).toBe(false);
  });

  it("toBeTruthy / toBeFalsy", () => {
    expect(simExpect(1).toBeTruthy().pass).toBe(true);
    expect(simExpect(0).toBeFalsy().pass).toBe(true);
    expect(simExpect("").toBeFalsy().pass).toBe(true);
    expect(simExpect("x").toBeTruthy().pass).toBe(true);
  });

  it("toBeNull / toBeUndefined / toBeDefined", () => {
    expect(simExpect(null).toBeNull().pass).toBe(true);
    expect(simExpect(undefined).toBeUndefined().pass).toBe(true);
    expect(simExpect(42).toBeDefined().pass).toBe(true);
  });

  it("数値比較", () => {
    expect(simExpect(10).toBeGreaterThan(5).pass).toBe(true);
    expect(simExpect(10).toBeLessThan(20).pass).toBe(true);
    expect(simExpect(0.1 + 0.2).toBeCloseTo(0.3).pass).toBe(true);
  });

  it("toContain", () => {
    expect(simExpect("hello world").toContain("world").pass).toBe(true);
    expect(simExpect([1, 2, 3]).toContain(2).pass).toBe(true);
    expect(simExpect([1, 2, 3]).toContain(4).pass).toBe(false);
  });

  it("toHaveLength", () => {
    expect(simExpect([1, 2, 3]).toHaveLength(3).pass).toBe(true);
    expect(simExpect("abc").toHaveLength(3).pass).toBe(true);
  });

  it("toThrow", () => {
    expect(simExpect(() => { throw new Error("boom"); }).toThrow("boom").pass).toBe(true);
    expect(simExpect(() => { throw new Error("boom"); }).toThrow().pass).toBe(true);
    expect(simExpect(() => {}).toThrow().pass).toBe(false);
  });

  it("toMatch", () => {
    expect(simExpect("hello-123").toMatch(/\d+/).pass).toBe(true);
    expect(simExpect("hello").toMatch("ell").pass).toBe(true);
  });

  it("失敗時のメッセージにexpected/receivedが含まれる", () => {
    const result = simExpect(42).toBe(99);
    expect(result.pass).toBe(false);
    expect(result.message).toContain("42");
    expect(result.message).toContain("99");
    expect(result.matcher).toBe("toBe");
  });
});

describe("テストランナー", () => {
  it("テストを収集して実行する", () => {
    const runner = new TestRunner();
    const results = runner.runFiles([{
      path: "math.test.js",
      code: `
        describe("math", function() {
          it("1 + 1 = 2", function() {
            expect(1 + 1).toBe(2);
          });
          it("2 * 3 = 6", function() {
            expect(2 * 3).toBe(6);
          });
        });
      `,
    }]);
    expect(results).toHaveLength(1);
    expect(results[0]?.passed).toBe(2);
    expect(results[0]?.failed).toBe(0);
  });

  it("失敗するテストを検出する", () => {
    const runner = new TestRunner();
    const results = runner.runFiles([{
      path: "fail.test.js",
      code: `
        it("should fail", function() {
          expect(1).toBe(2);
        });
      `,
    }]);
    expect(results[0]?.failed).toBe(1);
  });

  it("ネストした describe を処理する", () => {
    const runner = new TestRunner();
    const results = runner.runFiles([{
      path: "nested.test.js",
      code: `
        describe("outer", function() {
          describe("inner", function() {
            it("test", function() {
              expect(true).toBeTruthy();
            });
          });
        });
      `,
    }]);
    expect(results[0]?.passed).toBe(1);
  });

  it("beforeEach が各テストの前に実行される", () => {
    const runner = new TestRunner();
    const results = runner.runFiles([{
      path: "hooks.test.js",
      code: `
        var counter = 0;
        beforeEach(function() { counter = 0; });
        it("first", function() { counter++; expect(counter).toBe(1); });
        it("second", function() { counter++; expect(counter).toBe(1); });
      `,
    }]);
    expect(results[0]?.passed).toBe(2);
  });

  it("複数ファイルを実行する", () => {
    const runner = new TestRunner();
    const results = runner.runFiles([
      { path: "a.test.js", code: `it("a", function() { expect(1).toBe(1); });` },
      { path: "b.test.js", code: `it("b", function() { expect(2).toBe(2); });` },
    ]);
    expect(results).toHaveLength(2);
    expect(results[0]?.passed).toBe(1);
    expect(results[1]?.passed).toBe(1);
  });

  it("イベントが記録される", () => {
    const runner = new TestRunner();
    runner.runFiles([{
      path: "events.test.js",
      code: `it("pass", function() { expect(true).toBeTruthy(); });`,
    }]);
    const passes = runner.events.filter(e => e.type === "test_pass");
    expect(passes).toHaveLength(1);
    const completes = runner.events.filter(e => e.type === "run_complete");
    expect(completes).toHaveLength(1);
  });

  it("例外がテスト失敗として報告される", () => {
    const runner = new TestRunner();
    const results = runner.runFiles([{
      path: "throw.test.js",
      code: `it("throws", function() { throw new Error("boom"); });`,
    }]);
    expect(results[0]?.failed).toBe(1);
  });

  it("toEqual でオブジェクト比較ができる", () => {
    const runner = new TestRunner();
    const results = runner.runFiles([{
      path: "obj.test.js",
      code: `
        it("deep equal", function() {
          expect({ a: 1, b: [2, 3] }).toEqual({ a: 1, b: [2, 3] });
        });
      `,
    }]);
    expect(results[0]?.passed).toBe(1);
  });
});

describe("EXAMPLES サンプルコード", () => {
  it("5つのサンプルが定義されている", () => {
    expect(EXAMPLES).toHaveLength(5);
  });

  it("各サンプルにラベルとファイルがある", () => {
    for (const example of EXAMPLES) {
      expect(example.label).toBeTruthy();
      expect(example.files.length).toBeGreaterThan(0);
      for (const file of example.files) {
        expect(file.path).toBeTruthy();
        expect(file.code).toBeTruthy();
      }
    }
  });

  it("基本的なテスト: 全テストが成功する", () => {
    const runner = new TestRunner();
    const example = EXAMPLES.find(e => e.label === "基本的なテスト");
    expect(example).toBeDefined();
    const results = runner.runFiles(example!.files);
    expect(results[0]?.failed).toBe(0);
    expect(results[0]?.passed).toBeGreaterThan(0);
  });

  it("非同期テスト: 全テストが成功する", () => {
    const runner = new TestRunner();
    const example = EXAMPLES.find(e => e.label === "非同期テスト");
    expect(example).toBeDefined();
    const results = runner.runFiles(example!.files);
    expect(results[0]?.failed).toBe(0);
    expect(results[0]?.passed).toBeGreaterThan(0);
  });

  it("モック: 全テストが成功する", () => {
    const runner = new TestRunner();
    const example = EXAMPLES.find(e => e.label === "モック");
    expect(example).toBeDefined();
    const results = runner.runFiles(example!.files);
    expect(results[0]?.failed).toBe(0);
    expect(results[0]?.passed).toBeGreaterThan(0);
  });

  it("describe ネスト: 全テストが成功する", () => {
    const runner = new TestRunner();
    const example = EXAMPLES.find(e => e.label === "describe ネスト");
    expect(example).toBeDefined();
    const results = runner.runFiles(example!.files);
    expect(results[0]?.failed).toBe(0);
    expect(results[0]?.passed).toBeGreaterThan(0);
  });

  it("スナップショット: 全テストが成功する", () => {
    const runner = new TestRunner();
    const example = EXAMPLES.find(e => e.label === "スナップショット");
    expect(example).toBeDefined();
    const results = runner.runFiles(example!.files);
    expect(results[0]?.failed).toBe(0);
    expect(results[0]?.passed).toBeGreaterThan(0);
  });
});
