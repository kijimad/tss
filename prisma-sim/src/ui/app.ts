/** ブラウザ UI: Node.js シミュレーターのパターンに準拠した Prisma シミュレーター */

import { parseSchema, SchemaParseError } from "../schema/parser.js";
import { QueryEngine } from "../engine/query.js";
import { diffSchemas } from "../engine/migration.js";
import type { Row } from "../engine/store.js";

/** サンプルコード定義 */
interface Example {
  name: string;
  code: string;
}

/** サンプル一覧: スキーマ定義 + クエリコードを1つの textarea に記述 */
const EXAMPLES: Example[] = [
  {
    name: "基本クエリ (findMany)",
    code: `// --- schema ---
model User {
  id Int @id @default(autoincrement())
  name String
  email String @unique
}

// --- query ---
// model: User
// operation: create
// args: { "data": { "name": "Alice", "email": "alice@example.com" } }

// model: User
// operation: create
// args: { "data": { "name": "Bob", "email": "bob@example.com" } }

// model: User
// operation: findMany
// args: {}`,
  },
  {
    name: "条件検索 (where)",
    code: `// --- schema ---
model User {
  id Int @id @default(autoincrement())
  name String
  email String @unique
  age Int
}

// --- query ---
// model: User
// operation: create
// args: { "data": { "name": "Alice", "email": "alice@example.com", "age": 30 } }

// model: User
// operation: create
// args: { "data": { "name": "Bob", "email": "bob@example.com", "age": 25 } }

// model: User
// operation: create
// args: { "data": { "name": "Charlie", "email": "charlie@example.com", "age": 35 } }

// model: User
// operation: findMany
// args: { "where": { "name": { "contains": "li" } } }

// model: User
// operation: findMany
// args: { "where": { "age": { "gt": 28 } } }`,
  },
  {
    name: "ユニーク検索 (findUnique)",
    code: `// --- schema ---
model User {
  id Int @id @default(autoincrement())
  name String
  email String @unique
}

// --- query ---
// model: User
// operation: create
// args: { "data": { "name": "Alice", "email": "alice@example.com" } }

// model: User
// operation: create
// args: { "data": { "name": "Bob", "email": "bob@example.com" } }

// model: User
// operation: findUnique
// args: { "where": { "email": "alice@example.com" } }`,
  },
  {
    name: "レコード作成 (create)",
    code: `// --- schema ---
model User {
  id Int @id @default(autoincrement())
  name String
  email String @unique
}

// --- query ---
// model: User
// operation: create
// args: { "data": { "name": "Alice", "email": "alice@example.com" } }

// model: User
// operation: create
// args: { "data": { "name": "Bob", "email": "bob@example.com" } }

// model: User
// operation: create
// args: { "data": { "name": "Charlie", "email": "charlie@example.com" } }

// model: User
// operation: findMany
// args: {}`,
  },
  {
    name: "レコード更新 (update)",
    code: `// --- schema ---
model User {
  id Int @id @default(autoincrement())
  name String
  email String @unique
}

// --- query ---
// model: User
// operation: create
// args: { "data": { "name": "Alice", "email": "alice@example.com" } }

// model: User
// operation: update
// args: { "where": { "id": 1 }, "data": { "name": "Alice Updated" } }

// model: User
// operation: findMany
// args: {}`,
  },
  {
    name: "レコード削除 (delete)",
    code: `// --- schema ---
model User {
  id Int @id @default(autoincrement())
  name String
  email String @unique
}

// --- query ---
// model: User
// operation: create
// args: { "data": { "name": "Alice", "email": "alice@example.com" } }

// model: User
// operation: create
// args: { "data": { "name": "Bob", "email": "bob@example.com" } }

// model: User
// operation: delete
// args: { "where": { "id": 1 } }

// model: User
// operation: findMany
// args: {}`,
  },
  {
    name: "リレーション (include)",
    code: `// --- schema ---
model User {
  id Int @id @default(autoincrement())
  name String
  email String @unique
  posts Post[]
}

model Post {
  id Int @id @default(autoincrement())
  title String
  content String
  published Boolean @default(false)
  authorId Int
  author User @relation(fields: [authorId], references: [id])
}

// --- query ---
// model: User
// operation: create
// args: { "data": { "name": "Alice", "email": "alice@example.com" } }

// model: Post
// operation: create
// args: { "data": { "title": "最初の投稿", "content": "こんにちは！", "authorId": 1 } }

// model: Post
// operation: create
// args: { "data": { "title": "2番目の投稿", "content": "Prisma最高！", "authorId": 1 } }

// model: User
// operation: findMany
// args: { "include": { "posts": true } }`,
  },
  {
    name: "ソートとページング",
    code: `// --- schema ---
model User {
  id Int @id @default(autoincrement())
  name String
  email String @unique
  age Int
}

// --- query ---
// model: User
// operation: create
// args: { "data": { "name": "Alice", "email": "alice@example.com", "age": 30 } }

// model: User
// operation: create
// args: { "data": { "name": "Bob", "email": "bob@example.com", "age": 25 } }

// model: User
// operation: create
// args: { "data": { "name": "Charlie", "email": "charlie@example.com", "age": 35 } }

// model: User
// operation: create
// args: { "data": { "name": "Dave", "email": "dave@example.com", "age": 28 } }

// model: User
// operation: findMany
// args: { "orderBy": { "age": "asc" }, "take": 2, "skip": 1 }`,
  },
  {
    name: "マイグレーション",
    code: `// --- schema ---
model User {
  id Int @id @default(autoincrement())
  name String
  email String @unique
}

// --- migration ---
model User {
  id Int @id @default(autoincrement())
  name String
  email String @unique
  age Int
  bio String
}

model Post {
  id Int @id @default(autoincrement())
  title String
}`,
  },
  {
    name: "ユニーク制約違反",
    code: `// --- schema ---
model User {
  id Int @id @default(autoincrement())
  name String
  email String @unique
}

// --- query ---
// model: User
// operation: create
// args: { "data": { "name": "Alice", "email": "alice@example.com" } }

// model: User
// operation: create
// args: { "data": { "name": "Bob", "email": "alice@example.com" } }`,
  },
];

