/**
 * apigw.ts — Amazon API Gateway シミュレーション
 *
 * リクエスト処理パイプライン:
 *   Method Request (認証・バリデーション)
 *   → Integration Request (マッピング・バックエンド呼び出し)
 *   → Integration Response (レスポンス変換)
 *   → Method Response (クライアントへ返却)
 */

// ── リソース定義 ──

export interface Resource {
  path: string;
  methods: MethodConfig[];
}

export interface MethodConfig {
  httpMethod: string;
  authorizationType: "NONE" | "API_KEY" | "COGNITO" | "LAMBDA" | "IAM";
  /** API キーが必要か */
  apiKeyRequired: boolean;
  /** リクエストバリデーション */
  requestValidator?: "BODY" | "PARAMS" | "BODY_AND_PARAMS";
  /** 統合設定 */
  integration: Integration;
  /** メソッドレスポンス定義 */
  methodResponses: { statusCode: number; models?: string }[];
  /** CORS 設定 */
  cors?: boolean;
}

export type IntegrationType = "AWS_PROXY" | "AWS" | "HTTP" | "HTTP_PROXY" | "MOCK";

export interface Integration {
  type: IntegrationType;
  uri?: string;
  /** Lambda 関数名 (AWS_PROXY / AWS) */
  lambdaFunction?: string;
  /** Lambda シミュレーション */
  lambdaHandler?: (event: LambdaProxyEvent) => LambdaProxyResponse;
  /** Mock レスポンス */
  mockStatusCode?: number;
  mockBody?: string;
  /** マッピングテンプレート (VTL 風) */
  requestTemplate?: string;
  responseTemplate?: string;
  /** タイムアウト (ms) */
  timeoutMs: number;
}

// ── Lambda Proxy Event/Response ──

export interface LambdaProxyEvent {
  httpMethod: string;
  path: string;
  pathParameters: Record<string, string> | null;
  queryStringParameters: Record<string, string> | null;
  headers: Record<string, string>;
  body: string | null;
  requestContext: {
    stage: string;
    requestId: string;
    identity: { sourceIp: string; apiKey?: string };
  };
}

export interface LambdaProxyResponse {
  statusCode: number;
  headers?: Record<string, string>;
  body: string;
}

// ── オーソライザー ──

export interface Authorizer {
  name: string;
  type: "TOKEN" | "REQUEST" | "COGNITO";
  /** トークン検証のシミュレーション */
  validate: (token: string) => { allowed: boolean; principalId: string; context?: Record<string, string> };
}

// ── 使用量プラン ──

export interface UsagePlan {
  name: string;
  /** リクエスト/秒 */
  rateLimit: number;
  /** バーストリミット */
  burstLimit: number;
  /** 月間クォータ */
  quota: number;
}

// ── API キー ──

export interface ApiKey {
  id: string;
  name: string;
  value: string;
  enabled: boolean;
  usagePlanId: string;
}

// ── ステージ ──

export interface Stage {
  name: string;
  variables: Record<string, string>;
  throttling: { rateLimit: number; burstLimit: number };
  logging: boolean;
  caching: boolean;
  cacheTtl: number;
}

// ── API 定義 ──

export interface ApiDefinition {
  name: string;
  type: "REST" | "HTTP";
  resources: Resource[];
  authorizers: Authorizer[];
  stages: Stage[];
  usagePlans: UsagePlan[];
  apiKeys: ApiKey[];
}

// ── リクエスト/レスポンス ──

export interface GwRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  queryString: Record<string, string>;
  body: string | null;
  stage: string;
  sourceIp: string;
}

export interface GwResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

// ── トレース ──

export interface GwTrace {
  phase: "receive" | "route" | "auth" | "validate" | "throttle" | "api_key" |
    "integration_req" | "lambda" | "integration_resp" | "method_resp" |
    "cors" | "cache" | "error" | "mapping";
  detail: string;
  durationMs: number;
}

export interface GwResult {
  request: GwRequest;
  response: GwResponse;
  trace: GwTrace[];
  requestId: string;
  matchedResource: string | null;
  integrationLatency: number;
}

// ── スロットリング状態 ──

interface ThrottleState {
  requestCount: number;
  windowStart: number;
}

// ── エンジン ──

