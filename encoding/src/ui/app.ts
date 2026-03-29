/**
 * エンコーディングシミュレータUI
 * Node.jsシミュレータのUIパターンに準拠
 */

import { buildAsciiTable, encodeAscii, CONTROL_CHAR_NAMES } from "../codec/ascii";
import { encodeUtf8, hexDump, binaryDump, analyzeUtf8Structure } from "../codec/utf8";
import { encodeUtf16, analyzeSurrogatePair, type Endianness } from "../codec/utf16";
import { encodeShiftJis } from "../codec/shiftjis";
import { analyzeText, formatCodePoint } from "../codec/unicode";
import { simulateMojibake, type EncodingName } from "./mojibake";

/** サンプル定義 */
const EXAMPLES: { name: string; input: string }[] = [
  {
    name: 'ASCII文字 (Hello)',
    input: "Hello",
  },
  {
    name: "日本語 UTF-8 (あいう)",
    input: "あいう",
  },
  {
    name: "絵文字 UTF-8 (😀)",
    input: "😀",
  },
  {
    name: "UTF-16 サロゲートペア",
    input: "😀",
  },
  {
    name: "UTF-16 BOM (ビッグエンディアン)",
    input: "ABC",
  },
  {
    name: "Shift_JIS (漢字)",
    input: "山川田",
  },
  {
    name: "文字化け (UTF-8→Shift_JIS)",
    input: "日本語テスト",
  },
  {
    name: "文字化け (Shift_JIS→UTF-8)",
    input: "山川",
  },
  {
    name: "エンコード比較 (全形式)",
    input: "Aあ山😀",
  },
  {
    name: "ASCII制御文字",
    input: "",
  },
];

/** HTMLエスケープ */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** バイト配列を16進文字列に変換 */
function toHex(bytes: Uint8Array): string {
  return hexDump(bytes);
}