/** クエリ命令をパースする型 */
interface QueryCommand {
  model: string;
  operation: string;
  args: Record<string, unknown>;
}

/** コードテキストからスキーマ部分を抽出する */
function extractSchema(code: string): string {
  const schemaMatch = code.match(/\/\/ --- schema ---\n([\s\S]*?)(?=\n\/\/ --- (?:query|migration) ---|$)/);
  return schemaMatch ? schemaMatch[1]!.trim() : "";
}

/** コードテキストからクエリ命令群を抽出する */
function extractQueries(code: string): QueryCommand[] {
  const querySection = code.match(/\/\/ --- query ---\n([\s\S]*?)$/);
  if (!querySection) return [];

  const commands: QueryCommand[] = [];
  const lines = querySection[1]!.split("\n");

  let model = "";
  let operation = "";

  for (const line of lines) {
    const trimmed = line.trim();

    const modelMatch = trimmed.match(/^\/\/ model:\s*(.+)$/);
    if (modelMatch) {
      model = modelMatch[1]!.trim();
      continue;
    }

    const opMatch = trimmed.match(/^\/\/ operation:\s*(.+)$/);
    if (opMatch) {
      operation = opMatch[1]!.trim();
      continue;
    }

    const argsMatch = trimmed.match(/^\/\/ args:\s*(.+)$/);
    if (argsMatch) {
      const args = JSON.parse(argsMatch[1]!.trim()) as Record<string, unknown>;
      commands.push({ model, operation, args });
    }
  }

  return commands;
}

/** コードテキストからマイグレーション先スキーマを抽出する */
function extractMigrationTarget(code: string): string | null {
  const migrationMatch = code.match(/\/\/ --- migration ---\n([\s\S]*?)$/);
  return migrationMatch ? migrationMatch[1]!.trim() : null;
}

/** テーブル形式で結果を表示する HTML を生成 */
function renderTable(rows: Row[]): string {
  if (rows.length === 0) return "結果なし";

  const keys = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      keys.add(key);
    }
  }
  const columns = [...keys];

  let text = columns.map((c) => c.padEnd(20)).join("") + "\n";
  text += columns.map(() => "─".repeat(20)).join("") + "\n";

  for (const row of rows) {
    text += columns
      .map((col) => {
        const val = row[col];
        const display = typeof val === "object" ? JSON.stringify(val) : String(val ?? "null");
        return display.padEnd(20);
      })
      .join("") + "\n";
  }

  return text;
}

