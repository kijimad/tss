import { describe, it, expect } from "vitest";
import { ApiGatewayEngine } from "../engine/apigw.js";
import { EXAMPLES } from "../ui/app.js";
import type { ApiDefinition, GwRequest } from "../engine/apigw.js";

const req = (method: string, path: string, headers: Record<string, string> = {}, body: string | null = null): GwRequest => ({
  method, path, stage: "prod", headers: { "content-type": "application/json", "x-forwarded-proto": "https", ...headers },
  queryString: {}, body, sourceIp: "1.2.3.4",
});

const simpleApi: ApiDefinition = {
  name: "Test", type: "REST",
  resources: [{ path: "/hello", methods: [
    { httpMethod: "GET", authorizationType: "NONE", apiKeyRequired: false, integration: { type: "MOCK", mockStatusCode: 200, mockBody: '{"msg":"hi"}', timeoutMs: 1000 }, methodResponses: [{ statusCode: 200 }] },
  ]}],
  authorizers: [], apiKeys: [], usagePlans: [],
  stages: [{ name: "prod", variables: {}, throttling: { rateLimit: 100, burstLimit: 50 }, logging: true, caching: false, cacheTtl: 0 }],
};

describe("基本リクエスト処理", () => {
  it("MOCK 統合で 200 を返す", () => {
    const e = new ApiGatewayEngine(simpleApi);
    const r = e.handleRequest(req("GET", "/hello"));
    expect(r.response.statusCode).toBe(200);
    expect(r.response.body).toContain("hi");
  });

  it("存在しないリソースは 404", () => {
    const e = new ApiGatewayEngine(simpleApi);
    const r = e.handleRequest(req("GET", "/nothing"));
    expect(r.response.statusCode).toBe(404);
  });

  it("存在しないステージは 403", () => {
    const e = new ApiGatewayEngine(simpleApi);
    const r = e.handleRequest({ ...req("GET", "/hello"), stage: "unknown" });
    expect(r.response.statusCode).toBe(403);
  });
});

describe("パスパラメータ", () => {
  it("{id} をマッチして Lambda に渡す", () => {
    const api: ApiDefinition = {
      ...simpleApi,
      resources: [{ path: "/items/{id}", methods: [
        { httpMethod: "GET", authorizationType: "NONE", apiKeyRequired: false, integration: {
          type: "AWS_PROXY", lambdaFunction: "get",
          lambdaHandler: (ev) => ({ statusCode: 200, body: JSON.stringify({ id: ev.pathParameters?.["id"] }) }),
          timeoutMs: 29000,
        }, methodResponses: [{ statusCode: 200 }] },
      ]}],
    };
    const e = new ApiGatewayEngine(api);
    const r = e.handleRequest(req("GET", "/items/42"));
    expect(r.response.statusCode).toBe(200);
    expect(JSON.parse(r.response.body).id).toBe("42");
  });
});

describe("API キー", () => {
  it("有効な API キーで成功", () => {
    const api: ApiDefinition = {
      ...simpleApi,
      resources: [{ path: "/data", methods: [
        { httpMethod: "GET", authorizationType: "API_KEY", apiKeyRequired: true, integration: { type: "MOCK", mockStatusCode: 200, mockBody: "ok", timeoutMs: 1000 }, methodResponses: [{ statusCode: 200 }] },
      ]}],
      apiKeys: [{ id: "k1", name: "key", value: "secret", enabled: true, usagePlanId: "" }],
    };
    const e = new ApiGatewayEngine(api);
    expect(e.handleRequest(req("GET", "/data", { "x-api-key": "secret" })).response.statusCode).toBe(200);
  });

  it("API キーなしで 403", () => {
    const api: ApiDefinition = {
      ...simpleApi,
      resources: [{ path: "/data", methods: [
        { httpMethod: "GET", authorizationType: "API_KEY", apiKeyRequired: true, integration: { type: "MOCK", mockStatusCode: 200, mockBody: "ok", timeoutMs: 1000 }, methodResponses: [{ statusCode: 200 }] },
      ]}],
      apiKeys: [{ id: "k1", name: "key", value: "secret", enabled: true, usagePlanId: "" }],
    };
    const e = new ApiGatewayEngine(api);
    expect(e.handleRequest(req("GET", "/data")).response.statusCode).toBe(403);
  });
});

