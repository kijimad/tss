/**
 * ASCIIコーデック
 * 0x00-0x7Fの範囲でエンコード・デコードを行う
 */

/** 制御文字の名前マップ（0x00-0x1F および 0x7F） */
export const CONTROL_CHAR_NAMES: ReadonlyMap<number, string> = new Map([
  [0x00, "NUL"], [0x01, "SOH"], [0x02, "STX"], [0x03, "ETX"],
  [0x04, "EOT"], [0x05, "ENQ"], [0x06, "ACK"], [0x07, "BEL"],
  [0x08, "BS"],  [0x09, "HT"],  [0x0a, "LF"],  [0x0b, "VT"],
  [0x0c, "FF"],  [0x0d, "CR"],  [0x0e, "SO"],  [0x0f, "SI"],
  [0x10, "DLE"], [0x11, "DC1"], [0x12, "DC2"], [0x13, "DC3"],
  [0x14, "DC4"], [0x15, "NAK"], [0x16, "SYN"], [0x17, "ETB"],
  [0x18, "CAN"], [0x19, "EM"],  [0x1a, "SUB"], [0x1b, "ESC"],
  [0x1c, "FS"],  [0x1d, "GS"],  [0x1e, "RS"],  [0x1f, "US"],
  [0x7f, "DEL"],
]);

/** ASCII文字テーブルのエントリ */
export interface AsciiEntry {
  /** コードポイント（0x00-0x7F） */
  code: number;
  /** 16進数表記 */
  hex: string;
  /** 2進数表記 */
  binary: string;
  /** 表示文字または制御文字名 */
  display: string;
  /** 制御文字かどうか */
  isControl: boolean;
}

/**
 * 完全なASCIIテーブル（0x00-0x7F）を生成する
 */
export function buildAsciiTable(): AsciiEntry[] {
  const table: AsciiEntry[] = [];
  for (let code = 0; code <= 0x7f; code++) {
    const controlName = CONTROL_CHAR_NAMES.get(code);
    const isControl = controlName !== undefined;
    table.push({
      code,
      hex: `0x${code.toString(16).toUpperCase().padStart(2, "0")}`,
      binary: code.toString(2).padStart(7, "0"),
      display: isControl ? controlName : String.fromCharCode(code),
      isControl,
    });
  }
  return table;
}

/**
 * 文字列をASCIIバイト列にエンコードする
 * ASCII範囲外の文字は0x3F（?）に置換する
 */
export function encodeAscii(text: string): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    // ASCII範囲内ならそのまま、範囲外は?に置換
    bytes.push(code <= 0x7f ? code : 0x3f);
  }
  return new Uint8Array(bytes);
}

/**
 * ASCIIバイト列を文字列にデコードする
 * 0x7Fを超えるバイトは?に置換する
 */
export function decodeAscii(bytes: Uint8Array): string {
  let result = "";
  for (const byte of bytes) {
    // ASCII範囲内ならそのまま、範囲外は?に置換
    result += byte <= 0x7f ? String.fromCharCode(byte) : "?";
  }
  return result;
}

/**
 * 文字がASCII範囲内かどうかを判定する
 */
export function isAscii(char: string): boolean {
  const code = char.charCodeAt(0);
  return code >= 0 && code <= 0x7f;
}

/**
 * コードポイントから制御文字名を取得する
 * 制御文字でない場合はundefinedを返す
 */
export function getControlCharName(code: number): string | undefined {
  return CONTROL_CHAR_NAMES.get(code);
}
