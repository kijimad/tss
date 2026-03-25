/**
 * page.ts — 4KB ページのシリアライズ / デシリアライズ
 *
 * このファイルは B+Tree の物理レイヤーを担当する。
 * 1ページ = 4096 バイトの ArrayBuffer で、以下の構造を持つ:
 *
 *   ┌──────────────────── 4096 bytes ────────────────────┐
 *   │  ヘッダ (12B)                                      │
 *   │  [pageType:u16][cellCount:u16][rightChild:u32]     │
 *   │  [freeSpaceStart:u16][freeSpaceEnd:u16]            │
 *   ├────────────────────────────────────────────────────┤
 *   │  セルポインタ配列 (各 2B)                           │
 *   │  [offset0:u16][offset1:u16]...                     │
 *   │  ← freeSpaceStart                                  │
 *   │                                                    │
 *   │  (空き領域)                                        │
 *   │                                                    │
 *   │  freeSpaceEnd →                                    │
 *   │  セルデータ（末尾から前方向に成長）                   │
 *   │  [...cell1 data...][...cell0 data...]              │
 *   └────────────────────────────────────────────────────┘
 *
 * セルポインタ配列はヘッダ直後に前方向に成長し、
 * セルデータはページ末尾から後方向に成長する。
 * 両者が出会ったらページが満杯 → 分割が必要。
 *
 * rightChild フィールドの二重用途:
 *   - Interior ノード: 最右の子ページID（全キーより大きい値が格納されている子）
 *   - Leaf ノード: 次のリーフページID（範囲スキャン用のリンクリスト）
 */
import { PAGE_SIZE, PAGE_HEADER_SIZE, ValueTag, type SqlValue, type PageType } from "../types.js";

// === ページヘッダ読み取り ===

export function readPageType(buf: ArrayBuffer): PageType {
  const view = new DataView(buf);
  return view.getUint16(0) as 0x01 | 0x02 | 0x03;
}

export function readCellCount(buf: ArrayBuffer): number {
  return new DataView(buf).getUint16(2);
}

export function readRightChild(buf: ArrayBuffer): number {
  return new DataView(buf).getUint32(4);
}

export function readFreeSpaceStart(buf: ArrayBuffer): number {
  return new DataView(buf).getUint16(8);
}

export function readFreeSpaceEnd(buf: ArrayBuffer): number {
  return new DataView(buf).getUint16(10);
}

// === ページ初期化 ===
// 空の新規ページを作成する
export function initPage(pageType: PageType): ArrayBuffer {
  const buf = new ArrayBuffer(PAGE_SIZE);
  const view = new DataView(buf);
  view.setUint16(0, pageType);        // pageType
  view.setUint16(2, 0);               // cellCount = 0
  view.setUint32(4, 0);               // rightChild = 0（未接続）
  view.setUint16(8, PAGE_HEADER_SIZE); // freeSpaceStart = ヘッダ直後
  view.setUint16(10, PAGE_SIZE);      // freeSpaceEnd = ページ末尾
  return buf;
}

// === セルポインタ操作 ===
// セルポインタ配列はヘッダ(12B)の直後に並び、各エントリは2バイトのオフセット値。
// このオフセットはセルデータの開始位置を指す。

export function getCellOffset(buf: ArrayBuffer, index: number): number {
  const view = new DataView(buf);
  return view.getUint16(PAGE_HEADER_SIZE + index * 2);
}

export function setCellOffset(buf: ArrayBuffer, index: number, offset: number): void {
  const view = new DataView(buf);
  view.setUint16(PAGE_HEADER_SIZE + index * 2, offset);
}

// === ヘッダ書き込み ===
export function writePageHeader(
  buf: ArrayBuffer,
  pageType: PageType,
  cellCount: number,
  rightChild: number,
  freeSpaceStart: number,
  freeSpaceEnd: number,
): void {
  const view = new DataView(buf);
  view.setUint16(0, pageType);
  view.setUint16(2, cellCount);
  view.setUint32(4, rightChild);
  view.setUint16(8, freeSpaceStart);
  view.setUint16(10, freeSpaceEnd);
}

// === 値シリアライズ / デシリアライズ ===
// 各 SqlValue をバイナリ表現に変換する。先頭の1バイトが型タグ。
//
// フォーマット:
//   NULL:    [0x00]                          (1 byte)
//   INTEGER: [0x01][float64]                 (9 bytes)
//   TEXT:    [0x02][length:u32][utf8 bytes]  (5 + N bytes)
//   REAL:    [0x03][float64]                 (9 bytes)
//   BLOB:    [0x04][length:u32][bytes]       (5 + N bytes)
//
// INTEGER と REAL は両方 float64 で格納する（JavaScript の number に合わせた簡略化）

