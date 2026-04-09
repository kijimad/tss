/**
 * netdev.ts — ネットワーク機器エミュレーションエンジン
 *
 * L2 スイッチ (MAC 学習, VLAN, STP)、L3 ルーター (ルーティングテーブル, ACL)、
 * ファイアウォール (ステートフル, ゾーン)、NAT ゲートウェイ、
 * 無線 AP、L4 ロードバランサーをコード上でシミュレーションする。
 */

// ── 基本型 ──

export type MacAddr = string;
export type IPv4 = string;

/** 機器タイプ */
export type DeviceType = "l2-switch" | "l3-router" | "firewall" | "nat-gateway" | "wireless-ap" | "load-balancer" | "host";

/** ポート (物理インターフェース) */
export interface Port {
  id: string;
  name: string;
  mac: MacAddr;
  speed: string;
  /** VLAN (トランクなら複数) */
  vlans: number[];
  /** トランクポートか */
  trunk: boolean;
  /** STP ステート */
  stpState: "forwarding" | "blocking" | "listening" | "learning" | "disabled";
  /** リンクアップか */
  linkUp: boolean;
  /** 接続先デバイス名 */
  connectedTo?: string;
}

/** MAC アドレステーブルエントリ */
export interface MacEntry {
  mac: MacAddr;
  port: string;
  vlan: number;
  /** 動的学習 or 静的 */
  type: "dynamic" | "static";
  age: number;
}

/** ルーティングテーブルエントリ */
export interface RouteEntry {
  destination: IPv4;
  mask: IPv4;
  nextHop: IPv4;
  iface: string;
  metric: number;
  type: "connected" | "static" | "ospf" | "bgp";
}

/** ACL ルール */
export interface AclRule {
  id: number;
  action: "permit" | "deny";
  protocol: "tcp" | "udp" | "icmp" | "ip" | "any";
  srcIp: string;
  dstIp: string;
  srcPort?: string;
  dstPort?: string;
  /** ステートフル検査 */
  stateful: boolean;
}

/** NAT テーブルエントリ */
export interface NatEntry {
  type: "snat" | "dnat" | "pat";
  insideLocal: string;
  insideGlobal: string;
  outsideGlobal: string;
  port?: number;
  translatedPort?: number;
}

/** VLAN 定義 */
export interface VlanDef {
  id: number;
  name: string;
  subnet: IPv4;
  gateway: IPv4;
}

/** 無線設定 */
export interface WirelessConfig {
  ssid: string;
  channel: number;
  band: "2.4GHz" | "5GHz" | "6GHz";
  security: "open" | "WPA2-PSK" | "WPA3-SAE" | "WPA2-Enterprise";
  /** 最大クライアント数 */
  maxClients: number;
  /** 送信電力 (dBm) */
  txPower: number;
}

/** LB バックエンド */
export interface LbBackend {
  ip: IPv4;
  port: number;
  weight: number;
  healthy: boolean;
  connections: number;
}

/** ネットワーク機器 */
export interface Device {
  name: string;
  type: DeviceType;
  model: string;
  ip?: IPv4;
  ports: Port[];
  macTable: MacEntry[];
  routeTable: RouteEntry[];
  aclRules: AclRule[];
  natTable: NatEntry[];
  vlans: VlanDef[];
  wireless?: WirelessConfig;
  lbBackends?: LbBackend[];
  lbAlgorithm?: "round-robin" | "least-connections" | "ip-hash";
  /** ファイアウォールゾーン */
  fwZones?: { name: string; ports: string[]; trust: "trusted" | "untrusted" | "dmz" }[];
  /** STP ルートブリッジか */
  stpRoot?: boolean;
  stpPriority?: number;
}

/** フレーム / パケット */
export interface Frame {
  srcMac: MacAddr;
  dstMac: MacAddr;
  vlan?: number;
  etherType: "IPv4" | "ARP" | "802.1Q";
  srcIp?: IPv4;
  dstIp?: IPv4;
  protocol?: "tcp" | "udp" | "icmp";
  srcPort?: number;
  dstPort?: number;
  ttl: number;
  size: number;
}

