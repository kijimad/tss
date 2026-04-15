/*
 * CORS シミュレーター 型定義
 *
 * CORS (Cross-Origin Resource Sharing) は、ブラウザの同一オリジンポリシー
 * (Same-Origin Policy) を安全に緩和するための仕組み。
 *
 * 同一オリジンポリシーとは:
 *   ブラウザが「プロトコル + ホスト + ポート」の組み合わせ（＝オリジン）が
 *   異なるリソースへのアクセスを制限するセキュリティモデル。
 *   例: https://example.com:443 と http://example.com:80 は異なるオリジン。
 *
 * CORSの基本フロー:
 *   1. ブラウザがクロスオリジンリクエストを検出
 *   2. リクエストの種類（単純/プリフライト必要）を判定
 *   3. 必要に応じてOPTIONSプリフライトリクエストを送信
 *   4. サーバーのCORSレスポンスヘッダを検証
 *   5. 許可されればレスポンスをJavaScriptに公開
 */

/**
 * HTTPメソッド
 * CORSでは、メソッドの種類によってプリフライトの要否が決まる
 */
export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "OPTIONS" | "HEAD";

/**
 * 単純メソッド（プリフライト不要）
 * CORS仕様では GET, POST, HEAD のみが「単純メソッド」として扱われ、
 * 他の条件も満たせばプリフライトリクエストなしで送信可能。
 * PUT, DELETE, PATCH などは常にプリフライトが必要。
 */
export const SIMPLE_METHODS: HttpMethod[] = ["GET", "POST", "HEAD"];

/**
 * 単純ヘッダ（CORS-safelisted request headers）
 * これらのヘッダのみを使用する場合、プリフライト不要。
 * ただし Content-Type は値にも制約がある（SIMPLE_CONTENT_TYPES参照）。
 * Authorization など認証系ヘッダは含まれないため、API認証には通常プリフライトが必要。
 */
export const SIMPLE_HEADERS = [
  "accept", "accept-language", "content-language", "content-type",
];

/**
 * 単純Content-Type値
 * Content-Type ヘッダが単純ヘッダとみなされるのは以下の値のみ。
 * application/json は含まれないため、JSON API呼び出しは
 * 通常プリフライトが必要になる（よくある落とし穴）。
 */
export const SIMPLE_CONTENT_TYPES = [
  "application/x-www-form-urlencoded",
  "multipart/form-data",
  "text/plain",
];

/**
 * オリジン（プロトコル + ホスト + ポート）
 * 同一オリジンポリシーの判定単位。3つの要素がすべて一致しなければ
 * 異なるオリジンとみなされ、CORSチェックの対象となる。
 */
export interface Origin {
  /** プロトコル（http または https） */
  scheme: string;
  /** ホスト名（例: example.com, localhost） */
  host: string;
  /** ポート番号（省略時はプロトコルのデフォルトポート: http=80, https=443） */
  port?: number;
}

/** リクエストヘッダのキー・値マップ */
export interface RequestHeaders {
  [key: string]: string;
}

/**
 * CORSリクエスト
 * ブラウザが送信するクロスオリジンHTTPリクエストを表現する。
 * fetch() や XMLHttpRequest で設定するパラメータに対応。
 */
export interface CorsRequest {
  /**
   * リクエスト元オリジン
   * ブラウザが自動的に Origin ヘッダとして付与する値。
   * JavaScript側から偽装することはできない（ブラウザが強制する）。
   */
  origin: string;
  /** リクエスト先URL */
  url: string;
  /** HTTPメソッド */
  method: HttpMethod;
  /** リクエストヘッダ（カスタムヘッダがあるとプリフライトが必要になる） */
  headers: RequestHeaders;
  /**
   * クレデンシャルモード（cookies, HTTP認証, クライアント証明書）
   * fetch() の credentials: "include" や XMLHttpRequest の withCredentials に対応。
   * trueの場合:
   *   - Access-Control-Allow-Origin に "*" ワイルドカードは使用不可
   *   - Access-Control-Allow-Credentials: true が必須
   *   - Access-Control-Allow-Headers/Methods にも "*" は使用不可
   */
  credentials: boolean;
  /**
   * リクエストモード
   * - "cors": 通常のCORSリクエスト（デフォルト）
   * - "no-cors": CORSヘッダなしでも送信するが、レスポンスは不透明（JSから読めない）
   * - "same-origin": 同一オリジンのみ許可
   */
  mode: "cors" | "no-cors" | "same-origin";
}

