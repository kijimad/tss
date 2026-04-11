import type { Preset, Vpc } from "./types.js";

/** パブリックサブネット + IGW付きVPCのベース */
function baseVpc(overrides?: Partial<Vpc>): Vpc {
  return {
    id: "vpc-1", name: "MyVPC", cidr: "10.0.0.0/16",
    igw: { id: "igw-1", name: "MyIGW", attachedVpcId: "vpc-1", state: "attached" },
    natGateways: [],
    subnets: [
      { id: "sub-pub", name: "Public-1a", cidr: "10.0.1.0/24", az: "ap-northeast-1a",
        isPublic: true, mapPublicIpOnLaunch: true, routeTableId: "rt-pub" },
      { id: "sub-priv", name: "Private-1a", cidr: "10.0.2.0/24", az: "ap-northeast-1a",
        isPublic: false, mapPublicIpOnLaunch: false, routeTableId: "rt-priv" },
    ],
    routeTables: [
      { id: "rt-pub", name: "PublicRT", routes: [
        { destination: "10.0.0.0/16", target: "local", targetType: "local" },
        { destination: "0.0.0.0/0", target: "igw-1", targetType: "igw" },
      ]},
      { id: "rt-priv", name: "PrivateRT", routes: [
        { destination: "10.0.0.0/16", target: "local", targetType: "local" },
      ]},
    ],
    instances: [
      { id: "i-web", name: "WebServer", privateIp: "10.0.1.10", publicIp: "54.250.1.10",
        subnetId: "sub-pub", hasPublicIp: true, },
      { id: "i-db", name: "DBServer", privateIp: "10.0.2.20",
        subnetId: "sub-priv", hasPublicIp: false, },
    ],
    elasticIps: [{ allocationId: "eipalloc-1", publicIp: "54.250.1.10", associatedInstanceId: "i-web" }],
    ...overrides,
  };
}

