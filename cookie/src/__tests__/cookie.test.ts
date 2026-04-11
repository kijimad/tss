/* Cookie シミュレーター テスト */

import { describe, it, expect } from "vitest";
import {
  simulate, parseSetCookie, mkRequest, mkResponse,
  extractDomain, extractPath, extractOrigin,
  domainMatches, pathMatches, isSameSite,
} from "../cookie/engine.js";
import { PRESETS } from "../cookie/presets.js";

const NOW = Date.now();

// ─── ユーティリティ ───

describe("ユーティリティ", () => {
  it("URLからドメインを抽出", () => {
    expect(extractDomain("https://www.example.com/path")).toBe("www.example.com");
    expect(extractDomain("http://api.test.co.jp:8080/")).toBe("api.test.co.jp");
  });

  it("URLからパスを抽出", () => {
    expect(extractPath("https://example.com/app/page")).toBe("/app/page");
    expect(extractPath("https://example.com")).toBe("/");
  });

  it("URLからオリジンを抽出", () => {
    expect(extractOrigin("https://example.com/path?q=1")).toBe("https://example.com");
  });

  it("ドメインマッチング", () => {
    expect(domainMatches("example.com", "example.com")).toBe(true);
    expect(domainMatches("example.com", "www.example.com")).toBe(true);
    expect(domainMatches(".example.com", "sub.example.com")).toBe(true);
    expect(domainMatches("other.com", "example.com")).toBe(false);
  });

  it("パスマッチング", () => {
    expect(pathMatches("/", "/anything")).toBe(true);
    expect(pathMatches("/app", "/app/page")).toBe(true);
    expect(pathMatches("/app", "/application")).toBe(false);
    expect(pathMatches("/app/", "/app/page")).toBe(true);
  });

  it("同一サイト判定", () => {
    expect(isSameSite("https://www.example.com", "https://api.example.com")).toBe(true);
    expect(isSameSite("https://example.com", "https://other.com")).toBe(false);
  });
});

// ─── Set-Cookieパース ───

describe("Set-Cookieパース", () => {
  it("基本的なCookieをパース", () => {
    const d = parseSetCookie("session=abc123; Path=/; HttpOnly", "https://example.com/", NOW);
    expect(d.cookie.name).toBe("session");
    expect(d.cookie.value).toBe("abc123");
    expect(d.cookie.path).toBe("/");
    expect(d.cookie.httpOnly).toBe(true);
    expect(d.errors).toHaveLength(0);
  });

  it("Secure, SameSite属性をパース", () => {
    const d = parseSetCookie(
      "token=xyz; Path=/; Secure; SameSite=Strict",
      "https://example.com/", NOW,
    );
    expect(d.cookie.secure).toBe(true);
    expect(d.cookie.sameSite).toBe("strict");
  });

  it("Max-Ageをパース", () => {
    const d = parseSetCookie("pref=dark; Max-Age=3600", "https://example.com/", NOW);
    expect(d.cookie.maxAge).toBe(3600);
    expect(d.cookie.expires).toBe(NOW + 3600 * 1000);
  });

  it("Domain属性をパース", () => {
    const d = parseSetCookie(
      "g=1; Domain=example.com; Path=/",
      "https://www.example.com/", NOW,
    );
    expect(d.cookie.domain).toBe("example.com");
    expect(d.errors).toHaveLength(0);
  });

  it("不正なDomainを拒否", () => {
    const d = parseSetCookie(
      "g=1; Domain=evil.com; Path=/",
      "https://example.com/", NOW,
    );
    expect(d.errors.length).toBeGreaterThan(0);
  });

  it("SameSite=None にSecureなしで警告", () => {
    const d = parseSetCookie(
      "t=1; SameSite=None; Path=/",
      "https://example.com/", NOW,
    );
    expect(d.warnings.length).toBeGreaterThan(0);
  });

  it("__Secure-プレフィックスにSecureなしでエラー", () => {
    const d = parseSetCookie(
      "__Secure-token=abc; Path=/",
      "https://example.com/", NOW,
    );
    expect(d.errors.some(e => e.includes("__Secure-"))).toBe(true);
  });

  it("__Host-プレフィックスの検証", () => {
    // 正しい
    const ok = parseSetCookie(
      "__Host-sid=abc; Path=/; Secure",
      "https://example.com/", NOW,
    );
    expect(ok.errors).toHaveLength(0);

    // Path≠/
    const badPath = parseSetCookie(
      "__Host-sid=abc; Path=/admin; Secure",
      "https://example.com/", NOW,
    );
    expect(badPath.errors.some(e => e.includes("Path=/"))).toBe(true);
  });

  it("Partitioned属性をパース", () => {
    const d = parseSetCookie(
      "chip=1; Path=/; Secure; SameSite=None; Partitioned",
      "https://widget.com/", NOW,
    );
    expect(d.cookie.partitioned).toBe(true);
  });
});

