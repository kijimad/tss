/**
 * nmap.ts — ネットワークスキャナーエミュレーションエンジン
 *
 * 仮想ネットワーク上でポートスキャン、ホスト検出、
 * サービス検出、OS フィンガープリントをシミュレーションする。
 *
 * スキャンタイプ:
 *   SYN スキャン (-sS) / TCP Connect (-sT) / UDP (-sU) /
 *   FIN (-sF) / XMAS (-sX) / NULL (-sN) / Ping (-sn)
 */

// ── 基本型 ──

export type IPv4 = string;

/** ポートの状態 */
export type PortState = "open" | "closed" | "filtered" | "open|filtered" | "closed|filtered";

/** トランスポートプロトコル */
export type Protocol = "tcp" | "udp";

/** サービス情報 */
export interface ServiceInfo {
  name: string;
  product?: string;
  version?: string;
  extraInfo?: string;
  /** バナー (接続時に返される文字列) */
  banner?: string;
}

/** ポート定義 (ホストに紐づく) */
export interface PortDef {
  port: number;
  protocol: Protocol;
  state: PortState;
  service: ServiceInfo;
}

/** OS フィンガープリント */
export interface OsFingerprint {
  name: string;
  family: string;
  version: string;
  /** TTL の初期値 */
  ttl: number;
  /** TCP ウィンドウサイズ */
  windowSize: number;
  /** フィンガープリントの特徴 */
  tcpOptions: string;
  accuracy: number;
}

/** ファイアウォールルール */
export interface FirewallRule {
  /** 対象ポート (0 = 全ポート) */
  port: number;
  protocol: Protocol;
  action: "allow" | "drop" | "reject";
  /** 送信元 IP パターン (空 = 全て) */
  sourceIp?: string;
}

/** エミュレーション対象ホスト */
export interface Host {
  ip: IPv4;
  mac: string;
  hostname: string;
  /** ホストが起動しているか */
  up: boolean;
  /** ICMP echo に応答するか */
  icmpRespond: boolean;
  ports: PortDef[];
  os: OsFingerprint;
  firewall: FirewallRule[];
  /** ホップ数 (traceroute 用) */
  hops: number;
}

/** スキャンタイプ */
export type ScanType =
  | "syn"       // -sS SYN スキャン (ステルス)
  | "connect"   // -sT TCP Connect スキャン
  | "udp"       // -sU UDP スキャン
  | "fin"       // -sF FIN スキャン
  | "xmas"      // -sX Xmas スキャン (FIN+PSH+URG)
  | "null"      // -sN NULL スキャン
  | "ping";     // -sn Ping スキャン (ポートスキャンなし)

/** スキャン設定 */
export interface ScanConfig {
  /** スキャンタイプ */
  scanType: ScanType;
  /** 対象 IP リスト (CIDR や範囲も文字列で指定) */
  targets: IPv4[];
  /** スキャン対象ポート (空=デフォルト上位1000ポート相当) */
  ports: number[];
  /** サービス検出 (-sV) */
  serviceDetection: boolean;
  /** OS 検出 (-O) */
  osDetection: boolean;
  /** タイミングテンプレート (T0〜T5) */
  timing: number;
  /** 送信元 IP (スプーフィング表示用) */
  sourceIp: IPv4;
  /** ネットワーク遅延 (ms) */
  latencyMs: number;
}

/** スキャンイベント */
export interface ScanEvent {
  time: number;
  type: "probe_sent" | "probe_recv" | "host_discovery" | "port_result" | "service_detect" | "os_detect" | "info" | "warning";
  detail: string;
  targetIp?: IPv4;
  port?: number;
  protocol?: Protocol;
}

/** ポートスキャン結果 (1ポート) */
export interface PortResult {
  port: number;
  protocol: Protocol;
  state: PortState;
  service: ServiceInfo;
  /** プローブ→レスポンスの詳細 */
  reason: string;
}

/** ホストスキャン結果 */
export interface HostResult {
  ip: IPv4;
  hostname: string;
  mac: string;
  up: boolean;
  /** ホスト検出の理由 */
  upReason: string;
  ports: PortResult[];
  os?: { name: string; accuracy: number };
  hops: number;
  /** スキャン所要時間 */
  scanTime: number;
}

