# SMTP シミュレータ

仮想ネットワーク上でのメール送信（SMTP）をシミュレートするプロジェクトです。

## 試し方

### 1. 基本的なメール送信
From: `alice@example.com` → To: `charlie@test.org` でメールを送信し、プロトコルログにEHLO→MAIL FROM→RCPT TO→DATA→QUITの流れが表示されることを確認。

### 2. 同一ドメイン内メール送信
From: `alice@example.com` → To: `bob@example.com` で同一ドメイン内の配信を確認。

### 3. 存在しないユーザーへの送信
To: `nobody@example.com` に送信し、550エラー（ユーザー不明）がログに表示されることを確認。

### 4. 存在しないドメインへの送信
To: `someone@nonexistent.com` に送信し、DNS MXルックアップ失敗を確認。

### 5. 複数メールの連続送信
同じ宛先に複数メールを送信し、メールボックスビューアで受信メール一覧を確認。

### 6. 異なるドメイン間の送信
`example.com` → `test.org` → `corp.local` の各ドメイン間で送信を試す。

### 7. MIMEヘッダーの確認
プロトコルログにFrom、To、Subject、Date、Message-ID、Content-Typeが含まれることを確認。

### 8. メールボックスビューア
サーバーを選択して「更新」ボタンをクリックし、各ユーザーの受信メールを閲覧。

### 9. プロトコルログの詳細確認
C->S（クライアント→サーバー）とS->C（サーバー→クライアント）の方向がログで色分け表示されることを確認。

### 10. 不正なアドレスでの送信
`@`を含まないアドレスを入力して送信し、エラーハンドリングを確認。

## 開発

```bash
npm install
npm run dev      # 開発サーバー起動
npm run build    # ビルド
npm test         # テスト実行
npm run test:watch  # テスト監視モード
```
