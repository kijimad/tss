import type { QueryResult, SqlValue } from "../db/types.js";

// 結果テーブル表示コンポーネント
export class ResultTable {
  private container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  // クエリ結果を表示する
  showResult(result: QueryResult, sql: string): void {
    const wrapper = document.createElement("div");
    wrapper.style.cssText = "margin-bottom:16px;border:1px solid #e5e7eb;border-radius:4px;overflow:hidden;";

    // SQLヘッダ
    const header = document.createElement("div");
    header.style.cssText = "background:#f3f4f6;padding:8px 12px;font-family:monospace;font-size:12px;color:#6b7280;border-bottom:1px solid #e5e7eb;";
    header.textContent = sql;
    wrapper.appendChild(header);

    if (result.columns.length > 0 && result.rows.length > 0) {
      // テーブル表示
      const table = document.createElement("table");
      table.style.cssText = "width:100%;border-collapse:collapse;font-size:14px;";

      // ヘッダ行
      const thead = document.createElement("thead");
      const headerRow = document.createElement("tr");
      for (const col of result.columns) {
        const th = document.createElement("th");
        th.textContent = col;
        th.style.cssText = "text-align:left;padding:6px 12px;border-bottom:2px solid #e5e7eb;background:#f9fafb;font-weight:600;";
        headerRow.appendChild(th);
      }
      thead.appendChild(headerRow);
      table.appendChild(thead);

      // データ行
      const tbody = document.createElement("tbody");
      for (const row of result.rows) {
        const tr = document.createElement("tr");
        for (const val of row) {
          const td = document.createElement("td");
          td.textContent = this.formatValue(val);
          td.style.cssText = "padding:4px 12px;border-bottom:1px solid #f3f4f6;";
          if (val === null) {
            td.style.color = "#9ca3af";
            td.style.fontStyle = "italic";
          }
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      wrapper.appendChild(table);

      // 行数情報
      const info = document.createElement("div");
      info.style.cssText = "padding:4px 12px;font-size:12px;color:#6b7280;background:#f9fafb;border-top:1px solid #e5e7eb;";
      info.textContent = `${String(result.rows.length)} 行`;
      wrapper.appendChild(info);
    } else if (result.rowsAffected > 0) {
      const info = document.createElement("div");
      info.style.cssText = "padding:8px 12px;color:#059669;";
      info.textContent = `${String(result.rowsAffected)} 行が変更されました`;
      wrapper.appendChild(info);
    } else {
      const info = document.createElement("div");
      info.style.cssText = "padding:8px 12px;color:#059669;";
      info.textContent = "実行完了";
      wrapper.appendChild(info);
    }

    // 最新の結果を先頭に追加
    this.container.insertBefore(wrapper, this.container.firstChild);
  }

  // エラーメッセージを表示する
  showError(error: string, sql: string): void {
    const wrapper = document.createElement("div");
    wrapper.style.cssText = "margin-bottom:16px;border:1px solid #fca5a5;border-radius:4px;overflow:hidden;";

    const header = document.createElement("div");
    header.style.cssText = "background:#fef2f2;padding:8px 12px;font-family:monospace;font-size:12px;color:#6b7280;border-bottom:1px solid #fca5a5;";
    header.textContent = sql;
    wrapper.appendChild(header);

    const errorDiv = document.createElement("div");
    errorDiv.style.cssText = "padding:8px 12px;color:#dc2626;";
    errorDiv.textContent = error;
    wrapper.appendChild(errorDiv);

    this.container.insertBefore(wrapper, this.container.firstChild);
  }

  private formatValue(val: SqlValue): string {
    if (val === null) return "NULL";
    if (val instanceof Uint8Array) return `[BLOB ${String(val.length)} bytes]`;
    return String(val);
  }
}
