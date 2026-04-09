import { describe, it, expect } from "vitest";
import {
  ipToInt, intToIp, isInSubnet, rangeSize,
  createDiscover, createOffer, createRequest, createAck, createNak, createRelease, createDecline,
  DhcpServer, DhcpSimulator,
  createPool, createClient,
} from "../engine/dhcp.js";
import { EXPERIMENTS } from "../ui/app.js";

// ── IP ユーティリティ ──

describe("ipToInt / intToIp", () => {
  it("IP アドレスを整数に変換して復元する", () => {
    expect(intToIp(ipToInt("192.168.1.1"))).toBe("192.168.1.1");
    expect(intToIp(ipToInt("10.0.0.0"))).toBe("10.0.0.0");
    expect(intToIp(ipToInt("255.255.255.255"))).toBe("255.255.255.255");
    expect(intToIp(ipToInt("0.0.0.0"))).toBe("0.0.0.0");
  });

  it("正しい整数値を返す", () => {
    expect(ipToInt("192.168.1.1")).toBe(0xc0a80101);
    expect(ipToInt("10.0.0.1")).toBe(0x0a000001);
  });
});

describe("isInSubnet", () => {
  it("同一サブネット内の IP を判定する", () => {
    expect(isInSubnet("192.168.1.50", "192.168.1.0", "255.255.255.0")).toBe(true);
    expect(isInSubnet("192.168.2.50", "192.168.1.0", "255.255.255.0")).toBe(false);
  });

  it("/16 マスクで判定する", () => {
    expect(isInSubnet("10.0.5.100", "10.0.0.0", "255.255.0.0")).toBe(true);
    expect(isInSubnet("10.1.0.1", "10.0.0.0", "255.255.0.0")).toBe(false);
  });
});

describe("rangeSize", () => {
  it("アドレス範囲のサイズを計算する", () => {
    expect(rangeSize("192.168.1.100", "192.168.1.200")).toBe(101);
    expect(rangeSize("192.168.1.1", "192.168.1.1")).toBe(1);
  });
});

// ── パケット生成 ──

describe("パケット生成", () => {
  const client = createClient("test-host", "aa:bb:cc:dd:ee:ff");

  it("DISCOVER パケットを生成する", () => {
    const pkt = createDiscover(client, 0x12345678);
    expect(pkt.op).toBe("BOOTREQUEST");
    expect(pkt.messageType).toBe("DHCPDISCOVER");
    expect(pkt.chaddr).toBe("aa:bb:cc:dd:ee:ff");
    expect(pkt.xid).toBe(0x12345678);
    expect(pkt.flags).toBe(0x8000);
  });

  it("DISCOVER に希望 IP を含められる", () => {
    const pkt = createDiscover(client, 1, "192.168.1.50");
    expect(pkt.options.some((o) => o.code === 50 && o.value === "192.168.1.50")).toBe(true);
  });

  it("OFFER パケットを生成する", () => {
    const pool = createPool();
    const pkt = createOffer(1, "192.168.1.100", "192.168.1.1", "aa:bb:cc:dd:ee:ff", pool, 3600000);
    expect(pkt.op).toBe("BOOTREPLY");
    expect(pkt.messageType).toBe("DHCPOFFER");
    expect(pkt.yiaddr).toBe("192.168.1.100");
    expect(pkt.options.some((o) => o.code === 1)).toBe(true);
    expect(pkt.options.some((o) => o.code === 3)).toBe(true);
    expect(pkt.options.some((o) => o.code === 6)).toBe(true);
  });

  it("REQUEST パケットを生成する", () => {
    const pkt = createRequest(client, 1, "192.168.1.100", "192.168.1.1");
    expect(pkt.messageType).toBe("DHCPREQUEST");
    expect(pkt.options.some((o) => o.code === 50 && o.value === "192.168.1.100")).toBe(true);
  });

  it("ACK パケットを生成する", () => {
    const pool = createPool();
    const pkt = createAck(1, "192.168.1.100", "192.168.1.1", "aa:bb:cc:dd:ee:ff", pool, 3600000);
    expect(pkt.messageType).toBe("DHCPACK");
    expect(pkt.yiaddr).toBe("192.168.1.100");
  });

  it("NAK パケットを生成する", () => {
    const pkt = createNak(1, "192.168.1.1", "aa:bb:cc:dd:ee:ff", "テスト");
    expect(pkt.messageType).toBe("DHCPNAK");
    expect(pkt.options.some((o) => o.code === 56 && o.value === "テスト")).toBe(true);
  });

  it("RELEASE パケットを生成する", () => {
    const c = { ...client, ip: "192.168.1.100" };
    const pkt = createRelease(c, 1, "192.168.1.1");
    expect(pkt.messageType).toBe("DHCPRELEASE");
    expect(pkt.ciaddr).toBe("192.168.1.100");
  });

  it("DECLINE パケットを生成する", () => {
    const pkt = createDecline(client, 1, "192.168.1.1", "192.168.1.100");
    expect(pkt.messageType).toBe("DHCPDECLINE");
    expect(pkt.options.some((o) => o.code === 50 && o.value === "192.168.1.100")).toBe(true);
  });
});

