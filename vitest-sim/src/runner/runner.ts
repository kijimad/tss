/**
 * runner.ts -- テストランナー
 *
 * vitest のテスト実行エンジン:
 *   1. テストファイルを収集
 *   2. describe/it/test ブロックをパース
 *   3. beforeEach/afterEach フックを実行
 *   4. 各テストを実行し、expect の結果を収集
 *   5. 結果をレポート
 *
 * テストの定義は JavaScript コードを new Function で実行し、
 * グローバルに describe/it/expect を注入して収集する。
 */
import { expect, type MatchResult, type Expectation } from "../matchers/expect.js";

// テストスイート (describe)
export interface TestSuite {
  name: string;
  tests: TestCase[];
  suites: TestSuite[];    // ネストした describe
  beforeEachFns: (() => void)[];
  afterEachFns: (() => void)[];
  beforeAllFns: (() => void)[];
  afterAllFns: (() => void)[];
}

// テストケース (it/test)
export interface TestCase {
  name: string;
  fn: () => void;
  result: TestResult | undefined;
}

// テスト結果
export interface TestResult {
  status: "pass" | "fail" | "skip";
  duration: number;         // ms
  assertions: MatchResult[];
  error: string | undefined;
}

// ファイルごとの結果
export interface FileResult {
  path: string;
  suite: TestSuite;
  totalTests: number;
  passed: number;
  failed: number;
  duration: number;
}

// ランナーイベント
export type RunnerEvent =
  | { type: "file_start"; path: string }
  | { type: "suite_start"; name: string; depth: number }
  | { type: "test_start"; name: string }
  | { type: "test_pass"; name: string; duration: number; assertions: number }
  | { type: "test_fail"; name: string; duration: number; error: string }
  | { type: "file_complete"; path: string; passed: number; failed: number; duration: number }
  | { type: "run_complete"; files: number; passed: number; failed: number; duration: number };

export class TestRunner {
  events: RunnerEvent[] = [];
  onEvent: ((event: RunnerEvent) => void) | undefined;

  private emit(event: RunnerEvent): void { this.events.push(event); this.onEvent?.(event); }

  // テストファイル群を実行
  runFiles(files: { path: string; code: string }[]): FileResult[] {
    this.events = [];
    const startTime = performance.now();
    const results: FileResult[] = [];
    let totalPassed = 0;
    let totalFailed = 0;

    for (const file of files) {
      const result = this.runFile(file.path, file.code);
      results.push(result);
      totalPassed += result.passed;
      totalFailed += result.failed;
    }

    const totalDuration = performance.now() - startTime;
    this.emit({
      type: "run_complete",
      files: files.length,
      passed: totalPassed,
      failed: totalFailed,
      duration: totalDuration,
    });

    return results;
  }

  // 1ファイルを実行
  runFile(path: string, code: string): FileResult {
    this.emit({ type: "file_start", path });
    const startTime = performance.now();

    // テストスイートを収集
    const rootSuite: TestSuite = {
      name: path, tests: [], suites: [],
      beforeEachFns: [], afterEachFns: [],
      beforeAllFns: [], afterAllFns: [],
    };
    this.collectTests(code, rootSuite);

    // テストを実行
    let passed = 0;
    let failed = 0;
    this.executeSuite(rootSuite, [], 0);

    // 結果を集計
    const countResults = (suite: TestSuite): void => {
      for (const test of suite.tests) {
        if (test.result?.status === "pass") passed++;
        else if (test.result?.status === "fail") failed++;
      }
      for (const sub of suite.suites) countResults(sub);
    };
    countResults(rootSuite);

    const duration = performance.now() - startTime;
    this.emit({ type: "file_complete", path, passed, failed, duration });

    return {
      path,
      suite: rootSuite,
      totalTests: passed + failed,
      passed, failed, duration,
    };
  }

