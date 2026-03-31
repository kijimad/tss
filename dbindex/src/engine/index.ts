/**
 * index.ts — DB インデックスシミュレーション
 *
 * B+Tree インデックス、Hash インデックス、Full Table Scan の
 * 3方式を同一データに対して実行し、ページ I/O 回数と
 * 探索パスを比較できるようにする。
 */

// ──────────────────────────────────────
// 型定義
// ──────────────────────────────────────

/** テーブル行 */
export interface Row {
  id: number;
  [col: string]: unknown;
}

/** ページ（ディスク上の 1 ブロック）*/
export interface Page {
  id: number;
  type: "leaf" | "internal" | "data" | "hash_bucket" | "overflow";
  keys: number[];
  /** 内部ノード: 子ページ ID / リーフ: 行 ID */
  children: number[];
  /** 行データ（data ページの場合）*/
  rows?: Row[];
}

/** 探索トレースの 1 ステップ */
export interface TraceStep {
  pageId: number;
  pageType: Page["type"];
  action: string;
  keysInPage: number[];
  ioCount: number;
}

/** クエリの実行計画 */
export interface QueryPlan {
  method: "btree" | "hash" | "full_scan";
  label: string;
  /** アクセスしたページ一覧 */
  trace: TraceStep[];
  /** 合計ページ I/O */
  totalIo: number;
  /** 結果行 */
  resultRows: Row[];
  /** 比較回数 */
  comparisons: number;
}

/** クエリ種別 */
export type QueryType =
  | { type: "eq"; column: string; value: number }
  | { type: "range"; column: string; from: number; to: number }
  | { type: "full" };

// ──────────────────────────────────────
// B+Tree
// ──────────────────────────────────────

/** B+Tree ノード */
interface BTreeNode {
  id: number;
  leaf: boolean;
  keys: number[];
  /** leaf: 行 ID, internal: 子ノード ID */
  children: number[];
  /** リーフのリンク (次のリーフ ID, -1 で終端) */
  next: number;
}

/** B+Tree インデックス */
export class BPlusTree {
  private nodes = new Map<number, BTreeNode>();
  private rootId = -1;
  private nextId = 0;
  readonly order: number;

  constructor(order: number = 4) {
    this.order = order;
  }

  /** ノード一覧（可視化用） */
  get allNodes(): BTreeNode[] {
    return [...this.nodes.values()];
  }

  /** ルートノード */
  get root(): BTreeNode | undefined {
    return this.nodes.get(this.rootId);
  }

  private getNode(id: number): BTreeNode | undefined {
    return this.nodes.get(id);
  }

  /** ソート済みキー配列から B+Tree を一括構築する */
  buildFromSorted(entries: { key: number; rowId: number }[]): void {
    this.nodes.clear();
    this.nextId = 0;
    this.rootId = -1;
    if (entries.length === 0) return;

    const addNode = (n: BTreeNode) => { this.nodes.set(n.id, n); };

    // リーフノード群を作成
    const leaves: BTreeNode[] = [];
    for (let i = 0; i < entries.length; i += this.order) {
      const chunk = entries.slice(i, i + this.order);
      const leaf: BTreeNode = {
        id: this.nextId++, leaf: true,
        keys: chunk.map((e) => e.key),
        children: chunk.map((e) => e.rowId),
        next: -1,
      };
      leaves.push(leaf);
      addNode(leaf);
    }
    for (let i = 0; i < leaves.length - 1; i++) {
      leaves[i]!.next = leaves[i + 1]!.id;
    }

    // サブツリーの最小キーを取得するヘルパー
    const getMinKey = (n: BTreeNode): number => {
      if (n.leaf) return n.keys[0]!;
      return getMinKey(this.nodes.get(n.children[0]!)!);
    };

    // 内部ノードをボトムアップで構築
    let currentLevel: BTreeNode[] = leaves;
    while (currentLevel.length > 1) {
      const nextLevel: BTreeNode[] = [];
      for (let i = 0; i < currentLevel.length; i += this.order) {
        const group = currentLevel.slice(i, i + this.order);
        const internal: BTreeNode = {
          id: this.nextId++, leaf: false,
          keys: group.slice(1).map((child) => getMinKey(child)),
          children: group.map((n) => n.id),
          next: -1,
        };
        nextLevel.push(internal);
        addNode(internal);
      }
      currentLevel = nextLevel;
    }
    this.rootId = currentLevel[0]!.id;
  }

