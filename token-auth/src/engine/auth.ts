/**
 * auth.ts — トークン認証シミュレーション
 *
 * JWT の生成・検証・デコードのフルフローと、
 * OAuth2 Authorization Code / Refresh Token フローをエミュレート。
 *
 * 仕組み:
 *   Header.Payload.Signature
 *   HMAC-SHA256(base64(header) + "." + base64(payload), secret) で署名
 */

// ── Base64URL ──

export function base64urlEncode(str: string): string {
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64urlDecode(str: string): string {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  return atob(padded);
}

// ── HMAC-SHA256 簡易シミュレーション ──

export function hmacSha256(message: string, secret: string): string {
  // 簡易ハッシュ（教育用、実際の SHA256 ではない）
  let hash = 0x811c9dc5;
  const combined = message + "|" + secret;
  for (let i = 0; i < combined.length; i++) {
    hash ^= combined.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  // 256bit 風に拡張
  const h1 = (hash >>> 0).toString(16).padStart(8, "0");
  let hash2 = hash ^ 0xa5a5a5a5;
  for (let i = combined.length - 1; i >= 0; i--) {
    hash2 ^= combined.charCodeAt(i);
    hash2 = Math.imul(hash2, 0x01000193);
  }
  const h2 = (hash2 >>> 0).toString(16).padStart(8, "0");
  let hash3 = hash ^ hash2;
  for (let i = 0; i < combined.length; i += 2) {
    hash3 ^= combined.charCodeAt(i);
    hash3 = Math.imul(hash3, 0x01000193);
  }
  const h3 = (hash3 >>> 0).toString(16).padStart(8, "0");
  const h4 = ((hash ^ hash2 ^ hash3) >>> 0).toString(16).padStart(8, "0");
  return h1 + h2 + h3 + h4;
}

// ── JWT ──

export interface JwtHeader {
  alg: string;
  typ: string;
}

export interface JwtPayload {
  sub: string;
  iss?: string;
  aud?: string;
  exp: number;
  iat: number;
  nbf?: number;
  jti?: string;
  roles?: string[];
  [key: string]: unknown;
}

export interface JwtToken {
  raw: string;
  header: JwtHeader;
  payload: JwtPayload;
  signature: string;
  headerEncoded: string;
  payloadEncoded: string;
}

export interface VerifyResult {
  valid: boolean;
  errors: string[];
  checks: VerifyCheck[];
}

export interface VerifyCheck {
  name: string;
  passed: boolean;
  detail: string;
}

/** JWT を生成する */
export function createJwt(payload: JwtPayload, secret: string, alg = "HS256"): JwtToken {
  const header: JwtHeader = { alg, typ: "JWT" };
  const headerEncoded = base64urlEncode(JSON.stringify(header));
  const payloadEncoded = base64urlEncode(JSON.stringify(payload));
  const sigInput = headerEncoded + "." + payloadEncoded;
  const signature = base64urlEncode(hmacSha256(sigInput, secret));
  const raw = sigInput + "." + signature;
  return { raw, header, payload, signature, headerEncoded, payloadEncoded };
}

/** JWT をデコードする（署名検証なし） */
export function decodeJwt(token: string): JwtToken | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(base64urlDecode(parts[0]!)) as JwtHeader;
    const payload = JSON.parse(base64urlDecode(parts[1]!)) as JwtPayload;
    return { raw: token, header, payload, signature: parts[2]!, headerEncoded: parts[0]!, payloadEncoded: parts[1]! };
  } catch {
    return null;
  }
}

