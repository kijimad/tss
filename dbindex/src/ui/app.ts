import { BPlusTree, HashIndex, Table, executeQuery } from "../engine/index.js";
import type { Row, QueryType, QueryPlan, TraceStep, Page } from "../engine/index.js";

export interface Example {
  name: string;
  description: string;
  rows: Row[];
  query: QueryType;
  queryLabel: string;
  btreeOrder: number;
  hashBuckets: number;
  rowsPerPage: number;
}

/** テストデータ生成 */
function genRows(count: number, sparse = false): Row[] {
  const rows: Row[] = [];
  for (let i = 1; i <= count; i++) {
    const id = sparse ? i * 7 : i;
    rows.push({
      id,
      name: `user_${id}`,
      age: 20 + (id % 50),
      score: (id * 17) % 100,
    });
  }
  return rows;
}

export const EXAMPLES: Example[] = [
  {
    name: "等価検索 (少量データ: 20行)",
    description: "20 行の小テーブルで id=10 を検索。B+Tree・Hash ともに 1〜2 I/O で済む。Full Scan は全ページ走査。",
    rows: genRows(20),
    query: { type: "eq", column: "id", value: 10 },
    queryLabel: "SELECT * FROM users WHERE id = 10",
    btreeOrder: 4, hashBuckets: 8, rowsPerPage: 5,
  },
  {
    name: "等価検索 (大量データ: 200行)",
    description: "200 行で id=150 を検索。Full Scan は 20 ページ走査だが B+Tree は 3 I/O、Hash は 1 I/O。",
    rows: genRows(200),
    query: { type: "eq", column: "id", value: 150 },
    queryLabel: "SELECT * FROM users WHERE id = 150",
    btreeOrder: 5, hashBuckets: 16, rowsPerPage: 10,
  },
  {
    name: "範囲検索 (B+Tree のリーフリンク)",
    description: "id BETWEEN 10 AND 25 の範囲検索。B+Tree はリーフのリンクリストを辿り連続走査。Hash は範囲検索不可。",
    rows: genRows(50),
    query: { type: "range", column: "id", from: 10, to: 25 },
    queryLabel: "SELECT * FROM users WHERE id BETWEEN 10 AND 25",
    btreeOrder: 4, hashBuckets: 8, rowsPerPage: 5,
  },
  {
    name: "範囲検索 (広範囲 — Full Scan が有利)",
    description: "50 行中 40 行が該当する広範囲検索。大半を読むなら Full Scan の方がオーバーヘッドが少ない場合がある。",
    rows: genRows(50),
    query: { type: "range", column: "id", from: 5, to: 45 },
    queryLabel: "SELECT * FROM users WHERE id BETWEEN 5 AND 45",
    btreeOrder: 4, hashBuckets: 8, rowsPerPage: 10,
  },
  {
    name: "存在しないキーの検索",
    description: "存在しない id=999 を検索。B+Tree はリーフまで降りて不在を確認。Hash はバケットを 1 回だけ読む。",
    rows: genRows(50),
    query: { type: "eq", column: "id", value: 999 },
    queryLabel: "SELECT * FROM users WHERE id = 999",
    btreeOrder: 4, hashBuckets: 8, rowsPerPage: 10,
  },
  {
    name: "Hash 衝突の多いケース",
    description: "バケット数 4 で 100 行。ハッシュ衝突が多発し、バケット内の走査コストが増大する。",
    rows: genRows(100),
    query: { type: "eq", column: "id", value: 50 },
    queryLabel: "SELECT * FROM users WHERE id = 50",
    btreeOrder: 4, hashBuckets: 4, rowsPerPage: 10,
  },
];

// ── 色定義 ──

function methodColor(m: QueryPlan["method"]): string {
  switch (m) {
    case "btree":     return "#22c55e";
    case "hash":      return "#f59e0b";
    case "full_scan": return "#ef4444";
  }
}

function pageTypeColor(t: Page["type"]): string {
  switch (t) {
    case "internal":    return "#8b5cf6";
    case "leaf":        return "#22c55e";
    case "hash_bucket": return "#f59e0b";
    case "data":        return "#3b82f6";
    case "overflow":    return "#ef4444";
  }
}