export class EncodingApp {
  init(container: HTMLElement): void {
    container.style.cssText = "display:flex;flex-direction:column;height:100vh;font-family:system-ui;background:#0f172a;color:#e2e8f0;";

    // ヘッダ
    const header = document.createElement("div");
    header.style.cssText = "padding:8px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #1e293b;flex-wrap:wrap;";
    const title = document.createElement("h1");
    title.textContent = "Encoding Simulator";
    title.style.cssText = "margin:0;font-size:15px;color:#68d391;";
    header.appendChild(title);

    // サンプル選択ドロップダウン
    const select = document.createElement("select");
    select.style.cssText = "padding:4px 8px;background:#1e293b;border:1px solid #334155;border-radius:4px;color:#f8fafc;font-size:12px;";
    for (let i = 0; i < EXAMPLES.length; i++) {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = EXAMPLES[i]?.name ?? "";
      select.appendChild(opt);
    }
    header.appendChild(select);

    // 実行ボタン
    const runBtn = document.createElement("button");
    runBtn.textContent = "Run";
    runBtn.style.cssText = "padding:4px 16px;background:#68d391;color:#0f172a;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;";
    header.appendChild(runBtn);
    container.appendChild(header);

    // メインエリア
    const main = document.createElement("div");
    main.style.cssText = "flex:1;display:flex;overflow:hidden;";

    // 左パネル: テキスト入力
    const leftPanel = document.createElement("div");
    leftPanel.style.cssText = "flex:1;display:flex;flex-direction:column;border-right:1px solid #1e293b;";

    const codeLabel = document.createElement("div");
    codeLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#68d391;border-bottom:1px solid #1e293b;";
    codeLabel.textContent = "テキスト入力";
    leftPanel.appendChild(codeLabel);

    const textArea = document.createElement("textarea");
    textArea.style.cssText = "flex:1;padding:12px;font-family:'Fira Code',monospace;font-size:13px;background:#0f172a;color:#e2e8f0;border:none;outline:none;resize:none;tab-size:2;";
    textArea.spellcheck = false;
    textArea.value = EXAMPLES[0]?.input ?? "";
    leftPanel.appendChild(textArea);
    main.appendChild(leftPanel);

    // 右パネル: 結果表示
    const rightPanel = document.createElement("div");
    rightPanel.style.cssText = "flex:1;display:flex;flex-direction:column;";

    // 結果ラベル
    const outLabel = document.createElement("div");
    outLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#68d391;border-bottom:1px solid #1e293b;";
    outLabel.textContent = "エンコーディング結果";
    rightPanel.appendChild(outLabel);

    // 結果出力エリア
    const outputDiv = document.createElement("div");
    outputDiv.style.cssText = "flex:1;padding:12px;font-family:monospace;font-size:13px;overflow-y:auto;white-space:pre-wrap;border-bottom:1px solid #1e293b;";
    rightPanel.appendChild(outputDiv);

    // 詳細トレースエリア
    const detailLabel = document.createElement("div");
    detailLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#f59e0b;border-bottom:1px solid #1e293b;";
    detailLabel.textContent = "詳細分析";
    rightPanel.appendChild(detailLabel);

    const detailDiv = document.createElement("div");
    detailDiv.style.cssText = "flex:1;padding:8px 12px;font-family:monospace;font-size:10px;overflow-y:auto;";
    rightPanel.appendChild(detailDiv);

    main.appendChild(rightPanel);
    container.appendChild(main);

    // サンプル選択時の入力更新
    select.addEventListener("change", () => {
      const ex = EXAMPLES[Number(select.value)];
      if (ex !== undefined) textArea.value = ex.input;
    });

    // 実行ボタンのクリック処理
    runBtn.addEventListener("click", () => {
      outputDiv.innerHTML = "";
      detailDiv.innerHTML = "";

      const selectedIndex = Number(select.value);
      const exampleName = EXAMPLES[selectedIndex]?.name ?? "";
      const text = textArea.value;

      // サンプルに応じた処理を実行
      if (exampleName.startsWith("ASCII文字")) {
        renderAsciiEncode(text, outputDiv, detailDiv);
      } else if (exampleName.startsWith("日本語 UTF-8")) {
        renderUtf8Japanese(text, outputDiv, detailDiv);
      } else if (exampleName.startsWith("絵文字 UTF-8")) {
        renderUtf8Emoji(text, outputDiv, detailDiv);
      } else if (exampleName.startsWith("UTF-16 サロゲートペア")) {
        renderUtf16Surrogate(text, outputDiv, detailDiv);
      } else if (exampleName.startsWith("UTF-16 BOM")) {
        renderUtf16Bom(text, outputDiv, detailDiv);
      } else if (exampleName.startsWith("Shift_JIS")) {
        renderShiftJis(text, outputDiv, detailDiv);
      } else if (exampleName === "文字化け (UTF-8→Shift_JIS)") {
        renderMojibake(text, "utf8", "shiftjis", outputDiv, detailDiv);
      } else if (exampleName === "文字化け (Shift_JIS→UTF-8)") {
        renderMojibake(text, "shiftjis", "utf8", outputDiv, detailDiv);
      } else if (exampleName.startsWith("エンコード比較")) {
        renderComparison(text, outputDiv, detailDiv);
      } else if (exampleName.startsWith("ASCII制御文字")) {
        renderAsciiControlChars(outputDiv, detailDiv);
      } else {
        // デフォルト: UTF-8エンコード結果を表示
        renderUtf8Japanese(text, outputDiv, detailDiv);
      }
    });

    // 初回実行
    runBtn.click();
  }
}

/** ASCII文字のエンコード結果表示 */
function renderAsciiEncode(text: string, outputDiv: HTMLElement, detailDiv: HTMLElement): void {
  const bytes = encodeAscii(text);

  appendLine(outputDiv, `入力テキスト: "${escapeHtml(text)}"`, "#e2e8f0");
  appendLine(outputDiv, `文字数: ${text.length}`, "#94a3b8");
  appendLine(outputDiv, "", "#e2e8f0");
  appendLine(outputDiv, `ASCII バイト列: ${toHex(bytes)}`, "#68d391");
  appendLine(outputDiv, `バイト数: ${String(bytes.length)}`, "#94a3b8");

  // 詳細: 各文字のバイト値
  appendLine(detailDiv, "--- 文字ごとのASCIIバイト ---", "#475569");
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    const code = ch.charCodeAt(0);
    const hex = code.toString(16).toUpperCase().padStart(2, "0");
    appendLine(detailDiv, `  '${escapeHtml(ch)}' → 0x${hex} (${String(code)})`, "#e2e8f0");
  }
}

