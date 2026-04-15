/**
 * signing.ts — 公開鍵暗号 & デジタル署名シミュレーションエンジン
 *
 * 簡易 RSA を用いて、鍵生成 → 暗号化/復号 → 署名/検証 の
 * 一連の流れをステップごとにトレースする。
 */

// ── 数学ユーティリティ (簡易 RSA 用) ──

/** 最大公約数 */
export function gcd(a: number, b: number): number {
  while (b !== 0) {
    [a, b] = [b, a % b];
  }
  return a;
}

/** 拡張ユークリッド互除法 — ax + by = gcd(a,b) の (x, y) を返す */
export function extGcd(a: number, b: number): { g: number; x: number; y: number } {
  if (b === 0) return { g: a, x: 1, y: 0 };
  const r = extGcd(b, a % b);
  return { g: r.g, x: r.y, y: r.x - Math.floor(a / b) * r.y };
}

/** モジュラ逆元 a^(-1) mod m */
export function modInverse(a: number, m: number): number | null {
  const r = extGcd(((a % m) + m) % m, m);
  if (r.g !== 1) return null;
  return ((r.x % m) + m) % m;
}

/** 高速べき乗剰余 base^exp mod mod */
export function modPow(base: number, exp: number, mod: number): number {
  if (mod === 1) return 0;
  let result = 1;
  base = ((base % mod) + mod) % mod;
  while (exp > 0) {
    if (exp % 2 === 1) {
      result = (result * base) % mod;
    }
    exp = Math.floor(exp / 2);
    base = (base * base) % mod;
  }
  return result;
}

/** 素数判定 (試し割り) */
export function isPrime(n: number): boolean {
  if (n < 2) return false;
  if (n < 4) return true;
  if (n % 2 === 0 || n % 3 === 0) return false;
  for (let i = 5; i * i <= n; i += 6) {
    if (n % i === 0 || n % (i + 2) === 0) return false;
  }
  return true;
}

// ── 鍵ペア ──

/**
 * RSA 公開鍵を表すインターフェース
 * 公開指数 e と法 n のペアで構成される
 */
export interface RsaPublicKey {
  /** 公開指数 — 暗号化および署名検証に使用 */
  e: number;
  /** 法 (p * q) — 公開鍵と秘密鍵で共有される */
  n: number;
}

/**
 * RSA 秘密鍵を表すインターフェース
 * 秘密指数 d と素因数 p, q を保持する
 */
export interface RsaPrivateKey {
  /** 秘密指数 — 復号および署名生成に使用 */
  d: number;
  /** 法 (p * q) */
  n: number;
  /** 素因数1 */
  p: number;
  /** 素因数2 */
  q: number;
}

/**
 * RSA 鍵ペア — 公開鍵と秘密鍵の組み合わせ
 */
export interface RsaKeyPair {
  /** 公開鍵 — 暗号化と署名検証に使用 */
  publicKey: RsaPublicKey;
  /** 秘密鍵 — 復号と署名生成に使用 */
  privateKey: RsaPrivateKey;
}

// ── トレース ──

/**
 * シミュレーションの各ステップを記録するトレース情報
 * UIでの操作履歴表示に使用される
 */
export interface SigningTrace {
  /** 処理のフェーズ — UIでの色分け表示に対応 */
  phase:
    | "keygen"      // 鍵生成
    | "encrypt"     // 暗号化
    | "decrypt"     // 復号
    | "hash"        // ハッシュ計算
    | "sign"        // 署名
    | "verify"      // 検証
    | "tamper"      // 改ざん
    | "math"        // 数学的計算
    | "result";     // 結果
  /** トレースの詳細メッセージ */
  detail: string;
}

// ── 簡易ハッシュ (教育用) ──

/** 簡易ハッシュ — 文字列を小さな数値に変換 (教育目的) */
export function simpleHash(message: string, mod: number): number {
  let h = 0;
  for (let i = 0; i < message.length; i++) {
    h = (h * 31 + message.charCodeAt(i)) % mod;
  }
  // 0 だと署名が常に 0 になるので回避
  return h === 0 ? 1 : h;
}

// ── エンジン ──

