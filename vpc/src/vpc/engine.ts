import type {
  Cidr, IPv4, Vpc, Subnet, Instance, SecurityGroup, SgRule,
  RouteTable, Route, NetworkAcl, AclRule,
  Packet, PacketDef, SimEvent, SimulationResult,
} from "./types.js";

// === CIDR / IPアドレス操作 ===

/** IPアドレスを32ビット整数に変換 */
export function ipToInt(ip: IPv4): number {
  const parts = ip.split(".").map(Number);
  return ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0;
}

/** 32ビット整数をIPアドレスに変換 */
export function intToIp(n: number): IPv4 {
  return `${(n >>> 24) & 0xFF}.${(n >>> 16) & 0xFF}.${(n >>> 8) & 0xFF}.${n & 0xFF}`;
}

/** CIDRをネットワークアドレスとマスクに分解 */
export function parseCidr(cidr: Cidr): { network: number; mask: number; prefix: number } {
  const [ip, prefixStr] = cidr.split("/");
  const prefix = parseInt(prefixStr!, 10);
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  const network = (ipToInt(ip!) & mask) >>> 0;
  return { network, mask, prefix };
}

/** IPアドレスがCIDR範囲内か判定 */
export function isInCidr(ip: IPv4, cidr: Cidr): boolean {
  const { network, mask } = parseCidr(cidr);
  return ((ipToInt(ip) & mask) >>> 0) === network;
}

/** CIDRのプレフィックス長を取得 */
function cidrPrefix(cidr: Cidr): number {
  return parseInt(cidr.split("/")[1]!, 10);
}

// === ルートテーブル評価 ===

/** ルートテーブルからベストマッチを検索（最長一致） */
export function findRoute(rt: RouteTable, dstIp: IPv4): Route | null {
  let best: Route | null = null;
  let bestPrefix = -1;
  for (const route of rt.routes) {
    if (isInCidr(dstIp, route.destination)) {
      const prefix = cidrPrefix(route.destination);
      if (prefix > bestPrefix) {
        best = route;
        bestPrefix = prefix;
      }
    }
  }
  return best;
}

// === ネットワークACL評価 ===

/** ACLルールを評価（ルール番号順に最初にマッチしたルール） */
export function evaluateAcl(
  rules: AclRule[], packet: Packet, direction: "inbound" | "outbound",
): { matched: boolean; rule: AclRule | null; action: "allow" | "deny" } {
  const sorted = [...rules].sort((a, b) => a.ruleNumber - b.ruleNumber);
  const checkIp = direction === "inbound" ? packet.srcIp : packet.dstIp;

  for (const rule of sorted) {
    if (!matchAclRule(rule, packet, checkIp)) continue;
    return { matched: true, rule, action: rule.action };
  }
  // デフォルト: deny
  return { matched: false, rule: null, action: "deny" };
}

function matchAclRule(rule: AclRule, packet: Packet, ip: IPv4): boolean {
  if (rule.protocol !== "all" && rule.protocol !== packet.protocol) return false;
  if (!isInCidr(ip, rule.cidr)) return false;
  if (rule.protocol !== "icmp" && rule.protocol !== "all") {
    const port = packet.dstPort;
    if (port < rule.fromPort || port > rule.toPort) return false;
  }
  return true;
}

// === セキュリティグループ評価 ===

/** セキュリティグループ評価（ステートフル、いずれかのルールにマッチすればallow） */
export function evaluateSg(
  sgs: SecurityGroup[], packet: Packet, direction: "inbound" | "outbound",
): { allowed: boolean; matchedRule: SgRule | null; sgName: string } {
  for (const sg of sgs) {
    const rules = direction === "inbound" ? sg.inboundRules : sg.outboundRules;
    for (const rule of rules) {
      if (matchSgRule(rule, packet, direction)) {
        return { allowed: true, matchedRule: rule, sgName: sg.name };
      }
    }
  }
  return { allowed: false, matchedRule: null, sgName: "" };
}