/** 全体のスキャン結果 */
export interface ScanResult {
  events: ScanEvent[];
  hosts: HostResult[];
  /** スキャンサマリ */
  summary: {
    hostsUp: number;
    hostsDown: number;
    hostsTotal: number;
    openPorts: number;
    closedPorts: number;
    filteredPorts: number;
    totalTime: number;
  };
  /** Nmap 風の出力テキスト */
  nmapOutput: string;
}

// ── ファイアウォール判定 ──

/** ファイアウォールルールを評価する */
export function evaluateFirewall(rules: FirewallRule[], port: number, protocol: Protocol, sourceIp: IPv4): "allow" | "drop" | "reject" {
  for (const rule of rules) {
    if (rule.port !== 0 && rule.port !== port) continue;
    if (rule.protocol !== protocol) continue;
    if (rule.sourceIp && rule.sourceIp !== sourceIp) continue;
    return rule.action;
  }
  // デフォルトは allow
  return "allow";
}

// ── プローブとレスポンスのシミュレーション ──

/** SYN スキャンのレスポンスを決定する */
export function synProbe(host: Host, port: number, sourceIp: IPv4): { state: PortState; reason: string; flags: string } {
  const fwAction = evaluateFirewall(host.firewall, port, "tcp", sourceIp);
  if (fwAction === "drop") return { state: "filtered", reason: "no-response (FW drop)", flags: "" };
  if (fwAction === "reject") return { state: "filtered", reason: "icmp-unreach (FW reject)", flags: "RST" };

  const portDef = host.ports.find((p) => p.port === port && p.protocol === "tcp");
  if (!portDef || portDef.state === "closed") {
    return { state: "closed", reason: "reset (RST)", flags: "RST,ACK" };
  }
  if (portDef.state === "open") {
    return { state: "open", reason: "syn-ack", flags: "SYN,ACK" };
  }
  return { state: portDef.state, reason: "no-response", flags: "" };
}

/** TCP Connect スキャンのレスポンスを決定する */
export function connectProbe(host: Host, port: number, sourceIp: IPv4): { state: PortState; reason: string } {
  const fwAction = evaluateFirewall(host.firewall, port, "tcp", sourceIp);
  if (fwAction === "drop") return { state: "filtered", reason: "timeout (FW drop)" };
  if (fwAction === "reject") return { state: "filtered", reason: "connection refused (FW reject)" };

  const portDef = host.ports.find((p) => p.port === port && p.protocol === "tcp");
  if (!portDef || portDef.state === "closed") {
    return { state: "closed", reason: "conn-refused" };
  }
  if (portDef.state === "open") {
    return { state: "open", reason: "connected (3-way handshake)" };
  }
  return { state: portDef.state, reason: "no-response" };
}

/** UDP スキャンのレスポンスを決定する */
export function udpProbe(host: Host, port: number, sourceIp: IPv4): { state: PortState; reason: string } {
  const fwAction = evaluateFirewall(host.firewall, port, "udp", sourceIp);
  if (fwAction === "drop") return { state: "open|filtered", reason: "no-response (FW or open)" };

  const portDef = host.ports.find((p) => p.port === port && p.protocol === "udp");
  if (!portDef || portDef.state === "closed") {
    return { state: "closed", reason: "icmp port-unreachable" };
  }
  if (portDef.state === "open") {
    return { state: "open", reason: "udp-response" };
  }
  return { state: "open|filtered", reason: "no-response" };
}

/** FIN/XMAS/NULL スキャンのレスポンスを決定する */
export function stealthProbe(host: Host, port: number, sourceIp: IPv4, scanType: "fin" | "xmas" | "null"): { state: PortState; reason: string; flags: string } {
  const fwAction = evaluateFirewall(host.firewall, port, "tcp", sourceIp);
  if (fwAction === "drop") return { state: "open|filtered", reason: "no-response (FW drop)", flags: "" };

  const portDef = host.ports.find((p) => p.port === port && p.protocol === "tcp");
  // RFC 793: open ポートは応答なし、closed ポートは RST を返す
  if (!portDef || portDef.state === "closed") {
    return { state: "closed", reason: "reset", flags: "RST,ACK" };
  }
  if (portDef.state === "open") {
    const flagNames = { fin: "FIN", xmas: "FIN,PSH,URG", null: "(none)" };
    return { state: "open|filtered", reason: `no-response (sent ${flagNames[scanType]})`, flags: "" };
  }
  return { state: portDef.state, reason: "no-response", flags: "" };
}

