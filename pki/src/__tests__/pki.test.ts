/**
 * PKIシミュレーターのテスト
 * 暗号演算、RSA、証明書チェーン、TLSハンドシェイクを網羅的にテストする
 */

import { describe, it, expect, beforeEach } from "vitest";
import { modPow, gcd, modInverse, isPrime, generatePrimes, simpleHash } from "../crypto/math.js";
import {
  generateKeyPair,
  encrypt,
  decrypt,
  sign,
  verify,
  formatKeyInfo,
} from "../crypto/rsa.js";
import {
  createRootCACert,
  issueIntermediateCACert,
  issueEndEntityCert,
  validateCertificateChain,
  verifyCertSignature,
  isCertExpired,
  formatCertificate,
  resetSerialCounter,
} from "../crypto/cert.js";
import type { Certificate } from "../crypto/cert.js";
import {
  performHandshake,
  challengeResponseAuth,
  formatHandshakeLog,
} from "../auth/handshake.js";
import type { ClientConfig, ServerConfig } from "../auth/handshake.js";

// ========================================
// モジュラー算術のテスト
// ========================================
describe("モジュラー算術 (math.ts)", () => {
  describe("modPow", () => {
    it("べき乗剰余を正しく計算する", () => {
      // 2^10 mod 1000 = 1024 mod 1000 = 24
      expect(modPow(2n, 10n, 1000n)).toBe(24n);
    });

    it("大きな指数でも正しく計算する", () => {
      // 3^13 mod 7 = 1594323 mod 7 = 3
      expect(modPow(3n, 13n, 7n)).toBe(3n);
    });

    it("mod が 1 の場合は 0 を返す", () => {
      expect(modPow(5n, 3n, 1n)).toBe(0n);
    });

    it("指数が 0 の場合は 1 を返す", () => {
      expect(modPow(7n, 0n, 13n)).toBe(1n);
    });
  });

  describe("gcd", () => {
    it("最大公約数を正しく計算する", () => {
      expect(gcd(12n, 8n)).toBe(4n);
      expect(gcd(17n, 13n)).toBe(1n);
      expect(gcd(100n, 75n)).toBe(25n);
    });

    it("一方が 0 の場合", () => {
      expect(gcd(5n, 0n)).toBe(5n);
      expect(gcd(0n, 7n)).toBe(7n);
    });

    it("負の数を扱える", () => {
      expect(gcd(-12n, 8n)).toBe(4n);
    });
  });

  describe("modInverse", () => {
    it("モジュラー逆元を正しく計算する", () => {
      // 3 * 7 = 21 ≡ 1 (mod 10)
      const inv = modInverse(3n, 10n);
      expect((3n * inv) % 10n).toBe(1n);
    });

    it("逆元が存在しない場合はエラーを投げる", () => {
      expect(() => modInverse(2n, 4n)).toThrow("モジュラー逆元が存在しません");
    });

    it("公開指数 65537 の逆元を計算する", () => {
      const phi = 100n * 96n; // 例: (101-1)*(97-1)
      const e = 65537n;
      if (gcd(e, phi) === 1n) {
        const d = modInverse(e, phi);
        expect((e * d) % phi).toBe(1n);
      }
    });
  });

  describe("isPrime", () => {
    it("素数を正しく判定する", () => {
      expect(isPrime(2)).toBe(true);
      expect(isPrime(3)).toBe(true);
      expect(isPrime(5)).toBe(true);
      expect(isPrime(97)).toBe(true);
      expect(isPrime(997)).toBe(true);
    });

    it("合成数を正しく判定する", () => {
      expect(isPrime(0)).toBe(false);
      expect(isPrime(1)).toBe(false);
      expect(isPrime(4)).toBe(false);
      expect(isPrime(9)).toBe(false);
      expect(isPrime(100)).toBe(false);
    });

    it("負の数は素数でない", () => {
      expect(isPrime(-5)).toBe(false);
    });
  });

  describe("generatePrimes", () => {
    it("指定範囲内の素数を生成する", () => {
      const primes = generatePrimes(10, 30);
      expect(primes).toEqual([11, 13, 17, 19, 23, 29]);
    });

    it("範囲内に素数がない場合は空配列を返す", () => {
      const primes = generatePrimes(14, 16);
      expect(primes).toEqual([]);
    });
  });

  describe("simpleHash", () => {
    it("同じ文字列に対して同じハッシュを返す", () => {
      expect(simpleHash("hello")).toBe(simpleHash("hello"));
    });

    it("異なる文字列に対して異なるハッシュを返す", () => {
      expect(simpleHash("hello")).not.toBe(simpleHash("world"));
    });

    it("空文字列のハッシュは 0", () => {
      expect(simpleHash("")).toBe(0n);
    });
  });
});

