import { DnsFilterServer } from "../filter/server.js";
import type {
  FilterPolicy, DnsQuery, FilterResult, FilterStep, FilterStats,
  UpstreamRecord, Category, BlockEntry,
} from "../filter/server.js";

export interface Example {
  name: string;
  description: string;
  policy: FilterPolicy;
  upstream: UpstreamRecord[];
  queries: DnsQuery[];
}

// ── 共通ブロックリスト ──
const ADS: BlockEntry[] = [
  { domain: "doubleclick.net", category: "ads" },
  { domain: "googlesyndication.com", category: "ads" },
  { domain: "ad.example.com", category: "ads" },
  { domain: "ads.youtube.com", category: "ads" },
  { domain: "pagead2.googlesyndication.com", category: "ads" },
  { domain: "adservice.google.com", category: "ads" },
];
const TRACKING: BlockEntry[] = [
  { domain: "analytics.google.com", category: "tracking" },
  { domain: "pixel.facebook.com", category: "tracking" },
  { domain: "t.co", category: "tracking" },
  { domain: "stats.example.com", category: "tracking" },
];
const MALWARE: BlockEntry[] = [
  { domain: "malware-c2.evil.com", category: "malware" },
  { domain: "phish-login.example.net", category: "phishing" },
  { domain: "ransomware-drop.xyz", category: "malware" },
  { domain: "keylogger.bad.org", category: "malware" },
  { domain: "fake-bank.phishing.com", category: "phishing" },
];
const SOCIAL: BlockEntry[] = [
  { domain: "facebook.com", category: "social" },
  { domain: "instagram.com", category: "social" },
  { domain: "twitter.com", category: "social" },
  { domain: "tiktok.com", category: "social" },
  { domain: "reddit.com", category: "social" },
];
const ADULT: BlockEntry[] = [
  { domain: "adult-site.example.com", category: "adult" },
  { domain: "nsfw.example.net", category: "adult" },
];
const GAMING: BlockEntry[] = [
  { domain: "store.steampowered.com", category: "gaming" },
  { domain: "discord.com", category: "gaming" },
  { domain: "twitch.tv", category: "gaming" },
];
const ALL_BLOCKS = [...ADS, ...TRACKING, ...MALWARE, ...SOCIAL, ...ADULT, ...GAMING];

// ── 共通上流レコード ──
const UPSTREAM: UpstreamRecord[] = [
  { domain: "example.com", type: "A", value: "93.184.216.34", ttl: 300 },
  { domain: "www.google.com", type: "A", value: "142.250.80.46", ttl: 120 },
  { domain: "github.com", type: "A", value: "140.82.121.3", ttl: 60 },
  { domain: "api.example.com", type: "A", value: "93.184.216.35", ttl: 300 },
  { domain: "cdn.example.com", type: "A", value: "93.184.216.36", ttl: 600 },
  { domain: "facebook.com", type: "A", value: "157.240.1.35", ttl: 120 },
  { domain: "instagram.com", type: "A", value: "157.240.1.174", ttl: 120 },
  { domain: "twitter.com", type: "A", value: "104.244.42.1", ttl: 120 },
  { domain: "tiktok.com", type: "A", value: "161.117.197.194", ttl: 120 },
  { domain: "reddit.com", type: "A", value: "151.101.1.140", ttl: 120 },
  { domain: "store.steampowered.com", type: "A", value: "23.50.49.33", ttl: 120 },
  { domain: "discord.com", type: "A", value: "162.159.128.233", ttl: 120 },
  { domain: "twitch.tv", type: "A", value: "151.101.66.167", ttl: 120 },
  { domain: "docs.google.com", type: "A", value: "142.250.80.46", ttl: 120 },
  { domain: "mail.google.com", type: "A", value: "142.250.80.46", ttl: 120 },
  { domain: "slack.com", type: "A", value: "54.230.88.1", ttl: 120 },
];

const CLIENT = "192.168.1.100";
const q = (domain: string): DnsQuery => ({ domain, type: "A", clientIp: CLIENT });