export function encodeSqlValue(value: SqlValue): Uint8Array {
  if (value === null) {
    return new Uint8Array([ValueTag.Null]);
  }
  if (typeof value === "number") {
    if (Number.isInteger(value)) {
      const buf = new Uint8Array(9);
      buf[0] = ValueTag.Integer;
      new DataView(buf.buffer).setFloat64(1, value);
      return buf;
    }
    const buf = new Uint8Array(9);
    buf[0] = ValueTag.Real;
    new DataView(buf.buffer).setFloat64(1, value);
    return buf;
  }
  if (typeof value === "string") {
    const encoded = new TextEncoder().encode(value);
    const buf = new Uint8Array(5 + encoded.length);
    buf[0] = ValueTag.Text;
    new DataView(buf.buffer).setUint32(1, encoded.length);
    buf.set(encoded, 5);
    return buf;
  }
  // Uint8Array (BLOB)
  const buf = new Uint8Array(5 + value.length);
  buf[0] = ValueTag.Blob;
  new DataView(buf.buffer).setUint32(1, value.length);
  buf.set(value, 5);
  return buf;
}

// バイナリデータから SqlValue を1つ読み取る
// 戻り値の bytesRead で次の値の開始位置が分かる
export function decodeSqlValue(data: Uint8Array, offset: number): { value: SqlValue; bytesRead: number } {
  const tag = data[offset];
  if (tag === ValueTag.Null) {
    return { value: null, bytesRead: 1 };
  }
  if (tag === ValueTag.Integer || tag === ValueTag.Real) {
    const val = new DataView(data.buffer, data.byteOffset + offset + 1, 8).getFloat64(0);
    return { value: val, bytesRead: 9 };
  }
  if (tag === ValueTag.Text) {
    const len = new DataView(data.buffer, data.byteOffset + offset + 1, 4).getUint32(0);
    const text = new TextDecoder().decode(data.subarray(offset + 5, offset + 5 + len));
    return { value: text, bytesRead: 5 + len };
  }
  if (tag === ValueTag.Blob) {
    const len = new DataView(data.buffer, data.byteOffset + offset + 1, 4).getUint32(0);
    const blob = data.slice(offset + 5, offset + 5 + len);
    return { value: blob, bytesRead: 5 + len };
  }
  throw new Error(`不明な値タグ: ${String(tag)}`);
}

// === セルデータのエンコード / デコード ===
//
// リーフセルのバイナリ構造:
//   [keyCount:u16][key1][key2]...[valueCount:u16][val1][val2]...
//
// Interior セルのバイナリ構造:
//   [keyCount:u16][key1][key2]...[childPageId:u32]

export function encodeLeafCell(key: SqlValue[], value: SqlValue[]): Uint8Array {
  const parts: Uint8Array[] = [];

  // キー数とキー値
  const keyCountBuf = new Uint8Array(2);
  new DataView(keyCountBuf.buffer).setUint16(0, key.length);
  parts.push(keyCountBuf);
  for (const k of key) {
    parts.push(encodeSqlValue(k));
  }

  // 値数と値
  const valCountBuf = new Uint8Array(2);
  new DataView(valCountBuf.buffer).setUint16(0, value.length);
  parts.push(valCountBuf);
  for (const v of value) {
    parts.push(encodeSqlValue(v));
  }

  // 全パーツを1つの Uint8Array に結合
  const totalLen = parts.reduce((sum, p) => sum + p.length, 0);
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const p of parts) {
    result.set(p, offset);
    offset += p.length;
  }
  return result;
}

export function decodeLeafCell(data: Uint8Array, offset: number): { key: SqlValue[]; value: SqlValue[]; bytesRead: number } {
  let pos = offset;

  const keyCount = new DataView(data.buffer, data.byteOffset + pos, 2).getUint16(0);
  pos += 2;

  const key: SqlValue[] = [];
  for (let i = 0; i < keyCount; i++) {
    const { value, bytesRead } = decodeSqlValue(data, pos);
    key.push(value);
    pos += bytesRead;
  }

  const valCount = new DataView(data.buffer, data.byteOffset + pos, 2).getUint16(0);
  pos += 2;

  const values: SqlValue[] = [];
  for (let i = 0; i < valCount; i++) {
    const { value, bytesRead } = decodeSqlValue(data, pos);
    values.push(value);
    pos += bytesRead;
  }

  return { key, value: values, bytesRead: pos - offset };
}

