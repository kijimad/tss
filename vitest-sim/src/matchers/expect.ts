/**
 * expect.ts -- アサーションマッチャー
 *
 * vitest/jest 互換の expect() API を実装する。
 * expect(actual).toBe(expected) の形で、actual と expected を比較し、
 * 失敗時に詳細なエラーメッセージを生成する。
 */

export interface MatchResult {
  pass: boolean;
  message: string;
  expected: string;
  received: string;
  matcher: string;
}

export class Expectation {
  private actual: unknown;
  private negated = false;

  constructor(actual: unknown) {
    this.actual = actual;
  }

  get not(): Expectation {
    this.negated = true;
    return this;
  }

  // === 等値 ===

  toBe(expected: unknown): MatchResult {
    const pass = Object.is(this.actual, expected);
    return this.result(pass, "toBe", expected);
  }

  toEqual(expected: unknown): MatchResult {
    const pass = deepEqual(this.actual, expected);
    return this.result(pass, "toEqual", expected);
  }

  toStrictEqual(expected: unknown): MatchResult {
    const pass = deepEqual(this.actual, expected);
    return this.result(pass, "toStrictEqual", expected);
  }

  // === 真偽 ===

  toBeTruthy(): MatchResult {
    return this.result(!!this.actual, "toBeTruthy", "truthy");
  }

  toBeFalsy(): MatchResult {
    return this.result(!this.actual, "toBeFalsy", "falsy");
  }

  toBeNull(): MatchResult {
    return this.result(this.actual === null, "toBeNull", null);
  }

  toBeUndefined(): MatchResult {
    return this.result(this.actual === undefined, "toBeUndefined", undefined);
  }

  toBeDefined(): MatchResult {
    return this.result(this.actual !== undefined, "toBeDefined", "defined");
  }

  // === 数値 ===

  toBeGreaterThan(expected: number): MatchResult {
    return this.result(Number(this.actual) > expected, "toBeGreaterThan", expected);
  }

  toBeGreaterThanOrEqual(expected: number): MatchResult {
    return this.result(Number(this.actual) >= expected, "toBeGreaterThanOrEqual", expected);
  }

  toBeLessThan(expected: number): MatchResult {
    return this.result(Number(this.actual) < expected, "toBeLessThan", expected);
  }

  toBeLessThanOrEqual(expected: number): MatchResult {
    return this.result(Number(this.actual) <= expected, "toBeLessThanOrEqual", expected);
  }

  toBeCloseTo(expected: number, precision = 5): MatchResult {
    const diff = Math.abs(Number(this.actual) - expected);
    const pass = diff < Math.pow(10, -precision) / 2;
    return this.result(pass, "toBeCloseTo", expected);
  }

  toBeNaN(): MatchResult {
    return this.result(Number.isNaN(this.actual), "toBeNaN", NaN);
  }

  // === 文字列 ===

  toContain(expected: unknown): MatchResult {
    let pass = false;
    if (typeof this.actual === "string" && typeof expected === "string") {
      pass = this.actual.includes(expected);
    } else if (Array.isArray(this.actual)) {
      pass = this.actual.includes(expected);
    }
    return this.result(pass, "toContain", expected);
  }

  toMatch(pattern: RegExp | string): MatchResult {
    const str = String(this.actual);
    const pass = typeof pattern === "string" ? str.includes(pattern) : pattern.test(str);
    return this.result(pass, "toMatch", pattern);
  }

  toHaveLength(expected: number): MatchResult {
    const actual = this.actual;
    const len = (typeof actual === "string" || Array.isArray(actual)) ? actual.length : -1;
    return this.result(len === expected, "toHaveLength", expected);
  }

  // === 例外 ===

  toThrow(expected?: string | RegExp): MatchResult {
    let threw = false;
    let thrownMessage = "";
    if (typeof this.actual === "function") {
      try { this.actual(); }
      catch (e) {
        threw = true;
        thrownMessage = e instanceof Error ? e.message : String(e);
      }
    }
    let pass = threw;
    if (threw && expected !== undefined) {
      if (typeof expected === "string") pass = thrownMessage.includes(expected);
      else pass = expected.test(thrownMessage);
    }
    return this.result(pass, "toThrow", expected ?? "any error");
  }

  // === 型 ===

  toBeInstanceOf(expected: Function): MatchResult {
    const pass = this.actual instanceof expected;
    return this.result(pass, "toBeInstanceOf", expected.name);
  }

  // === ヘルパー ===

  private result(pass: boolean, matcher: string, expected: unknown): MatchResult {
    const finalPass = this.negated ? !pass : pass;
    const prefix = this.negated ? "not." : "";
    return {
      pass: finalPass,
      message: finalPass
        ? `${prefix}${matcher} passed`
        : `expect(${fmt(this.actual)}).${prefix}${matcher}(${fmt(expected)}) -- received: ${fmt(this.actual)}`,
      expected: fmt(expected),
      received: fmt(this.actual),
      matcher: `${prefix}${matcher}`,
    };
  }
}

export function expect(actual: unknown): Expectation {
  return new Expectation(actual);
}

function fmt(v: unknown): string {
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  if (typeof v === "string") return `"${v}"`;
  if (typeof v === "function") return `[Function]`;
  if (v instanceof RegExp) return v.toString();
  try { return JSON.stringify(v); } catch { return String(v); }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  const keysA = Object.keys(a); const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every(k => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
