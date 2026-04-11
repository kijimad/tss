import { describe, it, expect } from "vitest";
import { ObjectFileBuilder, buildSharedLibrary } from "../linker/object-file.js";
import { staticLink } from "../linker/static-linker.js";
import { dynamicLink } from "../linker/dynamic-linker.js";
import { PRESETS } from "../linker/presets.js";

describe("ObjectFileBuilder", () => {
  it("関数とシンボルを持つオブジェクトファイルを生成できる", () => {
    const obj = new ObjectFileBuilder("test.o")
      .addFunction("main", ["push rbp", "ret"])
      .build();

    expect(obj.name).toBe("test.o");
    expect(obj.symbols).toHaveLength(1);
    expect(obj.symbols[0]!.name).toBe("main");
    expect(obj.symbols[0]!.kind).toBe("function");
    expect(obj.symbols[0]!.binding).toBe("global");
    expect(obj.sections.some((s) => s.name === ".text")).toBe(true);
  });

  it("グローバル変数を追加できる", () => {
    const obj = new ObjectFileBuilder("data.o")
      .addVariable("count", "42")
      .build();

    expect(obj.symbols).toHaveLength(1);
    expect(obj.symbols[0]!.name).toBe("count");
    expect(obj.symbols[0]!.kind).toBe("variable");
    expect(obj.sections.some((s) => s.name === ".data")).toBe(true);
  });

  it("リロケーションを追加できる", () => {
    const obj = new ObjectFileBuilder("main.o")
      .addFunction("main", ["call foo"])
      .addRelocation("foo")
      .build();

    expect(obj.relocations).toHaveLength(1);
    expect(obj.relocations[0]!.symbol).toBe("foo");
  });

  it("ローカルシンボルを追加できる", () => {
    const obj = new ObjectFileBuilder("test.o")
      .addFunction("helper", ["ret"], "local")
      .build();

    expect(obj.symbols[0]!.binding).toBe("local");
  });
});

describe("buildSharedLibrary", () => {
  it("共有ライブラリを生成できる", () => {
    const lib = buildSharedLibrary("libtest.so", [
      { name: "func1", body: ["ret"] },
      { name: "func2", body: ["ret"] },
    ]);

    expect(lib.name).toBe("libtest.so");
    expect(lib.exportedSymbols).toHaveLength(2);
    expect(lib.exportedSymbols[0]!.name).toBe("func1");
    expect(lib.exportedSymbols[1]!.name).toBe("func2");
  });

  it("変数付き共有ライブラリを生成できる", () => {
    const lib = buildSharedLibrary(
      "libdata.so",
      [{ name: "get", body: ["ret"] }],
      [{ name: "VERSION", value: "1" }],
    );

    expect(lib.exportedSymbols).toHaveLength(2);
    expect(lib.exportedSymbols[1]!.kind).toBe("variable");
  });
});

describe("staticLink", () => {
  it("2つのオブジェクトファイルを正常にリンクできる", () => {
    const main = new ObjectFileBuilder("main.o")
      .addFunction("main", ["call add", "ret"])
      .addRelocation("add")
      .build();

    const math = new ObjectFileBuilder("math.o")
      .addFunction("add", ["add edi, esi", "ret"])
      .build();

    const result = staticLink([main, math]);

    expect(result.success).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.symbolTable.has("main")).toBe(true);
    expect(result.symbolTable.has("add")).toBe(true);
    expect(result.mergedSections.length).toBeGreaterThan(0);
    expect(result.steps.length).toBeGreaterThanOrEqual(4);
  });

  it("多重定義エラーを検出できる", () => {
    const a = new ObjectFileBuilder("a.o")
      .addFunction("helper", ["ret"])
      .build();

    const b = new ObjectFileBuilder("b.o")
      .addFunction("helper", ["ret"])
      .build();

    const result = staticLink([a, b]);

    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.includes("多重定義"))).toBe(true);
  });

  it("未定義シンボルエラーを検出できる", () => {
    const main = new ObjectFileBuilder("main.o")
      .addFunction("main", ["call missing", "ret"])
      .addRelocation("missing")
      .build();

    const result = staticLink([main]);

    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.includes("未定義参照"))).toBe(true);
  });

  it("ローカルシンボルはグローバルテーブルに追加されない", () => {
    const obj = new ObjectFileBuilder("test.o")
      .addFunction("public_fn", ["ret"])
      .addFunction("private_fn", ["ret"], "local")
      .build();

    const result = staticLink([obj]);

    expect(result.success).toBe(true);
    expect(result.symbolTable.has("public_fn")).toBe(true);
    expect(result.symbolTable.has("private_fn")).toBe(false);
  });

  it("データセクションも結合される", () => {
    const a = new ObjectFileBuilder("a.o")
      .addVariable("x", "10")
      .build();

    const b = new ObjectFileBuilder("b.o")
      .addVariable("y", "20")
      .build();

    const result = staticLink([a, b]);

    expect(result.success).toBe(true);
    const dataSection = result.mergedSections.find((s) => s.name === ".data");
    expect(dataSection).toBeDefined();
    expect(dataSection!.data.length).toBeGreaterThanOrEqual(2);
  });
});

