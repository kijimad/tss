/**
 * dnet.ts — Docker ネットワークエミュレーションエンジン
 *
 * bridge / host / none / overlay / macvlan ドライバー、
 * veth ペア、Linux bridge、iptables NAT/filter、
 * 組み込み DNS (127.0.0.11)、IPAM を仮想的に再現する。
 */

// ── 基本型 ──

export type IPv4 = string;
export type MacAddr = string;

/** ネットワークドライバー */
export type NetDriver = "bridge" | "host" | "none" | "overlay" | "macvlan" | "ipvlan";

/** IPAM サブネット */
export interface IpamSubnet {
  subnet: IPv4;
  gateway: IPv4;
  /** 割り当て範囲 */
  ipRange?: string;
}

/** IPAM 設定 */
export interface IpamConfig {
  driver: "default" | "custom";
  subnets: IpamSubnet[];
}

/** Docker ネットワーク */
export interface DockerNetwork {
  name: string;
  id: string;
  driver: NetDriver;
  ipam: IpamConfig;
  /** 内部ネットワーク (外部到達不可) */
  internal: boolean;
  /** ICC (Inter-Container Communication) */
  icc: boolean;
  /** Linux bridge 名 */
  bridgeName: string;
  /** MTU */
  mtu: number;
  /** VXLAN ID (overlay 用) */
  vxlanId?: number;
}

/** veth ペア */
export interface VethPair {
  hostEnd: string;
  containerEnd: string;
  bridgeName: string;
  containerId: string;
}

/** コンテナのネットワーク設定 */
export interface ContainerNetConfig {
  networkName: string;
  ip: IPv4;
  mac: MacAddr;
  gateway: IPv4;
  /** コンテナ内インターフェース名 */
  ifName: string;
  /** ホスト側 veth 名 */
  vethHost: string;
  /** DNS サーバー */
  dns: IPv4[];
  /** エイリアス (サービス名等) */
  aliases: string[];
}

/** コンテナ */
export interface Container {
  id: string;
  name: string;
  image: string;
  /** 接続しているネットワーク */
  networks: ContainerNetConfig[];
  /** ポートマッピング (hostPort:containerPort) */
  portMappings: { hostPort: number; containerPort: number; protocol: "tcp" | "udp" }[];
  /** 実行中か */
  running: boolean;
  /** PID namespace (ホストと共有 = host ネットワーク) */
  pidNamespace: string;
}

/** iptables ルール */
export interface IptablesRule {
  table: "nat" | "filter" | "mangle";
  chain: string;
  rule: string;
  target: string;
  comment?: string;
}

/** パケット */
export interface Packet {
  srcIp: IPv4;
  dstIp: IPv4;
  srcPort?: number;
  dstPort?: number;
  protocol: "tcp" | "udp" | "icmp";
  /** パケットサイズ */
  size: number;
  /** TTL */
  ttl: number;
  /** VXLAN encap か */
  vxlanEncap: boolean;
}

/** DNS クエリ */
export interface DnsQuery {
  name: string;
  type: "A" | "SRV" | "PTR";
  fromContainer: string;
}

/** シミュレーションイベント */
export interface SimEvent {
  time: number;
  layer: "Docker" | "Netns" | "Veth" | "Bridge" | "Iptables" | "NAT" | "DNS" | "VXLAN" | "Route" | "App";
  type: "create" | "packet" | "resolve" | "rule" | "info" | "error";
  detail: string;
}

/** シミュレーション設定 */
export interface SimConfig {
  networks: DockerNetwork[];
  containers: Container[];
  /** パケット送信シナリオ */
  packetFlows: PacketFlow[];
  /** DNS クエリシナリオ */
  dnsQueries: DnsQuery[];
}

/** パケットフロー (コンテナ間 or コンテナ→外部) */
export interface PacketFlow {
  from: string;
  to: string;
  dstPort: number;
  protocol: "tcp" | "udp" | "icmp";
  /** 外部宛てか */
  external: boolean;
}