export const presets: Preset[] = [
  // 1. IGW経由アウトバウンド（基本）
  {
    name: "IGW基本: アウトバウンド通信",
    description: "パブリックサブネットのインスタンスがIGW経由でインターネットへ。IGWが1:1 NATでプライベートIP→パブリックIPに変換",
    vpc: baseVpc(),
    packets: [
      { direction: "outbound", srcInstanceId: "i-web", dstIp: "8.8.8.8",
        protocol: "tcp", srcPort: 50000, dstPort: 443, payload: "HTTPS to Google DNS" },
    ],
  },

  // 2. IGW経由インバウンド
  {
    name: "IGW基本: インバウンド通信",
    description: "インターネットからパブリックIPでIGWに到達。IGWが逆NAT(パブリックIP→プライベートIP)してインスタンスへ配送",
    vpc: baseVpc(),
    packets: [
      { direction: "inbound", srcExternalIp: "203.0.113.50", dstIp: "54.250.1.10",
        protocol: "tcp", srcPort: 50000, dstPort: 80, payload: "HTTP Request from Internet" },
    ],
  },

  // 3. パブリックIPなしでIGW到達
  {
    name: "パブリックIPなしでのIGWアクセス",
    description: "プライベートサブネットのインスタンスにIGWルートがあってもパブリックIPがなければ通信不可",
    vpc: {
      ...baseVpc(),
      routeTables: [
        { id: "rt-pub", name: "PublicRT", routes: [
          { destination: "10.0.0.0/16", target: "local", targetType: "local" },
          { destination: "0.0.0.0/0", target: "igw-1", targetType: "igw" },
        ]},
        { id: "rt-priv", name: "PrivateRT-WithIGW", routes: [
          { destination: "10.0.0.0/16", target: "local", targetType: "local" },
          { destination: "0.0.0.0/0", target: "igw-1", targetType: "igw" },
        ]},
      ],
    },
    packets: [
      { direction: "outbound", srcInstanceId: "i-db", dstIp: "8.8.8.8",
        protocol: "tcp", srcPort: 50000, dstPort: 443, payload: "DB trying Internet (no public IP)" },
    ],
  },

  // 4. IGWデタッチ状態
  {
    name: "IGWデタッチ状態",
    description: "IGWがVPCからデタッチされた状態。ルートはあるがIGWが機能しない",
    vpc: {
      ...baseVpc(),
      igw: { id: "igw-1", name: "MyIGW-Detached", state: "detached" },
    },
    packets: [
      { direction: "outbound", srcInstanceId: "i-web", dstIp: "1.1.1.1",
        protocol: "tcp", srcPort: 50000, dstPort: 80, payload: "IGW detached" },
    ],
  },

  // 5. NAT Gateway経由（プライベート→インターネット）
  {
    name: "NAT Gateway経由アウトバウンド",
    description: "プライベートサブネットからNAT Gateway → IGW経由でインターネットへ。NATゲートウェイがSNATを行う",
    vpc: {
      ...baseVpc(),
      natGateways: [{ id: "nat-1", name: "NAT-GW-1a", subnetId: "sub-pub", publicIp: "54.250.2.1" }],
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
    },
    packets: [
      { direction: "outbound", srcInstanceId: "i-db", dstIp: "8.8.8.8",
        protocol: "tcp", srcPort: 50000, dstPort: 443, payload: "Private instance via NAT-GW" },
    ],
  },

  // 6. ルートなし（プライベートサブネット孤立）
  {
    name: "ルートなし（完全孤立）",
    description: "プライベートサブネットにデフォルトルートもNATもなく完全にインターネットから孤立",
    vpc: baseVpc(),
    packets: [
      { direction: "outbound", srcInstanceId: "i-db", dstIp: "8.8.8.8",
        protocol: "tcp", srcPort: 50000, dstPort: 443, payload: "No route to Internet" },
    ],
  },

  // 7. VPC内ローカル通信
  {
    name: "VPC内ローカル通信（IGW不使用）",
    description: "同一VPC内の通信はIGWを経由せずlocalルートで直接転送される",
    vpc: baseVpc(),
    packets: [
      { direction: "outbound", srcInstanceId: "i-web", dstIp: "10.0.2.20",
        protocol: "tcp", srcPort: 50000, dstPort: 3306, payload: "Web→DB (local route)" },
    ],
  },

  // 8. 双方向通信（リクエスト＋レスポンス）
  {
    name: "双方向通信シミュレーション",
    description: "外部クライアント→IGW→インスタンス（インバウンド）、そしてインスタンス→IGW→インターネット（レスポンス）",
    vpc: baseVpc(),
    packets: [
      { direction: "inbound", srcExternalIp: "203.0.113.100", dstIp: "54.250.1.10",
        protocol: "tcp", srcPort: 50000, dstPort: 80, payload: "HTTP Request" },
      { direction: "outbound", srcInstanceId: "i-web", dstIp: "203.0.113.100",
        protocol: "tcp", srcPort: 80, dstPort: 50000, payload: "HTTP Response" },
    ],
  },

  // 9. 複数インスタンスでのIGW共有
  {
    name: "複数インスタンスでのIGW共有",
    description: "複数のパブリックインスタンスが1つのIGWを共有。それぞれ異なるパブリックIPでNATされる",
    vpc: {
      ...baseVpc(),
      instances: [
        { id: "i-web1", name: "Web-1", privateIp: "10.0.1.10", publicIp: "54.250.1.10",
          subnetId: "sub-pub", hasPublicIp: true },
        { id: "i-web2", name: "Web-2", privateIp: "10.0.1.20", publicIp: "54.250.1.20",
          subnetId: "sub-pub", hasPublicIp: true },
        { id: "i-web3", name: "Web-3", privateIp: "10.0.1.30", publicIp: "54.250.1.30",
          subnetId: "sub-pub", hasPublicIp: true },
      ],
      elasticIps: [
        { allocationId: "eipalloc-1", publicIp: "54.250.1.10", associatedInstanceId: "i-web1" },
        { allocationId: "eipalloc-2", publicIp: "54.250.1.20", associatedInstanceId: "i-web2" },
        { allocationId: "eipalloc-3", publicIp: "54.250.1.30", associatedInstanceId: "i-web3" },
      ],
    },
    packets: [
      { direction: "outbound", srcInstanceId: "i-web1", dstIp: "8.8.8.8",
        protocol: "tcp", srcPort: 50000, dstPort: 443, payload: "Web-1 outbound" },
      { direction: "outbound", srcInstanceId: "i-web2", dstIp: "8.8.4.4",
        protocol: "tcp", srcPort: 50001, dstPort: 443, payload: "Web-2 outbound" },
      { direction: "inbound", srcExternalIp: "1.2.3.4", dstIp: "54.250.1.30",
        protocol: "tcp", srcPort: 50000, dstPort: 80, payload: "Inbound to Web-3" },
    ],
  },

  // 10. ブラックホールルート
  {
    name: "ブラックホールルート",
    description: "特定の宛先をブラックホールルートで明示的に破棄。IGWへのルートより優先される場合の挙動",
    vpc: {
      ...baseVpc(),
      routeTables: [
        { id: "rt-pub", name: "PublicRT-BH", routes: [
          { destination: "10.0.0.0/16", target: "local", targetType: "local" },
          { destination: "198.51.100.0/24", target: "blackhole", targetType: "blackhole" },
          { destination: "0.0.0.0/0", target: "igw-1", targetType: "igw" },
        ]},
        { id: "rt-priv", name: "PrivateRT", routes: [
          { destination: "10.0.0.0/16", target: "local", targetType: "local" },
        ]},
      ],
    },
    packets: [
      { direction: "outbound", srcInstanceId: "i-web", dstIp: "198.51.100.50",
        protocol: "tcp", srcPort: 50000, dstPort: 80, payload: "Blackholed destination" },
      { direction: "outbound", srcInstanceId: "i-web", dstIp: "8.8.8.8",
        protocol: "tcp", srcPort: 50000, dstPort: 443, payload: "Normal traffic via IGW" },
    ],
  },
];