/**
 * 公開鍵暗号・デジタル署名シミュレーションエンジン
 *
 * 簡易 RSA を用いて以下の操作を提供する:
 * - 鍵ペア生成 (generateKeyPair)
 * - 暗号化 / 復号 (encrypt / decrypt)
 * - メッセージ単位の暗号化 / 復号 (encryptMessage / decryptMessage)
 * - 署名 / 検証 (sign / verify)
 * - 改ざんシミュレーション (tamperAndVerify)
 *
 * 各メソッドは処理結果とともにトレース情報を返し、
 * UIで計算過程をステップごとに可視化できる。
 */
export class SigningEngine {
  /** RSA 鍵ペアを生成する */
  generateKeyPair(p: number, q: number): { keyPair: RsaKeyPair; trace: SigningTrace[] } {
    const trace: SigningTrace[] = [];

    trace.push({ phase: "keygen", detail: `素数 p=${p}, q=${q} を選択` });

    if (!isPrime(p) || !isPrime(q)) {
      trace.push({ phase: "keygen", detail: `エラー: p または q が素数でない` });
      throw new Error("p と q は素数でなければならない");
    }
    if (p === q) {
      trace.push({ phase: "keygen", detail: `エラー: p と q が同じ` });
      throw new Error("p と q は異なる素数でなければならない");
    }

    const n = p * q;
    trace.push({ phase: "math", detail: `n = p × q = ${p} × ${q} = ${n}` });

    const phi = (p - 1) * (q - 1);
    trace.push({ phase: "math", detail: `φ(n) = (p-1)(q-1) = ${p - 1} × ${q - 1} = ${phi}` });

    // 公開指数 e を選択 (gcd(e, φ(n)) = 1 となる値)
    let e = 65537;
    if (e >= phi) {
      // 小さい鍵の場合、適切な奇数 e を探す
      for (e = 3; e < phi; e += 2) {
        if (gcd(e, phi) === 1) break;
      }
    }
    trace.push({ phase: "math", detail: `公開指数 e=${e} を選択 (gcd(${e}, ${phi}) = 1)` });

    const d = modInverse(e, phi);
    if (d === null) {
      throw new Error("モジュラ逆元が存在しない");
    }
    trace.push({ phase: "math", detail: `秘密指数 d = e⁻¹ mod φ(n) = ${e}⁻¹ mod ${phi} = ${d}` });
    trace.push({ phase: "math", detail: `検証: e × d mod φ(n) = ${e} × ${d} mod ${phi} = ${(e * d) % phi}` });

    const keyPair: RsaKeyPair = {
      publicKey: { e, n },
      privateKey: { d, n, p, q },
    };

    trace.push({ phase: "keygen", detail: `公開鍵: (e=${e}, n=${n})` });
    trace.push({ phase: "keygen", detail: `秘密鍵: (d=${d}, n=${n})` });
    trace.push({ phase: "result", detail: `鍵ペア生成完了 — ${Math.floor(Math.log2(n)) + 1} ビット` });

    return { keyPair, trace };
  }

  /** 公開鍵で暗号化する (受信者の公開鍵で暗号化) */
  encrypt(plainValue: number, publicKey: RsaPublicKey): { cipher: number; trace: SigningTrace[] } {
    const trace: SigningTrace[] = [];

    trace.push({ phase: "encrypt", detail: `平文 m=${plainValue} を公開鍵で暗号化` });

    if (plainValue >= publicKey.n) {
      trace.push({ phase: "encrypt", detail: `⚠ 平文 ${plainValue} ≥ n=${publicKey.n} — 値は n 未満でなければならない` });
    }

    const cipher = modPow(plainValue, publicKey.e, publicKey.n);
    trace.push({ phase: "math", detail: `c = m^e mod n = ${plainValue}^${publicKey.e} mod ${publicKey.n} = ${cipher}` });
    trace.push({ phase: "result", detail: `暗号文: ${cipher}` });

    return { cipher, trace };
  }

  /** 秘密鍵で復号する */
  decrypt(cipher: number, privateKey: RsaPrivateKey): { plain: number; trace: SigningTrace[] } {
    const trace: SigningTrace[] = [];

    trace.push({ phase: "decrypt", detail: `暗号文 c=${cipher} を秘密鍵で復号` });

    const plain = modPow(cipher, privateKey.d, privateKey.n);
    trace.push({ phase: "math", detail: `m = c^d mod n = ${cipher}^${privateKey.d} mod ${privateKey.n} = ${plain}` });
    trace.push({ phase: "result", detail: `復号された平文: ${plain}` });

    return { plain, trace };
  }

