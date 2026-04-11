/* Cookie シミュレーター 型定義 */

/** SameSite属性 */
export type SameSitePolicy = "strict" | "lax" | "none";

/** Cookie */
export interface Cookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  /** 有効期限（UNIXタイムスタンプms）。undefinedならセッションCookie */
  expires?: number;
  /** Max-Age（秒） */
  maxAge?: number;
  /** Secure属性 */
  secure: boolean;
  /** HttpOnly属性 */
  httpOnly: boolean;
  /** SameSite属性 */
  sameSite: SameSitePolicy;
  /** 作成時刻 */
  createdAt: number;
  /** 最終アクセス時刻 */
  lastAccessed: number;
  /** サイズ（bytes） */
  size: number;
  /** __Secure-プレフィックス */
  securePrefix: boolean;
  /** __Host-プレフィックス */
  hostPrefix: boolean;
  /** Partitioned (CHIPS) */
  partitioned: boolean;
  /** パーティションキー（CHIPS用） */
  partitionKey?: string;
}

/** Set-Cookieヘッダのパース結果 */
export interface SetCookieDirective {
  raw: string;
  cookie: Cookie;
  errors: string[];
  warnings: string[];
}

/** HTTPリクエスト */
export interface HttpRequest {
  method: "GET" | "POST" | "PUT" | "DELETE" | "OPTIONS";
  url: string;
  scheme: "http" | "https";
  origin: string;
  /** リファラ（SameSite判定用） */
  referer?: string;
  /** ナビゲーション種別 */
  navigationType: "top_level" | "iframe" | "subresource" | "fetch";
  /** クロスサイトか */
  crossSite: boolean;
  headers: Record<string, string>;
}

/** HTTPレスポンス */
export interface HttpResponse {
  status: number;
  url: string;
  headers: Record<string, string>;
  setCookieHeaders: string[];
}

/** Cookie Jar（ブラウザのCookieストア） */
export interface CookieJar {
  /** ドメインごとのCookieストア */
  cookies: Map<string, Cookie[]>;
  /** 現在時刻（シミュレーション用） */
  currentTime: number;
  /** Cookieの最大数（ドメインあたり） */
  maxPerDomain: number;
  /** Cookie合計最大数 */
  maxTotal: number;
  /** サードパーティCookieブロック設定 */
  blockThirdParty: boolean;
  /** パーティション分離（CHIPS） */
  partitionEnabled: boolean;
}

/** シミュレーション操作 */
export type SimOp =
  | { type: "set_cookie"; response: HttpResponse; request: HttpRequest }
  | { type: "send_request"; request: HttpRequest }
  | { type: "advance_time"; seconds: number }
  | { type: "clear_cookies"; domain?: string }
  | { type: "toggle_third_party_block"; enabled: boolean }
  | { type: "toggle_partition"; enabled: boolean }
  | { type: "delete_cookie"; domain: string; name: string }
  | { type: "navigate"; url: string; from?: string };

/** イベント種別 */
export type EventType =
  | "cookie_set" | "cookie_reject" | "cookie_send"
  | "cookie_expire" | "cookie_evict" | "cookie_block"
  | "cookie_delete" | "sameSite_block" | "secure_block"
  | "prefix_error" | "partition" | "navigate" | "info";

/** シミュレーションイベント */
export interface SimEvent {
  time: number;
  type: EventType;
  message: string;
  detail?: string;
  cookieName?: string;
  domain?: string;
}

/** シミュレーション結果 */
export interface SimulationResult {
  jar: CookieJar;
  events: SimEvent[];
  /** リクエストごとの送信Cookie履歴 */
  requestLog: Array<{
    request: HttpRequest;
    sentCookies: Cookie[];
    blockedCookies: Array<{ cookie: Cookie; reason: string }>;
  }>;
}

/** プリセット */
export interface Preset {
  name: string;
  description: string;
  build: () => SimOp[];
}