/** 日本語UTF-8エンコード結果表示 */
function renderUtf8Japanese(text: string, outputDiv: HTMLElement, detailDiv: HTMLElement): void {
  const bytes = encodeUtf8(text);

  appendLine(outputDiv, `入力テキスト: "${escapeHtml(text)}"`, "#e2e8f0");
  appendLine(outputDiv, "", "#e2e8f0");
  appendLine(outputDiv, `UTF-8 バイト列: ${toHex(bytes)}`, "#68d391");
  appendLine(outputDiv, `バイト数: ${String(bytes.length)}`, "#94a3b8");
  appendLine(outputDiv, `バイナリ: ${binaryDump(bytes)}`, "#64748b");

  // 詳細: 各文字のUTF-8構造
  appendLine(detailDiv, "--- 文字ごとのUTF-8構造 ---", "#475569");
  for (const char of text) {
    const cp = char.codePointAt(0);
    if (cp === undefined) continue;
    const info = analyzeUtf8Structure(cp);
    const hexStr = info.bytes.map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join(" ");
    const bitStr = info.bitStructure
      .map((b) => `[${b.headerBits}|${b.payloadBits}]`)
      .join(" ");
    appendLine(detailDiv, `  '${escapeHtml(char)}' ${formatCodePoint(cp)} → ${hexStr} (${String(info.byteCount)}バイト)`, "#e2e8f0");
    appendLine(detailDiv, `    ビット構造: ${bitStr}`, "#94a3b8");
  }
}

/** 絵文字UTF-8エンコード結果表示 */
function renderUtf8Emoji(text: string, outputDiv: HTMLElement, detailDiv: HTMLElement): void {
  const bytes = encodeUtf8(text);

  appendLine(outputDiv, `入力テキスト: "${escapeHtml(text)}"`, "#e2e8f0");
  appendLine(outputDiv, "", "#e2e8f0");
  appendLine(outputDiv, `UTF-8 バイト列: ${toHex(bytes)}`, "#68d391");
  appendLine(outputDiv, `バイト数: ${String(bytes.length)} (4バイトエンコーディング)`, "#94a3b8");

  // 詳細: コードポイントとバイト構造
  appendLine(detailDiv, "--- 絵文字のUTF-8エンコード詳細 ---", "#475569");
  for (const char of text) {
    const cp = char.codePointAt(0);
    if (cp === undefined) continue;
    const info = analyzeUtf8Structure(cp);
    const hexStr = info.bytes.map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join(" ");
    const bitStr = info.bitStructure
      .map((b) => `[${b.headerBits}|${b.payloadBits}]`)
      .join(" ");
    appendLine(detailDiv, `  '${escapeHtml(char)}' コードポイント: ${formatCodePoint(cp)}`, "#f59e0b");
    appendLine(detailDiv, `    UTF-8バイト: ${hexStr}`, "#e2e8f0");
    appendLine(detailDiv, `    ビット構造: ${bitStr}`, "#94a3b8");
    appendLine(detailDiv, `    バイト数: ${String(info.byteCount)}`, "#64748b");
  }
}

/** UTF-16サロゲートペア表示 */
function renderUtf16Surrogate(text: string, outputDiv: HTMLElement, detailDiv: HTMLElement): void {
  const bytesBe = encodeUtf16(text, "BE" as Endianness);

  appendLine(outputDiv, `入力テキスト: "${escapeHtml(text)}"`, "#e2e8f0");
  appendLine(outputDiv, "", "#e2e8f0");
  appendLine(outputDiv, `UTF-16 BE バイト列: ${toHex(bytesBe)}`, "#68d391");
  appendLine(outputDiv, `バイト数: ${String(bytesBe.length)}`, "#94a3b8");

  // 詳細: サロゲートペアの分析
  appendLine(detailDiv, "--- サロゲートペア分析 ---", "#475569");
  for (const char of text) {
    const cp = char.codePointAt(0);
    if (cp === undefined) continue;
    const spInfo = analyzeSurrogatePair(cp);
    appendLine(detailDiv, `  '${escapeHtml(char)}' ${formatCodePoint(cp)}`, "#f59e0b");
    if (spInfo.needsSurrogate) {
      const high = spInfo.highSurrogate.toString(16).toUpperCase();
      const low = spInfo.lowSurrogate.toString(16).toUpperCase();
      appendLine(detailDiv, `    サロゲートペア必要: はい`, "#e2e8f0");
      appendLine(detailDiv, `    ハイサロゲート: 0x${high} (U+D800-U+DBFF)`, "#3b82f6");
      appendLine(detailDiv, `    ローサロゲート: 0x${low} (U+DC00-U+DFFF)`, "#8b5cf6");
    } else {
      appendLine(detailDiv, `    サロゲートペア必要: いいえ (BMP内)`, "#e2e8f0");
    }
  }
}