describe("オーソライザー", () => {
  const authApi: ApiDefinition = {
    ...simpleApi,
    resources: [{ path: "/secure", methods: [
      { httpMethod: "GET", authorizationType: "COGNITO", apiKeyRequired: false, integration: { type: "MOCK", mockStatusCode: 200, mockBody: "ok", timeoutMs: 1000 }, methodResponses: [{ statusCode: 200 }] },
    ]}],
    authorizers: [{ name: "Auth", type: "COGNITO", validate: (t) => t === "Bearer ok" ? { allowed: true, principalId: "u1" } : { allowed: false, principalId: "" } }],
  };

  it("有効トークンで成功", () => {
    const e = new ApiGatewayEngine(authApi);
    expect(e.handleRequest(req("GET", "/secure", { authorization: "Bearer ok" })).response.statusCode).toBe(200);
  });

  it("無効トークンで 401", () => {
    const e = new ApiGatewayEngine(authApi);
    expect(e.handleRequest(req("GET", "/secure", { authorization: "Bearer bad" })).response.statusCode).toBe(401);
  });
});

describe("スロットリング", () => {
  it("バースト上限超過で 429", () => {
    const api: ApiDefinition = {
      ...simpleApi,
      stages: [{ ...simpleApi.stages[0]!, throttling: { rateLimit: 2, burstLimit: 2 } }],
    };
    const e = new ApiGatewayEngine(api);
    e.handleRequest(req("GET", "/hello"));
    e.handleRequest(req("GET", "/hello"));
    const r3 = e.handleRequest(req("GET", "/hello"));
    expect(r3.response.statusCode).toBe(429);
  });
});

describe("キャッシュ", () => {
  it("キャッシュ有効時に 2 回目がキャッシュから返る", () => {
    const api: ApiDefinition = {
      ...simpleApi,
      stages: [{ ...simpleApi.stages[0]!, caching: true, cacheTtl: 60 }],
    };
    const e = new ApiGatewayEngine(api);
    e.handleRequest(req("GET", "/hello"));
    const r2 = e.handleRequest(req("GET", "/hello"));
    expect(r2.trace.some((t) => t.phase === "cache" && t.detail.includes("ヒット"))).toBe(true);
  });
});

describe("リクエストバリデーション", () => {
  it("不正な JSON で 400", () => {
    const api: ApiDefinition = {
      ...simpleApi,
      resources: [{ path: "/submit", methods: [
        { httpMethod: "POST", authorizationType: "NONE", apiKeyRequired: false, requestValidator: "BODY",
          integration: { type: "MOCK", mockStatusCode: 200, mockBody: "ok", timeoutMs: 1000 }, methodResponses: [{ statusCode: 200 }] },
      ]}],
    };
    const e = new ApiGatewayEngine(api);
    expect(e.handleRequest(req("POST", "/submit", {}, "not json")).response.statusCode).toBe(400);
  });
});

describe("トレース", () => {
  it("全リクエストでトレースが生成される", () => {
    const e = new ApiGatewayEngine(simpleApi);
    const r = e.handleRequest(req("GET", "/hello"));
    expect(r.trace.length).toBeGreaterThan(0);
    expect(r.trace[0]!.phase).toBe("receive");
    expect(r.requestId).toMatch(/^req-/);
  });
});

describe("EXAMPLES", () => {
  it("7 つのサンプル", () => { expect(EXAMPLES).toHaveLength(7); });
  it("名前が一意", () => { expect(new Set(EXAMPLES.map((e) => e.name)).size).toBe(EXAMPLES.length); });
  for (const ex of EXAMPLES) {
    it(`${ex.name}: 全リクエスト実行可能`, () => {
      const e = new ApiGatewayEngine(ex.api);
      for (const r of ex.requests) {
        const result = e.handleRequest(r);
        expect(result.trace.length).toBeGreaterThan(0);
      }
    });
  }
});