/**
 * サーバーCORS設定
 * サーバー側で設定するCORSポリシーを表現する。
 * 各フィールドは対応するAccess-Control-*レスポンスヘッダに変換される。
 */
export interface CorsServerConfig {
  /**
   * 許可オリジン → Access-Control-Allow-Origin ヘッダ
   * - "*": 全オリジンを許可（ただしcredentials使用時は不可）
   * - string[]: 許可するオリジンのホワイトリスト
   * セキュリティ上、本番環境では具体的なオリジンを指定することが推奨される。
   */
  allowOrigins: string[] | "*";
  /**
   * 許可メソッド → Access-Control-Allow-Methods ヘッダ
   * プリフライトレスポンスで返され、実際に使用可能なHTTPメソッドを宣言する。
   */
  allowMethods: HttpMethod[];
  /**
   * 許可ヘッダ → Access-Control-Allow-Headers ヘッダ
   * プリフライトレスポンスで返され、リクエストに含めてよいカスタムヘッダを宣言する。
   */
  allowHeaders: string[];
  /**
   * 公開ヘッダ → Access-Control-Expose-Headers ヘッダ
   * デフォルトではJSから読めるレスポンスヘッダはCORS-safelistedの6つのみ
   * (Cache-Control, Content-Language, Content-Type, Expires, Last-Modified, Pragma)。
   * このリストに追加したヘッダはJSから response.headers.get() で取得可能になる。
   */
  exposeHeaders: string[];
  /**
   * クレデンシャル許可 → Access-Control-Allow-Credentials: true ヘッダ
   * trueの場合、cookies等のクレデンシャルを含むリクエストを許可する。
   * このとき Access-Control-Allow-Origin に "*" は使用不可。
   */
  allowCredentials: boolean;
  /**
   * プリフライト結果キャッシュ秒数 → Access-Control-Max-Age ヘッダ
   * ブラウザがプリフライトの結果をキャッシュする秒数。
   * キャッシュ中は同じ条件のリクエストでOPTIONSリクエストを省略できる。
   * 0の場合キャッシュしない。ブラウザごとに上限が異なる（Chrome: 7200秒）。
   */
  maxAge: number;
  /**
   * Vary: Origin ヘッダを返すかどうか
   * CDNやプロキシがオリジンごとに異なるレスポンスをキャッシュするために必要。
   * allowOriginsがリストの場合は常にVary: Originを返すべき。
   */
  varyOrigin: boolean;
}

/**
 * プリフライトリクエスト
 * ブラウザが自動的に送信するOPTIONSメソッドのリクエスト。
 * 実リクエストの前に「このリクエストを送っていいか？」をサーバーに確認する。
 * プリフライトが必要になる条件:
 *   - 非単純メソッド（PUT, DELETE, PATCHなど）
 *   - 非単純ヘッダ（Authorization, カスタムヘッダなど）
 *   - Content-Type が application/json など非単純値
 */
export interface PreflightRequest {
  /** リクエスト元オリジン（Origin ヘッダ） */
  origin: string;
  /** 実リクエストで使うメソッド（Access-Control-Request-Method ヘッダ） */
  accessControlRequestMethod: HttpMethod;
  /** 実リクエストで使うカスタムヘッダ一覧（Access-Control-Request-Headers ヘッダ） */
  accessControlRequestHeaders: string[];
}

/**
 * CORSレスポンスヘッダ
 * サーバーが返すAccess-Control-*系ヘッダの集合。
 * ブラウザはこれらのヘッダを検証し、レスポンスをJSに公開するか判断する。
 */