/** シミュレーションイベント */
export interface SimEvent {
  time: number;
  device: string;
  layer: "L1" | "L2" | "L3" | "L4" | "L7" | "STP" | "VLAN" | "ACL" | "NAT" | "WiFi" | "LB";
  type: "rx" | "tx" | "learn" | "forward" | "drop" | "route" | "translate" | "filter" | "info";
  detail: string;
}

/** パケットフローシナリオ */
export interface FlowScenario {
  name: string;
  frame: Frame;
  ingressDevice: string;
  ingressPort: string;
}

/** トポロジー全体 */
export interface Topology {
  devices: Device[];
  /** デバイス間リンク [devA:portA, devB:portB] */
  links: [string, string][];
}

/** シミュレーション結果 */
export interface SimResult {
  events: SimEvent[];
  /** フローごとの到達結果 */
  flowResults: { name: string; reached: boolean; path: string[]; reason: string }[];
  /** 最終 MAC テーブル */
  macTables: Map<string, MacEntry[]>;
  totalTime: number;
}

// ── ユーティリティ ──

/** ブロードキャスト MAC か */
export function isBroadcast(mac: MacAddr): boolean {
  return mac === "ff:ff:ff:ff:ff:ff";
}

/** IP がサブネットに属するか */
export function ipInSubnet(ip: IPv4, subnet: IPv4, mask: IPv4): boolean {
  const toInt = (a: string) => a.split(".").reduce((acc, o) => (acc << 8) | parseInt(o), 0) >>> 0;
  return (toInt(ip) & toInt(mask)) === (toInt(subnet) & toInt(mask));
}

/** リンクの相手端を見つける */
function findPeer(links: [string, string][], devicePort: string): string | undefined {
  for (const [a, b] of links) {
    if (a === devicePort) return b;
    if (b === devicePort) return a;
  }
  return undefined;
}

// ── シミュレーター ──

export class NetdevSimulator {
  private topo: Topology;

  constructor(topo: Topology) { this.topo = topo; }

  simulate(scenarios: FlowScenario[]): SimResult {
    const events: SimEvent[] = [];
    const flowResults: SimResult["flowResults"] = [];
    const macTables = new Map<string, MacEntry[]>();
    let time = 0;

    // MAC テーブル初期化
    for (const dev of this.topo.devices) macTables.set(dev.name, [...dev.macTable]);

    for (const sc of scenarios) {
      time += 5;
      events.push({ time, device: sc.ingressDevice, layer: "L1", type: "info", detail: `=== フロー "${sc.name}" 開始 ===` });
      const result = this.processFrame(sc.frame, sc.ingressDevice, sc.ingressPort, time, events, macTables, []);
      flowResults.push({ name: sc.name, ...result });
      time += 10;
    }

    return { events, flowResults, macTables, totalTime: time };
  }

  private processFrame(
    frame: Frame, deviceName: string, inPort: string,
    time: number, events: SimEvent[], macTables: Map<string, MacEntry[]>,
    path: string[],
  ): { reached: boolean; path: string[]; reason: string } {
    const dev = this.topo.devices.find((d) => d.name === deviceName);
    if (!dev) return { reached: false, path, reason: `デバイス "${deviceName}" が見つからない` };
    path = [...path, `${deviceName}:${inPort}`];

    // ループ検出
    if (path.filter((p) => p.startsWith(deviceName + ":")).length > 2) {
      events.push({ time, device: deviceName, layer: "STP", type: "drop", detail: `ループ検出: ${path.join(" → ")}` });
      return { reached: false, path, reason: "ループ検出" };
    }

    events.push({ time, device: deviceName, layer: "L1", type: "rx", detail: `ポート ${inPort} でフレーム受信 (${frame.srcMac} → ${frame.dstMac}, ${frame.size}B)` });

    switch (dev.type) {
      case "l2-switch": return this.processSwitch(dev, frame, inPort, time, events, macTables, path);
      case "l3-router": return this.processRouter(dev, frame, inPort, time, events, macTables, path);
      case "firewall": return this.processFirewall(dev, frame, inPort, time, events, macTables, path);
      case "nat-gateway": return this.processNat(dev, frame, inPort, time, events, macTables, path);
      case "wireless-ap": return this.processWirelessAp(dev, frame, inPort, time, events, macTables, path);
      case "load-balancer": return this.processLoadBalancer(dev, frame, inPort, time, events, macTables, path);
      case "host":
        events.push({ time, device: deviceName, layer: "L7", type: "rx", detail: `ホスト ${deviceName} がフレームを受信 (dst=${frame.dstIp ?? frame.dstMac})` });
        return { reached: true, path, reason: "宛先ホスト到達" };
      default: return { reached: false, path, reason: `未対応の機器タイプ: ${dev.type}` };
    }
  }

