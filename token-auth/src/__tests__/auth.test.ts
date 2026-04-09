import { describe, it, expect } from "vitest";
import { createJwt, verifyJwt, decodeJwt, base64urlEncode, base64urlDecode, hmacSha256, simulateOAuth2 } from "../engine/auth.js";
import { EXAMPLES } from "../ui/app.js";

const SECRET = "test-secret";
const now = Math.floor(Date.now() / 1000);

describe("base64url", () => {
  it("エンコード → デコードが可逆", () => {
    const original = '{"alg":"HS256","typ":"JWT"}';
    expect(base64urlDecode(base64urlEncode(original))).toBe(original);
  });
  it("+ / = を含まない", () => {
    const encoded = base64urlEncode("test string with special chars!!!");
    expect(encoded).not.toContain("+");
    expect(encoded).not.toContain("/");
    expect(encoded).not.toContain("=");
  });
});

describe("hmacSha256", () => {
  it("同一入力で同一ハッシュ", () => {
    expect(hmacSha256("msg", "key")).toBe(hmacSha256("msg", "key"));
  });
  it("異なる秘密鍵で異なるハッシュ", () => {
    expect(hmacSha256("msg", "key1")).not.toBe(hmacSha256("msg", "key2"));
  });
  it("異なるメッセージで異なるハッシュ", () => {
    expect(hmacSha256("msg1", "key")).not.toBe(hmacSha256("msg2", "key"));
  });
});

describe("createJwt", () => {
  it("3 部分のトークンを生成する", () => {
    const jwt = createJwt({ sub: "user", exp: now + 3600, iat: now }, SECRET);
    expect(jwt.raw.split(".")).toHaveLength(3);
  });
  it("Header に alg と typ を含む", () => {
    const jwt = createJwt({ sub: "user", exp: now + 3600, iat: now }, SECRET);
    expect(jwt.header.alg).toBe("HS256");
    expect(jwt.header.typ).toBe("JWT");
  });
  it("Payload のクレームが保持される", () => {
    const jwt = createJwt({ sub: "alice", exp: now + 3600, iat: now, roles: ["admin"] }, SECRET);
    expect(jwt.payload.sub).toBe("alice");
    expect(jwt.payload.roles).toEqual(["admin"]);
  });
});

describe("decodeJwt", () => {
  it("有効なトークンをデコードする", () => {
    const jwt = createJwt({ sub: "user", exp: now + 3600, iat: now }, SECRET);
    const decoded = decodeJwt(jwt.raw);
    expect(decoded).not.toBeNull();
    expect(decoded!.payload.sub).toBe("user");
  });
  it("不正な形式は null", () => {
    expect(decodeJwt("not-a-jwt")).toBeNull();
    expect(decodeJwt("a.b")).toBeNull();
  });
});

describe("verifyJwt", () => {
  it("正しい秘密鍵で検証成功", () => {
    const jwt = createJwt({ sub: "user", exp: now + 3600, iat: now }, SECRET);
    const result = verifyJwt(jwt.raw, SECRET);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("間違った秘密鍵で署名不一致", () => {
    const jwt = createJwt({ sub: "user", exp: now + 3600, iat: now }, SECRET);
    const result = verifyJwt(jwt.raw, "wrong-key");
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Signature verification failed");
  });

  it("期限切れトークンを拒否する", () => {
    const jwt = createJwt({ sub: "user", exp: now - 100, iat: now - 3700 }, SECRET);
    const result = verifyJwt(jwt.raw, SECRET);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Token expired");
  });

  it("issuer 不一致を検出する", () => {
    const jwt = createJwt({ sub: "user", iss: "bad-issuer", exp: now + 3600, iat: now }, SECRET);
    const result = verifyJwt(jwt.raw, SECRET, { issuer: "good-issuer" });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Issuer mismatch");
  });

  it("audience 不一致を検出する", () => {
    const jwt = createJwt({ sub: "user", aud: "other-app", exp: now + 3600, iat: now }, SECRET);
    const result = verifyJwt(jwt.raw, SECRET, { audience: "my-app" });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Audience mismatch");
  });

  it("改ざんされたペイロードを検出する", () => {
    const jwt = createJwt({ sub: "user", exp: now + 3600, iat: now, roles: ["user"] }, SECRET);
    const parts = jwt.raw.split(".");
    const tampered = btoa(JSON.stringify({ sub: "user", exp: now + 3600, iat: now, roles: ["admin"] })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const tamperedToken = parts[0] + "." + tampered + "." + parts[2];
    const result = verifyJwt(tamperedToken, SECRET);
    expect(result.valid).toBe(false);
  });

  it("検証チェック一覧が返される", () => {
    const jwt = createJwt({ sub: "user", exp: now + 3600, iat: now }, SECRET);
    const result = verifyJwt(jwt.raw, SECRET);
    expect(result.checks.length).toBeGreaterThanOrEqual(3);
    expect(result.checks.every((c) => c.name.length > 0)).toBe(true);
  });
});

describe("simulateOAuth2", () => {
  it("アクセストークンとリフレッシュトークンを発行する", () => {
    const result = simulateOAuth2(
      { authorizationEndpoint: "https://auth.example.com/authorize", tokenEndpoint: "https://auth.example.com/token", clientId: "app", clientSecret: "secret", redirectUri: "https://app.com/cb", scopes: ["profile"] },
      { username: "alice", password: "pass" },
      SECRET,
    );
    expect(result.accessToken.raw.split(".")).toHaveLength(3);
    expect(result.refreshToken).toMatch(/^refresh_/);
    expect(result.trace.length).toBeGreaterThan(0);
  });

  it("トレースに全フェーズが含まれる", () => {
    const result = simulateOAuth2(
      { authorizationEndpoint: "a", tokenEndpoint: "t", clientId: "c", clientSecret: "s", redirectUri: "r", scopes: [] },
      { username: "u", password: "p" },
      SECRET,
    );
    const phases = result.trace.map((t) => t.phase);
    expect(phases).toContain("redirect");
    expect(phases).toContain("auth_code");
    expect(phases).toContain("token_request");
    expect(phases).toContain("token_response");
    expect(phases).toContain("access");
  });
});

describe("EXAMPLES", () => {
  it("8 つのサンプル", () => { expect(EXAMPLES).toHaveLength(8); });
  it("名前が一意", () => { expect(new Set(EXAMPLES.map((e) => e.name)).size).toBe(EXAMPLES.length); });
  for (const ex of EXAMPLES) {
    it(`${ex.name}: 実行可能`, () => {
      const result = ex.run();
      expect(result.jwt !== undefined || result.oauthTrace !== undefined || result.verification !== undefined).toBe(true);
    });
  }
});
