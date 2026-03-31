/**
 * server.ts — DNS フィルタリングサーバシミュレーション
 *
 * クエリを受け取り、ブロックリスト・カテゴリ・許可リストに基づいて
 * ALLOW / BLOCK を判定する。上流 DNS へのフォワードもシミュレート。
 */

/** フィルタリングカテゴリ */
export type Category = "ads" | "tracking" | "malware" | "phishing" | "social" | "adult" | "gaming" | "custom";

/** ブロック時の応答方法 */
export type BlockAction = "NXDOMAIN" | "0.0.0.0" | "REFUSED";

/** ブロックリストのエントリ */
export interface BlockEntry {
  domain: string;
  category: Category;
}

/** フィルタリングポリシー */
export interface FilterPolicy {
  /** ブロックするカテゴリ（有効なカテゴリのみフィルタ） */
  blockedCategories: Category[];
  /** ブロックリスト（ドメイン → カテゴリのマッピング） */
  blocklist: BlockEntry[];
  /** 許可リスト（ブロックリストより優先） */
  allowlist: string[];
  /** カスタムブロックドメイン */
  customBlocks: string[];
  /** ブロック時の応答 */
  blockAction: BlockAction;
}

/** 上流 DNS のレコード */
export interface UpstreamRecord {
  domain: string;
  type: "A" | "AAAA" | "CNAME";
  value: string;
  ttl: number;
}

/** DNS クエリ */
export interface DnsQuery {
  domain: string;
  type: "A" | "AAAA" | "CNAME" | "MX";
  clientIp: string;
}

/** 判定トレースのステップ */
export interface FilterStep {
  phase: "receive" | "allowlist" | "blocklist" | "category" | "custom" | "upstream" | "response" | "cache";
  detail: string;
  result: "pass" | "allow" | "block" | "info";
}

/** クエリ応答 */
export interface FilterResult {
  query: DnsQuery;
  allowed: boolean;
  action: "ALLOW" | BlockAction;
  answer: string | null;
  /** マッチしたカテゴリ（ブロック時） */
  category: Category | null;
  /** マッチしたルール名 */
  matchedRule: string | null;
  trace: FilterStep[];
  /** 応答時間 (ms シミュレーション) */
  latencyMs: number;
}

/** 統計情報 */
export interface FilterStats {
  totalQueries: number;
  allowed: number;
  blocked: number;
  cached: number;
  byCategory: Record<string, number>;
  topBlocked: { domain: string; count: number }[];
  topAllowed: { domain: string; count: number }[];
}

/** DNS フィルタリングサーバ */
export class DnsFilterServer {
  private policy: FilterPolicy;
  private upstream: UpstreamRecord[];
  private cache = new Map<string, { answer: string; ttl: number; cachedAt: number }>();
  private queryLog: FilterResult[] = [];
  private blockCountMap = new Map<string, number>();
  private allowCountMap = new Map<string, number>();
  private tick = 0;

  constructor(policy: FilterPolicy, upstream: UpstreamRecord[]) {
    this.policy = policy;
    this.upstream = upstream;
  }

  /** ポリシーを取得 */
  get currentPolicy(): FilterPolicy {
    return this.policy;
  }

  /** クエリログ */
  get log(): readonly FilterResult[] {
    return this.queryLog;
  }

  /** 統計情報 */
  get stats(): FilterStats {
    const byCategory: Record<string, number> = {};
    let allowed = 0;
    let blocked = 0;
    let cached = 0;

    for (const r of this.queryLog) {
      if (r.allowed) {
        allowed++;
      } else {
        blocked++;
        if (r.category !== null) {
          byCategory[r.category] = (byCategory[r.category] ?? 0) + 1;
        }
      }
      if (r.trace.some((s) => s.phase === "cache")) cached++;
    }

    const topBlocked = [...this.blockCountMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([domain, count]) => ({ domain, count }));

    const topAllowed = [...this.allowCountMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([domain, count]) => ({ domain, count }));

    return {
      totalQueries: this.queryLog.length,
      allowed,
      blocked,
      cached,
      byCategory,
      topBlocked,
      topAllowed,
    };
  }

  /** DNS クエリを処理する */
  resolve(query: DnsQuery): FilterResult {
    this.tick++;
    const trace: FilterStep[] = [];

    // 1. クエリ受信
    trace.push({
      phase: "receive",
      detail: `クエリ受信: ${query.domain} (${query.type}) from ${query.clientIp}`,
      result: "info",
    });

    const domain = query.domain.toLowerCase();

    // 2. 許可リストチェック（最優先）
    if (this.matchesAllowlist(domain)) {
      trace.push({
        phase: "allowlist",
        detail: `"${domain}" は許可リストに一致 → フィルタをバイパス`,
        result: "allow",
      });
      return this.resolveUpstream(query, domain, trace, "allowlist match");
    }
    trace.push({ phase: "allowlist", detail: "許可リストに一致なし", result: "pass" });

    // 3. カスタムブロックチェック
    if (this.matchesCustomBlock(domain)) {
      trace.push({
        phase: "custom",
        detail: `"${domain}" はカスタムブロックリストに一致`,
        result: "block",
      });
      return this.blocked(query, domain, "custom", `custom: ${domain}`, trace);
    }
    trace.push({ phase: "custom", detail: "カスタムブロックに一致なし", result: "pass" });

    // 4. ブロックリスト + カテゴリチェック
    const blockMatch = this.matchesBlocklist(domain);
    if (blockMatch !== null) {
      if (this.policy.blockedCategories.includes(blockMatch.category)) {
        trace.push({
          phase: "blocklist",
          detail: `"${domain}" → カテゴリ "${blockMatch.category}" がブロックリストに一致`,
          result: "info",
        });
        trace.push({
          phase: "category",
          detail: `カテゴリ "${blockMatch.category}" はブロック対象`,
          result: "block",
        });
        return this.blocked(query, domain, blockMatch.category, `${blockMatch.category}: ${blockMatch.domain}`, trace);
      }
      trace.push({
        phase: "blocklist",
        detail: `"${domain}" → カテゴリ "${blockMatch.category}" (ブロック対象外)`,
        result: "pass",
      });
      trace.push({
        phase: "category",
        detail: `カテゴリ "${blockMatch.category}" は有効なフィルタ対象外 → 許可`,
        result: "pass",
      });
    } else {
      trace.push({ phase: "blocklist", detail: "ブロックリストに一致なし", result: "pass" });
    }

    // 5. 上流 DNS へフォワード
    return this.resolveUpstream(query, domain, trace, null);
  }

