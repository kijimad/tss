import { describe, it, expect, beforeEach } from "vitest";
import { NestApplication } from "../nest/application.js";
import { DIContainer } from "../nest/container.js";
import type { ModuleDef, GuardDef, PipeDef, InterceptorDef } from "../nest/interfaces.js";

// ── DIContainer テスト ──

describe("DIContainer", () => {
  let container: DIContainer;

  beforeEach(() => {
    container = new DIContainer();
  });

  it("プロバイダを登録して解決できる", () => {
    container.register({
      name: "TestService",
      factory: () => ({ hello: () => "world" }),
    });
    const svc = container.resolve<{ hello: () => string }>("TestService");
    expect(svc.hello()).toBe("world");
  });

  it("シングルトンとして動作する（同じインスタンスを返す）", () => {
    container.register({
      name: "Counter",
      factory: () => ({ count: 0 }),
    });
    const a = container.resolve<{ count: number }>("Counter");
    a.count = 42;
    const b = container.resolve<{ count: number }>("Counter");
    expect(b.count).toBe(42);
  });

  it("依存関係を再帰的に解決できる", () => {
    container.register({ name: "A", factory: () => ({ value: "a" }) });
    container.register({
      name: "B",
      factory: (resolve) => {
        const a = resolve<{ value: string }>("A");
        return { value: `b+${a.value}` };
      },
    });
    container.register({
      name: "C",
      factory: (resolve) => {
        const b = resolve<{ value: string }>("B");
        return { value: `c+${b.value}` };
      },
    });
    const c = container.resolve<{ value: string }>("C");
    expect(c.value).toBe("c+b+a");
  });

  it("未登録のプロバイダでエラーになる", () => {
    expect(() => container.resolve("Unknown")).toThrow('Provider "Unknown" が見つかりません');
  });

  it("clear でリセットできる", () => {
    container.register({ name: "X", factory: () => ({}) });
    container.resolve("X");
    container.clear();
    expect(() => container.resolve("X")).toThrow();
  });
});

// ── NestApplication テスト ──

describe("NestApplication", () => {
  /** 基本的なモジュール定義を生成する */
  function createBasicModule(): ModuleDef {
    return {
      name: "TestModule",
      controllers: [
        {
          name: "TestController",
          prefix: "/test",
          routes: [
            { method: "GET", path: "/", handlerName: "index", handler: () => "ok" },
            {
              method: "GET",
              path: "/:id",
              handlerName: "findOne",
              handler: (ctx) => ({ id: ctx.params["id"] }),
            },
            {
              method: "POST",
              path: "/",
              handlerName: "create",
              handler: (ctx) => ({ created: ctx.body }),
            },
          ],
        },
      ],
      providers: [],
    };
  }

  it("GET リクエストを処理できる", () => {
    const app = new NestApplication(createBasicModule());
    const res = app.handleRequest("GET", "/test");
    expect(res.status).toBe(200);
    expect(res.body).toBe("ok");
  });

  it("パスパラメータを抽出できる", () => {
    const app = new NestApplication(createBasicModule());
    const res = app.handleRequest("GET", "/test/42");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: "42" });
  });

  it("POST ボディを受け取れる", () => {
    const app = new NestApplication(createBasicModule());
    const res = app.handleRequest("POST", "/test", { name: "Alice" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ created: { name: "Alice" } });
  });

  it("存在しないルートで 404 を返す", () => {
    const app = new NestApplication(createBasicModule());
    const res = app.handleRequest("GET", "/not-found");
    expect(res.status).toBe(404);
    expect(res.trace[0]?.status).toBe("error");
  });

  it("クエリ文字列をパースできる", () => {
    const mod: ModuleDef = {
      name: "M",
      controllers: [
        {
          name: "C",
          prefix: "/",
          routes: [
            {
              method: "GET",
              path: "/search",
              handlerName: "search",
              handler: (ctx) => ctx.query,
            },
          ],
        },
      ],
      providers: [],
    };
    const app = new NestApplication(mod);
    const res = app.handleRequest("GET", "/search?q=hello&page=2");
    expect(res.body).toEqual({ q: "hello", page: "2" });
  });

  it("トレースにルーティング・ハンドラ・レスポンスのイベントが含まれる", () => {
    const app = new NestApplication(createBasicModule());
    const res = app.handleRequest("GET", "/test");
    const phases = res.trace.map((t) => t.phase);
    expect(phases).toContain("routing");
    expect(phases).toContain("handler");
    expect(phases).toContain("response");
  });

  it("DI コンテナからサービスを解決してハンドラで利用できる", () => {
    const mod: ModuleDef = {
      name: "M",
      controllers: [
        {
          name: "C",
          prefix: "/",
          routes: [
            {
              method: "GET",
              path: "/",
              handlerName: "index",
              handler: (ctx) => {
                type Svc = { greet: () => string };
                return ctx.service<Svc>("GreetService").greet();
              },
            },
          ],
        },
      ],
      providers: [{ name: "GreetService", factory: () => ({ greet: () => "Hello from DI!" }) }],
    };
    const app = new NestApplication(mod);
    const res = app.handleRequest("GET", "/");
    expect(res.body).toBe("Hello from DI!");
  });
});

