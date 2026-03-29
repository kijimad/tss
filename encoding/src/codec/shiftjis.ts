/**
 * Shift_JISコーデック
 * シングルバイト（ASCII＋半角カタカナ）、ダブルバイト（JIS X 0208）のエンコード・デコード
 * 完全なテーブルではなく、よく使う文字のサブセットを含む
 */

/**
 * Unicodeコードポイント → Shift_JISバイト列のマッピング（サブセット）
 * ひらがな、カタカナ、常用漢字、記号の一部を含む（50文字以上）
 */
const UNICODE_TO_SJIS: ReadonlyMap<number, number[]> = new Map([
  // ひらがな（あ行〜わ行の一部）
  [0x3042, [0x82, 0xa0]], // あ
  [0x3044, [0x82, 0xa2]], // い
  [0x3046, [0x82, 0xa4]], // う
  [0x3048, [0x82, 0xa6]], // え
  [0x304a, [0x82, 0xa8]], // お
  [0x304b, [0x82, 0xa9]], // か
  [0x304d, [0x82, 0xab]], // き
  [0x304f, [0x82, 0xad]], // く
  [0x3051, [0x82, 0xaf]], // け
  [0x3053, [0x82, 0xb1]], // こ
  [0x3055, [0x82, 0xb3]], // さ
  [0x3057, [0x82, 0xb5]], // し
  [0x3059, [0x82, 0xb7]], // す
  [0x305b, [0x82, 0xb9]], // せ
  [0x305d, [0x82, 0xbb]], // そ
  [0x305f, [0x82, 0xbd]], // た
  [0x3061, [0x82, 0xbf]], // ち
  [0x3064, [0x82, 0xc2]], // つ
  [0x3066, [0x82, 0xc4]], // て
  [0x3068, [0x82, 0xc6]], // と
  [0x306a, [0x82, 0xc8]], // な
  [0x306b, [0x82, 0xc9]], // に
  [0x306c, [0x82, 0xca]], // ぬ
  [0x306d, [0x82, 0xcb]], // ね
  [0x306e, [0x82, 0xcc]], // の
  [0x306f, [0x82, 0xcd]], // は
  [0x3072, [0x82, 0xd0]], // ひ
  [0x3075, [0x82, 0xd3]], // ふ
  [0x3078, [0x82, 0xd6]], // へ
  [0x307b, [0x82, 0xd9]], // ほ
  [0x307e, [0x82, 0xdc]], // ま
  [0x307f, [0x82, 0xdd]], // み
  [0x3080, [0x82, 0xde]], // む
  [0x3081, [0x82, 0xdf]], // め
  [0x3082, [0x82, 0xe0]], // も
  [0x3084, [0x82, 0xe2]], // や
  [0x3086, [0x82, 0xe4]], // ゆ
  [0x3088, [0x82, 0xe6]], // よ
  [0x3089, [0x82, 0xe7]], // ら
  [0x308a, [0x82, 0xe8]], // り
  [0x308b, [0x82, 0xe9]], // る
  [0x308c, [0x82, 0xea]], // れ
  [0x308d, [0x82, 0xeb]], // ろ
  [0x308f, [0x82, 0xed]], // わ
  [0x3092, [0x82, 0xf0]], // を
  [0x3093, [0x82, 0xf1]], // ん

  // カタカナ（一部）
  [0x30a2, [0x83, 0x41]], // ア
  [0x30a4, [0x83, 0x43]], // イ
  [0x30a6, [0x83, 0x45]], // ウ
  [0x30a8, [0x83, 0x47]], // エ
  [0x30aa, [0x83, 0x49]], // オ

  // 常用漢字（一部）
  [0x5c71, [0x8e, 0x52]], // 山
  [0x5ddd, [0x90, 0xec]], // 川
  [0x7530, [0x93, 0x63]], // 田
  [0x4eba, [0x90, 0x6c]], // 人
  [0x65e5, [0x93, 0xfa]], // 日
  [0x6708, [0x8c, 0x8e]], // 月
  [0x706b, [0x89, 0xce]], // 火
  [0x6c34, [0x90, 0x85]], // 水
  [0x6728, [0x96, 0xd8]], // 木
  [0x91d1, [0x8b, 0xe0]], // 金
  [0x571f, [0x93, 0x79]], // 土
  [0x7a7a, [0x8b, 0xf3]], // 空
  [0x82b1, [0x89, 0xd4]], // 花

  // 記号
  [0x3001, [0x81, 0x41]], // 、
  [0x3002, [0x81, 0x42]], // 。
  [0x300c, [0x81, 0x75]], // 「
  [0x300d, [0x81, 0x76]], // 」
]);

