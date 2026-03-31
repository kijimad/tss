import { NestApplication } from "../nest/application.js";
import type {
  ModuleDef,
  PresetRequest,
  NestResponse,
  HttpMethod,
  TraceEvent,
} from "../nest/interfaces.js";

/** サンプル例の型定義 */
export interface Example {
  /** ドロップダウンに表示する名前 */
  name: string;
  /** エディタに表示する NestJS スタイルのコード */
  code: string;
  /** アプリケーションのモジュール定義 */
  module: ModuleDef;
  /** プリセットの HTTP リクエスト */
  requests: PresetRequest[];
  /** アプリケーション初期化後に呼ばれるフック */
  setup?: (app: NestApplication) => void;
}

/** サンプル例の一覧 */
export const EXAMPLES: Example[] = [
  // ── 1. Hello World ──
  {
    name: "Hello World",
    code: `import { Controller, Get, Module } from '@nestjs/common';

@Controller()
export class AppController {
  @Get()
  getHello(): string {
    return 'Hello, NestJS!';
  }

  @Get('health')
  health(): { status: string } {
    return { status: 'ok' };
  }
}

@Module({
  controllers: [AppController],
})
export class AppModule {}`,
    module: {
      name: "AppModule",
      controllers: [
        {
          name: "AppController",
          prefix: "/",
          routes: [
            {
              method: "GET",
              path: "/",
              handlerName: "getHello",
              handler: () => "Hello, NestJS!",
            },
            {
              method: "GET",
              path: "/health",
              handlerName: "health",
              handler: () => ({ status: "ok" }),
            },
          ],
        },
      ],
      providers: [],
    },
    requests: [
      { method: "GET", path: "/" },
      { method: "GET", path: "/health" },
      { method: "GET", path: "/not-found" },
    ],
  },

  // ── 2. CRUD ユーザー管理 ──
  {
    name: "CRUD ユーザー管理",
    code: `import { Controller, Get, Post, Put, Delete, Param, Body,
         Injectable, Module } from '@nestjs/common';

@Injectable()
export class UsersService {
  private users = [
    { id: 1, name: 'Alice', email: 'alice@example.com' },
    { id: 2, name: 'Bob',   email: 'bob@example.com' },
  ];

  findAll()          { return this.users; }
  findOne(id: number){ return this.users.find(u => u.id === id); }
  create(dto: any)   { const u = { id: this.users.length+1, ...dto }; this.users.push(u); return u; }
  update(id: number, dto: any) {
    const u = this.users.find(u => u.id === id);
    if (!u) return null;
    Object.assign(u, dto);
    return u;
  }
  remove(id: number) {
    const idx = this.users.findIndex(u => u.id === id);
    if (idx === -1) return null;
    return this.users.splice(idx, 1)[0];
  }
}

@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get()
  findAll()                { return this.usersService.findAll(); }
  @Get(':id')
  findOne(@Param('id') id) { return this.usersService.findOne(+id); }
  @Post()
  create(@Body() dto)      { return this.usersService.create(dto); }
  @Put(':id')
  update(@Param('id') id, @Body() dto) { return this.usersService.update(+id, dto); }
  @Delete(':id')
  remove(@Param('id') id)  { return this.usersService.remove(+id); }
}

@Module({
  controllers: [UsersController],
  providers:   [UsersService],
})
export class AppModule {}`,
    module: {
      name: "AppModule",
      controllers: [
        {
          name: "UsersController",
          prefix: "/users",
          routes: [
            {
              method: "GET",
              path: "/",
              handlerName: "findAll",
              handler: (ctx) => {
                type Svc = { findAll: () => unknown };
                return ctx.service<Svc>("UsersService").findAll();
              },
            },
            {
              method: "GET",
              path: "/:id",
              handlerName: "findOne",
              handler: (ctx) => {
                type Svc = { findOne: (id: number) => unknown };
                const user = ctx.service<Svc>("UsersService").findOne(Number(ctx.params["id"]));
                if (user === undefined) throw new Error("User not found");
                return user;
              },
            },
            {
              method: "POST",
              path: "/",
              handlerName: "create",
              handler: (ctx) => {
                type Svc = { create: (dto: unknown) => unknown };
                return ctx.service<Svc>("UsersService").create(ctx.body);
              },
            },
            {
              method: "PUT",
              path: "/:id",
              handlerName: "update",
              handler: (ctx) => {
                type Svc = { update: (id: number, dto: unknown) => unknown };
                return ctx.service<Svc>("UsersService").update(Number(ctx.params["id"]), ctx.body);
              },
            },
            {
              method: "DELETE",
              path: "/:id",
              handlerName: "remove",
              handler: (ctx) => {
                type Svc = { remove: (id: number) => unknown };
                return ctx.service<Svc>("UsersService").remove(Number(ctx.params["id"]));
              },
            },
          ],
        },
      ],
      providers: [
        {
          name: "UsersService",
          factory: () => {
            const users = [
              { id: 1, name: "Alice", email: "alice@example.com" },
              { id: 2, name: "Bob", email: "bob@example.com" },
            ];
            return {
              findAll: () => [...users],
              findOne: (id: number) => users.find((u) => u.id === id),
              create: (dto: Record<string, unknown>) => {
                const u = { id: users.length + 1, ...(dto as object) };
                users.push(u as typeof users[number]);
                return u;
              },
              update: (id: number, dto: Record<string, unknown>) => {
                const u = users.find((u) => u.id === id);
                if (!u) return null;
                Object.assign(u, dto);
                return u;
              },
              remove: (id: number) => {
                const idx = users.findIndex((u) => u.id === id);
                if (idx === -1) return null;
                return users.splice(idx, 1)[0];
              },
            };
          },
        },
      ],
    },
    requests: [
      { method: "GET", path: "/users" },
      { method: "GET", path: "/users/1" },
      { method: "POST", path: "/users", body: '{ "name": "Charlie", "email": "charlie@example.com" }' },
      { method: "PUT", path: "/users/1", body: '{ "name": "Alice Updated" }' },
      { method: "DELETE", path: "/users/2" },
    ],
  },

  // ── 3. 依存性注入 (DI) ──
  {
    name: "依存性注入 (DI)",
    code: `import { Controller, Get, Injectable, Module } from '@nestjs/common';

@Injectable()
export class ConfigService {
  get(key: string) { return { DB_HOST: 'localhost', DB_PORT: '5432' }[key]; }
}

@Injectable()
export class DatabaseService {
  constructor(private config: ConfigService) {}
  connect() {
    const host = this.config.get('DB_HOST');
    const port = this.config.get('DB_PORT');
    return \`Connected to \${host}:\${port}\`;
  }
  query(sql: string) { return [{ id: 1, result: sql }]; }
}

@Injectable()
export class AppService {
  constructor(private db: DatabaseService) {}
  getData() {
    const conn = this.db.connect();
    const rows = this.db.query('SELECT * FROM items');
    return { connection: conn, rows };
  }
}

@Controller()
export class AppController {
  constructor(private appService: AppService) {}

  @Get()
  getData() { return this.appService.getData(); }

  @Get('config')
  getConfig() { /* ConfigService を直接利用 */ }
}

@Module({
  controllers: [AppController],
  providers: [ConfigService, DatabaseService, AppService],
})
export class AppModule {}`,
    module: {
      name: "AppModule",
      controllers: [
        {
          name: "AppController",
          prefix: "/",
          routes: [
            {
              method: "GET",
              path: "/",
              handlerName: "getData",
              handler: (ctx) => {
                type Svc = { getData: () => unknown };
                return ctx.service<Svc>("AppService").getData();
              },
            },
            {
              method: "GET",
              path: "/config",
              handlerName: "getConfig",
              handler: (ctx) => {
                type Svc = { get: (key: string) => unknown };
                const config = ctx.service<Svc>("ConfigService");
                return {
                  DB_HOST: config.get("DB_HOST"),
                  DB_PORT: config.get("DB_PORT"),
                };
              },
            },
          ],
        },
      ],
      providers: [
        {
          name: "ConfigService",
          factory: () => ({
            get: (key: string) =>
              ({ DB_HOST: "localhost", DB_PORT: "5432" } as Record<string, string>)[key],
          }),
        },
        {
          name: "DatabaseService",
          factory: (resolve) => {
            type Cfg = { get: (key: string) => string };
            const config = resolve<Cfg>("ConfigService");
            return {
              connect: () => `Connected to ${config.get("DB_HOST")}:${config.get("DB_PORT")}`,
              query: (sql: string) => [{ id: 1, result: sql }],
            };
          },
        },
        {
          name: "AppService",
          factory: (resolve) => {
            type Db = { connect: () => string; query: (sql: string) => unknown[] };
            const db = resolve<Db>("DatabaseService");
            return {
              getData: () => ({
                connection: db.connect(),
                rows: db.query("SELECT * FROM items"),
              }),
            };
          },
        },
      ],
    },
    requests: [
      { method: "GET", path: "/" },
      { method: "GET", path: "/config" },
    ],
  },

  // ── 4. ミドルウェア ──
  {
    name: "ミドルウェア",
    code: `import { Controller, Get, Injectable, NestMiddleware,
         MiddlewareConsumer, Module } from '@nestjs/common';

@Injectable()
export class LoggerMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: Function) {
    console.log(\`[\${req.method}] \${req.url}\`);
    next();
  }
}

@Injectable()
export class AuthMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: Function) {
    const token = req.headers['x-api-key'];
    if (token) {
      req['user'] = { role: 'authenticated' };
    }
    next();
  }
}

@Controller('items')
export class ItemsController {
  @Get()
  findAll() { return [{ id: 1, name: 'Sword' }, { id: 2, name: 'Shield' }]; }
}

@Controller('admin')
export class AdminController {
  @Get()
  dashboard() { return { page: 'Admin Dashboard', secret: true }; }
}

@Module({
  controllers: [ItemsController, AdminController],
})
export class AppModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LoggerMiddleware).forRoutes('*');
    consumer.apply(AuthMiddleware).forRoutes('admin');
  }
}`,
    module: {
      name: "AppModule",
      controllers: [
        {
          name: "ItemsController",
          prefix: "/items",
          routes: [
            {
              method: "GET",
              path: "/",
              handlerName: "findAll",
              handler: () => [
                { id: 1, name: "Sword" },
                { id: 2, name: "Shield" },
              ],
            },
          ],
        },
        {
          name: "AdminController",
          prefix: "/admin",
          routes: [
            {
              method: "GET",
              path: "/",
              handlerName: "dashboard",
              handler: () => ({ page: "Admin Dashboard", secret: true }),
            },
          ],
        },
      ],
      providers: [],
      middlewares: [
        {
          name: "LoggerMiddleware",
          forRoutes: ["*"],
          use: () => {},
        },
        {
          name: "AuthMiddleware",
          forRoutes: ["/admin"],
          use: (ctx) => {
            if (ctx.headers["x-api-key"] !== undefined) {
              (ctx as unknown as Record<string, unknown>)["user"] = { role: "authenticated" };
            }
          },
        },
      ],
    },
    requests: [
      { method: "GET", path: "/items" },
      { method: "GET", path: "/admin" },
      { method: "GET", path: "/admin", headers: { "x-api-key": "secret-key-123" } },
    ],
  },

  // ── 5. ガード（認証）──
  {
    name: "ガード (認証)",
    code: `import { Controller, Get, UseGuards, CanActivate,
         ExecutionContext, Injectable, Module } from '@nestjs/common';

@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const token = request.headers['authorization'];
    return token === 'Bearer valid-token';
  }
}

@Injectable()
export class RolesGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const role = request.headers['x-role'];
    return role === 'admin';
  }
}

@Controller('dashboard')
@UseGuards(AuthGuard)
export class DashboardController {
  @Get()
  getPublic() { return { page: 'Dashboard' }; }

  @Get('admin')
  @UseGuards(RolesGuard)
  getAdmin() { return { page: 'Admin Panel', secret: 'data' }; }
}

@Module({
  controllers: [DashboardController],
})
export class AppModule {}`,
    module: {
      name: "AppModule",
      controllers: [
        {
          name: "DashboardController",
          prefix: "/dashboard",
          guards: [
            {
              name: "AuthGuard",
              canActivate: (ctx) => ctx.headers["authorization"] === "Bearer valid-token",
            },
          ],
          routes: [
            {
              method: "GET",
              path: "/",
              handlerName: "getPublic",
              handler: () => ({ page: "Dashboard" }),
            },
            {
              method: "GET",
              path: "/admin",
              handlerName: "getAdmin",
              handler: () => ({ page: "Admin Panel", secret: "data" }),
              guards: [
                {
                  name: "RolesGuard",
                  canActivate: (ctx) => ctx.headers["x-role"] === "admin",
                },
              ],
            },
          ],
        },
      ],
      providers: [],
    },
    requests: [
      { method: "GET", path: "/dashboard" },
      { method: "GET", path: "/dashboard", headers: { authorization: "Bearer valid-token" } },
      { method: "GET", path: "/dashboard/admin", headers: { authorization: "Bearer valid-token" } },
      {
        method: "GET",
        path: "/dashboard/admin",
        headers: { authorization: "Bearer valid-token", "x-role": "admin" },
      },
    ],
  },

  // ── 6. パイプ（バリデーション）──
  {
    name: "パイプ (バリデーション)",
    code: `import { Controller, Post, Body, UsePipes,
         PipeTransform, Injectable, Module } from '@nestjs/common';

@Injectable()
export class ValidationPipe implements PipeTransform {
  transform(value: any) {
    if (!value || typeof value !== 'object') {
      throw new Error('リクエストボディはオブジェクトである必要があります');
    }
    if (!value.name || typeof value.name !== 'string') {
      throw new Error('"name" フィールドは必須です (string)');
    }
    if (!value.email || !value.email.includes('@')) {
      throw new Error('"email" フィールドは有効なメールアドレスが必要です');
    }
    if (value.age !== undefined && (typeof value.age !== 'number' || value.age < 0)) {
      throw new Error('"age" フィールドは正の数値が必要です');
    }
    return value;
  }
}

@Controller('users')
export class UsersController {
  private users: any[] = [];

  @Post()
  @UsePipes(ValidationPipe)
  create(@Body() dto: any) {
    const user = { id: this.users.length + 1, ...dto };
    this.users.push(user);
    return user;
  }
}

@Module({
  controllers: [UsersController],
})
export class AppModule {}`,
    module: {
      name: "AppModule",
      controllers: [
        {
          name: "UsersController",
          prefix: "/users",
          routes: [
            {
              method: "POST",
              path: "/",
              handlerName: "create",
              pipes: [
                {
                  name: "ValidationPipe",
                  transform: (value) => {
                    if (value === null || value === undefined || typeof value !== "object") {
                      throw new Error("リクエストボディはオブジェクトである必要があります");
                    }
                    const obj = value as Record<string, unknown>;
                    if (!obj["name"] || typeof obj["name"] !== "string") {
                      throw new Error('"name" フィールドは必須です (string)');
                    }
                    if (
                      !obj["email"] ||
                      typeof obj["email"] !== "string" ||
                      !obj["email"].includes("@")
                    ) {
                      throw new Error('"email" フィールドは有効なメールアドレスが必要です');
                    }
                    if (
                      obj["age"] !== undefined &&
                      (typeof obj["age"] !== "number" || obj["age"] < 0)
                    ) {
                      throw new Error('"age" フィールドは正の数値が必要です');
                    }
                    return value;
                  },
                },
              ],
              handler: (ctx) => {
                const body = ctx.body as Record<string, unknown>;
                return { id: 1, ...body };
              },
            },
          ],
        },
      ],
      providers: [],
    },
    requests: [
      { method: "POST", path: "/users", body: '{ "name": "Alice", "email": "alice@example.com" }' },
      {
        method: "POST",
        path: "/users",
        body: '{ "name": "Bob", "email": "bob@example.com", "age": 25 }',
      },
      { method: "POST", path: "/users", body: '{ "email": "no-name@example.com" }' },
      { method: "POST", path: "/users", body: '{ "name": "Bad", "email": "invalid" }' },
      { method: "POST", path: "/users", body: '{ "name": "Neg", "email": "a@b.c", "age": -5 }' },
    ],
  },
];

