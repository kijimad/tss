/**
 * vpc.ts — AWS VPC ネットワークシミュレーション
 *
 * VPC / Subnet / IGW / NAT GW / Route Table / NACL / SG / ENI を
 * 再現し、パケットのルーティング判定とフィルタリングをトレース。
 */

// ── リソース型 ──

export interface Vpc {
  id: string;
  cidr: string;
  name: string;
}

export interface Subnet {
  id: string;
  vpcId: string;
  cidr: string;
  az: string;
  name: string;
  routeTableId: string;
  naclId: string;
  public: boolean;
}

export interface InternetGateway {
  id: string;
  vpcId: string;
}

export interface NatGateway {
  id: string;
  subnetId: string;
  publicIp: string;
}

export interface RouteTable {
  id: string;
  vpcId: string;
  name: string;
  routes: Route[];
}

export interface Route {
  destination: string;
  target: string;
  targetType: "local" | "igw" | "nat" | "pcx" | "vpgw" | "blackhole";
}

export interface NaclRule {
  ruleNumber: number;
  protocol: "tcp" | "udp" | "icmp" | "all";
  portFrom: number;
  portTo: number;
  cidr: string;
  action: "allow" | "deny";
}

export interface Nacl {
  id: string;
  vpcId: string;
  name: string;
  inbound: NaclRule[];
  outbound: NaclRule[];
}

export interface SecurityGroupRule {
  protocol: "tcp" | "udp" | "icmp" | "all";
  portFrom: number;
  portTo: number;
  source: string;
}

export interface SecurityGroup {
  id: string;
  vpcId: string;
  name: string;
  inbound: SecurityGroupRule[];
  outbound: SecurityGroupRule[];
}

export interface Eni {
  id: string;
  subnetId: string;
  privateIp: string;
  publicIp: string | null;
  sgIds: string[];
  instanceName: string;
}

// ── パケット ──

export interface Packet {
  srcIp: string;
  dstIp: string;
  srcPort: number;
  dstPort: number;
  protocol: "tcp" | "udp" | "icmp";
  label: string;
}

// ── トレース ──

export interface TraceHop {
  component: string;
  action: string;
  result: "pass" | "drop" | "forward" | "info";
}

export interface PacketTrace {
  packet: Packet;
  allowed: boolean;
  hops: TraceHop[];
}

// ── CIDR ──

function ipToNum(ip: string): number {
  const p = ip.split(".").map(Number);
  return ((p[0]! << 24) | (p[1]! << 16) | (p[2]! << 8) | p[3]!) >>> 0;
}

export function cidrContains(cidr: string, ip: string): boolean {
  if (cidr === "0.0.0.0/0") return true;
  const [base, prefixStr] = cidr.split("/");
  if (!base) return false;
  const prefix = Number(prefixStr ?? 32);
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return (ipToNum(ip) & mask) === (ipToNum(base) & mask);
}

function longestPrefixMatch(routes: Route[], dstIp: string): Route | undefined {
  let best: Route | undefined;
  let bestPrefix = -1;
  for (const r of routes) {
    const [, prefixStr] = r.destination.split("/");
    const prefix = Number(prefixStr ?? 0);
    if (cidrContains(r.destination, dstIp) && prefix > bestPrefix) {
      best = r;
      bestPrefix = prefix;
    }
  }
  return best;
}

// ── VPC エンジン ──

export class AwsVpc {
  vpcs: Vpc[] = [];
  subnets: Subnet[] = [];
  igws: InternetGateway[] = [];
  natGws: NatGateway[] = [];
  routeTables: RouteTable[] = [];
  nacls: Nacl[] = [];
  securityGroups: SecurityGroup[] = [];
  enis: Eni[] = [];

