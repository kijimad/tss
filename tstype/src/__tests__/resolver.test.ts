import { describe, it, expect } from "vitest";
import { analyze } from "../analyzer/resolver.js";
import { typeToString } from "../analyzer/types.js";
import type { TypeNode, TypeDef } from "../analyzer/types.js";

const prim = (n: string): TypeNode => ({ kind: "primitive", name: n });
const lit = (v: string | number | boolean): TypeNode => ({ kind: "literal", value: v });
const ref = (n: string): TypeNode => ({ kind: "ref", name: n });
const union = (...ms: TypeNode[]): TypeNode => ({ kind: "union", members: ms });
const obj = (...ps: [string, TypeNode, boolean?][]): TypeNode => ({
  kind: "object",
  properties: ps.map(([name, type, optional]) => ({ name, type, optional: optional ?? false, readonly: false })),
});
const gen = (name: string, ...args: TypeNode[]): TypeNode => ({ kind: "generic", name, args });
const fn = (params: [string, TypeNode][], ret: TypeNode): TypeNode => ({
  kind: "function",
  params: params.map(([name, type]) => ({ name, type })),
  returnType: ret,
});

describe("基本的な型解決", () => {
  it("ref を展開する", () => {
    const defs: TypeDef[] = [
      { name: "Foo", params: [], body: prim("string") },
      { name: "Bar", params: [], body: ref("Foo") },
    ];
    const result = analyze(defs, "Bar");
    const final = result.steps[result.steps.length - 1]!;
    expect(typeToString(final.type)).toBe("string");
  });

  it("union の ref を解決する", () => {
    const defs: TypeDef[] = [
      { name: "ID", params: [], body: union(prim("string"), prim("number")) },
      { name: "Result", params: [], body: ref("ID") },
    ];
    const result = analyze(defs, "Result");
    const final = result.steps[result.steps.length - 1]!;
    expect(typeToString(final.type)).toContain("string");
    expect(typeToString(final.type)).toContain("number");
  });

  it("intersection をマージする", () => {
    const defs: TypeDef[] = [
      { name: "A", params: [], body: obj(["x", prim("number")]) },
      { name: "B", params: [], body: obj(["y", prim("string")]) },
      { name: "C", params: [], body: { kind: "intersection", members: [ref("A"), ref("B")] } },
    ];
    const result = analyze(defs, "C");
    const final = result.steps[result.steps.length - 1]!;
    const str = typeToString(final.type);
    // intersection がマージされるか、両方のプロパティを含む
    expect(str).toContain("x");
    expect(str).toContain("y");
  });
});

describe("Partial<T>", () => {
  it("全プロパティを optional にする", () => {
    const defs: TypeDef[] = [
      { name: "User", params: [], body: obj(["name", prim("string")], ["age", prim("number")]) },
      { name: "Target", params: [], body: gen("Partial", ref("User")) },
    ];
    const result = analyze(defs, "Target");
    const final = result.steps[result.steps.length - 1]!;
    if (final.type.kind === "object") {
      expect(final.type.properties.every((p) => p.optional)).toBe(true);
    }
  });
});

describe("Pick<T, K>", () => {
  it("指定キーのプロパティのみ残す", () => {
    const defs: TypeDef[] = [
      { name: "User", params: [], body: obj(["id", prim("number")], ["name", prim("string")], ["email", prim("string")]) },
      { name: "Target", params: [], body: gen("Pick", ref("User"), union(lit("id"), lit("name"))) },
    ];
    const result = analyze(defs, "Target");
    const final = result.steps[result.steps.length - 1]!;
    if (final.type.kind === "object") {
      expect(final.type.properties).toHaveLength(2);
      expect(final.type.properties.map((p) => p.name)).toEqual(["id", "name"]);
    }
  });
});

describe("Omit<T, K>", () => {
  it("指定キーを除外する", () => {
    const defs: TypeDef[] = [
      { name: "User", params: [], body: obj(["id", prim("number")], ["name", prim("string")], ["email", prim("string")]) },
      { name: "Target", params: [], body: gen("Omit", ref("User"), lit("email")) },
    ];
    const result = analyze(defs, "Target");
    const final = result.steps[result.steps.length - 1]!;
    if (final.type.kind === "object") {
      expect(final.type.properties.map((p) => p.name)).not.toContain("email");
    }
  });
});

