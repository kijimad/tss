/**
 * serialize.ts — 各レイヤーのヘッダをバイナリ化/復元する
 *
 * 実際のプロトコルと同じバイナリ構造でシリアライズする。
 * Ethernet → IP → TCP の順にカプセル化し、逆順でデカプセル化する。
 */
import type {
  EthernetFrame, IpPacket, TcpSegment, TcpFlags,
  ArpPacket,
} from "./types.js";

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();

// =====================================================
// MAC アドレスのバイナリ変換
// =====================================================
export function macToBytes(mac: string): Uint8Array {
  const parts = mac.split(":");
  const bytes = new Uint8Array(6);
  for (let i = 0; i < 6; i++) {
    bytes[i] = parseInt(parts[i] ?? "0", 16);
  }
  return bytes;
}

export function bytesToMac(bytes: Uint8Array, offset: number): string {
  const parts: string[] = [];
  for (let i = 0; i < 6; i++) {
    parts.push((bytes[offset + i] ?? 0).toString(16).padStart(2, "0").toUpperCase());
  }
  return parts.join(":");
}

// =====================================================
// Ethernet フレーム (14バイトヘッダ)
//   [DstMAC:6B][SrcMAC:6B][EtherType:2B][Payload...]
// =====================================================
export function serializeEthernet(frame: EthernetFrame): Uint8Array {
  const header = new Uint8Array(14);
  header.set(macToBytes(frame.dstMac), 0);
  header.set(macToBytes(frame.srcMac), 6);
  new DataView(header.buffer).setUint16(12, frame.etherType);

  const result = new Uint8Array(14 + frame.payload.length);
  result.set(header, 0);
  result.set(frame.payload, 14);
  return result;
}

export function deserializeEthernet(data: Uint8Array): EthernetFrame {
  return {
    dstMac: bytesToMac(data, 0),
    srcMac: bytesToMac(data, 6),
    etherType: new DataView(data.buffer, data.byteOffset + 12, 2).getUint16(0),
    payload: data.slice(14),
  };
}

// =====================================================
// ARP パケット (28バイト)
//   [HardwareType:2B][ProtocolType:2B][HLen:1B][PLen:1B]
//   [Operation:2B]
//   [SenderMAC:6B][SenderIP:4B][TargetMAC:6B][TargetIP:4B]
// =====================================================
export function serializeArp(arp: ArpPacket): Uint8Array {
  const buf = new Uint8Array(28);
  const view = new DataView(buf.buffer);
  view.setUint16(0, 1);      // Hardware type: Ethernet
  view.setUint16(2, 0x0800); // Protocol type: IPv4
  buf[4] = 6;                // Hardware address length
  buf[5] = 4;                // Protocol address length
  view.setUint16(6, arp.operation);
  buf.set(macToBytes(arp.senderMac), 8);
  writeIpToBytes(buf, 14, arp.senderIp);
  buf.set(macToBytes(arp.targetMac), 18);
  writeIpToBytes(buf, 24, arp.targetIp);
  return buf;
}

export function deserializeArp(data: Uint8Array): ArpPacket {
  const view = new DataView(data.buffer, data.byteOffset);
  return {
    operation: view.getUint16(6) as 1 | 2,
    senderMac: bytesToMac(data, 8),
    senderIp: readIpFromBytes(data, 14),
    targetMac: bytesToMac(data, 18),
    targetIp: readIpFromBytes(data, 24),
  };
}

// =====================================================
// IP パケット (20バイトヘッダ、オプションなし)
//   [Version+IHL:1B][ToS:1B][TotalLength:2B]
//   [ID:2B][Flags+FragOffset:2B]
//   [TTL:1B][Protocol:1B][Checksum:2B]
//   [SrcIP:4B][DstIP:4B]
//   [Payload...]
// =====================================================
export function serializeIp(packet: IpPacket): Uint8Array {
  const headerLen = 20;
  const totalLen = headerLen + packet.payload.length;
  const buf = new Uint8Array(totalLen);
  const view = new DataView(buf.buffer);

  buf[0] = 0x45;                         // Version=4, IHL=5 (20バイト)
  buf[1] = 0;                            // ToS
  view.setUint16(2, totalLen);
  view.setUint16(4, 0);                  // ID
  view.setUint16(6, 0x4000);             // Don't Fragment
  buf[8] = packet.header.ttl;
  buf[9] = packet.header.protocol;
  view.setUint16(10, 0);                 // Checksum (省略)
  writeIpToBytes(buf, 12, packet.header.srcIp);
  writeIpToBytes(buf, 16, packet.header.dstIp);
  buf.set(packet.payload, 20);
  return buf;
}

export function deserializeIp(data: Uint8Array): IpPacket {
  const view = new DataView(data.buffer, data.byteOffset);
  const ihl = (data[0] ?? 0x45) & 0x0f;
  const headerLength = ihl * 4;
  return {
    header: {
      version: 4,
      headerLength,
      ttl: data[8] ?? 64,
      protocol: data[9] ?? 6,
      srcIp: readIpFromBytes(data, 12),
      dstIp: readIpFromBytes(data, 16),
    },
    payload: data.slice(headerLength),
  };
}