/** シミュレーション結果 */
export interface SimResult {
  events: SimEvent[];
  /** 生成された iptables ルール */
  iptablesRules: IptablesRule[];
  /** 生成された veth ペア */
  vethPairs: VethPair[];
  /** DNS 解決結果 */
  dnsResults: { query: string; answer: string; fromContainer: string }[];
  /** パケット到達結果 */
  flowResults: { from: string; to: string; reached: boolean; reason: string; path: string[] }[];
  totalTime: number;
}

// ── ユーティリティ ──

let macSeq = 0;
/** Docker 風の MAC アドレスを生成する */
export function genMac(): MacAddr {
  macSeq++;
  const b = (n: number) => (n & 0xff).toString(16).padStart(2, "0");
  return `02:42:ac:11:${b(macSeq >> 8)}:${b(macSeq)}`;
}

let ipSeq = 0;
/** サブネットから次の IP を割り当てる */
export function allocateIp(subnet: IPv4, offset?: number): IPv4 {
  const parts = subnet.split("/")[0]!.split(".");
  const base = parseInt(parts[3]!) + (offset ?? ++ipSeq);
  return `${parts[0]}.${parts[1]}.${parts[2]}.${base}`;
}

/** ショート ID を生成する */
export function shortId(): string {
  return Math.random().toString(16).slice(2, 14);
}

/** bridge 名を生成する */
export function bridgeName(netName: string): string {
  if (netName === "bridge") return "docker0";
  return `br-${shortId().slice(0, 12)}`;
}

/** veth 名を生成する */
export function vethName(): string {
  return `veth${shortId().slice(0, 7)}`;
}

// ── シミュレーター ──

