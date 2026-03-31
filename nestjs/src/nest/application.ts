import { DIContainer } from "./container.js";
import type {
  ModuleDef,
  ControllerDef,
  RouteDef,
  MiddlewareDef,
  GuardDef,
  PipeDef,
  InterceptorDef,
  RequestContext,
  HandlerContext,
  NestResponse,
  TraceEvent,
  HttpMethod,
} from "./interfaces.js";

/** ルートテーブルのエントリ */
interface RouteEntry {
  controller: ControllerDef;
  route: RouteDef;
  /** /users/:id → 正規表現 + パラメータ名 */
  regex: RegExp;
  paramNames: string[];
}

/** パスパターンを正規表現に変換する */
function pathToRegex(prefix: string, routePath: string): { regex: RegExp; paramNames: string[] } {
  const full = normalizePath(prefix + "/" + routePath);
  const paramNames: string[] = [];
  const pattern = full.replace(/:([^/]+)/g, (_, name: string) => {
    paramNames.push(name);
    return "([^/]+)";
  });
  return { regex: new RegExp(`^${pattern}$`), paramNames };
}

/** パスを正規化する（重複スラッシュ除去、末尾スラッシュ除去） */
function normalizePath(p: string): string {
  const normalized = ("/" + p).replace(/\/+/g, "/").replace(/\/$/, "");
  return normalized || "/";
}

/** クエリ文字列をパースする */
function parseQuery(path: string): { pathname: string; query: Record<string, string> } {
  const idx = path.indexOf("?");
  if (idx === -1) return { pathname: path, query: {} };
  const pathname = path.slice(0, idx);
  const query: Record<string, string> = {};
  const qs = path.slice(idx + 1);
  for (const pair of qs.split("&")) {
    const eqIdx = pair.indexOf("=");
    if (eqIdx === -1) {
      query[decodeURIComponent(pair)] = "";
    } else {
      query[decodeURIComponent(pair.slice(0, eqIdx))] = decodeURIComponent(pair.slice(eqIdx + 1));
    }
  }
  return { pathname, query };
}

/** NestJS アプリケーション */
export class NestApplication {
  private container = new DIContainer();
  private routeTable: RouteEntry[] = [];
  private moduleMiddlewares: MiddlewareDef[] = [];
  private globalGuards: GuardDef[] = [];
  private globalPipes: PipeDef[] = [];
  private globalInterceptors: InterceptorDef[] = [];

  constructor(private rootModule: ModuleDef) {
    this.bootstrap();
  }

  /** モジュールツリーを展開してルートテーブル・DI を構築する */
  private bootstrap(): void {
    const modules = this.collectModules(this.rootModule);

    // プロバイダを DI コンテナに登録
    for (const mod of modules) {
      for (const provider of mod.providers) {
        this.container.register(provider);
      }
    }

    // コントローラのルートを登録
    for (const mod of modules) {
      for (const ctrl of mod.controllers) {
        for (const route of ctrl.routes) {
          const { regex, paramNames } = pathToRegex(ctrl.prefix, route.path);
          this.routeTable.push({ controller: ctrl, route, regex, paramNames });
        }
      }
    }

    // モジュールミドルウェアを収集
    for (const mod of modules) {
      if (mod.middlewares !== undefined) {
        this.moduleMiddlewares.push(...mod.middlewares);
      }
    }
  }

  /** モジュールツリーを再帰的に収集する（imports を展開） */
  private collectModules(mod: ModuleDef): ModuleDef[] {
    const result: ModuleDef[] = [];
    if (mod.imports !== undefined) {
      for (const imported of mod.imports) {
        result.push(...this.collectModules(imported));
      }
    }
    result.push(mod);
    return result;
  }

  /** グローバルガードを設定する */
  useGlobalGuards(...guards: GuardDef[]): void {
    this.globalGuards.push(...guards);
  }

  /** グローバルパイプを設定する */
  useGlobalPipes(...pipes: PipeDef[]): void {
    this.globalPipes.push(...pipes);
  }

  /** グローバルインターセプターを設定する */
  useGlobalInterceptors(...interceptors: InterceptorDef[]): void {
    this.globalInterceptors.push(...interceptors);
  }

