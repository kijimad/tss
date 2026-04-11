/* Cookie プリセット集 */

import type { Preset } from "./types.js";
import { mkRequest, mkResponse } from "./engine.js";

/** 1. 基本的なCookie設定と送信 */
const basic: Preset = {
  name: "基本: Set-Cookie / Cookie送信",
  description: "Set-Cookieヘッダによる設定と、後続リクエストでの自動送信。",
  build: () => [
    {
      type: "set_cookie",
      response: mkResponse("https://example.com/login", [
        "session_id=abc123; Path=/; HttpOnly; Secure",
        "username=alice; Path=/",
        "theme=dark; Path=/; Max-Age=86400",
      ]),
      request: mkRequest("https://example.com/login"),
    },
    {
      type: "send_request",
      request: mkRequest("https://example.com/dashboard"),
    },
    {
      type: "send_request",
      request: mkRequest("https://example.com/api/data", {
        navigationType: "fetch",
      }),
    },
  ],
};

/** 2. Expires / Max-Age と有効期限 */
const expiration: Preset = {
  name: "有効期限: Expires / Max-Age",
  description: "セッションCookie vs 永続Cookie。Max-AgeがExpiresより優先。時間経過で失効。",
  build: () => [
    {
      type: "set_cookie",
      response: mkResponse("https://shop.example.com/", [
        "session=temp123; Path=/",                    // セッションCookie
        "pref=lang_ja; Path=/; Max-Age=3600",         // 1時間
        "remember=token456; Path=/; Max-Age=10",      // 10秒（すぐ失効）
        `tracking=xyz; Path=/; Expires=${new Date(Date.now() + 7 * 86400_000).toUTCString()}`, // 7日
      ]),
      request: mkRequest("https://shop.example.com/"),
    },
    {
      type: "send_request",
      request: mkRequest("https://shop.example.com/cart"),
    },
    { type: "advance_time", seconds: 15 }, // 15秒経過 → rememberが失効
    {
      type: "send_request",
      request: mkRequest("https://shop.example.com/cart"),
    },
  ],
};

/** 3. Domain / Path スコープ */
const scope: Preset = {
  name: "スコープ: Domain / Path",
  description: "Domain属性でサブドメインへの送信を制御。Path属性でパス単位の制限。",
  build: () => [
    {
      type: "set_cookie",
      response: mkResponse("https://www.example.com/app", [
        "global=1; Domain=example.com; Path=/",         // サブドメイン含む全パス
        "app_only=2; Path=/app",                         // /app 以下のみ
        "root_only=3; Path=/",                           // ルートのみ
      ]),
      request: mkRequest("https://www.example.com/app"),
    },
    // www.example.com/app → 3つ全て送信
    {
      type: "send_request",
      request: mkRequest("https://www.example.com/app/page"),
    },
    // www.example.com/ → global, root_only のみ
    {
      type: "send_request",
      request: mkRequest("https://www.example.com/"),
    },
    // api.example.com/ → global のみ (Domain=example.com)
    {
      type: "send_request",
      request: mkRequest("https://api.example.com/data"),
    },
  ],
};

/** 4. SameSite属性 */
const sameSite: Preset = {
  name: "SameSite: Strict / Lax / None",
  description: "クロスサイトリクエスト時のCookie送信制御。Strict=完全ブロック、Lax=トップレベルGETのみ、None=常に送信(Secure必須)。",
  build: () => [
    {
      type: "set_cookie",
      response: mkResponse("https://bank.example.com/", [
        "csrf=token1; Path=/; SameSite=Strict; Secure",
        "session=sid1; Path=/; SameSite=Lax; Secure",
        "analytics=track1; Path=/; SameSite=None; Secure",
      ]),
      request: mkRequest("https://bank.example.com/"),
    },
    // 同一サイトリクエスト → 全て送信
    {
      type: "send_request",
      request: mkRequest("https://bank.example.com/account"),
    },
    // クロスサイト トップレベルGET → Lax + None
    {
      type: "navigate",
      url: "https://bank.example.com/dashboard",
      from: "https://evil.example.org/",
    },
    {
      type: "send_request",
      request: mkRequest("https://bank.example.com/dashboard", {
        crossSite: true,
        referer: "https://evil.example.org/",
        navigationType: "top_level",
        method: "GET",
      }),
    },
    // クロスサイト POST (CSRF攻撃) → None のみ
    {
      type: "send_request",
      request: mkRequest("https://bank.example.com/transfer", {
        crossSite: true,
        method: "POST",
        navigationType: "top_level",
      }),
    },
    // クロスサイト サブリソース（img等） → None のみ
    {
      type: "send_request",
      request: mkRequest("https://bank.example.com/pixel.gif", {
        crossSite: true,
        navigationType: "subresource",
      }),
    },
  ],
};

