import type {
  Vpc, PacketDef, SimEvent, SimulationResult,
  NatMapping, NatGateway, Protocol,
} from "./types.js";

// ── IP / CIDR ユーティリティ ──

/** IPアドレスを32bit整数に変換 */
export function ipToInt(ip: string): number {
  const parts = ip.split(".");
  return ((parseInt(parts[0]!, 10) << 24)
    | (parseInt(parts[1]!, 10) << 16)
    | (parseInt(parts[2]!, 10) << 8)
    | parseInt(parts[3]!, 10)) >>> 0;
}

/** CIDRをパースしてネットワークアドレスとマスクを返す */
export function parseCidr(cidr: string): { network: number; mask: number; prefixLen: number } {
  const [ip, prefix] = cidr.split("/");
  const prefixLen = parseInt(prefix!, 10);
  const mask = prefixLen === 0 ? 0 : (0xFFFFFFFF << (32 - prefixLen)) >>> 0;
  return { network: ipToInt(ip!) & mask, mask, prefixLen };
}

/** 指定IPがCIDRに含まれるか */
export function isInCidr(ip: string, cidr: string): boolean {
  const { network, mask } = parseCidr(cidr);
  return (ipToInt(ip) & mask) === network;
}

// ── NAT ポートアロケータ ──

/** エフェメラルポート範囲（1024〜65535） */
const PORT_MIN = 1024;
const PORT_MAX = 65535;

/** プロトコルごとのアイドルタイムアウト（秒） */
export function getIdleTimeout(proto: Protocol): number {
  switch (proto) {
    case "tcp": return 350;
    case "udp": return 120;
    case "icmp": return 60;
  }
}

// ── シミュレーションエンジン ──

