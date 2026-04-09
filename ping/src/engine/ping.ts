/**
 * ping.ts — ICMP Echo / Ping エミュレーションエンジン
 *
 * 仮想ネットワークトポロジー上で ICMP Echo Request/Reply を
 * シミュレーションし、RTT・TTL・パケットロス・ジッター・
 * 経路 (traceroute) を再現する。
 *
 * 機能:
 *   ping / ping -f (flood) / ping -R (record route) /
 *   traceroute / MTU discovery / パケットフラグメンテーション
 */

// ── 基本型 ──

export type IPv4 = string;

/** ICMP メッセージタイプ */
export type IcmpType =
  | "echo-request"        // Type 8
  | "echo-reply"          // Type 0
  | "time-exceeded"       // Type 11 (TTL=0)
  | "dest-unreachable"    // Type 3
  | "redirect"            // Type 5
  | "frag-needed";        // Type 3, Code 4

/** ネットワークインターフェース */
export interface NetworkInterface {
  ip: IPv4;
  mac: string;
  /** MTU (bytes) */
  mtu: number;
}

/** ルーターノード */
export interface RouterNode {
  name: string;
  interfaces: NetworkInterface[];
  /** 転送遅延 (ms) */
  forwardDelay: number;
  /** ジッター係数 (0.0〜1.0) — 遅延のランダム変動幅 */
  jitter: number;
  /** パケットドロップ率 (0.0〜1.0) */
  dropRate: number;
  /** ICMP Time Exceeded を返すか */
  icmpEnabled: boolean;
  /** このルーターで TTL=0 の場合の応答可否 */
  ttlDecrement: boolean;
}

/** エンドホスト */
export interface HostNode {
  name: string;
  iface: NetworkInterface;
  /** ICMP Echo Reply を返すか */
  replyEnabled: boolean;
  /** 応答遅延 (ms) */
  replyDelay: number;
  /** OS の初期 TTL */
  initialTtl: number;
}

/** ネットワークリンク (2 ノード間の接続) */
export interface Link {
  /** 始点ノード名 */
  from: string;
  /** 終点ノード名 */
  to: string;
  /** 片道遅延 (ms) */
  latency: number;
  /** パケットロス率 (0.0〜1.0) */
  lossRate: number;
  /** 帯域制限による追加遅延 (ms, 大パケット時) */
  congestionDelay: number;
}

/** ネットワークトポロジー */
export interface Topology {
  hosts: HostNode[];
  routers: RouterNode[];
  links: Link[];
}

/** ICMP パケット */
export interface IcmpPacket {
  type: IcmpType;
  code: number;
  /** 識別子 */
  id: number;
  /** シーケンス番号 */
  seq: number;
  /** TTL */
  ttl: number;
  /** ペイロードサイズ (bytes) */
  payloadSize: number;
  /** Don't Fragment フラグ */
  df: boolean;
  /** 送信元 IP */
  srcIp: IPv4;
  /** 宛先 IP */
  dstIp: IPv4;
  /** Record Route オプションの IP リスト */
  recordRoute?: IPv4[];
}

/** ping の設定 */
export interface PingConfig {
  /** 送信元ホスト名 */
  source: string;
  /** 宛先ホスト名 or IP */
  destination: string;
  /** 送信回数 */
  count: number;
  /** 送信間隔 (ms) */
  interval: number;
  /** 初期 TTL */
  ttl: number;
  /** ペイロードサイズ (bytes, デフォルト 56) */
  payloadSize: number;
  /** Don't Fragment */
  df: boolean;
  /** Record Route オプション */
  recordRoute: boolean;
  /** タイムアウト (ms) */
  timeout: number;
  /** Flood モード (間隔 0) */
  flood: boolean;
}

/** traceroute の設定 */
export interface TracerouteConfig {
  source: string;
  destination: string;
  /** 最大ホップ数 */
  maxHops: number;
  /** 各ホップで送るプローブ数 */
  probesPerHop: number;
  payloadSize: number;
  timeout: number;
}

