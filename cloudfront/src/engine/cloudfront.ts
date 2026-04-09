/**
 * cloudfront.ts — Amazon CloudFront CDN シミュレーション
 *
 * エッジロケーション → キャッシュ判定 → オリジンフェッチ →
 * TTL 管理 → キャッシュビヘイビア → Lambda@Edge
 */

// ── エッジロケーション ──

export interface EdgeLocation {
  code: string;
  city: string;
  region: string;
  /** オリジンまでの RTT (ms) */
  originRttMs: number;
}

export const EDGE_LOCATIONS: EdgeLocation[] = [
  { code: "NRT", city: "東京", region: "ap-northeast-1", originRttMs: 5 },
  { code: "KIX", city: "大阪", region: "ap-northeast-1", originRttMs: 8 },
  { code: "ICN", city: "ソウル", region: "ap-northeast-2", originRttMs: 30 },
  { code: "SIN", city: "シンガポール", region: "ap-southeast-1", originRttMs: 70 },
  { code: "IAD", city: "バージニア", region: "us-east-1", originRttMs: 150 },
  { code: "SFO", city: "サンフランシスコ", region: "us-west-1", originRttMs: 170 },
  { code: "FRA", city: "フランクフルト", region: "eu-central-1", originRttMs: 200 },
  { code: "LHR", city: "ロンドン", region: "eu-west-2", originRttMs: 220 },
];

// ── オリジン ──

export interface Origin {
  id: string;
  type: "S3" | "ALB" | "Custom";
  domain: string;
  /** レスポンス生成時間 (ms) */
  responseTimeMs: number;
  /** 利用可能か */
  healthy: boolean;
}

// ── キャッシュビヘイビア ──

export interface CacheBehavior {
  pathPattern: string;
  /** デフォルト TTL (秒) */
  defaultTtl: number;
  /** 最大 TTL (秒) */
  maxTtl: number;
  /** 最小 TTL (秒) */
  minTtl: number;
  /** キャッシュキーに含めるヘッダ */
  forwardHeaders: string[];
  /** クエリ文字列をキャッシュキーに含めるか */
  forwardQueryString: boolean;
  /** 圧縮 */
  compress: boolean;
  /** ビューワープロトコルポリシー */
  viewerProtocolPolicy: "allow-all" | "redirect-to-https" | "https-only";
  /** Lambda@Edge 関数 */
  lambdaEdge?: LambdaEdgeConfig[];
  /** オリジン ID */
  originId: string;
}

// ── Lambda@Edge ──

export interface LambdaEdgeConfig {
  eventType: "viewer-request" | "origin-request" | "origin-response" | "viewer-response";
  functionName: string;
  /** シミュレーション用の関数 */
  handler: (req: CfRequest) => CfRequest | CfResponse | null;
}

// ── リクエスト / レスポンス ──

export interface CfRequest {
  method: string;
  uri: string;
  queryString: string;
  headers: Record<string, string>;
  clientIp: string;
  edgeLocation: string;
}

export interface CfResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  /** キャッシュから返したか */
  xCache: "Hit from cloudfront" | "Miss from cloudfront" | "Error from cloudfront";
  /** レスポンス時間 (ms) */
  timingMs: number;
  /** エッジ POP */
  xAmzCfPop: string;
}

// ── キャッシュエントリ ──

interface CacheEntry {
  key: string;
  response: CfResponse;
  storedAt: number;
  ttl: number;
  hitCount: number;
}

// ── トレース ──

export interface CfTrace {
  phase: "dns" | "edge_select" | "viewer_request" | "cache_lookup" | "origin_request" |
    "origin_fetch" | "origin_response" | "cache_store" | "viewer_response" |
    "lambda_edge" | "redirect" | "error" | "invalidation" | "compress" | "stats";
  detail: string;
  durationMs: number;
}

// ── ディストリビューション設定 ──

