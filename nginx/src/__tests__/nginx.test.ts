import { describe, it, expect } from "vitest";
import { NginxEngine } from "../engine/nginx.js";
import { EXAMPLES } from "../ui/app.js";
import type { NginxConfig, LocationBlock } from "../engine/nginx.js";

const minConfig = (locations: LocationBlock[], staticFiles: Record<string, string> = {}): NginxConfig => ({
  upstreams: [], staticFiles,
  servers: [{ listen: 80, serverName: ["test.com"], locations }],
});

const req = (path: string) => ({ method: "GET", host: "test.com", path, headers: {} });

describe("location マッチング", () => {
  it("完全一致 (=) が最優先", () => {
    const engine = new NginxEngine(minConfig([
      { match: { type: "exact", path: "/exact" }, directives: { returnCode: 200, returnBody: "exact" } },
      { match: { type: "prefix", path: "/" }, directives: { returnCode: 200, returnBody: "prefix" } },
    ]));
    expect(engine.handleRequest(req("/exact")).response.body).toBe("exact");
  });

  it("^~ がregexに勝つ", () => {
    const engine = new NginxEngine(minConfig([
      { match: { type: "prefix_priority", path: "/static/" }, directives: { returnCode: 200, returnBody: "priority" } },
      { match: { type: "regex", pattern: "\\.css$" }, directives: { returnCode: 200, returnBody: "regex" } },
    ]));
    expect(engine.handleRequest(req("/static/style.css")).response.body).toBe("priority");
  });

  it("regex がプレフィックスに勝つ", () => {
    const engine = new NginxEngine(minConfig([
      { match: { type: "prefix", path: "/" }, directives: { returnCode: 200, returnBody: "prefix" } },
      { match: { type: "regex", pattern: "\\.php$" }, directives: { returnCode: 200, returnBody: "regex" } },
    ]));
    expect(engine.handleRequest(req("/test.php")).response.body).toBe("regex");
  });

  it("一致なしで 404", () => {
    const engine = new NginxEngine(minConfig([]));
    expect(engine.handleRequest(req("/anything")).response.status).toBe(404);
  });
});

describe("静的ファイル配信", () => {
  it("root + パスでファイルを返す", () => {
    const engine = new NginxEngine(minConfig(
      [{ match: { type: "prefix", path: "/" }, directives: { root: "/www" } }],
      { "/www/index.html": "<h1>Hi</h1>" },
    ));
    const r = engine.handleRequest(req("/index.html"));
    expect(r.response.status).toBe(200);
    expect(r.response.body).toContain("Hi");
    expect(r.response.headers["content-type"]).toBe("text/html");
  });

  it("ファイルなしで 404", () => {
    const engine = new NginxEngine(minConfig(
      [{ match: { type: "prefix", path: "/" }, directives: { root: "/www" } }],
      {},
    ));
    expect(engine.handleRequest(req("/missing.html")).response.status).toBe(404);
  });
});

describe("リバースプロキシ", () => {
  it("upstream に round-robin で分散する", () => {
    const engine = new NginxEngine({
      upstreams: [{ name: "backend", method: "round-robin", servers: [
        { address: "10.0.1.1:8080", weight: 1, healthy: true },
        { address: "10.0.1.2:8080", weight: 1, healthy: true },
      ]}],
      servers: [{ listen: 80, serverName: ["test.com"], locations: [
        { match: { type: "prefix", path: "/" }, directives: { proxyPass: "http://backend" } },
      ]}],
      staticFiles: {},
    });
    const r1 = engine.handleRequest(req("/a"));
    const r2 = engine.handleRequest(req("/b"));
    expect(r1.upstreamServer).toBe("10.0.1.1:8080");
    expect(r2.upstreamServer).toBe("10.0.1.2:8080");
  });

  it("全サーバダウンで 502", () => {
    const engine = new NginxEngine({
      upstreams: [{ name: "dead", method: "round-robin", servers: [
        { address: "10.0.1.1:8080", weight: 1, healthy: false },
      ]}],
      servers: [{ listen: 80, serverName: ["test.com"], locations: [
        { match: { type: "prefix", path: "/" }, directives: { proxyPass: "http://dead" } },
      ]}],
      staticFiles: {},
    });
    expect(engine.handleRequest(req("/")).response.status).toBe(502);
  });
});

describe("return ディレクティブ", () => {
  it("301 リダイレクト", () => {
    const engine = new NginxEngine(minConfig([
      { match: { type: "prefix", path: "/" }, directives: { returnCode: 301, returnBody: "https://example.com/" } },
    ]));
    const r = engine.handleRequest(req("/page"));
    expect(r.response.status).toBe(301);
    expect(r.response.headers["location"]).toBe("https://example.com/");
  });

  it("200 直接レスポンス", () => {
    const engine = new NginxEngine(minConfig([
      { match: { type: "exact", path: "/health" }, directives: { returnCode: 200, returnBody: "ok" } },
    ]));
    expect(engine.handleRequest(req("/health")).response.body).toBe("ok");
  });
});

describe("server_name マッチ", () => {
  it("Host ヘッダでサーバーブロックを選択する", () => {
    const engine = new NginxEngine({
      upstreams: [], staticFiles: {},
      servers: [
        { listen: 80, serverName: ["app.com"], locations: [{ match: { type: "prefix", path: "/" }, directives: { returnCode: 200, returnBody: "app" } }] },
        { listen: 80, serverName: ["admin.com"], locations: [{ match: { type: "prefix", path: "/" }, directives: { returnCode: 200, returnBody: "admin" } }] },
      ],
    });
    expect(engine.handleRequest({ method: "GET", host: "app.com", path: "/", headers: {} }).response.body).toBe("app");
    expect(engine.handleRequest({ method: "GET", host: "admin.com", path: "/", headers: {} }).response.body).toBe("admin");
  });
});

describe("トレース", () => {
  it("全リクエストでトレースが生成される", () => {
    const engine = new NginxEngine(minConfig([
      { match: { type: "prefix", path: "/" }, directives: { returnCode: 200, returnBody: "ok" } },
    ]));
    const r = engine.handleRequest(req("/test"));
    expect(r.trace.length).toBeGreaterThan(0);
    expect(r.trace[0]!.phase).toBe("accept");
  });
});

describe("EXAMPLES", () => {
  it("6 つのサンプル", () => { expect(EXAMPLES).toHaveLength(6); });
  it("サンプル名が一意", () => {
    expect(new Set(EXAMPLES.map((e) => e.name)).size).toBe(EXAMPLES.length);
  });
  for (const ex of EXAMPLES) {
    it(`${ex.name}: 全リクエストが処理可能`, () => {
      const engine = new NginxEngine(ex.config);
      for (const r of ex.requests) {
        const result = engine.handleRequest(r);
        expect(result.trace.length).toBeGreaterThan(0);
        expect(result.response.status).toBeGreaterThanOrEqual(200);
      }
    });
  }
});