/** JWT を検証する */
export function verifyJwt(token: string, secret: string, options?: { audience?: string; issuer?: string; clockToleranceSec?: number }): VerifyResult {
  const checks: VerifyCheck[] = [];
  const errors: string[] = [];
  const now = Math.floor(Date.now() / 1000);
  const tolerance = options?.clockToleranceSec ?? 0;

  // 1. 構造チェック
  const decoded = decodeJwt(token);
  if (decoded === null) {
    checks.push({ name: "構造", passed: false, detail: "JWT の形式が不正 (3 部分でない)" });
    return { valid: false, errors: ["Invalid JWT format"], checks };
  }
  checks.push({ name: "構造", passed: true, detail: `Header.Payload.Signature (${token.length} chars)` });

  // 2. アルゴリズムチェック
  if (decoded.header.alg !== "HS256" && decoded.header.alg !== "HS384" && decoded.header.alg !== "HS512") {
    checks.push({ name: "alg", passed: false, detail: `未サポート: ${decoded.header.alg}` });
    errors.push(`Unsupported algorithm: ${decoded.header.alg}`);
  } else {
    checks.push({ name: "alg", passed: true, detail: decoded.header.alg });
  }

  // 3. 署名検証
  const sigInput = decoded.headerEncoded + "." + decoded.payloadEncoded;
  const expectedSig = base64urlEncode(hmacSha256(sigInput, secret));
  const sigValid = expectedSig === decoded.signature;
  checks.push({
    name: "署名 (HMAC)",
    passed: sigValid,
    detail: sigValid
      ? `HMAC(header.payload, secret) = ${expectedSig.slice(0, 16)}... ✓`
      : `期待: ${expectedSig.slice(0, 16)}... ≠ 実際: ${decoded.signature.slice(0, 16)}...`,
  });
  if (!sigValid) errors.push("Signature verification failed");

  // 4. 有効期限 (exp)
  if (decoded.payload.exp !== undefined) {
    const expired = now > decoded.payload.exp + tolerance;
    checks.push({
      name: "exp (有効期限)",
      passed: !expired,
      detail: expired
        ? `期限切れ: ${new Date(decoded.payload.exp * 1000).toISOString()} (${now - decoded.payload.exp}s 前)`
        : `有効: ${new Date(decoded.payload.exp * 1000).toISOString()} (残り ${decoded.payload.exp - now}s)`,
    });
    if (expired) errors.push("Token expired");
  }

  // 5. nbf (Not Before)
  if (decoded.payload.nbf !== undefined) {
    const notYet = now < decoded.payload.nbf - tolerance;
    checks.push({
      name: "nbf (開始時刻)",
      passed: !notYet,
      detail: notYet ? `まだ有効でない: ${new Date(decoded.payload.nbf * 1000).toISOString()}` : "OK",
    });
    if (notYet) errors.push("Token not yet valid");
  }

  // 6. iss (発行者)
  if (options?.issuer !== undefined) {
    const issMatch = decoded.payload.iss === options.issuer;
    checks.push({ name: "iss (発行者)", passed: issMatch, detail: `期待: "${options.issuer}", 実際: "${decoded.payload.iss}"` });
    if (!issMatch) errors.push("Issuer mismatch");
  }

  // 7. aud (対象者)
  if (options?.audience !== undefined) {
    const audMatch = decoded.payload.aud === options.audience;
    checks.push({ name: "aud (対象者)", passed: audMatch, detail: `期待: "${options.audience}", 実際: "${decoded.payload.aud}"` });
    if (!audMatch) errors.push("Audience mismatch");
  }

  return { valid: errors.length === 0, errors, checks };
}

// ── OAuth2 フロー ──

export interface OAuth2Config {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
}

export interface OAuth2Trace {
  step: number;
  phase: "redirect" | "auth_code" | "token_request" | "token_response" | "refresh" | "access" | "error" | "validate";
  from: string;
  to: string;
  detail: string;
  data?: Record<string, string>;
}

export interface OAuth2Result {
  accessToken: JwtToken;
  refreshToken: string;
  idToken?: JwtToken;
  expiresIn: number;
  tokenType: string;
  trace: OAuth2Trace[];
}

