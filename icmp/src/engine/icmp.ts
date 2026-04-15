/**
 * icmp.ts — ICMP プロトコルエミュレーションエンジン
 *
 * ICMP の全メッセージタイプ (Echo, Destination Unreachable,
 * Redirect, Time Exceeded, Parameter Problem, Timestamp 等) を
 * 仮想ネットワーク上でシミュレーションする。
 *
 * RFC 792 / RFC 1191 (Path MTU Discovery) / RFC 1122 に準拠した
 * パケット構造とルーターの ICMP 生成ロジックを再現する。
 */

// ── ICMP メッセージタイプ (RFC 792) ──

/** RFC 792 で定義された ICMP メッセージタイプの定数マッピング */
export const ICMP_TYPES = {
  ECHO_REPLY:          0,
  DEST_UNREACHABLE:    3,
  SOURCE_QUENCH:       4,
  REDIRECT:            5,
  ECHO_REQUEST:        8,
  TIME_EXCEEDED:       11,
  PARAMETER_PROBLEM:   12,
  TIMESTAMP_REQUEST:   13,
  TIMESTAMP_REPLY:     14,
  INFO_REQUEST:        15,
  INFO_REPLY:          16,
  ADDR_MASK_REQUEST:   17,
  ADDR_MASK_REPLY:     18,
} as const;

/** ICMP タイプコードのユニオン型 */
export type IcmpTypeCode = typeof ICMP_TYPES[keyof typeof ICMP_TYPES];

/** Destination Unreachable コード (Type 3) */
export const UNREACH_CODES = {
  NET_UNREACH:       0,
  HOST_UNREACH:      1,
  PROTO_UNREACH:     2,
  PORT_UNREACH:      3,
  FRAG_NEEDED:       4,
  SRC_ROUTE_FAILED:  5,
  NET_UNKNOWN:       6,
  HOST_UNKNOWN:      7,
  HOST_ISOLATED:     8,
  NET_PROHIBITED:    9,
  HOST_PROHIBITED:   10,
  NET_TOS_UNREACH:   11,
  HOST_TOS_UNREACH:  12,
  ADMIN_PROHIBITED:  13,
} as const;

/** Time Exceeded コード (Type 11) */
export const TIME_EXCEEDED_CODES = {
  TTL_EXCEEDED:       0,
  FRAG_REASSEMBLY:    1,
} as const;

/** Redirect コード (Type 5) */
export const REDIRECT_CODES = {
  NET_REDIRECT:       0,
  HOST_REDIRECT:      1,
  TOS_NET_REDIRECT:   2,
  TOS_HOST_REDIRECT:  3,
} as const;

/**
 * ICMP タイプ番号を人間が読める名前に変換する
 * @param type - ICMP メッセージタイプ番号
 * @returns タイプ名の文字列。未知のタイプは "Unknown(N)" 形式で返す
 */
export function icmpTypeName(type: number): string {
  const names: Record<number, string> = {
    0: "Echo Reply", 3: "Destination Unreachable", 4: "Source Quench",
    5: "Redirect", 8: "Echo Request", 11: "Time Exceeded",
    12: "Parameter Problem", 13: "Timestamp Request", 14: "Timestamp Reply",
    15: "Information Request", 16: "Information Reply",
    17: "Address Mask Request", 18: "Address Mask Reply",
  };
  return names[type] ?? `Unknown(${type})`;
}

/**
 * Destination Unreachable (Type 3) のコード番号を名前に変換する
 * @param code - Unreachable コード番号
 * @returns コード名の文字列
 */
export function unreachCodeName(code: number): string {
  const names: Record<number, string> = {
    0: "Network Unreachable", 1: "Host Unreachable", 2: "Protocol Unreachable",
    3: "Port Unreachable", 4: "Fragmentation Needed (DF set)",
    5: "Source Route Failed", 6: "Destination Network Unknown",
    7: "Destination Host Unknown", 8: "Source Host Isolated",
    9: "Network Administratively Prohibited", 10: "Host Administratively Prohibited",
    11: "Network Unreachable for TOS", 12: "Host Unreachable for TOS",
    13: "Communication Administratively Prohibited",
  };
  return names[code] ?? `Code ${code}`;
}

// ── パケット構造 ──

/** IPv4 アドレスを表す文字列型 (例: "192.168.1.1") */
export type IPv4 = string;