export class DockerNetSimulator {
  simulate(config: SimConfig): SimResult {
    const events: SimEvent[] = [];
    const iptablesRules: IptablesRule[] = [];
    const vethPairs: VethPair[] = [];
    const dnsResults: SimResult["dnsResults"] = [];
    const flowResults: SimResult["flowResults"] = [];
    let time = 0;

    // ── 1. ネットワーク作成 ──
    for (const net of config.networks) {
      time += 2;
      events.push({ time, layer: "Docker", type: "create", detail: `docker network create --driver ${net.driver} ${net.name}` });

      if (net.driver === "bridge") {
        events.push({ time, layer: "Bridge", type: "create", detail: `Linux bridge "${net.bridgeName}" 作成 (MTU=${net.mtu})` });
        for (const sub of net.ipam.subnets) {
          events.push({ time, layer: "Bridge", type: "create", detail: `${net.bridgeName} に ${sub.gateway} を割り当て (subnet=${sub.subnet})` });
        }
        // iptables ルール
        if (!net.internal) {
          const sub = net.ipam.subnets[0]!;
          const masq: IptablesRule = { table: "nat", chain: "POSTROUTING", rule: `-s ${sub.subnet} ! -o ${net.bridgeName}`, target: "MASQUERADE", comment: `${net.name} outbound NAT` };
          iptablesRules.push(masq);
          events.push({ time, layer: "Iptables", type: "rule", detail: `nat/POSTROUTING: ${masq.rule} → ${masq.target} (${masq.comment})` });
        }
        if (!net.icc) {
          const iccRule: IptablesRule = { table: "filter", chain: "DOCKER-ISOLATION", rule: `-i ${net.bridgeName} -o ${net.bridgeName}`, target: "DROP", comment: `${net.name} ICC disabled` };
          iptablesRules.push(iccRule);
          events.push({ time, layer: "Iptables", type: "rule", detail: `filter/DOCKER-ISOLATION: ${iccRule.rule} → DROP (ICC 無効)` });
        }
        if (net.internal) {
          const intRule: IptablesRule = { table: "filter", chain: "DOCKER-ISOLATION", rule: `-i ${net.bridgeName} ! -o ${net.bridgeName}`, target: "DROP", comment: `${net.name} internal` };
          iptablesRules.push(intRule);
          events.push({ time, layer: "Iptables", type: "rule", detail: `filter: ${net.name} は internal — 外部通信を DROP` });
        }
      } else if (net.driver === "overlay") {
        events.push({ time, layer: "VXLAN", type: "create", detail: `VXLAN tunnel 作成 (VNI=${net.vxlanId}, UDP:4789)` });
        events.push({ time, layer: "Bridge", type: "create", detail: `br0 (overlay namespace 内) 作成` });
      } else if (net.driver === "host") {
        events.push({ time, layer: "Netns", type: "info", detail: "host ドライバー: コンテナはホストのネットワーク名前空間を共有" });
      } else if (net.driver === "none") {
        events.push({ time, layer: "Netns", type: "info", detail: "none ドライバー: ループバックのみ (外部接続なし)" });
      } else if (net.driver === "macvlan") {
        events.push({ time, layer: "Netns", type: "create", detail: `macvlan: 親インターフェースに仮想 MAC を割り当て (mode=bridge)` });
      }
    }

    // ── 2. コンテナ接続 ──
    for (const ctn of config.containers) {
      time += 3;
      events.push({ time, layer: "Docker", type: "create", detail: `docker run ${ctn.name} (${ctn.image})` });

      for (const nc of ctn.networks) {
        const net = config.networks.find((n) => n.name === nc.networkName);
        if (!net) continue;

        if (net.driver === "bridge" || net.driver === "overlay") {
          // Network namespace 作成
          events.push({ time, layer: "Netns", type: "create", detail: `netns "${ctn.name}" 作成 (PID=${ctn.pidNamespace})` });

          // veth ペア
          const vp: VethPair = { hostEnd: nc.vethHost, containerEnd: nc.ifName, bridgeName: net.bridgeName, containerId: ctn.id };
          vethPairs.push(vp);
          events.push({ time, layer: "Veth", type: "create", detail: `veth ペア作成: ${vp.hostEnd} ↔ ${vp.containerEnd} (${ctn.name})` });
          events.push({ time, layer: "Veth", type: "create", detail: `${vp.hostEnd} → ${net.bridgeName} に接続` });
          events.push({ time, layer: "Veth", type: "create", detail: `${vp.containerEnd} → netns "${ctn.name}" に移動` });

          // IP/MAC 設定
          events.push({ time, layer: "Netns", type: "create", detail: `${nc.ifName}: ip=${nc.ip} mac=${nc.mac} gw=${nc.gateway}` });

          // DNS 設定
          events.push({ time, layer: "DNS", type: "create", detail: `/etc/resolv.conf: nameserver ${nc.dns.join(", ")} (組み込み DNS)` });

          // ルーティング
          events.push({ time, layer: "Route", type: "create", detail: `default via ${nc.gateway} dev ${nc.ifName}` });
        } else if (net.driver === "host") {
          events.push({ time, layer: "Netns", type: "info", detail: `${ctn.name}: ホストネットワーク名前空間を共有 (独自IP割り当てなし)` });
        } else if (net.driver === "none") {
          events.push({ time, layer: "Netns", type: "info", detail: `${ctn.name}: lo のみ (127.0.0.1)` });
        } else if (net.driver === "macvlan") {
          events.push({ time, layer: "Netns", type: "create", detail: `${ctn.name}: macvlan sub-if ip=${nc.ip} mac=${nc.mac}` });
        }
      }

      // ポートマッピング
      for (const pm of ctn.portMappings) {
        const nc = ctn.networks[0];
        if (!nc) continue;
        const dnatRule: IptablesRule = {
          table: "nat", chain: "DOCKER",
          rule: `-p ${pm.protocol} --dport ${pm.hostPort}`,
          target: `DNAT --to-destination ${nc.ip}:${pm.containerPort}`,
          comment: `${ctn.name} port mapping`,
        };
        iptablesRules.push(dnatRule);
        events.push({ time, layer: "NAT", type: "rule", detail: `DNAT: 0.0.0.0:${pm.hostPort} → ${nc.ip}:${pm.containerPort}/${pm.protocol} (${ctn.name})` });
      }
    }

    // ── 3. DNS 解決 ──
    for (const dq of config.dnsQueries) {
      time += 2;
      events.push({ time, layer: "DNS", type: "resolve", detail: `[${dq.fromContainer}] dig ${dq.name} ${dq.type} @127.0.0.11` });

      // コンテナ名 or エイリアスで解決
      let answer = "";
      for (const ctn of config.containers) {
        for (const nc of ctn.networks) {
          if (ctn.name === dq.name || nc.aliases.includes(dq.name)) {
            // 同一ネットワーク確認
            const fromCtn = config.containers.find((c) => c.name === dq.fromContainer);
            const sameNet = fromCtn?.networks.some((fn) => fn.networkName === nc.networkName);
            if (sameNet) { answer = nc.ip; break; }
          }
        }
        if (answer) break;
      }

      if (answer) {
        events.push({ time, layer: "DNS", type: "resolve", detail: `解決: ${dq.name} → ${answer} (組み込み DNS 127.0.0.11)` });
        dnsResults.push({ query: dq.name, answer, fromContainer: dq.fromContainer });
      } else {
        events.push({ time, layer: "DNS", type: "error", detail: `解決失敗: ${dq.name} (同一ネットワーク内にいない or 存在しない)` });
        dnsResults.push({ query: dq.name, answer: "NXDOMAIN", fromContainer: dq.fromContainer });
      }
    }

    // ── 4. パケットフロー ──
    for (const flow of config.packetFlows) {
      time += 5;
      const fromCtn = config.containers.find((c) => c.name === flow.from);
      const toCtn = config.containers.find((c) => c.name === flow.to);

      if (!fromCtn) {
        flowResults.push({ from: flow.from, to: flow.to, reached: false, reason: "送信元コンテナ不明", path: [] });
        continue;
      }

      const fromNc = fromCtn.networks[0];
      if (!fromNc) {
        events.push({ time, layer: "App", type: "error", detail: `${flow.from}: ネットワーク未接続` });
        flowResults.push({ from: flow.from, to: flow.to, reached: false, reason: "ネットワーク未接続", path: [] });
        continue;
      }

      const fromNet = config.networks.find((n) => n.name === fromNc.networkName);

      // none ドライバーチェック
      if (fromNet?.driver === "none") {
        events.push({ time, layer: "Netns", type: "error", detail: `${flow.from}: none ドライバー — 外部通信不可` });
        flowResults.push({ from: flow.from, to: flow.to, reached: false, reason: "none ドライバー", path: ["lo"] });
        continue;
      }

      events.push({ time, layer: "App", type: "packet", detail: `${flow.from} → ${flow.to}:${flow.dstPort}/${flow.protocol}` });

      if (flow.external) {
        // 外部通信
        const path = [fromNc.ifName, fromNc.vethHost, fromNet?.bridgeName ?? "?", "iptables(MASQUERADE)", "eth0", flow.to];
        if (fromNet?.internal) {
          events.push({ time, layer: "Iptables", type: "error", detail: `internal ネットワーク "${fromNet.name}" から外部通信は DROP` });
          flowResults.push({ from: flow.from, to: flow.to, reached: false, reason: "internal ネットワーク", path });
          continue;
        }
        events.push({ time, layer: "Veth", type: "packet", detail: `${fromNc.ifName} → ${fromNc.vethHost} (veth pair)` });
        events.push({ time, layer: "Bridge", type: "packet", detail: `${fromNet?.bridgeName}: MAC 学習 → ルーティング` });
        events.push({ time, layer: "NAT", type: "packet", detail: `POSTROUTING MASQUERADE: src=${fromNc.ip} → ホスト IP (SNAT)` });
        events.push({ time, layer: "Route", type: "packet", detail: `eth0 → ${flow.to} (外部)` });
        flowResults.push({ from: flow.from, to: flow.to, reached: true, reason: "NAT masquerade", path });
        continue;
      }

      // コンテナ間通信
      if (!toCtn) {
        flowResults.push({ from: flow.from, to: flow.to, reached: false, reason: "宛先コンテナ不明", path: [] });
        continue;
      }

      const toNc = toCtn.networks.find((nc) => fromCtn.networks.some((fn) => fn.networkName === nc.networkName));
      if (!toNc) {
        events.push({ time, layer: "Bridge", type: "error", detail: `${flow.from} と ${flow.to} は同一ネットワーク上にいない` });
        flowResults.push({ from: flow.from, to: flow.to, reached: false, reason: "異なるネットワーク", path: [] });
        continue;
      }

      const toNet = config.networks.find((n) => n.name === toNc.networkName);

      // ICC チェック
      if (toNet && !toNet.icc) {
        events.push({ time, layer: "Iptables", type: "error", detail: `ICC 無効: ${toNet.name} ではコンテナ間直接通信不可` });
        flowResults.push({ from: flow.from, to: flow.to, reached: false, reason: "ICC disabled", path: [fromNc.ifName, fromNc.vethHost, toNet.bridgeName, "DROP(ICC)"] });
        continue;
      }

      // Bridge 経由の通信
      const path: string[] = [];
      if (toNet?.driver === "bridge") {
        path.push(fromNc.ifName, fromNc.vethHost, toNet.bridgeName, toNc.vethHost, toNc.ifName);
        events.push({ time, layer: "Veth", type: "packet", detail: `${fromNc.ifName} → ${fromNc.vethHost}` });
        events.push({ time, layer: "Bridge", type: "packet", detail: `${toNet.bridgeName}: FDB lookup → ${toNc.mac} → ${toNc.vethHost}` });
        events.push({ time, layer: "Veth", type: "packet", detail: `${toNc.vethHost} → ${toNc.ifName} (${toCtn.name})` });
      } else if (toNet?.driver === "overlay") {
        path.push(fromNc.ifName, "br0", `VXLAN(VNI=${toNet.vxlanId})`, "br0", toNc.ifName);
        events.push({ time, layer: "Veth", type: "packet", detail: `${fromNc.ifName} → br0 (overlay)` });
        events.push({ time, layer: "VXLAN", type: "packet", detail: `VXLAN encap: VNI=${toNet.vxlanId} → UDP:4789 → リモートホスト` });
        events.push({ time, layer: "VXLAN", type: "packet", detail: `VXLAN decap → br0 → ${toNc.ifName} (${toCtn.name})` });
      } else if (toNet?.driver === "host") {
        path.push("host-stack");
        events.push({ time, layer: "Netns", type: "packet", detail: `host ネットワーク: ホストスタック経由で直接通信` });
      } else if (toNet?.driver === "macvlan") {
        path.push(fromNc.ifName, "parent-if", toNc.ifName);
        events.push({ time, layer: "Netns", type: "packet", detail: `macvlan: 親 IF 経由 → ${toNc.mac} → ${toCtn.name}` });
      }

      events.push({ time, layer: "App", type: "packet", detail: `${toCtn.name} がポート ${flow.dstPort}/${flow.protocol} で受信` });
      flowResults.push({ from: flow.from, to: flow.to, reached: true, reason: toNet?.driver ?? "bridge", path });
    }

    return { events, iptablesRules, vethPairs, dnsResults, flowResults, totalTime: time };
  }
}

// ── ヘルパー ──

export function createNetwork(name: string, driver: NetDriver, subnet: IPv4, gateway: IPv4, opts?: Partial<DockerNetwork>): DockerNetwork {
  return {
    name, id: shortId(), driver,
    ipam: { driver: "default", subnets: [{ subnet, gateway }] },
    internal: opts?.internal ?? false, icc: opts?.icc ?? true,
    bridgeName: opts?.bridgeName ?? bridgeName(name),
    mtu: opts?.mtu ?? 1500, vxlanId: opts?.vxlanId,
  };
}

export function createContainer(
  name: string, image: string, networks: ContainerNetConfig[],
  opts?: { ports?: Container["portMappings"]; running?: boolean },
): Container {
  return {
    id: shortId(), name, image, networks,
    portMappings: opts?.ports ?? [], running: opts?.running ?? true,
    pidNamespace: `pid-${shortId().slice(0, 6)}`,
  };
}

export function netConfig(networkName: string, ip: IPv4, gateway: IPv4, aliases?: string[]): ContainerNetConfig {
  return {
    networkName, ip, mac: genMac(), gateway,
    ifName: "eth0", vethHost: vethName(),
    dns: ["127.0.0.11"], aliases: aliases ?? [],
  };
}