/** 1 回の ping 結果 */
export interface PingReply {
  seq: number;
  /** 応答元 IP */
  fromIp: IPv4;
  /** 応答元ホスト名 */
  fromName: string;
  /** ラウンドトリップタイム (ms) */
  rtt: number;
  /** 応答時の TTL */
  ttl: number;
  /** 成功/失敗 */
  success: boolean;
  /** ICMP 応答タイプ */
  icmpType: IcmpType;
  /** エラー理由 (失敗時) */
  error?: string;
  /** パケットサイズ */
  bytes: number;
  /** Record Route で記録された IP */
  route?: IPv4[];
}

/** ping セッション全体の結果 */
export interface PingResult {
  replies: PingReply[];
  /** 統計 */
  stats: PingStats;
  events: PingEvent[];
}

/** ping 統計 */
export interface PingStats {
  transmitted: number;
  received: number;
  lossPercent: number;
  rttMin: number;
  rttMax: number;
  rttAvg: number;
  /** 標準偏差 */
  rttMdev: number;
}

/** traceroute のホップ結果 */
export interface TracerouteHop {
  hop: number;
  ip: IPv4;
  hostname: string;
  /** 各プローブの RTT (ms) — -1 = タイムアウト */
  rtts: number[];
}

/** traceroute 結果 */
export interface TracerouteResult {
  hops: TracerouteHop[];
  events: PingEvent[];
  reached: boolean;
}

/** シミュレーションイベント */
export interface PingEvent {
  time: number;
  type: "send" | "recv" | "forward" | "drop" | "ttl_expired" | "unreachable" | "frag_needed" | "info";
  detail: string;
  node?: string;
}

// ── ユーティリティ ──

/** ジッター付き遅延を計算する */
export function jitteredDelay(base: number, jitter: number): number {
  const variation = base * jitter * (Math.random() * 2 - 1);
  return Math.max(0, base + variation);
}

/** IP チェックサムを簡易計算する (教育用) */
export function icmpChecksum(packet: IcmpPacket): number {
  let sum = 0;
  sum += (packet.type === "echo-request" ? 8 : 0) << 8;
  sum += packet.code;
  sum += packet.id;
  sum += packet.seq;
  sum += packet.payloadSize;
  // 折り返し加算
  while (sum > 0xffff) sum = (sum & 0xffff) + (sum >> 16);
  return (~sum) & 0xffff;
}

/** 統計を計算する */
export function calculateStats(replies: PingReply[], transmitted: number): PingStats {
  const received = replies.filter((r) => r.success).length;
  const rtts = replies.filter((r) => r.success).map((r) => r.rtt);
  const rttMin = rtts.length > 0 ? Math.min(...rtts) : 0;
  const rttMax = rtts.length > 0 ? Math.max(...rtts) : 0;
  const rttAvg = rtts.length > 0 ? rtts.reduce((a, b) => a + b, 0) / rtts.length : 0;
  const variance = rtts.length > 0 ? rtts.reduce((a, r) => a + (r - rttAvg) ** 2, 0) / rtts.length : 0;
  return {
    transmitted,
    received,
    lossPercent: transmitted > 0 ? ((transmitted - received) / transmitted) * 100 : 0,
    rttMin, rttMax, rttAvg,
    rttMdev: Math.sqrt(variance),
  };
}

// ── 経路探索 ──

