/**
 * Unicodeデータベースのサブセット
 * コードポイント → 名前、ブロック、カテゴリの情報を提供する
 */

/** Unicodeブロック情報 */
export interface UnicodeBlockInfo {
  /** ブロック名 */
  name: string;
  /** 開始コードポイント */
  start: number;
  /** 終了コードポイント */
  end: number;
}

/** Unicodeの主要ブロック定義 */
export const UNICODE_BLOCKS: readonly UnicodeBlockInfo[] = [
  { name: "Basic Latin", start: 0x0000, end: 0x007f },
  { name: "Latin-1 Supplement", start: 0x0080, end: 0x00ff },
  { name: "Latin Extended-A", start: 0x0100, end: 0x017f },
  { name: "Latin Extended-B", start: 0x0180, end: 0x024f },
  { name: "Greek and Coptic", start: 0x0370, end: 0x03ff },
  { name: "Cyrillic", start: 0x0400, end: 0x04ff },
  { name: "Arabic", start: 0x0600, end: 0x06ff },
  { name: "Devanagari", start: 0x0900, end: 0x097f },
  { name: "Thai", start: 0x0e00, end: 0x0e7f },
  { name: "Hiragana", start: 0x3040, end: 0x309f },
  { name: "Katakana", start: 0x30a0, end: 0x30ff },
  { name: "CJK Unified Ideographs", start: 0x4e00, end: 0x9fff },
  { name: "Hangul Syllables", start: 0xac00, end: 0xd7af },
  { name: "CJK Compatibility Ideographs", start: 0xf900, end: 0xfaff },
  { name: "Halfwidth and Fullwidth Forms", start: 0xff00, end: 0xffef },
  { name: "Emoticons", start: 0x1f600, end: 0x1f64f },
  { name: "Miscellaneous Symbols and Pictographs", start: 0x1f300, end: 0x1f5ff },
  { name: "Transport and Map Symbols", start: 0x1f680, end: 0x1f6ff },
  { name: "Supplemental Symbols and Pictographs", start: 0x1f900, end: 0x1f9ff },
];

/** 代表的な文字の名前マッピング（サブセット） */
const CHARACTER_NAMES: ReadonlyMap<number, string> = new Map([
  [0x0000, "NULL"],
  [0x0009, "CHARACTER TABULATION"],
  [0x000a, "LINE FEED"],
  [0x000d, "CARRIAGE RETURN"],
  [0x0020, "SPACE"],
  [0x0021, "EXCLAMATION MARK"],
  [0x0041, "LATIN CAPITAL LETTER A"],
  [0x0042, "LATIN CAPITAL LETTER B"],
  [0x0043, "LATIN CAPITAL LETTER C"],
  [0x0061, "LATIN SMALL LETTER A"],
  [0x0062, "LATIN SMALL LETTER B"],
  [0x0063, "LATIN SMALL LETTER C"],
  [0x0030, "DIGIT ZERO"],
  [0x0031, "DIGIT ONE"],
  [0x00e9, "LATIN SMALL LETTER E WITH ACUTE"],
  [0x00fc, "LATIN SMALL LETTER U WITH DIAERESIS"],
  [0x3042, "HIRAGANA LETTER A"],
  [0x3044, "HIRAGANA LETTER I"],
  [0x3046, "HIRAGANA LETTER U"],
  [0x3048, "HIRAGANA LETTER E"],
  [0x304a, "HIRAGANA LETTER O"],
  [0x30a2, "KATAKANA LETTER A"],
  [0x30a4, "KATAKANA LETTER I"],
  [0x30a6, "KATAKANA LETTER U"],
  [0x4eba, "CJK UNIFIED IDEOGRAPH-4EBA"],  // 人
  [0x5c71, "CJK UNIFIED IDEOGRAPH-5C71"],  // 山
  [0x65e5, "CJK UNIFIED IDEOGRAPH-65E5"],  // 日
  [0x6708, "CJK UNIFIED IDEOGRAPH-6708"],  // 月
  [0x1f600, "GRINNING FACE"],
  [0x1f60a, "SMILING FACE WITH SMILING EYES"],
  [0x1f680, "ROCKET"],
]);

