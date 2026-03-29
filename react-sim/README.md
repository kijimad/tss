# react-sim

Reactの内部ランタイムをシミュレートするTypeScriptプロジェクト。

## 機能

- **仮想DOM**: `createElement`によるVNode生成、テキストノード対応
- **差分検出（Reconciliation）**: 旧/新VNodeツリーの比較、最小パッチ生成（INSERT, REMOVE, UPDATE, REPLACE, REORDER）
- **レンダラー**: パッチのシミュレートDOM適用、操作履歴追跡
- **ファイバーアーキテクチャ**: child/sibling/returnポインタ、Hookリスト、副作用タグ
- **スケジューラー**: ワークループ、タイムスライシング、優先度レーン（Sync, Default, Idle）
- **Hooks**: useState, useEffect, useMemo, useCallback, useRef

## スクリプト

```bash
npm run dev        # 開発サーバー起動
npm run build      # ビルド
npm run test       # テスト実行
npm run test:watch # テスト監視モード
```