export const EXAMPLES: Example[] = [
  {
    name: "広告 + トラッキングブロック",
    description: "Pi-hole 風の広告ブロック。広告・トラッキングドメインを 0.0.0.0 で応答。",
    policy: {
      blockedCategories: ["ads", "tracking"],
      blocklist: [...ADS, ...TRACKING],
      allowlist: [],
      customBlocks: [],
      blockAction: "0.0.0.0",
    },
    upstream: UPSTREAM,
    queries: [
      q("www.google.com"),
      q("doubleclick.net"),
      q("pagead2.googlesyndication.com"),
      q("analytics.google.com"),
      q("github.com"),
      q("pixel.facebook.com"),
      q("example.com"),
      q("ads.youtube.com"),
    ],
  },
  {
    name: "マルウェア・フィッシング防御",
    description: "セキュリティ特化フィルタ。既知の悪性ドメインを NXDOMAIN で遮断。",
    policy: {
      blockedCategories: ["malware", "phishing"],
      blocklist: [...MALWARE, ...ADS],
      allowlist: [],
      customBlocks: [],
      blockAction: "NXDOMAIN",
    },
    upstream: UPSTREAM,
    queries: [
      q("github.com"),
      q("malware-c2.evil.com"),
      q("example.com"),
      q("phish-login.example.net"),
      q("fake-bank.phishing.com"),
      q("www.google.com"),
      q("ransomware-drop.xyz"),
      q("doubleclick.net"),
    ],
  },
  {
    name: "企業ネットワーク (SNS + ゲーム制限)",
    description: "業務時間中の SNS・ゲームサイトをブロック。業務ツールは許可リストでバイパス。",
    policy: {
      blockedCategories: ["social", "gaming", "ads", "adult"],
      blocklist: ALL_BLOCKS,
      allowlist: ["slack.com", "docs.google.com", "github.com"],
      customBlocks: [],
      blockAction: "REFUSED",
    },
    upstream: UPSTREAM,
    queries: [
      q("github.com"),
      q("slack.com"),
      q("facebook.com"),
      q("twitter.com"),
      q("discord.com"),
      q("store.steampowered.com"),
      q("docs.google.com"),
      q("tiktok.com"),
      q("doubleclick.net"),
      q("example.com"),
    ],
  },
  {
    name: "ペアレンタルコントロール",
    description: "アダルト・SNS・ゲームをブロック。マルウェア防御も有効。",
    policy: {
      blockedCategories: ["adult", "social", "gaming", "malware", "phishing"],
      blocklist: ALL_BLOCKS,
      allowlist: [],
      customBlocks: [],
      blockAction: "0.0.0.0",
    },
    upstream: UPSTREAM,
    queries: [
      q("www.google.com"),
      q("adult-site.example.com"),
      q("facebook.com"),
      q("twitch.tv"),
      q("github.com"),
      q("example.com"),
      q("instagram.com"),
      q("malware-c2.evil.com"),
    ],
  },
  {
    name: "ホワイトリストモード (厳格)",
    description: "全ドメインをカスタムブロックし、許可リストのドメインのみ通過。最も厳格な設定。",
    policy: {
      blockedCategories: [],
      blocklist: [],
      allowlist: ["example.com", "api.example.com", "cdn.example.com"],
      customBlocks: ["*"],
      blockAction: "NXDOMAIN",
    },
    upstream: UPSTREAM,
    queries: [
      q("example.com"),
      q("api.example.com"),
      q("www.google.com"),
      q("github.com"),
      q("facebook.com"),
      q("cdn.example.com"),
    ],
  },
  {
    name: "キャッシュ動作の確認",
    description: "同じドメインを複数回クエリし、キャッシュヒットの様子を確認。",
    policy: {
      blockedCategories: ["ads"],
      blocklist: ADS,
      allowlist: [],
      customBlocks: [],
      blockAction: "0.0.0.0",
    },
    upstream: UPSTREAM,
    queries: [
      q("github.com"),
      q("github.com"),
      q("github.com"),
      q("doubleclick.net"),
      q("doubleclick.net"),
      q("example.com"),
      q("example.com"),
      q("www.google.com"),
    ],
  },
];

