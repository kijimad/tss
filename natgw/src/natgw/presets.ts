import type { Preset, Vpc, PacketDef } from "./types.js";

// ── ヘルパー ──

function makeVpc(overrides?: Partial<Vpc>): Vpc {
  return {
    id: "vpc-1", name: "DemoVPC", cidr: "10.0.0.0/16",
    igw: { id: "igw-1", name: "MainIGW" },
    natGateways: [{
      id: "nat-1", name: "NAT-GW-1a", subnetId: "sub-pub-1a",
      eip: { allocationId: "eipalloc-1", publicIp: "54.250.10.1" },
      state: "available", maxConnections: 55000, bandwidthGbps: 45,
    }],
    subnets: [
      { id: "sub-pub-1a", name: "Public-1a", cidr: "10.0.1.0/24", az: "ap-northeast-1a", isPublic: true, routeTableId: "rt-pub" },
      { id: "sub-priv-1a", name: "Private-1a", cidr: "10.0.2.0/24", az: "ap-northeast-1a", isPublic: false, routeTableId: "rt-priv" },
    ],
    routeTables: [
      { id: "rt-pub", name: "PublicRT", routes: [
        { destination: "10.0.0.0/16", target: "local", targetType: "local" },
        { destination: "0.0.0.0/0", target: "igw-1", targetType: "igw" },
      ]},
      { id: "rt-priv", name: "PrivateRT", routes: [
        { destination: "10.0.0.0/16", target: "local", targetType: "local" },
        { destination: "0.0.0.0/0", target: "nat-1", targetType: "nat" },
      ]},
    ],
    instances: [
      { id: "i-web", name: "WebServer", privateIp: "10.0.1.10", subnetId: "sub-pub-1a", publicIp: "54.250.20.1" },
      { id: "i-app", name: "AppServer", privateIp: "10.0.2.10", subnetId: "sub-priv-1a" },
      { id: "i-db", name: "DBServer", privateIp: "10.0.2.20", subnetId: "sub-priv-1a" },
    ],
    ...overrides,
  };
}

function outbound(srcId: string, dstIp: string, proto: "tcp" | "udp" | "icmp" = "tcp", srcPort = 50000, dstPort = 443): PacketDef {
  return { direction: "outbound", srcInstanceId: srcId, dstIp, protocol: proto, srcPort, dstPort, payload: "data" };
}

function response(fromIp: string, natEip: string, fromPort: number, extPort: number, proto: "tcp" | "udp" | "icmp" = "tcp"): PacketDef {
  return {
    direction: "inbound", srcInstanceId: "", dstIp: natEip,
    protocol: proto, srcPort: fromPort, dstPort: extPort, payload: "response",
    isResponse: true, responseFromIp: fromIp,
  };
}

// ── プリセット ──