export function runSimulation(vpc: Vpc, packets: PacketDef[]): SimulationResult {
  const events: SimEvent[] = [];
  const natMappings: NatMapping[] = [];
  let step = 0;
  let delivered = false;
  /** 次に割り当てるエフェメラルポート（NAT GW毎） */
  const nextPortMap = new Map<string, number>();

  function emit(type: SimEvent["type"], resource: string, description: string, mapping?: NatMapping): void {
    events.push({ step, type, resource, description, mapping });
  }

  /** ルートテーブルから最長一致ルートを検索 */
  function lookupRoute(routeTableId: string, dstIp: string) {
    const rt = vpc.routeTables.find((r) => r.id === routeTableId);
    if (!rt) return undefined;
    let bestRoute: (typeof rt.routes)[number] | undefined;
    let bestPrefix = -1;
    for (const route of rt.routes) {
      const { prefixLen } = parseCidr(route.destination);
      if (isInCidr(dstIp, route.destination) && prefixLen > bestPrefix) {
        bestRoute = route;
        bestPrefix = prefixLen;
      }
    }
    return bestRoute;
  }

  /** NAT Gatewayでエフェメラルポートを割り当て */
  function allocatePort(natGw: NatGateway): number | null {
    const current = nextPortMap.get(natGw.id) ?? PORT_MIN;
    if (current > PORT_MAX) return null;
    nextPortMap.set(natGw.id, current + 1);
    return current;
  }

  /** 同一NAT GWの現在のアクティブ接続数 */
  function activeConnections(natGwId: string): number {
    return natMappings.filter((m) => m.externalIp ===
      vpc.natGateways.find((n) => n.id === natGwId)?.eip.publicIp).length;
  }

  /** 既存マッピングから逆引き（レスポンス用） */
  function findReverseMapping(externalPort: number, srcIp: string, srcPort: number, proto: Protocol): NatMapping | undefined {
    return natMappings.find(
      (m) => m.externalPort === externalPort
        && m.destinationIp === srcIp
        && m.destinationPort === srcPort
        && m.protocol === proto
    );
  }

  for (const pkt of packets) {
    step++;

    if (pkt.isResponse && pkt.responseFromIp) {
      // レスポンスパケット（外部→NAT GW→内部）
      emit("response_arrive", "Internet", `応答パケット: ${pkt.responseFromIp}:${pkt.srcPort} → ${pkt.dstIp}:${pkt.dstPort}`);

      // NAT GW を特定
      const natGw = vpc.natGateways.find((n) => n.eip.publicIp === pkt.dstIp);
      if (!natGw) {
        emit("drop", "Internet", `宛先 ${pkt.dstIp} に対応するNAT Gatewayが見つからない`);
        continue;
      }

      if (natGw.state !== "available") {
        emit("nat_gw_state_error", natGw.name, `NAT Gatewayの状態が "${natGw.state}" — パケット破棄`);
        continue;
      }

      emit("nat_gw_receive", natGw.name, `NAT GWがレスポンスを受信: ${pkt.responseFromIp}:${pkt.srcPort} → ${pkt.dstIp}:${pkt.dstPort}`);

      // 逆引きマッピング検索
      const mapping = findReverseMapping(pkt.dstPort, pkt.responseFromIp, pkt.srcPort, pkt.protocol);
      if (!mapping) {
        emit("drop", natGw.name, `NAT変換テーブルに一致するマッピングがない — パケット破棄`);
        continue;
      }

      // DNAT: 宛先を内部IPに変換
      emit("nat_gw_dnat", natGw.name,
        `DNAT: dst ${pkt.dstIp}:${pkt.dstPort} → ${mapping.internalIp}:${mapping.internalPort}`, mapping);

      // 内部インスタンスへ配送
      const inst = vpc.instances.find((i) => i.privateIp === mapping.internalIp);
      if (inst) {
        emit("deliver", inst.name, `レスポンスパケットを ${inst.name} (${inst.privateIp}) へ配送`);
        delivered = true;
      } else {
        emit("drop", "VPC", `内部IP ${mapping.internalIp} のインスタンスが見つからない`);
      }
      continue;
    }

    // アウトバウンドパケット処理
    const srcInst = vpc.instances.find((i) => i.id === pkt.srcInstanceId);
    if (!srcInst) {
      emit("drop", "VPC", `インスタンス ${pkt.srcInstanceId} が見つからない`);
      continue;
    }

    emit("packet_create", srcInst.name,
      `${srcInst.privateIp}:${pkt.srcPort} → ${pkt.dstIp}:${pkt.dstPort} (${pkt.protocol})`);

    // サブネットのルートテーブルを検索
    const subnet = vpc.subnets.find((s) => s.id === srcInst.subnetId);
    if (!subnet) {
      emit("drop", "VPC", `サブネット ${srcInst.subnetId} が見つからない`);
      continue;
    }

    emit("route_lookup", subnet.name, `ルートテーブル ${subnet.routeTableId} を検索: dst=${pkt.dstIp}`);
    const route = lookupRoute(subnet.routeTableId, pkt.dstIp);

    if (!route) {
      emit("route_no_match", subnet.name, `宛先 ${pkt.dstIp} に一致するルートがない — パケット破棄`);
      continue;
    }

    emit("route_match", subnet.name,
      `ルート一致: ${route.destination} → ${route.target} (${route.targetType})`);

    // ルート種別で分岐
    if (route.targetType === "local") {
      // VPC内通信
      const dstInst = vpc.instances.find((i) => i.privateIp === pkt.dstIp);
      if (dstInst) {
        emit("local_route", "VPC", `ローカルルート: ${srcInst.privateIp} → ${dstInst.privateIp} (VPC内通信)`);
        emit("deliver", dstInst.name, `パケットを ${dstInst.name} (${dstInst.privateIp}) へ配送`);
        delivered = true;
      } else {
        emit("drop", "VPC", `宛先 ${pkt.dstIp} のインスタンスが見つからない`);
      }
      continue;
    }

    if (route.targetType === "blackhole") {
      emit("drop", "VPC", `ブラックホールルートに一致 — パケット破棄`);
      continue;
    }

    if (route.targetType === "igw") {
      // パブリックサブネットからIGW経由で直接送信
      if (srcInst.publicIp) {
        emit("igw_forward", vpc.igw.name,
          `IGW経由: ${srcInst.privateIp} → ${srcInst.publicIp} (1:1 NAT) → ${pkt.dstIp}`);
        emit("deliver", "Internet", `パケットをインターネットへ送出: ${srcInst.publicIp}:${pkt.srcPort} → ${pkt.dstIp}:${pkt.dstPort}`);
        delivered = true;
      } else {
        emit("drop", vpc.igw.name, `パブリックIPがないインスタンスはIGW経由で送信不可`);
      }
      continue;
    }

    if (route.targetType === "nat") {
      // NAT Gateway経由
      const natGw = vpc.natGateways.find((n) => n.id === route.target);
      if (!natGw) {
        emit("drop", "VPC", `NAT Gateway ${route.target} が見つからない`);
        continue;
      }

      // 状態チェック
      if (natGw.state !== "available") {
        emit("nat_gw_state_error", natGw.name, `NAT Gatewayの状態が "${natGw.state}" — パケット破棄`);
        continue;
      }

      emit("nat_gw_receive", natGw.name,
        `NAT GWがパケット受信: ${srcInst.privateIp}:${pkt.srcPort} → ${pkt.dstIp}:${pkt.dstPort}`);

      // 同時接続数チェック
      const connCount = activeConnections(natGw.id);
      if (connCount >= natGw.maxConnections) {
        emit("nat_gw_conn_limit", natGw.name,
          `同時接続数上限 (${natGw.maxConnections}) に達した — パケット破棄 (ErrorPortAllocation)`);
        continue;
      }

      // ポート割り当て
      const extPort = allocatePort(natGw);
      if (extPort === null) {
        emit("nat_gw_port_exhaust", natGw.name,
          `エフェメラルポート枯渇 (${PORT_MIN}〜${PORT_MAX}) — パケット破棄`);
        continue;
      }

      emit("nat_gw_port_alloc", natGw.name,
        `エフェメラルポート割り当て: ${extPort} (使用中: ${connCount + 1}/${natGw.maxConnections})`);

      // NATマッピング作成
      const mapping: NatMapping = {
        internalIp: srcInst.privateIp,
        internalPort: pkt.srcPort,
        externalIp: natGw.eip.publicIp,
        externalPort: extPort,
        destinationIp: pkt.dstIp,
        destinationPort: pkt.dstPort,
        protocol: pkt.protocol,
        createdAt: step,
        idleTimeoutSec: getIdleTimeout(pkt.protocol),
      };
      natMappings.push(mapping);

      // SNAT実行
      emit("nat_gw_snat", natGw.name,
        `SNAT: src ${srcInst.privateIp}:${pkt.srcPort} → ${natGw.eip.publicIp}:${extPort}`, mapping);

      // NAT GWはパブリックサブネットにあるため、IGW経由でインターネットへ
      const natSubnet = vpc.subnets.find((s) => s.id === natGw.subnetId);
      if (natSubnet) {
        const natRoute = lookupRoute(natSubnet.routeTableId, pkt.dstIp);
        if (natRoute && natRoute.targetType === "igw") {
          emit("nat_gw_forward", natGw.name,
            `NAT GW → IGW経由でインターネットへ転送`);
          emit("igw_forward", vpc.igw.name,
            `IGW通過: ${natGw.eip.publicIp}:${extPort} → ${pkt.dstIp}:${pkt.dstPort}`);
          emit("deliver", "Internet",
            `パケットをインターネットへ送出: ${natGw.eip.publicIp}:${extPort} → ${pkt.dstIp}:${pkt.dstPort}`);
          delivered = true;
        } else {
          emit("drop", natGw.name, `NAT GWのサブネットにインターネットへのルートがない`);
        }
      } else {
        emit("drop", natGw.name, `NAT GWのサブネット ${natGw.subnetId} が見つからない`);
      }
      continue;
    }
  }

  return {
    delivered,
    events,
    natMappings,
    portUsage: {
      allocated: natMappings.length,
      max: vpc.natGateways.reduce((sum, n) => sum + n.maxConnections, 0),
    },
  };
}
