/**
 * linker.test.ts — リンカーシミュレータのテストスイート
 *
 * 以下のモジュールをテストする:
 * - ObjectFileBuilder: オブジェクトファイル (.o) の構築
 * - buildSharedLibrary: 共有ライブラリ (.so) の構築
 * - staticLink: 静的リンカーのシンボル解決・リロケーション・セクション結合
 * - dynamicLink: 動的リンカーの GOT/PLT 構築・遅延バインディング
 * - PRESETS: 全プリセットの正当性と実行可能性
 */

import { describe, it, expect } from "vitest";
import { ObjectFileBuilder, buildSharedLibrary } from "../linker/object-file.js";
import { staticLink } from "../linker/static-linker.js";
import { dynamicLink } from "../linker/dynamic-linker.js";
import { PRESETS } from "../linker/presets.js";

// ============================================================================
// ObjectFileBuilder のテスト
// コンパイラが生成するオブジェクトファイルのビルダーが正しく動作するかを検証する
// ============================================================================

describe("ObjectFileBuilder", () => {
  // 基本的な関数定義を含むオブジェクトファイルが正しく生成されるか
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

  // .data セクションに変数を追加し、正しいシンボル情報が生成されるか
  it("グローバル変数を追加できる", () => {
    const obj = new ObjectFileBuilder("data.o")
      .addVariable("count", "42")
      .build();

    expect(obj.symbols).toHaveLength(1);
    expect(obj.symbols[0]!.name).toBe("count");
    expect(obj.symbols[0]!.kind).toBe("variable");
    expect(obj.sections.some((s) => s.name === ".data")).toBe(true);
  });

  // 外部シンボルへのリロケーション（未解決参照）が正しく記録されるか
  it("リロケーションを追加できる", () => {
    const obj = new ObjectFileBuilder("main.o")
      .addFunction("main", ["call foo"])
      .addRelocation("foo")
      .build();

    expect(obj.relocations).toHaveLength(1);
    expect(obj.relocations[0]!.symbol).toBe("foo");
  });

  // static 修飾に相当するローカルバインディングのシンボルが正しく設定されるか
  it("ローカルシンボルを追加できる", () => {
    const obj = new ObjectFileBuilder("test.o")
      .addFunction("helper", ["ret"], "local")
      .build();

    expect(obj.symbols[0]!.binding).toBe("local");
  });
});

// ============================================================================
// buildSharedLibrary のテスト
// 動的リンクで使用する共有ライブラリ (.so) が正しく構築されるかを検証する
// ============================================================================

describe("buildSharedLibrary", () => {
  // 複数のエクスポート関数を持つ .so が正しく生成されるか
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

  // エクスポート変数（.data セクション）を含む .so が正しく生成されるか
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

// ============================================================================
// staticLink のテスト
// 静的リンカーの主要機能を検証する:
// - シンボル解決（name resolution）
// - リロケーション適用
// - 多重定義・未定義参照のエラー検出
// - セクション結合
// ============================================================================

describe("staticLink", () => {
  // 正常系: main.o → add (math.o) の外部参照が正しく解決され、
  // セクションが結合された実行可能バイナリが生成されるか
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

  // エラー系: 同名グローバルシンボル "helper" が a.o と b.o の両方にある場合、
  // リンカーが多重定義エラーを報告するか
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

  // エラー系: 存在しないシンボル "missing" を参照している場合、
  // リンカーが未定義参照エラーを報告するか
  it("未定義シンボルエラーを検出できる", () => {
    const main = new ObjectFileBuilder("main.o")
      .addFunction("main", ["call missing", "ret"])
      .addRelocation("missing")
      .build();

    const result = staticLink([main]);

    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.includes("未定義参照"))).toBe(true);
  });

  // ローカル（static）シンボルはファイル外から参照不可であり、
  // グローバルシンボルテーブルに含まれないことを確認
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

  // .data セクション（グローバル変数）が .text と同様に正しく結合されるか
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

// ============================================================================
// dynamicLink のテスト
// 動的リンカーの主要機能を検証する:
// - GOT (Global Offset Table) の構築
// - PLT (Procedure Linkage Table) の構築
// - 外部シンボルの解決
// - 複数ライブラリからのリンク
// - 未定義シンボルのエラー検出
// ============================================================================

describe("dynamicLink", () => {
  // 正常系: libfoo.so の foo 関数に対して GOT/PLT エントリが作成され、
  // neededLibraries に libfoo.so が含まれるか
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

  // 複数の .so から異なるシンボルを参照する場合、
  // それぞれに GOT エントリが作成され、全ライブラリが依存リストに含まれるか
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

  // エラー系: 参照先シンボルがどの .so にも見つからない場合のエラー検出
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

  // オブジェクトファイル内で定義済みのグローバルシンボルは
  // 外部参照とみなされず、GOT エントリが作成されないことを確認
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

  // GOT エントリに共有ライブラリ上のシンボルの実アドレスが
  // 正しく設定されるか（遅延バインディング解決後の状態）
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

// ============================================================================
// PRESETS のテスト
// 全プリセットが正しく定義され、リンク処理が例外なく実行できることを検証する
// ============================================================================

describe("PRESETS", () => {
  // 全プリセットが必須フィールドを持ち、有効なモード値を持つか
  it("全プリセットが正しく定義されている", () => {
    expect(PRESETS.length).toBeGreaterThanOrEqual(6);
    for (const preset of PRESETS) {
      expect(preset.name).toBeTruthy();
      expect(preset.description).toBeTruthy();
      expect(["static", "dynamic", "both"]).toContain(preset.mode);
      expect(preset.objects.length).toBeGreaterThan(0);
    }
  });

  // 全プリセットについてリンク処理を実行し、例外が発生しないことを確認する。
  // エラー系プリセット（多重定義、未定義参照）も含め、success が true/false いずれでも
  // 処理ステップが生成されることを検証する。
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
