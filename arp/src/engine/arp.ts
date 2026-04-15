/**
 * arp.ts — ARP (Address Resolution Protocol) エミュレーションエンジン
 *
 * ============================================================
 * ARP (Address Resolution Protocol) とは
 * ============================================================
 *
 * ARP は RFC 826 で定義されたプロトコルで、ネットワーク層（L3）の
 * IP アドレスをデータリンク層（L2）の MAC アドレスに変換する。
 * TCP/IP 通信において、実際のフレーム送信には宛先 MAC アドレスが
 * 必須であるため、ARP はイーサネットネットワークの基盤となる。
 *
 * ARP は OSI モデルの L2/L3 の境界で動作する。IP パケットを Ethernet
 * フレームに格納して送信するために、宛先の MAC アドレスが必要であり、
 * その解決を担うのが ARP である。
 *
 * ---- 動作の流れ ----
 * 1. ホスト A がホスト B と通信したい場合、まず ARP キャッシュを確認
 * 2. キャッシュミスの場合、ARP Request をブロードキャスト (ff:ff:ff:ff:ff:ff) で送信
 * 3. ブロードキャストドメイン内の全ホストがフレームを受信
 * 4. ターゲット IP を持つホスト B がユニキャストで ARP Reply を返す
 * 5. ホスト A は受信した Reply で ARP キャッシュを更新し、通信を開始
 *
 * ---- ARP パケット構造 (RFC 826) ----
 * - Hardware Type (HTYPE): ハードウェアの種類 (1 = Ethernet)
 * - Protocol Type (PTYPE): プロトコルの種類 (0x0800 = IPv4)
 * - Hardware Length (HLEN): MAC アドレスの長さ (6 バイト)
 * - Protocol Length (PLEN): IP アドレスの長さ (4 バイト)
 * - Operation (OPER): 1 = ARP Request, 2 = ARP Reply
 * - Sender Hardware Address (SHA): 送信元 MAC アドレス
 * - Sender Protocol Address (SPA): 送信元 IP アドレス
 * - Target Hardware Address (THA): ターゲット MAC アドレス
 * - Target Protocol Address (TPA): ターゲット IP アドレス
 *
 * ---- 主要な ARP の種類 ----
 * - 通常の ARP: IP → MAC 解決 (Request はブロードキャスト、Reply はユニキャスト)
 * - Gratuitous ARP: 自身の IP/MAC を通知 (IP 変更、NIC 交換、フェイルオーバー時)
 * - ARP Probe (DAD): 重複アドレス検出。送信元 IP を 0.0.0.0 にして送信 (RFC 5227)
 * - Proxy ARP: ルーターが他サブネットの IP に対して自身の MAC で代理応答
 * - ARP スプーフィング: 偽の ARP Reply でキャッシュを汚染する攻撃手法 (MITM の前段階)
 *
 * ---- セキュリティ ----
 * - ARP には認証機構がないため、スプーフィング (ARP ポイズニング) に脆弱
 * - Dynamic ARP Inspection (DAI) でスイッチレベルで不正 ARP を検出・破棄可能
 * - Static ARP エントリはエージングの対象外で、手動管理が必要
 *
 * ============================================================
 *
 * このモジュールでは以下をシミュレーションする:
 * - ARP Request/Reply の基本フロー
 * - ARP キャッシュの管理 (追加・更新・エージング・フラッシュ)
 * - Gratuitous ARP によるキャッシュ更新通知
 * - ARP Probe による重複アドレス検出 (DAD: Duplicate Address Detection)
 * - Proxy ARP による異サブネット代理応答
 * - ARP スプーフィング攻撃と DAI による防御
 *
 * Ethernet フレームレベルでパケットの送受信を追跡し、
 * 各ホストの ARP テーブルの変化を可視化する。
 */

// ── 基本型 ──
// ARP シミュレーションで使用する基本的な型エイリアス

/** IPv4 アドレスを表す文字列型 (例: "192.168.1.1") */
export type IPv4 = string;