/** 5. Secure / HttpOnly */
const secureHttpOnly: Preset = {
  name: "Secure / HttpOnly 属性",
  description: "Secure: HTTPSのみ送信。HttpOnly: JavaScriptからアクセス不可。",
  build: () => [
    {
      type: "set_cookie",
      response: mkResponse("https://secure.example.com/", [
        "token=secret; Path=/; Secure; HttpOnly",
        "pref=value; Path=/",
      ]),
      request: mkRequest("https://secure.example.com/"),
    },
    // HTTPS → 両方送信
    {
      type: "send_request",
      request: mkRequest("https://secure.example.com/api"),
    },
    // HTTP → Secureなしのみ
    {
      type: "send_request",
      request: mkRequest("http://secure.example.com/api", { scheme: "http" }),
    },
    // HTTPでSecure Cookie設定を試みる → 拒否
    {
      type: "set_cookie",
      response: mkResponse("http://insecure.example.com/", [
        "hack=bad; Path=/; Secure",
      ]),
      request: mkRequest("http://insecure.example.com/", { scheme: "http" }),
    },
  ],
};

/** 6. Cookieプレフィックス (__Secure- / __Host-) */
const prefixes: Preset = {
  name: "Cookieプレフィックス",
  description: "__Secure-: Secure必須。__Host-: Secure必須、Domain指定不可、Path=/必須。",
  build: () => [
    // 正しい __Secure- Cookie
    {
      type: "set_cookie",
      response: mkResponse("https://app.example.com/", [
        "__Secure-token=abc; Path=/; Secure",
      ]),
      request: mkRequest("https://app.example.com/"),
    },
    // 不正な __Secure- Cookie（Secureなし）
    {
      type: "set_cookie",
      response: mkResponse("https://app.example.com/", [
        "__Secure-bad=xyz; Path=/",
      ]),
      request: mkRequest("https://app.example.com/"),
    },
    // 正しい __Host- Cookie
    {
      type: "set_cookie",
      response: mkResponse("https://app.example.com/", [
        "__Host-session=def; Path=/; Secure",
      ]),
      request: mkRequest("https://app.example.com/"),
    },
    // 不正な __Host- Cookie（Path≠/）
    {
      type: "set_cookie",
      response: mkResponse("https://app.example.com/", [
        "__Host-bad=ghi; Path=/admin; Secure",
      ]),
      request: mkRequest("https://app.example.com/"),
    },
    {
      type: "send_request",
      request: mkRequest("https://app.example.com/"),
    },
  ],
};

/** 7. サードパーティCookieブロック */
const thirdPartyBlock: Preset = {
  name: "サードパーティCookieブロック",
  description: "ブラウザのサードパーティCookieブロック機能。クロスサイトトラッキング防止。",
  build: () => [
    // ファーストパーティCookie設定
    {
      type: "set_cookie",
      response: mkResponse("https://news.example.com/", [
        "session=first1; Path=/; SameSite=Lax",
      ]),
      request: mkRequest("https://news.example.com/"),
    },
    // サードパーティCookie設定（広告ネットワーク）
    {
      type: "set_cookie",
      response: mkResponse("https://ads.tracker.com/pixel", [
        "uid=track123; Path=/; SameSite=None; Secure",
      ]),
      request: mkRequest("https://ads.tracker.com/pixel", {
        crossSite: true,
        origin: "https://news.example.com",
        navigationType: "subresource",
      }),
    },
    // サードパーティブロック有効化
    { type: "toggle_third_party_block", enabled: true },
    // 同じサードパーティCookieを再設定 → ブロック
    {
      type: "set_cookie",
      response: mkResponse("https://ads.tracker.com/pixel", [
        "uid2=track456; Path=/; SameSite=None; Secure",
      ]),
      request: mkRequest("https://ads.tracker.com/pixel", {
        crossSite: true,
        origin: "https://news.example.com",
        navigationType: "subresource",
      }),
    },
    // ファーストパーティは影響なし
    {
      type: "send_request",
      request: mkRequest("https://news.example.com/article"),
    },
  ],
};

