import { describe, it, expect } from "vitest";
import { CloudFrontEngine, EDGE_LOCATIONS } from "../engine/cloudfront.js";
import { EXAMPLES } from "../ui/app.js";
import type { Distribution, CfRequest } from "../engine/cloudfront.js";

const mkDist = (overrides?: Partial<Distribution>): Distribution => ({
  id: "TEST", domain: "test.cloudfront.net",
  origins: [{ id: "S3", type: "S3", domain: "bucket.s3.amazonaws.com", responseTimeMs: 20, healthy: true }],
  behaviors: [{ pathPattern: "*", defaultTtl: 300, maxTtl: 3600, minTtl: 0, forwardHeaders: [], forwardQueryString: false, compress: true, viewerProtocolPolicy: "allow-all", originId: "S3" }],
  defaultRootObject: "index.html", priceClass: "PriceClass_All", customErrorResponses: [],
  ...overrides,
});

const mkReq = (uri: string, edge = "NRT"): CfRequest => ({
  method: "GET", uri, queryString: "", headers: { "x-forwarded-proto": "https" },
  clientIp: "1.2.3.4", edgeLocation: edge,
});

describe("CloudFrontEngine 基本", () => {
  it("初回リクエストはキャッシュミス", () => {
    const e = new CloudFrontEngine(mkDist());
    const r = e.handleRequest(mkReq("/page.html"));
    expect(r.response.xCache).toBe("Miss from cloudfront");
    expect(r.response.status).toBe(200);
  });

  it("2回目のリクエストはキャッシュヒット", () => {
    const e = new CloudFrontEngine(mkDist());
    e.handleRequest(mkReq("/page.html"));
    const r2 = e.handleRequest(mkReq("/page.html"));
    expect(r2.response.xCache).toBe("Hit from cloudfront");
  });

  it("異なるエッジは独立キャッシュ", () => {
    const e = new CloudFrontEngine(mkDist());
    e.handleRequest(mkReq("/page.html", "NRT"));
    const r2 = e.handleRequest(mkReq("/page.html", "IAD"));
    expect(r2.response.xCache).toBe("Miss from cloudfront");
  });

  it("キャッシュヒット時のレスポンスが高速", () => {
    const e = new CloudFrontEngine(mkDist());
    const r1 = e.handleRequest(mkReq("/page.html"));
    const r2 = e.handleRequest(mkReq("/page.html"));
    expect(r2.response.timingMs).toBeLessThan(r1.response.timingMs);
  });
});

describe("キャッシュビヘイビア", () => {
  it("パスパターンでビヘイビアを選択する", () => {
    const dist = mkDist({
      behaviors: [
        { pathPattern: "*.jpg", defaultTtl: 86400, maxTtl: 86400, minTtl: 0, forwardHeaders: [], forwardQueryString: false, compress: false, viewerProtocolPolicy: "allow-all", originId: "S3" },
        { pathPattern: "*", defaultTtl: 60, maxTtl: 300, minTtl: 0, forwardHeaders: [], forwardQueryString: false, compress: true, viewerProtocolPolicy: "allow-all", originId: "S3" },
      ],
    });
    const e = new CloudFrontEngine(dist);
    const rJpg = e.handleRequest(mkReq("/photo.jpg"));
    expect(rJpg.behavior).toBe("*.jpg");
    const rHtml = e.handleRequest(mkReq("/page.html"));
    expect(rHtml.behavior).toBe("*");
  });

  it("TTL=0 では毎回オリジンフェッチ", () => {
    const dist = mkDist({
      behaviors: [{ pathPattern: "*", defaultTtl: 0, maxTtl: 0, minTtl: 0, forwardHeaders: [], forwardQueryString: false, compress: false, viewerProtocolPolicy: "allow-all", originId: "S3" }],
    });
    const e = new CloudFrontEngine(dist);
    e.handleRequest(mkReq("/api/data"));
    const r2 = e.handleRequest(mkReq("/api/data"));
    expect(r2.response.xCache).toBe("Miss from cloudfront");
  });
});

describe("オリジン障害", () => {
  it("ダウンしたオリジンは 502 を返す", () => {
    const dist = mkDist({
      origins: [{ id: "S3", type: "S3", domain: "down.s3.amazonaws.com", responseTimeMs: 0, healthy: false }],
    });
    const e = new CloudFrontEngine(dist);
    const r = e.handleRequest(mkReq("/page.html"));
    expect(r.response.status).toBe(502);
    expect(r.response.xCache).toBe("Error from cloudfront");
  });
});

describe("無効化", () => {
  it("invalidate 後はキャッシュミスになる", () => {
    const e = new CloudFrontEngine(mkDist());
    e.handleRequest(mkReq("/page.html"));
    expect(e.handleRequest(mkReq("/page.html")).response.xCache).toBe("Hit from cloudfront");
    e.invalidate(["/*"]);
    expect(e.handleRequest(mkReq("/page.html")).response.xCache).toBe("Miss from cloudfront");
  });
});

describe("統計", () => {
  it("ヒット率が計算される", () => {
    const e = new CloudFrontEngine(mkDist());
    e.handleRequest(mkReq("/a.html"));
    e.handleRequest(mkReq("/a.html"));
    e.handleRequest(mkReq("/a.html"));
    const s = e.stats;
    expect(s.totalRequests).toBe(3);
    expect(s.cacheHits).toBe(2);
    expect(s.hitRatio).toBe("66.7%");
  });
});

describe("EDGE_LOCATIONS", () => {
  it("8 か所が定義されている", () => {
    expect(EDGE_LOCATIONS).toHaveLength(8);
  });
  it("東京 (NRT) が含まれる", () => {
    expect(EDGE_LOCATIONS.find((e) => e.code === "NRT")).toBeDefined();
  });
});

describe("EXAMPLES", () => {
  it("7 つのサンプル", () => { expect(EXAMPLES).toHaveLength(7); });
  it("名前が一意", () => { expect(new Set(EXAMPLES.map((e) => e.name)).size).toBe(EXAMPLES.length); });

  for (const ex of EXAMPLES) {
    it(`${ex.name}: 全リクエスト実行可能`, () => {
      const e = new CloudFrontEngine(ex.distribution);
      for (const req of ex.requests) {
        const r = e.handleRequest(req);
        expect(r.trace.length).toBeGreaterThan(0);
        expect(r.response.status).toBeGreaterThanOrEqual(200);
      }
    });
  }
});
