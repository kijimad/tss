/**
 * ASCIIコーデック
 *
 * ASCII（American Standard Code for Information Interchange）は、
 * 1963年に制定された7ビットの文字エンコーディング規格である。
 * 合計128文字（0x00〜0x7F）を定義しており、以下の構成となっている:
 *   - 制御文字（0x00〜0x1F, 0x7F）: 通信制御や表示制御に使用される非印字文字（33文字）
 *   - 印字可能文字（0x20〜0x7E）: 英数字、記号、スペースなど（95文字）
 *
 * ASCIIはUTF-8と下位互換性があり、ASCIIの全文字はUTF-8でも同じバイト値で表現される。
 * これにより、ASCII文字のみで構成されたテキストはUTF-8としても有効である。
 *
 * 7ビットのため1バイト（8ビット）の最上位ビットは常に0となる。
 * 例: 'A' = 0x41 = 0b01000001
 */

/**
 * 制御文字の名前マップ（0x00-0x1F および 0x7F）
 *
 * 制御文字はテレタイプ通信の時代に定義されたもので、
 * 印字ではなく通信プロトコルの制御に使用される。
 * 現在でもLF（改行）、CR（復帰）、HT（タブ）、ESC（エスケープシーケンスの開始）
 * などは広く使われている。
 */
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

/**
 * ASCII文字テーブルの1エントリを表すインターフェース
 *
 * ASCIIテーブルの各文字について、コード値・16進数表記・2進数表記・
 * 表示文字（制御文字の場合はその名前）・制御文字フラグを保持する。
 * UIでのASCIIテーブル一覧表示やデバッグに使用される。
 */
export interface AsciiEntry {
  /** コードポイント値（0x00〜0x7F、10進数で0〜127） */
  code: number;
  /** 16進数表記（例: "0x41"） */
  hex: string;
  /** 2進数表記（7ビット幅、例: "1000001"） */
  binary: string;
  /** 印字可能文字はその文字自体、制御文字はその略称（例: "NUL", "LF"） */
  display: string;
  /** 制御文字（非印字文字）であるかどうかのフラグ */
  isControl: boolean;
}

/**
 * 完全なASCIIテーブル（0x00〜0x7F、128エントリ）を生成する
 *
 * 各コードポイントについて以下の情報を含むエントリを生成する:
 *   - 16進数表記（2桁、0埋め）
 *   - 2進数表記（7ビット幅、0埋め。ASCIIは7ビット規格のため）
 *   - 表示用文字列（制御文字は略称、印字可能文字はその文字自体）
 *
 * @returns 128個のAsciiEntryの配列（インデックスがコードポイントに対応）
 */
export function buildAsciiTable(): AsciiEntry[] {
  const table: AsciiEntry[] = [];
  for (let code = 0; code <= 0x7f; code++) {
    const controlName = CONTROL_CHAR_NAMES.get(code);
    const isControl = controlName !== undefined;
    table.push({
      code,
      // 16進数を大文字2桁で表記（例: 0x0A）
      hex: `0x${code.toString(16).toUpperCase().padStart(2, "0")}`,
      // 2進数を7ビット幅で表記（ASCIIは7ビット規格）
      binary: code.toString(2).padStart(7, "0"),
      // 制御文字ならその略称、そうでなければ文字そのもの
      display: isControl ? controlName : String.fromCharCode(code),
      isControl,
    });
  }
  return table;
}

/**
 * 文字列をASCIIバイト列にエンコードする
 *
 * ASCII範囲外の文字（日本語、絵文字など0x80以上のコードポイントを持つ文字）は
 * 0x3F（'?'の文字コード）に置換される。これはASCIIが7ビット（128文字）しか
 * 表現できないためであり、情報が失われる非可逆変換となる。
 *
 * @param text - エンコード対象の文字列
 * @returns ASCIIバイト列（Uint8Array）。各バイトは0x00〜0x7Fまたは0x3F
 */
export function encodeAscii(text: string): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    // ASCII範囲内（0x00〜0x7F）ならそのまま、範囲外は'?'（0x3F）に置換
    bytes.push(code <= 0x7f ? code : 0x3f);
  }
  return new Uint8Array(bytes);
}

/**
 * ASCIIバイト列を文字列にデコードする
 *
 * 0x7Fを超えるバイト（8ビット目が立っているバイト）はASCII規格の範囲外であるため、
 * '?'に置換される。これは文字化けを防ぐための安全な処理である。
 *
 * @param bytes - デコード対象のバイト列
 * @returns デコードされた文字列。範囲外のバイトは'?'として表示される
 */
export function decodeAscii(bytes: Uint8Array): string {
  let result = "";
  for (const byte of bytes) {
    // ASCII範囲内（0x00〜0x7F）ならUnicode文字に変換、範囲外は'?'に置換
    result += byte <= 0x7f ? String.fromCharCode(byte) : "?";
  }
  return result;
}

/**
 * 文字がASCII範囲内（0x00〜0x7F）かどうかを判定する
 *
 * charCodeAtを使用してUTF-16コードユニットを取得し、
 * それが7ビット範囲内に収まるかを確認する。
 * ASCII文字はすべてBMP（基本多言語面）内にあるため、
 * サロゲートペアを考慮する必要はない。
 *
 * @param char - 判定対象の文字（先頭1文字のみ評価）
 * @returns ASCII範囲内であればtrue
 */
export function isAscii(char: string): boolean {
  const code = char.charCodeAt(0);
  return code >= 0 && code <= 0x7f;
}

/**
 * コードポイントから制御文字名を取得する
 *
 * 制御文字（0x00〜0x1Fおよび0x7F）に該当する場合はその略称を返す。
 * 印字可能文字の場合はundefinedを返す。
 *
 * @param code - 確認するASCIIコードポイント
 * @returns 制御文字名（例: "NUL", "LF", "CR"）、または制御文字でない場合はundefined
 */
export function getControlCharName(code: number): string | undefined {
  return CONTROL_CHAR_NAMES.get(code);
}
