import { describe, it, expect } from "vitest";
import { ApacheEngine } from "../engine/httpd.js";
import { EXAMPLES } from "../ui/app.js";
import type { HttpdConfig } from "../engine/httpd.js";

const req = (host: string, uri: string) => ({ method: "GET", host, uri, headers: {} });

const simple = (files: Record<string, string> = {}): HttpdConfig => ({
  serverRoot: "/etc/httpd", loadedModules: ["core"],
  virtualHosts: [{
    serverName: "test.com", port: 80, documentRoot: "/www", ssl: false,
    rewriteRules: [], proxies: [],
    directories: [{ path: "/", allowOverride: "None", options: [], require: "all granted" }],
  }],
  fileSystem: files,
});

describe("静的ファイル配信", () => {
  it("存在するファイルを返す", () => {
    const engine = new ApacheEngine(simple({ "/www/page.html": "<h1>Hi</h1>" }));
    const r = engine.handleRequest(req("test.com", "/page.html"));
    expect(r.response.status).toBe(200);
    expect(r.response.body).toContain("Hi");
  });

  it("存在しないファイルは 404", () => {
    const engine = new ApacheEngine(simple());
    expect(engine.handleRequest(req("test.com", "/missing")).response.status).toBe(404);
  });

  it("MIME タイプが設定される", () => {
    const engine = new ApacheEngine(simple({ "/www/style.css": "body{}" }));
    expect(engine.handleRequest(req("test.com", "/style.css")).response.headers["content-type"]).toBe("text/css");
  });
});

describe("DirectoryIndex", () => {
  it("/ で index.html が返る", () => {
    const engine = new ApacheEngine({
      ...simple({ "/www/index.html": "<h1>Index</h1>" }),
      virtualHosts: [{
        serverName: "test.com", port: 80, documentRoot: "/www", ssl: false,
        rewriteRules: [], proxies: [],
        directories: [{ path: "/", allowOverride: "None", options: [], require: "all granted", directoryIndex: "index.html" }],
      }],
    });
    const r = engine.handleRequest(req("test.com", "/"));
    expect(r.response.status).toBe(200);
    expect(r.response.body).toContain("Index");
  });
});

describe("mod_rewrite", () => {
  it("内部書き換え", () => {
    const config: HttpdConfig = {
      ...simple({ "/www/index.php": "PHP output" }),
      virtualHosts: [{
        serverName: "test.com", port: 80, documentRoot: "/www", ssl: false,
        proxies: [],
        directories: [{ path: "/", allowOverride: "None", options: [], require: "all granted" }],
        rewriteRules: [{ pattern: "^/user/([0-9]+)$", substitution: "/index.php?id=$1", flags: ["L"] }],
      }],
    };
    const engine = new ApacheEngine(config);
    const r = engine.handleRequest(req("test.com", "/user/42"));
    expect(r.response.status).toBe(200);
    expect(r.finalUri).toContain("index.php");
  });

  it("外部リダイレクト [R=301]", () => {
    const config: HttpdConfig = {
      ...simple(),
      virtualHosts: [{
        serverName: "test.com", port: 80, documentRoot: "/www", ssl: false,
        proxies: [],
        directories: [{ path: "/", allowOverride: "None", options: [] }],
        rewriteRules: [{ pattern: "^/old$", substitution: "/new", flags: ["R=301", "L"] }],
      }],
    };
    const engine = new ApacheEngine(config);
    const r = engine.handleRequest(req("test.com", "/old"));
    expect(r.response.status).toBe(301);
    expect(r.response.headers["location"]).toBe("/new");
  });
});

describe("アクセス制御", () => {
  it("Require all denied で 403", () => {
    const config: HttpdConfig = {
      ...simple({ "/www/admin/index.html": "admin" }),
      virtualHosts: [{
        serverName: "test.com", port: 80, documentRoot: "/www", ssl: false,
        rewriteRules: [], proxies: [],
        directories: [
          { path: "/", allowOverride: "None", options: [], require: "all granted" },
          { path: "/admin/", allowOverride: "None", options: [], require: "all denied" },
        ],
      }],
    };
    const engine = new ApacheEngine(config);
    expect(engine.handleRequest(req("test.com", "/admin/index.html")).response.status).toBe(403);
  });
});

