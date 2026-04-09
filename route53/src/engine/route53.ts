/**
 * route53.ts — Amazon Route 53 シミュレーション
 *
 * DNS ホスティング + 7 種のルーティングポリシー + ヘルスチェック
 *
 * ルーティングポリシー:
 *   Simple, Weighted, Latency, Failover, Geolocation,
 *   Geoproximity, Multivalue Answer
 */

// ── レコード型 ──

export type RecordType = "A" | "AAAA" | "CNAME" | "MX" | "TXT" | "NS" | "SOA" | "ALIAS";

export type RoutingPolicy =
  | { type: "simple" }
  | { type: "weighted"; weight: number; setId: string }
  | { type: "latency"; region: string; setId: string }
  | { type: "failover"; role: "PRIMARY" | "SECONDARY"; setId: string }
  | { type: "geolocation"; continent?: string; country?: string; setId: string }
  | { type: "geoproximity"; region: string; bias: number; setId: string }
  | { type: "multivalue"; setId: string };

export interface ResourceRecord {
  name: string;
  type: RecordType;
  ttl: number;
  values: string[];
  routing: RoutingPolicy;
  /** ヘルスチェック ID (null なら常に healthy) */
  healthCheckId: string | null;
  /** エイリアスターゲット (ALIAS レコード用) */
  aliasTarget?: { dnsName: string; hostedZoneId: string; evaluateHealth: boolean };
}

// ── ヘルスチェック ──

export interface HealthCheck {
  id: string;
  type: "HTTP" | "HTTPS" | "TCP";
  endpoint: string;
  port: number;
  path: string;
  interval: number;
  failureThreshold: number;
  /** 現在の状態 */
  healthy: boolean;
  /** 連続失敗回数 */
  consecutiveFailures: number;
}

// ── ホストゾーン ──

export interface HostedZone {
  id: string;
  name: string;
  /** パブリック or プライベート */
  private: boolean;
  records: ResourceRecord[];
  healthChecks: HealthCheck[];
}

// ── DNS クエリ ──

export interface DnsQuery {
  name: string;
  type: RecordType;
  /** クライアントのリージョン (Latency/Geolocation 用) */
  clientRegion: string;
  /** クライアントの大陸 */
  clientContinent: string;
  /** クライアントの国 */
  clientCountry: string;
  /** クライアントの座標 (Geoproximity 用) */
  clientLat?: number;
  clientLon?: number;
}

// ── 解決トレース ──

export interface R53Trace {
  phase: "query" | "zone_match" | "record_match" | "health_check" | "routing" |
    "weighted" | "latency" | "failover" | "geo" | "geoprox" | "multivalue" |
    "alias" | "answer" | "nxdomain" | "ttl";
  detail: string;
}

export interface R53Result {
  query: DnsQuery;
  answers: string[];
  ttl: number;
  trace: R53Trace[];
  routingUsed: string;
  healthyRecords: number;
  totalRecords: number;
}

// ── リージョン遅延テーブル (ms) ──

const LATENCY_TABLE: Record<string, Record<string, number>> = {
  "ap-northeast-1": { "ap-northeast-1": 2, "ap-southeast-1": 60, "us-east-1": 150, "us-west-2": 120, "eu-west-1": 220, "eu-central-1": 230, "sa-east-1": 280 },
  "ap-southeast-1": { "ap-northeast-1": 60, "ap-southeast-1": 2, "us-east-1": 200, "us-west-2": 170, "eu-west-1": 180, "eu-central-1": 190, "sa-east-1": 320 },
  "us-east-1":      { "ap-northeast-1": 150, "ap-southeast-1": 200, "us-east-1": 2, "us-west-2": 70, "eu-west-1": 80, "eu-central-1": 90, "sa-east-1": 130 },
  "us-west-2":      { "ap-northeast-1": 120, "ap-southeast-1": 170, "us-east-1": 70, "us-west-2": 2, "eu-west-1": 140, "eu-central-1": 150, "sa-east-1": 180 },
  "eu-west-1":      { "ap-northeast-1": 220, "ap-southeast-1": 180, "us-east-1": 80, "us-west-2": 140, "eu-west-1": 2, "eu-central-1": 15, "sa-east-1": 200 },
  "eu-central-1":   { "ap-northeast-1": 230, "ap-southeast-1": 190, "us-east-1": 90, "us-west-2": 150, "eu-west-1": 15, "eu-central-1": 2, "sa-east-1": 210 },
  "sa-east-1":      { "ap-northeast-1": 280, "ap-southeast-1": 320, "us-east-1": 130, "us-west-2": 180, "eu-west-1": 200, "eu-central-1": 210, "sa-east-1": 2 },
};

