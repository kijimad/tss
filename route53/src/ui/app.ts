import { Route53Engine } from "../engine/route53.js";
import type { HostedZone, HealthCheck, DnsQuery, R53Result, R53Trace } from "../engine/route53.js";

export interface Example {
  name: string;
  description: string;
  zones: HostedZone[];
  queries: DnsQuery[];
}

const q = (name: string, type: "A" | "CNAME" | "MX" = "A", region = "ap-northeast-1", continent = "AS", country = "JP"): DnsQuery => ({
  name, type, clientRegion: region, clientContinent: continent, clientCountry: country,
});

const hc = (id: string, endpoint: string, healthy: boolean, failures = 0): HealthCheck => ({
  id, type: "HTTP", endpoint, port: 80, path: "/health", interval: 30, failureThreshold: 3,
  healthy, consecutiveFailures: failures,
});

export const EXAMPLES: Example[] = [
  {
    name: "Simple ルーティング",
    description: "最も基本的なルーティング。1 レコードに複数 IP を設定し、ラウンドロビンで返却。",
    zones: [{
      id: "Z001", name: "example.com", private: false, healthChecks: [],
      records: [
        { name: "www.example.com", type: "A", ttl: 300, values: ["93.184.216.34", "93.184.216.35"], routing: { type: "simple" }, healthCheckId: null },
        { name: "example.com", type: "MX", ttl: 3600, values: ["10 mail.example.com"], routing: { type: "simple" }, healthCheckId: null },
        { name: "example.com", type: "TXT", ttl: 3600, values: ['"v=spf1 include:_spf.google.com ~all"'], routing: { type: "simple" }, healthCheckId: null },
      ],
    }],
    queries: [q("www.example.com"), q("www.example.com"), q("example.com", "MX"), q("unknown.example.com")],
  },
  {
    name: "Weighted ルーティング (重み付け)",
    description: "90% を本番 (v2)、10% をカナリア (v3) に振り分け。ブルーグリーンデプロイに使用。",
    zones: [{
      id: "Z002", name: "app.example.com", private: false, healthChecks: [hc("hc-v2", "10.0.1.10", true), hc("hc-v3", "10.0.2.10", true)],
      records: [
        { name: "app.example.com", type: "A", ttl: 60, values: ["10.0.1.10"], routing: { type: "weighted", weight: 90, setId: "v2-prod" }, healthCheckId: "hc-v2" },
        { name: "app.example.com", type: "A", ttl: 60, values: ["10.0.2.10"], routing: { type: "weighted", weight: 10, setId: "v3-canary" }, healthCheckId: "hc-v3" },
      ],
    }],
    queries: [q("app.example.com"), q("app.example.com"), q("app.example.com"), q("app.example.com"), q("app.example.com")],
  },
  {
    name: "Latency ルーティング (遅延ベース)",
    description: "クライアントに最も遅延が少ないリージョンのエンドポイントを返却。東京・バージニア・フランクフルトの 3 リージョン。",
    zones: [{
      id: "Z003", name: "global.example.com", private: false, healthChecks: [hc("hc-tokyo", "10.1.0.1", true), hc("hc-virginia", "10.2.0.1", true), hc("hc-frankfurt", "10.3.0.1", true)],
      records: [
        { name: "api.global.example.com", type: "A", ttl: 60, values: ["10.1.0.1"], routing: { type: "latency", region: "ap-northeast-1", setId: "tokyo" }, healthCheckId: "hc-tokyo" },
        { name: "api.global.example.com", type: "A", ttl: 60, values: ["10.2.0.1"], routing: { type: "latency", region: "us-east-1", setId: "virginia" }, healthCheckId: "hc-virginia" },
        { name: "api.global.example.com", type: "A", ttl: 60, values: ["10.3.0.1"], routing: { type: "latency", region: "eu-central-1", setId: "frankfurt" }, healthCheckId: "hc-frankfurt" },
      ],
    }],
    queries: [
      q("api.global.example.com", "A", "ap-northeast-1", "AS", "JP"),
      q("api.global.example.com", "A", "us-east-1", "NA", "US"),
      q("api.global.example.com", "A", "eu-west-1", "EU", "IE"),
      q("api.global.example.com", "A", "sa-east-1", "SA", "BR"),
    ],
  },
  {
    name: "Failover ルーティング (障害時切替)",
    description: "PRIMARY がダウンすると自動で SECONDARY にフォールバック。DR (災害復旧) パターン。",
    zones: [{
      id: "Z004", name: "ha.example.com", private: false,
      healthChecks: [hc("hc-primary", "10.0.1.1", false, 5), hc("hc-secondary", "10.0.2.1", true)],
      records: [
        { name: "ha.example.com", type: "A", ttl: 60, values: ["10.0.1.1"], routing: { type: "failover", role: "PRIMARY", setId: "primary" }, healthCheckId: "hc-primary" },
        { name: "ha.example.com", type: "A", ttl: 60, values: ["10.0.2.1"], routing: { type: "failover", role: "SECONDARY", setId: "secondary" }, healthCheckId: "hc-secondary" },
      ],
    }],
    queries: [q("ha.example.com"), q("ha.example.com")],
  },
  {
    name: "Geolocation ルーティング (地理的)",
    description: "クライアントの国/大陸に応じて異なるエンドポイントを返却。コンテンツのローカライズやコンプライアンスに使用。",
    zones: [{
      id: "Z005", name: "geo.example.com", private: false, healthChecks: [],
      records: [
        { name: "geo.example.com", type: "A", ttl: 300, values: ["10.1.0.1"], routing: { type: "geolocation", country: "JP", setId: "japan" }, healthCheckId: null },
        { name: "geo.example.com", type: "A", ttl: 300, values: ["10.2.0.1"], routing: { type: "geolocation", country: "US", setId: "usa" }, healthCheckId: null },
        { name: "geo.example.com", type: "A", ttl: 300, values: ["10.3.0.1"], routing: { type: "geolocation", continent: "EU", setId: "europe" }, healthCheckId: null },
        { name: "geo.example.com", type: "A", ttl: 300, values: ["10.9.0.1"], routing: { type: "geolocation", setId: "default" }, healthCheckId: null },
      ],
    }],
    queries: [
      q("geo.example.com", "A", "ap-northeast-1", "AS", "JP"),
      q("geo.example.com", "A", "us-east-1", "NA", "US"),
      q("geo.example.com", "A", "eu-central-1", "EU", "DE"),
      q("geo.example.com", "A", "ap-southeast-1", "AS", "SG"),
    ],
  },
  {
    name: "Multivalue Answer + ヘルスチェック",
    description: "最大 8 件の healthy なレコードを返却。クライアント側でランダム選択。簡易ロードバランシング。",
    zones: [{
      id: "Z006", name: "multi.example.com", private: false,
      healthChecks: [hc("hc-1", "10.0.0.1", true), hc("hc-2", "10.0.0.2", false, 3), hc("hc-3", "10.0.0.3", true), hc("hc-4", "10.0.0.4", true)],
      records: [
        { name: "multi.example.com", type: "A", ttl: 60, values: ["10.0.0.1"], routing: { type: "multivalue", setId: "srv-1" }, healthCheckId: "hc-1" },
        { name: "multi.example.com", type: "A", ttl: 60, values: ["10.0.0.2"], routing: { type: "multivalue", setId: "srv-2" }, healthCheckId: "hc-2" },
        { name: "multi.example.com", type: "A", ttl: 60, values: ["10.0.0.3"], routing: { type: "multivalue", setId: "srv-3" }, healthCheckId: "hc-3" },
        { name: "multi.example.com", type: "A", ttl: 60, values: ["10.0.0.4"], routing: { type: "multivalue", setId: "srv-4" }, healthCheckId: "hc-4" },
      ],
    }],
    queries: [q("multi.example.com"), q("multi.example.com")],
  },
  {
    name: "ALIAS レコード (CloudFront/ELB)",
    description: "Zone Apex (example.com) で CloudFront ディストリビューションを指す ALIAS レコード。CNAME と違いルートドメインで使用可能。",
    zones: [{
      id: "Z007", name: "alias.example.com", private: false, healthChecks: [],
      records: [
        { name: "alias.example.com", type: "A", ttl: 60, values: ["13.32.0.1"],
          routing: { type: "simple" }, healthCheckId: null,
          aliasTarget: { dnsName: "d1234.cloudfront.net", hostedZoneId: "Z2FDTNDATAQYW2", evaluateHealth: true } },
      ],
    }],
    queries: [q("alias.example.com")],
  },
];