/** IP ヘッダ (簡易) */
export interface IpHeader {
  version: 4;
  ihl: number;
  tos: number;
  totalLength: number;
  identification: number;
  flags: { df: boolean; mf: boolean };
  fragmentOffset: number;
  ttl: number;
  protocol: number;
  headerChecksum: number;
  srcIp: IPv4;
  dstIp: IPv4;
}

/** ICMP ヘッダ */
export interface IcmpHeader {
  type: number;
  code: number;
  checksum: number;
  /** Type 依存フィールド (ID+Seq / Gateway / Pointer / MTU 等) */
  restOfHeader: number;
}

/** ICMP メッセージ全体 */
export interface IcmpMessage {
  ipHeader: IpHeader;
  icmpHeader: IcmpHeader;
  /** ペイロード (hex ダンプ) */
  payload: string;
  /** パケット全体のバイト数 */
  totalBytes: number;
  /** 表示用ラベル */
  label: string;
  /** 追加情報 */
  extra?: Record<string, string | number>;
}

/** ルーティングテーブルエントリ */
export interface RouteEntry {
  destination: IPv4;
  mask: IPv4;
  gateway: IPv4;
  iface: string;
  metric: number;
}

/** ファイアウォールルール */
export interface FwRule {
  /** 対象 ICMP タイプ (255=全て) */
  icmpType: number;
  action: "allow" | "drop" | "reject";
}

/** ネットワークノード */
export interface NetNode {
  name: string;
  ip: IPv4;
  /** 追加 IP (マルチホーム) */
  aliases?: IPv4[];
  mac: string;
  mtu: number;
  /** OS 初期 TTL */
  initialTtl: number;
  /** ICMP 応答可能か */
  icmpEnabled: boolean;
  /** ルーターか */
  isRouter: boolean;
  /** ルーティングテーブル (ルーターのみ) */
  routes: RouteEntry[];
  /** ファイアウォール */
  firewall: FwRule[];
  /** ICMP レート制限 (msg/sec, 0=無制限) */
  icmpRateLimit: number;
  /** 開いているポート (Port Unreachable 判定用) */
  openPorts: { port: number; proto: "tcp" | "udp" }[];
  /** Redirect で案内する better gateway */
  redirectGateway?: IPv4;
}

/** リンク */
export interface NetLink {
  from: string;
  to: string;
  latency: number;
  lossRate: number;
  /** リンク MTU (ノード MTU と別にリンク制限がある場合) */
  mtu?: number;
}

/** ネットワークトポロジー */
export interface Topology {
  nodes: NetNode[];
  links: NetLink[];
}

// ── シミュレーション ──

/** シミュレーションイベント */
export interface SimEvent {
  time: number;
  node: string;
  direction: "tx" | "rx" | "gen" | "drop" | "info";
  layer: "IP" | "ICMP" | "Link" | "App";
  detail: string;
  message?: IcmpMessage;
}

/** 送信シナリオ */
export interface Scenario {
  /** 送信元ノード */
  src: string;
  /** 宛先 IP */
  dstIp: IPv4;
  /** 送信する ICMP メッセージタイプ */
  icmpType: number;
  icmpCode: number;
  /** TTL */
  ttl: number;
  /** ペイロードサイズ */
  payloadSize: number;
  /** DF フラグ */
  df: boolean;
  /** 宛先ポート (Port Unreachable テスト用) */
  dstPort?: number;
  /** 送信プロトコル (Protocol Unreachable テスト用) */
  protocol?: number;
  /** 繰り返し回数 */
  count: number;
}

/** シミュレーション結果 */
export interface SimResult {
  events: SimEvent[];
  /** 送受信メッセージ一覧 */
  messages: IcmpMessage[];
  /** 統計 */
  stats: { sent: number; received: number; errors: number; dropped: number; redirects: number };
  totalTime: number;
}

// ── ユーティリティ ──

/**
 * IPv4 アドレス文字列を 32 ビット符号なし整数に変換する
 * @param ip - ドット区切りの IPv4 アドレス文字列
 * @returns 符号なし 32 ビット整数
 */
export function ipToInt(ip: IPv4): number {
  const p = ip.split(".");
  return ((parseInt(p[0]!) << 24) | (parseInt(p[1]!) << 16) | (parseInt(p[2]!) << 8) | parseInt(p[3]!)) >>> 0;
}