  /** HTTP リクエストを処理してレスポンスとトレースを返す */
  handleRequest(
    method: HttpMethod,
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): NestResponse {
    const trace: TraceEvent[] = [];
    const { pathname, query } = parseQuery(path);

    // 1. ルーティング
    const match = this.matchRoute(method, pathname);
    if (match === undefined) {
      trace.push({
        phase: "routing",
        name: "Router",
        detail: `Cannot ${method} ${pathname}`,
        status: "error",
      });
      return {
        status: 404,
        body: { statusCode: 404, message: `Cannot ${method} ${pathname}` },
        headers: { "content-type": "application/json" },
        trace,
      };
    }

    trace.push({
      phase: "routing",
      name: "Router",
      detail: `${method} ${pathname} → ${match.controller.name}.${match.route.handlerName}()`,
      status: "ok",
    });

    const ctx: RequestContext = {
      method,
      path: pathname,
      params: match.params,
      query,
      body,
      headers: headers ?? {},
    };

    try {
      // 2. ミドルウェア
      this.runMiddlewares(ctx, pathname, trace);

      // 3. ガード
      const allGuards = [
        ...this.globalGuards,
        ...(match.controller.guards ?? []),
        ...(match.route.guards ?? []),
      ];
      for (const guard of allGuards) {
        const allowed = guard.canActivate(ctx);
        trace.push({
          phase: "guard",
          name: guard.name,
          detail: allowed ? "アクセス許可" : "アクセス拒否",
          status: allowed ? "ok" : "error",
        });
        if (!allowed) {
          return {
            status: 403,
            body: { statusCode: 403, message: "Forbidden resource" },
            headers: { "content-type": "application/json" },
            trace,
          };
        }
      }

      // 4. インターセプター（before）+ ハンドラ + インターセプター（after）
      const allInterceptors = [
        ...this.globalInterceptors,
        ...(match.controller.interceptors ?? []),
        ...(match.route.interceptors ?? []),
      ];

      const handlerCtx: HandlerContext = {
        ...ctx,
        service: <T = unknown>(name: string) => this.container.resolve<T>(name),
      };

      // パイプを適用
      const allPipes = [...this.globalPipes, ...(match.route.pipes ?? [])];
      let transformedBody = ctx.body;
      for (const pipe of allPipes) {
        try {
          transformedBody = pipe.transform(transformedBody, { type: "body" });
          trace.push({
            phase: "pipe",
            name: pipe.name,
            detail: "バリデーション/変換 成功",
            status: "ok",
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          trace.push({
            phase: "pipe",
            name: pipe.name,
            detail: msg,
            status: "error",
          });
          return {
            status: 400,
            body: { statusCode: 400, message: msg },
            headers: { "content-type": "application/json" },
            trace,
          };
        }
      }
      handlerCtx.body = transformedBody;

      // インターセプターチェーンを構築（外側 → 内側 → ハンドラ）
      let result: unknown;
      const callHandler = () => {
        trace.push({
          phase: "handler",
          name: `${match.controller.name}.${match.route.handlerName}()`,
          detail: "ハンドラ実行",
          status: "ok",
        });
        return match.route.handler(handlerCtx);
      };

      if (allInterceptors.length === 0) {
        result = callHandler();
      } else {
        // インターセプターをチェーンする
        let chain = callHandler;
        for (let i = allInterceptors.length - 1; i >= 0; i--) {
          const interceptor = allInterceptors[i]!;
          const next = chain;
          chain = () => {
            trace.push({
              phase: "interceptor",
              name: interceptor.name,
              detail: "intercept 開始",
              status: "ok",
            });
            return interceptor.intercept(ctx, next);
          };
        }
        result = chain();
      }

      // 5. レスポンス
      const status = typeof result === "undefined" ? 204 : 200;
      trace.push({
        phase: "response",
        name: "Response",
        detail: `HTTP ${status}`,
        status: "ok",
      });

      return {
        status,
        body: result,
        headers: { "content-type": "application/json" },
        trace,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      trace.push({
        phase: "exception",
        name: "ExceptionFilter",
        detail: msg,
        status: "error",
      });
      return {
        status: 500,
        body: { statusCode: 500, message: msg },
        headers: { "content-type": "application/json" },
        trace,
      };
    }
  }

  /** ルートマッチング */
  private matchRoute(
    method: HttpMethod,
    pathname: string,
  ): { controller: ControllerDef; route: RouteDef; params: Record<string, string> } | undefined {
    for (const entry of this.routeTable) {
      if (entry.route.method !== method) continue;
      const m = pathname.match(entry.regex);
      if (m === null) continue;
      const params: Record<string, string> = {};
      for (let i = 0; i < entry.paramNames.length; i++) {
        params[entry.paramNames[i]!] = m[i + 1]!;
      }
      return { controller: entry.controller, route: entry.route, params };
    }
    return undefined;
  }

  /** ミドルウェアを実行する */
  private runMiddlewares(ctx: RequestContext, pathname: string, trace: TraceEvent[]): void {
    for (const mw of this.moduleMiddlewares) {
      const applies = mw.forRoutes.some(
        (pattern) => pattern === "*" || pathname.startsWith(normalizePath(pattern)),
      );
      if (!applies) {
        trace.push({ phase: "middleware", name: mw.name, detail: "スキップ（対象外）", status: "skip" });
        continue;
      }
      trace.push({ phase: "middleware", name: mw.name, detail: "実行", status: "ok" });
      mw.use(ctx, () => {});
    }
  }

  /** DI コンテナへの直接アクセス（テスト用） */
  get di(): DIContainer {
    return this.container;
  }
}
