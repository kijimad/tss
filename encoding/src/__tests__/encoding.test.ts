/**
 * エンコーディングシミュレータのテスト
 * ASCII、UTF-8、UTF-16、Shift_JIS、Unicode、文字化けのテスト
 */

import { describe, it, expect } from "vitest";
import {
  buildAsciiTable,
  encodeAscii,
  decodeAscii,
  isAscii,
  getControlCharName,
  CONTROL_CHAR_NAMES,
} from "../codec/ascii";
import {
  encodeUtf8,
  decodeUtf8,
  encodeCodePoint,
  hasUtf8Bom,
  analyzeUtf8Structure,
  hexDump,
  binaryDump,
  UTF8_BOM,
} from "../codec/utf8";
import {
  encodeUtf16,
  decodeUtf16,
  detectBom,
  analyzeSurrogatePair,
  encodeCodePointUtf16,
  UTF16_BOM_BE,
  UTF16_BOM_LE,
} from "../codec/utf16";
import {
  encodeShiftJis,
  decodeShiftJis,
  isLeadByte,
  isHalfWidthKatakana,
  getAvailableCharacters,
} from "../codec/shiftjis";
import {
  formatCodePoint,
  getBlock,
  getCategory,
  getCodePointInfo,
  analyzeText,
} from "../codec/unicode";
import { simulateMojibake } from "../ui/mojibake";

// ============================================================
// ASCIIコーデックのテスト
// ============================================================
describe("ASCIIコーデック", () => {
  it("ASCIIテーブルは128エントリを持つ", () => {
    const table = buildAsciiTable();
    expect(table).toHaveLength(128);
  });

  it("制御文字名が正しくマッピングされている", () => {
    expect(getControlCharName(0x00)).toBe("NUL");
    expect(getControlCharName(0x07)).toBe("BEL");
    expect(getControlCharName(0x0a)).toBe("LF");
    expect(getControlCharName(0x0d)).toBe("CR");
    expect(getControlCharName(0x1b)).toBe("ESC");
    expect(getControlCharName(0x7f)).toBe("DEL");
    // 制御文字でないもの
    expect(getControlCharName(0x41)).toBeUndefined();
  });

  it("制御文字名マップに33個のエントリがある（0x00-0x1F + DEL）", () => {
    expect(CONTROL_CHAR_NAMES.size).toBe(33);
  });

  it("ASCII文字列をエンコードできる", () => {
    const bytes = encodeAscii("ABC");
    expect(Array.from(bytes)).toEqual([0x41, 0x42, 0x43]);
  });

  it("ASCII範囲外の文字は0x3Fに置換される", () => {
    const bytes = encodeAscii("A日B");
    expect(bytes[0]).toBe(0x41); // A
    expect(bytes[1]).toBe(0x3f); // ? (日は範囲外)
    expect(bytes[2]).toBe(0x42); // B
  });

  it("ASCIIバイト列をデコードできる", () => {
    const text = decodeAscii(new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]));
    expect(text).toBe("Hello");
  });

  it("isAsciiが正しく判定する", () => {
    expect(isAscii("A")).toBe(true);
    expect(isAscii(" ")).toBe(true);
    expect(isAscii("\x00")).toBe(true);
    expect(isAscii("\x7F")).toBe(true);
  });

  it("ASCIIテーブルのエントリが正しい構造を持つ", () => {
    const table = buildAsciiTable();
    // 'A'のエントリを確認
    const entryA = table[0x41]!;
    expect(entryA.code).toBe(0x41);
    expect(entryA.hex).toBe("0x41");
    expect(entryA.display).toBe("A");
    expect(entryA.isControl).toBe(false);

    // NULのエントリを確認
    const entryNul = table[0]!;
    expect(entryNul.display).toBe("NUL");
    expect(entryNul.isControl).toBe(true);
  });
});

