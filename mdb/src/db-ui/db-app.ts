import { Database } from "../db/database.js";
import { SqlInput } from "./sql-input.js";
import { ResultTable } from "./result-table.js";
import { SchemaBrowser } from "./schema-browser.js";

// ブラウザUI メインアプリケーション
export class DbApp {
  private db: Database | null = null;
  private resultTable!: ResultTable;
  private schemaBrowser!: SchemaBrowser;

  async init(container: HTMLElement): Promise<void> {
    container.style.cssText = "display:flex;gap:16px;padding:16px;font-family:system-ui,-apple-system,sans-serif;height:100vh;box-sizing:border-box;";

    // 左パネル（メイン）
    const mainPanel = document.createElement("div");
    mainPanel.style.cssText = "flex:1;display:flex;flex-direction:column;gap:12px;min-width:0;";

    // タイトル
    const title = document.createElement("h1");
    title.textContent = "SQLite風 DB エンジン";
    title.style.cssText = "margin:0;font-size:20px;color:#1f2937;";
    mainPanel.appendChild(title);

    // SQL入力エリア
    const inputContainer = document.createElement("div");
    new SqlInput(inputContainer, (sql) => this.executeSql(sql));
    mainPanel.appendChild(inputContainer);

    // 結果表示エリア
    const resultContainer = document.createElement("div");
    resultContainer.style.cssText = "flex:1;overflow-y:auto;";
    this.resultTable = new ResultTable(resultContainer);
    mainPanel.appendChild(resultContainer);

    container.appendChild(mainPanel);

    // 右パネル（スキーマブラウザ）
    const sidePanel = document.createElement("div");
    sidePanel.style.cssText = "width:240px;padding:12px;background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb;overflow-y:auto;";
    this.schemaBrowser = new SchemaBrowser(sidePanel);
    container.appendChild(sidePanel);

    // データベースを開く
    this.db = await Database.open("tss-db");
    this.schemaBrowser.update(this.db.getSchema());
  }

  private async executeSql(sql: string): Promise<void> {
    if (this.db === null) return;

    try {
      // セミコロン区切りの複数文を一括実行
      const results = await this.db.executeMultiple(sql);
      for (const result of results) {
        this.resultTable.showResult(result, sql);
      }
      this.schemaBrowser.update(this.db.getSchema());
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.resultTable.showError(message, sql);
    }
  }
}
