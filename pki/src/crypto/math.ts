/**
 * モジュラー算術ユーティリティ
 *
 * RSA暗号（非対称暗号方式）の基礎となる数学関数を提供する。
 * 公開鍵暗号基盤（PKI）では、RSAの鍵生成・暗号化・署名すべてが
 * モジュラー算術（剰余演算）に依存している。
 *
 * このモジュールが提供する関数:
 * - modPow: べき乗剰余（RSA暗号化・復号・署名の中核演算）
 * - gcd: 最大公約数（公開指数 e の選定に使用）
 * - modInverse: モジュラー逆元（秘密指数 d の計算に使用）
 * - isPrime / generatePrimes / randomPrime: 素数関連（鍵生成用）
 * - simpleHash: 簡易ハッシュ（署名対象のダイジェスト生成用）
 */

/**
 * べき乗剰余: (base^exp) mod mod を効率的に計算する。
 *
 * 繰り返し二乗法（binary exponentiation）を使用し、
 * 巨大な指数でも O(log exp) 回の乗算で計算を完了する。
 * RSAでは暗号化（m^e mod n）や復号（c^d mod n）でこの演算が必要になる。
 *
 * @param base - 底（平文またはメッセージのハッシュ値）
 * @param exp - 指数（公開指数 e または秘密指数 d）
 * @param mod - 法（モジュラス n = p * q）
 * @returns (base^exp) mod mod の計算結果
 */
export function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  // mod が 1 の場合、いかなる数も mod 1 = 0
  if (mod === 1n) return 0n;
  let result = 1n;
  // 負の値にも対応するため、base を正の剰余に正規化する
  base = ((base % mod) + mod) % mod;
  while (exp > 0n) {
    // 繰り返し二乗法: 指数を2進数として分解し、
    // 最下位ビットが1のとき現在の base を結果に掛け合わせる
    if (exp % 2n === 1n) {
      result = (result * base) % mod;
    }
    // 指数を1ビット右シフト（2で割る）
    exp = exp >> 1n;
    // base を二乗して次のビット位置に対応させる
    base = (base * base) % mod;
  }
  return result;
}

/** 最大公約数をユークリッドの互除法で求める */
export function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b !== 0n) {
    const temp = b;
    b = a % b;
    a = temp;
  }
  return a;
}

/** 拡張ユークリッドの互除法でモジュラー逆元を求める */
export function modInverse(a: bigint, mod: bigint): bigint {
  a = ((a % mod) + mod) % mod;
  let [oldR, r] = [a, mod];
  let [oldS, s] = [1n, 0n];

  while (r !== 0n) {
    const quotient = oldR / r;
    [oldR, r] = [r, oldR - quotient * r];
    [oldS, s] = [s, oldS - quotient * s];
  }

  if (oldR !== 1n) {
    throw new Error("モジュラー逆元が存在しません");
  }

  return ((oldS % mod) + mod) % mod;
}

/** 試し割り法で素数判定を行う */
export function isPrime(n: number): boolean {
  if (n < 2) return false;
  if (n < 4) return true;
  if (n % 2 === 0 || n % 3 === 0) return false;
  // 6k +/- 1 の形の数でのみ試し割りする
  for (let i = 5; i * i <= n; i += 6) {
    if (n % i === 0 || n % (i + 2) === 0) return false;
  }
  return true;
}

/** 指定範囲内の素数リストを生成する（エラトステネスの篩） */
export function generatePrimes(min: number, max: number): number[] {
  const primes: number[] = [];
  for (let i = min; i <= max; i++) {
    if (isPrime(i)) {
      primes.push(i);
    }
  }
  return primes;
}

/** 範囲内からランダムな素数を選択する */
export function randomPrime(min: number, max: number): number {
  const primes = generatePrimes(min, max);
  if (primes.length === 0) {
    throw new Error(`範囲 [${min}, ${max}] 内に素数が見つかりません`);
  }
  const index = Math.floor(Math.random() * primes.length);
  const selected = primes[index];
  if (selected === undefined) {
    throw new Error("素数の選択に失敗しました");
  }
  return selected;
}

/** 簡易ハッシュ関数（教育用途。文字列を数値に変換する） */
export function simpleHash(message: string): bigint {
  let hash = 0n;
  for (let i = 0; i < message.length; i++) {
    const ch = BigInt(message.charCodeAt(i));
    hash = (hash * 31n + ch) % 1000000007n;
  }
  return hash;
}