  /** L2 スイッチ処理 */
  private processSwitch(
    dev: Device, frame: Frame, inPort: string,
    time: number, events: SimEvent[], macTables: Map<string, MacEntry[]>, path: string[],
  ): { reached: boolean; path: string[]; reason: string } {
    const table = macTables.get(dev.name)!;

    // STP チェック
    const port = dev.ports.find((p) => p.id === inPort);
    if (port && port.stpState === "blocking") {
      events.push({ time, device: dev.name, layer: "STP", type: "drop", detail: `ポート ${inPort} は STP Blocking 状態 — フレーム破棄` });
      return { reached: false, path, reason: "STP blocking" };
    }

    // VLAN チェック
    const vlan = frame.vlan ?? (port?.vlans[0] ?? 1);
    events.push({ time, device: dev.name, layer: "VLAN", type: "info", detail: `VLAN ${vlan} (ポート ${inPort})` });

    // MAC 学習
    if (!isBroadcast(frame.srcMac)) {
      const existing = table.find((e) => e.mac === frame.srcMac && e.vlan === vlan);
      if (!existing) {
        table.push({ mac: frame.srcMac, port: inPort, vlan, type: "dynamic", age: 0 });
        events.push({ time, device: dev.name, layer: "L2", type: "learn", detail: `MAC 学習: ${frame.srcMac} → ポート ${inPort} (VLAN ${vlan})` });
      }
    }

    // 宛先検索
    if (isBroadcast(frame.dstMac)) {
      events.push({ time, device: dev.name, layer: "L2", type: "forward", detail: `ブロードキャスト → 全ポートにフラッディング (VLAN ${vlan})` });
      // 同じ VLAN の全ポートに転送
      for (const p of dev.ports) {
        if (p.id === inPort) continue;
        if (!p.vlans.includes(vlan) && !p.trunk) continue;
        if (p.stpState === "blocking") continue;
        const peer = findPeer(this.topo.links, `${dev.name}:${p.id}`);
        if (peer) {
          const [peerDev, peerPort] = peer.split(":");
          return this.processFrame(frame, peerDev!, peerPort!, time + 1, events, macTables, path);
        }
      }
      return { reached: false, path, reason: "ブロードキャスト — 対向なし" };
    }

    const entry = table.find((e) => e.mac === frame.dstMac && e.vlan === vlan);
    if (entry) {
      events.push({ time, device: dev.name, layer: "L2", type: "forward", detail: `MAC テーブルヒット: ${frame.dstMac} → ポート ${entry.port}` });
      const peer = findPeer(this.topo.links, `${dev.name}:${entry.port}`);
      if (peer) {
        const [peerDev, peerPort] = peer.split(":");
        return this.processFrame(frame, peerDev!, peerPort!, time + 1, events, macTables, path);
      }
      return { reached: false, path, reason: "リンク先なし" };
    }

    // 不明 MAC → フラッディング
    events.push({ time, device: dev.name, layer: "L2", type: "forward", detail: `MAC 不明: ${frame.dstMac} → フラッディング (VLAN ${vlan})` });
    for (const p of dev.ports) {
      if (p.id === inPort) continue;
      if (!p.vlans.includes(vlan) && !p.trunk) continue;
      if (p.stpState === "blocking") continue;
      const peer = findPeer(this.topo.links, `${dev.name}:${p.id}`);
      if (peer) {
        const [peerDev, peerPort] = peer.split(":");
        const res = this.processFrame(frame, peerDev!, peerPort!, time + 1, events, macTables, path);
        if (res.reached) return res;
      }
    }
    return { reached: false, path, reason: "フラッディング後も宛先不明" };
  }