/** Prisma シミュレーター UI クラス */
export class PrismaApp {
  init(container: HTMLElement): void {
    container.style.cssText = "display:flex;flex-direction:column;height:100vh;font-family:system-ui;background:#0f172a;color:#e2e8f0;";

    // ヘッダ
    const header = document.createElement("div");
    header.style.cssText = "padding:8px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #1e293b;flex-wrap:wrap;";
    const title = document.createElement("h1");
    title.textContent = "Prisma Simulator";
    title.style.cssText = "margin:0;font-size:15px;color:#8b5cf6;";
    header.appendChild(title);

    const select = document.createElement("select");
    select.style.cssText = "padding:4px 8px;background:#1e293b;border:1px solid #334155;border-radius:4px;color:#f8fafc;font-size:12px;";
    for (let i = 0; i < EXAMPLES.length; i++) {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = EXAMPLES[i]?.name ?? "";
      select.appendChild(opt);
    }
    header.appendChild(select);

    const runBtn = document.createElement("button");
    runBtn.textContent = "Run";
    runBtn.style.cssText = "padding:4px 16px;background:#8b5cf6;color:#f8fafc;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;";
    header.appendChild(runBtn);
    container.appendChild(header);

    // メイン
    const main = document.createElement("div");
    main.style.cssText = "flex:1;display:flex;overflow:hidden;";

    // 左: コードエディタ
    const leftPanel = document.createElement("div");
    leftPanel.style.cssText = "flex:1;display:flex;flex-direction:column;border-right:1px solid #1e293b;";

    const codeLabel = document.createElement("div");
    codeLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#8b5cf6;border-bottom:1px solid #1e293b;";
    codeLabel.textContent = "Prisma Schema + Query";
    leftPanel.appendChild(codeLabel);

    const codeArea = document.createElement("textarea");
    codeArea.style.cssText = "flex:1;padding:12px;font-family:'Fira Code',monospace;font-size:13px;background:#0f172a;color:#e2e8f0;border:none;outline:none;resize:none;tab-size:2;";
    codeArea.spellcheck = false;
    codeArea.value = EXAMPLES[0]?.code ?? "";
    leftPanel.appendChild(codeArea);
    main.appendChild(leftPanel);

    // 右: 出力 + マイグレーションログ
    const rightPanel = document.createElement("div");
    rightPanel.style.cssText = "flex:1;display:flex;flex-direction:column;";

    // クエリ結果
    const outLabel = document.createElement("div");
    outLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#8b5cf6;border-bottom:1px solid #1e293b;";
    outLabel.textContent = "Query Result";
    rightPanel.appendChild(outLabel);

    const outputDiv = document.createElement("div");
    outputDiv.style.cssText = "flex:1;padding:12px;font-family:monospace;font-size:13px;overflow-y:auto;white-space:pre-wrap;border-bottom:1px solid #1e293b;";
    rightPanel.appendChild(outputDiv);

    // マイグレーションログ
    const migLabel = document.createElement("div");
    migLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#f59e0b;border-bottom:1px solid #1e293b;";
    migLabel.textContent = "Execution Log";
    rightPanel.appendChild(migLabel);

    const logDiv = document.createElement("div");
    logDiv.style.cssText = "flex:1;padding:8px 12px;font-family:monospace;font-size:10px;overflow-y:auto;";
    rightPanel.appendChild(logDiv);

    main.appendChild(rightPanel);
    container.appendChild(main);

    // サンプル切り替え
    select.addEventListener("change", () => {
      const ex = EXAMPLES[Number(select.value)];
      if (ex !== undefined) codeArea.value = ex.code;
    });

    // 実行
    runBtn.addEventListener("click", () => {
      outputDiv.innerHTML = "";
      logDiv.innerHTML = "";

      const code = codeArea.value;
      const logs: string[] = [];
      const results: string[] = [];

      try {
        // スキーマのパース
        const schemaText = extractSchema(code);
        if (!schemaText) {
          appendError(outputDiv, "スキーマが見つかりません。'// --- schema ---' セクションを記述してください。");
          return;
        }

        logs.push("スキーマをパース中...");
        const schema = parseSchema(schemaText);
        logs.push(`パース完了: ${String(schema.models.length)} モデル検出`);
        for (const model of schema.models) {
          logs.push(`  ${model.name} (${String(model.fields.length)} フィールド)`);
        }

        // マイグレーションモード
        const migrationTarget = extractMigrationTarget(code);
        if (migrationTarget !== null) {
          logs.push("");
          logs.push("マイグレーション先スキーマをパース中...");
          const toSchema = parseSchema(migrationTarget);
          logs.push(`パース完了: ${String(toSchema.models.length)} モデル検出`);

          const steps = diffSchemas(schema, toSchema);
          if (steps.length === 0) {
            results.push("差分なし: スキーマは同一です");
          } else {
            results.push(`マイグレーションステップ: ${String(steps.length)} 件\n`);
            for (const step of steps) {
              switch (step.type) {
                case "CreateTable":
                  results.push(`  + CREATE TABLE ${step.tableName}`);
                  break;
                case "DropTable":
                  results.push(`  - DROP TABLE ${step.tableName}`);
                  break;
                case "AddColumn":
                  results.push(`  + ADD COLUMN ${step.tableName}.${step.field.name} (${step.field.type.name})`);
                  break;
                case "DropColumn":
                  results.push(`  - DROP COLUMN ${step.tableName}.${step.fieldName}`);
                  break;
                case "CreateIndex":
                  results.push(`  + CREATE ${step.unique ? "UNIQUE " : ""}INDEX ${step.indexName}`);
                  break;
              }
            }
          }

          // 結果出力
          const resultEl = document.createElement("span");
          resultEl.style.color = "#e2e8f0";
          resultEl.textContent = results.join("\n");
          outputDiv.appendChild(resultEl);

          // ログ出力
          renderLogs(logDiv, logs);
          return;
        }

        // クエリモード
        const queries = extractQueries(code);
        if (queries.length === 0) {
          appendError(outputDiv, "クエリが見つかりません。'// --- query ---' セクションを記述してください。");
          renderLogs(logDiv, logs);
          return;
        }

        const engine = new QueryEngine(schema);
        logs.push("");

        let lastResult: Row[] = [];
        for (const cmd of queries) {
          logs.push(`実行: prisma.${cmd.model}.${cmd.operation}(${JSON.stringify(cmd.args)})`);
          try {
            switch (cmd.operation) {
              case "findMany":
                lastResult = engine.findMany(cmd.model, cmd.args);
                logs.push(`  -> ${String(lastResult.length)} 件取得`);
                break;
              case "findUnique": {
                const row = engine.findUnique(cmd.model, cmd.args as { where: Record<string, unknown> });
                lastResult = row ? [row] : [];
                logs.push(`  -> ${row ? "1 件取得" : "該当なし"}`);
                break;
              }
              case "create": {
                const created = engine.create(cmd.model, cmd.args as { data: Row });
                lastResult = [created];
                logs.push(`  -> 作成完了 (id=${String(created.id ?? "?")})`);
                break;
              }
              case "update": {
                const updated = engine.update(cmd.model, cmd.args as { where: Record<string, unknown>; data: Row });
                lastResult = [updated];
                logs.push(`  -> 更新完了`);
                break;
              }
              case "delete": {
                const deleted = engine.delete(cmd.model, cmd.args as { where: Record<string, unknown> });
                lastResult = [deleted];
                logs.push(`  -> 削除完了`);
                break;
              }
              default:
                logs.push(`  -> 不明な操作: ${cmd.operation}`);
            }
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            logs.push(`  -> エラー: ${msg}`);
            // エラー結果を出力に表示
            const errEl = document.createElement("div");
            errEl.style.cssText = "color:#f87171;margin-bottom:4px;";
            errEl.textContent = `Error: ${msg}`;
            outputDiv.appendChild(errEl);
          }
        }

        // 最終クエリ結果を表示
        if (lastResult.length > 0) {
          const resultEl = document.createElement("span");
          resultEl.style.color = "#e2e8f0";
          resultEl.textContent = renderTable(lastResult);
          outputDiv.appendChild(resultEl);
        } else if (outputDiv.childNodes.length === 0) {
          const emptyEl = document.createElement("span");
          emptyEl.style.color = "#64748b";
          emptyEl.textContent = "結果なし";
          outputDiv.appendChild(emptyEl);
        }

        // 実行情報
        const infoEl = document.createElement("div");
        infoEl.style.cssText = "color:#64748b;margin-top:8px;font-size:11px;border-top:1px solid #1e293b;padding-top:4px;";
        infoEl.textContent = `Queries: ${String(queries.length)} | Models: ${String(schema.models.length)}`;
        outputDiv.appendChild(infoEl);

      } catch (e) {
        if (e instanceof SchemaParseError) {
          appendError(outputDiv, `Schema Parse Error: ${e.message}`);
        } else {
          appendError(outputDiv, `Error: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      // ログ出力
      renderLogs(logDiv, logs);
    });

    // 初回実行
    runBtn.click();
  }
}

/** エラーメッセージを出力エリアに追加する */
function appendError(container: HTMLElement, message: string): void {
  const errEl = document.createElement("div");
  errEl.style.cssText = "color:#f87171;";
  errEl.textContent = message;
  container.appendChild(errEl);
}

/** ログ行を描画する */
function renderLogs(container: HTMLElement, logs: string[]): void {
  for (const log of logs) {
    const row = document.createElement("div");
    row.style.cssText = "padding:1px 0;";

    // ログ内容に応じて色を変える
    if (log.startsWith("  -> エラー:")) {
      row.style.color = "#f87171";
    } else if (log.startsWith("  ->")) {
      row.style.color = "#68d391";
    } else if (log.startsWith("実行:")) {
      row.style.color = "#f59e0b";
    } else {
      row.style.color = "#64748b";
    }

    row.textContent = log;
    container.appendChild(row);
  }
}