export interface Distribution {
  id: string;
  domain: string;
  origins: Origin[];
  behaviors: CacheBehavior[];
  defaultRootObject: string;
  priceClass: "PriceClass_100" | "PriceClass_200" | "PriceClass_All";
  /** カスタムエラーレスポンス */
  customErrorResponses: { errorCode: number; responsePagePath: string; ttl: number }[];
}

// ── シミュレーション結果 ──

export interface CfResult {
  request: CfRequest;
  response: CfResponse;
  trace: CfTrace[];
  behavior: string;
  cacheKey: string;
}

// ── CDN エンジン ──

export class CloudFrontEngine {
  private dist: Distribution;
  private caches = new Map<string, Map<string, CacheEntry>>(); // edge → cache
  private clock = 0;
  private totalRequests = 0;
  private cacheHits = 0;

  constructor(dist: Distribution) {
    this.dist = dist;
    for (const edge of EDGE_LOCATIONS) {
      this.caches.set(edge.code, new Map());
    }
  }

  get stats() {
    return {
      totalRequests: this.totalRequests,
      cacheHits: this.cacheHits,
      hitRatio: this.totalRequests > 0 ? (this.cacheHits / this.totalRequests * 100).toFixed(1) + "%" : "0%",
      edgeCacheSizes: [...this.caches.entries()].map(([code, cache]) => ({ code, size: cache.size })),
    };
  }

