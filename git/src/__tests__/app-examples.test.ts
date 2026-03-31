import { describe, it, expect } from "vitest";
import { EXAMPLES } from "../ui/app.js";

describe("EXAMPLES 配列", () => {
  it("5つのサンプルシナリオが定義されている", () => {
    expect(EXAMPLES).toHaveLength(5);
  });

  it("各サンプルに name と commands が存在する", () => {
    for (const example of EXAMPLES) {
      expect(example.name).toBeTruthy();
      expect(Array.isArray(example.commands)).toBe(true);
      expect(example.commands.length).toBeGreaterThan(0);
    }
  });

  it("各サンプルの名前が一意である", () => {
    const names = EXAMPLES.map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("「基本: init → add → commit」シナリオが正しいコマンドを持つ", () => {
    const basic = EXAMPLES.find((e) => e.name.includes("基本"));
    expect(basic).toBeDefined();
    expect(basic!.commands).toContain("git init");
    expect(basic!.commands).toContain("git add file.txt");
    expect(basic!.commands.some((c) => c.startsWith("git commit"))).toBe(true);
    expect(basic!.commands.some((c) => c.startsWith("echo"))).toBe(true);
  });

  it("「ブランチとマージ」シナリオがブランチ操作を含む", () => {
    const branch = EXAMPLES.find((e) => e.name.includes("ブランチ"));
    expect(branch).toBeDefined();
    expect(branch!.commands.some((c) => c.startsWith("git branch"))).toBe(true);
    expect(branch!.commands.some((c) => c.startsWith("git checkout"))).toBe(true);
    expect(branch!.commands.some((c) => c.startsWith("git merge"))).toBe(true);
  });

  it("「コンフリクト解消」シナリオがマージを含む", () => {
    const conflict = EXAMPLES.find((e) => e.name.includes("コンフリクト"));
    expect(conflict).toBeDefined();
    expect(conflict!.commands.some((c) => c.startsWith("git merge"))).toBe(true);
    expect(conflict!.commands.some((c) => c === "git status")).toBe(true);
  });

  it("「タグ付け」シナリオがタグ操作を含む", () => {
    const tag = EXAMPLES.find((e) => e.name.includes("タグ"));
    expect(tag).toBeDefined();
    expect(tag!.commands.filter((c) => c.startsWith("git tag")).length).toBeGreaterThanOrEqual(2);
  });

  it("「diff の確認」シナリオが diff コマンドを含む", () => {
    const diff = EXAMPLES.find((e) => e.name.includes("diff"));
    expect(diff).toBeDefined();
    expect(diff!.commands.some((c) => c === "git diff")).toBe(true);
  });

  it("全サンプルの先頭コマンドが git init である", () => {
    for (const example of EXAMPLES) {
      expect(example.commands[0]).toBe("git init");
    }
  });
});
