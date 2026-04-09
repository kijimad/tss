import { ApiGatewayEngine } from "../engine/apigw.js";
import type { ApiDefinition, GwRequest, GwResult, GwTrace } from "../engine/apigw.js";

export interface Example {
  name: string;
  description: string;
  api: ApiDefinition;
  requests: GwRequest[];
}

const req = (method: string, path: string, stage = "prod", headers: Record<string, string> = {}, body: string | null = null, qs: Record<string, string> = {}): GwRequest => ({
  method, path, stage, headers: { "content-type": "application/json", ...headers },
  queryString: qs, body, sourceIp: "203.0.113.1",
});

// ── Lambda ハンドラ群 ──

const crudHandler = (event: { httpMethod: string; path: string; pathParameters: Record<string, string> | null; body: string | null }) => {
  const id = event.pathParameters?.["id"];
  switch (event.httpMethod) {
    case "GET":
      return id
        ? { statusCode: 200, body: JSON.stringify({ id, name: "Alice", email: "alice@example.com" }) }
        : { statusCode: 200, body: JSON.stringify([{ id: "1", name: "Alice" }, { id: "2", name: "Bob" }]) };
    case "POST":
      return { statusCode: 201, body: JSON.stringify({ id: "3", ...JSON.parse(event.body ?? "{}") }) };
    case "PUT":
      return { statusCode: 200, body: JSON.stringify({ id, updated: true }) };
    case "DELETE":
      return { statusCode: 204, body: "" };
    default:
      return { statusCode: 405, body: '{"message":"Method Not Allowed"}' };
  }
};

