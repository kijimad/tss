/**
 * app.ts — DNS シミュレータ ブラウザUI
 *
 * ドメイン名を入力すると、再帰解決の過程をステップバイステップで表示する。
 * 各クエリがどのサーバに送られ、どんな応答が返ってきたかが見える。
 */
import { buildInternet } from "../server/internet.js";
import { DnsResolver } from "../resolver/resolver.js";
import { DnsCache } from "../resolver/cache.js";
import { RecordType, recordTypeToString } from "../protocol/types.js";
import type { ResolveTrace, NetworkEvent } from "../protocol/types.js";

export class DnsApp {
  private resolver!: DnsResolver;
  private cache!: DnsCache;
  private resultDiv!: HTMLElement;
  private cacheDiv!: HTMLElement;

  init(container: HTMLElement): void {
    container.style.cssText = "max-width:900px;margin:0 auto;padding:24px;font-family:system-ui,-apple-system,sans-serif;";

    // タイトル
    const title = document.createElement("h1");
    title.textContent = "DNS リゾルバ シミュレータ";
    title.style.cssText = "margin:0 0 16px 0;font-size:22px;color:#1f2937;";
    container.appendChild(title);

    // 説明
    const desc = document.createElement("p");
    desc.style.cssText = "color:#6b7280;font-size:14px;margin:0 0 16px 0;";
    desc.textContent = "ドメイン名を入力すると、ルートサーバから権威サーバまでの再帰解決の過程を表示します。";
    container.appendChild(desc);

    // 入力エリア
    const inputRow = document.createElement("div");
    inputRow.style.cssText = "display:flex;gap:8px;margin-bottom:16px;align-items:center;";

    const input = document.createElement("input");
    input.type = "text";
    input.value = "www.example.com";
    input.placeholder = "ドメイン名";
    input.style.cssText = "flex:1;padding:8px 12px;border:1px solid #d1d5db;border-radius:6px;font-size:15px;";

    // レコード型選択
    const typeSelect = document.createElement("select");
    typeSelect.style.cssText = "padding:8px;border:1px solid #d1d5db;border-radius:6px;font-size:14px;";
    const types = [
      { value: String(RecordType.A), label: "A (IPv4)" },
      { value: String(RecordType.NS), label: "NS" },
      { value: String(RecordType.CNAME), label: "CNAME" },
      { value: String(RecordType.MX), label: "MX" },
      { value: String(RecordType.TXT), label: "TXT" },
    ];
    for (const t of types) {
      const opt = document.createElement("option");
      opt.value = t.value;
      opt.textContent = t.label;
      typeSelect.appendChild(opt);
    }

    const resolveBtn = document.createElement("button");
    resolveBtn.textContent = "解決";
    resolveBtn.style.cssText = "padding:8px 24px;background:#2563eb;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:15px;font-weight:500;";

    const clearCacheBtn = document.createElement("button");
    clearCacheBtn.textContent = "キャッシュクリア";
    clearCacheBtn.style.cssText = "padding:8px 16px;background:#ef4444;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;";

    inputRow.appendChild(input);
    inputRow.appendChild(typeSelect);
    inputRow.appendChild(resolveBtn);
    inputRow.appendChild(clearCacheBtn);
    container.appendChild(inputRow);

    // レイアウト: 結果 + キャッシュ
    const layout = document.createElement("div");
    layout.style.cssText = "display:flex;gap:16px;";

    // 結果表示
    this.resultDiv = document.createElement("div");
    this.resultDiv.style.cssText = "flex:1;";
    layout.appendChild(this.resultDiv);

    // キャッシュ表示
    this.cacheDiv = document.createElement("div");
    this.cacheDiv.style.cssText = "width:280px;";
    layout.appendChild(this.cacheDiv);

    container.appendChild(layout);

    // インターネット構築
    const { network } = buildInternet();
    this.cache = new DnsCache();
    this.resolver = new DnsResolver(network, this.cache);

    // イベントハンドラ
    resolveBtn.addEventListener("click", () => {
      const name = input.value.trim();
      if (name) {
        const type = Number(typeSelect.value);
        this.doResolve(name, type);
      }
    });

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const name = input.value.trim();
        if (name) {
          const type = Number(typeSelect.value);
          this.doResolve(name, type);
        }
      }
    });

    clearCacheBtn.addEventListener("click", () => {
      this.cache.clear();
      this.updateCacheView();
    });

    this.updateCacheView();
  }

  private async doResolve(name: string, type: number): Promise<void> {
    try {
      const trace = await this.resolver.resolve(name, type as 1);
      this.showTrace(trace);
      this.updateCacheView();
    } catch (e) {
      this.resultDiv.innerHTML = "";
      const err = document.createElement("div");
      err.style.cssText = "color:#dc2626;padding:12px;";
      err.textContent = e instanceof Error ? e.message : String(e);
      this.resultDiv.appendChild(err);
    }
  }

  private showTrace(trace: ResolveTrace): void {
    this.resultDiv.innerHTML = "";

    // サマリー
    const summary = document.createElement("div");
    summary.style.cssText = "display:flex;gap:16px;padding:12px;background:#f8fafc;border-radius:8px;margin-bottom:16px;flex-wrap:wrap;";

    const stats = [
      { label: "クエリ", value: `${trace.query} (${trace.recordType})`, color: "#1f2937" },
      { label: "問い合わせ数", value: String(trace.totalQueries), color: "#2563eb" },
      { label: "キャッシュヒット", value: String(trace.cacheHits), color: "#059669" },
      { label: "実行時間", value: `${trace.elapsedMs.toFixed(1)}ms`, color: "#6b7280" },
    ];
    for (const s of stats) {
      const el = document.createElement("div");
      el.innerHTML = `<span style="font-size:11px;color:#6b7280;">${s.label}</span><br><span style="font-weight:600;color:${s.color};">${s.value}</span>`;
      summary.appendChild(el);
    }
    this.resultDiv.appendChild(summary);

    // 結果
    if (trace.result.length > 0) {
      const resultSection = document.createElement("div");
      resultSection.style.cssText = "padding:12px;background:#f0fdf4;border:1px solid #86efac;border-radius:8px;margin-bottom:16px;";
      const resultTitle = document.createElement("div");
      resultTitle.style.cssText = "font-weight:600;color:#059669;margin-bottom:8px;";
      resultTitle.textContent = "解決結果";
      resultSection.appendChild(resultTitle);
      for (const r of trace.result) {
        const row = document.createElement("div");
        row.style.cssText = "font-family:monospace;font-size:14px;color:#1f2937;padding:2px 0;";
        row.textContent = `${r.name}  ${recordTypeToString(r.type)}  ${r.data}  (TTL: ${String(r.ttl)}s)`;
        resultSection.appendChild(row);
      }
      this.resultDiv.appendChild(resultSection);
    } else {
      const noResult = document.createElement("div");
      noResult.style.cssText = "padding:12px;background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;margin-bottom:16px;color:#dc2626;";
      noResult.textContent = "レコードが見つかりませんでした";
      this.resultDiv.appendChild(noResult);
    }

    // イベントタイムライン
    const timelineTitle = document.createElement("div");
    timelineTitle.style.cssText = "font-weight:600;color:#374151;margin-bottom:8px;font-size:14px;";
    timelineTitle.textContent = "解決の流れ";
    this.resultDiv.appendChild(timelineTitle);

    const timeline = document.createElement("div");
    timeline.style.cssText = "border-left:3px solid #e5e7eb;padding-left:16px;";

    for (const event of trace.events) {
      const row = this.createEventRow(event);
      timeline.appendChild(row);
    }

    this.resultDiv.appendChild(timeline);
  }

  private createEventRow(event: NetworkEvent): HTMLElement {
    const row = document.createElement("div");
    row.style.cssText = "display:flex;align-items:flex-start;gap:8px;padding:6px 0;position:relative;";

    // タイムラインのドット
    const dot = document.createElement("div");
    dot.style.cssText = "width:10px;height:10px;border-radius:50%;position:absolute;left:-22px;top:10px;";

    const badge = document.createElement("span");
    badge.style.cssText = "padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;white-space:nowrap;";

    const detail = document.createElement("span");
    detail.style.cssText = "font-size:13px;color:#374151;";

    const time = document.createElement("span");
    time.style.cssText = "font-size:11px;color:#9ca3af;margin-left:auto;white-space:nowrap;";
    time.textContent = `${event.timestamp.toFixed(1)}ms`;

    switch (event.type) {
      case "resolve_step":
        dot.style.background = "#3b82f6";
        badge.style.cssText += "background:#dbeafe;color:#1d4ed8;";
        badge.textContent = "問い合わせ";
        detail.textContent = `${event.serverIp} に「${event.question}」を送信`;
        break;

      case "udp_send":
        dot.style.background = "#8b5cf6";
        badge.style.cssText += "background:#ede9fe;color:#5b21b6;";
        badge.textContent = "UDP送信";
        detail.textContent = `${event.from} → ${event.to} (ID: ${String(event.messageId)})`;
        break;

      case "udp_recv":
        dot.style.background = "#10b981";
        badge.style.cssText += "background:#d1fae5;color:#065f46;";
        badge.textContent = "UDP受信";
        detail.textContent = `${event.from} → ${event.to} (回答: ${String(event.answerCount)}件)`;
        break;

      case "cache_hit":
        dot.style.background = "#f59e0b";
        badge.style.cssText += "background:#fef3c7;color:#92400e;";
        badge.textContent = "キャッシュHIT";
        detail.textContent = `${event.name} ${event.recordType} (残TTL: ${String(event.ttl)}s)`;
        break;

      case "cache_miss":
        dot.style.background = "#6b7280";
        badge.style.cssText += "background:#f3f4f6;color:#374151;";
        badge.textContent = "キャッシュMISS";
        detail.textContent = `${event.name} ${event.recordType}`;
        break;

      case "cache_store":
        dot.style.background = "#059669";
        badge.style.cssText += "background:#ecfdf5;color:#047857;";
        badge.textContent = "キャッシュ保存";
        detail.textContent = `${event.name} ${event.recordType} (TTL: ${String(event.ttl)}s)`;
        break;
    }

    row.appendChild(dot);
    row.appendChild(badge);
    row.appendChild(detail);
    row.appendChild(time);
    return row;
  }

  private updateCacheView(): void {
    this.cacheDiv.innerHTML = "";

    const title = document.createElement("div");
    title.style.cssText = "font-weight:600;color:#374151;margin-bottom:8px;font-size:14px;";
    title.textContent = "キャッシュ";
    this.cacheDiv.appendChild(title);

    const entries = this.cache.getAllEntries();
    if (entries.length === 0) {
      const empty = document.createElement("div");
      empty.style.cssText = "color:#9ca3af;font-size:13px;";
      empty.textContent = "空";
      this.cacheDiv.appendChild(empty);
      return;
    }

    const table = document.createElement("div");
    table.style.cssText = "font-size:12px;font-family:monospace;";

    for (const entry of entries) {
      const row = document.createElement("div");
      row.style.cssText = `padding:3px 6px;border-bottom:1px solid #f3f4f6;${entry.expired ? "opacity:0.4;" : ""}`;
      row.textContent = `${entry.name} ${entry.type} → ${entry.data} (${String(entry.ttl)}s)`;
      table.appendChild(row);
    }

    this.cacheDiv.appendChild(table);
  }
}
