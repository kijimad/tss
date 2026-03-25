# SQLite風データベースエンジン (TypeScript / ブラウザ)

## Context
学習目的で、SQLite風のデータベースエンジンをTypeScriptでゼロから実装する。ブラウザ上で動作し、4KBページベースのストレージをIndexedDBで永続化する。SQL全機能セット（JOIN, GROUP BY, HAVING, サブクエリ, INDEX）をサポートする。

## ディレクトリ構成
```
src/db/
  types.ts                 # 共通型（AST, SqlValue, ページ型等）
  database.ts              # 公開API (Database クラス)
  sql/
    token-types.ts         # トークン種別定義
    tokenizer.ts           # SQL → トークン列
    parser.ts              # トークン列 → AST（再帰下降）
  storage/
    page.ts                # 4KBページのシリアライズ/デシリアライズ
    pager.ts               # ページキャッシュ + dirty tracking
    idb-backend.ts         # IndexedDB ラッパー (PageStore インターフェース)
  btree/
    btree.ts               # B+Tree (insert/search/delete/rangeScan/fullScan)
    node.ts                # ノード操作ユーティリティ
  catalog/
    schema-manager.ts      # テーブル/インデックスのメタデータ管理
  executor/
    executor.ts            # AST → 実行結果
    expression.ts          # WHERE/HAVING式評価
    scan.ts                # シーケンシャルスキャン / インデックススキャン
    join.ts                # Nested Loop Join
    sort.ts                # ORDER BY / GROUP BY
    planner.ts             # インデックス選択の簡易プランナ
  __tests__/               # テスト群
src/db-ui/
  db-app.ts                # ブラウザUI
  sql-input.ts             # SQL入力エリア
  result-table.ts          # 結果テーブル
  schema-browser.ts        # スキーマ表示
```

## 実装フェーズ

### Phase 0: セットアップ
- `vitest` + `fake-indexeddb` を追加
- ディレクトリ構造作成

### Phase 1: SQLパーサ (Phase 2 と並行可)
- `token-types.ts`: トークン種別 (const object + 型)
- `tokenizer.ts`: 正規表現ベース。キーワード/リテラル/記号
- `parser.ts`: 再帰下降。まず CREATE TABLE, INSERT, 基本 SELECT
- `types.ts`: discriminated union で AST 型定義 (`type` フィールドで判別、`as` 不要)

### Phase 2: ストレージエンジン (Phase 1 と並行可)
- ページフォーマット (4096バイト ArrayBuffer):
  - ヘッダ 12B: pageType(u16), cellCount(u16), rightChild(u32), freeSpaceStart(u16), freeSpaceEnd(u16)
  - セルポインタ配列 (各2B)、セルデータ (末尾から前方向に成長)
- 値エンコーディング: タグバイト + データ (INTEGER=0x01+f64, TEXT=0x02+len+utf8, REAL=0x03+f64, BLOB=0x04+len+bytes, NULL=0x00)
- `PageStore` インターフェース → IndexedDB実装 + インメモリ実装(テスト用)
- ページキャッシュ (LRU, デフォルト64ページ)

### Phase 3: B+Tree
- リーフノードは nextLeaf で連結（範囲スキャン用）
- insert: ルートから下降→リーフ挿入→分割伝播
- search: キー完全一致
- rangeScan: AsyncGenerator でリーフチェーン走査
- delete: 単純リーフ削除（リバランスは後回し可）
- テスト: インメモリ PageStore で大量データ挿入・検索・削除

### Phase 4: スキーマ管理 + E2E ★最初の動作ポイント
- ページ0 = メタページ（テーブル/インデックス一覧）
- `Database.open(name)` / `Database.execute(sql)` / `Database.close()`
- CREATE TABLE → INSERT → SELECT の一気通貫

### Phase 5: WHERE / UPDATE / DELETE
- 式評価器: 比較、AND/OR/NOT、LIKE、BETWEEN、IN、IS NULL
- UPDATE: fullScan→filter→delete+insert
- DELETE: fullScan→filter→delete

### Phase 6: ORDER BY / LIMIT / CREATE INDEX
- インメモリソート
- セカンダリ B+Tree (インデックスキー → 主キー)
- 簡易プランナ: WHERE条件とインデックスの照合

### Phase 7: JOIN / GROUP BY / HAVING / サブクエリ
- Nested Loop Join (INNER / LEFT)
- GROUP BY + 集約関数 (COUNT, SUM, AVG, MIN, MAX)
- HAVING: グループ化後フィルタ
- サブクエリ: executor 再帰呼び出し

### Phase 8: ブラウザUI
- SQL入力 (textarea + Ctrl+Enter)、実行履歴
- 結果テーブル (HTML table)
- スキーマブラウザ

### Phase 9: 仕上げ
- エラーメッセージ改善、AUTOINCREMENT、NULL三値論理、テスト拡充

## 設計方針
- **`as` 回避**: 全 AST / QueryPlan を discriminated union (`type` フィールド) で定義。`switch`/`if` で自動ナローイング
- **非同期統一**: ストレージ操作は全て async/await。キャッシュヒット時も Promise 経由
- **テスト**: vitest。Parser は pure function テスト、Storage は in-memory PageStore、E2E は Database クラス経由

## 検証方法
1. `npm run test` で全テストパス
2. ブラウザで DB UI を開き、以下を実行:
   - CREATE TABLE → INSERT 複数行 → SELECT WHERE → UPDATE → DELETE
   - CREATE INDEX → インデックス使用確認
   - JOIN / GROUP BY / サブクエリ
3. ページリロード後もデータが残っている (IndexedDB 永続化)
