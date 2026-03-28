/**
 * encoder.ts — DNS メッセージをバイナリ (ArrayBuffer) に変換する
 *
 * DNS パケットのバイナリ構造を手動で組み立てる。
 * 実際のDNS通信で使われるフォーマットと同一。
 *
 * ドメイン名のエンコード例:
 *   "example.com" → [7, 'e','x','a','m','p','l','e', 3, 'c','o','m', 0]
 *   各ラベルの前に長さバイト、最後に 0x00 終端
 */
import type { DnsMessage, DnsRecord, DnsQuestion } from "./types.js";

// DNS メッセージを ArrayBuffer にエンコードする
export function encodeDnsMessage(msg: DnsMessage): ArrayBuffer {
  // 最大512バイト（UDP制限）のバッファを確保
  const buf = new ArrayBuffer(512);
  const view = new DataView(buf);
  let offset = 0;

  // === ヘッダ (12バイト) ===
  view.setUint16(offset, msg.header.id); offset += 2;

  // Flags を組み立てる
  let flags = 0;
  flags |= (msg.header.qr & 1) << 15;
  flags |= (msg.header.opcode & 0xf) << 11;
  flags |= (msg.header.aa ? 1 : 0) << 10;
  flags |= (msg.header.tc ? 1 : 0) << 9;
  flags |= (msg.header.rd ? 1 : 0) << 8;
  flags |= (msg.header.ra ? 1 : 0) << 7;
  flags |= msg.header.rcode & 0xf;
  view.setUint16(offset, flags); offset += 2;

  view.setUint16(offset, msg.header.qdcount); offset += 2;
  view.setUint16(offset, msg.header.ancount); offset += 2;
  view.setUint16(offset, msg.header.nscount); offset += 2;
  view.setUint16(offset, msg.header.arcount); offset += 2;

  // === Question セクション ===
  for (const q of msg.questions) {
    offset = encodeQuestion(view, offset, q);
  }

  // === Answer セクション ===
  for (const r of msg.answers) {
    offset = encodeRecord(view, offset, r);
  }

  // === Authority セクション ===
  for (const r of msg.authorities) {
    offset = encodeRecord(view, offset, r);
  }

  // === Additional セクション ===
  for (const r of msg.additionals) {
    offset = encodeRecord(view, offset, r);
  }

  // 使用した部分だけ切り出して返す
  return buf.slice(0, offset);
}

// Question をエンコード
function encodeQuestion(view: DataView, offset: number, q: DnsQuestion): number {
  offset = encodeDomainName(view, offset, q.name);
  view.setUint16(offset, q.type); offset += 2;
  view.setUint16(offset, q.class); offset += 2;
  return offset;
}

// Resource Record をエンコード
function encodeRecord(view: DataView, offset: number, r: DnsRecord): number {
  offset = encodeDomainName(view, offset, r.name);
  view.setUint16(offset, r.type); offset += 2;
  view.setUint16(offset, r.class); offset += 2;
  view.setUint32(offset, r.ttl); offset += 4;

  // RDATA のエンコード（型によって異なる）
  const rdataStart = offset;
  offset += 2; // RDLENGTH の位置を予約

  offset = encodeRdata(view, offset, r);

  // RDLENGTH を書き戻す
  const rdlength = offset - rdataStart - 2;
  view.setUint16(rdataStart, rdlength);

  return offset;
}

// ドメイン名をラベル形式でエンコード
// "example.com" → [7]example[3]com[0]
export function encodeDomainName(view: DataView, offset: number, name: string): number {
  if (name === "" || name === ".") {
    view.setUint8(offset, 0);
    return offset + 1;
  }

  const labels = name.split(".");
  for (const label of labels) {
    if (label.length === 0) continue;
    view.setUint8(offset, label.length);
    offset += 1;
    for (let i = 0; i < label.length; i++) {
      view.setUint8(offset, label.charCodeAt(i));
      offset += 1;
    }
  }
  // 終端の 0
  view.setUint8(offset, 0);
  offset += 1;
  return offset;
}

// RDATA をレコード型に応じてエンコード
function encodeRdata(view: DataView, offset: number, r: DnsRecord): number {
  switch (r.type) {
    case 1: {
      // A レコード: IPv4 アドレスを4バイトに変換
      // "93.184.216.34" → [93, 184, 216, 34]
      const parts = r.data.split(".");
      for (const p of parts) {
        view.setUint8(offset, Number(p));
        offset += 1;
      }
      return offset;
    }

    case 28: {
      // AAAA レコード: IPv6 を16バイトに（簡易実装: 文字列をそのまま格納）
      const encoder = new TextEncoder();
      const bytes = encoder.encode(r.data);
      for (let i = 0; i < bytes.length; i++) {
        const b = bytes[i];
        if (b !== undefined) {
          view.setUint8(offset + i, b);
        }
      }
      return offset + bytes.length;
    }

    case 2:   // NS
    case 5:   // CNAME
    case 15:  // MX
    default: {
      // ドメイン名形式のデータ（NS, CNAME）やテキストデータ
      if (r.type === 15) {
        // MX: 優先度(u16) + ドメイン名
        view.setUint16(offset, 10); // デフォルト優先度
        offset += 2;
      }
      return encodeDomainName(view, offset, r.data);
    }
  }
}
