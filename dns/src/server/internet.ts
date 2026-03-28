/**
 * internet.ts — 仮想インターネットのセットアップ
 *
 * 実際のDNS階層を模したサーバ群を構築する:
 *
 *   ルートサーバ (198.41.0.4)
 *     ├── .com TLD サーバ (192.5.6.30)
 *     │     ├── example.com 権威 (93.184.216.34)
 *     │     └── google.com 権威 (216.239.32.10)
 *     ├── .net TLD サーバ (192.33.14.30)
 *     │     └── cloudflare.net 権威 (104.16.132.229)
 *     └── .jp TLD サーバ (203.119.1.1)
 *           └── example.jp 権威 (210.171.226.50)
 *
 * 各サーバは自分のゾーンのレコードだけを知っている。
 * リゾルバがルートから順に辿って最終的な回答にたどり着く。
 */
import { RecordType, RecordClass } from "../protocol/types.js";
import type { DnsRecord } from "../protocol/types.js";
import { DnsServer } from "./dns-server.js";
import { VirtualNetwork } from "../network/virtual-network.js";

// レコード作成ヘルパー
function aRecord(name: string, ip: string, ttl = 3600): DnsRecord {
  return { name, type: RecordType.A, class: RecordClass.IN, ttl, data: ip };
}

function nsRecord(name: string, ns: string, ttl = 86400): DnsRecord {
  return { name, type: RecordType.NS, class: RecordClass.IN, ttl, data: ns };
}

function cnameRecord(name: string, target: string, ttl = 3600): DnsRecord {
  return { name, type: RecordType.CNAME, class: RecordClass.IN, ttl, data: target };
}

function mxRecord(name: string, mailServer: string, ttl = 3600): DnsRecord {
  return { name, type: RecordType.MX, class: RecordClass.IN, ttl, data: mailServer };
}

function txtRecord(name: string, text: string, ttl = 3600): DnsRecord {
  return { name, type: RecordType.TXT, class: RecordClass.IN, ttl, data: text };
}

