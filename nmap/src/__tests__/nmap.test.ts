import { describe, it, expect } from "vitest";
import {
  evaluateFirewall, synProbe, connectProbe, udpProbe, stealthProbe,
  NmapScanner, createHost, tcp, udp,
  KNOWN_SERVICES, OS_LINUX, OS_WINDOWS, OS_FREEBSD, OS_CISCO,
} from "../engine/nmap.js";
import { EXPERIMENTS } from "../ui/app.js";
import type { Host, FirewallRule, ScanConfig } from "../engine/nmap.js";

// ── ファイアウォール ──

describe("evaluateFirewall", () => {
  const rules: FirewallRule[] = [
    { port: 80, protocol: "tcp", action: "allow" },
    { port: 3306, protocol: "tcp", action: "drop" },
    { port: 22, protocol: "tcp", action: "allow", sourceIp: "10.0.0.1" },
    { port: 0, protocol: "tcp", action: "reject" },
  ];

  it("許可ルールにマッチする", () => {
    expect(evaluateFirewall(rules, 80, "tcp", "any")).toBe("allow");
  });

  it("DROP ルールにマッチする", () => {
    expect(evaluateFirewall(rules, 3306, "tcp", "any")).toBe("drop");
  });

  it("送信元 IP が一致しないとスキップされる", () => {
    // port 22 は sourceIp=10.0.0.1 のみ allow、それ以外はデフォルトの port=0 reject
    expect(evaluateFirewall(rules, 22, "tcp", "10.0.0.1")).toBe("allow");
    expect(evaluateFirewall(rules, 22, "tcp", "192.168.1.1")).toBe("reject");
  });

  it("ルールなしの場合は allow", () => {
    expect(evaluateFirewall([], 80, "tcp", "any")).toBe("allow");
  });
});

// ── プローブ ──

describe("synProbe", () => {
  const host = createHost("10.0.0.1", "test", [
    tcp(80, "open", KNOWN_SERVICES.http!),
    tcp(443, "open", KNOWN_SERVICES.https!),
  ], OS_LINUX);

  it("open ポートに SYN/ACK を返す", () => {
    const r = synProbe(host, 80, "any");
    expect(r.state).toBe("open");
    expect(r.flags).toBe("SYN,ACK");
  });

  it("closed ポートに RST を返す", () => {
    const r = synProbe(host, 22, "any");
    expect(r.state).toBe("closed");
    expect(r.flags).toBe("RST,ACK");
  });

  it("ファイアウォール DROP で filtered になる", () => {
    const fw = createHost("10.0.0.2", "fw", [tcp(80, "open", KNOWN_SERVICES.http!)], OS_LINUX, {
      firewall: [{ port: 80, protocol: "tcp", action: "drop" }],
    });
    const r = synProbe(fw, 80, "any");
    expect(r.state).toBe("filtered");
  });
});

describe("connectProbe", () => {
  const host = createHost("10.0.0.1", "test", [tcp(22, "open", KNOWN_SERVICES.ssh!)], OS_LINUX);

  it("open ポートで connected", () => {
    expect(connectProbe(host, 22, "any").state).toBe("open");
  });

  it("closed ポートで conn-refused", () => {
    const r = connectProbe(host, 80, "any");
    expect(r.state).toBe("closed");
    expect(r.reason).toContain("conn-refused");
  });
});

describe("udpProbe", () => {
  const host = createHost("10.0.0.1", "test", [udp(53, "open", KNOWN_SERVICES.dnsUdp!)], OS_LINUX);

  it("open ポートに応答する", () => {
    expect(udpProbe(host, 53, "any").state).toBe("open");
  });

  it("closed ポートで ICMP unreachable", () => {
    const r = udpProbe(host, 161, "any");
    expect(r.state).toBe("closed");
  });

  it("DROP ファイアウォールで open|filtered", () => {
    const fw = createHost("10.0.0.2", "fw", [udp(53, "open", KNOWN_SERVICES.dnsUdp!)], OS_LINUX, {
      firewall: [{ port: 53, protocol: "udp", action: "drop" }],
    });
    expect(udpProbe(fw, 53, "any").state).toBe("open|filtered");
  });
});