/** UTF-16 BOM表示 */
function renderUtf16Bom(text: string, outputDiv: HTMLElement, detailDiv: HTMLElement): void {
  const bytesBeWithBom = encodeUtf16(text, "BE" as Endianness, true);
  const bytesLeWithBom = encodeUtf16(text, "LE" as Endianness, true);

  appendLine(outputDiv, `入力テキスト: "${escapeHtml(text)}"`, "#e2e8f0");
  appendLine(outputDiv, "", "#e2e8f0");
  appendLine(outputDiv, `UTF-16 BE (BOM付き): ${toHex(bytesBeWithBom)}`, "#68d391");
  appendLine(outputDiv, `UTF-16 LE (BOM付き): ${toHex(bytesLeWithBom)}`, "#3b82f6");

  // 詳細: BOMの説明
  appendLine(detailDiv, "--- BOM (Byte Order Mark) ---", "#475569");
  appendLine(detailDiv, "  ビッグエンディアン BOM: FE FF", "#f59e0b");
  appendLine(detailDiv, "  リトルエンディアン BOM: FF FE", "#f59e0b");
  appendLine(detailDiv, "", "#e2e8f0");
  appendLine(detailDiv, "  BOMはバイトオーダーを示すプレフィックス", "#94a3b8");
  appendLine(detailDiv, `  BE データ部分: ${toHex(bytesBeWithBom.slice(2))}`, "#e2e8f0");
  appendLine(detailDiv, `  LE データ部分: ${toHex(bytesLeWithBom.slice(2))}`, "#e2e8f0");
}

/** Shift_JISエンコード結果表示 */
function renderShiftJis(text: string, outputDiv: HTMLElement, detailDiv: HTMLElement): void {
  const bytes = encodeShiftJis(text);

  appendLine(outputDiv, `入力テキスト: "${escapeHtml(text)}"`, "#e2e8f0");
  appendLine(outputDiv, "", "#e2e8f0");
  appendLine(outputDiv, `Shift_JIS バイト列: ${toHex(bytes)}`, "#68d391");
  appendLine(outputDiv, `バイト数: ${String(bytes.length)}`, "#94a3b8");
  appendLine(outputDiv, `バイナリ: ${binaryDump(bytes)}`, "#64748b");

  // 詳細: 各文字のShift_JISバイト
  appendLine(detailDiv, "--- 文字ごとのShift_JISバイト ---", "#475569");
  for (const char of text) {
    const charBytes = encodeShiftJis(char);
    const hexStr = toHex(charBytes);
    appendLine(detailDiv, `  '${escapeHtml(char)}' → ${hexStr} (${String(charBytes.length)}バイト)`, "#e2e8f0");
  }
}

/** 文字化けデモ表示 */
function renderMojibake(
  text: string,
  encodeAs: EncodingName,
  decodeAs: EncodingName,
  outputDiv: HTMLElement,
  detailDiv: HTMLElement,
): void {
  const result = simulateMojibake(text, encodeAs, decodeAs);

  appendLine(outputDiv, `元のテキスト: "${escapeHtml(text)}"`, "#e2e8f0");
  appendLine(outputDiv, `エンコード: ${encodeAs} → デコード: ${decodeAs}`, "#94a3b8");
  appendLine(outputDiv, "", "#e2e8f0");
  appendLine(outputDiv, `中間バイト列: ${toHex(result.intermediateBytes)}`, "#f59e0b");
  appendLine(outputDiv, "", "#e2e8f0");
  appendLine(outputDiv, `文字化け結果: ${escapeHtml(result.decodedText)}`, "#f87171");

  // 詳細: 各ステップ
  appendLine(detailDiv, "--- 文字化けの過程 ---", "#475569");
  appendLine(detailDiv, `  1. 元テキスト: "${escapeHtml(text)}"`, "#e2e8f0");
  appendLine(detailDiv, `  2. ${encodeAs}でエンコード → バイト列取得`, "#94a3b8");
  appendLine(detailDiv, `     ${toHex(result.intermediateBytes)}`, "#f59e0b");
  appendLine(detailDiv, `  3. ${decodeAs}でデコード → 文字化け発生`, "#94a3b8");
  appendLine(detailDiv, `     "${escapeHtml(result.decodedText)}"`, "#f87171");
}

