import { Database } from "../db/database.js";
import { SqlInput } from "./sql-input.js";
import { ResultTable } from "./result-table.js";
import { SchemaBrowser } from "./schema-browser.js";

// SQLサンプル集: ラベルとSQL文のペア
export const EXAMPLES: { label: string; sql: string }[] = [
  {
    label: "テーブル作成 + INSERT",
    sql: `CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, age INTEGER);
INSERT INTO users (id, name, age) VALUES (1, 'Alice', 30);
INSERT INTO users (id, name, age) VALUES (2, 'Bob', 25);
INSERT INTO users (id, name, age) VALUES (3, 'Charlie', 35);`,
  },
  {
    label: "SELECT + WHERE",
    sql: `SELECT * FROM users WHERE age >= 30;`,
  },
  {
    label: "集約関数",
    sql: `SELECT COUNT(*) AS total, SUM(age) AS age_sum, AVG(age) AS age_avg FROM users;`,
  },
  {
    label: "JOIN",
    sql: `CREATE TABLE orders (id INTEGER PRIMARY KEY, user_id INTEGER, item TEXT, price INTEGER);
INSERT INTO orders (id, user_id, item, price) VALUES (1, 1, 'Book', 1500);
INSERT INTO orders (id, user_id, item, price) VALUES (2, 2, 'Pen', 200);
INSERT INTO orders (id, user_id, item, price) VALUES (3, 1, 'Notebook', 500);
SELECT users.name, orders.item, orders.price FROM users JOIN orders ON users.id = orders.user_id;`,
  },
  {
    label: "サブクエリ",
    sql: `SELECT * FROM users WHERE age > (SELECT AVG(age) FROM users);`,
  },
];

// ブラウザUI メインアプリケーション
export class DbApp {
  private db: Database | null = null;
  private sqlInput!: SqlInput;
  private resultTable!: ResultTable;
  private schemaBrowser!: SchemaBrowser;

  async init(container: HTMLElement): Promise<void> {
    container.style.cssText = "display:flex;gap:16px;padding:16px;font-family:system-ui,-apple-system,sans-serif;height:100vh;box-sizing:border-box;";

    // 左パネル（メイン）
    const mainPanel = document.createElement("div");
    mainPanel.style.cssText = "flex:1;display:flex;flex-direction:column;gap:12px;min-width:0;";

    // ヘッダー（タイトル + サンプル選択）
    const header = document.createElement("div");
    header.style.cssText = "display:flex;align-items:center;gap:12px;flex-wrap:wrap;";

    // タイトル
    const title = document.createElement("h1");
    title.textContent = "SQLite風 DB エンジン";
    title.style.cssText = "margin:0;font-size:20px;color:#1f2937;";
    header.appendChild(title);

    // サンプルSQL選択ドロップダウン
    const exampleSelect = document.createElement("select");
    exampleSelect.style.cssText = "padding:4px 8px;font-size:14px;border:1px solid #d1d5db;border-radius:4px;background:white;color:#374151;cursor:pointer;";

    // デフォルト選択肢
    const defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.textContent = "-- サンプルを選択 --";
    exampleSelect.appendChild(defaultOption);

    // サンプルごとの選択肢を追加
    for (const example of EXAMPLES) {
      const option = document.createElement("option");
      option.value = example.sql;
      option.textContent = example.label;
      exampleSelect.appendChild(option);
    }

    // サンプル選択時にSQL入力欄へ反映
    exampleSelect.addEventListener("change", () => {
      if (exampleSelect.value) {
        this.sqlInput.setValue(exampleSelect.value);
      }
      // 選択状態をデフォルトに戻す（何度でも同じサンプルを選べるように）
      exampleSelect.selectedIndex = 0;
    });

    header.appendChild(exampleSelect);
    mainPanel.appendChild(header);

    // SQL入力エリア
    const inputContainer = document.createElement("div");
    this.sqlInput = new SqlInput(inputContainer, (sql) => this.executeSql(sql));
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
