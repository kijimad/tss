import { describe, it, expect } from "vitest";
import { EXAMPLES } from "../ui/app.js";

describe("EXAMPLES 配列", () => {
  it("サンプルが4つ定義されている", () => {
    expect(EXAMPLES).toHaveLength(4);
  });

  it("各サンプルにnameとcommandsが存在する", () => {
    for (const example of EXAMPLES) {
      expect(typeof example.name).toBe("string");
      expect(example.name.length).toBeGreaterThan(0);
      expect(Array.isArray(example.commands)).toBe(true);
      expect(example.commands.length).toBeGreaterThan(0);
    }
  });

  it("各コマンドが空文字列でない", () => {
    for (const example of EXAMPLES) {
      for (const cmd of example.commands) {
        expect(typeof cmd).toBe("string");
        expect(cmd.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("期待するサンプル名が含まれている", () => {
    const names = EXAMPLES.map((e) => e.name);
    expect(names).toContain("基本コマンド");
    expect(names).toContain("ファイルシステム");
    expect(names).toContain("プロセス管理");
    expect(names).toContain("システム情報");
  });

  it("基本コマンドのサンプルにhelpが含まれている", () => {
    const basic = EXAMPLES.find((e) => e.name === "基本コマンド");
    expect(basic).toBeDefined();
    expect(basic!.commands).toContain("help");
  });

  it("ファイルシステムのサンプルにmkdirが含まれている", () => {
    const fs = EXAMPLES.find((e) => e.name === "ファイルシステム");
    expect(fs).toBeDefined();
    expect(fs!.commands.some((c) => c.startsWith("mkdir"))).toBe(true);
  });

  it("プロセス管理のサンプルにpsが含まれている", () => {
    const proc = EXAMPLES.find((e) => e.name === "プロセス管理");
    expect(proc).toBeDefined();
    expect(proc!.commands).toContain("ps");
  });

  it("システム情報のサンプルにunameが含まれている", () => {
    const sys = EXAMPLES.find((e) => e.name === "システム情報");
    expect(sys).toBeDefined();
    expect(sys!.commands).toContain("uname");
  });
});