// ── ミドルウェアテスト ──

describe("ミドルウェア", () => {
  it("対象ルートのみで実行される", () => {
    const log: string[] = [];
    const mod: ModuleDef = {
      name: "M",
      controllers: [
        {
          name: "A",
          prefix: "/a",
          routes: [{ method: "GET", path: "/", handlerName: "index", handler: () => "a" }],
        },
        {
          name: "B",
          prefix: "/b",
          routes: [{ method: "GET", path: "/", handlerName: "index", handler: () => "b" }],
        },
      ],
      providers: [],
      middlewares: [
        {
          name: "OnlyA",
          forRoutes: ["/a"],
          use: () => {
            log.push("middleware-a");
          },
        },
      ],
    };
    const app = new NestApplication(mod);
    app.handleRequest("GET", "/a");
    app.handleRequest("GET", "/b");
    expect(log).toEqual(["middleware-a"]);
  });

  it("forRoutes '*' で全ルートに適用される", () => {
    let count = 0;
    const mod: ModuleDef = {
      name: "M",
      controllers: [
        {
          name: "C",
          prefix: "/",
          routes: [
            { method: "GET", path: "/a", handlerName: "a", handler: () => "a" },
            { method: "GET", path: "/b", handlerName: "b", handler: () => "b" },
          ],
        },
      ],
      providers: [],
      middlewares: [
        {
          name: "Global",
          forRoutes: ["*"],
          use: () => {
            count++;
          },
        },
      ],
    };
    const app = new NestApplication(mod);
    app.handleRequest("GET", "/a");
    app.handleRequest("GET", "/b");
    expect(count).toBe(2);
  });
});

// ── ガードテスト ──

describe("ガード", () => {
  const authGuard: GuardDef = {
    name: "AuthGuard",
    canActivate: (ctx) => ctx.headers["authorization"] === "Bearer token",
  };

  it("認証失敗で 403 を返す", () => {
    const mod: ModuleDef = {
      name: "M",
      controllers: [
        {
          name: "C",
          prefix: "/",
          guards: [authGuard],
          routes: [{ method: "GET", path: "/", handlerName: "index", handler: () => "secret" }],
        },
      ],
      providers: [],
    };
    const app = new NestApplication(mod);
    const res = app.handleRequest("GET", "/");
    expect(res.status).toBe(403);
  });

  it("認証成功でハンドラが実行される", () => {
    const mod: ModuleDef = {
      name: "M",
      controllers: [
        {
          name: "C",
          prefix: "/",
          guards: [authGuard],
          routes: [{ method: "GET", path: "/", handlerName: "index", handler: () => "secret" }],
        },
      ],
      providers: [],
    };
    const app = new NestApplication(mod);
    const res = app.handleRequest("GET", "/", undefined, { authorization: "Bearer token" });
    expect(res.status).toBe(200);
    expect(res.body).toBe("secret");
  });

  it("ルートレベルのガードが機能する", () => {
    const mod: ModuleDef = {
      name: "M",
      controllers: [
        {
          name: "C",
          prefix: "/",
          routes: [
            { method: "GET", path: "/public", handlerName: "pub", handler: () => "public" },
            {
              method: "GET",
              path: "/private",
              handlerName: "priv",
              handler: () => "private",
              guards: [authGuard],
            },
          ],
        },
      ],
      providers: [],
    };
    const app = new NestApplication(mod);
    expect(app.handleRequest("GET", "/public").status).toBe(200);
    expect(app.handleRequest("GET", "/private").status).toBe(403);
    expect(
      app.handleRequest("GET", "/private", undefined, { authorization: "Bearer token" }).status,
    ).toBe(200);
  });
});