// ============================================================
// UTF-8コーデックのテスト
// ============================================================
describe("UTF-8コーデック", () => {
  it("1バイト文字のエンコード: U+0041 (A) → 0x41", () => {
    const bytes = encodeCodePoint(0x0041);
    expect(bytes).toEqual([0x41]);
  });

  it("2バイト文字のエンコード: U+00E9 (é) → 0xC3 0xA9", () => {
    const bytes = encodeCodePoint(0x00e9);
    expect(bytes).toEqual([0xc3, 0xa9]);
  });

  it("3バイト文字のエンコード: U+3042 (あ) → 0xE3 0x81 0x82", () => {
    const bytes = encodeCodePoint(0x3042);
    expect(bytes).toEqual([0xe3, 0x81, 0x82]);
  });

  it("4バイト文字のエンコード: U+1F600 (😀) → 0xF0 0x9F 0x98 0x80", () => {
    const bytes = encodeCodePoint(0x1f600);
    expect(bytes).toEqual([0xf0, 0x9f, 0x98, 0x80]);
  });

  it("文字列のUTF-8エンコード・デコードが往復できる", () => {
    const original = "Hello, あいう 🚀";
    const encoded = encodeUtf8(original);
    const decoded = decodeUtf8(encoded);
    expect(decoded).toBe(original);
  });

  it("BOM付きエンコードが正しい", () => {
    const encoded = encodeUtf8("A", true);
    // BOM(3バイト) + A(1バイト) = 4バイト
    expect(encoded.length).toBe(4);
    expect(encoded[0]).toBe(0xef);
    expect(encoded[1]).toBe(0xbb);
    expect(encoded[2]).toBe(0xbf);
    expect(encoded[3]).toBe(0x41);
  });

  it("BOM付きバイト列のデコードでBOMがスキップされる", () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x41]); // BOM + A
    const decoded = decodeUtf8(bytes);
    expect(decoded).toBe("A");
  });

  it("BOM検出が正しく動作する", () => {
    expect(hasUtf8Bom(UTF8_BOM)).toBe(true);
    expect(hasUtf8Bom(new Uint8Array([0xef, 0xbb]))).toBe(false);
    expect(hasUtf8Bom(new Uint8Array([0x41, 0x42]))).toBe(false);
  });

  it("不正なバイト列のデコードで置換文字が使用される", () => {
    // 不正な継続バイト
    const bytes = new Uint8Array([0xc3, 0x00]); // 2バイト文字の先頭 + 不正な継続バイト
    const decoded = decodeUtf8(bytes);
    expect(decoded).toContain("\uFFFD");
  });

  it("UTF-8ビット構造の解析が正しい", () => {
    // 1バイト文字
    const info1 = analyzeUtf8Structure(0x41);
    expect(info1.byteCount).toBe(1);
    expect(info1.bitStructure[0]!.headerBits).toBe("0");

    // 2バイト文字
    const info2 = analyzeUtf8Structure(0x00e9);
    expect(info2.byteCount).toBe(2);
    expect(info2.bitStructure[0]!.headerBits).toBe("110");
    expect(info2.bitStructure[1]!.headerBits).toBe("10");

    // 3バイト文字
    const info3 = analyzeUtf8Structure(0x3042);
    expect(info3.byteCount).toBe(3);
    expect(info3.bitStructure[0]!.headerBits).toBe("1110");

    // 4バイト文字
    const info4 = analyzeUtf8Structure(0x1f600);
    expect(info4.byteCount).toBe(4);
    expect(info4.bitStructure[0]!.headerBits).toBe("11110");
  });

  it("範囲外のコードポイントでエラーが発生する", () => {
    expect(() => encodeCodePoint(-1)).toThrow("無効なコードポイント");
    expect(() => encodeCodePoint(0x110000)).toThrow("コードポイントが範囲外");
  });

  it("hexDumpが正しいフォーマットを返す", () => {
    const result = hexDump(new Uint8Array([0x48, 0x65, 0x6c]));
    expect(result).toBe("48 65 6C");
  });

  it("binaryDumpが正しいフォーマットを返す", () => {
    const result = binaryDump(new Uint8Array([0x41]));
    expect(result).toBe("01000001");
  });
});