/** Unicode一般カテゴリ */
export type GeneralCategory =
  | "Letter"
  | "Mark"
  | "Number"
  | "Punctuation"
  | "Symbol"
  | "Separator"
  | "Other";

/** コードポイントの詳細情報 */
export interface CodePointInfo {
  /** コードポイント値 */
  codePoint: number;
  /** U+XXXX形式の表記 */
  notation: string;
  /** 文字名（わかる場合） */
  name: string | null;
  /** 所属ブロック */
  block: string;
  /** 一般カテゴリ */
  category: GeneralCategory;
  /** 文字の表示 */
  character: string;
}

/**
 * コードポイントをU+XXXX形式の文字列に変換する
 * BMP内（U+0000-U+FFFF）は4桁、BMP外は5桁以上で表示
 */
export function formatCodePoint(codePoint: number): string {
  const hex = codePoint.toString(16).toUpperCase();
  const padded = hex.length <= 4 ? hex.padStart(4, "0") : hex;
  return `U+${padded}`;
}

/**
 * コードポイントが属するUnicodeブロックを取得する
 */
export function getBlock(codePoint: number): string {
  for (const block of UNICODE_BLOCKS) {
    if (codePoint >= block.start && codePoint <= block.end) {
      return block.name;
    }
  }
  return "Unknown";
}

/**
 * コードポイントの一般カテゴリを推定する
 * 厳密なUnicodeデータベースではなく、範囲ベースの簡易判定
 */
export function getCategory(codePoint: number): GeneralCategory {
  // 制御文字
  if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) {
    return "Other";
  }
  // 数字
  if (codePoint >= 0x30 && codePoint <= 0x39) {
    return "Number";
  }
  // 基本ラテン文字
  if (
    (codePoint >= 0x41 && codePoint <= 0x5a) ||
    (codePoint >= 0x61 && codePoint <= 0x7a)
  ) {
    return "Letter";
  }
  // ひらがな・カタカナ
  if (
    (codePoint >= 0x3040 && codePoint <= 0x309f) ||
    (codePoint >= 0x30a0 && codePoint <= 0x30ff)
  ) {
    return "Letter";
  }
  // CJK統合漢字
  if (codePoint >= 0x4e00 && codePoint <= 0x9fff) {
    return "Letter";
  }
  // ラテン拡張
  if (codePoint >= 0x00c0 && codePoint <= 0x024f) {
    return "Letter";
  }
  // 句読点・記号（ASCII範囲）
  if (
    (codePoint >= 0x21 && codePoint <= 0x2f) ||
    (codePoint >= 0x3a && codePoint <= 0x40) ||
    (codePoint >= 0x5b && codePoint <= 0x60) ||
    (codePoint >= 0x7b && codePoint <= 0x7e)
  ) {
    return "Punctuation";
  }
  // 空白
  if (codePoint === 0x20 || codePoint === 0x3000) {
    return "Separator";
  }
  // 絵文字
  if (codePoint >= 0x1f300 && codePoint <= 0x1f9ff) {
    return "Symbol";
  }
  return "Letter";
}

/**
 * コードポイントの詳細情報を取得する
 */
export function getCodePointInfo(codePoint: number): CodePointInfo {
  return {
    codePoint,
    notation: formatCodePoint(codePoint),
    name: CHARACTER_NAMES.get(codePoint) ?? null,
    block: getBlock(codePoint),
    category: getCategory(codePoint),
    character: String.fromCodePoint(codePoint),
  };
}

/**
 * 文字列内の全コードポイントの情報を取得する
 */
export function analyzeText(text: string): CodePointInfo[] {
  const results: CodePointInfo[] = [];
  for (const char of text) {
    const cp = char.codePointAt(0);
    if (cp !== undefined) {
      results.push(getCodePointInfo(cp));
    }
  }
  return results;
}