/** トポロジーから送信元→宛先の経路 (ノード名リスト) を見つける */
export function findRoute(topo: Topology, srcName: string, dstName: string): string[] | undefined {
  // BFS でノード名の経路を探索
  const allNodes = new Set<string>([
    ...topo.hosts.map((h) => h.name),
    ...topo.routers.map((r) => r.name),
  ]);
  if (!allNodes.has(srcName) || !allNodes.has(dstName)) return undefined;

  const adj = new Map<string, string[]>();
  for (const n of allNodes) adj.set(n, []);
  for (const link of topo.links) {
    adj.get(link.from)?.push(link.to);
    adj.get(link.to)?.push(link.from);
  }

  const visited = new Set<string>();
  const queue: string[][] = [[srcName]];
  visited.add(srcName);

  while (queue.length > 0) {
    const path = queue.shift()!;
    const current = path[path.length - 1]!;
    if (current === dstName) return path;
    for (const next of adj.get(current) ?? []) {
      if (!visited.has(next)) {
        visited.add(next);
        queue.push([...path, next]);
      }
    }
  }
  return undefined;
}

/** ノード名から IP を取得する */
export function nodeIp(topo: Topology, name: string): IPv4 {
  const host = topo.hosts.find((h) => h.name === name);
  if (host) return host.iface.ip;
  const router = topo.routers.find((r) => r.name === name);
  if (router) return router.interfaces[0]?.ip ?? "0.0.0.0";
  return "0.0.0.0";
}

/** 2 ノード間のリンクを取得する */
export function getLink(topo: Topology, a: string, b: string): Link | undefined {
  return topo.links.find((l) => (l.from === a && l.to === b) || (l.from === b && l.to === a));
}

/** ノードの MTU を取得する */
export function nodeMtu(topo: Topology, name: string): number {
  const host = topo.hosts.find((h) => h.name === name);
  if (host) return host.iface.mtu;
  const router = topo.routers.find((r) => r.name === name);
  if (router) return Math.min(...router.interfaces.map((i) => i.mtu));
  return 1500;
}

// ── Ping シミュレーター ──

export class PingSimulator {
  private topo: Topology;

  constructor(topo: Topology) {
    this.topo = topo;
  }

  /** ping を実行する */
  ping(config: PingConfig): PingResult {
    const events: PingEvent[] = [];
    const replies: PingReply[] = [];
    let time = 0;

    const route = findRoute(this.topo, config.source, config.destination);
    const dstIp = nodeIp(this.topo, config.destination);

    events.push({
      time, type: "info",
      detail: `PING ${config.destination} (${dstIp}) ${config.payloadSize}(${config.payloadSize + 28}) bytes of data.`,
    });

    if (!route) {
      events.push({ time, type: "unreachable", detail: `${config.destination}: ネットワーク到達不能 (経路なし)` });
      for (let seq = 1; seq <= config.count; seq++) {
        replies.push({
          seq, fromIp: "", fromName: "", rtt: 0, ttl: 0, success: false,
          icmpType: "dest-unreachable", error: "Network unreachable", bytes: config.payloadSize,
        });
      }
      return { replies, stats: calculateStats(replies, config.count), events };
    }

    for (let seq = 1; seq <= config.count; seq++) {
      const result = this.sendEcho(config, route, seq, time, events);
      replies.push(result);
      time = result.success ? time + result.rtt : time + config.timeout;
      if (!config.flood) time += config.interval;
    }

    const stats = calculateStats(replies, config.count);
    events.push({
      time, type: "info",
      detail: `--- ${config.destination} ping statistics ---\n${stats.transmitted} transmitted, ${stats.received} received, ${stats.lossPercent.toFixed(0)}% loss\nrtt min/avg/max/mdev = ${stats.rttMin.toFixed(3)}/${stats.rttAvg.toFixed(3)}/${stats.rttMax.toFixed(3)}/${stats.rttMdev.toFixed(3)} ms`,
    });

    return { replies, stats, events };
  }

