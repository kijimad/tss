/**
 * dhcp.ts — DHCP サーバーエミュレーションエンジン
 *
 * DHCP の DORA (Discover→Offer→Request→Ack) プロセス、
 * リース管理、アドレスプール、リレーエージェントをシミュレーションする。
 *
 * パイプライン:
 *   クライアント起動 → DHCPDISCOVER (broadcast) →
 *   DHCPOFFER → DHCPREQUEST → DHCPACK → リース確立
 *   → リース更新 (RENEW/REBIND) → リース解放 (RELEASE)
 */

// ── 基本型 ──

/** MAC アドレス (文字列表現) */
export type MacAddress = string;

/** IPv4 アドレス (文字列表現) */
export type IPv4 = string;

/** DHCP メッセージタイプ */
export type DhcpMessageType =
  | "DHCPDISCOVER"
  | "DHCPOFFER"
  | "DHCPREQUEST"
  | "DHCPACK"
  | "DHCPNAK"
  | "DHCPDECLINE"
  | "DHCPRELEASE"
  | "DHCPINFORM";

/** DHCP オプション */
export interface DhcpOption {
  code: number;
  name: string;
  value: string;
}

/** DHCP パケット */
export interface DhcpPacket {
  /** メッセージタイプ */
  op: "BOOTREQUEST" | "BOOTREPLY";
  /** ハードウェアタイプ (1 = Ethernet) */
  htype: number;
  /** ハードウェアアドレス長 */
  hlen: number;
  /** ホップ数 (リレー用) */
  hops: number;
  /** トランザクション ID */
  xid: number;
  /** 経過時間 (秒) */
  secs: number;
  /** フラグ (0x8000 = broadcast) */
  flags: number;
  /** クライアント IP (すでに持っている場合) */
  ciaddr: IPv4;
  /** 割り当て IP */
  yiaddr: IPv4;
  /** サーバー IP */
  siaddr: IPv4;
  /** リレーエージェント IP */
  giaddr: IPv4;
  /** クライアント MAC */
  chaddr: MacAddress;
  /** DHCP オプション */
  options: DhcpOption[];
  /** メッセージタイプ (Option 53 から抽出) */
  messageType: DhcpMessageType;
}

/** リース状態 */
export type LeaseState = "offered" | "bound" | "renewing" | "rebinding" | "expired" | "released";

/** DHCP リース */
export interface Lease {
  ip: IPv4;
  mac: MacAddress;
  hostname: string;
  state: LeaseState;
  /** リース開始時刻 (ms) */
  startTime: number;
  /** リース期間 (ms) */
  duration: number;
  /** T1 (更新タイマー、通常 duration/2) */
  t1: number;
  /** T2 (再バインドタイマー、通常 duration*7/8) */
  t2: number;
  /** 有効期限 (ms) */
  expiresAt: number;
}

/** アドレスプール */
export interface AddressPool {
  /** サブネット */
  subnet: IPv4;
  /** サブネットマスク */
  mask: IPv4;
  /** 割り当て範囲開始 */
  rangeStart: IPv4;
  /** 割り当て範囲終了 */
  rangeEnd: IPv4;
  /** デフォルトゲートウェイ */
  gateway: IPv4;
  /** DNS サーバー */
  dnsServers: IPv4[];
  /** ドメイン名 */
  domainName: string;
  /** デフォルトリース期間 (ms) */
  defaultLease: number;
  /** 最大リース期間 (ms) */
  maxLease: number;
  /** 予約アドレス (MAC→IP の固定マッピング) */
  reservations: Map<MacAddress, IPv4>;
}

/** ネットワークインターフェース (エミュレーション) */
export interface NetworkInterface {
  mac: MacAddress;
  hostname: string;
  /** 現在の IP (未取得なら "0.0.0.0") */
  ip: IPv4;
  /** 希望 IP (DHCPREQUEST 時に指定) */
  requestedIp?: IPv4;
}

/** リレーエージェント設定 */
export interface RelayAgent {
  /** リレーの IP */
  ip: IPv4;
  /** 転送先サーバー IP */
  serverIp: IPv4;
  /** リレー追加遅延 (ms) */
  latency: number;
}