/** MAC (Media Access Control) アドレスを表す文字列型 (例: "aa:bb:cc:00:11:22") */
export type MacAddr = string;

/** ARP オペレーション */
export type ArpOp = "REQUEST" | "REPLY";

/** ARP パケット (RFC 826) */
export interface ArpPacket {
  /** ハードウェアタイプ (1 = Ethernet) */
  htype: number;
  /** プロトコルタイプ (0x0800 = IPv4) */
  ptype: number;
  /** ハードウェアアドレス長 (6) */
  hlen: number;
  /** プロトコルアドレス長 (4) */
  plen: number;
  /** オペレーション */
  oper: ArpOp;
  /** 送信元 MAC */
  sha: MacAddr;
  /** 送信元 IP */
  spa: IPv4;
  /** ターゲット MAC (Request 時は 00:00:00:00:00:00) */
  tha: MacAddr;
  /** ターゲット IP */
  tpa: IPv4;
}

/** Ethernet フレーム (簡易) */
export interface EtherFrame {
  srcMac: MacAddr;
  dstMac: MacAddr;
  /** EtherType (0x0806 = ARP) */
  etherType: number;
  payload: ArpPacket;
  /** フレームサイズ (bytes) */
  size: number;
}

/** ARP キャッシュエントリ */
export interface ArpCacheEntry {
  ip: IPv4;
  mac: MacAddr;
  /** エントリタイプ */
  type: "dynamic" | "static" | "incomplete";
  /** 作成時刻 (ms) */
  createdAt: number;
  /** 有効期限 (ms) */
  expiresAt: number;
}

/** ネットワークインターフェース */
export interface NetInterface {
  ip: IPv4;
  mac: MacAddr;
  /** サブネットマスク */
  mask: IPv4;
  /** デフォルトゲートウェイ */
  gateway?: IPv4;
}

/** ホスト */
export interface Host {
  name: string;
  iface: NetInterface;
  arpCache: ArpCacheEntry[];
  /** ARP キャッシュ TTL (ms) */
  arpTimeout: number;
  /** Proxy ARP を有効にするか */
  proxyArp: boolean;
  /** Proxy ARP で応答するサブネット */
  proxySubnets?: IPv4[];
  /** ARP パケットを受け入れるか (セキュリティ) */
  acceptArp: boolean;
}

/** ネットワークセグメント (ブロードキャストドメイン) */
export interface Segment {
  name: string;
  hosts: string[];
}

/** トポロジー */
export interface Topology {
  hosts: Host[];
  segments: Segment[];
}

/** シミュレーションシナリオ */
export interface Scenario {
  /** シナリオ名 */
  name: string;
  /** ARP を発生させるトリガー */
  action: ArpAction;
}

export type ArpAction =
  | { type: "resolve"; from: string; targetIp: IPv4 }
  | { type: "gratuitous"; from: string }
  | { type: "probe"; from: string; targetIp: IPv4 }
  | { type: "spoof"; attacker: string; victimIp: IPv4; spoofedMac: MacAddr; targetIp: IPv4 }
  | { type: "age"; time: number }
  | { type: "flush"; host: string };

/** シミュレーションイベント */
export interface SimEvent {
  time: number;
  host: string;
  layer: "Ethernet" | "ARP" | "Cache" | "Security" | "Info";
  type: "tx" | "rx" | "update" | "expire" | "drop" | "info" | "warning";
  detail: string;
  frame?: EtherFrame;
}

/** シミュレーション結果 */
export interface SimResult {
  events: SimEvent[];
  /** 各ホストの最終 ARP キャッシュ */
  caches: Map<string, ArpCacheEntry[]>;
  /** 送受信したフレーム数 */
  stats: { requests: number; replies: number; gratuitous: number; proxyReplies: number; dropped: number };
  totalTime: number;
}

// ── ユーティリティ ──