// ── DHCP サーバー ──

describe("DhcpServer", () => {
  it("IP アドレスを割り当てる", () => {
    const pool = createPool();
    const server = new DhcpServer(pool, "192.168.1.1");
    const ip = server.allocateIp("aa:bb:cc:00:00:01");
    expect(ip).toBe("192.168.1.100");
  });

  it("予約アドレスを優先する", () => {
    const pool = createPool({
      reservations: new Map([["aa:bb:cc:00:00:01", "192.168.1.10"]]),
    });
    const server = new DhcpServer(pool, "192.168.1.1");
    const ip = server.allocateIp("aa:bb:cc:00:00:01");
    expect(ip).toBe("192.168.1.10");
  });

  it("DISCOVER → OFFER を処理する", () => {
    const pool = createPool();
    const server = new DhcpServer(pool, "192.168.1.1");
    const discover = createDiscover(createClient("test", "aa:bb:cc:00:00:01"), 1);
    const result = server.handleDiscover(discover, 0);
    expect("offer" in result).toBe(true);
    if ("offer" in result) {
      expect(result.offer.messageType).toBe("DHCPOFFER");
      expect(result.ip).toBe("192.168.1.100");
    }
  });

  it("REQUEST → ACK を処理する", () => {
    const pool = createPool();
    const server = new DhcpServer(pool, "192.168.1.1");
    const client = createClient("test", "aa:bb:cc:00:00:01");
    const discover = createDiscover(client, 1);
    const offerResult = server.handleDiscover(discover, 0);
    expect("offer" in offerResult).toBe(true);

    const request = createRequest(client, 1, "192.168.1.100", "192.168.1.1");
    const ackResult = server.handleRequest(request, 100);
    expect("ack" in ackResult).toBe(true);
  });

  it("不一致の REQUEST に NAK を返す", () => {
    const pool = createPool();
    const server = new DhcpServer(pool, "192.168.1.1");
    const client = createClient("test", "aa:bb:cc:00:00:01");
    const request = createRequest(client, 1, "192.168.1.99", "192.168.1.1");
    const result = server.handleRequest(request, 0);
    expect("nak" in result).toBe(true);
  });

  it("RELEASE でリースを解放する", () => {
    const pool = createPool();
    const server = new DhcpServer(pool, "192.168.1.1");
    const client = createClient("test", "aa:bb:cc:00:00:01");
    server.handleDiscover(createDiscover(client, 1), 0);
    server.handleRequest(createRequest(client, 1, "192.168.1.100", "192.168.1.1"), 100);

    expect(server.getPoolUsage().used).toBe(1);
    client.ip = "192.168.1.100";
    server.handleRelease(createRelease(client, 2, "192.168.1.1"));
    expect(server.getPoolUsage().used).toBe(0);
    expect(server.getLeases().find((l) => l.mac === client.mac)?.state).toBe("released");
  });

  it("DECLINE で IP を除外する", () => {
    const pool = createPool();
    const server = new DhcpServer(pool, "192.168.1.1");
    const client = createClient("test", "aa:bb:cc:00:00:01");
    server.handleDiscover(createDiscover(client, 1), 0);

    server.handleDecline(createDecline(client, 1, "192.168.1.1", "192.168.1.100"));
    // 次の割り当てでは .100 がスキップされる
    const ip2 = server.allocateIp("aa:bb:cc:00:00:02");
    expect(ip2).toBe("192.168.1.101");
  });

  it("プール枯渇で NAK を返す", () => {
    const pool = createPool({ rangeStart: "192.168.1.100", rangeEnd: "192.168.1.100" });
    const server = new DhcpServer(pool, "192.168.1.1");
    server.handleDiscover(createDiscover(createClient("c1", "aa:00:00:00:00:01"), 1), 0);
    const result = server.handleDiscover(createDiscover(createClient("c2", "aa:00:00:00:00:02"), 2), 100);
    expect("nak" in result).toBe(true);
  });

  it("リース更新を処理する", () => {
    const pool = createPool({ defaultLease: 200 });
    const server = new DhcpServer(pool, "192.168.1.1");
    const client = createClient("test", "aa:bb:cc:00:00:01");
    server.handleDiscover(createDiscover(client, 1), 0);
    server.handleRequest(createRequest(client, 1, "192.168.1.100", "192.168.1.1"), 10);

    const renewReq = createRequest(client, 2, "192.168.1.100", "192.168.1.1");
    const result = server.handleRenew(renewReq, 110);
    expect("ack" in result).toBe(true);
  });

  it("期限切れリースを処理する", () => {
    const pool = createPool({ defaultLease: 100 });
    const server = new DhcpServer(pool, "192.168.1.1");
    const client = createClient("test", "aa:bb:cc:00:00:01");
    server.handleDiscover(createDiscover(client, 1), 0);
    server.handleRequest(createRequest(client, 1, "192.168.1.100", "192.168.1.1"), 10);

    const expired = server.expireLeases(200);
    expect(expired).toHaveLength(1);
    expect(expired[0]!.state).toBe("expired");
    expect(server.getPoolUsage().used).toBe(0);
  });
});

