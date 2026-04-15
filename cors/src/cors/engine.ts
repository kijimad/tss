/*
 * CORS シミュレーションエンジン
 *
 * ブラウザのCORS処理フローを忠実にエミュレートする。
 * 実際のネットワーク通信は行わず、リクエスト定義とサーバー設定から
 * ブラウザの動作（分類→プリフライト→CORSチェック）をシミュレートする。
 *
 * 処理の全体フロー:
 *   1. リクエスト分類 (classifyRequest)
 *      → 同一オリジン / 単純リクエスト / プリフライト必要 / no-cors を判定
 *   2. プリフライト処理（必要な場合のみ）
 *      → OPTIONSリクエストの送信＆レスポンス検証をエミュレート
 *      → キャッシュの確認・保存も行う
 *   3. 実リクエスト送信＆CORSヘッダ検証
 *      → Access-Control-Allow-Origin 等のヘッダをチェック
 *   4. 最終判定 (CorsVerdict)
 *      → allowed / blocked_* / same_origin / opaque
 */

import type {
  CorsRequest, CorsServerConfig, CorsResponseHeaders,
  HttpMethod, RequestClassification,
  PreflightCacheEntry, SimStep, SimEvent,
  RequestResult, SimulationResult, SimOp,
} from "./types.js";
import { SIMPLE_METHODS, SIMPLE_HEADERS, SIMPLE_CONTENT_TYPES } from "./types.js";

// ─── オリジンユーティリティ ───

/**
 * URLからオリジン部分（プロトコル + ホスト + ポート）を抽出する。
 * 例: "https://example.com:8080/api/data?q=1" → "https://example.com:8080"
 * 同一オリジンポリシーの判定に使用。
 */
export function extractOrigin(url: string): string {
  const m = url.match(/^(https?:\/\/[^/]+)/);
  return m ? m[1]! : url;
}

/**
 * 同一オリジン判定
 * リクエスト元のオリジンとリクエスト先URLのオリジンが一致するか確認する。
 * 一致する場合、CORSチェックは不要（ブラウザはそのままリクエストを通す）。
 */
export function isSameOrigin(origin: string, url: string): boolean {
  return extractOrigin(url) === origin;
}

// ─── リクエスト分類 ───
// ブラウザはリクエストの内容に基づいて、プリフライトの要否を自動的に判定する。
// 「単純リクエスト」の条件をすべて満たせばプリフライト不要、1つでも外れればプリフライトが必要。

/**
 * 指定されたヘッダが「単純ヘッダ」（CORS-safelisted request header）かどうか判定する。
 * 単純ヘッダの条件:
 *   - ヘッダ名が accept, accept-language, content-language, content-type のいずれか
 *   - content-type の場合、値が application/x-www-form-urlencoded, multipart/form-data,
 *     text/plain のいずれか（application/json は非単純！）
 */
function isSimpleHeader(name: string, value?: string): boolean {
  const lower = name.toLowerCase();
  if (!SIMPLE_HEADERS.includes(lower)) return false;
  // Content-Typeの場合、値も単純値であることが必要
  if (lower === "content-type" && value) {
    return SIMPLE_CONTENT_TYPES.includes(value.toLowerCase().split(";")[0]!.trim());
  }
  return true;
}

/**
 * リクエストを分類する（ブラウザの分類ロジックをエミュレート）
 *
 * 判定の優先順位:
 *   1. 同一オリジン → CORSチェック不要
 *   2. mode: "no-cors" → 不透明レスポンスとして処理
 *   3. 非単純メソッド or 非単純ヘッダ → プリフライト必要
 *   4. 上記以外 → 単純リクエスト（プリフライト不要）
 */
export function classifyRequest(req: CorsRequest): RequestClassification {
  // 同一オリジンであればCORSの対象外
  if (isSameOrigin(req.origin, req.url)) return "same_origin";

  // no-corsモードでは不透明レスポンスが返る（JSからアクセス不可）
  if (req.mode === "no-cors") return "no_cors";

  // 非単純メソッド（PUT, DELETE等）はプリフライト必要
  if (!SIMPLE_METHODS.includes(req.method)) return "preflight_cors";

  // 非単純ヘッダが1つでもあればプリフライト必要
  for (const [name, value] of Object.entries(req.headers)) {
    if (!isSimpleHeader(name, value)) return "preflight_cors";
  }

  // すべて単純条件を満たす → プリフライト不要
  return "simple_cors";
}