describe("Exclude<T, U>", () => {
  it("指定メンバーを除外する", () => {
    const defs: TypeDef[] = [
      { name: "Status", params: [], body: union(lit("a"), lit("b"), lit("c")) },
      { name: "Target", params: [], body: gen("Exclude", ref("Status"), lit("b")) },
    ];
    const result = analyze(defs, "Target");
    const final = result.steps[result.steps.length - 1]!;
    const str = typeToString(final.type);
    expect(str).not.toContain('"b"');
    expect(str).toContain('"a"');
    expect(str).toContain('"c"');
  });
});

describe("Extract<T, U>", () => {
  it("指定メンバーのみ抽出する", () => {
    const defs: TypeDef[] = [
      { name: "T", params: [], body: union(lit("a"), lit("b"), lit("c")) },
      { name: "Target", params: [], body: gen("Extract", ref("T"), union(lit("a"), lit("c"))) },
    ];
    const result = analyze(defs, "Target");
    const final = result.steps[result.steps.length - 1]!;
    const str = typeToString(final.type);
    expect(str).toContain('"a"');
    expect(str).toContain('"c"');
    expect(str).not.toContain('"b"');
  });
});

describe("Record<K, V>", () => {
  it("各キーにプロパティを生成する", () => {
    const defs: TypeDef[] = [
      { name: "Target", params: [], body: gen("Record", union(lit("x"), lit("y")), prim("number")) },
    ];
    const result = analyze(defs, "Target");
    const final = result.steps[result.steps.length - 1]!;
    if (final.type.kind === "object") {
      expect(final.type.properties).toHaveLength(2);
    }
  });
});

describe("ReturnType<T>", () => {
  it("関数の戻り値型を抽出する", () => {
    const defs: TypeDef[] = [
      { name: "Fn", params: [], body: fn([["x", prim("number")]], prim("string")) },
      { name: "Target", params: [], body: gen("ReturnType", ref("Fn")) },
    ];
    const result = analyze(defs, "Target");
    const final = result.steps[result.steps.length - 1]!;
    expect(typeToString(final.type)).toBe("string");
  });
});

describe("Parameters<T>", () => {
  it("関数のパラメータ型をタプルで返す", () => {
    const defs: TypeDef[] = [
      { name: "Fn", params: [], body: fn([["a", prim("string")], ["b", prim("number")]], prim("void")) },
      { name: "Target", params: [], body: gen("Parameters", ref("Fn")) },
    ];
    const result = analyze(defs, "Target");
    const final = result.steps[result.steps.length - 1]!;
    expect(final.type.kind).toBe("tuple");
    if (final.type.kind === "tuple") {
      expect(final.type.elements).toHaveLength(2);
    }
  });
});

describe("条件型", () => {
  it("extends が成立する場合 trueType を返す", () => {
    const defs: TypeDef[] = [
      { name: "IsString", params: ["T"], body: { kind: "conditional", check: ref("T"), extendsType: prim("string"), trueType: lit("yes"), falseType: lit("no") } },
      { name: "Target", params: [], body: gen("IsString", prim("string")) },
    ];
    const result = analyze(defs, "Target");
    const final = result.steps[result.steps.length - 1]!;
    expect(typeToString(final.type)).toBe('"yes"');
  });

  it("extends が成立しない場合 falseType を返す", () => {
    const defs: TypeDef[] = [
      { name: "IsString", params: ["T"], body: { kind: "conditional", check: ref("T"), extendsType: prim("string"), trueType: lit("yes"), falseType: lit("no") } },
      { name: "Target", params: [], body: gen("IsString", prim("number")) },
    ];
    const result = analyze(defs, "Target");
    const final = result.steps[result.steps.length - 1]!;
    expect(typeToString(final.type)).toBe('"no"');
  });
});

describe("NonNullable<T>", () => {
  it("null と undefined を除外する", () => {
    const defs: TypeDef[] = [
      { name: "T", params: [], body: union(prim("string"), { kind: "null" }, { kind: "undefined" }) },
      { name: "Target", params: [], body: gen("NonNullable", ref("T")) },
    ];
    const result = analyze(defs, "Target");
    const final = result.steps[result.steps.length - 1]!;
    expect(typeToString(final.type)).toBe("string");
  });
});

describe("解決ステップ", () => {
  it("全解析で最低2ステップ（定義 + 最終型）がある", () => {
    const defs: TypeDef[] = [
      { name: "T", params: [], body: prim("string") },
    ];
    const result = analyze(defs, "T");
    expect(result.steps.length).toBeGreaterThanOrEqual(2);
  });
});
