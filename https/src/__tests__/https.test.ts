import { describe, it, expect } from "vitest";
import {
  randomHex, simpleHash, prf, xorEncrypt, xorDecrypt, hmac,
  simulateECDHE, simulateDHE, hexDump,
  negotiateCipherSuite, verifyCertChain,
  HttpsSimulator, createValidCertChain, createInvalidCertChain,
  CIPHER_SUITES,
} from "../engine/https.js";
import { EXPERIMENTS } from "../ui/app.js";
import type { HttpsConfig } from "../engine/https.js";

// ── 暗号ユーティリティ ──

describe("randomHex", () => {
  it("指定バイト数の hex 文字列を生成する", () => {
    const hex = randomHex(16);
    expect(hex).toHaveLength(32);
    expect(hex).toMatch(/^[0-9a-f]+$/);
  });

  it("異なる呼び出しで異なる値を返す", () => {
    const a = randomHex(32);
    const b = randomHex(32);
    expect(a).not.toBe(b);
  });
});

describe("simpleHash", () => {
  it("同じ入力に対して同じハッシュを返す", () => {
    expect(simpleHash("hello")).toBe(simpleHash("hello"));
  });

  it("異なる入力に対して異なるハッシュを返す", () => {
    expect(simpleHash("hello")).not.toBe(simpleHash("world"));
  });

  it("64文字の hex 文字列を返す", () => {
    const h = simpleHash("test");
    expect(h).toHaveLength(64);
    expect(h).toMatch(/^[0-9a-f]+$/);
  });
});

describe("prf", () => {
  it("指定長の出力を返す", () => {
    const result = prf("secret", "label", "seed", 48);
    expect(result).toHaveLength(96);
  });

  it("同じ入力で同じ出力", () => {
    const a = prf("secret", "label", "seed", 32);
    const b = prf("secret", "label", "seed", 32);
    expect(a).toBe(b);
  });
});

describe("xorEncrypt / xorDecrypt", () => {
  it("暗号化して復号すると元に戻る", () => {
    const key = randomHex(32);
    const plaintext = "Hello, TLS!";
    const encrypted = xorEncrypt(plaintext, key);
    const decrypted = xorDecrypt(encrypted, key);
    expect(decrypted).toBe(plaintext);
  });

  it("異なる鍵では復号できない", () => {
    const key1 = "aabbccddee";
    const key2 = "1122334455";
    const plaintext = "Secret data";
    const encrypted = xorEncrypt(plaintext, key1);
    const decrypted = xorDecrypt(encrypted, key2);
    expect(decrypted).not.toBe(plaintext);
  });
});

describe("hmac", () => {
  it("同じ入力で同じ出力", () => {
    expect(hmac("key", "data")).toBe(hmac("key", "data"));
  });

  it("異なるキーで異なる出力", () => {
    expect(hmac("key1", "data")).not.toBe(hmac("key2", "data"));
  });
});

describe("simulateECDHE", () => {
  it("鍵ペアと共有秘密を生成する", () => {
    const result = simulateECDHE();
    expect(result.clientPrivate).toBeDefined();
    expect(result.clientPublic).toBeDefined();
    expect(result.serverPrivate).toBeDefined();
    expect(result.serverPublic).toBeDefined();
    expect(result.sharedSecret).toBeDefined();
    expect(result.sharedSecret.length).toBeGreaterThan(0);
  });
});

describe("simulateDHE", () => {
  it("DH パラメータと共有秘密を生成する", () => {
    const result = simulateDHE();
    expect(result.p).toBeDefined();
    expect(result.g).toBe("02");
    expect(result.clientPublic).toBeDefined();
    expect(result.serverPublic).toBeDefined();
    expect(result.sharedSecret).toBeDefined();
  });
});

