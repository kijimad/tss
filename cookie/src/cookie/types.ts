/**
 * Cookie シミュレーター 型定義
 *
 * RFC 6265 (HTTP State Management Mechanism) に基づくCookieの動作を
 * シミュレーションするための型定義群。
 *
 * Cookieとは、サーバーがHTTPレスポンスの Set-Cookie ヘッダで送信し、
 * ブラウザがローカルに保存する小さなデータ片である。
 * ブラウザは後続のリクエストで Cookie ヘッダに含めて自動送信する。
 * これにより、ステートレスなHTTPプロトコル上でセッション管理や
 * ユーザー設定の保持などを実現する。
 */

/**
 * SameSite属性のポリシー値
 *
 * SameSite属性はCSRF（クロスサイトリクエストフォージェリ）攻撃を防ぐために
 * 導入された。クロスサイトリクエスト時にCookieを送信するかどうかを制御する。
 *
 * - "strict": クロスサイトリクエストでは一切Cookieを送信しない。
 *             最も安全だが、外部サイトからのリンクでもセッションが切れる。
 * - "lax":    トップレベルのGETナビゲーションのみCookie送信を許可。
 *             現在のブラウザのデフォルト値。利便性と安全性のバランスが良い。
 * - "none":   クロスサイトリクエストでも常にCookieを送信する。
 *             Secure属性が必須。サードパーティCookieに使用される。
 */
export type SameSitePolicy = "strict" | "lax" | "none";

/**
 * Cookie
 *
 * ブラウザが保持する個別のCookieを表す。
 * RFC 6265で定義される各属性に加え、シミュレーション用のメタデータを含む。
 *
 * Cookieには大きく2種類がある:
 * - セッションCookie: expiresが未指定で、ブラウザ終了時に削除される
 * - 永続Cookie: expiresまたはmaxAgeが指定され、期限まで保持される
 *
 * サイズ制限（ブラウザの一般的な実装）:
 * - 1つのCookieは最大4096バイト（名前+値）
 * - 1ドメインあたり最大50個程度（ブラウザにより異なる）
 */
export interface Cookie {
  /** Cookie名（name=valueのname部分） */
  name: string;
  /** Cookie値（name=valueのvalue部分） */
  value: string;
  /**
   * Domain属性
   * Cookieが送信される対象ドメインを指定する。
   * Domain=example.com と指定すると、サブドメイン（www.example.com等）にも送信される。
   * 省略時はCookieを設定したホストのみに送信される（ホストオンリーCookie）。
   */
  domain: string;
  /**
   * Path属性
   * Cookieが送信されるURLパスを制限する。
   * Path=/app と指定すると、/app 以下のURLにのみ送信される。
   */
  path: string;
  /**
   * 有効期限（UNIXタイムスタンプ、ミリ秒）
   * Expires属性またはMax-Age属性から算出される。
   * undefinedの場合はセッションCookieとして扱い、ブラウザ終了時に削除される。
   * Max-AgeとExpiresの両方が指定された場合、Max-Ageが優先される（RFC 6265準拠）。
   */
  expires?: number;
  /**
   * Max-Age属性（秒）
   * Cookieの有効期間を秒単位で指定する。
   * 0を指定するとCookieが即座に削除される（サーバーからのCookie削除手段）。
   */
  maxAge?: number;
  /**
   * Secure属性
   * trueの場合、HTTPS接続でのみCookieが送信される。
   * HTTP（非暗号化）接続ではCookieが送信されず、設定もできない。
   * SameSite=Noneを使う場合はSecure属性が必須。
   */
  secure: boolean;
  /**
   * HttpOnly属性
   * trueの場合、JavaScriptのdocument.cookieからアクセスできない。
   * XSS（クロスサイトスクリプティング）攻撃によるCookie窃取を防止する。
   */
  httpOnly: boolean;
  /**
   * SameSite属性
   * クロスサイトリクエスト時のCookie送信ポリシーを制御する。
   * CSRF攻撃への主要な防御手段の一つ。
   */
  sameSite: SameSitePolicy;
  /** 作成時刻（UNIXタイムスタンプ、ミリ秒） */
  createdAt: number;
  /**
   * 最終アクセス時刻（UNIXタイムスタンプ、ミリ秒）
   * Cookie Jar容量超過時に、LRU方式で最も古いCookieから削除するために使用。
   */
  lastAccessed: number;
  /** Cookieのサイズ（バイト数）。名前と値の文字列長の合計。 */
  size: number;
  /**
   * __Secure-プレフィックス
   * Cookie名が "__Secure-" で始まる場合、Secure属性が必須。
   * Cookieが確実にHTTPS経由で設定されたことを保証する。
   */
  securePrefix: boolean;
  /**
   * __Host-プレフィックス
   * Cookie名が "__Host-" で始まる場合:
   * - Secure属性が必須
   * - Domain属性を指定不可（ホストオンリーCookieとなる）
   * - Path=/ が必須
   * セッション固定攻撃の防止に最も効果的。
   */
  hostPrefix: boolean;
  /**
   * Partitioned属性（CHIPS: Cookies Having Independent Partitioned State）
   * trueの場合、Cookieはトップレベルサイトごとに分離されたパーティションに保存される。
   * クロスサイトトラッキングを防止しつつ埋め込みウィジェット等の機能を維持する。
   */
  partitioned: boolean;
  /**
   * パーティションキー（CHIPS用）
   * Cookieが属するパーティションを識別するトップレベルサイトのオリジン。
   * 例: siteA.com に埋め込まれた widget.com のCookieは
   *     "https://siteA.com" がパーティションキーとなる。
   */
  partitionKey?: string;
}

