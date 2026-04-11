import type { Preset, SecurityGroup } from "./types.js";

// === 共通セキュリティグループ ===

const sgWeb: SecurityGroup = {
  id: "sg-web", name: "web-sg",
  inboundRules: [
    { protocol: "tcp", fromPort: 80, toPort: 80, source: "0.0.0.0/0", description: "HTTP許可" },
    { protocol: "tcp", fromPort: 443, toPort: 443, source: "0.0.0.0/0", description: "HTTPS許可" },
    { protocol: "tcp", fromPort: 22, toPort: 22, source: "10.0.0.0/16", description: "SSH(VPC内)" },
  ],
  outboundRules: [
    { protocol: "all", fromPort: 0, toPort: 65535, source: "0.0.0.0/0", description: "全送信許可" },
  ],
};

const sgDb: SecurityGroup = {
  id: "sg-db", name: "db-sg",
  inboundRules: [
    { protocol: "tcp", fromPort: 3306, toPort: 3306, source: "10.0.1.0/24", description: "MySQL(Webサブネットから)" },
    { protocol: "tcp", fromPort: 22, toPort: 22, source: "10.0.0.0/16", description: "SSH(VPC内)" },
  ],
  outboundRules: [
    { protocol: "all", fromPort: 0, toPort: 65535, source: "0.0.0.0/0", description: "全送信許可" },
  ],
};

const sgStrict: SecurityGroup = {
  id: "sg-strict", name: "strict-sg",
  inboundRules: [
    { protocol: "tcp", fromPort: 22, toPort: 22, source: "10.0.1.0/24", description: "SSH(特定サブネット)" },
  ],
  outboundRules: [
    { protocol: "all", fromPort: 0, toPort: 65535, source: "0.0.0.0/0", description: "全送信許可" },
  ],
};

// === プリセット ===