  /** traceroute を実行する */
  traceroute(config: TracerouteConfig): TracerouteResult {
    const events: PingEvent[] = [];
    const hops: TracerouteHop[] = [];
    let reached = false;

    const route = findRoute(this.topo, config.source, config.destination);
    const dstIp = nodeIp(this.topo, config.destination);

    events.push({
      time: 0, type: "info",
      detail: `traceroute to ${config.destination} (${dstIp}), ${config.maxHops} hops max, ${config.payloadSize} byte packets`,
    });

    if (!route) {
      events.push({ time: 0, type: "unreachable", detail: "経路なし" });
      return { hops, events, reached: false };
    }

    let time = 0;

    for (let ttl = 1; ttl <= config.maxHops; ttl++) {
      const rtts: number[] = [];
      let hopIp = "";
      let hopName = "";

      for (let probe = 0; probe < config.probesPerHop; probe++) {
        const result = this.sendProbe(config, route, ttl, time, events);
        time += result.rtt > 0 ? result.rtt : config.timeout;

        if (result.respondIp) {
          hopIp = result.respondIp;
          hopName = result.respondName;
          rtts.push(result.rtt);
        } else {
          rtts.push(-1);
        }
      }

      if (hopIp) {
        hops.push({ hop: ttl, ip: hopIp, hostname: hopName, rtts });
      } else {
        hops.push({ hop: ttl, ip: "*", hostname: "*", rtts });
      }

      // 宛先に到達したか
      if (hopIp === dstIp) {
        reached = true;
        break;
      }
    }

    return { hops, events, reached };
  }

