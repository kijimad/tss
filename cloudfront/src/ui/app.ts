import { CloudFrontEngine } from "../engine/cloudfront.js";
import type { Distribution, CfRequest, CfResult, CfTrace } from "../engine/cloudfront.js";

export interface Example {
  name: string;
  description: string;
  distribution: Distribution;
  /** 順番に送信するリクエスト */
  requests: CfRequest[];
  /** 無効化パス (指定 tick 後に実行) */
  invalidateAfter?: { afterIndex: number; paths: string[] };
}

// ── ディストリビューション定義 ──

const basicDist: Distribution = {
  id: "E1ABC2DEF3", domain: "d1234.cloudfront.net",
  origins: [
    { id: "S3-website", type: "S3", domain: "my-bucket.s3.amazonaws.com", responseTimeMs: 20, healthy: true },
  ],
  behaviors: [
    { pathPattern: "*.jpg", defaultTtl: 86400, maxTtl: 604800, minTtl: 3600, forwardHeaders: [], forwardQueryString: false, compress: false, viewerProtocolPolicy: "allow-all", originId: "S3-website" },
    { pathPattern: "*.css", defaultTtl: 86400, maxTtl: 604800, minTtl: 3600, forwardHeaders: [], forwardQueryString: false, compress: true, viewerProtocolPolicy: "allow-all", originId: "S3-website" },
    { pathPattern: "*.js", defaultTtl: 86400, maxTtl: 604800, minTtl: 3600, forwardHeaders: [], forwardQueryString: false, compress: true, viewerProtocolPolicy: "allow-all", originId: "S3-website" },
    { pathPattern: "*", defaultTtl: 300, maxTtl: 3600, minTtl: 0, forwardHeaders: [], forwardQueryString: false, compress: true, viewerProtocolPolicy: "redirect-to-https", originId: "S3-website" },
  ],
  defaultRootObject: "index.html",
  priceClass: "PriceClass_All",
  customErrorResponses: [{ errorCode: 404, responsePagePath: "/error/404.html", ttl: 60 }],
};

const apiDist: Distribution = {
  id: "E2XYZ4GHI5", domain: "api-cdn.example.com",
  origins: [
    { id: "ALB-api", type: "ALB", domain: "api-alb-123.us-east-1.elb.amazonaws.com", responseTimeMs: 50, healthy: true },
    { id: "S3-static", type: "S3", domain: "static-assets.s3.amazonaws.com", responseTimeMs: 15, healthy: true },
  ],
  behaviors: [
    { pathPattern: "/api/*", defaultTtl: 0, maxTtl: 0, minTtl: 0, forwardHeaders: ["Authorization", "Accept"], forwardQueryString: true, compress: false, viewerProtocolPolicy: "https-only", originId: "ALB-api" },
    { pathPattern: "/static/*", defaultTtl: 604800, maxTtl: 2592000, minTtl: 86400, forwardHeaders: [], forwardQueryString: false, compress: true, viewerProtocolPolicy: "allow-all", originId: "S3-static" },
    { pathPattern: "*", defaultTtl: 60, maxTtl: 300, minTtl: 0, forwardHeaders: [], forwardQueryString: false, compress: true, viewerProtocolPolicy: "redirect-to-https", originId: "ALB-api" },
  ],
  defaultRootObject: "index.html",
  priceClass: "PriceClass_200",
  customErrorResponses: [],
};

const lambdaDist: Distribution = {
  ...basicDist, id: "E3LMB6EDGE",
  behaviors: [
    {
      pathPattern: "*", defaultTtl: 300, maxTtl: 3600, minTtl: 0,
      forwardHeaders: [], forwardQueryString: false, compress: true,
      viewerProtocolPolicy: "redirect-to-https", originId: "S3-website",
      lambdaEdge: [
        {
          eventType: "viewer-request", functionName: "add-security-headers",
          handler: (req) => {
            req.headers["x-custom-header"] = "added-by-lambda";
            return req;
          },
        },
        {
          eventType: "viewer-response", functionName: "add-cors-headers",
          handler: () => null,
        },
      ],
    },
  ],
};

const failDist: Distribution = {
  ...basicDist, id: "E4FAILOVER",
  origins: [
    { id: "primary", type: "ALB", domain: "primary.example.com", responseTimeMs: 30, healthy: false },
    { id: "fallback", type: "S3", domain: "fallback-bucket.s3.amazonaws.com", responseTimeMs: 10, healthy: true },
  ],
  behaviors: [
    { pathPattern: "*", defaultTtl: 60, maxTtl: 300, minTtl: 0, forwardHeaders: [], forwardQueryString: false, compress: true, viewerProtocolPolicy: "allow-all", originId: "primary" },
  ],
};