// ── パイプテスト ──

describe("パイプ", () => {
  const validationPipe: PipeDef = {
    name: "Validation",
    transform: (value) => {
      if (value === null || typeof value !== "object") throw new Error("Invalid body");
      return value;
    },
  };

  it("バリデーション失敗で 400 を返す", () => {
    const mod: ModuleDef = {
      name: "M",
      controllers: [
        {
          name: "C",
          prefix: "/",
          routes: [
            {
              method: "POST",
              path: "/",
              handlerName: "create",
              handler: (ctx) => ctx.body,
              pipes: [validationPipe],
            },
          ],
        },
      ],
      providers: [],
    };
    const app = new NestApplication(mod);
    const res = app.handleRequest("POST", "/", null);
    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>)["message"]).toBe("Invalid body");
  });

  it("バリデーション成功でハンドラが実行される", () => {
    const mod: ModuleDef = {
      name: "M",
      controllers: [
        {
          name: "C",
          prefix: "/",
          routes: [
            {
              method: "POST",
              path: "/",
              handlerName: "create",
              handler: (ctx) => ctx.body,
              pipes: [validationPipe],
            },
          ],
        },
      ],
      providers: [],
    };
    const app = new NestApplication(mod);
    const res = app.handleRequest("POST", "/", { name: "test" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ name: "test" });
  });
});

// ── インターセプターテスト ──

describe("インターセプター", () => {
  it("ハンドラの前後で処理できる", () => {
    const log: string[] = [];
    const interceptor: InterceptorDef = {
      name: "LoggingInterceptor",
      intercept: (_ctx, next) => {
        log.push("before");
        const result = next();
        log.push("after");
        return result;
      },
    };
    const mod: ModuleDef = {
      name: "M",
      controllers: [
        {
          name: "C",
          prefix: "/",
          interceptors: [interceptor],
          routes: [
            {
              method: "GET",
              path: "/",
              handlerName: "index",
              handler: () => {
                log.push("handler");
                return "ok";
              },
            },
          ],
        },
      ],
      providers: [],
    };
    const app = new NestApplication(mod);
    const res = app.handleRequest("GET", "/");
    expect(res.body).toBe("ok");
    expect(log).toEqual(["before", "handler", "after"]);
  });

  it("レスポンスを変換できる", () => {
    const transformInterceptor: InterceptorDef = {
      name: "Transform",
      intercept: (_ctx, next) => {
        const data = next();
        return { data, timestamp: "2026-01-01T00:00:00Z" };
      },
    };
    const mod: ModuleDef = {
      name: "M",
      controllers: [
        {
          name: "C",
          prefix: "/",
          routes: [
            {
              method: "GET",
              path: "/",
              handlerName: "index",
              handler: () => "hello",
              interceptors: [transformInterceptor],
            },
          ],
        },
      ],
      providers: [],
    };
    const app = new NestApplication(mod);
    const res = app.handleRequest("GET", "/");
    expect(res.body).toEqual({ data: "hello", timestamp: "2026-01-01T00:00:00Z" });
  });
});

// ── モジュールインポートテスト ──

describe("モジュールインポート", () => {
  it("インポートしたモジュールのプロバイダを利用できる", () => {
    const sharedModule: ModuleDef = {
      name: "SharedModule",
      controllers: [],
      providers: [{ name: "SharedService", factory: () => ({ data: "shared" }) }],
    };
    const appModule: ModuleDef = {
      name: "AppModule",
      controllers: [
        {
          name: "C",
          prefix: "/",
          routes: [
            {
              method: "GET",
              path: "/",
              handlerName: "index",
              handler: (ctx) => ctx.service<{ data: string }>("SharedService"),
            },
          ],
        },
      ],
      providers: [],
      imports: [sharedModule],
    };
    const app = new NestApplication(appModule);
    const res = app.handleRequest("GET", "/");
    expect(res.body).toEqual({ data: "shared" });
  });
});
