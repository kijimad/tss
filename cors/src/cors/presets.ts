/* CORS プリセット集 */

import type { Preset } from "./types.js";
import { mkRequest, mkServerConfig } from "./engine.js";

/** 1. 同一オリジンリクエスト */
const sameOrigin: Preset = {
  name: "同一オリジン",
  description: "同じオリジンへのリクエスト。CORSチェック不要。",
  build: () => [{
    type: "request",
    request: mkRequest("https://example.com", "https://example.com/api/data"),
    serverConfig: mkServerConfig(),
  }],
};

/** 2. 単純リクエスト (GET) */
const simpleGet: Preset = {
  name: "単純リクエスト (GET)",
  description: "GETリクエスト＋単純ヘッダのみ → プリフライト不要。サーバーがACAOを返せば許可。",
  build: () => [{
    type: "request",
    request: mkRequest("https://app.example.com", "https://api.example.com/users", "GET"),
    serverConfig: mkServerConfig({
      allowOrigins: ["https://app.example.com"],
    }),
  }],
};

/** 3. 単純リクエスト (POST + form) */
const simplePost: Preset = {
  name: "単純リクエスト (POST)",
  description: "POSTリクエスト＋Content-Type: application/x-www-form-urlencoded → 単純リクエスト。",
  build: () => [{
    type: "request",
    request: mkRequest("https://app.example.com", "https://api.example.com/submit", "POST", {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    }),
    serverConfig: mkServerConfig({
      allowOrigins: ["https://app.example.com"],
    }),
  }],
};

/** 4. プリフライト (JSON POST) */
const preflightJson: Preset = {
  name: "プリフライト (JSON POST)",
  description: "Content-Type: application/json は非単純ヘッダ → OPTIONSプリフライトが必要。",
  build: () => [{
    type: "request",
    request: mkRequest("https://frontend.example.com", "https://api.example.com/data", "POST", {
      headers: { "Content-Type": "application/json" },
    }),
    serverConfig: mkServerConfig({
      allowOrigins: ["https://frontend.example.com"],
      allowHeaders: ["Content-Type"],
    }),
  }],
};

/** 5. プリフライト (PUT + Authorization) */
const preflightPut: Preset = {
  name: "プリフライト (PUT + Auth)",
  description: "PUTメソッド＋Authorizationヘッダ → 2つの理由でプリフライト必要。",
  build: () => [{
    type: "request",
    request: mkRequest("https://dashboard.example.com", "https://api.example.com/resource/1", "PUT", {
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer eyJhbGciOiJIUzI1NiJ9...",
      },
    }),
    serverConfig: mkServerConfig({
      allowOrigins: ["https://dashboard.example.com"],
      allowMethods: ["GET", "POST", "PUT", "DELETE"],
      allowHeaders: ["Content-Type", "Authorization"],
    }),
  }],
};

/** 6. クレデンシャル付きリクエスト */
const withCredentials: Preset = {
  name: "クレデンシャル付き",
  description: "credentials: true → ACAO: * は不可、具体的オリジン必須。Allow-Credentials: true 必要。",
  build: () => [
    // 正しい設定
    {
      type: "request",
      request: mkRequest("https://app.example.com", "https://api.example.com/me", "GET", {
        credentials: true,
      }),
      serverConfig: mkServerConfig({
        allowOrigins: ["https://app.example.com"],
        allowCredentials: true,
      }),
    },
    // 誤り: ワイルドカード + credentials
    {
      type: "request",
      request: mkRequest("https://app.example.com", "https://api.other.com/me", "GET", {
        credentials: true,
      }),
      serverConfig: mkServerConfig({
        allowOrigins: "*",
        allowCredentials: false,
      }),
    },
  ],
};

/** 7. オリジン拒否 */
const originBlocked: Preset = {
  name: "オリジン拒否",
  description: "許可リストにないオリジンからのリクエスト → ブラウザがレスポンスをブロック。",
  build: () => [{
    type: "request",
    request: mkRequest("https://evil.example.org", "https://api.example.com/secret", "GET"),
    serverConfig: mkServerConfig({
      allowOrigins: ["https://app.example.com", "https://admin.example.com"],
    }),
  }],
};

/** 8. ヘッダ拒否 (カスタムヘッダ) */
const headerBlocked: Preset = {
  name: "カスタムヘッダ拒否",
  description: "サーバーが許可していないカスタムヘッダ → プリフライト失敗。",
  build: () => [{
    type: "request",
    request: mkRequest("https://app.example.com", "https://api.example.com/data", "GET", {
      headers: { "X-Custom-Header": "value123", "X-Request-Id": "abc" },
    }),
    serverConfig: mkServerConfig({
      allowOrigins: ["https://app.example.com"],
      allowHeaders: ["Content-Type"], // X-Custom-Header, X-Request-Id は許可されていない
    }),
  }],
};

/** 9. Expose-Headers */
const exposeHeaders: Preset = {
  name: "Expose-Headers",
  description: "デフォルトではJSから読めるレスポンスヘッダは限定的。Expose-Headersで追加公開。",
  build: () => [
    // Expose-Headersなし
    {
      type: "request",
      request: mkRequest("https://app.example.com", "https://api.example.com/download", "GET"),
      serverConfig: mkServerConfig({
        allowOrigins: ["https://app.example.com"],
        exposeHeaders: [],
      }),
    },
    // Expose-Headersあり
    {
      type: "request",
      request: mkRequest("https://app.example.com", "https://api.example.com/download", "GET"),
      serverConfig: mkServerConfig({
        allowOrigins: ["https://app.example.com"],
        exposeHeaders: ["X-Request-Id", "X-RateLimit-Remaining", "Content-Disposition"],
      }),
    },
  ],
};

/** 10. プリフライトキャッシュ */
const preflightCache: Preset = {
  name: "プリフライトキャッシュ",
  description: "Max-Ageでプリフライト結果をキャッシュ。同じリクエストの2回目はOPTIONS省略。",
  build: () => [
    {
      type: "request",
      request: mkRequest("https://app.example.com", "https://api.example.com/items", "DELETE"),
      serverConfig: mkServerConfig({
        allowOrigins: ["https://app.example.com"],
        allowMethods: ["GET", "POST", "DELETE"],
        maxAge: 3600,
      }),
    },
    // 2回目 → キャッシュヒット
    {
      type: "request",
      request: mkRequest("https://app.example.com", "https://api.example.com/items/1", "DELETE"),
      serverConfig: mkServerConfig({
        allowOrigins: ["https://app.example.com"],
        allowMethods: ["GET", "POST", "DELETE"],
        maxAge: 3600,
      }),
    },
  ],
};

export const PRESETS: Preset[] = [
  sameOrigin,
  simpleGet,
  simplePost,
  preflightJson,
  preflightPut,
  withCredentials,
  originBlocked,
  headerBlocked,
  exposeHeaders,
  preflightCache,
];