export const BROADCAST_MAC = "ff:ff:ff:ff:ff:ff";
export const ZERO_MAC = "00:00:00:00:00:00";
export const ARP_ETHERTYPE = 0x0806;

/** IP がサブネット内か判定する */
export function sameSubnet(ip1: IPv4, ip2: IPv4, mask: IPv4): boolean {
  const toInt = (a: string) => a.split(".").reduce((acc, o) => (acc << 8) | parseInt(o), 0) >>> 0;
  return (toInt(ip1) & toInt(mask)) === (toInt(ip2) & toInt(mask));
}

/** ARP パケットを作成する */
export function makeArpPacket(oper: ArpOp, sha: MacAddr, spa: IPv4, tha: MacAddr, tpa: IPv4): ArpPacket {
  return { htype: 1, ptype: 0x0800, hlen: 6, plen: 4, oper, sha, spa, tha, tpa };
}

/** ARP Request フレームを作成する */
export function makeArpRequest(srcMac: MacAddr, srcIp: IPv4, targetIp: IPv4): EtherFrame {
  return {
    srcMac, dstMac: BROADCAST_MAC, etherType: ARP_ETHERTYPE,
    payload: makeArpPacket("REQUEST", srcMac, srcIp, ZERO_MAC, targetIp),
    size: 42,
  };
}

/** ARP Reply フレームを作成する */
export function makeArpReply(srcMac: MacAddr, srcIp: IPv4, dstMac: MacAddr, dstIp: IPv4): EtherFrame {
  return {
    srcMac, dstMac, etherType: ARP_ETHERTYPE,
    payload: makeArpPacket("REPLY", srcMac, srcIp, dstMac, dstIp),
    size: 42,
  };
}

/** Gratuitous ARP フレームを作成する */
export function makeGratuitousArp(mac: MacAddr, ip: IPv4): EtherFrame {
  return {
    srcMac: mac, dstMac: BROADCAST_MAC, etherType: ARP_ETHERTYPE,
    payload: makeArpPacket("REQUEST", mac, ip, ZERO_MAC, ip),
    size: 42,
  };
}

/** ARP Probe (DAD) フレームを作成する (src IP = 0.0.0.0) */
export function makeArpProbe(mac: MacAddr, targetIp: IPv4): EtherFrame {
  return {
    srcMac: mac, dstMac: BROADCAST_MAC, etherType: ARP_ETHERTYPE,
    payload: makeArpPacket("REQUEST", mac, "0.0.0.0", ZERO_MAC, targetIp),
    size: 42,
  };
}

/** ARP パケットのサマリ文字列 */
export function arpSummary(pkt: ArpPacket): string {
  if (pkt.oper === "REQUEST") {
    if (pkt.spa === "0.0.0.0") return `ARP Probe: Who has ${pkt.tpa}? (DAD)`;
    if (pkt.spa === pkt.tpa) return `Gratuitous ARP: ${pkt.spa} is-at ${pkt.sha}`;
    return `ARP Request: Who has ${pkt.tpa}? Tell ${pkt.spa}`;
  }
  return `ARP Reply: ${pkt.spa} is-at ${pkt.sha}`;
}

// ── シミュレーター ──

export class ArpSimulator {
  private topo: Topology;

  constructor(topo: Topology) {
    this.topo = topo;
  }