describe("hexDump", () => {
  it("hex ダンプ文字列を生成する", () => {
    const dump = hexDump("Hello");
    expect(dump).toContain("0000");
    expect(dump).toContain("48 65 6c 6c 6f");
    expect(dump).toContain("|Hello|");
  });

  it("長い入力を切り詰める", () => {
    const longStr = "A".repeat(100);
    const dump = hexDump(longStr, 16);
    expect(dump).toContain("... (84 more bytes)");
  });
});

// ── 暗号スイートネゴシエーション ──

describe("negotiateCipherSuite", () => {
  it("TLS 1.3 で TLS 1.3 専用スイートを選択する", () => {
    const result = negotiateCipherSuite(["TLS_AES_128_GCM_SHA256"], "TLS1.3");
    expect(result).toBeDefined();
    expect(result!.name).toBe("TLS_AES_128_GCM_SHA256");
  });

  it("TLS 1.2 で TLS 1.3 専用スイートは選択されない", () => {
    const result = negotiateCipherSuite(["TLS_AES_128_GCM_SHA256"], "TLS1.2");
    expect(result).toBeUndefined();
  });

  it("TLS 1.2 で ECDHE スイートを選択する", () => {
    const result = negotiateCipherSuite(["TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256"], "TLS1.2");
    expect(result).toBeDefined();
    expect(result!.keyExchange).toBe("ECDHE");
  });

  it("未知のスイート名では undefined", () => {
    const result = negotiateCipherSuite(["UNKNOWN_SUITE"], "TLS1.2");
    expect(result).toBeUndefined();
  });

  it("クライアント優先順位で最初に一致したものを返す", () => {
    const result = negotiateCipherSuite([
      "TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384",
      "TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256",
    ], "TLS1.2");
    expect(result!.name).toBe("TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384");
  });
});

// ── 証明書チェーン検証 ──

describe("verifyCertChain", () => {
  it("有効なチェーンを検証する", () => {
    const chain = createValidCertChain("example.com");
    const result = verifyCertChain(chain);
    expect(result.valid).toBe(true);
    expect(result.steps.length).toBeGreaterThan(0);
  });

  it("空のチェーンはエラー", () => {
    const result = verifyCertChain([]);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("空");
  });

  it("発行者不一致のチェーンはエラー", () => {
    const chain = createInvalidCertChain();
    const result = verifyCertChain(chain);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("不一致");
  });

  it("検証ステップがログされる", () => {
    const chain = createValidCertChain("test.com");
    const result = verifyCertChain(chain);
    expect(result.steps.some((s) => s.includes("✓"))).toBe(true);
  });
});

// ── HTTPS シミュレーター ──