  /** リクエストを処理する */
  handleRequest(req: CfRequest): CfResult {
    this.clock += 100;
    this.totalRequests++;
    const trace: CfTrace[] = [];

    // 1. DNS 解決 → エッジロケーション選択
    const edge = EDGE_LOCATIONS.find((e) => e.code === req.edgeLocation) ?? EDGE_LOCATIONS[0]!;
    trace.push({ phase: "dns", detail: `${this.dist.domain} → エッジ ${edge.code} (${edge.city})`, durationMs: 5 });
    trace.push({ phase: "edge_select", detail: `POP: ${edge.code}, オリジンRTT: ${edge.originRttMs}ms`, durationMs: 0 });

    // 2. キャッシュビヘイビアのマッチング
    let uri = req.uri === "/" ? `/${this.dist.defaultRootObject}` : req.uri;
    const behavior = this.matchBehavior(uri);
    const behaviorLabel = behavior.pathPattern;

    // 3. ビューワープロトコルポリシー
    if (behavior.viewerProtocolPolicy === "redirect-to-https" && req.headers["x-forwarded-proto"] === "http") {
      trace.push({ phase: "redirect", detail: "HTTP → HTTPS リダイレクト (301)", durationMs: 1 });
      const resp: CfResponse = {
        status: 301, statusText: "Moved Permanently",
        headers: { location: `https://${this.dist.domain}${req.uri}` },
        body: "", xCache: "Miss from cloudfront", timingMs: 1, xAmzCfPop: edge.code,
      };
      return { request: req, response: resp, trace, behavior: behaviorLabel, cacheKey: "" };
    }

    // 4. Lambda@Edge: viewer-request
    const vrLambda = behavior.lambdaEdge?.find((l) => l.eventType === "viewer-request");
    if (vrLambda !== undefined) {
      trace.push({ phase: "lambda_edge", detail: `viewer-request: ${vrLambda.functionName}`, durationMs: 5 });
      const result = vrLambda.handler(req);
      if (result !== null && "status" in result) {
        return { request: req, response: { ...result, xAmzCfPop: edge.code }, trace, behavior: behaviorLabel, cacheKey: "" };
      }
      if (result !== null && "uri" in result) {
        uri = result.uri;
        trace.push({ phase: "lambda_edge", detail: `URI 書き換え: ${req.uri} → ${uri}`, durationMs: 0 });
      }
    }

    // 5. キャッシュキー生成
    const cacheKey = this.buildCacheKey(uri, req, behavior);
    trace.push({ phase: "cache_lookup", detail: `キャッシュキー: ${cacheKey}`, durationMs: 0 });

    // 6. キャッシュルックアップ
    const edgeCache = this.caches.get(edge.code)!;
    const cached = edgeCache.get(cacheKey);
    if (cached !== undefined) {
      const age = this.clock - cached.storedAt;
      if (age < cached.ttl * 1000) {
        cached.hitCount++;
        this.cacheHits++;
        trace.push({ phase: "cache_lookup", detail: `\u2714 キャッシュヒット! (age=${(age / 1000).toFixed(0)}s / TTL=${cached.ttl}s, hits=${cached.hitCount})`, durationMs: 1 });

        // Lambda@Edge: viewer-response
        const vlrLambda = behavior.lambdaEdge?.find((l) => l.eventType === "viewer-response");
        if (vlrLambda !== undefined) {
          trace.push({ phase: "lambda_edge", detail: `viewer-response: ${vlrLambda.functionName}`, durationMs: 3 });
        }

        const resp = { ...cached.response, xCache: "Hit from cloudfront" as const, timingMs: 2, xAmzCfPop: edge.code,
          headers: { ...cached.response.headers, "x-cache": "Hit from cloudfront", "age": String(Math.floor(age / 1000)) } };
        trace.push({ phase: "viewer_response", detail: `200 OK (Cache Hit, ${resp.timingMs}ms)`, durationMs: resp.timingMs });

        return { request: req, response: resp, trace, behavior: behaviorLabel, cacheKey };
      }
      edgeCache.delete(cacheKey);
      trace.push({ phase: "cache_lookup", detail: `キャッシュ期限切れ (age=${(age / 1000).toFixed(0)}s > TTL=${cached.ttl}s) → オリジンへ`, durationMs: 1 });
    } else {
      trace.push({ phase: "cache_lookup", detail: "キャッシュミス → オリジンフェッチ", durationMs: 1 });
    }

    // 7. Lambda@Edge: origin-request
    const orLambda = behavior.lambdaEdge?.find((l) => l.eventType === "origin-request");
    if (orLambda !== undefined) {
      trace.push({ phase: "lambda_edge", detail: `origin-request: ${orLambda.functionName}`, durationMs: 3 });
    }

    // 8. オリジンフェッチ
    const origin = this.dist.origins.find((o) => o.id === behavior.originId);
    if (origin === undefined || !origin.healthy) {
      trace.push({ phase: "error", detail: `オリジン "${behavior.originId}" が利用不可 → 502`, durationMs: 0 });
      const resp: CfResponse = {
        status: 502, statusText: "Bad Gateway",
        headers: { "x-cache": "Error from cloudfront" },
        body: "<h1>502 Bad Gateway</h1>", xCache: "Error from cloudfront",
        timingMs: edge.originRttMs, xAmzCfPop: edge.code,
      };
      return { request: req, response: resp, trace, behavior: behaviorLabel, cacheKey };
    }

    const fetchTime = edge.originRttMs + origin.responseTimeMs;
    trace.push({ phase: "origin_fetch", detail: `${origin.type}://${origin.domain}${uri} (RTT=${edge.originRttMs}ms + 処理=${origin.responseTimeMs}ms)`, durationMs: fetchTime });

    // オリジンレスポンス生成
    const originBody = this.generateOriginResponse(uri, origin);
    const originHeaders: Record<string, string> = {
      "content-type": this.guessContentType(uri),
      "cache-control": `max-age=${behavior.defaultTtl}`,
      "x-origin": origin.domain,
    };

    trace.push({ phase: "origin_response", detail: `200 OK (${originBody.length}B, Cache-Control: max-age=${behavior.defaultTtl})`, durationMs: 0 });

    // 9. Lambda@Edge: origin-response
    const orespLambda = behavior.lambdaEdge?.find((l) => l.eventType === "origin-response");
    if (orespLambda !== undefined) {
      trace.push({ phase: "lambda_edge", detail: `origin-response: ${orespLambda.functionName}`, durationMs: 3 });
    }

    // 10. 圧縮
    if (behavior.compress && (originHeaders["content-type"]?.includes("text") || originHeaders["content-type"]?.includes("javascript") || originHeaders["content-type"]?.includes("json"))) {
      trace.push({ phase: "compress", detail: `gzip 圧縮: ${originBody.length}B → ${Math.floor(originBody.length * 0.3)}B`, durationMs: 2 });
      originHeaders["content-encoding"] = "gzip";
    }

    // 11. キャッシュストア
    const ttl = Math.min(Math.max(behavior.defaultTtl, behavior.minTtl), behavior.maxTtl);
    const resp: CfResponse = {
      status: 200, statusText: "OK", headers: { ...originHeaders, "x-cache": "Miss from cloudfront" },
      body: originBody, xCache: "Miss from cloudfront", timingMs: fetchTime + 2, xAmzCfPop: edge.code,
    };

    if (ttl > 0) {
      edgeCache.set(cacheKey, { key: cacheKey, response: resp, storedAt: this.clock, ttl, hitCount: 0 });
      trace.push({ phase: "cache_store", detail: `エッジ ${edge.code} にキャッシュ保存 (TTL=${ttl}s)`, durationMs: 1 });
    }

    trace.push({ phase: "viewer_response", detail: `200 OK (Cache Miss, ${resp.timingMs}ms)`, durationMs: resp.timingMs });

    return { request: req, response: resp, trace, behavior: behaviorLabel, cacheKey };
  }

