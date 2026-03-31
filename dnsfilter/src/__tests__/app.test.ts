import { describe, it, expect } from "vitest";
import { EXAMPLES } from "../ui/app.js";
import { DnsFilterServer } from "../filter/server.js";

describe("EXAMPLES 配列", () => {
  it("6 つのサンプルが定義されている", () => {
    expect(EXAMPLES).toHaveLength(6);
  });

  it("各サンプルに必要なフィールドがある", () => {
    for (const ex of EXAMPLES) {
      expect(ex.name.length).toBeGreaterThan(0);
      expect(ex.description.length).toBeGreaterThan(0);
      expect(ex.queries.length).toBeGreaterThan(0);
    }
  });

  it("サンプル名が重複していない", () => {
    const names = EXAMPLES.map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("各サンプルの実行", () => {
  for (const ex of EXAMPLES) {
    it(`${ex.name}: 全クエリが実行可能`, () => {
      const server = new DnsFilterServer(ex.policy, ex.upstream);
      for (const q of ex.queries) {
        const result = server.resolve(q);
        expect(typeof result.allowed).toBe("boolean");
        expect(result.trace.length).toBeGreaterThan(0);
      }
    });
  }

  it("広告ブロック: 広告ドメインがブロックされる", () => {
    const ex = EXAMPLES[0]!;
    const server = new DnsFilterServer(ex.policy, ex.upstream);
    const results = ex.queries.map((q) => server.resolve(q));
    expect(results.some((r) => !r.allowed && r.category === "ads")).toBe(true);
    expect(results.some((r) => r.allowed)).toBe(true);
  });

  it("デフォルト拒否 (ホワイトリスト): 許可リスト以外がブロック", () => {
    const ex = EXAMPLES[4]!;
    const server = new DnsFilterServer(ex.policy, ex.upstream);
    const results = ex.queries.map((q) => server.resolve(q));
    const allowedDomains = results.filter((r) => r.allowed).map((r) => r.query.domain);
    // 許可リストのドメインのみ許可
    for (const d of allowedDomains) {
      expect(ex.policy.allowlist.some((a) => d === a || d.endsWith(`.${a}`))).toBe(true);
    }
  });

  it("キャッシュ: 同じドメインの2回目でキャッシュヒット", () => {
    const ex = EXAMPLES[5]!;
    const server = new DnsFilterServer(ex.policy, ex.upstream);
    const results = ex.queries.map((q) => server.resolve(q));
    const cacheHits = results.filter((r) => r.trace.some((s) => s.phase === "cache"));
    expect(cacheHits.length).toBeGreaterThan(0);
  });
});
