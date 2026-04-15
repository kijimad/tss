/**
 * decoder.ts — ArrayBuffer から DNS メッセージを復元する
 *
 * エンコーダの逆操作。バイナリを1バイトずつ読み取り、
 * ヘッダ → Question → Answer → Authority → Additional の順で解析する。
 *
 * ドメイン名のデコード:
 *   [7]example[3]com[0] → "example.com"
 *   先頭2ビットが 11 の場合はポインタ（メッセージ圧縮）
 */
import { type DnsMessage, type DnsHeader, type DnsQuestion, type DnsRecord, type ResponseCode, type RecordType } from "./types.js";

/**
 * ArrayBuffer から DNS メッセージをデコードする
 *
 * バイナリデータを先頭から順にパースし、ヘッダ・Question・Answer・
 * Authority・Additional の各セクションを復元する。
 *
 * @param buf - DNSメッセージのバイナリ表現
 * @returns デコードされたDNSメッセージ
 */
export function decodeDnsMessage(buf: ArrayBuffer): DnsMessage {
  const view = new DataView(buf);
  let offset = 0;
  const fullData = new Uint8Array(buf);

  // === ヘッダ (12バイト) ===
  const id = view.getUint16(offset); offset += 2;
  const flags = view.getUint16(offset); offset += 2;
  const qdcount = view.getUint16(offset); offset += 2;
  const ancount = view.getUint16(offset); offset += 2;
  const nscount = view.getUint16(offset); offset += 2;
  const arcount = view.getUint16(offset); offset += 2;

  // Flags を分解
  const qr = ((flags >> 15) & 1) as 0 | 1;
  const opcode = (flags >> 11) & 0xf;
  const aa = ((flags >> 10) & 1) === 1;
  const tc = ((flags >> 9) & 1) === 1;
  const rd = ((flags >> 8) & 1) === 1;
  const ra = ((flags >> 7) & 1) === 1;
  const rcode = (flags & 0xf) as ResponseCode;

  const header: DnsHeader = { id, qr, opcode, aa, tc, rd, ra, rcode, qdcount, ancount, nscount, arcount };

  // === Question セクション ===
  const questions: DnsQuestion[] = [];
  for (let i = 0; i < qdcount; i++) {
    const { name, newOffset } = decodeDomainName(fullData, offset);
    offset = newOffset;
    const type = view.getUint16(offset) as RecordType; offset += 2;
    const cls = view.getUint16(offset); offset += 2;
    questions.push({ name, type, class: cls });
  }

  // === Answer, Authority, Additional セクション ===
  const answers: DnsRecord[] = [];
  for (let i = 0; i < ancount; i++) {
    const { record, newOffset } = decodeRecord(fullData, view, offset);
    answers.push(record);
    offset = newOffset;
  }

  const authorities: DnsRecord[] = [];
  for (let i = 0; i < nscount; i++) {
    const { record, newOffset } = decodeRecord(fullData, view, offset);
    authorities.push(record);
    offset = newOffset;
  }

  const additionals: DnsRecord[] = [];
  for (let i = 0; i < arcount; i++) {
    const { record, newOffset } = decodeRecord(fullData, view, offset);
    additionals.push(record);
    offset = newOffset;
  }

  return { header, questions, answers, authorities, additionals };
}

/**
 * Resource Record を1件デコードする
 * @param fullData - メッセージ全体のバイト配列（ポインタ解決に使用）
 * @param view - DataView（数値読み取り用）
 * @param offset - 読み取り開始位置
 * @returns デコードされたレコードと次の読み取り位置
 */
function decodeRecord(
  fullData: Uint8Array,
  view: DataView,
  offset: number,
): { record: DnsRecord; newOffset: number } {
  const { name, newOffset: nameEnd } = decodeDomainName(fullData, offset);
  offset = nameEnd;

  const type = view.getUint16(offset) as RecordType; offset += 2;
  const cls = view.getUint16(offset); offset += 2;
  const ttl = view.getUint32(offset); offset += 4;
  const rdlength = view.getUint16(offset); offset += 2;

  const data = decodeRdata(fullData, view, offset, type, rdlength);
  offset += rdlength;

  return { record: { name, type, class: cls, ttl, data }, newOffset: offset };
}

/**
 * RDATA をレコード型に応じてデコードする
 *
 * Aレコードは4バイトのIPv4アドレス、NS/CNAMEはドメイン名、
 * MXは優先度+ドメイン名、その他はUTF-8テキストとして扱う。
 *
 * @param fullData - メッセージ全体のバイト配列
 * @param view - DataView
 * @param offset - RDATA の開始位置
 * @param type - レコード型
 * @param rdlength - RDATA の長さ（バイト）
 * @returns デコードされたデータの文字列表現
 */
function decodeRdata(
  fullData: Uint8Array,
  view: DataView,
  offset: number,
  type: RecordType,
  rdlength: number,
): string {
  switch (type) {
    case 1: {
      // A レコード: 4バイト → "a.b.c.d"
      const a = view.getUint8(offset);
      const b = view.getUint8(offset + 1);
      const c = view.getUint8(offset + 2);
      const d = view.getUint8(offset + 3);
      return `${String(a)}.${String(b)}.${String(c)}.${String(d)}`;
    }

    case 2:   // NS
    case 5: { // CNAME
      // ドメイン名
      const { name } = decodeDomainName(fullData, offset);
      return name;
    }

    case 15: {
      // MX: 優先度(u16) + ドメイン名
      // 優先度は読み飛ばし、ドメイン名だけ返す
      const { name } = decodeDomainName(fullData, offset + 2);
      return name;
    }

    default: {
      // その他: UTF-8 テキストとして読む
      const bytes = fullData.slice(offset, offset + rdlength);
      return new TextDecoder().decode(bytes);
    }
  }
}

/**
 * ドメイン名をデコードする
 *
 * DNS のドメイン名はラベル列で表現される:
 *   [長さ][ラベル文字列][長さ][ラベル文字列]...[0x00]
 *
 * メッセージ圧縮: 先頭2ビットが 11 の場合、残り14ビットはメッセージ内のオフセット。
 * 同じドメイン名を繰り返し書く代わりに、前に出現した位置を指すポインタ。
 */
export function decodeDomainName(data: Uint8Array, offset: number): { name: string; newOffset: number } {
  const labels: string[] = [];
  let currentOffset = offset;
  let jumped = false;
  let returnOffset = offset; // ポインタジャンプ前の位置

  while (true) {
    const len = data[currentOffset];
    if (len === undefined || len === 0) {
      if (!jumped) returnOffset = currentOffset + 1;
      break;
    }

    // ポインタ判定: 先頭2ビットが 11
    if ((len & 0xc0) === 0xc0) {
      if (!jumped) returnOffset = currentOffset + 2;
      const nextByte = data[currentOffset + 1] ?? 0;
      currentOffset = ((len & 0x3f) << 8) | nextByte;
      jumped = true;
      continue;
    }

    // 通常のラベル
    currentOffset += 1;
    let label = "";
    for (let i = 0; i < len; i++) {
      const ch = data[currentOffset + i];
      if (ch !== undefined) {
        label += String.fromCharCode(ch);
      }
    }
    labels.push(label);
    currentOffset += len;
  }

  return { name: labels.join("."), newOffset: returnOffset };
}