/**
 * リクエストヘッダから非単純ヘッダを抽出する。
 * プリフライトの Access-Control-Request-Headers ヘッダに設定される値となる。
 */
function getNonSimpleHeaders(headers: Record<string, string>): string[] {
  return Object.keys(headers).filter(name => {
    const value = headers[name];
    return !isSimpleHeader(name, value);
  });
}

// ─── サーバーレスポンス生成 ───

/** サーバーCORS設定からレスポンスヘッダを生成 */
function buildCorsResponse(
  config: CorsServerConfig, requestOrigin: string,
): CorsResponseHeaders {
  const headers: CorsResponseHeaders = {};

  // Access-Control-Allow-Origin
  if (config.allowOrigins === "*") {
    if (config.allowCredentials) {
      // クレデンシャル時は "*" 不可、具体的なオリジンを返す
      headers["access-control-allow-origin"] = requestOrigin;
    } else {
      headers["access-control-allow-origin"] = "*";
    }
  } else {
    if (config.allowOrigins.includes(requestOrigin)) {
      headers["access-control-allow-origin"] = requestOrigin;
    }
    // マッチしなければヘッダなし
  }

  // Vary
  if (config.varyOrigin || config.allowOrigins !== "*") {
    headers["vary"] = "Origin";
  }

  // Allow-Credentials
  if (config.allowCredentials) {
    headers["access-control-allow-credentials"] = "true";
  }

  // Expose-Headers
  if (config.exposeHeaders.length > 0) {
    headers["access-control-expose-headers"] = config.exposeHeaders.join(", ");
  }

  return headers;
}

/** プリフライトレスポンスヘッダ生成 */
function buildPreflightResponse(
  config: CorsServerConfig, requestOrigin: string,
  _requestMethod: HttpMethod, _requestHeaders: string[],
): CorsResponseHeaders {
  const headers = buildCorsResponse(config, requestOrigin);

  // Allow-Methods
  headers["access-control-allow-methods"] = config.allowMethods.join(", ");

  // Allow-Headers
  if (config.allowHeaders.length > 0) {
    headers["access-control-allow-headers"] = config.allowHeaders.join(", ");
  }

  // Max-Age
  if (config.maxAge > 0) {
    headers["access-control-max-age"] = String(config.maxAge);
  }

  return headers;
}

// ─── CORSチェック ───

/** オリジンチェック */
function checkOrigin(
  config: CorsServerConfig, origin: string,
): { pass: boolean; reason: string } {
  if (config.allowOrigins === "*") {
    return { pass: true, reason: "Access-Control-Allow-Origin: * （全オリジン許可）" };
  }
  if (config.allowOrigins.includes(origin)) {
    return { pass: true, reason: `Access-Control-Allow-Origin: ${origin} （許可リストに一致）` };
  }
  return {
    pass: false,
    reason: `オリジン ${origin} は許可リスト [${config.allowOrigins.join(", ")}] に含まれない`,
  };
}

/** メソッドチェック */
function checkMethod(
  config: CorsServerConfig, method: HttpMethod,
): { pass: boolean; reason: string } {
  if (config.allowMethods.includes(method)) {
    return { pass: true, reason: `${method} は許可メソッド [${config.allowMethods.join(", ")}] に含まれる` };
  }
  return {
    pass: false,
    reason: `${method} は許可メソッド [${config.allowMethods.join(", ")}] に含まれない`,
  };
}

/** ヘッダチェック */
function checkHeaders(
  config: CorsServerConfig, requestHeaders: string[],
): { pass: boolean; reason: string; blockedHeader?: string } {
  const allowedLower = config.allowHeaders.map(h => h.toLowerCase());
  // ワイルドカード
  if (allowedLower.includes("*")) {
    return { pass: true, reason: "Access-Control-Allow-Headers: * （全ヘッダ許可）" };
  }

  for (const h of requestHeaders) {
    if (!allowedLower.includes(h.toLowerCase())) {
      return {
        pass: false,
        reason: `ヘッダ "${h}" は許可ヘッダ [${config.allowHeaders.join(", ")}] に含まれない`,
        blockedHeader: h,
      };
    }
  }
  return { pass: true, reason: `リクエストヘッダ [${requestHeaders.join(", ")}] はすべて許可` };
}

