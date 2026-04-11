import type { Preset } from "./types.js";

/** 共通ノード定義ヘルパー */
function basicTopology(tunnelIface: string, tunnelLocal: string, tunnelRemote: string) {
  return {
    nodes: [
      {
        id: "src", name: "送信元ホスト", type: "host" as const,
        interfaces: [{ name: "eth0", address: "10.0.1.10", subnet: "10.0.1.0/24" }],
      },
      {
        id: "te1", name: "トンネル入口ルータ", type: "tunnel-endpoint" as const,
        interfaces: [
          { name: "eth0", address: "10.0.1.1", subnet: "10.0.1.0/24" },
          { name: "eth1", address: tunnelLocal, subnet: "203.0.113.0/24" },
          { name: tunnelIface, address: "172.16.0.1", subnet: "172.16.0.0/30" },
        ],
      },
      {
        id: "isp1", name: "ISPルータ1", type: "router" as const,
        interfaces: [
          { name: "eth0", address: "203.0.113.2", subnet: "203.0.113.0/24" },
          { name: "eth1", address: "198.51.100.1", subnet: "198.51.100.0/24" },
        ],
      },
      {
        id: "isp2", name: "ISPルータ2", type: "router" as const,
        interfaces: [
          { name: "eth0", address: "198.51.100.2", subnet: "198.51.100.0/24" },
          { name: "eth1", address: tunnelRemote, subnet: "192.0.2.0/24" },
        ],
      },
      {
        id: "te2", name: "トンネル出口ルータ", type: "tunnel-endpoint" as const,
        interfaces: [
          { name: "eth0", address: tunnelRemote, subnet: "192.0.2.0/24" },
          { name: "eth1", address: "10.0.2.1", subnet: "10.0.2.0/24" },
          { name: tunnelIface, address: "172.16.0.2", subnet: "172.16.0.0/30" },
        ],
      },
      {
        id: "dst", name: "宛先ホスト", type: "host" as const,
        interfaces: [{ name: "eth0", address: "10.0.2.10", subnet: "10.0.2.0/24" }],
      },
    ],
    links: [
      { from: { nodeId: "src", iface: "eth0" }, to: { nodeId: "te1", iface: "eth0" } },
      { from: { nodeId: "te1", iface: "eth1" }, to: { nodeId: "isp1", iface: "eth0" }, label: "インターネット" },
      { from: { nodeId: "isp1", iface: "eth1" }, to: { nodeId: "isp2", iface: "eth0" }, label: "インターネット" },
      { from: { nodeId: "isp2", iface: "eth1" }, to: { nodeId: "te2", iface: "eth0" }, label: "インターネット" },
      { from: { nodeId: "te2", iface: "eth1" }, to: { nodeId: "dst", iface: "eth0" } },
      { from: { nodeId: "te1", iface: tunnelIface }, to: { nodeId: "te2", iface: tunnelIface }, label: "トンネル" },
    ],
  };
}