  /** 等価検索 */
  searchEq(key: number): { trace: TraceStep[]; rowIds: number[]; comparisons: number } {
    const trace: TraceStep[] = [];
    let comparisons = 0;
    let io = 0;

    const rootNode = this.root;
    if (rootNode === undefined) return { trace, rowIds: [], comparisons };

    // ルートから探索
    let node = rootNode;
    while (!node.leaf) {
      io++;
      trace.push({
        pageId: node.id, pageType: "internal",
        action: `内部ノード: keys=[${node.keys.join(",")}] からキー ${key} の子を選択`,
        keysInPage: node.keys, ioCount: io,
      });
      let childIdx = node.children.length - 1;
      for (let i = 0; i < node.keys.length; i++) {
        comparisons++;
        if (key < node.keys[i]!) { childIdx = i; break; }
      }
      node = this.getNode(node.children[childIdx]!)!;
    }

    // リーフノード
    io++;
    const rowIds: number[] = [];
    for (let i = 0; i < node.keys.length; i++) {
      comparisons++;
      if (node.keys[i] === key) {
        rowIds.push(node.children[i]!);
      }
    }
    trace.push({
      pageId: node.id, pageType: "leaf",
      action: rowIds.length > 0
        ? `リーフ: キー ${key} を発見 → rowId=[${rowIds.join(",")}]`
        : `リーフ: キー ${key} は存在しない`,
      keysInPage: node.keys, ioCount: io,
    });

    return { trace, rowIds, comparisons };
  }

  /** 範囲検索 */
  searchRange(from: number, to: number): { trace: TraceStep[]; rowIds: number[]; comparisons: number } {
    const trace: TraceStep[] = [];
    let comparisons = 0;
    let io = 0;
    const rowIds: number[] = [];

    const rootNode = this.root;
    if (rootNode === undefined) return { trace, rowIds, comparisons };

    // ルートから最初のリーフまで降りる
    let node = rootNode;
    while (!node.leaf) {
      io++;
      trace.push({
        pageId: node.id, pageType: "internal",
        action: `内部ノード: keys=[${node.keys.join(",")}] から開始キー ${from} の子を選択`,
        keysInPage: node.keys, ioCount: io,
      });
      let childIdx = node.children.length - 1;
      for (let i = 0; i < node.keys.length; i++) {
        comparisons++;
        if (from < node.keys[i]!) { childIdx = i; break; }
      }
      node = this.getNode(node.children[childIdx]!)!;
    }

    // リーフをリンクで辿る
    let current: BTreeNode | undefined = node;
    while (current !== undefined) {
      io++;
      const found: number[] = [];
      for (let i = 0; i < current.keys.length; i++) {
        comparisons++;
        const k = current.keys[i]!;
        if (k > to) {
          rowIds.push(...found);
          trace.push({
            pageId: current.id, pageType: "leaf",
            action: `リーフ: ${found.length} 件一致, キー ${k} > ${to} → 範囲終了`,
            keysInPage: current.keys, ioCount: io,
          });
          return { trace, rowIds, comparisons };
        }
        if (k >= from) {
          found.push(current.children[i]!);
        }
      }
      rowIds.push(...found);
      trace.push({
        pageId: current.id, pageType: "leaf",
        action: `リーフ: ${found.length} 件一致 (keys=[${current.keys.join(",")}])`,
        keysInPage: current.keys, ioCount: io,
      });
      current = current.next >= 0 ? this.getNode(current.next) : undefined;
    }

    return { trace, rowIds, comparisons };
  }

  /** ページ情報を取得（可視化用） */
  toPages(): Page[] {
    return [...this.nodes.values()].map((n) => ({
      id: n.id,
      type: n.leaf ? "leaf" as const : "internal" as const,
      keys: n.keys,
      children: n.children,
    }));
  }
}

// ──────────────────────────────────────
// Hash インデックス
// ──────────────────────────────────────

/** Hash バケット */
interface HashBucket {
  id: number;
  entries: { key: number; rowId: number }[];
  overflow?: number;
}

/** Hash インデックス */
export class HashIndex {
  readonly bucketCount: number;
  private buckets: HashBucket[] = [];
  constructor(bucketCount: number = 8) {
    this.bucketCount = bucketCount;
    for (let i = 0; i < bucketCount; i++) {
      this.buckets.push({ id: i, entries: [] });
    }
  }

  /** データを挿入 */
  insert(key: number, rowId: number): void {
    const idx = key % this.bucketCount;
    this.buckets[idx]!.entries.push({ key, rowId });
  }

