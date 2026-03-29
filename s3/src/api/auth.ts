/**
 * AWS Signature V4シミュレーションモジュール
 * アクセスキー/シークレットキー管理、正規リクエスト生成、署名チェーン、署名付きURL生成
 */

/** AWS認証情報 */
export interface AWSCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service: string;
}

/** 署名付きURLのパラメータ */
export interface PresignedUrlParams {
  method: string;
  bucket: string;
  key: string;
  expiresIn: number;
  credentials: AWSCredentials;
}

/** 署名付きURLの結果 */
export interface PresignedUrlResult {
  url: string;
  expiresAt: Date;
}

/**
 * HMAC-SHA256を計算する（Web Crypto APIベース）
 * テスト環境ではNode.jsのcryptoを使用
 */
async function hmacSha256(key: Uint8Array, message: string): Promise<Uint8Array> {
  // Node.js環境でのcrypto対応
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.subtle) {
    const cryptoKey = await globalThis.crypto.subtle.importKey(
      'raw',
      key,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const sig = await globalThis.crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(message));
    return new Uint8Array(sig);
  }
  // フォールバック: 簡易実装
  return simpleHmac(key, message);
}

/** SHA-256ハッシュを計算する */
async function sha256(message: string): Promise<string> {
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.subtle) {
    const data = new TextEncoder().encode(message);
    const hash = await globalThis.crypto.subtle.digest('SHA-256', data);
    return hexEncode(new Uint8Array(hash));
  }
  return simpleHash(message);
}

/** バイト配列を16進文字列に変換する */
function hexEncode(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** 簡易HMACフォールバック（テスト用） */
function simpleHmac(key: Uint8Array, message: string): Uint8Array {
  const msgBytes = new TextEncoder().encode(message);
  const result = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    const k = key[i % key.length] ?? 0;
    const m = msgBytes[i % msgBytes.length] ?? 0;
    result[i] = (k ^ m) & 0xff;
  }
  return result;
}

/** 簡易ハッシュフォールバック（テスト用） */
function simpleHash(message: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < message.length; i++) {
    hash ^= message.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0').repeat(8);
}

/** 日付をAWS形式のISO文字列に変換する */
export function toAWSDateString(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

/** 日付をAWSの日付部分のみに変換する */
export function toAWSDateOnly(date: Date): string {
  return toAWSDateString(date).slice(0, 8);
}

/** URIエンコード（AWS仕様） */
export function awsUriEncode(str: string, encodeSlash = true): string {
  let encoded = '';
  for (const ch of str) {
    if (
      (ch >= 'A' && ch <= 'Z') ||
      (ch >= 'a' && ch <= 'z') ||
      (ch >= '0' && ch <= '9') ||
      ch === '_' ||
      ch === '-' ||
      ch === '~' ||
      ch === '.'
    ) {
      encoded += ch;
    } else if (ch === '/' && !encodeSlash) {
      encoded += ch;
    } else {
      const bytes = new TextEncoder().encode(ch);
      for (const b of bytes) {
        encoded += `%${b.toString(16).toUpperCase().padStart(2, '0')}`;
      }
    }
  }
  return encoded;
}

/** 正規リクエストを生成する */
export function createCanonicalRequest(
  method: string,
  uri: string,
  queryString: string,
  headers: Record<string, string>,
  payloadHash: string,
): string {
  // ヘッダーをソートして正規化
  const sortedHeaders = Object.entries(headers)
    .map(([k, v]) => [k.toLowerCase(), v.trim()] as const)
    .sort(([a], [b]) => a.localeCompare(b));

  const canonicalHeaders = sortedHeaders.map(([k, v]) => `${k}:${v}`).join('\n') + '\n';
  const signedHeaders = sortedHeaders.map(([k]) => k).join(';');

  return [method, awsUriEncode(uri, false), queryString, canonicalHeaders, signedHeaders, payloadHash].join('\n');
}

/** 署名文字列を生成する */
export function createStringToSign(dateTime: string, scope: string, canonicalRequestHash: string): string {
  return ['AWS4-HMAC-SHA256', dateTime, scope, canonicalRequestHash].join('\n');
}

/** 署名キーを導出する（HMAC連鎖） */
export async function deriveSigningKey(
  secretKey: string,
  dateStamp: string,
  region: string,
  service: string,
): Promise<Uint8Array> {
  const kSecret = new TextEncoder().encode(`AWS4${secretKey}`);
  const kDate = await hmacSha256(kSecret, dateStamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  return hmacSha256(kService, 'aws4_request');
}

/** リクエストに署名する */
export async function signRequest(
  method: string,
  uri: string,
  queryString: string,
  headers: Record<string, string>,
  payload: string,
  credentials: AWSCredentials,
  date: Date,
): Promise<string> {
  const dateTime = toAWSDateString(date);
  const dateStamp = toAWSDateOnly(date);
  const scope = `${dateStamp}/${credentials.region}/${credentials.service}/aws4_request`;
  const payloadHash = await sha256(payload);
  const canonicalRequest = createCanonicalRequest(method, uri, queryString, headers, payloadHash);
  const canonicalRequestHash = await sha256(canonicalRequest);
  const stringToSign = createStringToSign(dateTime, scope, canonicalRequestHash);
  const signingKey = await deriveSigningKey(credentials.secretAccessKey, dateStamp, credentials.region, credentials.service);
  const signatureBytes = await hmacSha256(signingKey, stringToSign);
  return hexEncode(signatureBytes);
}

/** 署名付きURLを生成する */
export function generatePresignedUrl(params: PresignedUrlParams): PresignedUrlResult {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + params.expiresIn * 1000);
  const dateTime = toAWSDateString(now);
  const dateStamp = toAWSDateOnly(now);
  const scope = `${dateStamp}/${params.credentials.region}/${params.credentials.service}/aws4_request`;
  const credential = `${params.credentials.accessKeyId}/${scope}`;

  const queryParams = new URLSearchParams({
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': credential,
    'X-Amz-Date': dateTime,
    'X-Amz-Expires': params.expiresIn.toString(),
    'X-Amz-SignedHeaders': 'host',
    'X-Amz-Signature': 'SIMULATED_SIGNATURE',
  });

  const host = `${params.bucket}.s3.${params.credentials.region}.amazonaws.com`;
  const encodedKey = awsUriEncode(params.key, false);
  const url = `https://${host}/${encodedKey}?${queryParams.toString()}`;

  return { url, expiresAt };
}