/**
 * Set-Cookieヘッダのパース結果
 *
 * サーバーからのHTTPレスポンスに含まれる Set-Cookie ヘッダを解析した結果。
 * パース中に検出されたエラーや警告も含む。
 * errorsが空でない場合、そのCookieはブラウザに保存されず拒否される。
 */
export interface SetCookieDirective {
  /** Set-Cookieヘッダの生の文字列 */
  raw: string;
  /** パースされたCookieオブジェクト */
  cookie: Cookie;
  /** パースエラー（このCookieは保存されない） */
  errors: string[];
  /** 警告（Cookieは保存されるが注意が必要） */
  warnings: string[];
}

/**
 * HTTPリクエスト
 *
 * ブラウザからサーバーへ送信されるHTTPリクエストを表す。
 * Cookie送信判定に必要な情報（スキーム、オリジン、ナビゲーション種別等）を含む。
 */
export interface HttpRequest {
  /** HTTPメソッド */
  method: "GET" | "POST" | "PUT" | "DELETE" | "OPTIONS";
  /** リクエスト先の完全なURL */
  url: string;
  /** URLスキーム（Secure属性の判定に使用） */
  scheme: "http" | "https";
  /** リクエスト元のオリジン（パーティションキーの算出に使用） */
  origin: string;
  /**
   * リファラ（SameSite判定用）
   * リクエスト元のページURLを示し、クロスサイト判定の参考情報。
   */
  referer?: string;
  /**
   * ナビゲーション種別
   * SameSite=Laxの判定で重要な役割を果たす。
   * - "top_level": アドレスバーが変わるナビゲーション（リンククリック等）
   * - "iframe":    iframe内のナビゲーション
   * - "subresource": 画像、CSS、JS等のサブリソース読み込み
   * - "fetch":     fetch() API や XMLHttpRequest によるリクエスト
   */
  navigationType: "top_level" | "iframe" | "subresource" | "fetch";
  /**
   * クロスサイトかどうか
   * リクエスト元とリクエスト先のeTLD+1が異なる場合にtrue。
   * SameSite属性の判定やサードパーティCookieブロックに使用。
   */
  crossSite: boolean;
  /** リクエストヘッダ */
  headers: Record<string, string>;
}

/**
 * HTTPレスポンス
 *
 * サーバーからブラウザへ返されるHTTPレスポンスを表す。
 * Set-Cookieヘッダを含み、ブラウザはこれをパースしてCookie Jarに保存する。
 */
export interface HttpResponse {
  /** HTTPステータスコード */
  status: number;
  /** レスポンスのURL（リダイレクト後の最終URL） */
  url: string;
  /** レスポンスヘッダ */
  headers: Record<string, string>;
  /**
   * Set-Cookieヘッダの配列
   * HTTPレスポンスには複数のSet-Cookieヘッダを含めることができる。
   * 例: "session_id=abc123; Path=/; HttpOnly; Secure; SameSite=Lax"
   */
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