/**
 * Shift_JISバイト列 → Unicodeコードポイントの逆引きマップ
 * 初回アクセス時に構築する
 */
let sjisToUnicodeCache: Map<number, number> | null = null;

function getSjisToUnicodeMap(): Map<number, number> {
  if (sjisToUnicodeCache !== null) return sjisToUnicodeCache;

  sjisToUnicodeCache = new Map();
  for (const [unicode, sjisBytes] of UNICODE_TO_SJIS) {
    // ダブルバイトのキーは上位バイト << 8 | 下位バイトで表現
    if (sjisBytes.length === 2) {
      const key = (sjisBytes[0]! << 8) | sjisBytes[1]!;
      sjisToUnicodeCache.set(key, unicode);
    } else if (sjisBytes.length === 1) {
      sjisToUnicodeCache.set(sjisBytes[0]!, unicode);
    }
  }
  return sjisToUnicodeCache;
}

/**
 * Shift_JISのダブルバイト先頭バイトかどうかを判定する
 * 先頭バイトの範囲: 0x81-0x9F, 0xE0-0xEF
 */
export function isLeadByte(byte: number): boolean {
  return (byte >= 0x81 && byte <= 0x9f) || (byte >= 0xe0 && byte <= 0xef);
}

/**
 * 半角カタカナの範囲（0xA1-0xDF）かどうかを判定する
 */
export function isHalfWidthKatakana(byte: number): boolean {
  return byte >= 0xa1 && byte <= 0xdf;
}

/**
 * 文字列をShift_JISバイト列にエンコードする
 * テーブルに存在しない文字は0x3F（?）に置換する
 */
export function encodeShiftJis(text: string): Uint8Array {
  const bytes: number[] = [];
  for (const char of text) {
    const cp = char.codePointAt(0);
    if (cp === undefined) continue;

    // ASCII範囲はそのまま
    if (cp <= 0x7f) {
      bytes.push(cp);
      continue;
    }

    // テーブルから検索
    const sjisBytes = UNICODE_TO_SJIS.get(cp);
    if (sjisBytes !== undefined) {
      bytes.push(...sjisBytes);
    } else {
      // テーブルにない文字は?に置換
      bytes.push(0x3f);
    }
  }
  return new Uint8Array(bytes);
}

/**
 * Shift_JISバイト列を文字列にデコードする
 * テーブルに存在しないバイト列は?に置換する
 */
export function decodeShiftJis(bytes: Uint8Array): string {
  const reverseMap = getSjisToUnicodeMap();
  let result = "";
  let i = 0;

  while (i < bytes.length) {
    const byte = bytes[i]!;

    // ASCII範囲
    if (byte <= 0x7f) {
      result += String.fromCharCode(byte);
      i++;
      continue;
    }

    // 半角カタカナ（0xA1-0xDF）→ Unicode半角カタカナ（U+FF61-U+FF9F）
    if (isHalfWidthKatakana(byte)) {
      result += String.fromCharCode(0xff61 + (byte - 0xa1));
      i++;
      continue;
    }

    // ダブルバイト文字
    if (isLeadByte(byte)) {
      const nextByte = bytes[i + 1];
      if (nextByte !== undefined) {
        const key = (byte << 8) | nextByte;
        const unicode = reverseMap.get(key);
        if (unicode !== undefined) {
          result += String.fromCodePoint(unicode);
        } else {
          result += "?";
        }
        i += 2;
        continue;
      }
    }

    // 不明なバイト
    result += "?";
    i++;
  }

  return result;
}

/**
 * テーブルに含まれる文字のリストを取得する（デモ用）
 */
export function getAvailableCharacters(): Array<{ char: string; codePoint: number; sjisBytes: number[] }> {
  const chars: Array<{ char: string; codePoint: number; sjisBytes: number[] }> = [];
  for (const [cp, sjisBytes] of UNICODE_TO_SJIS) {
    chars.push({
      char: String.fromCodePoint(cp),
      codePoint: cp,
      sjisBytes: [...sjisBytes],
    });
  }
  return chars;
}