// ============================================================
// UTF-16コーデックのテスト
// ============================================================
describe("UTF-16コーデック", () => {
  it("BMP内の文字をビッグエンディアンでエンコードできる", () => {
    const bytes = encodeUtf16("A", "BE");
    expect(Array.from(bytes)).toEqual([0x00, 0x41]);
  });

  it("BMP内の文字をリトルエンディアンでエンコードできる", () => {
    const bytes = encodeUtf16("A", "LE");
    expect(Array.from(bytes)).toEqual([0x41, 0x00]);
  });

  it("BOM付きエンコード（BE）が正しい", () => {
    const bytes = encodeUtf16("A", "BE", true);
    expect(bytes[0]).toBe(0xfe);
    expect(bytes[1]).toBe(0xff);
    expect(bytes[2]).toBe(0x00);
    expect(bytes[3]).toBe(0x41);
  });

  it("BOM付きエンコード（LE）が正しい", () => {
    const bytes = encodeUtf16("A", "LE", true);
    expect(bytes[0]).toBe(0xff);
    expect(bytes[1]).toBe(0xfe);
    expect(bytes[2]).toBe(0x41);
    expect(bytes[3]).toBe(0x00);
  });

  it("UTF-16エンコード・デコードが往復できる（BE）", () => {
    const original = "Hello, あいう";
    const encoded = encodeUtf16(original, "BE", true);
    const decoded = decodeUtf16(encoded);
    expect(decoded).toBe(original);
  });

  it("UTF-16エンコード・デコードが往復できる（LE）", () => {
    const original = "Hello, あいう";
    const encoded = encodeUtf16(original, "LE", true);
    const decoded = decodeUtf16(encoded);
    expect(decoded).toBe(original);
  });

  it("BOM検出が正しく動作する", () => {
    expect(detectBom(UTF16_BOM_BE)).toBe("BE");
    expect(detectBom(UTF16_BOM_LE)).toBe("LE");
    expect(detectBom(new Uint8Array([0x41, 0x42]))).toBeNull();
    expect(detectBom(new Uint8Array([0xfe]))).toBeNull();
  });

  it("サロゲートペアの解析が正しい（BMP内）", () => {
    const info = analyzeSurrogatePair(0x0041);
    expect(info.needsSurrogate).toBe(false);
    expect(info.highSurrogate).toBe(0);
    expect(info.lowSurrogate).toBe(0);
  });

  it("サロゲートペアの解析が正しい（U+10000以上）", () => {
    // U+1F600 (😀) → D83D DE00
    const info = analyzeSurrogatePair(0x1f600);
    expect(info.needsSurrogate).toBe(true);
    expect(info.highSurrogate).toBe(0xd83d);
    expect(info.lowSurrogate).toBe(0xde00);
  });

  it("サロゲートペア文字のUTF-16エンコードが正しい", () => {
    // U+1F600 → D83D DE00 (BE)
    const bytes = encodeCodePointUtf16(0x1f600, "BE");
    expect(bytes).toEqual([0xd8, 0x3d, 0xde, 0x00]);
  });

  it("サロゲートペア文字のUTF-16エンコード・デコードが往復できる", () => {
    const original = "😀🚀";
    const encoded = encodeUtf16(original, "BE", true);
    const decoded = decodeUtf16(encoded);
    expect(decoded).toBe(original);
  });
});

// ============================================================
// Shift_JISコーデックのテスト
// ============================================================
describe("Shift_JISコーデック", () => {
  it("ASCII文字はそのままエンコードされる", () => {
    const bytes = encodeShiftJis("ABC");
    expect(Array.from(bytes)).toEqual([0x41, 0x42, 0x43]);
  });

  it("ひらがなのエンコードが正しい: あ → 82 A0", () => {
    const bytes = encodeShiftJis("あ");
    expect(Array.from(bytes)).toEqual([0x82, 0xa0]);
  });

  it("漢字のエンコードが正しい: 山 → 8E 52", () => {
    const bytes = encodeShiftJis("山");
    expect(Array.from(bytes)).toEqual([0x8e, 0x52]);
  });

  it("Shift_JISエンコード・デコードが往復できる", () => {
    const original = "あいうえお";
    const encoded = encodeShiftJis(original);
    const decoded = decodeShiftJis(encoded);
    expect(decoded).toBe(original);
  });

  it("テーブルにない文字は?に置換される", () => {
    const bytes = encodeShiftJis("😀"); // 絵文字はテーブルにない
    expect(Array.from(bytes)).toEqual([0x3f]);
  });

  it("ダブルバイト先頭バイトの判定が正しい", () => {
    expect(isLeadByte(0x81)).toBe(true);
    expect(isLeadByte(0x9f)).toBe(true);
    expect(isLeadByte(0xe0)).toBe(true);
    expect(isLeadByte(0xef)).toBe(true);
    expect(isLeadByte(0x41)).toBe(false);
    expect(isLeadByte(0xa0)).toBe(false);
  });

  it("半角カタカナ範囲の判定が正しい", () => {
    expect(isHalfWidthKatakana(0xa1)).toBe(true);
    expect(isHalfWidthKatakana(0xdf)).toBe(true);
    expect(isHalfWidthKatakana(0xa0)).toBe(false);
    expect(isHalfWidthKatakana(0xe0)).toBe(false);
  });

  it("利用可能な文字が50以上ある", () => {
    const chars = getAvailableCharacters();
    expect(chars.length).toBeGreaterThanOrEqual(50);
  });

  it("漢字のエンコード・デコードが往復できる", () => {
    const original = "山川田人日月";
    const encoded = encodeShiftJis(original);
    const decoded = decodeShiftJis(encoded);
    expect(decoded).toBe(original);
  });

  it("混合テキスト（ASCII＋日本語）のエンコード・デコードが往復できる", () => {
    const original = "Hello あいう";
    const encoded = encodeShiftJis(original);
    const decoded = decodeShiftJis(encoded);
    expect(decoded).toBe(original);
  });
});