function matchSgRule(rule: SgRule, packet: Packet, direction: "inbound" | "outbound"): boolean {
  if (rule.protocol !== "all" && rule.protocol !== packet.protocol) return false;
  if (rule.protocol !== "icmp" && rule.protocol !== "all") {
    const port = direction === "inbound" ? packet.dstPort : packet.dstPort;
    if (port < rule.fromPort || port > rule.toPort) return false;
  }
  // ソースCIDRチェック
  const checkIp = direction === "inbound" ? packet.srcIp : packet.dstIp;
  if (rule.source.startsWith("sg-")) return true; // SG参照は簡易的にtrue
  if (!isInCidr(checkIp, rule.source)) return false;
  return true;
}

// === VPC内リソース検索 ===

/** インスタンスをIPで検索 */
function findInstanceByIp(vpcs: Vpc[], ip: IPv4): { vpc: Vpc; subnet: Subnet; instance: Instance } | null {
  for (const vpc of vpcs) {
    for (const subnet of vpc.subnets) {
      for (const inst of subnet.instances) {
        if (inst.privateIp === ip || inst.publicIp === ip) {
          return { vpc, subnet, instance: inst };
        }
      }
    }
  }
  return null;
}

/** インスタンスをIDで検索 */
function findInstanceById(vpcs: Vpc[], id: string): { vpc: Vpc; subnet: Subnet; instance: Instance } | null {
  for (const vpc of vpcs) {
    for (const subnet of vpc.subnets) {
      for (const inst of subnet.instances) {
        if (inst.id === id) return { vpc, subnet, instance: inst };
      }
    }
  }
  return null;
}

/** サブネットのルートテーブルを取得 */
function getRouteTable(vpc: Vpc, subnet: Subnet): RouteTable | undefined {
  return vpc.routeTables.find((rt) => rt.id === subnet.routeTableId);
}

/** サブネットのNACLを取得 */
function getAcl(vpc: Vpc, subnetId: string): NetworkAcl | undefined {
  return vpc.networkAcls.find((acl) => acl.subnetIds.includes(subnetId));
}

// === シミュレーションエンジン ===

