/* MITM シミュレーター プリセット */

import type { Preset, SimOp } from "./types.js";
import { noDefense, fullDefense, hstsOnly, certDefense, validCert } from "./engine.js";

export const PRESETS: Preset[] = [
  {
    name: "ARPスプーフィング（HTTP）",
    description: "平文HTTP通信に対するARPスプーフィング攻撃",
    build: (): SimOp[] => [
      {
        type: "attack", method: "arp_spoofing", protocol: "http", tls: "none",
        defense: noDefense(), httpPayload: "POST /login HTTP/1.1\r\nuser=admin&password=secret123",
      },
    ],
  },
  {
    name: "ARPスプーフィング（HTTPS）",
    description: "暗号化HTTPS通信に対するARPスプーフィング（暗号化の効果を検証）",
    build: (): SimOp[] => [
      {
        type: "attack", method: "arp_spoofing", protocol: "http", tls: "none",
        defense: noDefense(), httpPayload: "GET /api/account HTTP/1.1\r\nCookie: token=abc123",
      },
      {
        type: "attack", method: "arp_spoofing", protocol: "https", tls: "tls1.2",
        serverCert: validCert("example.com"),
        defense: noDefense(), httpPayload: "GET /api/account HTTP/1.1\r\nCookie: token=abc123",
      },
    ],
  },
  {
    name: "DNSスプーフィング",
    description: "偽DNS応答によるトラフィック誘導（DNSSEC有無の比較）",
    build: (): SimOp[] => [
      {
        type: "attack", method: "dns_spoofing", protocol: "http", tls: "none",
        defense: noDefense(), httpPayload: "GET /login HTTP/1.1\r\nHost: example.com",
      },
      {
        type: "attack", method: "dns_spoofing", protocol: "https", tls: "tls1.2",
        serverCert: validCert("example.com"),
        defense: { ...noDefense(), dnssec: true }, httpPayload: "GET /login HTTP/1.1\r\nHost: example.com",
      },
    ],
  },
  {
    name: "SSLストリッピング",
    description: "HTTPS通信をHTTPにダウングレードする攻撃（HSTS防御の検証）",
    build: (): SimOp[] => [
      {
        type: "attack", method: "ssl_stripping", protocol: "https", tls: "tls1.2",
        serverCert: validCert("example.com"),
        defense: noDefense(), httpPayload: "POST /transfer HTTP/1.1\r\namount=10000&to=attacker",
      },
      {
        type: "attack", method: "ssl_stripping", protocol: "https", tls: "tls1.2",
        serverCert: validCert("example.com"),
        defense: hstsOnly(), httpPayload: "POST /transfer HTTP/1.1\r\namount=10000&to=attacker",
      },
    ],
  },
  {
    name: "偽証明書攻撃",
    description: "自己署名証明書を使用したMITM（証明書検証の重要性）",
    build: (): SimOp[] => [
      {
        type: "attack", method: "rogue_cert", protocol: "https", tls: "tls1.2",
        serverCert: validCert("example.com"),
        defense: noDefense(), httpPayload: "POST /api/payment HTTP/1.1\r\ncard=4111111111111111",
      },
      {
        type: "attack", method: "rogue_cert", protocol: "https", tls: "tls1.2",
        serverCert: validCert("example.com"),
        defense: certDefense(), httpPayload: "POST /api/payment HTTP/1.1\r\ncard=4111111111111111",
      },
    ],
  },
  {
    name: "セッションハイジャック",
    description: "セッションCookieの窃取によるなりすまし攻撃",
    build: (): SimOp[] => [
      {
        type: "attack", method: "session_hijack", protocol: "http", tls: "none",
        defense: noDefense(), httpPayload: "GET /dashboard HTTP/1.1\r\nCookie: session_id=abc123",
      },
      {
        type: "attack", method: "session_hijack", protocol: "https", tls: "tls1.2",
        serverCert: validCert("example.com"),
        defense: noDefense(), httpPayload: "GET /dashboard HTTP/1.1\r\nCookie: session_id=abc123",
      },
    ],
  },
  {
    name: "パケットインジェクション",
    description: "HTTPレスポンスへの悪意あるコード注入",
    build: (): SimOp[] => [
      {
        type: "attack", method: "packet_injection", protocol: "http", tls: "none",
        defense: noDefense(), httpPayload: "HTTP/1.1 200 OK\r\n<html><body>Welcome</body></html>",
      },
      {
        type: "attack", method: "packet_injection", protocol: "https", tls: "tls1.2",
        serverCert: validCert("example.com"),
        defense: noDefense(), httpPayload: "HTTP/1.1 200 OK\r\n<html><body>Welcome</body></html>",
      },
    ],
  },
  {
    name: "パッシブ盗聴",
    description: "ネットワーク通信の受動的な傍受（暗号化の重要性）",
    build: (): SimOp[] => [
      {
        type: "attack", method: "passive_sniff", protocol: "http", tls: "none",
        defense: noDefense(), httpPayload: "POST /login HTTP/1.1\r\nuser=admin&password=P@ssw0rd",
      },
      {
        type: "attack", method: "passive_sniff", protocol: "https", tls: "tls1.2",
        serverCert: validCert("example.com"),
        defense: noDefense(), httpPayload: "POST /login HTTP/1.1\r\nuser=admin&password=P@ssw0rd",
      },
    ],
  },
  {
    name: "TLSバージョン比較",
    description: "TLSバージョンごとの安全性比較",
    build: (): SimOp[] => [
      {
        type: "attack", method: "passive_sniff", protocol: "http", tls: "none",
        defense: noDefense(), httpPayload: "GET /secret HTTP/1.1",
      },
      {
        type: "attack", method: "passive_sniff", protocol: "https", tls: "tls1.0",
        serverCert: validCert("example.com"),
        defense: { ...noDefense(), minTls: "tls1.2" }, httpPayload: "GET /secret HTTP/1.1",
      },
      {
        type: "attack", method: "passive_sniff", protocol: "https", tls: "tls1.2",
        serverCert: validCert("example.com"),
        defense: noDefense(), httpPayload: "GET /secret HTTP/1.1",
      },
      {
        type: "attack", method: "passive_sniff", protocol: "https", tls: "tls1.3",
        serverCert: validCert("example.com"),
        defense: noDefense(), httpPayload: "GET /secret HTTP/1.1",
      },
    ],
  },
  {
    name: "多層防御",
    description: "全防御メカニズムを有効にした場合の攻撃結果",
    build: (): SimOp[] => [
      {
        type: "attack", method: "arp_spoofing", protocol: "https", tls: "tls1.3",
        serverCert: validCert("example.com"),
        defense: fullDefense(), httpPayload: "POST /api/data HTTP/1.1\r\nsecret=classified",
      },
      {
        type: "attack", method: "dns_spoofing", protocol: "https", tls: "tls1.3",
        serverCert: validCert("example.com"),
        defense: fullDefense(), httpPayload: "POST /api/data HTTP/1.1\r\nsecret=classified",
      },
      {
        type: "attack", method: "ssl_stripping", protocol: "https", tls: "tls1.3",
        serverCert: validCert("example.com"),
        defense: fullDefense(), httpPayload: "POST /api/data HTTP/1.1\r\nsecret=classified",
      },
    ],
  },
];
