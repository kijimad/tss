import { describe, it, expect } from "vitest";
import {
  tcpHandshakeCost, tls12HandshakeCost, tls13HandshakeCost, tls13ZeroRttCost,
  quicHandshakeCost, quicZeroRttCost, dnsCost, authCost, requestCost, reuseCost,
  ConnCostSimulator, NETWORKS, DEFAULT_SERVER,
} from "../engine/conncost.js";
import { EXPERIMENTS } from "../ui/app.js";
import type { SimConfig } from "../engine/conncost.js";

// ── コスト関数 ──

describe("tcpHandshakeCost", () => {
  it("1 RTT のコスト", () => {
    const c = tcpHandshakeCost(50);
    expect(c.durationMs).toBe(50);
    expect(c.rtts).toBe(1);
    expect(c.packets).toBe(3);
  });
});

describe("tls12HandshakeCost", () => {
  it("2 RTT のコスト", () => {
    const c = tls12HandshakeCost(100);
    expect(c.durationMs).toBe(200);
    expect(c.rtts).toBe(2);
  });
});

describe("tls13HandshakeCost", () => {
  it("1 RTT のコスト", () => {
    const c = tls13HandshakeCost(100);
    expect(c.durationMs).toBe(100);
    expect(c.rtts).toBe(1);
  });
});

describe("tls13ZeroRttCost", () => {
  it("0 RTT", () => {
    const c = tls13ZeroRttCost();
    expect(c.durationMs).toBe(0);
    expect(c.rtts).toBe(0);
  });
});

describe("quicHandshakeCost", () => {
  it("1 RTT (TCP+TLS 統合)", () => {
    const c = quicHandshakeCost(80);
    expect(c.durationMs).toBe(80);
    expect(c.rtts).toBe(1);
  });
});

describe("quicZeroRttCost", () => {
  it("0 RTT", () => {
    const c = quicZeroRttCost();
    expect(c.durationMs).toBe(0);
    expect(c.rtts).toBe(0);
  });
});

describe("dnsCost", () => {
  it("DNS ありのコスト", () => {
    const c = dnsCost(20);
    expect(c.durationMs).toBe(20);
    expect(c.packets).toBe(2);
  });
  it("DNS キャッシュ済み", () => {
    const c = dnsCost(0);
    expect(c.durationMs).toBe(0);
    expect(c.packets).toBe(0);
  });
});

describe("authCost", () => {
  it("認証あり", () => {
    const c = authCost(10, 50);
    expect(c.durationMs).toBe(60);
    expect(c.rtts).toBe(1);
  });
  it("認証なし", () => {
    const c = authCost(0, 50);
    expect(c.durationMs).toBe(0);
  });
});

describe("requestCost", () => {
  it("処理時間 + 1 RTT", () => {
    const c = requestCost(10, 50);
    expect(c.durationMs).toBe(60);
    expect(c.rtts).toBe(1);
  });
});

describe("reuseCost", () => {
  it("コスト 0", () => {
    const c = reuseCost();
    expect(c.durationMs).toBe(0);
    expect(c.rtts).toBe(0);
    expect(c.cpuCost).toBe(0);
  });
});

// ── シミュレーター ──

