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

/** Diffie-Hellman 鍵交換に使用する公開パラメータ */
export interface DhParams {
  p: number;  // 素数 (公開)
  g: number;  // 生成元 (公開)
}

/** DH 鍵交換で生成される鍵ペア */
export interface DhKeyPair {
  privateKey: number;  // 秘密の乱数
  publicKey: number;   // g^privateKey mod p (相手に送る)
}

/** 公開パラメータ（教育用に小さい素数を使用） */
export const DH_PARAMS: DhParams = { p: 23, g: 5 };

/**
 * DH 鍵ペアを生成する
 * @param params - DH公開パラメータ（素数pと生成元g）
 * @returns 秘密鍵と公開鍵のペア
 */
export function dhGenerateKeyPair(params: DhParams): DhKeyPair {
  const privateKey = 2 + Math.floor(Math.random() * (params.p - 3)); // 2..p-2
  const publicKey = modPow(params.g, privateKey, params.p);
  return { privateKey, publicKey };
}

/**
 * DH 共有秘密を計算する
 *
 * 相手の公開鍵を自分の秘密鍵でべき乗剰余して共有秘密を導出する。
 * クライアント・サーバ双方で同じ値が得られるのがDHの要。
 *
 * @param otherPublicKey - 相手の公開鍵
 * @param myPrivateKey - 自分の秘密鍵
 * @param p - DH の素数パラメータ
 * @returns 共有秘密の値
 */
export function dhComputeSharedSecret(otherPublicKey: number, myPrivateKey: number, p: number): number {
  return modPow(otherPublicKey, myPrivateKey, p);
}

/**
 * べき乗剰余を計算する (base^exp mod mod)
 *
 * 繰り返し二乗法を使用して効率的に計算する。
 *
 * @param base - 底
 * @param exp - 指数
 * @param mod - 法
 * @returns base^exp mod mod の結果
 */
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

/**
 * 対称暗号で平文を暗号化する
 *
 * XOR ベースの簡易暗号。鍵とインデックスを組み合わせて各文字を変換し、
 * Base64 でエンコードした結果を返す。
 *
 * @param plaintext - 暗号化する平文
 * @param key - 暗号化鍵（共有秘密から導出）
 * @returns Base64 エンコードされた暗号文
 */
export function symmetricEncrypt(plaintext: string, key: number): string {
  let result = "";
  for (let i = 0; i < plaintext.length; i++) {
    const encrypted = plaintext.charCodeAt(i) ^ ((key + i) & 0xFF);
    result += String.fromCharCode(encrypted);
  }
  return btoa(result); // Base64 エンコード
}

/**
 * 対称暗号で暗号文を復号する
 *
 * symmetricEncrypt の逆操作。Base64 デコード後に XOR で元の平文を復元する。
 *
 * @param ciphertext - Base64 エンコードされた暗号文
 * @param key - 復号鍵（暗号化と同じ鍵）
 * @returns 復号された平文
 */
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

/**
 * 簡易ハッシュ関数
 *
 * FNV-1a に類似したハッシュ。2つのハッシュ値を並行して計算し、
 * 16桁の16進文字列として返す。データの完全性検証に使用する。
 *
 * @param data - ハッシュ対象の文字列
 * @returns 16桁の16進ハッシュ値
 */
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

/** 公開鍵暗号の鍵ペア（RSA/Ed25519 相当） */
export interface KeyPair {
  publicKey: string;     // "ssh-rsa AAAA..."
  privateKey: string;    // 秘密鍵
  fingerprint: string;   // SHA256:xxxx
}

/**
 * 公開鍵・秘密鍵ペアを生成する
 *
 * 名前とランダム値からシード値を作り、そこから鍵ペアとフィンガープリントを導出する。
 *
 * @param name - 鍵の識別名（ユーザ名やホスト名）
 * @returns 公開鍵・秘密鍵・フィンガープリントのセット
 */
export function generateKeyPair(name: string): KeyPair {
  const seed = simpleHash(name + String(Date.now()) + String(Math.random()));
  const publicKey = `ssh-rsa ${btoa(seed).slice(0, 20)} ${name}`;
  const privateKey = seed;
  const fingerprint = `SHA256:${simpleHash(publicKey).slice(0, 12)}`;
  return { publicKey, privateKey, fingerprint };
}

/**
 * 秘密鍵でデータに署名する
 *
 * データと秘密鍵を結合してハッシュを取ることで署名を生成する。
 *
 * @param data - 署名対象のデータ
 * @param privateKey - 署名に使用する秘密鍵
 * @returns 署名文字列
 */
export function sign(data: string, privateKey: string): string {
  return simpleHash(data + privateKey);
}

/**
 * 署名を検証する
 *
 * 同じデータと秘密鍵から署名を再計算し、提供された署名と一致するか確認する。
 * 注: 簡易実装のため秘密鍵も必要（実際のRSAでは公開鍵のみで検証可能）。
 *
 * @param data - 検証対象のデータ
 * @param signature - 検証する署名
 * @param publicKey - 公開鍵（この実装では未使用）
 * @param privateKey - 秘密鍵（署名再計算用）
 * @returns 署名が有効なら true
 */
export function verify(data: string, signature: string, _publicKey: string, privateKey: string): boolean {
  return sign(data, privateKey) === signature;
}

/**
 * ホスト鍵フィンガープリントをコロン区切りで整形する
 *
 * @param fp - フィンガープリント文字列
 * @returns コロン区切りに整形された文字列（例: "a1:b2:c3:..."）
 */
export function formatFingerprint(fp: string): string {
  return fp.replace(/(.{2})/g, "$1:").slice(0, -1);
}