  /** 1 回の Echo Request を送信してレスポンスを得る */
  private sendEcho(
    config: PingConfig, route: string[], seq: number, startTime: number, events: PingEvent[],
  ): PingReply {
    const srcIp = nodeIp(this.topo, config.source);
    const dstIp = nodeIp(this.topo, config.destination);
    let ttl = config.ttl;
    let rtt = 0;
    const routeRecord: IPv4[] = config.recordRoute ? [srcIp] : [];

    events.push({
      time: startTime, type: "send", node: config.source,
      detail: `#${seq} Echo Request → ${dstIp} (TTL=${ttl}, size=${config.payloadSize}B${config.df ? ", DF" : ""})`,
    });

    // 往路: 各ホップを通過
    for (let i = 0; i < route.length - 1; i++) {
      const current = route[i]!;
      const next = route[i + 1]!;
      const link = getLink(this.topo, current, next);
      if (!link) {
        events.push({ time: startTime + rtt, type: "unreachable", detail: `#${seq} リンクなし: ${current} → ${next}` });
        return { seq, fromIp: "", fromName: "", rtt: 0, ttl: 0, success: false, icmpType: "dest-unreachable", error: "No route", bytes: config.payloadSize };
      }

      // パケットロス判定
      if (Math.random() < link.lossRate) {
        events.push({ time: startTime + rtt, type: "drop", node: current, detail: `#${seq} パケットロス: ${current} → ${next} のリンクで消失` });
        return { seq, fromIp: "", fromName: "", rtt: 0, ttl: 0, success: false, icmpType: "echo-request", error: "Packet lost", bytes: config.payloadSize };
      }

      // ルーターでの処理
      const router = this.topo.routers.find((r) => r.name === next);
      if (router) {
        // MTU チェック
        const mtu = nodeMtu(this.topo, next);
        if (config.df && config.payloadSize + 28 > mtu) {
          events.push({
            time: startTime + rtt, type: "frag_needed", node: next,
            detail: `#${seq} Frag needed: パケット ${config.payloadSize + 28}B > MTU ${mtu}B (DF set)`,
          });
          return {
            seq, fromIp: nodeIp(this.topo, next), fromName: next, rtt: rtt + link.latency,
            ttl: 0, success: false, icmpType: "frag-needed",
            error: `Frag needed (MTU=${mtu})`, bytes: config.payloadSize,
          };
        }

        // ルーターでのドロップ判定
        if (Math.random() < router.dropRate) {
          events.push({ time: startTime + rtt, type: "drop", node: next, detail: `#${seq} ルーター ${next} でドロップ (混雑)` });
          return { seq, fromIp: "", fromName: "", rtt: 0, ttl: 0, success: false, icmpType: "echo-request", error: "Router drop", bytes: config.payloadSize };
        }

        // TTL デクリメント
        if (router.ttlDecrement) ttl--;
        if (ttl <= 0) {
          const routerIp = nodeIp(this.topo, next);
          const hopDelay = link.latency + jitteredDelay(router.forwardDelay, router.jitter);
          rtt += hopDelay;
          if (router.icmpEnabled) {
            events.push({
              time: startTime + rtt, type: "ttl_expired", node: next,
              detail: `#${seq} TTL exceeded: ${next} (${routerIp}) が Time Exceeded を返す`,
            });
            return { seq, fromIp: routerIp, fromName: next, rtt: rtt * 2, ttl: 0, success: false, icmpType: "time-exceeded", error: "TTL exceeded", bytes: config.payloadSize };
          }
          events.push({ time: startTime + rtt, type: "ttl_expired", node: next, detail: `#${seq} TTL=0 at ${next} (ICMP 無効、応答なし)` });
          return { seq, fromIp: "", fromName: "", rtt: 0, ttl: 0, success: false, icmpType: "time-exceeded", error: "TTL exceeded (silent)", bytes: config.payloadSize };
        }

        const hopDelay = link.latency + jitteredDelay(router.forwardDelay, router.jitter);
        rtt += hopDelay;
        if (config.recordRoute) routeRecord.push(nodeIp(this.topo, next));
        events.push({
          time: startTime + rtt, type: "forward", node: next,
          detail: `#${seq} ${next} (${nodeIp(this.topo, next)}) 転送 TTL=${ttl} (+${hopDelay.toFixed(1)}ms)`,
        });
      } else {
        // ホスト間リンク
        rtt += link.latency;
      }
    }

    // 宛先ホスト
    const dstHost = this.topo.hosts.find((h) => h.name === config.destination);
    if (!dstHost) {
      events.push({ time: startTime + rtt, type: "unreachable", detail: `#${seq} 宛先ホスト不明` });
      return { seq, fromIp: "", fromName: "", rtt: 0, ttl: 0, success: false, icmpType: "dest-unreachable", error: "Host unknown", bytes: config.payloadSize };
    }

    if (!dstHost.replyEnabled) {
      events.push({ time: startTime + rtt, type: "drop", node: dstHost.name, detail: `#${seq} ${dstHost.name} は ICMP 応答無効` });
      return { seq, fromIp: dstIp, fromName: dstHost.name, rtt: 0, ttl: 0, success: false, icmpType: "echo-request", error: "ICMP disabled", bytes: config.payloadSize };
    }

    // 応答遅延
    rtt += dstHost.replyDelay;
    if (config.recordRoute) routeRecord.push(dstIp);

    events.push({
      time: startTime + rtt, type: "recv", node: dstHost.name,
      detail: `#${seq} ${dstHost.name} (${dstIp}) が Echo Reply を返す`,
    });

    // 復路: 同じ経路を逆順 (簡略化: 往路の遅延と同等)
    const returnRoute = [...route].reverse();
    for (let i = 0; i < returnRoute.length - 1; i++) {
      const current = returnRoute[i]!;
      const next = returnRoute[i + 1]!;
      const link = getLink(this.topo, current, next);
      if (!link) break;

      if (Math.random() < link.lossRate) {
        events.push({ time: startTime + rtt, type: "drop", detail: `#${seq} 復路パケットロス: ${current} → ${next}` });
        return { seq, fromIp: "", fromName: "", rtt: 0, ttl: 0, success: false, icmpType: "echo-reply", error: "Reply lost", bytes: config.payloadSize };
      }

      const router = this.topo.routers.find((r) => r.name === current);
      if (router) {
        rtt += jitteredDelay(link.latency + router.forwardDelay, router.jitter);
        if (config.recordRoute) routeRecord.push(nodeIp(this.topo, current));
      } else {
        rtt += link.latency;
      }
    }

    const totalRtt = Math.max(0, rtt);
    events.push({
      time: startTime + totalRtt, type: "recv", node: config.source,
      detail: `#${seq} ${config.payloadSize + 28} bytes from ${dstIp}: seq=${seq} ttl=${ttl} time=${totalRtt.toFixed(1)}ms`,
    });

    return {
      seq, fromIp: dstIp, fromName: dstHost.name, rtt: totalRtt,
      ttl, success: true, icmpType: "echo-reply", bytes: config.payloadSize + 28,
      route: config.recordRoute ? routeRecord : undefined,
    };
  }