/** シミュレーションイベント */
export interface SimEvent {
  time: number;
  type: "packet" | "lease" | "pool" | "error" | "relay" | "timer";
  direction: "client→server" | "server→client" | "broadcast" | "relay" | "internal";
  detail: string;
  packet?: DhcpPacket;
  clientMac?: MacAddress;
}

/** シミュレーション設定 */
export interface SimConfig {
  /** サーバー設定 */
  pool: AddressPool;
  /** クライアント一覧 */
  clients: NetworkInterface[];
  /** リレーエージェント (なければ同一サブネット) */
  relay?: RelayAgent;
  /** ネットワーク遅延 (ms) */
  networkLatency: number;
  /** シミュレーション時間上限 (ms) */
  maxTime: number;
  /** リース更新をシミュレーションするか */
  simulateRenewal: boolean;
  /** リース解放をシミュレーションするクライアント MAC */
  releaseClients: MacAddress[];
  /** DHCPDECLINE を送るクライアント MAC */
  declineClients: MacAddress[];
  /** 不正サーバーを模擬するか */
  rogueServer: boolean;
}

/** シミュレーション結果 */
export interface SimResult {
  events: SimEvent[];
  leases: Lease[];
  /** プール使用状況 */
  poolUsage: { total: number; used: number; available: number; reserved: number };
  /** クライアントごとの最終 IP */
  clientIps: Map<MacAddress, IPv4>;
  totalTime: number;
}

// ── IP アドレスユーティリティ ──

/** IPv4 を 32bit 整数に変換する */
export function ipToInt(ip: IPv4): number {
  const parts = ip.split(".");
  return ((parseInt(parts[0]!) << 24) | (parseInt(parts[1]!) << 16) | (parseInt(parts[2]!) << 8) | parseInt(parts[3]!)) >>> 0;
}

/** 32bit 整数を IPv4 に変換する */
export function intToIp(n: number): IPv4 {
  return `${(n >>> 24) & 0xff}.${(n >>> 16) & 0xff}.${(n >>> 8) & 0xff}.${n & 0xff}`;
}

/** サブネットに属するか判定する */
export function isInSubnet(ip: IPv4, subnet: IPv4, mask: IPv4): boolean {
  return (ipToInt(ip) & ipToInt(mask)) === (ipToInt(subnet) & ipToInt(mask));
}

/** アドレス範囲内の IP 数を計算する */
export function rangeSize(start: IPv4, end: IPv4): number {
  return ipToInt(end) - ipToInt(start) + 1;
}

/** ランダム MAC アドレスを生成する */
export function randomMac(): MacAddress {
  const hex = () => Math.floor(Math.random() * 256).toString(16).padStart(2, "0");
  return `02:${hex()}:${hex()}:${hex()}:${hex()}:${hex()}`;
}

/** ランダムなトランザクション ID を生成する */
export function randomXid(): number {
  return Math.floor(Math.random() * 0xffffffff);
}

// ── パケット生成 ──

/** DHCP オプションを作成する */
function opt(code: number, name: string, value: string): DhcpOption {
  return { code, name, value };
}

/** DHCPDISCOVER パケットを生成する */
export function createDiscover(client: NetworkInterface, xid: number, requestedIp?: IPv4): DhcpPacket {
  const options: DhcpOption[] = [
    opt(53, "DHCP Message Type", "DHCPDISCOVER"),
    opt(61, "Client Identifier", client.mac),
    opt(12, "Hostname", client.hostname),
    opt(55, "Parameter Request List", "1,3,6,15,51"),
  ];
  if (requestedIp) {
    options.push(opt(50, "Requested IP Address", requestedIp));
  }
  return {
    op: "BOOTREQUEST", htype: 1, hlen: 6, hops: 0, xid, secs: 0, flags: 0x8000,
    ciaddr: "0.0.0.0", yiaddr: "0.0.0.0", siaddr: "0.0.0.0", giaddr: "0.0.0.0",
    chaddr: client.mac, options, messageType: "DHCPDISCOVER",
  };
}

