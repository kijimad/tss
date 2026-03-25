import { PageType, type QueryResult, type Stmt } from "./types.js";
import { Pager } from "./storage/pager.js";
import { IdbPageStore, MemoryPageStore } from "./storage/idb-backend.js";
import { SchemaManager } from "./catalog/schema-manager.js";
import { Executor } from "./executor/executor.js";
import { tokenize } from "./sql/tokenizer.js";
import { Parser } from "./sql/parser.js";
import { readPageType } from "./storage/page.js";

// メタページID
const META_PAGE_ID = 1;

// 公開API
export class Database {
  private pager: Pager;
  private schema!: SchemaManager;
  private executor!: Executor;

  private constructor(pager: Pager) {
    this.pager = pager;
  }

  // IndexedDBバックエンドで開く
  static async open(name: string): Promise<Database> {
    const store = await IdbPageStore.open(name);
    const pager = new Pager(store);
    await pager.init();

    const db = new Database(pager);
    await db.initSchema();
    return db;
  }

  // テスト用インメモリバックエンドで開く
  static async openMemory(): Promise<Database> {
    const store = new MemoryPageStore();
    const pager = new Pager(store);
    await pager.init();

    const db = new Database(pager);
    await db.initSchema();
    return db;
  }

  // SQLを実行
  async execute(sql: string): Promise<QueryResult> {
    const tokens = tokenize(sql);
    const parser = new Parser(tokens);
    const stmt = parser.parse();
    const result = await this.executor.execute(stmt);
    await this.pager.flush();
    return result;
  }

  // 複数SQL文を一括実行
  async executeMultiple(sql: string): Promise<QueryResult[]> {
    const tokens = tokenize(sql);
    const parser = new Parser(tokens);
    const stmts = parser.parseMultiple();
    const results: QueryResult[] = [];
    for (const stmt of stmts) {
      results.push(await this.executor.execute(stmt));
    }
    await this.pager.flush();
    return results;
  }

  // SQL文をパースのみ（デバッグ用）
  parseSql(sql: string): Stmt {
    const tokens = tokenize(sql);
    return new Parser(tokens).parse();
  }

  async close(): Promise<void> {
    await this.pager.flush();
  }

  // スキーママネージャへのアクセス
  getSchema(): SchemaManager {
    return this.schema;
  }

  private async initSchema(): Promise<void> {
    let metaRootPageId: number;

    if (this.pager.getMaxPageId() === 0) {
      // 新規データベース: メタページを作成
      const { pageId } = await this.pager.allocatePage(PageType.Leaf);
      metaRootPageId = pageId;
    } else {
      // 既存データベース: メタページを読み込む
      try {
        const metaPage = await this.pager.getPage(META_PAGE_ID);
        readPageType(metaPage); // 有効性チェック
        metaRootPageId = META_PAGE_ID;
      } catch {
        // メタページが見つからない場合は新規作成
        const { pageId } = await this.pager.allocatePage(PageType.Leaf);
        metaRootPageId = pageId;
      }
    }

    this.schema = new SchemaManager(this.pager, metaRootPageId);
    await this.schema.load();
    this.executor = new Executor(this.pager, this.schema);
    await this.pager.flush();
  }
}
