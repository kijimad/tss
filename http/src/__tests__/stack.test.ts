import { describe, it, expect } from "vitest";
import {
  serializeEthernet, deserializeEthernet,
  serializeIp, deserializeIp,
  serializeTcp, deserializeTcp,
  serializeArp, deserializeArp,
  serializeHttpRequest, deserializeHttpRequest,
  serializeHttpResponse, deserializeHttpResponse,
  macToBytes, bytesToMac,
} from "../stack/serialize.js";
import { NetworkNode } from "../devices/node.js";
import { Link } from "../devices/link.js";
import type { HttpRequest, HttpResponse } from "../stack/types.js";

describe("シリアライズ", () => {
  describe("MAC アドレス", () => {
    it("文字列とバイト列を相互変換する", () => {
      const mac = "AA:BB:CC:00:11:22";
      const bytes = macToBytes(mac);
      expect(bytes).toEqual(new Uint8Array([0xAA, 0xBB, 0xCC, 0x00, 0x11, 0x22]));
      expect(bytesToMac(bytes, 0)).toBe(mac);
    });
  });

  describe("Ethernet", () => {
    it("フレームをエンコード/デコードする", () => {
      const frame = {
        srcMac: "AA:BB:CC:00:00:01",
        dstMac: "DD:EE:FF:00:00:02",
        etherType: 0x0800,
        payload: new Uint8Array([1, 2, 3]),
      };
      const encoded = serializeEthernet(frame);
      expect(encoded.length).toBe(14 + 3); // ヘッダ14B + ペイロード3B

      const decoded = deserializeEthernet(encoded);
      expect(decoded.srcMac).toBe("AA:BB:CC:00:00:01");
      expect(decoded.dstMac).toBe("DD:EE:FF:00:00:02");
      expect(decoded.etherType).toBe(0x0800);
      expect(decoded.payload).toEqual(new Uint8Array([1, 2, 3]));
    });
  });

  describe("ARP", () => {
    it("パケットをエンコード/デコードする", () => {
      const arp = {
        operation: 1 as const,
        senderMac: "AA:BB:CC:00:00:01",
        senderIp: "192.168.1.10",
        targetMac: "00:00:00:00:00:00",
        targetIp: "192.168.1.1",
      };
      const encoded = serializeArp(arp);
      expect(encoded.length).toBe(28);

      const decoded = deserializeArp(encoded);
      expect(decoded.operation).toBe(1);
      expect(decoded.senderMac).toBe("AA:BB:CC:00:00:01");
      expect(decoded.senderIp).toBe("192.168.1.10");
      expect(decoded.targetIp).toBe("192.168.1.1");
    });
  });

  describe("IP", () => {
    it("パケットをエンコード/デコードする", () => {
      const packet = {
        header: { version: 4 as const, headerLength: 20, ttl: 64, protocol: 6, srcIp: "192.168.1.10", dstIp: "93.184.216.34" },
        payload: new Uint8Array([10, 20, 30]),
      };
      const encoded = serializeIp(packet);
      expect(encoded.length).toBe(20 + 3);

      const decoded = deserializeIp(encoded);
      expect(decoded.header.srcIp).toBe("192.168.1.10");
      expect(decoded.header.dstIp).toBe("93.184.216.34");
      expect(decoded.header.ttl).toBe(64);
      expect(decoded.header.protocol).toBe(6);
      expect(decoded.payload).toEqual(new Uint8Array([10, 20, 30]));
    });
  });

  describe("TCP", () => {
    it("セグメントをエンコード/デコードする", () => {
      const segment = {
        header: {
          srcPort: 49152, dstPort: 80, seqNum: 1000, ackNum: 0,
          dataOffset: 20, flags: { fin: false, syn: true, rst: false, psh: false, ack: false, urg: false },
          windowSize: 65535, checksum: 0,
        },
        payload: new Uint8Array(0),
      };
      const encoded = serializeTcp(segment);
      expect(encoded.length).toBe(20);

      const decoded = deserializeTcp(encoded);
      expect(decoded.header.srcPort).toBe(49152);
      expect(decoded.header.dstPort).toBe(80);
      expect(decoded.header.seqNum).toBe(1000);
      expect(decoded.header.flags.syn).toBe(true);
      expect(decoded.header.flags.ack).toBe(false);
    });

    it("データ付きセグメントをエンコード/デコードする", () => {
      const data = new TextEncoder().encode("Hello");
      const segment = {
        header: {
          srcPort: 80, dstPort: 49152, seqNum: 5000, ackNum: 1001,
          dataOffset: 20, flags: { fin: false, syn: false, rst: false, psh: true, ack: true, urg: false },
          windowSize: 65535, checksum: 0,
        },
        payload: data,
      };
      const encoded = serializeTcp(segment);
      const decoded = deserializeTcp(encoded);
      expect(new TextDecoder().decode(decoded.payload)).toBe("Hello");
      expect(decoded.header.flags.psh).toBe(true);
      expect(decoded.header.flags.ack).toBe(true);
    });
  });

  describe("HTTP", () => {
    it("リクエストをエンコード/デコードする", () => {
      const req: HttpRequest = {
        method: "GET", path: "/index.html", version: "HTTP/1.1",
        headers: new Map([["Host", "example.com"], ["Accept", "text/html"]]),
        body: "",
      };
      const encoded = serializeHttpRequest(req);
      const decoded = deserializeHttpRequest(encoded);
      expect(decoded.method).toBe("GET");
      expect(decoded.path).toBe("/index.html");
      expect(decoded.headers.get("Host")).toBe("example.com");
    });

    it("レスポンスをエンコード/デコードする", () => {
      const res: HttpResponse = {
        version: "HTTP/1.1", statusCode: 200, statusText: "OK",
        headers: new Map([["Content-Type", "text/html"]]),
        body: "<h1>Hello</h1>",
      };
      const encoded = serializeHttpResponse(res);
      const decoded = deserializeHttpResponse(encoded);
      expect(decoded.statusCode).toBe(200);
      expect(decoded.body).toBe("<h1>Hello</h1>");
    });
  });
});

