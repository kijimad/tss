# prisma-sim

Prisma ORM シミュレーター。スキーマパーサー、クエリエンジン、マイグレーションシステム、リレーション処理、クライアント生成をコードで表現します。

## 機能

- **スキーマパーサー**: Prisma スキーマ言語を AST に変換
- **クエリエンジン**: findMany, findUnique, create, update, delete をサポート
- **マイグレーション**: 2つのスキーマを比較し、マイグレーションステップを生成
- **リレーション**: 1:1, 1:N, N:M のリレーションを処理
- **UI**: スキーマエディタ、クエリビルダー、結果ビューア、マイグレーションログ

## 開発

```bash
npm install
npm run dev      # 開発サーバー起動
npm run test     # テスト実行
npm run build    # ビルド
```