const req = (uri: string, edge: string, qs = "", headers: Record<string, string> = {}): CfRequest => ({
  method: "GET", uri, queryString: qs, headers: { "x-forwarded-proto": "https", ...headers },
  clientIp: "203.0.113.1", edgeLocation: edge,
});

export const EXAMPLES: Example[] = [
  {
    name: "キャッシュヒット/ミス (S3 オリジン)",
    description: "同じ URL を複数回リクエスト。1 回目はミス (オリジンフェッチ)、2 回目以降はヒット (エッジから即座に返却)。",
    distribution: basicDist,
    requests: [
      req("/index.html", "NRT"),
      req("/index.html", "NRT"),
      req("/index.html", "NRT"),
      req("/style.css", "NRT"),
      req("/app.js", "NRT"),
      req("/hero.jpg", "NRT"),
    ],
  },
  {
    name: "マルチエッジ (東京 / シンガポール / バージニア)",
    description: "同じコンテンツでもエッジが異なるとキャッシュは別。各エッジで独立にオリジンフェッチが発生。",
    distribution: basicDist,
    requests: [
      req("/index.html", "NRT"),
      req("/index.html", "SIN"),
      req("/index.html", "IAD"),
      req("/index.html", "NRT"),
      req("/index.html", "SIN"),
    ],
  },
  {
    name: "API + 静的アセット (ビヘイビア分離)",
    description: "/api/* は TTL=0 で毎回オリジン。/static/* は TTL=7日でキャッシュ。ビヘイビアのパスパターンマッチを確認。",
    distribution: apiDist,
    requests: [
      req("/api/users", "NRT", "page=1", { "Authorization": "Bearer token123" }),
      req("/api/users", "NRT", "page=1", { "Authorization": "Bearer token123" }),
      req("/static/logo.png", "NRT"),
      req("/static/logo.png", "NRT"),
      req("/api/orders", "NRT", "", { "Authorization": "Bearer token456" }),
    ],
  },
  {
    name: "キャッシュ無効化 (Invalidation)",
    description: "3 リクエスト後に /* を無効化。次のリクエストは再びミスになりオリジンフェッチが発生。",
    distribution: basicDist,
    requests: [
      req("/index.html", "NRT"),
      req("/index.html", "NRT"),
      req("/index.html", "NRT"),
      req("/index.html", "NRT"),
    ],
    invalidateAfter: { afterIndex: 2, paths: ["/*"] },
  },
  {
    name: "Lambda@Edge (ヘッダ操作)",
    description: "viewer-request で X-Custom-Header を追加、viewer-response で CORS ヘッダを追加。",
    distribution: lambdaDist,
    requests: [
      req("/page.html", "NRT"),
      req("/page.html", "NRT"),
    ],
  },
  {
    name: "オリジン障害 (502 Bad Gateway)",
    description: "プライマリオリジンがダウン。CloudFront は 502 を返す。",
    distribution: failDist,
    requests: [
      req("/index.html", "NRT"),
      req("/index.html", "SIN"),
    ],
  },
  {
    name: "HTTP → HTTPS リダイレクト",
    description: "ビューワープロトコルポリシーが redirect-to-https。HTTP リクエストは 301 で HTTPS にリダイレクト。",
    distribution: basicDist,
    requests: [
      { method: "GET", uri: "/page.html", queryString: "", headers: { "x-forwarded-proto": "http" }, clientIp: "203.0.113.1", edgeLocation: "NRT" },
      req("/page.html", "NRT"),
    ],
  },
];

function phaseColor(p: CfTrace["phase"]): string {
  switch (p) {
    case "dns":             return "#60a5fa";
    case "edge_select":     return "#06b6d4";
    case "viewer_request":  return "#a78bfa";
    case "cache_lookup":    return "#f59e0b";
    case "origin_request":  return "#3b82f6";
    case "origin_fetch":    return "#ef4444";
    case "origin_response": return "#22c55e";
    case "cache_store":     return "#10b981";
    case "viewer_response": return "#22c55e";
    case "lambda_edge":     return "#ec4899";
    case "redirect":        return "#3b82f6";
    case "error":           return "#ef4444";
    case "invalidation":    return "#dc2626";
    case "compress":        return "#8b5cf6";
    case "stats":           return "#64748b";
  }
}