// ─── Cookie保存と送信 ───

describe("Cookie保存と送信", () => {
  it("Set-CookieでCookieが保存される", () => {
    const result = simulate([{
      type: "set_cookie",
      response: mkResponse("https://example.com/", ["sid=123; Path=/"]),
      request: mkRequest("https://example.com/"),
    }]);
    let count = 0;
    for (const [, cookies] of result.jar.cookies) count += cookies.length;
    expect(count).toBe(1);
  });

  it("保存したCookieがリクエストで送信される", () => {
    const result = simulate([
      {
        type: "set_cookie",
        response: mkResponse("https://example.com/", ["sid=123; Path=/"]),
        request: mkRequest("https://example.com/"),
      },
      {
        type: "send_request",
        request: mkRequest("https://example.com/page"),
      },
    ]);
    expect(result.requestLog[0]!.sentCookies.length).toBe(1);
    expect(result.requestLog[0]!.sentCookies[0]!.name).toBe("sid");
  });

  it("ドメイン不一致のCookieは送信されない", () => {
    const result = simulate([
      {
        type: "set_cookie",
        response: mkResponse("https://example.com/", ["sid=123; Path=/"]),
        request: mkRequest("https://example.com/"),
      },
      {
        type: "send_request",
        request: mkRequest("https://other.com/"),
      },
    ]);
    expect(result.requestLog[0]!.sentCookies.length).toBe(0);
  });

  it("パス不一致のCookieは送信されない", () => {
    const result = simulate([
      {
        type: "set_cookie",
        response: mkResponse("https://example.com/app", ["sid=123; Path=/app"]),
        request: mkRequest("https://example.com/app"),
      },
      {
        type: "send_request",
        request: mkRequest("https://example.com/other"),
      },
    ]);
    expect(result.requestLog[0]!.sentCookies.length).toBe(0);
  });
});

// ─── SameSite ───

describe("SameSite", () => {
  it("SameSite=Strict: クロスサイトで送信不可", () => {
    const result = simulate([
      {
        type: "set_cookie",
        response: mkResponse("https://bank.com/", ["csrf=t; Path=/; SameSite=Strict; Secure"]),
        request: mkRequest("https://bank.com/"),
      },
      {
        type: "send_request",
        request: mkRequest("https://bank.com/api", {
          crossSite: true,
          navigationType: "top_level",
        }),
      },
    ]);
    expect(result.requestLog[0]!.sentCookies.length).toBe(0);
    expect(result.requestLog[0]!.blockedCookies.length).toBe(1);
  });

  it("SameSite=Lax: クロスサイトトップレベルGETで送信可", () => {
    const result = simulate([
      {
        type: "set_cookie",
        response: mkResponse("https://site.com/", ["sid=1; Path=/; SameSite=Lax; Secure"]),
        request: mkRequest("https://site.com/"),
      },
      {
        type: "send_request",
        request: mkRequest("https://site.com/page", {
          crossSite: true,
          navigationType: "top_level",
          method: "GET",
        }),
      },
    ]);
    expect(result.requestLog[0]!.sentCookies.length).toBe(1);
  });

  it("SameSite=Lax: クロスサイトPOSTで送信不可", () => {
    const result = simulate([
      {
        type: "set_cookie",
        response: mkResponse("https://site.com/", ["sid=1; Path=/; SameSite=Lax; Secure"]),
        request: mkRequest("https://site.com/"),
      },
      {
        type: "send_request",
        request: mkRequest("https://site.com/api", {
          crossSite: true,
          navigationType: "top_level",
          method: "POST",
        }),
      },
    ]);
    expect(result.requestLog[0]!.blockedCookies.length).toBe(1);
  });

  it("SameSite=None + Secure: クロスサイトで送信可", () => {
    const result = simulate([
      {
        type: "set_cookie",
        response: mkResponse("https://track.com/", ["uid=1; Path=/; SameSite=None; Secure"]),
        request: mkRequest("https://track.com/"),
      },
      {
        type: "send_request",
        request: mkRequest("https://track.com/pixel", {
          crossSite: true,
          navigationType: "subresource",
        }),
      },
    ]);
    expect(result.requestLog[0]!.sentCookies.length).toBe(1);
  });
});