export function runSimulation(vpcs: Vpc[], packetDefs: PacketDef[]): SimulationResult {
  const events: SimEvent[] = [];
  let step = 0;
  let delivered = false;

  for (const pktDef of packetDefs) {
    delivered = false;

    // 送信元インスタンスの検索
    const srcInfo = findInstanceById(vpcs, pktDef.srcInstanceId);
    if (!srcInfo) {
      events.push({
        step: step++, type: "drop", resource: pktDef.srcInstanceId,
        description: `送信元インスタンス ${pktDef.srcInstanceId} が見つからない`,
      });
      continue;
    }

    const packet: Packet = {
      srcIp: srcInfo.instance.privateIp,
      dstIp: pktDef.dstIp,
      protocol: pktDef.protocol,
      srcPort: pktDef.srcPort,
      dstPort: pktDef.dstPort,
      payload: pktDef.payload,
    };

    events.push({
      step: step++, type: "packet_create", resource: srcInfo.instance.name,
      packet,
      description: `パケット生成: ${packet.srcIp}:${packet.srcPort} → ${packet.dstIp}:${packet.dstPort} (${packet.protocol})`,
    });

    // 1. 送信元のセキュリティグループ（アウトバウンド）
    const sgOut = evaluateSg(srcInfo.instance.securityGroups, packet, "outbound");
    events.push({
      step: step++, type: "sg_evaluate", resource: srcInfo.instance.name,
      description: `送信元SG評価 (outbound): ${sgOut.allowed ? "許可" : "拒否"}${sgOut.matchedRule ? ` [${sgOut.sgName}: ${sgOut.matchedRule.description}]` : " [ルールなし]"}`,
    });
    if (!sgOut.allowed) {
      events.push({
        step: step++, type: "sg_deny", resource: srcInfo.instance.name,
        description: `セキュリティグループにより送信拒否`,
      });
      continue;
    }
    events.push({
      step: step++, type: "sg_allow", resource: srcInfo.instance.name,
      description: `SG outbound 許可`,
    });

    // 2. 送信元サブネットのNACL（アウトバウンド）
    const srcAcl = getAcl(srcInfo.vpc, srcInfo.subnet.id);
    if (srcAcl) {
      const aclResult = evaluateAcl(srcAcl.outboundRules, packet, "outbound");
      events.push({
        step: step++, type: "nacl_evaluate", resource: srcAcl.name,
        description: `送信元NACL評価 (outbound): ルール${aclResult.rule?.ruleNumber ?? "*"} → ${aclResult.action}`,
      });
      if (aclResult.action === "deny") {
        events.push({
          step: step++, type: "nacl_deny", resource: srcAcl.name,
          description: `NACLにより送信拒否`,
        });
        continue;
      }
      events.push({
        step: step++, type: "nacl_allow", resource: srcAcl.name,
        description: `NACL outbound 許可`,
      });
    }

    // 3. ルートテーブル評価
    const rt = getRouteTable(srcInfo.vpc, srcInfo.subnet);
    if (!rt) {
      events.push({
        step: step++, type: "drop", resource: srcInfo.subnet.name,
        description: `ルートテーブルが見つからない`,
      });
      continue;
    }

    const route = findRoute(rt, packet.dstIp);
    events.push({
      step: step++, type: "route_lookup", resource: rt.name,
      description: `ルートテーブル検索: dst=${packet.dstIp}`,
    });

    if (!route) {
      events.push({
        step: step++, type: "route_no_match", resource: rt.name,
        description: `ルートが見つからない → パケット破棄`,
      });
      events.push({ step: step++, type: "drop", resource: rt.name, description: "宛先へのルートなし" });
      continue;
    }

    events.push({
      step: step++, type: "route_match", resource: rt.name,
      description: `ルートマッチ: ${route.destination} → ${route.target} (${route.targetType})`,
    });

    // 4. ターゲット別処理
    switch (route.targetType) {
      case "local": {
        // VPC内ローカル転送
        const dstInfo = findInstanceByIp(vpcs, packet.dstIp);
        if (!dstInfo) {
          events.push({
            step: step++, type: "drop", resource: srcInfo.vpc.name,
            description: `宛先 ${packet.dstIp} のインスタンスがVPC内に存在しない`,
          });
          continue;
        }

        events.push({
          step: step++, type: "subnet_forward", resource: srcInfo.vpc.name,
          description: `VPC内ローカル転送: ${srcInfo.subnet.name} → ${dstInfo.subnet.name}`,
        });

        // 宛先サブネットのNACL（インバウンド）
        const dstAcl = getAcl(dstInfo.vpc, dstInfo.subnet.id);
        if (dstAcl) {
          const aclIn = evaluateAcl(dstAcl.inboundRules, packet, "inbound");
          events.push({
            step: step++, type: "nacl_evaluate", resource: dstAcl.name,
            description: `宛先NACL評価 (inbound): ルール${aclIn.rule?.ruleNumber ?? "*"} → ${aclIn.action}`,
          });
          if (aclIn.action === "deny") {
            events.push({
              step: step++, type: "nacl_deny", resource: dstAcl.name,
              description: `NACLにより受信拒否`,
            });
            continue;
          }
          events.push({
            step: step++, type: "nacl_allow", resource: dstAcl.name,
            description: `NACL inbound 許可`,
          });
        }

        // 宛先SGインバウンド
        const sgIn = evaluateSg(dstInfo.instance.securityGroups, packet, "inbound");
        events.push({
          step: step++, type: "sg_evaluate", resource: dstInfo.instance.name,
          description: `宛先SG評価 (inbound): ${sgIn.allowed ? "許可" : "拒否"}${sgIn.matchedRule ? ` [${sgIn.sgName}: ${sgIn.matchedRule.description}]` : ""}`,
        });
        if (!sgIn.allowed) {
          events.push({
            step: step++, type: "sg_deny", resource: dstInfo.instance.name,
            description: `セキュリティグループにより受信拒否`,
          });
          continue;
        }
        events.push({
          step: step++, type: "sg_allow", resource: dstInfo.instance.name,
          description: `SG inbound 許可`,
        });

        events.push({
          step: step++, type: "deliver", resource: dstInfo.instance.name,
          packet,
          description: `パケット配送完了: ${dstInfo.instance.name} (${dstInfo.instance.privateIp})`,
        });
        delivered = true;
        break;
      }

      case "igw": {
        // インターネットゲートウェイ経由
        const igw = srcInfo.vpc.igw;
        if (!igw) {
          events.push({
            step: step++, type: "drop", resource: "IGW",
            description: `インターネットゲートウェイが存在しない`,
          });
          continue;
        }
        events.push({
          step: step++, type: "igw_forward", resource: igw.name,
          description: `IGW経由でインターネットへ転送: ${packet.srcIp} → ${packet.dstIp}`,
        });
        events.push({
          step: step++, type: "deliver", resource: "Internet",
          packet,
          description: `インターネットへ到達: ${packet.dstIp}:${packet.dstPort}`,
        });
        delivered = true;
        break;
      }

      case "nat": {
        // NATゲートウェイ経由
        const nat = srcInfo.vpc.natGateways.find((n) => route.target === n.id);
        if (!nat) {
          events.push({
            step: step++, type: "drop", resource: "NAT",
            description: `NATゲートウェイ ${route.target} が見つからない`,
          });
          continue;
        }
        events.push({
          step: step++, type: "nat_translate", resource: nat.name,
          description: `NAT変換: ${packet.srcIp} → ${nat.publicIp} (EIP)`,
        });
        events.push({
          step: step++, type: "igw_forward", resource: srcInfo.vpc.igw?.name ?? "IGW",
          description: `IGW経由でインターネットへ: ${nat.publicIp} → ${packet.dstIp}`,
        });
        events.push({
          step: step++, type: "deliver", resource: "Internet",
          packet: { ...packet, srcIp: nat.publicIp },
          description: `インターネットへ到達 (NAT経由): src=${nat.publicIp}, dst=${packet.dstIp}`,
        });
        delivered = true;
        break;
      }

      case "peering": {
        // VPCピアリング
        const peering = srcInfo.vpc.peeringConnections.find((p) => route.target === p.id);
        if (!peering) {
          events.push({
            step: step++, type: "drop", resource: "Peering",
            description: `ピアリング接続 ${route.target} が見つからない`,
          });
          continue;
        }

        events.push({
          step: step++, type: "peering_forward", resource: peering.name,
          description: `VPCピアリング転送: ${srcInfo.vpc.name} → peer VPC (${peering.peerCidr})`,
        });

        // ピア先VPCでのルーティング
        const peerVpc = vpcs.find((v) => v.id === peering.peerVpcId);
        if (!peerVpc) {
          events.push({
            step: step++, type: "drop", resource: peering.name,
            description: `ピア先VPC ${peering.peerVpcId} が見つからない`,
          });
          continue;
        }

        const dstInPeer = findInstanceByIp([peerVpc], packet.dstIp);
        if (!dstInPeer) {
          events.push({
            step: step++, type: "drop", resource: peerVpc.name,
            description: `ピア先VPCに宛先 ${packet.dstIp} が存在しない`,
          });
          continue;
        }

        // ピア先のNACLとSG評価
        const peerAcl = getAcl(peerVpc, dstInPeer.subnet.id);
        if (peerAcl) {
          const peerAclResult = evaluateAcl(peerAcl.inboundRules, packet, "inbound");
          events.push({
            step: step++, type: "nacl_evaluate", resource: peerAcl.name,
            description: `ピア先NACL評価 (inbound): ルール${peerAclResult.rule?.ruleNumber ?? "*"} → ${peerAclResult.action}`,
          });
          if (peerAclResult.action === "deny") {
            events.push({
              step: step++, type: "nacl_deny", resource: peerAcl.name,
              description: `ピア先NACLにより拒否`,
            });
            continue;
          }
        }

        const peerSg = evaluateSg(dstInPeer.instance.securityGroups, packet, "inbound");
        events.push({
          step: step++, type: "sg_evaluate", resource: dstInPeer.instance.name,
          description: `ピア先SG評価 (inbound): ${peerSg.allowed ? "許可" : "拒否"}`,
        });
        if (!peerSg.allowed) {
          events.push({
            step: step++, type: "sg_deny", resource: dstInPeer.instance.name,
            description: `ピア先SGにより拒否`,
          });
          continue;
        }

        events.push({
          step: step++, type: "deliver", resource: dstInPeer.instance.name,
          packet,
          description: `ピアリング経由で配送完了: ${dstInPeer.instance.name} (${dstInPeer.instance.privateIp})`,
        });
        delivered = true;
        break;
      }
    }
  }

  return { events, delivered };
}
