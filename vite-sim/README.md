# Vite Dev Server シミュレータ

ブラウザ上で動作する Vite dev server の実装。仮想ファイルシステム上のプロジェクトに対して、ファイル変換パイプライン、依存グラフ、HMR を実行し、各段階の出力を可視化する。

## 起動

```bash
npm install
npm run dev
```

## 画面の見方

- **左上**: ファイルツリー（クリックでファイル選択）
- **左中**: エディタ（選択中のファイルを編集）
- **左下**: 「Save + HMR」ボタン（保存して HMR 発火）、「Request File」ボタン（サーバにリクエスト）
- **右上**: **変換後の出力** — Vite がブラウザに返す JavaScript コード
- **右中**: **Transform Pipeline** — 適用された変換ステップの一覧
- **右下**: **Server Log** — HTTP リクエスト、変換、HMR イベント、依存グラフ更新

## Vite パイプライン

```
ブラウザ: GET /src/main.ts
    |
Dev Server:
    1. VFS からファイルを読む
    2. 変換パイプライン:
       strip-types → resolve-imports → hmr-inject
    3. 依存グラフを更新
    4. 変換済み JS をレスポンスとして返す
    |
ブラウザ: import 文を見て次のファイルをリクエスト
```

## サポートする変換

| 拡張子 | 変換内容 |
|--------|---------|
| `.ts` | 型注釈除去 → import 解決 → HMR 注入 |
| `.tsx` | 型注釈除去 → JSX→createElement → import 解決 → HMR 注入 |
| `.jsx` | JSX→createElement → import 解決 → HMR 注入 |
| `.js` | import 解決 → HMR 注入 |
| `.css` | CSS → JS (style タグ動的注入コード) に変換 |
| `.json` | `export default {...}` に変換 |
| `.svg` | 文字列として export |

## import パス解決

```javascript
// 相対パス → 絶対パス + タイムスタンプ
import { App } from './App.ts'
→ import { App } from '/src/App.ts?t=1234567890'

// bare import → /@modules/ プレフィックス (事前バンドル)
import React from 'react'
→ import React from '/@modules/react'
```

## 事前バンドル (Pre-bundling)

node_modules のパッケージは起動時に事前バンドルされ `/@modules/` パスで配信される。シミュレータには react, react-dom, lodash が含まれている。

## HMR (Hot Module Replacement)

ファイル変更時:
1. 変更されたファイルから依存グラフを上流に辿る
2. `import.meta.hot.accept()` があるモジュール（HMR 境界）で停止
3. 境界モジュールのみ再実行
4. 境界が見つからなければフルリロード

---

## 実験

### 実験 1: TypeScript 変換を確認する

1. ファイルツリーで `/src/main.ts` をクリック
2. 「Request File」をクリック
3. 右上に変換後の JavaScript が表示される
4. 右中の Transform Pipeline に適用されたステップ:
   - `strip-types`: TypeScript の型注釈を除去
   - `resolve-imports`: import パスを絶対パスに変換
   - `hmr-inject`: HMR クライアントコードを注入

---

### 実験 2: CSS の変換を確認する

1. `/src/style.css` をクリック
2. 「Request File」
3. CSS が JavaScript に変換されている:
   ```javascript
   const css = `body { ... }`;
   const style = document.createElement('style');
   style.textContent = css;
   document.head.appendChild(style);
   ```
4. ブラウザはこの JS を実行して動的に style タグを挿入する

---

### 実験 3: import パスの解決

1. `/src/main.ts` を Request
2. 変換後のコードで:
   - `'./App.ts'` → `'/src/App.ts?t=...'` （相対→絶対 + タイムスタンプ）
   - `'react'` → `'/@modules/react'` （bare import → 事前バンドル）
3. タイムスタンプはキャッシュバスティング用（ファイル更新時に変わる）

---

### 実験 4: ファイルを編集して HMR

1. `/src/Header.ts` をクリック
2. エディタで `"My App"` を `"Updated App"` に変更
3. 「Save + HMR」をクリック
4. Server Log に:
   - `[HMR] /src/Header.ts -> boundary: ...`
   - 依存グラフが更新される
5. 変換後の出力も更新される

---

### 実験 5: 事前バンドルされたモジュール

1. `/src/main.ts` のエディタに以下を追加:
   ```typescript
   import { useState } from 'react';
   ```
2. 「Request File」をクリック
3. 変換後のコードで `from "/@modules/react"` に変換されている
4. Server Log に `Pre-bundle: react` が表示されている（サーバ起動時に事前バンドル済み）

---

### 実験 6: JSON ファイルの変換

1. `/data.json` をクリック
2. 「Request File」
3. `export default {"name":"vite-app","version":"1.0.0"}` に変換されている
4. これにより `import data from './data.json'` で JSON を直接 import できる

---

### 実験 7: 依存グラフを観察する

1. 各ファイルを順に Request する: `/src/main.ts`, `/src/App.ts`, `/src/Header.ts`, `/src/utils.ts`
2. Server Log に `Dep graph: N modules, M edges` が表示される
3. リクエストするたびにモジュール数とエッジ数が増える
4. main.ts → App.ts → Header.ts のチェーンが構築される

---

### 実験 8: HMR 境界の確認

1. 全ファイルを Request して依存グラフを構築
2. `/src/style.css` を編集して Save + HMR
3. CSS は HMR 境界を持たないので、上流の `main.ts` まで伝播
4. HMR 境界が見つからない場合は `[HMR] Full reload` になる

---

### 実験 9: 新しいファイルを追加する

1. エディタに新しいコードを入力
2. ファイルツリーには現在のファイルしかないが、エディタで内容を変更して Save すれば反映される
3. 既存ファイルの import を追加すれば依存グラフに反映される

---

### 実験 10: Server Log を読む

各イベントの意味:
- `Server running at http://localhost:5173/` — サーバ起動
- `Pre-bundle: react` — node_modules のパッケージを事前バンドル
- `GET /src/main.ts [200] application/javascript (0.3ms)` — HTTP リクエスト処理
- `Transform: /src/main.ts [strip-types -> resolve-imports -> hmr-inject]` — 適用された変換
- `Dep graph: 4 modules, 3 edges` — 依存グラフの状態
- `[HMR] /src/App.ts -> boundary: /src/main.ts` — HMR 伝播

---

## 実際の Vite との違い

| Vite | このシミュレータ |
|------|-----------------|
| Node.js + Koa サーバ | メモリ上の仮想サーバ |
| esbuild で高速変換 | 正規表現ベースの簡易変換 |
| Rollup でプロダクションビルド | ビルド機能なし |
| WebSocket で HMR 通知 | 関数呼び出しで即時反映 |
| 実ファイルシステム監視 (chokidar) | 仮想 FS + 手動保存 |
| プラグインシステム | 固定の変換パイプライン |
| PostCSS / Sass / Less 対応 | CSS → JS 変換のみ |
