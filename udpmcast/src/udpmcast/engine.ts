import type {
  Host, Router, UdpDatagram, IgmpMessage,
  SimOp, SimEvent, SimulationResult, EventType, MulticastScope,
} from "./types.js";

/** マルチキャストアドレス判定 (224.0.0.0 ~ 239.255.255.255) */
export function isMulticastAddr(ip: string): boolean {
  const first = parseInt(ip.split(".")[0] ?? "0", 10);
  return first >= 224 && first <= 239;
}

/** マルチキャストIPからMACアドレスを算出 */
export function multicastIpToMac(ip: string): string {
  const parts = ip.split(".").map((p) => parseInt(p, 10));
  const b2 = (parts[1]! & 0x7f).toString(16).padStart(2, "0");
  const b3 = parts[2]!.toString(16).padStart(2, "0");
  const b4 = parts[3]!.toString(16).padStart(2, "0");
  return `01:00:5e:${b2}:${b3}:${b4}`;
}

/** マルチキャストスコープ判定 */
export function getMulticastScope(ip: string): MulticastScope {
  const parts = ip.split(".").map((p) => parseInt(p, 10));
  if (parts[0] === 224 && parts[1] === 0 && parts[2] === 0) return "link_local";
  if (parts[0] === 239) return "site_local";
  return "global";
}

/** TTLがスコープ範囲内か検証 */
export function ttlInScope(ttl: number, scope: MulticastScope): boolean {
  switch (scope) {
    case "link_local": return ttl >= 1;
    case "site_local": return ttl <= 32;
    case "global": return ttl > 0;
  }
}