/** クレデンシャルチェック */
function checkCredentials(
  config: CorsServerConfig, credentials: boolean, allowOrigin: string | undefined,
): { pass: boolean; reason: string } {
  if (!credentials) return { pass: true, reason: "クレデンシャルなし" };

  if (!config.allowCredentials) {
    return {
      pass: false,
      reason: "credentials: true だが Access-Control-Allow-Credentials: true がない",
    };
  }

  if (allowOrigin === "*") {
    return {
      pass: false,
      reason: "credentials: true のとき Access-Control-Allow-Origin: * は不可（具体的オリジンが必要）",
    };
  }

  return { pass: true, reason: "Access-Control-Allow-Credentials: true かつ具体的オリジン" };
}

// ─── リクエスト処理 ───

/** 単一リクエストをシミュレート */
export function processRequest(
  req: CorsRequest,
  config: CorsServerConfig,
  preflightCache: PreflightCacheEntry[],
  currentTime: number,
): RequestResult {
  const steps: SimStep[] = [];
  const events: SimEvent[] = [];

  // ─── Step 1: リクエスト分類 ───
  const classification = classifyRequest(req);
  steps.push({
    phase: "classify",
    message: `リクエスト分類: ${classificationLabel(classification)}`,
    detail: classificationDetail(req, classification),
    success: true,
  });
  events.push({
    type: "classify",
    message: `${req.method} ${req.url} → ${classificationLabel(classification)}`,
    detail: `Origin: ${req.origin}, Mode: ${req.mode}`,
  });

  // ─── 同一オリジン ───
  if (classification === "same_origin") {
    steps.push({
      phase: "result",
      message: "同一オリジン → CORSチェック不要",
      verdict: "same_origin",
      success: true,
    });
    events.push({ type: "same_origin", message: "同一オリジンリクエスト → 許可" });
    return {
      request: req, serverConfig: config, classification,
      steps, events, verdict: "same_origin",
      preflightCached: false,
    };
  }

  // ─── no-cors ───
  if (classification === "no_cors") {
    steps.push({
      phase: "result",
      message: "no-corsモード → 不透明レスポンス（JSからアクセス不可）",
      verdict: "opaque",
      success: true,
    });
    events.push({ type: "no_cors", message: "no-corsモード → 不透明レスポンス" });
    return {
      request: req, serverConfig: config, classification,
      steps, events, verdict: "opaque",
      preflightCached: false,
    };
  }

  let preflightCached = false;
  let preflightResponse: CorsResponseHeaders | undefined;

  // ─── プリフライト ───
  if (classification === "preflight_cors") {
    const nonSimpleHeaders = getNonSimpleHeaders(req.headers);

    // キャッシュ確認
    const cached = preflightCache.find(
      c => c.origin === req.origin && c.url === extractOrigin(req.url) && c.expiresAt > currentTime,
    );

    if (cached) {
      preflightCached = true;
      steps.push({
        phase: "preflight_send",
        message: "プリフライトキャッシュヒット → OPTIONSリクエスト省略",
        success: true,
      });
      events.push({ type: "cache_hit", message: `プリフライトキャッシュヒット (残り${Math.round((cached.expiresAt - currentTime) / 1000)}秒)` });
    } else {
      // プリフライトリクエスト送信
      const preflightHeaders: Record<string, string> = {
        "Origin": req.origin,
        "Access-Control-Request-Method": req.method,
      };
      if (nonSimpleHeaders.length > 0) {
        preflightHeaders["Access-Control-Request-Headers"] = nonSimpleHeaders.join(", ");
      }

      steps.push({
        phase: "preflight_send",
        message: `OPTIONS ${req.url} プリフライトリクエスト送信`,
        headers: preflightHeaders,
        success: true,
      });

      // プリフライトレスポンス生成
      preflightResponse = buildPreflightResponse(config, req.origin, req.method, nonSimpleHeaders);

      steps.push({
        phase: "preflight_check",
        message: "プリフライトレスポンス受信",
        headers: Object.fromEntries(
          Object.entries(preflightResponse).filter((e): e is [string, string] => e[1] !== undefined)
        ),
        success: true,
      });

      // オリジンチェック
      const originCheck = checkOrigin(config, req.origin);
      if (!originCheck.pass) {
        steps.push({
          phase: "preflight_check",
          message: `オリジンチェック失敗: ${originCheck.reason}`,
          verdict: "blocked_origin",
          success: false,
        });
        events.push({ type: "preflight_fail", message: originCheck.reason });
        return {
          request: req, serverConfig: config, classification,
          steps, events, verdict: "blocked_origin",
          preflightResponse, preflightCached: false,
        };
      }

      // メソッドチェック
      const methodCheck = checkMethod(config, req.method);
      if (!methodCheck.pass) {
        steps.push({
          phase: "preflight_check",
          message: `メソッドチェック失敗: ${methodCheck.reason}`,
          verdict: "blocked_method",
          success: false,
        });
        events.push({ type: "preflight_fail", message: methodCheck.reason });
        return {
          request: req, serverConfig: config, classification,
          steps, events, verdict: "blocked_method",
          preflightResponse, preflightCached: false,
        };
      }

      // ヘッダチェック
      if (nonSimpleHeaders.length > 0) {
        const headerCheck = checkHeaders(config, nonSimpleHeaders);
        if (!headerCheck.pass) {
          steps.push({
            phase: "preflight_check",
            message: `ヘッダチェック失敗: ${headerCheck.reason}`,
            verdict: "blocked_header",
            success: false,
          });
          events.push({ type: "preflight_fail", message: headerCheck.reason });
          return {
            request: req, serverConfig: config, classification,
            steps, events, verdict: "blocked_header",
            preflightResponse, preflightCached: false,
          };
        }
      }

      // クレデンシャルチェック
      const credCheck = checkCredentials(config, req.credentials, preflightResponse["access-control-allow-origin"]);
      if (!credCheck.pass) {
        steps.push({
          phase: "preflight_check",
          message: `クレデンシャルチェック失敗: ${credCheck.reason}`,
          verdict: "blocked_credentials",
          success: false,
        });
        events.push({ type: "credential_error", message: credCheck.reason });
        return {
          request: req, serverConfig: config, classification,
          steps, events, verdict: "blocked_credentials",
          preflightResponse, preflightCached: false,
        };
      }

      steps.push({
        phase: "preflight_check",
        message: "プリフライトチェック通過",
        success: true,
      });
      events.push({ type: "preflight_pass", message: "プリフライト成功 → 実リクエスト送信へ" });

      // キャッシュ保存
      if (config.maxAge > 0) {
        preflightCache.push({
          origin: req.origin,
          url: extractOrigin(req.url),
          methods: config.allowMethods,
          headers: config.allowHeaders,
          expiresAt: currentTime + config.maxAge * 1000,
        });
        events.push({
          type: "cache_miss",
          message: `プリフライト結果をキャッシュ (Max-Age=${config.maxAge}秒)`,
        });
      }
    }
  }

  // ─── 実リクエスト送信 ───
  const requestHeaders: Record<string, string> = {
    ...req.headers,
    "Origin": req.origin,
  };

  steps.push({
    phase: "actual_send",
    message: `${req.method} ${req.url} 実リクエスト送信`,
    headers: requestHeaders,
    success: true,
  });

  // 実レスポンスのCORSヘッダ
  const actualResponse = buildCorsResponse(config, req.origin);

  steps.push({
    phase: "cors_check",
    message: "CORSレスポンスヘッダ検証",
    headers: Object.fromEntries(
      Object.entries(actualResponse).filter((e): e is [string, string] => e[1] !== undefined)
    ),
    success: true,
  });

  // ─── CORSチェック（実レスポンス） ───

  // オリジンチェック
  const acao = actualResponse["access-control-allow-origin"];
  if (!acao) {
    steps.push({
      phase: "cors_check",
      message: "Access-Control-Allow-Origin ヘッダなし → ブロック",
      verdict: "no_cors_header",
      success: false,
    });
    events.push({ type: "cors_fail", message: "CORSヘッダなし → ブラウザがレスポンスをブロック" });
    return {
      request: req, serverConfig: config, classification,
      steps, events, verdict: "no_cors_header",
      preflightResponse, actualResponse, preflightCached,
    };
  }

  if (acao !== "*" && acao !== req.origin) {
    steps.push({
      phase: "cors_check",
      message: `オリジン不一致: ${acao} ≠ ${req.origin}`,
      verdict: "blocked_origin",
      success: false,
    });
    events.push({ type: "cors_fail", message: `オリジン不一致 → ブロック` });
    return {
      request: req, serverConfig: config, classification,
      steps, events, verdict: "blocked_origin",
      preflightResponse, actualResponse, preflightCached,
    };
  }

  // クレデンシャルチェック（実レスポンス）
  const credCheck2 = checkCredentials(config, req.credentials, acao);
  if (!credCheck2.pass) {
    steps.push({
      phase: "cors_check",
      message: `クレデンシャルエラー: ${credCheck2.reason}`,
      verdict: "blocked_credentials",
      success: false,
    });
    events.push({ type: "credential_error", message: credCheck2.reason });
    return {
      request: req, serverConfig: config, classification,
      steps, events, verdict: "blocked_credentials",
      preflightResponse, actualResponse, preflightCached,
    };
  }

  // 成功
  steps.push({
    phase: "result",
    message: "CORSチェック通過 → レスポンスをJSに公開",
    verdict: "allowed",
    success: true,
    detail: actualResponse["access-control-expose-headers"]
      ? `公開ヘッダ: ${actualResponse["access-control-expose-headers"]}`
      : undefined,
  });
  events.push({
    type: "cors_pass",
    message: `CORS許可: ${req.method} ${req.url}`,
    detail: `ACAO: ${acao}`,
  });

  return {
    request: req, serverConfig: config, classification,
    steps, events, verdict: "allowed",
    preflightResponse, actualResponse, preflightCached,
  };
}