/** OAuth2 Authorization Code フローをシミュレートする */
export function simulateOAuth2(
  config: OAuth2Config,
  userCredentials: { username: string; password: string },
  jwtSecret: string,
): OAuth2Result {
  const trace: OAuth2Trace[] = [];
  let step = 0;
  const now = Math.floor(Date.now() / 1000);

  // 1. 認可リクエスト (ブラウザ → 認可サーバー)
  step++;
  const state = Math.random().toString(36).slice(2, 10);
  trace.push({
    step, phase: "redirect", from: "Client App", to: "Authorization Server",
    detail: `GET ${config.authorizationEndpoint}`,
    data: { response_type: "code", client_id: config.clientId, redirect_uri: config.redirectUri, scope: config.scopes.join(" "), state },
  });

  // 2. ユーザー認証 + 同意
  step++;
  trace.push({ step, phase: "auth_code", from: "User", to: "Authorization Server", detail: `ログイン: ${userCredentials.username} / ****  → 認可同意` });

  // 3. 認可コード発行 + リダイレクト
  step++;
  const authCode = "auth_" + Math.random().toString(36).slice(2, 14);
  trace.push({
    step, phase: "auth_code", from: "Authorization Server", to: "Client App",
    detail: `302 Redirect → ${config.redirectUri}`,
    data: { code: authCode, state },
  });

  // 4. トークンリクエスト (バックチャネル)
  step++;
  trace.push({
    step, phase: "token_request", from: "Client App (Backend)", to: "Authorization Server",
    detail: `POST ${config.tokenEndpoint}`,
    data: { grant_type: "authorization_code", code: authCode, redirect_uri: config.redirectUri, client_id: config.clientId, client_secret: config.clientSecret.slice(0, 8) + "..." },
  });

  // 5. トークン発行
  step++;
  const accessPayload: JwtPayload = {
    sub: userCredentials.username, iss: "https://auth.example.com", aud: config.clientId,
    exp: now + 3600, iat: now, jti: "tok_" + Math.random().toString(36).slice(2, 10),
    roles: ["user"], scope: config.scopes.join(" "),
  };
  const accessToken = createJwt(accessPayload, jwtSecret);
  const refreshToken = "refresh_" + Math.random().toString(36).slice(2, 22);

  trace.push({
    step, phase: "token_response", from: "Authorization Server", to: "Client App",
    detail: "200 OK — アクセストークン + リフレッシュトークン発行",
    data: { access_token: accessToken.raw.slice(0, 30) + "...", token_type: "Bearer", expires_in: "3600", refresh_token: refreshToken.slice(0, 20) + "..." },
  });

  // 6. API アクセス
  step++;
  trace.push({
    step, phase: "access", from: "Client App", to: "Resource Server",
    detail: "GET /api/user — Authorization: Bearer <access_token>",
  });
  trace.push({
    step, phase: "validate", from: "Resource Server", to: "Resource Server",
    detail: "JWT 検証: 署名 ✓, 期限 ✓, iss ✓, aud ✓ → 200 OK",
  });

  return { accessToken, refreshToken, expiresIn: 3600, tokenType: "Bearer", trace };
}

/** リフレッシュトークンフローをシミュレートする */
export function simulateRefresh(
  refreshToken: string,
  config: OAuth2Config,
  jwtSecret: string,
): { newAccessToken: JwtToken; trace: OAuth2Trace[] } {
  const trace: OAuth2Trace[] = [];
  const now = Math.floor(Date.now() / 1000);

  trace.push({
    step: 1, phase: "refresh", from: "Client App", to: "Authorization Server",
    detail: `POST ${config.tokenEndpoint}`,
    data: { grant_type: "refresh_token", refresh_token: refreshToken.slice(0, 20) + "...", client_id: config.clientId },
  });

  const newPayload: JwtPayload = {
    sub: "user", iss: "https://auth.example.com", aud: config.clientId,
    exp: now + 3600, iat: now, jti: "tok_" + Math.random().toString(36).slice(2, 10),
    roles: ["user"],
  };
  const newAccessToken = createJwt(newPayload, jwtSecret);

  trace.push({
    step: 2, phase: "token_response", from: "Authorization Server", to: "Client App",
    detail: "200 OK — 新しいアクセストークン発行",
  });

  return { newAccessToken, trace };
}