export function runSimulation(ops: SimOp[]): SimulationResult {
  const hosts: Host[] = [];
  const routers: Router[] = [];
  const events: SimEvent[] = [];
  const datagrams: UdpDatagram[] = [];
  /** グループ → メンバーIP一覧 */
  const groupTable: Record<string, string[]> = {};
  let step = 0;

  const stats = {
    totalDatagrams: 0, multicastDatagrams: 0, unicastDatagrams: 0,
    deliveredCount: 0, droppedCount: 0, igmpMessages: 0, ttlExpired: 0,
  };

  function emit(type: EventType, desc: string, from?: string, to?: string,
    datagram?: UdpDatagram, igmp?: IgmpMessage): void {
    events.push({ step, type, description: desc, from, to, datagram, igmp });
  }

  function findHost(ip: string): Host | undefined {
    return hosts.find((h) => h.ip === ip);
  }

  function addToGroup(group: string, ip: string): void {
    if (!groupTable[group]) groupTable[group] = [];
    if (!groupTable[group]!.includes(ip)) groupTable[group]!.push(ip);
  }

  function removeFromGroup(group: string, ip: string): void {
    if (groupTable[group]) {
      groupTable[group] = groupTable[group]!.filter((m) => m !== ip);
      if (groupTable[group]!.length === 0) delete groupTable[group];
    }
  }

  for (const op of ops) {
    step++;

    switch (op.type) {
      case "add_host": {
        hosts.push({ ...op.host, joinedGroups: [...op.host.joinedGroups] });
        emit("host_add", `ホスト追加: ${op.host.name} (${op.host.ip}) iface=${op.host.iface}`);
        break;
      }

      case "add_router": {
        routers.push({
          ...op.router,
          interfaces: op.router.interfaces.map((i) => ({ ...i, groups: i.groups.map((g) => ({ ...g, members: [...g.members] })) })),
        });
        emit("router_add", `ルーター追加: ${op.router.name} (${op.router.ip}) interfaces=${op.router.interfaces.map((i) => i.name).join(",")}`);
        break;
      }

      case "igmp_join": {
        const host = findHost(op.hostIp);
        if (!host) {
          emit("udp_drop", `ホスト ${op.hostIp} が見つからない`, op.hostIp);
          stats.droppedCount++;
          break;
        }

        // IGMPv2 Membership Report送信
        const igmpMsg: IgmpMessage = { type: "membership_report_v2", group: op.group, srcIp: op.hostIp };
        emit("igmp_join", `${host.name}: IGMP Join — グループ ${op.group} に参加要求`, op.hostIp, op.group, undefined, igmpMsg);
        stats.igmpMessages++;

        // グループメンバーシップ更新
        if (!host.joinedGroups.includes(op.group)) {
          host.joinedGroups.push(op.group);
        }
        addToGroup(op.group, op.hostIp);

        emit("igmp_report", `IGMP Membership Report: ${op.hostIp} → グループ ${op.group}`, op.hostIp, "224.0.0.22", undefined, igmpMsg);

        // ルーターのグループテーブルを更新
        for (const router of routers) {
          for (const iface of router.interfaces) {
            const existing = iface.groups.find((g) => g.group === op.group);
            if (existing) {
              if (!existing.members.includes(op.hostIp)) existing.members.push(op.hostIp);
              existing.timer = 260; // リセット
            } else {
              iface.groups.push({ group: op.group, members: [op.hostIp], timer: 260 });
            }
          }
        }

        const mac = multicastIpToMac(op.group);
        emit("group_membership_update", `グループ ${op.group} メンバー更新 — MAC: ${mac}、メンバー: [${groupTable[op.group]?.join(", ") ?? ""}]`);
        break;
      }

      case "igmp_leave": {
        const host = findHost(op.hostIp);
        if (!host) break;

        const igmpMsg: IgmpMessage = { type: "leave_group", group: op.group, srcIp: op.hostIp };
        emit("igmp_leave", `${host.name}: IGMP Leave — グループ ${op.group} から離脱`, op.hostIp, "224.0.0.2", undefined, igmpMsg);
        stats.igmpMessages++;

        host.joinedGroups = host.joinedGroups.filter((g) => g !== op.group);
        removeFromGroup(op.group, op.hostIp);

        // ルーターのグループテーブルから削除
        for (const router of routers) {
          for (const iface of router.interfaces) {
            const existing = iface.groups.find((g) => g.group === op.group);
            if (existing) {
              existing.members = existing.members.filter((m) => m !== op.hostIp);
            }
          }
        }

        emit("group_membership_update", `グループ ${op.group} メンバー更新 — メンバー: [${groupTable[op.group]?.join(", ") ?? "なし"}]`);
        break;
      }

      case "igmp_query": {
        const router = routers.find((r) => r.ip === op.routerIp);
        if (!router) break;

        const targetGroup = op.group ?? "0.0.0.0";
        const isGeneral = !op.group;
        const igmpMsg: IgmpMessage = {
          type: "membership_query", group: targetGroup, srcIp: op.routerIp,
          maxResponseTime: 10,
        };

        if (isGeneral) {
          emit("igmp_query", `${router.name}: General Query — 全グループのメンバーシップ確認`, op.routerIp, "224.0.0.1", undefined, igmpMsg);
        } else {
          emit("igmp_query", `${router.name}: Group-Specific Query — グループ ${op.group} のメンバーシップ確認`, op.routerIp, op.group, undefined, igmpMsg);
        }
        stats.igmpMessages++;

        // メンバーが応答
        for (const host of hosts) {
          const respondGroups = isGeneral ? host.joinedGroups : host.joinedGroups.filter((g) => g === op.group);
          for (const group of respondGroups) {
            const reportMsg: IgmpMessage = { type: "membership_report_v2", group, srcIp: host.ip };
            emit("igmp_query_response", `${host.name}: Membership Report応答 — グループ ${group}`, host.ip, op.routerIp, undefined, reportMsg);
            stats.igmpMessages++;
          }
        }
        break;
      }

      case "send_multicast": {
        const scope = getMulticastScope(op.group);
        emit("scope_check", `マルチキャストスコープ: ${op.group} → ${scope} (TTL=${op.ttl})`);

        // スコープとTTLの検証
        if (scope === "link_local" && op.ttl > 1) {
          emit("udp_drop", `リンクローカル (224.0.0.x) にはTTL=1が必須、TTL=${op.ttl}で送信 → ルーターで転送されない`);
        }

        const mac = multicastIpToMac(op.group);
        emit("multicast_resolve", `マルチキャストIP→MAC解決: ${op.group} → ${mac}`);

        const datagram: UdpDatagram = {
          srcAddr: { ip: op.srcIp, port: op.srcPort },
          dstAddr: { ip: op.group, port: op.dstPort },
          ttl: op.ttl, payload: op.data, payloadSize: op.data.length,
          isMulticast: true,
        };
        datagrams.push(datagram);
        stats.totalDatagrams++;
        stats.multicastDatagrams++;

        emit("udp_send", `UDP マルチキャスト送信: ${op.srcIp}:${op.srcPort} → ${op.group}:${op.dstPort} (TTL=${op.ttl}, ${op.data.length}B)`,
          op.srcIp, op.group, datagram);

        // グループメンバーに配送
        const members = groupTable[op.group] ?? [];
        if (members.length === 0) {
          emit("udp_drop", `グループ ${op.group} にメンバーなし — データグラム破棄`);
          stats.droppedCount++;
        } else {
          for (const memberIp of members) {
            if (memberIp === op.srcIp) continue; // 自分には送らない（通常）
            const host = findHost(memberIp);
            if (host) {
              emit("udp_deliver", `${host.name} (${memberIp}): ポート ${op.dstPort} にデータ配送 — "${op.data.slice(0, 40)}"`,
                op.srcIp, memberIp, datagram);
              stats.deliveredCount++;
            }
          }
        }
        break;
      }

      case "send_unicast": {
        const datagram: UdpDatagram = {
          srcAddr: { ip: op.srcIp, port: op.srcPort },
          dstAddr: { ip: op.dstIp, port: op.dstPort },
          ttl: 64, payload: op.data, payloadSize: op.data.length,
          isMulticast: false,
        };
        datagrams.push(datagram);
        stats.totalDatagrams++;
        stats.unicastDatagrams++;

        emit("unicast_send", `UDP ユニキャスト送信: ${op.srcIp}:${op.srcPort} → ${op.dstIp}:${op.dstPort} (${op.data.length}B)`,
          op.srcIp, op.dstIp, datagram);

        const host = findHost(op.dstIp);
        if (host) {
          emit("unicast_deliver", `${host.name} (${op.dstIp}): ポート ${op.dstPort} にデータ配送`, op.srcIp, op.dstIp, datagram);
          stats.deliveredCount++;
        } else {
          emit("udp_drop", `宛先 ${op.dstIp} が見つからない — データグラム破棄`);
          stats.droppedCount++;
        }
        break;
      }

      case "ttl_expire": {
        const scope = getMulticastScope(op.group);
        emit("scope_check", `マルチキャストスコープ: ${op.group} → ${scope} (TTL=${op.ttl})`);

        const datagram: UdpDatagram = {
          srcAddr: { ip: op.srcIp, port: 5000 },
          dstAddr: { ip: op.group, port: 5000 },
          ttl: op.ttl, payload: "expired", payloadSize: 7,
          isMulticast: true,
        };
        datagrams.push(datagram);
        stats.totalDatagrams++;
        stats.multicastDatagrams++;

        emit("udp_send", `UDP マルチキャスト送信: ${op.srcIp} → ${op.group} (TTL=${op.ttl})`, op.srcIp, op.group, datagram);

        // TTLをデクリメントしながらホップ
        let currentTtl = op.ttl;
        let hopCount = 0;
        while (currentTtl > 0) {
          currentTtl--;
          hopCount++;
          emit("ttl_decrement", `ホップ ${hopCount}: TTL ${currentTtl + 1} → ${currentTtl}`);
          if (currentTtl === 0) {
            emit("ttl_expire", `TTL=0 — データグラム破棄 (${hopCount}ホップ到達)`, op.srcIp, op.group);
            stats.ttlExpired++;
            stats.droppedCount++;
            break;
          }
        }
        break;
      }

      case "igmp_v3_join": {
        const host = findHost(op.hostIp);
        if (!host) break;

        const igmpMsg: IgmpMessage = {
          type: "membership_report_v3", group: op.group, srcIp: op.hostIp,
          filterMode: op.filterMode, sourceList: op.sourceList,
        };

        const filterDesc = op.filterMode === "include"
          ? `INCLUDEフィルタ — ソース [${op.sourceList.join(", ")}] のみ受信`
          : `EXCLUDEフィルタ — ソース [${op.sourceList.join(", ")}] を除外`;

        emit("igmp_join", `${host.name}: IGMPv3 Join — グループ ${op.group}、${filterDesc}`, op.hostIp, op.group, undefined, igmpMsg);
        stats.igmpMessages++;

        if (!host.joinedGroups.includes(op.group)) {
          host.joinedGroups.push(op.group);
        }
        addToGroup(op.group, op.hostIp);

        emit("igmp_report", `IGMPv3 Membership Report: ${op.hostIp} → グループ ${op.group} (${op.filterMode}, sources=[${op.sourceList.join(",")}])`,
          op.hostIp, "224.0.0.22", undefined, igmpMsg);

        emit("group_membership_update", `グループ ${op.group} メンバー更新 — メンバー: [${groupTable[op.group]?.join(", ") ?? ""}]`);
        break;
      }

      case "multicast_forward": {
        const router = routers.find((r) => r.ip === op.routerIp);
        if (!router) break;

        emit("multicast_forward",
          `${router.name}: マルチキャスト転送 — グループ ${op.group}、入力=${op.inIface} → 出力=[${op.outIfaces.join(", ")}]`,
          op.routerIp, op.group);

        // 各出力インターフェースへ転送
        for (const outIface of op.outIfaces) {
          const iface = router.interfaces.find((i) => i.name === outIface);
          if (iface) {
            const members = iface.groups.find((g) => g.group === op.group)?.members ?? [];
            if (members.length > 0) {
              emit("udp_deliver", `${outIface}: グループ ${op.group} のメンバー [${members.join(", ")}] にフレーム転送`, op.routerIp, outIface);
              stats.deliveredCount += members.length;
            } else {
              emit("udp_drop", `${outIface}: グループ ${op.group} のメンバーなし — 転送不要`, op.routerIp, outIface);
            }
          }
        }
        break;
      }
    }
  }

  return { events, hosts, routers, datagrams, groupTable, stats };
}