export class CfApp {
  init(container: HTMLElement): void {
    container.style.cssText = "display:flex;flex-direction:column;height:100vh;font-family:'Fira Code','Cascadia Code',monospace;background:#0f172a;color:#e2e8f0;";

    const header = document.createElement("div");
    header.style.cssText = "padding:8px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #1e293b;flex-wrap:wrap;";
    const title = document.createElement("h1");
    title.textContent = "CloudFront CDN Simulator";
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

    // 左: ディストリビューション設定 + 統計
    const leftPanel = document.createElement("div");
    leftPanel.style.cssText = "width:340px;display:flex;flex-direction:column;border-right:1px solid #1e293b;overflow-y:auto;font-size:10px;";

    const cfgLabel = document.createElement("div");
    cfgLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#ff9900;border-bottom:1px solid #1e293b;";
    cfgLabel.textContent = "Distribution Config";
    leftPanel.appendChild(cfgLabel);
    const cfgDiv = document.createElement("div");
    cfgDiv.style.cssText = "padding:8px 12px;border-bottom:1px solid #1e293b;";
    leftPanel.appendChild(cfgDiv);

    const statsLabel = document.createElement("div");
    statsLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#06b6d4;border-bottom:1px solid #1e293b;";
    statsLabel.textContent = "Cache Stats";
    leftPanel.appendChild(statsLabel);
    const statsDiv = document.createElement("div");
    statsDiv.style.cssText = "padding:8px 12px;";
    leftPanel.appendChild(statsDiv);
    main.appendChild(leftPanel);

    // 中央: リクエスト結果
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
    rightPanel.style.cssText = "width:420px;display:flex;flex-direction:column;";
    const trLabel = document.createElement("div");
    trLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#22c55e;border-bottom:1px solid #1e293b;";
    trLabel.textContent = "CDN Processing Trace (click)";
    rightPanel.appendChild(trLabel);
    const trDiv = document.createElement("div");
    trDiv.style.cssText = "flex:1;padding:4px 8px;font-size:9px;overflow-y:auto;line-height:1.6;";
    rightPanel.appendChild(trDiv);
    main.appendChild(rightPanel);
    container.appendChild(main);

    // ── 描画 ──

    const renderConfig = (dist: Distribution) => {
      cfgDiv.innerHTML = "";
      const add = (l: string, v: string, c: string) => {
        const r = document.createElement("div"); r.style.marginBottom = "2px";
        r.innerHTML = `<span style="color:${c};font-weight:600;min-width:80px;display:inline-block;">${l}</span> <span style="color:#94a3b8;">${v}</span>`;
        cfgDiv.appendChild(r);
      };
      add("ID", dist.id, "#ff9900");
      add("Domain", dist.domain, "#e2e8f0");
      add("Price Class", dist.priceClass, "#64748b");
      add("Root Object", dist.defaultRootObject, "#64748b");

      for (const o of dist.origins) {
        add(`Origin`, `${o.type}://${o.domain} ${o.healthy ? "\u2714" : "\u2718 DOWN"}`, o.healthy ? "#22c55e" : "#ef4444");
      }

      const bhTitle = document.createElement("div");
      bhTitle.style.cssText = "color:#f59e0b;font-weight:600;margin-top:6px;margin-bottom:2px;";
      bhTitle.textContent = "Cache Behaviors:";
      cfgDiv.appendChild(bhTitle);

      for (const b of dist.behaviors) {
        const le = b.lambdaEdge?.map((l) => ` \u{1F4A0}${l.eventType}`).join("") ?? "";
        add(b.pathPattern, `TTL=${b.defaultTtl}s → ${b.originId}${le}`, "#f59e0b");
      }
    };

    const renderStats = (engine: CloudFrontEngine) => {
      statsDiv.innerHTML = "";
      const s = engine.stats;
      const add = (l: string, v: string, c: string) => {
        const r = document.createElement("div"); r.style.marginBottom = "2px";
        r.innerHTML = `<span style="color:${c};font-weight:600;">${v}</span> ${l}`;
        statsDiv.appendChild(r);
      };
      add("Total Requests", String(s.totalRequests), "#e2e8f0");
      add("Cache Hits", String(s.cacheHits), "#22c55e");
      add("Hit Ratio", s.hitRatio, "#f59e0b");

      const edgeTitle = document.createElement("div");
      edgeTitle.style.cssText = "color:#06b6d4;font-weight:600;margin-top:6px;margin-bottom:2px;";
      edgeTitle.textContent = "Edge Cache:";
      statsDiv.appendChild(edgeTitle);
      for (const e of s.edgeCacheSizes) {
        if (e.size > 0) {
          const r = document.createElement("div");
          r.style.cssText = "color:#94a3b8;padding-left:8px;";
          r.textContent = `${e.code}: ${e.size} entries`;
          statsDiv.appendChild(r);
        }
      }
    };

    const renderResults = (results: CfResult[], extra: CfTrace[]) => {
      resDiv.innerHTML = "";
      for (let i = 0; i < results.length; i++) {
        const r = results[i]!;
        const isHit = r.response.xCache === "Hit from cloudfront";
        const isError = r.response.status >= 400;
        const border = isHit ? "#22c55e" : isError ? "#ef4444" : "#f59e0b";
        const el = document.createElement("div");
        el.style.cssText = `padding:5px 8px;margin-bottom:3px;border:1px solid ${border}44;border-radius:4px;background:${border}06;cursor:pointer;`;

        const cacheTag = isHit ? `<span style="color:#22c55e;font-size:9px;font-weight:600;"> HIT</span>` : isError ? `<span style="color:#ef4444;font-size:9px;"> ERR</span>` : `<span style="color:#f59e0b;font-size:9px;"> MISS</span>`;
        el.innerHTML =
          `<div style="display:flex;justify-content:space-between;"><span style="color:#e2e8f0;font-weight:600;">${r.request.method} ${r.request.uri}${cacheTag}</span><span style="color:#64748b;">${r.response.timingMs}ms</span></div>` +
          `<div style="color:#64748b;font-size:9px;">${r.response.status} | POP=${r.response.xAmzCfPop} | behavior=${r.behavior} | key=${r.cacheKey.slice(0, 30)}</div>`;
        el.addEventListener("click", () => renderTrace(r.trace));
        resDiv.appendChild(el);
      }
      if (extra.length > 0) {
        for (const t of extra) {
          const el = document.createElement("div");
          el.style.cssText = "padding:4px 8px;margin-bottom:3px;border:1px dashed #dc2626;border-radius:4px;color:#dc2626;font-size:9px;";
          el.textContent = `\u26A0 ${t.detail}`;
          resDiv.appendChild(el);
        }
      }
    };

    const renderTrace = (trace: CfTrace[]) => {
      trDiv.innerHTML = "";
      for (const step of trace) {
        const el = document.createElement("div");
        el.style.cssText = "display:flex;gap:4px;align-items:flex-start;margin-bottom:2px;";
        const color = phaseColor(step.phase);
        const dur = step.durationMs > 0 ? `<span style="color:#64748b;min-width:32px;text-align:right;">${step.durationMs}ms</span>` : '<span style="min-width:32px;"></span>';
        el.innerHTML =
          `<span style="min-width:80px;padding:0 3px;border-radius:2px;font-size:8px;font-weight:600;text-align:center;color:${color};background:${color}15;border:1px solid ${color}33;">${step.phase}</span>` +
          dur +
          `<span style="color:#cbd5e1;">${step.detail}</span>`;
        trDiv.appendChild(el);
      }
    };

    const loadExample = (ex: Example) => {
      descSpan.textContent = ex.description;
      renderConfig(ex.distribution);
      resDiv.innerHTML = ""; trDiv.innerHTML = ""; statsDiv.innerHTML = "";
    };

    const runSim = (ex: Example) => {
      const engine = new CloudFrontEngine(ex.distribution);
      const results: CfResult[] = [];
      const extraTrace: CfTrace[] = [];

      for (let i = 0; i < ex.requests.length; i++) {
        if (ex.invalidateAfter !== undefined && i === ex.invalidateAfter.afterIndex + 1) {
          const invTrace = engine.invalidate(ex.invalidateAfter.paths);
          extraTrace.push(...invTrace);
        }
        results.push(engine.handleRequest(ex.requests[i]!));
      }

      renderConfig(ex.distribution);
      renderResults(results, extraTrace);
      renderStats(engine);
      if (results[0]) renderTrace(results[0].trace);
    };

    exSelect.addEventListener("change", () => { const ex = EXAMPLES[Number(exSelect.value)]; if (ex) loadExample(ex); });
    runBtn.addEventListener("click", () => { const ex = EXAMPLES[Number(exSelect.value)]; if (ex) runSim(ex); });
    loadExample(EXAMPLES[0]!);
  }
}
