/**
 * モジュラー算術ユーティリティ
 * RSA暗号の基礎となる数学関数を提供する
 */

/** べき乗剰余: (base^exp) mod mod を効率的に計算する */
export function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  if (mod === 1n) return 0n;
  let result = 1n;
  base = ((base % mod) + mod) % mod;
  while (exp > 0n) {
    // 指数の最下位ビットが1なら結果に掛ける
    if (exp % 2n === 1n) {
      result = (result * base) % mod;
    }
    exp = exp >> 1n;
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