describe("stealthProbe (FIN/XMAS/NULL)", () => {
  const host = createHost("10.0.0.1", "test", [tcp(80, "open", KNOWN_SERVICES.http!)], OS_LINUX);

  it("open ポートで open|filtered (応答なし)", () => {
    expect(stealthProbe(host, 80, "any", "fin").state).toBe("open|filtered");
    expect(stealthProbe(host, 80, "any", "xmas").state).toBe("open|filtered");
    expect(stealthProbe(host, 80, "any", "null").state).toBe("open|filtered");
  });

  it("closed ポートで RST", () => {
    expect(stealthProbe(host, 22, "any", "fin").state).toBe("closed");
    expect(stealthProbe(host, 22, "any", "xmas").flags).toBe("RST,ACK");
  });
});

// ── スキャナー ──

describe("NmapScanner", () => {
  const network: Host[] = [
    createHost("10.0.0.1", "web", [tcp(80, "open", KNOWN_SERVICES.http!), tcp(443, "open", KNOWN_SERVICES.https!)], OS_LINUX),
    createHost("10.0.0.2", "db", [tcp(3306, "open", KNOWN_SERVICES.mysql!)], OS_LINUX, { icmpRespond: false }),
    createHost("10.0.0.3", "down", [], OS_LINUX, { up: false }),
  ];

  const baseConfig: ScanConfig = {
    scanType: "syn", targets: ["10.0.0.1"], ports: [22, 80, 443],
    serviceDetection: false, osDetection: false, timing: 4,
    sourceIp: "10.0.0.100", latencyMs: 5,
  };

  it("基本 SYN スキャンが完了する", () => {
    const scanner = new NmapScanner(network);
    const result = scanner.scan(baseConfig);
    expect(result.hosts).toHaveLength(1);
    expect(result.hosts[0]!.up).toBe(true);
    expect(result.hosts[0]!.ports.length).toBe(3);
    expect(result.summary.openPorts).toBe(2);
    expect(result.summary.closedPorts).toBe(1);
  });

  it("ダウンホストを検出する", () => {
    const scanner = new NmapScanner(network);
    const result = scanner.scan({ ...baseConfig, targets: ["10.0.0.3"] });
    expect(result.hosts[0]!.up).toBe(false);
    expect(result.summary.hostsDown).toBe(1);
  });

  it("存在しないホストを処理する", () => {
    const scanner = new NmapScanner(network);
    const result = scanner.scan({ ...baseConfig, targets: ["10.0.0.99"] });
    expect(result.hosts[0]!.up).toBe(false);
  });

  it("ICMP 非応答ホストも検出する", () => {
    const scanner = new NmapScanner(network);
    const result = scanner.scan({ ...baseConfig, targets: ["10.0.0.2"], ports: [3306] });
    expect(result.hosts[0]!.up).toBe(true);
    expect(result.hosts[0]!.upReason).not.toBe("echo-reply");
  });

  it("Ping スキャンでポートなし結果を返す", () => {
    const scanner = new NmapScanner(network);
    const result = scanner.scan({
      ...baseConfig, scanType: "ping", targets: ["10.0.0.1", "10.0.0.3"],
    });
    expect(result.hosts[0]!.up).toBe(true);
    expect(result.hosts[0]!.ports).toHaveLength(0);
    expect(result.hosts[1]!.up).toBe(false);
  });

  it("サービス検出が動作する", () => {
    const scanner = new NmapScanner(network);
    const result = scanner.scan({ ...baseConfig, serviceDetection: true });
    const httpPort = result.hosts[0]!.ports.find((p) => p.port === 80);
    expect(httpPort?.service.product).toBe("nginx");
  });

  it("OS 検出が動作する", () => {
    const scanner = new NmapScanner(network);
    const result = scanner.scan({ ...baseConfig, osDetection: true });
    expect(result.hosts[0]!.os).toBeDefined();
    expect(result.hosts[0]!.os!.name).toContain("Linux");
  });

  it("Nmap 風出力が生成される", () => {
    const scanner = new NmapScanner(network);
    const result = scanner.scan(baseConfig);
    expect(result.nmapOutput).toContain("Nmap scan report");
    expect(result.nmapOutput).toContain("Host is up");
    expect(result.nmapOutput).toContain("PORT");
  });

  it("複数ホストスキャンが動作する", () => {
    const scanner = new NmapScanner(network);
    const result = scanner.scan({
      ...baseConfig, targets: ["10.0.0.1", "10.0.0.2", "10.0.0.3"],
    });
    expect(result.hosts).toHaveLength(3);
    expect(result.summary.hostsUp).toBe(2);
    expect(result.summary.hostsDown).toBe(1);
  });

  it("全スキャンタイプが動作する", () => {
    const scanner = new NmapScanner(network);
    const types: ScanConfig["scanType"][] = ["syn", "connect", "udp", "fin", "xmas", "null", "ping"];
    for (const scanType of types) {
      const result = scanner.scan({ ...baseConfig, scanType, ports: [80] });
      expect(result.events.length).toBeGreaterThan(0);
    }
  });

  it("タイミングが速いほどスキャン時間が短い", () => {
    const scanner = new NmapScanner(network);
    const slow = scanner.scan({ ...baseConfig, timing: 1 });
    const fast = scanner.scan({ ...baseConfig, timing: 5 });
    expect(fast.summary.totalTime).toBeLessThan(slow.summary.totalTime);
  });
});