// ========================================
// RSA暗号のテスト
// ========================================
describe("RSA暗号 (rsa.ts)", () => {
  describe("generateKeyPair", () => {
    it("有効な鍵ペアを生成する", () => {
      const keyPair = generateKeyPair();
      expect(keyPair.publicKey.n).toBeGreaterThan(0n);
      expect(keyPair.publicKey.e).toBeGreaterThan(0n);
      expect(keyPair.privateKey.d).toBeGreaterThan(0n);
      expect(keyPair.privateKey.p).not.toBe(keyPair.privateKey.q);
    });

    it("n = p * q であること", () => {
      const keyPair = generateKeyPair();
      expect(keyPair.publicKey.n).toBe(keyPair.privateKey.p * keyPair.privateKey.q);
    });
  });

  describe("encrypt / decrypt", () => {
    it("暗号化と復号で元のメッセージに戻る", () => {
      const keyPair = generateKeyPair();
      const message = 42n;
      const cipher = encrypt(message, keyPair.publicKey);
      const decrypted = decrypt(cipher, keyPair.privateKey);
      expect(decrypted).toBe(message);
    });

    it("複数のメッセージで正しく動作する", () => {
      const keyPair = generateKeyPair();
      for (const m of [1n, 2n, 100n, 999n]) {
        if (m < keyPair.publicKey.n) {
          const cipher = encrypt(m, keyPair.publicKey);
          const decrypted = decrypt(cipher, keyPair.privateKey);
          expect(decrypted).toBe(m);
        }
      }
    });

    it("メッセージがモジュラスより大きい場合はエラー", () => {
      const keyPair = generateKeyPair();
      const tooLarge = keyPair.publicKey.n + 1n;
      expect(() => encrypt(tooLarge, keyPair.publicKey)).toThrow("モジュラスより大きい");
    });
  });

  describe("sign / verify", () => {
    it("正しい署名を検証できる", () => {
      const keyPair = generateKeyPair();
      const message = "テストメッセージ";
      const signature = sign(message, keyPair.privateKey);
      expect(verify(message, signature, keyPair.publicKey)).toBe(true);
    });

    it("改ざんされたメッセージは検証に失敗する", () => {
      const keyPair = generateKeyPair();
      const message = "テストメッセージ";
      const signature = sign(message, keyPair.privateKey);
      expect(verify("改ざんメッセージ", signature, keyPair.publicKey)).toBe(false);
    });

    it("異なる鍵で署名を検証すると失敗する", () => {
      const keyPair1 = generateKeyPair();
      const keyPair2 = generateKeyPair();
      const message = "テスト";
      const signature = sign(message, keyPair1.privateKey);
      // 異なる鍵での検証は通常失敗する
      // ただし偶然一致する可能性があるため、複数回テストする
      let allVerified = true;
      for (let i = 0; i < 5; i++) {
        const kp1 = generateKeyPair();
        const kp2 = generateKeyPair();
        const sig = sign(`msg-${i}`, kp1.privateKey);
        if (!verify(`msg-${i}`, sig, kp2.publicKey)) {
          allVerified = false;
          break;
        }
      }
      expect(allVerified).toBe(false);
    });
  });

  describe("formatKeyInfo", () => {
    it("鍵情報を文字列に変換する", () => {
      const keyPair = generateKeyPair();
      const info = formatKeyInfo(keyPair);
      expect(info).toContain("RSA鍵ペア情報");
      expect(info).toContain("p =");
      expect(info).toContain("q =");
      expect(info).toContain("n = p * q");
    });
  });
});