function phaseColor(p: R53Trace["phase"]): string {
  switch (p) {
    case "query":        return "#60a5fa";
    case "zone_match":   return "#06b6d4";
    case "record_match": return "#a78bfa";
    case "health_check": return "#22c55e";
    case "routing":      return "#f59e0b";
    case "weighted":     return "#f59e0b";
    case "latency":      return "#3b82f6";
    case "failover":     return "#ef4444";
    case "geo":          return "#ec4899";
    case "geoprox":      return "#8b5cf6";
    case "multivalue":   return "#10b981";
    case "alias":        return "#06b6d4";
    case "answer":       return "#22c55e";
    case "nxdomain":     return "#ef4444";
    case "ttl":          return "#64748b";
  }
}

export class R53App {
  init(container: HTMLElement): void {
    container.style.cssText = "display:flex;flex-direction:column;height:100vh;font-family:'Fira Code','Cascadia Code',monospace;background:#0f172a;color:#e2e8f0;";

    const header = document.createElement("div");
    header.style.cssText = "padding:8px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #1e293b;flex-wrap:wrap;";
    const title = document.createElement("h1");
    title.textContent = "Route 53 Simulator";
    title.style.cssText = "margin:0;font-size:15px;color:#8b5cf6;";
    header.appendChild(title);

    const exSelect = document.createElement("select");
    exSelect.style.cssText = "padding:4px 8px;background:#1e293b;border:1px solid #334155;border-radius:4px;color:#f8fafc;font-size:12px;";
    for (let i = 0; i < EXAMPLES.length; i++) { const o = document.createElement("option"); o.value = String(i); o.textContent = EXAMPLES[i]!.name; exSelect.appendChild(o); }
    header.appendChild(exSelect);

    const runBtn = document.createElement("button");
    runBtn.textContent = "\u25B6 Resolve All";
    runBtn.style.cssText = "padding:4px 16px;background:#8b5cf6;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;";
    header.appendChild(runBtn);

    const descSpan = document.createElement("span");
    descSpan.style.cssText = "font-size:10px;color:#64748b;margin-left:auto;max-width:400px;";
    header.appendChild(descSpan);
    container.appendChild(header);

    const main = document.createElement("div");
    main.style.cssText = "flex:1;display:flex;overflow:hidden;";

    // 左: ゾーン設定
    const leftPanel = document.createElement("div");
    leftPanel.style.cssText = "width:340px;display:flex;flex-direction:column;border-right:1px solid #1e293b;overflow-y:auto;font-size:10px;";
    const zoneLabel = document.createElement("div");
    zoneLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#8b5cf6;border-bottom:1px solid #1e293b;";
    zoneLabel.textContent = "Hosted Zone & Records";
    leftPanel.appendChild(zoneLabel);
    const zoneDiv = document.createElement("div");
    zoneDiv.style.cssText = "padding:8px 12px;";
    leftPanel.appendChild(zoneDiv);
    main.appendChild(leftPanel);

    // 中央: 結果
    const centerPanel = document.createElement("div");
    centerPanel.style.cssText = "flex:1;display:flex;flex-direction:column;border-right:1px solid #1e293b;";
    const resLabel = document.createElement("div");
    resLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#e2e8f0;border-bottom:1px solid #1e293b;";
    resLabel.textContent = "DNS Resolution Results";
    centerPanel.appendChild(resLabel);
    const resDiv = document.createElement("div");
    resDiv.style.cssText = "flex:1;padding:4px 8px;font-size:10px;overflow-y:auto;";
    centerPanel.appendChild(resDiv);
    main.appendChild(centerPanel);

    // 右: トレース
    const rightPanel = document.createElement("div");
    rightPanel.style.cssText = "width:440px;display:flex;flex-direction:column;";
    const trLabel = document.createElement("div");
    trLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#22c55e;border-bottom:1px solid #1e293b;";
    trLabel.textContent = "Resolution Trace (click)";
    rightPanel.appendChild(trLabel);
    const trDiv = document.createElement("div");
    trDiv.style.cssText = "flex:1;padding:4px 8px;font-size:9px;overflow-y:auto;line-height:1.6;";
    rightPanel.appendChild(trDiv);
    main.appendChild(rightPanel);
    container.appendChild(main);

    // ── 描画 ──

    const renderZones = (zones: HostedZone[]) => {
      zoneDiv.innerHTML = "";
      for (const z of zones) {
        const zEl = document.createElement("div");
        zEl.style.cssText = "margin-bottom:10px;";
        zEl.innerHTML = `<div style="color:#8b5cf6;font-weight:600;margin-bottom:4px;">\u{1F310} ${z.name} (${z.id})</div>`;
        for (const r of z.records) {
          const routing = r.routing.type !== "simple" ? ` <span style="color:#f59e0b;font-size:8px;">[${r.routing.type}${r.routing.type === "weighted" && r.routing.type === "weighted" ? `:${(r.routing as {weight:number}).weight}` : ""}]</span>` : "";
          const hcTag = r.healthCheckId ? ` <span style="color:#22c55e;font-size:8px;">[HC]</span>` : "";
          const alias = r.aliasTarget ? ` <span style="color:#06b6d4;font-size:8px;">[ALIAS→${r.aliasTarget.dnsName}]</span>` : "";
          zEl.innerHTML += `<div style="padding:2px 6px;margin-bottom:1px;border-left:2px solid #334155;">` +
            `<span style="color:#3b82f6;">${r.type}</span> <span style="color:#e2e8f0;">${r.name}</span>` +
            ` → <span style="color:#94a3b8;">${r.values.join(", ")}</span> <span style="color:#64748b;">TTL=${r.ttl}</span>${routing}${hcTag}${alias}</div>`;
        }
        if (z.healthChecks.length > 0) {
          zEl.innerHTML += `<div style="color:#22c55e;font-weight:600;margin-top:4px;">Health Checks:</div>`;
          for (const hc of z.healthChecks) {
            const color = hc.healthy ? "#22c55e" : "#ef4444";
            zEl.innerHTML += `<div style="padding-left:8px;color:${color};">${hc.healthy ? "\u2714" : "\u2718"} ${hc.id}: ${hc.type}://${hc.endpoint}:${hc.port}${hc.path}${hc.healthy ? "" : ` (failures=${hc.consecutiveFailures})`}</div>`;
          }
        }
        zoneDiv.appendChild(zEl);
      }
    };

    const renderResults = (results: R53Result[]) => {
      resDiv.innerHTML = "";
      for (const r of results) {
        const el = document.createElement("div");
        const ok = r.answers.length > 0;
        const border = ok ? "#22c55e" : "#ef4444";
        el.style.cssText = `padding:5px 8px;margin-bottom:3px;border:1px solid ${border}44;border-radius:4px;background:${border}06;cursor:pointer;`;
        el.innerHTML =
          `<div style="display:flex;justify-content:space-between;">` +
          `<span style="color:#e2e8f0;font-weight:600;">${r.query.name} ${r.query.type}</span>` +
          `<span style="color:${border};font-weight:600;">${ok ? r.answers.join(", ") : "NXDOMAIN"}</span></div>` +
          `<div style="color:#64748b;font-size:9px;">from=${r.query.clientRegion} (${r.query.clientCountry}) | routing=${r.routingUsed} | healthy=${r.healthyRecords}/${r.totalRecords} | TTL=${r.ttl}s</div>`;
        el.addEventListener("click", () => renderTrace(r.trace));
        resDiv.appendChild(el);
      }
    };

    const renderTrace = (trace: R53Trace[]) => {
      trDiv.innerHTML = "";
      for (const step of trace) {
        const el = document.createElement("div");
        el.style.cssText = "display:flex;gap:4px;align-items:flex-start;margin-bottom:2px;";
        const color = phaseColor(step.phase);
        el.innerHTML =
          `<span style="min-width:80px;padding:0 3px;border-radius:2px;font-size:8px;font-weight:600;text-align:center;color:${color};background:${color}15;border:1px solid ${color}33;">${step.phase}</span>` +
          `<span style="color:#cbd5e1;">${step.detail}</span>`;
        trDiv.appendChild(el);
      }
    };

    const loadExample = (ex: Example) => {
      descSpan.textContent = ex.description;
      renderZones(ex.zones);
      resDiv.innerHTML = ""; trDiv.innerHTML = "";
    };

    const runSim = (ex: Example) => {
      const engine = new Route53Engine(ex.zones);
      renderZones(ex.zones);
      const results = ex.queries.map((q) => engine.resolve(q));
      renderResults(results);
      if (results[0]) renderTrace(results[0].trace);
    };

    exSelect.addEventListener("change", () => { const ex = EXAMPLES[Number(exSelect.value)]; if (ex) loadExample(ex); });
    runBtn.addEventListener("click", () => { const ex = EXAMPLES[Number(exSelect.value)]; if (ex) runSim(ex); });
    loadExample(EXAMPLES[0]!);
  }
}