  simulate(scenarios: Scenario[]): SimResult {
    const events: SimEvent[] = [];
    const caches = new Map<string, ArpCacheEntry[]>();
    let time = 0;
    let requests = 0, replies = 0, gratuitous = 0, proxyReplies = 0, dropped = 0;

    // キャッシュ初期化
    for (const h of this.topo.hosts) caches.set(h.name, [...h.arpCache]);

    for (const sc of scenarios) {
      time += 5;
      events.push({ time, host: "-", layer: "Info", type: "info", detail: `=== ${sc.name} ===` });

      switch (sc.action.type) {
        case "resolve": {
          const a = sc.action;
          const host = this.topo.hosts.find((h) => h.name === a.from);
          if (!host) break;

          // キャッシュ確認
          const cache = caches.get(host.name)!;
          const cached = cache.find((e) => e.ip === a.targetIp && e.type !== "incomplete" && e.expiresAt > time);
          if (cached) {
            events.push({ time, host: host.name, layer: "Cache", type: "info", detail: `キャッシュヒット: ${a.targetIp} → ${cached.mac} (TTL=${cached.expiresAt - time}ms)` });
            break;
          }

          // ARP Request 送信
          const frame = makeArpRequest(host.iface.mac, host.iface.ip, a.targetIp);
          events.push({ time, host: host.name, layer: "Ethernet", type: "tx", detail: `${host.iface.mac} → ${BROADCAST_MAC} (broadcast)`, frame });
          events.push({ time, host: host.name, layer: "ARP", type: "tx", detail: arpSummary(frame.payload), frame });
          requests++;

          // incomplete エントリを追加
          cache.push({ ip: a.targetIp, mac: ZERO_MAC, type: "incomplete", createdAt: time, expiresAt: time + 3000 });

          // ブロードキャストドメイン内の全ホストが受信
          time += 1;
          const seg = this.topo.segments.find((s) => s.hosts.includes(host.name));
          if (!seg) break;

          for (const peerName of seg.hosts) {
            if (peerName === host.name) continue;
            const peer = this.topo.hosts.find((h) => h.name === peerName);
            if (!peer) continue;

            events.push({ time, host: peer.name, layer: "Ethernet", type: "rx", detail: `ブロードキャストフレーム受信 (from ${host.iface.mac})`, frame });

            // 送信元 MAC/IP を学習 (RFC 826: merge flag)
            const peerCache = caches.get(peer.name)!;
            const existing = peerCache.find((e) => e.ip === host.iface.ip);
            if (existing) {
              existing.mac = host.iface.mac;
              existing.createdAt = time;
              existing.expiresAt = time + peer.arpTimeout;
              existing.type = "dynamic";
              events.push({ time, host: peer.name, layer: "Cache", type: "update", detail: `キャッシュ更新: ${host.iface.ip} → ${host.iface.mac}` });
            } else {
              peerCache.push({ ip: host.iface.ip, mac: host.iface.mac, type: "dynamic", createdAt: time, expiresAt: time + peer.arpTimeout });
              events.push({ time, host: peer.name, layer: "Cache", type: "update", detail: `キャッシュ追加: ${host.iface.ip} → ${host.iface.mac}` });
            }

            // ターゲット IP が自分なら Reply
            if (peer.iface.ip === a.targetIp) {
              time += 1;
              const reply = makeArpReply(peer.iface.mac, peer.iface.ip, host.iface.mac, host.iface.ip);
              events.push({ time, host: peer.name, layer: "ARP", type: "tx", detail: arpSummary(reply.payload), frame: reply });
              replies++;

              // 送信元がキャッシュ更新
              time += 1;
              events.push({ time, host: host.name, layer: "Ethernet", type: "rx", detail: `ユニキャスト受信 (from ${peer.iface.mac})`, frame: reply });
              const inc = cache.find((e) => e.ip === a.targetIp && e.type === "incomplete");
              if (inc) { inc.mac = peer.iface.mac; inc.type = "dynamic"; inc.expiresAt = time + host.arpTimeout; }
              else { cache.push({ ip: a.targetIp, mac: peer.iface.mac, type: "dynamic", createdAt: time, expiresAt: time + host.arpTimeout }); }
              events.push({ time, host: host.name, layer: "Cache", type: "update", detail: `解決完了: ${a.targetIp} → ${peer.iface.mac}` });
            }
            // Proxy ARP チェック
            else if (peer.proxyArp && peer.proxySubnets?.some((sub) => sameSubnet(a.targetIp, sub, peer.iface.mask))) {
              time += 1;
              const proxyReply = makeArpReply(peer.iface.mac, a.targetIp, host.iface.mac, host.iface.ip);
              events.push({ time, host: peer.name, layer: "ARP", type: "tx", detail: `Proxy ARP Reply: ${a.targetIp} is-at ${peer.iface.mac} (代理応答)`, frame: proxyReply });
              proxyReplies++;

              time += 1;
              const inc = cache.find((e) => e.ip === a.targetIp && e.type === "incomplete");
              if (inc) { inc.mac = peer.iface.mac; inc.type = "dynamic"; inc.expiresAt = time + host.arpTimeout; }
              events.push({ time, host: host.name, layer: "Cache", type: "update", detail: `Proxy ARP 解決: ${a.targetIp} → ${peer.iface.mac}` });
            }
          }
          break;
        }

        case "gratuitous": {
          const a = sc.action;
          const host = this.topo.hosts.find((h) => h.name === a.from);
          if (!host) break;

          const frame = makeGratuitousArp(host.iface.mac, host.iface.ip);
          events.push({ time, host: host.name, layer: "Ethernet", type: "tx", detail: `${host.iface.mac} → ${BROADCAST_MAC} (broadcast)`, frame });
          events.push({ time, host: host.name, layer: "ARP", type: "tx", detail: arpSummary(frame.payload), frame });
          gratuitous++;

          time += 1;
          const seg = this.topo.segments.find((s) => s.hosts.includes(host.name));
          if (!seg) break;

          for (const peerName of seg.hosts) {
            if (peerName === host.name) continue;
            const peer = this.topo.hosts.find((h) => h.name === peerName);
            if (!peer) continue;

            events.push({ time, host: peer.name, layer: "Ethernet", type: "rx", detail: `Gratuitous ARP 受信`, frame });

            const peerCache = caches.get(peer.name)!;
            const existing = peerCache.find((e) => e.ip === host.iface.ip);
            if (existing) {
              const oldMac = existing.mac;
              existing.mac = host.iface.mac;
              existing.expiresAt = time + peer.arpTimeout;
              events.push({ time, host: peer.name, layer: "Cache", type: "update", detail: `Gratuitous 更新: ${host.iface.ip} ${oldMac} → ${host.iface.mac}` });
            } else {
              peerCache.push({ ip: host.iface.ip, mac: host.iface.mac, type: "dynamic", createdAt: time, expiresAt: time + peer.arpTimeout });
              events.push({ time, host: peer.name, layer: "Cache", type: "update", detail: `Gratuitous 追加: ${host.iface.ip} → ${host.iface.mac}` });
            }
          }
          break;
        }

        case "probe": {
          const a = sc.action;
          const host = this.topo.hosts.find((h) => h.name === a.from);
          if (!host) break;

          const frame = makeArpProbe(host.iface.mac, a.targetIp);
          events.push({ time, host: host.name, layer: "ARP", type: "tx", detail: arpSummary(frame.payload), frame });
          requests++;

          time += 1;
          const seg = this.topo.segments.find((s) => s.hosts.includes(host.name));
          if (!seg) break;

          let conflict = false;
          for (const peerName of seg.hosts) {
            if (peerName === host.name) continue;
            const peer = this.topo.hosts.find((h) => h.name === peerName);
            if (!peer) continue;
            if (peer.iface.ip === a.targetIp) {
              conflict = true;
              const reply = makeArpReply(peer.iface.mac, peer.iface.ip, host.iface.mac, "0.0.0.0");
              events.push({ time, host: peer.name, layer: "ARP", type: "tx", detail: `ARP Reply (DAD 競合): ${a.targetIp} is-at ${peer.iface.mac}`, frame: reply });
              replies++;
              time += 1;
              events.push({ time, host: host.name, layer: "Security", type: "warning", detail: `⚠ DAD 失敗: ${a.targetIp} は既に ${peer.iface.mac} (${peer.name}) が使用中` });
            }
          }
          if (!conflict) {
            events.push({ time, host: host.name, layer: "ARP", type: "info", detail: `DAD 成功: ${a.targetIp} は利用可能` });
          }
          break;
        }

        case "spoof": {
          const a = sc.action;
          const attacker = this.topo.hosts.find((h) => h.name === a.attacker);
          if (!attacker) break;

          events.push({ time, host: attacker.name, layer: "Security", type: "warning", detail: `⚠ ARP Spoofing 開始: "${a.victimIp} is-at ${a.spoofedMac}" を偽装` });

          // 偽の ARP Reply を送信
          const fakeReply = makeArpReply(a.spoofedMac, a.victimIp, BROADCAST_MAC, a.targetIp);
          fakeReply.dstMac = BROADCAST_MAC;
          events.push({ time, host: attacker.name, layer: "ARP", type: "tx", detail: `偽 ARP Reply: ${a.victimIp} is-at ${a.spoofedMac}`, frame: fakeReply });

          time += 1;
          const seg = this.topo.segments.find((s) => s.hosts.includes(attacker.name));
          if (!seg) break;

          for (const peerName of seg.hosts) {
            if (peerName === attacker.name) continue;
            const peer = this.topo.hosts.find((h) => h.name === peerName);
            if (!peer) continue;

            if (!peer.acceptArp) {
              events.push({ time, host: peer.name, layer: "Security", type: "drop", detail: `ARP 受信拒否 (セキュリティポリシー)` });
              dropped++;
              continue;
            }

            const peerCache = caches.get(peer.name)!;
            const existing = peerCache.find((e) => e.ip === a.victimIp);
            if (existing) {
              const oldMac = existing.mac;
              existing.mac = a.spoofedMac;
              events.push({ time, host: peer.name, layer: "Cache", type: "update", detail: `⚠ キャッシュ汚染: ${a.victimIp} ${oldMac} → ${a.spoofedMac} (spoofed!)` });
            } else {
              peerCache.push({ ip: a.victimIp, mac: a.spoofedMac, type: "dynamic", createdAt: time, expiresAt: time + peer.arpTimeout });
              events.push({ time, host: peer.name, layer: "Cache", type: "update", detail: `⚠ キャッシュ汚染: ${a.victimIp} → ${a.spoofedMac} (spoofed!)` });
            }
          }
          break;
        }

        case "age": {
          const ageTime = sc.action.time;
          time = ageTime;
          for (const [hostName, cache] of caches) {
            const expired = cache.filter((e) => e.type === "dynamic" && e.expiresAt <= ageTime);
            for (const e of expired) {
              events.push({ time, host: hostName, layer: "Cache", type: "expire", detail: `エントリ期限切れ: ${e.ip} → ${e.mac} (age=${ageTime - e.createdAt}ms)` });
            }
            caches.set(hostName, cache.filter((e) => e.type === "static" || e.expiresAt > ageTime));
          }
          break;
        }

        case "flush": {
          const hostName = sc.action.host;
          caches.set(hostName, []);
          events.push({ time, host: hostName, layer: "Cache", type: "info", detail: `ARP キャッシュをフラッシュ` });
          break;
        }
      }
    }

    return {
      events, caches,
      stats: { requests, replies, gratuitous, proxyReplies, dropped },
      totalTime: time,
    };
  }
}

// ── ヘルパー ──

export function createHost(name: string, ip: IPv4, mac: MacAddr, opts?: Partial<Host> & { gateway?: IPv4; mask?: IPv4 }): Host {
  return {
    name,
    iface: { ip, mac, mask: opts?.mask ?? "255.255.255.0", gateway: opts?.gateway },
    arpCache: opts?.arpCache ?? [],
    arpTimeout: opts?.arpTimeout ?? 20000,
    proxyArp: opts?.proxyArp ?? false,
    proxySubnets: opts?.proxySubnets,
    acceptArp: opts?.acceptArp ?? true,
  };
}

export function segment(name: string, hosts: string[]): Segment {
  return { name, hosts };
}