// ========================================
// 証明書のテスト
// ========================================
describe("証明書 (cert.ts)", () => {
  let rootKeyPair: ReturnType<typeof generateKeyPair>;
  let intKeyPair: ReturnType<typeof generateKeyPair>;
  let eeKeyPair: ReturnType<typeof generateKeyPair>;
  let rootCert: Certificate;
  let intCert: Certificate;
  let eeCert: Certificate;

  beforeEach(() => {
    resetSerialCounter();
    rootKeyPair = generateKeyPair();
    intKeyPair = generateKeyPair();
    eeKeyPair = generateKeyPair();

    rootCert = createRootCACert("Test Root CA", rootKeyPair);
    intCert = issueIntermediateCACert(
      "Test Intermediate CA",
      intKeyPair.publicKey,
      rootCert,
      rootKeyPair.privateKey,
    );
    eeCert = issueEndEntityCert(
      "test.example.com",
      eeKeyPair.publicKey,
      intCert,
      intKeyPair.privateKey,
    );
  });

  describe("createRootCACert", () => {
    it("自己署名のルートCA証明書を作成する", () => {
      expect(rootCert.subject).toBe("Test Root CA");
      expect(rootCert.issuer).toBe("Test Root CA");
      expect(rootCert.type).toBe("root-ca");
      expect(rootCert.isSelfSigned).toBe(true);
    });

    it("自己署名を検証できる", () => {
      expect(verifyCertSignature(rootCert, rootCert.publicKey)).toBe(true);
    });
  });

  describe("issueIntermediateCACert", () => {
    it("中間CA証明書を正しく発行する", () => {
      expect(intCert.subject).toBe("Test Intermediate CA");
      expect(intCert.issuer).toBe("Test Root CA");
      expect(intCert.type).toBe("intermediate-ca");
      expect(intCert.isSelfSigned).toBe(false);
    });

    it("ルートCAの公開鍵で署名を検証できる", () => {
      expect(verifyCertSignature(intCert, rootCert.publicKey)).toBe(true);
    });
  });

  describe("issueEndEntityCert", () => {
    it("エンドエンティティ証明書を正しく発行する", () => {
      expect(eeCert.subject).toBe("test.example.com");
      expect(eeCert.issuer).toBe("Test Intermediate CA");
      expect(eeCert.type).toBe("end-entity");
    });

    it("中間CAの公開鍵で署名を検証できる", () => {
      expect(verifyCertSignature(eeCert, intCert.publicKey)).toBe(true);
    });
  });

  describe("isCertExpired", () => {
    it("有効期間内の証明書は期限切れでない", () => {
      expect(isCertExpired(rootCert)).toBe(false);
    });

    it("遠い未来の日付では期限切れになる", () => {
      const futureDate = new Date("2050-01-01");
      expect(isCertExpired(rootCert, futureDate)).toBe(true);
    });

    it("過去の日付では有効期間前と判定される", () => {
      const pastDate = new Date("2000-01-01");
      expect(isCertExpired(rootCert, pastDate)).toBe(true);
    });
  });

  describe("validateCertificateChain", () => {
    it("正しいチェーンの検証に成功する", () => {
      const result = validateCertificateChain(
        [eeCert, intCert, rootCert],
        [rootCert],
      );
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.log.length).toBeGreaterThan(0);
    });

    it("信頼されていないルートCAの場合は失敗する", () => {
      const result = validateCertificateChain(
        [eeCert, intCert, rootCert],
        [],
      );
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("信頼されていません"))).toBe(true);
    });

    it("期限切れの証明書がある場合は失敗する", () => {
      const futureDate = new Date("2050-01-01");
      const result = validateCertificateChain(
        [eeCert, intCert, rootCert],
        [rootCert],
        futureDate,
      );
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("有効期限が切れています"))).toBe(true);
    });

    it("空のチェーンは失敗する", () => {
      const result = validateCertificateChain([], [rootCert]);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("空です");
    });

    it("無効な署名の証明書を検出する", () => {
      // 署名を改ざんする
      const tamperedCert: Certificate = {
        ...eeCert,
        signature: eeCert.signature + 1n,
      };
      const result = validateCertificateChain(
        [tamperedCert, intCert, rootCert],
        [rootCert],
      );
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("署名が無効"))).toBe(true);
    });

    it("発行者が不一致の場合は失敗する", () => {
      const mismatchedCert: Certificate = {
        ...eeCert,
        issuer: "Unknown CA",
      };
      const result = validateCertificateChain(
        [mismatchedCert, intCert, rootCert],
        [rootCert],
      );
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("発行者が不一致"))).toBe(true);
    });
  });

  describe("formatCertificate", () => {
    it("証明書情報を文字列に変換する", () => {
      const formatted = formatCertificate(rootCert);
      expect(formatted).toContain("Test Root CA");
      expect(formatted).toContain("root-ca");
      expect(formatted).toContain("シリアル番号");
    });
  });
});