// =====================================================
// TCP セグメント (20バイトヘッダ、オプションなし)
//   [SrcPort:2B][DstPort:2B]
//   [SeqNum:4B]
//   [AckNum:4B]
//   [DataOffset+Flags:2B][Window:2B]
//   [Checksum:2B][UrgentPointer:2B]
//   [Payload...]
// =====================================================
export function serializeTcp(segment: TcpSegment): Uint8Array {
  const headerLen = 20;
  const totalLen = headerLen + segment.payload.length;
  const buf = new Uint8Array(totalLen);
  const view = new DataView(buf.buffer);

  view.setUint16(0, segment.header.srcPort);
  view.setUint16(2, segment.header.dstPort);
  view.setUint32(4, segment.header.seqNum);
  view.setUint32(8, segment.header.ackNum);

  // Data offset (5 = 20バイト) + reserved + flags
  let flagsWord = (5 << 12); // data offset in upper 4 bits
  if (segment.header.flags.fin) flagsWord |= 0x01;
  if (segment.header.flags.syn) flagsWord |= 0x02;
  if (segment.header.flags.rst) flagsWord |= 0x04;
  if (segment.header.flags.psh) flagsWord |= 0x08;
  if (segment.header.flags.ack) flagsWord |= 0x10;
  if (segment.header.flags.urg) flagsWord |= 0x20;
  view.setUint16(12, flagsWord);

  view.setUint16(14, segment.header.windowSize);
  view.setUint16(16, 0); // Checksum (省略)
  view.setUint16(18, 0); // Urgent pointer

  buf.set(segment.payload, 20);
  return buf;
}

export function deserializeTcp(data: Uint8Array): TcpSegment {
  const view = new DataView(data.buffer, data.byteOffset);
  const flagsWord = view.getUint16(12);
  const dataOffset = (flagsWord >> 12) & 0x0f;
  const headerLen = dataOffset * 4;

  const flags: TcpFlags = {
    fin: (flagsWord & 0x01) !== 0,
    syn: (flagsWord & 0x02) !== 0,
    rst: (flagsWord & 0x04) !== 0,
    psh: (flagsWord & 0x08) !== 0,
    ack: (flagsWord & 0x10) !== 0,
    urg: (flagsWord & 0x20) !== 0,
  };

  return {
    header: {
      srcPort: view.getUint16(0),
      dstPort: view.getUint16(2),
      seqNum: view.getUint32(4),
      ackNum: view.getUint32(8),
      dataOffset: headerLen,
      flags,
      windowSize: view.getUint16(14),
      checksum: view.getUint16(16),
    },
    payload: data.slice(headerLen),
  };
}

// =====================================================
// HTTP テキストのシリアライズ
// =====================================================
export function serializeHttpRequest(req: import("./types.js").HttpRequest): Uint8Array {
  let text = `${req.method} ${req.path} ${req.version}\r\n`;
  for (const [key, value] of req.headers) {
    text += `${key}: ${value}\r\n`;
  }
  text += "\r\n" + req.body;
  return ENCODER.encode(text);
}

export function serializeHttpResponse(res: import("./types.js").HttpResponse): Uint8Array {
  let text = `${res.version} ${String(res.statusCode)} ${res.statusText}\r\n`;
  for (const [key, value] of res.headers) {
    text += `${key}: ${value}\r\n`;
  }
  text += "\r\n" + res.body;
  return ENCODER.encode(text);
}

export function deserializeHttpRequest(data: Uint8Array): import("./types.js").HttpRequest {
  const text = DECODER.decode(data);
  const [headerPart, ...bodyParts] = text.split("\r\n\r\n");
  const body = bodyParts.join("\r\n\r\n");
  const lines = (headerPart ?? "").split("\r\n");
  const requestLine = lines[0] ?? "";
  const [method, path, version] = requestLine.split(" ");
  const headers = new Map<string, string>();
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const colonIndex = line.indexOf(":");
    if (colonIndex > 0) {
      headers.set(line.slice(0, colonIndex).trim(), line.slice(colonIndex + 1).trim());
    }
  }
  return { method: method ?? "GET", path: path ?? "/", version: version ?? "HTTP/1.1", headers, body };
}

export function deserializeHttpResponse(data: Uint8Array): import("./types.js").HttpResponse {
  const text = DECODER.decode(data);
  const [headerPart, ...bodyParts] = text.split("\r\n\r\n");
  const body = bodyParts.join("\r\n\r\n");
  const lines = (headerPart ?? "").split("\r\n");
  const statusLine = lines[0] ?? "";
  const spaceIdx = statusLine.indexOf(" ");
  const version = statusLine.slice(0, spaceIdx);
  const rest = statusLine.slice(spaceIdx + 1);
  const codeEnd = rest.indexOf(" ");
  const statusCode = Number(rest.slice(0, codeEnd));
  const statusText = rest.slice(codeEnd + 1);
  const headers = new Map<string, string>();
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const colonIndex = line.indexOf(":");
    if (colonIndex > 0) {
      headers.set(line.slice(0, colonIndex).trim(), line.slice(colonIndex + 1).trim());
    }
  }
  return { version, statusCode, statusText, headers, body };
}

// =====================================================
// ヘルパー: IPアドレスのバイナリ変換
// =====================================================
function writeIpToBytes(buf: Uint8Array, offset: number, ip: string): void {
  const parts = ip.split(".");
  for (let i = 0; i < 4; i++) {
    buf[offset + i] = Number(parts[i] ?? "0");
  }
}

function readIpFromBytes(buf: Uint8Array, offset: number): string {
  return `${String(buf[offset] ?? 0)}.${String(buf[offset + 1] ?? 0)}.${String(buf[offset + 2] ?? 0)}.${String(buf[offset + 3] ?? 0)}`;
}

// TCP フラグを文字列化
export function tcpFlagsToString(flags: TcpFlags): string {
  const parts: string[] = [];
  if (flags.syn) parts.push("SYN");
  if (flags.ack) parts.push("ACK");
  if (flags.fin) parts.push("FIN");
  if (flags.rst) parts.push("RST");
  if (flags.psh) parts.push("PSH");
  if (flags.urg) parts.push("URG");
  return parts.join(",");
}
