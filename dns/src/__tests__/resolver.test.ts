import { describe, it, expect } from "vitest";
import { buildInternet } from "../server/internet.js";
import { DnsResolver } from "../resolver/resolver.js";
import { DnsCache } from "../resolver/cache.js";
import { RecordType } from "../protocol/types.js";

describe("DNS リゾルバ", () => {
  it("example.com の A レコードを解決する", async () => {
    const { network } = buildInternet();
    const cache = new DnsCache();
    const resolver = new DnsResolver(network, cache);

    const trace = await resolver.resolve("example.com", RecordType.A);
    expect(trace.result).toHaveLength(1);
    expect(trace.result[0]?.data).toBe("93.184.216.34");
    // ルート → .com TLD → example.com 権威 = 3クエリ
    expect(trace.totalQueries).toBe(3);
  });

  it("www.example.com を解決する", async () => {
    const { network } = buildInternet();
    const cache = new DnsCache();
    const resolver = new DnsResolver(network, cache);

    const trace = await resolver.resolve("www.example.com", RecordType.A);
    expect(trace.result).toHaveLength(1);
    expect(trace.result[0]?.data).toBe("93.184.216.34");
  });

  it("google.com を解決する", async () => {
    const { network } = buildInternet();
    const cache = new DnsCache();
    const resolver = new DnsResolver(network, cache);

    const trace = await resolver.resolve("google.com", RecordType.A);
    expect(trace.result).toHaveLength(1);
    expect(trace.result[0]?.data).toBe("142.250.80.46");
  });

  it("github.com を解決する", async () => {
    const { network } = buildInternet();
    const cache = new DnsCache();
    const resolver = new DnsResolver(network, cache);

    const trace = await resolver.resolve("github.com", RecordType.A);
    expect(trace.result).toHaveLength(1);
    expect(trace.result[0]?.data).toBe("140.82.112.3");
  });

  it("example.jp を解決する (.jp TLD経由)", async () => {
    const { network } = buildInternet();
    const cache = new DnsCache();
    const resolver = new DnsResolver(network, cache);

    const trace = await resolver.resolve("example.jp", RecordType.A);
    expect(trace.result).toHaveLength(1);
    expect(trace.result[0]?.data).toBe("210.171.226.50");
  });

  it("wikipedia.org を解決する (.org TLD経由)", async () => {
    const { network } = buildInternet();
    const cache = new DnsCache();
    const resolver = new DnsResolver(network, cache);

    const trace = await resolver.resolve("wikipedia.org", RecordType.A);
    expect(trace.result).toHaveLength(1);
    expect(trace.result[0]?.data).toBe("208.80.154.224");
  });

  it("2回目のクエリはキャッシュヒットする", async () => {
    const { network } = buildInternet();
    const cache = new DnsCache();
    const resolver = new DnsResolver(network, cache);

    // 1回目
    await resolver.resolve("example.com", RecordType.A);

    // 2回目
    const trace = await resolver.resolve("example.com", RecordType.A);
    expect(trace.cacheHits).toBeGreaterThan(0);
    expect(trace.totalQueries).toBe(0); // ネットワーク問い合わせなし
    expect(trace.result[0]?.data).toBe("93.184.216.34");
  });

  it("トレースイベントが記録される", async () => {
    const { network } = buildInternet();
    const cache = new DnsCache();
    const resolver = new DnsResolver(network, cache);

    const trace = await resolver.resolve("example.com", RecordType.A);
    expect(trace.events.length).toBeGreaterThan(0);

    // resolve_step イベントがある
    const resolveSteps = trace.events.filter(e => e.type === "resolve_step");
    expect(resolveSteps.length).toBeGreaterThan(0);

    // cache_store イベントがある
    const cacheStores = trace.events.filter(e => e.type === "cache_store");
    expect(cacheStores.length).toBeGreaterThan(0);
  });

  it("実行時間が記録される", async () => {
    const { network } = buildInternet();
    const cache = new DnsCache();
    const resolver = new DnsResolver(network, cache);

    const trace = await resolver.resolve("example.com", RecordType.A);
    expect(trace.elapsedMs).toBeGreaterThanOrEqual(0);
  });
});

describe("DNS キャッシュ", () => {
  it("レコードを格納して取得する", () => {
    const cache = new DnsCache();
    cache.store([
      { name: "example.com", type: RecordType.A, class: 1, ttl: 3600, data: "93.184.216.34" },
    ]);

    const result = cache.lookup("example.com", RecordType.A);
    expect(result).toHaveLength(1);
    expect(result?.[0]?.data).toBe("93.184.216.34");
  });

  it("存在しないキーは undefined を返す", () => {
    const cache = new DnsCache();
    const result = cache.lookup("nonexistent.com", RecordType.A);
    expect(result).toBeUndefined();
  });

  it("キャッシュをクリアする", () => {
    const cache = new DnsCache();
    cache.store([
      { name: "example.com", type: RecordType.A, class: 1, ttl: 3600, data: "1.2.3.4" },
    ]);
    cache.clear();
    expect(cache.lookup("example.com", RecordType.A)).toBeUndefined();
  });

  it("全エントリを取得する", () => {
    const cache = new DnsCache();
    cache.store([
      { name: "a.com", type: RecordType.A, class: 1, ttl: 100, data: "1.1.1.1" },
      { name: "b.com", type: RecordType.A, class: 1, ttl: 200, data: "2.2.2.2" },
    ]);

    const entries = cache.getAllEntries();
    expect(entries).toHaveLength(2);
  });
});