// ─── Secure属性 ───

describe("Secure属性", () => {
  it("Secure CookieはHTTPで送信されない", () => {
    const result = simulate([
      {
        type: "set_cookie",
        response: mkResponse("https://example.com/", ["token=x; Path=/; Secure"]),
        request: mkRequest("https://example.com/"),
      },
      {
        type: "send_request",
        request: mkRequest("http://example.com/", { scheme: "http" }),
      },
    ]);
    expect(result.requestLog[0]!.blockedCookies.length).toBe(1);
  });

  it("Secure CookieはHTTPで設定不可", () => {
    const result = simulate([{
      type: "set_cookie",
      response: mkResponse("http://example.com/", ["token=x; Path=/; Secure"]),
      request: mkRequest("http://example.com/", { scheme: "http" }),
    }]);
    const blockEvent = result.events.find(e => e.type === "secure_block");
    expect(blockEvent).toBeDefined();
  });
});

// ─── 有効期限 ───

describe("有効期限", () => {
  it("Max-Age=0でCookieが即座に失効", () => {
    const result = simulate([
      {
        type: "set_cookie",
        response: mkResponse("https://example.com/", ["sid=1; Path=/; Max-Age=3600"]),
        request: mkRequest("https://example.com/"),
      },
      {
        type: "set_cookie",
        response: mkResponse("https://example.com/", ["sid=; Path=/; Max-Age=0"]),
        request: mkRequest("https://example.com/"),
      },
      { type: "advance_time", seconds: 1 },
      {
        type: "send_request",
        request: mkRequest("https://example.com/"),
      },
    ]);
    expect(result.requestLog[0]!.sentCookies.length).toBe(0);
  });

  it("時間経過でCookieが失効する", () => {
    const result = simulate([
      {
        type: "set_cookie",
        response: mkResponse("https://example.com/", ["tmp=1; Path=/; Max-Age=10"]),
        request: mkRequest("https://example.com/"),
      },
      { type: "advance_time", seconds: 15 },
      {
        type: "send_request",
        request: mkRequest("https://example.com/"),
      },
    ]);
    const expireEvent = result.events.find(e => e.type === "cookie_expire");
    expect(expireEvent).toBeDefined();
    expect(result.requestLog[0]!.sentCookies.length).toBe(0);
  });
});

// ─── サードパーティブロック ───

describe("サードパーティCookieブロック", () => {
  it("ブロック有効時にクロスサイトCookie設定が拒否される", () => {
    const result = simulate([
      { type: "toggle_third_party_block", enabled: true },
      {
        type: "set_cookie",
        response: mkResponse("https://ads.tracker.com/", ["uid=1; Path=/; SameSite=None; Secure"]),
        request: mkRequest("https://ads.tracker.com/", {
          crossSite: true,
          origin: "https://news.example.com",
          navigationType: "subresource",
        }),
      },
    ]);
    const blockEvent = result.events.find(e => e.type === "cookie_block");
    expect(blockEvent).toBeDefined();
  });
});

// ─── Cookie削除 ───

describe("Cookie削除", () => {
  it("全Cookie削除", () => {
    const result = simulate([
      {
        type: "set_cookie",
        response: mkResponse("https://example.com/", ["a=1; Path=/", "b=2; Path=/"]),
        request: mkRequest("https://example.com/"),
      },
      { type: "clear_cookies" },
    ]);
    let count = 0;
    for (const [, cookies] of result.jar.cookies) count += cookies.length;
    expect(count).toBe(0);
  });
});

// ─── プリセット ───

describe("プリセット", () => {
  it("全プリセットがエラーなく実行できる", () => {
    for (const preset of PRESETS) {
      const ops = preset.build();
      const result = simulate(ops);
      expect(result.events.length).toBeGreaterThan(0);
    }
  });

  it("プリセット数が10個ある", () => {
    expect(PRESETS.length).toBe(10);
  });

  it("全プリセットに一意の名前がある", () => {
    const names = PRESETS.map(p => p.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
