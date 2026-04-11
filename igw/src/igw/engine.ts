import type {
  IPv4, Cidr, Vpc, Subnet, Instance, Route, RouteTable,
  Packet, PacketDef, NatEntry, SimEvent, SimulationResult,
} from "./types.js";

// === IP / CIDR ===

export function ipToInt(ip: IPv4): number {
  const p = ip.split(".").map(Number);
  return ((p[0]! << 24) | (p[1]! << 16) | (p[2]! << 8) | p[3]!) >>> 0;
}

export function parseCidr(cidr: Cidr): { network: number; mask: number; prefix: number } {
  const [ip, prefixStr] = cidr.split("/");
  const prefix = parseInt(prefixStr!, 10);
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  const network = (ipToInt(ip!) & mask) >>> 0;
  return { network, mask, prefix };
}

export function isInCidr(ip: IPv4, cidr: Cidr): boolean {
  const { network, mask } = parseCidr(cidr);
  return ((ipToInt(ip) & mask) >>> 0) === network;
}



// === VPCリソース検索 ===

function findInstanceById(vpc: Vpc, id: string): Instance | undefined {
  return vpc.instances.find((i) => i.id === id);
}

function findInstanceByPrivateIp(vpc: Vpc, ip: IPv4): Instance | undefined {
  return vpc.instances.find((i) => i.privateIp === ip);
}

function findInstanceByPublicIp(vpc: Vpc, ip: IPv4): Instance | undefined {
  return vpc.instances.find((i) => i.publicIp === ip);
}

function findSubnet(vpc: Vpc, subnetId: string): Subnet | undefined {
  return vpc.subnets.find((s) => s.id === subnetId);
}

function findRouteTable(vpc: Vpc, rtId: string): RouteTable | undefined {
  return vpc.routeTables.find((r) => r.id === rtId);
}

function findBestRoute(rt: RouteTable, dstIp: IPv4): Route | null {
  let best: Route | null = null;
  let bestPrefix = -1;
  for (const route of rt.routes) {
    if (isInCidr(dstIp, route.destination)) {
      const prefix = parseInt(route.destination.split("/")[1]!, 10);
      if (prefix > bestPrefix) {
        best = route;
        bestPrefix = prefix;
      }
    }
  }
  return best;
}

// === シミュレーション ===

