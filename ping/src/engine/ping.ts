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

/** IPv4 アドレスを表す文字列型 */
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

/**
 * ジッター付き遅延を計算する
 *
 * 基本遅延にランダムな変動を加え、実際のネットワーク遅延を模倣する。
 * 変動幅は base * jitter で決まり、-1.0〜+1.0 の範囲でランダムに分布する。
 *
 * @param base - 基本遅延 (ms)
 * @param jitter - ジッター係数 (0.0〜1.0)
 * @returns ジッター適用後の遅延 (ms)。0 未満にはならない。
 */
export function jitteredDelay(base: number, jitter: number): number {
  const variation = base * jitter * (Math.random() * 2 - 1);
  return Math.max(0, base + variation);
}

/**
 * ICMP チェックサムを簡易計算する (教育用)
 *
 * 実際の ICMP チェックサム計算を簡略化したもの。
 * パケットの主要フィールドを合算し、1 の補数を返す。
 *
 * @param packet - チェックサム計算対象の ICMP パケット
 * @returns 16 ビットのチェックサム値
 */
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

/**
 * ping 応答結果から統計情報を計算する
 *
 * 成功した応答の RTT から最小・最大・平均・標準偏差を算出し、
 * パケットロス率とともに PingStats オブジェクトとして返す。
 *
 * @param replies - ping 応答結果の配列
 * @param transmitted - 送信したパケット総数
 * @returns 集計された統計情報
 */
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

/**
 * トポロジーから送信元→宛先の最短経路 (ノード名リスト) を BFS で探索する
 *
 * リンクの重み (遅延) は考慮せず、ホップ数が最小の経路を返す。
 * 到達不能な場合は undefined を返す。
 *
 * @param topo - ネットワークトポロジー
 * @param srcName - 送信元ノード名
 * @param dstName - 宛先ノード名
 * @returns ノード名の配列 (送信元→宛先)、または到達不能時は undefined
 */
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

/**
 * ノード名から IP アドレスを取得する
 *
 * ホストの場合はインターフェースの IP、ルーターの場合は最初のインターフェースの IP を返す。
 * 見つからない場合は "0.0.0.0" を返す。
 *
 * @param topo - ネットワークトポロジー
 * @param name - ノード名
 * @returns ノードの IP アドレス
 */
export function nodeIp(topo: Topology, name: string): IPv4 {
  const host = topo.hosts.find((h) => h.name === name);
  if (host) return host.iface.ip;
  const router = topo.routers.find((r) => r.name === name);
  if (router) return router.interfaces[0]?.ip ?? "0.0.0.0";
  return "0.0.0.0";
}

/**
 * 2 ノード間のリンクを取得する
 *
 * リンクは双方向として扱い、from/to の順序を問わず検索する。
 *
 * @param topo - ネットワークトポロジー
 * @param a - ノード名 A
 * @param b - ノード名 B
 * @returns リンク情報。存在しない場合は undefined
 */
export function getLink(topo: Topology, a: string, b: string): Link | undefined {
  return topo.links.find((l) => (l.from === a && l.to === b) || (l.from === b && l.to === a));
}

/**
 * ノードの MTU (最大転送単位) を取得する
 *
 * ホストの場合はインターフェースの MTU、ルーターの場合は
 * 全インターフェースの最小 MTU を返す。見つからない場合はデフォルト 1500。
 *
 * @param topo - ネットワークトポロジー
 * @param name - ノード名
 * @returns MTU 値 (bytes)
 */
export function nodeMtu(topo: Topology, name: string): number {
  const host = topo.hosts.find((h) => h.name === name);
  if (host) return host.iface.mtu;
  const router = topo.routers.find((r) => r.name === name);
  if (router) return Math.min(...router.interfaces.map((i) => i.mtu));
  return 1500;
}

// ── Ping シミュレーター ──

/**
 * ICMP Ping シミュレーター
 *
 * 仮想ネットワークトポロジー上で ping と traceroute を実行する。
 * パケットの送信・転送・ロス・TTL 減算・MTU チェック・応答を
 * ステップごとにシミュレーションし、イベントログと統計を生成する。
 */
export class PingSimulator {
  /** シミュレーション対象のネットワークトポロジー */
  private topo: Topology;

  /**
   * PingSimulator のインスタンスを生成する
   * @param topo - シミュレーション対象のネットワークトポロジー
   */
  constructor(topo: Topology) {
    this.topo = topo;
  }

