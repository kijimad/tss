import { describe, it, expect } from "vitest";
import { EXAMPLES, type Example } from "../ui/app.js";

describe("EXAMPLES 配列", () => {
  it("5つのサンプル例が定義されている", () => {
    expect(EXAMPLES).toHaveLength(5);
  });

  it("各サンプル例が name と commands を持つ", () => {
    for (const example of EXAMPLES) {
      expect(typeof example.name).toBe("string");
      expect(example.name.length).toBeGreaterThan(0);
      expect(Array.isArray(example.commands)).toBe(true);
      expect(example.commands.length).toBeGreaterThan(0);
    }
  });

  it("全コマンドが docker で始まる", () => {
    for (const example of EXAMPLES) {
      for (const cmd of example.commands) {
        expect(cmd).toMatch(/^docker /);
      }
    }
  });

  it("イメージ取得 + 実行 の例が docker pull と docker run を含む", () => {
    const example = EXAMPLES.find((e) => e.name === "イメージ取得 + 実行");
    expect(example).toBeDefined();
    expect(example!.commands.some((c) => c.startsWith("docker pull"))).toBe(true);
    expect(example!.commands.some((c) => c.startsWith("docker run"))).toBe(true);
  });

  it("ポートマッピング の例が -p フラグを含む", () => {
    const example = EXAMPLES.find((e) => e.name === "ポートマッピング");
    expect(example).toBeDefined();
    expect(example!.commands.some((c) => c.includes("-p "))).toBe(true);
  });

  it("環境変数の設定 の例が -e フラグを含む", () => {
    const example = EXAMPLES.find((e) => e.name === "環境変数の設定");
    expect(example).toBeDefined();
    expect(example!.commands.some((c) => c.includes("-e "))).toBe(true);
  });

  it("コンテナ管理 の例が ps, stop, rm を含む", () => {
    const example = EXAMPLES.find((e) => e.name === "コンテナ管理");
    expect(example).toBeDefined();
    expect(example!.commands.some((c) => c.startsWith("docker ps"))).toBe(true);
    expect(example!.commands.some((c) => c.startsWith("docker stop"))).toBe(true);
    expect(example!.commands.some((c) => c.startsWith("docker rm"))).toBe(true);
  });

  it("Dockerfile ビルド の例が docker build と docker images を含む", () => {
    const example = EXAMPLES.find((e) => e.name === "Dockerfile ビルド");
    expect(example).toBeDefined();
    expect(example!.commands.some((c) => c.startsWith("docker build"))).toBe(true);
    expect(example!.commands.some((c) => c.startsWith("docker images"))).toBe(true);
  });

  it("サンプル名が重複していない", () => {
    const names = EXAMPLES.map((e) => e.name);
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(names.length);
  });

  it("各サンプルのコマンドが空文字列を含まない", () => {
    for (const example of EXAMPLES) {
      for (const cmd of example.commands) {
        expect(cmd.trim().length).toBeGreaterThan(0);
      }
    }
  });
});