// ── スキャナー ──

export class NmapScanner {
  private network: Host[];

  constructor(network: Host[]) {
    this.network = network;
  }

  /** スキャンを実行する */
  scan(config: ScanConfig): ScanResult {
    const events: ScanEvent[] = [];
    const hostResults: HostResult[] = [];
    let time = 0;
    const baseDelay = Math.max(1, 6 - config.timing) * config.latencyMs;

    events.push({
      time, type: "info",
      detail: `Nmap スキャン開始: ${this.scanTypeLabel(config.scanType)} 対象=${config.targets.join(",")} ポート=${config.ports.length > 0 ? config.ports.join(",") : "default"} タイミング=T${config.timing}`,
    });

    for (const targetIp of config.targets) {
      const host = this.network.find((h) => h.ip === targetIp);
      time += baseDelay;

      // ── ホスト検出 ──
      if (!host) {
        events.push({ time, type: "host_discovery", detail: `${targetIp}: ホスト未検出 (ネットワークに存在しない)`, targetIp });
        hostResults.push({
          ip: targetIp, hostname: "", mac: "", up: false, upReason: "no-route",
          ports: [], hops: 0, scanTime: baseDelay,
        });
        continue;
      }

      if (!host.up) {
        events.push({ time, type: "host_discovery", detail: `${targetIp} (${host.hostname}): ホストダウン`, targetIp });
        hostResults.push({
          ip: targetIp, hostname: host.hostname, mac: host.mac, up: false, upReason: "host-down",
          ports: [], hops: host.hops, scanTime: baseDelay,
        });
        continue;
      }

      // Ping チェック
      let upReason: string;
      if (host.icmpRespond) {
        events.push({ time, type: "probe_sent", detail: `→ ${targetIp}: ICMP Echo Request`, targetIp });
        time += baseDelay;
        events.push({ time, type: "probe_recv", detail: `← ${targetIp}: ICMP Echo Reply (TTL=${host.os.ttl})`, targetIp });
        upReason = "echo-reply";
      } else {
        // ICMP 応答なし → ARP / TCP probe で判定
        events.push({ time, type: "probe_sent", detail: `→ ${targetIp}: ICMP Echo Request (応答なし)`, targetIp });
        time += baseDelay;
        events.push({ time, type: "probe_sent", detail: `→ ${targetIp}: TCP SYN probe :80,:443`, targetIp });
        time += baseDelay;
        const has80 = host.ports.some((p) => p.port === 80 && p.state === "open");
        const has443 = host.ports.some((p) => p.port === 443 && p.state === "open");
        if (has80 || has443) {
          events.push({ time, type: "probe_recv", detail: `← ${targetIp}: SYN-ACK (ポート ${has80 ? 80 : 443})`, targetIp });
          upReason = "syn-ack";
        } else {
          events.push({ time, type: "probe_recv", detail: `← ${targetIp}: ARP Reply (${host.mac})`, targetIp });
          upReason = "arp-response";
        }
      }

      events.push({ time, type: "host_discovery", detail: `${targetIp} (${host.hostname}): ホスト稼働中 [${upReason}]`, targetIp });

      // Ping スキャンならポートスキャンをスキップ
      if (config.scanType === "ping") {
        hostResults.push({
          ip: targetIp, hostname: host.hostname, mac: host.mac, up: true, upReason,
          ports: [], hops: host.hops, scanTime: time,
        });
        continue;
      }

      // ── ポートスキャン ──
      const portsToScan = config.ports.length > 0 ? config.ports : this.defaultPorts();
      const portResults: PortResult[] = [];
      const hostScanStart = time;

      for (const port of portsToScan) {
        time += Math.max(1, baseDelay * 0.3);
        const protocol: Protocol = config.scanType === "udp" ? "udp" : "tcp";

        let probeResult: { state: PortState; reason: string; flags?: string };
        let probeDetail: string;
        let recvDetail: string;

        switch (config.scanType) {
          case "syn": {
            const r = synProbe(host, port, config.sourceIp);
            probeResult = r;
            probeDetail = `→ ${targetIp}:${port} SYN`;
            recvDetail = r.flags ? `← ${targetIp}:${port} ${r.flags}` : `← ${targetIp}:${port} (no response)`;
            break;
          }
          case "connect": {
            const r = connectProbe(host, port, config.sourceIp);
            probeResult = r;
            probeDetail = `→ ${targetIp}:${port} TCP Connect`;
            recvDetail = r.state === "open" ? `← ${targetIp}:${port} Connected` : `← ${targetIp}:${port} ${r.reason}`;
            break;
          }
          case "udp": {
            const r = udpProbe(host, port, config.sourceIp);
            probeResult = r;
            probeDetail = `→ ${targetIp}:${port}/udp probe`;
            recvDetail = r.state === "closed" ? `← ${targetIp}:${port} ICMP port-unreachable` : `← ${targetIp}:${port} ${r.reason}`;
            break;
          }
          case "fin":
          case "xmas":
          case "null": {
            const r = stealthProbe(host, port, config.sourceIp, config.scanType);
            probeResult = r;
            const flagMap = { fin: "FIN", xmas: "FIN,PSH,URG", null: "(no flags)" };
            probeDetail = `→ ${targetIp}:${port} ${flagMap[config.scanType]}`;
            recvDetail = r.flags ? `← ${targetIp}:${port} ${r.flags}` : `← ${targetIp}:${port} (no response)`;
            break;
          }
          default:
            continue;
        }

        events.push({ time, type: "probe_sent", detail: probeDetail, targetIp, port, protocol });
        time += baseDelay * (probeResult.state === "filtered" || probeResult.state === "open|filtered" ? 2 : 0.5);
        events.push({ time, type: "probe_recv", detail: recvDetail, targetIp, port, protocol });

        // サービス情報
        const portDef = host.ports.find((p) => p.port === port && p.protocol === protocol);
        const service = portDef?.service ?? { name: "unknown" };

        portResults.push({ port, protocol, state: probeResult.state, service, reason: probeResult.reason });

        events.push({
          time, type: "port_result",
          detail: `${targetIp}:${port}/${protocol} = ${probeResult.state} (${probeResult.reason})`,
          targetIp, port, protocol,
        });
      }

      // ── サービス検出 ──
      if (config.serviceDetection) {
        const openPorts = portResults.filter((p) => p.state === "open");
        for (const pr of openPorts) {
          time += baseDelay;
          const portDef = host.ports.find((p) => p.port === pr.port && p.protocol === pr.protocol);
          if (portDef?.service.banner) {
            events.push({
              time, type: "service_detect",
              detail: `${targetIp}:${pr.port} バナー取得: "${portDef.service.banner}"`,
              targetIp, port: pr.port,
            });
          }
          if (portDef?.service.product) {
            pr.service = { ...portDef.service };
            events.push({
              time, type: "service_detect",
              detail: `${targetIp}:${pr.port} → ${pr.service.product ?? ""} ${pr.service.version ?? ""}`.trim(),
              targetIp, port: pr.port,
            });
          }
        }
      }

      // ── OS 検出 ──
      let osResult: { name: string; accuracy: number } | undefined;
      if (config.osDetection && portResults.some((p) => p.state === "open")) {
        time += baseDelay * 2;
        events.push({ time, type: "os_detect", detail: `${targetIp}: TCP/IP フィンガープリントプローブ送信 (TTL=${host.os.ttl}, Window=${host.os.windowSize})`, targetIp });
        time += baseDelay;
        events.push({
          time, type: "os_detect",
          detail: `${targetIp}: OS 推定 → ${host.os.name} (${host.os.family} ${host.os.version}) 精度=${host.os.accuracy}%`,
          targetIp,
        });
        osResult = { name: `${host.os.name} (${host.os.family} ${host.os.version})`, accuracy: host.os.accuracy };
      }

      const scanTime = time - hostScanStart;
      hostResults.push({
        ip: targetIp, hostname: host.hostname, mac: host.mac, up: true, upReason,
        ports: portResults, os: osResult, hops: host.hops, scanTime,
      });
    }

    // サマリ
    const hostsUp = hostResults.filter((h) => h.up).length;
    const allPorts = hostResults.flatMap((h) => h.ports);
    const summary = {
      hostsUp,
      hostsDown: hostResults.length - hostsUp,
      hostsTotal: hostResults.length,
      openPorts: allPorts.filter((p) => p.state === "open").length,
      closedPorts: allPorts.filter((p) => p.state === "closed").length,
      filteredPorts: allPorts.filter((p) => p.state === "filtered" || p.state === "open|filtered").length,
      totalTime: time,
    };

    events.push({
      time, type: "info",
      detail: `スキャン完了: ${summary.hostsUp} hosts up, ${summary.hostsDown} down (${summary.hostsTotal} total) — ${time.toFixed(0)}ms`,
    });

    const nmapOutput = this.formatNmapOutput(config, hostResults, summary);

    return { events, hosts: hostResults, summary, nmapOutput };
  }