/** DHCPOFFER パケットを生成する */
export function createOffer(
  xid: number, offeredIp: IPv4, serverIp: IPv4, clientMac: MacAddress,
  pool: AddressPool, leaseDuration: number,
): DhcpPacket {
  return {
    op: "BOOTREPLY", htype: 1, hlen: 6, hops: 0, xid, secs: 0, flags: 0x8000,
    ciaddr: "0.0.0.0", yiaddr: offeredIp, siaddr: serverIp, giaddr: "0.0.0.0",
    chaddr: clientMac,
    options: [
      opt(53, "DHCP Message Type", "DHCPOFFER"),
      opt(54, "DHCP Server Identifier", serverIp),
      opt(51, "IP Address Lease Time", String(leaseDuration)),
      opt(1, "Subnet Mask", pool.mask),
      opt(3, "Router", pool.gateway),
      opt(6, "DNS Server", pool.dnsServers.join(",")),
      opt(15, "Domain Name", pool.domainName),
      opt(58, "Renewal Time (T1)", String(Math.floor(leaseDuration / 2))),
      opt(59, "Rebinding Time (T2)", String(Math.floor(leaseDuration * 7 / 8))),
    ],
    messageType: "DHCPOFFER",
  };
}

/** DHCPREQUEST パケットを生成する */
export function createRequest(
  client: NetworkInterface, xid: number, requestedIp: IPv4, serverIp: IPv4,
): DhcpPacket {
  return {
    op: "BOOTREQUEST", htype: 1, hlen: 6, hops: 0, xid, secs: 0, flags: 0x8000,
    ciaddr: "0.0.0.0", yiaddr: "0.0.0.0", siaddr: "0.0.0.0", giaddr: "0.0.0.0",
    chaddr: client.mac,
    options: [
      opt(53, "DHCP Message Type", "DHCPREQUEST"),
      opt(54, "DHCP Server Identifier", serverIp),
      opt(50, "Requested IP Address", requestedIp),
      opt(61, "Client Identifier", client.mac),
      opt(12, "Hostname", client.hostname),
    ],
    messageType: "DHCPREQUEST",
  };
}

/** DHCPACK パケットを生成する */
export function createAck(
  xid: number, assignedIp: IPv4, serverIp: IPv4, clientMac: MacAddress,
  pool: AddressPool, leaseDuration: number,
): DhcpPacket {
  return {
    op: "BOOTREPLY", htype: 1, hlen: 6, hops: 0, xid, secs: 0, flags: 0x8000,
    ciaddr: "0.0.0.0", yiaddr: assignedIp, siaddr: serverIp, giaddr: "0.0.0.0",
    chaddr: clientMac,
    options: [
      opt(53, "DHCP Message Type", "DHCPACK"),
      opt(54, "DHCP Server Identifier", serverIp),
      opt(51, "IP Address Lease Time", String(leaseDuration)),
      opt(1, "Subnet Mask", pool.mask),
      opt(3, "Router", pool.gateway),
      opt(6, "DNS Server", pool.dnsServers.join(",")),
      opt(15, "Domain Name", pool.domainName),
      opt(58, "Renewal Time (T1)", String(Math.floor(leaseDuration / 2))),
      opt(59, "Rebinding Time (T2)", String(Math.floor(leaseDuration * 7 / 8))),
    ],
    messageType: "DHCPACK",
  };
}

/** DHCPNAK パケットを生成する */
export function createNak(xid: number, serverIp: IPv4, clientMac: MacAddress, reason: string): DhcpPacket {
  return {
    op: "BOOTREPLY", htype: 1, hlen: 6, hops: 0, xid, secs: 0, flags: 0x8000,
    ciaddr: "0.0.0.0", yiaddr: "0.0.0.0", siaddr: serverIp, giaddr: "0.0.0.0",
    chaddr: clientMac,
    options: [
      opt(53, "DHCP Message Type", "DHCPNAK"),
      opt(54, "DHCP Server Identifier", serverIp),
      opt(56, "Message", reason),
    ],
    messageType: "DHCPNAK",
  };
}

/** DHCPRELEASE パケットを生成する */
export function createRelease(client: NetworkInterface, xid: number, serverIp: IPv4): DhcpPacket {
  return {
    op: "BOOTREQUEST", htype: 1, hlen: 6, hops: 0, xid, secs: 0, flags: 0,
    ciaddr: client.ip, yiaddr: "0.0.0.0", siaddr: "0.0.0.0", giaddr: "0.0.0.0",
    chaddr: client.mac,
    options: [
      opt(53, "DHCP Message Type", "DHCPRELEASE"),
      opt(54, "DHCP Server Identifier", serverIp),
      opt(61, "Client Identifier", client.mac),
    ],
    messageType: "DHCPRELEASE",
  };
}