export interface CorsResponseHeaders {
  /** 許可するオリジン。"*"（全許可）または具体的なオリジン文字列 */
  "access-control-allow-origin"?: string;
  /** プリフライトで許可するメソッド一覧（カンマ区切り） */
  "access-control-allow-methods"?: string;
  /** プリフライトで許可するヘッダ一覧（カンマ区切り） */
  "access-control-allow-headers"?: string;
  /** JSから読み取り可能にするレスポンスヘッダ一覧 */
  "access-control-expose-headers"?: string;
  /** クレデンシャル付きリクエストを許可するか（"true"のみ有効） */
  "access-control-allow-credentials"?: string;
  /** プリフライト結果のキャッシュ時間（秒） */
  "access-control-max-age"?: string;
  /** キャッシュの使い分けに使用（CDN/プロキシ向け） */
  vary?: string;
  [key: string]: string | undefined;
}

/**
 * CORSチェック結果（最終判定）
 * ブラウザがレスポンスをJavaScriptに公開するかどうかの最終的な判定。
 * "allowed"以外はすべてブラウザがレスポンスをブロックするケース。
 * ブロック時、サーバーには実際にリクエストが到達している点に注意
 * （CORSはブラウザ側の保護であり、サーバー側のセキュリティではない）。
 */
export type CorsVerdict =
  | "allowed"           // CORS許可: レスポンスがJSに公開される
  | "blocked_origin"    // オリジン不許可: ACAOヘッダが一致しない
  | "blocked_method"    // メソッド不許可: プリフライトでメソッドが拒否された
  | "blocked_header"    // ヘッダ不許可: プリフライトでヘッダが拒否された
  | "blocked_credentials" // クレデンシャルエラー: "*"とcredentialsの併用など
  | "blocked_preflight" // プリフライト失敗: OPTIONSリクエスト自体が失敗
  | "same_origin"       // 同一オリジン: CORSチェック自体が不要
  | "opaque"            // 不透明レスポンス: no-corsモードでJSからアクセス不可
  | "no_cors_header";   // CORSヘッダなし: サーバーがACAOヘッダを返さなかった

/**
 * リクエスト分類
 * ブラウザがリクエストの内容を分析し、CORSの処理フローを決定する。
 * この分類により、プリフライトの要否や不透明レスポンスの扱いが変わる。
 */
export type RequestClassification =
  | "same_origin"       // 同一オリジン: CORSチェック不要でそのまま通過
  | "simple_cors"       // 単純リクエスト: プリフライト不要で直接送信
  | "preflight_cors"    // プリフライト必要: 先にOPTIONSリクエストで確認
  | "no_cors";          // no-corsモード: 不透明レスポンスとして処理

/**
 * プリフライトキャッシュエントリ
 * ブラウザはAccess-Control-Max-Ageヘッダの値に基づいて
 * プリフライト結果をキャッシュする。キャッシュが有効な間は
 * 同条件のリクエストでOPTIONSプリフライトを省略でき、パフォーマンスが向上する。
 * キャッシュキーはオリジンとURLの組み合わせ。
 */
export interface PreflightCacheEntry {
  /** キャッシュ対象のリクエスト元オリジン */
  origin: string;
  /** キャッシュ対象のリクエスト先オリジン */
  url: string;
  /** キャッシュされた許可メソッド一覧 */
  methods: HttpMethod[];
  /** キャッシュされた許可ヘッダ一覧 */
  headers: string[];
  /** キャッシュ有効期限（UNIXタイムスタンプ、ミリ秒） */
  expiresAt: number;
}

/**
 * シミュレーションステップ
 * CORSチェックの各段階を表現する。UIでステップごとの進行状況を表示するために使用。
 * phase の流れ: classify → preflight_send → preflight_check → actual_send → cors_check → result
 */