  /** デフォルトスキャンポート (よく使われる上位ポート) */
  private defaultPorts(): number[] {
    return [21, 22, 23, 25, 53, 80, 110, 111, 135, 139, 143, 443, 445, 993, 995, 1723, 3306, 3389, 5432, 5900, 8080, 8443];
  }

  private scanTypeLabel(st: ScanType): string {
    switch (st) {
      case "syn":     return "SYN Stealth Scan (-sS)";
      case "connect": return "TCP Connect Scan (-sT)";
      case "udp":     return "UDP Scan (-sU)";
      case "fin":     return "FIN Scan (-sF)";
      case "xmas":    return "Xmas Scan (-sX)";
      case "null":    return "NULL Scan (-sN)";
      case "ping":    return "Ping Scan (-sn)";
    }
  }

  /** Nmap 風のテキスト出力を生成する */
  private formatNmapOutput(config: ScanConfig, hosts: HostResult[], summary: ScanResult["summary"]): string {
    const lines: string[] = [];
    lines.push(`Starting Nmap (sim) at ${new Date().toISOString()}`);
    lines.push(`Scan type: ${this.scanTypeLabel(config.scanType)}`);
    lines.push("");

    for (const h of hosts) {
      if (!h.up) {
        lines.push(`Nmap scan report for ${h.hostname || h.ip}`);
        lines.push(`Host is down.`);
        lines.push("");
        continue;
      }

      lines.push(`Nmap scan report for ${h.hostname} (${h.ip})`);
      lines.push(`Host is up (latency ${config.latencyMs}ms).`);
      if (h.mac) lines.push(`MAC Address: ${h.mac}`);

      if (h.ports.length > 0) {
        const notShown = h.ports.filter((p) => p.state === "closed").length;
        if (notShown > 0) lines.push(`Not shown: ${notShown} closed ports`);
        lines.push(`PORT      STATE          SERVICE`);
        for (const p of h.ports.filter((pr) => pr.state !== "closed")) {
          const portStr = `${p.port}/${p.protocol}`.padEnd(10);
          const stateStr = p.state.padEnd(15);
          const svc = p.service.product ? `${p.service.name} ${p.service.product} ${p.service.version ?? ""}`.trim() : p.service.name;
          lines.push(`${portStr}${stateStr}${svc}`);
        }
      }

      if (h.os) {
        lines.push(`OS details: ${h.os.name} (accuracy: ${h.os.accuracy}%)`);
      }
      lines.push("");
    }

    lines.push(`Nmap done: ${summary.hostsTotal} IP address (${summary.hostsUp} host up) scanned in ${(summary.totalTime / 1000).toFixed(2)}s`);
    return lines.join("\n");
  }
}