/**
 * 32 ビット符号なし整数を IPv4 アドレス文字列に変換する
 * @param n - 符号なし 32 ビット整数
 * @returns ドット区切りの IPv4 アドレス文字列
 */
export function intToIp(n: number): IPv4 {
  return `${(n >>> 24) & 0xff}.${(n >>> 16) & 0xff}.${(n >>> 8) & 0xff}.${n & 0xff}`;
}

/**
 * IP アドレスが指定サブネットに属するか判定する
 * @param ip - 判定対象の IP アドレス
 * @param dest - サブネットの宛先アドレス
 * @param mask - サブネットマスク
 * @returns マッチすれば true
 */
export function matchSubnet(ip: IPv4, dest: IPv4, mask: IPv4): boolean {
  return (ipToInt(ip) & ipToInt(mask)) === (ipToInt(dest) & ipToInt(mask));
}

/**
 * ICMP チェックサムを簡易計算する
 * @param type - ICMP タイプ
 * @param code - ICMP コード
 * @param rest - ヘッダの残り 4 バイト (ID+Seq 等)
 * @param payloadLen - ペイロード長
 * @returns 16 ビットのチェックサム値
 */
export function computeChecksum(type: number, code: number, rest: number, payloadLen: number): number {
  let sum = (type << 8 | code) + rest + payloadLen;
  while (sum > 0xffff) sum = (sum & 0xffff) + (sum >> 16);
  return (~sum) & 0xffff;
}

/**
 * 簡易 IP ヘッダを生成する
 * @param src - 送信元 IP アドレス
 * @param dst - 宛先 IP アドレス
 * @param ttl - Time To Live
 * @param payloadLen - ペイロード長 (ICMP ヘッダ含む)
 * @param df - Don't Fragment フラグ
 * @param proto - プロトコル番号 (デフォルト: 1 = ICMP)
 * @returns 生成した IP ヘッダ
 */
export function makeIpHeader(src: IPv4, dst: IPv4, ttl: number, payloadLen: number, df: boolean, proto?: number): IpHeader {
  return {
    version: 4, ihl: 5, tos: 0, totalLength: 20 + 8 + payloadLen,
    identification: Math.floor(Math.random() * 0xffff),
    flags: { df, mf: false }, fragmentOffset: 0,
    ttl, protocol: proto ?? 1, headerChecksum: 0, srcIp: src, dstIp: dst,
  };
}

/**
 * ICMP メッセージ (IP ヘッダ + ICMP ヘッダ + ペイロード) を生成する
 * @param src - 送信元 IP
 * @param dst - 宛先 IP
 * @param type - ICMP タイプ
 * @param code - ICMP コード
 * @param rest - ヘッダ残り部分 (ID+Seq / Gateway / MTU 等)
 * @param ttl - TTL 値
 * @param payloadSize - ペイロードサイズ (最大 64 バイト)
 * @param df - DF フラグ
 * @param extra - 追加メタデータ
 * @returns 生成した ICMP メッセージ
 */
export function makeIcmpMessage(
  src: IPv4, dst: IPv4, type: number, code: number, rest: number,
  ttl: number, payloadSize: number, df: boolean, extra?: Record<string, string | number>,
): IcmpMessage {
  const payload = "00".repeat(Math.min(payloadSize, 64));
  const chk = computeChecksum(type, code, rest, payloadSize);
  return {
    ipHeader: makeIpHeader(src, dst, ttl, payloadSize + 8, df),
    icmpHeader: { type, code, checksum: chk, restOfHeader: rest },
    payload, totalBytes: 20 + 8 + payloadSize,
    label: `${icmpTypeName(type)}${code > 0 ? ` (code=${code})` : ""}`,
    extra,
  };
}

// ── 経路探索 ──

/**
 * BFS (幅優先探索) でトポロジー上の最短経路を探索する
 * @param topo - ネットワークトポロジー
 * @param srcName - 送信元ノード名
 * @param dstIp - 宛先 IP アドレス
 * @returns ノード名の配列 (経路)。到達不能なら undefined
 */
