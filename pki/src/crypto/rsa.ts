/**
 * RSA暗号シミュレーション
 * 小さな素数を使って可視化可能なRSA鍵ペアを生成する
 */

import { gcd, modInverse, modPow, randomPrime, simpleHash } from "./math.js";

/** RSA公開鍵 */
export interface RsaPublicKey {
  /** モジュラス (n = p * q) */
  n: bigint;
  /** 公開指数 */
  e: bigint;
}

/** RSA秘密鍵 */
export interface RsaPrivateKey {
  /** モジュラス (n = p * q) */
  n: bigint;
  /** 秘密指数 */
  d: bigint;
  /** 素数p（デバッグ/教育用途） */
  p: bigint;
  /** 素数q（デバッグ/教育用途） */
  q: bigint;
}

/** RSA鍵ペア */
export interface RsaKeyPair {
  publicKey: RsaPublicKey;
  privateKey: RsaPrivateKey;
}

/**
 * RSA鍵ペアを生成する
 * 小さな素数（可視化用）を使用する
 */
export function generateKeyPair(
  minPrime = 100,
  maxPrime = 997,
): RsaKeyPair {
  // 異なる2つの素数 p, q を選択
  const p = BigInt(randomPrime(minPrime, maxPrime));
  let q = BigInt(randomPrime(minPrime, maxPrime));
  while (q === p) {
    q = BigInt(randomPrime(minPrime, maxPrime));
  }

  const n = p * q;
  // オイラーのトーシェント関数 φ(n) = (p-1)(q-1)
  const phi = (p - 1n) * (q - 1n);

  // 公開指数 e を選択（φ(n)と互いに素）
  let e = 65537n;
  if (e >= phi) {
    e = 3n;
  }
  while (gcd(e, phi) !== 1n) {
    e += 2n;
  }

  // 秘密指数 d = e^(-1) mod φ(n)
  const d = modInverse(e, phi);

  return {
    publicKey: { n, e },
    privateKey: { n, d, p, q },
  };
}

/** RSA暗号化: 平文 m を公開鍵で暗号化する */
export function encrypt(message: bigint, publicKey: RsaPublicKey): bigint {
  if (message >= publicKey.n) {
    throw new Error("メッセージがモジュラスより大きいです");
  }
  return modPow(message, publicKey.e, publicKey.n);
}

/** RSA復号: 暗号文 c を秘密鍵で復号する */
export function decrypt(cipher: bigint, privateKey: RsaPrivateKey): bigint {
  return modPow(cipher, privateKey.d, privateKey.n);
}

/** デジタル署名: メッセージのハッシュを秘密鍵で署名する */
export function sign(message: string, privateKey: RsaPrivateKey): bigint {
  const hash = simpleHash(message) % privateKey.n;
  return modPow(hash, privateKey.d, privateKey.n);
}

/** 署名検証: 署名が正しいか公開鍵で検証する */
export function verify(
  message: string,
  signature: bigint,
  publicKey: RsaPublicKey,
): boolean {
  const hash = simpleHash(message) % publicKey.n;
  const decrypted = modPow(signature, publicKey.e, publicKey.n);
  return decrypted === hash;
}

/** 鍵情報を人間に読みやすい文字列に変換する */
export function formatKeyInfo(keyPair: RsaKeyPair): string {
  const { publicKey, privateKey } = keyPair;
  return [
    `=== RSA鍵ペア情報 ===`,
    `p = ${privateKey.p}`,
    `q = ${privateKey.q}`,
    `n = p * q = ${publicKey.n}`,
    `e (公開指数) = ${publicKey.e}`,
    `d (秘密指数) = ${privateKey.d}`,
  ].join("\n");
}