// 仮想インターネットを構築する
export function buildInternet(): { network: VirtualNetwork; servers: DnsServer[] } {
  const network = new VirtualNetwork();
  const servers: DnsServer[] = [];

  // === ルートサーバ ===
  const root = new DnsServer({
    name: "a.root-servers.net",
    ip: "198.41.0.4",
    zones: new Map([
      [".", {
        records: [
          // .com の委任
          nsRecord("com", "a.gtld-servers.net"),
          aRecord("a.gtld-servers.net", "192.5.6.30"),
          // .net の委任
          nsRecord("net", "a.gtld-servers.net-net"),
          aRecord("a.gtld-servers.net-net", "192.33.14.30"),
          // .jp の委任
          nsRecord("jp", "a.dns.jp"),
          aRecord("a.dns.jp", "203.119.1.1"),
          // .org の委任
          nsRecord("org", "a.gtld-servers.org"),
          aRecord("a.gtld-servers.org", "199.19.56.1"),
        ],
      }],
    ]),
  });
  servers.push(root);
  network.registerServer(root.ip, (pkt) => root.handlePacket(pkt));

  // === .com TLD サーバ ===
  const comTld = new DnsServer({
    name: "a.gtld-servers.net",
    ip: "192.5.6.30",
    zones: new Map([
      ["com", {
        records: [
          // example.com の委任
          nsRecord("example.com", "ns1.example.com"),
          aRecord("ns1.example.com", "93.184.216.34"),
          // google.com の委任
          nsRecord("google.com", "ns1.google.com"),
          aRecord("ns1.google.com", "216.239.32.10"),
          // github.com の委任
          nsRecord("github.com", "ns1.github.com"),
          aRecord("ns1.github.com", "140.82.112.3"),
        ],
      }],
    ]),
  });
  servers.push(comTld);
  network.registerServer(comTld.ip, (pkt) => comTld.handlePacket(pkt));

  // === .net TLD サーバ ===
  const netTld = new DnsServer({
    name: "a.gtld-servers.net-net",
    ip: "192.33.14.30",
    zones: new Map([
      ["net", {
        records: [
          nsRecord("cloudflare.net", "ns1.cloudflare.net"),
          aRecord("ns1.cloudflare.net", "104.16.132.229"),
        ],
      }],
    ]),
  });
  servers.push(netTld);
  network.registerServer(netTld.ip, (pkt) => netTld.handlePacket(pkt));

  // === .jp TLD サーバ ===
  const jpTld = new DnsServer({
    name: "a.dns.jp",
    ip: "203.119.1.1",
    zones: new Map([
      ["jp", {
        records: [
          nsRecord("example.jp", "ns1.example.jp"),
          aRecord("ns1.example.jp", "210.171.226.50"),
        ],
      }],
    ]),
  });
  servers.push(jpTld);
  network.registerServer(jpTld.ip, (pkt) => jpTld.handlePacket(pkt));

  // === .org TLD サーバ ===
  const orgTld = new DnsServer({
    name: "a.gtld-servers.org",
    ip: "199.19.56.1",
    zones: new Map([
      ["org", {
        records: [
          nsRecord("wikipedia.org", "ns1.wikipedia.org"),
          aRecord("ns1.wikipedia.org", "208.80.154.224"),
        ],
      }],
    ]),
  });
  servers.push(orgTld);
  network.registerServer(orgTld.ip, (pkt) => orgTld.handlePacket(pkt));

  // === 権威サーバ群 ===

  // example.com
  const exampleCom = new DnsServer({
    name: "ns1.example.com",
    ip: "93.184.216.34",
    zones: new Map([
      ["example.com", {
        records: [
          aRecord("example.com", "93.184.216.34"),
          aRecord("www.example.com", "93.184.216.34"),
          cnameRecord("blog.example.com", "www.example.com"),
          mxRecord("example.com", "mail.example.com"),
          aRecord("mail.example.com", "93.184.216.35"),
          txtRecord("example.com", "v=spf1 include:example.com ~all"),
          nsRecord("example.com", "ns1.example.com"),
          aRecord("ns1.example.com", "93.184.216.34"),
        ],
      }],
    ]),
  });
  servers.push(exampleCom);
  network.registerServer(exampleCom.ip, (pkt) => exampleCom.handlePacket(pkt));

  // google.com
  const googleCom = new DnsServer({
    name: "ns1.google.com",
    ip: "216.239.32.10",
    zones: new Map([
      ["google.com", {
        records: [
          aRecord("google.com", "142.250.80.46"),
          aRecord("www.google.com", "142.250.80.46"),
          aRecord("mail.google.com", "142.250.80.17"),
          mxRecord("google.com", "smtp.google.com"),
          aRecord("smtp.google.com", "142.250.80.26"),
        ],
      }],
    ]),
  });
  servers.push(googleCom);
  network.registerServer(googleCom.ip, (pkt) => googleCom.handlePacket(pkt));

  // github.com
  const githubCom = new DnsServer({
    name: "ns1.github.com",
    ip: "140.82.112.3",
    zones: new Map([
      ["github.com", {
        records: [
          aRecord("github.com", "140.82.112.3"),
          aRecord("www.github.com", "140.82.112.3"),
          aRecord("api.github.com", "140.82.112.5"),
        ],
      }],
    ]),
  });
  servers.push(githubCom);
  network.registerServer(githubCom.ip, (pkt) => githubCom.handlePacket(pkt));

  // cloudflare.net
  const cloudflareNet = new DnsServer({
    name: "ns1.cloudflare.net",
    ip: "104.16.132.229",
    zones: new Map([
      ["cloudflare.net", {
        records: [
          aRecord("cloudflare.net", "104.16.132.229"),
          aRecord("www.cloudflare.net", "104.16.133.229"),
        ],
      }],
    ]),
  });
  servers.push(cloudflareNet);
  network.registerServer(cloudflareNet.ip, (pkt) => cloudflareNet.handlePacket(pkt));

  // example.jp
  const exampleJp = new DnsServer({
    name: "ns1.example.jp",
    ip: "210.171.226.50",
    zones: new Map([
      ["example.jp", {
        records: [
          aRecord("example.jp", "210.171.226.50"),
          aRecord("www.example.jp", "210.171.226.51"),
        ],
      }],
    ]),
  });
  servers.push(exampleJp);
  network.registerServer(exampleJp.ip, (pkt) => exampleJp.handlePacket(pkt));

  // wikipedia.org
  const wikipediaOrg = new DnsServer({
    name: "ns1.wikipedia.org",
    ip: "208.80.154.224",
    zones: new Map([
      ["wikipedia.org", {
        records: [
          aRecord("wikipedia.org", "208.80.154.224"),
          aRecord("en.wikipedia.org", "208.80.154.224"),
          aRecord("ja.wikipedia.org", "208.80.154.224"),
        ],
      }],
    ]),
  });
  servers.push(wikipediaOrg);
  network.registerServer(wikipediaOrg.ip, (pkt) => wikipediaOrg.handlePacket(pkt));

  return { network, servers };
}
