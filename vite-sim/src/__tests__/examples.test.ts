import { describe, it, expect } from "vitest";
import { EXAMPLES } from "../ui/app.js";
import { VirtualFileSystem } from "../server/vfs.js";
import { ViteDevServer } from "../server/dev-server.js";

describe("EXAMPLES プリセット配列", () => {
  it("5 つのサンプルが定義されている", () => {
    expect(EXAMPLES.length).toBe(5);
  });

  it("すべてのサンプルにラベルとファイルがある", () => {
    for (const example of EXAMPLES) {
      expect(typeof example.label).toBe("string");
      expect(example.label.length).toBeGreaterThan(0);
      expect(Object.keys(example.files).length).toBeGreaterThan(0);
    }
  });

  it("すべてのサンプルに index.html が含まれる", () => {
    for (const example of EXAMPLES) {
      expect(example.files["/index.html"]).toBeDefined();
      expect(example.files["/index.html"]).toContain("<!DOCTYPE html>");
    }
  });

  it("各サンプルのラベルが期待通りである", () => {
    const labels = EXAMPLES.map((e) => e.label);
    expect(labels).toContain("Hello World");
    expect(labels).toContain("CSS インポート");
    expect(labels).toContain("HMR 更新");
    expect(labels).toContain("JSX トランスフォーム");
    expect(labels).toContain("環境変数");
  });

  it("各サンプルのファイルパスがスラッシュで始まる", () => {
    for (const example of EXAMPLES) {
      for (const path of Object.keys(example.files)) {
        expect(path.startsWith("/")).toBe(true);
      }
    }
  });
});

describe("EXAMPLES を VFS に読み込む", () => {
  it("各サンプルを VFS に正しく書き込める", () => {
    for (const example of EXAMPLES) {
      const vfs = new VirtualFileSystem();
      for (const [path, content] of Object.entries(example.files)) {
        vfs.writeFile(path, content);
      }
      // ファイル数が一致することを確認
      expect(vfs.listFiles().length).toBe(Object.keys(example.files).length);
      // 各ファイルが読み込めることを確認
      for (const [path, content] of Object.entries(example.files)) {
        expect(vfs.readFile(path)).toBe(content);
      }
    }
  });

  it("サンプル切り替え時に既存ファイルを置き換えられる", () => {
    const vfs = new VirtualFileSystem();
    const first = EXAMPLES[0]!;
    const second = EXAMPLES[1]!;

    // 最初のサンプルを書き込む
    for (const [path, content] of Object.entries(first.files)) {
      vfs.writeFile(path, content);
    }
    expect(vfs.listFiles().length).toBe(Object.keys(first.files).length);

    // 既存ファイルを削除してから次のサンプルを書き込む
    for (const f of vfs.listFiles()) {
      vfs.deleteFile(f.path);
    }
    for (const [path, content] of Object.entries(second.files)) {
      vfs.writeFile(path, content);
    }

    // 二番目のサンプルのファイルだけが存在すること
    expect(vfs.listFiles().length).toBe(Object.keys(second.files).length);
    for (const path of Object.keys(second.files)) {
      expect(vfs.exists(path)).toBe(true);
    }
    // 最初のサンプル固有のファイルが残っていないこと
    for (const path of Object.keys(first.files)) {
      if (!(path in second.files)) {
        expect(vfs.exists(path)).toBe(false);
      }
    }
  });
});

describe("EXAMPLES でサーバーが動作する", () => {
  it("各サンプルの index.html をリクエストできる", () => {
    for (const example of EXAMPLES) {
      const vfs = new VirtualFileSystem();
      for (const [path, content] of Object.entries(example.files)) {
        vfs.writeFile(path, content);
      }
      const server = new ViteDevServer(vfs);
      server.start();
      const res = server.handleRequest({ method: "GET", path: "/index.html", headers: {} });
      expect(res.status).toBe(200);
      expect(res.body).toContain("<!DOCTYPE html>");
    }
  });

  it("各サンプルの TypeScript ファイルを変換できる", () => {
    for (const example of EXAMPLES) {
      const vfs = new VirtualFileSystem();
      for (const [path, content] of Object.entries(example.files)) {
        vfs.writeFile(path, content);
      }
      const server = new ViteDevServer(vfs);
      server.start();

      // .ts / .tsx ファイルをリクエストして変換が成功することを確認
      const tsFiles = Object.keys(example.files).filter(
        (p) => p.endsWith(".ts") || p.endsWith(".tsx"),
      );
      for (const tsFile of tsFiles) {
        const res = server.handleRequest({ method: "GET", path: tsFile, headers: {} });
        expect(res.status).toBe(200);
        expect(res.body.length).toBeGreaterThan(0);
      }
    }
  });
});