export class DbIndexApp {
  init(container: HTMLElement): void {
    container.style.cssText =
      "display:flex;flex-direction:column;height:100vh;font-family:'Fira Code','Cascadia Code',monospace;background:#0f172a;color:#e2e8f0;";

    // ── ヘッダ ──
    const header = document.createElement("div");
    header.style.cssText = "padding:8px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #1e293b;flex-wrap:wrap;";

    const title = document.createElement("h1");
    title.textContent = "DB Index Simulator";
    title.style.cssText = "margin:0;font-size:15px;color:#22c55e;";
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
    runBtn.textContent = "\u25B6 Execute";
    runBtn.style.cssText = "padding:4px 16px;background:#22c55e;color:#0f172a;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;";
    header.appendChild(runBtn);

    const querySpan = document.createElement("span");
    querySpan.style.cssText = "font-size:11px;color:#06b6d4;font-weight:600;";
    header.appendChild(querySpan);

    const descSpan = document.createElement("span");
    descSpan.style.cssText = "font-size:10px;color:#64748b;margin-left:auto;max-width:400px;";
    header.appendChild(descSpan);

    container.appendChild(header);

    // ── メイン ──
    const main = document.createElement("div");
    main.style.cssText = "flex:1;display:flex;overflow:hidden;";

    // 左: インデックス構造の可視化
    const leftPanel = document.createElement("div");
    leftPanel.style.cssText = "width:340px;display:flex;flex-direction:column;border-right:1px solid #1e293b;overflow-y:auto;";

    const treeLabel = document.createElement("div");
    treeLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#22c55e;border-bottom:1px solid #1e293b;";
    treeLabel.textContent = "B+Tree Structure";
    leftPanel.appendChild(treeLabel);

    const treeDiv = document.createElement("div");
    treeDiv.style.cssText = "padding:8px 12px;font-size:10px;border-bottom:1px solid #1e293b;max-height:250px;overflow-y:auto;";
    leftPanel.appendChild(treeDiv);

    const hashLabel = document.createElement("div");
    hashLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#f59e0b;border-bottom:1px solid #1e293b;";
    hashLabel.textContent = "Hash Buckets";
    leftPanel.appendChild(hashLabel);

    const hashDiv = document.createElement("div");
    hashDiv.style.cssText = "padding:8px 12px;font-size:10px;border-bottom:1px solid #1e293b;max-height:200px;overflow-y:auto;";
    leftPanel.appendChild(hashDiv);

    const infoLabel = document.createElement("div");
    infoLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#94a3b8;border-bottom:1px solid #1e293b;";
    infoLabel.textContent = "Table Info";
    leftPanel.appendChild(infoLabel);

    const infoDiv = document.createElement("div");
    infoDiv.style.cssText = "padding:8px 12px;font-size:10px;";
    leftPanel.appendChild(infoDiv);

    main.appendChild(leftPanel);

    // 中央: 比較結果
    const centerPanel = document.createElement("div");
    centerPanel.style.cssText = "flex:1;display:flex;flex-direction:column;border-right:1px solid #1e293b;";

    const compLabel = document.createElement("div");
    compLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#e2e8f0;border-bottom:1px solid #1e293b;";
    compLabel.textContent = "Execution Plan Comparison";
    centerPanel.appendChild(compLabel);

    const compDiv = document.createElement("div");
    compDiv.style.cssText = "padding:8px 12px;font-size:10px;border-bottom:1px solid #1e293b;";
    centerPanel.appendChild(compDiv);

    const barLabel = document.createElement("div");
    barLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#a78bfa;border-bottom:1px solid #1e293b;";
    barLabel.textContent = "I/O Cost Bar";
    centerPanel.appendChild(barLabel);

    const barDiv = document.createElement("div");
    barDiv.style.cssText = "padding:12px;";
    centerPanel.appendChild(barDiv);

    const resultLabel = document.createElement("div");
    resultLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#06b6d4;border-bottom:1px solid #1e293b;";
    resultLabel.textContent = "Result Rows";
    centerPanel.appendChild(resultLabel);

    const resultDiv = document.createElement("div");
    resultDiv.style.cssText = "flex:1;padding:8px 12px;font-size:10px;overflow-y:auto;";
    centerPanel.appendChild(resultDiv);

    main.appendChild(centerPanel);

    // 右: 探索トレース
    const rightPanel = document.createElement("div");
    rightPanel.style.cssText = "width:360px;display:flex;flex-direction:column;";

    const traceLabel = document.createElement("div");
    traceLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#8b5cf6;border-bottom:1px solid #1e293b;";
    traceLabel.textContent = "Access Trace (click a plan)";
    rightPanel.appendChild(traceLabel);

    const traceDiv = document.createElement("div");
    traceDiv.style.cssText = "flex:1;padding:4px 8px;font-size:10px;overflow-y:auto;line-height:1.6;";
    rightPanel.appendChild(traceDiv);

    main.appendChild(rightPanel);
    container.appendChild(main);

    // ── 描画 ──

    const renderTree = (btree: BPlusTree) => {
      treeDiv.innerHTML = "";
      const pages = btree.toPages();
      if (pages.length === 0) { treeDiv.textContent = "(empty)"; return; }
      for (const page of pages) {
        const el = document.createElement("div");
        const color = pageTypeColor(page.type);
        el.style.cssText = `margin-bottom:3px;padding:3px 6px;border:1px solid ${color}44;border-radius:3px;background:${color}08;`;
        el.innerHTML =
          `<span style="color:${color};font-weight:600;">Page ${page.id}</span> ` +
          `<span style="color:#64748b;">[${page.type}]</span> ` +
          `<span style="color:#94a3b8;">keys=[${page.keys.join(",")}]</span>`;
        treeDiv.appendChild(el);
      }
      const add = (l: string, v: string) => {
        const row = document.createElement("div");
        row.style.cssText = "margin-top:4px;color:#475569;";
        row.innerHTML = `${l}: <span style="color:#94a3b8;">${v}</span>`;
        treeDiv.appendChild(row);
      };
      add("Order", String(btree.order));
      add("ノード数", String(pages.length));
      add("木の深さ", String(new Set(pages.map((p) => p.type)).size));
    };

    const renderHash = (hash: HashIndex) => {
      hashDiv.innerHTML = "";
      const pages = hash.toPages();
      for (const page of pages) {
        const el = document.createElement("div");
        const fill = page.keys.length;
        const barW = Math.min(100, fill * 4);
        el.style.cssText = "margin-bottom:2px;display:flex;gap:4px;align-items:center;";
        el.innerHTML =
          `<span style="color:#f59e0b;min-width:55px;">Bucket ${page.id}</span>` +
          `<span style="display:inline-block;width:${barW}px;height:8px;background:#f59e0b44;border-radius:2px;"></span>` +
          `<span style="color:#64748b;">${fill} entries</span>`;
        hashDiv.appendChild(el);
      }
      const add = (l: string, v: string) => {
        const row = document.createElement("div");
        row.style.cssText = "margin-top:4px;color:#475569;";
        row.innerHTML = `${l}: <span style="color:#94a3b8;">${v}</span>`;
        hashDiv.appendChild(row);
      };
      add("バケット数", String(hash.bucketCount));
    };

    const renderInfo = (table: Table) => {
      infoDiv.innerHTML = "";
      const add = (l: string, v: string, c: string) => {
        const row = document.createElement("div");
        row.style.marginBottom = "2px";
        row.innerHTML = `<span style="color:${c};font-weight:600;">${l}:</span> <span style="color:#94a3b8;">${v}</span>`;
        infoDiv.appendChild(row);
      };
      add("テーブル", table.name, "#e2e8f0");
      add("行数", String(table.rows.length), "#06b6d4");
      add("ページ数", `${table.pageCount} (${table.rowsPerPage}行/ページ)`, "#3b82f6");
    };

    const renderComparison = (plans: QueryPlan[]) => {
      compDiv.innerHTML = "";
      for (const plan of plans) {
        const el = document.createElement("div");
        const color = methodColor(plan.method);
        el.style.cssText = `margin-bottom:6px;padding:6px 8px;border:1px solid ${color}44;border-radius:4px;background:${color}08;cursor:pointer;`;
        el.innerHTML =
          `<div style="display:flex;justify-content:space-between;align-items:center;">` +
          `<span style="color:${color};font-weight:600;">${plan.label}</span>` +
          `<span style="color:#e2e8f0;font-size:12px;font-weight:700;">${plan.totalIo} I/O</span>` +
          `</div>` +
          `<div style="color:#64748b;font-size:9px;margin-top:2px;">` +
          `比較回数: ${plan.comparisons}, 結果: ${plan.resultRows.length} 行` +
          `</div>`;
        el.addEventListener("click", () => renderTrace(plan.trace, color));
        compDiv.appendChild(el);
      }
    };

    const renderBars = (plans: QueryPlan[]) => {
      barDiv.innerHTML = "";
      const maxIo = Math.max(...plans.map((p) => p.totalIo), 1);
      for (const plan of plans) {
        const color = methodColor(plan.method);
        const pct = (plan.totalIo / maxIo) * 100;
        const row = document.createElement("div");
        row.style.cssText = "margin-bottom:8px;";
        row.innerHTML =
          `<div style="display:flex;justify-content:space-between;margin-bottom:2px;">` +
          `<span style="color:${color};font-size:10px;font-weight:600;">${plan.label}</span>` +
          `<span style="color:#e2e8f0;font-size:10px;">${plan.totalIo} I/O</span>` +
          `</div>` +
          `<div style="height:16px;background:#1e293b;border-radius:4px;overflow:hidden;">` +
          `<div style="height:100%;width:${pct}%;background:${color};border-radius:4px;transition:width 0.3s;"></div>` +
          `</div>`;
        barDiv.appendChild(row);
      }
    };

    const renderResult = (rows: Row[]) => {
      resultDiv.innerHTML = "";
      if (rows.length === 0) {
        resultDiv.textContent = "(0 件)";
        return;
      }
      const cols = Object.keys(rows[0]!);
      const headerRow = document.createElement("div");
      headerRow.style.cssText = "display:flex;gap:8px;color:#64748b;font-weight:600;border-bottom:1px solid #1e293b;padding-bottom:2px;margin-bottom:2px;";
      for (const col of cols) {
        const span = document.createElement("span");
        span.style.minWidth = "60px";
        span.textContent = col;
        headerRow.appendChild(span);
      }
      resultDiv.appendChild(headerRow);

      for (const row of rows.slice(0, 20)) {
        const el = document.createElement("div");
        el.style.cssText = "display:flex;gap:8px;color:#94a3b8;";
        for (const col of cols) {
          const span = document.createElement("span");
          span.style.minWidth = "60px";
          span.textContent = String(row[col]);
          el.appendChild(span);
        }
        resultDiv.appendChild(el);
      }
      if (rows.length > 20) {
        const more = document.createElement("div");
        more.style.cssText = "color:#475569;margin-top:4px;";
        more.textContent = `... 他 ${rows.length - 20} 件`;
        resultDiv.appendChild(more);
      }
    };

    const renderTrace = (trace: TraceStep[], accentColor: string) => {
      traceDiv.innerHTML = "";
      for (const step of trace) {
        const el = document.createElement("div");
        el.style.cssText = "margin-bottom:4px;display:flex;gap:4px;align-items:flex-start;";

        const ioBadge = document.createElement("span");
        ioBadge.style.cssText = `min-width:32px;padding:0 4px;border-radius:2px;font-size:9px;font-weight:600;text-align:center;color:${accentColor};background:${accentColor}15;border:1px solid ${accentColor}33;`;
        ioBadge.textContent = `IO ${step.ioCount}`;
        el.appendChild(ioBadge);

        const pType = document.createElement("span");
        const ptColor = pageTypeColor(step.pageType);
        pType.style.cssText = `min-width:55px;color:${ptColor};font-size:9px;font-weight:600;`;
        pType.textContent = `P${step.pageId} ${step.pageType}`;
        el.appendChild(pType);

        const detail = document.createElement("span");
        detail.style.color = "#cbd5e1";
        detail.textContent = step.action;
        el.appendChild(detail);

        traceDiv.appendChild(el);
      }
    };

    // ── ロジック ──

    const loadExample = (ex: Example) => {
      descSpan.textContent = ex.description;
      querySpan.textContent = ex.queryLabel;
      compDiv.innerHTML = "";
      barDiv.innerHTML = "";
      resultDiv.innerHTML = "";
      traceDiv.innerHTML = "";

      const table = new Table("users", ex.rows, ex.rowsPerPage);
      const btree = new BPlusTree(ex.btreeOrder);
      btree.buildFromSorted(ex.rows.map((r) => ({ key: r["id"] as number, rowId: r["id"] as number })));
      const hash = new HashIndex(ex.hashBuckets);
      for (const row of ex.rows) hash.insert(row["id"] as number, row["id"] as number);

      renderTree(btree);
      renderHash(hash);
      renderInfo(table);
    };

    const runQuery = (ex: Example) => {
      const table = new Table("users", ex.rows, ex.rowsPerPage);
      const btree = new BPlusTree(ex.btreeOrder);
      btree.buildFromSorted(ex.rows.map((r) => ({ key: r["id"] as number, rowId: r["id"] as number })));
      const hash = new HashIndex(ex.hashBuckets);
      for (const row of ex.rows) hash.insert(row["id"] as number, row["id"] as number);

      const { plans } = executeQuery(table, btree, hash, ex.query);
      renderComparison(plans);
      renderBars(plans);
      if (plans[0] !== undefined) {
        renderResult(plans[0].resultRows);
        renderTrace(plans[0].trace, methodColor(plans[0].method));
      }
    };

    // ── イベント ──
    exSelect.addEventListener("change", () => {
      const ex = EXAMPLES[Number(exSelect.value)];
      if (ex !== undefined) loadExample(ex);
    });
    runBtn.addEventListener("click", () => {
      const ex = EXAMPLES[Number(exSelect.value)];
      if (ex !== undefined) runQuery(ex);
    });

    loadExample(EXAMPLES[0]!);
  }
}