export class ApiGatewayEngine {
  private api: ApiDefinition;
  private throttle = new Map<string, ThrottleState>();
  private cache = new Map<string, { body: string; storedAt: number }>();
  private clock = 0;
  private keyUsage = new Map<string, number>();

  constructor(api: ApiDefinition) {
    this.api = api;
  }

  get definition(): ApiDefinition {
    return this.api;
  }

  /** リクエストを処理する */
  handleRequest(req: GwRequest): GwResult {
    this.clock += 100;
    const trace: GwTrace[] = [];
    const requestId = `req-${Math.random().toString(36).slice(2, 10)}`;

    // 1. リクエスト受信
    trace.push({ phase: "receive", detail: `${req.method} /${req.stage}${req.path} (IP: ${req.sourceIp})`, durationMs: 1 });

    // 2. ステージ確認
    const stage = this.api.stages.find((s) => s.name === req.stage);
    if (stage === undefined) {
      trace.push({ phase: "error", detail: `ステージ "${req.stage}" が存在しない`, durationMs: 0 });
      return this.errorResult(req, 403, '{"message":"Missing Authentication Token"}', trace, requestId);
    }

    // 3. リソースマッチング
    const { resource, method, pathParams } = this.matchResource(req.method, req.path);
    if (resource === null || method === null) {
      trace.push({ phase: "route", detail: `${req.method} ${req.path} に一致するリソースなし`, durationMs: 0 });
      return this.errorResult(req, 404, `{"message":"Resource not found: ${req.path}"}`, trace, requestId);
    }
    trace.push({ phase: "route", detail: `リソース: ${resource.path} → ${method.httpMethod} (${method.integration.type})`, durationMs: 1 });

    // 4. CORS preflight
    if (req.method === "OPTIONS" && method.cors) {
      trace.push({ phase: "cors", detail: "CORS preflight → 200 OK", durationMs: 0 });
      return {
        request: req, requestId, matchedResource: resource.path, integrationLatency: 0, trace,
        response: { statusCode: 200, headers: this.corsHeaders(), body: "" },
      };
    }

    // 5. スロットリング
    const throttleKey = req.sourceIp;
    const ts = this.throttle.get(throttleKey);
    if (ts !== undefined && this.clock - ts.windowStart < 1000 && ts.requestCount >= stage.throttling.burstLimit) {
      trace.push({ phase: "throttle", detail: `バースト上限超過 (${stage.throttling.burstLimit} req/s) → 429`, durationMs: 0 });
      return this.errorResult(req, 429, '{"message":"Too Many Requests"}', trace, requestId);
    }
    if (ts === undefined || this.clock - ts.windowStart >= 1000) {
      this.throttle.set(throttleKey, { requestCount: 1, windowStart: this.clock });
    } else {
      ts.requestCount++;
    }
    trace.push({ phase: "throttle", detail: `スロットリング OK (rate=${stage.throttling.rateLimit}/s, burst=${stage.throttling.burstLimit})`, durationMs: 0 });

    // 6. API キー検証
    if (method.apiKeyRequired) {
      const apiKeyValue = req.headers["x-api-key"];
      if (apiKeyValue === undefined) {
        trace.push({ phase: "api_key", detail: "x-api-key ヘッダなし → 403", durationMs: 0 });
        return this.errorResult(req, 403, '{"message":"Forbidden"}', trace, requestId);
      }
      const key = this.api.apiKeys.find((k) => k.value === apiKeyValue && k.enabled);
      if (key === undefined) {
        trace.push({ phase: "api_key", detail: "無効な API キー → 403", durationMs: 0 });
        return this.errorResult(req, 403, '{"message":"Forbidden"}', trace, requestId);
      }
      // クォータチェック
      const plan = this.api.usagePlans.find((p) => p.name === key.usagePlanId);
      if (plan !== undefined) {
        const used = this.keyUsage.get(key.id) ?? 0;
        if (used >= plan.quota) {
          trace.push({ phase: "api_key", detail: `クォータ超過 (${used}/${plan.quota}) → 429`, durationMs: 0 });
          return this.errorResult(req, 429, '{"message":"Limit Exceeded"}', trace, requestId);
        }
        this.keyUsage.set(key.id, used + 1);
      }
      trace.push({ phase: "api_key", detail: `API キー "${key.name}" 検証 OK`, durationMs: 1 });
    }

    // 7. オーソライザー
    if (method.authorizationType !== "NONE" && method.authorizationType !== "API_KEY") {
      const authResult = this.runAuthorizer(req, method.authorizationType, trace);
      if (!authResult.allowed) {
        return this.errorResult(req, 401, '{"message":"Unauthorized"}', trace, requestId);
      }
    }

    // 8. リクエストバリデーション
    if (method.requestValidator !== undefined) {
      trace.push({ phase: "validate", detail: `リクエストバリデーション: ${method.requestValidator}`, durationMs: 1 });
      if (method.requestValidator.includes("BODY") && req.body !== null) {
        try { JSON.parse(req.body); } catch {
          trace.push({ phase: "validate", detail: "JSON パースエラー → 400", durationMs: 0 });
          return this.errorResult(req, 400, '{"message":"Invalid request body"}', trace, requestId);
        }
      }
    }

    // 9. キャッシュ確認
    if (stage.caching && req.method === "GET") {
      const cacheKey = `${req.path}?${JSON.stringify(req.queryString)}`;
      const cached = this.cache.get(cacheKey);
      if (cached !== undefined && this.clock - cached.storedAt < stage.cacheTtl * 1000) {
        trace.push({ phase: "cache", detail: `キャッシュヒット (TTL=${stage.cacheTtl}s)`, durationMs: 1 });
        return {
          request: req, requestId, matchedResource: resource.path, integrationLatency: 0, trace,
          response: { statusCode: 200, headers: { "x-cache": "Hit" }, body: cached.body },
        };
      }
    }

    // 10. 統合リクエスト
    const integ = method.integration;
    trace.push({ phase: "integration_req", detail: `統合タイプ: ${integ.type}${integ.lambdaFunction ? ` → ${integ.lambdaFunction}` : ""}${integ.uri ? ` → ${integ.uri}` : ""}`, durationMs: 1 });

    if (integ.requestTemplate !== undefined) {
      trace.push({ phase: "mapping", detail: `リクエストマッピングテンプレート適用`, durationMs: 1 });
    }

    let integResponse: { statusCode: number; headers: Record<string, string>; body: string };
    let integLatency: number;

    switch (integ.type) {
      case "AWS_PROXY": {
        const event: LambdaProxyEvent = {
          httpMethod: req.method, path: req.path,
          pathParameters: pathParams,
          queryStringParameters: Object.keys(req.queryString).length > 0 ? req.queryString : null,
          headers: req.headers, body: req.body,
          requestContext: { stage: req.stage, requestId, identity: { sourceIp: req.sourceIp, apiKey: req.headers["x-api-key"] } },
        };
        const lambdaResp = integ.lambdaHandler?.(event) ?? { statusCode: 200, body: '{"message":"OK"}' };
        integLatency = 15 + Math.floor(Math.random() * 20);

        if (integLatency > integ.timeoutMs) {
          trace.push({ phase: "lambda", detail: `Lambda タイムアウト (${integ.timeoutMs}ms)`, durationMs: integ.timeoutMs });
          return this.errorResult(req, 504, '{"message":"Endpoint request timed out"}', trace, requestId);
        }

        trace.push({ phase: "lambda", detail: `Lambda 実行: ${integ.lambdaFunction} → ${lambdaResp.statusCode} (${integLatency}ms)`, durationMs: integLatency });
        integResponse = { statusCode: lambdaResp.statusCode, headers: lambdaResp.headers ?? {}, body: lambdaResp.body };
        break;
      }
      case "MOCK":
        integLatency = 1;
        trace.push({ phase: "integration_req", detail: `Mock レスポンス: ${integ.mockStatusCode}`, durationMs: integLatency });
        integResponse = { statusCode: integ.mockStatusCode ?? 200, headers: {}, body: integ.mockBody ?? "" };
        break;

      case "HTTP_PROXY":
      case "HTTP":
        integLatency = 30 + Math.floor(Math.random() * 50);
        trace.push({ phase: "integration_req", detail: `HTTP プロキシ → ${integ.uri} (${integLatency}ms)`, durationMs: integLatency });
        integResponse = { statusCode: 200, headers: {}, body: JSON.stringify({ upstream: integ.uri, path: req.path }) };
        break;

      default:
        integLatency = 10;
        integResponse = { statusCode: 200, headers: {}, body: '{"ok":true}' };
    }

    // 11. 統合レスポンス
    trace.push({ phase: "integration_resp", detail: `統合レスポンス: ${integResponse.statusCode}`, durationMs: 1 });
    if (integ.responseTemplate !== undefined) {
      trace.push({ phase: "mapping", detail: "レスポンスマッピングテンプレート適用", durationMs: 1 });
    }

    // 12. キャッシュ保存
    if (stage.caching && req.method === "GET" && integResponse.statusCode === 200) {
      const cacheKey = `${req.path}?${JSON.stringify(req.queryString)}`;
      this.cache.set(cacheKey, { body: integResponse.body, storedAt: this.clock });
      trace.push({ phase: "cache", detail: `キャッシュ保存 (TTL=${stage.cacheTtl}s)`, durationMs: 0 });
    }

    // 13. CORS ヘッダ
    const respHeaders: Record<string, string> = { ...integResponse.headers, "x-amzn-requestid": requestId };
    if (method.cors) {
      Object.assign(respHeaders, this.corsHeaders());
      trace.push({ phase: "cors", detail: "CORS ヘッダ付与", durationMs: 0 });
    }

    // 14. メソッドレスポンス
    trace.push({ phase: "method_resp", detail: `${integResponse.statusCode} → クライアント (total: ${integLatency + 5}ms)`, durationMs: 2 });

    return {
      request: req, requestId, matchedResource: resource.path, integrationLatency: integLatency, trace,
      response: { statusCode: integResponse.statusCode, headers: respHeaders, body: integResponse.body },
    };
  }

