# NestJS Framework Simulator

ブラウザ上で NestJS のリクエストライフサイクルと主要機能を体験できるシミュレータです。

## 起動方法

```bash
cd nestjs
npm install
npm run dev
```

または Docker Compose で:

```bash
docker compose up nestjs
# http://localhost:5535
```

## シミュレートする NestJS 機能

### リクエストライフサイクル

NestJS がリクエストを受け取ってからレスポンスを返すまでの全ステップを再現します。

```
Client Request
  │
  ▼
Middleware        ← forRoutes パターンでフィルタリング
  │
  ▼
Guard             ← canActivate() で認可チェック
  │
  ▼
Interceptor       ← intercept() の前処理
  │
  ▼
Pipe              ← transform() でバリデーション/変換
  │
  ▼
Route Handler     ← コントローラのメソッド実行
  │
  ▼
Interceptor       ← intercept() の後処理（レスポンス変換）
  │
  ▼
Response
```

右パネルの「Request Lifecycle Trace」でこのフローがステップごとに表示されます。

### DI コンテナ

`@Injectable()` に相当するプロバイダをシングルトンとして管理します。依存関係は再帰的に解決されます。

```typescript
// ConfigService → DatabaseService → AppService のチェーン
@Injectable()
export class DatabaseService {
  constructor(private config: ConfigService) {}
}
```

シミュレータ内部では `ProviderDef.factory` の `resolve` 引数で依存を解決します。

### ルーティング

- パスパラメータ: `/users/:id` → `ctx.params["id"]`
- クエリ文字列: `/search?q=hello` → `ctx.query["q"]`
- HTTP メソッド: GET / POST / PUT / DELETE / PATCH

### ミドルウェア

`forRoutes` で適用対象を指定します。`"*"` は全ルートに適用されます。

```typescript
consumer.apply(LoggerMiddleware).forRoutes('*');
consumer.apply(AuthMiddleware).forRoutes('admin');
```

### ガード

コントローラレベルとルートレベルの両方で設定可能です。`canActivate()` が `false` を返すと 403 Forbidden になります。

```typescript
@Controller('dashboard')
@UseGuards(AuthGuard)          // コントローラ全体に適用
export class DashboardController {
  @Get('admin')
  @UseGuards(RolesGuard)       // このルートにのみ追加適用
  getAdmin() { ... }
}
```

### パイプ

リクエストボディのバリデーションや型変換を行います。`transform()` で例外を投げると 400 Bad Request になります。

### インターセプター

ハンドラの前後で処理を挟みます。レスポンスの変換（ラッピング、ロギング等）に使用します。

## プリセット例

| # | 名前 | 概要 |
|---|------|------|
| 1 | Hello World | 最小構成の Controller + GET ルート |
| 2 | CRUD ユーザー管理 | Service を注入した REST API (GET/POST/PUT/DELETE) |
| 3 | 依存性注入 (DI) | ConfigService → DatabaseService → AppService の3層チェーン |
| 4 | ミドルウェア | LoggerMiddleware (全ルート) + AuthMiddleware (/admin のみ) |
| 5 | ガード (認証) | AuthGuard (Bearer トークン) + RolesGuard (ロールチェック) |
| 6 | パイプ (バリデーション) | name/email/age のバリデーションルール |

## UI の使い方

1. 左上のドロップダウンからサンプルを選択
2. 左パネルに NestJS のコードが表示される
3. ヘッダのリクエストプリセットドロップダウンで送信するリクエストを選択（メソッド・パス・ボディが自動設定される）
4. 「Send」ボタンでリクエストを送信
5. 右パネルにレスポンスとライフサイクルトレースが表示される
6. メソッド・パス・ボディを自由に編集して独自のリクエストも送信可能

## ファイル構成

```
nestjs/
├── src/
│   ├── nest/
│   │   ├── interfaces.ts   # 型定義
│   │   ├── container.ts    # DI コンテナ
│   │   └── application.ts  # NestApplication (ルーティング + パイプライン)
│   ├── ui/
│   │   └── app.ts          # UI + EXAMPLES 定義
│   └── __tests__/
│       ├── nest.test.ts     # フレームワークコアのテスト
│       └── app.test.ts      # EXAMPLES のテスト
├── index.html
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

## テスト

```bash
npm test           # 42 テスト実行
npm run test:watch # ウォッチモード
```