/** 8. CHIPS (Partitioned Cookie) */
const chips: Preset = {
  name: "CHIPS: パーティション分離",
  description: "Partitioned属性でCookieをトップレベルサイトごとに分離。サードパーティ追跡を防止しつつ機能を維持。",
  build: () => [
    { type: "toggle_partition", enabled: true },
    // サイトA埋め込みのウィジェットがCookie設定
    {
      type: "set_cookie",
      response: mkResponse("https://widget.example.com/chat", [
        "chat_session=s1; Path=/; SameSite=None; Secure; Partitioned",
      ]),
      request: mkRequest("https://widget.example.com/chat", {
        crossSite: true,
        origin: "https://siteA.example.com",
        navigationType: "iframe",
      }),
    },
    // サイトB埋め込みの同じウィジェット → 別パーティション
    {
      type: "set_cookie",
      response: mkResponse("https://widget.example.com/chat", [
        "chat_session=s2; Path=/; SameSite=None; Secure; Partitioned",
      ]),
      request: mkRequest("https://widget.example.com/chat", {
        crossSite: true,
        origin: "https://siteB.example.com",
        navigationType: "iframe",
      }),
    },
    // サイトAからのリクエスト → s1のみ
    {
      type: "send_request",
      request: mkRequest("https://widget.example.com/chat/api", {
        crossSite: true,
        origin: "https://siteA.example.com",
        navigationType: "iframe",
      }),
    },
  ],
};

/** 9. Cookie削除（Max-Age=0） */
const deletion: Preset = {
  name: "Cookie削除: Max-Age=0",
  description: "Max-Age=0またはExpires=過去日でCookieを削除。サーバー側からのログアウト処理。",
  build: () => [
    {
      type: "set_cookie",
      response: mkResponse("https://app.example.com/", [
        "session=active; Path=/; Secure; HttpOnly",
        "user=alice; Path=/",
        "pref=dark; Path=/; Max-Age=86400",
      ]),
      request: mkRequest("https://app.example.com/"),
    },
    {
      type: "send_request",
      request: mkRequest("https://app.example.com/profile"),
    },
    // ログアウト → Max-Age=0 で削除
    {
      type: "set_cookie",
      response: mkResponse("https://app.example.com/logout", [
        "session=; Path=/; Max-Age=0; Secure; HttpOnly",
        "user=; Path=/; Max-Age=0",
      ]),
      request: mkRequest("https://app.example.com/logout"),
    },
    {
      type: "send_request",
      request: mkRequest("https://app.example.com/"),
    },
  ],
};

/** 10. 総合: 認証フロー */
const authFlow: Preset = {
  name: "総合: OAuth認証フロー",
  description: "ログイン → セッション確立 → CSRF保護 → API呼び出し → ログアウト の一連の流れ。",
  build: () => [
    // 1. ログインページ（CSRFトークン設定）
    {
      type: "set_cookie",
      response: mkResponse("https://auth.example.com/login", [
        "csrf_token=rand123; Path=/; SameSite=Strict; Secure",
      ]),
      request: mkRequest("https://auth.example.com/login"),
    },
    // 2. 認証成功 → セッションCookie + Remember-Me
    {
      type: "set_cookie",
      response: mkResponse("https://auth.example.com/callback", [
        "__Host-session=encrypted_jwt_token; Path=/; Secure; HttpOnly; SameSite=Lax",
        "remember_me=long_token; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=2592000",
        "user_pref=theme_dark; Path=/; SameSite=Lax; Max-Age=31536000",
      ]),
      request: mkRequest("https://auth.example.com/callback"),
    },
    // 3. APIリクエスト（同一サイト）
    {
      type: "send_request",
      request: mkRequest("https://auth.example.com/api/me", {
        navigationType: "fetch",
      }),
    },
    // 4. クロスサイトからのリクエスト（SameSite検証）
    {
      type: "send_request",
      request: mkRequest("https://auth.example.com/api/data", {
        crossSite: true,
        navigationType: "fetch",
        method: "GET",
      }),
    },
    // 5. ログアウト
    {
      type: "set_cookie",
      response: mkResponse("https://auth.example.com/logout", [
        "__Host-session=; Path=/; Max-Age=0; Secure; HttpOnly",
        "remember_me=; Path=/; Max-Age=0; Secure; HttpOnly",
        "csrf_token=; Path=/; Max-Age=0; Secure",
      ]),
      request: mkRequest("https://auth.example.com/logout"),
    },
    {
      type: "send_request",
      request: mkRequest("https://auth.example.com/"),
    },
  ],
};

export const PRESETS: Preset[] = [
  basic,
  expiration,
  scope,
  sameSite,
  secureHttpOnly,
  prefixes,
  thirdPartyBlock,
  chips,
  deletion,
  authFlow,
];
