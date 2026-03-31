import { AwsVpc } from "../net/vpc.js";
import type { Subnet, Packet, PacketTrace, TraceHop } from "../net/vpc.js";

export interface Example {
  name: string;
  description: string;
  build: (vpc: AwsVpc) => void;
  packets: Packet[];
}

// ── ヘルパー ──

function pubSubnet(id: string, vpcId: string, cidr: string, az: string, name: string): Subnet {
  return { id, vpcId, cidr, az, name, routeTableId: `${id}-rt`, naclId: `${id}-nacl`, public: true };
}
function privSubnet(id: string, vpcId: string, cidr: string, az: string, name: string): Subnet {
  return { id, vpcId, cidr, az, name, routeTableId: `${id}-rt`, naclId: `${id}-nacl`, public: false };
}

export const EXAMPLES: Example[] = [
  {
    name: "基本 VPC (パブリック + プライベート)",
    description: "パブリックサブネットの Web サーバーはインターネットアクセス可能。プライベートサブネットの DB は NAT GW 経由。",
    build: (v) => {
      v.vpcs = [{ id: "vpc-1", cidr: "10.0.0.0/16", name: "production-vpc" }];
      v.subnets = [
        pubSubnet("sub-pub-1a", "vpc-1", "10.0.1.0/24", "ap-northeast-1a", "public-1a"),
        privSubnet("sub-priv-1a", "vpc-1", "10.0.10.0/24", "ap-northeast-1a", "private-1a"),
      ];
      v.igws = [{ id: "igw-1", vpcId: "vpc-1" }];
      v.natGws = [{ id: "nat-1", subnetId: "sub-pub-1a", publicIp: "54.150.1.100" }];
      v.routeTables = [
        { id: "sub-pub-1a-rt", vpcId: "vpc-1", name: "public-rt", routes: [
          { destination: "10.0.0.0/16", target: "local", targetType: "local" },
          { destination: "0.0.0.0/0", target: "igw-1", targetType: "igw" },
        ]},
        { id: "sub-priv-1a-rt", vpcId: "vpc-1", name: "private-rt", routes: [
          { destination: "10.0.0.0/16", target: "local", targetType: "local" },
          { destination: "0.0.0.0/0", target: "nat-1", targetType: "nat" },
        ]},
      ];
      v.nacls = [
        { id: "sub-pub-1a-nacl", vpcId: "vpc-1", name: "public-nacl", inbound: [
          { ruleNumber: 100, protocol: "tcp", portFrom: 80, portTo: 80, cidr: "0.0.0.0/0", action: "allow" },
          { ruleNumber: 110, protocol: "tcp", portFrom: 443, portTo: 443, cidr: "0.0.0.0/0", action: "allow" },
          { ruleNumber: 120, protocol: "tcp", portFrom: 1024, portTo: 65535, cidr: "0.0.0.0/0", action: "allow" },
        ], outbound: [
          { ruleNumber: 100, protocol: "all", portFrom: 0, portTo: 65535, cidr: "0.0.0.0/0", action: "allow" },
        ]},
        { id: "sub-priv-1a-nacl", vpcId: "vpc-1", name: "private-nacl", inbound: [
          { ruleNumber: 100, protocol: "tcp", portFrom: 5432, portTo: 5432, cidr: "10.0.1.0/24", action: "allow" },
          { ruleNumber: 110, protocol: "tcp", portFrom: 1024, portTo: 65535, cidr: "0.0.0.0/0", action: "allow" },
        ], outbound: [
          { ruleNumber: 100, protocol: "all", portFrom: 0, portTo: 65535, cidr: "0.0.0.0/0", action: "allow" },
        ]},
      ];
      v.securityGroups = [
        { id: "sg-web", vpcId: "vpc-1", name: "web-sg", inbound: [
          { protocol: "tcp", portFrom: 80, portTo: 80, source: "0.0.0.0/0" },
          { protocol: "tcp", portFrom: 443, portTo: 443, source: "0.0.0.0/0" },
        ], outbound: [
          { protocol: "all", portFrom: 0, portTo: 65535, source: "0.0.0.0/0" },
        ]},
        { id: "sg-db", vpcId: "vpc-1", name: "db-sg", inbound: [
          { protocol: "tcp", portFrom: 5432, portTo: 5432, source: "10.0.1.0/24" },
        ], outbound: [
          { protocol: "all", portFrom: 0, portTo: 65535, source: "0.0.0.0/0" },
        ]},
      ];
      v.enis = [
        { id: "eni-web", subnetId: "sub-pub-1a", privateIp: "10.0.1.10", publicIp: "54.150.2.10", sgIds: ["sg-web"], instanceName: "web-server" },
        { id: "eni-db", subnetId: "sub-priv-1a", privateIp: "10.0.10.20", publicIp: null, sgIds: ["sg-db"], instanceName: "db-server" },
      ];
    },
    packets: [
      { srcIp: "203.0.113.50", dstIp: "54.150.2.10", srcPort: 50000, dstPort: 80, protocol: "tcp", label: "外部 → Web (HTTP)" },
      { srcIp: "203.0.113.50", dstIp: "54.150.2.10", srcPort: 50001, dstPort: 22, protocol: "tcp", label: "外部 → Web (SSH 拒否)" },
      { srcIp: "10.0.1.10", dstIp: "10.0.10.20", srcPort: 50002, dstPort: 5432, protocol: "tcp", label: "Web → DB (PostgreSQL)" },
      { srcIp: "10.0.10.20", dstIp: "8.8.8.8", srcPort: 50003, dstPort: 443, protocol: "tcp", label: "DB → Internet (NAT 経由)" },
      { srcIp: "203.0.113.50", dstIp: "10.0.10.20", srcPort: 50004, dstPort: 5432, protocol: "tcp", label: "外部 → DB 直接 (不可)" },
    ],
  },
  {
    name: "マルチ AZ 冗長構成",
    description: "2 AZ にパブリック/プライベートサブネットを配置。Web が両 AZ に分散。",
    build: (v) => {
      v.vpcs = [{ id: "vpc-1", cidr: "10.0.0.0/16", name: "multi-az-vpc" }];
      v.subnets = [
        pubSubnet("sub-pub-1a", "vpc-1", "10.0.1.0/24", "ap-northeast-1a", "public-1a"),
        pubSubnet("sub-pub-1c", "vpc-1", "10.0.2.0/24", "ap-northeast-1c", "public-1c"),
        privSubnet("sub-priv-1a", "vpc-1", "10.0.10.0/24", "ap-northeast-1a", "private-1a"),
        privSubnet("sub-priv-1c", "vpc-1", "10.0.11.0/24", "ap-northeast-1c", "private-1c"),
      ];
      v.igws = [{ id: "igw-1", vpcId: "vpc-1" }];
      v.natGws = [
        { id: "nat-1a", subnetId: "sub-pub-1a", publicIp: "54.150.1.100" },
        { id: "nat-1c", subnetId: "sub-pub-1c", publicIp: "54.150.1.101" },
      ];
      const pubRt = { id: "pub-rt", vpcId: "vpc-1", name: "public-rt", routes: [
        { destination: "10.0.0.0/16", target: "local", targetType: "local" as const },
        { destination: "0.0.0.0/0", target: "igw-1", targetType: "igw" as const },
      ]};
      v.routeTables = [
        { ...pubRt, id: "sub-pub-1a-rt" },
        { ...pubRt, id: "sub-pub-1c-rt" },
        { id: "sub-priv-1a-rt", vpcId: "vpc-1", name: "private-1a-rt", routes: [
          { destination: "10.0.0.0/16", target: "local", targetType: "local" },
          { destination: "0.0.0.0/0", target: "nat-1a", targetType: "nat" },
        ]},
        { id: "sub-priv-1c-rt", vpcId: "vpc-1", name: "private-1c-rt", routes: [
          { destination: "10.0.0.0/16", target: "local", targetType: "local" },
          { destination: "0.0.0.0/0", target: "nat-1c", targetType: "nat" },
        ]},
      ];
      const defaultNacl = { vpcId: "vpc-1", inbound: [
        { ruleNumber: 100, protocol: "all" as const, portFrom: 0, portTo: 65535, cidr: "0.0.0.0/0", action: "allow" as const },
      ], outbound: [
        { ruleNumber: 100, protocol: "all" as const, portFrom: 0, portTo: 65535, cidr: "0.0.0.0/0", action: "allow" as const },
      ]};
      v.nacls = [
        { ...defaultNacl, id: "sub-pub-1a-nacl", name: "pub-1a-nacl" },
        { ...defaultNacl, id: "sub-pub-1c-nacl", name: "pub-1c-nacl" },
        { ...defaultNacl, id: "sub-priv-1a-nacl", name: "priv-1a-nacl" },
        { ...defaultNacl, id: "sub-priv-1c-nacl", name: "priv-1c-nacl" },
      ];
      v.securityGroups = [
        { id: "sg-web", vpcId: "vpc-1", name: "web-sg", inbound: [
          { protocol: "tcp", portFrom: 80, portTo: 80, source: "0.0.0.0/0" },
        ], outbound: [
          { protocol: "all", portFrom: 0, portTo: 65535, source: "0.0.0.0/0" },
        ]},
        { id: "sg-app", vpcId: "vpc-1", name: "app-sg", inbound: [
          { protocol: "tcp", portFrom: 8080, portTo: 8080, source: "10.0.0.0/16" },
        ], outbound: [
          { protocol: "all", portFrom: 0, portTo: 65535, source: "0.0.0.0/0" },
        ]},
      ];
      v.enis = [
        { id: "eni-web-1a", subnetId: "sub-pub-1a", privateIp: "10.0.1.10", publicIp: "54.150.2.10", sgIds: ["sg-web"], instanceName: "web-1a" },
        { id: "eni-web-1c", subnetId: "sub-pub-1c", privateIp: "10.0.2.10", publicIp: "54.150.2.11", sgIds: ["sg-web"], instanceName: "web-1c" },
        { id: "eni-app-1a", subnetId: "sub-priv-1a", privateIp: "10.0.10.10", publicIp: null, sgIds: ["sg-app"], instanceName: "app-1a" },
        { id: "eni-app-1c", subnetId: "sub-priv-1c", privateIp: "10.0.11.10", publicIp: null, sgIds: ["sg-app"], instanceName: "app-1c" },
      ];
    },
    packets: [
      { srcIp: "203.0.113.1", dstIp: "54.150.2.10", srcPort: 50000, dstPort: 80, protocol: "tcp", label: "外部 → web-1a" },
      { srcIp: "203.0.113.1", dstIp: "54.150.2.11", srcPort: 50001, dstPort: 80, protocol: "tcp", label: "外部 → web-1c" },
      { srcIp: "10.0.1.10", dstIp: "10.0.10.10", srcPort: 50002, dstPort: 8080, protocol: "tcp", label: "web-1a → app-1a (同一 AZ)" },
      { srcIp: "10.0.1.10", dstIp: "10.0.11.10", srcPort: 50003, dstPort: 8080, protocol: "tcp", label: "web-1a → app-1c (クロス AZ)" },
      { srcIp: "10.0.10.10", dstIp: "8.8.8.8", srcPort: 50004, dstPort: 443, protocol: "tcp", label: "app-1a → Internet (NAT)" },
    ],
  },
  {
    name: "NACL によるブロック",
    description: "NACL で特定 IP レンジを拒否。SG が許可してもNACL で止まる（ステートレス）。",
    build: (v) => {
      v.vpcs = [{ id: "vpc-1", cidr: "10.0.0.0/16", name: "nacl-demo-vpc" }];
      v.subnets = [pubSubnet("sub-1", "vpc-1", "10.0.1.0/24", "ap-northeast-1a", "web-subnet")];
      v.igws = [{ id: "igw-1", vpcId: "vpc-1" }];
      v.routeTables = [{ id: "sub-1-rt", vpcId: "vpc-1", name: "rt", routes: [
        { destination: "10.0.0.0/16", target: "local", targetType: "local" },
        { destination: "0.0.0.0/0", target: "igw-1", targetType: "igw" },
      ]}];
      v.nacls = [{ id: "sub-1-nacl", vpcId: "vpc-1", name: "strict-nacl", inbound: [
        { ruleNumber: 50, protocol: "all", portFrom: 0, portTo: 65535, cidr: "198.51.100.0/24", action: "deny" },
        { ruleNumber: 100, protocol: "tcp", portFrom: 80, portTo: 80, cidr: "0.0.0.0/0", action: "allow" },
        { ruleNumber: 110, protocol: "tcp", portFrom: 443, portTo: 443, cidr: "0.0.0.0/0", action: "allow" },
      ], outbound: [
        { ruleNumber: 100, protocol: "all", portFrom: 0, portTo: 65535, cidr: "0.0.0.0/0", action: "allow" },
      ]}];
      v.securityGroups = [{ id: "sg-1", vpcId: "vpc-1", name: "web-sg", inbound: [
        { protocol: "tcp", portFrom: 80, portTo: 80, source: "0.0.0.0/0" },
        { protocol: "tcp", portFrom: 443, portTo: 443, source: "0.0.0.0/0" },
      ], outbound: [
        { protocol: "all", portFrom: 0, portTo: 65535, source: "0.0.0.0/0" },
      ]}];
      v.enis = [{ id: "eni-1", subnetId: "sub-1", privateIp: "10.0.1.10", publicIp: "54.150.2.10", sgIds: ["sg-1"], instanceName: "web-server" }];
    },
    packets: [
      { srcIp: "203.0.113.1", dstIp: "54.150.2.10", srcPort: 50000, dstPort: 80, protocol: "tcp", label: "一般 → Web (許可)" },
      { srcIp: "198.51.100.50", dstIp: "54.150.2.10", srcPort: 50001, dstPort: 80, protocol: "tcp", label: "ブロック IP → Web (NACL 拒否)" },
      { srcIp: "198.51.100.50", dstIp: "54.150.2.10", srcPort: 50002, dstPort: 443, protocol: "tcp", label: "ブロック IP → HTTPS (NACL 拒否)" },
      { srcIp: "203.0.113.2", dstIp: "54.150.2.10", srcPort: 50003, dstPort: 443, protocol: "tcp", label: "一般 → HTTPS (許可)" },
    ],
  },
  {
    name: "プライベートサブネットのみ (NAT なし)",
    description: "インターネットアクセス不可のプライベート構成。外部からも内部からも通信できない。",
    build: (v) => {
      v.vpcs = [{ id: "vpc-1", cidr: "10.0.0.0/16", name: "private-only-vpc" }];
      v.subnets = [privSubnet("sub-1", "vpc-1", "10.0.1.0/24", "ap-northeast-1a", "private-only")];
      v.routeTables = [{ id: "sub-1-rt", vpcId: "vpc-1", name: "private-rt", routes: [
        { destination: "10.0.0.0/16", target: "local", targetType: "local" },
      ]}];
      v.nacls = [{ id: "sub-1-nacl", vpcId: "vpc-1", name: "default-nacl", inbound: [
        { ruleNumber: 100, protocol: "all", portFrom: 0, portTo: 65535, cidr: "10.0.0.0/16", action: "allow" },
      ], outbound: [
        { ruleNumber: 100, protocol: "all", portFrom: 0, portTo: 65535, cidr: "10.0.0.0/16", action: "allow" },
      ]}];
      v.securityGroups = [{ id: "sg-1", vpcId: "vpc-1", name: "internal-sg", inbound: [
        { protocol: "all", portFrom: 0, portTo: 65535, source: "10.0.0.0/16" },
      ], outbound: [
        { protocol: "all", portFrom: 0, portTo: 65535, source: "10.0.0.0/16" },
      ]}];
      v.enis = [
        { id: "eni-1", subnetId: "sub-1", privateIp: "10.0.1.10", publicIp: null, sgIds: ["sg-1"], instanceName: "internal-server" },
        { id: "eni-2", subnetId: "sub-1", privateIp: "10.0.1.20", publicIp: null, sgIds: ["sg-1"], instanceName: "internal-db" },
      ];
    },
    packets: [
      { srcIp: "10.0.1.10", dstIp: "10.0.1.20", srcPort: 50000, dstPort: 5432, protocol: "tcp", label: "server → db (VPC内 許可)" },
      { srcIp: "10.0.1.10", dstIp: "8.8.8.8", srcPort: 50001, dstPort: 443, protocol: "tcp", label: "server → Internet (ルートなし)" },
      { srcIp: "203.0.113.1", dstIp: "10.0.1.10", srcPort: 50002, dstPort: 80, protocol: "tcp", label: "外部 → server (到達不可)" },
    ],
  },
];