/** DHCPDECLINE パケットを生成する */
export function createDecline(client: NetworkInterface, xid: number, serverIp: IPv4, declinedIp: IPv4): DhcpPacket {
  return {
    op: "BOOTREQUEST", htype: 1, hlen: 6, hops: 0, xid, secs: 0, flags: 0,
    ciaddr: "0.0.0.0", yiaddr: "0.0.0.0", siaddr: "0.0.0.0", giaddr: "0.0.0.0",
    chaddr: client.mac,
    options: [
      opt(53, "DHCP Message Type", "DHCPDECLINE"),
      opt(50, "Requested IP Address", declinedIp),
      opt(54, "DHCP Server Identifier", serverIp),
    ],
    messageType: "DHCPDECLINE",
  };
}

// ── DHCP サーバー ──

export class DhcpServer {
  private pool: AddressPool;
  private serverIp: IPv4;
  private leases: Map<MacAddress, Lease> = new Map();
  /** Decline された IP (一時的に使用不可) */
  private declinedIps: Set<IPv4> = new Set();
  /** 割り当て済み IP */
  private allocatedIps: Set<IPv4> = new Set();

  constructor(pool: AddressPool, serverIp: IPv4) {
    this.pool = pool;
    this.serverIp = serverIp;
  }

  /** 利用可能な IP を割り当てる */
  allocateIp(mac: MacAddress): IPv4 | undefined {
    // 予約チェック
    const reserved = this.pool.reservations.get(mac);
    if (reserved) return reserved;

    // 以前のリースがあればそれを再利用
    const existing = this.leases.get(mac);
    if (existing && !this.declinedIps.has(existing.ip)) return existing.ip;

    // プールから空きを探す
    const start = ipToInt(this.pool.rangeStart);
    const end = ipToInt(this.pool.rangeEnd);
    for (let i = start; i <= end; i++) {
      const candidate = intToIp(i);
      if (!this.allocatedIps.has(candidate) && !this.declinedIps.has(candidate)) {
        return candidate;
      }
    }
    return undefined;
  }

  /** DISCOVER を処理して OFFER を返す */
  handleDiscover(packet: DhcpPacket, time: number): { offer: DhcpPacket; ip: IPv4 } | { nak: DhcpPacket } {
    const ip = this.allocateIp(packet.chaddr);
    if (!ip) {
      return { nak: createNak(packet.xid, this.serverIp, packet.chaddr, "アドレスプール枯渇") };
    }
    this.allocatedIps.add(ip);
    const leaseDuration = this.pool.defaultLease;
    // Offered 状態のリースを仮作成
    this.leases.set(packet.chaddr, {
      ip, mac: packet.chaddr,
      hostname: packet.options.find((o) => o.code === 12)?.value ?? "unknown",
      state: "offered", startTime: time, duration: leaseDuration,
      t1: Math.floor(leaseDuration / 2),
      t2: Math.floor(leaseDuration * 7 / 8),
      expiresAt: time + leaseDuration,
    });
    return { offer: createOffer(packet.xid, ip, this.serverIp, packet.chaddr, this.pool, leaseDuration), ip };
  }

  /** REQUEST を処理して ACK/NAK を返す */
  handleRequest(packet: DhcpPacket, time: number): { ack: DhcpPacket } | { nak: DhcpPacket } {
    const requestedIp = packet.options.find((o) => o.code === 50)?.value;
    const lease = this.leases.get(packet.chaddr);

    if (!requestedIp || !lease || lease.ip !== requestedIp) {
      return { nak: createNak(packet.xid, this.serverIp, packet.chaddr, "要求 IP がリースと不一致") };
    }

    // リースを確定
    lease.state = "bound";
    lease.startTime = time;
    lease.expiresAt = time + lease.duration;

    return { ack: createAck(packet.xid, lease.ip, this.serverIp, packet.chaddr, this.pool, lease.duration) };
  }