describe("mod_proxy", () => {
  it("ProxyPass でバックエンドに転送", () => {
    const config: HttpdConfig = {
      ...simple(),
      virtualHosts: [{
        serverName: "test.com", port: 80, documentRoot: "/www", ssl: false,
        rewriteRules: [],
        directories: [{ path: "/", allowOverride: "None", options: [] }],
        proxies: [{ path: "/api/", backend: "http://10.0.1.1:3000" }],
      }],
    };
    const engine = new ApacheEngine(config);
    const r = engine.handleRequest(req("test.com", "/api/users"));
    expect(r.response.status).toBe(200);
    expect(r.handlerUsed).toBe("proxy-server");
  });

  it("balancer で分散", () => {
    const config: HttpdConfig = {
      ...simple(),
      virtualHosts: [{
        serverName: "test.com", port: 80, documentRoot: "/www", ssl: false,
        rewriteRules: [],
        directories: [{ path: "/", allowOverride: "None", options: [] }],
        proxies: [{ path: "/api/", backend: "balancer://be", balancerMembers: [
          { url: "http://10.0.1.1:3000" }, { url: "http://10.0.1.2:3000" },
        ]}],
      }],
    };
    const engine = new ApacheEngine(config);
    const r1 = engine.handleRequest(req("test.com", "/api/a"));
    const r2 = engine.handleRequest(req("test.com", "/api/b"));
    expect(r1.response.headers["x-backend"]).toBe("http://10.0.1.1:3000");
    expect(r2.response.headers["x-backend"]).toBe("http://10.0.1.2:3000");
  });
});

describe("VirtualHost", () => {
  it("Host ヘッダで VirtualHost を選択する", () => {
    const config: HttpdConfig = {
      serverRoot: "/etc/httpd", loadedModules: ["core"],
      virtualHosts: [
        { serverName: "a.com", port: 80, documentRoot: "/www/a", ssl: false, rewriteRules: [], proxies: [],
          directories: [{ path: "/", allowOverride: "None", options: [] }] },
        { serverName: "b.com", port: 80, documentRoot: "/www/b", ssl: false, rewriteRules: [], proxies: [],
          directories: [{ path: "/", allowOverride: "None", options: [] }] },
      ],
      fileSystem: { "/www/a/index.html": "A", "/www/b/index.html": "B" },
    };
    const engine = new ApacheEngine(config);
    expect(engine.handleRequest(req("a.com", "/index.html")).response.body).toBe("A");
    expect(engine.handleRequest(req("b.com", "/index.html")).response.body).toBe("B");
  });
});

describe("CGI", () => {
  it(".cgi ファイルが CGI ハンドラで実行される", () => {
    const engine = new ApacheEngine(simple({ "/www/test.cgi": "CGI output" }));
    const r = engine.handleRequest(req("test.com", "/test.cgi"));
    expect(r.response.status).toBe(200);
    expect(r.handlerUsed).toBe("cgi-script");
  });
});

describe("トレース", () => {
  it("全リクエストでトレースが生成される", () => {
    const engine = new ApacheEngine(simple({ "/www/index.html": "ok" }));
    const r = engine.handleRequest(req("test.com", "/index.html"));
    expect(r.trace.length).toBeGreaterThan(0);
    expect(r.trace[0]!.phase).toBe("post_read_request");
  });
});

describe("EXAMPLES", () => {
  it("6 つのサンプル", () => { expect(EXAMPLES).toHaveLength(6); });
  it("名前が一意", () => { expect(new Set(EXAMPLES.map((e) => e.name)).size).toBe(EXAMPLES.length); });
  for (const ex of EXAMPLES) {
    it(`${ex.name}: 全リクエスト処理可能`, () => {
      const engine = new ApacheEngine(ex.config);
      for (const r of ex.requests) {
        const result = engine.handleRequest(r);
        expect(result.trace.length).toBeGreaterThan(0);
      }
    });
  }
});