export function findPath(topo: Topology, srcName: string, dstIp: IPv4): string[] | undefined {
  const dstNode = topo.nodes.find((n) => n.ip === dstIp || n.aliases?.includes(dstIp));
  if (!dstNode) return undefined;
  const dstName = dstNode.name;
  const adj = new Map<string, string[]>();
  for (const n of topo.nodes) adj.set(n.name, []);
  for (const l of topo.links) { adj.get(l.from)?.push(l.to); adj.get(l.to)?.push(l.from); }
  const visited = new Set<string>([srcName]);
  const queue: string[][] = [[srcName]];
  while (queue.length > 0) {
    const path = queue.shift()!;
    if (path[path.length - 1] === dstName) return path;
    for (const next of adj.get(path[path.length - 1]!) ?? []) {
      if (!visited.has(next)) { visited.add(next); queue.push([...path, next]); }
    }
  }
  return undefined;
}

/**
 * 2 つのノード間のリンクを取得する (方向を問わない)
 * @param topo - ネットワークトポロジー
 * @param a - ノード名 A
 * @param b - ノード名 B
 * @returns リンク情報。存在しなければ undefined
 */
export function getLink(topo: Topology, a: string, b: string): NetLink | undefined {
  return topo.links.find((l) => (l.from === a && l.to === b) || (l.from === b && l.to === a));
}

// ── ICMP シミュレーター ──

/**
 * ICMP プロトコルのシミュレーションを行うメインクラス。
 * 仮想トポロジー上で ICMP メッセージの送信・転送・応答を再現し、
 * 各ホップでの TTL デクリメント、MTU チェック、ファイアウォール、
 * パケットロスなどのネットワーク動作をエミュレートする。
 */
export class IcmpSimulator {
  /** シミュレーション対象のネットワークトポロジー */
  private topo: Topology;

  /** @param topo - シミュレーション対象のネットワークトポロジー */
  constructor(topo: Topology) { this.topo = topo; }

  /**
   * 複数のシナリオを順次実行し、シミュレーション結果を返す
   * @param scenarios - 実行するシナリオの配列
   * @returns イベントログ、メッセージ一覧、統計情報を含む結果
   */
  simulate(scenarios: Scenario[]): SimResult {
    const events: SimEvent[] = [];
    const messages: IcmpMessage[] = [];
    let time = 0;
    let sent = 0, received = 0, errors = 0, dropped = 0, redirects = 0;

    for (const sc of scenarios) {
      for (let i = 0; i < sc.count; i++) {
        const result = this.processScenario(sc, time, events, messages);
        sent++;
        if (result === "received") received++;
        else if (result === "error") errors++;
        else if (result === "dropped") dropped++;
        else if (result === "redirect") { redirects++; received++; }
        time += 50;
      }
    }

    return { events, messages, stats: { sent, received, errors, dropped, redirects }, totalTime: time };
  }