export const presets: Preset[] = [
  // 1. IP-in-IP (IPIP) 基本
  {
    name: "IP-in-IP (RFC 2003)",
    description: "最もシンプルなトンネリング。IPv4パケットをそのまま別のIPv4パケットに格納 (proto=4)",
    ...basicTopology("tun0", "203.0.113.1", "192.0.2.1"),
    tunnel: {
      name: "IPIP-Tunnel",
      protocol: "IPIP",
      localEndpoint: "203.0.113.1",
      remoteEndpoint: "192.0.2.1",
      localInner: "10.0.1.10",
      remoteInner: "10.0.2.10",
      mtu: 1480,
    },
    packets: [
      { src: "10.0.1.10", dst: "10.0.2.10", payload: "Hello via IPIP", size: 64 },
    ],
  },

  // 2. GRE基本
  {
    name: "GRE基本 (RFC 2784)",
    description: "Generic Routing Encapsulationによるトンネリング。GREヘッダ+外側IPヘッダ付与",
    ...basicTopology("gre0", "203.0.113.1", "192.0.2.1"),
    tunnel: {
      name: "GRE-Tunnel",
      protocol: "GRE",
      localEndpoint: "203.0.113.1",
      remoteEndpoint: "192.0.2.1",
      localInner: "10.0.1.10",
      remoteInner: "10.0.2.10",
      mtu: 1476,
    },
    packets: [
      { src: "10.0.1.10", dst: "10.0.2.10", payload: "Hello via GRE", size: 100 },
    ],
  },

  // 3. GRE + Key
  {
    name: "GRE + Key (マルチトンネル識別)",
    description: "GREキーフィールドで複数のトンネルを識別。同一エンドポイント間で複数トンネル運用可能",
    ...basicTopology("gre0", "203.0.113.1", "192.0.2.1"),
    tunnel: {
      name: "GRE-Key-Tunnel",
      protocol: "GRE",
      localEndpoint: "203.0.113.1",
      remoteEndpoint: "192.0.2.1",
      localInner: "10.0.1.10",
      remoteInner: "10.0.2.10",
      greKey: 12345,
      mtu: 1472,
    },
    packets: [
      { src: "10.0.1.10", dst: "10.0.2.10", payload: "GRE with Key=12345", size: 80 },
      { src: "10.0.1.10", dst: "10.0.2.10", payload: "Second packet", size: 60 },
    ],
  },

  // 4. 6in4 (IPv6 over IPv4)
  {
    name: "6in4 (RFC 4213)",
    description: "IPv6パケットをIPv4トンネルで転送。IPv6アイランド間の接続に使用",
    ...basicTopology("sit0", "203.0.113.1", "192.0.2.1"),
    tunnel: {
      name: "6in4-Tunnel",
      protocol: "6in4",
      localEndpoint: "203.0.113.1",
      remoteEndpoint: "192.0.2.1",
      localInner: "2001:db8:1::10",
      remoteInner: "2001:db8:2::10",
      mtu: 1480,
    },
    packets: [
      { src: "2001:db8:1::10", dst: "2001:db8:2::10", payload: "IPv6 via IPv4", size: 64, ipv6: true },
    ],
  },

  // 5. IPsec トンネルモード
  {
    name: "IPsec トンネルモード (ESP)",
    description: "IPsec ESPによる暗号化トンネル。パケット全体を暗号化して新しいIPヘッダで包む",
    ...basicTopology("ipsec0", "203.0.113.1", "192.0.2.1"),
    tunnel: {
      name: "IPsec-Tunnel",
      protocol: "IPsec",
      localEndpoint: "203.0.113.1",
      remoteEndpoint: "192.0.2.1",
      localInner: "10.0.1.10",
      remoteInner: "10.0.2.10",
      mtu: 1438,
    },
    packets: [
      { src: "10.0.1.10", dst: "10.0.2.10", payload: "Encrypted data", size: 100 },
    ],
  },

  // 6. MTU問題
  {
    name: "MTU問題とフラグメンテーション",
    description: "カプセル化によるオーバーヘッドでMTUを超過する場合の挙動を確認",
    ...basicTopology("gre0", "203.0.113.1", "192.0.2.1"),
    tunnel: {
      name: "GRE-MTU-Tunnel",
      protocol: "GRE",
      localEndpoint: "203.0.113.1",
      remoteEndpoint: "192.0.2.1",
      localInner: "10.0.1.10",
      remoteInner: "10.0.2.10",
      mtu: 200,  // 意図的に低いMTU
    },
    packets: [
      { src: "10.0.1.10", dst: "10.0.2.10", payload: "Small packet", size: 50 },
      { src: "10.0.1.10", dst: "10.0.2.10", payload: "Large packet that exceeds MTU", size: 180 },
    ],
  },

  // 7. TTL問題
  {
    name: "TTL減算とループ防止",
    description: "トンネル通過時の外側IPヘッダTTL減算を確認。TTL=1でのパケット破棄",
    ...basicTopology("tun0", "203.0.113.1", "192.0.2.1"),
    tunnel: {
      name: "IPIP-TTL-Tunnel",
      protocol: "IPIP",
      localEndpoint: "203.0.113.1",
      remoteEndpoint: "192.0.2.1",
      localInner: "10.0.1.10",
      remoteInner: "10.0.2.10",
      mtu: 1480,
    },
    packets: [
      { src: "10.0.1.10", dst: "10.0.2.10", payload: "Normal TTL", size: 40, ttl: 64 },
      { src: "10.0.1.10", dst: "10.0.2.10", payload: "Low TTL", size: 40, ttl: 3 },
    ],
  },

  // 8. 複数パケット連続送信
  {
    name: "複数パケット連続送信 (GRE Sequence)",
    description: "GREシーケンス番号による順序保証付き連続パケット転送",
    ...basicTopology("gre0", "203.0.113.1", "192.0.2.1"),
    tunnel: {
      name: "GRE-Seq-Tunnel",
      protocol: "GRE",
      localEndpoint: "203.0.113.1",
      remoteEndpoint: "192.0.2.1",
      localInner: "10.0.1.10",
      remoteInner: "10.0.2.10",
      greKey: 9999,
      mtu: 1472,
    },
    packets: [
      { src: "10.0.1.10", dst: "10.0.2.10", payload: "Packet #1", size: 50 },
      { src: "10.0.1.10", dst: "10.0.2.10", payload: "Packet #2", size: 60 },
      { src: "10.0.1.10", dst: "10.0.2.10", payload: "Packet #3", size: 70 },
    ],
  },

  // 9. IPv6 over GRE
  {
    name: "IPv6 over GRE",
    description: "GREトンネルでIPv6パケットを転送。GREヘッダのプロトコルタイプが0x86DD",
    ...basicTopology("gre6-0", "203.0.113.1", "192.0.2.1"),
    tunnel: {
      name: "GRE6-Tunnel",
      protocol: "GRE6",
      localEndpoint: "203.0.113.1",
      remoteEndpoint: "192.0.2.1",
      localInner: "2001:db8:a::1",
      remoteInner: "2001:db8:b::1",
      mtu: 1476,
    },
    packets: [
      { src: "2001:db8:a::1", dst: "2001:db8:b::1", payload: "IPv6 over GRE", size: 80, ipv6: true },
    ],
  },

  // 10. プロトコル比較
  {
    name: "プロトコル比較 (IPIP vs GRE vs IPsec)",
    description: "同じペイロードを3つのトンネルプロトコルで送信し、オーバーヘッドを比較",
    nodes: [
      { id: "src", name: "送信元", type: "host" as const,
        interfaces: [{ name: "eth0", address: "10.0.1.10", subnet: "10.0.1.0/24" }] },
      { id: "te1", name: "トンネル入口", type: "tunnel-endpoint" as const,
        interfaces: [
          { name: "eth0", address: "10.0.1.1", subnet: "10.0.1.0/24" },
          { name: "eth1", address: "203.0.113.1", subnet: "203.0.113.0/24" },
        ] },
      { id: "te2", name: "トンネル出口", type: "tunnel-endpoint" as const,
        interfaces: [
          { name: "eth0", address: "192.0.2.1", subnet: "192.0.2.0/24" },
          { name: "eth1", address: "10.0.2.1", subnet: "10.0.2.0/24" },
        ] },
      { id: "dst", name: "宛先", type: "host" as const,
        interfaces: [{ name: "eth0", address: "10.0.2.10", subnet: "10.0.2.0/24" }] },
    ],
    links: [
      { from: { nodeId: "src", iface: "eth0" }, to: { nodeId: "te1", iface: "eth0" } },
      { from: { nodeId: "te1", iface: "eth1" }, to: { nodeId: "te2", iface: "eth0" }, label: "インターネット" },
      { from: { nodeId: "te2", iface: "eth1" }, to: { nodeId: "dst", iface: "eth0" } },
    ],
    tunnel: {
      name: "Compare-Tunnel",
      protocol: "GRE",
      localEndpoint: "203.0.113.1",
      remoteEndpoint: "192.0.2.1",
      localInner: "10.0.1.10",
      remoteInner: "10.0.2.10",
      mtu: 1500,
    },
    packets: [
      { src: "10.0.1.10", dst: "10.0.2.10", payload: "100byte payload for comparison", size: 100 },
    ],
  },
];