export interface SimStep {
  /**
   * ステップ種別
   * - classify: リクエスト分類（単純/プリフライト/同一オリジン）
   * - preflight_send: OPTIONSプリフライトリクエストの送信
   * - preflight_check: プリフライトレスポンスの検証
   * - actual_send: 実リクエストの送信
   * - cors_check: 実レスポンスのCORSヘッダ検証
   * - result: 最終結果
   */
  phase: "classify" | "preflight_send" | "preflight_check" | "actual_send" | "cors_check" | "result";
  /** ステップの説明メッセージ */
  message: string;
  /** 補足詳細情報 */
  detail?: string;
  /** このステップで送受信されたヘッダ情報 */
  headers?: Record<string, string>;
  /** このステップでの判定結果（失敗時または最終結果時に設定） */
  verdict?: CorsVerdict;
  /** このステップが成功したかどうか */
  success: boolean;
}

/**
 * シミュレーション操作
 * シミュレーションエンジンに投入する1つの操作単位。
 * リクエスト内容とサーバー設定のペアで、クライアントとサーバーの両方をエミュレートする。
 */
export type SimOp = {
  type: "request";
  /** クライアント側のリクエスト定義 */
  request: CorsRequest;
  /** サーバー側のCORS設定 */
  serverConfig: CorsServerConfig;
};

/**
 * イベント種別
 * シミュレーション中に発生するイベントの種類。UIでのイベントログ表示に使用。
 */
export type EventType =
  | "classify"          // リクエスト分類完了
  | "preflight"         // プリフライトリクエスト送信
  | "preflight_pass"    // プリフライトチェック成功
  | "preflight_fail"    // プリフライトチェック失敗
  | "cors_pass"         // CORSチェック成功（レスポンス公開）
  | "cors_fail"         // CORSチェック失敗（レスポンスブロック）
  | "same_origin"       // 同一オリジンリクエスト検出
  | "no_cors"           // no-corsモードリクエスト検出
  | "cache_hit"         // プリフライトキャッシュヒット
  | "cache_miss"        // プリフライトキャッシュミス（結果を新規キャッシュ）
  | "credential_error"  // クレデンシャル関連のエラー
  | "info";             // 一般的な情報メッセージ

/**
 * シミュレーションイベント
 * CORSチェックの各段階で発生するイベント。時系列のログとして記録される。
 */
export interface SimEvent {
  /** イベントの種別 */
  type: EventType;
  /** イベントのメッセージ */
  message: string;
  /** 補足詳細 */
  detail?: string;
}

/**
 * 単一リクエストの結果
 * 1つのHTTPリクエストに対するCORSシミュレーションの全結果を保持する。
 * プリフライト（もしあれば）と実リクエストの両方の情報を含む。
 */
export interface RequestResult {
  /** 元のリクエスト定義 */
  request: CorsRequest;
  /** サーバー側のCORS設定 */
  serverConfig: CorsServerConfig;
  /** リクエストの分類結果 */
  classification: RequestClassification;
  /** シミュレーションの各ステップ */
  steps: SimStep[];
  /** 発生したイベント一覧 */
  events: SimEvent[];
  /** 最終判定結果 */
  verdict: CorsVerdict;
  /** プリフライトレスポンスヘッダ（プリフライトが発生した場合のみ） */
  preflightResponse?: CorsResponseHeaders;
  /** 実レスポンスのCORSヘッダ */
  actualResponse?: CorsResponseHeaders;
  /** プリフライト結果がキャッシュから取得されたかどうか */
  preflightCached: boolean;
}

/**
 * シミュレーション全体の結果
 * 複数のリクエストをまとめて実行した場合の全体結果。
 * プリフライトキャッシュは複数リクエスト間で共有される。
 */
export interface SimulationResult {
  /** 各リクエストの結果 */
  results: RequestResult[];
  /** シミュレーション終了時のプリフライトキャッシュ状態 */
  preflightCache: PreflightCacheEntry[];
  /** 全リクエストの全イベント（時系列順） */
  events: SimEvent[];
}

/**
 * プリセット
 * セレクトボックスで選択可能な実験シナリオ。
 * CORSの各概念（単純リクエスト、プリフライト、クレデンシャルなど）を
 * 具体的なリクエスト例で体験できるようにする。
 */
export interface Preset {
  /** プリセットの表示名 */
  name: string;
  /** プリセットの説明文 */
  description: string;
  /** シミュレーション操作を生成するファクトリ関数 */
  build: () => SimOp[];
}