// ─── ラベル ───

function classificationLabel(c: RequestClassification): string {
  switch (c) {
    case "same_origin": return "同一オリジン";
    case "simple_cors": return "単純リクエスト (プリフライト不要)";
    case "preflight_cors": return "プリフライト必要";
    case "no_cors": return "no-corsモード";
  }
}

function classificationDetail(req: CorsRequest, c: RequestClassification): string {
  if (c === "same_origin") return `${req.origin} === ${extractOrigin(req.url)}`;
  if (c === "no_cors") return "mode: 'no-cors'";

  const reasons: string[] = [];
  if (!SIMPLE_METHODS.includes(req.method)) {
    reasons.push(`非単純メソッド: ${req.method}`);
  }
  for (const [name, value] of Object.entries(req.headers)) {
    if (!isSimpleHeader(name, value)) {
      reasons.push(`非単純ヘッダ: ${name}`);
    }
  }
  if (reasons.length === 0) reasons.push("単純リクエスト条件を満たす");
  return reasons.join(", ");
}

// ─── リクエスト・サーバー設定ヘルパー ───

/** リクエスト生成 */
export function mkRequest(
  origin: string, url: string, method: HttpMethod = "GET",
  opts?: Partial<CorsRequest>,
): CorsRequest {
  return {
    origin, url, method,
    headers: {},
    credentials: false,
    mode: "cors",
    ...opts,
  };
}

/** サーバー設定生成 */
export function mkServerConfig(opts?: Partial<CorsServerConfig>): CorsServerConfig {
  return {
    allowOrigins: "*",
    allowMethods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    exposeHeaders: [],
    allowCredentials: false,
    maxAge: 0,
    varyOrigin: true,
    ...opts,
  };
}

// ─── メインシミュレーション ───

/** シミュレーション実行 */
export function simulate(ops: SimOp[]): SimulationResult {
  const results: RequestResult[] = [];
  const preflightCache: PreflightCacheEntry[] = [];
  const allEvents: SimEvent[] = [];
  const currentTime = Date.now();

  for (const op of ops) {
    const result = processRequest(op.request, op.serverConfig, preflightCache, currentTime);
    results.push(result);
    allEvents.push(...result.events);
  }

  return { results, preflightCache, events: allEvents };
}
