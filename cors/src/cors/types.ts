/* CORS シミュレーター 型定義 */

/** HTTPメソッド */
export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "OPTIONS" | "HEAD";

/** 単純メソッド（プリフライト不要） */
export const SIMPLE_METHODS: HttpMethod[] = ["GET", "POST", "HEAD"];

/** 単純ヘッダ（プリフライト不要） */
export const SIMPLE_HEADERS = [
  "accept", "accept-language", "content-language", "content-type",
];

/** 単純Content-Type値 */
export const SIMPLE_CONTENT_TYPES = [
  "application/x-www-form-urlencoded",
  "multipart/form-data",
  "text/plain",
];

/** オリジン */
export interface Origin {
  scheme: string;
  host: string;
  port?: number;
}

/** リクエストヘッダ */
export interface RequestHeaders {
  [key: string]: string;
}

/** CORSリクエスト */
export interface CorsRequest {
  /** リクエスト元オリジン */
  origin: string;
  /** リクエスト先URL */
  url: string;
  /** HTTPメソッド */
  method: HttpMethod;
  /** リクエストヘッダ */
  headers: RequestHeaders;
  /** クレデンシャル (cookies, auth) */
  credentials: boolean;
  /** リクエストモード */
  mode: "cors" | "no-cors" | "same-origin";
}

/** サーバーCORS設定 */
export interface CorsServerConfig {
  /** 許可オリジン（"*"またはオリジン文字列のリスト） */
  allowOrigins: string[] | "*";
  /** 許可メソッド */
  allowMethods: HttpMethod[];
  /** 許可ヘッダ */
  allowHeaders: string[];
  /** 公開ヘッダ（レスポンスでJSから読めるヘッダ） */
  exposeHeaders: string[];
  /** クレデンシャル許可 */
  allowCredentials: boolean;
  /** プリフライト結果キャッシュ秒数 */
  maxAge: number;
  /** Vary: Originを返すか */
  varyOrigin: boolean;
}

/** プリフライトリクエスト */
export interface PreflightRequest {
  origin: string;
  accessControlRequestMethod: HttpMethod;
  accessControlRequestHeaders: string[];
}

/** CORSレスポンスヘッダ */
export interface CorsResponseHeaders {
  "access-control-allow-origin"?: string;
  "access-control-allow-methods"?: string;
  "access-control-allow-headers"?: string;
  "access-control-expose-headers"?: string;
  "access-control-allow-credentials"?: string;
  "access-control-max-age"?: string;
  vary?: string;
  [key: string]: string | undefined;
}

/** CORSチェック結果 */
export type CorsVerdict =
  | "allowed"           // CORS許可
  | "blocked_origin"    // オリジン不許可
  | "blocked_method"    // メソッド不許可
  | "blocked_header"    // ヘッダ不許可
  | "blocked_credentials" // クレデンシャル+ワイルドカード
  | "blocked_preflight" // プリフライト失敗
  | "same_origin"       // 同一オリジン（CORSチェック不要）
  | "opaque"            // no-corsモードで不透明レスポンス
  | "no_cors_header";   // CORSヘッダなし

/** リクエスト分類 */
export type RequestClassification =
  | "same_origin"       // 同一オリジン
  | "simple_cors"       // 単純リクエスト（プリフライト不要）
  | "preflight_cors"    // プリフライト必要
  | "no_cors";          // no-corsモード

/** プリフライトキャッシュエントリ */
export interface PreflightCacheEntry {
  origin: string;
  url: string;
  methods: HttpMethod[];
  headers: string[];
  expiresAt: number;
}

/** シミュレーションステップ */
export interface SimStep {
  /** ステップ種別 */
  phase: "classify" | "preflight_send" | "preflight_check" | "actual_send" | "cors_check" | "result";
  /** 説明 */
  message: string;
  /** 詳細 */
  detail?: string;
  /** ヘッダ情報 */
  headers?: Record<string, string>;
  /** 判定結果 */
  verdict?: CorsVerdict;
  /** 成功/失敗 */
  success: boolean;
}

/** シミュレーション操作 */
export type SimOp = {
  type: "request";
  request: CorsRequest;
  serverConfig: CorsServerConfig;
};

/** イベント種別 */
export type EventType =
  | "classify" | "preflight" | "preflight_pass" | "preflight_fail"
  | "cors_pass" | "cors_fail" | "same_origin" | "no_cors"
  | "cache_hit" | "cache_miss" | "credential_error" | "info";

/** シミュレーションイベント */
export interface SimEvent {
  type: EventType;
  message: string;
  detail?: string;
}

/** 単一リクエストの結果 */
export interface RequestResult {
  request: CorsRequest;
  serverConfig: CorsServerConfig;
  classification: RequestClassification;
  steps: SimStep[];
  events: SimEvent[];
  verdict: CorsVerdict;
  preflightResponse?: CorsResponseHeaders;
  actualResponse?: CorsResponseHeaders;
  preflightCached: boolean;
}

/** シミュレーション結果 */
export interface SimulationResult {
  results: RequestResult[];
  preflightCache: PreflightCacheEntry[];
  events: SimEvent[];
}

/** プリセット */
export interface Preset {
  name: string;
  description: string;
  build: () => SimOp[];
}