  /** キャッシュ無効化 */
  invalidate(paths: string[]): CfTrace[] {
    const trace: CfTrace[] = [];
    let cleared = 0;
    for (const [, cache] of this.caches) {
      for (const path of paths) {
        for (const [key] of cache) {
          if (path === "/*" || key.includes(path)) {
            cache.delete(key);
            cleared++;
          }
        }
      }
    }
    trace.push({ phase: "invalidation", detail: `パス [${paths.join(", ")}] を ${EDGE_LOCATIONS.length} エッジから無効化 (${cleared} エントリ削除)`, durationMs: 50 });
    return trace;
  }

  // ── ヘルパー ──

  private matchBehavior(uri: string): CacheBehavior {
    for (const b of this.dist.behaviors) {
      if (b.pathPattern === "*") continue;
      const pattern = b.pathPattern.replace("*", ".*");
      if (new RegExp(`^${pattern}$`).test(uri)) return b;
    }
    return this.dist.behaviors.find((b) => b.pathPattern === "*") ?? this.dist.behaviors[0]!;
  }

  private buildCacheKey(uri: string, req: CfRequest, behavior: CacheBehavior): string {
    let key = uri;
    if (behavior.forwardQueryString && req.queryString) {
      key += `?${req.queryString}`;
    }
    for (const h of behavior.forwardHeaders) {
      const v = req.headers[h.toLowerCase()];
      if (v !== undefined) key += `|${h}=${v}`;
    }
    return key;
  }

  private generateOriginResponse(uri: string, origin: Origin): string {
    if (uri.endsWith(".html")) return `<html><body><h1>Content from ${origin.domain}</h1><p>Path: ${uri}</p></body></html>`;
    if (uri.endsWith(".json")) return JSON.stringify({ origin: origin.domain, path: uri, ts: this.clock });
    if (uri.endsWith(".js")) return `console.log("served from ${origin.domain}");`;
    if (uri.endsWith(".css")) return `/* from ${origin.domain} */ body { margin: 0; }`;
    if (uri.endsWith(".jpg") || uri.endsWith(".png")) return `[binary image data from ${origin.domain}]`;
    return `Response from ${origin.domain} for ${uri}`;
  }

  private guessContentType(uri: string): string {
    const ext = uri.split(".").pop()?.toLowerCase() ?? "";
    const map: Record<string, string> = {
      html: "text/html", json: "application/json", js: "application/javascript",
      css: "text/css", jpg: "image/jpeg", png: "image/png", svg: "image/svg+xml",
    };
    return map[ext] ?? "application/octet-stream";
  }
}
