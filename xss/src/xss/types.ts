/* XSS シミュレーター 型定義 */

// ─── 攻撃分類 ───

/** XSS攻撃タイプ */
export type XssType = "reflected" | "stored" | "dom_based";

/** インジェクションコンテキスト */
export type InjectionContext =
  | "html_body"        // <div>ここ</div>
  | "html_attribute"   // <input value="ここ">
  | "href_attribute"   // <a href="ここ">
  | "script_string"    // <script>var x = "ここ";</script>
  | "script_block"     // <script>ここ</script>
  | "event_handler"    // <div onclick="ここ">
  | "style"            // <style>ここ</style>
  | "url_param";       // ?q=ここ（DOM-based用）

/** 攻撃ペイロード */
export interface XssPayload {
  /** 攻撃者が送り込む入力値 */
  input: string;
  /** ペイロードの説明 */
  description: string;
  /** 攻撃目的 */
  intent: string;
}

// ─── サーバー/アプリケーション ───

/** サーバーの出力エンコード設定 */
export interface OutputEncoding {
  /** HTMLエンティティエスケープ */
  htmlEscape: boolean;
  /** JavaScript文字列エスケープ */
  jsEscape: boolean;
  /** URLエンコード */
  urlEncode: boolean;
  /** CSSエスケープ */
  cssEscape: boolean;
}

/** サニタイザー設定 */
export interface SanitizerConfig {
  /** サニタイズ有効 */
  enabled: boolean;
  /** ブロックするタグ */
  blockTags: string[];
  /** ブロックする属性 */
  blockAttributes: string[];
  /** ブロックするプロトコル */
  blockProtocols: string[];
  /** ホワイトリスト方式か（falseならブラックリスト） */
  whitelist: boolean;
  /** 許可タグ（ホワイトリスト方式時） */
  allowTags?: string[];
}

/** CSPディレクティブ */
export interface CspPolicy {
  /** CSP有効 */
  enabled: boolean;
  /** default-src */
  defaultSrc: string[];
  /** script-src */
  scriptSrc: string[];
  /** style-src */
  styleSrc: string[];
  /** img-src */
  imgSrc: string[];
  /** connect-src */
  connectSrc: string[];
  /** report-uri */
  reportUri?: string;
  /** nonce値 */
  nonce?: string;
}

/** サーバー/ページ設定 */
export interface PageConfig {
  /** 出力エンコード */
  encoding: OutputEncoding;
  /** サニタイザー */
  sanitizer: SanitizerConfig;
  /** CSP */
  csp: CspPolicy;
  /** HttpOnly Cookie */
  httpOnlyCookie: boolean;
  /** X-XSS-Protection ヘッダ */
  xssProtection: boolean;
}

// ─── シミュレーション結果 ───

/** 処理ステップ */
export interface SimStep {
  phase: string;
  message: string;
  detail?: string;
  blocked: boolean;
}

/** 攻撃結果 */
export interface AttackResult {
  /** 攻撃タイプ */
  xssType: XssType;
  /** インジェクションコンテキスト */
  context: InjectionContext;
  /** 元のペイロード */
  payload: XssPayload;
  /** サーバー処理後のHTML */
  renderedHtml: string;
  /** サニタイズ後のHTML */
  sanitizedHtml: string;
  /** スクリプトが実行されたか */
  scriptExecuted: boolean;
  /** 実行されたスクリプト内容（シミュレーション） */
  executedScript?: string;
  /** Cookie窃取成功したか */
  cookieStolen: boolean;
  /** CSPでブロックされたか */
  cspBlocked: boolean;
  /** ブロック理由 */
  blockReasons: string[];
  /** 処理ステップ */
  steps: SimStep[];
  /** 防御勧告 */
  mitigations: string[];
}

// ─── シミュレーション ───

/** シミュレーション操作 */
export type SimOp = {
  type: "attack";
  xssType: XssType;
  context: InjectionContext;
  payload: XssPayload;
  pageConfig: PageConfig;
};

/** イベント種別 */
export type EventType =
  | "inject" | "encode" | "sanitize" | "render"
  | "execute" | "block" | "csp" | "steal" | "info" | "warn";

/** シミュレーションイベント */
export interface SimEvent {
  type: EventType;
  message: string;
  detail?: string;
}

/** シミュレーション結果 */
export interface SimulationResult {
  results: AttackResult[];
  events: SimEvent[];
}

/** プリセット */
export interface Preset {
  name: string;
  description: string;
  build: () => SimOp[];
}
