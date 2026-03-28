import { describe, it, expect } from "vitest";
import { encodeDnsMessage, encodeDomainName } from "../protocol/encoder.js";
import { decodeDnsMessage, decodeDomainName } from "../protocol/decoder.js";
import { RecordType, RecordClass, ResponseCode } from "../protocol/types.js";
import type { DnsMessage } from "../protocol/types.js";

describe("DNS プロトコル", () => {
  describe("ドメイン名エンコード/デコード", () => {
    it("通常のドメイン名をエンコード/デコードする", () => {
      const buf = new ArrayBuffer(64);
      const view = new DataView(buf);
      const end = encodeDomainName(view, 0, "example.com");

      const data = new Uint8Array(buf);
      // [7]example[3]com[0]
      expect(data[0]).toBe(7);
      expect(data[8]).toBe(3);
      expect(end).toBe(13); // 7 + 'example' + 3 + 'com' + 0 = 1+7+1+3+1

      const { name, newOffset } = decodeDomainName(data, 0);
      expect(name).toBe("example.com");
      expect(newOffset).toBe(13);
    });

    it("サブドメインをエンコード/デコードする", () => {
      const buf = new ArrayBuffer(64);
      const view = new DataView(buf);
      encodeDomainName(view, 0, "www.example.com");

      const { name } = decodeDomainName(new Uint8Array(buf), 0);
      expect(name).toBe("www.example.com");
    });

    it("空文字列をエンコード/デコードする", () => {
      const buf = new ArrayBuffer(64);
      const view = new DataView(buf);
      const end = encodeDomainName(view, 0, "");
      expect(end).toBe(1); // 終端の0だけ

      const { name } = decodeDomainName(new Uint8Array(buf), 0);
      expect(name).toBe("");
    });
  });

  describe("メッセージ エンコード/デコード", () => {
    it("クエリメッセージをエンコード/デコードする", () => {
      const msg: DnsMessage = {
        header: {
          id: 0x1234,
          qr: 0,
          opcode: 0,
          aa: false,
          tc: false,
          rd: true,
          ra: false,
          rcode: ResponseCode.NoError,
          qdcount: 1,
          ancount: 0,
          nscount: 0,
          arcount: 0,
        },
        questions: [
          { name: "example.com", type: RecordType.A, class: RecordClass.IN },
        ],
        answers: [],
        authorities: [],
        additionals: [],
      };

      const encoded = encodeDnsMessage(msg);
      const decoded = decodeDnsMessage(encoded);

      expect(decoded.header.id).toBe(0x1234);
      expect(decoded.header.qr).toBe(0);
      expect(decoded.header.rd).toBe(true);
      expect(decoded.header.qdcount).toBe(1);
      expect(decoded.questions).toHaveLength(1);
      expect(decoded.questions[0]?.name).toBe("example.com");
      expect(decoded.questions[0]?.type).toBe(RecordType.A);
    });

    it("レスポンスメッセージをエンコード/デコードする", () => {
      const msg: DnsMessage = {
        header: {
          id: 0xABCD,
          qr: 1,
          opcode: 0,
          aa: true,
          tc: false,
          rd: true,
          ra: true,
          rcode: ResponseCode.NoError,
          qdcount: 1,
          ancount: 1,
          nscount: 0,
          arcount: 0,
        },
        questions: [
          { name: "example.com", type: RecordType.A, class: RecordClass.IN },
        ],
        answers: [
          { name: "example.com", type: RecordType.A, class: RecordClass.IN, ttl: 3600, data: "93.184.216.34" },
        ],
        authorities: [],
        additionals: [],
      };

      const encoded = encodeDnsMessage(msg);
      const decoded = decodeDnsMessage(encoded);

      expect(decoded.header.qr).toBe(1);
      expect(decoded.header.aa).toBe(true);
      expect(decoded.header.ra).toBe(true);
      expect(decoded.answers).toHaveLength(1);
      expect(decoded.answers[0]?.name).toBe("example.com");
      expect(decoded.answers[0]?.data).toBe("93.184.216.34");
      expect(decoded.answers[0]?.ttl).toBe(3600);
    });

    it("NS レコードをエンコード/デコードする", () => {
      const msg: DnsMessage = {
        header: {
          id: 1, qr: 1, opcode: 0, aa: false, tc: false, rd: false, ra: false,
          rcode: ResponseCode.NoError, qdcount: 0, ancount: 0, nscount: 1, arcount: 1,
        },
        questions: [],
        answers: [],
        authorities: [
          { name: "example.com", type: RecordType.NS, class: RecordClass.IN, ttl: 86400, data: "ns1.example.com" },
        ],
        additionals: [
          { name: "ns1.example.com", type: RecordType.A, class: RecordClass.IN, ttl: 3600, data: "93.184.216.34" },
        ],
      };

      const encoded = encodeDnsMessage(msg);
      const decoded = decodeDnsMessage(encoded);

      expect(decoded.authorities).toHaveLength(1);
      expect(decoded.authorities[0]?.data).toBe("ns1.example.com");
      expect(decoded.additionals).toHaveLength(1);
      expect(decoded.additionals[0]?.data).toBe("93.184.216.34");
    });
  });
});