  /** パケットのルーティングとフィルタリングをトレースする */
  tracePacket(packet: Packet): PacketTrace {
    const hops: TraceHop[] = [];
    const { srcIp, dstIp } = packet;

    // 1. 送信元 ENI を特定
    const srcEni = this.enis.find((e) => e.privateIp === srcIp || e.publicIp === srcIp);
    if (!srcEni) {
      // 外部からの着信
      return this.traceInbound(packet, hops);
    }

    const srcSubnet = this.subnets.find((s) => s.id === srcEni.subnetId)!;
    hops.push({ component: `ENI (${srcEni.instanceName})`, action: `送信: ${srcIp}:${packet.srcPort} → ${dstIp}:${packet.dstPort}`, result: "info" });

    // 2. 送信元 SG アウトバウンドチェック
    if (!this.checkSg(srcEni.sgIds, packet, "outbound", hops)) {
      return { packet, allowed: false, hops };
    }

    // 3. 送信元サブネットの NACL アウトバウンド
    if (!this.checkNacl(srcSubnet.naclId, packet, "outbound", hops)) {
      return { packet, allowed: false, hops };
    }

    // 4. ルートテーブル
    const rt = this.routeTables.find((r) => r.id === srcSubnet.routeTableId)!;
    const route = longestPrefixMatch(rt.routes, dstIp);
    if (!route) {
      hops.push({ component: `RT (${rt.name})`, action: `${dstIp} に一致するルートなし`, result: "drop" });
      return { packet, allowed: false, hops };
    }
    hops.push({ component: `RT (${rt.name})`, action: `${route.destination} → ${route.target} (${route.targetType})`, result: "forward" });

    // 5. ターゲット別処理
    if (route.targetType === "local") {
      return this.deliverLocal(packet, dstIp, hops);
    }
    if (route.targetType === "igw") {
      return this.deliverViaIgw(packet, route.target, hops);
    }
    if (route.targetType === "nat") {
      return this.deliverViaNat(packet, route.target, hops);
    }
    if (route.targetType === "blackhole") {
      hops.push({ component: "Blackhole", action: "パケット破棄", result: "drop" });
      return { packet, allowed: false, hops };
    }

    hops.push({ component: route.target, action: "未対応のターゲットタイプ", result: "drop" });
    return { packet, allowed: false, hops };
  }

  /** VPC 内のローカル配送 */
  private deliverLocal(packet: Packet, dstIp: string, hops: TraceHop[]): PacketTrace {
    const dstEni = this.enis.find((e) => e.privateIp === dstIp);
    if (!dstEni) {
      hops.push({ component: "VPC", action: `${dstIp} に対応する ENI なし`, result: "drop" });
      return { packet, allowed: false, hops };
    }

    const dstSubnet = this.subnets.find((s) => s.id === dstEni.subnetId)!;

    // 宛先サブネット NACL インバウンド
    if (!this.checkNacl(dstSubnet.naclId, packet, "inbound", hops)) {
      return { packet, allowed: false, hops };
    }

    // 宛先 SG インバウンド
    if (!this.checkSg(dstEni.sgIds, packet, "inbound", hops)) {
      return { packet, allowed: false, hops };
    }

    hops.push({ component: `ENI (${dstEni.instanceName})`, action: `配送完了: ${dstIp}`, result: "pass" });
    return { packet, allowed: true, hops };
  }

  /** IGW 経由 (インターネットへ) */
  private deliverViaIgw(packet: Packet, igwId: string, hops: TraceHop[]): PacketTrace {
    const igw = this.igws.find((g) => g.id === igwId);
    if (!igw) {
      hops.push({ component: "IGW", action: `${igwId} が見つからない`, result: "drop" });
      return { packet, allowed: false, hops };
    }
    const srcEni = this.enis.find((e) => e.privateIp === packet.srcIp);
    const natIp = srcEni?.publicIp ?? packet.srcIp;
    hops.push({ component: `IGW (${igwId})`, action: `NAT: ${packet.srcIp} → ${natIp} (パブリック IP)`, result: "forward" });
    hops.push({ component: "Internet", action: `${natIp} → ${packet.dstIp} (インターネット到達)`, result: "pass" });
    return { packet, allowed: true, hops };
  }

  /** NAT Gateway 経由 */
  private deliverViaNat(packet: Packet, natId: string, hops: TraceHop[]): PacketTrace {
    const nat = this.natGws.find((n) => n.id === natId);
    if (!nat) {
      hops.push({ component: "NAT GW", action: `${natId} が見つからない`, result: "drop" });
      return { packet, allowed: false, hops };
    }
    hops.push({ component: `NAT GW (${natId})`, action: `SNAT: ${packet.srcIp} → ${nat.publicIp}`, result: "forward" });
    hops.push({ component: "Internet", action: `${nat.publicIp} → ${packet.dstIp} (NAT 経由)`, result: "pass" });
    return { packet, allowed: true, hops };
  }

