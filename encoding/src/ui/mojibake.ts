/**
 * 文字化け（Mojibake）シミュレーション
 * あるエンコーディングで符号化されたバイト列を、別のエンコーディングで復号することで
 * 文字化けを再現する
 */

import { encodeUtf8, decodeUtf8 } from "../codec/utf8";
import { encodeShiftJis, decodeShiftJis } from "../codec/shiftjis";

/** 対応するエンコーディング名 */
export type EncodingName = "utf8" | "shiftjis";

/** 文字化け結果 */
export interface MojibakeResult {
  /** 元のテキスト */
  originalText: string;
  /** エンコードに使用したエンコーディング */
  encodedWith: EncodingName;
  /** デコードに使用したエンコーディング */
  decodedWith: EncodingName;
  /** 中間のバイト列 */
  intermediateBytes: Uint8Array;
  /** 文字化けしたテキスト */
  decodedText: string;
}

/** エンコード関数のマップ */
const encoders: Record<EncodingName, (text: string) => Uint8Array> = {
  utf8: (text: string) => encodeUtf8(text),
  shiftjis: encodeShiftJis,
};

/** デコード関数のマップ */
const decoders: Record<EncodingName, (bytes: Uint8Array) => string> = {
  utf8: decodeUtf8,
  shiftjis: decodeShiftJis,
};

/**
 * 文字化けをシミュレートする
 * encodeAsでエンコードし、decodeAsでデコードすることで文字化けを再現
 */
export function simulateMojibake(
  text: string,
  encodeAs: EncodingName,
  decodeAs: EncodingName,
): MojibakeResult {
  // 指定エンコーディングでバイト列に変換
  const intermediateBytes = encoders[encodeAs](text);
  // 別のエンコーディングで復号（文字化け発生）
  const decodedText = decoders[decodeAs](intermediateBytes);

  return {
    originalText: text,
    encodedWith: encodeAs,
    decodedWith: decodeAs,
    intermediateBytes,
    decodedText,
  };
}
