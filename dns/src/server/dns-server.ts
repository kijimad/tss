/**
 * dns-server.ts — 仮想 DNS サーバ
 *
 * 1台のDNSサーバをシミュレートする。
 * 権威サーバとして動作し、自分が管理するゾーンのレコードに応答する。
 *
 * 動作:
 *   1. クエリパケットを受信
 *   2. Question のドメイン名に対応するレコードを自分のゾーンから検索
 *   3. 見つかれば Answer に入れて返す
 *   4. 見つからなければ、委任先（NS レコード）を Authority に入れて返す
 */
import type { UdpPacket, DnsRecord, DnsServerConfig } from "../protocol/types.js";
import { RecordType, ResponseCode } from "../protocol/types.js";
import { decodeDnsMessage } from "../protocol/decoder.js";
import { encodeDnsMessage } from "../protocol/encoder.js";
import type { DnsMessage } from "../protocol/types.js";

export class DnsServer {
  readonly name: string;
  readonly ip: string;
  private zones: Map<string, DnsRecord[]>;

  constructor(config: DnsServerConfig) {
    this.name = config.name;
    this.ip = config.ip;
    this.zones = new Map();

    // ゾーンデータを展開
    for (const [zoneName, zoneData] of config.zones) {
      this.zones.set(zoneName, zoneData.records);
    }
  }

  // レコードを追加
  addRecord(zoneName: string, record: DnsRecord): void {
    const existing = this.zones.get(zoneName);
    if (existing !== undefined) {
      existing.push(record);
    } else {
      this.zones.set(zoneName, [record]);
    }
  }

  // パケットを処理して応答を返す
  handlePacket(packet: UdpPacket): UdpPacket | undefined {
    const query = decodeDnsMessage(packet.data);
    if (query.header.qr !== 0) return undefined; // クエリでなければ無視

    const question = query.questions[0];
    if (question === undefined) return undefined;

    const response = this.buildResponse(query, question.name, question.type);
    const responseData = encodeDnsMessage(response);

    return {
      source: packet.destination,
      destination: packet.source,
      data: responseData,
    };
  }

  // クエリに対する応答を組み立てる
  private buildResponse(query: DnsMessage, name: string, type: RecordType): DnsMessage {
    const answers: DnsRecord[] = [];
    const authorities: DnsRecord[] = [];
    const additionals: DnsRecord[] = [];

    // 完全一致でレコードを検索
    const exactRecords = this.findRecords(name, type);
    if (exactRecords.length > 0) {
      answers.push(...exactRecords);
    } else {
      // CNAME があればそれを返す
      const cnameRecords = this.findRecords(name, RecordType.CNAME);
      if (cnameRecords.length > 0) {
        answers.push(...cnameRecords);
      } else {
        // 委任: このドメインを管理する NS レコードを探す
        const delegation = this.findDelegation(name);
        if (delegation !== undefined) {
          authorities.push(...delegation.nsRecords);
          // グルーレコード（NS の IP アドレス）を Additional に追加
          for (const ns of delegation.nsRecords) {
            const glue = this.findRecords(ns.data, RecordType.A);
            additionals.push(...glue);
          }
        }
      }
    }

    return {
      header: {
        id: query.header.id,
        qr: 1,
        opcode: 0,
        aa: answers.length > 0, // 回答があれば権威あり
        tc: false,
        rd: query.header.rd,
        ra: false,
        rcode: ResponseCode.NoError,
        qdcount: query.questions.length,
        ancount: answers.length,
        nscount: authorities.length,
        arcount: additionals.length,
      },
      questions: query.questions,
      answers,
      authorities,
      additionals,
    };
  }

  // 指定ドメイン・型のレコードを検索
  private findRecords(name: string, type: RecordType): DnsRecord[] {
    const results: DnsRecord[] = [];
    for (const [, records] of this.zones) {
      for (const r of records) {
        if (r.name === name && r.type === type) {
          results.push(r);
        }
      }
    }
    return results;
  }

  // 委任先の NS レコードを探す（最長一致）
  // 例: "www.example.com" のクエリに対して "example.com" の NS を返す
  private findDelegation(name: string): { nsRecords: DnsRecord[] } | undefined {
    const parts = name.split(".");
    // 右端から順に上位ドメインを試す
    for (let i = 0; i < parts.length; i++) {
      const domain = parts.slice(i).join(".");
      const nsRecords: DnsRecord[] = [];
      for (const [, records] of this.zones) {
        for (const r of records) {
          if (r.name === domain && r.type === RecordType.NS) {
            nsRecords.push(r);
          }
        }
      }
      if (nsRecords.length > 0) {
        return { nsRecords };
      }
    }
    return undefined;
  }
}