/** エンコード比較表示 */
function renderComparison(text: string, outputDiv: HTMLElement, detailDiv: HTMLElement): void {
  const utf8Bytes = encodeUtf8(text);
  const utf16beBytes = encodeUtf16(text, "BE" as Endianness);
  const utf16leBytes = encodeUtf16(text, "LE" as Endianness);
  const sjisBytes = encodeShiftJis(text);
  const asciiBytes = encodeAscii(text);

  appendLine(outputDiv, `入力テキスト: "${escapeHtml(text)}"`, "#e2e8f0");
  appendLine(outputDiv, "", "#e2e8f0");
  appendLine(outputDiv, `ASCII      (${String(asciiBytes.length).padStart(2)}バイト): ${toHex(asciiBytes)}`, "#94a3b8");
  appendLine(outputDiv, `UTF-8      (${String(utf8Bytes.length).padStart(2)}バイト): ${toHex(utf8Bytes)}`, "#68d391");
  appendLine(outputDiv, `UTF-16 BE  (${String(utf16beBytes.length).padStart(2)}バイト): ${toHex(utf16beBytes)}`, "#3b82f6");
  appendLine(outputDiv, `UTF-16 LE  (${String(utf16leBytes.length).padStart(2)}バイト): ${toHex(utf16leBytes)}`, "#8b5cf6");
  appendLine(outputDiv, `Shift_JIS  (${String(sjisBytes.length).padStart(2)}バイト): ${toHex(sjisBytes)}`, "#f59e0b");

  // 詳細: 各文字のコードポイントと各エンコーディングのバイト
  appendLine(detailDiv, "--- 文字ごとの比較 ---", "#475569");
  const codePoints = analyzeText(text);
  for (const info of codePoints) {
    const charUtf8 = encodeUtf8(info.character);
    const charSjis = encodeShiftJis(info.character);
    appendLine(detailDiv, `  '${escapeHtml(info.character)}' ${info.notation}`, "#f59e0b");
    appendLine(detailDiv, `    UTF-8: ${toHex(charUtf8)}  Shift_JIS: ${toHex(charSjis)}`, "#e2e8f0");
  }
}

/** ASCII制御文字一覧表示 */
function renderAsciiControlChars(outputDiv: HTMLElement, detailDiv: HTMLElement): void {
  appendLine(outputDiv, "ASCII制御文字一覧 (0x00-0x1F, 0x7F)", "#e2e8f0");
  appendLine(outputDiv, "", "#e2e8f0");

  // 制御文字名をテーブルのように表示
  const table = buildAsciiTable();
  for (let i = 0; i <= 0x1f; i++) {
    const entry = table[i]!;
    const name = CONTROL_CHAR_NAMES.get(i) ?? "";
    appendLine(outputDiv, `  0x${entry.hex.slice(2)} (${String(i).padStart(3)}) : ${name.padEnd(4)} ${entry.binary}`, "#68d391");
  }
  // DEL
  const delEntry = table[0x7f]!;
  appendLine(outputDiv, `  0x${delEntry.hex.slice(2)} (127) : DEL  ${delEntry.binary}`, "#68d391");

  // 詳細: 制御文字の説明
  appendLine(detailDiv, "--- 制御文字の詳細 ---", "#475569");
  appendLine(detailDiv, "  制御文字はASCIIの0x00-0x1Fと0x7Fの範囲", "#94a3b8");
  appendLine(detailDiv, "  合計33文字（0x00-0x1Fの32文字 + DEL）", "#94a3b8");
  appendLine(detailDiv, "", "#e2e8f0");
  appendLine(detailDiv, "  主要な制御文字:", "#e2e8f0");
  appendLine(detailDiv, "    NUL (0x00) - 空文字", "#f59e0b");
  appendLine(detailDiv, "    BEL (0x07) - ベル", "#f59e0b");
  appendLine(detailDiv, "    BS  (0x08) - バックスペース", "#f59e0b");
  appendLine(detailDiv, "    HT  (0x09) - 水平タブ", "#f59e0b");
  appendLine(detailDiv, "    LF  (0x0A) - 改行", "#f59e0b");
  appendLine(detailDiv, "    CR  (0x0D) - 復帰", "#f59e0b");
  appendLine(detailDiv, "    ESC (0x1B) - エスケープ", "#f59e0b");
  appendLine(detailDiv, "    DEL (0x7F) - 削除", "#f59e0b");
}

/** 出力行を追加するヘルパー */
function appendLine(container: HTMLElement, text: string, color: string): void {
  const row = document.createElement("div");
  row.style.cssText = `padding:1px 0;color:${color};`;
  row.innerHTML = text;
  container.appendChild(row);
}