describe("HttpsSimulator", () => {
  const defaultReq = { method: "GET", path: "/", headers: { "Host": "example.com" } };
  const defaultRes = { statusCode: 200, statusText: "OK", headers: { "Content-Type": "text/html" }, body: "<h1>OK</h1>" };
  const defaultNet = { rttMs: 50, packetLossRate: 0, bandwidthMbps: 100 };

  it("TLS 1.3 フルハンドシェイクが成功する", () => {
    const sim = new HttpsSimulator();
    const result = sim.simulate({
      tlsVersion: "TLS1.3",
      clientCipherSuites: ["TLS_AES_128_GCM_SHA256"],
      serverCertChain: createValidCertChain("example.com"),
      sessionResumption: false,
      httpRequest: defaultReq,
      httpResponse: defaultRes,
      network: defaultNet,
      forceCertError: false,
    });
    expect(result.success).toBe(true);
    expect(result.session).not.toBeNull();
    expect(result.events.length).toBeGreaterThan(10);
    expect(result.handshakeTime).toBeGreaterThan(0);
    expect(result.roundTrips).toBeGreaterThan(0);
  });

  it("TLS 1.2 ECDHE ハンドシェイクが成功する", () => {
    const sim = new HttpsSimulator();
    const result = sim.simulate({
      tlsVersion: "TLS1.2",
      clientCipherSuites: ["TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256"],
      serverCertChain: createValidCertChain("example.com"),
      sessionResumption: false,
      httpRequest: defaultReq,
      httpResponse: defaultRes,
      network: defaultNet,
      forceCertError: false,
    });
    expect(result.success).toBe(true);
    expect(result.session!.cipherSuite.keyExchange).toBe("ECDHE");
  });

  it("RSA 鍵交換が成功する", () => {
    const sim = new HttpsSimulator();
    const result = sim.simulate({
      tlsVersion: "TLS1.2",
      clientCipherSuites: ["TLS_RSA_WITH_AES_128_GCM_SHA256"],
      serverCertChain: createValidCertChain("example.com"),
      sessionResumption: false,
      httpRequest: defaultReq,
      httpResponse: defaultRes,
      network: defaultNet,
      forceCertError: false,
    });
    expect(result.success).toBe(true);
    expect(result.session!.cipherSuite.keyExchange).toBe("RSA");
  });

  it("DHE 鍵交換が成功する", () => {
    const sim = new HttpsSimulator();
    const result = sim.simulate({
      tlsVersion: "TLS1.2",
      clientCipherSuites: ["TLS_DHE_RSA_WITH_AES_128_CBC_SHA256"],
      serverCertChain: createValidCertChain("example.com"),
      sessionResumption: false,
      httpRequest: defaultReq,
      httpResponse: defaultRes,
      network: defaultNet,
      forceCertError: false,
    });
    expect(result.success).toBe(true);
    expect(result.session!.cipherSuite.keyExchange).toBe("DHE");
  });

  it("暗号スイート不一致でハンドシェイク失敗", () => {
    const sim = new HttpsSimulator();
    const result = sim.simulate({
      tlsVersion: "TLS1.2",
      clientCipherSuites: ["TLS_AES_128_GCM_SHA256"],
      serverCertChain: createValidCertChain("example.com"),
      sessionResumption: false,
      httpRequest: defaultReq,
      httpResponse: defaultRes,
      network: defaultNet,
      forceCertError: false,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("ネゴシエーション");
  });

  it("証明書エラーでハンドシェイク失敗", () => {
    const sim = new HttpsSimulator();
    const result = sim.simulate({
      tlsVersion: "TLS1.2",
      clientCipherSuites: ["TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256"],
      serverCertChain: createValidCertChain("example.com"),
      sessionResumption: false,
      httpRequest: defaultReq,
      httpResponse: defaultRes,
      network: defaultNet,
      forceCertError: true,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("証明書");
  });

  it("不正な証明書チェーンでハンドシェイク失敗", () => {
    const sim = new HttpsSimulator();
    const result = sim.simulate({
      tlsVersion: "TLS1.2",
      clientCipherSuites: ["TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256"],
      serverCertChain: createInvalidCertChain(),
      sessionResumption: false,
      httpRequest: defaultReq,
      httpResponse: defaultRes,
      network: defaultNet,
      forceCertError: false,
    });
    expect(result.success).toBe(false);
  });

  it("セッション再開が成功する", () => {
    const sim = new HttpsSimulator();
    // まずフルハンドシェイク
    const full = sim.simulate({
      tlsVersion: "TLS1.2",
      clientCipherSuites: ["TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256"],
      serverCertChain: createValidCertChain("example.com"),
      sessionResumption: false,
      httpRequest: defaultReq,
      httpResponse: defaultRes,
      network: defaultNet,
      forceCertError: false,
    });
    expect(full.success).toBe(true);

    // セッション再開
    const resumed = sim.simulate({
      tlsVersion: "TLS1.2",
      clientCipherSuites: ["TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256"],
      serverCertChain: createValidCertChain("example.com"),
      sessionResumption: true,
      previousSession: full.session!,
      httpRequest: defaultReq,
      httpResponse: defaultRes,
      network: defaultNet,
      forceCertError: false,
    });
    expect(resumed.success).toBe(true);
    // セッション再開はイベント数が少ない
    expect(resumed.events.length).toBeLessThan(full.events.length);
  });

  it("高レイテンシ環境でハンドシェイク時間が長い", () => {
    const sim = new HttpsSimulator();
    const lowLat = sim.simulate({
      tlsVersion: "TLS1.2",
      clientCipherSuites: ["TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256"],
      serverCertChain: createValidCertChain("example.com"),
      sessionResumption: false,
      httpRequest: defaultReq,
      httpResponse: defaultRes,
      network: { rttMs: 10, packetLossRate: 0, bandwidthMbps: 100 },
      forceCertError: false,
    });
    const highLat = sim.simulate({
      tlsVersion: "TLS1.2",
      clientCipherSuites: ["TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256"],
      serverCertChain: createValidCertChain("example.com"),
      sessionResumption: false,
      httpRequest: defaultReq,
      httpResponse: defaultRes,
      network: { rttMs: 600, packetLossRate: 0, bandwidthMbps: 100 },
      forceCertError: false,
    });
    expect(highLat.handshakeTime).toBeGreaterThan(lowLat.handshakeTime);
  });

  it("暗号化された HTTP データがある", () => {
    const sim = new HttpsSimulator();
    const result = sim.simulate({
      tlsVersion: "TLS1.3",
      clientCipherSuites: ["TLS_AES_128_GCM_SHA256"],
      serverCertChain: createValidCertChain("example.com"),
      sessionResumption: false,
      httpRequest: defaultReq,
      httpResponse: defaultRes,
      network: defaultNet,
      forceCertError: false,
    });
    expect(result.encryptedRequest).toBeDefined();
    expect(result.encryptedResponse).toBeDefined();
    expect(result.encryptedRequest!.length).toBeGreaterThan(0);
  });
});

// ── データ生成ヘルパー ──

describe("createValidCertChain", () => {
  it("3 つの証明書を含むチェーンを生成する", () => {
    const chain = createValidCertChain("test.com");
    expect(chain).toHaveLength(3);
    expect(chain[0]!.subject).toBe("test.com");
    expect(chain[1]!.subject).toBe("Intermediate CA");
    expect(chain[2]!.subject).toBe("Root CA");
  });

  it("ルート証明書が自己署名", () => {
    const chain = createValidCertChain("test.com");
    expect(chain[2]!.selfSigned).toBe(true);
    expect(chain[2]!.isCA).toBe(true);
  });
});

describe("createInvalidCertChain", () => {
  it("発行者が不一致のチェーンを生成する", () => {
    const chain = createInvalidCertChain();
    expect(chain[0]!.issuer).not.toBe(chain[1]!.subject);
  });
});

describe("CIPHER_SUITES", () => {
  it("8 つのスイートが定義されている", () => {
    expect(CIPHER_SUITES).toHaveLength(8);
  });

  it("TLS 1.3 専用スイートが含まれる", () => {
    expect(CIPHER_SUITES.some((s) => s.tls13Only)).toBe(true);
  });

  it("名前が一意", () => {
    const names = new Set(CIPHER_SUITES.map((s) => s.name));
    expect(names.size).toBe(CIPHER_SUITES.length);
  });
});

// ── プリセット実験 ──

describe("EXPERIMENTS", () => {
  it("9 つのプリセット", () => {
    expect(EXPERIMENTS).toHaveLength(9);
  });

  it("名前が一意", () => {
    expect(new Set(EXPERIMENTS.map((e) => e.name)).size).toBe(EXPERIMENTS.length);
  });

  for (const exp of EXPERIMENTS) {
    it(`${exp.name}: シミュレーション可能`, () => {
      const sim = new HttpsSimulator();
      const result = sim.simulate(exp.config);
      expect(result.events.length).toBeGreaterThan(0);
      // 成功・失敗どちらでもイベントが記録される
      expect(result.totalTime).toBeGreaterThanOrEqual(0);
    });
  }
});
