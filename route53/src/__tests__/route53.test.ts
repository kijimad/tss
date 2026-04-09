import { describe, it, expect } from "vitest";
import { Route53Engine } from "../engine/route53.js";
import { EXAMPLES } from "../ui/app.js";
import type { HostedZone, DnsQuery } from "../engine/route53.js";

const q = (name: string, region = "ap-northeast-1", country = "JP", continent = "AS"): DnsQuery => ({
  name, type: "A", clientRegion: region, clientContinent: continent, clientCountry: country,
});

const simpleZone: HostedZone = {
  id: "Z1", name: "test.com", private: false, healthChecks: [],
  records: [
    { name: "www.test.com", type: "A", ttl: 300, values: ["1.1.1.1", "2.2.2.2"], routing: { type: "simple" }, healthCheckId: null },
  ],
};

describe("Simple ルーティング", () => {
  it("全 IP を返す", () => {
    const e = new Route53Engine([simpleZone]);
    const r = e.resolve(q("www.test.com"));
    expect(r.answers).toEqual(["1.1.1.1", "2.2.2.2"]);
  });

  it("存在しないレコードは NXDOMAIN", () => {
    const e = new Route53Engine([simpleZone]);
    expect(e.resolve(q("missing.test.com")).answers).toEqual([]);
  });

  it("存在しないゾーンは NXDOMAIN", () => {
    const e = new Route53Engine([simpleZone]);
    expect(e.resolve(q("other.example.com")).answers).toEqual([]);
  });
});

describe("Weighted ルーティング", () => {
  it("重みに基づいてレコードを選択する", () => {
    const zone: HostedZone = {
      id: "Z2", name: "w.com", private: false, healthChecks: [],
      records: [
        { name: "w.com", type: "A", ttl: 60, values: ["1.0.0.1"], routing: { type: "weighted", weight: 100, setId: "a" }, healthCheckId: null },
        { name: "w.com", type: "A", ttl: 60, values: ["2.0.0.1"], routing: { type: "weighted", weight: 0, setId: "b" }, healthCheckId: null },
      ],
    };
    const e = new Route53Engine([zone]);
    const r = e.resolve(q("w.com"));
    expect(r.answers).toEqual(["1.0.0.1"]);
    expect(r.routingUsed).toBe("weighted");
  });
});

describe("Latency ルーティング", () => {
  it("最も遅延が少ないリージョンを選択する", () => {
    const zone: HostedZone = {
      id: "Z3", name: "lat.com", private: false, healthChecks: [],
      records: [
        { name: "lat.com", type: "A", ttl: 60, values: ["10.1.0.1"], routing: { type: "latency", region: "ap-northeast-1", setId: "tokyo" }, healthCheckId: null },
        { name: "lat.com", type: "A", ttl: 60, values: ["10.2.0.1"], routing: { type: "latency", region: "us-east-1", setId: "virginia" }, healthCheckId: null },
      ],
    };
    const e = new Route53Engine([zone]);
    const r = e.resolve(q("lat.com", "ap-northeast-1"));
    expect(r.answers).toEqual(["10.1.0.1"]);
    const r2 = e.resolve(q("lat.com", "us-east-1", "US", "NA"));
    expect(r2.answers).toEqual(["10.2.0.1"]);
  });
});

describe("Failover ルーティング", () => {
  it("PRIMARY healthy → PRIMARY を返す", () => {
    const zone: HostedZone = {
      id: "Z4", name: "fo.com", private: false,
      healthChecks: [{ id: "hc-p", type: "HTTP", endpoint: "p", port: 80, path: "/", interval: 30, failureThreshold: 3, healthy: true, consecutiveFailures: 0 }],
      records: [
        { name: "fo.com", type: "A", ttl: 60, values: ["1.0.0.1"], routing: { type: "failover", role: "PRIMARY", setId: "p" }, healthCheckId: "hc-p" },
        { name: "fo.com", type: "A", ttl: 60, values: ["2.0.0.1"], routing: { type: "failover", role: "SECONDARY", setId: "s" }, healthCheckId: null },
      ],
    };
    const e = new Route53Engine([zone]);
    expect(e.resolve(q("fo.com")).answers).toEqual(["1.0.0.1"]);
  });

  it("PRIMARY unhealthy → SECONDARY にフォールバック", () => {
    const zone: HostedZone = {
      id: "Z4", name: "fo.com", private: false,
      healthChecks: [{ id: "hc-p", type: "HTTP", endpoint: "p", port: 80, path: "/", interval: 30, failureThreshold: 3, healthy: false, consecutiveFailures: 5 }],
      records: [
        { name: "fo.com", type: "A", ttl: 60, values: ["1.0.0.1"], routing: { type: "failover", role: "PRIMARY", setId: "p" }, healthCheckId: "hc-p" },
        { name: "fo.com", type: "A", ttl: 60, values: ["2.0.0.1"], routing: { type: "failover", role: "SECONDARY", setId: "s" }, healthCheckId: null },
      ],
    };
    const e = new Route53Engine([zone]);
    expect(e.resolve(q("fo.com")).answers).toEqual(["2.0.0.1"]);
  });
});

