import { describe, it, expect } from "vitest";
import { parse, buildNfa, simulateNfa, astToString } from "../engine/regex.js";
import { EXAMPLES } from "../ui/app.js";

/** ヘルパー: パターンと入力でマッチを実行 */
function match(pattern: string, input: string): boolean {
  const ast = parse(pattern);
  const nfa = buildNfa(ast);
  return simulateNfa(nfa, input).matched;
}

describe("パーサー", () => {
  it("リテラルを解析する", () => {
    const ast = parse("abc");
    expect(astToString(ast)).toContain("Literal");
  });

  it("選択 (|) を解析する", () => {
    const ast = parse("a|b");
    expect(astToString(ast)).toContain("Alt");
  });

  it("量指定子 (* + ?) を解析する", () => {
    expect(astToString(parse("a*"))).toContain("Star");
    expect(astToString(parse("a+"))).toContain("Plus");
    expect(astToString(parse("a?"))).toContain("Question");
  });

  it("グループを解析する", () => {
    const ast = parse("(ab)");
    expect(astToString(ast)).toContain("Group");
  });

  it("文字クラスを解析する", () => {
    const ast = parse("[a-z]");
    expect(astToString(ast)).toContain("CharClass");
  });

  it("エスケープを解析する", () => {
    const ast = parse("\\d");
    expect(astToString(ast)).toContain("CharClass");
  });
});

describe("NFA 構築", () => {
  it("リテラルで 2 状態を生成する", () => {
    const nfa = buildNfa(parse("a"));
    expect(nfa.states.length).toBe(2);
  });

  it("選択で分岐状態を作る", () => {
    const nfa = buildNfa(parse("a|b"));
    expect(nfa.states.length).toBeGreaterThan(4);
  });

  it("star でループ構造を作る", () => {
    const nfa = buildNfa(parse("a*"));
    const starState = nfa.states.find((s) => s.label === "*");
    expect(starState).toBeDefined();
    expect(starState!.epsilon.length).toBe(2); // child start + accept
  });

  it("連結で状態をチェーンする", () => {
    const nfa = buildNfa(parse("ab"));
    expect(nfa.states.length).toBe(4); // a(2) + b(2)
  });
});

describe("リテラルマッチ", () => {
  it("完全一致", () => { expect(match("abc", "abc")).toBe(true); });
  it("不一致", () => { expect(match("abc", "abd")).toBe(false); });
  it("部分一致は不一致", () => { expect(match("abc", "ab")).toBe(false); });
  it("空パターンは空文字列にマッチ", () => { expect(match("", "")).toBe(true); });
});

describe("選択 (|)", () => {
  it("左にマッチ", () => { expect(match("cat|dog", "cat")).toBe(true); });
  it("右にマッチ", () => { expect(match("cat|dog", "dog")).toBe(true); });
  it("どちらにも不一致", () => { expect(match("cat|dog", "bird")).toBe(false); });
});

describe("量指定子", () => {
  it("* (0回)", () => { expect(match("ab*c", "ac")).toBe(true); });
  it("* (複数回)", () => { expect(match("ab*c", "abbbc")).toBe(true); });
  it("+ (1回以上)", () => { expect(match("ab+c", "abc")).toBe(true); });
  it("+ (0回は不一致)", () => { expect(match("ab+c", "ac")).toBe(false); });
  it("? (0回)", () => { expect(match("ab?c", "ac")).toBe(true); });
  it("? (1回)", () => { expect(match("ab?c", "abc")).toBe(true); });
});

describe("ドット (.)", () => {
  it("任意の 1 文字にマッチ", () => { expect(match("a.c", "abc")).toBe(true); });
  it("数字にもマッチ", () => { expect(match("a.c", "a1c")).toBe(true); });
  it("文字なしは不一致", () => { expect(match("a.c", "ac")).toBe(false); });
});

describe("文字クラス", () => {
  it("[a-z] にマッチ", () => { expect(match("[a-z]", "m")).toBe(true); });
  it("[a-z] に数字は不一致", () => { expect(match("[a-z]", "5")).toBe(false); });
  it("[0-9]+ で数字列にマッチ", () => { expect(match("[0-9]+", "123")).toBe(true); });
});

describe("グループ", () => {
  it("(ab)+c にマッチ", () => { expect(match("(ab)+c", "ababc")).toBe(true); });
  it("(ab)+c で 0 回は不一致", () => { expect(match("(ab)+c", "c")).toBe(false); });
});

describe("エスケープシーケンス", () => {
  it("\\d で数字にマッチ", () => { expect(match("\\d", "5")).toBe(true); });
  it("\\d で文字に不一致", () => { expect(match("\\d", "a")).toBe(false); });
  it("\\w で単語文字にマッチ", () => { expect(match("\\w+", "hello_123")).toBe(true); });
});

describe("トレース", () => {
  it("ステップが記録される", () => {
    const nfa = buildNfa(parse("abc"));
    const result = simulateNfa(nfa, "abc");
    expect(result.steps.length).toBeGreaterThan(0);
    expect(result.steps[0]!.phase).toBe("start");
  });

  it("マッチ時に accept ステップがある", () => {
    const nfa = buildNfa(parse("a"));
    const result = simulateNfa(nfa, "a");
    expect(result.steps.some((s) => s.phase === "accept")).toBe(true);
  });

  it("不一致時に reject ステップがある", () => {
    const nfa = buildNfa(parse("a"));
    const result = simulateNfa(nfa, "b");
    expect(result.steps.some((s) => s.phase === "reject")).toBe(true);
  });
});

describe("EXAMPLES", () => {
  it("8 つのサンプル", () => { expect(EXAMPLES).toHaveLength(8); });
  it("名前が一意", () => { expect(new Set(EXAMPLES.map((e) => e.name)).size).toBe(EXAMPLES.length); });

  for (const ex of EXAMPLES) {
    it(`${ex.name}: 全入力が実行可能`, () => {
      const ast = parse(ex.pattern);
      const nfa = buildNfa(ast);
      for (const input of ex.inputs) {
        const result = simulateNfa(nfa, input);
        expect(result.steps.length).toBeGreaterThan(0);
      }
    });
  }
});