  /** メッセージに署名する (秘密鍵で署名) */
  sign(message: string, privateKey: RsaPrivateKey): { hash: number; signature: number; trace: SigningTrace[] } {
    const trace: SigningTrace[] = [];

    trace.push({ phase: "sign", detail: `メッセージ「${message}」に署名` });

    // ハッシュ計算
    const hash = simpleHash(message, privateKey.n);
    trace.push({ phase: "hash", detail: `H(message) = simpleHash("${message}") mod ${privateKey.n} = ${hash}` });

    // 秘密鍵でハッシュを暗号化 = 署名
    const signature = modPow(hash, privateKey.d, privateKey.n);
    trace.push({ phase: "math", detail: `sig = H(m)^d mod n = ${hash}^${privateKey.d} mod ${privateKey.n} = ${signature}` });
    trace.push({ phase: "result", detail: `署名値: ${signature}` });

    return { hash, signature, trace };
  }

  /** 署名を検証する (公開鍵で検証) */
  verify(
    message: string,
    signature: number,
    publicKey: RsaPublicKey,
  ): { valid: boolean; recoveredHash: number; expectedHash: number; trace: SigningTrace[] } {
    const trace: SigningTrace[] = [];

    trace.push({ phase: "verify", detail: `メッセージ「${message}」の署名を検証` });

    // 公開鍵で署名を復号 → ハッシュを復元
    const recoveredHash = modPow(signature, publicKey.e, publicKey.n);
    trace.push({ phase: "math", detail: `H' = sig^e mod n = ${signature}^${publicKey.e} mod ${publicKey.n} = ${recoveredHash}` });

    // メッセージから期待されるハッシュを計算
    const expectedHash = simpleHash(message, publicKey.n);
    trace.push({ phase: "hash", detail: `H(message) = simpleHash("${message}") mod ${publicKey.n} = ${expectedHash}` });

    const valid = recoveredHash === expectedHash;
    trace.push({ phase: "verify", detail: `H' (${recoveredHash}) ${valid ? "===" : "!=="} H(m) (${expectedHash})` });
    trace.push({ phase: "result", detail: valid ? "✓ 署名は有効 — メッセージは改ざんされていない" : "✗ 署名は無効 — メッセージが改ざんされた可能性がある" });

    return { valid, recoveredHash, expectedHash, trace };
  }

  /** メッセージ全体の暗号化 (文字単位) */
  encryptMessage(message: string, publicKey: RsaPublicKey): { cipherValues: number[]; trace: SigningTrace[] } {
    const trace: SigningTrace[] = [];
    trace.push({ phase: "encrypt", detail: `メッセージ「${message}」を文字単位で暗号化` });

    const cipherValues: number[] = [];
    for (const ch of message) {
      const code = ch.charCodeAt(0);
      const { cipher } = this.encrypt(code, publicKey);
      cipherValues.push(cipher);
      trace.push({ phase: "math", detail: `'${ch}' (${code}) → ${cipher}` });
    }

    trace.push({ phase: "result", detail: `暗号文: [${cipherValues.join(", ")}]` });
    return { cipherValues, trace };
  }

  /** 暗号化されたメッセージの復号 (文字単位) */
  decryptMessage(cipherValues: number[], privateKey: RsaPrivateKey): { message: string; trace: SigningTrace[] } {
    const trace: SigningTrace[] = [];
    trace.push({ phase: "decrypt", detail: `暗号文 [${cipherValues.join(", ")}] を復号` });

    const chars: string[] = [];
    for (const c of cipherValues) {
      const { plain } = this.decrypt(c, privateKey);
      const ch = String.fromCharCode(plain);
      chars.push(ch);
      trace.push({ phase: "math", detail: `${c} → ${plain} → '${ch}'` });
    }

    const message = chars.join("");
    trace.push({ phase: "result", detail: `復号メッセージ: 「${message}」` });
    return { message, trace };
  }

  /** 改ざんシミュレーション */
  tamperAndVerify(
    originalMessage: string,
    tamperedMessage: string,
    signature: number,
    publicKey: RsaPublicKey,
  ): { valid: boolean; trace: SigningTrace[] } {
    const trace: SigningTrace[] = [];

    trace.push({ phase: "tamper", detail: `メッセージを「${originalMessage}」→「${tamperedMessage}」に改ざん` });

    const result = this.verify(tamperedMessage, signature, publicKey);
    trace.push(...result.trace);

    return { valid: result.valid, trace };
  }
}