describe("Geolocation ルーティング", () => {
  it("国マッチが最優先", () => {
    const zone: HostedZone = {
      id: "Z5", name: "geo.com", private: false, healthChecks: [],
      records: [
        { name: "geo.com", type: "A", ttl: 300, values: ["10.1.0.1"], routing: { type: "geolocation", country: "JP", setId: "jp" }, healthCheckId: null },
        { name: "geo.com", type: "A", ttl: 300, values: ["10.9.0.1"], routing: { type: "geolocation", setId: "default" }, healthCheckId: null },
      ],
    };
    const e = new Route53Engine([zone]);
    expect(e.resolve(q("geo.com", "ap-northeast-1", "JP", "AS")).answers).toEqual(["10.1.0.1"]);
  });

  it("国に一致なし → 大陸 → デフォルト", () => {
    const zone: HostedZone = {
      id: "Z5", name: "geo.com", private: false, healthChecks: [],
      records: [
        { name: "geo.com", type: "A", ttl: 300, values: ["10.1.0.1"], routing: { type: "geolocation", country: "JP", setId: "jp" }, healthCheckId: null },
        { name: "geo.com", type: "A", ttl: 300, values: ["10.9.0.1"], routing: { type: "geolocation", setId: "default" }, healthCheckId: null },
      ],
    };
    const e = new Route53Engine([zone]);
    expect(e.resolve(q("geo.com", "us-east-1", "US", "NA")).answers).toEqual(["10.9.0.1"]);
  });
});

describe("Multivalue Answer", () => {
  it("healthy なレコードのみ返す", () => {
    const zone: HostedZone = {
      id: "Z6", name: "mv.com", private: false,
      healthChecks: [
        { id: "h1", type: "HTTP", endpoint: "1", port: 80, path: "/", interval: 30, failureThreshold: 3, healthy: true, consecutiveFailures: 0 },
        { id: "h2", type: "HTTP", endpoint: "2", port: 80, path: "/", interval: 30, failureThreshold: 3, healthy: false, consecutiveFailures: 5 },
      ],
      records: [
        { name: "mv.com", type: "A", ttl: 60, values: ["1.0.0.1"], routing: { type: "multivalue", setId: "1" }, healthCheckId: "h1" },
        { name: "mv.com", type: "A", ttl: 60, values: ["2.0.0.1"], routing: { type: "multivalue", setId: "2" }, healthCheckId: "h2" },
      ],
    };
    const e = new Route53Engine([zone]);
    const r = e.resolve(q("mv.com"));
    expect(r.answers).toEqual(["1.0.0.1"]);
    expect(r.healthyRecords).toBe(1);
  });
});

describe("トレース", () => {
  it("全クエリでトレースが生成される", () => {
    const e = new Route53Engine([simpleZone]);
    const r = e.resolve(q("www.test.com"));
    expect(r.trace.length).toBeGreaterThan(0);
    expect(r.trace[0]!.phase).toBe("query");
  });
});

describe("EXAMPLES", () => {
  it("7 つのサンプル", () => { expect(EXAMPLES).toHaveLength(7); });
  it("名前が一意", () => { expect(new Set(EXAMPLES.map((e) => e.name)).size).toBe(EXAMPLES.length); });
  for (const ex of EXAMPLES) {
    it(`${ex.name}: 全クエリ実行可能`, () => {
      const e = new Route53Engine(ex.zones);
      for (const q of ex.queries) {
        const r = e.resolve(q);
        expect(r.trace.length).toBeGreaterThan(0);
      }
    });
  }
});