  // ── ヘルパー ──

  private matchResource(method: string, path: string): { resource: Resource | null; method: MethodConfig | null; pathParams: Record<string, string> | null } {
    for (const res of this.api.resources) {
      const params = this.matchPath(res.path, path);
      if (params !== null) {
        const m = res.methods.find((m) => m.httpMethod === method || m.httpMethod === "ANY");
        if (m !== undefined) return { resource: res, method: m, pathParams: Object.keys(params).length > 0 ? params : null };
      }
    }
    return { resource: null, method: null, pathParams: null };
  }

  private matchPath(pattern: string, actual: string): Record<string, string> | null {
    const patParts = pattern.split("/").filter(Boolean);
    const actParts = actual.split("/").filter(Boolean);
    if (patParts.length !== actParts.length) {
      // {proxy+} チェック
      const lastPat = patParts[patParts.length - 1];
      if (lastPat === "{proxy+}" && actParts.length >= patParts.length - 1) {
        const params: Record<string, string> = {};
        for (let i = 0; i < patParts.length - 1; i++) {
          const pp = patParts[i]!;
          if (pp.startsWith("{") && pp.endsWith("}")) params[pp.slice(1, -1)] = actParts[i]!;
          else if (pp !== actParts[i]) return null;
        }
        params["proxy"] = actParts.slice(patParts.length - 1).join("/");
        return params;
      }
      return null;
    }
    const params: Record<string, string> = {};
    for (let i = 0; i < patParts.length; i++) {
      const pp = patParts[i]!;
      if (pp.startsWith("{") && pp.endsWith("}")) params[pp.slice(1, -1)] = actParts[i]!;
      else if (pp !== actParts[i]) return null;
    }
    return params;
  }

  private runAuthorizer(req: GwRequest, type: MethodConfig["authorizationType"], trace: GwTrace[]): { allowed: boolean } {
    const token = req.headers["authorization"] ?? "";
    const authorizer = this.api.authorizers[0];
    if (authorizer === undefined) {
      trace.push({ phase: "auth", detail: "オーソライザー未設定 → 許可", durationMs: 0 });
      return { allowed: true };
    }
    const result = authorizer.validate(token);
    trace.push({ phase: "auth", detail: `${authorizer.name} (${type}): ${result.allowed ? "許可" : "拒否"} (principal=${result.principalId})`, durationMs: 5 });
    return result;
  }

  private corsHeaders(): Record<string, string> {
    return {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
      "access-control-allow-headers": "Content-Type,Authorization,X-Api-Key",
    };
  }

  private errorResult(req: GwRequest, status: number, body: string, trace: GwTrace[], requestId: string): GwResult {
    trace.push({ phase: "error", detail: `${status} エラーレスポンス`, durationMs: 0 });
    return {
      request: req, requestId, matchedResource: null, integrationLatency: 0, trace,
      response: { statusCode: status, headers: { "x-amzn-requestid": requestId }, body },
    };
  }
}