// ── カスタムブロックのワイルドカード対応 ──
// server.ts の matchesCustomBlock は完全一致/サフィックス一致なので
// "*" は全ドメインにマッチさせるため、サーバ側のロジックを活用
// ("*" は任意のドメインのサフィックスにはならないが、
//  UIレベルで全ドメインを "custom" として追加する方法もある)
// ここでは server.ts を修正せず、"*" を特殊扱いする

function stepColor(phase: FilterStep["phase"]): string {
  switch (phase) {
    case "receive":   return "#60a5fa";
    case "allowlist":  return "#10b981";
    case "blocklist":  return "#f59e0b";
    case "category":   return "#a78bfa";
    case "custom":     return "#ec4899";
    case "upstream":   return "#06b6d4";
    case "response":   return "#e2e8f0";
    case "cache":      return "#fbbf24";
  }
}

function catColor(cat: Category): string {
  switch (cat) {
    case "ads":      return "#f59e0b";
    case "tracking": return "#a78bfa";
    case "malware":  return "#ef4444";
    case "phishing": return "#dc2626";
    case "social":   return "#3b82f6";
    case "adult":    return "#ec4899";
    case "gaming":   return "#10b981";
    case "custom":   return "#6b7280";
  }
}

export class DnsFilterApp {
  init(container: HTMLElement): void {
    container.style.cssText =
      "display:flex;flex-direction:column;height:100vh;font-family:'Fira Code','Cascadia Code',monospace;background:#0f172a;color:#e2e8f0;";

    // ── ヘッダ ──
    const header = document.createElement("div");
    header.style.cssText = "padding:8px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #1e293b;flex-wrap:wrap;";

    const title = document.createElement("h1");
    title.textContent = "DNS Filtering Server";
    title.style.cssText = "margin:0;font-size:15px;color:#10b981;";
    header.appendChild(title);

    const exSelect = document.createElement("select");
    exSelect.style.cssText = "padding:4px 8px;background:#1e293b;border:1px solid #334155;border-radius:4px;color:#f8fafc;font-size:12px;";
    for (let i = 0; i < EXAMPLES.length; i++) {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = EXAMPLES[i]!.name;
      exSelect.appendChild(opt);
    }
    header.appendChild(exSelect);

    const runBtn = document.createElement("button");
    runBtn.textContent = "\u25B6 Run All Queries";
    runBtn.style.cssText = "padding:4px 16px;background:#10b981;color:#0f172a;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;";
    header.appendChild(runBtn);

    const descSpan = document.createElement("span");
    descSpan.style.cssText = "font-size:10px;color:#64748b;margin-left:auto;max-width:400px;";
    header.appendChild(descSpan);

    container.appendChild(header);

    // ── メイン ──
    const main = document.createElement("div");
    main.style.cssText = "flex:1;display:flex;overflow:hidden;";

    // 左: ポリシー + 統計
    const leftPanel = document.createElement("div");
    leftPanel.style.cssText = "width:300px;display:flex;flex-direction:column;border-right:1px solid #1e293b;overflow-y:auto;";

    const policyLabel = document.createElement("div");
    policyLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#f59e0b;border-bottom:1px solid #1e293b;";
    policyLabel.textContent = "Filter Policy";
    leftPanel.appendChild(policyLabel);

    const policyDiv = document.createElement("div");
    policyDiv.style.cssText = "padding:8px 12px;font-size:10px;border-bottom:1px solid #1e293b;";
    leftPanel.appendChild(policyDiv);

    const statsLabel = document.createElement("div");
    statsLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#06b6d4;border-bottom:1px solid #1e293b;";
    statsLabel.textContent = "Statistics";
    leftPanel.appendChild(statsLabel);

    const statsDiv = document.createElement("div");
    statsDiv.style.cssText = "padding:8px 12px;font-size:10px;";
    leftPanel.appendChild(statsDiv);

    main.appendChild(leftPanel);

    // 中央: クエリ結果
    const centerPanel = document.createElement("div");
    centerPanel.style.cssText = "flex:1;display:flex;flex-direction:column;border-right:1px solid #1e293b;";

    const resultLabel = document.createElement("div");
    resultLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#e2e8f0;border-bottom:1px solid #1e293b;";
    resultLabel.textContent = "Query Results";
    centerPanel.appendChild(resultLabel);

    const resultDiv = document.createElement("div");
    resultDiv.style.cssText = "flex:1;padding:4px 8px;font-size:10px;overflow-y:auto;";
    centerPanel.appendChild(resultDiv);

    main.appendChild(centerPanel);

    // 右: トレース
    const rightPanel = document.createElement("div");
    rightPanel.style.cssText = "width:380px;display:flex;flex-direction:column;";

    const traceLabel = document.createElement("div");
    traceLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#a78bfa;border-bottom:1px solid #1e293b;";
    traceLabel.textContent = "Filter Trace (click a query)";
    rightPanel.appendChild(traceLabel);

    const traceDiv = document.createElement("div");
    traceDiv.style.cssText = "flex:1;padding:4px 8px;font-size:10px;overflow-y:auto;line-height:1.6;";
    rightPanel.appendChild(traceDiv);

    main.appendChild(rightPanel);
    container.appendChild(main);

    // ── 描画 ──

    const renderPolicy = (p: FilterPolicy) => {
      policyDiv.innerHTML = "";
      const add = (label: string, value: string, color: string) => {
        const row = document.createElement("div");
        row.style.marginBottom = "3px";
        row.innerHTML = `<span style="color:${color};font-weight:600;">${label}:</span> <span style="color:#94a3b8;">${value}</span>`;
        policyDiv.appendChild(row);
      };
      add("応答方法", p.blockAction, "#ef4444");
      add("ブロックカテゴリ", p.blockedCategories.length > 0 ? p.blockedCategories.join(", ") : "(なし)", "#f59e0b");
      add("ブロックリスト", `${p.blocklist.length} エントリ`, "#64748b");
      add("許可リスト", p.allowlist.length > 0 ? p.allowlist.join(", ") : "(なし)", "#10b981");
      add("カスタムブロック", p.customBlocks.length > 0 ? p.customBlocks.join(", ") : "(なし)", "#ec4899");
    };

    const renderStats = (s: FilterStats) => {
      statsDiv.innerHTML = "";
      const pct = s.totalQueries > 0 ? ((s.blocked / s.totalQueries) * 100).toFixed(0) : "0";

      const items: [string, string, string][] = [
        ["総クエリ", String(s.totalQueries), "#e2e8f0"],
        ["許可", String(s.allowed), "#10b981"],
        ["ブロック", `${s.blocked} (${pct}%)`, "#ef4444"],
        ["キャッシュ", String(s.cached), "#fbbf24"],
      ];
      for (const [l, v, c] of items) {
        const row = document.createElement("div");
        row.style.marginBottom = "2px";
        row.innerHTML = `<span style="color:${c};font-weight:600;">${v}</span> ${l}`;
        statsDiv.appendChild(row);
      }

      if (Object.keys(s.byCategory).length > 0) {
        const catTitle = document.createElement("div");
        catTitle.style.cssText = "margin-top:6px;font-weight:600;color:#f59e0b;";
        catTitle.textContent = "カテゴリ別ブロック:";
        statsDiv.appendChild(catTitle);
        for (const [cat, count] of Object.entries(s.byCategory)) {
          const row = document.createElement("div");
          row.style.paddingLeft = "8px";
          row.innerHTML = `<span style="color:${catColor(cat as Category)}">${cat}</span>: ${count}`;
          statsDiv.appendChild(row);
        }
      }

      if (s.topBlocked.length > 0) {
        const topTitle = document.createElement("div");
        topTitle.style.cssText = "margin-top:6px;font-weight:600;color:#ef4444;";
        topTitle.textContent = "Top ブロック:";
        statsDiv.appendChild(topTitle);
        for (const t of s.topBlocked) {
          const row = document.createElement("div");
          row.style.cssText = "padding-left:8px;color:#94a3b8;";
          row.textContent = `${t.domain} (${t.count})`;
          statsDiv.appendChild(row);
        }
      }
    };

    const renderResults = (results: FilterResult[]) => {
      resultDiv.innerHTML = "";
      for (const r of results) {
        const row = document.createElement("div");
        const ok = r.allowed;
        const bg = ok ? "#10b98110" : "#ef444410";
        const border = ok ? "#10b981" : "#ef4444";
        row.style.cssText = `padding:5px 8px;margin-bottom:3px;border:1px solid ${border};border-radius:4px;background:${bg};cursor:pointer;`;

        const verdict = ok ? "\u2714 ALLOW" : `\u2718 ${r.action}`;
        const vColor = ok ? "#10b981" : "#ef4444";
        const catTag = r.category ? ` <span style="color:${catColor(r.category)};font-size:9px;">[${r.category}]</span>` : "";

        row.innerHTML =
          `<div style="display:flex;justify-content:space-between;">` +
          `<span style="color:#e2e8f0;font-weight:600;">${r.query.domain}</span>` +
          `<span style="color:${vColor};font-size:11px;font-weight:600;">${verdict}</span>` +
          `</div>` +
          `<div style="color:#64748b;font-size:9px;">${r.answer ?? "(no answer)"} — ${r.latencyMs}ms${catTag}</div>`;

        row.addEventListener("click", () => renderTrace(r.trace));
        resultDiv.appendChild(row);
      }
    };

    const renderTrace = (trace: FilterStep[]) => {
      traceDiv.innerHTML = "";
      for (const step of trace) {
        const line = document.createElement("div");
        line.style.cssText = "display:flex;gap:4px;align-items:flex-start;margin-bottom:2px;";

        const badge = document.createElement("span");
        const color = stepColor(step.phase);
        badge.style.cssText = `min-width:60px;padding:0 4px;border-radius:2px;font-size:9px;font-weight:600;text-align:center;color:${color};background:${color}15;border:1px solid ${color}33;`;
        badge.textContent = step.phase;
        line.appendChild(badge);

        const icon = document.createElement("span");
        const iColor = step.result === "allow" ? "#10b981" : step.result === "block" ? "#ef4444" : step.result === "pass" ? "#64748b" : "#94a3b8";
        icon.style.cssText = `color:${iColor};min-width:12px;`;
        icon.textContent = step.result === "allow" ? "\u2714" : step.result === "block" ? "\u2718" : step.result === "pass" ? "\u2192" : "\u2022";
        line.appendChild(icon);

        const detail = document.createElement("span");
        detail.style.color = "#cbd5e1";
        detail.textContent = step.detail;
        line.appendChild(detail);

        traceDiv.appendChild(line);
      }
    };

    // ── ロジック ──

    const loadExample = (ex: Example) => {
      descSpan.textContent = ex.description;
      renderPolicy(ex.policy);
      resultDiv.innerHTML = "";
      traceDiv.innerHTML = "";
      statsDiv.innerHTML = "";
    };

    const runAll = (ex: Example) => {
      const server = new DnsFilterServer(ex.policy, ex.upstream);
      const results: FilterResult[] = [];
      for (const q of ex.queries) {
        results.push(server.resolve(q));
      }
      renderResults(results);
      renderStats(server.stats);
      if (results[0] !== undefined) renderTrace(results[0].trace);
    };

    // ── イベント ──
    exSelect.addEventListener("change", () => {
      const ex = EXAMPLES[Number(exSelect.value)];
      if (ex !== undefined) loadExample(ex);
    });
    runBtn.addEventListener("click", () => {
      const ex = EXAMPLES[Number(exSelect.value)];
      if (ex !== undefined) runAll(ex);
    });

    loadExample(EXAMPLES[0]!);
  }
}