  /** 外部からのインバウンドトラフィック */
  private traceInbound(packet: Packet, hops: TraceHop[]): PacketTrace {
    hops.push({ component: "Internet", action: `外部 ${packet.srcIp} からの着信`, result: "info" });

    // パブリック IP を持つ ENI を探す
    const dstEni = this.enis.find((e) => e.publicIp === packet.dstIp || e.privateIp === packet.dstIp);
    if (!dstEni) {
      hops.push({ component: "VPC", action: `${packet.dstIp} に対応する ENI なし`, result: "drop" });
      return { packet, allowed: false, hops };
    }

    const igw = this.igws[0];
    if (igw) {
      hops.push({ component: `IGW (${igw.id})`, action: `DNAT: ${packet.dstIp} → ${dstEni.privateIp}`, result: "forward" });
    }

    const dstSubnet = this.subnets.find((s) => s.id === dstEni.subnetId)!;

    if (!this.checkNacl(dstSubnet.naclId, packet, "inbound", hops)) {
      return { packet, allowed: false, hops };
    }

    if (!this.checkSg(dstEni.sgIds, packet, "inbound", hops)) {
      return { packet, allowed: false, hops };
    }

    hops.push({ component: `ENI (${dstEni.instanceName})`, action: `配送完了: ${dstEni.privateIp}`, result: "pass" });
    return { packet, allowed: true, hops };
  }

  /** NACL チェック */
  private checkNacl(naclId: string, packet: Packet, direction: "inbound" | "outbound", hops: TraceHop[]): boolean {
    const nacl = this.nacls.find((n) => n.id === naclId);
    if (!nacl) return true;

    const rules = direction === "inbound" ? nacl.inbound : nacl.outbound;
    const sorted = [...rules].sort((a, b) => a.ruleNumber - b.ruleNumber);
    const srcIp = direction === "inbound" ? packet.srcIp : packet.dstIp;

    for (const rule of sorted) {
      if (!cidrContains(rule.cidr, srcIp)) continue;
      if (rule.protocol !== "all" && rule.protocol !== packet.protocol) continue;
      if (rule.protocol !== "icmp" && (packet.dstPort < rule.portFrom || packet.dstPort > rule.portTo)) continue;

      const allowed = rule.action === "allow";
      hops.push({
        component: `NACL (${nacl.name}) ${direction}`,
        action: `ルール #${rule.ruleNumber}: ${rule.action.toUpperCase()} ${rule.protocol} ${rule.portFrom}-${rule.portTo} ${rule.cidr}`,
        result: allowed ? "pass" : "drop",
      });
      return allowed;
    }

    hops.push({ component: `NACL (${nacl.name}) ${direction}`, action: "デフォルト: DENY ALL", result: "drop" });
    return false;
  }

  /** SG チェック（OR 評価） */
  private checkSg(sgIds: string[], packet: Packet, direction: "inbound" | "outbound", hops: TraceHop[]): boolean {
    for (const sgId of sgIds) {
      const sg = this.securityGroups.find((s) => s.id === sgId);
      if (!sg) continue;

      const rules = direction === "inbound" ? sg.inbound : sg.outbound;
      const srcIp = direction === "inbound" ? packet.srcIp : packet.dstIp;

      for (const rule of rules) {
        if (rule.protocol !== "all" && rule.protocol !== packet.protocol) continue;
        if (rule.protocol !== "icmp" && (packet.dstPort < rule.portFrom || packet.dstPort > rule.portTo)) continue;
        if (!cidrContains(rule.source, srcIp)) continue;

        hops.push({
          component: `SG (${sg.name}) ${direction}`,
          action: `\u2714 ${rule.protocol} ${rule.portFrom}-${rule.portTo} from ${rule.source}`,
          result: "pass",
        });
        return true;
      }
    }

    const sgNames = sgIds.map((id) => this.securityGroups.find((s) => s.id === id)?.name ?? id).join(", ");
    hops.push({ component: `SG (${sgNames}) ${direction}`, action: "一致ルールなし → 暗黙拒否", result: "drop" });
    return false;
  }
}
