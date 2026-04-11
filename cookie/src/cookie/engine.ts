/* Cookie シミュレーションエンジン */

import type {
  Cookie, CookieJar, SetCookieDirective,
  HttpRequest, HttpResponse, SameSitePolicy,
  SimOp, SimEvent, SimulationResult,
} from "./types.js";

// ─── Cookie Jar ───

/** CookieJar生成 */
export function createJar(): CookieJar {
  return {
    cookies: new Map(),
    currentTime: Date.now(),
    maxPerDomain: 50,
    maxTotal: 3000,
    blockThirdParty: false,
    partitionEnabled: false,
  };
}

// ─── URL / ドメインユーティリティ ───

/** URLからドメイン抽出 */
export function extractDomain(url: string): string {
  try {
    const match = url.match(/^https?:\/\/([^/:]+)/);
    return match ? match[1]! : url;
  } catch {
    return url;
  }
}

/** URLからパス抽出 */
export function extractPath(url: string): string {
  try {
    const match = url.match(/^https?:\/\/[^/]+(\/[^?#]*)?/);
    return match?.[1] ?? "/";
  } catch {
    return "/";
  }
}

/** URLからスキーム抽出 */
export function extractScheme(url: string): "http" | "https" {
  return url.startsWith("https") ? "https" : "http";
}

/** URLからオリジン抽出 */
export function extractOrigin(url: string): string {
  const match = url.match(/^(https?:\/\/[^/]+)/);
  return match ? match[1]! : url;
}

/** ドメインマッチング（サブドメイン含む） */
export function domainMatches(cookieDomain: string, requestDomain: string): boolean {
  const cd = cookieDomain.startsWith(".") ? cookieDomain.slice(1) : cookieDomain;
  if (requestDomain === cd) return true;
  if (requestDomain.endsWith("." + cd)) return true;
  return false;
}

/** パスマッチング */
export function pathMatches(cookiePath: string, requestPath: string): boolean {
  if (requestPath === cookiePath) return true;
  if (requestPath.startsWith(cookiePath)) {
    if (cookiePath.endsWith("/")) return true;
    if (requestPath[cookiePath.length] === "/") return true;
  }
  return false;
}

/** 同一サイト判定 */
export function isSameSite(origin1: string, origin2: string): boolean {
  const d1 = extractDomain(origin1);
  const d2 = extractDomain(origin2);
  // 登録可能ドメイン（eTLD+1）の簡易判定
  const getRegistrable = (d: string): string => {
    const parts = d.split(".");
    return parts.length >= 2 ? parts.slice(-2).join(".") : d;
  };
  return getRegistrable(d1) === getRegistrable(d2);
}

// ─── Set-Cookie パース ───

/** Set-Cookieヘッダをパース */
export function parseSetCookie(
  header: string, responseUrl: string, currentTime: number,
): SetCookieDirective {
  const errors: string[] = [];
  const warnings: string[] = [];
  const parts = header.split(";").map(s => s.trim());
  const nameValue = parts[0] ?? "";
  const eqIdx = nameValue.indexOf("=");

  const name = eqIdx >= 0 ? nameValue.slice(0, eqIdx).trim() : nameValue.trim();
  const value = eqIdx >= 0 ? nameValue.slice(eqIdx + 1).trim() : "";

  if (!name) errors.push("Cookie名が空");

  const responseDomain = extractDomain(responseUrl);
  const responsePath = extractPath(responseUrl);

  let domain = responseDomain;
  let path = responsePath.replace(/\/[^/]*$/, "") || "/";
  let expires: number | undefined;
  let maxAge: number | undefined;
  let secure = false;
  let httpOnly = false;
  let sameSite: SameSitePolicy = "lax"; // デフォルトはLax
  let partitioned = false;

  for (let i = 1; i < parts.length; i++) {
    const attr = parts[i]!;
    const [attrName, ...attrValParts] = attr.split("=");
    const an = (attrName ?? "").trim().toLowerCase();
    const av = attrValParts.join("=").trim();

    switch (an) {
      case "domain": {
        const d = av.startsWith(".") ? av.slice(1) : av;
        // ドメインが応答ドメインのサフィックスか確認
        if (!domainMatches(d, responseDomain) && d !== responseDomain) {
          errors.push(`Domain="${av}" はレスポンスドメイン ${responseDomain} にマッチしない`);
        } else {
          domain = d;
        }
        break;
      }
      case "path":
        path = av || "/";
        break;
      case "expires": {
        const d = new Date(av);
        if (!isNaN(d.getTime())) {
          expires = d.getTime();
        } else {
          warnings.push(`Expires="${av}" のパースに失敗`);
        }
        break;
      }
      case "max-age": {
        const n = parseInt(av, 10);
        if (!isNaN(n)) {
          maxAge = n;
          expires = currentTime + n * 1000;
        } else {
          warnings.push(`Max-Age="${av}" が無効`);
        }
        break;
      }
      case "secure":
        secure = true;
        break;
      case "httponly":
        httpOnly = true;
        break;
      case "samesite":
        switch (av.toLowerCase()) {
          case "strict": sameSite = "strict"; break;
          case "lax": sameSite = "lax"; break;
          case "none":
            sameSite = "none";
            break;
          default:
            warnings.push(`SameSite="${av}" は不明 → Lax扱い`);
        }
        break;
      case "partitioned":
        partitioned = true;
        break;
    }
  }

  // SameSite=None にはSecure必須
  if (sameSite === "none" && !secure) {
    warnings.push("SameSite=None にはSecure属性が必要 → 拒否される可能性");
  }

  // プレフィックスチェック
  const securePrefix = name.startsWith("__Secure-");
  const hostPrefix = name.startsWith("__Host-");

  if (securePrefix && !secure) {
    errors.push("__Secure-プレフィックスにはSecure属性が必須");
  }
  if (hostPrefix) {
    if (!secure) errors.push("__Host-プレフィックスにはSecure属性が必須");
    if (domain !== responseDomain) errors.push("__Host-プレフィックスではDomain指定不可");
    if (path !== "/") errors.push("__Host-プレフィックスではPath=/必須");
  }

  const cookie: Cookie = {
    name, value, domain, path,
    expires, maxAge, secure, httpOnly, sameSite,
    createdAt: currentTime,
    lastAccessed: currentTime,
    size: name.length + value.length,
    securePrefix, hostPrefix, partitioned,
    partitionKey: partitioned ? extractOrigin(responseUrl) : undefined,
  };

  return { raw: header, cookie, errors, warnings };
}

// ─── Cookie保存 ───

/** CookieをJarに保存 */
function storeCookie(
  jar: CookieJar, cookie: Cookie, request: HttpRequest,
  events: SimEvent[],
): boolean {
  // Secure属性チェック（非HTTPS）
  if (cookie.secure && request.scheme !== "https") {
    events.push({
      time: jar.currentTime, type: "secure_block",
      message: `${cookie.name}: Secure属性のCookieは非HTTPSで設定不可`,
      cookieName: cookie.name, domain: cookie.domain,
    });
    return false;
  }

  // サードパーティCookieブロック
  if (jar.blockThirdParty && request.crossSite) {
    events.push({
      time: jar.currentTime, type: "cookie_block",
      message: `${cookie.name}: サードパーティCookieブロック (origin=${request.origin})`,
      cookieName: cookie.name, domain: cookie.domain,
    });
    return false;
  }

  // パーティション
  if (jar.partitionEnabled && cookie.partitioned) {
    cookie.partitionKey = request.origin;
    events.push({
      time: jar.currentTime, type: "partition",
      message: `${cookie.name}: CHIPS パーティション分離 (key=${cookie.partitionKey})`,
      cookieName: cookie.name, domain: cookie.domain,
    });
  }

  const domainKey = cookie.partitionKey
    ? `${cookie.domain}::${cookie.partitionKey}`
    : cookie.domain;

  const domainCookies = jar.cookies.get(domainKey) ?? [];

  // 同名Cookieの上書き
  const existingIdx = domainCookies.findIndex(
    c => c.name === cookie.name && c.path === cookie.path
  );
  if (existingIdx >= 0) {
    domainCookies[existingIdx] = cookie;
    events.push({
      time: jar.currentTime, type: "cookie_set",
      message: `${cookie.name}=${truncate(cookie.value, 20)} 更新 (domain=${cookie.domain}, path=${cookie.path})`,
      cookieName: cookie.name, domain: cookie.domain,
      detail: formatCookieAttrs(cookie),
    });
  } else {
    // ドメイン上限チェック
    if (domainCookies.length >= jar.maxPerDomain) {
      // 最も古いCookieを削除
      domainCookies.sort((a, b) => a.lastAccessed - b.lastAccessed);
      const evicted = domainCookies.shift()!;
      events.push({
        time: jar.currentTime, type: "cookie_evict",
        message: `${evicted.name}: ドメイン上限(${jar.maxPerDomain})到達 → 最古のCookie削除`,
        cookieName: evicted.name, domain: evicted.domain,
      });
    }

    domainCookies.push(cookie);
    events.push({
      time: jar.currentTime, type: "cookie_set",
      message: `${cookie.name}=${truncate(cookie.value, 20)} 設定 (domain=${cookie.domain}, path=${cookie.path})`,
      cookieName: cookie.name, domain: cookie.domain,
      detail: formatCookieAttrs(cookie),
    });
  }

  jar.cookies.set(domainKey, domainCookies);
  return true;
}

/** Cookie属性をフォーマット */
function formatCookieAttrs(c: Cookie): string {
  const attrs: string[] = [];
  if (c.secure) attrs.push("Secure");
  if (c.httpOnly) attrs.push("HttpOnly");
  attrs.push(`SameSite=${c.sameSite}`);
  if (c.expires) attrs.push(`Expires=${new Date(c.expires).toISOString().slice(0, 10)}`);
  if (c.maxAge !== undefined) attrs.push(`Max-Age=${c.maxAge}s`);
  if (c.partitioned) attrs.push("Partitioned");
  if (c.securePrefix) attrs.push("__Secure-");
  if (c.hostPrefix) attrs.push("__Host-");
  return attrs.join(", ");
}

/** 文字列を切り詰め */
function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
}

// ─── Cookie送信判定 ───

/** リクエストに送信するCookieを選択 */
function selectCookies(
  jar: CookieJar, request: HttpRequest, events: SimEvent[],
): { sent: Cookie[]; blocked: Array<{ cookie: Cookie; reason: string }> } {
  const sent: Cookie[] = [];
  const blocked: Array<{ cookie: Cookie; reason: string }> = [];
  const reqDomain = extractDomain(request.url);
  const reqPath = extractPath(request.url);
  const reqScheme = extractScheme(request.url);
  const reqOrigin = extractOrigin(request.url);

  // 期限切れCookieを削除
  expireCookies(jar, events);

  for (const [, cookies] of jar.cookies) {
    for (const cookie of cookies) {
      // ドメインマッチ
      if (!domainMatches(cookie.domain, reqDomain)) continue;

      // パスマッチ
      if (!pathMatches(cookie.path, reqPath)) continue;

      // Secure属性チェック
      if (cookie.secure && reqScheme !== "https") {
        blocked.push({ cookie, reason: "Secure属性 (非HTTPS)" });
        events.push({
          time: jar.currentTime, type: "secure_block",
          message: `${cookie.name}: Secure属性のため非HTTPSリクエストに送信不可`,
          cookieName: cookie.name, domain: cookie.domain,
        });
        continue;
      }

      // SameSite判定
      if (request.crossSite) {
        const sameSiteResult = checkSameSite(cookie, request);
        if (!sameSiteResult.allowed) {
          blocked.push({ cookie, reason: sameSiteResult.reason });
          events.push({
            time: jar.currentTime, type: "sameSite_block",
            message: `${cookie.name}: ${sameSiteResult.reason}`,
            cookieName: cookie.name, domain: cookie.domain,
          });
          continue;
        }
      }

      // サードパーティブロック
      if (jar.blockThirdParty && request.crossSite && !cookie.partitioned) {
        blocked.push({ cookie, reason: "サードパーティCookieブロック" });
        events.push({
          time: jar.currentTime, type: "cookie_block",
          message: `${cookie.name}: サードパーティCookieブロック`,
          cookieName: cookie.name, domain: cookie.domain,
        });
        continue;
      }

      // パーティションチェック（CHIPS）
      if (cookie.partitioned && cookie.partitionKey) {
        if (cookie.partitionKey !== reqOrigin && request.crossSite) {
          blocked.push({ cookie, reason: "パーティションキー不一致" });
          continue;
        }
      }

      cookie.lastAccessed = jar.currentTime;
      sent.push(cookie);
    }
  }

  // パス長の降順、作成日時の昇順でソート（RFC 6265準拠）
  sent.sort((a, b) => {
    if (a.path.length !== b.path.length) return b.path.length - a.path.length;
    return a.createdAt - b.createdAt;
  });

  return { sent, blocked };
}

/** SameSite判定 */
function checkSameSite(
  cookie: Cookie, request: HttpRequest,
): { allowed: boolean; reason: string } {
  switch (cookie.sameSite) {
    case "strict":
      return {
        allowed: false,
        reason: `SameSite=Strict: クロスサイトリクエストで送信不可`,
      };

    case "lax":
      // Lax: トップレベルGETナビゲーションのみ許可
      if (request.navigationType === "top_level" && request.method === "GET") {
        return { allowed: true, reason: "" };
      }
      return {
        allowed: false,
        reason: `SameSite=Lax: ${request.navigationType === "top_level" ? "非GET" : "サブリソース"}リクエストで送信不可`,
      };

    case "none":
      // None: Secure必須
      if (!cookie.secure) {
        return {
          allowed: false,
          reason: "SameSite=None にSecure属性なし → 拒否",
        };
      }
      return { allowed: true, reason: "" };

    default:
      return { allowed: true, reason: "" };
  }
}

// ─── Cookie期限管理 ───

/** 期限切れCookieを削除 */
function expireCookies(jar: CookieJar, events: SimEvent[]): void {
  for (const [domainKey, cookies] of jar.cookies) {
    const alive: Cookie[] = [];
    for (const c of cookies) {
      if (c.expires && c.expires <= jar.currentTime) {
        events.push({
          time: jar.currentTime, type: "cookie_expire",
          message: `${c.name}: 有効期限切れ → 削除`,
          cookieName: c.name, domain: c.domain,
        });
      } else {
        alive.push(c);
      }
    }
    if (alive.length !== cookies.length) {
      jar.cookies.set(domainKey, alive);
    }
  }
}

// ─── ヘルパー: リクエスト生成 ───

/** リクエスト生成ヘルパー */
export function mkRequest(
  url: string, opts?: Partial<HttpRequest>,
): HttpRequest {
  const scheme = extractScheme(url);
  const origin = extractOrigin(url);
  return {
    method: "GET",
    url,
    scheme,
    origin,
    navigationType: "top_level",
    crossSite: false,
    headers: {},
    ...opts,
  };
}

/** レスポンス生成ヘルパー */
export function mkResponse(
  url: string, setCookies: string[],
): HttpResponse {
  return {
    status: 200,
    url,
    headers: { "content-type": "text/html" },
    setCookieHeaders: setCookies,
  };
}

// ─── メインシミュレーション ───

/** シミュレーション実行 */
export function simulate(ops: SimOp[]): SimulationResult {
  const jar = createJar();
  const events: SimEvent[] = [];
  const requestLog: SimulationResult["requestLog"] = [];

  events.push({
    time: jar.currentTime, type: "info",
    message: "Cookie シミュレーション開始",
  });

  for (const op of ops) {
    switch (op.type) {
      case "set_cookie": {
        for (const header of op.response.setCookieHeaders) {
          const directive = parseSetCookie(header, op.response.url, jar.currentTime);

          // エラーがあれば拒否
          if (directive.errors.length > 0) {
            for (const err of directive.errors) {
              events.push({
                time: jar.currentTime, type: "cookie_reject",
                message: `Set-Cookie拒否: ${err}`,
                detail: header,
              });
            }
            continue;
          }

          // 警告出力
          for (const warn of directive.warnings) {
            events.push({
              time: jar.currentTime, type: "info",
              message: `⚠ ${warn}`,
              detail: header,
            });
          }

          storeCookie(jar, directive.cookie, op.request, events);
        }
        break;
      }

      case "send_request": {
        const { sent, blocked } = selectCookies(jar, op.request, events);

        if (sent.length > 0) {
          const cookieHeader = sent.map(c => `${c.name}=${c.value}`).join("; ");
          events.push({
            time: jar.currentTime, type: "cookie_send",
            message: `Cookie送信: ${sent.map(c => c.name).join(", ")} → ${extractDomain(op.request.url)}`,
            detail: `Cookie: ${truncate(cookieHeader, 60)}`,
          });
        }

        requestLog.push({
          request: op.request,
          sentCookies: sent,
          blockedCookies: blocked,
        });
        break;
      }

      case "advance_time": {
        jar.currentTime += op.seconds * 1000;
        events.push({
          time: jar.currentTime, type: "info",
          message: `時間経過: ${op.seconds}秒`,
        });
        expireCookies(jar, events);
        break;
      }

      case "clear_cookies": {
        if (op.domain) {
          jar.cookies.delete(op.domain);
          events.push({
            time: jar.currentTime, type: "cookie_delete",
            message: `${op.domain} のCookieをすべて削除`,
          });
        } else {
          jar.cookies.clear();
          events.push({
            time: jar.currentTime, type: "cookie_delete",
            message: "全Cookieを削除",
          });
        }
        break;
      }

      case "delete_cookie": {
        const cookies = jar.cookies.get(op.domain);
        if (cookies) {
          const idx = cookies.findIndex(c => c.name === op.name);
          if (idx >= 0) {
            cookies.splice(idx, 1);
            events.push({
              time: jar.currentTime, type: "cookie_delete",
              message: `Cookie削除: ${op.name} (domain=${op.domain})`,
            });
          }
        }
        break;
      }

      case "toggle_third_party_block": {
        jar.blockThirdParty = op.enabled;
        events.push({
          time: jar.currentTime, type: "info",
          message: `サードパーティCookieブロック: ${op.enabled ? "有効" : "無効"}`,
        });
        break;
      }

      case "toggle_partition": {
        jar.partitionEnabled = op.enabled;
        events.push({
          time: jar.currentTime, type: "info",
          message: `CHIPS パーティション分離: ${op.enabled ? "有効" : "無効"}`,
        });
        break;
      }

      case "navigate": {
        const from = op.from ? extractOrigin(op.from) : undefined;
        const to = extractOrigin(op.url);
        const crossSite = from ? !isSameSite(from, to) : false;
        events.push({
          time: jar.currentTime, type: "navigate",
          message: `ナビゲーション: ${from ?? "(直接)"} → ${to}${crossSite ? " (クロスサイト)" : " (同一サイト)"}`,
        });
        break;
      }
    }
  }

  return { jar, events, requestLog };
}