describe("dynamicLink", () => {
  it("共有ライブラリのシンボルを GOT/PLT で参照できる", () => {
    const main = new ObjectFileBuilder("main.o")
      .addFunction("main", ["call foo@PLT", "ret"])
      .addRelocation("foo")
      .build();

    const lib = buildSharedLibrary("libfoo.so", [
      { name: "foo", body: ["ret"] },
    ]);

    const result = dynamicLink([main], [lib]);

    expect(result.success).toBe(true);
    expect(result.got.has("foo")).toBe(true);
    expect(result.plt.has("foo")).toBe(true);
    expect(result.neededLibraries).toContain("libfoo.so");
  });

  it("複数ライブラリからのリンクに対応できる", () => {
    const main = new ObjectFileBuilder("main.o")
      .addFunction("main", ["call a", "call b", "ret"])
      .addRelocation("a")
      .addRelocation("b")
      .build();

    const libA = buildSharedLibrary("liba.so", [
      { name: "a", body: ["ret"] },
    ]);
    const libB = buildSharedLibrary("libb.so", [
      { name: "b", body: ["ret"] },
    ]);

    const result = dynamicLink([main], [libA, libB]);

    expect(result.success).toBe(true);
    expect(result.got.size).toBe(2);
    expect(result.neededLibraries).toEqual(["liba.so", "libb.so"]);
  });

  it("未定義の外部シンボルでエラーになる", () => {
    const main = new ObjectFileBuilder("main.o")
      .addFunction("main", ["call missing", "ret"])
      .addRelocation("missing")
      .build();

    const lib = buildSharedLibrary("libother.so", [
      { name: "other", body: ["ret"] },
    ]);

    const result = dynamicLink([main], [lib]);

    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.includes("未定義参照"))).toBe(true);
  });

  it("ローカルシンボルは外部参照とみなされない", () => {
    const main = new ObjectFileBuilder("main.o")
      .addFunction("main", ["call local_fn", "ret"])
      .addFunction("local_fn", ["ret"])
      .addRelocation("local_fn")
      .build();

    const result = dynamicLink([main], []);

    expect(result.success).toBe(true);
    expect(result.got.size).toBe(0);
  });

  it("GOT エントリに解決済みアドレスが設定される", () => {
    const main = new ObjectFileBuilder("main.o")
      .addFunction("main", ["call func", "ret"])
      .addRelocation("func")
      .build();

    const lib = buildSharedLibrary("lib.so", [
      { name: "func", body: ["ret"] },
    ]);

    const result = dynamicLink([main], [lib]);

    expect(result.success).toBe(true);
    const gotEntry = result.got.get("func");
    expect(gotEntry).toBeDefined();
    expect(gotEntry!.resolvedAddress).not.toBeNull();
    expect(gotEntry!.resolvedAddress).toBeGreaterThan(0);
  });
});

describe("PRESETS", () => {
  it("全プリセットが正しく定義されている", () => {
    expect(PRESETS.length).toBeGreaterThanOrEqual(6);
    for (const preset of PRESETS) {
      expect(preset.name).toBeTruthy();
      expect(preset.description).toBeTruthy();
      expect(["static", "dynamic", "both"]).toContain(preset.mode);
      expect(preset.objects.length).toBeGreaterThan(0);
    }
  });

  it("各プリセットのリンクが実行できる（エラー系含む）", () => {
    for (const preset of PRESETS) {
      if (preset.mode === "static" || preset.mode === "both") {
        const allObjects = [...preset.objects];
        if (preset.mode === "both") {
          for (const lib of preset.libraries) {
            allObjects.push({
              name: lib.name,
              sections: lib.sections,
              symbols: lib.exportedSymbols,
              relocations: [],
            });
          }
        }
        const result = staticLink(allObjects);
        // 結果は成功でも失敗でもよいが、例外が投げられないこと
        expect(result.steps.length).toBeGreaterThan(0);
      }
      if (preset.mode === "dynamic" || preset.mode === "both") {
        const result = dynamicLink(preset.objects, preset.libraries);
        expect(result.steps.length).toBeGreaterThan(0);
      }
    }
  });
});