  /**
   * 単一シナリオを処理し、パケットの送信から宛先での応答までをシミュレートする。
   * 経路探索、各ホップでの TTL/MTU/FW チェック、宛先でのメッセージタイプ別応答を行う。
   * @param sc - 実行するシナリオ
   * @param startTime - シミュレーション開始時刻 (ms)
   * @param events - イベントログの蓄積先
   * @param messages - メッセージ一覧の蓄積先
   * @returns シナリオの結果 ("received" | "error" | "dropped" | "redirect")
   */
  private processScenario(
    sc: Scenario, startTime: number, events: SimEvent[], messages: IcmpMessage[],
  ): "received" | "error" | "dropped" | "redirect" {
    let time = startTime;
    const srcNode = this.topo.nodes.find((n) => n.name === sc.src);
    if (!srcNode) {
      events.push({ time, node: sc.src, direction: "info", layer: "App", detail: `送信元 "${sc.src}" がトポロジーに存在しない` });
      return "error";
    }

    // 送信メッセージ作成
    const id = Math.floor(Math.random() * 0xffff);
    const seq = 1;
    const rest = (id << 16) | seq;
    const extra: Record<string, string | number> = {};
    if (sc.icmpType === ICMP_TYPES.TIMESTAMP_REQUEST) {
      extra["originate"] = time;
      extra["receive"] = 0;
      extra["transmit"] = 0;
    }
    if (sc.dstPort !== undefined) extra["dstPort"] = sc.dstPort;
    if (sc.protocol !== undefined) extra["protocol"] = sc.protocol;

    const outMsg = makeIcmpMessage(srcNode.ip, sc.dstIp, sc.icmpType, sc.icmpCode, rest, sc.ttl, sc.payloadSize, sc.df, Object.keys(extra).length > 0 ? extra : undefined);
    messages.push(outMsg);

    events.push({
      time, node: srcNode.name, direction: "tx", layer: "ICMP",
      detail: `${outMsg.label}: ${srcNode.ip} → ${sc.dstIp} (id=${id} seq=${seq} TTL=${sc.ttl} ${sc.payloadSize + 28}B${sc.df ? " DF" : ""})`,
      message: outMsg,
    });

    // 経路探索
    const path = findPath(this.topo, sc.src, sc.dstIp);
    if (!path) {
      const errMsg = makeIcmpMessage(srcNode.ip, srcNode.ip, ICMP_TYPES.DEST_UNREACHABLE, UNREACH_CODES.NET_UNREACH, 0, 64, 0, false);
      messages.push(errMsg);
      events.push({ time, node: srcNode.name, direction: "gen", layer: "ICMP", detail: `Destination Unreachable: Network Unreachable (${sc.dstIp} への経路なし)`, message: errMsg });
      return "error";
    }

    // 各ホップを通過
    let currentTtl = sc.ttl;
    for (let i = 0; i < path.length - 1; i++) {
      const cur = path[i]!;
      const next = path[i + 1]!;
      const nextNode = this.topo.nodes.find((n) => n.name === next)!;
      const link = getLink(this.topo, cur, next);
      if (!link) { events.push({ time, node: cur, direction: "drop", layer: "Link", detail: `リンク ${cur}↔${next} が存在しない` }); return "error"; }

      // パケットロス
      if (Math.random() < link.lossRate) {
        events.push({ time, node: cur, direction: "drop", layer: "Link", detail: `パケットロス: ${cur} → ${next} リンクで消失` });
        return "dropped";
      }

      time += link.latency;

      // ファイアウォール
      const fwResult = this.checkFirewall(nextNode, sc.icmpType);
      if (fwResult === "drop") {
        events.push({ time, node: next, direction: "drop", layer: "ICMP", detail: `FW DROP: ${nextNode.name} が ICMP Type ${sc.icmpType} を破棄 (admin-prohibited)` });
        return "dropped";
      }
      if (fwResult === "reject") {
        const errMsg = makeIcmpMessage(nextNode.ip, srcNode.ip, ICMP_TYPES.DEST_UNREACHABLE, UNREACH_CODES.ADMIN_PROHIBITED, 0, nextNode.initialTtl, 0, false);
        messages.push(errMsg);
        events.push({ time, node: next, direction: "gen", layer: "ICMP", detail: `FW REJECT → Dest Unreachable: Admin Prohibited`, message: errMsg });
        return "error";
      }

      // ルーターでの処理
      if (nextNode.isRouter && i < path.length - 2) {
        // TTL デクリメント
        currentTtl--;
        if (currentTtl <= 0) {
          if (nextNode.icmpEnabled) {
            const teMsg = makeIcmpMessage(nextNode.ip, srcNode.ip, ICMP_TYPES.TIME_EXCEEDED, TIME_EXCEEDED_CODES.TTL_EXCEEDED, 0, nextNode.initialTtl, 28, false);
            messages.push(teMsg);
            events.push({ time, node: next, direction: "gen", layer: "ICMP", detail: `Time Exceeded: TTL=0 at ${nextNode.name} (${nextNode.ip}) → 送信元へ通知`, message: teMsg });
          } else {
            events.push({ time, node: next, direction: "drop", layer: "ICMP", detail: `TTL=0 at ${nextNode.name} (ICMP 無効: 静かに破棄)` });
          }
          return "error";
        }

        // MTU チェック (Path MTU Discovery)
        const linkMtu = link.mtu ?? nextNode.mtu;
        if (sc.df && outMsg.totalBytes > linkMtu) {
          const mtuRest = (0 << 16) | linkMtu;
          const fragMsg = makeIcmpMessage(nextNode.ip, srcNode.ip, ICMP_TYPES.DEST_UNREACHABLE, UNREACH_CODES.FRAG_NEEDED, mtuRest, nextNode.initialTtl, 28, false, { nextHopMtu: linkMtu });
          messages.push(fragMsg);
          events.push({ time, node: next, direction: "gen", layer: "ICMP", detail: `Frag Needed & DF set: パケット ${outMsg.totalBytes}B > MTU ${linkMtu}B → Next-Hop MTU=${linkMtu}`, message: fragMsg });
          return "error";
        }

        // Redirect チェック
        if (nextNode.redirectGateway && i === 0) {
          const rdMsg = makeIcmpMessage(nextNode.ip, srcNode.ip, ICMP_TYPES.REDIRECT, REDIRECT_CODES.HOST_REDIRECT, ipToInt(nextNode.redirectGateway), nextNode.initialTtl, 28, false, { betterGateway: nextNode.redirectGateway });
          messages.push(rdMsg);
          events.push({ time, node: next, direction: "gen", layer: "ICMP", detail: `Redirect: ${nextNode.name} → 送信元に ${nextNode.redirectGateway} への直接ルートを通知`, message: rdMsg });
          // パケットはそのまま転送される
          events.push({ time, node: next, direction: "tx", layer: "IP", detail: `転送続行: TTL=${currentTtl}` });
          return "redirect";
        }

        events.push({ time, node: next, direction: "tx", layer: "IP", detail: `${nextNode.name} (${nextNode.ip}) 転送: TTL=${currentTtl}` });
      }
    }

    // 宛先ノードに到着
    const dstNode = this.topo.nodes.find((n) => n.ip === sc.dstIp || n.aliases?.includes(sc.dstIp));
    if (!dstNode) {
      events.push({ time, node: path[path.length - 1]!, direction: "gen", layer: "ICMP", detail: `Host Unreachable: ${sc.dstIp}` });
      return "error";
    }

    events.push({ time, node: dstNode.name, direction: "rx", layer: "ICMP", detail: `${outMsg.label} 受信 (${srcNode.ip} → ${sc.dstIp})` });

    // 宛先での処理
    if (!dstNode.icmpEnabled && sc.icmpType === ICMP_TYPES.ECHO_REQUEST) {
      events.push({ time, node: dstNode.name, direction: "drop", layer: "ICMP", detail: `${dstNode.name} は ICMP Echo に応答しない` });
      return "dropped";
    }

    // メッセージタイプごとの応答
    switch (sc.icmpType) {
      case ICMP_TYPES.ECHO_REQUEST: {
        const replyMsg = makeIcmpMessage(dstNode.ip, srcNode.ip, ICMP_TYPES.ECHO_REPLY, 0, rest, dstNode.initialTtl, sc.payloadSize, false);
        messages.push(replyMsg);
        const lastLink = getLink(this.topo, path[path.length - 2]!, path[path.length - 1]!);
        time += lastLink?.latency ?? 1;
        events.push({ time, node: dstNode.name, direction: "gen", layer: "ICMP", detail: `Echo Reply: ${dstNode.ip} → ${srcNode.ip} (id=${id} seq=${seq} TTL=${dstNode.initialTtl})`, message: replyMsg });
        // 復路 (簡略化)
        const rtt = (time - startTime) * 2;
        events.push({ time: startTime + rtt, node: srcNode.name, direction: "rx", layer: "ICMP", detail: `Echo Reply 受信: ${sc.payloadSize + 28}B from ${dstNode.ip} TTL=${Math.max(1, dstNode.initialTtl - (path.length - 2))} rtt=${rtt.toFixed(1)}ms`, message: replyMsg });
        return "received";
      }

      case ICMP_TYPES.TIMESTAMP_REQUEST: {
        const tsReply = makeIcmpMessage(dstNode.ip, srcNode.ip, ICMP_TYPES.TIMESTAMP_REPLY, 0, rest, dstNode.initialTtl, 12, false, { originate: time - 10, receive: time, transmit: time + 1 });
        messages.push(tsReply);
        events.push({ time, node: dstNode.name, direction: "gen", layer: "ICMP", detail: `Timestamp Reply: originate=${time - 10} receive=${time} transmit=${time + 1}`, message: tsReply });
        return "received";
      }

      case ICMP_TYPES.ADDR_MASK_REQUEST: {
        const maskReply = makeIcmpMessage(dstNode.ip, srcNode.ip, ICMP_TYPES.ADDR_MASK_REPLY, 0, ipToInt("255.255.255.0"), dstNode.initialTtl, 4, false, { mask: "255.255.255.0" });
        messages.push(maskReply);
        events.push({ time, node: dstNode.name, direction: "gen", layer: "ICMP", detail: `Address Mask Reply: mask=255.255.255.0`, message: maskReply });
        return "received";
      }

      default: {
        // Port Unreachable (UDP to closed port)
        if (sc.dstPort !== undefined && !dstNode.openPorts.some((p) => p.port === sc.dstPort)) {
          const puMsg = makeIcmpMessage(dstNode.ip, srcNode.ip, ICMP_TYPES.DEST_UNREACHABLE, UNREACH_CODES.PORT_UNREACH, 0, dstNode.initialTtl, 28, false, { port: sc.dstPort });
          messages.push(puMsg);
          events.push({ time, node: dstNode.name, direction: "gen", layer: "ICMP", detail: `Port Unreachable: UDP port ${sc.dstPort} is closed`, message: puMsg });
          return "error";
        }

        // Protocol Unreachable
        if (sc.protocol !== undefined && sc.protocol !== 1 && sc.protocol !== 6 && sc.protocol !== 17) {
          const prMsg = makeIcmpMessage(dstNode.ip, srcNode.ip, ICMP_TYPES.DEST_UNREACHABLE, UNREACH_CODES.PROTO_UNREACH, 0, dstNode.initialTtl, 28, false, { protocol: sc.protocol });
          messages.push(prMsg);
          events.push({ time, node: dstNode.name, direction: "gen", layer: "ICMP", detail: `Protocol Unreachable: protocol=${sc.protocol} is not supported`, message: prMsg });
          return "error";
        }

        events.push({ time, node: dstNode.name, direction: "rx", layer: "ICMP", detail: `メッセージ処理完了 (Type=${sc.icmpType})` });
        return "received";
      }
    }
  }

