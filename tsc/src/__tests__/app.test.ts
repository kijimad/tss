import { describe, it, expect } from "vitest";
import { EXAMPLES } from "../ui/app.js";
import { transpileWithCheck } from "../transpile.js";

describe("EXAMPLES サンプルコード", () => {
  it("サンプルが5つ以上存在する", () => {
    expect(EXAMPLES.length).toBeGreaterThanOrEqual(5);
  });

  it("各サンプルに name と code が含まれている", () => {
    for (const example of EXAMPLES) {
      expect(example.name).toBeTruthy();
      expect(example.code).toBeTruthy();
    }
  });

  it("各サンプルコードがトランスパイル可能である", () => {
    for (const example of EXAMPLES) {
      const result = transpileWithCheck(example.code);
      // トランスパイル結果が空でないことを確認
      expect(result.output.length).toBeGreaterThan(0);
    }
  });

  it("Hello World サンプルが含まれている", () => {
    const helloWorld = EXAMPLES.find((e) => e.name === "Hello World");
    expect(helloWorld).toBeDefined();
    expect(helloWorld?.code).toContain("console.log");
  });

  it("型アノテーションサンプルが含まれている", () => {
    const typeAnnotation = EXAMPLES.find((e) => e.name === "型アノテーション");
    expect(typeAnnotation).toBeDefined();
    expect(typeAnnotation?.code).toContain("string");
    expect(typeAnnotation?.code).toContain("number");
    expect(typeAnnotation?.code).toContain("boolean");
  });

  it("インターフェースサンプルが含まれている", () => {
    const iface = EXAMPLES.find((e) => e.name === "インターフェース");
    expect(iface).toBeDefined();
    expect(iface?.code).toContain("interface");
  });

  it("ジェネリクスサンプルが含まれている", () => {
    const generics = EXAMPLES.find((e) => e.name === "ジェネリクス");
    expect(generics).toBeDefined();
    expect(generics?.code).toContain("<T>");
  });

  it("Enum と Union 型サンプルが含まれている", () => {
    const enumUnion = EXAMPLES.find((e) => e.name === "Enum と Union 型");
    expect(enumUnion).toBeDefined();
    expect(enumUnion?.code).toContain("enum");
  });
});