  /** 等価検索 */
  searchEq(key: number): { trace: TraceStep[]; rowIds: number[]; comparisons: number } {
    const trace: TraceStep[] = [];
    let comparisons = 0;
    let io = 0;

    const idx = key % this.bucketCount;
    const bucket = this.buckets[idx]!;
    io++;

    const rowIds: number[] = [];
    for (const entry of bucket.entries) {
      comparisons++;
      if (entry.key === key) rowIds.push(entry.rowId);
    }

    trace.push({
      pageId: bucket.id, pageType: "hash_bucket",
      action: `hash(${key}) = bucket[${idx}] → ${bucket.entries.length} エントリ走査, ${rowIds.length} 件一致`,
      keysInPage: bucket.entries.map((e) => e.key),
      ioCount: io,
    });

    return { trace, rowIds, comparisons };
  }

  /** ページ情報（可視化用） */
  toPages(): Page[] {
    return this.buckets.map((b) => ({
      id: b.id,
      type: "hash_bucket" as const,
      keys: b.entries.map((e) => e.key),
      children: b.entries.map((e) => e.rowId),
    }));
  }
}

// ──────────────────────────────────────
// テーブルとクエリ実行
// ──────────────────────────────────────

/** シミュレーション用テーブル */
export class Table {
  readonly name: string;
  readonly rows: Row[];
  readonly rowsPerPage: number;

  constructor(name: string, rows: Row[], rowsPerPage = 10) {
    this.name = name;
    this.rows = rows;
    this.rowsPerPage = rowsPerPage;
  }

  /** ページ数 */
  get pageCount(): number {
    return Math.ceil(this.rows.length / this.rowsPerPage);
  }

  /** フルスキャン */
  fullScan(query: QueryType): { trace: TraceStep[]; resultRows: Row[]; comparisons: number } {
    const trace: TraceStep[] = [];
    let comparisons = 0;
    let io = 0;
    const result: Row[] = [];

    for (let p = 0; p < this.pageCount; p++) {
      io++;
      const pageRows = this.rows.slice(p * this.rowsPerPage, (p + 1) * this.rowsPerPage);
      const keysInPage = pageRows.map((r) => r["id"] as number);
      let matched = 0;

      for (const row of pageRows) {
        comparisons++;
        if (query.type === "eq") {
          if (row[query.column] === query.value) { result.push(row); matched++; }
        } else if (query.type === "range") {
          const v = row[query.column] as number;
          if (v >= query.from && v <= query.to) { result.push(row); matched++; }
        } else {
          result.push(row); matched++;
        }
      }

      trace.push({
        pageId: p, pageType: "data",
        action: `データページ ${p}: ${pageRows.length} 行走査, ${matched} 件一致`,
        keysInPage, ioCount: io,
      });
    }

    return { trace, resultRows: result, comparisons };
  }
}

/** クエリを 3 方式で実行して比較する */
export function executeQuery(
  table: Table,
  btree: BPlusTree,
  hash: HashIndex,
  query: QueryType,
): { plans: QueryPlan[] } {
  const plans: QueryPlan[] = [];

  // 1. Full Scan
  const scan = table.fullScan(query);
  plans.push({
    method: "full_scan", label: "Full Table Scan",
    trace: scan.trace, totalIo: scan.trace.length,
    resultRows: scan.resultRows, comparisons: scan.comparisons,
  });

  // 2. B+Tree Index
  if (query.type === "eq") {
    const btResult = btree.searchEq(query.value);
    const resultRows = btResult.rowIds.map((id) => table.rows.find((r) => r["id"] === id)).filter((r): r is Row => r !== undefined);
    plans.push({
      method: "btree", label: "B+Tree Index Scan",
      trace: btResult.trace, totalIo: btResult.trace.length,
      resultRows, comparisons: btResult.comparisons,
    });
  } else if (query.type === "range") {
    const btResult = btree.searchRange(query.from, query.to);
    const resultRows = btResult.rowIds.map((id) => table.rows.find((r) => r["id"] === id)).filter((r): r is Row => r !== undefined);
    plans.push({
      method: "btree", label: "B+Tree Range Scan",
      trace: btResult.trace, totalIo: btResult.trace.length,
      resultRows, comparisons: btResult.comparisons,
    });
  }

  // 3. Hash Index (等価検索のみ)
  if (query.type === "eq") {
    const hResult = hash.searchEq(query.value);
    const resultRows = hResult.rowIds.map((id) => table.rows.find((r) => r["id"] === id)).filter((r): r is Row => r !== undefined);
    plans.push({
      method: "hash", label: "Hash Index Lookup",
      trace: hResult.trace, totalIo: hResult.trace.length,
      resultRows, comparisons: hResult.comparisons,
    });
  }

  return { plans };
}