export function encodeInteriorCell(key: SqlValue[], childPageId: number): Uint8Array {
  const parts: Uint8Array[] = [];

  const keyCountBuf = new Uint8Array(2);
  new DataView(keyCountBuf.buffer).setUint16(0, key.length);
  parts.push(keyCountBuf);

  for (const k of key) {
    parts.push(encodeSqlValue(k));
  }

  // 子ページID（このキーより小さい値が格納されている子ページ）
  const childBuf = new Uint8Array(4);
  new DataView(childBuf.buffer).setUint32(0, childPageId);
  parts.push(childBuf);

  const totalLen = parts.reduce((sum, p) => sum + p.length, 0);
  const result = new Uint8Array(totalLen);
  let off = 0;
  for (const p of parts) {
    result.set(p, off);
    off += p.length;
  }
  return result;
}

export function decodeInteriorCell(data: Uint8Array, offset: number): { key: SqlValue[]; childPageId: number; bytesRead: number } {
  let pos = offset;

  const keyCount = new DataView(data.buffer, data.byteOffset + pos, 2).getUint16(0);
  pos += 2;

  const key: SqlValue[] = [];
  for (let i = 0; i < keyCount; i++) {
    const { value, bytesRead } = decodeSqlValue(data, pos);
    key.push(value);
    pos += bytesRead;
  }

  const childPageId = new DataView(data.buffer, data.byteOffset + pos, 4).getUint32(0);
  pos += 4;

  return { key, childPageId, bytesRead: pos - offset };
}

// === ページへのセル挿入 ===
// insertAt 位置にセルを挿入する。ソート順を維持するため、
// B+Tree 側が正しい挿入位置を計算して渡す。
//
// 手順:
// 1. セルデータをページ末尾（freeSpaceEnd）から前方向に書き込む
// 2. セルポインタ配列の insertAt 以降を1つずつ後ろにシフト
// 3. insertAt 位置に新しいセルポインタを書き込む
// 4. ヘッダ（cellCount, freeSpaceStart, freeSpaceEnd）を更新
export function insertCellIntoPage(buf: ArrayBuffer, cellData: Uint8Array, insertAt: number): boolean {
  const view = new DataView(buf);
  const cellCount = view.getUint16(2);
  const freeSpaceStart = view.getUint16(8);
  const freeSpaceEnd = view.getUint16(10);

  // 空き領域が足りるか確認（セルポインタ2B + セルデータ本体）
  const needed = 2 + cellData.length;
  if (freeSpaceEnd - freeSpaceStart < needed) {
    return false; // ページ満杯 → 呼び出し元で分割処理が必要
  }

  // セルデータを末尾から書き込む
  const cellOffset = freeSpaceEnd - cellData.length;
  const pageBytes = new Uint8Array(buf);
  pageBytes.set(cellData, cellOffset);

  // セルポインタ配列をシフト（挿入位置以降を後ろにずらす）
  for (let i = cellCount; i > insertAt; i--) {
    const prev = view.getUint16(PAGE_HEADER_SIZE + (i - 1) * 2);
    view.setUint16(PAGE_HEADER_SIZE + i * 2, prev);
  }

  // 新しいセルポインタを書き込む
  view.setUint16(PAGE_HEADER_SIZE + insertAt * 2, cellOffset);

  // ヘッダ更新
  view.setUint16(2, cellCount + 1);
  view.setUint16(8, freeSpaceStart + 2);  // セルポインタが1つ増えた
  view.setUint16(10, cellOffset);         // セルデータの先頭が前にずれた

  return true;
}

// ページからセルを削除する
// セルデータ自体は残る（コンパクションなし）が、セルポインタ配列から除外される。
// 簡易実装のため、削除されたセルのスペースは再利用されない。
export function removeCellFromPage(buf: ArrayBuffer, index: number): void {
  const view = new DataView(buf);
  const cellCount = view.getUint16(2);

  // セルポインタ配列をシフト（削除位置以降を前にずらす）
  for (let i = index; i < cellCount - 1; i++) {
    const next = view.getUint16(PAGE_HEADER_SIZE + (i + 1) * 2);
    view.setUint16(PAGE_HEADER_SIZE + i * 2, next);
  }

  view.setUint16(2, cellCount - 1);
  view.setUint16(8, PAGE_HEADER_SIZE + (cellCount - 1) * 2);
}
