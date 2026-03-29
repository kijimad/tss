/**
 * UTF-16コーデック
 * BOM検出、サロゲートペア処理、ビッグ/リトルエンディアン対応
 */

/** エンディアンの種類 */
export type Endianness = "BE" | "LE";

/** UTF-16 BOM（ビッグエンディアン）: FE FF */
export const UTF16_BOM_BE = new Uint8Array([0xfe, 0xff]);
/** UTF-16 BOM（リトルエンディアン）: FF FE */
export const UTF16_BOM_LE = new Uint8Array([0xff, 0xfe]);

/**
 * サロゲートペアの情報
 */
export interface SurrogatePairInfo {
  /** 元のコードポイント */
  codePoint: number;
  /** ハイサロゲート（0xD800-0xDBFF） */
  highSurrogate: number;
  /** ローサロゲート（0xDC00-0xDFFF） */
  lowSurrogate: number;
  /** サロゲートペアが必要かどうか */
  needsSurrogate: boolean;
}

/**
 * コードポイントがサロゲートペアを必要とするか判定し、情報を返す
 */
export function analyzeSurrogatePair(codePoint: number): SurrogatePairInfo {
  if (codePoint <= 0xffff) {
    // BMP内の文字 → サロゲートペア不要
    return {
      codePoint,
      highSurrogate: 0,
      lowSurrogate: 0,
      needsSurrogate: false,
    };
  }
  // サロゲートペアを計算（U+10000以上）
  const offset = codePoint - 0x10000;
  const highSurrogate = 0xd800 + (offset >> 10);
  const lowSurrogate = 0xdc00 + (offset & 0x3ff);
  return {
    codePoint,
    highSurrogate,
    lowSurrogate,
    needsSurrogate: true,
  };
}

/**
 * 文字列をUTF-16バイト列にエンコードする
 */
export function encodeUtf16(
  text: string,
  endianness: Endianness = "BE",
  includeBom = false,
): Uint8Array {
  const bytes: number[] = [];

  // BOMを先頭に追加
  if (includeBom) {
    if (endianness === "BE") {
      bytes.push(0xfe, 0xff);
    } else {
      bytes.push(0xff, 0xfe);
    }
  }

  // 文字列のコードユニットを処理（JavaScriptは内部的にUTF-16）
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (endianness === "BE") {
      bytes.push((code >> 8) & 0xff, code & 0xff);
    } else {
      bytes.push(code & 0xff, (code >> 8) & 0xff);
    }
  }

  return new Uint8Array(bytes);
}

/**
 * UTF-16バイト列を文字列にデコードする
 * BOMがあればエンディアンを自動検出する
 */
export function decodeUtf16(
  bytes: Uint8Array,
  defaultEndianness: Endianness = "BE",
): string {
  let endianness = defaultEndianness;
  let offset = 0;

  // BOMを検出してエンディアンを決定
  const bomResult = detectBom(bytes);
  if (bomResult !== null) {
    endianness = bomResult;
    offset = 2; // BOMをスキップ
  }

  let result = "";
  for (let i = offset; i + 1 < bytes.length; i += 2) {
    const b0 = bytes[i]!;
    const b1 = bytes[i + 1]!;
    const codeUnit = endianness === "BE"
      ? (b0 << 8) | b1
      : (b1 << 8) | b0;
    result += String.fromCharCode(codeUnit);
  }

  return result;
}

/**
 * BOMを検出してエンディアンを返す
 * BOMが存在しない場合はnullを返す
 */
export function detectBom(bytes: Uint8Array): Endianness | null {
  if (bytes.length < 2) return null;
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return "BE";
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return "LE";
  return null;
}

/**
 * コードポイントのUTF-16エンコード結果をバイト単位で取得する
 */
export function encodeCodePointUtf16(
  codePoint: number,
  endianness: Endianness = "BE",
): number[] {
  const char = String.fromCodePoint(codePoint);
  const bytes: number[] = [];
  for (let i = 0; i < char.length; i++) {
    const code = char.charCodeAt(i);
    if (endianness === "BE") {
      bytes.push((code >> 8) & 0xff, code & 0xff);
    } else {
      bytes.push(code & 0xff, (code >> 8) & 0xff);
    }
  }
  return bytes;
}