  /** L3 ルーター処理 */
  private processRouter(
    dev: Device, frame: Frame, _inPort: string,
    time: number, events: SimEvent[], macTables: Map<string, MacEntry[]>, path: string[],
  ): { reached: boolean; path: string[]; reason: string } {
    if (!frame.dstIp) {
      events.push({ time, device: dev.name, layer: "L3", type: "drop", detail: "IP ヘッダなし — 破棄" });
      return { reached: false, path, reason: "IP ヘッダなし" };
    }

    // TTL チェック
    if (frame.ttl <= 1) {
      events.push({ time, device: dev.name, layer: "L3", type: "drop", detail: `TTL=0 → ICMP Time Exceeded` });
      return { reached: false, path, reason: "TTL exceeded" };
    }
    frame = { ...frame, ttl: frame.ttl - 1 };

    // ACL チェック
    const aclResult = this.checkAcl(dev.aclRules, frame);
    if (aclResult === "deny") {
      events.push({ time, device: dev.name, layer: "ACL", type: "filter", detail: `ACL DENY: ${frame.srcIp} → ${frame.dstIp}:${frame.dstPort ?? "*"}` });
      return { reached: false, path, reason: "ACL denied" };
    }
    if (dev.aclRules.length > 0) {
      events.push({ time, device: dev.name, layer: "ACL", type: "filter", detail: `ACL PERMIT: ${frame.srcIp} → ${frame.dstIp}` });
    }

    // ルーティング
    const route = this.lookupRoute(dev.routeTable, frame.dstIp!);
    if (!route) {
      events.push({ time, device: dev.name, layer: "L3", type: "drop", detail: `ルーティングテーブルにエントリなし: ${frame.dstIp}` });
      return { reached: false, path, reason: "no route to host" };
    }

    events.push({
      time, device: dev.name, layer: "L3", type: "route",
      detail: `ルート: ${frame.dstIp} → ${route.nextHop === "0.0.0.0" ? "directly connected" : route.nextHop} via ${route.iface} (${route.type}, metric=${route.metric})`,
    });

    // 出力ポートから次のデバイスへ
    const outPort = dev.ports.find((p) => p.id === route.iface);
    if (!outPort) return { reached: false, path, reason: `出力ポート ${route.iface} なし` };

    events.push({ time, device: dev.name, layer: "L2", type: "tx", detail: `ポート ${outPort.id} から転送 (TTL=${frame.ttl})` });

    const peer = findPeer(this.topo.links, `${dev.name}:${outPort.id}`);
    if (!peer) return { reached: false, path, reason: "リンク先なし" };
    const [peerDev, peerPort] = peer.split(":");
    return this.processFrame(frame, peerDev!, peerPort!, time + 2, events, macTables, path);
  }

  /** ファイアウォール処理 */
  private processFirewall(
    dev: Device, frame: Frame, inPort: string,
    time: number, events: SimEvent[], macTables: Map<string, MacEntry[]>, path: string[],
  ): { reached: boolean; path: string[]; reason: string } {
    // ゾーン判定
    const inZone = dev.fwZones?.find((z) => z.ports.includes(inPort));
    events.push({
      time, device: dev.name, layer: "L3", type: "rx",
      detail: `ゾーン: ${inZone?.name ?? "unknown"} (${inZone?.trust ?? "?"}) → パケット検査`,
    });

    // ステートフルインスペクション
    const aclResult = this.checkAcl(dev.aclRules, frame);
    if (aclResult === "deny") {
      events.push({
        time, device: dev.name, layer: "ACL", type: "filter",
        detail: `FW DENY: ${frame.srcIp}:${frame.srcPort ?? "*"} → ${frame.dstIp}:${frame.dstPort ?? "*"} (${frame.protocol ?? "ip"})`,
      });
      return { reached: false, path, reason: "firewall deny" };
    }
    events.push({
      time, device: dev.name, layer: "ACL", type: "filter",
      detail: `FW PERMIT: ${frame.srcIp} → ${frame.dstIp}:${frame.dstPort ?? "*"}${dev.aclRules.some((r) => r.stateful) ? " (stateful)" : ""}`,
    });

    // ルーティング (ファイアウォールもルーティング機能を持つ)
    const route = this.lookupRoute(dev.routeTable, frame.dstIp!);
    if (!route) return { reached: false, path, reason: "no route" };

    events.push({ time, device: dev.name, layer: "L3", type: "route", detail: `転送: → ${route.iface} (${route.nextHop})` });

    const peer = findPeer(this.topo.links, `${dev.name}:${route.iface}`);
    if (!peer) return { reached: false, path, reason: "リンク先なし" };
    const [peerDev, peerPort] = peer.split(":");
    return this.processFrame({ ...frame, ttl: frame.ttl - 1 }, peerDev!, peerPort!, time + 2, events, macTables, path);
  }

