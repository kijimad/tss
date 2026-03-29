# S3 Simulator

Amazon S3をシミュレートするTypeScript + Vite + Vitestプロジェクト。

## 機能

- **バケット管理**: CreateBucket, DeleteBucket, ListBuckets
- **オブジェクト操作**: PutObject, GetObject, DeleteObject, HeadObject, CopyObject
- **ListObjectsV2**: prefix, delimiter（フォルダ表示）, continuation token, max-keys
- **バージョニング**: バージョンID, 削除マーカー, バージョン一覧
- **ACL**: private, public-read, authenticated-read
- **AWS Signature V4**: HMAC-SHA256チェーン, 正規リクエスト, 署名付きURL
- **マルチパートアップロード**: 開始 → パートアップロード → 完了/中止
- **XMLレスポンス**: ListBucketResult, Error形式
- **ブラウザUI**: S3コンソール風のバケット/オブジェクトブラウザ

## セットアップ

```bash
npm install
```

## コマンド

```bash
npm run dev        # 開発サーバー起動
npm run build      # ビルド
npm run test       # テスト実行
npm run test:watch # テスト監視モード
```

## プロジェクト構成

```
src/
  storage/bucket.ts   # バケット管理
  storage/object.ts   # オブジェクトストレージ
  api/rest.ts         # REST APIシミュレーション
  api/auth.ts         # AWS Signature V4
  api/multipart.ts    # マルチパートアップロード
  ui/app.ts           # ブラウザUI
  __tests__/s3.test.ts # テスト
```