describe("ConnCostSimulator", () => {
  const base: SimConfig = {
    protocol: "tcp", connMode: "new-per-request",
    network: NETWORKS.lan!, server: DEFAULT_SERVER, requestCount: 1,
  };

  it("TCP 平文の基本フロー", () => {
    const sim = new ConnCostSimulator();
    const r = sim.simulate(base);
    expect(r.requests).toHaveLength(1);
    expect(r.summary.connectionsCreated).toBe(1);
    expect(r.summary.totalRtts).toBeGreaterThanOrEqual(2);
  });

  it("TLS 1.2 は TCP + TLS (3 RTT)", () => {
    const sim = new ConnCostSimulator();
    const r = sim.simulate({ ...base, protocol: "tls12" });
    const req = r.requests[0]!;
    expect(req.phases.some((p) => p.phase === "TCP Handshake")).toBe(true);
    expect(req.phases.some((p) => p.phase === "TLS 1.2 Handshake")).toBe(true);
    expect(req.totalRtts).toBeGreaterThanOrEqual(3);
  });

  it("TLS 1.3 は TCP + TLS (2 RTT)", () => {
    const sim = new ConnCostSimulator();
    const r = sim.simulate({ ...base, protocol: "tls13" });
    const req = r.requests[0]!;
    expect(req.phases.some((p) => p.phase === "TLS 1.3 Handshake")).toBe(true);
    expect(req.totalRtts).toBeGreaterThanOrEqual(2);
  });

  it("TLS 1.3 0-RTT: 初回はフル、2 回目は 0-RTT", () => {
    const sim = new ConnCostSimulator();
    const r = sim.simulate({ ...base, protocol: "tls13-0rtt", requestCount: 2 });
    expect(r.requests[0]!.phases.some((p) => p.phase === "TLS 1.3 Handshake")).toBe(true);
    expect(r.requests[1]!.phases.some((p) => p.phase === "TLS 1.3 0-RTT")).toBe(true);
    expect(r.requests[1]!.totalMs).toBeLessThan(r.requests[0]!.totalMs);
  });

  it("QUIC は 1 RTT (TCP+TLS 統合)", () => {
    const sim = new ConnCostSimulator();
    const r = sim.simulate({ ...base, protocol: "quic" });
    expect(r.requests[0]!.phases.some((p) => p.phase === "QUIC Handshake")).toBe(true);
    expect(r.requests[0]!.totalRtts).toBeLessThanOrEqual(3);
  });

  it("QUIC 0-RTT: 2 回目は 0-RTT", () => {
    const sim = new ConnCostSimulator();
    const r = sim.simulate({ ...base, protocol: "quic-0rtt", requestCount: 2 });
    expect(r.requests[1]!.phases.some((p) => p.phase === "QUIC 0-RTT")).toBe(true);
  });

  it("Keep-Alive で 2 回目以降はコスト 0", () => {
    const sim = new ConnCostSimulator();
    const r = sim.simulate({ ...base, protocol: "tls13", connMode: "keep-alive", requestCount: 5 });
    expect(r.summary.connectionsCreated).toBe(1);
    expect(r.summary.connectionsReused).toBe(4);
    expect(r.requests[1]!.connectionReused).toBe(true);
    expect(r.requests[1]!.totalMs).toBeLessThan(r.requests[0]!.totalMs);
  });

  it("new-per-request で毎回接続コストがかかる", () => {
    const sim = new ConnCostSimulator();
    const r = sim.simulate({ ...base, protocol: "tls13", connMode: "new-per-request", requestCount: 3 });
    expect(r.summary.connectionsCreated).toBe(3);
    expect(r.summary.connectionsReused).toBe(0);
  });

  it("高 RTT 環境で HS オーバーヘッドが大きい", () => {
    const sim = new ConnCostSimulator();
    const rLan = sim.simulate({ ...base, protocol: "tls12", network: NETWORKS.lan! });
    const rGlobal = sim.simulate({ ...base, protocol: "tls12", network: NETWORKS.global! });
    expect(rGlobal.summary.handshakeOverheadMs).toBeGreaterThan(rLan.summary.handshakeOverheadMs);
  });

  it("HS オーバーヘッドのパーセンテージが計算される", () => {
    const sim = new ConnCostSimulator();
    const r = sim.simulate({ ...base, protocol: "tls12", network: NETWORKS.global!, requestCount: 1 });
    expect(r.summary.handshakeOverheadPercent).toBeGreaterThan(0);
    expect(r.summary.handshakeOverheadPercent).toBeLessThanOrEqual(100);
  });

  it("QUIC < TLS 1.3 < TLS 1.2 の順でコストが低い", () => {
    const sim = new ConnCostSimulator();
    const net = NETWORKS.global!;
    const r12 = sim.simulate({ ...base, protocol: "tls12", network: net });
    const r13 = sim.simulate({ ...base, protocol: "tls13", network: net });
    const rQ = sim.simulate({ ...base, protocol: "quic", network: net });
    expect(rQ.requests[0]!.totalMs).toBeLessThan(r13.requests[0]!.totalMs);
    expect(r13.requests[0]!.totalMs).toBeLessThan(r12.requests[0]!.totalMs);
  });
});

// ── NETWORKS ──

describe("NETWORKS", () => {
  it("7 つのプリセット", () => {
    expect(Object.keys(NETWORKS)).toHaveLength(7);
  });
  it("LAN の RTT が最小", () => {
    expect(NETWORKS.lan!.rttMs).toBeLessThanOrEqual(NETWORKS.satellite!.rttMs);
  });
});

// ── プリセット ──

describe("EXPERIMENTS", () => {
  it("9 つのプリセット", () => { expect(EXPERIMENTS).toHaveLength(9); });
  it("名前が一意", () => { expect(new Set(EXPERIMENTS.map((e) => e.name)).size).toBe(EXPERIMENTS.length); });
  for (const exp of EXPERIMENTS) {
    it(`${exp.name}: シミュレーション可能`, () => {
      const sim = new ConnCostSimulator();
      const r = sim.simulate(exp.config);
      expect(r.requests.length).toBe(exp.config.requestCount);
      expect(r.events.length).toBeGreaterThan(0);
    });
  }
});