  /** NAT ゲートウェイ処理 */
  private processNat(
    dev: Device, frame: Frame, _inPort: string,
    time: number, events: SimEvent[], macTables: Map<string, MacEntry[]>, path: string[],
  ): { reached: boolean; path: string[]; reason: string } {
    // NAT 変換
    const natRule = dev.natTable.find((n) =>
      (n.type === "snat" && frame.srcIp === n.insideLocal) ||
      (n.type === "pat" && frame.srcIp === n.insideLocal) ||
      (n.type === "dnat" && frame.dstIp === n.outsideGlobal),
    );

    if (natRule) {
      if (natRule.type === "snat" || natRule.type === "pat") {
        const origSrc = frame.srcIp;
        frame = { ...frame, srcIp: natRule.insideGlobal };
        events.push({
          time, device: dev.name, layer: "NAT", type: "translate",
          detail: `${natRule.type.toUpperCase()}: src ${origSrc}${natRule.port ? `:${natRule.port}` : ""} → ${natRule.insideGlobal}${natRule.translatedPort ? `:${natRule.translatedPort}` : ""}`,
        });
      } else if (natRule.type === "dnat") {
        const origDst = frame.dstIp;
        frame = { ...frame, dstIp: natRule.insideLocal };
        events.push({
          time, device: dev.name, layer: "NAT", type: "translate",
          detail: `DNAT: dst ${origDst} → ${natRule.insideLocal}`,
        });
      }
    } else {
      events.push({ time, device: dev.name, layer: "NAT", type: "info", detail: "NAT ルールなし — パススルー" });
    }

    // ルーティング
    const route = this.lookupRoute(dev.routeTable, frame.dstIp!);
    if (!route) return { reached: false, path, reason: "no route" };

    const peer = findPeer(this.topo.links, `${dev.name}:${route.iface}`);
    if (!peer) return { reached: false, path, reason: "リンク先なし" };
    const [peerDev, peerPort] = peer.split(":");
    return this.processFrame(frame, peerDev!, peerPort!, time + 2, events, macTables, path);
  }

  /** 無線 AP 処理 */
  private processWirelessAp(
    dev: Device, frame: Frame, inPort: string,
    time: number, events: SimEvent[], macTables: Map<string, MacEntry[]>, path: string[],
  ): { reached: boolean; path: string[]; reason: string } {
    const wc = dev.wireless!;
    events.push({
      time, device: dev.name, layer: "WiFi", type: "rx",
      detail: `SSID="${wc.ssid}" ch=${wc.channel} ${wc.band} ${wc.security} (${wc.txPower}dBm)`,
    });

    // 有線ポートへブリッジ
    const wiredPort = dev.ports.find((p) => p.id !== inPort && p.linkUp);
    if (!wiredPort) return { reached: false, path, reason: "有線ポートなし" };

    events.push({ time, device: dev.name, layer: "L2", type: "forward", detail: `無線→有線ブリッジ: ${inPort} → ${wiredPort.id}` });

    const peer = findPeer(this.topo.links, `${dev.name}:${wiredPort.id}`);
    if (!peer) return { reached: false, path, reason: "リンク先なし" };
    const [peerDev, peerPort] = peer.split(":");
    return this.processFrame(frame, peerDev!, peerPort!, time + 2, events, macTables, path);
  }