export const presets: Preset[] = [
  // 1. 基本的なNAT Gateway送信
  {
    name: "1. 基本 — プライベートインスタンスからのアウトバウンド",
    description: "プライベートサブネットのインスタンスがNAT Gateway経由でインターネットにアクセス。SNAT（ソースNAT）でプライベートIP→EIPに変換される。",
    vpc: makeVpc(),
    packets: [outbound("i-app", "8.8.8.8")],
  },

  // 2. レスポンス戻り（DNAT）
  {
    name: "2. レスポンス戻り — DNAT逆変換",
    description: "アウトバウンド後に外部サーバーからのレスポンスがNAT GWに到達し、DNATで元のプライベートIPに戻される。コネクション追跡の仕組み。",
    vpc: makeVpc(),
    packets: [
      outbound("i-app", "93.184.216.34", "tcp", 50000, 443),
      response("93.184.216.34", "54.250.10.1", 443, 1024),
    ],
  },

  // 3. 複数インスタンスからの同時接続
  {
    name: "3. 複数インスタンス — ポート割り当て",
    description: "複数のプライベートインスタンスが同じNAT GWを共有。各接続に異なるエフェメラルポートが割り当てられ、接続を区別する。",
    vpc: makeVpc(),
    packets: [
      outbound("i-app", "8.8.8.8", "tcp", 50000, 443),
      outbound("i-db", "1.1.1.1", "tcp", 50001, 443),
      outbound("i-app", "8.8.4.4", "tcp", 50002, 80),
    ],
  },

  // 4. UDPトラフィック
  {
    name: "4. UDP — DNS問い合わせ",
    description: "UDP通信（DNS問い合わせ）のNAT変換。UDPのアイドルタイムアウトはTCPより短い（120秒 vs 350秒）。",
    vpc: makeVpc(),
    packets: [
      outbound("i-app", "8.8.8.8", "udp", 50000, 53),
      response("8.8.8.8", "54.250.10.1", 53, 1024, "udp"),
    ],
  },

  // 5. ICMPトラフィック
  {
    name: "5. ICMP — Ping送信",
    description: "ICMPパケット（Ping）のNAT変換。ICMPのアイドルタイムアウトは最短（60秒）。",
    vpc: makeVpc(),
    packets: [
      outbound("i-app", "8.8.8.8", "icmp", 0, 0),
    ],
  },

  // 6. 同時接続数上限
  {
    name: "6. 同時接続数上限 — ErrorPortAllocation",
    description: "NAT GWの同時接続数上限に達するとErrorPortAllocationが発生しパケットが破棄される。（テスト用に上限を2に設定）",
    vpc: makeVpc({
      natGateways: [{
        id: "nat-1", name: "NAT-GW-1a", subnetId: "sub-pub-1a",
        eip: { allocationId: "eipalloc-1", publicIp: "54.250.10.1" },
        state: "available", maxConnections: 2, bandwidthGbps: 45,
      }],
    }),
    packets: [
      outbound("i-app", "8.8.8.8", "tcp", 50000, 443),
      outbound("i-app", "1.1.1.1", "tcp", 50001, 443),
      outbound("i-db", "9.9.9.9", "tcp", 50002, 443),
    ],
  },

  // 7. NAT GW状態異常
  {
    name: "7. 状態異常 — NAT GWが利用不可",
    description: "NAT Gatewayの状態がavailableでない場合（pending, failed等）、パケットは破棄される。",
    vpc: makeVpc({
      natGateways: [{
        id: "nat-1", name: "NAT-GW-1a (failed)", subnetId: "sub-pub-1a",
        eip: { allocationId: "eipalloc-1", publicIp: "54.250.10.1" },
        state: "failed", maxConnections: 55000, bandwidthGbps: 45,
      }],
    }),
    packets: [outbound("i-app", "8.8.8.8")],
  },

  // 8. ルートなし（NAT GWへのルートが未設定）
  {
    name: "8. ルートなし — デフォルトルート未設定",
    description: "プライベートサブネットにデフォルトルート（0.0.0.0/0 → NAT GW）が設定されていない場合、外部通信不可。",
    vpc: makeVpc({
      routeTables: [
        { id: "rt-pub", name: "PublicRT", routes: [
          { destination: "10.0.0.0/16", target: "local", targetType: "local" },
          { destination: "0.0.0.0/0", target: "igw-1", targetType: "igw" },
        ]},
        { id: "rt-priv", name: "PrivateRT", routes: [
          { destination: "10.0.0.0/16", target: "local", targetType: "local" },
        ]},
      ],
    }),
    packets: [outbound("i-app", "8.8.8.8")],
  },

  // 9. マルチAZ構成
  {
    name: "9. マルチAZ — AZ毎のNAT GW",
    description: "AZ毎にNAT GWを配置する推奨構成。各AZのプライベートサブネットは同じAZのNAT GWを使用し、AZ障害時の影響を最小化。",
    vpc: makeVpc({
      natGateways: [
        {
          id: "nat-1a", name: "NAT-GW-1a", subnetId: "sub-pub-1a",
          eip: { allocationId: "eipalloc-1a", publicIp: "54.250.10.1" },
          state: "available", maxConnections: 55000, bandwidthGbps: 45,
        },
        {
          id: "nat-1c", name: "NAT-GW-1c", subnetId: "sub-pub-1c",
          eip: { allocationId: "eipalloc-1c", publicIp: "54.250.10.2" },
          state: "available", maxConnections: 55000, bandwidthGbps: 45,
        },
      ],
      subnets: [
        { id: "sub-pub-1a", name: "Public-1a", cidr: "10.0.1.0/24", az: "ap-northeast-1a", isPublic: true, routeTableId: "rt-pub" },
        { id: "sub-pub-1c", name: "Public-1c", cidr: "10.0.3.0/24", az: "ap-northeast-1c", isPublic: true, routeTableId: "rt-pub" },
        { id: "sub-priv-1a", name: "Private-1a", cidr: "10.0.2.0/24", az: "ap-northeast-1a", isPublic: false, routeTableId: "rt-priv-1a" },
        { id: "sub-priv-1c", name: "Private-1c", cidr: "10.0.4.0/24", az: "ap-northeast-1c", isPublic: false, routeTableId: "rt-priv-1c" },
      ],
      routeTables: [
        { id: "rt-pub", name: "PublicRT", routes: [
          { destination: "10.0.0.0/16", target: "local", targetType: "local" },
          { destination: "0.0.0.0/0", target: "igw-1", targetType: "igw" },
        ]},
        { id: "rt-priv-1a", name: "PrivateRT-1a", routes: [
          { destination: "10.0.0.0/16", target: "local", targetType: "local" },
          { destination: "0.0.0.0/0", target: "nat-1a", targetType: "nat" },
        ]},
        { id: "rt-priv-1c", name: "PrivateRT-1c", routes: [
          { destination: "10.0.0.0/16", target: "local", targetType: "local" },
          { destination: "0.0.0.0/0", target: "nat-1c", targetType: "nat" },
        ]},
      ],
      instances: [
        { id: "i-web-1a", name: "Web-1a", privateIp: "10.0.1.10", subnetId: "sub-pub-1a", publicIp: "54.250.20.1" },
        { id: "i-web-1c", name: "Web-1c", privateIp: "10.0.3.10", subnetId: "sub-pub-1c", publicIp: "54.250.20.2" },
        { id: "i-app-1a", name: "App-1a", privateIp: "10.0.2.10", subnetId: "sub-priv-1a" },
        { id: "i-app-1c", name: "App-1c", privateIp: "10.0.4.10", subnetId: "sub-priv-1c" },
      ],
    }),
    packets: [
      outbound("i-app-1a", "8.8.8.8", "tcp", 50000, 443),
      outbound("i-app-1c", "1.1.1.1", "tcp", 50001, 443),
    ],
  },

  // 10. パブリックサブネットとの比較
  {
    name: "10. 比較 — パブリック(IGW) vs プライベート(NAT GW)",
    description: "パブリックサブネットのインスタンスはIGWで1:1 NAT、プライベートはNAT GWでSNAT。両方の経路を比較。",
    vpc: makeVpc(),
    packets: [
      outbound("i-web", "8.8.8.8", "tcp", 50000, 443),
      outbound("i-app", "8.8.8.8", "tcp", 50001, 443),
    ],
  },
];
