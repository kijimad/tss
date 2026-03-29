import { describe, it, expect, beforeEach } from "vitest";
import { VirtualFileSystem } from "../server/vfs.js";
import { transform } from "../transform/transformer.js";
import { DependencyGraph } from "../modules/dep-graph.js";
import { ViteDevServer } from "../server/dev-server.js";

describe("ファイル変換", () => {
  it("TypeScript の型を除去する", () => {
    const result = transform("/src/main.ts", 'const x: number = 42;\nconst s: string = "hello";', Date.now());
    expect(result.code).not.toContain(": number");
    expect(result.code).not.toContain(": string");
    expect(result.code).toContain("const x");
    expect(result.code).toContain("= 42");
    expect(result.contentType).toBe("application/javascript");
  });

  it("CSS を JS に変換する", () => {
    const result = transform("/src/style.css", "body { color: red; }", Date.now());
    expect(result.code).toContain("createElement('style')");
    expect(result.code).toContain("body { color: red; }");
    expect(result.contentType).toBe("application/javascript");
  });

  it("JSON を ESM に変換する", () => {
    const result = transform("/data.json", '{"name":"test"}', Date.now());
    expect(result.code).toContain("export default");
    expect(result.code).toContain('"name":"test"');
  });

  it("import パスを解決する", () => {
    const result = transform("/src/App.ts", 'import { foo } from "./utils";\nimport React from "react";', Date.now());
    expect(result.code).toContain("/src/utils");
    expect(result.code).toContain("/@modules/react");
  });

  it("HMR コードが注入される", () => {
    const result = transform("/src/main.ts", "console.log('hello');", Date.now());
    expect(result.code).toContain("import.meta.hot");
  });

  it("変換ステップが記録される", () => {
    const result = transform("/src/app.ts", "const x: number = 1;", Date.now());
    expect(result.transforms.length).toBeGreaterThan(0);
    expect(result.transforms.map(s => s.name)).toContain("strip-types");
  });
});

describe("依存グラフ", () => {
  it("import 関係を追跡する", () => {
    const g = new DependencyGraph();
    g.updateFromCode("/src/App.ts", 'import { Header } from "/src/Header.ts";\nimport { Footer } from "/src/Footer.ts";');
    const mod = g.getModule("/src/App.ts");
    expect(mod?.importedModules.has("/src/Header.ts")).toBe(true);
    expect(mod?.importedModules.has("/src/Footer.ts")).toBe(true);

    const header = g.getModule("/src/Header.ts");
    expect(header?.importers.has("/src/App.ts")).toBe(true);
  });

  it("HMR 境界を計算する", () => {
    const g = new DependencyGraph();
    g.updateFromCode("/src/main.ts", 'import { App } from "/src/App.ts"');
    g.updateFromCode("/src/App.ts", 'import.meta.hot;\nimport { Header } from "/src/Header.ts"');
    g.updateFromCode("/src/Header.ts", 'import { styles } from "/src/styles.css"');

    // styles.css 変更 → Header → App (HMR 境界)
    const { boundary } = g.getHmrBoundary("/src/styles.css");
    // Header に acceptsHmr がないので App まで伝播
    expect(boundary).toContain("/src/App.ts");
  });
});

describe("Dev Server", () => {
  let vfs: VirtualFileSystem;
  let server: ViteDevServer;

  beforeEach(() => {
    vfs = new VirtualFileSystem();
    vfs.writeFile("/index.html", '<html><head></head><body><script type="module" src="/src/main.ts"></script></body></html>');
    vfs.writeFile("/src/main.ts", 'import { App } from "./App.ts";\nconsole.log("hello");');
    vfs.writeFile("/src/App.ts", 'export function App() { return "app"; }');
    vfs.writeFile("/src/style.css", "body { margin: 0; }");
    server = new ViteDevServer(vfs);
    server.start();
  });

  it("index.html にHMRスクリプトを注入する", () => {
    const res = server.handleRequest({ method: "GET", path: "/", headers: {} });
    expect(res.status).toBe(200);
    expect(res.body).toContain("@vite/client");
  });

  it("TSファイルをJSに変換して返す", () => {
    const res = server.handleRequest({ method: "GET", path: "/src/main.ts", headers: {} });
    expect(res.status).toBe(200);
    expect(res.headers["Content-Type"]).toBe("application/javascript");
    expect(res.transformResult).toBeDefined();
    expect(res.transformResult?.transforms.length).toBeGreaterThan(0);
  });

  it("CSSをJSに変換して返す", () => {
    const res = server.handleRequest({ method: "GET", path: "/src/style.css", headers: {} });
    expect(res.status).toBe(200);
    expect(res.body).toContain("createElement");
  });

  it("事前バンドルされたモジュールを返す", () => {
    const res = server.handleRequest({ method: "GET", path: "/@modules/react", headers: {} });
    expect(res.status).toBe(200);
    expect(res.body).toContain("useState");
  });

  it("存在しないファイルは404", () => {
    const res = server.handleRequest({ method: "GET", path: "/nonexistent.ts", headers: {} });
    expect(res.status).toBe(404);
  });

  it("ファイル変更でHMRイベントが発生する", () => {
    // まず依存グラフを構築するためにリクエスト
    server.handleRequest({ method: "GET", path: "/src/main.ts", headers: {} });
    server.handleRequest({ method: "GET", path: "/src/App.ts", headers: {} });

    server.resetEvents();
    const hmr = server.handleFileChange("/src/App.ts");
    expect(hmr.propagation.length).toBeGreaterThan(0);
  });

  it("サーバイベントが記録される", () => {
    server.handleRequest({ method: "GET", path: "/src/main.ts", headers: {} });
    const requests = server.events.filter(e => e.type === "request");
    expect(requests.length).toBeGreaterThan(0);
  });
});