export function runSimulation(vpc: Vpc, packets: PacketDef[]): SimulationResult {
  const events: SimEvent[] = [];
  const natTable: NatEntry[] = [];
  let step = 0;
  let delivered = false;

  for (const pktDef of packets) {
    delivered = false;

    if (pktDef.direction === "outbound") {
      // === アウトバウンド: インスタンス → インターネット ===
      const inst = pktDef.srcInstanceId ? findInstanceById(vpc, pktDef.srcInstanceId) : undefined;
      if (!inst) {
        events.push({ step: step++, type: "drop", resource: "VPC", description: `送信元インスタンス ${pktDef.srcInstanceId} が見つからない` });
        continue;
      }

      const packet: Packet = {
        srcIp: inst.privateIp, dstIp: pktDef.dstIp,
        protocol: pktDef.protocol, srcPort: pktDef.srcPort, dstPort: pktDef.dstPort,
        payload: pktDef.payload,
      };

      events.push({
        step: step++, type: "packet_create", resource: inst.name, packet,
        description: `パケット生成: ${packet.srcIp}:${packet.srcPort} → ${packet.dstIp}:${packet.dstPort} (${packet.protocol})`,
      });

      // ルートテーブル検索
      const subnet = findSubnet(vpc, inst.subnetId);
      if (!subnet) {
        events.push({ step: step++, type: "drop", resource: inst.name, description: `サブネット ${inst.subnetId} が見つからない` });
        continue;
      }

      const rt = findRouteTable(vpc, subnet.routeTableId);
      if (!rt) {
        events.push({ step: step++, type: "drop", resource: subnet.name, description: `ルートテーブル ${subnet.routeTableId} が見つからない` });
        continue;
      }

      events.push({ step: step++, type: "route_lookup", resource: rt.name, description: `ルートテーブル検索: dst=${packet.dstIp}` });

      const route = findBestRoute(rt, packet.dstIp);
      if (!route) {
        events.push({ step: step++, type: "route_no_match", resource: rt.name, description: `ルートなし → パケット破棄` });
        events.push({ step: step++, type: "drop", resource: rt.name, description: `宛先 ${packet.dstIp} へのルートが存在しない` });
        continue;
      }

      events.push({ step: step++, type: "route_match", resource: rt.name, description: `ルートマッチ: ${route.destination} → ${route.target} (${route.targetType})` });

      if (route.targetType === "local") {
        // VPC内ローカル転送
        const dstInst = findInstanceByPrivateIp(vpc, packet.dstIp);
        if (dstInst) {
          events.push({ step: step++, type: "subnet_forward", resource: vpc.name, description: `VPC内ローカル転送 → ${dstInst.name}` });
          events.push({ step: step++, type: "deliver", resource: dstInst.name, packet, description: `配送完了: ${dstInst.name} (${dstInst.privateIp})` });
          delivered = true;
        } else {
          events.push({ step: step++, type: "drop", resource: vpc.name, description: `VPC内に宛先 ${packet.dstIp} が存在しない` });
        }
        continue;
      }

      if (route.targetType === "igw") {
        // IGW経由
        if (!vpc.igw) {
          events.push({ step: step++, type: "drop", resource: "IGW", description: `IGWが存在しない` });
          continue;
        }
        if (vpc.igw.state !== "attached") {
          events.push({ step: step++, type: "igw_detached", resource: vpc.igw.name, description: `IGWがVPCにアタッチされていない (state=${vpc.igw.state})` });
          events.push({ step: step++, type: "drop", resource: vpc.igw.name, description: `パケット破棄` });
          continue;
        }

        events.push({ step: step++, type: "igw_receive", resource: vpc.igw.name, description: `IGWがパケットを受信 (src=${packet.srcIp}, dst=${packet.dstIp})` });

        // IGWの1:1 NAT（プライベートIP → パブリックIP）
        if (!inst.publicIp) {
          events.push({
            step: step++, type: "igw_no_public_ip", resource: vpc.igw.name,
            description: `インスタンス ${inst.name} にパブリックIPが割り当てられていない → パケット破棄。IGWはパブリックIPなしのインスタンスのトラフィックを転送できない`,
          });
          events.push({ step: step++, type: "drop", resource: vpc.igw.name, description: `パブリックIPなし` });
          continue;
        }

        const natEntry: NatEntry = {
          originalSrc: inst.privateIp, translatedSrc: inst.publicIp,
          originalDst: packet.dstIp, direction: "outbound",
          description: `送信NAT: ${inst.privateIp} → ${inst.publicIp}`,
        };
        natTable.push(natEntry);

        events.push({
          step: step++, type: "igw_nat_outbound", resource: vpc.igw.name, natEntry,
          description: `IGW 1:1 NAT (outbound): srcIP ${inst.privateIp} → ${inst.publicIp}`,
        });

        const translatedPacket = { ...packet, srcIp: inst.publicIp };
        events.push({
          step: step++, type: "igw_forward_internet", resource: vpc.igw.name,
          packet: translatedPacket,
          description: `インターネットへ転送: ${inst.publicIp}:${packet.srcPort} → ${packet.dstIp}:${packet.dstPort}`,
        });
        events.push({
          step: step++, type: "deliver", resource: "Internet",
          packet: translatedPacket,
          description: `インターネットに到達`,
        });
        delivered = true;
        continue;
      }

      if (route.targetType === "nat") {
        // NATゲートウェイ経由
        const nat = vpc.natGateways.find((n) => n.id === route.target);
        if (!nat) {
          events.push({ step: step++, type: "drop", resource: "NAT-GW", description: `NATゲートウェイ ${route.target} が見つからない` });
          continue;
        }

        events.push({
          step: step++, type: "nat_gw_translate", resource: nat.name,
          description: `NATゲートウェイでアドレス変換: ${packet.srcIp} → ${nat.publicIp}`,
        });

        const natEntry: NatEntry = {
          originalSrc: inst.privateIp, translatedSrc: nat.publicIp,
          originalDst: packet.dstIp, direction: "outbound",
          description: `NAT-GW変換: ${inst.privateIp} → ${nat.publicIp}`,
        };
        natTable.push(natEntry);

        // NAT-GWはパブリックサブネットにいるのでIGW経由
        if (!vpc.igw || vpc.igw.state !== "attached") {
          events.push({ step: step++, type: "drop", resource: "IGW", description: `IGWが利用できない` });
          continue;
        }

        events.push({
          step: step++, type: "igw_receive", resource: vpc.igw.name,
          description: `IGWがNAT-GWからのパケットを受信`,
        });
        events.push({
          step: step++, type: "igw_forward_internet", resource: vpc.igw.name,
          packet: { ...packet, srcIp: nat.publicIp },
          description: `インターネットへ転送: ${nat.publicIp} → ${packet.dstIp}`,
        });
        events.push({
          step: step++, type: "deliver", resource: "Internet",
          packet: { ...packet, srcIp: nat.publicIp },
          description: `インターネットに到達 (NAT-GW経由)`,
        });
        delivered = true;
        continue;
      }

      if (route.targetType === "blackhole") {
        events.push({ step: step++, type: "drop", resource: rt.name, description: `ブラックホールルート → パケット破棄` });
        continue;
      }

    } else {
      // === インバウンド: インターネット → インスタンス ===
      const dstPublicIp = pktDef.dstIp;
      const srcExternalIp = pktDef.srcExternalIp ?? "203.0.113.50";

      const packet: Packet = {
        srcIp: srcExternalIp, dstIp: dstPublicIp,
        protocol: pktDef.protocol, srcPort: pktDef.srcPort, dstPort: pktDef.dstPort,
        payload: pktDef.payload,
      };

      events.push({
        step: step++, type: "packet_create", resource: "Internet",
        packet,
        description: `インターネットからパケット受信: ${packet.srcIp}:${packet.srcPort} → ${packet.dstIp}:${packet.dstPort}`,
      });

      // IGW確認
      if (!vpc.igw) {
        events.push({ step: step++, type: "drop", resource: "IGW", description: `IGWが存在しない` });
        continue;
      }
      if (vpc.igw.state !== "attached") {
        events.push({ step: step++, type: "igw_detached", resource: vpc.igw.name, description: `IGWがアタッチされていない` });
        events.push({ step: step++, type: "drop", resource: vpc.igw.name, description: `パケット破棄` });
        continue;
      }

      events.push({
        step: step++, type: "igw_receive_internet", resource: vpc.igw.name,
        description: `IGWがインターネットからパケットを受信 (dst=${dstPublicIp})`,
      });

      // パブリックIPからインスタンスを検索
      const targetInst = findInstanceByPublicIp(vpc, dstPublicIp);
      if (!targetInst) {
        events.push({
          step: step++, type: "drop", resource: vpc.igw.name,
          description: `パブリックIP ${dstPublicIp} に対応するインスタンスがない`,
        });
        continue;
      }

      // IGWの1:1 NAT（パブリックIP → プライベートIP）
      const natEntry: NatEntry = {
        originalSrc: srcExternalIp, translatedSrc: srcExternalIp,
        originalDst: dstPublicIp, direction: "inbound",
        description: `受信NAT: dst ${dstPublicIp} → ${targetInst.privateIp}`,
      };
      natTable.push(natEntry);

      events.push({
        step: step++, type: "igw_nat_inbound", resource: vpc.igw.name, natEntry,
        description: `IGW 1:1 NAT (inbound): dstIP ${dstPublicIp} → ${targetInst.privateIp}`,
      });

      const translatedPacket = { ...packet, dstIp: targetInst.privateIp };

      // VPC内ルーティング
      const targetSubnet = findSubnet(vpc, targetInst.subnetId);
      if (targetSubnet) {
        events.push({
          step: step++, type: "subnet_forward", resource: targetSubnet.name,
          description: `サブネット ${targetSubnet.name} へ転送`,
        });
      }

      events.push({
        step: step++, type: "deliver", resource: targetInst.name,
        packet: translatedPacket,
        description: `配送完了: ${targetInst.name} (${targetInst.privateIp}) ← ${srcExternalIp}`,
      });
      delivered = true;
    }
  }

  return { events, natTable, delivered };
}
