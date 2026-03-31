import { describe, it, expect } from "vitest";
import { EXAMPLES, type ShellExample } from "../ui/app.js";

describe("EXAMPLES配列", () => {
  it("サンプルが5つ定義されている", () => {
    expect(EXAMPLES).toHaveLength(5);
  });

  it("各サンプルにnameとcommandsが存在する", () => {
    for (const example of EXAMPLES) {
      expect(example.name).toBeTruthy();
      expect(Array.isArray(example.commands)).toBe(true);
      expect(example.commands.length).toBeGreaterThan(0);
    }
  });

  it("ファイル操作サンプルが正しい", () => {
    const example = EXAMPLES.find((e) => e.name === "ファイル操作");
    expect(example).toBeDefined();
    expect(example!.commands).toHaveLength(5);
    // ls, echo, cat, cp, mv のコマンドを含む
    expect(example!.commands[0]).toMatch(/^ls/);
    expect(example!.commands[1]).toMatch(/^echo/);
    expect(example!.commands[2]).toMatch(/^cat/);
    expect(example!.commands[3]).toMatch(/^cp/);
    expect(example!.commands[4]).toMatch(/^mv/);
  });

  it("パイプとリダイレクトサンプルが正しい", () => {
    const example = EXAMPLES.find((e) => e.name === "パイプとリダイレクト");
    expect(example).toBeDefined();
    // パイプやリダイレクトを含むコマンドがある
    const hasPipe = example!.commands.some((c) => c.includes("|"));
    const hasRedirect = example!.commands.some((c) => c.includes(">"));
    expect(hasPipe).toBe(true);
    expect(hasRedirect).toBe(true);
  });

  it("ディレクトリ操作サンプルが正しい", () => {
    const example = EXAMPLES.find((e) => e.name === "ディレクトリ操作");
    expect(example).toBeDefined();
    const cmds = example!.commands.join(" ");
    expect(cmds).toContain("mkdir");
    expect(cmds).toContain("cd");
    expect(cmds).toContain("ls");
    expect(cmds).toContain("pwd");
  });

  it("テキスト処理サンプルが正しい", () => {
    const example = EXAMPLES.find((e) => e.name === "テキスト処理");
    expect(example).toBeDefined();
    const cmds = example!.commands.join(" ");
    expect(cmds).toContain("grep");
    expect(cmds).toContain("sort");
    expect(cmds).toContain("head");
    expect(cmds).toContain("tail");
  });

  it("変数とコマンド置換サンプルが正しい", () => {
    const example = EXAMPLES.find((e) => e.name === "変数とコマンド置換");
    expect(example).toBeDefined();
    // 変数代入と参照を含む
    const hasAssignment = example!.commands.some((c) => /^\w+=/.test(c));
    const hasExpansion = example!.commands.some((c) => c.includes("$"));
    expect(hasAssignment).toBe(true);
    expect(hasExpansion).toBe(true);
  });

  it("全サンプル名が一意である", () => {
    const names = EXAMPLES.map((e) => e.name);
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(names.length);
  });

  it("ShellExample型が正しく適用される", () => {
    // 型チェック: ShellExample型のオブジェクトが正しい構造を持つ
    const testExample: ShellExample = {
      name: "テスト",
      commands: ["echo test"],
    };
    expect(testExample.name).toBe("テスト");
    expect(testExample.commands).toEqual(["echo test"]);
  });
});