// ── 描画ヘルパー ──

function hopColor(result: TraceHop["result"]): string {
  switch (result) {
    case "pass":    return "#22c55e";
    case "drop":    return "#ef4444";
    case "forward": return "#3b82f6";
    case "info":    return "#94a3b8";
  }
}

export class AwsNetApp {
  init(container: HTMLElement): void {
    container.style.cssText = "display:flex;flex-direction:column;height:100vh;font-family:'Fira Code','Cascadia Code',monospace;background:#0f172a;color:#e2e8f0;";

    // ── ヘッダ ──
    const header = document.createElement("div");
    header.style.cssText = "padding:8px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #1e293b;flex-wrap:wrap;";
    const title = document.createElement("h1");
    title.textContent = "AWS VPC Network Simulator";
    title.style.cssText = "margin:0;font-size:15px;color:#ff9900;";
    header.appendChild(title);

    const exSelect = document.createElement("select");
    exSelect.style.cssText = "padding:4px 8px;background:#1e293b;border:1px solid #334155;border-radius:4px;color:#f8fafc;font-size:12px;";
    for (let i = 0; i < EXAMPLES.length; i++) { const o = document.createElement("option"); o.value = String(i); o.textContent = EXAMPLES[i]!.name; exSelect.appendChild(o); }
    header.appendChild(exSelect);

    const runBtn = document.createElement("button");
    runBtn.textContent = "\u25B6 Send All Packets";
    runBtn.style.cssText = "padding:4px 16px;background:#ff9900;color:#0f172a;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;";
    header.appendChild(runBtn);

    const descSpan = document.createElement("span");
    descSpan.style.cssText = "font-size:10px;color:#64748b;margin-left:auto;max-width:400px;";
    header.appendChild(descSpan);
    container.appendChild(header);

    // ── メイン ──
    const main = document.createElement("div");
    main.style.cssText = "flex:1;display:flex;overflow:hidden;";

    // 左: VPC トポロジ図
    const leftPanel = document.createElement("div");
    leftPanel.style.cssText = "flex:1;display:flex;flex-direction:column;border-right:1px solid #1e293b;overflow-y:auto;";
    const topoLabel = document.createElement("div");
    topoLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#ff9900;border-bottom:1px solid #1e293b;";
    topoLabel.textContent = "VPC Topology";
    leftPanel.appendChild(topoLabel);
    const topoDiv = document.createElement("div");
    topoDiv.style.cssText = "padding:12px;font-size:10px;";
    leftPanel.appendChild(topoDiv);
    main.appendChild(leftPanel);

    // 中央: パケット結果
    const centerPanel = document.createElement("div");
    centerPanel.style.cssText = "width:360px;display:flex;flex-direction:column;border-right:1px solid #1e293b;";
    const pktLabel = document.createElement("div");
    pktLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#e2e8f0;border-bottom:1px solid #1e293b;";
    pktLabel.textContent = "Packet Results";
    centerPanel.appendChild(pktLabel);
    const pktDiv = document.createElement("div");
    pktDiv.style.cssText = "flex:1;padding:4px 8px;font-size:10px;overflow-y:auto;";
    centerPanel.appendChild(pktDiv);
    main.appendChild(centerPanel);

    // 右: トレース
    const rightPanel = document.createElement("div");
    rightPanel.style.cssText = "width:400px;display:flex;flex-direction:column;";
    const trLabel = document.createElement("div");
    trLabel.style.cssText = "padding:4px 12px;font-size:11px;font-weight:600;color:#22c55e;border-bottom:1px solid #1e293b;";
    trLabel.textContent = "Packet Trace (click)";
    rightPanel.appendChild(trLabel);
    const trDiv = document.createElement("div");
    trDiv.style.cssText = "flex:1;padding:4px 8px;font-size:10px;overflow-y:auto;line-height:1.6;";
    rightPanel.appendChild(trDiv);
    main.appendChild(rightPanel);
    container.appendChild(main);

    // ── VPC トポロジ図の描画 ──

    const renderTopology = (vpc: AwsVpc) => {
      topoDiv.innerHTML = "";
      for (const v of vpc.vpcs) {
        const vpcBox = document.createElement("div");
        vpcBox.style.cssText = "border:2px solid #ff990044;border-radius:8px;padding:10px;margin-bottom:10px;background:#ff990005;";
        vpcBox.innerHTML = `<div style="color:#ff9900;font-weight:600;margin-bottom:8px;">\u{1F310} ${v.name} (${v.cidr})</div>`;

        // IGW
        for (const igw of vpc.igws.filter((g) => g.vpcId === v.id)) {
          const el = document.createElement("div");
          el.style.cssText = "margin-bottom:6px;padding:4px 8px;background:#3b82f615;border:1px solid #3b82f644;border-radius:4px;display:inline-block;";
          el.innerHTML = `<span style="color:#3b82f6;">\u{1F30D} IGW</span> <span style="color:#64748b;">${igw.id}</span>`;
          vpcBox.appendChild(el);
        }

        // サブネット
        const azGroups = new Map<string, typeof vpc.subnets>();
        for (const sub of vpc.subnets.filter((s) => s.vpcId === v.id)) {
          if (!azGroups.has(sub.az)) azGroups.set(sub.az, []);
          azGroups.get(sub.az)!.push(sub);
        }

        for (const [az, subs] of azGroups) {
          const azBox = document.createElement("div");
          azBox.style.cssText = "margin:6px 0;padding:8px;border:1px dashed #475569;border-radius:6px;";
          azBox.innerHTML = `<div style="color:#64748b;font-size:9px;margin-bottom:4px;">\u{1F4CD} ${az}</div>`;

          for (const sub of subs) {
            const subBox = document.createElement("div");
            const subColor = sub.public ? "#22c55e" : "#a78bfa";
            subBox.style.cssText = `margin:4px 0;padding:6px;border:1px solid ${subColor}44;border-radius:4px;background:${subColor}08;`;

            const tag = sub.public ? "\u{1F4E4} Public" : "\u{1F512} Private";
            subBox.innerHTML = `<div style="color:${subColor};font-weight:600;">${tag} — ${sub.name} (${sub.cidr})</div>`;

            // NAT GW
            for (const nat of vpc.natGws.filter((n) => n.subnetId === sub.id)) {
              subBox.innerHTML += `<div style="color:#f59e0b;font-size:9px;margin-top:2px;">\u{1F501} NAT GW ${nat.id} (${nat.publicIp})</div>`;
            }

            // ENIs
            for (const eni of vpc.enis.filter((e) => e.subnetId === sub.id)) {
              const pubTag = eni.publicIp ? ` / ${eni.publicIp}` : "";
              subBox.innerHTML += `<div style="margin-top:3px;padding:3px 6px;background:#1e293b;border-radius:3px;color:#e2e8f0;">` +
                `\u{1F5A5} ${eni.instanceName} <span style="color:#64748b;">${eni.privateIp}${pubTag}</span> ` +
                `<span style="color:#f59e0b;font-size:8px;">[${eni.sgIds.join(",")}]</span></div>`;
            }

            azBox.appendChild(subBox);
          }
          vpcBox.appendChild(azBox);
        }
        topoDiv.appendChild(vpcBox);
      }
    };

    const renderResults = (results: PacketTrace[]) => {
      pktDiv.innerHTML = "";
      for (const r of results) {
        const el = document.createElement("div");
        const ok = r.allowed;
        const border = ok ? "#22c55e" : "#ef4444";
        el.style.cssText = `padding:5px 8px;margin-bottom:3px;border:1px solid ${border}44;border-radius:4px;background:${border}08;cursor:pointer;`;
        el.innerHTML =
          `<div style="display:flex;justify-content:space-between;">` +
          `<span style="color:#e2e8f0;font-weight:600;">${r.packet.label}</span>` +
          `<span style="color:${border};font-weight:600;">${ok ? "\u2714 ALLOW" : "\u2718 DROP"}</span>` +
          `</div>` +
          `<div style="color:#64748b;font-size:9px;">${r.packet.srcIp}:${r.packet.srcPort} \u2192 ${r.packet.dstIp}:${r.packet.dstPort} ${r.packet.protocol}</div>` +
          `<div style="color:#475569;font-size:9px;">${r.hops.length} hops</div>`;
        el.addEventListener("click", () => renderTrace(r.hops));
        pktDiv.appendChild(el);
      }
    };

    const renderTrace = (hops: TraceHop[]) => {
      trDiv.innerHTML = "";
      for (let i = 0; i < hops.length; i++) {
        const hop = hops[i]!;
        const color = hopColor(hop.result);
        const el = document.createElement("div");
        el.style.cssText = "display:flex;gap:4px;align-items:flex-start;margin-bottom:3px;";
        el.innerHTML =
          `<span style="min-width:14px;color:${color};font-weight:700;">${i + 1}</span>` +
          `<span style="min-width:120px;color:${color};font-weight:600;font-size:9px;">${hop.component}</span>` +
          `<span style="color:#cbd5e1;">${hop.action}</span>`;
        trDiv.appendChild(el);

        if (i < hops.length - 1) {
          const arrow = document.createElement("div");
          arrow.style.cssText = "color:#334155;padding-left:14px;font-size:9px;";
          arrow.textContent = "\u2502";
          trDiv.appendChild(arrow);
        }
      }
    };

    // ── ロジック ──

    const loadExample = (ex: Example) => {
      descSpan.textContent = ex.description;
      const vpc = new AwsVpc();
      ex.build(vpc);
      renderTopology(vpc);
      pktDiv.innerHTML = "";
      trDiv.innerHTML = "";
    };

    const runAll = (ex: Example) => {
      const vpc = new AwsVpc();
      ex.build(vpc);
      renderTopology(vpc);
      const results: PacketTrace[] = [];
      for (const pkt of ex.packets) results.push(vpc.tracePacket(pkt));
      renderResults(results);
      if (results[0]) renderTrace(results[0].hops);
    };

    exSelect.addEventListener("change", () => { const ex = EXAMPLES[Number(exSelect.value)]; if (ex) loadExample(ex); });
    runBtn.addEventListener("click", () => { const ex = EXAMPLES[Number(exSelect.value)]; if (ex) runAll(ex); });
    loadExample(EXAMPLES[0]!);
  }
}
