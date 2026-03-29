/**
 * crypto.ts -- 暗号プリミティブのシミュレーション
 *
 * SSH で使われる暗号操作を簡易的に再現する:
 *
 *   1. Diffie-Hellman 鍵交換: 盗聴者がいても安全に共有秘密を生成
 *   2. 対称暗号 (AES 相当): 共有秘密でデータを暗号化/復号
 *   3. ハッシュ (SHA-256 相当): データの完全性検証
 *   4. 公開鍵暗号 (RSA 相当): 認証用の署名/検証
 *
 * 実際の暗号は数学的に安全だが、ここでは「仕組みが見える」ことを優先して
 * 小さい数値とシンプルな操作で再現する。
 */

// === Diffie-Hellman 鍵交換 ===
// 実際: 大きな素数とべき乗剰余を使う
// シミュレータ: 小さい素数で同じアルゴリズム

export interface DhParams {
  p: number;  // 素数 (公開)
  g: number;  // 生成元 (公開)
}

export interface DhKeyPair {
  privateKey: number;  // 秘密の乱数
  publicKey: number;   // g^privateKey mod p (相手に送る)
}

// 公開パラメータ
export const DH_PARAMS: DhParams = { p: 23, g: 5 };

// DH 鍵ペアを生成
export function dhGenerateKeyPair(params: DhParams): DhKeyPair {
  const privateKey = 2 + Math.floor(Math.random() * (params.p - 3)); // 2..p-2
  const publicKey = modPow(params.g, privateKey, params.p);
  return { privateKey, publicKey };
}

// DH 共有秘密を計算: 相手の公開鍵 ^ 自分の秘密鍵 mod p
export function dhComputeSharedSecret(otherPublicKey: number, myPrivateKey: number, p: number): number {
  return modPow(otherPublicKey, myPrivateKey, p);
}

// べき乗剰余 (a^b mod m)
function modPow(base: number, exp: number, mod: number): number {
  let result = 1;
  base = base % mod;
  while (exp > 0) {
    if (exp % 2 === 1) result = (result * base) % mod;
    exp = Math.floor(exp / 2);
    base = (base * base) % mod;
  }
  return result;
}

// === 対称暗号 (XOR ベースの簡易暗号) ===
// 実際: AES-256-CTR
// シミュレータ: XOR (鍵を繰り返し適用)

export function symmetricEncrypt(plaintext: string, key: number): string {
  let result = "";
  for (let i = 0; i < plaintext.length; i++) {
    const encrypted = plaintext.charCodeAt(i) ^ ((key + i) & 0xFF);
    result += String.fromCharCode(encrypted);
  }
  return btoa(result); // Base64 エンコード
}

export function symmetricDecrypt(ciphertext: string, key: number): string {
  const decoded = atob(ciphertext);
  let result = "";
  for (let i = 0; i < decoded.length; i++) {
    const decrypted = decoded.charCodeAt(i) ^ ((key + i) & 0xFF);
    result += String.fromCharCode(decrypted);
  }
  return result;
}

// === ハッシュ (簡易) ===
export function simpleHash(data: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < data.length; i++) {
    h1 ^= data.charCodeAt(i);
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= data.charCodeAt(i);
    h2 = Math.imul(h2, 0x811c9dc5);
  }
  return (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
}

// === 公開鍵暗号 (署名/検証の簡易版) ===
// 実際: RSA or Ed25519
// シミュレータ: 秘密鍵でハッシュに署名、公開鍵で検証

export interface KeyPair {
  publicKey: string;     // "ssh-rsa AAAA..."
  privateKey: string;    // 秘密鍵
  fingerprint: string;   // SHA256:xxxx
}

export function generateKeyPair(name: string): KeyPair {
  const seed = simpleHash(name + String(Date.now()) + String(Math.random()));
  const publicKey = `ssh-rsa ${btoa(seed).slice(0, 20)} ${name}`;
  const privateKey = seed;
  const fingerprint = `SHA256:${simpleHash(publicKey).slice(0, 12)}`;
  return { publicKey, privateKey, fingerprint };
}

// 署名: 秘密鍵でデータに署名
export function sign(data: string, privateKey: string): string {
  return simpleHash(data + privateKey);
}

// 検証: 公開鍵で署名を検証
export function verify(data: string, signature: string, publicKey: string, privateKey: string): boolean {
  return sign(data, privateKey) === signature;
}

// ホスト鍵フィンガープリント表示用
export function formatFingerprint(fp: string): string {
  return fp.replace(/(.{2})/g, "$1:").slice(0, -1);
}