  /**
   * ノードのファイアウォールルールに基づき ICMP メッセージの処理を判定する
   * @param node - チェック対象のノード
   * @param icmpType - 受信した ICMP タイプ
   * @returns "allow" (通過) | "drop" (静かに破棄) | "reject" (エラー応答付き拒否)
   */
  private checkFirewall(node: NetNode, icmpType: number): "allow" | "drop" | "reject" {
    for (const rule of node.firewall) {
      if (rule.icmpType === 255 || rule.icmpType === icmpType) return rule.action;
    }
    return "allow";
  }
}

// ── ネットワーク構築ヘルパー ──

/**
 * 一般ノード (ホスト) を簡潔に生成するヘルパー関数
 * @param name - ノード名
 * @param ip - IP アドレス
 * @param opts - オプション設定 (MTU, TTL, ファイアウォール等)
 * @returns 生成したネットワークノード
 */
export function node(name: string, ip: IPv4, opts?: Partial<NetNode>): NetNode {
  return {
    name, ip, mac: `02:00:${ip.split(".").map((o) => parseInt(o).toString(16).padStart(2, "0")).join(":")}`,
    mtu: opts?.mtu ?? 1500, initialTtl: opts?.initialTtl ?? 64, icmpEnabled: opts?.icmpEnabled ?? true,
    isRouter: opts?.isRouter ?? false, routes: opts?.routes ?? [], firewall: opts?.firewall ?? [],
    icmpRateLimit: opts?.icmpRateLimit ?? 0, openPorts: opts?.openPorts ?? [],
    aliases: opts?.aliases, redirectGateway: opts?.redirectGateway,
  };
}

/**
 * ルーターノードを簡潔に生成するヘルパー関数。
 * isRouter=true, 初期 TTL=255 がデフォルトで設定される。
 * @param name - ノード名
 * @param ip - IP アドレス
 * @param opts - オプション設定
 * @returns 生成したルーターノード
 */
export function routerNode(name: string, ip: IPv4, opts?: Partial<NetNode>): NetNode {
  return node(name, ip, { ...opts, isRouter: true, initialTtl: opts?.initialTtl ?? 255 });
}

/**
 * ネットワークリンクを簡潔に生成するヘルパー関数
 * @param from - 接続元ノード名
 * @param to - 接続先ノード名
 * @param latency - レイテンシ (ms)
 * @param opts - オプション (パケットロス率, リンク MTU)
 * @returns 生成したリンク
 */
export function netLink(from: string, to: string, latency: number, opts?: { loss?: number; mtu?: number }): NetLink {
  return { from, to, latency, lossRate: opts?.loss ?? 0, mtu: opts?.mtu };
}