  /**
   * ping を実行する
   *
   * 指定された設定に基づき、送信元から宛先へ ICMP Echo Request を送信し、
   * 応答結果・統計・イベントログを返す。経路が見つからない場合は全パケットが
   * Destination Unreachable となる。
   *
   * @param config - ping の設定 (送信元、宛先、回数、TTL など)
   * @returns ping の実行結果 (応答一覧、統計、イベント)
   */
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

  /**
   * traceroute を実行する
   *
   * TTL を 1 から順に増やしながらプローブを送信し、各ホップのルーター情報と
   * RTT を収集する。宛先に到達するか maxHops に達するまで繰り返す。
   *
   * @param config - traceroute の設定 (送信元、宛先、最大ホップ数など)
   * @returns traceroute の実行結果 (ホップ一覧、イベント、到達可否)
   */
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

  /**
   * 1 回の ICMP Echo Request を送信してレスポンスを得る
   *
   * 往路では各ホップでリンクロス・ルータードロップ・MTU チェック・TTL 減算を行い、
   * 宛先到達後は復路の遅延とロスも考慮して最終的な RTT を算出する。
   * Record Route オプションが有効な場合、経由した IP を記録する。
   *
   * @param config - ping の設定
   * @param route - 送信元から宛先までのノード名リスト
   * @param seq - シーケンス番号
   * @param startTime - 送信開始時刻 (ms)
   * @param events - イベントログの追記先
   * @returns 1 回分の ping 応答結果
   */
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

  /**
   * traceroute 用のプローブを 1 回送信する
   *
   * 指定された TTL でパケットを送信し、TTL=0 となるノードまたは
   * 宛先ノードからの応答を取得する。復路の遅延は往路と同程度として簡略化。
   *
   * @param _config - traceroute の設定 (現在は直接参照しないが将来拡張用)
   * @param route - 送信元から宛先までのノード名リスト
   * @param ttl - プローブの TTL 値
   * @param startTime - 送信開始時刻 (ms)
   * @param events - イベントログの追記先
   * @returns 応答元の IP・ノード名・RTT (応答なしの場合は空文字列と rtt=-1)
   */
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

/**
 * エンドホストノードを簡易作成するヘルパー関数
 *
 * MAC アドレスは IP アドレスから自動生成される。
 *
 * @param name - ホスト名
 * @param ip - ホストの IP アドレス
 * @param opts - オプション設定 (応答可否、応答遅延、初期 TTL、MTU)
 * @returns HostNode オブジェクト
 */
export function host(name: string, ip: IPv4, opts?: { reply?: boolean; delay?: number; ttl?: number; mtu?: number }): HostNode {
  return {
    name, iface: { ip, mac: `02:00:${ip.split(".").map((o) => parseInt(o).toString(16).padStart(2, "0")).join(":")}`, mtu: opts?.mtu ?? 1500 },
    replyEnabled: opts?.reply ?? true, replyDelay: opts?.delay ?? 0.5, initialTtl: opts?.ttl ?? 64,
  };
}

/**
 * ルーターノードを簡易作成するヘルパー関数
 *
 * 複数の IP アドレスを持つインターフェースを生成する。
 * MAC アドレスは各 IP から自動生成される。
 *
 * @param name - ルーター名
 * @param ips - 各インターフェースの IP アドレス
 * @param opts - オプション設定 (転送遅延、ジッター、ドロップ率、ICMP 可否、MTU)
 * @returns RouterNode オブジェクト
 */
export function router(name: string, ips: IPv4[], opts?: { delay?: number; jitter?: number; drop?: number; icmp?: boolean; mtu?: number }): RouterNode {
  return {
    name,
    interfaces: ips.map((ip) => ({ ip, mac: `02:ff:${ip.split(".").map((o) => parseInt(o).toString(16).padStart(2, "0")).join(":")}`, mtu: opts?.mtu ?? 1500 })),
    forwardDelay: opts?.delay ?? 1, jitter: opts?.jitter ?? 0.1, dropRate: opts?.drop ?? 0,
    icmpEnabled: opts?.icmp ?? true, ttlDecrement: true,
  };
}

/**
 * ネットワークリンクを簡易作成するヘルパー関数
 *
 * @param from - 始点ノード名
 * @param to - 終点ノード名
 * @param latency - 片道遅延 (ms)
 * @param opts - オプション設定 (パケットロス率、混雑遅延)
 * @returns Link オブジェクト
 */
export function link(from: string, to: string, latency: number, opts?: { loss?: number; congestion?: number }): Link {
  return { from, to, latency, lossRate: opts?.loss ?? 0, congestionDelay: opts?.congestion ?? 0 };
}
