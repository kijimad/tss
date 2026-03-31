/** NestJS フレームワークシミュレータの型定義 */

/** HTTP メソッド */
export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

/** リクエストコンテキスト */
export interface RequestContext {
  method: HttpMethod;
  path: string;
  params: Record<string, string>;
  query: Record<string, string>;
  body: unknown;
  headers: Record<string, string>;
}

/** パイプラインの各ステップを記録するトレースイベント */
export interface TraceEvent {
  phase:
    | "routing"
    | "middleware"
    | "guard"
    | "interceptor"
    | "pipe"
    | "handler"
    | "exception"
    | "response";
  name: string;
  detail: string;
  status: "ok" | "error" | "skip";
}

/** レスポンス */
export interface NestResponse {
  status: number;
  body: unknown;
  headers: Record<string, string>;
  trace: TraceEvent[];
}

/** ハンドラに渡されるコンテキスト（サービス解決機能付き） */
export interface HandlerContext extends RequestContext {
  /** DI コンテナからサービスを取得 */
  service<T = unknown>(name: string): T;
}

/** ルート定義 */
export interface RouteDef {
  method: HttpMethod;
  path: string;
  handlerName: string;
  handler: (ctx: HandlerContext) => unknown;
  guards?: GuardDef[];
  pipes?: PipeDef[];
  interceptors?: InterceptorDef[];
}

/** コントローラ定義 */
export interface ControllerDef {
  name: string;
  prefix: string;
  routes: RouteDef[];
  guards?: GuardDef[];
  interceptors?: InterceptorDef[];
}

/** プロバイダ（サービス）定義 */
export interface ProviderDef {
  name: string;
  factory: (resolve: <T = unknown>(name: string) => T) => unknown;
}

/** ミドルウェア定義 */
export interface MiddlewareDef {
  name: string;
  /** 適用するルートパターン（"*" で全ルート） */
  forRoutes: string[];
  use: (ctx: RequestContext, next: () => void) => void;
}

/** ガード定義 */
export interface GuardDef {
  name: string;
  canActivate: (ctx: RequestContext) => boolean;
}

/** パイプ定義 */
export interface PipeDef {
  name: string;
  transform: (value: unknown, metadata: { type: string; key?: string }) => unknown;
}

/** インターセプター定義 */
export interface InterceptorDef {
  name: string;
  intercept: (ctx: RequestContext, next: () => unknown) => unknown;
}

/** モジュール定義 */
export interface ModuleDef {
  name: string;
  controllers: ControllerDef[];
  providers: ProviderDef[];
  middlewares?: MiddlewareDef[];
  imports?: ModuleDef[];
}

/** プリセットされた HTTP リクエスト */
export interface PresetRequest {
  method: HttpMethod;
  path: string;
  body?: string;
  headers?: Record<string, string>;
}