  /** ログをリセットする */
  reset(): void {
    this.queryLog = [];
    this.blockCountMap.clear();
    this.allowCountMap.clear();
    this.cache.clear();
    this.tick = 0;
  }

  /** 許可リストに一致するか */
  private matchesAllowlist(domain: string): boolean {
    return this.policy.allowlist.some((a) => domain === a || domain.endsWith(`.${a}`));
  }

  /** カスタムブロックに一致するか */
  private matchesCustomBlock(domain: string): boolean {
    return this.policy.customBlocks.some((b) => b === "*" || domain === b || domain.endsWith(`.${b}`));
  }

  /** ブロックリストに一致するか */
  private matchesBlocklist(domain: string): BlockEntry | null {
    for (const entry of this.policy.blocklist) {
      if (domain === entry.domain || domain.endsWith(`.${entry.domain}`)) {
        return entry;
      }
    }
    return null;
  }

  /** 上流 DNS を引いて応答する */
  private resolveUpstream(
    query: DnsQuery,
    domain: string,
    trace: FilterStep[],
    matchedRule: string | null,
  ): FilterResult {
    // キャッシュチェック
    const cacheKey = `${domain}:${query.type}`;
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined && this.tick - cached.cachedAt < cached.ttl) {
      trace.push({
        phase: "cache",
        detail: `キャッシュヒット: ${domain} → ${cached.answer} (TTL 残り ${cached.ttl - (this.tick - cached.cachedAt)})`,
        result: "info",
      });
      trace.push({ phase: "response", detail: `応答: ${cached.answer} (キャッシュ, 1ms)`, result: "allow" });
      const result: FilterResult = {
        query, allowed: true, action: "ALLOW", answer: cached.answer,
        category: null, matchedRule, trace, latencyMs: 1,
      };
      this.queryLog.push(result);
      this.allowCountMap.set(domain, (this.allowCountMap.get(domain) ?? 0) + 1);
      return result;
    }

    // 上流へフォワード
    trace.push({ phase: "upstream", detail: `上流 DNS (8.8.8.8) へフォワード: ${domain} ${query.type}`, result: "info" });

    const record = this.upstream.find((r) => r.domain === domain && r.type === query.type);
    if (record !== undefined) {
      this.cache.set(cacheKey, { answer: record.value, ttl: record.ttl, cachedAt: this.tick });
      trace.push({ phase: "upstream", detail: `応答: ${record.value} (TTL=${record.ttl})`, result: "allow" });
      trace.push({ phase: "response", detail: `応答: ${record.value} (${15 + Math.floor(Math.random() * 30)}ms)`, result: "allow" });
      const result: FilterResult = {
        query, allowed: true, action: "ALLOW", answer: record.value,
        category: null, matchedRule, trace, latencyMs: 15 + Math.floor(Math.random() * 30),
      };
      this.queryLog.push(result);
      this.allowCountMap.set(domain, (this.allowCountMap.get(domain) ?? 0) + 1);
      return result;
    }

    // NXDOMAIN（存在しないドメイン）
    trace.push({ phase: "upstream", detail: `上流から NXDOMAIN: ${domain} は存在しない`, result: "info" });
    trace.push({ phase: "response", detail: "応答: NXDOMAIN", result: "info" });
    const result: FilterResult = {
      query, allowed: true, action: "ALLOW", answer: null,
      category: null, matchedRule, trace, latencyMs: 20,
    };
    this.queryLog.push(result);
    return result;
  }

  /** ブロック応答を生成する */
  private blocked(
    query: DnsQuery,
    domain: string,
    category: Category,
    matchedRule: string,
    trace: FilterStep[],
  ): FilterResult {
    const action = this.policy.blockAction;
    let answer: string | null;
    switch (action) {
      case "NXDOMAIN": answer = null; break;
      case "0.0.0.0":  answer = "0.0.0.0"; break;
      case "REFUSED":   answer = null; break;
    }
    trace.push({ phase: "response", detail: `ブロック応答: ${action} (0ms)`, result: "block" });
    const result: FilterResult = {
      query, allowed: false, action, answer,
      category, matchedRule, trace, latencyMs: 0,
    };
    this.queryLog.push(result);
    this.blockCountMap.set(domain, (this.blockCountMap.get(domain) ?? 0) + 1);
    return result;
  }
}
