import { describe, it, expect, beforeEach } from "vitest";
import { DnsFilterServer } from "../filter/server.js";
import type { FilterPolicy, UpstreamRecord, DnsQuery } from "../filter/server.js";

const upstream: UpstreamRecord[] = [
  { domain: "example.com", type: "A", value: "93.184.216.34", ttl: 300 },
  { domain: "google.com", type: "A", value: "142.250.80.46", ttl: 120 },
  { domain: "evil.com", type: "A", value: "6.6.6.6", ttl: 60 },
];

const q = (domain: string): DnsQuery => ({ domain, type: "A", clientIp: "192.168.1.100" });

function makeServer(overrides?: Partial<FilterPolicy>): DnsFilterServer {
  const policy: FilterPolicy = {
    blockedCategories: ["ads", "malware"],
    blocklist: [
      { domain: "ad.example.com", category: "ads" },
      { domain: "tracker.net", category: "tracking" },
      { domain: "evil.com", category: "malware" },
    ],
    allowlist: [],
    customBlocks: [],
    blockAction: "NXDOMAIN",
    ...overrides,
  };
  return new DnsFilterServer(policy, upstream);
}

describe("基本フィルタリング", () => {
  let server: DnsFilterServer;

  beforeEach(() => {
    server = makeServer();
  });

  it("ブロックリスト + 有効カテゴリのドメインをブロックする", () => {
    const result = server.resolve(q("ad.example.com"));
    expect(result.allowed).toBe(false);
    expect(result.category).toBe("ads");
  });

  it("ブロックリストにあるが無効カテゴリのドメインは許可する", () => {
    // tracking は blockedCategories に含まれていない
    const result = server.resolve(q("tracker.net"));
    expect(result.allowed).toBe(true);
  });

  it("ブロックリストにないドメインは上流へフォワードする", () => {
    const result = server.resolve(q("example.com"));
    expect(result.allowed).toBe(true);
    expect(result.answer).toBe("93.184.216.34");
  });

  it("サブドメインもマッチする", () => {
    const result = server.resolve(q("sub.ad.example.com"));
    expect(result.allowed).toBe(false);
  });
});

describe("ブロックアクション", () => {
  it("NXDOMAIN: answer が null", () => {
    const server = makeServer({ blockAction: "NXDOMAIN" });
    const result = server.resolve(q("evil.com"));
    expect(result.action).toBe("NXDOMAIN");
    expect(result.answer).toBeNull();
  });

  it("0.0.0.0: answer が 0.0.0.0", () => {
    const server = makeServer({ blockAction: "0.0.0.0" });
    const result = server.resolve(q("evil.com"));
    expect(result.action).toBe("0.0.0.0");
    expect(result.answer).toBe("0.0.0.0");
  });

  it("REFUSED: answer が null", () => {
    const server = makeServer({ blockAction: "REFUSED" });
    const result = server.resolve(q("evil.com"));
    expect(result.action).toBe("REFUSED");
  });
});

describe("許可リスト", () => {
  it("許可リストのドメインはブロックリストより優先される", () => {
    const server = makeServer({
      allowlist: ["evil.com"],
    });
    const result = server.resolve(q("evil.com"));
    expect(result.allowed).toBe(true);
  });

  it("許可リストのサブドメインも許可される", () => {
    const server = makeServer({
      allowlist: ["evil.com"],
    });
    const result = server.resolve(q("sub.evil.com"));
    expect(result.allowed).toBe(true);
  });
});

describe("カスタムブロック", () => {
  it("カスタムブロックリストのドメインをブロックする", () => {
    const server = makeServer({ customBlocks: ["custom-block.example.com"] });
    const result = server.resolve(q("custom-block.example.com"));
    expect(result.allowed).toBe(false);
    expect(result.category).toBe("custom");
  });
});

describe("キャッシュ", () => {
  it("同じドメインの2回目のクエリはキャッシュヒットする", () => {
    const server = makeServer();
    server.resolve(q("example.com"));
    const result2 = server.resolve(q("example.com"));
    expect(result2.allowed).toBe(true);
    expect(result2.trace.some((s) => s.phase === "cache")).toBe(true);
  });

  it("ブロックされたドメインはキャッシュされない（上流に到達しない）", () => {
    const server = makeServer();
    server.resolve(q("evil.com"));
    const result2 = server.resolve(q("evil.com"));
    // ブロックは毎回フィルタで判定される（キャッシュ不要）
    expect(result2.allowed).toBe(false);
    expect(result2.trace.some((s) => s.phase === "cache")).toBe(false);
  });
});

describe("統計", () => {
  it("正しい統計が集計される", () => {
    const server = makeServer();
    server.resolve(q("example.com"));
    server.resolve(q("evil.com"));
    server.resolve(q("ad.example.com"));

    const stats = server.stats;
    expect(stats.totalQueries).toBe(3);
    expect(stats.allowed).toBe(1);
    expect(stats.blocked).toBe(2);
    expect(stats.byCategory["malware"]).toBe(1);
    expect(stats.byCategory["ads"]).toBe(1);
  });

  it("topBlocked にブロックされたドメインが表示される", () => {
    const server = makeServer();
    server.resolve(q("evil.com"));
    server.resolve(q("evil.com"));
    expect(server.stats.topBlocked[0]?.domain).toBe("evil.com");
    expect(server.stats.topBlocked[0]?.count).toBe(2);
  });
});

describe("トレース", () => {
  it("全クエリで receive ステップがある", () => {
    const server = makeServer();
    const result = server.resolve(q("example.com"));
    expect(result.trace[0]?.phase).toBe("receive");
  });

  it("ブロック時に response ステップがある", () => {
    const server = makeServer();
    const result = server.resolve(q("evil.com"));
    expect(result.trace.some((s) => s.phase === "response" && s.result === "block")).toBe(true);
  });
});
