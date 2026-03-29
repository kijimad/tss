/**
 * UTF-8コーデック
 * 1〜4バイトのエンコード・デコード、継続バイト処理、BOM検出を行う
 */

/** UTF-8のBOM（バイトオーダーマーク）: EF BB BF */
export const UTF8_BOM = new Uint8Array([0xef, 0xbb, 0xbf]);

/**
 * UTF-8エンコードのバイト構造情報
 */
export interface Utf8ByteInfo {
  /** 元のコードポイント */
  codePoint: number;
  /** エンコード後のバイト列 */
  bytes: number[];
  /** バイト数（1〜4） */
  byteCount: number;
  /** 各バイトのビット文字列（ヘッダービットとペイロードビットを区別） */
  bitStructure: Array<{ headerBits: string; payloadBits: string }>;
}

/**
 * 単一のコードポイントをUTF-8バイト列にエンコードする
 */
export function encodeCodePoint(codePoint: number): number[] {
  if (codePoint < 0) {
    throw new RangeError(`無効なコードポイント: ${codePoint}`);
  }
  // 1バイト: U+0000〜U+007F → 0xxxxxxx
  if (codePoint <= 0x7f) {
    return [codePoint];
  }
  // 2バイト: U+0080〜U+07FF → 110xxxxx 10xxxxxx
  if (codePoint <= 0x7ff) {
    return [
      0xc0 | (codePoint >> 6),
      0x80 | (codePoint & 0x3f),
    ];
  }
  // 3バイト: U+0800〜U+FFFF → 1110xxxx 10xxxxxx 10xxxxxx
  if (codePoint <= 0xffff) {
    return [
      0xe0 | (codePoint >> 12),
      0x80 | ((codePoint >> 6) & 0x3f),
      0x80 | (codePoint & 0x3f),
    ];
  }
  // 4バイト: U+10000〜U+10FFFF → 11110xxx 10xxxxxx 10xxxxxx 10xxxxxx
  if (codePoint <= 0x10ffff) {
    return [
      0xf0 | (codePoint >> 18),
      0x80 | ((codePoint >> 12) & 0x3f),
      0x80 | ((codePoint >> 6) & 0x3f),
      0x80 | (codePoint & 0x3f),
    ];
  }
  throw new RangeError(`コードポイントが範囲外: U+${codePoint.toString(16).toUpperCase()}`);
}

/**
 * 文字列をUTF-8バイト列にエンコードする
 */
export function encodeUtf8(text: string, includeBom = false): Uint8Array {
  const bytes: number[] = [];
  // BOMを先頭に追加する場合
  if (includeBom) {
    bytes.push(0xef, 0xbb, 0xbf);
  }
  // 文字列をコードポイント単位で処理（サロゲートペア対応）
  for (const char of text) {
    const cp = char.codePointAt(0);
    if (cp !== undefined) {
      bytes.push(...encodeCodePoint(cp));
    }
  }
  return new Uint8Array(bytes);
}

/**
 * UTF-8バイト列を文字列にデコードする
 */
export function decodeUtf8(bytes: Uint8Array): string {
  let result = "";
  let i = 0;

  // BOMがあればスキップ
  if (hasUtf8Bom(bytes)) {
    i = 3;
  }

  while (i < bytes.length) {
    const byte = bytes[i]!;
    let codePoint: number;
    let bytesNeeded: number;

    if (byte <= 0x7f) {
      // 1バイト文字
      codePoint = byte;
      bytesNeeded = 0;
    } else if ((byte & 0xe0) === 0xc0) {
      // 2バイト文字
      codePoint = byte & 0x1f;
      bytesNeeded = 1;
    } else if ((byte & 0xf0) === 0xe0) {
      // 3バイト文字
      codePoint = byte & 0x0f;
      bytesNeeded = 2;
    } else if ((byte & 0xf8) === 0xf0) {
      // 4バイト文字
      codePoint = byte & 0x07;
      bytesNeeded = 3;
    } else {
      // 不正なバイト → 置換文字
      result += "\uFFFD";
      i++;
      continue;
    }

    // 継続バイトを読み取る
    let valid = true;
    for (let j = 0; j < bytesNeeded; j++) {
      const nextByte = bytes[i + 1 + j];
      if (nextByte === undefined || (nextByte & 0xc0) !== 0x80) {
        valid = false;
        break;
      }
      codePoint = (codePoint << 6) | (nextByte & 0x3f);
    }

    if (valid) {
      result += String.fromCodePoint(codePoint);
      i += 1 + bytesNeeded;
    } else {
      // 不正なシーケンス → 置換文字
      result += "\uFFFD";
      i++;
    }
  }

  return result;
}

/**
 * UTF-8のBOMが存在するかチェックする
 */
export function hasUtf8Bom(bytes: Uint8Array): boolean {
  return bytes.length >= 3
    && bytes[0] === 0xef
    && bytes[1] === 0xbb
    && bytes[2] === 0xbf;
}

/**
 * コードポイントのUTF-8バイト構造を解析する
 * ヘッダービットとペイロードビットを分離して返す
 */
export function analyzeUtf8Structure(codePoint: number): Utf8ByteInfo {
  const bytes = encodeCodePoint(codePoint);
  const byteCount = bytes.length;

  const bitStructure: Array<{ headerBits: string; payloadBits: string }> = [];

  if (byteCount === 1) {
    // 1バイト: 0xxxxxxx
    const b = bytes[0]!;
    bitStructure.push({
      headerBits: "0",
      payloadBits: (b & 0x7f).toString(2).padStart(7, "0"),
    });
  } else if (byteCount === 2) {
    // 先頭バイト: 110xxxxx
    const b0 = bytes[0]!;
    bitStructure.push({
      headerBits: "110",
      payloadBits: (b0 & 0x1f).toString(2).padStart(5, "0"),
    });
    // 継続バイト: 10xxxxxx
    const b1 = bytes[1]!;
    bitStructure.push({
      headerBits: "10",
      payloadBits: (b1 & 0x3f).toString(2).padStart(6, "0"),
    });
  } else if (byteCount === 3) {
    // 先頭バイト: 1110xxxx
    const b0 = bytes[0]!;
    bitStructure.push({
      headerBits: "1110",
      payloadBits: (b0 & 0x0f).toString(2).padStart(4, "0"),
    });
    // 継続バイト: 10xxxxxx × 2
    for (let j = 1; j < 3; j++) {
      const bj = bytes[j]!;
      bitStructure.push({
        headerBits: "10",
        payloadBits: (bj & 0x3f).toString(2).padStart(6, "0"),
      });
    }
  } else {
    // 先頭バイト: 11110xxx
    const b0 = bytes[0]!;
    bitStructure.push({
      headerBits: "11110",
      payloadBits: (b0 & 0x07).toString(2).padStart(3, "0"),
    });
    // 継続バイト: 10xxxxxx × 3
    for (let j = 1; j < 4; j++) {
      const bj = bytes[j]!;
      bitStructure.push({
        headerBits: "10",
        payloadBits: (bj & 0x3f).toString(2).padStart(6, "0"),
      });
    }
  }

  return { codePoint, bytes, byteCount, bitStructure };
}

/**
 * バイト列を16進数ダンプ文字列に変換する
 */
export function hexDump(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).toUpperCase().padStart(2, "0"))
    .join(" ");
}

/**
 * バイト列を2進数ダンプ文字列に変換する
 */
export function binaryDump(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(2).padStart(8, "0"))
    .join(" ");
}