// ── シミュレーター ──

describe("DhcpSimulator", () => {
  it("基本的な DORA シミュレーションが完了する", () => {
    const sim = new DhcpSimulator();
    const result = sim.simulate({
      pool: createPool(),
      clients: [createClient("host", "aa:bb:cc:00:00:01")],
      networkLatency: 5,
      maxTime: 100,
      simulateRenewal: false,
      releaseClients: [],
      declineClients: [],
      rogueServer: false,
    });

    expect(result.events.length).toBeGreaterThan(3);
    expect(result.leases).toHaveLength(1);
    expect(result.leases[0]!.state).toBe("bound");
    expect(result.clientIps.get("aa:bb:cc:00:00:01")).toBe("192.168.1.100");
  });

  it("複数クライアントに異なる IP を割り当てる", () => {
    const sim = new DhcpSimulator();
    const result = sim.simulate({
      pool: createPool(),
      clients: [
        createClient("h1", "aa:00:00:00:00:01"),
        createClient("h2", "aa:00:00:00:00:02"),
        createClient("h3", "aa:00:00:00:00:03"),
      ],
      networkLatency: 5,
      maxTime: 500,
      simulateRenewal: false,
      releaseClients: [],
      declineClients: [],
      rogueServer: false,
    });

    const ips = new Set(result.clientIps.values());
    expect(ips.size).toBe(3);
  });

  it("RELEASE でクライアント IP が解放される", () => {
    const sim = new DhcpSimulator();
    const result = sim.simulate({
      pool: createPool(),
      clients: [createClient("h1", "aa:00:00:00:00:01")],
      networkLatency: 5,
      maxTime: 500,
      simulateRenewal: false,
      releaseClients: ["aa:00:00:00:00:01"],
      declineClients: [],
      rogueServer: false,
    });

    expect(result.clientIps.has("aa:00:00:00:00:01")).toBe(false);
    expect(result.events.some((e) => e.detail.includes("DHCPRELEASE"))).toBe(true);
  });

  it("DECLINE で再割り当てが行われる", () => {
    const sim = new DhcpSimulator();
    const result = sim.simulate({
      pool: createPool(),
      clients: [createClient("h1", "aa:00:00:00:00:01")],
      networkLatency: 5,
      maxTime: 500,
      simulateRenewal: false,
      releaseClients: [],
      declineClients: ["aa:00:00:00:00:01"],
      rogueServer: false,
    });

    expect(result.events.some((e) => e.detail.includes("DHCPDECLINE"))).toBe(true);
    // 再割り当てされた IP は .100 でなく .101
    expect(result.clientIps.get("aa:00:00:00:00:01")).toBe("192.168.1.101");
  });

  it("リレーエージェント経由で動作する", () => {
    const sim = new DhcpSimulator();
    const result = sim.simulate({
      pool: createPool({ subnet: "10.0.0.0", mask: "255.255.0.0", rangeStart: "10.0.1.100", rangeEnd: "10.0.1.200", gateway: "10.0.0.1" }),
      clients: [createClient("remote", "aa:00:00:00:00:01")],
      relay: { ip: "10.0.0.254", serverIp: "10.0.0.1", latency: 10 },
      networkLatency: 5,
      maxTime: 500,
      simulateRenewal: false,
      releaseClients: [],
      declineClients: [],
      rogueServer: false,
    });

    expect(result.events.some((e) => e.type === "relay")).toBe(true);
    expect(result.clientIps.get("aa:00:00:00:00:01")).toBe("10.0.1.100");
  });
});

// ── ヘルパー ──

describe("createPool", () => {
  it("デフォルト値でプールを作成する", () => {
    const pool = createPool();
    expect(pool.subnet).toBe("192.168.1.0");
    expect(pool.gateway).toBe("192.168.1.1");
    expect(pool.dnsServers).toEqual(["8.8.8.8", "8.8.4.4"]);
  });

  it("オーバーライドが反映される", () => {
    const pool = createPool({ gateway: "10.0.0.1", defaultLease: 1000 });
    expect(pool.gateway).toBe("10.0.0.1");
    expect(pool.defaultLease).toBe(1000);
  });
});

describe("createClient", () => {
  it("クライアントを作成する", () => {
    const c = createClient("test", "aa:bb:cc:dd:ee:ff");
    expect(c.hostname).toBe("test");
    expect(c.mac).toBe("aa:bb:cc:dd:ee:ff");
    expect(c.ip).toBe("0.0.0.0");
  });

  it("MAC を自動生成できる", () => {
    const c = createClient("auto");
    expect(c.mac).toMatch(/^02:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}$/);
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
    it(`${exp.name}: シミュレーション可能`, () => {
      const sim = new DhcpSimulator();
      const clients = exp.config.clients.map((c) => ({ ...c }));
      const pool = { ...exp.config.pool, reservations: new Map(exp.config.pool.reservations) };
      const result = sim.simulate({ ...exp.config, pool, clients });
      expect(result.events.length).toBeGreaterThan(0);
    });
  }
});