export const presets: Preset[] = [
  // 1. 基本VPC：パブリック＋プライベートサブネット
  {
    name: "基本VPC構成",
    description: "パブリックサブネット（Web）とプライベートサブネット（DB）の2層構成",
    vpcs: [{
      id: "vpc-1", name: "MyVPC", cidr: "10.0.0.0/16",
      igw: { id: "igw-1", name: "MyIGW" },
      natGateways: [],
      networkAcls: [{
        id: "acl-1", name: "DefaultACL", subnetIds: ["sub-pub", "sub-priv"],
        inboundRules: [{ ruleNumber: 100, protocol: "all", fromPort: 0, toPort: 65535, cidr: "0.0.0.0/0", action: "allow" }],
        outboundRules: [{ ruleNumber: 100, protocol: "all", fromPort: 0, toPort: 65535, cidr: "0.0.0.0/0", action: "allow" }],
      }],
      peeringConnections: [],
      subnets: [
        {
          id: "sub-pub", name: "Public-1a", cidr: "10.0.1.0/24", az: "ap-northeast-1a",
          isPublic: true, routeTableId: "rt-pub",
          instances: [{ id: "i-web", name: "WebServer", privateIp: "10.0.1.10", publicIp: "54.250.1.1", securityGroups: [sgWeb] }],
        },
        {
          id: "sub-priv", name: "Private-1a", cidr: "10.0.2.0/24", az: "ap-northeast-1a",
          isPublic: false, routeTableId: "rt-priv",
          instances: [{ id: "i-db", name: "DBServer", privateIp: "10.0.2.10", securityGroups: [sgDb] }],
        },
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
    }],
    packets: [
      { srcInstanceId: "i-web", dstIp: "10.0.2.10", protocol: "tcp", srcPort: 45000, dstPort: 3306, payload: "SQL Query" },
    ],
  },

  // 2. SG拒否
  {
    name: "セキュリティグループによる拒否",
    description: "SGルールに合致しないポートへのアクセスが拒否される様子を確認",
    vpcs: [{
      id: "vpc-1", name: "MyVPC", cidr: "10.0.0.0/16",
      igw: { id: "igw-1", name: "MyIGW" },
      natGateways: [], networkAcls: [{
        id: "acl-1", name: "DefaultACL", subnetIds: ["sub-1", "sub-2"],
        inboundRules: [{ ruleNumber: 100, protocol: "all", fromPort: 0, toPort: 65535, cidr: "0.0.0.0/0", action: "allow" }],
        outboundRules: [{ ruleNumber: 100, protocol: "all", fromPort: 0, toPort: 65535, cidr: "0.0.0.0/0", action: "allow" }],
      }],
      peeringConnections: [],
      subnets: [
        { id: "sub-1", name: "Subnet-A", cidr: "10.0.1.0/24", az: "ap-northeast-1a", isPublic: true, routeTableId: "rt-1",
          instances: [{ id: "i-1", name: "ClientServer", privateIp: "10.0.1.10", securityGroups: [sgWeb] }] },
        { id: "sub-2", name: "Subnet-B", cidr: "10.0.2.0/24", az: "ap-northeast-1a", isPublic: false, routeTableId: "rt-1",
          instances: [{ id: "i-2", name: "ProtectedServer", privateIp: "10.0.2.10", securityGroups: [sgStrict] }] },
      ],
      routeTables: [
        { id: "rt-1", name: "MainRT", routes: [{ destination: "10.0.0.0/16", target: "local", targetType: "local" }] },
      ],
    }],
    packets: [
      { srcInstanceId: "i-1", dstIp: "10.0.2.10", protocol: "tcp", srcPort: 50000, dstPort: 80, payload: "HTTP Request (should be denied)" },
    ],
  },

  // 3. NACL拒否
  {
    name: "ネットワークACLによる拒否",
    description: "NACLルールで特定トラフィックをブロック。SGより先にNACLで評価される",
    vpcs: [{
      id: "vpc-1", name: "MyVPC", cidr: "10.0.0.0/16",
      igw: { id: "igw-1", name: "MyIGW" },
      natGateways: [], networkAcls: [
        {
          id: "acl-src", name: "SourceACL", subnetIds: ["sub-1"],
          inboundRules: [{ ruleNumber: 100, protocol: "all", fromPort: 0, toPort: 65535, cidr: "0.0.0.0/0", action: "allow" }],
          outboundRules: [{ ruleNumber: 100, protocol: "all", fromPort: 0, toPort: 65535, cidr: "0.0.0.0/0", action: "allow" }],
        },
        {
          id: "acl-dst", name: "DestACL", subnetIds: ["sub-2"],
          inboundRules: [
            { ruleNumber: 50, protocol: "tcp", fromPort: 22, toPort: 22, cidr: "10.0.1.0/24", action: "deny" },
            { ruleNumber: 100, protocol: "all", fromPort: 0, toPort: 65535, cidr: "0.0.0.0/0", action: "allow" },
          ],
          outboundRules: [{ ruleNumber: 100, protocol: "all", fromPort: 0, toPort: 65535, cidr: "0.0.0.0/0", action: "allow" }],
        },
      ],
      peeringConnections: [],
      subnets: [
        { id: "sub-1", name: "Subnet-A", cidr: "10.0.1.0/24", az: "1a", isPublic: true, routeTableId: "rt-1",
          instances: [{ id: "i-1", name: "Attacker", privateIp: "10.0.1.50", securityGroups: [sgWeb] }] },
        { id: "sub-2", name: "Subnet-B", cidr: "10.0.2.0/24", az: "1a", isPublic: false, routeTableId: "rt-1",
          instances: [{ id: "i-2", name: "Target", privateIp: "10.0.2.10", securityGroups: [sgWeb] }] },
      ],
      routeTables: [
        { id: "rt-1", name: "MainRT", routes: [{ destination: "10.0.0.0/16", target: "local", targetType: "local" }] },
      ],
    }],
    packets: [
      { srcInstanceId: "i-1", dstIp: "10.0.2.10", protocol: "tcp", srcPort: 50000, dstPort: 22, payload: "SSH attempt (blocked by NACL)" },
    ],
  },

  // 4. NATゲートウェイ
  {
    name: "NATゲートウェイ経由",
    description: "プライベートサブネットからNATゲートウェイ経由でインターネットに接続",
    vpcs: [{
      id: "vpc-1", name: "MyVPC", cidr: "10.0.0.0/16",
      igw: { id: "igw-1", name: "MyIGW" },
      natGateways: [{ id: "nat-1", name: "NAT-GW", subnetId: "sub-pub", publicIp: "54.250.2.1" }],
      networkAcls: [{
        id: "acl-1", name: "DefaultACL", subnetIds: ["sub-pub", "sub-priv"],
        inboundRules: [{ ruleNumber: 100, protocol: "all", fromPort: 0, toPort: 65535, cidr: "0.0.0.0/0", action: "allow" }],
        outboundRules: [{ ruleNumber: 100, protocol: "all", fromPort: 0, toPort: 65535, cidr: "0.0.0.0/0", action: "allow" }],
      }],
      peeringConnections: [],
      subnets: [
        { id: "sub-pub", name: "Public-1a", cidr: "10.0.1.0/24", az: "1a", isPublic: true, routeTableId: "rt-pub",
          instances: [{ id: "i-web", name: "WebServer", privateIp: "10.0.1.10", publicIp: "54.250.1.1", securityGroups: [sgWeb] }] },
        { id: "sub-priv", name: "Private-1a", cidr: "10.0.2.0/24", az: "1a", isPublic: false, routeTableId: "rt-priv",
          instances: [{ id: "i-app", name: "AppServer", privateIp: "10.0.2.10", securityGroups: [sgWeb] }] },
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
    }],
    packets: [
      { srcInstanceId: "i-app", dstIp: "8.8.8.8", protocol: "tcp", srcPort: 50000, dstPort: 443, payload: "HTTPS to Internet via NAT" },
    ],
  },

  // 5. IGW経由インターネット
  {
    name: "IGW経由インターネット接続",
    description: "パブリックサブネットのインスタンスからIGW経由でインターネットへ",
    vpcs: [{
      id: "vpc-1", name: "MyVPC", cidr: "10.0.0.0/16",
      igw: { id: "igw-1", name: "MyIGW" },
      natGateways: [], networkAcls: [{
        id: "acl-1", name: "DefaultACL", subnetIds: ["sub-pub"],
        inboundRules: [{ ruleNumber: 100, protocol: "all", fromPort: 0, toPort: 65535, cidr: "0.0.0.0/0", action: "allow" }],
        outboundRules: [{ ruleNumber: 100, protocol: "all", fromPort: 0, toPort: 65535, cidr: "0.0.0.0/0", action: "allow" }],
      }],
      peeringConnections: [],
      subnets: [
        { id: "sub-pub", name: "Public-1a", cidr: "10.0.1.0/24", az: "1a", isPublic: true, routeTableId: "rt-pub",
          instances: [{ id: "i-web", name: "WebServer", privateIp: "10.0.1.10", publicIp: "54.250.1.1", securityGroups: [sgWeb] }] },
      ],
      routeTables: [
        { id: "rt-pub", name: "PublicRT", routes: [
          { destination: "10.0.0.0/16", target: "local", targetType: "local" },
          { destination: "0.0.0.0/0", target: "igw-1", targetType: "igw" },
        ]},
      ],
    }],
    packets: [
      { srcInstanceId: "i-web", dstIp: "1.1.1.1", protocol: "tcp", srcPort: 50000, dstPort: 80, payload: "HTTP to Internet" },
    ],
  },

  // 6. ルートなし
  {
    name: "ルートなし（パケット破棄）",
    description: "プライベートサブネットにインターネット向けルートがない場合のパケット破棄",
    vpcs: [{
      id: "vpc-1", name: "MyVPC", cidr: "10.0.0.0/16",
      natGateways: [], networkAcls: [{
        id: "acl-1", name: "DefaultACL", subnetIds: ["sub-priv"],
        inboundRules: [{ ruleNumber: 100, protocol: "all", fromPort: 0, toPort: 65535, cidr: "0.0.0.0/0", action: "allow" }],
        outboundRules: [{ ruleNumber: 100, protocol: "all", fromPort: 0, toPort: 65535, cidr: "0.0.0.0/0", action: "allow" }],
      }],
      peeringConnections: [],
      subnets: [
        { id: "sub-priv", name: "Private-1a", cidr: "10.0.2.0/24", az: "1a", isPublic: false, routeTableId: "rt-priv",
          instances: [{ id: "i-1", name: "IsolatedServer", privateIp: "10.0.2.10", securityGroups: [sgWeb] }] },
      ],
      routeTables: [
        { id: "rt-priv", name: "PrivateRT", routes: [
          { destination: "10.0.0.0/16", target: "local", targetType: "local" },
        ]},
      ],
    }],
    packets: [
      { srcInstanceId: "i-1", dstIp: "8.8.8.8", protocol: "tcp", srcPort: 50000, dstPort: 443, payload: "No route to Internet" },
    ],
  },

  // 7. VPCピアリング
  {
    name: "VPCピアリング",
    description: "2つのVPCをピアリング接続し、プライベートIP同士で通信",
    vpcs: [
      {
        id: "vpc-a", name: "VPC-A (Production)", cidr: "10.0.0.0/16",
        natGateways: [], networkAcls: [{
          id: "acl-a", name: "ACL-A", subnetIds: ["sub-a"],
          inboundRules: [{ ruleNumber: 100, protocol: "all", fromPort: 0, toPort: 65535, cidr: "0.0.0.0/0", action: "allow" }],
          outboundRules: [{ ruleNumber: 100, protocol: "all", fromPort: 0, toPort: 65535, cidr: "0.0.0.0/0", action: "allow" }],
        }],
        peeringConnections: [{ id: "pcx-1", name: "A-to-B Peering", peerVpcId: "vpc-b", localCidr: "10.0.0.0/16", peerCidr: "172.16.0.0/16" }],
        subnets: [
          { id: "sub-a", name: "ProdSubnet", cidr: "10.0.1.0/24", az: "1a", isPublic: false, routeTableId: "rt-a",
            instances: [{ id: "i-prod", name: "ProdApp", privateIp: "10.0.1.10", securityGroups: [{
              id: "sg-prod", name: "prod-sg",
              inboundRules: [{ protocol: "all", fromPort: 0, toPort: 65535, source: "172.16.0.0/16", description: "VPC-Bから許可" }],
              outboundRules: [{ protocol: "all", fromPort: 0, toPort: 65535, source: "0.0.0.0/0", description: "全送信許可" }],
            }] }] },
        ],
        routeTables: [
          { id: "rt-a", name: "ProdRT", routes: [
            { destination: "10.0.0.0/16", target: "local", targetType: "local" },
            { destination: "172.16.0.0/16", target: "pcx-1", targetType: "peering" },
          ]},
        ],
      },
      {
        id: "vpc-b", name: "VPC-B (Staging)", cidr: "172.16.0.0/16",
        natGateways: [], networkAcls: [{
          id: "acl-b", name: "ACL-B", subnetIds: ["sub-b"],
          inboundRules: [{ ruleNumber: 100, protocol: "all", fromPort: 0, toPort: 65535, cidr: "0.0.0.0/0", action: "allow" }],
          outboundRules: [{ ruleNumber: 100, protocol: "all", fromPort: 0, toPort: 65535, cidr: "0.0.0.0/0", action: "allow" }],
        }],
        peeringConnections: [{ id: "pcx-1", name: "B-to-A Peering", peerVpcId: "vpc-a", localCidr: "172.16.0.0/16", peerCidr: "10.0.0.0/16" }],
        subnets: [
          { id: "sub-b", name: "StagingSubnet", cidr: "172.16.1.0/24", az: "1a", isPublic: false, routeTableId: "rt-b",
            instances: [{ id: "i-stg", name: "StagingApp", privateIp: "172.16.1.10", securityGroups: [{
              id: "sg-stg", name: "stg-sg",
              inboundRules: [{ protocol: "all", fromPort: 0, toPort: 65535, source: "10.0.0.0/16", description: "VPC-Aから許可" }],
              outboundRules: [{ protocol: "all", fromPort: 0, toPort: 65535, source: "0.0.0.0/0", description: "全送信許可" }],
            }] }] },
        ],
        routeTables: [
          { id: "rt-b", name: "StagingRT", routes: [
            { destination: "172.16.0.0/16", target: "local", targetType: "local" },
            { destination: "10.0.0.0/16", target: "pcx-1", targetType: "peering" },
          ]},
        ],
      },
    ],
    packets: [
      { srcInstanceId: "i-prod", dstIp: "172.16.1.10", protocol: "tcp", srcPort: 50000, dstPort: 8080, payload: "Cross-VPC via Peering" },
    ],
  },

  // 8. マルチAZ構成
  {
    name: "マルチAZ構成",
    description: "2つのAZにまたがるサブネット構成。同一VPC内のAZ間通信",
    vpcs: [{
      id: "vpc-1", name: "MultiAZ-VPC", cidr: "10.0.0.0/16",
      igw: { id: "igw-1", name: "MyIGW" },
      natGateways: [], networkAcls: [{
        id: "acl-1", name: "DefaultACL", subnetIds: ["sub-1a", "sub-1c"],
        inboundRules: [{ ruleNumber: 100, protocol: "all", fromPort: 0, toPort: 65535, cidr: "0.0.0.0/0", action: "allow" }],
        outboundRules: [{ ruleNumber: 100, protocol: "all", fromPort: 0, toPort: 65535, cidr: "0.0.0.0/0", action: "allow" }],
      }],
      peeringConnections: [],
      subnets: [
        { id: "sub-1a", name: "Public-1a", cidr: "10.0.1.0/24", az: "ap-northeast-1a", isPublic: true, routeTableId: "rt-1",
          instances: [{ id: "i-1a", name: "Web-1a", privateIp: "10.0.1.10", securityGroups: [sgWeb] }] },
        { id: "sub-1c", name: "Public-1c", cidr: "10.0.3.0/24", az: "ap-northeast-1c", isPublic: true, routeTableId: "rt-1",
          instances: [{ id: "i-1c", name: "Web-1c", privateIp: "10.0.3.10", securityGroups: [sgWeb] }] },
      ],
      routeTables: [
        { id: "rt-1", name: "PublicRT", routes: [
          { destination: "10.0.0.0/16", target: "local", targetType: "local" },
          { destination: "0.0.0.0/0", target: "igw-1", targetType: "igw" },
        ]},
      ],
    }],
    packets: [
      { srcInstanceId: "i-1a", dstIp: "10.0.3.10", protocol: "tcp", srcPort: 50000, dstPort: 80, payload: "Cross-AZ health check" },
    ],
  },

  // 9. NACL順序評価
  {
    name: "NACL順序評価（ルール番号）",
    description: "NACLはルール番号の小さい順に評価。先にマッチしたルールが適用される",
    vpcs: [{
      id: "vpc-1", name: "MyVPC", cidr: "10.0.0.0/16",
      natGateways: [], networkAcls: [
        {
          id: "acl-src", name: "SrcACL", subnetIds: ["sub-1"],
          inboundRules: [{ ruleNumber: 100, protocol: "all", fromPort: 0, toPort: 65535, cidr: "0.0.0.0/0", action: "allow" }],
          outboundRules: [{ ruleNumber: 100, protocol: "all", fromPort: 0, toPort: 65535, cidr: "0.0.0.0/0", action: "allow" }],
        },
        {
          id: "acl-dst", name: "DstACL-Ordered", subnetIds: ["sub-2"],
          inboundRules: [
            { ruleNumber: 10, protocol: "tcp", fromPort: 80, toPort: 80, cidr: "10.0.1.0/24", action: "allow" },
            { ruleNumber: 20, protocol: "tcp", fromPort: 0, toPort: 65535, cidr: "10.0.1.0/24", action: "deny" },
            { ruleNumber: 100, protocol: "all", fromPort: 0, toPort: 65535, cidr: "0.0.0.0/0", action: "allow" },
          ],
          outboundRules: [{ ruleNumber: 100, protocol: "all", fromPort: 0, toPort: 65535, cidr: "0.0.0.0/0", action: "allow" }],
        },
      ],
      peeringConnections: [],
      subnets: [
        { id: "sub-1", name: "Client-Subnet", cidr: "10.0.1.0/24", az: "1a", isPublic: true, routeTableId: "rt-1",
          instances: [{ id: "i-1", name: "Client", privateIp: "10.0.1.10", securityGroups: [sgWeb] }] },
        { id: "sub-2", name: "Server-Subnet", cidr: "10.0.2.0/24", az: "1a", isPublic: false, routeTableId: "rt-1",
          instances: [{ id: "i-2", name: "Server", privateIp: "10.0.2.10", securityGroups: [sgWeb] }] },
      ],
      routeTables: [
        { id: "rt-1", name: "MainRT", routes: [{ destination: "10.0.0.0/16", target: "local", targetType: "local" }] },
      ],
    }],
    packets: [
      { srcInstanceId: "i-1", dstIp: "10.0.2.10", protocol: "tcp", srcPort: 50000, dstPort: 80, payload: "HTTP (allowed by rule 10)" },
      { srcInstanceId: "i-1", dstIp: "10.0.2.10", protocol: "tcp", srcPort: 50000, dstPort: 22, payload: "SSH (denied by rule 20)" },
    ],
  },

  // 10. 総合：3層アーキテクチャ
  {
    name: "総合: 3層VPCアーキテクチャ",
    description: "Web(Public) → App(Private) → DB(Private)の3層。NAT経由インターネット、SG/NACLで制御",
    vpcs: [{
      id: "vpc-1", name: "Production-VPC", cidr: "10.0.0.0/16",
      igw: { id: "igw-1", name: "ProdIGW" },
      natGateways: [{ id: "nat-1", name: "NAT-GW", subnetId: "sub-web", publicIp: "54.250.10.1" }],
      networkAcls: [
        { id: "acl-web", name: "WebACL", subnetIds: ["sub-web"],
          inboundRules: [
            { ruleNumber: 100, protocol: "tcp", fromPort: 80, toPort: 80, cidr: "0.0.0.0/0", action: "allow" },
            { ruleNumber: 110, protocol: "tcp", fromPort: 443, toPort: 443, cidr: "0.0.0.0/0", action: "allow" },
            { ruleNumber: 200, protocol: "tcp", fromPort: 1024, toPort: 65535, cidr: "0.0.0.0/0", action: "allow" },
          ],
          outboundRules: [{ ruleNumber: 100, protocol: "all", fromPort: 0, toPort: 65535, cidr: "0.0.0.0/0", action: "allow" }],
        },
        { id: "acl-app", name: "AppACL", subnetIds: ["sub-app"],
          inboundRules: [
            { ruleNumber: 100, protocol: "tcp", fromPort: 8080, toPort: 8080, cidr: "10.0.1.0/24", action: "allow" },
            { ruleNumber: 200, protocol: "tcp", fromPort: 1024, toPort: 65535, cidr: "0.0.0.0/0", action: "allow" },
          ],
          outboundRules: [{ ruleNumber: 100, protocol: "all", fromPort: 0, toPort: 65535, cidr: "0.0.0.0/0", action: "allow" }],
        },
        { id: "acl-db", name: "DBACL", subnetIds: ["sub-db"],
          inboundRules: [
            { ruleNumber: 100, protocol: "tcp", fromPort: 5432, toPort: 5432, cidr: "10.0.2.0/24", action: "allow" },
          ],
          outboundRules: [{ ruleNumber: 100, protocol: "all", fromPort: 0, toPort: 65535, cidr: "0.0.0.0/0", action: "allow" }],
        },
      ],
      peeringConnections: [],
      subnets: [
        { id: "sub-web", name: "Web-Subnet", cidr: "10.0.1.0/24", az: "1a", isPublic: true, routeTableId: "rt-web",
          instances: [{ id: "i-web", name: "WebServer", privateIp: "10.0.1.10", publicIp: "54.250.1.1",
            securityGroups: [{ id: "sg-w", name: "web-sg",
              inboundRules: [
                { protocol: "tcp", fromPort: 80, toPort: 80, source: "0.0.0.0/0", description: "HTTP" },
                { protocol: "tcp", fromPort: 443, toPort: 443, source: "0.0.0.0/0", description: "HTTPS" },
              ],
              outboundRules: [{ protocol: "all", fromPort: 0, toPort: 65535, source: "0.0.0.0/0", description: "All" }],
            }] }] },
        { id: "sub-app", name: "App-Subnet", cidr: "10.0.2.0/24", az: "1a", isPublic: false, routeTableId: "rt-app",
          instances: [{ id: "i-app", name: "AppServer", privateIp: "10.0.2.10",
            securityGroups: [{ id: "sg-a", name: "app-sg",
              inboundRules: [{ protocol: "tcp", fromPort: 8080, toPort: 8080, source: "10.0.1.0/24", description: "Webサブネットから" }],
              outboundRules: [{ protocol: "all", fromPort: 0, toPort: 65535, source: "0.0.0.0/0", description: "All" }],
            }] }] },
        { id: "sub-db", name: "DB-Subnet", cidr: "10.0.3.0/24", az: "1a", isPublic: false, routeTableId: "rt-db",
          instances: [{ id: "i-db", name: "DBServer", privateIp: "10.0.3.10",
            securityGroups: [{ id: "sg-d", name: "db-sg",
              inboundRules: [{ protocol: "tcp", fromPort: 5432, toPort: 5432, source: "10.0.2.0/24", description: "Appサブネットから" }],
              outboundRules: [{ protocol: "all", fromPort: 0, toPort: 65535, source: "0.0.0.0/0", description: "All" }],
            }] }] },
      ],
      routeTables: [
        { id: "rt-web", name: "WebRT", routes: [
          { destination: "10.0.0.0/16", target: "local", targetType: "local" },
          { destination: "0.0.0.0/0", target: "igw-1", targetType: "igw" },
        ]},
        { id: "rt-app", name: "AppRT", routes: [
          { destination: "10.0.0.0/16", target: "local", targetType: "local" },
          { destination: "0.0.0.0/0", target: "nat-1", targetType: "nat" },
        ]},
        { id: "rt-db", name: "DBRT", routes: [
          { destination: "10.0.0.0/16", target: "local", targetType: "local" },
        ]},
      ],
    }],
    packets: [
      { srcInstanceId: "i-web", dstIp: "10.0.2.10", protocol: "tcp", srcPort: 50000, dstPort: 8080, payload: "Web → App" },
      { srcInstanceId: "i-app", dstIp: "10.0.3.10", protocol: "tcp", srcPort: 50000, dstPort: 5432, payload: "App → DB" },
      { srcInstanceId: "i-app", dstIp: "8.8.8.8", protocol: "tcp", srcPort: 50000, dstPort: 443, payload: "App → Internet via NAT" },
    ],
  },
];
