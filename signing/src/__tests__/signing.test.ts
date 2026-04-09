import { describe, it, expect } from "vitest";
import {
  gcd, extGcd, modInverse, modPow, isPrime,
  simpleHash, SigningEngine,
} from "../engine/signing.js";

// ── 数学ユーティリティ ──

describe("gcd", () => {
  it("互いに素な数", () => expect(gcd(17, 13)).toBe(1));
  it("公約数を持つ数", () => expect(gcd(12, 8)).toBe(4));
  it("同一の数", () => expect(gcd(7, 7)).toBe(7));
  it("一方が 0", () => expect(gcd(5, 0)).toBe(5));
});

describe("extGcd", () => {
  it("ax + by = gcd(a,b) を満たす", () => {
    const { g, x, y } = extGcd(35, 15);
    expect(g).toBe(5);
    expect(35 * x + 15 * y).toBe(5);
  });
});

describe("modInverse", () => {
  it("逆元が存在する場合", () => {
    const inv = modInverse(3, 11);
    expect(inv).not.toBeNull();
    expect((3 * inv!) % 11).toBe(1);
  });
  it("逆元が存在しない場合", () => {
    expect(modInverse(2, 4)).toBeNull();
  });
});

describe("modPow", () => {
  it("2^10 mod 1000 = 24", () => expect(modPow(2, 10, 1000)).toBe(24));
  it("3^13 mod 7 = 3", () => expect(modPow(3, 13, 7)).toBe(3));
  it("指数 0 は 1 を返す", () => expect(modPow(5, 0, 13)).toBe(1));
});

describe("isPrime", () => {
  it("素数を判定", () => {
    expect(isPrime(2)).toBe(true);
    expect(isPrime(17)).toBe(true);
    expect(isPrime(97)).toBe(true);
  });
  it("合成数を判定", () => {
    expect(isPrime(1)).toBe(false);
    expect(isPrime(4)).toBe(false);
    expect(isPrime(15)).toBe(false);
  });
});

describe("simpleHash", () => {
  it("同じ文字列は同じハッシュ", () => {
    expect(simpleHash("hello", 1000)).toBe(simpleHash("hello", 1000));
  });
  it("異なる文字列は (高確率で) 異なるハッシュ", () => {
    expect(simpleHash("hello", 1000)).not.toBe(simpleHash("world", 1000));
  });
  it("0 にならない", () => {
    // 空文字列は h=0 だが 1 に変換される
    expect(simpleHash("", 100)).toBe(1);
  });
});

// ── 共通セットアップ (決定的なので共有可能) ──

const engine = new SigningEngine();
const { keyPair } = engine.generateKeyPair(61, 53);

// ── 鍵生成 ──

describe("鍵生成", () => {
  it("正しい鍵ペアを生成する (p=61, q=53)", () => {
    expect(keyPair.publicKey.n).toBe(61 * 53);
    expect(keyPair.privateKey.n).toBe(61 * 53);
    // e * d ≡ 1 (mod φ(n))
    const phi = 60 * 52;
    expect((keyPair.publicKey.e * keyPair.privateKey.d) % phi).toBe(1);
  });

  it("鍵生成でトレースが出力される", () => {
    const { trace } = engine.generateKeyPair(17, 19);
    expect(trace.some((t) => t.phase === "keygen")).toBe(true);
    expect(trace.some((t) => t.phase === "math")).toBe(true);
    expect(trace.some((t) => t.phase === "result")).toBe(true);
  });

  it("p が素数でなければエラー", () => {
    expect(() => engine.generateKeyPair(10, 53)).toThrow();
  });

  it("p === q ならエラー", () => {
    expect(() => engine.generateKeyPair(61, 61)).toThrow();
  });
});

// ── 暗号化 / 復号 ──

describe("暗号化と復号", () => {
  it("暗号化→復号で元の値に戻る", () => {
    const m = 42;
    const { cipher } = engine.encrypt(m, keyPair.publicKey);
    const { plain } = engine.decrypt(cipher, keyPair.privateKey);
    expect(plain).toBe(m);
  });

  it("複数の値で正しく動作する", () => {
    for (const m of [0, 1, 10, 100, 500]) {
      if (m >= keyPair.publicKey.n) continue;
      const { cipher } = engine.encrypt(m, keyPair.publicKey);
      const { plain } = engine.decrypt(cipher, keyPair.privateKey);
      expect(plain).toBe(m);
    }
  });
});

// ── メッセージ暗号化 / 復号 ──

describe("メッセージ暗号化と復号", () => {
  it("文字列を暗号化→復号で元に戻る", () => {
    const msg = "Hello";
    const { cipherValues } = engine.encryptMessage(msg, keyPair.publicKey);
    const { message } = engine.decryptMessage(cipherValues, keyPair.privateKey);
    expect(message).toBe(msg);
  });

  it("暗号文は平文と異なる", () => {
    const msg = "AB";
    const { cipherValues } = engine.encryptMessage(msg, keyPair.publicKey);
    expect(cipherValues[0]).not.toBe(msg.charCodeAt(0));
  });
});

// ── 署名 / 検証 ──

describe("署名と検証", () => {
  it("正しい署名は検証に成功する", () => {
    const msg = "transfer 100 yen";
    const { signature } = engine.sign(msg, keyPair.privateKey);
    const { valid } = engine.verify(msg, signature, keyPair.publicKey);
    expect(valid).toBe(true);
  });

  it("改ざんされたメッセージは検証に失敗する", () => {
    const msg = "transfer 100 yen";
    const { signature } = engine.sign(msg, keyPair.privateKey);
    const { valid } = engine.tamperAndVerify(msg, "transfer 999 yen", signature, keyPair.publicKey);
    expect(valid).toBe(false);
  });

  it("異なる秘密鍵の署名は検証に失敗する", () => {
    const { keyPair: otherKeys } = engine.generateKeyPair(67, 71);
    const msg = "secret";
    const { signature } = engine.sign(msg, otherKeys.privateKey);
    const { valid } = engine.verify(msg, signature, keyPair.publicKey);
    expect(valid).toBe(false);
  });

  it("署名でトレースが出力される", () => {
    const { trace } = engine.sign("test", keyPair.privateKey);
    expect(trace.some((t) => t.phase === "sign")).toBe(true);
    expect(trace.some((t) => t.phase === "hash")).toBe(true);
  });
});

// ── トレース ──

describe("トレース", () => {
  it("改ざん検出でトレースが出力される", () => {
    const { signature } = engine.sign("original", keyPair.privateKey);
    const { trace } = engine.tamperAndVerify("original", "tampered", signature, keyPair.publicKey);
    expect(trace.some((t) => t.phase === "tamper")).toBe(true);
  });
});