export const EXAMPLES: Example[] = [
  {
    name: "REST API + Lambda Proxy 統合",
    description: "CRUD API。GET /users, GET /users/{id}, POST /users を Lambda Proxy 統合で処理。パスパラメータの抽出を確認。",
    api: {
      name: "UserAPI", type: "REST",
      resources: [
        { path: "/users", methods: [
          { httpMethod: "GET", authorizationType: "NONE", apiKeyRequired: false, integration: { type: "AWS_PROXY", lambdaFunction: "getUsers", lambdaHandler: crudHandler, timeoutMs: 29000 }, methodResponses: [{ statusCode: 200 }], cors: true },
          { httpMethod: "POST", authorizationType: "NONE", apiKeyRequired: false, requestValidator: "BODY", integration: { type: "AWS_PROXY", lambdaFunction: "createUser", lambdaHandler: crudHandler, timeoutMs: 29000 }, methodResponses: [{ statusCode: 201 }], cors: true },
        ]},
        { path: "/users/{id}", methods: [
          { httpMethod: "GET", authorizationType: "NONE", apiKeyRequired: false, integration: { type: "AWS_PROXY", lambdaFunction: "getUser", lambdaHandler: crudHandler, timeoutMs: 29000 }, methodResponses: [{ statusCode: 200 }], cors: true },
          { httpMethod: "DELETE", authorizationType: "NONE", apiKeyRequired: false, integration: { type: "AWS_PROXY", lambdaFunction: "deleteUser", lambdaHandler: crudHandler, timeoutMs: 29000 }, methodResponses: [{ statusCode: 204 }], cors: true },
        ]},
      ],
      authorizers: [], stages: [{ name: "prod", variables: {}, throttling: { rateLimit: 1000, burstLimit: 500 }, logging: true, caching: false, cacheTtl: 0 }],
      usagePlans: [], apiKeys: [],
    },
    requests: [
      req("GET", "/users"),
      req("GET", "/users/1"),
      req("POST", "/users", "prod", {}, '{"name":"Charlie","email":"c@example.com"}'),
      req("DELETE", "/users/2"),
      req("GET", "/nonexistent"),
    ],
  },
  {
    name: "API キー + 使用量プラン",
    description: "API キーが必要な API。有効/無効キーとクォータ超過の挙動を確認。",
    api: {
      name: "ProtectedAPI", type: "REST",
      resources: [{ path: "/data", methods: [
        { httpMethod: "GET", authorizationType: "API_KEY", apiKeyRequired: true, integration: { type: "AWS_PROXY", lambdaFunction: "getData", lambdaHandler: () => ({ statusCode: 200, body: '{"data":"secret"}' }), timeoutMs: 29000 }, methodResponses: [{ statusCode: 200 }] },
      ]}],
      authorizers: [],
      stages: [{ name: "prod", variables: {}, throttling: { rateLimit: 100, burstLimit: 50 }, logging: true, caching: false, cacheTtl: 0 }],
      usagePlans: [{ name: "basic", rateLimit: 10, burstLimit: 5, quota: 3 }],
      apiKeys: [
        { id: "key-1", name: "valid-key", value: "abc123", enabled: true, usagePlanId: "basic" },
        { id: "key-2", name: "disabled-key", value: "xyz789", enabled: false, usagePlanId: "basic" },
      ],
    },
    requests: [
      req("GET", "/data", "prod", { "x-api-key": "abc123" }),
      req("GET", "/data", "prod", { "x-api-key": "abc123" }),
      req("GET", "/data", "prod", { "x-api-key": "abc123" }),
      req("GET", "/data", "prod", { "x-api-key": "abc123" }),
      req("GET", "/data"),
      req("GET", "/data", "prod", { "x-api-key": "xyz789" }),
    ],
  },
  {
    name: "Cognito オーソライザー",
    description: "Bearer トークンによる認証。有効/無効/なしの各ケースを確認。",
    api: {
      name: "AuthAPI", type: "REST",
      resources: [{ path: "/profile", methods: [
        { httpMethod: "GET", authorizationType: "COGNITO", apiKeyRequired: false, integration: { type: "AWS_PROXY", lambdaFunction: "getProfile", lambdaHandler: () => ({ statusCode: 200, body: '{"userId":"u-123","name":"Alice"}' }), timeoutMs: 29000 }, methodResponses: [{ statusCode: 200 }] },
      ]}],
      authorizers: [{
        name: "CognitoAuth", type: "COGNITO",
        validate: (token) => {
          if (token === "Bearer valid-token") return { allowed: true, principalId: "user-123" };
          if (token === "Bearer expired") return { allowed: false, principalId: "anonymous" };
          return { allowed: false, principalId: "anonymous" };
        },
      }],
      stages: [{ name: "prod", variables: {}, throttling: { rateLimit: 1000, burstLimit: 500 }, logging: true, caching: false, cacheTtl: 0 }],
      usagePlans: [], apiKeys: [],
    },
    requests: [
      req("GET", "/profile", "prod", { "authorization": "Bearer valid-token" }),
      req("GET", "/profile", "prod", { "authorization": "Bearer expired" }),
      req("GET", "/profile"),
    ],
  },
  {
    name: "Mock 統合",
    description: "バックエンド不要の Mock レスポンス。ヘルスチェックや静的レスポンスに使用。",
    api: {
      name: "MockAPI", type: "REST",
      resources: [
        { path: "/health", methods: [
          { httpMethod: "GET", authorizationType: "NONE", apiKeyRequired: false, integration: { type: "MOCK", mockStatusCode: 200, mockBody: '{"status":"healthy"}', timeoutMs: 1000 }, methodResponses: [{ statusCode: 200 }] },
        ]},
        { path: "/maintenance", methods: [
          { httpMethod: "GET", authorizationType: "NONE", apiKeyRequired: false, integration: { type: "MOCK", mockStatusCode: 503, mockBody: '{"message":"Service under maintenance"}', timeoutMs: 1000 }, methodResponses: [{ statusCode: 503 }] },
        ]},
      ],
      authorizers: [],
      stages: [{ name: "prod", variables: {}, throttling: { rateLimit: 1000, burstLimit: 500 }, logging: true, caching: false, cacheTtl: 0 }],
      usagePlans: [], apiKeys: [],
    },
    requests: [req("GET", "/health"), req("GET", "/maintenance"), req("GET", "/unknown")],
  },
  {
    name: "ステージキャッシュ",
    description: "GET リクエストがステージキャッシュされる。2 回目以降は Lambda を呼ばずキャッシュから返却。",
    api: {
      name: "CachedAPI", type: "REST",
      resources: [{ path: "/items", methods: [
        { httpMethod: "GET", authorizationType: "NONE", apiKeyRequired: false, integration: { type: "AWS_PROXY", lambdaFunction: "listItems", lambdaHandler: () => ({ statusCode: 200, body: JSON.stringify({ items: [1, 2, 3], ts: Date.now() }) }), timeoutMs: 29000 }, methodResponses: [{ statusCode: 200 }] },
      ]}],
      authorizers: [],
      stages: [{ name: "prod", variables: {}, throttling: { rateLimit: 1000, burstLimit: 500 }, logging: true, caching: true, cacheTtl: 60 }],
      usagePlans: [], apiKeys: [],
    },
    requests: [req("GET", "/items"), req("GET", "/items"), req("GET", "/items")],
  },
  {
    name: "スロットリング (429)",
    description: "バースト上限 2 req/s の制限。3 回目以降のリクエストが 429 Too Many Requests になる。",
    api: {
      name: "ThrottleAPI", type: "REST",
      resources: [{ path: "/api", methods: [
        { httpMethod: "GET", authorizationType: "NONE", apiKeyRequired: false, integration: { type: "MOCK", mockStatusCode: 200, mockBody: '{"ok":true}', timeoutMs: 1000 }, methodResponses: [{ statusCode: 200 }] },
      ]}],
      authorizers: [],
      stages: [{ name: "prod", variables: {}, throttling: { rateLimit: 2, burstLimit: 2 }, logging: true, caching: false, cacheTtl: 0 }],
      usagePlans: [], apiKeys: [],
    },
    requests: [req("GET", "/api"), req("GET", "/api"), req("GET", "/api"), req("GET", "/api")],
  },
  {
    name: "リクエストバリデーション",
    description: "POST ボディの JSON バリデーション。不正な JSON は 400 Bad Request。",
    api: {
      name: "ValidAPI", type: "REST",
      resources: [{ path: "/submit", methods: [
        { httpMethod: "POST", authorizationType: "NONE", apiKeyRequired: false, requestValidator: "BODY", integration: { type: "AWS_PROXY", lambdaFunction: "submit", lambdaHandler: (e) => ({ statusCode: 200, body: `{"received":${e.body}}` }), timeoutMs: 29000 }, methodResponses: [{ statusCode: 200 }] },
      ]}],
      authorizers: [],
      stages: [{ name: "prod", variables: {}, throttling: { rateLimit: 1000, burstLimit: 500 }, logging: true, caching: false, cacheTtl: 0 }],
      usagePlans: [], apiKeys: [],
    },
    requests: [
      req("POST", "/submit", "prod", {}, '{"name":"Alice"}'),
      req("POST", "/submit", "prod", {}, 'not json{{{'),
      req("POST", "/submit", "prod", {}, null),
    ],
  },
];

