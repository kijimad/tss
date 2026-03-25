import type { SchemaManager } from "../db/catalog/schema-manager.js";

// スキーマブラウザコンポーネント
export class SchemaBrowser {
  private container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  // スキーマ情報を更新して表示する
  update(schema: SchemaManager): void {
    this.container.innerHTML = "";

    const title = document.createElement("h3");
    title.textContent = "スキーマ";
    title.style.cssText = "margin:0 0 8px 0;font-size:14px;color:#374151;";
    this.container.appendChild(title);

    const tables = schema.getAllTables();
    if (tables.length === 0) {
      const empty = document.createElement("p");
      empty.textContent = "テーブルなし";
      empty.style.cssText = "color:#9ca3af;font-size:12px;";
      this.container.appendChild(empty);
      return;
    }

    for (const table of tables) {
      const tableDiv = document.createElement("div");
      tableDiv.style.cssText = "margin-bottom:12px;";

      const tableName = document.createElement("div");
      tableName.textContent = table.name;
      tableName.style.cssText = "font-weight:600;font-size:13px;color:#1f2937;margin-bottom:4px;";
      tableDiv.appendChild(tableName);

      const colList = document.createElement("ul");
      colList.style.cssText = "margin:0;padding-left:16px;list-style:none;";

      for (const col of table.columns) {
        const li = document.createElement("li");
        li.style.cssText = "font-size:12px;color:#6b7280;padding:1px 0;";
        let text = `${col.name} ${col.type}`;
        if (col.primaryKey) text += " PK";
        if (col.notNull) text += " NOT NULL";
        if (col.autoIncrement) text += " AI";
        li.textContent = text;
        colList.appendChild(li);
      }
      tableDiv.appendChild(colList);

      // インデックス情報
      const indexes = schema.getIndexesForTable(table.name);
      for (const idx of indexes) {
        const idxDiv = document.createElement("div");
        idxDiv.style.cssText = "font-size:11px;color:#9ca3af;padding-left:8px;";
        idxDiv.textContent = `idx: ${idx.name} (${idx.columns.join(", ")})${idx.unique ? " UNIQUE" : ""}`;
        tableDiv.appendChild(idxDiv);
      }

      this.container.appendChild(tableDiv);
    }
  }
}