  /** RELEASE を処理する */
  handleRelease(packet: DhcpPacket): void {
    const lease = this.leases.get(packet.chaddr);
    if (lease) {
      lease.state = "released";
      this.allocatedIps.delete(lease.ip);
    }
  }

  /** DECLINE を処理する (IP を使用不可にする) */
  handleDecline(packet: DhcpPacket): void {
    const declinedIp = packet.options.find((o) => o.code === 50)?.value;
    if (declinedIp) {
      this.declinedIps.add(declinedIp);
      this.allocatedIps.delete(declinedIp);
    }
    const lease = this.leases.get(packet.chaddr);
    if (lease) {
      lease.state = "released";
      this.leases.delete(packet.chaddr);
    }
  }

  /** リース更新 REQUEST (RENEW) を処理する */
  handleRenew(packet: DhcpPacket, time: number): { ack: DhcpPacket } | { nak: DhcpPacket } {
    const lease = this.leases.get(packet.chaddr);
    if (!lease || lease.state === "released" || lease.state === "expired") {
      return { nak: createNak(packet.xid, this.serverIp, packet.chaddr, "有効なリースなし") };
    }
    lease.state = "bound";
    lease.startTime = time;
    lease.expiresAt = time + lease.duration;
    return { ack: createAck(packet.xid, lease.ip, this.serverIp, packet.chaddr, this.pool, lease.duration) };
  }

  /** 期限切れリースを処理する */
  expireLeases(time: number): Lease[] {
    const expired: Lease[] = [];
    for (const [, lease] of this.leases) {
      if (lease.state === "bound" && time >= lease.expiresAt) {
        lease.state = "expired";
        this.allocatedIps.delete(lease.ip);
        expired.push(lease);
      }
    }
    return expired;
  }

  getLeases(): Lease[] {
    return [...this.leases.values()];
  }

  getPoolUsage(): { total: number; used: number; available: number; reserved: number } {
    const total = rangeSize(this.pool.rangeStart, this.pool.rangeEnd);
    const used = this.allocatedIps.size;
    const reserved = this.pool.reservations.size;
    return { total, used, available: total - used, reserved };
  }
}

// ── シミュレーター ──