// ── ヘルパー ──

describe("createHost", () => {
  it("ホストを作成する", () => {
    const h = createHost("10.0.0.1", "test", [], OS_LINUX);
    expect(h.ip).toBe("10.0.0.1");
    expect(h.hostname).toBe("test");
    expect(h.up).toBe(true);
    expect(h.icmpRespond).toBe(true);
  });

  it("オプションが反映される", () => {
    const h = createHost("10.0.0.1", "test", [], OS_LINUX, { up: false, icmpRespond: false, hops: 3 });
    expect(h.up).toBe(false);
    expect(h.icmpRespond).toBe(false);
    expect(h.hops).toBe(3);
  });
});

describe("tcp / udp", () => {
  it("TCP ポートを定義する", () => {
    const p = tcp(80, "open", KNOWN_SERVICES.http!);
    expect(p.port).toBe(80);
    expect(p.protocol).toBe("tcp");
    expect(p.state).toBe("open");
  });

  it("UDP ポートを定義する", () => {
    const p = udp(53, "open", KNOWN_SERVICES.dnsUdp!);
    expect(p.protocol).toBe("udp");
  });
});

describe("OS フィンガープリント", () => {
  it("各 OS プリセットが定義されている", () => {
    expect(OS_LINUX.ttl).toBe(64);
    expect(OS_WINDOWS.ttl).toBe(128);
    expect(OS_FREEBSD.ttl).toBe(64);
    expect(OS_CISCO.ttl).toBe(255);
  });
});

describe("KNOWN_SERVICES", () => {
  it("主要サービスが定義されている", () => {
    expect(KNOWN_SERVICES.ssh).toBeDefined();
    expect(KNOWN_SERVICES.http).toBeDefined();
    expect(KNOWN_SERVICES.mysql).toBeDefined();
    expect(KNOWN_SERVICES.ssh!.product).toBe("OpenSSH");
  });
});

// ── プリセット実験 ──

describe("EXPERIMENTS", () => {
  it("9 つのプリセット", () => {
    expect(EXPERIMENTS).toHaveLength(9);
  });

  it("名前が一意", () => {
    expect(new Set(EXPERIMENTS.map((e) => e.name)).size).toBe(EXPERIMENTS.length);
  });

  for (const exp of EXPERIMENTS) {
    it(`${exp.name}: スキャン可能`, () => {
      const scanner = new NmapScanner(exp.network);
      const result = scanner.scan(exp.config);
      expect(result.events.length).toBeGreaterThan(0);
      expect(result.hosts.length).toBeGreaterThan(0);
      expect(result.nmapOutput.length).toBeGreaterThan(0);
    });
  }
});