/** トレースフェーズに対応する色 */
function phaseColor(phase: TraceEvent["phase"]): string {
  switch (phase) {
    case "routing":
      return "#60a5fa";
    case "middleware":
      return "#a78bfa";
    case "guard":
      return "#f59e0b";
    case "interceptor":
      return "#34d399";
    case "pipe":
      return "#f472b6";
    case "handler":
      return "#22d3ee";
    case "exception":
      return "#ef4444";
    case "response":
      return "#10b981";
  }
}

/** ステータスに対応するアイコン */
function statusIcon(s: TraceEvent["status"]): string {
  switch (s) {
    case "ok":
      return "\u2714";
    case "error":
      return "\u2718";
    case "skip":
      return "\u2500";
  }
}

export class NestJsApp {
  private app!: NestApplication;

  init(container: HTMLElement): void {
    container.style.cssText =
      "display:flex;flex-direction:column;height:100vh;font-family:'Fira Code','Cascadia Code',monospace;background:#0f172a;color:#e2e8f0;";

    // ── ヘッダ ──
    const header = document.createElement("div");
    header.style.cssText =
      "padding:8px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #1e293b;flex-wrap:wrap;";

    const title = document.createElement("h1");
    title.textContent = "NestJS Framework Simulator";
    title.style.cssText = "margin:0;font-size:15px;color:#e0234e;";
    header.appendChild(title);

    // サンプル選択ドロップダウン
    const select = document.createElement("select");
    select.style.cssText =
      "padding:4px 8px;background:#1e293b;border:1px solid #334155;border-radius:4px;color:#f8fafc;font-size:12px;";
    for (let i = 0; i < EXAMPLES.length; i++) {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = EXAMPLES[i]!.name;
      select.appendChild(opt);
    }
    header.appendChild(select);

    // リクエスト選択ドロップダウン
    const reqSelect = document.createElement("select");
    reqSelect.style.cssText =
      "padding:4px 8px;background:#1e293b;border:1px solid #334155;border-radius:4px;color:#94a3b8;font-size:11px;";
    header.appendChild(reqSelect);

    // Send ボタン
    const sendBtn = document.createElement("button");
    sendBtn.textContent = "Send";
    sendBtn.style.cssText =
      "padding:4px 16px;background:#e0234e;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;";
    header.appendChild(sendBtn);

    // メソッド + パス入力
    const methodSelect = document.createElement("select");
    methodSelect.style.cssText =
      "padding:4px 6px;background:#1e293b;border:1px solid #334155;border-radius:4px;color:#f8fafc;font-size:12px;";
    for (const m of ["GET", "POST", "PUT", "DELETE", "PATCH"]) {
      const opt = document.createElement("option");
      opt.value = m;
      opt.textContent = m;
      methodSelect.appendChild(opt);
    }
    header.appendChild(methodSelect);

    const pathInput = document.createElement("input");
    pathInput.type = "text";
    pathInput.value = "/";
    pathInput.style.cssText =
      "padding:4px 8px;background:#1e293b;border:1px solid #334155;border-radius:4px;color:#f8fafc;font-size:12px;width:200px;";
    pathInput.placeholder = "/path";
    header.appendChild(pathInput);

    container.appendChild(header);

    // ── メイン ──
    const main = document.createElement("div");
    main.style.cssText = "flex:1;display:flex;overflow:hidden;";

    // 左パネル: コードエディタ
    const leftPanel = document.createElement("div");
    leftPanel.style.cssText = "flex:1;display:flex;flex-direction:column;border-right:1px solid #1e293b;";

    const codeLabel = document.createElement("div");
    codeLabel.style.cssText =
      "padding:4px 12px;font-size:11px;font-weight:600;color:#e0234e;border-bottom:1px solid #1e293b;";
    codeLabel.textContent = "NestJS Application Code";
    leftPanel.appendChild(codeLabel);

    const codeArea = document.createElement("textarea");
    codeArea.style.cssText =
      "flex:1;padding:12px;font-family:inherit;font-size:12px;background:#0f172a;color:#e2e8f0;border:none;outline:none;resize:none;tab-size:2;";
    codeArea.spellcheck = false;
    codeArea.readOnly = true;
    leftPanel.appendChild(codeArea);
    main.appendChild(leftPanel);

    // 右パネル
    const rightPanel = document.createElement("div");
    rightPanel.style.cssText = "flex:1;display:flex;flex-direction:column;";

    // ボディ入力
    const bodyLabel = document.createElement("div");
    bodyLabel.style.cssText =
      "padding:4px 12px;font-size:11px;font-weight:600;color:#94a3b8;border-bottom:1px solid #1e293b;display:flex;align-items:center;gap:8px;";
    bodyLabel.textContent = "Request Body (JSON)";

    const headersInfo = document.createElement("span");
    headersInfo.style.cssText = "font-size:10px;color:#64748b;font-weight:400;";
    bodyLabel.appendChild(headersInfo);
    rightPanel.appendChild(bodyLabel);

    const bodyArea = document.createElement("textarea");
    bodyArea.style.cssText =
      "height:60px;padding:8px 12px;font-family:inherit;font-size:11px;background:#0f172a;color:#e2e8f0;border:none;outline:none;resize:none;border-bottom:1px solid #1e293b;";
    bodyArea.spellcheck = false;
    bodyArea.placeholder = '{ "key": "value" }';
    rightPanel.appendChild(bodyArea);

    // レスポンス
    const resLabel = document.createElement("div");
    resLabel.style.cssText =
      "padding:4px 12px;font-size:11px;font-weight:600;color:#10b981;border-bottom:1px solid #1e293b;";
    resLabel.textContent = "Response";
    rightPanel.appendChild(resLabel);

    const resDiv = document.createElement("div");
    resDiv.style.cssText =
      "padding:8px 12px;font-size:12px;overflow-y:auto;white-space:pre-wrap;border-bottom:1px solid #1e293b;max-height:150px;min-height:60px;";
    rightPanel.appendChild(resDiv);

    // ライフサイクルトレース
    const traceLabel = document.createElement("div");
    traceLabel.style.cssText =
      "padding:4px 12px;font-size:11px;font-weight:600;color:#f59e0b;border-bottom:1px solid #1e293b;";
    traceLabel.textContent = "Request Lifecycle Trace";
    rightPanel.appendChild(traceLabel);

    const traceDiv = document.createElement("div");
    traceDiv.style.cssText = "flex:1;padding:8px 12px;font-size:11px;overflow-y:auto;";
    rightPanel.appendChild(traceDiv);

    main.appendChild(rightPanel);
    container.appendChild(main);

    // ── 状態管理変数 ──
    let currentHeaders: Record<string, string> = {};

    // ── リクエストプリセットを更新する ──
    const updateReqOptions = (ex: Example) => {
      reqSelect.innerHTML = "";
      for (let i = 0; i < ex.requests.length; i++) {
        const r = ex.requests[i]!;
        const opt = document.createElement("option");
        opt.value = String(i);
        const hdrs = r.headers ? ` [${Object.keys(r.headers).join(",")}]` : "";
        opt.textContent = `${r.method} ${r.path}${hdrs}`;
        reqSelect.appendChild(opt);
      }
      applyPresetRequest(ex, 0);
    };

    // ── プリセットリクエストを適用する ──
    const applyPresetRequest = (ex: Example, idx: number) => {
      const r = ex.requests[idx];
      if (r === undefined) return;
      methodSelect.value = r.method;
      pathInput.value = r.path;
      bodyArea.value = r.body ?? "";
      currentHeaders = r.headers ?? {};
      headersInfo.textContent =
        Object.keys(currentHeaders).length > 0
          ? `Headers: ${Object.entries(currentHeaders)
              .map(([k, v]) => `${k}: ${v}`)
              .join(", ")}`
          : "";
    };

    // ── レスポンスを描画する ──
    const renderResponse = (res: NestResponse) => {
      const statusColor = res.status < 300 ? "#10b981" : res.status < 400 ? "#f59e0b" : "#ef4444";
      resDiv.innerHTML = "";
      const statusSpan = document.createElement("span");
      statusSpan.style.cssText = `color:${statusColor};font-weight:600;`;
      statusSpan.textContent = `HTTP ${res.status}\n`;
      resDiv.appendChild(statusSpan);

      const bodySpan = document.createElement("span");
      bodySpan.style.color = "#e2e8f0";
      bodySpan.textContent =
        typeof res.body === "string" ? res.body : JSON.stringify(res.body, null, 2);
      resDiv.appendChild(bodySpan);
    };

    // ── トレースを描画する ──
    const renderTrace = (trace: TraceEvent[]) => {
      traceDiv.innerHTML = "";
      for (const ev of trace) {
        const line = document.createElement("div");
        line.style.cssText = "margin-bottom:3px;display:flex;gap:6px;align-items:flex-start;";

        const badge = document.createElement("span");
        badge.style.cssText = `display:inline-block;min-width:80px;padding:1px 6px;border-radius:3px;font-size:10px;font-weight:600;text-align:center;background:${phaseColor(ev.phase)}22;color:${phaseColor(ev.phase)};border:1px solid ${phaseColor(ev.phase)}44;`;
        badge.textContent = ev.phase;
        line.appendChild(badge);

        const icon = document.createElement("span");
        icon.style.cssText = `color:${ev.status === "ok" ? "#10b981" : ev.status === "error" ? "#ef4444" : "#64748b"};`;
        icon.textContent = statusIcon(ev.status);
        line.appendChild(icon);

        const text = document.createElement("span");
        text.style.cssText = "color:#cbd5e1;";
        text.textContent = `${ev.name} — ${ev.detail}`;
        line.appendChild(text);

        traceDiv.appendChild(line);
      }
    };

    // ── イベントリスナ ──

    // サンプル切り替え
    select.addEventListener("change", () => {
      const ex = EXAMPLES[Number(select.value)];
      if (ex === undefined) return;
      codeArea.value = ex.code;
      this.app = new NestApplication(ex.module);
      if (ex.setup !== undefined) ex.setup(this.app);
      updateReqOptions(ex);
      resDiv.innerHTML = "";
      traceDiv.innerHTML = "";
    });

    // リクエストプリセット切り替え
    reqSelect.addEventListener("change", () => {
      const ex = EXAMPLES[Number(select.value)];
      if (ex === undefined) return;
      applyPresetRequest(ex, Number(reqSelect.value));
    });

    // リクエスト送信
    sendBtn.addEventListener("click", () => {
      const method = methodSelect.value as HttpMethod;
      const path = pathInput.value;
      let body: unknown = undefined;
      if (bodyArea.value.trim()) {
        try {
          body = JSON.parse(bodyArea.value);
        } catch {
          resDiv.innerHTML = "";
          const errSpan = document.createElement("span");
          errSpan.style.color = "#ef4444";
          errSpan.textContent = "JSON パースエラー: ボディが不正な JSON です";
          resDiv.appendChild(errSpan);
          traceDiv.innerHTML = "";
          return;
        }
      }
      const res = this.app.handleRequest(method, path, body, currentHeaders);
      renderResponse(res);
      renderTrace(res.trace);
    });

    // ── 初期表示 ──
    const firstExample = EXAMPLES[0]!;
    codeArea.value = firstExample.code;
    this.app = new NestApplication(firstExample.module);
    if (firstExample.setup !== undefined) firstExample.setup(this.app);
    updateReqOptions(firstExample);
  }
}