// ── ネットワーク構築ヘルパー ──

/** よくあるサービス定義 */
export const KNOWN_SERVICES: Record<string, ServiceInfo> = {
  ftp:    { name: "ftp",    product: "vsftpd",            version: "3.0.5",  banner: "220 (vsFTPd 3.0.5)" },
  ssh:    { name: "ssh",    product: "OpenSSH",           version: "9.6p1",  banner: "SSH-2.0-OpenSSH_9.6p1 Ubuntu-3" },
  telnet: { name: "telnet", product: "Linux telnetd",     version: "",       banner: "Login:" },
  smtp:   { name: "smtp",   product: "Postfix smtpd",     version: "",       banner: "220 mail.example.com ESMTP Postfix" },
  dns:    { name: "domain", product: "BIND",              version: "9.18.24" },
  http:   { name: "http",   product: "nginx",             version: "1.24.0", banner: "HTTP/1.1 200 OK\r\nServer: nginx/1.24.0" },
  pop3:   { name: "pop3",   product: "Dovecot pop3d",     version: "" },
  imap:   { name: "imap",   product: "Dovecot imapd",     version: "" },
  https:  { name: "https",  product: "nginx",             version: "1.24.0" },
  smb:    { name: "microsoft-ds", product: "Samba smbd",  version: "4.19" },
  mysql:  { name: "mysql",  product: "MySQL",             version: "8.0.36", banner: "5.7.42-log" },
  rdp:    { name: "ms-wbt-server", product: "Microsoft Terminal Services" },
  pg:     { name: "postgresql", product: "PostgreSQL",    version: "16.2" },
  vnc:    { name: "vnc",    product: "RealVNC",           version: "5.3" },
  httpAlt:{ name: "http-proxy", product: "Apache httpd",  version: "2.4.58", banner: "HTTP/1.1 200 OK\r\nServer: Apache/2.4.58" },
  dnsUdp: { name: "domain", product: "BIND",             version: "9.18.24" },
  ntp:    { name: "ntp",    product: "ntpd",              version: "4.2.8" },
  snmp:   { name: "snmp",   product: "net-snmp",          version: "5.9.4" },
};