// ============================================================
// Unicodeデータベースのテスト
// ============================================================
describe("Unicodeデータベース", () => {
  it("コードポイントのフォーマットが正しい", () => {
    expect(formatCodePoint(0x0041)).toBe("U+0041");
    expect(formatCodePoint(0x3042)).toBe("U+3042");
    expect(formatCodePoint(0x1f600)).toBe("U+1F600");
    expect(formatCodePoint(0x0000)).toBe("U+0000");
  });

  it("Unicodeブロックの判定が正しい", () => {
    expect(getBlock(0x0041)).toBe("Basic Latin");
    expect(getBlock(0x3042)).toBe("Hiragana");
    expect(getBlock(0x30a2)).toBe("Katakana");
    expect(getBlock(0x5c71)).toBe("CJK Unified Ideographs");
    expect(getBlock(0x1f600)).toBe("Emoticons");
  });

  it("一般カテゴリの判定が正しい", () => {
    expect(getCategory(0x0041)).toBe("Letter");     // A
    expect(getCategory(0x0030)).toBe("Number");      // 0
    expect(getCategory(0x0021)).toBe("Punctuation"); // !
    expect(getCategory(0x0020)).toBe("Separator");   // space
    expect(getCategory(0x0000)).toBe("Other");       // NUL
    expect(getCategory(0x3042)).toBe("Letter");      // あ
    expect(getCategory(0x1f600)).toBe("Symbol");     // 😀
  });

  it("コードポイント情報が正しく取得できる", () => {
    const info = getCodePointInfo(0x0041);
    expect(info.notation).toBe("U+0041");
    expect(info.name).toBe("LATIN CAPITAL LETTER A");
    expect(info.block).toBe("Basic Latin");
    expect(info.category).toBe("Letter");
    expect(info.character).toBe("A");
  });

  it("テキスト分析が正しく動作する", () => {
    const results = analyzeText("Aあ");
    expect(results).toHaveLength(2);
    expect(results[0]!.codePoint).toBe(0x0041);
    expect(results[1]!.codePoint).toBe(0x3042);
  });

  it("名前が登録されていないコードポイントはnullを返す", () => {
    const info = getCodePointInfo(0x0064); // 'd' は名前未登録
    expect(info.name).toBeNull();
  });

  it("未知のブロックに属するコードポイントはUnknownを返す", () => {
    expect(getBlock(0x0300)).toBe("Unknown");
  });
});

// ============================================================
// 文字化け（Mojibake）のテスト
// ============================================================
describe("文字化けシミュレーション", () => {
  it("同じエンコーディングで符号化・復号すると元に戻る（UTF-8）", () => {
    const result = simulateMojibake("Hello", "utf8", "utf8");
    expect(result.decodedText).toBe("Hello");
  });

  it("同じエンコーディングで符号化・復号すると元に戻る（Shift_JIS）", () => {
    const result = simulateMojibake("あいう", "shiftjis", "shiftjis");
    expect(result.decodedText).toBe("あいう");
  });

  it("UTF-8でエンコードしShift_JISでデコードすると文字化けする", () => {
    const result = simulateMojibake("あ", "utf8", "shiftjis");
    // 元のテキストとは異なるはず
    expect(result.decodedText).not.toBe("あ");
    expect(result.encodedWith).toBe("utf8");
    expect(result.decodedWith).toBe("shiftjis");
    expect(result.originalText).toBe("あ");
  });

  it("中間バイト列が正しいエンコーディングのものである", () => {
    const result = simulateMojibake("A", "utf8", "shiftjis");
    // 'A'のUTF-8は0x41
    expect(result.intermediateBytes[0]).toBe(0x41);
  });

  it("Shift_JISでエンコードしUTF-8でデコードすると文字化けする", () => {
    const result = simulateMojibake("山川", "shiftjis", "utf8");
    // 元のテキストとは異なるはず
    expect(result.decodedText).not.toBe("山川");
  });
});

// ============================================================
// バイトダンプのテスト
// ============================================================
describe("バイトダンプ", () => {
  it("hexDumpが空のバイト列で空文字列を返す", () => {
    expect(hexDump(new Uint8Array([]))).toBe("");
  });

  it("binaryDumpが空のバイト列で空文字列を返す", () => {
    expect(binaryDump(new Uint8Array([]))).toBe("");
  });

  it("hexDumpが複数バイトをスペース区切りで表示する", () => {
    const result = hexDump(new Uint8Array([0xef, 0xbb, 0xbf]));
    expect(result).toBe("EF BB BF");
  });

  it("binaryDumpが8ビット幅で表示する", () => {
    const result = binaryDump(new Uint8Array([0xff, 0x00]));
    expect(result).toBe("11111111 00000000");
  });
});
