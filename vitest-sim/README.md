# Vitest シミュレータ

ブラウザ上で動作するテストランナーの実装。`describe`/`it`/`expect` API、`beforeEach`/`afterEach` フック、詳細なマッチャーを提供し、テスト実行過程を可視化する。

## 起動

```bash
npm install
npm run dev
```

## 画面の見方

- **左上**: テストファイルタブ（7ファイル）
- **左**: テストコードエディタ（編集可能）
- **右上**: テスト結果ツリー（パス/フェイル + 所要時間）
- **右下**: ランナーログ（テスト実行の詳細イベント）
- **ヘッダ右**: 統計（総テスト数、パス数、フェイル数、実行時間）

## サポートする API

### テスト定義

| API | 説明 |
|-----|------|
| `describe(name, fn)` | テストスイートの定義（ネスト可能） |
| `it(name, fn)` | テストケースの定義 |
| `test(name, fn)` | `it` のエイリアス |
| `beforeEach(fn)` | 各テストの前に実行 |
| `afterEach(fn)` | 各テストの後に実行 |
| `beforeAll(fn)` | スイート開始前に1回実行 |
| `afterAll(fn)` | スイート終了後に1回実行 |

### マッチャー (expect)

| マッチャー | 説明 | 例 |
|-----------|------|---|
| `.toBe(val)` | `Object.is` で厳密比較 | `expect(1).toBe(1)` |
| `.toEqual(val)` | 深い比較（オブジェクト/配列） | `expect({a:1}).toEqual({a:1})` |
| `.toBeTruthy()` | truthy な値 | `expect(1).toBeTruthy()` |
| `.toBeFalsy()` | falsy な値 | `expect(0).toBeFalsy()` |
| `.toBeNull()` | `null` | `expect(null).toBeNull()` |
| `.toBeUndefined()` | `undefined` | `expect(undefined).toBeUndefined()` |
| `.toBeDefined()` | `undefined` でない | `expect(42).toBeDefined()` |
| `.toBeGreaterThan(n)` | `>` | `expect(10).toBeGreaterThan(5)` |
| `.toBeLessThan(n)` | `<` | `expect(3).toBeLessThan(10)` |
| `.toBeCloseTo(n, p)` | 浮動小数点近似 | `expect(0.1+0.2).toBeCloseTo(0.3)` |
| `.toContain(val)` | 配列/文字列に含む | `expect([1,2]).toContain(1)` |
| `.toHaveLength(n)` | 長さ | `expect("abc").toHaveLength(3)` |
| `.toMatch(pat)` | 正規表現/文字列マッチ | `expect("a-1").toMatch(/\\d/)` |
| `.toThrow(msg?)` | 例外を投げる | `expect(fn).toThrow("err")` |
| `.not.xxx()` | 否定 | `expect(1).not.toBe(2)` |

---

## 実験

### 実験 1: 基本的なテスト実行

1. 「Run All Tests」をクリック
2. 右パネルに各ファイルの結果がツリー表示される
3. 緑チェック = パス、赤バツ = フェイル
4. ヘッダに統計が表示される

---

### 実験 2: 失敗するテストを観察する

1. `failing.test.js` タブをクリック
2. コード内の `expect(1 + 1).toBe(3)` が意図的に失敗する
3. 「Run All Tests」
4. 失敗したテストに赤いエラーメッセージが表示される:
   ```
   expect(2).toBe(3) -- received: 2
   ```
5. expected と received の値が明示される

---

### 実験 3: テストコードを編集する

1. `math.test.js` タブを選択
2. エディタで `expect(1 + 2).toBe(3)` を `expect(1 + 2).toBe(4)` に変更
3. 「Run All Tests」
4. そのテストが失敗に変わる
5. 元に戻して再実行すればパスに戻る

---

### 実験 4: beforeEach フック

1. `hooks.test.js` タブを選択
2. `beforeEach` で `items = []` にリセットしている
3. 各テストが独立して動作する（前のテストの状態が残らない）
4. beforeEach をコメントアウトして再実行 → "is reset by beforeEach" が失敗する

---

### 実験 5: オブジェクトの深い比較

1. `object.test.js` を確認
2. `toEqual` はオブジェクトの各プロパティを再帰的に比較する
3. `toBe` と `toEqual` の違い:
   - `toBe`: 参照の同一性（`===`）
   - `toEqual`: 値の同等性（中身が同じなら OK）

---

### 実験 6: 例外テスト

1. `exceptions.test.js` を確認
2. `expect(fn).toThrow("boom")` — 関数が "boom" を含む例外を投げることを検証
3. `expect(fn).not.toThrow()` — 例外を投げないことを検証

---

### 実験 7: 新しいテストファイルを書く

`math.test.js` のコードを全部消して以下を入力:

```javascript
describe("my tests", function() {
  it("string repeat", function() {
    var result = "ha".repeat(3);
    expect(result).toBe("hahaha");
    expect(result).toHaveLength(6);
  });

  it("array operations", function() {
    var arr = [3, 1, 2];
    arr.sort();
    expect(arr).toEqual([1, 2, 3]);
    expect(arr).toHaveLength(3);
  });
});
```

「Run All Tests」で実行される。

---

### 実験 8: ランナーログを読む

右下のログに表示されるイベント:
- `▶ math.test.js` — ファイル実行開始
- `  Math` — describe ブロック開始
- `  ○ addition` — テスト開始
- `  ✓ addition (0.1ms, 2 assertions)` — テストパス（所要時間とアサーション数）
- `  ✗ this should fail (0.0ms) -- expect(2).toBe(3)` — テスト失敗（エラーメッセージ）
- `Test Files 7 | Tests 20 passed, 2 failed | 5ms` — 最終集計

---

### 実験 9: not マッチャー

```javascript
it("not examples", function() {
  expect(1).not.toBe(2);
  expect("hello").not.toContain("xyz");
  expect([1, 2]).not.toHaveLength(5);
  expect(null).not.toBeDefined();
});
```

`.not` は全てのマッチャーの前に付けて否定できる。

---

### 実験 10: 浮動小数点の罠

```javascript
it("floating point", function() {
  // これは失敗する！
  // expect(0.1 + 0.2).toBe(0.3);

  // toBeCloseTo を使う
  expect(0.1 + 0.2).toBeCloseTo(0.3);
});
```

`0.1 + 0.2` は `0.30000000000000004` なので `toBe(0.3)` は失敗する。`toBeCloseTo` は指定精度内で比較するので成功する。

---

## 実際の Vitest との違い

| Vitest | このシミュレータ |
|--------|-----------------|
| Vite ベースの高速変換 | `new Function` で直接実行 |
| ワーカースレッドで並列実行 | シングルスレッド逐次実行 |
| ファイルシステム監視 (watch モード) | 手動実行 |
| スナップショットテスト | 未実装 |
| モック (vi.fn, vi.mock) | 未実装 |
| カバレッジ (c8/istanbul) | 未実装 |
| TypeScript サポート | JS のみ（var で変数宣言） |
| 非同期テスト (async/await) | 同期のみ |
| .each / parameterized tests | 未実装 |
