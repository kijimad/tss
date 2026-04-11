/* CORS シミュレーター テスト */

import { describe, it, expect } from "vitest";
import {
  simulate, classifyRequest, mkRequest, mkServerConfig,
  extractOrigin, isSameOrigin,
} from "../cors/engine.js";
import { PRESETS } from "../cors/presets.js";

// ─── ユーティリティ ───

describe("ユーティリティ", () => {
  it("オリジン抽出", () => {
    expect(extractOrigin("https://example.com/path?q=1")).toBe("https://example.com");
    expect(extractOrigin("http://localhost:3000/api")).toBe("http://localhost:3000");
  });

  it("同一オリジン判定", () => {
    expect(isSameOrigin("https://example.com", "https://example.com/api")).toBe(true);
    expect(isSameOrigin("https://example.com", "https://api.example.com/")).toBe(false);
    expect(isSameOrigin("http://example.com", "https://example.com/")).toBe(false);
  });
});

// ─── リクエスト分類 ───

describe("リクエスト分類", () => {
  it("同一オリジンを検出", () => {
    const req = mkRequest("https://example.com", "https://example.com/api");
    expect(classifyRequest(req)).toBe("same_origin");
  });

  it("GET → 単純リクエスト", () => {
    const req = mkRequest("https://a.com", "https://b.com/api", "GET");
    expect(classifyRequest(req)).toBe("simple_cors");
  });

  it("POST + form → 単純リクエスト", () => {
    const req = mkRequest("https://a.com", "https://b.com/api", "POST", {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    expect(classifyRequest(req)).toBe("simple_cors");
  });

  it("POST + JSON → プリフライト必要", () => {
    const req = mkRequest("https://a.com", "https://b.com/api", "POST", {
      headers: { "Content-Type": "application/json" },
    });
    expect(classifyRequest(req)).toBe("preflight_cors");
  });

  it("PUT → プリフライト必要", () => {
    const req = mkRequest("https://a.com", "https://b.com/api", "PUT");
    expect(classifyRequest(req)).toBe("preflight_cors");
  });

  it("DELETE → プリフライト必要", () => {
    const req = mkRequest("https://a.com", "https://b.com/api", "DELETE");
    expect(classifyRequest(req)).toBe("preflight_cors");
  });

  it("カスタムヘッダ → プリフライト必要", () => {
    const req = mkRequest("https://a.com", "https://b.com/api", "GET", {
      headers: { "Authorization": "Bearer token" },
    });
    expect(classifyRequest(req)).toBe("preflight_cors");
  });

  it("no-corsモード", () => {
    const req = mkRequest("https://a.com", "https://b.com/img.png", "GET", {
      mode: "no-cors",
    });
    expect(classifyRequest(req)).toBe("no_cors");
  });
});

// ─── CORSチェック ───

describe("CORSチェック", () => {
  it("ワイルドカードオリジンで許可", () => {
    const result = simulate([{
      type: "request",
      request: mkRequest("https://any.com", "https://api.com/data"),
      serverConfig: mkServerConfig({ allowOrigins: "*" }),
    }]);
    expect(result.results[0]!.verdict).toBe("allowed");
  });

  it("許可リストのオリジンで許可", () => {
    const result = simulate([{
      type: "request",
      request: mkRequest("https://app.com", "https://api.com/data"),
      serverConfig: mkServerConfig({ allowOrigins: ["https://app.com"] }),
    }]);
    expect(result.results[0]!.verdict).toBe("allowed");
  });

  it("許可リストにないオリジンでブロック", () => {
    const result = simulate([{
      type: "request",
      request: mkRequest("https://evil.com", "https://api.com/data"),
      serverConfig: mkServerConfig({ allowOrigins: ["https://app.com"] }),
    }]);
    expect(result.results[0]!.verdict).toBe("no_cors_header");
  });

  it("同一オリジンはCORSチェックなし", () => {
    const result = simulate([{
      type: "request",
      request: mkRequest("https://example.com", "https://example.com/api"),
      serverConfig: mkServerConfig(),
    }]);
    expect(result.results[0]!.verdict).toBe("same_origin");
  });

  it("no-corsモードは不透明レスポンス", () => {
    const result = simulate([{
      type: "request",
      request: mkRequest("https://a.com", "https://b.com/img", "GET", { mode: "no-cors" }),
      serverConfig: mkServerConfig(),
    }]);
    expect(result.results[0]!.verdict).toBe("opaque");
  });
});

// ─── プリフライト ───

describe("プリフライト", () => {
  it("プリフライト成功でリクエスト許可", () => {
    const result = simulate([{
      type: "request",
      request: mkRequest("https://app.com", "https://api.com/data", "PUT", {
        headers: { "Content-Type": "application/json", "Authorization": "Bearer x" },
      }),
      serverConfig: mkServerConfig({
        allowOrigins: ["https://app.com"],
        allowMethods: ["GET", "PUT"],
        allowHeaders: ["Content-Type", "Authorization"],
      }),
    }]);
    expect(result.results[0]!.verdict).toBe("allowed");
    expect(result.results[0]!.classification).toBe("preflight_cors");
  });

  it("許可されていないメソッドでプリフライト失敗", () => {
    const result = simulate([{
      type: "request",
      request: mkRequest("https://app.com", "https://api.com/data", "DELETE"),
      serverConfig: mkServerConfig({
        allowOrigins: ["https://app.com"],
        allowMethods: ["GET", "POST"], // DELETEなし
      }),
    }]);
    expect(result.results[0]!.verdict).toBe("blocked_method");
  });

  it("許可されていないヘッダでプリフライト失敗", () => {
    const result = simulate([{
      type: "request",
      request: mkRequest("https://app.com", "https://api.com/data", "GET", {
        headers: { "X-Custom": "value" },
      }),
      serverConfig: mkServerConfig({
        allowOrigins: ["https://app.com"],
        allowHeaders: ["Content-Type"], // X-Customなし
      }),
    }]);
    expect(result.results[0]!.verdict).toBe("blocked_header");
  });

  it("プリフライトキャッシュが機能する", () => {
    const result = simulate([
      {
        type: "request",
        request: mkRequest("https://app.com", "https://api.com/items", "DELETE"),
        serverConfig: mkServerConfig({
          allowOrigins: ["https://app.com"],
          allowMethods: ["GET", "DELETE"],
          maxAge: 3600,
        }),
      },
      {
        type: "request",
        request: mkRequest("https://app.com", "https://api.com/items/1", "DELETE"),
        serverConfig: mkServerConfig({
          allowOrigins: ["https://app.com"],
          allowMethods: ["GET", "DELETE"],
          maxAge: 3600,
        }),
      },
    ]);
    expect(result.results[0]!.preflightCached).toBe(false);
    expect(result.results[1]!.preflightCached).toBe(true);
  });
});

// ─── クレデンシャル ───

describe("クレデンシャル", () => {
  it("credentials + 具体的オリジン + Allow-Credentials → 許可", () => {
    const result = simulate([{
      type: "request",
      request: mkRequest("https://app.com", "https://api.com/me", "GET", {
        credentials: true,
      }),
      serverConfig: mkServerConfig({
        allowOrigins: ["https://app.com"],
        allowCredentials: true,
      }),
    }]);
    expect(result.results[0]!.verdict).toBe("allowed");
  });

  it("credentials + Allow-Credentials: false → ブロック", () => {
    const result = simulate([{
      type: "request",
      request: mkRequest("https://app.com", "https://api.com/me", "GET", {
        credentials: true,
      }),
      serverConfig: mkServerConfig({
        allowOrigins: ["https://app.com"],
        allowCredentials: false,
      }),
    }]);
    expect(result.results[0]!.verdict).toBe("blocked_credentials");
  });
});

// ─── Expose-Headers ───

describe("Expose-Headers", () => {
  it("Expose-Headersが設定される", () => {
    const result = simulate([{
      type: "request",
      request: mkRequest("https://app.com", "https://api.com/data"),
      serverConfig: mkServerConfig({
        allowOrigins: ["https://app.com"],
        exposeHeaders: ["X-Request-Id", "X-RateLimit"],
      }),
    }]);
    expect(result.results[0]!.actualResponse?.["access-control-expose-headers"]).toBe("X-Request-Id, X-RateLimit");
  });
});

// ─── プリセット ───

describe("プリセット", () => {
  it("全プリセットがエラーなく実行できる", () => {
    for (const preset of PRESETS) {
      const ops = preset.build();
      const result = simulate(ops);
      expect(result.results.length).toBeGreaterThan(0);
    }
  });

  it("プリセット数が10個ある", () => {
    expect(PRESETS.length).toBe(10);
  });

  it("全プリセットに一意の名前がある", () => {
    const names = PRESETS.map(p => p.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