// ========================================
// TLSハンドシェイクのテスト
// ========================================
describe("TLSハンドシェイク (handshake.ts)", () => {
  let rootKeyPair: ReturnType<typeof generateKeyPair>;
  let intKeyPair: ReturnType<typeof generateKeyPair>;
  let eeKeyPair: ReturnType<typeof generateKeyPair>;
  let rootCert: Certificate;
  let intCert: Certificate;
  let eeCert: Certificate;

  beforeEach(() => {
    resetSerialCounter();
    rootKeyPair = generateKeyPair();
    intKeyPair = generateKeyPair();
    eeKeyPair = generateKeyPair();

    rootCert = createRootCACert("Handshake Root CA", rootKeyPair);
    intCert = issueIntermediateCACert(
      "Handshake Intermediate CA",
      intKeyPair.publicKey,
      rootCert,
      rootKeyPair.privateKey,
    );
    eeCert = issueEndEntityCert(
      "server.example.com",
      eeKeyPair.publicKey,
      intCert,
      intKeyPair.privateKey,
    );
  });

  describe("performHandshake", () => {
    it("正常なハンドシェイクが成功する", () => {
      const clientConfig: ClientConfig = {
        trustedRoots: [rootCert],
        cipherSuites: ["RSA_SIM_WITH_AES_128", "RSA_SIM_WITH_AES_256"],
      };
      const serverConfig: ServerConfig = {
        certificateChain: [eeCert, intCert, rootCert],
        privateKey: eeKeyPair.privateKey,
        cipherSuites: ["RSA_SIM_WITH_AES_256", "RSA_SIM_WITH_AES_128"],
      };

      const result = performHandshake(clientConfig, serverConfig);
      expect(result.success).toBe(true);
      expect(result.state).toBe("finished");
      expect(result.selectedCipher).toBe("RSA_SIM_WITH_AES_256");
      expect(result.sharedSecret).not.toBeNull();
      expect(result.error).toBeNull();
      expect(result.log.length).toBeGreaterThan(0);
    });

    it("共通の暗号スイートがない場合は失敗する", () => {
      const clientConfig: ClientConfig = {
        trustedRoots: [rootCert],
        cipherSuites: ["CIPHER_A"],
      };
      const serverConfig: ServerConfig = {
        certificateChain: [eeCert, intCert, rootCert],
        privateKey: eeKeyPair.privateKey,
        cipherSuites: ["CIPHER_B"],
      };

      const result = performHandshake(clientConfig, serverConfig);
      expect(result.success).toBe(false);
      expect(result.state).toBe("failed");
      expect(result.error).toContain("暗号スイート");
    });

    it("信頼されていないルートCAの場合は失敗する", () => {
      const clientConfig: ClientConfig = {
        trustedRoots: [],
        cipherSuites: ["RSA_SIM_WITH_AES_128"],
      };
      const serverConfig: ServerConfig = {
        certificateChain: [eeCert, intCert, rootCert],
        privateKey: eeKeyPair.privateKey,
        cipherSuites: ["RSA_SIM_WITH_AES_128"],
      };

      const result = performHandshake(clientConfig, serverConfig);
      expect(result.success).toBe(false);
      expect(result.state).toBe("failed");
      expect(result.error).toContain("信頼されていません");
    });

    it("ハンドシェイクログにすべてのステップが記録される", () => {
      const clientConfig: ClientConfig = {
        trustedRoots: [rootCert],
        cipherSuites: ["RSA_SIM_WITH_AES_128"],
      };
      const serverConfig: ServerConfig = {
        certificateChain: [eeCert, intCert, rootCert],
        privateKey: eeKeyPair.privateKey,
        cipherSuites: ["RSA_SIM_WITH_AES_128"],
      };

      const result = performHandshake(clientConfig, serverConfig);
      // ClientHello, ServerHello, Certificate, CertVerified, CertificateVerify, Finished
      const messageTypes = result.log.map((entry) => entry.message.type);
      expect(messageTypes).toContain("ClientHello");
      expect(messageTypes).toContain("ServerHello");
      expect(messageTypes).toContain("Certificate");
      expect(messageTypes).toContain("CertificateVerify");
      expect(messageTypes).toContain("Finished");
    });
  });

  describe("challengeResponseAuth", () => {
    it("正しいチャレンジ・レスポンスが検証に成功する", () => {
      const result = challengeResponseAuth(
        "test-challenge-123",
        eeKeyPair.privateKey,
        eeKeyPair.publicKey,
      );
      expect(result.verified).toBe(true);
      expect(result.challenge).toBe("test-challenge-123");
    });

    it("異なる鍵ペアでは検証に失敗する", () => {
      const otherKeyPair = generateKeyPair();
      // 異なる秘密鍵で署名し、元の公開鍵で検証する
      let failedOnce = false;
      for (let i = 0; i < 5; i++) {
        const other = generateKeyPair();
        const r = challengeResponseAuth(
          `challenge-${i}`,
          other.privateKey,
          eeKeyPair.publicKey,
        );
        if (!r.verified) {
          failedOnce = true;
          break;
        }
      }
      expect(failedOnce).toBe(true);
    });
  });

  describe("formatHandshakeLog", () => {
    it("ハンドシェイク結果を文字列に変換する", () => {
      const clientConfig: ClientConfig = {
        trustedRoots: [rootCert],
        cipherSuites: ["RSA_SIM_WITH_AES_128"],
      };
      const serverConfig: ServerConfig = {
        certificateChain: [eeCert, intCert, rootCert],
        privateKey: eeKeyPair.privateKey,
        cipherSuites: ["RSA_SIM_WITH_AES_128"],
      };

      const result = performHandshake(clientConfig, serverConfig);
      const formatted = formatHandshakeLog(result);
      expect(formatted).toContain("TLSハンドシェイクログ");
      expect(formatted).toContain("結果: 成功");
    });

    it("失敗時のログにエラーが含まれる", () => {
      const clientConfig: ClientConfig = {
        trustedRoots: [],
        cipherSuites: ["RSA_SIM_WITH_AES_128"],
      };
      const serverConfig: ServerConfig = {
        certificateChain: [eeCert, intCert, rootCert],
        privateKey: eeKeyPair.privateKey,
        cipherSuites: ["RSA_SIM_WITH_AES_128"],
      };

      const result = performHandshake(clientConfig, serverConfig);
      const formatted = formatHandshakeLog(result);
      expect(formatted).toContain("結果: 失敗");
      expect(formatted).toContain("エラー:");
    });
  });
});