/** 2 リージョン間の遅延を取得 */
function getLatency(from: string, to: string): number {
  return LATENCY_TABLE[from]?.[to] ?? 999;
}

// ── Route 53 エンジン ──

export class Route53Engine {
  private zones: HostedZone[];

  constructor(zones: HostedZone[]) {
    this.zones = zones;
  }

  get hostedZones(): HostedZone[] {
    return this.zones;
  }

  /** DNS クエリを解決する */
  resolve(query: DnsQuery): R53Result {
    const trace: R53Trace[] = [];
    trace.push({ phase: "query", detail: `${query.name} ${query.type} (from ${query.clientRegion}, ${query.clientCountry})` });

    // 1. ホストゾーンマッチ
    const zone = this.findZone(query.name);
    if (zone === undefined) {
      trace.push({ phase: "nxdomain", detail: `ホストゾーンが見つからない → NXDOMAIN` });
      return { query, answers: [], ttl: 0, trace, routingUsed: "none", healthyRecords: 0, totalRecords: 0 };
    }
    trace.push({ phase: "zone_match", detail: `ホストゾーン: ${zone.name} (${zone.id})` });

    // 2. レコードマッチ
    const records = zone.records.filter((r) => r.name === query.name && (r.type === query.type || r.type === "ALIAS" || r.type === "CNAME"));
    if (records.length === 0) {
      trace.push({ phase: "nxdomain", detail: `${query.name} ${query.type} のレコードなし → NXDOMAIN` });
      return { query, answers: [], ttl: 0, trace, routingUsed: "none", healthyRecords: 0, totalRecords: records.length };
    }
    trace.push({ phase: "record_match", detail: `${records.length} レコード候補` });

    // 3. ヘルスチェックフィルタ
    const healthyRecords = records.filter((r) => {
      if (r.healthCheckId === null) return true;
      const hc = zone.healthChecks.find((h) => h.id === r.healthCheckId);
      if (hc === undefined) return true;
      const ok = hc.healthy;
      trace.push({ phase: "health_check", detail: `HC "${hc.id}" (${hc.type}://${hc.endpoint}:${hc.port}${hc.path}): ${ok ? "\u2714 Healthy" : "\u2718 Unhealthy (failures=${hc.consecutiveFailures})"}` });
      return ok;
    });
    trace.push({ phase: "health_check", detail: `Healthy: ${healthyRecords.length}/${records.length}` });

    const totalRecords = records.length;
    const candidateRecords = healthyRecords.length > 0 ? healthyRecords : records;

    // 4. ルーティングポリシー適用
    const routingType = candidateRecords[0]?.routing.type ?? "simple";
    let selectedValues: string[] = [];
    let ttl = candidateRecords[0]?.ttl ?? 300;
    let routingUsed = routingType;

    switch (routingType) {
      case "simple":
        selectedValues = candidateRecords.flatMap((r) => r.values);
        trace.push({ phase: "routing", detail: `Simple: 全レコード返却 (${selectedValues.length} 件)` });
        break;

      case "weighted": {
        const totalWeight = candidateRecords.reduce((s, r) => s + (r.routing.type === "weighted" ? r.routing.weight : 0), 0);
        let rand = Math.random() * totalWeight;
        for (const r of candidateRecords) {
          if (r.routing.type !== "weighted") continue;
          rand -= r.routing.weight;
          if (rand <= 0) {
            selectedValues = r.values;
            ttl = r.ttl;
            trace.push({ phase: "weighted", detail: `Weighted: setId="${r.routing.setId}" weight=${r.routing.weight}/${totalWeight} → 選択` });
            break;
          }
          trace.push({ phase: "weighted", detail: `Weighted: setId="${r.routing.setId}" weight=${r.routing.weight}/${totalWeight} → スキップ` });
        }
        routingUsed = "weighted";
        break;
      }

      case "latency": {
        let bestLatency = Infinity;
        let bestRecord: ResourceRecord | null = null;
        for (const r of candidateRecords) {
          if (r.routing.type !== "latency") continue;
          const lat = getLatency(query.clientRegion, r.routing.region);
          trace.push({ phase: "latency", detail: `Latency: ${r.routing.setId} (${r.routing.region}) → ${lat}ms from ${query.clientRegion}` });
          if (lat < bestLatency) { bestLatency = lat; bestRecord = r; }
        }
        if (bestRecord !== null) {
          selectedValues = bestRecord.values;
          ttl = bestRecord.ttl;
          trace.push({ phase: "latency", detail: `最小遅延: ${bestLatency}ms → 選択` });
        }
        routingUsed = "latency";
        break;
      }

      case "failover": {
        const primary = candidateRecords.find((r) => r.routing.type === "failover" && r.routing.role === "PRIMARY");
        const secondary = candidateRecords.find((r) => r.routing.type === "failover" && r.routing.role === "SECONDARY");
        if (primary !== undefined) {
          selectedValues = primary.values;
          ttl = primary.ttl;
          trace.push({ phase: "failover", detail: `Failover: PRIMARY (${primary.values.join(",")}) → 使用` });
        } else if (secondary !== undefined) {
          selectedValues = secondary.values;
          ttl = secondary.ttl;
          trace.push({ phase: "failover", detail: `Failover: PRIMARY unhealthy → SECONDARY (${secondary.values.join(",")}) にフォールバック` });
        }
        routingUsed = "failover";
        break;
      }

      case "geolocation": {
        let matched: ResourceRecord | null = null;
        // 国 → 大陸 → デフォルト の順で探す
        for (const r of candidateRecords) {
          if (r.routing.type !== "geolocation") continue;
          if (r.routing.country === query.clientCountry) {
            matched = r;
            trace.push({ phase: "geo", detail: `Geolocation: 国 "${query.clientCountry}" にマッチ (${r.routing.setId})` });
            break;
          }
        }
        if (matched === null) {
          for (const r of candidateRecords) {
            if (r.routing.type !== "geolocation") continue;
            if (r.routing.continent === query.clientContinent) {
              matched = r;
              trace.push({ phase: "geo", detail: `Geolocation: 大陸 "${query.clientContinent}" にマッチ (${r.routing.setId})` });
              break;
            }
          }
        }
        if (matched === null) {
          matched = candidateRecords.find((r) => r.routing.type === "geolocation" && r.routing.country === undefined && r.routing.continent === undefined) ?? candidateRecords[0] ?? null;
          if (matched !== null) trace.push({ phase: "geo", detail: `Geolocation: デフォルトレコードにフォールバック` });
        }
        if (matched !== null) { selectedValues = matched.values; ttl = matched.ttl; }
        routingUsed = "geolocation";
        break;
      }

      case "geoproximity": {
        // 簡略版: リージョンの遅延ベースで近さを推定
        let bestScore = Infinity;
        let bestRec: ResourceRecord | null = null;
        for (const r of candidateRecords) {
          if (r.routing.type !== "geoproximity") continue;
          const lat = getLatency(query.clientRegion, r.routing.region);
          const score = lat - r.routing.bias;
          trace.push({ phase: "geoprox", detail: `Geoproximity: ${r.routing.setId} (${r.routing.region}) latency=${lat}ms bias=${r.routing.bias} → score=${score}` });
          if (score < bestScore) { bestScore = score; bestRec = r; }
        }
        if (bestRec !== null) { selectedValues = bestRec.values; ttl = bestRec.ttl; }
        routingUsed = "geoproximity";
        break;
      }

      case "multivalue": {
        selectedValues = candidateRecords.flatMap((r) => r.values);
        // 最大 8 件
        if (selectedValues.length > 8) selectedValues = selectedValues.slice(0, 8);
        trace.push({ phase: "multivalue", detail: `Multivalue: ${selectedValues.length} レコード返却 (max 8)` });
        routingUsed = "multivalue";
        break;
      }
    }

    // 5. ALIAS 解決
    for (const r of candidateRecords) {
      if (r.aliasTarget !== undefined) {
        trace.push({ phase: "alias", detail: `ALIAS → ${r.aliasTarget.dnsName} (zone: ${r.aliasTarget.hostedZoneId})` });
        if (selectedValues.length === 0) selectedValues = r.values;
      }
    }

    // 6. 回答
    if (selectedValues.length === 0) {
      trace.push({ phase: "nxdomain", detail: "回答なし → NXDOMAIN" });
    } else {
      trace.push({ phase: "answer", detail: `回答: ${selectedValues.join(", ")} (TTL=${ttl}s)` });
      trace.push({ phase: "ttl", detail: `TTL: ${ttl}s → クライアントキャッシュ` });
    }

    return { query, answers: selectedValues, ttl, trace, routingUsed, healthyRecords: healthyRecords.length, totalRecords };
  }

  /** ホストゾーンを探す (最長一致) */
  private findZone(name: string): HostedZone | undefined {
    let best: HostedZone | undefined;
    let bestLen = 0;
    for (const z of this.zones) {
      if ((name === z.name || name.endsWith("." + z.name)) && z.name.length > bestLen) {
        best = z;
        bestLen = z.name.length;
      }
    }
    return best;
  }
}