/** Linux サーバーの OS フィンガープリント */
export const OS_LINUX: OsFingerprint = {
  name: "Linux", family: "Linux", version: "6.5", ttl: 64, windowSize: 65535,
  tcpOptions: "MSS,SackOK,TS,NOP,WScale", accuracy: 95,
};

/** Windows サーバーの OS フィンガープリント */
export const OS_WINDOWS: OsFingerprint = {
  name: "Windows Server", family: "Windows", version: "2022", ttl: 128, windowSize: 65535,
  tcpOptions: "MSS,NOP,WScale,NOP,NOP,TS,SackOK", accuracy: 92,
};

/** FreeBSD の OS フィンガープリント */
export const OS_FREEBSD: OsFingerprint = {
  name: "FreeBSD", family: "FreeBSD", version: "14.0", ttl: 64, windowSize: 65535,
  tcpOptions: "MSS,NOP,WScale,SackOK,TS", accuracy: 88,
};

/** ネットワーク機器の OS フィンガープリント */
export const OS_CISCO: OsFingerprint = {
  name: "Cisco IOS", family: "Cisco", version: "15.2", ttl: 255, windowSize: 4128,
  tcpOptions: "MSS", accuracy: 90,
};

/** ホストを簡単に作成する */
export function createHost(
  ip: IPv4,
  hostname: string,
  ports: PortDef[],
  os: OsFingerprint,
  options?: { mac?: string; icmpRespond?: boolean; firewall?: FirewallRule[]; up?: boolean; hops?: number },
): Host {
  return {
    ip,
    mac: options?.mac ?? `02:00:${ip.split(".").map((o) => parseInt(o).toString(16).padStart(2, "0")).join(":")}`,
    hostname,
    up: options?.up ?? true,
    icmpRespond: options?.icmpRespond ?? true,
    ports,
    os,
    firewall: options?.firewall ?? [],
    hops: options?.hops ?? 1,
  };
}

/** TCP ポートを定義する */
export function tcp(port: number, state: PortState, service: ServiceInfo): PortDef {
  return { port, protocol: "tcp", state, service };
}

/** UDP ポートを定義する */
export function udp(port: number, state: PortState, service: ServiceInfo): PortDef {
  return { port, protocol: "udp", state, service };
}