function phaseColor(p: GwTrace["phase"]): string {
  switch (p) {
    case "receive":          return "#60a5fa";
    case "route":            return "#06b6d4";
    case "auth":             return "#a78bfa";
    case "validate":         return "#f59e0b";
    case "throttle":         return "#f97316";
    case "api_key":          return "#ec4899";
    case "integration_req":  return "#3b82f6";
    case "lambda":           return "#22c55e";
    case "integration_resp": return "#10b981";
    case "method_resp":      return "#22c55e";
    case "cors":             return "#64748b";
    case "cache":            return "#f59e0b";
    case "error":            return "#ef4444";
    case "mapping":          return "#8b5cf6";
  }
}

export class ApiGwApp {
  init(container: HTMLElement): void {
    container.style.cssText = "display:flex;flex-direction:column;height:100vh;font-family:'Fira Code','Cascadia Code',monospace;background:#0f172a;color:#e2e8f0;";

    const header = document.createElement("div");
    header.style.cssText = "padding:8px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #1e293b;flex-wrap:wrap;";
    const title = document.createElement("h1");
    title.textContent = "API Gateway Simulator";
    title.style.cssText = "margin:0;font-size:15px;color:#ff9900;";
    header.appendChild(title);

    const exSelect = document.createElement("select");
    exSelect.style.cssText = "padding:4px 8px;background:#1e293b;border:1px solid #334155;border-radius:4px;color:#f8fafc;font-size:12px;";
    for (let i = 0; i < EXAMPLES.length; i++) { const o = document.createElement("option"); o.value = String(i); o.textContent = EXAMPLES[i]!.name; exSelect.appendChild(o); }
    header.appendChild(exSelect);

    const runBtn = document.createElement("button");
    runBtn.textContent = "\u25B6 Send All";
    runBtn.style.cssText = "padding:4px 16px;background:#ff9900;color:#0f172a;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;";
    header.appendChild(runBtn);

    const descSpan = document.createElement("span");
    descSpan.style.cssText = "font-size:10px;color:#64748b;margin-left:auto;max-width:400px;";
    header.appendChild(descSpan);
    container.appendChild(header);

    const main = document.createElement("div");
    main.style.cssText = "flex:1;display:flex;overflow:hidden;";

    // 左: API 設定
    const leftPanel = document.createElement("div");
    leftPanel.style.cssText = "width:320px;display:flex;flex-direction:column;border-right:1px solid #1e293b;overflow-y:auto;font-size:10px;";
    const cfgLabel = document.createElement("div");
    cfgLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#ff9900;border-bottom:1px solid #1e293b;";
    cfgLabel.textContent = "API Configuration";
    leftPanel.appendChild(cfgLabel);
    const cfgDiv = document.createElement("div");
    cfgDiv.style.cssText = "padding:8px 12px;";
    leftPanel.appendChild(cfgDiv);
    main.appendChild(leftPanel);

    // 中央: 結果
    const centerPanel = document.createElement("div");
    centerPanel.style.cssText = "flex:1;display:flex;flex-direction:column;border-right:1px solid #1e293b;";
    const resLabel = document.createElement("div");
    resLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#e2e8f0;border-bottom:1px solid #1e293b;";
    resLabel.textContent = "Request Results";
    centerPanel.appendChild(resLabel);
    const resDiv = document.createElement("div");
    resDiv.style.cssText = "flex:1;padding:4px 8px;font-size:10px;overflow-y:auto;";
    centerPanel.appendChild(resDiv);
    main.appendChild(centerPanel);

    // 右: トレース
    const rightPanel = document.createElement("div");
    rightPanel.style.cssText = "width:440px;display:flex;flex-direction:column;";
    const trLabel = document.createElement("div");
    trLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#22c55e;border-bottom:1px solid #1e293b;";
    trLabel.textContent = "Execution Trace (click)";
    rightPanel.appendChild(trLabel);
    const trDiv = document.createElement("div");
    trDiv.style.cssText = "flex:1;padding:4px 8px;font-size:9px;overflow-y:auto;line-height:1.6;";
    rightPanel.appendChild(trDiv);
    main.appendChild(rightPanel);
    container.appendChild(main);

    // ── 描画 ──

    const renderConfig = (api: ApiDefinition) => {
      cfgDiv.innerHTML = "";
      const add = (l: string, v: string, c: string) => {
        const r = document.createElement("div"); r.style.marginBottom = "2px";
        r.innerHTML = `<span style="color:${c};font-weight:600;min-width:75px;display:inline-block;">${l}</span> <span style="color:#94a3b8;">${v}</span>`;
        cfgDiv.appendChild(r);
      };
      add("API 名", api.name, "#ff9900");
      add("タイプ", api.type, "#64748b");
      add("ステージ", api.stages.map((s) => s.name).join(", "), "#3b82f6");
      if (api.authorizers.length > 0) add("オーソライザー", api.authorizers.map((a) => `${a.name}(${a.type})`).join(", "), "#a78bfa");
      if (api.apiKeys.length > 0) add("API キー", `${api.apiKeys.length} 個`, "#ec4899");
      if (api.usagePlans.length > 0) add("使用量プラン", api.usagePlans.map((p) => `${p.name}(${p.quota}/月)`).join(", "), "#f59e0b");

      const resTitle = document.createElement("div");
      resTitle.style.cssText = "color:#06b6d4;font-weight:600;margin-top:8px;margin-bottom:4px;";
      resTitle.textContent = "Resources:";
      cfgDiv.appendChild(resTitle);
      for (const res of api.resources) {
        for (const m of res.methods) {
          const el = document.createElement("div");
          el.style.cssText = "padding:2px 6px;margin-bottom:2px;border-left:2px solid #334155;";
          const authTag = m.authorizationType !== "NONE" ? ` <span style="color:#a78bfa;font-size:8px;">[${m.authorizationType}]</span>` : "";
          const keyTag = m.apiKeyRequired ? ' <span style="color:#ec4899;font-size:8px;">[KEY]</span>' : "";
          el.innerHTML = `<span style="color:#22c55e;">${m.httpMethod}</span> <span style="color:#e2e8f0;">${res.path}</span> → <span style="color:#64748b;">${m.integration.type}</span>${authTag}${keyTag}`;
          cfgDiv.appendChild(el);
        }
      }
    };

    const renderResults = (results: GwResult[]) => {
      resDiv.innerHTML = "";
      for (const r of results) {
        const el = document.createElement("div");
        const ok = r.response.statusCode < 400;
        const border = ok ? "#22c55e" : r.response.statusCode === 429 ? "#f59e0b" : "#ef4444";
        el.style.cssText = `padding:5px 8px;margin-bottom:3px;border:1px solid ${border}44;border-radius:4px;background:${border}06;cursor:pointer;`;
        el.innerHTML =
          `<div style="display:flex;justify-content:space-between;">` +
          `<span style="color:#e2e8f0;font-weight:600;">${r.request.method} ${r.request.path}</span>` +
          `<span style="color:${border};font-weight:600;">${r.response.statusCode}</span></div>` +
          `<div style="color:#64748b;font-size:9px;">stage=${r.request.stage} | resource=${r.matchedResource ?? "none"} | latency=${r.integrationLatency}ms | ${r.requestId}</div>`;
        if (r.response.body && r.response.body.length < 80) {
          el.innerHTML += `<div style="color:#94a3b8;font-size:9px;margin-top:1px;">${r.response.body}</div>`;
        }
        el.addEventListener("click", () => renderTrace(r.trace, r.response));
        resDiv.appendChild(el);
      }
    };

    const renderTrace = (trace: GwTrace[], resp: GwResult["response"]) => {
      trDiv.innerHTML = "";
      for (const step of trace) {
        const el = document.createElement("div");
        el.style.cssText = "display:flex;gap:4px;align-items:flex-start;margin-bottom:2px;";
        const color = phaseColor(step.phase);
        const dur = step.durationMs > 0 ? `<span style="color:#64748b;min-width:30px;text-align:right;">${step.durationMs}ms</span>` : '<span style="min-width:30px;"></span>';
        el.innerHTML =
          `<span style="min-width:85px;padding:0 3px;border-radius:2px;font-size:8px;font-weight:600;text-align:center;color:${color};background:${color}15;border:1px solid ${color}33;">${step.phase}</span>` +
          dur + `<span style="color:#cbd5e1;">${step.detail}</span>`;
        trDiv.appendChild(el);
      }
      // レスポンスヘッダ + ボディ
      const section = document.createElement("div");
      section.style.cssText = "margin-top:8px;padding:4px 6px;background:#1e293b;border-radius:4px;";
      section.innerHTML = `<div style="color:#64748b;font-weight:600;margin-bottom:2px;">Response Headers</div>`;
      for (const [k, v] of Object.entries(resp.headers)) {
        section.innerHTML += `<div style="color:#94a3b8;"><span style="color:#06b6d4;">${k}:</span> ${v}</div>`;
      }
      if (resp.body) {
        section.innerHTML += `<div style="color:#64748b;font-weight:600;margin-top:4px;">Body</div><pre style="color:#94a3b8;font-size:9px;margin:0;white-space:pre-wrap;">${resp.body.slice(0, 300)}</pre>`;
      }
      trDiv.appendChild(section);
    };

    const loadExample = (ex: Example) => {
      descSpan.textContent = ex.description;
      renderConfig(ex.api);
      resDiv.innerHTML = ""; trDiv.innerHTML = "";
    };

    const runSim = (ex: Example) => {
      const engine = new ApiGatewayEngine(ex.api);
      const results = ex.requests.map((r) => engine.handleRequest(r));
      renderConfig(ex.api);
      renderResults(results);
      if (results[0]) renderTrace(results[0].trace, results[0].response);
    };

    exSelect.addEventListener("change", () => { const ex = EXAMPLES[Number(exSelect.value)]; if (ex) loadExample(ex); });
    runBtn.addEventListener("click", () => { const ex = EXAMPLES[Number(exSelect.value)]; if (ex) runSim(ex); });
    loadExample(EXAMPLES[0]!);
  }
}
