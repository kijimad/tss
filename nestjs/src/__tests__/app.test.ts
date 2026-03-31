import { describe, it, expect } from "vitest";
import { EXAMPLES } from "../ui/app.js";
import { NestApplication } from "../nest/application.js";

describe("EXAMPLES 配列", () => {
  it("6 つのサンプルが定義されている", () => {
    expect(EXAMPLES).toHaveLength(6);
  });

  it("各サンプルに必要なフィールドがある", () => {
    for (const ex of EXAMPLES) {
      expect(ex.name).toBeTruthy();
      expect(ex.code).toBeTruthy();
      expect(ex.module).toBeTruthy();
      expect(ex.requests.length).toBeGreaterThan(0);
    }
  });

  it("サンプル名が重複していない", () => {
    const names = EXAMPLES.map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("各サンプルのリクエストに有効な HTTP メソッドがある", () => {
    const validMethods = new Set(["GET", "POST", "PUT", "DELETE", "PATCH"]);
    for (const ex of EXAMPLES) {
      for (const req of ex.requests) {
        expect(validMethods.has(req.method)).toBe(true);
        expect(req.path.startsWith("/")).toBe(true);
      }
    }
  });
});

describe("各サンプルの実行", () => {
  it("Hello World: GET / が正常に動作する", () => {
    const ex = EXAMPLES[0]!;
    const app = new NestApplication(ex.module);
    const res = app.handleRequest("GET", "/");
    expect(res.status).toBe(200);
    expect(res.body).toBe("Hello, NestJS!");
  });

  it("Hello World: GET /health が正常に動作する", () => {
    const ex = EXAMPLES[0]!;
    const app = new NestApplication(ex.module);
    const res = app.handleRequest("GET", "/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("CRUD: GET /users がユーザー一覧を返す", () => {
    const ex = EXAMPLES[1]!;
    const app = new NestApplication(ex.module);
    const res = app.handleRequest("GET", "/users");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("CRUD: POST /users で新規ユーザーを作成できる", () => {
    const ex = EXAMPLES[1]!;
    const app = new NestApplication(ex.module);
    const res = app.handleRequest("POST", "/users", { name: "Charlie", email: "c@e.com" });
    expect(res.status).toBe(200);
    expect((res.body as Record<string, unknown>)["name"]).toBe("Charlie");
  });

  it("CRUD: DELETE /users/:id でユーザーを削除できる", () => {
    const ex = EXAMPLES[1]!;
    const app = new NestApplication(ex.module);
    const res = app.handleRequest("DELETE", "/users/1");
    expect(res.status).toBe(200);
  });

  it("DI: サービスチェーンが正しく解決される", () => {
    const ex = EXAMPLES[2]!;
    const app = new NestApplication(ex.module);
    const res = app.handleRequest("GET", "/");
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body["connection"]).toBe("Connected to localhost:5432");
    expect(Array.isArray(body["rows"])).toBe(true);
  });

  it("DI: ConfigService に直接アクセスできる", () => {
    const ex = EXAMPLES[2]!;
    const app = new NestApplication(ex.module);
    const res = app.handleRequest("GET", "/config");
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body["DB_HOST"]).toBe("localhost");
  });

  it("ミドルウェア: 対象ルートで実行される", () => {
    const ex = EXAMPLES[3]!;
    const app = new NestApplication(ex.module);
    const res = app.handleRequest("GET", "/items");
    expect(res.status).toBe(200);
    const mwEvents = res.trace.filter((t) => t.phase === "middleware");
    expect(mwEvents.length).toBeGreaterThan(0);
  });

  it("ガード: 認証なしで 403 を返す", () => {
    const ex = EXAMPLES[4]!;
    const app = new NestApplication(ex.module);
    const res = app.handleRequest("GET", "/dashboard");
    expect(res.status).toBe(403);
  });

  it("ガード: 有効なトークンで 200 を返す", () => {
    const ex = EXAMPLES[4]!;
    const app = new NestApplication(ex.module);
    const res = app.handleRequest("GET", "/dashboard", undefined, {
      authorization: "Bearer valid-token",
    });
    expect(res.status).toBe(200);
  });

  it("ガード: AuthGuard + RolesGuard 両方が必要", () => {
    const ex = EXAMPLES[4]!;
    const app = new NestApplication(ex.module);

    // AuthGuard のみ → RolesGuard で拒否
    const res1 = app.handleRequest("GET", "/dashboard/admin", undefined, {
      authorization: "Bearer valid-token",
    });
    expect(res1.status).toBe(403);

    // 両方パス
    const res2 = app.handleRequest("GET", "/dashboard/admin", undefined, {
      authorization: "Bearer valid-token",
      "x-role": "admin",
    });
    expect(res2.status).toBe(200);
  });

  it("パイプ: 有効なボディで 200 を返す", () => {
    const ex = EXAMPLES[5]!;
    const app = new NestApplication(ex.module);
    const res = app.handleRequest("POST", "/users", {
      name: "Alice",
      email: "alice@example.com",
    });
    expect(res.status).toBe(200);
  });

  it("パイプ: name なしで 400 を返す", () => {
    const ex = EXAMPLES[5]!;
    const app = new NestApplication(ex.module);
    const res = app.handleRequest("POST", "/users", { email: "a@b.com" });
    expect(res.status).toBe(400);
  });

  it("パイプ: 不正なメールで 400 を返す", () => {
    const ex = EXAMPLES[5]!;
    const app = new NestApplication(ex.module);
    const res = app.handleRequest("POST", "/users", { name: "Bad", email: "invalid" });
    expect(res.status).toBe(400);
  });

  it("パイプ: 負の age で 400 を返す", () => {
    const ex = EXAMPLES[5]!;
    const app = new NestApplication(ex.module);
    const res = app.handleRequest("POST", "/users", {
      name: "Neg",
      email: "a@b.c",
      age: -5,
    });
    expect(res.status).toBe(400);
  });

  it("全サンプルのプリセットリクエストが実行可能", () => {
    for (const ex of EXAMPLES) {
      const app = new NestApplication(ex.module);
      if (ex.setup !== undefined) ex.setup(app);
      for (const req of ex.requests) {
        let body: unknown = undefined;
        if (req.body !== undefined) {
          body = JSON.parse(req.body);
        }
        const res = app.handleRequest(req.method, req.path, body, req.headers);
        // レスポンスが返ること（ステータスコードは問わない）
        expect(typeof res.status).toBe("number");
        expect(res.trace.length).toBeGreaterThan(0);
      }
    }
  });
});