  /** ロードバランサー処理 */
  private processLoadBalancer(
    dev: Device, frame: Frame, inPort: string,
    time: number, events: SimEvent[], macTables: Map<string, MacEntry[]>, path: string[],
  ): { reached: boolean; path: string[]; reason: string } {
    const backends = dev.lbBackends?.filter((b) => b.healthy) ?? [];
    if (backends.length === 0) {
      events.push({ time, device: dev.name, layer: "LB", type: "drop", detail: "健全なバックエンドなし — 503" });
      return { reached: false, path, reason: "no healthy backend" };
    }

    let selected: LbBackend;
    switch (dev.lbAlgorithm) {
      case "least-connections":
        selected = backends.reduce((a, b) => a.connections < b.connections ? a : b);
        break;
      case "ip-hash": {
        const hash = (frame.srcIp ?? "").split(".").reduce((a, o) => a + parseInt(o), 0);
        selected = backends[hash % backends.length]!;
        break;
      }
      default:
        selected = backends[Math.floor(Math.random() * backends.length)]!;
    }

    events.push({
      time, device: dev.name, layer: "LB", type: "forward",
      detail: `${dev.lbAlgorithm}: ${frame.dstIp}:${frame.dstPort} → ${selected.ip}:${selected.port} (weight=${selected.weight}, conn=${selected.connections})`,
    });

    // バックエンドへ転送
    frame = { ...frame, dstIp: selected.ip, dstPort: selected.port };
    const outPort = dev.ports.find((p) => p.id !== inPort);
    if (!outPort) return { reached: false, path, reason: "出力ポートなし" };

    const peer = findPeer(this.topo.links, `${dev.name}:${outPort.id}`);
    if (!peer) return { reached: false, path, reason: "リンク先なし" };
    const [peerDev, peerPort] = peer.split(":");
    return this.processFrame(frame, peerDev!, peerPort!, time + 1, events, macTables, path);
  }

  /** ACL 評価 */
  private checkAcl(rules: AclRule[], frame: Frame): "permit" | "deny" {
    for (const rule of rules) {
      if (rule.protocol !== "any" && rule.protocol !== "ip" && rule.protocol !== frame.protocol) continue;
      if (rule.srcIp !== "any" && frame.srcIp !== rule.srcIp) continue;
      if (rule.dstIp !== "any" && frame.dstIp !== rule.dstIp) continue;
      if (rule.dstPort && frame.dstPort !== undefined && String(frame.dstPort) !== rule.dstPort) continue;
      return rule.action;
    }
    return "permit";
  }

  /** ルーティングテーブル検索 (最長一致) */
  private lookupRoute(table: RouteEntry[], dstIp: IPv4): RouteEntry | undefined {
    let best: RouteEntry | undefined;
    let bestMask = -1;
    for (const r of table) {
      if (ipInSubnet(dstIp, r.destination, r.mask)) {
        const maskVal = r.mask.split(".").reduce((a, o) => a + parseInt(o), 0);
        if (maskVal > bestMask) { best = r; bestMask = maskVal; }
      }
    }
    return best;
  }
}

// ── ヘルパー ──

export function port(id: string, name: string, opts?: Partial<Port>): Port {
  return {
    id, name, mac: `02:00:00:00:00:${id.replace(/[^0-9a-f]/gi, "").padStart(2, "0")}`,
    speed: opts?.speed ?? "1Gbps", vlans: opts?.vlans ?? [1], trunk: opts?.trunk ?? false,
    stpState: opts?.stpState ?? "forwarding", linkUp: opts?.linkUp ?? true, connectedTo: opts?.connectedTo,
  };
}

export function route(dst: IPv4, mask: IPv4, nh: IPv4, iface: string, opts?: Partial<RouteEntry>): RouteEntry {
  return { destination: dst, mask, nextHop: nh, iface, metric: opts?.metric ?? 0, type: opts?.type ?? "static" };
}

export function acl(id: number, action: "permit" | "deny", proto: AclRule["protocol"], src: string, dst: string, opts?: { dstPort?: string; stateful?: boolean }): AclRule {
  return { id, action, protocol: proto, srcIp: src, dstIp: dst, dstPort: opts?.dstPort, stateful: opts?.stateful ?? false };
}