  // コードからテストを収集（describe/it を注入して実行）
  private collectTests(code: string, rootSuite: TestSuite): void {
    const suiteStack: TestSuite[] = [rootSuite];

    const currentSuite = (): TestSuite => suiteStack[suiteStack.length - 1] ?? rootSuite;

    const describeFn = (name: string, fn: () => void) => {
      const suite: TestSuite = {
        name, tests: [], suites: [],
        beforeEachFns: [], afterEachFns: [],
        beforeAllFns: [], afterAllFns: [],
      };
      currentSuite().suites.push(suite);
      suiteStack.push(suite);
      fn();
      suiteStack.pop();
    };

    const itFn = (name: string, fn: () => void) => {
      currentSuite().tests.push({ name, fn, result: undefined });
    };

    const beforeEachFn = (fn: () => void) => { currentSuite().beforeEachFns.push(fn); };
    const afterEachFn = (fn: () => void) => { currentSuite().afterEachFns.push(fn); };
    const beforeAllFn = (fn: () => void) => { currentSuite().beforeAllFns.push(fn); };
    const afterAllFn = (fn: () => void) => { currentSuite().afterAllFns.push(fn); };

    // expect を wrap して結果を収集
    const wrappedExpect = (actual: unknown): Record<string, (...args: unknown[]) => void> => {
      const exp = expect(actual);
      return new Proxy({} as Record<string, (...args: unknown[]) => void>, {
        get(_target, prop: string) {
          if (prop === "not") {
            const notExp = exp.not;
            return new Proxy({} as Record<string, (...args: unknown[]) => void>, {
              get(_t2, p2: string) {
                return (...args: unknown[]) => {
                  const method = (notExp as Record<string, Function>)[p2];
                  if (typeof method === "function") {
                    const result = method.apply(notExp, args) as MatchResult;
                    collectAssertion(result);
                    if (!result.pass) throw new Error(result.message);
                  }
                };
              },
            });
          }
          return (...args: unknown[]) => {
            const method = (exp as Record<string, Function>)[prop];
            if (typeof method === "function") {
              const result = method.apply(exp, args) as MatchResult;
              collectAssertion(result);
              if (!result.pass) throw new Error(result.message);
            }
          };
        },
      });
    };

    let currentAssertions: MatchResult[] = [];
    const collectAssertion = (result: MatchResult) => { currentAssertions.push(result); };

    // テスト実行時にアサーションを紐付けるため、currentAssertions への参照を保持
    (this as unknown as { _currentAssertions: MatchResult[] })._currentAssertions = currentAssertions;
    (this as unknown as { _collectAssertion: (r: MatchResult) => void })._collectAssertion = collectAssertion;

    try {
      const fn = new Function(
        "describe", "it", "test", "expect",
        "beforeEach", "afterEach", "beforeAll", "afterAll",
        code,
      );
      fn(describeFn, itFn, itFn, wrappedExpect, beforeEachFn, afterEachFn, beforeAllFn, afterAllFn);
    } catch (e) {
      // トップレベルのコードでエラー
      rootSuite.tests.push({
        name: "Collection Error",
        fn: () => { throw e; },
        result: { status: "fail", duration: 0, assertions: [], error: e instanceof Error ? e.message : String(e) },
      });
    }
  }

  // スイートを再帰的に実行
  private executeSuite(suite: TestSuite, parentBeforeEach: (() => void)[], depth: number): void {
    if (suite.name !== suite.tests[0]?.name || suite.suites.length > 0 || suite.tests.length > 0) {
      this.emit({ type: "suite_start", name: suite.name, depth });
    }

    // beforeAll
    for (const fn of suite.beforeAllFns) {
      try { fn(); } catch { /* ignore */ }
    }

    const allBeforeEach = [...parentBeforeEach, ...suite.beforeEachFns];

    // テストケース実行
    for (const test of suite.tests) {
      if (test.result !== undefined) continue; // 既に結果がある（収集時エラー）

      this.emit({ type: "test_start", name: test.name });
      const startTime = performance.now();
      const assertions: MatchResult[] = [];

      // beforeEach 実行
      for (const fn of allBeforeEach) {
        try { fn(); } catch { /* ignore */ }
      }

      let error: string | undefined;
      try {
        // expect のアサーション収集を一時的にリダイレクト
        const origCollect = (this as unknown as { _collectAssertion: (r: MatchResult) => void })._collectAssertion;
        (this as unknown as { _collectAssertion: (r: MatchResult) => void })._collectAssertion = (r) => assertions.push(r);
        test.fn();
        (this as unknown as { _collectAssertion: (r: MatchResult) => void })._collectAssertion = origCollect;
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }

      // afterEach 実行
      for (const fn of suite.afterEachFns) {
        try { fn(); } catch { /* ignore */ }
      }

      const duration = performance.now() - startTime;
      const status = error !== undefined ? "fail" : "pass";
      test.result = { status, duration, assertions, error };

      if (status === "pass") {
        this.emit({ type: "test_pass", name: test.name, duration, assertions: assertions.length });
      } else {
        this.emit({ type: "test_fail", name: test.name, duration, error: error ?? "" });
      }
    }

    // ネストしたスイート
    for (const sub of suite.suites) {
      this.executeSuite(sub, allBeforeEach, depth + 1);
    }

    // afterAll
    for (const fn of suite.afterAllFns) {
      try { fn(); } catch { /* ignore */ }
    }
  }
}