describe("ネットワークノード", () => {
  describe("ARP", () => {
    it("ARP リクエスト/リプライで MAC アドレスを学習する", () => {
      const link = new Link("lan");

      const pc = new NetworkNode("PC");
      pc.addNic("eth0", "AA:00:00:00:00:01", "192.168.1.10", "255.255.255.0");
      pc.connectLink("eth0", link);

      const router = new NetworkNode("Router");
      router.addNic("lan0", "AA:00:00:00:00:02", "192.168.1.1", "255.255.255.0");
      router.connectLink("lan0", link);

      // PC が ルータの MAC を ARP で問い合わせる
      pc.sendArpRequest("192.168.1.1", "eth0");

      // ルータが ARP リプライを返し、PC の ARP テーブルに登録される
      const entry = pc.arpTable.find(e => e.ip === "192.168.1.1");
      expect(entry).toBeDefined();
      expect(entry?.mac).toBe("AA:00:00:00:00:02");

      // ルータ側も PC の MAC を学習する
      const routerEntry = router.arpTable.find(e => e.ip === "192.168.1.10");
      expect(routerEntry).toBeDefined();
      expect(routerEntry?.mac).toBe("AA:00:00:00:00:01");
    });
  });

  describe("IP ルーティング + TCP + HTTP", () => {
    it("PC → ルータ → サーバ の通信で HTTP レスポンスを受け取る", () => {
      // ネットワーク構築
      const lanLink = new Link("lan");
      const wanLink = new Link("wan");

      // PC
      const pc = new NetworkNode("PC");
      pc.addNic("eth0", "AA:00:00:00:00:01", "192.168.1.10", "255.255.255.0");
      pc.connectLink("eth0", lanLink);
      pc.addRoute("192.168.1.0", "255.255.255.0", "0.0.0.0", "eth0");
      pc.addDefaultRoute("192.168.1.1", "eth0");
      // ARP エントリなし → ARP で動的に解決される

      // ルータ
      const router = new NetworkNode("Router");
      router.addNic("lan0", "AA:00:00:00:00:02", "192.168.1.1", "255.255.255.0");
      router.addNic("wan0", "BB:00:00:00:00:01", "203.0.113.1", "255.255.255.0");
      router.connectLink("lan0", lanLink);
      router.connectLink("wan0", wanLink);
      router.addRoute("192.168.1.0", "255.255.255.0", "0.0.0.0", "lan0");
      router.addRoute("0.0.0.0", "0.0.0.0", "0.0.0.0", "wan0");
      router.ipForwardingEnabled = true;
      router.natEnabled = true;

      // サーバ
      const server = new NetworkNode("Server");
      server.addNic("eth0", "CC:00:00:00:00:01", "93.184.216.34", "255.255.255.0");
      server.connectLink("eth0", wanLink);
      server.addRoute("0.0.0.0", "0.0.0.0", "0.0.0.0", "eth0");

      // サーバで HTTP をリッスン
      server.listen(80, (req) => ({
        version: "HTTP/1.1",
        statusCode: 200,
        statusText: "OK",
        headers: new Map([["Content-Type", "text/html"]]),
        body: `<h1>Hello from ${req.path}</h1>`,
      }));

      // HTTP リクエスト送信
      pc.sendHttpRequest("93.184.216.34", 80, {
        method: "GET",
        path: "/test",
        version: "HTTP/1.1",
        headers: new Map([["Host", "93.184.216.34"]]),
        body: "",
      });

      // イベント検証

      // PC から TCP SYN が送られた
      const pcTcpSend = pc.events.filter(e => e.type === "tcp_send");
      expect(pcTcpSend.length).toBeGreaterThan(0);
      expect(pcTcpSend[0]?.flags).toContain("SYN");

      // サーバが SYN を受信した
      const serverTcpRecv = server.events.filter(e => e.type === "tcp_recv");
      expect(serverTcpRecv.length).toBeGreaterThan(0);

      // サーバが SYN+ACK を返した
      const serverTcpSend = server.events.filter(e => e.type === "tcp_send");
      const synAck = serverTcpSend.find(e => e.type === "tcp_send" && e.flags.includes("SYN") && e.flags.includes("ACK"));
      expect(synAck).toBeDefined();

      // ARP が行われた
      const pcArp = pc.events.filter(e => e.type === "arp_request");
      expect(pcArp.length).toBeGreaterThan(0);

      // PC が ルータの MAC を学習した
      const routerMacEntry = pc.arpTable.find(e => e.ip === "192.168.1.1");
      expect(routerMacEntry).toBeDefined();
      expect(routerMacEntry?.mac).toBe("AA:00:00:00:00:02");

      // サーバが HTTP レスポンスを返した
      const httpRes = server.events.find(e => e.type === "http_response");
      expect(httpRes).toBeDefined();
      if (httpRes?.type === "http_response") {
        expect(httpRes.statusCode).toBe(200);
      }

      // ルータで NAT が行われた
      const natEvents = router.events.filter(e => e.type === "ip_nat");
      expect(natEvents.length).toBeGreaterThan(0);

      // ルータで IP 転送が行われた
      const fwdEvents = router.events.filter(e => e.type === "ip_forward");
      expect(fwdEvents.length).toBeGreaterThan(0);
    });
  });
});