  /** traceroute 用のプローブ送信 */
  private sendProbe(
    _config: TracerouteConfig, route: string[], ttl: number, startTime: number, events: PingEvent[],
  ): { respondIp: string; respondName: string; rtt: number } {
    let rtt = 0;

    for (let i = 0; i < route.length - 1 && i < ttl; i++) {
      const current = route[i]!;
      const next = route[i + 1]!;
      const link = getLink(this.topo, current, next);
      if (!link) return { respondIp: "", respondName: "", rtt: -1 };

      if (Math.random() < link.lossRate) return { respondIp: "", respondName: "", rtt: -1 };

      rtt += link.latency;
      const router = this.topo.routers.find((r) => r.name === next);
      if (router) {
        rtt += jitteredDelay(router.forwardDelay, router.jitter);
        if (i + 1 === ttl - 1 || i + 1 === route.length - 1) {
          // このホップで TTL=0 または宛先到達
        }
      }
    }

    // TTL で到達するノード
    const reachIndex = Math.min(ttl, route.length - 1);
    const reachNode = route[reachIndex]!;
    const reachIp = nodeIp(this.topo, reachNode);

    // ルーターの場合 ICMP 有効チェック
    const router = this.topo.routers.find((r) => r.name === reachNode);
    if (router && !router.icmpEnabled) {
      events.push({ time: startTime + rtt, type: "ttl_expired", detail: `hop ${ttl}: * (${reachNode} ICMP 無効)` });
      return { respondIp: "", respondName: "", rtt: -1 };
    }

    // 復路の遅延を加算 (簡略化: 往路と同程度)
    rtt *= 2;

    events.push({
      time: startTime + rtt, type: "recv",
      detail: `hop ${ttl}: ${reachNode} (${reachIp}) ${rtt.toFixed(1)}ms`,
    });

    return { respondIp: reachIp, respondName: reachNode, rtt };
  }
}

// ── プリセット用トポロジー構築 ──

/** 簡単なホストを作成する */
export function host(name: string, ip: IPv4, opts?: { reply?: boolean; delay?: number; ttl?: number; mtu?: number }): HostNode {
  return {
    name, iface: { ip, mac: `02:00:${ip.split(".").map((o) => parseInt(o).toString(16).padStart(2, "0")).join(":")}`, mtu: opts?.mtu ?? 1500 },
    replyEnabled: opts?.reply ?? true, replyDelay: opts?.delay ?? 0.5, initialTtl: opts?.ttl ?? 64,
  };
}

/** ルーターを作成する */
export function router(name: string, ips: IPv4[], opts?: { delay?: number; jitter?: number; drop?: number; icmp?: boolean; mtu?: number }): RouterNode {
  return {
    name,
    interfaces: ips.map((ip) => ({ ip, mac: `02:ff:${ip.split(".").map((o) => parseInt(o).toString(16).padStart(2, "0")).join(":")}`, mtu: opts?.mtu ?? 1500 })),
    forwardDelay: opts?.delay ?? 1, jitter: opts?.jitter ?? 0.1, dropRate: opts?.drop ?? 0,
    icmpEnabled: opts?.icmp ?? true, ttlDecrement: true,
  };
}

/** リンクを作成する */
export function link(from: string, to: string, latency: number, opts?: { loss?: number; congestion?: number }): Link {
  return { from, to, latency, lossRate: opts?.loss ?? 0, congestionDelay: opts?.congestion ?? 0 };
}