export class DhcpSimulator {
  /** DHCP シミュレーションを実行する */
  simulate(config: SimConfig): SimResult {
    const events: SimEvent[] = [];
    const serverIp = config.pool.gateway;
    const server = new DhcpServer(config.pool, serverIp);
    const clientIps = new Map<MacAddress, IPv4>();
    let time = 0;
    const lat = config.networkLatency;

    // 各クライアントの DORA プロセスを実行
    for (const client of config.clients) {
      const xid = randomXid();

      // ── DHCPDISCOVER ──
      const discover = createDiscover(client, xid, client.requestedIp);
      events.push({
        time, type: "packet", direction: "broadcast",
        detail: `${client.hostname} (${client.mac}) → DHCPDISCOVER${client.requestedIp ? ` (希望: ${client.requestedIp})` : ""} [xid=0x${xid.toString(16)}]`,
        packet: discover, clientMac: client.mac,
      });

      // リレーエージェント経由の場合
      if (config.relay) {
        time += config.relay.latency;
        events.push({
          time, type: "relay", direction: "relay",
          detail: `リレーエージェント (${config.relay.ip}) が DISCOVER を ${config.relay.serverIp} へ転送 (giaddr=${config.relay.ip})`,
          clientMac: client.mac,
        });
        discover.giaddr = config.relay.ip;
        discover.hops = 1;
      }

      time += lat;

      // ── サーバー処理: OFFER ──
      const offerResult = server.handleDiscover(discover, time);
      if ("nak" in offerResult) {
        events.push({
          time, type: "error", direction: "server→client",
          detail: `DHCPNAK → ${client.hostname}: アドレスプール枯渇`,
          packet: offerResult.nak, clientMac: client.mac,
        });
        time += lat;
        continue;
      }

      events.push({
        time, type: "packet", direction: "server→client",
        detail: `サーバー → DHCPOFFER: ${offerResult.ip} を ${client.hostname} に提案 (リース: ${config.pool.defaultLease}ms)`,
        packet: offerResult.offer, clientMac: client.mac,
      });

      // 不正サーバーも OFFER を出す場合
      if (config.rogueServer) {
        events.push({
          time: time + 1, type: "error", direction: "server→client",
          detail: `⚠ 不正サーバー (192.168.1.254) → DHCPOFFER: 10.99.99.${Math.floor(Math.random() * 254) + 1} (偽の GW/DNS を含む)`,
          clientMac: client.mac,
        });
      }

      time += lat;

      // DECLINE 対象なら DECLINE を送って再 DISCOVER
      if (config.declineClients.includes(client.mac)) {
        const decline = createDecline(client, xid, serverIp, offerResult.ip);
        events.push({
          time, type: "packet", direction: "client→server",
          detail: `${client.hostname} → DHCPDECLINE: ${offerResult.ip} (IP 競合検出)`,
          packet: decline, clientMac: client.mac,
        });
        server.handleDecline(decline);
        events.push({
          time, type: "pool", direction: "internal",
          detail: `サーバー: ${offerResult.ip} を一時的に使用不可に設定`,
          clientMac: client.mac,
        });
        time += lat;

        // 再 DISCOVER
        const xid2 = randomXid();
        const discover2 = createDiscover(client, xid2);
        events.push({
          time, type: "packet", direction: "broadcast",
          detail: `${client.hostname} → 再 DHCPDISCOVER [xid=0x${xid2.toString(16)}]`,
          packet: discover2, clientMac: client.mac,
        });
        time += lat;

        const retry = server.handleDiscover(discover2, time);
        if ("nak" in retry) {
          events.push({ time, type: "error", direction: "server→client", detail: `DHCPNAK → ${client.hostname}: プール枯渇`, clientMac: client.mac });
          time += lat;
          continue;
        }
        events.push({
          time, type: "packet", direction: "server→client",
          detail: `サーバー → DHCPOFFER: ${retry.ip} (再割り当て)`,
          packet: retry.offer, clientMac: client.mac,
        });
        time += lat;

        // REQUEST
        const req2 = createRequest(client, xid2, retry.ip, serverIp);
        events.push({
          time, type: "packet", direction: "broadcast",
          detail: `${client.hostname} → DHCPREQUEST: ${retry.ip} を要求`,
          packet: req2, clientMac: client.mac,
        });
        time += lat;
        const ackResult2 = server.handleRequest(req2, time);
        if ("ack" in ackResult2) {
          events.push({
            time, type: "packet", direction: "server→client",
            detail: `サーバー → DHCPACK: ${retry.ip} を ${client.hostname} に確定`,
            packet: ackResult2.ack, clientMac: client.mac,
          });
          client.ip = retry.ip;
          clientIps.set(client.mac, retry.ip);
          events.push({
            time, type: "lease", direction: "internal",
            detail: `リース確立: ${client.hostname} = ${retry.ip} (期間: ${config.pool.defaultLease}ms)`,
            clientMac: client.mac,
          });
        }
        time += lat * 2;
        continue;
      }

      // ── DHCPREQUEST ──
      const request = createRequest(client, xid, offerResult.ip, serverIp);
      events.push({
        time, type: "packet", direction: "broadcast",
        detail: `${client.hostname} → DHCPREQUEST: ${offerResult.ip} を要求 (サーバー: ${serverIp})`,
        packet: request, clientMac: client.mac,
      });

      if (config.relay) {
        time += config.relay.latency;
        events.push({
          time, type: "relay", direction: "relay",
          detail: `リレーエージェント: REQUEST を転送`,
          clientMac: client.mac,
        });
      }

      time += lat;

      // ── サーバー処理: ACK ──
      const ackResult = server.handleRequest(request, time);
      if ("nak" in ackResult) {
        events.push({
          time, type: "error", direction: "server→client",
          detail: `DHCPNAK → ${client.hostname}: ${ackResult.nak.options.find((o) => o.code === 56)?.value}`,
          packet: ackResult.nak, clientMac: client.mac,
        });
        time += lat;
        continue;
      }

      events.push({
        time, type: "packet", direction: "server→client",
        detail: `サーバー → DHCPACK: ${offerResult.ip} を ${client.hostname} に確定`,
        packet: ackResult.ack, clientMac: client.mac,
      });

      client.ip = offerResult.ip;
      clientIps.set(client.mac, offerResult.ip);

      events.push({
        time, type: "lease", direction: "internal",
        detail: `リース確立: ${client.hostname} = ${offerResult.ip} (GW: ${config.pool.gateway}, DNS: ${config.pool.dnsServers.join(",")}, 期間: ${config.pool.defaultLease}ms)`,
        clientMac: client.mac,
      });

      time += lat * 2;
    }

    // ── リース更新シミュレーション ──
    if (config.simulateRenewal) {
      const leases = server.getLeases().filter((l) => l.state === "bound");
      for (const lease of leases) {
        const renewTime = lease.startTime + lease.t1;
        if (renewTime > config.maxTime) continue;

        time = renewTime;
        const client = config.clients.find((c) => c.mac === lease.mac);
        if (!client) continue;
        const xid = randomXid();

        events.push({
          time, type: "timer", direction: "internal",
          detail: `T1 タイマー満了: ${client.hostname} (${lease.ip}) がリース更新を開始`,
          clientMac: lease.mac,
        });

        // RENEW: unicast でサーバーに直接 REQUEST
        const renewReq = createRequest(client, xid, lease.ip, serverIp);
        renewReq.ciaddr = lease.ip;
        events.push({
          time, type: "packet", direction: "client→server",
          detail: `${client.hostname} → DHCPREQUEST (RENEW): ${lease.ip} のリース延長要求 (unicast)`,
          packet: renewReq, clientMac: lease.mac,
        });
        time += lat;

        const renewResult = server.handleRenew(renewReq, time);
        if ("ack" in renewResult) {
          events.push({
            time, type: "packet", direction: "server→client",
            detail: `サーバー → DHCPACK: ${lease.ip} のリース更新完了 (新期限: +${lease.duration}ms)`,
            packet: renewResult.ack, clientMac: lease.mac,
          });
          events.push({
            time, type: "lease", direction: "internal",
            detail: `リース更新: ${client.hostname} = ${lease.ip}`,
            clientMac: lease.mac,
          });
        }
      }
    }

    // ── リース解放 ──
    for (const mac of config.releaseClients) {
      const client = config.clients.find((c) => c.mac === mac);
      if (!client || client.ip === "0.0.0.0") continue;

      time += lat;
      const xid = randomXid();
      const release = createRelease(client, xid, serverIp);

      events.push({
        time, type: "packet", direction: "client→server",
        detail: `${client.hostname} → DHCPRELEASE: ${client.ip} を解放`,
        packet: release, clientMac: mac,
      });
      time += lat;
      server.handleRelease(release);
      events.push({
        time, type: "lease", direction: "internal",
        detail: `リース解放: ${client.hostname} (${client.ip}) → プールに返却`,
        clientMac: mac,
      });
      client.ip = "0.0.0.0";
      clientIps.delete(mac);
    }

    // ── リース期限切れ ──
    if (time < config.maxTime) {
      const expired = server.expireLeases(config.maxTime);
      for (const lease of expired) {
        events.push({
          time: lease.expiresAt, type: "timer", direction: "internal",
          detail: `リース期限切れ: ${lease.hostname} (${lease.ip}) — プールに返却`,
          clientMac: lease.mac,
        });
      }
    }

    // イベントを時刻順にソート
    events.sort((a, b) => a.time - b.time);

    return {
      events,
      leases: server.getLeases(),
      poolUsage: server.getPoolUsage(),
      clientIps,
      totalTime: Math.max(time, ...events.map((e) => e.time)),
    };
  }
}

// ── プリセット用ヘルパー ──

/** デフォルトのアドレスプールを作成する */
export function createPool(overrides?: Partial<AddressPool>): AddressPool {
  return {
    subnet: "192.168.1.0",
    mask: "255.255.255.0",
    rangeStart: "192.168.1.100",
    rangeEnd: "192.168.1.200",
    gateway: "192.168.1.1",
    dnsServers: ["8.8.8.8", "8.8.4.4"],
    domainName: "example.local",
    defaultLease: 3600000,
    maxLease: 7200000,
    reservations: new Map(),
    ...overrides,
  };
}

/** クライアントを作成する */
export function createClient(hostname: string, mac?: MacAddress, requestedIp?: IPv4): NetworkInterface {
  return { mac: mac ?? randomMac(), hostname, ip: "0.0.0.0", requestedIp };
}
